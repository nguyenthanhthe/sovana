import { BRANCHES_VI, floorMod } from '@sovana/geo-time';
import type { BaziChartIR, ChartIR, ZiweiChartIR, ZiweiPalaceIR } from '@sovana/kernel';
import type {
  BirthTimeCertaintyMode,
  BirthTimeWindow,
  ChartPredicate,
  ChartRectificationFeatures,
  CreateRectificationSessionOptions,
  InitRectificationOptions,
  InvariantIntersectionReport,
  MenhBranchGroup,
  ProvenanceNode,
  QuestionSelectionResult,
  RectificationCandidate,
  RectificationCategory,
  RectificationQuestion,
  RectificationSession,
  RectificationState,
  SolverReportIR,
  WeightedCandidateReport,
} from './types.js';

const MICRO_SCALE = 1_000_000;
const MICRO_SCALE_BIG = 1_000_000n;
const SURVIVING_THRESHOLD_MICRO = 50_000;
const LOCK_PROB_THRESHOLD_MICRO = 800_000;
const LOCK_RATIO_MULTIPLIER = 3;

const ALLOWED_CATEGORIES: ReadonlySet<string> = new Set<RectificationCategory>([
  'RETRODICTIVE_TIMELINE',
  'SOMATIC_MEDICAL',
  'KINSHIP_TOPOLOGY',
]);

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function jsRound(x: number): number {
  return Math.floor(x + 0.5);
}

/**
 * Exact zero-float Largest Remainder (Hamilton) normalization in pure BigInt arithmetic.
 * Guarantees TS and Python produce 100% identical integer micro-probabilities summing to 1_000_000.
 */
export function normalizeMicroProbs(weights: readonly (number | bigint)[]): number[] {
  const n = weights.length;
  if (n === 0) {
    throw new Error('Cannot normalize empty probability weight vector');
  }

  const bigWeights: bigint[] = weights.map((w) => {
    const bw = typeof w === 'bigint' ? w : BigInt(Math.max(0, Math.trunc(w)));
    return bw < 0n ? 0n : bw;
  });

  let sum = 0n;
  for (const bw of bigWeights) {
    sum += bw;
  }

  const effectiveWeights = sum === 0n ? bigWeights.map(() => 1n) : bigWeights;
  const effectiveSum = sum === 0n ? BigInt(n) : sum;

  const quotients: number[] = new Array<number>(n);
  const remainders: Array<{ idx: number; rem: bigint }> = [];
  let qSum = 0;

  for (let i = 0; i < n; i++) {
    const scaled = effectiveWeights[i]! * MICRO_SCALE_BIG;
    const q = Number(scaled / effectiveSum);
    const r = scaled % effectiveSum;
    quotients[i] = q;
    qSum += q;
    remainders.push({ idx: i, rem: r });
  }

  const deficit = MICRO_SCALE - qSum;
  remainders.sort((a, b) => (a.rem > b.rem ? -1 : a.rem < b.rem ? 1 : a.idx - b.idx));

  for (let k = 0; k < deficit; k++) {
    const target = remainders[k]!;
    quotients[target.idx] = quotients[target.idx]! + 1;
  }

  return quotients;
}

function entropyBitsFloat(probsMicro: readonly number[]): number {
  let h = 0.0;
  for (const p of probsMicro) {
    if (p > 0) {
      const ratio = p / MICRO_SCALE;
      h -= ratio * Math.log2(ratio);
    }
  }
  return h < 0 ? 0 : h;
}

export function computeEntropyMillibits(probsMicro: readonly number[]): number {
  return jsRound(entropyBitsFloat(probsMicro) * 1000.0);
}

