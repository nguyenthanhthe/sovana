import type { PillarPair } from '@sovana/geo-time';
import type { BaziChartIR, BaziStrengthClass, ChartIR, ZiweiSilo } from '@sovana/kernel';

export type RuleSilo = 'nam-phai' | 'toan-thu' | 'bazi' | 'liuyao' | 'cross';
export type RulePolarity = 'CAT' | 'HUNG' | 'TRUNG';
export type ConflictKind = 'CROSS_SILO' | 'INTRA_SILO_PARACONSISTENT';

export type LiuyaoTheUngRelation =
  | 'UNG_SINH_THE'
  | 'THE_SINH_UNG'
  | 'UNG_KHAC_THE'
  | 'THE_KHAC_UNG'
  | 'TY_HOA';

export type LiuyaoStateFlag =
  | 'theTuanKhong'
  | 'theNguyetPha'
  | 'ungTuanKhong'
  | 'ungNguyetPha'
  | 'theDong'
  | 'ungDong'
  | 'hoaTienThan'
  | 'hoaThoaiThan'
  | 'hoaHoiDauSinh'
  | 'hoaHoiDauKhac'
  | 'theVuongTuong'
  | 'theHuuTu'
  | 'hasPhucThan'
  | 'phiSinhPhuc'
  | 'phiKhacPhuc'
  | 'phiLamKhongPha'
  | 'theAmDong';

export type ZiweiRelativePalaceRelation = 'opposite' | 'prev' | 'next' | 'nhi_hop';

export type ConditionAST =
  | {
      readonly op: 'star_in_palace';
      readonly star: string;
      readonly palace: string;
      readonly silo?: ZiweiSilo | undefined;
    }
  | {
      readonly op: 'star_in_tam_phuong';
      readonly star: string;
      readonly palace: string;
      readonly silo?: ZiweiSilo | undefined;
    }
  | {
      readonly op: 'star_brightness_in';
      readonly star: string;
      readonly palace?: string | undefined;
      readonly levels: readonly string[];
      readonly silo?: ZiweiSilo | undefined;
    }
  | {
      readonly op: 'sihua_in_palace';
      readonly transform: string;
      readonly palace: string;
      readonly silo?: ZiweiSilo | undefined;
    }
  | {
      readonly op: 'palace_has_flag';
      readonly palace: string;
      readonly flag: 'tuanTrung' | 'trietLo';
      readonly silo?: ZiweiSilo | undefined;
    }
  | {
      readonly op: 'palace_branch_in';
      readonly palace: string;
      readonly branches: readonly number[];
      readonly silo?: ZiweiSilo | undefined;
    }
  | {
      readonly op: 'star_in_relative_palace';
      readonly star: string;
      readonly palace: string;
      readonly relation: ZiweiRelativePalaceRelation;
      readonly silo?: ZiweiSilo | undefined;
    }
  | {
      readonly op: 'palace_major_count';
      readonly palace: string;
      readonly min?: number | undefined;
      readonly max?: number | undefined;
      readonly exact?: number | undefined;
      readonly silo?: ZiweiSilo | undefined;
    }
  | {
      readonly op: 'palace_star_count_in';
      readonly palace: string;
      readonly stars: readonly string[];
      readonly min: number;
      readonly max?: number | undefined;
      readonly silo?: ZiweiSilo | undefined;
    }
  | {
      readonly op: 'star_co_located';
      readonly stars: readonly string[];
      readonly palace?: string | undefined;
      readonly silo?: ZiweiSilo | undefined;
    }
  | {
      readonly op: 'vo_chinh_dieu';
      readonly palace: string;
      readonly value: boolean;
      readonly silo?: ZiweiSilo | undefined;
    }
  | {
      readonly op: 'tam_khong_in_tam_phuong';
      readonly palace: string;
      readonly minCount: number;
      readonly silo?: ZiweiSilo | undefined;
    }
  | {
      readonly op: 'thai_tue_tu_linh';
      readonly scope: 'tam_hop' | 'tam_phuong';
      readonly silo?: ZiweiSilo | undefined;
    }
  | {
      readonly op: 'year_stem_in';
      readonly stems: readonly number[];
    }
  | {
      readonly op: 'bazi_strength_is';
      readonly value: BaziStrengthClass;
    }
  | {
      readonly op: 'day_stem_in';
      readonly stems: readonly number[];
    }
  | {
      readonly op: 'month_branch_in';
      readonly branches: readonly number[];
    }
  | {
      readonly op: 'bazi_has_ten_god';
      readonly tenGod: string;
    }
  | {
      readonly op: 'liuyao_has_moving';
      readonly value: boolean;
    }
  | {
      readonly op: 'liuyao_the_ung_relation';
      readonly relation: LiuyaoTheUngRelation;
    }
  | {
      readonly op: 'liuyao_state_flag';
      readonly flag: LiuyaoStateFlag;
    }
  | {
      readonly op: 'derived_node';
      readonly nodeId: string;
    }
  | {
      readonly op: 'and';
      readonly args: readonly ConditionAST[];
    }
  | {
      readonly op: 'or';
      readonly args: readonly ConditionAST[];
    }
  | {
      readonly op: 'not';
      readonly arg: ConditionAST;
    };

