import { BRANCHES_VI, STEMS_VI, floorMod, type NormalizedBirthTemporal } from '@sovana/geo-time';
import { loadLiuyaoAxiom } from './store.js';
import type {
  LiuyaoCastMethod,
  LiuyaoChartIR,
  LiuyaoHexagramSpec,
  LiuyaoHexagramSummaryIR,
  LiuyaoLineIR,
  LiuyaoLineValue,
  LiuyaoPhucThanIR,
} from './types.js';

// Tiên Thiên Bát Quái remainder (sum % 8):
// 1=Càn(111=7), 2=Đoài(011=3), 3=Ly(101=5), 4=Chấn(001=1),
// 5=Tốn(110=6), 6=Khảm(010=2), 7=Cấn(100=4), 0(8)=Khôn(000=0)
const TIEN_THIEN_REM_TO_BITS3 = [0, 7, 3, 5, 1, 6, 2, 4] as const;

const ELEMENT_TO_INDEX: Record<string, number> = {
  Mộc: 0,
  Hỏa: 1,
  Thổ: 2,
  Kim: 3,
  Thủy: 4,
};

const RELATIVES_BY_DIFF = [
  'Huynh Đệ',
  'Tử Tôn',
  'Thê Tài',
  'Quan Quỷ',
  'Phụ Mẫu',
] as const;

const ALL_FIVE_RELATIVES = [
  'Phụ Mẫu',
  'Huynh Đệ',
  'Tử Tôn',
  'Thê Tài',
  'Quan Quỷ',
] as const;

export function computeLiuyaoRelativeVi(houseElementVi: string, lineElementVi: string): string {
  const hIdx = ELEMENT_TO_INDEX[houseElementVi];
  const lIdx = ELEMENT_TO_INDEX[lineElementVi];
  if (hIdx === undefined || lIdx === undefined) {
    throw new Error(`Unknown element in Liuyao relative lookup: ${houseElementVi} / ${lineElementVi}`);
  }
  return RELATIVES_BY_DIFF[floorMod(lIdx - hIdx, 5)]!;
}

function toHexagramSummary(spec: LiuyaoHexagramSpec): LiuyaoHexagramSummaryIR {
  return {
    bitsIndex: spec.bitsIndex,
    code6bit: spec.code6bit,
    kingWenNumber: spec.kingWenNumber,
    nameVi: spec.nameVi,
    upperTrigram: spec.upperTrigram,
    lowerTrigram: spec.lowerTrigram,
    houseNameVi: spec.houseNameVi,
    houseElementVi: spec.houseElementVi,
    generationType: spec.generationType,
    theLine: spec.theLine,
    ungLine: spec.ungLine,
  };
}

export function deriveMaiHoaLines(
  temporal: NormalizedBirthTemporal,
): [LiuyaoLineValue, LiuyaoLineValue, LiuyaoLineValue, LiuyaoLineValue, LiuyaoLineValue, LiuyaoLineValue] {
  const yBranch = temporal.pillars.lunarYearPillar.branchIndex;
  const m = temporal.lunarActive.effectiveLunarMonth;
  const d = temporal.lunarActive.lunarDay;
  const hBranch = temporal.trueSolarTime.shichenBranch;

  const upperRem = (yBranch + 1 + m + d) % 8;
  const lowerRem = (upperRem + hBranch + 1) % 8;
  const movingLine = ((yBranch + 1 + m + d + hBranch + 1) % 6) || 6;

  const lowerBits = TIEN_THIEN_REM_TO_BITS3[lowerRem]!;
  const upperBits = TIEN_THIEN_REM_TO_BITS3[upperRem]!;
  const bits6 = lowerBits | (upperBits << 3);

  const lines: LiuyaoLineValue[] = [];
  for (let i = 0; i < 6; i++) {
    const isYang = ((bits6 >> i) & 1) === 1;
    const isMoving = i + 1 === movingLine;
    if (isMoving) {
      lines.push(isYang ? 9 : 6);
    } else {
      lines.push(isYang ? 7 : 8);
    }
  }

  return lines as [
    LiuyaoLineValue,
    LiuyaoLineValue,
    LiuyaoLineValue,
    LiuyaoLineValue,
    LiuyaoLineValue,
    LiuyaoLineValue,
  ];
}

