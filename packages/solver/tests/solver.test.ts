import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeBirthTemporal } from '@sovana/geo-time';
import { compileChartIR } from '@sovana/kernel';
import {
  PUBLIC_RECTIFICATION_QUESTIONS,
  answerQuestion,
  canonicalJson,
  computeCertaintyPriorWeights,
  computeEntropyMillibits,
  computeInvariantIntersection,
  createInitialRectificationState,
  createRectificationSessionFromCharts,
  evalChartPredicate,
  evaluateRulesDAG,
  loadSampleRules,
  normalizeMicroProbs,
  selectNextQuestion,
  sha256Canonical,
  validateQuestionBank,
} from '../src/index.js';
import type { BirthTimeWindow, RectificationQuestion, RuleIR } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  };
}

function shuffleDeterministic<T>(items: readonly T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng() % (i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

describe('@sovana/solver — Stratified Forward-Chaining DAG & Confluence', () => {
  it('loads all 56 public sample rules and satisfies Church-Rosser Confluence across 20 permutations', () => {
    const rules = loadSampleRules();
    expect(rules.length).toBe(56);

    const temporal = normalizeBirthTemporal({
      year: 1980,
      month: 8,
      day: 15,
      hour: 10,
      minute: 30,
      location: 'Đà Nẵng',
      migrationDestination: 'TP. Hồ Chí Minh',
    });
    const chart = compileChartIR({
      temporal,
      gender: 'male',
      castMaiHoa: true,
    });

    const baselineReport = evaluateRulesDAG(chart, rules);
    const baselineSha = sha256Canonical(baselineReport);
    expect(baselineReport.totalRulesEvaluated).toBe(56);
    expect(baselineReport.strataEvaluated).toEqual([1, 2]);
    expect(baselineReport.nodes.length).toBeGreaterThan(0);

    const rng = makeRng(0x20261125);
    for (let trial = 0; trial < 20; trial++) {
      const permuted = shuffleDeterministic(rules, rng);
      const report = evaluateRulesDAG(chart, permuted);
      expect(sha256Canonical(report)).toBe(baselineSha);
      expect(canonicalJson(report)).toBe(canonicalJson(baselineReport));
    }
  });

  it('tracks Paraconsistent CROSS_SILO conflicts on Can Canh without overwriting either silo', () => {
    const temporal = normalizeBirthTemporal({
      year: 1980,
      month: 8,
      day: 15,
      hour: 10,
      minute: 30,
      location: 'Đà Nẵng',
    });
    const chart = compileChartIR({ temporal, gender: 'male' });
    expect(chart.temporal.pillars.lunarYearPillar.stemIndex).toBe(6); // Can Canh

    const report = evaluateRulesDAG(chart);
    const nodeIds = new Set(report.nodes.map((n) => n.nodeId));

    // Both Nam Phai and Toan Thu Can Canh axioms must coexist in Provenance DAG
    expect(nodeIds.has('NP-017')).toBe(true); // Nam Phái Thái Âm Hóa Kỵ (HUNG, tai)
    expect(nodeIds.has('TT-007')).toBe(true); // Toàn Thư Thái Âm Hóa Khoa (CAT, tai)
    expect(nodeIds.has('NP-018')).toBe(true); // Nam Phái Thiên Đồng Hóa Khoa (CAT, phuc)
    expect(nodeIds.has('TT-008')).toBe(true); // Toàn Thư Thiên Đồng Hóa Kỵ (HUNG, phuc)
    expect(nodeIds.has('CR-006')).toBe(true); // Stratum 2 cross arbiter

    const crossConflicts = report.conflicts.filter((c) => c.kind === 'CROSS_SILO');
    expect(crossConflicts.length).toBeGreaterThanOrEqual(2);

    const taiConflict = crossConflicts.find((c) => c.domain === 'tai');
    expect(taiConflict).toBeDefined();
    expect(taiConflict!.positiveNodeIds).toContain('TT-007');
    expect(taiConflict!.negativeNodeIds).toContain('NP-017');

    const phucConflict = crossConflicts.find((c) => c.domain === 'phuc');
    expect(phucConflict).toBeDefined();
    expect(phucConflict!.positiveNodeIds).toContain('NP-018');
    expect(phucConflict!.negativeNodeIds).toContain('TT-008');
  });

  it('computes shortest proof depth, IsomorphicContextFilter, and extended Bazi/Liuyao AST ops', () => {
    const temporal = normalizeBirthTemporal({
      year: 1996,
      month: 5,
      day: 20,
      hour: 4,
      minute: 0,
      location: 'Hà Nội',
    });
    const chart = compileChartIR({
      temporal,
      gender: 'female',
      liuyaoLines: [9, 7, 8, 6, 7, 8],
    });

    const customRules: RuleIR[] = [
      {
        id: 'R-S1-FAST',
        silo: 'bazi',
        stratum: 1,
        domain: 'quan',
        polarity: 'CAT',
        when: { op: 'day_stem_in', stems: [chart.temporal.pillars.dayPillar.stemIndex] },
        claimVi: 'Nhật can hợp cách',
        actionableAdviceVi: 'Phát huy chuyên môn cốt lõi',
        classicalSource: 'Cùng Thông Bảo Giám',
        careerCategories: ['TECH', 'RESEARCH'],
      },
      {
        id: 'R-S1-MONTH',
        silo: 'bazi',
        stratum: 1,
        domain: 'quan',
        polarity: 'HUNG',
        when: {
          op: 'and',
          args: [
            { op: 'month_branch_in', branches: [chart.temporal.pillars.baziMonthPillar.branchIndex] },
            { op: 'liuyao_has_moving', value: true },
          ],
        },
        claimVi: 'Nguyệt lệnh kiêm hào động cảnh báo biến chuyển',
        classicalSource: 'Tăng San Bốc Dịch',
      },
      {
        id: 'R-S2-CHAIN',
        silo: 'bazi',
        stratum: 2,
        domain: 'quan',
        polarity: 'CAT',
        when: { op: 'derived_node', nodeId: 'R-S1-FAST' },
        claimVi: 'Suy diễn tầng 2',
        classicalSource: 'Test',
      },
      {
        id: 'R-S3-DIAMOND',
        silo: 'cross',
        stratum: 3,
        domain: 'quan',
        polarity: 'CAT',
        when: {
          op: 'or',
          args: [
            { op: 'derived_node', nodeId: 'R-S2-CHAIN' }, // depth 2 -> would give 3
            { op: 'derived_node', nodeId: 'R-S1-FAST' }, // depth 1 -> shortest depth = 2!
          ],
        },
        claimVi: 'Hội tụ đường chứng minh ngắn nhất',
        classicalSource: 'Test',
      },
    ];

    const repAllowed = evaluateRulesDAG(chart, customRules, { careerCategory: 'TECH' });
    const diamond = repAllowed.nodes.find((n) => n.nodeId === 'R-S3-DIAMOND');
    expect(diamond).toBeDefined();
    expect(diamond!.proofDepth).toBe(2);
    expect(diamond!.parentNodeIds).toEqual(['R-S1-FAST']);
    expect(repAllowed.nodes.find((n) => n.nodeId === 'R-S1-FAST')!.actionableAdviceVi).toBe(
      'Phát huy chuyên môn cốt lõi',
    );
    expect(
      repAllowed.conflicts.some(
        (c) => c.kind === 'INTRA_SILO_PARACONSISTENT' && c.domain === 'quan',
      ),
    ).toBe(true);

    const repFilteredOut = evaluateRulesDAG(chart, customRules, { careerCategory: 'FINANCE' });
    expect(repFilteredOut.nodes.some((n) => n.nodeId === 'R-S1-FAST')).toBe(false);
    expect(repFilteredOut.nodes.some((n) => n.nodeId === 'R-S3-DIAMOND')).toBe(false);
  });

  it('evaluates all 5 new Ziwei ConditionAST ops and all 5 new LiuyaoStateFlag values accurately', () => {
    // 1980-08-15 00:30 Đà Nẵng (male) has Vô Chính Diệu Mệnh + populated palaces
    const temporal = normalizeBirthTemporal({
      year: 1980,
      month: 8,
      day: 15,
      hour: 0,
      minute: 30,
      location: 'Đà Nẵng',
    });
    const baseChart = compileChartIR({
      temporal,
      gender: 'male',
      liuyaoLines: [7, 8, 7, 8, 7, 8],
    });

    const zwNp = baseChart.ziweiNamPhai;
    const zwTt = baseChart.ziweiToanThu;
    const menhP = zwNp.palaces.find((p) => p.palaceName === 'Mệnh')!;
    const thanP = zwNp.palaces.find((p) => p.isThan || p.branchIndex === zwNp.thanBranch)!;
    const noBocTt = zwTt.palaces.find((p) => p.palaceName === 'Nô Bộc')!;
    const vcdPalace = zwNp.palaces.find((p) => p.majorStars.length === 0)!;
    const populatedPalace = zwNp.palaces.find((p) => p.majorStars.length >= 1)!;
    expect(vcdPalace).toBeDefined();
    expect(populatedPalace).toBeDefined();

    const relTargets = {
      opposite: (menhP.branchIndex + 6) % 12,
      prev: (menhP.branchIndex + 11) % 12,
      next: (menhP.branchIndex + 1) % 12,
      nhi_hop: (13 - menhP.branchIndex) % 12,
    } as const;

    const getFirstStar = (branchIdx: number): string => {
      const p = zwNp.palaces.find((pal) => pal.branchIndex === branchIdx)!;
      return p.majorStars[0]?.name ?? p.minorStars[0]?.name ?? p.thaiTueStar;
    };

    const twoStarPalace = [...zwNp.palaces]
      .sort((a, b) => a.branchIndex - b.branchIndex)
      .find((p) => p.majorStars.length + p.minorStars.length >= 2)!;
    const twoStars = [...twoStarPalace.majorStars, ...twoStarPalace.minorStars]
      .slice(0, 2)
      .map((s) => s.name);
    const sortedTwoStars = [...new Set(twoStars)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    // Craft deterministic Liuyao chart state to verify all 5 new LiuyaoStateFlag conditions
    const lyBase = baseChart.liuyao!;
    const theIdx = lyBase.lines.findIndex((l) => l.isThe);
    const theLineOrig = lyBase.lines[theIdx]!;
    // Make month=Dần (2, Mộc), theLine=Hỏa (Tướng in Mộc), static, nhatThan=(theLine.branch + 6)%12
    const modifiedLines = lyBase.lines.map((l, idx) => {
      if (idx === theIdx) {
        return {
          ...l,
          isMoving: false,
          elementVi: 'Hỏa',
          isTuanKhong: true,
          isNguyetPha: false,
        };
      }
      if (idx === 0) {
        return { ...l, isTuanKhong: false, isNguyetPha: true };
      }
      return { ...l, isTuanKhong: false, isNguyetPha: false };
    });

    const chartAmDong = {
      ...baseChart,
      liuyao: {
        ...lyBase,
        monthBranchIndex: 2, // Dần (Mộc) -> Mộc sinh Hỏa (Tướng)
        nhatThanBranch: (theLineOrig.branchIndex + 6) % 12,
        lines: modifiedLines,
        phucThan: [
          {
            lineNumber: 1,
            missingRelativeVi: 'Thê Tài',
            stemIndex: 0,
            branchIndex: 4,
            branchVi: 'Thìn',
            elementVi: 'Hỏa',
            phiThanBranchVi: 'Dần',
            phiThanElementVi: 'Mộc', // Mộc sinh Hỏa -> phiSinhPhuc
            phiThanRelativeVi: 'Huynh Đệ',
          },
          {
            lineNumber: 2,
            missingRelativeVi: 'Quan Quỷ',
            stemIndex: 1,
            branchIndex: 6,
            branchVi: 'Ngọ',
            elementVi: 'Mộc',
            phiThanBranchVi: 'Thân',
            phiThanElementVi: 'Kim', // Kim khắc Mộc -> phiKhacPhuc
            phiThanRelativeVi: 'Phụ Mẫu',
          },
        ],
      },
    };

    const rules: RuleIR[] = [
      {
        id: 'OP-BRANCH-THAN',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: { op: 'palace_branch_in', palace: 'Thân', branches: [thanP.branchIndex] },
        claimVi: 'Cung Thân hợp chi',
        classicalSource: 'Test',
      },
      {
        id: 'OP-BRANCH-NOBOC-TT',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: {
          op: 'palace_branch_in',
          palace: 'Giao Hữu',
          branches: [noBocTt.branchIndex],
          silo: 'toan-thu',
        },
        claimVi: 'Giao Hữu (Nô Bộc) Toàn Thư hợp chi',
        classicalSource: 'Test',
      },
      {
        id: 'OP-BRANCH-MISS',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'HUNG',
        when: {
          op: 'palace_branch_in',
          palace: 'Mệnh',
          branches: [(menhP.branchIndex + 1) % 12],
        },
        claimVi: 'Không khớp chi Mệnh',
        classicalSource: 'Test',
      },
      {
        id: 'OP-REL-OPP',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: {
          op: 'star_in_relative_palace',
          palace: 'Mệnh',
          relation: 'opposite',
          star: getFirstStar(relTargets.opposite),
        },
        claimVi: 'Đối cung',
        classicalSource: 'Test',
      },
      {
        id: 'OP-REL-PREV',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: {
          op: 'star_in_relative_palace',
          palace: 'Mệnh',
          relation: 'prev',
          star: getFirstStar(relTargets.prev),
        },
        claimVi: 'Giáp tiền',
        classicalSource: 'Test',
      },
      {
        id: 'OP-REL-NEXT',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: {
          op: 'star_in_relative_palace',
          palace: 'Mệnh',
          relation: 'next',
          star: getFirstStar(relTargets.next),
        },
        claimVi: 'Giáp hậu',
        classicalSource: 'Test',
      },
      {
        id: 'OP-REL-NHIHOP',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: {
          op: 'star_in_relative_palace',
          palace: 'Mệnh',
          relation: 'nhi_hop',
          star: getFirstStar(relTargets.nhi_hop),
        },
        claimVi: 'Nhị hợp',
        classicalSource: 'Test',
      },
      {
        id: 'OP-MAJOR-VCD',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'TRUNG',
        when: { op: 'palace_major_count', palace: vcdPalace.palaceName, exact: 0 },
        claimVi: 'Vô Chính Diệu',
        classicalSource: 'Test',
      },
      {
        id: 'OP-MAJOR-RANGE',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: {
          op: 'palace_major_count',
          palace: populatedPalace.palaceName,
          min: populatedPalace.majorStars.length,
          max: populatedPalace.majorStars.length,
        },
        claimVi: 'Đúng số chính tinh',
        classicalSource: 'Test',
      },
      {
        id: 'OP-MAJOR-MISS',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'HUNG',
        when: { op: 'palace_major_count', palace: vcdPalace.palaceName, min: 1 },
        claimVi: 'Không khớp min 1',
        classicalSource: 'Test',
      },
      {
        id: 'OP-STAR-COUNT-DEDUP',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: {
          op: 'palace_star_count_in',
          palace: twoStarPalace.palaceName,
          stars: [twoStars[0]!, twoStars[0]!, twoStars[1]!, 'SaoKhongTonTai'],
          min: 2,
          max: 2,
        },
        claimVi: 'Đếm sao duy nhất đúng 2',
        classicalSource: 'Test',
      },
      {
        id: 'OP-STAR-COUNT-MISS',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'HUNG',
        when: {
          op: 'palace_star_count_in',
          palace: twoStarPalace.palaceName,
          stars: [twoStars[0]!, twoStars[0]!, twoStars[1]!],
          min: 3, // duplicate should not inflate count to 3
        },
        claimVi: 'Trùng tên không tính 2 lần',
        classicalSource: 'Test',
      },
      {
        id: 'OP-COLOC-PALACE',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: {
          op: 'star_co_located',
          palace: twoStarPalace.palaceName,
          stars: [twoStars[1]!, twoStars[0]!, twoStars[1]!],
        },
        claimVi: 'Đồng cung tại cung chỉ định',
        classicalSource: 'Test',
      },
      {
        id: 'OP-COLOC-ANY',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: {
          op: 'star_co_located',
          stars: [twoStars[1]!, twoStars[0]!],
        },
        claimVi: 'Đồng cung bất kỳ',
        classicalSource: 'Test',
      },
      {
        id: 'OP-COLOC-EMPTY',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'HUNG',
        when: { op: 'star_co_located', stars: [] },
        claimVi: 'Rỗng không khớp',
        classicalSource: 'Test',
      },
      {
        id: 'LY-PHUC-HAS',
        silo: 'liuyao',
        stratum: 1,
        domain: 'quan',
        polarity: 'TRUNG',
        when: { op: 'liuyao_state_flag', flag: 'hasPhucThan' },
        claimVi: 'Có Phục Thần',
        classicalSource: 'Test',
      },
      {
        id: 'LY-PHUC-SINH',
        silo: 'liuyao',
        stratum: 1,
        domain: 'quan',
        polarity: 'CAT',
        when: { op: 'liuyao_state_flag', flag: 'phiSinhPhuc' },
        claimVi: 'Phi sinh Phục',
        classicalSource: 'Test',
      },
      {
        id: 'LY-PHUC-KHAC',
        silo: 'liuyao',
        stratum: 1,
        domain: 'quan',
        polarity: 'HUNG',
        when: { op: 'liuyao_state_flag', flag: 'phiKhacPhuc' },
        claimVi: 'Phi khắc Phục',
        classicalSource: 'Test',
      },
      {
        id: 'LY-PHUC-KP',
        silo: 'liuyao',
        stratum: 1,
        domain: 'quan',
        polarity: 'HUNG',
        when: { op: 'liuyao_state_flag', flag: 'phiLamKhongPha' },
        claimVi: 'Phi lâm Không/Phá',
        classicalSource: 'Test',
      },
      {
        id: 'LY-THE-AMDONG',
        silo: 'liuyao',
        stratum: 1,
        domain: 'quan',
        polarity: 'CAT',
        when: { op: 'liuyao_state_flag', flag: 'theAmDong' },
        claimVi: 'Thế Ám Động',
        classicalSource: 'Test',
      },
    ];

    const rep = evaluateRulesDAG(chartAmDong, rules);
    const byId = new Map(rep.nodes.map((n) => [n.nodeId, n]));

    expect(byId.get('OP-BRANCH-THAN')?.matchedFacts).toEqual([
      `ziwei:nam-phai:palace_branch_in:Thân:${thanP.branchIndex}`,
    ]);
    expect(byId.get('OP-BRANCH-NOBOC-TT')?.matchedFacts).toEqual([
      `ziwei:toan-thu:palace_branch_in:Giao Hữu:${noBocTt.branchIndex}`,
    ]);
    expect(byId.has('OP-BRANCH-MISS')).toBe(false);

    expect(byId.get('OP-REL-OPP')?.matchedFacts).toEqual([
      `ziwei:nam-phai:star_in_relative_palace:Mệnh:opposite:${getFirstStar(relTargets.opposite)}`,
    ]);
    expect(byId.get('OP-REL-PREV')?.matchedFacts).toEqual([
      `ziwei:nam-phai:star_in_relative_palace:Mệnh:prev:${getFirstStar(relTargets.prev)}`,
    ]);
    expect(byId.get('OP-REL-NEXT')?.matchedFacts).toEqual([
      `ziwei:nam-phai:star_in_relative_palace:Mệnh:next:${getFirstStar(relTargets.next)}`,
    ]);
    expect(byId.get('OP-REL-NHIHOP')?.matchedFacts).toEqual([
      `ziwei:nam-phai:star_in_relative_palace:Mệnh:nhi_hop:${getFirstStar(relTargets.nhi_hop)}`,
    ]);

    expect(byId.get('OP-MAJOR-VCD')?.matchedFacts).toEqual([
      `ziwei:nam-phai:palace_major_count:${vcdPalace.palaceName}:0`,
    ]);
    expect(byId.get('OP-MAJOR-RANGE')?.matchedFacts).toEqual([
      `ziwei:nam-phai:palace_major_count:${populatedPalace.palaceName}:${populatedPalace.majorStars.length}`,
    ]);
    expect(byId.has('OP-MAJOR-MISS')).toBe(false);

    expect(byId.get('OP-STAR-COUNT-DEDUP')?.matchedFacts).toEqual([
      `ziwei:nam-phai:palace_star_count_in:${twoStarPalace.palaceName}:2`,
    ]);
    expect(byId.has('OP-STAR-COUNT-MISS')).toBe(false);

    expect(byId.get('OP-COLOC-PALACE')?.matchedFacts).toEqual([
      `ziwei:nam-phai:star_co_located:${twoStarPalace.palaceName}:${sortedTwoStars.join('+')}`,
    ]);
    expect(byId.get('OP-COLOC-ANY')?.matchedFacts).toEqual([
      `ziwei:nam-phai:star_co_located:palace_${twoStarPalace.branchIndex}:${sortedTwoStars.join('+')}`,
    ]);
    expect(byId.has('OP-COLOC-EMPTY')).toBe(false);

    expect(byId.get('LY-PHUC-HAS')?.matchedFacts).toEqual(['liuyao:flag:hasPhucThan']);
    expect(byId.get('LY-PHUC-SINH')?.matchedFacts).toEqual(['liuyao:flag:phiSinhPhuc']);
    expect(byId.get('LY-PHUC-KHAC')?.matchedFacts).toEqual(['liuyao:flag:phiKhacPhuc']);
    expect(byId.get('LY-PHUC-KP')?.matchedFacts).toEqual(['liuyao:flag:phiLamKhongPha']);
    expect(byId.get('LY-THE-AMDONG')?.matchedFacts).toEqual(['liuyao:flag:theAmDong']);

    // Negative checks for the 5 Liuyao flags
    const chartNegativeLy = {
      ...baseChart,
      liuyao: {
        ...lyBase,
        monthBranchIndex: 8, // Thân (Kim) -> Hỏa is Tù in Kim (not Vượng/Tướng)
        nhatThanBranch: (theLineOrig.branchIndex + 6) % 12,
        lines: modifiedLines.map((l) => ({ ...l, isTuanKhong: false, isNguyetPha: false })),
        phucThan: [],
      },
    };
    const negRep = evaluateRulesDAG(chartNegativeLy, rules.filter((r) => r.silo === 'liuyao'));
    expect(negRep.nodes).toEqual([]);

    // Moving Thế cannot be Ám Động even when Nhật Xung + Vượng/Tướng
    const chartMovingThe = {
      ...chartAmDong,
      liuyao: {
        ...chartAmDong.liuyao,
        lines: chartAmDong.liuyao.lines.map((l, idx) =>
          idx === theIdx ? { ...l, isMoving: true } : l,
        ),
      },
    };
    const movingRep = evaluateRulesDAG(chartMovingThe, [rules.find((r) => r.id === 'LY-THE-AMDONG')!]);
    expect(movingRep.nodes).toEqual([]);

    // Verify exact TS <-> Python SHA-256 lockstep on these extended rules + chartAmDong
    const tsSha = sha256Canonical(rep);
    const pyCheckScript = [
      'import json, sys',
      'from sovana.geo_time import sha256_canonical',
      'from sovana.solver import evaluate_rules_dag',
      'payload = json.load(sys.stdin)',
      'rep = evaluate_rules_dag(payload["chart"], payload["rules"])',
      'print(sha256_canonical(rep))',
    ].join('\n');
    const pySha = execFileSync('uv', ['run', 'python', '-c', pyCheckScript], {
      cwd: repoRoot,
      input: JSON.stringify({ chart: chartAmDong, rules }),
      encoding: 'utf-8',
    }).trim();
    expect(tsSha).toBe(pySha);
  });
});

describe('@sovana/solver — Shannon-Entropy Anti-Barnum Bayesian Rectification', () => {
  it('rejects Barnum / personality questions immediately', () => {
    const barnumBank = [
      {
        id: 'BARNUM-1',
        category: 'PERSONALITY_TRAIT' as unknown as RectificationQuestion['category'],
        promptVi: 'Bạn có phải người đôi khi hướng nội nhưng lúc cần lại hướng ngoại không?',
        options: [
          { id: 'YES', labelVi: 'Đúng' },
          { id: 'NO', labelVi: 'Không' },
        ],
        likelihoodMatrixMicro: {
          YES: new Array<number>(12).fill(500_000),
          NO: new Array<number>(12).fill(500_000),
        },
      },
    ];
    expect(() => validateQuestionBank(barnumBank)).toThrow(/Anti-Barnum violation/);
  });

  it('converges to LOCKED (P >= 0.80, ratio >= 3.0) in <= 4 questions for a true Giờ Dần user (and all 12 Shichen)', () => {
    for (let trueBranch = 0; trueBranch < 12; trueBranch++) {
      let state = createInitialRectificationState({ userAge: 28 });
      expect(state.entropyMillibits).toBe(3585);
      expect(state.candidates.reduce((acc, c) => acc + c.probMicro, 0)).toBe(1_000_000);

      let steps = 0;
      while (state.status === 'ACTIVE') {
        const next = selectNextQuestion(state, PUBLIC_RECTIFICATION_QUESTIONS);
        expect(next).not.toBeNull();
        expect(next!.expectedInfoGainMillibits).toBeGreaterThan(0);

        const q = next!.question;
        const mat = q.likelihoodMatrixMicro as Record<string, readonly number[]>;
        let bestOptId = q.options[0]!.id;
        let bestLikelihood = -1;
        for (const opt of q.options) {
          const l = mat[opt.id]![trueBranch]!;
          if (l > bestLikelihood) {
            bestLikelihood = l;
            bestOptId = opt.id;
          }
        }

        state = answerQuestion(state, q.id, bestOptId, PUBLIC_RECTIFICATION_QUESTIONS);
        expect(state.candidates.reduce((acc, c) => acc + c.probMicro, 0)).toBe(1_000_000);
        steps++;
      }

      expect(steps).toBeLessThanOrEqual(4);
      expect(state.status).toBe('LOCKED');
      expect(state.lockedShichenBranch).toBe(trueBranch);
      expect(state.top1ProbMicro).toBeGreaterThanOrEqual(800_000);
      expect(state.top1ProbMicro).toBeGreaterThanOrEqual(3 * state.top2ProbMicro);
    }
  });

  it('triggers Bayesian Safety Brake -> INVARIANT_INTERSECTION on ambiguous/neutral answers', () => {
    let state = createInitialRectificationState({ candidateBranches: [1, 2], maxQuestions: 5 });
    expect(computeEntropyMillibits(normalizeMicroProbs([1, 1]))).toBe(1000);

    while (state.status === 'ACTIVE') {
      const next = selectNextQuestion(state);
      expect(next).not.toBeNull();
      state = answerQuestion(state, next!.questionId, 'OPT_NA');
    }

    expect(state.status).toBe('INVARIANT_INTERSECTION');
    expect(state.lockedShichenBranch).toBeNull();
    expect(state.answers.length).toBe(5);

    // Build candidate reports for Sửu (02:00) and Dần (04:00) on same date
    const tSuu = normalizeBirthTemporal({
      year: 1990,
      month: 6,
      day: 15,
      hour: 2,
      minute: 0,
      location: 'Hà Nội',
    });
    const tDan = normalizeBirthTemporal({
      year: 1990,
      month: 6,
      day: 15,
      hour: 4,
      minute: 0,
      location: 'Hà Nội',
    });
    const cSuu = compileChartIR({ temporal: tSuu, gender: 'male' });
    const cDan = compileChartIR({ temporal: tDan, gender: 'male' });
    const rSuu = evaluateRulesDAG(cSuu);
    const rDan = evaluateRulesDAG(cDan);

    const intersection = computeInvariantIntersection([rSuu, rDan], cDan.bazi, state);
    expect(intersection.mode).toBe('INVARIANT_INTERSECTION');
    expect(intersection.survivingCandidateCount).toBe(2);
    expect(intersection.survivingBranches).toEqual([1, 2]);
    expect(intersection.invariantBaziPillars.dayPillar).toEqual(cSuu.bazi.dayPillar.pillar);

    // Every invariant node must appear in BOTH rSuu and rDan
    const suuIds = new Set(rSuu.nodes.map((n) => n.nodeId));
    const danIds = new Set(rDan.nodes.map((n) => n.nodeId));
    for (const node of intersection.invariantNodes) {
      expect(suuIds.has(node.nodeId)).toBe(true);
      expect(danIds.has(node.nodeId)).toBe(true);
    }
  });

  it('produces 100% Bit-Exact SHA-256 digests matching Python sovana.solver across 100 full-stack vectors', () => {
    const tsVectorHashes: string[] = [];
    for (let i = 0; i < 100; i++) {
      const y = 1910 + ((i * 17) % 180);
      const m = 1 + ((i * 5) % 12);
      const d = 1 + ((i * 7) % 28);
      const h = (i * 3) % 24;
      const min = (i * 11) % 60;
      const gender = i % 2 === 0 ? 'male' : 'female';
      const loc = i % 3 === 0 ? 'Hà Nội' : i % 3 === 1 ? 'Sài Gòn' : 'Đà Nẵng';
      const mig = i % 4 === 0 ? 'TP. Hồ Chí Minh' : undefined;

      const temporal = normalizeBirthTemporal(
        mig !== undefined
          ? { year: y, month: m, day: d, hour: h, minute: min, location: loc, migrationDestination: mig }
          : { year: y, month: m, day: d, hour: h, minute: min, location: loc },
      );
      const chart = compileChartIR({
        temporal,
        gender,
        castMaiHoa: i % 2 === 0,
      });
      const dagReport = evaluateRulesDAG(chart);

      let rectState = createInitialRectificationState(
        i % 4 === 0
          ? { candidateBranches: [h >> 1, ((h >> 1) + 1) % 12], userAge: i % 5 === 0 ? 8 : 30 }
          : { userAge: i % 5 === 0 ? 8 : 30 },
      );
      const firstSel = selectNextQuestion(rectState);
      if (firstSel) {
        const opt = firstSel.question.options[i % firstSel.question.options.length]!.id;
        rectState = answerQuestion(rectState, firstSel.questionId, opt);
      }
      const inter = computeInvariantIntersection([dagReport], chart.bazi);
      tsVectorHashes.push(sha256Canonical({ dagReport, firstSel, rectState, inter }));
    }

    const pyScript = [
      'import json',
      'from sovana.geo_time import normalize_birth_temporal, sha256_canonical',
      'from sovana.kernel import compile_chart_ir',
      'from sovana.solver import answer_question, compute_invariant_intersection, create_initial_rectification_state, evaluate_rules_dag, select_next_question',
      'out = []',
      'for i in range(100):',
      '    y = 1910 + ((i * 17) % 180)',
      '    m = 1 + ((i * 5) % 12)',
      '    d = 1 + ((i * 7) % 28)',
      '    h = (i * 3) % 24',
      '    mn = (i * 11) % 60',
      '    g = "male" if i % 2 == 0 else "female"',
      '    loc = "Hà Nội" if i % 3 == 0 else ("Sài Gòn" if i % 3 == 1 else "Đà Nẵng")',
      '    mig = "TP. Hồ Chí Minh" if i % 4 == 0 else None',
      '    t = normalize_birth_temporal(y, m, d, h, mn, loc, migration_destination=mig)',
      '    c = compile_chart_ir(t, g, cast_mai_hoa=(i % 2 == 0))',
      '    dag_rep = evaluate_rules_dag(c)',
      '    cb = [h >> 1, ((h >> 1) + 1) % 12] if i % 4 == 0 else None',
      '    age = 8 if i % 5 == 0 else 30',
      '    st = create_initial_rectification_state(candidate_branches=cb, user_age=age)',
      '    sel = select_next_question(st)',
      '    if sel is not None:',
      '        opt = sel.question.options[i % len(sel.question.options)].id',
      '        st = answer_question(st, sel.question_id, opt)',
      '    inter = compute_invariant_intersection([dag_rep], c.bazi)',
      '    out.append(sha256_canonical({"dagReport": dag_rep, "firstSel": sel, "rectState": st, "inter": inter}))',
      'print(json.dumps(out))',
    ].join('\n');

    const pyStdout = execFileSync('uv', ['run', 'python', '-c', pyScript], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    const pyVectorHashes = JSON.parse(pyStdout.trim()) as string[];

    expect(pyVectorHashes.length).toBe(100);
    expect(tsVectorHashes).toEqual(pyVectorHashes);
  });

  it('evaluates vo_chinh_dieu, tam_khong_in_tam_phuong, and thai_tue_tu_linh in TS <-> Python lockstep', () => {
    // 1985-06-15 12:00 Hà Nội (female): let's also pair with 1980-08-15 00:30 (VCD Mệnh)
    const tVcd = normalizeBirthTemporal({
      year: 1980,
      month: 8,
      day: 15,
      hour: 0,
      minute: 30,
      location: 'Đà Nẵng',
    });
    const chartVcd = compileChartIR({ temporal: tVcd, gender: 'male' });
    const menhVcd = chartVcd.ziweiNamPhai.palaces[chartVcd.ziweiNamPhai.menhBranch]!;
    expect(menhVcd.voChinhDieu).toBe(true);

    // Find a date where menhInThaiTueTamHop && hasFullTuLinhInMenhTamHop (any Yin year with Mệnh in Thái Tuế Tam Hợp)
    let chartTuLinh = chartVcd;
    for (let h = 0; h < 24; h += 2) {
      const tCand = normalizeBirthTemporal({
        year: 1985,
        month: 6,
        day: 15,
        hour: h,
        minute: 0,
        location: 'Hà Nội',
      });
      const cCand = compileChartIR({ temporal: tCand, gender: 'female' });
      if (cCand.ziweiNamPhai.thaiTueTamHopTuLinh.isThaiTueTuLinhWay) {
        chartTuLinh = cCand;
        break;
      }
    }
    expect(chartTuLinh.ziweiNamPhai.thaiTueTamHopTuLinh.isThaiTueTuLinhWay).toBe(true);

    const vcdPopulated = chartVcd.ziweiNamPhai.palaces.find((p) => !p.voChinhDieu)!;
    const tamKhongRules: RuleIR[] = [
      {
        id: 'M3-VCD-TRUE',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'TRUNG',
        when: { op: 'vo_chinh_dieu', palace: 'Mệnh', value: true },
        claimVi: 'Mệnh Vô Chính Diệu',
        classicalSource: 'Test',
      },
      {
        id: 'M3-VCD-FALSE',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: { op: 'vo_chinh_dieu', palace: vcdPopulated.palaceName, value: false },
        claimVi: 'Cung có chính tinh',
        classicalSource: 'Test',
      },
      {
        id: 'M3-TAM-KHONG',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: { op: 'tam_khong_in_tam_phuong', palace: 'Mệnh', minCount: 1 },
        claimVi: 'Tam Không hội chiếu',
        classicalSource: 'Test',
      },
      {
        id: 'M3-TAM-KHONG-MISS',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'HUNG',
        when: { op: 'tam_khong_in_tam_phuong', palace: 'Mệnh', minCount: 5 },
        claimVi: 'Không thể đạt 5 Không',
        classicalSource: 'Test',
      },
    ];

    const tuLinhRules: RuleIR[] = [
      {
        id: 'M3-TULINH-HOP',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: { op: 'thai_tue_tu_linh', scope: 'tam_hop' },
        claimVi: 'Thái Tuế Tứ Linh tam hợp',
        classicalSource: 'Test',
      },
      {
        id: 'M3-TULINH-PHUONG',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: { op: 'thai_tue_tu_linh', scope: 'tam_phuong' },
        claimVi: 'Thái Tuế Tứ Linh tam phương',
        classicalSource: 'Test',
      },
    ];

    const repVcd = evaluateRulesDAG(chartVcd, tamKhongRules);
    expect(repVcd.nodes.map((n) => n.nodeId)).toEqual(['M3-TAM-KHONG', 'M3-VCD-FALSE', 'M3-VCD-TRUE']);

    const repTuLinh = evaluateRulesDAG(chartTuLinh, tuLinhRules);
    expect(repTuLinh.nodes.map((n) => n.nodeId)).toEqual(['M3-TULINH-HOP', 'M3-TULINH-PHUONG']);

    const pyScript = [
      'import json, sys',
      'from sovana.geo_time import sha256_canonical',
      'from sovana.solver import evaluate_rules_dag',
      'payload = json.load(sys.stdin)',
      'out = [sha256_canonical(evaluate_rules_dag(item["chart"], item["rules"])) for item in payload]',
      'print(json.dumps(out))',
    ].join('\n');
    const pyShas = JSON.parse(
      execFileSync('uv', ['run', 'python', '-c', pyScript], {
        cwd: repoRoot,
        input: JSON.stringify([
          { chart: chartVcd, rules: tamKhongRules },
          { chart: chartTuLinh, rules: tuLinhRules },
        ]),
        encoding: 'utf-8',
      }).trim(),
    ) as string[];
    expect(pyShas).toEqual([sha256Canonical(repVcd), sha256Canonical(repTuLinh)]);
  });

  it('has 0 Địa Chi / Dương chi / Âm chi leaks across all 12 PUBLIC_RECTIFICATION_QUESTIONS', () => {
    const leakRe = /\b(Tý|Sửu|Dần|Mão|Thìn|Tỵ|Ngọ|Mùi|Thân|Dậu|Tuất|Hợi|Dương chi|Âm chi)\b/u;
    expect(PUBLIC_RECTIFICATION_QUESTIONS).toHaveLength(12);
    for (const q of PUBLIC_RECTIFICATION_QUESTIONS) {
      expect(q.promptVi).not.toMatch(leakRe);
      for (const opt of q.options) {
        expect(opt.labelVi).not.toMatch(leakRe);
      }
      expect(q.chartPredicates).toBeTruthy();
    }
  });

  it('evalChartPredicate ignores borrowedMajorStars on VCD palaces and distinguishes native stars', () => {
    const tVcd = normalizeBirthTemporal({
      year: 1980,
      month: 8,
      day: 15,
      hour: 0,
      minute: 30,
      location: 'Đà Nẵng',
    });
    const chart = compileChartIR({ temporal: tVcd, gender: 'male' });
    const vcdPalace = chart.ziweiNamPhai.palaces.find(
      (p) => p.voChinhDieu && p.borrowedMajorStars.length > 0,
    )!;
    const borrowedStarName = vcdPalace.borrowedMajorStars[0]!.name;
    expect(
      evalChartPredicate(
        { op: 'palace_has_any_star', palace: vcdPalace.palaceName, stars: [borrowedStarName] },
        chart,
      ),
    ).toBe(false);
    expect(
      evalChartPredicate(
        { op: 'menh_vo_chinh_dieu', expected: chart.ziweiNamPhai.palaces[chart.ziweiNamPhai.menhBranch]!.voChinhDieu },
        chart,
      ),
    ).toBe(true);
  });

  it('converges via 12-ChartIR Blind Bayesian Rectification across dates, certainty modes, and TS<->Python lockstep', () => {
    const build12Charts = (year: number, month: number, day: number, gender: 'male' | 'female') =>
      Array.from({ length: 12 }, (_, b) => {
        const hour = (b * 2) % 24;
        const temporal = normalizeBirthTemporal({
          year,
          month,
          day,
          hour,
          minute: 0,
          location: 'Hà Nội',
        });
        return compileChartIR({ temporal, gender });
      });

    const dates: Array<[number, number, number, 'male' | 'female']> = [
      [1990, 6, 15, 'male'],
      [1980, 8, 15, 'male'],
      [1985, 3, 25, 'female'],
      [1968, 1, 29, 'female'],
    ];

    const windowBranches: Record<BirthTimeWindow, readonly number[]> = {
      SANG: [3, 4, 5],
      TRUA: [6],
      CHIEU: [7, 8, 9],
      TOI: [9, 10, 11],
      DEM: [11, 0, 1, 2],
    };

    const runToLock = (
      charts: ReturnType<typeof build12Charts>,
      session: ReturnType<typeof createRectificationSessionFromCharts>,
      trueBranch: number,
    ) => {
      let state = session.state;
      let steps = 0;
      while (state.status === 'ACTIVE') {
        const next = selectNextQuestion(state, session.compiledBank);
        expect(next).not.toBeNull();
        const q = next!.question;
        const mat = q.likelihoodMatrixMicro as Record<string, readonly number[]>;
        let bestOpt = q.options[0]!.id;
        let bestVal = -1;
        for (const opt of q.options) {
          const val = mat[opt.id]![trueBranch]!;
          if (val > bestVal) {
            bestVal = val;
            bestOpt = opt.id;
          }
        }
        state = answerQuestion(state, q.id, bestOpt, session.compiledBank);
        steps++;
      }
      return { state, steps };
    };

    for (const [y, m, d, g] of dates) {
      const charts = build12Charts(y, m, d, g);

      for (let b = 0; b < 12; b++) {
        // EXACT_TIME
        const exactSess = createRectificationSessionFromCharts(charts, {
          mode: 'EXACT_TIME',
          centerBranch: b,
          userAge: 28,
        });
        const exactRes = runToLock(charts, exactSess, b);
        expect(exactRes.state.status).toBe('LOCKED');
        expect(exactRes.state.lockedShichenBranch).toBe(b);
        expect(exactRes.steps).toBeLessThanOrEqual(5);

        // UNKNOWN
        const unkSess = createRectificationSessionFromCharts(charts, {
          mode: 'UNKNOWN',
          userAge: 28,
        });
        expect(unkSess.state.entropyMillibits).toBe(3585);
        const unkRes = runToLock(charts, unkSess, b);
        expect(unkRes.state.status).toBe('LOCKED');
        expect(unkRes.state.lockedShichenBranch).toBe(b);
        expect(unkRes.steps).toBeLessThanOrEqual(6);
      }

      // All 5 TIME_WINDOWs
      for (const win of ['SANG', 'TRUA', 'CHIEU', 'TOI', 'DEM'] as const) {
        for (const b of windowBranches[win]) {
          const winSess = createRectificationSessionFromCharts(charts, {
            mode: 'TIME_WINDOW',
            birthTimeWindow: win,
            userAge: 32,
          });
          const winRes = runToLock(charts, winSess, b);
          expect(winRes.state.status).toBe('LOCKED');
          expect(winRes.state.lockedShichenBranch).toBe(b);
          expect(winRes.steps).toBeLessThanOrEqual(5);
        }
      }
    }

    // TS <-> Python sha256Canonical(session) lockstep check across all 3 modes
    expect(computeCertaintyPriorWeights('UNKNOWN')).toEqual(new Array(12).fill(1));
    const sampleCharts = build12Charts(1980, 8, 15, 'male');
    const sessExact = createRectificationSessionFromCharts(sampleCharts, {
      mode: 'EXACT_TIME',
      ambiguousBranches: [0, 1],
      centerBranch: 0,
      userAge: 30,
    });
    const sessWin = createRectificationSessionFromCharts(sampleCharts, {
      mode: 'TIME_WINDOW',
      birthTimeWindow: 'SANG',
      userAge: 30,
    });
    const sessUnk = createRectificationSessionFromCharts(sampleCharts, {
      mode: 'UNKNOWN',
      userAge: 30,
    });
    const pickUnk = selectNextQuestion(sessUnk.state, sessUnk.compiledBank);
    expect(pickUnk).not.toBeNull();
    const afterUnk = answerQuestion(
      sessUnk.state,
      pickUnk!.questionId,
      pickUnk!.question.options[0]!.id,
      sessUnk.compiledBank,
    );

    const tsSessionShas = [
      sha256Canonical(sessExact),
      sha256Canonical(sessWin),
      sha256Canonical(sessUnk),
      sha256Canonical(pickUnk),
      sha256Canonical(afterUnk),
    ];

    const pyScript = [
      'import json, sys',
      'from sovana.geo_time import sha256_canonical',
      'from sovana.solver import answer_question, create_rectification_session_from_charts, select_next_question',
      'charts = json.load(sys.stdin)',
      's_ex = create_rectification_session_from_charts(charts, mode="EXACT_TIME", ambiguous_branches=[0, 1], center_branch=0, user_age=30)',
      's_wn = create_rectification_session_from_charts(charts, mode="TIME_WINDOW", birth_time_window="SANG", user_age=30)',
      's_uk = create_rectification_session_from_charts(charts, mode="UNKNOWN", user_age=30)',
      'pk = select_next_question(s_uk.state, s_uk.compiled_bank)',
      'af = answer_question(s_uk.state, pk.question_id, pk.question.options[0].id, s_uk.compiled_bank)',
      'print(json.dumps([sha256_canonical(s_ex), sha256_canonical(s_wn), sha256_canonical(s_uk), sha256_canonical(pk), sha256_canonical(af)]))',
    ].join('\n');
    const pyShas = JSON.parse(
      execFileSync('uv', ['run', 'python', '-c', pyScript], {
        cwd: repoRoot,
        input: JSON.stringify(sampleCharts),
        encoding: 'utf-8',
      }).trim(),
    ) as string[];
    expect(tsSessionShas).toEqual(pyShas);
  });
});
