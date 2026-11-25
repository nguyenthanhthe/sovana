import {
  BRANCHES_VI,
  MS_PER_DAY,
  STEMS_VI,
  civilFromEpochDay,
  epochDayFromCivil,
  findLapXuanMs,
  findSolarTermAt,
  floorMod,
  formatIsoDate,
  localEpochDayFromSeconds,
  upperBound,
} from './ephemeris.js';
import { resolveLocation } from './geo.js';
import { loadEphemeris } from './store.js';
import { resolveHistoricalTimezone } from './tz.js';
import type {
  CalendarMode,
  ConvertLunarToSolarInput,
  ConvertLunarToSolarResult,
  EphemerisTable,
  LateZiPolicy,
  LeapMonthPolicy,
  LunarDateResult,
  LunarMonthMeta,
  LunarYearLeapInfo,
  PillarPair,
  SexagenaryPillars,
  SolarDateResult,
} from './types.js';

interface SuiMonthLabel {
  k: number;
  dayStart: number;
  dayEnd: number;
  lunarYear: number;
  lunarMonth: number;
  isLeapMonth: boolean;
}

function getOffsetSeconds(calendarMode: CalendarMode, offsetSecondsOverride?: number): number {
  if (offsetSecondsOverride !== undefined) return offsetSecondsOverride;
  return calendarMode === 'CN_UTC8' ? 28_800 : 25_200;
}

function findDongChiDay(eph: EphemerisTable, approxGregYear: number, offsetSeconds: number): number {
  const jan1Ms = epochDayFromCivil(approxGregYear, 1, 1) * MS_PER_DAY;
  let idx = Math.max(0, upperBound(eph.solarTerms, jan1Ms) - 1);
  while (idx < eph.solarTerms.length) {
    if ((eph.firstSolarTermIndex + idx) % 24 === 18) {
      const ms = eph.solarTerms[idx]!;
      const d = localEpochDayFromSeconds(ms, offsetSeconds);
      if (civilFromEpochDay(d).year === approxGregYear) {
        return d;
      }
      if (civilFromEpochDay(d).year > approxGregYear) {
        break;
      }
    }
    idx++;
  }
  throw new RangeError(`Dong Chi not found for year ${approxGregYear}`);
}

function newMoonDayAt(eph: EphemerisTable, k: number, offsetSeconds: number): number {
  return localEpochDayFromSeconds(eph.newMoons[k]!, offsetSeconds);
}

function findK11ForYear(eph: EphemerisTable, gregYear: number, offsetSeconds: number): number {
  const dcDay = findDongChiDay(eph, gregYear, offsetSeconds);
  const dcMsEstimate = dcDay * MS_PER_DAY - offsetSeconds * 1000 + MS_PER_DAY;
  let k = Math.min(eph.newMoons.length - 2, Math.max(0, upperBound(eph.newMoons, dcMsEstimate) - 1));
  while (k > 0 && newMoonDayAt(eph, k, offsetSeconds) > dcDay) {
    k--;
  }
  while (k + 1 < eph.newMoons.length && newMoonDayAt(eph, k + 1, offsetSeconds) <= dcDay) {
    k++;
  }
  return k;
}

function monthHasZhongqi(eph: EphemerisTable, day0: number, day1: number, offsetSeconds: number): boolean {
  const msLow = day0 * MS_PER_DAY - offsetSeconds * 1000 - MS_PER_DAY;
  let idx = Math.max(0, upperBound(eph.solarTerms, msLow) - 1);
  while (idx < eph.solarTerms.length) {
    const termIdx = (eph.firstSolarTermIndex + idx) % 24;
    const tDay = localEpochDayFromSeconds(eph.solarTerms[idx]!, offsetSeconds);
    if (tDay >= day1) break;
    if (tDay >= day0 && termIdx % 2 === 0) {
      return true;
    }
    idx++;
  }
  return false;
}

const suiLabelCache = new WeakMap<EphemerisTable, Map<string, SuiMonthLabel[]>>();