export function castLiuyaoChart(
  temporal: NormalizedBirthTemporal,
  lineValues: readonly LiuyaoLineValue[],
  method: LiuyaoCastMethod = 'manual-lines',
): LiuyaoChartIR {
  if (lineValues.length !== 6) {
    throw new RangeError(`Liuyao requires exactly 6 line values; received ${lineValues.length}`);
  }
  for (let i = 0; i < 6; i++) {
    const v = lineValues[i];
    if (v !== 6 && v !== 7 && v !== 8 && v !== 9) {
      throw new RangeError(`Invalid Liuyao line value at line ${i + 1}: ${String(v)}`);
    }
  }

  const axiom = loadLiuyaoAxiom();

  let primaryBits = 0;
  let transformedBits = 0;
  const movingLines: number[] = [];

  for (let i = 0; i < 6; i++) {
    const v = lineValues[i]!;
    const pBit = v === 7 || v === 9 ? 1 : 0;
    const tBit = v === 7 || v === 6 ? 1 : 0;
    if (pBit === 1) primaryBits |= 1 << i;
    if (tBit === 1) transformedBits |= 1 << i;
    if (v === 6 || v === 9) {
      movingLines.push(i + 1);
    }
  }

  const primarySpec = axiom.hexagramsByBits[primaryBits]!;
  const transformedSpec = axiom.hexagramsByBits[transformedBits]!;

  const dayStem = temporal.pillars.dayPillar.stemIndex;
  const dayBranch = temporal.pillars.dayPillar.branchIndex;
  const monthBranch = temporal.pillars.baziMonthPillar.branchIndex;
  const nguyetPhaBranch = floorMod(monthBranch + 6, 12);

  const tk0 = floorMod(dayBranch + 9 - dayStem + 1, 12);
  const tk1 = floorMod(dayBranch + 9 - dayStem + 2, 12);
  const tuanKhongBranches: [number, number] = [tk0, tk1];

  const beasts = axiom.sixBeastsByDayStem[String(dayStem)]!;

  const lines: LiuyaoLineIR[] = [];
  const presentRelatives = new Set<string>();

  for (let i = 0; i < 6; i++) {
    const lineNum = i + 1;
    const rawVal = lineValues[i]!;
    const isYang = rawVal === 7 || rawVal === 9;
    const isMoving = rawVal === 6 || rawVal === 9;
    const sIdx = primarySpec.lineStems[i]!;
    const bIdx = primarySpec.lineBranches[i]!;
    const elemVi = primarySpec.lineElementsVi[i]!;
    const relVi = primarySpec.lineRelativesVi[i]!;
    presentRelatives.add(relVi);

    let tBranchIdx: number | null = null;
    let tBranchVi: string | null = null;
    let tElemVi: string | null = null;
    let tRelVi: string | null = null;

    if (isMoving) {
      tBranchIdx = transformedSpec.lineBranches[i]!;
      tBranchVi = BRANCHES_VI[tBranchIdx]!;
      tElemVi = transformedSpec.lineElementsVi[i]!;
      tRelVi = computeLiuyaoRelativeVi(primarySpec.houseElementVi, tElemVi);
    }

    lines.push({
      lineNumber: lineNum,
      rawValue: rawVal,
      isYang,
      isMoving,
      isThe: lineNum === primarySpec.theLine,
      isUng: lineNum === primarySpec.ungLine,
      stemIndex: sIdx,
      stemVi: STEMS_VI[sIdx]!,
      branchIndex: bIdx,
      branchVi: BRANCHES_VI[bIdx]!,
      elementVi: elemVi,
      relativeVi: relVi,
      beastVi: beasts[i]!,
      isTuanKhong: bIdx === tk0 || bIdx === tk1,
      isNguyetPha: bIdx === nguyetPhaBranch,
      transformedBranchIndex: tBranchIdx,
      transformedBranchVi: tBranchVi,
      transformedElementVi: tElemVi,
      transformedRelativeVi: tRelVi,
    });
  }

  // Phục Thần: look up missing Lục Thân from the 8-pure base hexagram of the same houseNameVi
  const pureBaseSpec = axiom.hexagramsByBits.find(
    (h) => h.houseNameVi === primarySpec.houseNameVi && h.upperTrigram === h.lowerTrigram,
  );
  if (!pureBaseSpec) {
    throw new Error(`Pure base hexagram not found for house '${primarySpec.houseNameVi}'`);
  }

  const phucThan: LiuyaoPhucThanIR[] = [];
  const missingRelatives = ALL_FIVE_RELATIVES.filter((r) => !presentRelatives.has(r));

  if (missingRelatives.length > 0) {
    for (let i = 0; i < 6; i++) {
      const baseRel = pureBaseSpec.lineRelativesVi[i]!;
      if (missingRelatives.includes(baseRel as (typeof ALL_FIVE_RELATIVES)[number])) {
        const pStem = pureBaseSpec.lineStems[i]!;
        const pBranch = pureBaseSpec.lineBranches[i]!;
        const pElem = pureBaseSpec.lineElementsVi[i]!;
        const phiLine = lines[i]!;
        phucThan.push({
          lineNumber: i + 1,
          missingRelativeVi: baseRel,
          stemIndex: pStem,
          branchIndex: pBranch,
          branchVi: BRANCHES_VI[pBranch]!,
          elementVi: pElem,
          phiThanBranchVi: phiLine.branchVi,
          phiThanElementVi: phiLine.elementVi,
          phiThanRelativeVi: phiLine.relativeVi,
        });
      }
    }
  }

  return {
    method,
    lineValues: [...lineValues],
    primaryHexagram: toHexagramSummary(primarySpec),
    transformedHexagram: toHexagramSummary(transformedSpec),
    hasMovingLines: movingLines.length > 0,
    movingLines,
    monthBranchIndex: monthBranch,
    nguyetPhaBranch,
    nhatThanBranch: dayBranch,
    tuanKhongBranches,
    lines,
    phucThan,
  };
}
