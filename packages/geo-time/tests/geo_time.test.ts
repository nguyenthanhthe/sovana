import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  computeMigrationAzimuth,
  computeTrueSolarTime,
  convertLunarToSolar,
  epochDayFromCivil,
  getCivilMonthDays,
  getLunarYearLeapInfo,
  isValidCivilDate,
  listProvinces34,
  listProvinces63,
  loadEphemeris,
  lunarToSolar,
  map34To63,
  map63To34,
  normalizeBirthTemporal,
  resolveHistoricalTimezone,
  resolveLocation,
  sha256Canonical,
  solarToLunar,
} from '../src/index.js';

describe('@sovana/geo-time', () => {
  it('fixes Smoking Gun #1: VN UTC+7 vs CN UTC+8 in 1968, 1985, 2007, 2030 and round-trips lunarToSolar', () => {
    const eph = loadEphemeris();

    // 1968 Tết Mậu Thân: 1968-01-29 is Mồng 1 in VN (UTC+7), 12/30 in CN (UTC+8)
    const d1968 = epochDayFromCivil(1968, 1, 29);
    const vn1968 = solarToLunar(eph, d1968, 'VN_UTC7');
    const cn1968 = solarToLunar(eph, d1968, 'CN_UTC8');
    expect(vn1968.lunarYear).toBe(1968);
    expect(vn1968.lunarMonth).toBe(1);
    expect(vn1968.lunarDay).toBe(1);
    expect(cn1968.lunarYear).toBe(1967);
    expect(cn1968.lunarMonth).toBe(12);
    expect(cn1968.lunarDay).toBe(30);

    // 1985 leap month divergence: 1985-01-21 is Tet in VN, 12/1 in CN
    const d1985 = epochDayFromCivil(1985, 1, 21);
    expect(solarToLunar(eph, d1985, 'VN_UTC7')).toMatchObject({ lunarYear: 1985, lunarMonth: 1, lunarDay: 1 });
    expect(solarToLunar(eph, d1985, 'CN_UTC8')).toMatchObject({ lunarYear: 1984, lunarMonth: 12, lunarDay: 1 });

    // 2030 Tết Canh Tuất: 2030-02-02 VN vs 2030-02-03 CN
    const d2030 = epochDayFromCivil(2030, 2, 2);
    expect(solarToLunar(eph, d2030, 'VN_UTC7')).toMatchObject({ lunarYear: 2030, lunarMonth: 1, lunarDay: 1 });
    expect(solarToLunar(eph, d2030, 'CN_UTC8')).toMatchObject({ lunarYear: 2029, lunarMonth: 12, lunarDay: 30 });

    // Round-trip including leap month 2 of 1985 VN
    const rtLeap = lunarToSolar(eph, 1985, 2, 15, true, 'VN_UTC7');
    const back = solarToLunar(eph, rtLeap.epochDay, 'VN_UTC7', 'split-15');
    expect(back.isLeapMonth).toBe(true);
    expect(back.lunarMonth).toBe(2);
    expect(back.effectiveLunarMonth).toBe(2);

    const backAfter15 = solarToLunar(eph, rtLeap.epochDay + 1, 'VN_UTC7', 'split-15');
    expect(backAfter15.lunarDay).toBe(16);
    expect(backAfter15.effectiveLunarMonth).toBe(3);
  });

  it('fixes Smoking Gun #3: North vs South historical timezones and 17th parallel split', () => {
    const hanoi1968 = normalizeBirthTemporal({
      year: 1968,
      month: 5,
      day: 15,
      hour: 1,
      minute: 15,
      location: 'Hà Nội',
    });
    const saigon1968 = normalizeBirthTemporal({
      year: 1968,
      month: 5,
      day: 15,
      hour: 1,
      minute: 15,
      location: 'Sài Gòn',
    });

    expect(hanoi1968.timezone.zoneId).toBe('VN_NORTH_DRV');
    expect(hanoi1968.timezone.utcOffsetSeconds).toBe(25_200);
    expect(saigon1968.timezone.zoneId).toBe('VN_SOUTH_RVN');
    expect(saigon1968.timezone.utcOffsetSeconds).toBe(28_800);
    // Saigon 01:15 UTC+8 -> True Solar ~00:25 -> Ty (0); Hanoi 01:15 UTC+7 -> True Solar ~01:22 -> Suu (1)
    expect(saigon1968.trueSolarTime.shichenBranch).toBe(0);
    expect(hanoi1968.trueSolarTime.shichenBranch).toBe(1);

    // 1945 Japanese occupation UTC+9
    const hn1945 = resolveHistoricalTimezone({
      year: 1945, month: 6, day: 1, hour: 12, minute: 0, lat: 21.0285, lon: 105.8542,
    });
    expect(hn1945.regimeId).toBe('VN_1945_JAPAN_UTC9');
    expect(hn1945.utcOffsetSeconds).toBe(32_400);

    // 1950 Contested zone
    const hn1950 = resolveHistoricalTimezone({
      year: 1950, month: 6, day: 1, hour: 12, minute: 0, lat: 21.0285, lon: 105.8542,
    });
    expect(hn1950.isContestedZone).toBe(true);
    expect(hn1950.candidateOffsetsSeconds).toEqual([25_200, 28_800]);

    // 1975-06-13 unified UTC+7
    const sg1975After = resolveHistoricalTimezone({
      year: 1975, month: 6, day: 13, hour: 8, minute: 0, lat: 10.7769, lon: 106.7009,
    });
    expect(sg1975After.utcOffsetSeconds).toBe(25_200);

    // 17th parallel inside Quang Tri: Vinh Linh (North) vs Dong Ha (South)
    const vinhLinh = resolveLocation('Vĩnh Linh, Quảng Trị');
    const dongHa = resolveLocation('Đông Hà, Quảng Trị');
    expect(vinhLinh.tzZone).toBe('VN_NORTH_DRV');
    expect(dongHa.tzZone).toBe('VN_SOUTH_RVN');
  });

  it('resolves 63<->34 bi-temporal provinces, islands, wide warnings, and Vincenty azimuths', () => {
    expect(listProvinces34().length).toBe(34);
    expect(listProvinces63().length).toBe(63);

    const hy = map63To34('Thái Bình');
    expect(hy.id).toBe('hung-yen');
    const mergedIntoHy = map34To63('hung-yen');
    expect(mergedIntoHy.map((p) => p.shortName).sort()).toEqual(['Hưng Yên', 'Thái Bình']);

    const phuQuoc = resolveLocation('Phú Quốc');
    expect(phuQuoc.matchedBy).toBe('special_zone');
    expect(phuQuoc.post2025Id).toBe('an-giang');

    const lamDong = resolveLocation('lam-dong');
    expect(lamDong.wideLongitudeWarning).toBe(true);

    const hn = resolveLocation('Hà Nội');
    const hcm = resolveLocation('TP. Hồ Chí Minh');
    const mig = computeMigrationAzimuth(hn.lat, hn.lon, hcm.lat, hcm.lon);
    expect(mig.isSignificantMigration).toBe(true);
    expect(mig.distanceMeters).toBeGreaterThan(1_130_000);
    expect(mig.distanceMeters).toBeLessThan(1_165_000);
    expect(mig.palaceBranchVi).toBe('Ngọ');
  });

  it('computes BoundaryUncertaintyEnvelope and deterministic RFC 8785 SHA-256', () => {
    // 105.0 deg E, 01:02:00 UTC+7 is near 01:00 Shichen boundary
    const tst = computeTrueSolarTime({
      year: 2000, month: 6, day: 15, hour: 1, minute: 2, second: 0, lon: 105.0, utcOffsetSeconds: 25_200,
    });
    expect(tst.secondsToShichenBoundary).toBeLessThanOrEqual(900);

    const norm = normalizeBirthTemporal({
      year: 2025,
      month: 8,
      day: 15,
      hour: 9,
      minute: 30,
      location: 'Hà Nội',
      migrationDestination: 'TP. Hồ Chí Minh',
    });
    expect(canonicalJson({ b: 1, a: -0, c: 105.0 })).toBe('{"a":0,"b":1,"c":105}');
    expect(sha256Canonical(norm)).toHaveLength(64);
  });

  it('passes full 73,414-day (1900-01-01..2100-12-31) solar<->lunar round-trip in VN_UTC7 & CN_UTC8 (146,828 checks)', () => {
    const eph = loadEphemeris();
    const startDay = epochDayFromCivil(1900, 1, 1);
    const endDay = epochDayFromCivil(2100, 12, 31);
    expect(endDay - startDay + 1).toBe(73_414);

    for (const mode of ['VN_UTC7', 'CN_UTC8'] as const) {
      for (let d = startDay; d <= endDay; d++) {
        const lunar = solarToLunar(eph, d, mode);
        const solar = lunarToSolar(
          eph,
          lunar.lunarYear,
          lunar.lunarMonth,
          lunar.lunarDay,
          lunar.isLeapMonth,
          mode,
        );
        expect(solar.epochDay).toBe(d);
      }
    }
  });

  it('supports convertLunarToSolar, getLunarYearLeapInfo, getCivilMonthDays, and isValidCivilDate', () => {
    // 1900-01-01..1900-01-30 boundary (lunarYear=1899, month=12)
    const boundary = convertLunarToSolar({
      lunarYear: 1899,
      lunarMonth: 12,
      lunarDay: 1,
      calendarMode: 'VN_UTC7',
    });
    expect(boundary.isoDate).toBe('1900-01-01');
    const boundaryEnd = convertLunarToSolar({
      lunarYear: 1899,
      lunarMonth: 12,
      lunarDay: 30,
      calendarMode: 'VN_UTC7',
    });
    expect(boundaryEnd.isoDate).toBe('1900-01-30');

    // 1968 Sài Gòn VN_HISTORICAL (UTC+8 -> effective CN_UTC8) vs Hà Nội (VN_UTC7)
    const sg1968 = convertLunarToSolar({
      lunarYear: 1968,
      lunarMonth: 1,
      lunarDay: 1,
      calendarMode: 'VN_HISTORICAL',
      location: 'Sài Gòn',
    });
    expect(sg1968.effectiveLunarCalendar).toBe('CN_UTC8');
    expect(sg1968.isoDate).toBe('1968-01-30');
    const hn1968 = convertLunarToSolar({
      lunarYear: 1968,
      lunarMonth: 1,
      lunarDay: 1,
      calendarMode: 'VN_HISTORICAL',
      location: 'Hà Nội',
    });
    expect(hn1968.effectiveLunarCalendar).toBe('VN_UTC7');
    expect(hn1968.isoDate).toBe('1968-01-29');

    // 1985 Leap Month 2
    const leapInfo1985 = getLunarYearLeapInfo(1985, 'VN_UTC7');
    expect(leapInfo1985.leapMonth).toBe(2);
    expect(leapInfo1985.months.length).toBe(13);
    const leap1985 = convertLunarToSolar({
      lunarYear: 1985,
      lunarMonth: 2,
      lunarDay: 15,
      isLeapMonth: true,
      calendarMode: 'VN_UTC7',
    });
    expect(leap1985.isLeapMonth).toBe(true);
    expect(leap1985.isoDate).toBe('1985-04-04');

    // Invalid lunar day 30 on 29-day month
    const shortMonth = leapInfo1985.months.find((m) => m.lengthDays === 29)!;
    expect(() =>
      convertLunarToSolar({
        lunarYear: 1985,
        lunarMonth: shortMonth.lunarMonth,
        lunarDay: 30,
        isLeapMonth: shortMonth.isLeapMonth,
        calendarMode: 'VN_UTC7',
      }),
    ).toThrow(/Invalid lunar day/);

    // Civil date helpers: 30/02, 29/02 leap vs non-leap, 31/04
    expect(getCivilMonthDays(2024, 2)).toBe(29);
    expect(getCivilMonthDays(2025, 2)).toBe(28);
    expect(getCivilMonthDays(1900, 2)).toBe(28);
    expect(getCivilMonthDays(2000, 2)).toBe(29);
    expect(getCivilMonthDays(2025, 4)).toBe(30);
    expect(isValidCivilDate(2025, 2, 30)).toBe(false);
    expect(isValidCivilDate(2025, 2, 29)).toBe(false);
    expect(isValidCivilDate(2024, 2, 29)).toBe(true);
    expect(isValidCivilDate(2025, 4, 31)).toBe(false);
  });
});
