import { canonicalJson, normalizeBirthTemporal, sha256Canonical } from '@sovana/geo-time';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  castBaziChart,
  castDivinationAtInstant,
  castLiuyaoChart,
  castZiweiChart,
  compileChartIR,
  deriveMaiHoaLines,
  type Gender,
  type LiuyaoLineValue,
  type ZiweiChartIR,
} from '../src/index.js';

const EXPECTED_MAJOR_STARS = [
  'Cự Môn',
  'Liêm Trinh',
  'Phá Quân',
  'Tham Lang',
  'Thái Dương',
  'Thái Âm',
  'Thiên Cơ',
  'Thiên Lương',
  'Thiên Phủ',
  'Thiên Tướng',
  'Thiên Đồng',
  'Thất Sát',
  'Tử Vi',
  'Vũ Khúc',
].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

const EXPECTED_PALACE_NAMES = [
  'Huynh Đệ',
  'Mệnh',
  'Nô Bộc',
  'Phu Thê',
  'Phúc Đức',
  'Phụ Mẫu',
  'Quan Lộc',
  'Thiên Di',
  'Tài Bạch',
  'Tử Tức',
  'Tật Ách',
  'Điền Trạch',
] as const;

function findStarSihua(chart: ZiweiChartIR, starName: string): string | null {
  for (const p of chart.palaces) {
    for (const s of p.majorStars) {
      if (s.name === starName) return s.sihuaTransform;
    }
    for (const s of p.minorStars) {
      if (s.name === starName) return s.sihuaTransform;
    }
  }
  return null;
}