export const PUBLIC_RECTIFICATION_QUESTIONS: readonly RectificationQuestion[] = [
  {
    id: 'Q-01',
    category: 'SOMATIC_MEDICAL',
    minAge: 0,
    maxAge: 120,
    ageCohort: null,
    promptVi:
      'Vào thời thơ ấu (khi chưa bị ép giờ đi học), nhịp tỉnh táo tự nhiên nhất trong ngày của bạn nghiêng về buổi nào?',
    options: [
      { id: 'OPT_DAWN_MORN', labelVi: 'Dậy sớm từ rạng sáng và tỉnh táo nhất suốt buổi sáng' },
      { id: 'OPT_NOON_DUSK', labelVi: 'Tỉnh táo mạnh mẽ nhất từ trưa cho tới chiều muộn' },
      { id: 'OPT_NIGHT_LATE', labelVi: 'Tỉnh táo rõ nhất vào buổi tối khuya đến nửa đêm' },
      { id: 'OPT_NA', labelVi: 'Không rõ / Đồng đều mọi buổi trong ngày' },
    ],
    likelihoodMatrixMicro: {
      OPT_DAWN_MORN: [60000, 60000, 780000, 780000, 780000, 780000, 60000, 60000, 60000, 60000, 60000, 60000],
      OPT_NOON_DUSK: [60000, 60000, 60000, 60000, 60000, 60000, 780000, 780000, 780000, 780000, 60000, 60000],
      OPT_NIGHT_LATE: [780000, 780000, 60000, 60000, 60000, 60000, 60000, 60000, 60000, 60000, 780000, 780000],
      OPT_NA: [100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000],
    },
    chartPredicates: {
      OPT_DAWN_MORN: { op: 'shichen_in', branches: [2, 3, 4, 5] },
      OPT_NOON_DUSK: { op: 'shichen_in', branches: [6, 7, 8, 9] },
      OPT_NIGHT_LATE: { op: 'shichen_in', branches: [10, 11, 0, 1] },
    },
  },
  {
    id: 'Q-02',
    category: 'KINSHIP_TOPOLOGY',
    minAge: 0,
    maxAge: 120,
    ageCohort: null,
    promptVi:
      'Cấu trúc thực tế giữa bạn và anh chị em ruột trong gia đình khớp với tình huống nào nhất?',
    options: [
      { id: 'OPT_THUY_CUC', labelVi: 'Là con một, hoặc con trưởng sống tách tự lập sớm xa anh em' },
      { id: 'OPT_KIM_CUC', labelVi: 'Anh chị em cách tuổi nhau rõ (từ 4 năm trở lên) và ít ở chung dài ngày' },
      { id: 'OPT_HOA_CUC', labelVi: 'Có anh chị em gần tuổi (cách 1–3 năm) và bạn thường gánh vác việc chung' },
      { id: 'OPT_MOC_CUC', labelVi: 'Gia đình đông anh chị em (từ 3 người trở lên) gắn bó hỗ trợ nhau' },
      { id: 'OPT_NA', labelVi: 'Không rõ / Không thuộc các mẫu trên' },
    ],
    likelihoodMatrixMicro: {
      OPT_THUY_CUC: [790000, 40000, 40000, 40000, 790000, 40000, 40000, 40000, 790000, 40000, 40000, 40000],
      OPT_KIM_CUC: [40000, 790000, 40000, 40000, 40000, 790000, 40000, 40000, 40000, 790000, 40000, 40000],
      OPT_HOA_CUC: [40000, 40000, 790000, 40000, 40000, 40000, 790000, 40000, 40000, 40000, 790000, 40000],
      OPT_MOC_CUC: [40000, 40000, 40000, 790000, 40000, 40000, 40000, 790000, 40000, 40000, 40000, 790000],
      OPT_NA: [90000, 90000, 90000, 90000, 90000, 90000, 90000, 90000, 90000, 90000, 90000, 90000],
    },
    chartPredicates: {
      OPT_THUY_CUC: {
        op: 'or',
        args: [
          { op: 'cuc_in', cucNumbers: [2] },
          { op: 'palace_has_any_star', palace: 'Huynh Đệ', stars: ['Cô Thần', 'Quả Tú', 'Đà La'] },
        ],
      },
      OPT_KIM_CUC: {
        op: 'or',
        args: [
          { op: 'cuc_in', cucNumbers: [4] },
          { op: 'palace_has_any_star', palace: 'Huynh Đệ', stars: ['Thất Sát', 'Kình Dương', 'Vũ Khúc'] },
        ],
      },
      OPT_HOA_CUC: {
        op: 'or',
        args: [
          { op: 'cuc_in', cucNumbers: [6] },
          { op: 'palace_has_any_star', palace: 'Huynh Đệ', stars: ['Thái Dương', 'Thiên Tướng'] },
          { op: 'palace_has_sihua', palace: 'Huynh Đệ', transforms: ['Hóa Quyền'] },
        ],
      },
      OPT_MOC_CUC: {
        op: 'or',
        args: [
          { op: 'cuc_in', cucNumbers: [3, 5] },
          {
            op: 'palace_has_any_star',
            palace: 'Huynh Đệ',
            stars: ['Thiên Phủ', 'Thái Âm', 'Thiên Đồng', 'Tả Phụ', 'Hữu Bật'],
          },
        ],
      },
    },
  },
  {
    id: 'Q-03',
    category: 'RETRODICTIVE_TIMELINE',
    minAge: 0,
    maxAge: 120,
    ageCohort: null,
    promptVi:
      'Trong 18 năm đầu đời, nơi ở và môi trường học tập của gia đình bạn diễn ra theo xu hướng nào?',
    options: [
      { id: 'OPT_TU_CHINH', labelVi: 'Ở ổn định một địa phương, nhưng có một bước ngoặt đổi hướng rất dứt khoát' },
      { id: 'OPT_TU_MO', labelVi: 'Gắn bó lâu dài tại nhà cũ hoặc đất tổ tiên, hầu như không dời đổi chỗ ở' },
      { id: 'OPT_TU_SINH', labelVi: 'Gia đình từng chuyển nhà nhiều lần hoặc bạn sớm rời quê đi học xa' },
      { id: 'OPT_NA', labelVi: 'Không rõ / Thông tin trung tính' },
    ],
    likelihoodMatrixMicro: {
      OPT_TU_CHINH: [780000, 60000, 60000, 780000, 60000, 60000, 780000, 60000, 60000, 780000, 60000, 60000],
      OPT_TU_MO: [60000, 780000, 60000, 60000, 780000, 60000, 60000, 780000, 60000, 60000, 780000, 60000],
      OPT_TU_SINH: [60000, 60000, 780000, 60000, 60000, 780000, 60000, 60000, 780000, 60000, 60000, 780000],
      OPT_NA: [100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000],
    },
    chartPredicates: {
      OPT_TU_CHINH: { op: 'menh_branch_group', group: 'TU_CHINH' },
      OPT_TU_MO: { op: 'menh_branch_group', group: 'TU_MO' },
      OPT_TU_SINH: { op: 'menh_branch_group', group: 'TU_SINH' },
    },
  },
  {
    id: 'Q-04',
    category: 'SOMATIC_MEDICAL',
    minAge: 0,
    maxAge: 120,
    ageCohort: null,
    promptVi:
      'Nếu từng có vết sẹo nhỏ, chấn thương nhẹ hoặc bên cơ thể dễ mỏi hơn, chúng tập trung ở phía nào?',
    options: [
      { id: 'OPT_YANG_BRANCH', labelVi: 'Tập trung rõ hơn ở nửa bên trái cơ thể hoặc vùng đầu mặt' },
      { id: 'OPT_YIN_BRANCH', labelVi: 'Tập trung rõ hơn ở nửa bên phải cơ thể' },
      { id: 'OPT_NA', labelVi: 'Không rõ / Cân bằng cả hai bên hoặc chưa từng có' },
    ],
    likelihoodMatrixMicro: {
      OPT_YANG_BRANCH: [800000, 100000, 800000, 100000, 800000, 100000, 800000, 100000, 800000, 100000, 800000, 100000],
      OPT_YIN_BRANCH: [100000, 800000, 100000, 800000, 100000, 800000, 100000, 800000, 100000, 800000, 100000, 800000],
      OPT_NA: [100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000],
    },
    chartPredicates: {
      OPT_YANG_BRANCH: { op: 'menh_branch_parity', parity: 0 },
      OPT_YIN_BRANCH: { op: 'menh_branch_parity', parity: 1 },
    },
  },
  {
    id: 'Q-05',
    category: 'SOMATIC_MEDICAL',
    minAge: 0,
    maxAge: 120,
    ageCohort: null,
    promptVi:
      'Khi mệt mỏi kéo dài hoặc thời tiết đổi mùa, biểu hiện cơ địa nào xuất hiện rõ hơn ở bạn?',
    options: [
      { id: 'OPT_TY', labelVi: 'Dễ lạnh bàn tay bàn chân hoặc đau mỏi vùng thắt lưng' },
      { id: 'OPT_NGO', labelVi: 'Dễ bốc nóng mặt, nhiệt miệng hoặc mỏi rát mắt khi thiếu ngủ' },
      { id: 'OPT_OTHER_05', labelVi: 'Không có biểu hiện nào trong hai nhóm trên' },
      { id: 'OPT_NA', labelVi: 'Không rõ' },
    ],
    likelihoodMatrixMicro: {
      OPT_TY: [760000, 100000, 100000, 100000, 100000, 100000, 80000, 100000, 100000, 100000, 100000, 100000],
      OPT_NGO: [80000, 100000, 100000, 100000, 100000, 100000, 760000, 100000, 100000, 100000, 100000, 100000],
      OPT_OTHER_05: [80000, 720000, 720000, 720000, 720000, 720000, 80000, 720000, 720000, 720000, 720000, 720000],
      OPT_NA: [80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000],
    },
    chartPredicates: {
      OPT_TY: { op: 'shichen_in', branches: [0] },
      OPT_NGO: { op: 'shichen_in', branches: [6] },
      OPT_OTHER_05: { op: 'otherwise' },
    },
  },
  {
    id: 'Q-06',
    category: 'SOMATIC_MEDICAL',
    minAge: 0,
    maxAge: 120,
    ageCohort: null,
    promptVi:
      'Khi ăn uống thất thường hoặc căng thẳng công việc, phản ứng tiêu hóa nào hay gặp nhất ở bạn?',
    options: [
      { id: 'OPT_SUU', labelVi: 'Hay căng tức vùng hạ sườn hoặc khó ngủ lại lúc nửa đêm về sáng' },
      { id: 'OPT_MUI', labelVi: 'Dễ trào ngược dạ dày hoặc đầy hơi chướng bụng vào đầu giờ chiều' },
      { id: 'OPT_OTHER_06', labelVi: 'Hệ tiêu hóa ổn định, không gặp hai dấu hiệu trên' },
      { id: 'OPT_NA', labelVi: 'Không rõ' },
    ],
    likelihoodMatrixMicro: {
      OPT_SUU: [100000, 760000, 100000, 100000, 100000, 100000, 100000, 80000, 100000, 100000, 100000, 100000],
      OPT_MUI: [100000, 80000, 100000, 100000, 100000, 100000, 100000, 760000, 100000, 100000, 100000, 100000],
      OPT_OTHER_06: [720000, 80000, 720000, 720000, 720000, 720000, 720000, 80000, 720000, 720000, 720000, 720000],
      OPT_NA: [80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000],
    },
    chartPredicates: {
      OPT_SUU: { op: 'shichen_in', branches: [1] },
      OPT_MUI: { op: 'shichen_in', branches: [7] },
      OPT_OTHER_06: { op: 'otherwise' },
    },
  },
  {
    id: 'Q-07',
    category: 'SOMATIC_MEDICAL',
    minAge: 0,
    maxAge: 120,
    ageCohort: null,
    promptVi:
      'Khi trời trở lạnh hoặc hanh khô kéo dài, dấu hiệu cơ địa nào xuất hiện rõ hơn?',
    options: [
      { id: 'OPT_DAN', labelVi: 'Nhạy cảm đường hô hấp trên, dễ ho khan hoặc nghẹt mũi lúc sáng sớm' },
      { id: 'OPT_THAN', labelVi: 'Hay khát nước về chiều, dễ tiểu đêm hoặc mỏi bắp chân khi trời lạnh' },
      { id: 'OPT_OTHER_07', labelVi: 'Không có biểu hiện nào trong hai nhóm trên' },
      { id: 'OPT_NA', labelVi: 'Không rõ' },
    ],
    likelihoodMatrixMicro: {
      OPT_DAN: [100000, 100000, 760000, 100000, 100000, 100000, 100000, 100000, 80000, 100000, 100000, 100000],
      OPT_THAN: [100000, 100000, 80000, 100000, 100000, 100000, 100000, 100000, 760000, 100000, 100000, 100000],
      OPT_OTHER_07: [720000, 720000, 80000, 720000, 720000, 720000, 720000, 720000, 80000, 720000, 720000, 720000],
      OPT_NA: [80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000],
    },
    chartPredicates: {
      OPT_DAN: { op: 'shichen_in', branches: [2] },
      OPT_THAN: { op: 'shichen_in', branches: [8] },
      OPT_OTHER_07: { op: 'otherwise' },
    },
  },
  {
    id: 'Q-08',
    category: 'SOMATIC_MEDICAL',
    minAge: 0,
    maxAge: 120,
    ageCohort: null,
    promptVi:
      'Về cơ địa dị ứng hoặc nhạy cảm niêm mạc hàng ngày, bạn hay gặp tình huống nào hơn?',
    options: [
      { id: 'OPT_MAO', labelVi: 'Đường ruột nhạy cảm với đồ lạnh hoặc sữa vào buổi sáng sớm' },
      { id: 'OPT_DAU', labelVi: 'Viêm mũi dị ứng hoặc khô rát họng mỗi khi gió lạnh buổi chiều tối' },
      { id: 'OPT_OTHER_08', labelVi: 'Không có cơ địa nhạy cảm ở cả hai nhóm trên' },
      { id: 'OPT_NA', labelVi: 'Không rõ' },
    ],
    likelihoodMatrixMicro: {
      OPT_MAO: [100000, 100000, 100000, 760000, 100000, 100000, 100000, 100000, 100000, 80000, 100000, 100000],
      OPT_DAU: [100000, 100000, 100000, 80000, 100000, 100000, 100000, 100000, 100000, 760000, 100000, 100000],
      OPT_OTHER_08: [720000, 720000, 720000, 80000, 720000, 720000, 720000, 720000, 720000, 80000, 720000, 720000],
      OPT_NA: [80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000],
    },
    chartPredicates: {
      OPT_MAO: { op: 'shichen_in', branches: [3] },
      OPT_DAU: { op: 'shichen_in', branches: [9] },
      OPT_OTHER_08: { op: 'otherwise' },
    },
  },
  {
    id: 'Q-09',
    category: 'SOMATIC_MEDICAL',
    minAge: 0,
    maxAge: 120,
    ageCohort: null,
    promptVi:
      'Trong nhịp sinh hoạt hàng ngày, vấn đề thể chất nào ảnh hưởng tới bạn rõ rệt hơn?',
    options: [
      { id: 'OPT_THIN', labelVi: 'Hễ trễ bữa sáng là đau rát thượng vị hoặc cồn cào dạ dày ngay' },
      { id: 'OPT_TUAT', labelVi: 'Khó thư giãn vùng cổ vai gáy vào buổi tối khiến khó vào giấc ngủ sớm' },
      { id: 'OPT_OTHER_09', labelVi: 'Không gặp cả hai vấn đề trên' },
      { id: 'OPT_NA', labelVi: 'Không rõ' },
    ],
    likelihoodMatrixMicro: {
      OPT_THIN: [100000, 100000, 100000, 100000, 760000, 100000, 100000, 100000, 100000, 100000, 80000, 100000],
      OPT_TUAT: [100000, 100000, 100000, 100000, 80000, 100000, 100000, 100000, 100000, 100000, 760000, 100000],
      OPT_OTHER_09: [720000, 720000, 720000, 720000, 80000, 720000, 720000, 720000, 720000, 720000, 80000, 720000],
      OPT_NA: [80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000],
    },
    chartPredicates: {
      OPT_THIN: { op: 'shichen_in', branches: [4] },
      OPT_TUAT: { op: 'shichen_in', branches: [10] },
      OPT_OTHER_09: { op: 'otherwise' },
    },
  },
  {
    id: 'Q-10',
    category: 'KINSHIP_TOPOLOGY',
    minAge: 0,
    maxAge: 120,
    ageCohort: null,
    promptVi:
      'Theo lời kể của mẹ hoặc giấy chứng sinh, ca sinh của bạn diễn ra trong tình huống nào?',
    options: [
      { id: 'OPT_TY_SNAKE', labelVi: 'Sinh thường nhanh thuận lợi vào ban ngày trời sáng' },
      { id: 'OPT_HOI', labelVi: 'Ca sinh vào đêm muộn hoặc có can thiệp sản khoa (sinh khó, sinh mổ, dây rốn quấn cổ)' },
      { id: 'OPT_OTHER_10', labelVi: 'Ca sinh bình thường nhưng không thuộc hai tình huống trên' },
      { id: 'OPT_NA', labelVi: 'Không còn thông tin lúc sinh' },
    ],
    likelihoodMatrixMicro: {
      OPT_TY_SNAKE: [100000, 100000, 100000, 100000, 100000, 760000, 100000, 100000, 100000, 100000, 100000, 80000],
      OPT_HOI: [100000, 100000, 100000, 100000, 100000, 80000, 100000, 100000, 100000, 100000, 100000, 760000],
      OPT_OTHER_10: [720000, 720000, 720000, 720000, 720000, 80000, 720000, 720000, 720000, 720000, 720000, 80000],
      OPT_NA: [80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000],
    },
    chartPredicates: {
      OPT_TY_SNAKE: { op: 'shichen_in', branches: [5] },
      OPT_HOI: { op: 'shichen_in', branches: [11] },
      OPT_OTHER_10: { op: 'otherwise' },
    },
  },
  {
    id: 'Q-11',
    category: 'KINSHIP_TOPOLOGY',
    minAge: 0,
    maxAge: 120,
    ageCohort: null,
    promptVi:
      'Nghề nghiệp chủ đạo của cha mẹ trong giai đoạn nuôi dưỡng bạn thuộc nhóm nào?',
    options: [
      { id: 'OPT_GAP_A', labelVi: 'Nghề có tính biến động cao (tự doanh nhỏ, đổi việc hoặc chuyển công tác nhiều)' },
      { id: 'OPT_GAP_B', labelVi: 'Ngành hành chính, giáo dục, y tế hoặc chuyên môn ổn định lâu năm' },
      { id: 'OPT_GAP_C', labelVi: 'Kinh doanh thương mại, kỹ thuật hoặc làm việc ở nơi xa gia đình' },
      { id: 'OPT_NA', labelVi: 'Không rõ / Đa dạng khác' },
    ],
    likelihoodMatrixMicro: {
      OPT_GAP_A: [70000, 760000, 760000, 70000, 70000, 70000, 70000, 760000, 760000, 70000, 70000, 70000],
      OPT_GAP_B: [70000, 70000, 70000, 760000, 760000, 70000, 70000, 70000, 70000, 760000, 760000, 70000],
      OPT_GAP_C: [760000, 70000, 70000, 70000, 70000, 760000, 760000, 70000, 70000, 70000, 70000, 760000],
      OPT_NA: [100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000],
    },
    chartPredicates: {
      OPT_GAP_A: {
        op: 'palace_has_any_star',
        palace: 'Phụ Mẫu',
        stars: ['Thất Sát', 'Phá Quân', 'Tham Lang', 'Thiên Mã'],
      },
      OPT_GAP_B: {
        op: 'palace_has_any_star',
        palace: 'Phụ Mẫu',
        stars: ['Thiên Phủ', 'Thiên Lương', 'Thiên Tướng', 'Văn Xương', 'Văn Khúc'],
      },
      OPT_GAP_C: {
        op: 'palace_has_any_star',
        palace: 'Phụ Mẫu',
        stars: ['Vũ Khúc', 'Thái Dương', 'Cự Môn', 'Lộc Tồn'],
      },
    },
  },
  {
    id: 'Q-12',
    category: 'RETRODICTIVE_TIMELINE',
    minAge: 12,
    maxAge: 120,
    ageCohort: null,
    promptVi:
      'Trong giai đoạn 12–18 tuổi, dấu mốc thực tế nổi bật nhất của bạn là gì?',
    options: [
      { id: 'OPT_REV_A', labelVi: 'Chuyển trường chuyên, lớp chọn hoặc chuyển môi trường học xa nhà' },
      { id: 'OPT_REV_B', labelVi: 'Gia đình trải qua biến động rõ rệt về nhà cửa hoặc tài chính' },
      { id: 'OPT_REV_C', labelVi: 'Đảm nhận vai trò lớp trưởng, đội trưởng hoặc đạt giải thưởng thành tích nổi bật' },
      { id: 'OPT_NA', labelVi: 'Giai đoạn học tập bình lặng, không có biến cố nổi bật' },
    ],
    likelihoodMatrixMicro: {
      OPT_REV_A: [70000, 70000, 760000, 760000, 70000, 70000, 70000, 70000, 760000, 760000, 70000, 70000],
      OPT_REV_B: [760000, 760000, 70000, 70000, 760000, 760000, 70000, 70000, 70000, 70000, 70000, 70000],
      OPT_REV_C: [70000, 70000, 70000, 70000, 70000, 70000, 760000, 760000, 70000, 70000, 760000, 760000],
      OPT_NA: [100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000],
    },
    chartPredicates: {
      OPT_REV_A: {
        op: 'or',
        args: [
          { op: 'palace_has_any_star', palace: 'Thiên Di', stars: ['Thiên Mã', 'Thái Dương', 'Thiên Cơ'] },
          { op: 'palace_has_sihua', palace: 'Quan Lộc', transforms: ['Hóa Khoa'] },
        ],
      },
      OPT_REV_B: {
        op: 'or',
        args: [
          { op: 'palace_has_sihua', palace: 'Điền Trạch', transforms: ['Hóa Kỵ'] },
          { op: 'palace_has_tuan_triet', palace: 'Phụ Mẫu' },
        ],
      },
      OPT_REV_C: {
        op: 'or',
        args: [
          { op: 'palace_has_sihua', palace: 'Mệnh', transforms: ['Hóa Quyền', 'Hóa Khoa'] },
          { op: 'palace_has_any_star', palace: 'Mệnh', stars: ['Tử Vi', 'Thái Dương', 'Thiên Khôi', 'Thiên Việt'] },
        ],
      },
    },
  },
];

