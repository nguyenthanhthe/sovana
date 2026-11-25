import {
  BRANCHES_VI,
  STEMS_VI,
  floorDivBig,
  floorMod,
  loadEphemeris,
  type NormalizedBirthTemporal,
  type PillarPair,
} from '@sovana/geo-time';
import { loadBaziAxiom } from './store.js';
import type {
  BaziChartIR,
  BaziDaiVanIR,
  BaziHiddenStemIR,
  BaziPillarDetailIR,
  BaziStrengthClass,
  Gender,
} from './types.js';
import { sexagenaryIndex } from './ziwei.js';

export const ELEMENTS_VI = ['Mộc', 'Hỏa', 'Thổ', 'Kim', 'Thủy'] as const;

const BRANCH_ELEMENTS_VI = [
  'Thủy',
  'Thổ',
  'Mộc',
  'Mộc',
  'Thổ',
  'Hỏa',
  'Hỏa',
  'Thổ',
  'Kim',
  'Kim',
  'Thổ',
  'Thủy',
] as const;

const CLIMATE_AUDIT_NOTES: Record<string, string> = {
  Cwa: 'Köppen Cwa (Cận nhiệt đới ẩm mùa đông khô lạnh): Có mùa đông lạnh rõ rệt tương đồng lưu vực Hoa Nam/Giang Nam; áp dụng trực tiếp Điều Hầu Cùng Thông Bảo Giám (0% chỉnh số Ngũ Hành).',
  Cwb: 'Köppen Cwb (Cao nguyên cận nhiệt đới ôn hòa): Nền nhiệt mát quanh năm và biên độ ngày đêm lớn; đối chiếu song song Điều Hầu cổ điển với thực địa cao nguyên (0% chỉnh số Ngũ Hành).',
  Am: 'Köppen Am (Nhiệt đới gió mùa ẩm): Mùa thu–đông mưa ẩm thay vì băng tuyết cực đoan; đối chiếu song song Điều Hầu cổ điển với độ ẩm thực địa (0% chỉnh số Ngũ Hành).',
  Aw: 'Köppen Aw (Nhiệt đới xavan hai mùa mưa–khô): Nền nhiệt cao quanh năm không có sương tuyết mùa đông; giữ nguyên cấu trúc Tứ Trụ và ghi nhận độ lệch vĩ độ khi đọc Điều Hầu mùa Đông (0% chỉnh số Ngũ Hành).',
};

const DEFAULT_CLIMATE_AUDIT_NOTE =
  'Đối chiếu song song Điều Hầu Dụng Thần cổ điển với vùng khí hậu thực địa theo tọa độ vĩ độ nơi sinh (0% chỉnh số Ngũ Hành).';

export function stemElementIndex(stemIndex: number): number {
  return Math.floor(stemIndex / 2);
}

export function computeTenGodIndex(dayMasterStem: number, targetStem: number): number {
  const dmElem = stemElementIndex(dayMasterStem);
  const tElem = stemElementIndex(targetStem);
  const rel = floorMod(tElem - dmElem, 5);
  const polarityOffset = dayMasterStem % 2 === targetStem % 2 ? 0 : 1;
  return rel * 2 + polarityOffset;
}