describe('@sovana/kernel — Deterministic Symbolic Kernel', () => {
  it('isolates Smoking Gun #2: Can Canh (1980) Sihua fork between nam-phai and toan-thu', () => {
    const temporal = normalizeBirthTemporal({
      year: 1980,
      month: 8,
      day: 15,
      hour: 10,
      minute: 0,
      location: 'Đà Nẵng',
      migrationDestination: 'TP. Hồ Chí Minh',
    });

    const ir = compileChartIR({ temporal, gender: 'male', targetYear: 2026 });

    expect(temporal.pillars.lunarYearPillar.stemIndex).toBe(6); // Canh
    expect(findStarSihua(ir.ziweiNamPhai, 'Thái Dương')).toBe('Hóa Lộc');
    expect(findStarSihua(ir.ziweiNamPhai, 'Vũ Khúc')).toBe('Hóa Quyền');
    expect(findStarSihua(ir.ziweiNamPhai, 'Thiên Đồng')).toBe('Hóa Khoa');
    expect(findStarSihua(ir.ziweiNamPhai, 'Thái Âm')).toBe('Hóa Kỵ');

    expect(findStarSihua(ir.ziweiToanThu, 'Thái Dương')).toBe('Hóa Lộc');
    expect(findStarSihua(ir.ziweiToanThu, 'Vũ Khúc')).toBe('Hóa Quyền');
    expect(findStarSihua(ir.ziweiToanThu, 'Thái Âm')).toBe('Hóa Khoa');
    expect(findStarSihua(ir.ziweiToanThu, 'Thiên Đồng')).toBe('Hóa Kỵ');

    expect(ir.empiricalForks.hasSihuaFork).toBe(true);
    expect(ir.empiricalForks.consensusMode).toBe(false);
    expect(ir.empiricalForks.forkedStars.map((f) => f.starName)).toEqual(['Thiên Đồng', 'Thái Âm']);

    expect(ir.ziweiNamPhai.luuNien).not.toBeNull();
    expect(ir.ziweiNamPhai.luuNien?.targetYear).toBe(2026);
    expect(ir.ziweiNamPhai.luuNien?.luuNienPalaceBranch).toBe(6); // Bính Ngọ
  });

  it('isolates Can Nhâm (1992) Thiên Phủ vs Tả Phụ Hóa Khoa fork', () => {
    const temporal = normalizeBirthTemporal({
      year: 1992,
      month: 6,
      day: 15,
      hour: 10,
      minute: 0,
      location: 'Hà Nội',
    });

    const ir = compileChartIR({ temporal, gender: 'female' });
    expect(temporal.pillars.lunarYearPillar.stemIndex).toBe(8); // Nhâm
    expect(findStarSihua(ir.ziweiNamPhai, 'Thiên Phủ')).toBe('Hóa Khoa');
    expect(findStarSihua(ir.ziweiToanThu, 'Tả Phụ')).toBe('Hóa Khoa');
    expect(ir.empiricalForks.hasSihuaFork).toBe(true);
    expect(ir.empiricalForks.forkedStars.map((f) => f.starName)).toEqual(['Thiên Phủ', 'Tả Phụ']);
  });

  it('captures Smoking Gun #1: 1968 Tết Mậu Thân VN_UTC7 vs CN_UTC8 divergence & 1985 leap month split', () => {
    const tetVn = normalizeBirthTemporal({
      year: 1968,
      month: 1,
      day: 29,
      hour: 10,
      minute: 30,
      location: 'Hà Nội',
      calendarMode: 'VN_UTC7',
    });
    const tetCn = normalizeBirthTemporal({
      year: 1968,
      month: 1,
      day: 29,
      hour: 10,
      minute: 30,
      location: 'Hà Nội',
      calendarMode: 'CN_UTC8',
    });

    const chartVn = compileChartIR({ temporal: tetVn, gender: 'male' });
    const chartCn = compileChartIR({ temporal: tetCn, gender: 'male' });

    expect(chartVn.empiricalForks.isLunarDivergentVnCn).toBe(true);
    expect(sha256Canonical(chartVn.ziweiNamPhai)).not.toBe(sha256Canonical(chartCn.ziweiNamPhai));

    // 1985 VN_UTC7 has Leap 2nd lunar month (e.g. 1985-04-10 = 21/2 nhuận Ất Sửu, lunarDay > 15)
    const leapKeep = normalizeBirthTemporal({
      year: 1985,
      month: 4,
      day: 10,
      hour: 10,
      minute: 0,
      location: 'Hà Nội',
      leapMonthPolicy: 'keep',
    });
    const leapSplit = normalizeBirthTemporal({
      year: 1985,
      month: 4,
      day: 10,
      hour: 10,
      minute: 0,
      location: 'Hà Nội',
      leapMonthPolicy: 'split-15',
    });
    expect(leapKeep.lunarActive.isLeapMonth).toBe(true);
    expect(leapKeep.lunarActive.effectiveLunarMonth).not.toBe(
      leapSplit.lunarActive.effectiveLunarMonth,
    );
    const zKeep = castZiweiChart(leapKeep, 'male', 'nam-phai');
    const zSplit = castZiweiChart(leapSplit, 'male', 'nam-phai');
    expect(zKeep.menhBranch).not.toBe(zSplit.menhBranch);
  });

  it('computes quantitative Bazi chart with exact Lập Xuân minute transition and Köppen climate note', () => {
    const beforeLapXuan = normalizeBirthTemporal({
      year: 2004,
      month: 2,
      day: 4,
      hour: 2,
      minute: 30,
      location: 'Hà Nội',
    });
    const afterLapXuan = normalizeBirthTemporal({
      year: 2004,
      month: 2,
      day: 4,
      hour: 22,
      minute: 30,
      location: 'Hà Nội',
    });

    const baziBefore = castBaziChart(beforeLapXuan, 'male');
    const baziAfter = castBaziChart(afterLapXuan, 'male');

    expect(baziBefore.yearPillar.pillar.labelVi).toBe('Quý Mùi');
    expect(baziAfter.yearPillar.pillar.labelVi).toBe('Giáp Thân');
    expect(baziBefore.direction).toBe(-1); // Quý (Yin) + Male
    expect(baziAfter.direction).toBe(1); // Giáp (Yang) + Male

    expect(baziBefore.dayMasterScoreBps).toBeGreaterThanOrEqual(0);
    expect(baziBefore.dayMasterScoreBps).toBeLessThanOrEqual(10_000);
    expect(baziBefore.daiVan).toHaveLength(8);
    expect(baziBefore.dayPillar.stemTenGod).toBe('Nhật Chủ');
    expect(baziBefore.dieuHau.summaryVi.length).toBeGreaterThan(0);
    expect(baziBefore.climateAuditNote).toContain('Cwa');
  });

  it('validates all 64 Liuyao hexagrams, Thế/Ứng distance, moving lines, and complete 5-relative Phục Thần', () => {
    const temporal = normalizeBirthTemporal({
      year: 1996,
      month: 5,
      day: 12,
      hour: 9,
      minute: 30,
      location: 'Sài Gòn',
    });

    for (let bits = 0; bits < 64; bits++) {
      const staticLines: LiuyaoLineValue[] = [];
      for (let i = 0; i < 6; i++) {
        staticLines.push(((bits >> i) & 1) === 1 ? 7 : 8);
      }
      const chart = castLiuyaoChart(temporal, staticLines);
      expect(chart.primaryHexagram.bitsIndex).toBe(bits);
      expect(chart.transformedHexagram.bitsIndex).toBe(bits);
      expect(chart.hasMovingLines).toBe(false);
      expect(Math.abs(chart.primaryHexagram.theLine - chart.primaryHexagram.ungLine)).toBe(3);

      const allFive = new Set([
        ...chart.lines.map((l) => l.relativeVi),
        ...chart.phucThan.map((pt) => pt.missingRelativeVi),
      ]);
      expect(allFive.size).toBe(5);
    }

    // Moving lines test: all 6 moving Yang (9 -> 0 Khôn)
    const moving = castLiuyaoChart(temporal, [9, 9, 9, 9, 9, 9]);
    expect(moving.primaryHexagram.bitsIndex).toBe(63);
    expect(moving.transformedHexagram.bitsIndex).toBe(0);
    expect(moving.hasMovingLines).toBe(true);
    expect(moving.movingLines).toEqual([1, 2, 3, 4, 5, 6]);
    for (const line of moving.lines) {
      expect(line.transformedBranchVi).not.toBeNull();
      expect(line.transformedRelativeVi).not.toBeNull();
    }

    // Mai Hoa deterministic derivation
    const maiHoa = deriveMaiHoaLines(temporal);
    expect(maiHoa).toHaveLength(6);
    expect(maiHoa.filter((v) => v === 6 || v === 9)).toHaveLength(1);
  });

  it('satisfies algebraic Z12 invariants across 300 fast-check random charts & < 0.5 ms/op kernel speed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1902, max: 2098 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        fc.constantFrom<Gender>('male', 'female'),
        (year, month, day, hour, minute, gender) => {
          const temporal = normalizeBirthTemporal({
            year,
            month,
            day,
            hour,
            minute,
            location: 'Hà Nội',
          });

          const ir = compileChartIR({ temporal, gender, castMaiHoa: true });

          for (const chart of [ir.ziweiNamPhai, ir.ziweiToanThu]) {
            // 1. 12 palaces cover 0..11 bijectively
            expect(chart.palaces.map((p) => p.branchIndex)).toEqual([
              0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
            ]);
            const namesSorted = [...chart.palaces.map((p) => p.palaceName)].sort();
            expect(namesSorted).toEqual([...EXPECTED_PALACE_NAMES].sort());

            // 2. Reflection symmetry: (tuVi + thienPhu) % 12 === 4
            expect((chart.tuViBranch + chart.thienPhuBranch) % 12).toBe(4);

            // 3. 14 major stars conserved
            const allMajors = chart.palaces.flatMap((p) => p.majorStars);
            expect(allMajors).toHaveLength(14);
            const majorNames = [...allMajors.map((s) => s.name)].sort((a, b) =>
              a < b ? -1 : a > b ? 1 : 0,
            );
            expect(majorNames).toEqual(EXPECTED_MAJOR_STARS);

            // 4. Exact 4 Sihua transforms conserved
            const sihuas = chart.palaces
              .flatMap((p) => [...p.majorStars, ...p.minorStars])
              .map((s) => s.sihuaTransform)
              .filter((t): t is NonNullable<typeof t> => t !== null)
              .sort();
            expect(sihuas).toEqual(['Hóa Khoa', 'Hóa Kỵ', 'Hóa Lộc', 'Hóa Quyền']);

            // 5. Exactly 2 Tuần and 2 Triệt palaces, 1 Mệnh and 1 Thân
            expect(chart.palaces.filter((p) => p.tuanTrung)).toHaveLength(2);
            expect(chart.palaces.filter((p) => p.trietLo)).toHaveLength(2);
            expect(chart.palaces.filter((p) => p.isMenh)).toHaveLength(1);
            expect(chart.palaces.filter((p) => p.isThan)).toHaveLength(1);

            // 6. Code-point star sorting inside every palace
            for (const p of chart.palaces) {
              for (let i = 1; i < p.majorStars.length; i++) {
                expect(p.majorStars[i - 1]!.name < p.majorStars[i]!.name).toBe(true);
              }
              for (let i = 1; i < p.minorStars.length; i++) {
                expect(p.minorStars[i - 1]!.name < p.minorStars[i]!.name).toBe(true);
              }
            }
          }

          // 7. Canonical JSON & SHA-256 determinism
          const json1 = canonicalJson(ir);
          const json2 = canonicalJson(compileChartIR({ temporal, gender, castMaiHoa: true }));
          expect(json1).toBe(json2);
        },
      ),
      { numRuns: 300 },
    );

    // Throughput gate (< 0.5 ms/op for castZiweiChart + castBaziChart)
    const sampleTemporal = normalizeBirthTemporal({
      year: 1990,
      month: 5,
      day: 15,
      hour: 14,
      minute: 20,
      location: 'Hà Nội',
    });
    // Warm up
    compileChartIR({ temporal: sampleTemporal, gender: 'male' });
    const iterations = 400;
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      compileChartIR({ temporal: sampleTemporal, gender: i % 2 === 0 ? 'male' : 'female' });
    }
    const avgMs = (performance.now() - t0) / iterations;
    expect(avgMs).toBeLessThan(0.5);
  });

  it('places 105 Nam Phái stars, Linh Tinh / Thiên Giải / Nguyệt Đức fixes, minor brightness, VCD, Tứ Linh, and 12-month Lưu Niên', () => {
    // 1980-08-15 00:30 Đà Nẵng (male): Canh Thân (yStem=6, yBranch=8), Mệnh Vô Chính Diệu
    const tVcd = normalizeBirthTemporal({
      year: 1980,
      month: 8,
      day: 15,
      hour: 0,
      minute: 30,
      location: 'Đà Nẵng',
    });
    const ir = compileChartIR({ temporal: tVcd, gender: 'male', targetYear: 2026 });
    const np = ir.ziweiNamPhai;
    const tt = ir.ziweiToanThu;

    // 1. Exact star count: 14 major + 91 minor/ring/sha = 105 in nam-phai; 104 in toan-thu
    const npMinorCount = np.palaces.reduce((acc, p) => acc + p.minorStars.length, 0);
    const ttMinorCount = tt.palaces.reduce((acc, p) => acc + p.minorStars.length, 0);
    expect(npMinorCount).toBe(91);
    expect(ttMinorCount).toBe(90);

    const findBranch = (chart: ZiweiChartIR, name: string): number =>
      chart.palaces.find(
        (p) => p.majorStars.some((s) => s.name === name) || p.minorStars.some((s) => s.name === name),
      )!.branchIndex;

    // Thiên Không only in nam-phai; Nguyệt Đức silo divergence
    expect(
      np.palaces.some((p) => p.minorStars.some((s) => s.name === 'Thiên Không')),
    ).toBe(true);
    expect(
      tt.palaces.some((p) => p.minorStars.some((s) => s.name === 'Thiên Không')),
    ).toBe(false);
    const yb = tVcd.pillars.lunarYearPillar.branchIndex;
    expect(findBranch(np, 'Thiên Không')).toBe((yb + 1) % 12);
    expect(findBranch(np, 'Nguyệt Đức')).toBe((5 + yb) % 12);
    expect(findBranch(tt, 'Nguyệt Đức')).toBe(yb);

    // Thiên Giải = floorMod(8 + (m - 1), 12) (no skip-palace bug)
    const effMonth = tVcd.lunarActive.effectiveLunarMonth;
    expect(findBranch(np, 'Thiên Giải')).toBe((8 + effMonth - 1) % 12);

    // Linh Tinh moves opposite to Hỏa Tinh relative to start
    const hBranch = tVcd.trueSolarTime.shichenBranch;
    const linhStarts = { 8: 10 }; // Thân -> 10 Tuất
    const expectedLinh = (((linhStarts[yb as 8] - np.direction * hBranch) % 12) + 12) % 12;
    expect(findBranch(np, 'Linh Tinh')).toBe(expectedLinh);

    // Minor star brightness populated on Nam Phái 17 minor/ring stars
    const namPhai17 = [
      'Kình Dương', 'Đà La', 'Hỏa Tinh', 'Linh Tinh', 'Văn Xương', 'Văn Khúc',
      'Địa Không', 'Địa Kiếp', 'Đại Hao', 'Tiểu Hao', 'Thiên Khốc', 'Thiên Hư',
      'Thiên Mã', 'Thiên Hình', 'Thiên Riêu', 'Tang Môn', 'Bạch Hổ',
    ];
    for (const sName of namPhai17) {
      const starObj = np.palaces
        .flatMap((p) => p.minorStars)
        .find((s) => s.name === sName);
      expect(starObj).toBeDefined();
      expect(['Đắc', 'Hãm']).toContain(starObj!.brightness);
    }

    // Vô Chính Diệu + borrowedMajorStars + Tam Không + Tứ Linh
    const menhPal = np.palaces[np.menhBranch]!;
    const oppPal = np.palaces[(np.menhBranch + 6) % 12]!;
    expect(menhPal.voChinhDieu).toBe(true);
    expect(menhPal.borrowedMajorStars).toEqual(oppPal.majorStars);
    for (const p of np.palaces) {
      if (!p.voChinhDieu) {
        expect(p.borrowedMajorStars).toEqual([]);
      }
      expect(p.tamKhongTypes).toEqual(
        [...p.tamKhongTypes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      );
      expect(p.tuLinhPresent).toEqual(
        [...p.tuLinhPresent].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }

    // Yin year (1985 Ất Sửu, yBranch=1) places all 4 Tứ Linh inside Thái Tuế Tam Hợp
    const tYin = normalizeBirthTemporal({
      year: 1985,
      month: 6,
      day: 15,
      hour: 10,
      minute: 0,
      location: 'Hà Nội',
    });
    const cYin = castZiweiChart(tYin, 'female', 'nam-phai');
    const ybYin = tYin.pillars.lunarYearPillar.branchIndex;
    expect(ybYin % 2).toBe(1);
    const ttBranches = new Set([ybYin, (ybYin + 4) % 12, (ybYin + 8) % 12]);
    for (const tlStar of ['Long Trì', 'Phượng Các', 'Bạch Hổ', 'Hoa Cái']) {
      expect(ttBranches.has(findBranch(cYin, tlStar))).toBe(true);
    }

    // Lưu Niên 9 Lưu Động Tinh + 4 Tứ Hóa + 12-month Nguyệt Hạn
    const ln = np.luuNien!;
    expect(ln.luuDongTinhByBranch).toHaveLength(12);
    expect(ln.luuDongTinhByBranch.flat()).toHaveLength(9);
    expect(ln.luuNienSihua).toHaveLength(4);
    expect(ln.luuNienSihua.map((x) => x.transform)).toEqual([
      'Hóa Lộc', 'Hóa Quyền', 'Hóa Khoa', 'Hóa Kỵ',
    ]);
    expect(ln.nguyetHan).toHaveLength(12);
    expect(ln.nguyetHan.map((x) => x.lunarMonth)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(new Set(ln.nguyetHan.map((x) => x.branchIndex)).size).toBe(12);
  });

  it('casts real-time divination deterministically in UTC+7 independent of OS timezone', () => {
    // 2026-05-15T16:30:00Z === 2026-05-15T23:30:00 UTC+7 (late-Tý boundary)
    const nowMs = Date.UTC(2026, 4, 15, 16, 30, 0);
    const inq = castDivinationAtInstant({ nowMs, location: 'Hà Nội' });
    expect(inq.nowMs).toBe(nowMs);
    expect(inq.utc7IsoWallClock).toBe('2026-05-15T23:30:00');
    expect(inq.inquiryTimeLabelVi).toContain('Thời khắc hiện tại: 23:30 · 15/05/2026');
    expect(inq.liuyao.method).toBe('mai-hoa');
    expect(inq.liuyao.lines).toHaveLength(6);

    const manual = castDivinationAtInstant({
      nowMs,
      location: 'Sài Gòn',
      lines: [6, 7, 8, 9, 7, 8],
    });
    expect(manual.liuyao.method).toBe('manual-lines');
    expect(manual.liuyao.lineValues).toEqual([6, 7, 8, 9, 7, 8]);
  });
});