export function loadPublicRectificationQuestions(): RectificationQuestion[] {
  return [...PUBLIC_RECTIFICATION_QUESTIONS];
}

function getRawLikelihood(
  question: RectificationQuestion,
  optionIdx: number,
  optionId: string,
  branch: number,
): number {
  const b = floorMod(branch, 12);
  const mat = question.likelihoodMatrixMicro;

  if (Array.isArray(mat)) {
    const row = mat[optionIdx];
    if (!row || row[b] === undefined) {
      throw new Error(`Missing likelihood entry for question '${question.id}', option '${optionId}', branch ${b}`);
    }
    return Number(row[b]);
  }

  const entry = (mat as Readonly<Record<string, readonly number[] | Readonly<Record<string, number>>>>)[optionId];
  if (!entry) {
    throw new Error(`Missing likelihood row for question '${question.id}', option '${optionId}'`);
  }
  if (Array.isArray(entry)) {
    const val = entry[b];
    if (val === undefined) {
      throw new Error(`Likelihood array for '${question.id}' option '${optionId}' must cover 12 branches (missing ${b})`);
    }
    return Number(val);
  }

  const dictVal = (entry as Readonly<Record<string, number>>)[String(b)];
  if (dictVal === undefined) {
    throw new Error(`Likelihood map for '${question.id}' option '${optionId}' missing branch '${b}'`);
  }
  return Number(dictVal);
}