function makePillarPair(stemIndex: number, branchIndex: number): PillarPair {
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

function computeSecondsToTargetJie(temporal: NormalizedBirthTemporal, direction: 1 | -1): number {
  const eph = loadEphemeris();
  const instantMs = temporal.trueSolarTime.instantUnixMs;
  const curIdx = temporal.solarTerm.index;

  // In @sovana/geo-time SOLAR_TERMS_VI:
  // Even termIndex (0=Xuân Phân, 2=Cốc Vũ, ..., 18=Đông Chí, 20=Đại Hàn, 22=Vũ Thủy) = Trung Khí (isMajorTerm: true)
  // Odd termIndex (1=Thanh Minh, 3=Lập Hạ, ..., 19=Tiểu Hàn, 21=Lập Xuân, 23=Kinh Trập) = Tiết / Jie (isMajorTerm: false)
  if (direction === 1) {
    let k = curIdx + 1;
    while (k < eph.solarTerms.length) {
      if ((eph.firstSolarTermIndex + k) % 2 === 1) {
        const diff = BigInt(eph.solarTerms[k]!) - BigInt(instantMs);
        return Math.max(0, Number(floorDivBig(diff, 1000n)));
      }
      k++;
    }
    throw new RangeError(`Next Jie solar term out of ephemeris bounds for ${instantMs}`);
  }

  let k = curIdx;
  while (k >= 0) {
    if ((eph.firstSolarTermIndex + k) % 2 === 1) {
      const diff = BigInt(instantMs) - BigInt(eph.solarTerms[k]!);
      return Math.max(0, Number(floorDivBig(diff, 1000n)));
    }
    k--;
  }
  throw new RangeError(`Previous Jie solar term out of ephemeris bounds for ${instantMs}`);
}

export function castBaziChart(temporal: NormalizedBirthTemporal, gender: Gender): BaziChartIR {
  if (gender !== 'male' && gender !== 'female') {
    throw new RangeError(`Invalid gender: ${String(gender)}`);
  }

  const axiom = loadBaziAxiom();
  const dmStem = temporal.pillars.dayPillar.stemIndex;
  const dmElemIdx = stemElementIndex(dmStem);
  const dmElemVi = ELEMENTS_VI[dmElemIdx]!;
  const monthBranch = temporal.pillars.baziMonthPillar.branchIndex;

  const isYangYear = temporal.pillars.baziYearPillar.stemIndex % 2 === 0;
  const direction: 1 | -1 = isYangYear === (gender === 'male') ? 1 : -1;

  const tenGodName = (targetStem: number): string =>
    axiom.tenGodsNamesVi[computeTenGodIndex(dmStem, targetStem)]!;

  const buildPillarDetail = (
    position: 'year' | 'month' | 'day' | 'hour',
    pillar: PillarPair,
  ): BaziPillarDetailIR => {
    const s = pillar.stemIndex;
    const b = pillar.branchIndex;
    const stemElem = ELEMENTS_VI[stemElementIndex(s)]!;
    const branchElem = BRANCH_ELEMENTS_VI[b]!;
    const stemTenGod = position === 'day' ? 'Nhật Chủ' : tenGodName(s);

    const rawHidden = axiom.hiddenStemsByBranch[String(b)]!;
    const hiddenStems: BaziHiddenStemIR[] = rawHidden.map((hs) => ({
      stemIndex: hs.stemIndex,
      stemVi: STEMS_VI[hs.stemIndex]!,
      elementVi: ELEMENTS_VI[stemElementIndex(hs.stemIndex)]!,
      weightBps: hs.weightBps,
      tenGod: tenGodName(hs.stemIndex),
    }));

    const napAmEntry = axiom.napAm60[sexagenaryIndex(s, b)]!;
    const tk0 = floorMod(b + 9 - s + 1, 12);
    const tk1 = floorMod(b + 9 - s + 2, 12);

    return {
      position,
      pillar,
      stemElementVi: stemElem,
      branchElementVi: branchElem,
      stemTenGod,
      hiddenStems,
      napAmVi: napAmEntry.napAmVi,
      napAmElementVi: napAmEntry.elementVi,
      tuanKhongBranches: [tk0, tk1],
      tuanKhongVi: [BRANCHES_VI[tk0]!, BRANCHES_VI[tk1]!],
    };
  };

  const yearPillar = buildPillarDetail('year', temporal.pillars.baziYearPillar);
  const monthPillar = buildPillarDetail('month', temporal.pillars.baziMonthPillar);
  const dayPillar = buildPillarDetail('day', temporal.pillars.dayPillar);
  const hourPillar = buildPillarDetail('hour', temporal.pillars.hourPillar);

  const fourPillars = [yearPillar, monthPillar, dayPillar, hourPillar];

  // Exact integer micro-basis-points scoring:
  // Each heavenly stem = 1000 bps * 1000 = 1_000_000 raw units
  // Each hidden stem = weightBps * seasonalMultiplierBps[elementVi][monthBranch] raw units
  const elemRaw = [0, 0, 0, 0, 0];
  for (const p of fourPillars) {
    const sElemIdx = stemElementIndex(p.pillar.stemIndex);
    elemRaw[sElemIdx] = elemRaw[sElemIdx]! + 1_000_000;
    for (const hs of p.hiddenStems) {
      const hElemIdx = stemElementIndex(hs.stemIndex);
      const hElemVi = ELEMENTS_VI[hElemIdx]!;
      const seasonalMult = axiom.seasonalMultiplierBps[hElemVi]![monthBranch]!;
      elemRaw[hElemIdx] = elemRaw[hElemIdx]! + hs.weightBps * seasonalMult;
    }
  }

  const totalRaw = elemRaw.reduce((acc, v) => acc + v, 0);
  const resourceElemIdx = floorMod(dmElemIdx - 1, 5);
  const supportRaw = elemRaw[dmElemIdx]! + elemRaw[resourceElemIdx]!;
  const dayMasterScoreBps = Math.round((supportRaw * 10_000) / totalRaw);

  const strengthClass: BaziStrengthClass =
    dayMasterScoreBps >= 5200
      ? 'THAN_VUONG'
      : dayMasterScoreBps <= 4400
        ? 'THAN_NHUOC'
        : 'CAN_BANG';

  const elementScoresBps: Record<string, number> = {};
  for (let i = 0; i < ELEMENTS_VI.length; i++) {
    elementScoresBps[ELEMENTS_VI[i]!] = Math.round((elemRaw[i]! * 10_000) / totalRaw);
  }

  const secondsToTargetJie = computeSecondsToTargetJie(temporal, direction);
  const daiVanStartAgeMonths = Math.floor(secondsToTargetJie / 21_600);
  const daiVanStartAgeYears = Math.round(secondsToTargetJie / 259_200);

  const daiVan: BaziDaiVanIR[] = [];
  for (let k = 1; k <= 8; k++) {
    const dvPillar = makePillarPair(
      temporal.pillars.baziMonthPillar.stemIndex + direction * k,
      temporal.pillars.baziMonthPillar.branchIndex + direction * k,
    );
    const startAge = daiVanStartAgeYears + (k - 1) * 10;
    const napAm = axiom.napAm60[sexagenaryIndex(dvPillar.stemIndex, dvPillar.branchIndex)]!;
    daiVan.push({
      index: k,
      pillar: dvPillar,
      startAge,
      endAge: startAge + 9,
      stemTenGod: tenGodName(dvPillar.stemIndex),
      napAmVi: napAm.napAmVi,
    });
  }

  const rawDieuHau = axiom.cungThongBaoGiamDieuHau[String(dmStem)]![String(monthBranch)]!;
  const dieuHau = {
    primaryGodStemIndices: [...rawDieuHau.primaryGodStemIndices],
    primaryGodStemsVi: rawDieuHau.primaryGodStemIndices.map((idx) => STEMS_VI[idx]!),
    summaryVi: rawDieuHau.summaryVi,
  };

  const koppen = temporal.location.koppenZone;
  const climateAuditNote =
    (koppen ? CLIMATE_AUDIT_NOTES[koppen] : undefined) ?? DEFAULT_CLIMATE_AUDIT_NOTE;

  return {
    gender,
    direction,
    dayMasterStemIndex: dmStem,
    dayMasterStemVi: STEMS_VI[dmStem]!,
    dayMasterElementVi: dmElemVi,
    yearPillar,
    monthPillar,
    dayPillar,
    hourPillar,
    dayMasterScoreBps,
    strengthClass,
    elementScoresBps,
    secondsToTargetJie,
    daiVanStartAgeMonths,
    daiVanStartAgeYears,
    daiVan,
    dieuHau,
    climateAuditNote,
  };
}
