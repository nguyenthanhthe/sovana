import { floorMod } from '@sovana/geo-time';
import type { ChartIR, ZiweiChartIR, ZiweiPalaceIR } from '@sovana/kernel';
import { loadSampleRules } from './store.js';
import type {
  ConditionAST,
  IsomorphicContextFilter,
  LiuyaoStateFlag,
  LiuyaoTheUngRelation,
  ParaconsistentConflict,
  ProvenanceNode,
  RuleIR,
  RuleSilo,
  SolverReportIR,
} from './types.js';

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedUnique(items: readonly string[]): string[] {
  if (items.length === 0) return [];
  const set = new Set(items);
  return Array.from(set).sort(cmpStr);
}

const ELEMENT_INDEX: Readonly<Record<string, number>> = {
  Mộc: 0,
  Hỏa: 1,
  Thổ: 2,
  Kim: 3,
  Thủy: 4,
};

// Branch 0=Tý .. 11=Hợi -> Five Element index (Mộc=0, Hỏa=1, Thổ=2, Kim=3, Thủy=4)
const BRANCH_ELEMENT_INDEX: readonly number[] = [
  4, // 0 Tý: Thủy
  2, // 1 Sửu: Thổ
  0, // 2 Dần: Mộc
  0, // 3 Mão: Mộc
  2, // 4 Thìn: Thổ
  1, // 5 Tỵ: Hỏa
  1, // 6 Ngọ: Hỏa
  2, // 7 Mùi: Thổ
  3, // 8 Thân: Kim
  3, // 9 Dậu: Kim
  2, // 10 Tuất: Thổ
  4, // 11 Hợi: Thủy
];

const TIEN_THAN_PAIRS: ReadonlySet<string> = new Set([
  '11->0',
  '2->3',
  '5->6',
  '8->9',
  '1->4',
  '4->7',
  '7->10',
]);

const THOAI_THAN_PAIRS: ReadonlySet<string> = new Set([
  '0->11',
  '3->2',
  '6->5',
  '9->8',
  '4->1',
  '7->4',
  '10->7',
]);

function normalizePalaceKey(name: string): string {
  const trimmed = name.trim();
  if (trimmed === 'Giao Hữu' || trimmed === 'Nô Bộc') return 'Nô Bộc';
  return trimmed;
}

function findPalace(ziwei: ZiweiChartIR, palaceQuery: string): ZiweiPalaceIR | undefined {
  const target = normalizePalaceKey(palaceQuery);
  if (target === 'Thân') {
    return ziwei.palaces.find((p) => p.isThan || p.branchIndex === ziwei.thanBranch);
  }
  return ziwei.palaces.find((p) => normalizePalaceKey(p.palaceName) === target);
}

function findPalaceByBranch(ziwei: ZiweiChartIR, branchIndex: number): ZiweiPalaceIR | undefined {
  const b = floorMod(branchIndex, 12);
  return ziwei.palaces.find((p) => p.branchIndex === b);
}

function palaceHasStarOrTransform(palace: ZiweiPalaceIR, starOrTransform: string): boolean {
  for (const s of palace.majorStars) {
    if (s.name === starOrTransform || s.sihuaTransform === starOrTransform) return true;
  }
  for (const s of palace.minorStars) {
    if (s.name === starOrTransform || s.sihuaTransform === starOrTransform) return true;
  }
  if (
    palace.thaiTueStar === starOrTransform ||
    palace.trangSinhStar === starOrTransform ||
    palace.bacSyStar === starOrTransform
  ) {
    return true;
  }
  return false;
}

function selectZiweiChart(
  chart: ChartIR,
  ruleSilo: RuleSilo,
  explicitSilo?: 'nam-phai' | 'toan-thu' | undefined,
): { siloId: 'nam-phai' | 'toan-thu'; ziwei: ZiweiChartIR } {
  const siloId: 'nam-phai' | 'toan-thu' =
    explicitSilo !== undefined ? explicitSilo : ruleSilo === 'toan-thu' ? 'toan-thu' : 'nam-phai';
  return {
    siloId,
    ziwei: siloId === 'toan-thu' ? chart.ziweiToanThu : chart.ziweiNamPhai,
  };
}

