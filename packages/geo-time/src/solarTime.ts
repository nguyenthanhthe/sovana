import {
  BRANCHES_VI,
  MS_PER_DAY,
  UNIX_EPOCH_JD,
  civilFromEpochDay,
  epochDayFromCivil,
  floorDivBig,
  floorModBig,
} from './ephemeris.js';
import type { TrueSolarTimeInput, TrueSolarTimeResult } from './types.js';

const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function deltaTSeconds(decimalYear: number): number {
  const y = decimalYear;
  if (y < 1900.0) {
    const t = (y - 1860.0) / 100.0;
    return 7.62 + 57.37 * t - 251.75 * t * t + 168.068 * t ** 3;
  }
  if (y < 1920.0) {
    const t = y - 1900.0;
    return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4;
  }
  if (y < 1941.0) {
    const t = y - 1920.0;
    return 21.2 + 0.84493 * t - 0.0761 * t ** 2 + 0.0020936 * t ** 3;
  }
  if (y < 1961.0) {
    const t = y - 1950.0;
    return 29.07 + 0.407 * t - (t ** 2) / 233.0 + (t ** 3) / 2547.0;
  }
  if (y < 1986.0) {
    const t = y - 1975.0;
    return 45.45 + 1.067 * t - (t ** 2) / 260.0 - (t ** 3) / 718.0;
  }
  if (y < 2005.0) {
    const t = y - 2000.0;
    return (
      63.86 +
      0.3345 * t -
      0.060374 * t ** 2 +
      0.0017275 * t ** 3 +
      0.000651814 * t ** 4 +
      0.00002373599 * t ** 5
    );
  }
  if (y < 2050.0) {
    const t = y - 2000.0;
    return 62.92 + 0.32217 * t + 0.005589 * t ** 2;
  }
  const t = (y - 1820.0) / 100.0;
  return -20.0 + 32.0 * t ** 2 - 0.5628 * (2150.0 - y);
}

/** Jean Meeus, Astronomical Algorithms (2nd ed., Ch. 28) Equation of Time in seconds. */
export function meeusEquationOfTimeSeconds(unixMs: number): number {
  const jdUt1 = UNIX_EPOCH_JD + unixMs / MS_PER_DAY;
  const approxYear = 2000.0 + (jdUt1 - 2451545.0) / 365.2425;
  const jdTt = jdUt1 + deltaTSeconds(approxYear) / 86400.0;

  const t = (jdTt - 2451545.0) / 36525.0;
  const tau = t / 10.0;

  const l0Raw =
    280.4664567 +
    360007.6982779 * tau +
    0.03032028 * tau ** 2 +
    (tau ** 3) / 49931.0 -
    (tau ** 4) / 15300.0 -
    (tau ** 5) / 2000000.0;
  const l0 = ((l0Raw % 360.0) + 360.0) % 360.0;

  const m = 357.5291092 + 35999.0502909 * t - 0.0001536 * t ** 2 + (t ** 3) / 24490000.0;
  const mRad = m * DEG2RAD;

  const c =
    (1.914602 - 0.004817 * t - 0.000014 * t ** 2) * Math.sin(mRad) +
    (0.019993 - 0.000101 * t) * Math.sin(2.0 * mRad) +
    0.000289 * Math.sin(3.0 * mRad);
  const sunTrueLon = l0 + c;

  const omega = (125.04452 - 1934.136261 * t) * DEG2RAD;
  const lSunRad = l0 * DEG2RAD;
  const lMoonRad = (218.3165 + 481267.8813 * t) * DEG2RAD;
  const dpsiArcsec =
    -17.2 * Math.sin(omega) -
    1.32 * Math.sin(2.0 * lSunRad) -
    0.23 * Math.sin(2.0 * lMoonRad) +
    0.21 * Math.sin(2.0 * omega);
  const depsArcsec =
    9.2 * Math.cos(omega) +
    0.57 * Math.cos(2.0 * lSunRad) +
    0.1 * Math.cos(2.0 * lMoonRad) -
    0.09 * Math.cos(2.0 * omega);

  const apparentLon = sunTrueLon - 0.00569 - 0.00478 * Math.sin(omega);

  const u = tau / 10.0;
  const eps0Arcsec =
    23.0 * 3600.0 +
    26.0 * 60.0 +
    21.448 -
    4680.93 * u -
    1.55 * u ** 2 +
    1999.25 * u ** 3 -
    51.38 * u ** 4 -
    249.67 * u ** 5 -
    39.05 * u ** 6 +
    7.12 * u ** 7 +
    27.87 * u ** 8 +
    5.79 * u ** 9 +
    2.45 * u ** 10;
  const eps = ((eps0Arcsec + depsArcsec) / 3600.0) * DEG2RAD;

  const appLonRad = apparentLon * DEG2RAD;
  const raRad = Math.atan2(Math.cos(eps) * Math.sin(appLonRad), Math.cos(appLonRad));
  const raDeg = (((raRad * RAD2DEG) % 360.0) + 360.0) % 360.0;

  let eotDeg = l0 - 0.0057183 - raDeg + (dpsiArcsec / 3600.0) * Math.cos(eps);
  eotDeg = ((((eotDeg + 180.0) % 360.0) + 360.0) % 360.0) - 180.0;
  return eotDeg * 240.0;
}

