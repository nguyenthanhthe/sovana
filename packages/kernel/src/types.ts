import type {
  CalendarMode,
  LocationQuery,
  NormalizedBirthTemporal,
  PillarPair,
} from '@sovana/geo-time';

export type Gender = 'male' | 'female';
export type ZiweiSilo = 'nam-phai' | 'toan-thu';
export type SihuaTransform = 'Hóa Lộc' | 'Hóa Quyền' | 'Hóa Khoa' | 'Hóa Kỵ';
export type ZiweiStarCategory = 'major' | 'auxiliary' | 'sha' | 'ring';
export type BaziStrengthClass = 'THAN_VUONG' | 'THAN_NHUOC' | 'CAN_BANG';
export type LiuyaoLineValue = 6 | 7 | 8 | 9;
export type LiuyaoCastMethod = 'manual-lines' | 'mai-hoa';

export interface ZiweiAxiomSpec {
  siloId: ZiweiSilo;
  nameVi: string;
  palaceOrderCounterClockwise: string[];
  sihuaByStem: Record<string, [string, string, string, string]>;
  brightnessLevels: string[];
  majorStarBrightnessByBranch: Record<string, string[]>;
  minorStarBrightnessByBranch: Record<string, (string | null)[]>;
  thaiTueRing: string[];
  trangSinhStages: string[];
  trangSinhStartByCuc: Record<string, number>;
  bacSyRing: string[];
  locTonByStem: number[];
  thienKhoiVietByStem: [number, number][];
  menhChuByBranch: string[];
  thanChuByBranch: string[];
  trietByStemPair: Record<string, [number, number]>;
}

export interface NapAmEntrySpec {
  index: number;
  canChiVi: string;
  napAmVi: string;
  elementVi: string;
  cucNumber: 2 | 3 | 4 | 5 | 6;
}

export interface HiddenStemSpec {
  stemIndex: number;
  weightBps: number;
}

export interface DieuHauEntrySpec {
  primaryGodStemIndices: number[];
  summaryVi: string;
}

export interface BaziAxiomSpec {
  hiddenStemsByBranch: Record<string, HiddenStemSpec[]>;
  tenGodsNamesVi: string[];
  napAm60: NapAmEntrySpec[];
  seasonalMultiplierBps: Record<string, number[]>;
  cungThongBaoGiamDieuHau: Record<string, Record<string, DieuHauEntrySpec>>;
}

export interface LiuyaoHexagramSpec {
  bitsIndex: number;
  code6bit: string;
  kingWenNumber: number;
  nameVi: string;
  upperTrigram: string;
  lowerTrigram: string;
  houseNameVi: string;
  houseElementVi: string;
  generationType: string;
  theLine: number;
  ungLine: number;
  lineBranches: number[];
  lineStems: number[];
  lineElementsVi: string[];
  lineRelativesVi: string[];
}

export interface LiuyaoAxiomSpec {
  hexagramsByBits: LiuyaoHexagramSpec[];
  sixBeastsByDayStem: Record<string, string[]>;
}

export interface ZiweiStarIR {
  name: string;
  category: ZiweiStarCategory;
  brightness: string | null;
  sihuaTransform: SihuaTransform | null;
}

export interface ZiweiPalaceIR {
  branchIndex: number;
  branchVi: string;
  stemIndex: number;
  stemVi: string;
  palaceName: string;
  isMenh: boolean;
  isThan: boolean;
  tuanTrung: boolean;
  trietLo: boolean;
  daiHanStartAge: number;
  daiHanEndAge: number;
  tieuHanBranchIndex: number;
  tieuHanBranchVi: string;
  thaiTueStar: string;
  trangSinhStar: string;
  bacSyStar: string;
  majorStars: ZiweiStarIR[];
  minorStars: ZiweiStarIR[];
  voChinhDieu: boolean;
  borrowedMajorStars: ZiweiStarIR[];
  tamKhongTypes: string[];
  tuLinhPresent: string[];
}

export interface ZiweiLuuNienSihuaIR {
  transform: SihuaTransform;
  starName: string;
  branchIndex: number;
  palaceName: string;
}

export interface ZiweiNguyetHanEntryIR {
  lunarMonth: number;
  branchIndex: number;
  branchVi: string;
  palaceName: string;
}

export interface ZiweiThaiTueTuLinhIR {
  menhInThaiTueTamHop: boolean;
  thanInThaiTueTamHop: boolean;
  menhTamHopTuLinhStars: string[];
  menhTamPhuongTuLinhStars: string[];
  hasFullTuLinhInMenhTamHop: boolean;
  hasFullTuLinhInMenhTamPhuong: boolean;
  isThaiTueTuLinhWay: boolean;
}

export interface ZiweiLuuNienIR {
  targetYear: number;
  yearStemIndex: number;
  yearBranchIndex: number;
  yearCanChiVi: string;
  nominalAge: number;
  luuNienPalaceBranch: number;
  tieuHanPalaceBranch: number;
  activeDaiHanPalaceBranch: number | null;
  luuDongTinhByBranch: string[][];
  luuNienSihua: ZiweiLuuNienSihuaIR[];
  nguyetHan: ZiweiNguyetHanEntryIR[];
}