export function validateQuestionBank(questionBank: readonly RectificationQuestion[]): void {
  for (const q of questionBank) {
    if (!ALLOWED_CATEGORIES.has(q.category)) {
      throw new Error(
        `Anti-Barnum violation in question '${q.id}': category '${String(q.category)}' is forbidden; allowed categories are RETRODICTIVE_TIMELINE, SOMATIC_MEDICAL, KINSHIP_TOPOLOGY`,
      );
    }
    if (!q.options || q.options.length < 2) {
      throw new Error(`Rectification question '${q.id}' must define at least 2 options`);
    }
    for (let optIdx = 0; optIdx < q.options.length; optIdx++) {
      const opt = q.options[optIdx]!;
      for (let b = 0; b < 12; b++) {
        const val = getRawLikelihood(q, optIdx, opt.id, b);
        if (!Number.isFinite(val) || val <= 0) {
          throw new Error(
            `Invalid likelihood ${val} in question '${q.id}' option '${opt.id}' branch ${b}: must be positive`,
          );
        }
      }
    }
  }
}

/**
 * Returns a [options.length][12] table where each branch column sums to 1_000_000.
 */
function buildNormalizedColumnMatrix(question: RectificationQuestion): number[][] {
  const optCount = question.options.length;
  const table: number[][] = Array.from({ length: optCount }, () => new Array<number>(12).fill(0));

  for (let b = 0; b < 12; b++) {
    const rawCol: number[] = [];
    for (let o = 0; o < optCount; o++) {
      rawCol.push(getRawLikelihood(question, o, question.options[o]!.id, b));
    }
    const normCol = normalizeMicroProbs(rawCol);
    for (let o = 0; o < optCount; o++) {
      table[o]![b] = normCol[o]!;
    }
  }
  return table;
}