function baziHasTenGod(chart: ChartIR, tenGod: string): boolean {
  const pillars = [
    chart.bazi.yearPillar,
    chart.bazi.monthPillar,
    chart.bazi.dayPillar,
    chart.bazi.hourPillar,
  ];
  for (const p of pillars) {
    if (p.position !== 'day' && p.stemTenGod === tenGod) {
      return true;
    }
    for (const hs of p.hiddenStems) {
      if (hs.tenGod === tenGod) {
        return true;
      }
    }
  }
  return false;
}

function computeTheUngRelation(chart: ChartIR): LiuyaoTheUngRelation | null {
  const ly = chart.liuyao;
  if (!ly) return null;
  const theLine = ly.lines.find((l) => l.isThe);
  const ungLine = ly.lines.find((l) => l.isUng);
  if (!theLine || !ungLine) return null;
  const eThe = ELEMENT_INDEX[theLine.elementVi];
  const eUng = ELEMENT_INDEX[ungLine.elementVi];
  if (eThe === undefined || eUng === undefined) return null;
  if (eThe === eUng) return 'TY_HOA';
  if ((eThe + 1) % 5 === eUng) return 'THE_SINH_UNG';
  if ((eUng + 1) % 5 === eThe) return 'UNG_SINH_THE';
  if ((eThe + 2) % 5 === eUng) return 'THE_KHAC_UNG';
  return 'UNG_KHAC_THE';
}

function evalLiuyaoFlag(chart: ChartIR, flag: LiuyaoStateFlag): boolean {
  const ly = chart.liuyao;
  if (!ly) return false;
  const theLine = ly.lines.find((l) => l.isThe);
  const ungLine = ly.lines.find((l) => l.isUng);

  switch (flag) {
    case 'theTuanKhong':
      return Boolean(theLine?.isTuanKhong);
    case 'theNguyetPha':
      return Boolean(theLine?.isNguyetPha);
    case 'ungTuanKhong':
      return Boolean(ungLine?.isTuanKhong);
    case 'ungNguyetPha':
      return Boolean(ungLine?.isNguyetPha);
    case 'theDong':
      return Boolean(theLine?.isMoving);
    case 'ungDong':
      return Boolean(ungLine?.isMoving);
    case 'hoaTienThan':
      return ly.lines.some(
        (l) =>
          l.isMoving &&
          l.transformedBranchIndex !== null &&
          TIEN_THAN_PAIRS.has(`${l.branchIndex}->${l.transformedBranchIndex}`),
      );
    case 'hoaThoaiThan':
      return ly.lines.some(
        (l) =>
          l.isMoving &&
          l.transformedBranchIndex !== null &&
          THOAI_THAN_PAIRS.has(`${l.branchIndex}->${l.transformedBranchIndex}`),
      );
    case 'hoaHoiDauSinh':
      return ly.lines.some((l) => {
        if (!l.isMoving || l.transformedElementVi === null) return false;
        const ePrim = ELEMENT_INDEX[l.elementVi];
        const eTrans = ELEMENT_INDEX[l.transformedElementVi];
        return ePrim !== undefined && eTrans !== undefined && (eTrans + 1) % 5 === ePrim;
      });
    case 'hoaHoiDauKhac':
      return ly.lines.some((l) => {
        if (!l.isMoving || l.transformedElementVi === null) return false;
        const ePrim = ELEMENT_INDEX[l.elementVi];
        const eTrans = ELEMENT_INDEX[l.transformedElementVi];
        return ePrim !== undefined && eTrans !== undefined && (eTrans + 2) % 5 === ePrim;
      });
    case 'theVuongTuong':
    case 'theHuuTu': {
      if (!theLine) return false;
      const eThe = ELEMENT_INDEX[theLine.elementVi];
      const eMonth = BRANCH_ELEMENT_INDEX[floorMod(ly.monthBranchIndex, 12)];
      if (eThe === undefined || eMonth === undefined) return false;
      const isVT = eThe === eMonth || (eMonth + 1) % 5 === eThe;
      return flag === 'theVuongTuong' ? isVT : !isVT;
    }
    case 'hasPhucThan':
      return ly.phucThan.length > 0;
    case 'phiSinhPhuc':
      return ly.phucThan.some((p) => {
        const a = ELEMENT_INDEX[p.phiThanElementVi];
        const b = ELEMENT_INDEX[p.elementVi];
        return a !== undefined && b !== undefined && (a + 1) % 5 === b;
      });
    case 'phiKhacPhuc':
      return ly.phucThan.some((p) => {
        const a = ELEMENT_INDEX[p.phiThanElementVi];
        const b = ELEMENT_INDEX[p.elementVi];
        return a !== undefined && b !== undefined && (a + 2) % 5 === b;
      });
    case 'phiLamKhongPha':
      return ly.phucThan.some((p) => {
        const line = ly.lines[p.lineNumber - 1];
        return line !== undefined && (line.isTuanKhong || line.isNguyetPha);
      });
    case 'theAmDong': {
      if (!theLine || theLine.isMoving) return false;
      const eThe = ELEMENT_INDEX[theLine.elementVi];
      const eMonth = BRANCH_ELEMENT_INDEX[floorMod(ly.monthBranchIndex, 12)];
      if (eThe === undefined || eMonth === undefined) return false;
      const isVT = eThe === eMonth || (eMonth + 1) % 5 === eThe;
      return isVT && floorMod(ly.nhatThanBranch + 6, 12) === theLine.branchIndex;
    }
  }
}

