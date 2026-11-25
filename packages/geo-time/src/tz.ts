import { loadTzRegimes } from './store.js';
import { epochDayFromCivil, formatIsoDate } from './ephemeris.js';
import type { TimezoneQuery, TimezoneResolution, VietnamTzZone } from './types.js';

const VN_IANA_ALIASES = new Set(['Asia/Ho_Chi_Minh', 'Asia/Saigon', 'Asia/Hanoi']);

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseWallSeconds(isoWall: string): bigint {
  const year = Number(isoWall.slice(0, 4));
  const month = Number(isoWall.slice(5, 7));
  const day = Number(isoWall.slice(8, 10));
  const hour = Number(isoWall.slice(11, 13));
  const minute = Number(isoWall.slice(14, 16));
  const second = Number(isoWall.slice(17, 19));
  const ed = epochDayFromCivil(year, month, day);
  return BigInt(ed) * 86_400n + BigInt(hour * 3600 + minute * 60 + second);
}

function formatOffsetLabel(offsetSeconds: number): string {
  const sign = offsetSeconds >= 0 ? '+' : '-';
  const abs = Math.abs(offsetSeconds);
  const hh = Math.floor(abs / 3600);
  const mm = Math.floor((abs % 3600) / 60);
  const ss = abs % 60;
  return ss === 0 ? `${sign}${pad2(hh)}:${pad2(mm)}` : `${sign}${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(ianaTimeZone: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(ianaTimeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: ianaTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    dtfCache.set(ianaTimeZone, dtf);
  }
  return dtf;
}

function resolveIntlOffsetSeconds(
  ianaTimeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): { offsetSeconds: number; isDstGapOrFold: boolean } {
  const wallUtcMs = epochDayFromCivil(year, month, day) * 86_400_000 + (hour * 3600 + minute * 60 + second) * 1000;
  const dtf = getFormatter(ianaTimeZone);

  const partsToUtcMs = (utcGuessMs: number): number => {
    const parts = dtf.formatToParts(new Date(utcGuessMs));
    const map: Record<string, number> = {};
    for (const p of parts) {
      if (p.type !== 'literal') {
        map[p.type] = Number(p.value);
      }
    }
    const h = map.hour === 24 ? 0 : (map.hour ?? 0);
    return epochDayFromCivil(map.year!, map.month!, map.day!) * 86_400_000 + (h * 3600 + map.minute! * 60 + map.second!) * 1000;
  };

  // Two-pass fixed-point iteration from UTC wall guess
  let guess = wallUtcMs;
  for (let i = 0; i < 3; i++) {
    const localAtGuess = partsToUtcMs(guess);
    guess = guess + (wallUtcMs - localAtGuess);
  }
  const offsetSeconds = Math.round((wallUtcMs - guess) / 1000);

  // Check +/- 1 hour for fold/gap
  const offMinus = Math.round((partsToUtcMs(guess - 3_600_000) - (guess - 3_600_000)) / 1000);
  const offPlus = Math.round((partsToUtcMs(guess + 3_600_000) - (guess + 3_600_000)) / 1000);
  return {
    offsetSeconds,
    isDstGapOrFold: offMinus !== offsetSeconds || offPlus !== offsetSeconds,
  };
}

export function resolveHistoricalTimezone(query: TimezoneQuery): TimezoneResolution {
  const sec = query.second ?? 0;
  const spec = loadTzRegimes();
  const bb = spec.vietnamBoundingBox;

  const inVnBox =
    query.lat !== undefined &&
    query.lon !== undefined &&
    query.lat >= bb.minLat &&
    query.lat <= bb.maxLat &&
    query.lon >= bb.minLon &&
    query.lon <= bb.maxLon;

  const isVn =
    query.tzZone != null ||
    inVnBox ||
    (query.ianaTimeZone !== undefined && VN_IANA_ALIASES.has(query.ianaTimeZone)) ||
    (query.ianaTimeZone === undefined && query.lat === undefined && query.lon === undefined);

  if (isVn) {
    const zone: VietnamTzZone =
      query.tzZone ?? (query.lat !== undefined && query.lat >= spec.parallel17LatDeg ? 'VN_NORTH_DRV' : 'VN_SOUTH_RVN');
    const intervals = spec.zones[zone];
    const localIso = `${formatIsoDate(query.year, query.month, query.day)}T${pad2(query.hour)}:${pad2(query.minute)}:${pad2(sec)}`;
    const localSec = parseWallSeconds(localIso);

    let matchedIdx = -1;
    for (let i = 0; i < intervals.length; i++) {
      const iv = intervals[i]!;
      if (localIso >= iv.startLocal && localIso < iv.endLocal) {
        matchedIdx = i;
        break;
      }
    }

    // Handle 1-hour wall-clock gaps (e.g. 1942-12-31 23:00 -> 1943-01-01 00:00) by snapping forward
    let isGapOrFold = false;
    if (matchedIdx < 0) {
      for (let i = 0; i < intervals.length; i++) {
        if (localIso < intervals[i]!.startLocal) {
          matchedIdx = i;
          isGapOrFold = true;
          break;
        }
      }
      if (matchedIdx < 0) {
        matchedIdx = intervals.length - 1;
      }
    }

    const iv = intervals[matchedIdx]!;
    if (!isGapOrFold) {
      const prevIv = matchedIdx > 0 ? intervals[matchedIdx - 1]! : null;
      const nextIv = matchedIdx + 1 < intervals.length ? intervals[matchedIdx + 1]! : null;
      if (prevIv && prevIv.utcOffsetSeconds !== iv.utcOffsetSeconds) {
        const diff = localSec - parseWallSeconds(iv.startLocal);
        if (diff >= 0n && diff < 3600n) isGapOrFold = true;
      }
      if (nextIv && nextIv.utcOffsetSeconds !== iv.utcOffsetSeconds) {
        const diff = parseWallSeconds(iv.endLocal) - localSec;
        if (diff > 0n && diff <= 3600n) isGapOrFold = true;
      }
    }

    return {
      source: 'VN_REGIME',
      zoneId: zone,
      regimeId: iv.id,
      utcOffsetSeconds: iv.utcOffsetSeconds,
      utcOffsetLabel: iv.utcOffsetLabel,
      isContestedZone: iv.isContestedZone,
      candidateOffsetsSeconds: [...iv.candidateOffsetsSeconds],
      decision121CpLunar: iv.decision121CpLunar,
      isDstGapOrFold: isGapOrFold,
      historicalNote: iv.historicalNote,
    };
  }

  const iana = query.ianaTimeZone ?? 'UTC';
  const { offsetSeconds, isDstGapOrFold } = resolveIntlOffsetSeconds(
    iana,
    query.year,
    query.month,
    query.day,
    query.hour,
    query.minute,
    sec,
  );
  return {
    source: 'INTL_IANA',
    zoneId: iana,
    regimeId: `IANA_${iana}`,
    utcOffsetSeconds: offsetSeconds,
    utcOffsetLabel: formatOffsetLabel(offsetSeconds),
    isContestedZone: false,
    candidateOffsetsSeconds: [offsetSeconds],
    decision121CpLunar: false,
    isDstGapOrFold,
    historicalNote: `OS Intl/IANA tzdb resolution for ${iana}`,
  };
}