function isQuestionEligibleForAge(q: RectificationQuestion, userAge: number | null): boolean {
  if (userAge === null) return true;
  if (q.minAge !== undefined && q.minAge !== null && userAge < q.minAge) return false;
  if (q.maxAge !== undefined && q.maxAge !== null && userAge > q.maxAge) return false;
  return true;
}

function summarizeTopTwo(candidates: readonly RectificationCandidate[]): {
  top1ProbMicro: number;
  top2ProbMicro: number;
  topBranch: number;
} {
  const sorted = [...candidates].sort((a, b) =>
    b.probMicro !== a.probMicro ? b.probMicro - a.probMicro : a.shichenBranch - b.shichenBranch,
  );
  const top1 = sorted[0];
  const top2 = sorted[1];
  return {
    top1ProbMicro: top1 ? top1.probMicro : 0,
    top2ProbMicro: top2 ? top2.probMicro : 0,
    topBranch: top1 ? top1.shichenBranch : 0,
  };
}

function isBayesianLocked(top1ProbMicro: number, top2ProbMicro: number): boolean {
  return top1ProbMicro >= LOCK_PROB_THRESHOLD_MICRO && top1ProbMicro >= LOCK_RATIO_MULTIPLIER * top2ProbMicro;
}

export function createInitialRectificationState(options?: InitRectificationOptions): RectificationState {
  const rawBranches = options?.candidateBranches ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const branchSet = new Set<number>();
  for (const b of rawBranches) {
    branchSet.add(floorMod(Math.trunc(b), 12));
  }
  const branches = Array.from(branchSet).sort((a, b) => a - b);
  if (branches.length === 0) {
    throw new Error('createInitialRectificationState requires at least 1 candidate Shichen branch');
  }

  let rawWeights: number[];
  if (options?.priorWeights === undefined) {
    rawWeights = branches.map(() => 1);
  } else if (Array.isArray(options.priorWeights)) {
    const arr = options.priorWeights as readonly number[];
    if (arr.length === branches.length) {
      rawWeights = [...arr];
    } else if (arr.length === 12) {
      rawWeights = branches.map((b) => arr[b] ?? 1);
    } else {
      throw new Error('priorWeights array length must match candidateBranches length or 12');
    }
  } else {
    const rec = options.priorWeights as Readonly<Record<number, number>>;
    rawWeights = branches.map((b) => rec[b] ?? 1);
  }

  const probsMicro = normalizeMicroProbs(rawWeights);
  const candidates: RectificationCandidate[] = branches.map((b, i) => ({
    shichenBranch: b,
    shichenBranchVi: BRANCHES_VI[b]!,
    probMicro: probsMicro[i]!,
  }));

  const entropyMillibits = computeEntropyMillibits(probsMicro);
  const maxQuestions = options?.maxQuestions ?? 5;
  const userAge = options?.userAge ?? null;
  const { top1ProbMicro, top2ProbMicro, topBranch } = summarizeTopTwo(candidates);
  const locked = isBayesianLocked(top1ProbMicro, top2ProbMicro);

  return {
    schemaVersion: '1.0.0',
    status: locked ? 'LOCKED' : maxQuestions <= 0 ? 'INVARIANT_INTERSECTION' : 'ACTIVE',
    candidates,
    entropyMillibits,
    askedQuestionIds: [],
    answers: [],
    maxQuestions,
    userAge,
    lockedShichenBranch: locked ? topBranch : null,
    top1ProbMicro,
    top2ProbMicro,
  };
}

export function selectNextQuestion(
  state: RectificationState,
  questionBank: readonly RectificationQuestion[] = PUBLIC_RECTIFICATION_QUESTIONS,
): QuestionSelectionResult | null {
  validateQuestionBank(questionBank);

  if (state.status !== 'ACTIVE' || state.answers.length >= state.maxQuestions) {
    return null;
  }

  const askedSet = new Set(state.askedQuestionIds);
  const eligible = questionBank.filter(
    (q) => !askedSet.has(q.id) && isQuestionEligibleForAge(q, state.userAge),
  );
  if (eligible.length === 0) {
    return null;
  }

  const priorProbs = state.candidates.map((c) => c.probMicro);
  const currentHFloat = entropyBitsFloat(priorProbs);
  const currentEntropyMillibits = jsRound(currentHFloat * 1000.0);

  let bestQuestion: RectificationQuestion | null = null;
  let bestExpectedPostMillibits = currentEntropyMillibits;
  let bestGainMillibits = -1;
  let bestGainMicrobits = -1;

  for (const q of eligible) {
    const colMatrix = buildNormalizedColumnMatrix(q);
    let expectedPostHFloat = 0.0;

    for (let o = 0; o < q.options.length; o++) {
      const optRow = colMatrix[o]!;
      let marginalPico = 0n;
      const unnormWeights: bigint[] = [];

      for (const cand of state.candidates) {
        const lMicro = BigInt(optRow[cand.shichenBranch]!);
        const wPico = BigInt(cand.probMicro) * lMicro;
        unnormWeights.push(wPico);
        marginalPico += wPico;
      }

      if (marginalPico > 0n) {
        const postMicro = normalizeMicroProbs(unnormWeights);
        const postH = entropyBitsFloat(postMicro);
        const pOption = Number(marginalPico) / 1_000_000_000_000.0;
        expectedPostHFloat += pOption * postH;
      }
    }

    const expectedPostMillibits = jsRound(expectedPostHFloat * 1000.0);
    const gainMillibits = Math.max(0, currentEntropyMillibits - expectedPostMillibits);
    const gainMicrobits = Math.max(0, jsRound((currentHFloat - expectedPostHFloat) * 1_000_000.0));

    const isBetter =
      bestQuestion === null ||
      gainMillibits > bestGainMillibits ||
      (gainMillibits === bestGainMillibits && gainMicrobits > bestGainMicrobits) ||
      (gainMillibits === bestGainMillibits &&
        gainMicrobits === bestGainMicrobits &&
        cmpStr(q.id, bestQuestion.id) < 0);

    if (isBetter) {
      bestQuestion = q;
      bestExpectedPostMillibits = expectedPostMillibits;
      bestGainMillibits = gainMillibits;
      bestGainMicrobits = gainMicrobits;
    }
  }

  if (!bestQuestion) return null;

  const canonicalQuestion: RectificationQuestion = {
    id: bestQuestion.id,
    category: bestQuestion.category,
    ageCohort: bestQuestion.ageCohort ?? null,
    minAge: bestQuestion.minAge ?? null,
    maxAge: bestQuestion.maxAge ?? null,
    promptVi: bestQuestion.promptVi,
    options: bestQuestion.options.map((o) => ({ id: o.id, labelVi: o.labelVi })),
    likelihoodMatrixMicro: bestQuestion.likelihoodMatrixMicro,
    chartPredicates: bestQuestion.chartPredicates ?? null,
  };

  return {
    question: canonicalQuestion,
    questionId: bestQuestion.id,
    currentEntropyMillibits,
    expectedPosteriorEntropyMillibits: bestExpectedPostMillibits,
    expectedInfoGainMillibits: bestGainMillibits,
  };
}