interface EvalOutcome {
  matched: boolean;
  cost: number;
  parents: string[];
  facts: string[];
}

const UNMATCHED: EvalOutcome = {
  matched: false,
  cost: 0,
  parents: [],
  facts: [],
};

function evaluateCondition(
  cond: ConditionAST,
  chart: ChartIR,
  ruleSilo: RuleSilo,
  derivedMap: ReadonlyMap<string, ProvenanceNode>,
): EvalOutcome {
  switch (cond.op) {
    case 'star_in_palace': {
      const { siloId, ziwei } = selectZiweiChart(chart, ruleSilo, cond.silo);
      const p = findPalace(ziwei, cond.palace);
      if (!p || !palaceHasStarOrTransform(p, cond.star)) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`ziwei:${siloId}:star_in_palace:${cond.palace}:${cond.star}`],
      };
    }
    case 'star_in_tam_phuong': {
      const { siloId, ziwei } = selectZiweiChart(chart, ruleSilo, cond.silo);
      const basePalace = findPalace(ziwei, cond.palace);
      if (!basePalace) return UNMATCHED;
      const b = basePalace.branchIndex;
      const branches = [b, (b + 4) % 12, (b + 8) % 12, (b + 6) % 12];
      const hit = branches.some((br) => {
        const pal = findPalaceByBranch(ziwei, br);
        return pal !== undefined && palaceHasStarOrTransform(pal, cond.star);
      });
      if (!hit) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`ziwei:${siloId}:star_in_tam_phuong:${cond.palace}:${cond.star}`],
      };
    }
    case 'star_brightness_in': {
      const { siloId, ziwei } = selectZiweiChart(chart, ruleSilo, cond.silo);
      const searchPalaces: ZiweiPalaceIR[] =
        cond.palace !== undefined && cond.palace.length > 0
          ? (() => {
              const p = findPalace(ziwei, cond.palace);
              return p ? [p] : [];
            })()
          : ziwei.palaces;
      for (const p of searchPalaces) {
        const allStars = [...p.majorStars, ...p.minorStars];
        for (const s of allStars) {
          if (s.name === cond.star || s.sihuaTransform === cond.star) {
            if (s.brightness !== null && cond.levels.includes(s.brightness)) {
              const palLabel = cond.palace !== undefined && cond.palace.length > 0 ? cond.palace : '*';
              return {
                matched: true,
                cost: 0,
                parents: [],
                facts: [`ziwei:${siloId}:star_brightness_in:${palLabel}:${cond.star}:${s.brightness}`],
              };
            }
          }
        }
      }
      return UNMATCHED;
    }
    case 'sihua_in_palace': {
      const { siloId, ziwei } = selectZiweiChart(chart, ruleSilo, cond.silo);
      const p = findPalace(ziwei, cond.palace);
      if (!p || !palaceHasStarOrTransform(p, cond.transform)) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`ziwei:${siloId}:sihua_in_palace:${cond.palace}:${cond.transform}`],
      };
    }
    case 'palace_has_flag': {
      const { siloId, ziwei } = selectZiweiChart(chart, ruleSilo, cond.silo);
      const p = findPalace(ziwei, cond.palace);
      if (!p) return UNMATCHED;
      const flagVal = cond.flag === 'tuanTrung' ? p.tuanTrung : p.trietLo;
      if (!flagVal) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`ziwei:${siloId}:palace_has_flag:${cond.palace}:${cond.flag}`],
      };
    }
    case 'palace_branch_in': {
      const { siloId, ziwei } = selectZiweiChart(chart, ruleSilo, cond.silo);
      const p = findPalace(ziwei, cond.palace);
      if (!p || !cond.branches.includes(p.branchIndex)) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`ziwei:${siloId}:palace_branch_in:${cond.palace}:${p.branchIndex}`],
      };
    }
    case 'star_in_relative_palace': {
      const { siloId, ziwei } = selectZiweiChart(chart, ruleSilo, cond.silo);
      const basePalace = findPalace(ziwei, cond.palace);
      if (!basePalace) return UNMATCHED;
      const b = basePalace.branchIndex;
      let targetBranch: number;
      switch (cond.relation) {
        case 'opposite':
          targetBranch = (b + 6) % 12;
          break;
        case 'prev':
          targetBranch = (b + 11) % 12;
          break;
        case 'next':
          targetBranch = (b + 1) % 12;
          break;
        case 'nhi_hop':
          targetBranch = (13 - b) % 12;
          break;
      }
      const targetPalace = findPalaceByBranch(ziwei, targetBranch);
      if (!targetPalace || !palaceHasStarOrTransform(targetPalace, cond.star)) {
        return UNMATCHED;
      }
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`ziwei:${siloId}:star_in_relative_palace:${cond.palace}:${cond.relation}:${cond.star}`],
      };
    }
    case 'palace_major_count': {
      const { siloId, ziwei } = selectZiweiChart(chart, ruleSilo, cond.silo);
      const p = findPalace(ziwei, cond.palace);
      if (!p) return UNMATCHED;
      const count = p.majorStars.length;
      if (
        (cond.exact != null && count !== cond.exact) ||
        (cond.min != null && count < cond.min) ||
        (cond.max != null && count > cond.max)
      ) {
        return UNMATCHED;
      }
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`ziwei:${siloId}:palace_major_count:${cond.palace}:${count}`],
      };
    }
    case 'palace_star_count_in': {
      const { siloId, ziwei } = selectZiweiChart(chart, ruleSilo, cond.silo);
      const p = findPalace(ziwei, cond.palace);
      if (!p) return UNMATCHED;
      let count = 0;
      for (const s of new Set(cond.stars)) {
        if (palaceHasStarOrTransform(p, s)) count++;
      }
      if (count < cond.min || (cond.max != null && count > cond.max)) {
        return UNMATCHED;
      }
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`ziwei:${siloId}:palace_star_count_in:${cond.palace}:${count}`],
      };
    }
    case 'star_co_located': {
      const uniq = sortedUnique(cond.stars);
      if (uniq.length === 0) return UNMATCHED;
      const { siloId, ziwei } = selectZiweiChart(chart, ruleSilo, cond.silo);
      const sortedJoined = uniq.join('+');
      if (cond.palace != null && cond.palace.length > 0) {
        const p = findPalace(ziwei, cond.palace);
        if (!p || !uniq.every((s) => palaceHasStarOrTransform(p, s))) return UNMATCHED;
        return {
          matched: true,
          cost: 0,
          parents: [],
          facts: [`ziwei:${siloId}:star_co_located:${cond.palace}:${sortedJoined}`],
        };
      }
      const sortedPalaces = [...ziwei.palaces].sort((a, b) => a.branchIndex - b.branchIndex);
      const hit = sortedPalaces.find((p) => uniq.every((s) => palaceHasStarOrTransform(p, s)));
      if (!hit) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`ziwei:${siloId}:star_co_located:palace_${hit.branchIndex}:${sortedJoined}`],
      };
    }
    case 'vo_chinh_dieu': {
      const { siloId, ziwei } = selectZiweiChart(chart, ruleSilo, cond.silo);
      const p = findPalace(ziwei, cond.palace);
      if (!p || p.voChinhDieu !== cond.value) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`ziwei:${siloId}:vo_chinh_dieu:${cond.palace}:${String(cond.value)}`],
      };
    }
    case 'tam_khong_in_tam_phuong': {
      const { siloId, ziwei } = selectZiweiChart(chart, ruleSilo, cond.silo);
      const basePalace = findPalace(ziwei, cond.palace);
      if (!basePalace) return UNMATCHED;
      const b = basePalace.branchIndex;
      const found = new Set<string>();
      for (const br of [b, (b + 4) % 12, (b + 8) % 12, (b + 6) % 12]) {
        const pal = findPalaceByBranch(ziwei, br);
        if (pal) {
          for (const tok of pal.tamKhongTypes) {
            found.add(tok);
          }
        }
      }
      const count = found.size;
      if (count < cond.minCount) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`ziwei:${siloId}:tam_khong_in_tam_phuong:${cond.palace}:${count}`],
      };
    }
    case 'thai_tue_tu_linh': {
      const { siloId, ziwei } = selectZiweiChart(chart, ruleSilo, cond.silo);
      const tt = ziwei.thaiTueTamHopTuLinh;
      const hasTuLinh =
        cond.scope === 'tam_hop' ? tt.hasFullTuLinhInMenhTamHop : tt.hasFullTuLinhInMenhTamPhuong;
      if (!tt.menhInThaiTueTamHop || !hasTuLinh) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`ziwei:${siloId}:thai_tue_tu_linh:${cond.scope}`],
      };
    }
    case 'year_stem_in': {
      const yStem =
        ruleSilo === 'bazi'
          ? chart.temporal.pillars.baziYearPillar.stemIndex
          : chart.temporal.pillars.lunarYearPillar.stemIndex;
      if (!cond.stems.includes(yStem)) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`stem:year:${yStem}`],
      };
    }
    case 'bazi_strength_is': {
      if (chart.bazi.strengthClass !== cond.value) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`bazi:strength:${cond.value}`],
      };
    }
    case 'day_stem_in': {
      const dStem = chart.temporal.pillars.dayPillar.stemIndex;
      if (!cond.stems.includes(dStem)) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`bazi:day_stem:${dStem}`],
      };
    }
    case 'month_branch_in': {
      const mBranch = chart.temporal.pillars.baziMonthPillar.branchIndex;
      if (!cond.branches.includes(mBranch)) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`bazi:month_branch:${mBranch}`],
      };
    }
    case 'bazi_has_ten_god': {
      if (!baziHasTenGod(chart, cond.tenGod)) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`bazi:ten_god:${cond.tenGod}`],
      };
    }
    case 'liuyao_has_moving': {
      if (!chart.liuyao) return UNMATCHED;
      const hasMoving = chart.liuyao.movingLines.length > 0;
      if (hasMoving !== cond.value) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`liuyao:has_moving:${String(cond.value)}`],
      };
    }
    case 'liuyao_the_ung_relation': {
      const rel = computeTheUngRelation(chart);
      if (rel !== cond.relation) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`liuyao:the_ung:${cond.relation}`],
      };
    }
    case 'liuyao_state_flag': {
      if (!evalLiuyaoFlag(chart, cond.flag)) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`liuyao:flag:${cond.flag}`],
      };
    }
    case 'derived_node': {
      const parent = derivedMap.get(cond.nodeId);
      if (!parent) return UNMATCHED;
      return {
        matched: true,
        cost: parent.proofDepth,
        parents: [cond.nodeId],
        facts: [`derived:${cond.nodeId}`],
      };
    }
    case 'and': {
      if (cond.args.length === 0) {
        return { matched: true, cost: 0, parents: [], facts: [] };
      }
      let maxCost = 0;
      const allParents: string[] = [];
      const allFacts: string[] = [];
      for (const arg of cond.args) {
        const sub = evaluateCondition(arg, chart, ruleSilo, derivedMap);
        if (!sub.matched) return UNMATCHED;
        if (sub.cost > maxCost) maxCost = sub.cost;
        allParents.push(...sub.parents);
        allFacts.push(...sub.facts);
      }
      return {
        matched: true,
        cost: maxCost,
        parents: sortedUnique(allParents),
        facts: sortedUnique(allFacts),
      };
    }
    case 'or': {
      const matchedSubs: EvalOutcome[] = [];
      for (const arg of cond.args) {
        const sub = evaluateCondition(arg, chart, ruleSilo, derivedMap);
        if (sub.matched) matchedSubs.push(sub);
      }
      if (matchedSubs.length === 0) return UNMATCHED;
      let minCost = matchedSubs[0]!.cost;
      for (const sub of matchedSubs) {
        if (sub.cost < minCost) minCost = sub.cost;
      }
      const bestParents: string[] = [];
      const bestFacts: string[] = [];
      for (const sub of matchedSubs) {
        if (sub.cost === minCost) {
          bestParents.push(...sub.parents);
          bestFacts.push(...sub.facts);
        }
      }
      return {
        matched: true,
        cost: minCost,
        parents: sortedUnique(bestParents),
        facts: sortedUnique(bestFacts),
      };
    }
    case 'not': {
      const sub = evaluateCondition(cond.arg, chart, ruleSilo, derivedMap);
      if (sub.matched) return UNMATCHED;
      return {
        matched: true,
        cost: 0,
        parents: [],
        facts: [`not:${cond.arg.op}`],
      };
    }
  }
}