function buildSuiLabels(eph: EphemerisTable, y0: number, offsetSeconds: number): SuiMonthLabel[] {
  let byKey = suiLabelCache.get(eph);
  if (!byKey) {
    byKey = new Map();
    suiLabelCache.set(eph, byKey);
  }
  const cacheKey = `${y0}:${offsetSeconds}`;
  const cached = byKey.get(cacheKey);
  if (cached) return cached;

  const kStart = findK11ForYear(eph, y0, offsetSeconds);
  const kEnd = findK11ForYear(eph, y0 + 1, offsetSeconds);
  const hasLeap = kEnd - kStart === 13;
  let leapAssigned = false;
  let monthNum = 10;
  let lunarYear = y0;
  const labels: SuiMonthLabel[] = [];

  for (let k = kStart; k < kEnd; k++) {
    const dayStart = newMoonDayAt(eph, k, offsetSeconds);
    const dayEnd = newMoonDayAt(eph, k + 1, offsetSeconds) - 1;
    let isLeap = false;
    if (k === kStart) {
      monthNum = 11;
      lunarYear = y0;
    } else if (hasLeap && !leapAssigned && !monthHasZhongqi(eph, dayStart, dayEnd + 1, offsetSeconds)) {
      isLeap = true;
      leapAssigned = true;
    } else {
      monthNum += 1;
      if (monthNum > 12) monthNum = 1;
      if (monthNum === 1) lunarYear = y0 + 1;
    }
    labels.push({
      k,
      dayStart,
      dayEnd,
      lunarYear,
      lunarMonth: monthNum,
      isLeapMonth: isLeap,
    });
  }
  byKey.set(cacheKey, labels);
  return labels;
}

export function computeEffectiveLunarMonth(
  lunarMonth: number,
  lunarDay: number,
  isLeapMonth: boolean,
  policy: LeapMonthPolicy,
): number {
  if (!isLeapMonth) return lunarMonth;
  if (policy === 'next-month') return (lunarMonth % 12) + 1;
  if (policy === 'split-15') return lunarDay <= 15 ? lunarMonth : (lunarMonth % 12) + 1;
  return lunarMonth;
}

export function solarToLunar(
  eph: EphemerisTable,
  epochDay: number,
  calendarMode: CalendarMode = 'VN_UTC7',
  leapMonthPolicy: LeapMonthPolicy = 'keep',
  offsetSecondsOverride?: number,
): LunarDateResult {
  const offsetSeconds = getOffsetSeconds(calendarMode, offsetSecondsOverride);
  const gregYear = civilFromEpochDay(epochDay).year;
  const maxSui = eph.endYear - 2;
  const initSui = Math.max(eph.startYear, Math.min(maxSui, gregYear - 1));

  let labels = buildSuiLabels(eph, initSui, offsetSeconds);
  const lastLabel = labels[labels.length - 1]!;
  if (epochDay > lastLabel.dayEnd && initSui + 1 <= maxSui) {
    labels = buildSuiLabels(eph, initSui + 1, offsetSeconds);
  } else if (epochDay < labels[0]!.dayStart && initSui - 1 >= eph.startYear) {
    labels = buildSuiLabels(eph, initSui - 1, offsetSeconds);
  }

  for (const m of labels) {
    if (epochDay >= m.dayStart && epochDay <= m.dayEnd) {
      const lunarDay = epochDay - m.dayStart + 1;
      const monthLengthDays = m.dayEnd - m.dayStart + 1;
      return {
        lunarYear: m.lunarYear,
        lunarMonth: m.lunarMonth,
        lunarDay,
        isLeapMonth: m.isLeapMonth,
        effectiveLunarMonth: computeEffectiveLunarMonth(m.lunarMonth, lunarDay, m.isLeapMonth, leapMonthPolicy),
        monthLengthDays,
        calendarMode,
        offsetSeconds,
        leapMonthPolicy,
      };
    }
  }
  throw new RangeError(`Epoch day ${epochDay} outside lunar Sui bounds`);
}