export function answerQuestion(
  state: RectificationState,
  questionId: string,
  answerValue: string,
  questionBank: readonly RectificationQuestion[] = PUBLIC_RECTIFICATION_QUESTIONS,
): RectificationState {
  validateQuestionBank(questionBank);

  const question = questionBank.find((q) => q.id === questionId);
  if (!question) {
    throw new Error(`Rectification question '${questionId}' not found in question bank`);
  }

  const optIndex = question.options.findIndex((o) => o.id === answerValue);
  if (optIndex < 0) {
    throw new Error(`Invalid option '${answerValue}' for rectification question '${questionId}'`);
  }

  const colMatrix = buildNormalizedColumnMatrix(question);
  const optRow = colMatrix[optIndex]!;

  const unnormWeights: bigint[] = state.candidates.map(
    (c) => BigInt(c.probMicro) * BigInt(optRow[c.shichenBranch]!),
  );
  const postMicro = normalizeMicroProbs(unnormWeights);

  const newCandidates: RectificationCandidate[] = state.candidates.map((c, idx) => ({
    shichenBranch: c.shichenBranch,
    shichenBranchVi: c.shichenBranchVi,
    probMicro: postMicro[idx]!,
  }));

  const entropyBeforeMillibits = state.entropyMillibits;
  const entropyAfterMillibits = computeEntropyMillibits(postMicro);

  const askedQuestionIds = state.askedQuestionIds.includes(questionId)
    ? [...state.askedQuestionIds]
    : [...state.askedQuestionIds, questionId];

  const answers = [
    ...state.answers,
    {
      questionId,
      optionId: answerValue,
      entropyBeforeMillibits,
      entropyAfterMillibits,
    },
  ];

  const { top1ProbMicro, top2ProbMicro, topBranch } = summarizeTopTwo(newCandidates);
  const locked = isBayesianLocked(top1ProbMicro, top2ProbMicro);

  const askedSet = new Set(askedQuestionIds);
  const remainingCount = questionBank.filter(
    (q) => !askedSet.has(q.id) && isQuestionEligibleForAge(q, state.userAge),
  ).length;

  let status: RectificationState['status'];
  let lockedShichenBranch: number | null = null;
  if (locked) {
    status = 'LOCKED';
    lockedShichenBranch = topBranch;
  } else if (answers.length >= state.maxQuestions || remainingCount === 0) {
    status = 'INVARIANT_INTERSECTION';
  } else {
    status = 'ACTIVE';
  }

  return {
    schemaVersion: '1.0.0',
    status,
    candidates: newCandidates,
    entropyMillibits: entropyAfterMillibits,
    askedQuestionIds,
    answers,
    maxQuestions: state.maxQuestions,
    userAge: state.userAge,
    lockedShichenBranch,
    top1ProbMicro,
    top2ProbMicro,
  };
}

function isWeightedReportEntry(
  item: SolverReportIR | WeightedCandidateReport,
): item is WeightedCandidateReport {
  return 'report' in item && 'probMicro' in item;
}

export function computeInvariantIntersection(
  candidateReports: readonly (SolverReportIR | WeightedCandidateReport)[],
  bazi: BaziChartIR,
  probsOrState?: readonly number[] | RectificationState | undefined,
): InvariantIntersectionReport {
  let survivingReports: SolverReportIR[] = [];
  let survivingBranches: number[] = [];

  if (candidateReports.length > 0 && isWeightedReportEntry(candidateReports[0]!)) {
    const weighted = candidateReports as readonly WeightedCandidateReport[];
    const filtered = weighted.filter((w) => w.probMicro >= SURVIVING_THRESHOLD_MICRO);
    const chosen = filtered.length > 0 ? filtered : [weighted.reduce((a, b) => (b.probMicro > a.probMicro ? b : a))];
    survivingReports = chosen.map((w) => w.report);
    survivingBranches = chosen
      .map((w, idx) => (w.shichenBranch !== undefined ? w.shichenBranch : idx))
      .sort((a, b) => a - b);
  } else {
    const plainReports = candidateReports as readonly SolverReportIR[];
    if (probsOrState === undefined) {
      survivingReports = [...plainReports];
      survivingBranches = plainReports.map((_, idx) => idx);
    } else if (Array.isArray(probsOrState)) {
      const probs = probsOrState as readonly number[];
      const indices: number[] = [];
      for (let i = 0; i < plainReports.length; i++) {
        if ((probs[i] ?? 0) >= SURVIVING_THRESHOLD_MICRO) {
          indices.push(i);
        }
      }
      if (indices.length === 0 && plainReports.length > 0) {
        let bestIdx = 0;
        for (let i = 1; i < plainReports.length; i++) {
          if ((probs[i] ?? 0) > (probs[bestIdx] ?? 0)) bestIdx = i;
        }
        indices.push(bestIdx);
      }
      survivingReports = indices.map((i) => plainReports[i]!);
      survivingBranches = indices;
    } else {
      const rectState = probsOrState as RectificationState;
      const indices: number[] = [];
      const branches: number[] = [];
      for (let i = 0; i < plainReports.length && i < rectState.candidates.length; i++) {
        const cand = rectState.candidates[i]!;
        if (cand.probMicro >= SURVIVING_THRESHOLD_MICRO) {
          indices.push(i);
          branches.push(cand.shichenBranch);
        }
      }
      if (indices.length === 0 && plainReports.length > 0 && rectState.candidates.length > 0) {
        let bestIdx = 0;
        for (let i = 1; i < Math.min(plainReports.length, rectState.candidates.length); i++) {
          if (rectState.candidates[i]!.probMicro > rectState.candidates[bestIdx]!.probMicro) {
            bestIdx = i;
          }
        }
        indices.push(bestIdx);
        branches.push(rectState.candidates[bestIdx]!.shichenBranch);
      }
      survivingReports = indices.map((i) => plainReports[i]!);
      survivingBranches = branches.sort((a, b) => a - b);
    }
  }

  let invariantNodes: ProvenanceNode[] = [];
  let invariantClaimsVi: string[] = [];

  if (survivingReports.length > 0) {
    const firstReport = survivingReports[0]!;
    const commonNodeIds = new Set(firstReport.nodes.map((n) => n.nodeId));
    for (let i = 1; i < survivingReports.length; i++) {
      const ids = new Set(survivingReports[i]!.nodes.map((n) => n.nodeId));
      for (const id of Array.from(commonNodeIds)) {
        if (!ids.has(id)) commonNodeIds.delete(id);
      }
    }

    invariantNodes = firstReport.nodes
      .filter((n) => commonNodeIds.has(n.nodeId))
      .sort((a, b) => (a.stratum !== b.stratum ? a.stratum - b.stratum : cmpStr(a.nodeId, b.nodeId)));

    const commonClaims = new Set(firstReport.nodes.map((n) => n.claimVi));
    for (let i = 1; i < survivingReports.length; i++) {
      const claims = new Set(survivingReports[i]!.nodes.map((n) => n.claimVi));
      for (const cl of Array.from(commonClaims)) {
        if (!claims.has(cl)) commonClaims.delete(cl);
      }
    }

    const orderedClaims: string[] = [];
    const seenClaims = new Set<string>();
    for (const node of firstReport.nodes) {
      if (commonClaims.has(node.claimVi) && !seenClaims.has(node.claimVi)) {
        seenClaims.add(node.claimVi);
        orderedClaims.push(node.claimVi);
      }
    }
    invariantClaimsVi = orderedClaims;
  }

  return {
    schemaVersion: '1.0.0',
    mode: 'INVARIANT_INTERSECTION',
    survivingCandidateCount: survivingReports.length,
    survivingBranches,
    invariantNodes,
    invariantClaimsVi,
    invariantBaziPillars: {
      yearPillar: bazi.yearPillar.pillar,
      monthPillar: bazi.monthPillar.pillar,
      dayPillar: bazi.dayPillar.pillar,
    },
  };
}

