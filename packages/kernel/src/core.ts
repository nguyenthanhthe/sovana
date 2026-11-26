import {
  MS_PER_DAY,
  civilFromEpochDay,
  floorDivBig,
  floorModBig,
  normalizeBirthTemporal,
  type NormalizedBirthTemporal,
} from '@sovana/geo-time';
import { castBaziChart } from './bazi.js';
import { castLiuyaoChart, deriveMaiHoaLines } from './liuyao.js';
import type {
  CastDivinationInput,
  ChartIR,
  CompileChartInput,
  EmpiricalForkIR,
  ForkedStarDetailIR,
  InquiryDivinationIR,
  ZiweiChartIR,
} from './types.js';
import { castZiweiChart, compareCodePoint } from './ziwei.js';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export * from './types.js';
export { castZiweiChart, compareCodePoint, sexagenaryIndex } from './ziwei.js';
export {
  analyzeZiweiMultiLayerSihua,
  detectPalaceTuHoa,
  getLuuNguyetStemIndex,
  getLuuThoiStemIndex,
  getSihuaTupleByStem,
  resolveDongHan,
  resolveSihuaPlacements,
  type LuuNguyetOptions,
  type MultiLayerSihuaOptions,
} from './sihua.js';
export { detectDinhTapCuc, detectStructuredPatterns } from './patterns.js';
export { ELEMENTS_VI, castBaziChart, computeTenGodIndex, stemElementIndex } from './bazi.js';
export { castLiuyaoChart, computeLiuyaoRelativeVi, deriveMaiHoaLines } from './liuyao.js';

export function computeEmpiricalForks(
  temporal: NormalizedBirthTemporal,
  namPhai: ZiweiChartIR,
  toanThu: ZiweiChartIR,
): EmpiricalForkIR {
  const forkedStars: ForkedStarDetailIR[] = [];
  let brightnessDiffCount = 0;

  for (let b = 0; b < 12; b++) {
    const pNam = namPhai.palaces[b]!;
    const pToan = toanThu.palaces[b]!;

    for (let i = 0; i < pNam.majorStars.length; i++) {
      const sNam = pNam.majorStars[i]!;
      const sToan = pToan.majorStars[i]!;
      if (sNam.brightness !== sToan.brightness) {
        brightnessDiffCount++;
      }
      if (sNam.sihuaTransform !== sToan.sihuaTransform) {
        forkedStars.push({
          starName: sNam.name,
          branchIndex: b,
          palaceName: pNam.palaceName,
          namPhaiSihua: sNam.sihuaTransform,
          toanThuSihua: sToan.sihuaTransform,
        });
      }
    }

    const toanMinorByName = new Map(pToan.minorStars.map((s) => [s.name, s]));
    for (const sNam of pNam.minorStars) {
      const sToan = toanMinorByName.get(sNam.name);
      const toanSihua = sToan ? sToan.sihuaTransform : null;
      if (sNam.sihuaTransform !== toanSihua) {
        forkedStars.push({
          starName: sNam.name,
          branchIndex: b,
          palaceName: pNam.palaceName,
          namPhaiSihua: sNam.sihuaTransform,
          toanThuSihua: toanSihua,
        });
      }
    }
  }

  forkedStars.sort((a, b) => compareCodePoint(a.starName, b.starName));
  const hasSihuaFork = forkedStars.length > 0;
  const isLunarDivergentVnCn =
    temporal.lunarVn.lunarYear !== temporal.lunarCn.lunarYear ||
    temporal.lunarVn.lunarMonth !== temporal.lunarCn.lunarMonth ||
    temporal.lunarVn.lunarDay !== temporal.lunarCn.lunarDay ||
    temporal.lunarVn.isLeapMonth !== temporal.lunarCn.isLeapMonth;
  const isBoundaryAmbiguous = temporal.uncertainty.isBoundaryAmbiguous;

  return {
    hasSihuaFork,
    forkedStars,
    brightnessDiffCount,
    isLunarDivergentVnCn,
    isBoundaryAmbiguous,
    consensusMode: !hasSihuaFork && !isBoundaryAmbiguous,
  };
}

export function compileChartIR(input: CompileChartInput): ChartIR {
  const { temporal, gender, targetYear, liuyaoLines, castMaiHoa } = input;
  const ziweiNamPhai = castZiweiChart(temporal, gender, 'nam-phai', targetYear);
  const ziweiToanThu = castZiweiChart(temporal, gender, 'toan-thu', targetYear);
  const empiricalForks = computeEmpiricalForks(temporal, ziweiNamPhai, ziweiToanThu);
  const bazi = castBaziChart(temporal, gender);

  let liuyao = null;
  if (liuyaoLines !== undefined) {
    liuyao = castLiuyaoChart(temporal, liuyaoLines, 'manual-lines');
  } else if (castMaiHoa === true) {
    liuyao = castLiuyaoChart(temporal, deriveMaiHoaLines(temporal), 'mai-hoa');
  }

  return {
    schemaVersion: '1.0.0',
    gender,
    temporal,
    ziweiNamPhai,
    ziweiToanThu,
    empiricalForks,
    bazi,
    liuyao,
  };
}

export function castDivinationAtInstant(input?: CastDivinationInput): InquiryDivinationIR {
  const effectiveNowMs = Math.trunc(input?.nowMs ?? Date.now());
  const utc7Ms = BigInt(effectiveNowMs) + 25_200_000n;
  const msPerDayBig = BigInt(MS_PER_DAY);
  const epochDay = Number(floorDivBig(utc7Ms, msPerDayBig));
  const msOfDay = Number(floorModBig(utc7Ms, msPerDayBig));
  const { year, month, day } = civilFromEpochDay(epochDay);
  const totalSeconds = Math.trunc(msOfDay / 1000);
  const hour = Math.trunc(totalSeconds / 3600);
  const minute = Math.trunc((totalSeconds % 3600) / 60);
  const second = totalSeconds % 60;

  const inquiryTemporal = normalizeBirthTemporal({
    year,
    month,
    day,
    hour,
    minute,
    second,
    location: input?.location ?? 'Hà Nội',
    calendarMode: input?.calendarMode ?? 'VN_UTC7',
  });

  const method = input?.lines !== undefined ? 'manual-lines' : 'mai-hoa';
  const effectiveLines = input?.lines !== undefined ? input.lines : deriveMaiHoaLines(inquiryTemporal);
  const liuyao = castLiuyaoChart(inquiryTemporal, effectiveLines, method);

  const utc7IsoWallClock = `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
  const inquiryTimeLabelVi = `Thời khắc hiện tại: ${pad2(hour)}:${pad2(minute)} · ${pad2(day)}/${pad2(month)}/${String(year).padStart(4, '0')} (Giờ ${inquiryTemporal.trueSolarTime.shichenBranchVi} · ${inquiryTemporal.pillars.dayPillar.labelVi})`;

  return {
    nowMs: effectiveNowMs,
    utc7IsoWallClock,
    inquiryTimeLabelVi,
    inquiryTemporal,
    liuyao,
  };
}