export function equationOfTimeCentiseconds(unixMs: number): number {
  return Math.round(meeusEquationOfTimeSeconds(unixMs) * 100.0);
}

export function longitudeCorrectionMs(lonMicroDeg: number, utcOffsetSeconds: number): number {
  const num = BigInt(lonMicroDeg) * 240n - BigInt(utcOffsetSeconds) * 1_000_000n;
  const rounded = (num + (num >= 0n ? 500n : -500n)) / 1000n;
  return Number(rounded);
}

export function branchFromSolarMsOfDay(msOfDay: number): number {
  if (msOfDay >= 82_800_000 || msOfDay < 3_600_000) {
    return 0;
  }
  return Math.floor((msOfDay - 3_600_000) / 7_200_000) + 1;
}

export function computeTrueSolarTime(input: TrueSolarTimeInput): TrueSolarTimeResult {
  const sec = input.second ?? 0;
  const localEpochDay = epochDayFromCivil(input.year, input.month, input.day);
  const localWallMs =
    BigInt(localEpochDay) * 86_400_000n +
    BigInt((input.hour * 3600 + input.minute * 60 + sec) * 1000);
  const instantUnixMs = Number(localWallMs - BigInt(input.utcOffsetSeconds) * 1000n);

  const lonMicroDeg = Math.round(input.lon * 1_000_000);
  const lonCorrMs = longitudeCorrectionMs(lonMicroDeg, input.utcOffsetSeconds);
  const eotCentiseconds = equationOfTimeCentiseconds(instantUnixMs);
  const eotMs = eotCentiseconds * 10;
  const totalCorrectionMs = lonCorrMs + eotMs;

  const trueSolarWallMs = localWallMs + BigInt(totalCorrectionMs);
  const trueSolarEpochDay = Number(floorDivBig(trueSolarWallMs, 86_400_000n));
  const msOfDay = Number(floorModBig(trueSolarWallMs, 86_400_000n));
  const dayOffset = trueSolarEpochDay - localEpochDay;

  const civil = civilFromEpochDay(trueSolarEpochDay);
  const totalSecOfDay = Math.floor(msOfDay / 1000);
  const tsHour = Math.floor(totalSecOfDay / 3600);
  const tsMinute = Math.floor((totalSecOfDay % 3600) / 60);
  const tsSecond = totalSecOfDay % 60;
  const shichenBranch = branchFromSolarMsOfDay(msOfDay);
  const isLateZi = shichenBranch === 0 && msOfDay >= 82_800_000;

  let minDistMs = 86_400_000;
  for (let k = 0; k < 12; k++) {
    const bMs = (2 * k + 1) * 3_600_000;
    const raw = Math.abs(msOfDay - bMs);
    const wrapped = Math.min(raw, 86_400_000 - raw);
    if (wrapped < minDistMs) {
      minDistMs = wrapped;
    }
  }
  const secondsToShichenBoundary = Math.floor(minDistMs / 1000);
  const secondsToMidnightBoundary = Math.floor(Math.min(msOfDay, 86_400_000 - msOfDay) / 1000);

  return {
    instantUnixMs,
    localEpochDay,
    trueSolarEpochDay,
    dayOffset,
    year: civil.year,
    month: civil.month,
    day: civil.day,
    hour: tsHour,
    minute: tsMinute,
    second: tsSecond,
    formattedTime: `${pad2(tsHour)}:${pad2(tsMinute)}:${pad2(tsSecond)}`,
    lonMicroDeg,
    longitudeCorrectionMs: lonCorrMs,
    eotCentiseconds,
    eotMs,
    totalCorrectionMs,
    shichenBranch,
    shichenBranchVi: BRANCHES_VI[shichenBranch]!,
    isLateZi,
    secondsToShichenBoundary,
    secondsToMidnightBoundary,
  };
}