const MENH_GROUP_BRANCHES: Readonly<Record<MenhBranchGroup, readonly number[]>> = {
  TU_CHINH: [0, 3, 6, 9],
  TU_MO: [1, 4, 7, 10],
  TU_SINH: [2, 5, 8, 11],
};

function normalizePalaceKey(name: string): string {
  const trimmed = name.trim();
  return trimmed === 'Giao Hữu' || trimmed === 'Nô Bộc' ? 'Nô Bộc' : trimmed;
}

function findZiweiPalace(ziwei: ZiweiChartIR, palaceQuery: string): ZiweiPalaceIR | undefined {
  const target = normalizePalaceKey(palaceQuery);
  if (target === 'Thân') {
    return ziwei.palaces.find((p) => p.isThan || p.branchIndex === ziwei.thanBranch);
  }
  return ziwei.palaces.find((p) => normalizePalaceKey(p.palaceName) === target);
}

export function computeCertaintyPriorWeights(
  mode: BirthTimeCertaintyMode,
  ambiguousBranches: readonly number[] = [],
  centerBranch?: number | undefined,
  window?: BirthTimeWindow | undefined,
): number[] {
  if (mode === 'UNKNOWN') {
    return new Array<number>(12).fill(1);
  }
  if (mode === 'TIME_WINDOW') {
    const w = new Array<number>(12).fill(5);
    if (window === 'SANG') {
      for (const b of [3, 4, 5]) w[b] = 280;
      for (const b of [2, 6]) w[b] = 65;
      return w;
    }
    if (window === 'TRUA') {
      w.fill(8);
      w[6] = 500;
      for (const b of [5, 7]) w[b] = 190;
      for (const b of [4, 8]) w[b] = 30;
      return w;
    }
    if (window === 'CHIEU') {
      for (const b of [7, 8, 9]) w[b] = 280;
      for (const b of [6, 10]) w[b] = 65;
      return w;
    }
    if (window === 'TOI') {
      w.fill(7);
      for (const b of [9, 10]) w[b] = 320;
      w[11] = 220;
      for (const b of [8, 0]) w[b] = 45;
      return w;
    }
    if (window === 'DEM') {
      for (const b of [11, 0, 1, 2]) w[b] = 225;
      for (const b of [10, 3]) w[b] = 35;
      return w;
    }
    return new Array<number>(12).fill(1);
  }

  // EXACT_TIME
  const uniqueAmbig = Array.from(new Set(ambiguousBranches.map((b) => floorMod(Math.trunc(b), 12))));
  const center =
    centerBranch !== undefined ? floorMod(Math.trunc(centerBranch), 12) : (uniqueAmbig[0] ?? 0);
  if (uniqueAmbig.length >= 2) {
    const w = new Array<number>(12).fill(10);
    for (const b of uniqueAmbig) w[b] = 450;
    w[center] = 480;
    return w;
  }
  const w = new Array<number>(12).fill(20);
  w[floorMod(center - 1, 12)] = 120;
  w[floorMod(center + 1, 12)] = 120;
  w[center] = 700;
  return w;
}

export function evalChartPredicate(predicate: ChartPredicate, chart: ChartIR): boolean {
  const ziwei = chart.ziweiNamPhai;
  switch (predicate.op) {
    case 'always':
      return true;
    case 'otherwise':
      return false;
    case 'shichen_in':
      return predicate.branches.includes(chart.temporal.trueSolarTime.shichenBranch);
    case 'menh_vo_chinh_dieu': {
      const menh = ziwei.palaces[ziwei.menhBranch] ?? findZiweiPalace(ziwei, 'Mệnh');
      return menh ? Boolean(menh.voChinhDieu) === predicate.expected : false;
    }
    case 'menh_branch_parity':
      return floorMod(ziwei.menhBranch, 2) === predicate.parity;
    case 'menh_branch_group':
      return MENH_GROUP_BRANCHES[predicate.group].includes(floorMod(ziwei.menhBranch, 12));
    case 'cuc_in':
      return predicate.cucNumbers.includes(ziwei.cucNumber);
    case 'than_palace_in': {
      const thanPalace = ziwei.palaces.find((p) => p.isThan || p.branchIndex === ziwei.thanBranch);
      if (!thanPalace) return false;
      const actual = normalizePalaceKey(thanPalace.palaceName);
      return predicate.palaces.some((p) => normalizePalaceKey(p) === actual);
    }
    case 'palace_has_any_star': {
      const palace = findZiweiPalace(ziwei, predicate.palace);
      if (!palace) return false;
      const starSet = new Set(predicate.stars);
      return (
        palace.majorStars.some((s) => starSet.has(s.name)) ||
        palace.minorStars.some((s) => starSet.has(s.name))
      );
    }
    case 'palace_has_sihua': {
      const palace = findZiweiPalace(ziwei, predicate.palace);
      if (!palace) return false;
      const tSet = new Set<string>(predicate.transforms);
      return (
        palace.majorStars.some((s) => s.sihuaTransform !== null && tSet.has(s.sihuaTransform)) ||
        palace.minorStars.some((s) => s.sihuaTransform !== null && tSet.has(s.sihuaTransform))
      );
    }
    case 'palace_has_tuan_triet': {
      const palace = findZiweiPalace(ziwei, predicate.palace);
      return palace ? Boolean(palace.tuanTrung || palace.trietLo) : false;
    }
    case 'and':
      return predicate.args.every((arg) => evalChartPredicate(arg, chart));
    case 'or':
      return predicate.args.some((arg) => evalChartPredicate(arg, chart));
  }
}

