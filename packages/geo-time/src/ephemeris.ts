import type { EphemerisTable, SolarTermInfo } from './types.js';

export const MS_PER_DAY = 86_400_000;
export const UNIX_EPOCH_JD = 2440587.5;

export const STEMS_VI = [
  'Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu',
  'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý',
] as const;

export const BRANCHES_VI = [
  'Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ',
  'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi',
] as const;

export const SOLAR_TERMS_VI = [
  'Xuân Phân', 'Thanh Minh', 'Cốc Vũ', 'Lập Hạ', 'Tiểu Mãn', 'Mang Chủng',
  'Hạ Chí', 'Tiểu Thử', 'Đại Thử', 'Lập Thu', 'Xử Thử', 'Bạch Lộ',
  'Thu Phân', 'Hàn Lộ', 'Sương Giáng', 'Lập Đông', 'Tiểu Tuyết', 'Đại Tuyết',
  'Đông Chí', 'Tiểu Hàn', 'Đại Hàn', 'Lập Xuân', 'Vũ Thủy', 'Kinh Trập',
] as const;

export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export function floorMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

export function floorDivBig(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  return r !== 0n && (r < 0n) !== (b < 0n) ? q - 1n : q;
}

export function floorModBig(a: bigint, b: bigint): bigint {
  const r = a % b;
  return r < 0n ? r + (b < 0n ? -b : b) : r;
}

export function epochDayFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromEpochDay(z: number): { year: number; month: number; day: number } {
  const z2 = z + 719468;
  const era = Math.floor(z2 / 146097);
  const doe = z2 - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  let y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  y += m <= 2 ? 1 : 0;
  return { year: y, month: m, day: d };
}

export function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getCivilMonthDays(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Invalid civil year/month: ${year}-${month}`);
  }
  if (month === 2) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

export function isValidCivilDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (month < 1 || month > 12) {
    return false;
  }
  return day >= 1 && day <= getCivilMonthDays(year, month);
}

export function localEpochDayFromSeconds(unixMs: number, offsetSeconds: number): number {
  const shifted = BigInt(unixMs) + BigInt(offsetSeconds) * 1000n;
  return Number(floorDivBig(shifted, 86_400_000n));
}

export function localEpochDay(unixMs: number, offsetMinutes: number): number {
  return localEpochDayFromSeconds(unixMs, Math.round(offsetMinutes * 60));
}

export function parseEphemeris(bytes: Uint8Array): EphemerisTable {
  if (bytes.byteLength < 32) {
    throw new Error(`Invalid SVNEPH01 buffer length: ${bytes.byteLength}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(
    bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!,
    bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!,
  );
  if (magic !== 'SVNEPH01') {
    throw new Error(`Invalid ephemeris magic header: ${magic}`);
  }
  const version = view.getUint16(8, true);
  if (version !== 1) {
    throw new Error(`Unsupported ephemeris version: ${version}`);
  }
  const startYear = view.getInt16(12, true);
  const endYear = view.getInt16(14, true);
  const nmCount = view.getUint32(16, true);
  const stCount = view.getUint32(20, true);
  const firstSolarTermIndex = view.getUint8(24);
  const timeScaleId = view.getUint8(25);

  const expectedLen = 32 + (nmCount + stCount) * 8;
  if (bytes.byteLength !== expectedLen) {
    throw new Error(`Truncated ephemeris buffer: got ${bytes.byteLength}, expected ${expectedLen}`);
  }

  let offset = 32;
  const newMoons: number[] = new Array(nmCount);
  for (let i = 0; i < nmCount; i++) {
    newMoons[i] = Number(view.getBigInt64(offset, true));
    offset += 8;
  }
  const solarTerms: number[] = new Array(stCount);
  for (let i = 0; i < stCount; i++) {
    solarTerms[i] = Number(view.getBigInt64(offset, true));
    offset += 8;
  }

  return {
    version,
    startYear,
    endYear,
    firstSolarTermIndex,
    timeScaleId,
    newMoons,
    solarTerms,
  };
}

export function upperBound(arr: readonly number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! <= target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

export function findNewMoonBracket(
  eph: EphemerisTable,
  unixMs: number,
): { index: number; prevMs: number; nextMs: number } {
  const idx = upperBound(eph.newMoons, unixMs) - 1;
  if (idx < 0 || idx + 1 >= eph.newMoons.length) {
    throw new RangeError(`Timestamp ${unixMs} outside ephemeris new-moon range`);
  }
  return {
    index: idx,
    prevMs: eph.newMoons[idx]!,
    nextMs: eph.newMoons[idx + 1]!,
  };
}

export function findSolarTermAt(eph: EphemerisTable, instantUnixMs: number): SolarTermInfo {
  const idx = upperBound(eph.solarTerms, instantUnixMs) - 1;
  if (idx < 0 || idx + 1 >= eph.solarTerms.length) {
    throw new RangeError(`Timestamp ${instantUnixMs} outside ephemeris solar-term range`);
  }
  const termIndex = (eph.firstSolarTermIndex + idx) % 24;
  const nextTermIndex = (termIndex + 1) % 24;
  const startMs = eph.solarTerms[idx]!;
  const nextMs = eph.solarTerms[idx + 1]!;
  const secondsToPrevTerm = Number(floorDivBig(BigInt(instantUnixMs) - BigInt(startMs), 1000n));
  const secondsToNextTerm = Number(floorDivBig(BigInt(nextMs) - BigInt(instantUnixMs), 1000n));
  return {
    index: idx,
    termIndex,
    termNameVi: SOLAR_TERMS_VI[termIndex]!,
    isMajorTerm: termIndex % 2 === 0,
    startMs,
    nextMs,
    nextTermIndex,
    nextTermNameVi: SOLAR_TERMS_VI[nextTermIndex]!,
    secondsToPrevTerm,
    secondsToNextTerm,
    minSecondsToTermBoundary: Math.min(secondsToPrevTerm, secondsToNextTerm),
  };
}

export function findLapXuanMs(eph: EphemerisTable, gregYear: number): number {
  const jan1Ms = epochDayFromCivil(gregYear, 1, 1) * MS_PER_DAY;
  let idx = Math.max(0, upperBound(eph.solarTerms, jan1Ms) - 1);
  while (idx < eph.solarTerms.length) {
    const termIndex = (eph.firstSolarTermIndex + idx) % 24;
    if (termIndex === 21) {
      return eph.solarTerms[idx]!;
    }
    idx++;
  }
  throw new RangeError(`Lap Xuan not found for year ${gregYear}`);
}