function lunarToSolarMeta(
  eph: EphemerisTable,
  lunarYear: number,
  lunarMonth: number,
  lunarDay: number,
  isLeapMonth = false,
  calendarMode: CalendarMode = 'VN_UTC7',
  offsetSecondsOverride?: number,
): { solar: SolarDateResult; monthLengthDays: number; offsetSeconds: number } {
  if (!Number.isInteger(lunarYear)) {
    throw new RangeError(`Invalid lunar year: ${lunarYear}`);
  }
  if (!Number.isInteger(lunarMonth) || lunarMonth < 1 || lunarMonth > 12) {
    throw new RangeError(`Invalid lunar month: ${lunarMonth}`);
  }
  if (!Number.isInteger(lunarDay) || lunarDay < 1 || lunarDay > 30) {
    throw new RangeError(`Invalid lunar day: ${lunarDay}`);
  }
  const suiYear = lunarMonth >= 11 ? lunarYear : lunarYear - 1;
  if (suiYear < eph.startYear || suiYear > eph.endYear - 2) {
    throw new RangeError(`Lunar date ${lunarYear}-${lunarMonth}-${lunarDay} outside ephemeris bounds`);
  }

  const offsetSeconds = getOffsetSeconds(calendarMode, offsetSecondsOverride);
  const labels = buildSuiLabels(eph, suiYear, offsetSeconds);
  const match = labels.find(
    (m) => m.lunarYear === lunarYear && m.lunarMonth === lunarMonth && m.isLeapMonth === isLeapMonth,
  );
  if (!match) {
    throw new RangeError(
      `Lunar month ${lunarYear}-${lunarMonth}${isLeapMonth ? ' (leap)' : ''} does not exist`,
    );
  }
  const monthLengthDays = match.dayEnd - match.dayStart + 1;
  if (lunarDay < 1 || lunarDay > monthLengthDays) {
    throw new RangeError(`Invalid lunar day ${lunarDay} for month length ${monthLengthDays}`);
  }
  const epochDay = match.dayStart + lunarDay - 1;
  const civil = civilFromEpochDay(epochDay);
  return {
    solar: {
      ...civil,
      epochDay,
      isoDate: formatIsoDate(civil.year, civil.month, civil.day),
    },
    monthLengthDays,
    offsetSeconds,
  };
}

export function lunarToSolar(
  eph: EphemerisTable,
  lunarYear: number,
  lunarMonth: number,
  lunarDay: number,
  isLeapMonth = false,
  calendarMode: CalendarMode = 'VN_UTC7',
  offsetSecondsOverride?: number,
): SolarDateResult {
  return lunarToSolarMeta(
    eph,
    lunarYear,
    lunarMonth,
    lunarDay,
    isLeapMonth,
    calendarMode,
    offsetSecondsOverride,
  ).solar;
}

export function convertLunarToSolar(input: ConvertLunarToSolarInput): ConvertLunarToSolarResult {
  const eph = loadEphemeris();
  const isLeapMonth = input.isLeapMonth ?? false;
  const calendarMode: CalendarMode = input.calendarMode ?? 'VN_UTC7';

  let effectiveLunarCalendar: 'VN_UTC7' | 'CN_UTC8';
  if (calendarMode === 'CN_UTC8') {
    effectiveLunarCalendar = 'CN_UTC8';
  } else if (calendarMode === 'VN_UTC7') {
    effectiveLunarCalendar = 'VN_UTC7';
  } else {
    let tentative: SolarDateResult;
    try {
      tentative = lunarToSolar(
        eph,
        input.lunarYear,
        input.lunarMonth,
        input.lunarDay,
        isLeapMonth,
        'VN_UTC7',
        input.offsetSecondsOverride,
      );
    } catch {
      tentative = lunarToSolar(
        eph,
        input.lunarYear,
        input.lunarMonth,
        1,
        false,
        'VN_UTC7',
        input.offsetSecondsOverride,
      );
    }
    const loc = resolveLocation(input.location ?? 'Hà Nội');
    const tz = resolveHistoricalTimezone({
      year: tentative.year,
      month: tentative.month,
      day: tentative.day,
      hour: 12,
      minute: 0,
      lat: loc.lat,
      lon: loc.lon,
      tzZone: loc.tzZone,
    });
    effectiveLunarCalendar = !tz.decision121CpLunar && tz.utcOffsetSeconds === 28_800 ? 'CN_UTC8' : 'VN_UTC7';
  }

  const { solar, monthLengthDays, offsetSeconds } = lunarToSolarMeta(
    eph,
    input.lunarYear,
    input.lunarMonth,
    input.lunarDay,
    isLeapMonth,
    effectiveLunarCalendar,
    input.offsetSecondsOverride,
  );
  return {
    ...solar,
    lunarYear: input.lunarYear,
    lunarMonth: input.lunarMonth,
    lunarDay: input.lunarDay,
    isLeapMonth,
    monthLengthDays,
    calendarMode,
    effectiveLunarCalendar,
    offsetSeconds,
  };
}