export function extractChartRectificationFeatures(chart: ChartIR): ChartRectificationFeatures {
  const ziwei = chart.ziweiNamPhai;
  const menhPalace = ziwei.palaces[ziwei.menhBranch] ?? findZiweiPalace(ziwei, 'Mệnh')!;
  const thanPalace =
    ziwei.palaces.find((p) => p.isThan || p.branchIndex === ziwei.thanBranch) ??
    ziwei.palaces[ziwei.thanBranch]!;
  const palaceSignatureTags: Record<string, string[]> = {};
  for (const p of ziwei.palaces) {
    const tags: string[] = [];
    for (const s of p.majorStars) {
      tags.push(s.name);
      if (s.sihuaTransform) tags.push(s.sihuaTransform);
    }
    for (const s of p.minorStars) {
      if (s.category !== 'ring') tags.push(s.name);
      if (s.sihuaTransform) tags.push(s.sihuaTransform);
    }
    if (p.tuanTrung) tags.push('Tuần');
    if (p.trietLo) tags.push('Triệt');
    palaceSignatureTags[p.palaceName] = tags;
  }

  return {
    shichenBranch: chart.temporal.trueSolarTime.shichenBranch,
    shichenBranchVi: chart.temporal.trueSolarTime.shichenBranchVi,
    menhBranch: ziwei.menhBranch,
    thanBranch: ziwei.thanBranch,
    thanPalaceName: thanPalace.palaceName,
    cucNumber: ziwei.cucNumber,
    menhVoChinhDieu: Boolean(menhPalace.voChinhDieu),
    menhParity: (floorMod(ziwei.menhBranch, 2) === 0 ? 0 : 1) as 0 | 1,
    menhMajorStars: menhPalace.majorStars.map((s) => s.name),
    palaceSignatureTags,
  };
}

function distributeIntTotal(total: number, indices: readonly number[], out: number[]): void {
  const n = indices.length;
  if (n === 0) return;
  const base = Math.floor(total / n);
  const rem = total % n;
  for (let i = 0; i < n; i++) {
    out[indices[i]!] = base + (i < rem ? 1 : 0);
  }
}

export function compileChartConditionedBank(
  candidateCharts: readonly ChartIR[],
  bank: readonly RectificationQuestion[] = PUBLIC_RECTIFICATION_QUESTIONS,
): RectificationQuestion[] {
  const chartByBranch = new Map<number, ChartIR>();
  for (const chart of candidateCharts) {
    chartByBranch.set(floorMod(chart.temporal.trueSolarTime.shichenBranch, 12), chart);
  }

  return bank.map((q) => {
    const preds = q.chartPredicates ?? null;
    if (!preds) {
      return {
        id: q.id,
        category: q.category,
        ageCohort: q.ageCohort ?? null,
        minAge: q.minAge ?? null,
        maxAge: q.maxAge ?? null,
        promptVi: q.promptVi,
        options: q.options.map((o) => ({ id: o.id, labelVi: o.labelVi })),
        likelihoodMatrixMicro: q.likelihoodMatrixMicro,
        chartPredicates: null,
      };
    }

    const optCount = q.options.length;
    const cols: number[][] = Array.from({ length: optCount }, () => new Array<number>(12).fill(0));
    const naIndices: number[] = [];
    const subIndices: number[] = [];
    const otherwiseIndices: number[] = [];

    for (let o = 0; o < optCount; o++) {
      const optId = q.options[o]!.id;
      const pred = preds[optId];
      if (!pred && (optId === 'OPT_NA' || optId.endsWith('_NA'))) {
        naIndices.push(o);
      } else {
        subIndices.push(o);
        if (pred && pred.op === 'otherwise') {
          otherwiseIndices.push(o);
        }
      }
    }

    for (let b = 0; b < 12; b++) {
      const chart = chartByBranch.get(b);
      if (!chart) {
        const rawCol: number[] = [];
        for (let o = 0; o < optCount; o++) {
          rawCol.push(getRawLikelihood(q, o, q.options[o]!.id, b));
        }
        const norm = normalizeMicroProbs(rawCol);
        for (let o = 0; o < optCount; o++) {
          cols[o]![b] = norm[o]!;
        }
        continue;
      }

      const naProbTotal = naIndices.length > 0 ? 80_000 : 0;
      const subBudget = MICRO_SCALE - naProbTotal;
      const col = new Array<number>(optCount).fill(0);
      distributeIntTotal(naProbTotal, naIndices, col);

      const hitIndices: number[] = [];
      const missIndices: number[] = [];
      for (const o of subIndices) {
        const pred = preds[q.options[o]!.id];
        if (pred && evalChartPredicate(pred, chart)) {
          hitIndices.push(o);
        } else {
          missIndices.push(o);
        }
      }

      if (hitIndices.length > 0 && missIndices.length > 0) {
        const hitBudget = naIndices.length > 0 ? 760_000 : 820_000;
        const missBudget = subBudget - hitBudget;
        distributeIntTotal(hitBudget, hitIndices, col);
        distributeIntTotal(missBudget, missIndices, col);
      } else if (hitIndices.length === 0 && otherwiseIndices.length > 0 && otherwiseIndices.length < subIndices.length) {
        const nonOther = subIndices.filter((o) => !otherwiseIndices.includes(o));
        const otherBudget = naIndices.length > 0 ? 720_000 : 780_000;
        const remBudget = subBudget - otherBudget;
        distributeIntTotal(otherBudget, otherwiseIndices, col);
        distributeIntTotal(remBudget, nonOther, col);
      } else {
        distributeIntTotal(subBudget, subIndices, col);
      }

      for (let o = 0; o < optCount; o++) {
        cols[o]![b] = col[o]!;
      }
    }

    const matrixRecord: Record<string, number[]> = {};
    for (let o = 0; o < optCount; o++) {
      matrixRecord[q.options[o]!.id] = cols[o]!;
    }

    return {
      id: q.id,
      category: q.category,
      ageCohort: q.ageCohort ?? null,
      minAge: q.minAge ?? null,
      maxAge: q.maxAge ?? null,
      promptVi: q.promptVi,
      options: q.options.map((o) => ({ id: o.id, labelVi: o.labelVi })),
      likelihoodMatrixMicro: matrixRecord,
      chartPredicates: preds,
    };
  });
}

export function createRectificationSessionFromCharts(
  candidateCharts: readonly ChartIR[],
  options?: CreateRectificationSessionOptions,
): RectificationSession {
  if (candidateCharts.length === 0) {
    throw new Error('createRectificationSessionFromCharts requires at least 1 candidate ChartIR');
  }
  const sortedCharts = [...candidateCharts].sort(
    (a, b) => a.temporal.trueSolarTime.shichenBranch - b.temporal.trueSolarTime.shichenBranch,
  );
  const candidateBranches = Array.from(
    new Set(sortedCharts.map((c) => floorMod(c.temporal.trueSolarTime.shichenBranch, 12))),
  ).sort((a, b) => a - b);

  const mode: BirthTimeCertaintyMode = options?.mode ?? 'UNKNOWN';
  const priorWeights = computeCertaintyPriorWeights(
    mode,
    options?.ambiguousBranches ?? [],
    options?.centerBranch,
    options?.birthTimeWindow,
  );
  const maxQuestions = options?.maxQuestions ?? (mode === 'UNKNOWN' ? 6 : 5);
  const state = createInitialRectificationState({
    candidateBranches,
    priorWeights,
    maxQuestions,
    userAge: options?.userAge ?? null,
  });
  const compiledBank = compileChartConditionedBank(
    sortedCharts,
    options?.questionBank ?? PUBLIC_RECTIFICATION_QUESTIONS,
  );
  const chartFeatures = sortedCharts.map(extractChartRectificationFeatures);

  return {
    state,
    compiledBank,
    chartFeatures,
  };
}
