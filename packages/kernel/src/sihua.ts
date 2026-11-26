import { BRANCHES_VI, STEMS_VI, floorMod, type NormalizedBirthTemporal } from '@sovana/geo-time';
import { loadZiweiAxiom } from './store.js';
import type {
  GengSihuaVariant,
  SihuaTransform,
  ZiweiChartIR,
  ZiweiDongHanEntryIR,
  ZiweiDongHanIR,
  ZiweiIncomingPhiTinhEntryIR,
  ZiweiLuuNguyetSihuaIR,
  ZiweiMultiLayerSihuaIR,
  ZiweiPalaceIR,
  ZiweiPalaceTuHoaIR,
  ZiweiSihuaPlacementIR,
  ZiweiSilo,
  ZiweiTuHoaEntryIR,
} from './types.js';

const SIHUA_TRANSFORMS: readonly [SihuaTransform, SihuaTransform, SihuaTransform, SihuaTransform] = [
  'Hóa Lộc',
  'Hóa Quyền',
  'Hóa Khoa',
  'Hóa Kỵ',
];

const GENG_VARIANT_TUPLES: Readonly<
  Record<Exclude<GengSihuaVariant, 'default'>, readonly [string, string, string, string]>
> = {
  'duong-vu-am-dong': ['Thái Dương', 'Vũ Khúc', 'Thái Âm', 'Thiên Đồng'],
  'duong-vu-dong-am': ['Thái Dương', 'Vũ Khúc', 'Thiên Đồng', 'Thái Âm'],
  'duong-vu-phu-dong': ['Thái Dương', 'Vũ Khúc', 'Thiên Phủ', 'Thiên Đồng'],
  'duong-vu-phu-tuong': ['Thái Dương', 'Vũ Khúc', 'Thiên Phủ', 'Thiên Tướng'],
  'duong-vu-dong-tuong': ['Thái Dương', 'Vũ Khúc', 'Thiên Đồng', 'Thiên Tướng'],
};

// Cổ quyết Đồng Hạn: Nhất Mệnh (0), Nhị Tài (-4), Tam Tật (-5), Tứ Phu (-2), Ngũ Phúc (+2)
const DONG_HAN_MING_OFFSETS: Readonly<Record<number, number>> = {
  1: 0,
  2: -4,
  3: -5,
  4: -2,
  5: 2,
};

export interface LuuNguyetOptions {
  readonly isLeapMonth?: boolean | undefined;
  readonly lunarDay?: number | undefined;
  readonly nextYearStemIndex?: number | undefined;
}

export interface MultiLayerSihuaOptions {
  readonly gengVariant?: GengSihuaVariant | undefined;
  readonly targetYear?: number | undefined;
  readonly inquiryDayStemIndex?: number | undefined;
  readonly inquiryHourBranch?: number | undefined;
}

export function getSihuaTupleByStem(
  stemIndex: number,
  silo: ZiweiSilo,
  gengVariant: GengSihuaVariant = 'default',
): readonly [string, string, string, string] {
  const s = floorMod(Math.trunc(stemIndex), 10);
  if (s === 6 && gengVariant !== 'default') {
    return GENG_VARIANT_TUPLES[gengVariant];
  }
  const axiom = loadZiweiAxiom(silo);
  return axiom.sihuaByStem[String(s)]!;
}

export function getLuuNguyetStemIndex(
  yearStemIndex: number,
  lunarMonth: number,
  options?: LuuNguyetOptions,
): number {
  const clampedMonth = Math.max(1, Math.min(12, Math.trunc(lunarMonth)));
  let effectiveMonth = clampedMonth;
  let effectiveYearStem = floorMod(Math.trunc(yearStemIndex), 10);

  if (options?.isLeapMonth && (options.lunarDay ?? 1) > 15) {
    if (clampedMonth >= 12) {
      effectiveMonth = 1;
      effectiveYearStem =
        options.nextYearStemIndex !== undefined
          ? floorMod(Math.trunc(options.nextYearStemIndex), 10)
          : floorMod(effectiveYearStem + 1, 10);
    } else {
      effectiveMonth = clampedMonth + 1;
    }
  }

  const tigerStem = ((effectiveYearStem % 5) * 2 + 2) % 10;
  return (tigerStem + (effectiveMonth - 1)) % 10;
}

