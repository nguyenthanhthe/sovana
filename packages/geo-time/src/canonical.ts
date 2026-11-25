import { sha256Hex } from './sha256.js';
import { loadEphemeris } from './store.js';
import { findSolarTermAt, floorMod, formatIsoDate } from './ephemeris.js';
import { resolveLocation } from './geo.js';
import { computeSexagenaryPillars, solarToLunar } from './lunar.js';
import { computeTrueSolarTime } from './solarTime.js';
import { resolveHistoricalTimezone } from './tz.js';
import type {
  CalendarMode,
  LateZiPolicy,
  LeapMonthPolicy,
  NormalizeBirthInput,
  NormalizedBirthTemporal,
} from './types.js';
import { computeMigrationAzimuth } from './vincenty.js';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function serializeCanonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Non-finite number not allowed in canonical JSON: ${value}`);
    }
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeCanonical(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${serializeCanonical(obj[k])}`);
    return `{${entries.join(',')}}`;
  }
  throw new Error(`Unsupported canonical JSON value type: ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return serializeCanonical(value);
}

export function sha256Canonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function normalizeBirthTemporal(input: NormalizeBirthInput): NormalizedBirthTemporal {
  const second = input.second ?? 0;
  const calendarMode: CalendarMode = input.calendarMode ?? 'VN_HISTORICAL';
  const leapMonthPolicy: LeapMonthPolicy = input.leapMonthPolicy ?? 'keep';
  const lateZiPolicy: LateZiPolicy = input.lateZiPolicy ?? 'next-day';

  const eph = loadEphemeris();
  const location = resolveLocation(input.location);
  const timezone = resolveHistoricalTimezone({
    year: input.year,
    month: input.month,
    day: input.day,
    hour: input.hour,
    minute: input.minute,
    second,
    lat: location.lat,
    lon: location.lon,
    tzZone: location.tzZone,
    ianaTimeZone: input.ianaTimeZone,
  });

  const trueSolarTime = computeTrueSolarTime({
    year: input.year,
    month: input.month,
    day: input.day,
    hour: input.hour,
    minute: input.minute,
    second,
    lon: location.lon,
    utcOffsetSeconds: timezone.utcOffsetSeconds,
  });

  const solarTerm = findSolarTermAt(eph, trueSolarTime.instantUnixMs);
  const lunarVn = solarToLunar(eph, trueSolarTime.trueSolarEpochDay, 'VN_UTC7', leapMonthPolicy);
  const lunarCn = solarToLunar(eph, trueSolarTime.trueSolarEpochDay, 'CN_UTC8', leapMonthPolicy);
  const lunarActive =
    calendarMode === 'CN_UTC8'
      ? lunarCn
      : calendarMode === 'VN_UTC7'
        ? lunarVn
        : timezone.decision121CpLunar
          ? lunarVn
          : timezone.utcOffsetSeconds === 28_800
            ? lunarCn
            : lunarVn;

  const pillars = computeSexagenaryPillars(
    eph,
    trueSolarTime.instantUnixMs,
    lunarActive.lunarYear,
    trueSolarTime.trueSolarEpochDay,
    trueSolarTime.shichenBranch,
    trueSolarTime.isLateZi,
    lateZiPolicy,
  );

  const isShichenBoundaryAmbiguous = trueSolarTime.secondsToShichenBoundary <= 900;
  const isSolarTermBoundaryAmbiguous = solarTerm.minSecondsToTermBoundary <= 600;
  const candidateShichenBranches = [trueSolarTime.shichenBranch];
  if (isShichenBoundaryAmbiguous) {
    const msMod = (trueSolarTime.hour * 3600 + trueSolarTime.minute * 60 + trueSolarTime.second) * 1000;
    const nearestOddIdx = Math.round((msMod - 3_600_000) / 7_200_000);
    const boundaryMs = nearestOddIdx * 7_200_000 + 3_600_000;
    const adj =
      msMod >= boundaryMs
        ? floorMod(trueSolarTime.shichenBranch - 1, 12)
        : floorMod(trueSolarTime.shichenBranch + 1, 12);
    if (!candidateShichenBranches.includes(adj)) {
      candidateShichenBranches.push(adj);
    }
  }

  const migration = input.migrationDestination
    ? (() => {
        const dest = resolveLocation(input.migrationDestination);
        return computeMigrationAzimuth(location.lat, location.lon, dest.lat, dest.lon);
      })()
    : null;

  return {
    schemaVersion: '1.0.0',
    inputEcho: {
      isoWallClock: `${formatIsoDate(input.year, input.month, input.day)}T${pad2(input.hour)}:${pad2(input.minute)}:${pad2(second)}`,
      calendarMode,
      leapMonthPolicy,
      lateZiPolicy,
    },
    location,
    timezone,
    trueSolarTime,
    solarTerm,
    lunarVn,
    lunarCn,
    lunarActive,
    pillars,
    uncertainty: {
      isShichenBoundaryAmbiguous,
      secondsToShichenBoundary: trueSolarTime.secondsToShichenBoundary,
      isSolarTermBoundaryAmbiguous,
      minSecondsToTermBoundary: solarTerm.minSecondsToTermBoundary,
      isContestedTimezone: timezone.isContestedZone,
      isDstGapOrFold: timezone.isDstGapOrFold,
      wideLongitudeWarning: location.wideLongitudeWarning,
      isBoundaryAmbiguous:
        isShichenBoundaryAmbiguous || isSolarTermBoundaryAmbiguous || timezone.isContestedZone || timezone.isDstGapOrFold,
      candidateShichenBranches,
    },
    migration,
  };
}