export interface RuleIR {
  readonly id: string;
  readonly silo: RuleSilo;
  readonly stratum: number;
  readonly domain: string;
  readonly polarity: RulePolarity;
  readonly when: ConditionAST;
  readonly claimVi: string;
  readonly classicalSource: string;
  readonly actionableAdviceVi?: string | null | undefined;
  readonly careerCategory?: string | null | undefined;
  readonly careerCategories?: readonly string[] | null | undefined;
  readonly setting?: string | null | undefined;
  readonly settings?: readonly string[] | null | undefined;
}

export interface IsomorphicContextFilter {
  readonly careerCategory?: string | null | undefined;
  readonly setting?: string | null | undefined;
}

export interface ContextFilterEcho {
  careerCategory: string | null;
  setting: string | null;
}

export interface ProvenanceNode {
  nodeId: string;
  silo: RuleSilo;
  stratum: number;
  proofDepth: number;
  domain: string;
  polarity: RulePolarity;
  claimVi: string;
  actionableAdviceVi: string | null;
  classicalSource: string;
  parentNodeIds: string[];
  matchedFacts: string[];
}

export interface ParaconsistentConflict {
  conflictId: string;
  domain: string;
  kind: ConflictKind;
  positiveNodeIds: string[];
  negativeNodeIds: string[];
  resolutionHintVi: string;
}

export interface SolverReportIR {
  schemaVersion: string;
  totalRulesEvaluated: number;
  strataEvaluated: number[];
  contextFilter: ContextFilterEcho | null;
  nodes: ProvenanceNode[];
  conflicts: ParaconsistentConflict[];
}

export type RectificationCategory =
  | 'RETRODICTIVE_TIMELINE'
  | 'SOMATIC_MEDICAL'
  | 'KINSHIP_TOPOLOGY';

export type RectificationStatus = 'ACTIVE' | 'LOCKED' | 'INVARIANT_INTERSECTION';

export type BirthTimeCertaintyMode = 'EXACT_TIME' | 'TIME_WINDOW' | 'UNKNOWN';
export type BirthTimeWindow = 'SANG' | 'TRUA' | 'CHIEU' | 'TOI' | 'DEM';
export type MenhBranchGroup = 'TU_CHINH' | 'TU_MO' | 'TU_SINH';

export type ChartPredicate =
  | { readonly op: 'always' }
  | { readonly op: 'otherwise' }
  | { readonly op: 'shichen_in'; readonly branches: readonly number[] }
  | { readonly op: 'menh_vo_chinh_dieu'; readonly expected: boolean }
  | { readonly op: 'menh_branch_parity'; readonly parity: 0 | 1 }
  | { readonly op: 'menh_branch_group'; readonly group: MenhBranchGroup }
  | { readonly op: 'cuc_in'; readonly cucNumbers: readonly number[] }
  | { readonly op: 'than_palace_in'; readonly palaces: readonly string[] }
  | { readonly op: 'palace_has_any_star'; readonly palace: string; readonly stars: readonly string[] }
  | {
      readonly op: 'palace_has_sihua';
      readonly palace: string;
      readonly transforms: readonly ('Hóa Lộc' | 'Hóa Quyền' | 'Hóa Khoa' | 'Hóa Kỵ')[];
    }
  | { readonly op: 'palace_has_tuan_triet'; readonly palace: string }
  | { readonly op: 'and'; readonly args: readonly ChartPredicate[] }
  | { readonly op: 'or'; readonly args: readonly ChartPredicate[] };