export function getLuuThoiStemIndex(dayStemIndex: number, hourBranch: number): number {
  const dStem = floorMod(Math.trunc(dayStemIndex), 10);
  const hBranch = floorMod(Math.trunc(hourBranch), 12);
  const ratStem = (dStem % 5) * 2;
  return (ratStem + hBranch) % 10;
}

function palaceHasPlacedStar(palace: ZiweiPalaceIR, starName: string): boolean {
  return (
    palace.majorStars.some((s) => s.name === starName) ||
    palace.minorStars.some((s) => s.name === starName)
  );
}

export function resolveSihuaPlacements(
  chart: ZiweiChartIR,
  stemIndex: number,
  gengVariant: GengSihuaVariant = 'default',
): ZiweiSihuaPlacementIR[] {
  const tuple = getSihuaTupleByStem(stemIndex, chart.silo, gengVariant);
  const out: ZiweiSihuaPlacementIR[] = [];
  for (let i = 0; i < 4; i++) {
    const starName = tuple[i]!;
    const transform = SIHUA_TRANSFORMS[i]!;
    const host =
      chart.palaces.find((p) => palaceHasPlacedStar(p, starName)) ?? chart.palaces[chart.menhBranch]!;
    out.push({
      transform,
      starName,
      branchIndex: host.branchIndex,
      branchVi: host.branchVi,
      palaceName: host.palaceName,
    });
  }
  return out;
}

export function resolveDongHan(
  chart: ZiweiChartIR,
  lunarBirthYear: number,
  targetYear?: number,
): ZiweiDongHanIR {
  const endAge = Math.max(0, chart.cucNumber - 1);
  if (endAge < 1) {
    return {
      hasDongHan: false,
      startAge: 1,
      endAge: 0,
      entries: [],
      isTargetYearInDongHan: false,
      activeEntry: null,
    };
  }

  const entries: ZiweiDongHanEntryIR[] = [];
  for (let age = 1; age <= endAge; age++) {
    const offset = DONG_HAN_MING_OFFSETS[age] ?? 0;
    const branch = floorMod(chart.menhBranch + offset, 12);
    const pal = chart.palaces[branch]!;
    entries.push({
      nominalAge: age,
      year: lunarBirthYear + age - 1,
      branchIndex: branch,
      branchVi: pal.branchVi,
      palaceName: pal.palaceName,
      stemIndex: pal.stemIndex,
      stemVi: pal.stemVi,
    });
  }

  const effectiveTargetYear = targetYear ?? chart.luuNien?.targetYear;
  let activeEntry: ZiweiDongHanEntryIR | null = null;
  if (effectiveTargetYear !== undefined) {
    const nominalAge = Math.trunc(effectiveTargetYear) - lunarBirthYear + 1;
    activeEntry = entries.find((e) => e.nominalAge === nominalAge) ?? null;
  }

  return {
    hasDongHan: entries.length > 0,
    startAge: 1,
    endAge,
    entries,
    isTargetYearInDongHan: activeEntry !== null,
    activeEntry,
  };
}

export function detectPalaceTuHoa(
  chart: ZiweiChartIR,
  branchIndex: number,
  gengVariant: GengSihuaVariant = 'default',
): ZiweiPalaceTuHoaIR {
  const b = floorMod(Math.trunc(branchIndex), 12);
  const palace = chart.palaces[b]!;
  const oppPalace = chart.palaces[(b + 6) % 12]!;
  const tuple = getSihuaTupleByStem(palace.stemIndex, chart.silo, gengVariant);

  const selfTransforms: ZiweiTuHoaEntryIR[] = [];
  const oppositeOutwardTransforms: ZiweiTuHoaEntryIR[] = [];

  for (let i = 0; i < 4; i++) {
    const starName = tuple[i]!;
    const transform = SIHUA_TRANSFORMS[i]!;
    if (palaceHasPlacedStar(palace, starName)) {
      selfTransforms.push({
        transform,
        starName,
        kind: 'TU_HOA_BAN_CUNG',
        targetBranchIndex: palace.branchIndex,
        targetBranchVi: palace.branchVi,
        targetPalaceName: palace.palaceName,
      });
    } else if (palaceHasPlacedStar(oppPalace, starName)) {
      oppositeOutwardTransforms.push({
        transform,
        starName,
        kind: 'HOA_XUAT_DOI_CUNG',
        targetBranchIndex: oppPalace.branchIndex,
        targetBranchVi: oppPalace.branchVi,
        targetPalaceName: oppPalace.palaceName,
      });
    }
  }

  return {
    branchIndex: palace.branchIndex,
    branchVi: palace.branchVi,
    stemIndex: palace.stemIndex,
    stemVi: palace.stemVi,
    palaceName: palace.palaceName,
    selfTransforms,
    oppositeOutwardTransforms,
  };
}