function passesContextFilter(rule: RuleIR, filter?: IsomorphicContextFilter | undefined): boolean {
  if (!filter) return true;

  if (filter.careerCategory !== undefined && filter.careerCategory !== null) {
    if (rule.careerCategory !== undefined && rule.careerCategory !== null) {
      if (rule.careerCategory !== filter.careerCategory) return false;
    }
    if (rule.careerCategories !== undefined && rule.careerCategories !== null && rule.careerCategories.length > 0) {
      if (!rule.careerCategories.includes(filter.careerCategory)) return false;
    }
  }

  if (filter.setting !== undefined && filter.setting !== null) {
    if (rule.setting !== undefined && rule.setting !== null) {
      if (rule.setting !== filter.setting) return false;
    }
    if (rule.settings !== undefined && rule.settings !== null && rule.settings.length > 0) {
      if (!rule.settings.includes(filter.setting)) return false;
    }
  }

  return true;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function detectParaconsistentConflicts(nodes: readonly ProvenanceNode[]): ParaconsistentConflict[] {
  const domains = sortedUnique(nodes.map((n) => n.domain));
  const conflicts: ParaconsistentConflict[] = [];

  for (const domain of domains) {
    const domNodes = nodes.filter((n) => n.domain === domain);

    // 1. Cross-Silo opposition (opposing polarities CAT vs HUNG across distinct silos, or nam-phai vs toan-thu fork)
    const crossPosSet = new Set<string>();
    const crossNegSet = new Set<string>();
    let hasNamPhaiToanThuPair = false;

    for (const u of domNodes) {
      if (u.polarity !== 'CAT') continue;
      for (const v of domNodes) {
        if (v.polarity !== 'HUNG' || v.silo === u.silo) continue;
        crossPosSet.add(u.nodeId);
        crossNegSet.add(v.nodeId);
        if (
          (u.silo === 'nam-phai' && v.silo === 'toan-thu') ||
          (u.silo === 'toan-thu' && v.silo === 'nam-phai')
        ) {
          hasNamPhaiToanThuPair = true;
        }
      }
    }

    if (crossPosSet.size > 0 && crossNegSet.size > 0) {
      conflicts.push({
        conflictId: `conflict:${domain}:CROSS_SILO`,
        domain,
        kind: 'CROSS_SILO',
        positiveNodeIds: Array.from(crossPosSet).sort(cmpStr),
        negativeNodeIds: Array.from(crossNegSet).sort(cmpStr),
        resolutionHintVi: hasNamPhaiToanThuPair
          ? `Bất đồng tiên đề Nam Phái ↔ Toàn Thư tại lĩnh vực '${domain}': bảo toàn cả hai nhánh suy diễn (lưỡng thuyết) và dùng câu hỏi Định Bàn thực chứng quá khứ để xác lập hệ tiên đề ứng hợp.`
          : `Đối lập Cát/Hung liên hệ thống tại lĩnh vực '${domain}': bảo toàn cả hai mệnh đề và đối chiếu Dụng Thần Bát Tự cùng Đại Hạn Tử Vi trước khi kết luận.`,
      });
    }

    // 2. Intra-Silo paraconsistent coexistence (CAT and HUNG within the same silo & domain)
    const silos = sortedUnique(domNodes.map((n) => n.silo));
    for (const silo of silos) {
      const posIds = domNodes
        .filter((n) => n.silo === silo && n.polarity === 'CAT')
        .map((n) => n.nodeId)
        .sort(cmpStr);
      const negIds = domNodes
        .filter((n) => n.silo === silo && n.polarity === 'HUNG')
        .map((n) => n.nodeId)
        .sort(cmpStr);
      if (posIds.length > 0 && negIds.length > 0) {
        conflicts.push({
          conflictId: `conflict:${domain}:INTRA_SILO_PARACONSISTENT:${silo}`,
          domain,
          kind: 'INTRA_SILO_PARACONSISTENT',
          positiveNodeIds: posIds,
          negativeNodeIds: negIds,
          resolutionHintVi: `Lưỡng thuyết nội phái (${silo}) tại lĩnh vực '${domain}': Cát tinh và Hung tinh đồng hiện, bảo toàn cả hai chiều thuận–nghịch theo từng giai đoạn vận hạn thay vì triệt tiêu.`,
        });
      }
    }
  }

  conflicts.sort((a, b) => cmpStr(a.conflictId, b.conflictId));
  return conflicts;
}

export function evaluateRulesDAG(
  chart: ChartIR,
  rules?: readonly RuleIR[] | undefined,
  contextFilter?: IsomorphicContextFilter | undefined,
): SolverReportIR {
  const sourceRules = rules ?? loadSampleRules();
  const activeRules = sourceRules.filter((r) => passesContextFilter(r, contextFilter));

  // Deduplicate by rule.id deterministically and group by topological stratum
  const byId = new Map<string, RuleIR>();
  for (const r of activeRules) {
    if (!Number.isInteger(r.stratum) || r.stratum < 1) {
      throw new Error(`Invalid rule stratum for '${r.id}': ${r.stratum} (must be integer >= 1)`);
    }
    if (!byId.has(r.id)) {
      byId.set(r.id, r);
    }
  }

  const canonicalRules = Array.from(byId.values()).sort((a, b) =>
    a.stratum !== b.stratum ? a.stratum - b.stratum : cmpStr(a.id, b.id),
  );

  const strataSet = new Set<number>();
  for (const r of canonicalRules) {
    strataSet.add(r.stratum);
  }
  const strataEvaluated = Array.from(strataSet).sort((a, b) => a - b);

  const derivedMap = new Map<string, ProvenanceNode>();

  for (const stratum of strataEvaluated) {
    const stratumRules = canonicalRules.filter((r) => r.stratum === stratum);
    let changed = true;
    while (changed) {
      changed = false;
      for (const rule of stratumRules) {
        const outcome = evaluateCondition(rule.when, chart, rule.silo, derivedMap);
        if (!outcome.matched) continue;

        const candidateDepth = 1 + outcome.cost;
        const existing = derivedMap.get(rule.id);

        if (!existing) {
          derivedMap.set(rule.id, {
            nodeId: rule.id,
            silo: rule.silo,
            stratum: rule.stratum,
            proofDepth: candidateDepth,
            domain: rule.domain,
            polarity: rule.polarity,
            claimVi: rule.claimVi,
            actionableAdviceVi: rule.actionableAdviceVi ?? null,
            classicalSource: rule.classicalSource,
            parentNodeIds: outcome.parents,
            matchedFacts: outcome.facts,
          });
          changed = true;
        } else if (
          candidateDepth < existing.proofDepth ||
          (candidateDepth === existing.proofDepth &&
            (!arraysEqual(existing.parentNodeIds, outcome.parents) ||
              !arraysEqual(existing.matchedFacts, outcome.facts)))
        ) {
          const mergedParents =
            candidateDepth < existing.proofDepth
              ? outcome.parents
              : sortedUnique([...existing.parentNodeIds, ...outcome.parents]);
          const mergedFacts =
            candidateDepth < existing.proofDepth
              ? outcome.facts
              : sortedUnique([...existing.matchedFacts, ...outcome.facts]);
          if (
            candidateDepth < existing.proofDepth ||
            !arraysEqual(existing.parentNodeIds, mergedParents) ||
            !arraysEqual(existing.matchedFacts, mergedFacts)
          ) {
            derivedMap.set(rule.id, {
              ...existing,
              proofDepth: candidateDepth,
              parentNodeIds: mergedParents,
              matchedFacts: mergedFacts,
            });
            changed = true;
          }
        }
      }
    }
  }

  const nodes = Array.from(derivedMap.values()).sort((a, b) =>
    a.stratum !== b.stratum ? a.stratum - b.stratum : cmpStr(a.nodeId, b.nodeId),
  );

  const conflicts = detectParaconsistentConflicts(nodes);

  const normalizedContextFilter =
    contextFilter !== undefined
      ? {
          careerCategory: contextFilter.careerCategory ?? null,
          setting: contextFilter.setting ?? null,
        }
      : null;

  return {
    schemaVersion: '1.0.0',
    totalRulesEvaluated: canonicalRules.length,
    strataEvaluated,
    contextFilter: normalizedContextFilter,
    nodes,
    conflicts,
  };
}