export interface ZiweiChartIR {
  silo: ZiweiSilo;
  siloNameVi: string;
  gender: Gender;
  yinYangLabelVi: string;
  direction: 1 | -1;
  menhBranch: number;
  thanBranch: number;
  menhChuStar: string;
  thanChuStar: string;
  cucNumber: 2 | 3 | 4 | 5 | 6;
  cucNameVi: string;
  banMenhNapAmVi: string;
  tuViBranch: number;
  thienPhuBranch: number;
  tuanTrungBranches: [number, number];
  trietLoBranches: [number, number];
  palaces: ZiweiPalaceIR[];
  thaiTueTamHopTuLinh: ZiweiThaiTueTuLinhIR;
  luuNien: ZiweiLuuNienIR | null;
}

export interface ForkedStarDetailIR {
  starName: string;
  branchIndex: number;
  palaceName: string;
  namPhaiSihua: SihuaTransform | null;
  toanThuSihua: SihuaTransform | null;
}

export interface EmpiricalForkIR {
  hasSihuaFork: boolean;
  forkedStars: ForkedStarDetailIR[];
  brightnessDiffCount: number;
  isLunarDivergentVnCn: boolean;
  isBoundaryAmbiguous: boolean;
  consensusMode: boolean;
}

export interface BaziHiddenStemIR {
  stemIndex: number;
  stemVi: string;
  elementVi: string;
  weightBps: number;
  tenGod: string;
}

export interface BaziPillarDetailIR {
  position: 'year' | 'month' | 'day' | 'hour';
  pillar: PillarPair;
  stemElementVi: string;
  branchElementVi: string;
  stemTenGod: string;
  hiddenStems: BaziHiddenStemIR[];
  napAmVi: string;
  napAmElementVi: string;
  tuanKhongBranches: [number, number];
  tuanKhongVi: [string, string];
}

export interface BaziDaiVanIR {
  index: number;
  pillar: PillarPair;
  startAge: number;
  endAge: number;
  stemTenGod: string;
  napAmVi: string;
}

export interface BaziDieuHauIR {
  primaryGodStemIndices: number[];
  primaryGodStemsVi: string[];
  summaryVi: string;
}

export interface BaziChartIR {
  gender: Gender;
  direction: 1 | -1;
  dayMasterStemIndex: number;
  dayMasterStemVi: string;
  dayMasterElementVi: string;
  yearPillar: BaziPillarDetailIR;
  monthPillar: BaziPillarDetailIR;
  dayPillar: BaziPillarDetailIR;
  hourPillar: BaziPillarDetailIR;
  dayMasterScoreBps: number;
  strengthClass: BaziStrengthClass;
  elementScoresBps: Record<string, number>;
  secondsToTargetJie: number;
  daiVanStartAgeMonths: number;
  daiVanStartAgeYears: number;
  daiVan: BaziDaiVanIR[];
  dieuHau: BaziDieuHauIR;
  climateAuditNote: string;
}

export interface LiuyaoHexagramSummaryIR {
  bitsIndex: number;
  code6bit: string;
  kingWenNumber: number;
  nameVi: string;
  upperTrigram: string;
  lowerTrigram: string;
  houseNameVi: string;
  houseElementVi: string;
  generationType: string;
  theLine: number;
  ungLine: number;
}

export interface LiuyaoLineIR {
  lineNumber: number;
  rawValue: LiuyaoLineValue;
  isYang: boolean;
  isMoving: boolean;
  isThe: boolean;
  isUng: boolean;
  stemIndex: number;
  stemVi: string;
  branchIndex: number;
  branchVi: string;
  elementVi: string;
  relativeVi: string;
  beastVi: string;
  isTuanKhong: boolean;
  isNguyetPha: boolean;
  transformedBranchIndex: number | null;
  transformedBranchVi: string | null;
  transformedElementVi: string | null;
  transformedRelativeVi: string | null;
}

export interface LiuyaoPhucThanIR {
  lineNumber: number;
  missingRelativeVi: string;
  stemIndex: number;
  branchIndex: number;
  branchVi: string;
  elementVi: string;
  phiThanBranchVi: string;
  phiThanElementVi: string;
  phiThanRelativeVi: string;
}

export interface LiuyaoChartIR {
  method: LiuyaoCastMethod;
  lineValues: number[];
  primaryHexagram: LiuyaoHexagramSummaryIR;
  transformedHexagram: LiuyaoHexagramSummaryIR;
  hasMovingLines: boolean;
  movingLines: number[];
  monthBranchIndex: number;
  nguyetPhaBranch: number;
  nhatThanBranch: number;
  tuanKhongBranches: [number, number];
  lines: LiuyaoLineIR[];
  phucThan: LiuyaoPhucThanIR[];
}

export interface CompileChartInput {
  temporal: NormalizedBirthTemporal;
  gender: Gender;
  targetYear?: number | undefined;
  liuyaoLines?: readonly LiuyaoLineValue[] | undefined;
  castMaiHoa?: boolean | undefined;
}

export interface ChartIR {
  schemaVersion: string;
  gender: Gender;
  temporal: NormalizedBirthTemporal;
  ziweiNamPhai: ZiweiChartIR;
  ziweiToanThu: ZiweiChartIR;
  empiricalForks: EmpiricalForkIR;
  bazi: BaziChartIR;
  liuyao: LiuyaoChartIR | null;
}

export interface CastDivinationInput {
  nowMs?: number | undefined;
  location?: LocationQuery | undefined;
  calendarMode?: CalendarMode | undefined;
  lines?: readonly LiuyaoLineValue[] | undefined;
}

export interface InquiryDivinationIR {
  nowMs: number;
  utc7IsoWallClock: string;
  inquiryTimeLabelVi: string;
  inquiryTemporal: NormalizedBirthTemporal;
  liuyao: LiuyaoChartIR;
}
