import { normalizeBirthTemporal } from '@sovana/geo-time';
import {
  analyzeZiweiMultiLayerSihua,
  compileChartIR,
  detectDinhTapCuc,
  detectPalaceTuHoa,
  detectStructuredPatterns,
  getLuuNguyetStemIndex,
  getLuuThoiStemIndex,
  getSihuaTupleByStem,
  resolveDongHan,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

describe('Multi-Layer Si Hua, Phi Tinh / Tự Hóa, Đồng Hạn & 3-Tier Patterns', () => {
  it('computes Đồng Hạn (1..cucNumber-1), Lai Nhân Cung, Đại Hạn Tứ Hóa, 12 Lưu Nguyệt Tứ Hóa & Tự Hóa accurately', () => {
    const temporal = normalizeBirthTemporal({
      year: 2006,
      month: 8,
      day: 31,
      hour: 1,
      minute: 45,
      location: 'Thái Bình',
      calendarMode: 'VN_HISTORICAL',
      leapMonthPolicy: 'keep',
    });
    const chart = compileChartIR({ temporal, gender: 'male', targetYear: 2026 });

    // Kim Tứ Cục (cucNumber = 4) -> Đồng Hạn covers nominal ages 1, 2, 3 (2006, 2007, 2008)
    const dh2007 = resolveDongHan(chart.ziweiNamPhai, temporal.lunarActive.lunarYear, 2007);
    expect(dh2007.hasDongHan).toBe(true);
    expect(dh2007.entries).toHaveLength(3);
    expect(dh2007.entries[0]?.palaceName).toBe('Mệnh'); // Nhất Mệnh
    expect(dh2007.entries[1]?.palaceName).toBe('Tài Bạch'); // Nhị Tài
    expect(dh2007.entries[2]?.palaceName).toBe('Tật Ách'); // Tam Tật
    expect(dh2007.isTargetYearInDongHan).toBe(true);
    expect(dh2007.activeEntry?.nominalAge).toBe(2);

    // Multi-layer Si Hua in 2026 (Age 21 -> Đại Hạn 14–23)
    const ml2026 = analyzeZiweiMultiLayerSihua(chart.ziweiNamPhai, temporal, {
      targetYear: 2026,
      inquiryDayStemIndex: 8, // Nhâm
      inquiryHourBranch: 1, // Sửu
    });
    expect(ml2026.laiNhanCung.stemVi).toBe('Bính');
    expect(ml2026.laiNhanCung.primaryBranchIndex).toBeGreaterThanOrEqual(2);
    expect(ml2026.banMenhSihua).toHaveLength(4);
    expect(ml2026.daiHanSihua?.sourceKind).toBe('DAI_HAN');
    expect(ml2026.daiHanSihua?.startAge).toBe(14);
    expect(ml2026.daiHanSihua?.endAge).toBe(23);
    expect(ml2026.daiHanSihua?.transforms).toHaveLength(4);
    expect(ml2026.luuNienSihua).toHaveLength(4);
    expect(ml2026.luuNguyetSihua).toHaveLength(12);
    expect(ml2026.luuNhatSihua?.transforms).toHaveLength(4);
    expect(ml2026.luuThoiSihua?.transforms).toHaveLength(4);
    expect(ml2026.tuHoaByBranch).toHaveLength(12);
    expect(ml2026.incomingPhiTinhByBranch).toHaveLength(12);

    // Multi-layer Si Hua in childhood year 2006 (Age 1 -> Đồng Hạn Mệnh)
    const ml2006 = analyzeZiweiMultiLayerSihua(chart.ziweiNamPhai, temporal, { targetYear: 2006 });
    expect(ml2006.daiHanSihua?.sourceKind).toBe('DONG_HAN');
    expect(ml2006.daiHanSihua?.palaceName).toBe('Mệnh');

    // Geng variants & Ngũ Hổ / Ngũ Thử Độn
    expect(getSihuaTupleByStem(6, 'toan-thu', 'duong-vu-phu-dong')).toEqual([
      'Thái Dương',
      'Vũ Khúc',
      'Thiên Phủ',
      'Thiên Đồng',
    ]);
    expect(getLuuNguyetStemIndex(0, 1)).toBe(2); // Giáp Kỷ chi niên Bính tác thủ (Tháng Giêng = Bính Dần)
    expect(getLuuNguyetStemIndex(0, 4, { isLeapMonth: true, lunarDay: 20 })).toBe(6); // Nhuận sau rằm -> tính sang tháng 5
    expect(getLuuThoiStemIndex(0, 0)).toBe(0); // Giáp Kỷ hoàn gia Giáp (Giờ Tý = Giáp Tý)
    expect(detectPalaceTuHoa(chart.ziweiNamPhai, chart.ziweiNamPhai.menhBranch).branchIndex).toBe(
      chart.ziweiNamPhai.menhBranch,
    );
  });

  it('detects 3-tier classical patterns (required / bonus / breaking) and 8 Định Tạp Cục transit patterns without CJK/Hangul leaks', () => {
    const samples = [
      { year: 2006, month: 8, day: 31, hour: 1, minute: 45, gender: 'male' as const },
      { year: 1990, month: 5, day: 15, hour: 10, minute: 0, gender: 'female' as const },
      { year: 1984, month: 11, day: 8, hour: 23, minute: 15, gender: 'male' as const },
      { year: 1992, month: 3, day: 9, hour: 10, minute: 0, gender: 'female' as const },
    ];

    let totalPatterns = 0;
    let totalDinhTap = 0;
    const forbiddenScriptRe = /[\uAC00-\uD7AF\u3040-\u30FF\u0400-\u04FF]/u;

    for (const s of samples) {
      const t = normalizeBirthTemporal({
        ...s,
        location: 'Hà Nội',
        calendarMode: 'VN_HISTORICAL',
      });
      const chart = compileChartIR({ temporal: t, gender: s.gender, targetYear: 2026 });
      const pats = detectStructuredPatterns(chart.ziweiNamPhai);
      const dt = detectDinhTapCuc(chart.ziweiNamPhai, t.lunarActive.lunarYear, { targetYear: 2026 });

      totalPatterns += pats.length;
      totalDinhTap += dt.allHits.length;

      for (const p of pats) {
        expect(p.conditions.required.length).toBeGreaterThanOrEqual(1);
        expect(forbiddenScriptRe.test(p.descriptionVi)).toBe(false);
        expect(forbiddenScriptRe.test(p.adviceVi)).toBe(false);
        if (p.conditions.breaking.length > 0 && p.baseLevel !== 'CANH_BAO') {
          expect(p.effectiveLevel).toBe('PHA_CACH');
          expect(p.isBroken).toBe(true);
        }
      }

      for (const h of dt.allHits) {
        expect(h.endAge).toBeGreaterThanOrEqual(h.startAge);
        expect(forbiddenScriptRe.test(h.detailVi)).toBe(false);
        expect(forbiddenScriptRe.test(h.adviceVi)).toBe(false);
      }
    }

    expect(totalPatterns).toBeGreaterThanOrEqual(4);
    expect(totalDinhTap).toBeGreaterThanOrEqual(4);
  });
});
