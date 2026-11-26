import { normalizeBirthTemporal } from '@sovana/geo-time';
import { compileChartIR } from '@sovana/kernel';
import { evaluateHopBan } from '../src/index.js';
import { describe, expect, it } from 'vitest';

describe('evaluateHopBan — Deterministic 2-Chart Synastry (Hôn nhân & Hợp tác)', () => {
  it('evaluates 5-pillar synastry, cross-chart Phi Hóa (8 flights), Bát Tự complementarity & Đại Hạn sync deterministically', () => {
    const tempA = normalizeBirthTemporal({
      year: 1994,
      month: 6,
      day: 18,
      hour: 9,
      minute: 30,
      location: 'Hà Nội',
      calendarMode: 'VN_HISTORICAL',
    });
    const tempB = normalizeBirthTemporal({
      year: 1997,
      month: 10,
      day: 12,
      hour: 14,
      minute: 15,
      location: 'Đà Nẵng',
      calendarMode: 'VN_HISTORICAL',
    });

    const chartA = compileChartIR({ temporal: tempA, gender: 'male', targetYear: 2026 });
    const chartB = compileChartIR({ temporal: tempB, gender: 'female', targetYear: 2026 });

    const rep1 = evaluateHopBan(chartA, chartB, {
      silo: 'nam-phai',
      targetYear: 2026,
      labelA: 'Nguyễn Minh Quân',
      labelB: 'Trần Thu Hà',
    });
    const rep2 = evaluateHopBan(chartA, chartB, {
      silo: 'nam-phai',
      targetYear: 2026,
      labelA: 'Nguyễn Minh Quân',
      labelB: 'Trần Thu Hà',
    });

    expect(rep1).toEqual(rep2);
    expect(rep1.crossPhiHoaFlights).toHaveLength(8);
    expect(rep1.crossPhiHoaFlights.filter((f) => f.direction === 'A_TO_B')).toHaveLength(4);
    expect(rep1.crossPhiHoaFlights.filter((f) => f.direction === 'B_TO_A')).toHaveLength(4);

    for (const modeEval of [rep1.honNhan, rep1.hopTac]) {
      expect(modeEval.pillars).toHaveLength(5);
      expect(modeEval.totalScore).toBeGreaterThanOrEqual(15);
      expect(modeEval.totalScore).toBeLessThanOrEqual(99);
      expect(modeEval.starRating).toBeGreaterThanOrEqual(1);
      expect(modeEval.starRating).toBeLessThanOrEqual(5);
      expect(modeEval.actionableAdviceVi.length).toBeGreaterThanOrEqual(3);
    }

    const rawStr = JSON.stringify(rep1);
    expect(rawStr).not.toContain('ni_quote');
    expect(/[\u4E00-\u9FFF\uAC00-\uD7AF]/u.test(rawStr)).toBe(false);
  });
});