export function getLunarYearLeapInfo(
  lunarYear: number,
  calendarMode: CalendarMode = 'VN_UTC7',
  offsetSecondsOverride?: number,
): LunarYearLeapInfo {
  if (!Number.isInteger(lunarYear)) {
    throw new RangeError(`Invalid lunar year: ${lunarYear}`);
  }
  const eph = loadEphemeris();
  const offsetSeconds = getOffsetSeconds(calendarMode, offsetSecondsOverride);
  const maxSui = eph.endYear - 2;
  const collected: SuiMonthLabel[] = [];
  if (lunarYear - 1 >= eph.startYear && lunarYear - 1 <= maxSui) {
    collected.push(...buildSuiLabels(eph, lunarYear - 1, offsetSeconds));
  }
  if (lunarYear >= eph.startYear && lunarYear <= maxSui) {
    collected.push(...buildSuiLabels(eph, lunarYear, offsetSeconds));
  }
  const yearLabels = collected.filter((m) => m.lunarYear === lunarYear);
  if (yearLabels.length === 0) {
    throw new RangeError(`Lunar year ${lunarYear} outside ephemeris bounds`);
  }

  const months: LunarMonthMeta[] = yearLabels.map((m) => {
    const startCivil = civilFromEpochDay(m.dayStart);
    const endCivil = civilFromEpochDay(m.dayEnd);
    return {
      lunarMonth: m.lunarMonth,
      isLeapMonth: m.isLeapMonth,
      lengthDays: m.dayEnd - m.dayStart + 1,
      startIsoDate: formatIsoDate(startCivil.year, startCivil.month, startCivil.day),
      endIsoDate: formatIsoDate(endCivil.year, endCivil.month, endCivil.day),
    };
  });
  const leapEntry = months.find((m) => m.isLeapMonth);
  return {
    lunarYear,
    calendarMode,
    offsetSeconds,
    leapMonth: leapEntry ? leapEntry.lunarMonth : null,
    months,
  };
}

function makePillar(stemIndex: number, branchIndex: number): PillarPair {
  const s = floorMod(stemIndex, 10);
  const b = floorMod(branchIndex, 12);
  return {
    stemIndex: s,
    branchIndex: b,
    stemVi: STEMS_VI[s]!,
    branchVi: BRANCHES_VI[b]!,
    labelVi: `${STEMS_VI[s]} ${BRANCHES_VI[b]}`,
  };
}

export function computeSexagenaryPillars(
  eph: EphemerisTable,
  instantUnixMs: number,
  lunarYear: number,
  trueSolarEpochDay: number,
  shichenBranch: number,
  isLateZi: boolean,
  lateZiPolicy: LateZiPolicy = 'next-day',
): SexagenaryPillars {
  const lunarYearPillar = makePillar(lunarYear - 4, lunarYear - 4);

  const approxEpochDay = localEpochDayFromSeconds(instantUnixMs, 0);
  const gregYear = civilFromEpochDay(approxEpochDay).year;
  const lapXuanMs = findLapXuanMs(eph, gregYear);
  const baziYear = instantUnixMs < lapXuanMs ? gregYear - 1 : gregYear;
  const baziYearPillar = makePillar(baziYear - 4, baziYear - 4);

  const term = findSolarTermAt(eph, instantUnixMs);
  const baziMonthBranch = floorMod(Math.floor(floorMod(term.termIndex - 21, 24) / 2) + 2, 12);
  const firstMonthStem = ((baziYearPillar.stemIndex % 5) * 2 + 2) % 10;
  const baziMonthStem = (firstMonthStem + floorMod(baziMonthBranch - 2, 12)) % 10;
  const baziMonthPillar = makePillar(baziMonthStem, baziMonthBranch);

  const dayEpoch = trueSolarEpochDay + (isLateZi && lateZiPolicy === 'next-day' ? 1 : 0);
  const jdn = dayEpoch + 2440588;
  const dayIdx = floorMod(jdn + 49, 60);
  const dayPillar = makePillar(dayIdx % 10, dayIdx % 12);

  const firstHourStem = (dayPillar.stemIndex % 5) * 2;
  const hourPillar = makePillar(firstHourStem + shichenBranch, shichenBranch);

  return {
    lunarYearPillar,
    baziYearPillar,
    baziMonthPillar,
    dayPillar,
    hourPillar,
    lateZiPolicy,
  };
}