export function analyzeZiweiMultiLayerSihua(
  chart: ZiweiChartIR,
  temporal: NormalizedBirthTemporal,
  options?: MultiLayerSihuaOptions,
): ZiweiMultiLayerSihuaIR {
  const gengVariant: GengSihuaVariant = options?.gengVariant ?? 'default';
  const yStem = temporal.pillars.lunarYearPillar.stemIndex;
  const lunarBirthYear = temporal.lunarActive.lunarYear;
  const effectiveTargetYear = options?.targetYear ?? chart.luuNien?.targetYear;

  // Lai Nhân Cung: ưu tiên cung từ Dần..Hợi (branch >= 2) khi Can trùng ở Tý/Dần hoặc Sửu/Mão
  const matchingBranches = chart.palaces
    .filter((p) => p.stemIndex === yStem)
    .map((p) => p.branchIndex);
  const primaryLaiNhanBranch =
    matchingBranches.find((b) => b >= 2) ?? matchingBranches[0] ?? chart.menhBranch;
  const primaryLaiNhanPalace = chart.palaces[primaryLaiNhanBranch]!;

  const dongHan = resolveDongHan(chart, lunarBirthYear, effectiveTargetYear);
  const banMenhSihua = resolveSihuaPlacements(chart, yStem, gengVariant);

  let daiHanSihua: ZiweiMultiLayerSihuaIR['daiHanSihua'] = null;
  if (effectiveTargetYear !== undefined) {
    const nominalAge = Math.trunc(effectiveTargetYear) - lunarBirthYear + 1;
    if (dongHan.activeEntry) {
      const dhEntry = dongHan.activeEntry;
      daiHanSihua = {
        sourceKind: 'DONG_HAN',
        palaceBranchIndex: dhEntry.branchIndex,
        palaceBranchVi: dhEntry.branchVi,
        palaceName: dhEntry.palaceName,
        stemIndex: dhEntry.stemIndex,
        stemVi: dhEntry.stemVi,
        startAge: dhEntry.nominalAge,
        endAge: dhEntry.nominalAge,
        transforms: resolveSihuaPlacements(chart, dhEntry.stemIndex, gengVariant),
      };
    } else {
      const dxPalace =
        chart.palaces.find(
          (p) => nominalAge >= p.daiHanStartAge && nominalAge <= p.daiHanEndAge,
        ) ??
        (chart.luuNien?.activeDaiHanPalaceBranch !== null &&
        chart.luuNien?.activeDaiHanPalaceBranch !== undefined
          ? chart.palaces[chart.luuNien.activeDaiHanPalaceBranch]
          : undefined);
      if (dxPalace) {
        daiHanSihua = {
          sourceKind: 'DAI_HAN',
          palaceBranchIndex: dxPalace.branchIndex,
          palaceBranchVi: dxPalace.branchVi,
          palaceName: dxPalace.palaceName,
          stemIndex: dxPalace.stemIndex,
          stemVi: dxPalace.stemVi,
          startAge: dxPalace.daiHanStartAge,
          endAge: dxPalace.daiHanEndAge,
          transforms: resolveSihuaPlacements(chart, dxPalace.stemIndex, gengVariant),
        };
      }
    }
  }

  let luuNienSihua: ZiweiSihuaPlacementIR[] = [];
  let luuNguyetSihua: ZiweiLuuNguyetSihuaIR[] = [];
  if (effectiveTargetYear !== undefined) {
    const tyStem = floorMod(Math.trunc(effectiveTargetYear) - 4, 10);
    luuNienSihua = resolveSihuaPlacements(chart, tyStem, gengVariant);

    const nguyetEntries = chart.luuNien?.nguyetHan ?? [];
    for (let m = 1; m <= 12; m++) {
      const mStem = getLuuNguyetStemIndex(tyStem, m);
      const nh = nguyetEntries.find((e) => e.lunarMonth === m);
      const bIdx = nh ? nh.branchIndex : floorMod(chart.menhBranch + (m - 1), 12);
      const pal = chart.palaces[bIdx]!;
      luuNguyetSihua.push({
        lunarMonth: m,
        stemIndex: mStem,
        stemVi: STEMS_VI[mStem]!,
        nguyetHanBranchIndex: bIdx,
        nguyetHanBranchVi: pal.branchVi,
        nguyetHanPalaceName: pal.palaceName,
        transforms: resolveSihuaPlacements(chart, mStem, gengVariant),
      });
    }
  }

  let luuNhatSihua: ZiweiMultiLayerSihuaIR['luuNhatSihua'] = null;
  let luuThoiSihua: ZiweiMultiLayerSihuaIR['luuThoiSihua'] = null;
  if (options?.inquiryDayStemIndex !== undefined) {
    const dStem = floorMod(Math.trunc(options.inquiryDayStemIndex), 10);
    luuNhatSihua = {
      stemIndex: dStem,
      stemVi: STEMS_VI[dStem]!,
      transforms: resolveSihuaPlacements(chart, dStem, gengVariant),
    };
    if (options.inquiryHourBranch !== undefined) {
      const hBranch = floorMod(Math.trunc(options.inquiryHourBranch), 12);
      const hStem = getLuuThoiStemIndex(dStem, hBranch);
      luuThoiSihua = {
        stemIndex: hStem,
        stemVi: STEMS_VI[hStem]!,
        hourBranch: hBranch,
        hourBranchVi: BRANCHES_VI[hBranch]!,
        transforms: resolveSihuaPlacements(chart, hStem, gengVariant),
      };
    }
  }

  const tuHoaByBranch: ZiweiPalaceTuHoaIR[] = [];
  const incomingPhiTinhByBranch: ZiweiIncomingPhiTinhEntryIR[][] = Array.from(
    { length: 12 },
    () => [],
  );

  for (let b = 0; b < 12; b++) {
    tuHoaByBranch.push(detectPalaceTuHoa(chart, b, gengVariant));
  }

  for (let srcBranch = 0; srcBranch < 12; srcBranch++) {
    const srcPalace = chart.palaces[srcBranch]!;
    const placements = resolveSihuaPlacements(chart, srcPalace.stemIndex, gengVariant);
    for (const pl of placements) {
      if (pl.branchIndex !== srcBranch) {
        incomingPhiTinhByBranch[pl.branchIndex]!.push({
          fromBranchIndex: srcBranch,
          fromBranchVi: srcPalace.branchVi,
          fromStemIndex: srcPalace.stemIndex,
          fromStemVi: srcPalace.stemVi,
          fromPalaceName: srcPalace.palaceName,
          transform: pl.transform,
          starName: pl.starName,
          relation: 'NHAP_CUNG',
        });
      }
      const oppTarget = (pl.branchIndex + 6) % 12;
      if (oppTarget !== srcBranch) {
        incomingPhiTinhByBranch[oppTarget]!.push({
          fromBranchIndex: srcBranch,
          fromBranchVi: srcPalace.branchVi,
          fromStemIndex: srcPalace.stemIndex,
          fromStemVi: srcPalace.stemVi,
          fromPalaceName: srcPalace.palaceName,
          transform: pl.transform,
          starName: pl.starName,
          relation: 'XUNG_CHIEU',
        });
      }
    }
  }

  return {
    silo: chart.silo,
    gengVariant,
    laiNhanCung: {
      stemIndex: yStem,
      stemVi: STEMS_VI[yStem]!,
      primaryBranchIndex: primaryLaiNhanBranch,
      primaryBranchVi: primaryLaiNhanPalace.branchVi,
      primaryPalaceName: primaryLaiNhanPalace.palaceName,
      allMatchingBranches: matchingBranches,
    },
    dongHan,
    banMenhSihua,
    daiHanSihua,
    luuNienSihua,
    luuNguyetSihua,
    luuNhatSihua,
    luuThoiSihua,
    tuHoaByBranch,
    incomingPhiTinhByBranch,
  };
}