export interface RectificationOption {
  readonly id: string;
  readonly labelVi: string;
}

export type LikelihoodMatrixInput =
  | Readonly<Record<string, readonly number[] | Readonly<Record<string, number>>>>
  | readonly (readonly number[])[];

export interface RectificationQuestion {
  readonly id: string;
  readonly category: RectificationCategory;
  readonly ageCohort?: string | null | undefined;
  readonly minAge?: number | null | undefined;
  readonly maxAge?: number | null | undefined;
  readonly promptVi: string;
  readonly options: readonly RectificationOption[];
  readonly likelihoodMatrixMicro: LikelihoodMatrixInput;
  readonly chartPredicates?: Readonly<Record<string, ChartPredicate>> | null | undefined;
}

export interface ChartRectificationFeatures {
  shichenBranch: number;
  shichenBranchVi: string;
  menhBranch: number;
  thanBranch: number;
  thanPalaceName: string;
  cucNumber: number;
  menhVoChinhDieu: boolean;
  menhParity: 0 | 1;
  menhMajorStars: string[];
  palaceSignatureTags: Record<string, string[]>;
}

export interface RectificationSession {
  state: RectificationState;
  compiledBank: RectificationQuestion[];
  chartFeatures: ChartRectificationFeatures[];
}

export interface CreateRectificationSessionOptions {
  readonly mode?: BirthTimeCertaintyMode | undefined;
  readonly birthTimeWindow?: BirthTimeWindow | undefined;
  readonly ambiguousBranches?: readonly number[] | undefined;
  readonly centerBranch?: number | undefined;
  readonly maxQuestions?: number | undefined;
  readonly userAge?: number | null | undefined;
  readonly questionBank?: readonly RectificationQuestion[] | undefined;
}

export interface RectificationCandidate {
  shichenBranch: number;
  shichenBranchVi: string;
  probMicro: number;
}

export interface RectificationAnswerRecord {
  questionId: string;
  optionId: string;
  entropyBeforeMillibits: number;
  entropyAfterMillibits: number;
}

export interface RectificationState {
  schemaVersion: string;
  status: RectificationStatus;
  candidates: RectificationCandidate[];
  entropyMillibits: number;
  askedQuestionIds: string[];
  answers: RectificationAnswerRecord[];
  maxQuestions: number;
  userAge: number | null;
  lockedShichenBranch: number | null;
  top1ProbMicro: number;
  top2ProbMicro: number;
}

export interface InitRectificationOptions {
  readonly candidateBranches?: readonly number[] | undefined;
  readonly priorWeights?: readonly number[] | Readonly<Record<number, number>> | undefined;
  readonly maxQuestions?: number | undefined;
  readonly userAge?: number | null | undefined;
}

export interface QuestionSelectionResult {
  question: RectificationQuestion;
  questionId: string;
  currentEntropyMillibits: number;
  expectedPosteriorEntropyMillibits: number;
  expectedInfoGainMillibits: number;
}

export interface WeightedCandidateReport {
  readonly report: SolverReportIR;
  readonly probMicro: number;
  readonly shichenBranch?: number | undefined;
}

export interface InvariantBaziPillars {
  yearPillar: PillarPair;
  monthPillar: PillarPair;
  dayPillar: PillarPair;
}

export interface InvariantIntersectionReport {
  schemaVersion: string;
  mode: 'INVARIANT_INTERSECTION';
  survivingCandidateCount: number;
  survivingBranches: number[];
  invariantNodes: ProvenanceNode[];
  invariantClaimsVi: string[];
  invariantBaziPillars: InvariantBaziPillars;
}

export type { BaziChartIR, ChartIR };
