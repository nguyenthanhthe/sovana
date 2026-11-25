"""Maximum-Information-Gain (Shannon Entropy) Anti-Barnum Bayesian Rectification."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any, cast

from sovana.geo_time.ephemeris import BRANCHES_VI, floor_mod, js_round
from sovana.geo_time.models import PillarPair, SovanaModel
from sovana.solver.models import (
    BirthTimeCertaintyMode,
    BirthTimeWindow,
    ChartPredicate,
    ChartRectificationFeatures,
    InvariantBaziPillars,
    InvariantIntersectionReport,
    MenhBranchGroup,
    ProvenanceNode,
    QuestionSelectionResult,
    RectificationAnswerRecord,
    RectificationCandidate,
    RectificationCategory,
    RectificationOption,
    RectificationQuestion,
    RectificationSession,
    RectificationState,
    RectificationStatus,
    SolverReportIR,
)

MICRO_SCALE = 1_000_000
SURVIVING_THRESHOLD_MICRO = 50_000
LOCK_PROB_THRESHOLD_MICRO = 800_000
LOCK_RATIO_MULTIPLIER = 3

ALLOWED_CATEGORIES: frozenset[str] = frozenset(
    {
        "RETRODICTIVE_TIMELINE",
        "SOMATIC_MEDICAL",
        "KINSHIP_TOPOLOGY",
    }
)


def normalize_micro_probs(weights: Sequence[int]) -> list[int]:
    """Exact zero-float Largest Remainder normalization in arbitrary-precision int."""
    n = len(weights)
    if n == 0:
        raise ValueError("Cannot normalize empty probability weight vector")

    clean_weights = [max(0, int(w)) for w in weights]
    total = sum(clean_weights)
    effective_weights = [1] * n if total == 0 else clean_weights
    effective_sum = n if total == 0 else total

    quotients: list[int] = [0] * n
    remainders: list[tuple[int, int]] = []
    q_sum = 0

    for i, w in enumerate(effective_weights):
        scaled = w * MICRO_SCALE
        q = scaled // effective_sum
        r = scaled % effective_sum
        quotients[i] = q
        q_sum += q
        remainders.append((r, i))

    deficit = MICRO_SCALE - q_sum
    remainders.sort(key=lambda item: (-item[0], item[1]))
    for k in range(deficit):
        idx = remainders[k][1]
        quotients[idx] += 1

    return quotients


def _entropy_bits_float(probs_micro: Sequence[int]) -> float:
    h = 0.0
    for p in probs_micro:
        if p > 0:
            ratio = p / MICRO_SCALE
            h -= ratio * math.log2(ratio)
    return 0.0 if h < 0.0 else h


def compute_entropy_millibits(probs_micro: Sequence[int]) -> int:
    return js_round(_entropy_bits_float(probs_micro) * 1000.0)


PUBLIC_RECTIFICATION_QUESTIONS: tuple[RectificationQuestion, ...] = (
    RectificationQuestion(
        id="Q-01",
        category="SOMATIC_MEDICAL",
        age_cohort=None,
        min_age=0,
        max_age=120,
        prompt_vi=(
            "Vào thời thơ ấu (khi chưa bị ép giờ đi học), nhịp tỉnh táo tự nhiên "
            "nhất trong ngày của bạn nghiêng về buổi nào?"
        ),
        options=[
            RectificationOption(
                id="OPT_DAWN_MORN",
                label_vi="Dậy sớm từ rạng sáng và tỉnh táo nhất suốt buổi sáng",
            ),
            RectificationOption(
                id="OPT_NOON_DUSK",
                label_vi="Tỉnh táo mạnh mẽ nhất từ trưa cho tới chiều muộn",
            ),
            RectificationOption(
                id="OPT_NIGHT_LATE",
                label_vi="Tỉnh táo rõ nhất vào buổi tối khuya đến nửa đêm",
            ),
            RectificationOption(
                id="OPT_NA",
                label_vi="Không rõ / Đồng đều mọi buổi trong ngày",
            ),
        ],
        likelihood_matrix_micro={
            "OPT_DAWN_MORN": [
                60000, 60000, 780000, 780000, 780000, 780000,
                60000, 60000, 60000, 60000, 60000, 60000,
            ],
            "OPT_NOON_DUSK": [
                60000, 60000, 60000, 60000, 60000, 60000,
                780000, 780000, 780000, 780000, 60000, 60000,
            ],
            "OPT_NIGHT_LATE": [
                780000, 780000, 60000, 60000, 60000, 60000,
                60000, 60000, 60000, 60000, 780000, 780000,
            ],
            "OPT_NA": [
                100000, 100000, 100000, 100000, 100000, 100000,
                100000, 100000, 100000, 100000, 100000, 100000,
            ],
        },
        chart_predicates={
            "OPT_DAWN_MORN": {"op": "shichen_in", "branches": [2, 3, 4, 5]},
            "OPT_NOON_DUSK": {"op": "shichen_in", "branches": [6, 7, 8, 9]},
            "OPT_NIGHT_LATE": {"op": "shichen_in", "branches": [10, 11, 0, 1]},
        },
    ),
    RectificationQuestion(
        id="Q-02",
        category="KINSHIP_TOPOLOGY",
        age_cohort=None,
        min_age=0,
        max_age=120,
        prompt_vi=(
            "Cấu trúc thực tế giữa bạn và anh chị em ruột trong gia đình khớp "
            "với tình huống nào nhất?"
        ),
        options=[
            RectificationOption(
                id="OPT_THUY_CUC",
                label_vi="Là con một, hoặc con trưởng sống tách tự lập sớm xa anh em",
            ),
            RectificationOption(
                id="OPT_KIM_CUC",
                label_vi=(
                    "Anh chị em cách tuổi nhau rõ (từ 4 năm trở lên) và ít ở chung dài ngày"
                ),
            ),
            RectificationOption(
                id="OPT_HOA_CUC",
                label_vi="Có anh chị em gần tuổi (cách 1–3 năm) và bạn thường gánh vác việc chung",
            ),
            RectificationOption(
                id="OPT_MOC_CUC",
                label_vi="Gia đình đông anh chị em (từ 3 người trở lên) gắn bó hỗ trợ nhau",
            ),
            RectificationOption(
                id="OPT_NA",
                label_vi="Không rõ / Không thuộc các mẫu trên",
            ),
        ],
        likelihood_matrix_micro={
            "OPT_THUY_CUC": [
                790000, 40000, 40000, 40000, 790000, 40000,
                40000, 40000, 790000, 40000, 40000, 40000,
            ],
            "OPT_KIM_CUC": [
                40000, 790000, 40000, 40000, 40000, 790000,
                40000, 40000, 40000, 790000, 40000, 40000,
            ],
            "OPT_HOA_CUC": [
                40000, 40000, 790000, 40000, 40000, 40000,
                790000, 40000, 40000, 40000, 790000, 40000,
            ],
            "OPT_MOC_CUC": [
                40000, 40000, 40000, 790000, 40000, 40000,
                40000, 790000, 40000, 40000, 40000, 790000,
            ],
            "OPT_NA": [
                90000, 90000, 90000, 90000, 90000, 90000,
                90000, 90000, 90000, 90000, 90000, 90000,
            ],
        },
        chart_predicates={
            "OPT_THUY_CUC": {
                "op": "or",
                "args": [
                    {"op": "cuc_in", "cucNumbers": [2]},
                    {
                        "op": "palace_has_any_star",
                        "palace": "Huynh Đệ",
                        "stars": ["Cô Thần", "Quả Tú", "Đà La"],
                    },
                ],
            },
            "OPT_KIM_CUC": {
                "op": "or",
                "args": [
                    {"op": "cuc_in", "cucNumbers": [4]},
                    {
                        "op": "palace_has_any_star",
                        "palace": "Huynh Đệ",
                        "stars": ["Thất Sát", "Kình Dương", "Vũ Khúc"],
                    },
                ],
            },
            "OPT_HOA_CUC": {
                "op": "or",
                "args": [
                    {"op": "cuc_in", "cucNumbers": [6]},
                    {
                        "op": "palace_has_any_star",
                        "palace": "Huynh Đệ",
                        "stars": ["Thái Dương", "Thiên Tướng"],
                    },
                    {
                        "op": "palace_has_sihua",
                        "palace": "Huynh Đệ",
                        "transforms": ["Hóa Quyền"],
                    },
                ],
            },
            "OPT_MOC_CUC": {
                "op": "or",
                "args": [
                    {"op": "cuc_in", "cucNumbers": [3, 5]},
                    {
                        "op": "palace_has_any_star",
                        "palace": "Huynh Đệ",
                        "stars": ["Thiên Phủ", "Thái Âm", "Thiên Đồng", "Tả Phụ", "Hữu Bật"],
                    },
                ],
            },
        },
    ),
    RectificationQuestion(
        id="Q-03",
        category="RETRODICTIVE_TIMELINE",
        age_cohort=None,
        min_age=0,
        max_age=120,
        prompt_vi=(
            "Trong 18 năm đầu đời, nơi ở và môi trường học tập của gia đình bạn "
            "diễn ra theo xu hướng nào?"
        ),
        options=[
            RectificationOption(
                id="OPT_TU_CHINH",
                label_vi=(
                    "Ở ổn định một địa phương, nhưng có một bước ngoặt đổi hướng rất dứt khoát"
                ),
            ),
            RectificationOption(
                id="OPT_TU_MO",
                label_vi=(
                    "Gắn bó lâu dài tại nhà cũ hoặc đất tổ tiên, hầu như không dời đổi chỗ ở"
                ),
            ),
            RectificationOption(
                id="OPT_TU_SINH",
                label_vi="Gia đình từng chuyển nhà nhiều lần hoặc bạn sớm rời quê đi học xa",
            ),
            RectificationOption(
                id="OPT_NA",
                label_vi="Không rõ / Thông tin trung tính",
            ),
        ],
        likelihood_matrix_micro={
            "OPT_TU_CHINH": [
                780000, 60000, 60000, 780000, 60000, 60000,
                780000, 60000, 60000, 780000, 60000, 60000,
            ],
            "OPT_TU_MO": [
                60000, 780000, 60000, 60000, 780000, 60000,
                60000, 780000, 60000, 60000, 780000, 60000,
            ],
            "OPT_TU_SINH": [
                60000, 60000, 780000, 60000, 60000, 780000,
                60000, 60000, 780000, 60000, 60000, 780000,
            ],
            "OPT_NA": [
                100000, 100000, 100000, 100000, 100000, 100000,
                100000, 100000, 100000, 100000, 100000, 100000,
            ],
        },
        chart_predicates={
            "OPT_TU_CHINH": {"op": "menh_branch_group", "group": "TU_CHINH"},
            "OPT_TU_MO": {"op": "menh_branch_group", "group": "TU_MO"},
            "OPT_TU_SINH": {"op": "menh_branch_group", "group": "TU_SINH"},
        },
    ),
    RectificationQuestion(
        id="Q-04",
        category="SOMATIC_MEDICAL",
        age_cohort=None,
        min_age=0,
        max_age=120,
        prompt_vi=(
            "Nếu từng có vết sẹo nhỏ, chấn thương nhẹ hoặc bên cơ thể dễ mỏi hơn, "
            "chúng tập trung ở phía nào?"
        ),
        options=[
            RectificationOption(
                id="OPT_YANG_BRANCH",
                label_vi="Tập trung rõ hơn ở nửa bên trái cơ thể hoặc vùng đầu mặt",
            ),
            RectificationOption(
                id="OPT_YIN_BRANCH",
                label_vi="Tập trung rõ hơn ở nửa bên phải cơ thể",
            ),
            RectificationOption(
                id="OPT_NA",
                label_vi="Không rõ / Cân bằng cả hai bên hoặc chưa từng có",
            ),
        ],
        likelihood_matrix_micro={
            "OPT_YANG_BRANCH": [
                800000, 100000, 800000, 100000, 800000, 100000,
                800000, 100000, 800000, 100000, 800000, 100000,
            ],
            "OPT_YIN_BRANCH": [
                100000, 800000, 100000, 800000, 100000, 800000,
                100000, 800000, 100000, 800000, 100000, 800000,
            ],
            "OPT_NA": [
                100000, 100000, 100000, 100000, 100000, 100000,
                100000, 100000, 100000, 100000, 100000, 100000,
            ],
        },
        chart_predicates={
            "OPT_YANG_BRANCH": {"op": "menh_branch_parity", "parity": 0},
            "OPT_YIN_BRANCH": {"op": "menh_branch_parity", "parity": 1},
        },
    ),
    RectificationQuestion(
        id="Q-05",
        category="SOMATIC_MEDICAL",
        age_cohort=None,
        min_age=0,
        max_age=120,
        prompt_vi=(
            "Khi mệt mỏi kéo dài hoặc thời tiết đổi mùa, biểu hiện cơ địa nào "
            "xuất hiện rõ hơn ở bạn?"
        ),
        options=[
            RectificationOption(
                id="OPT_TY",
                label_vi="Dễ lạnh bàn tay bàn chân hoặc đau mỏi vùng thắt lưng",
            ),
            RectificationOption(
                id="OPT_NGO",
                label_vi="Dễ bốc nóng mặt, nhiệt miệng hoặc mỏi rát mắt khi thiếu ngủ",
            ),
            RectificationOption(
                id="OPT_OTHER_05",
                label_vi="Không có biểu hiện nào trong hai nhóm trên",
            ),
            RectificationOption(id="OPT_NA", label_vi="Không rõ"),
        ],
        likelihood_matrix_micro={
            "OPT_TY": [
                760000, 100000, 100000, 100000, 100000, 100000,
                80000, 100000, 100000, 100000, 100000, 100000,
            ],
            "OPT_NGO": [
                80000, 100000, 100000, 100000, 100000, 100000,
                760000, 100000, 100000, 100000, 100000, 100000,
            ],
            "OPT_OTHER_05": [
                80000, 720000, 720000, 720000, 720000, 720000,
                80000, 720000, 720000, 720000, 720000, 720000,
            ],
            "OPT_NA": [
                80000, 80000, 80000, 80000, 80000, 80000,
                80000, 80000, 80000, 80000, 80000, 80000,
            ],
        },
        chart_predicates={
            "OPT_TY": {"op": "shichen_in", "branches": [0]},
            "OPT_NGO": {"op": "shichen_in", "branches": [6]},
            "OPT_OTHER_05": {"op": "otherwise"},
        },
    ),
    RectificationQuestion(
        id="Q-06",
        category="SOMATIC_MEDICAL",
        age_cohort=None,
        min_age=0,
        max_age=120,
        prompt_vi=(
            "Khi ăn uống thất thường hoặc căng thẳng công việc, phản ứng tiêu hóa "
            "nào hay gặp nhất ở bạn?"
        ),
        options=[
            RectificationOption(
                id="OPT_SUU",
                label_vi="Hay căng tức vùng hạ sườn hoặc khó ngủ lại lúc nửa đêm về sáng",
            ),
            RectificationOption(
                id="OPT_MUI",
                label_vi="Dễ trào ngược dạ dày hoặc đầy hơi chướng bụng vào đầu giờ chiều",
            ),
            RectificationOption(
                id="OPT_OTHER_06",
                label_vi="Hệ tiêu hóa ổn định, không gặp hai dấu hiệu trên",
            ),
            RectificationOption(id="OPT_NA", label_vi="Không rõ"),
        ],
        likelihood_matrix_micro={
            "OPT_SUU": [
                100000, 760000, 100000, 100000, 100000, 100000,
                100000, 80000, 100000, 100000, 100000, 100000,
            ],
            "OPT_MUI": [
                100000, 80000, 100000, 100000, 100000, 100000,
                100000, 760000, 100000, 100000, 100000, 100000,
            ],
            "OPT_OTHER_06": [
                720000, 80000, 720000, 720000, 720000, 720000,
                720000, 80000, 720000, 720000, 720000, 720000,
            ],
            "OPT_NA": [
                80000, 80000, 80000, 80000, 80000, 80000,
                80000, 80000, 80000, 80000, 80000, 80000,
            ],
        },
        chart_predicates={
            "OPT_SUU": {"op": "shichen_in", "branches": [1]},
            "OPT_MUI": {"op": "shichen_in", "branches": [7]},
            "OPT_OTHER_06": {"op": "otherwise"},
        },
    ),
    RectificationQuestion(
        id="Q-07",
        category="SOMATIC_MEDICAL",
        age_cohort=None,
        min_age=0,
        max_age=120,
        prompt_vi=(
            "Khi trời trở lạnh hoặc hanh khô kéo dài, dấu hiệu cơ địa nào "
            "xuất hiện rõ hơn?"
        ),
        options=[
            RectificationOption(
                id="OPT_DAN",
                label_vi="Nhạy cảm đường hô hấp trên, dễ ho khan hoặc nghẹt mũi lúc sáng sớm",
            ),
            RectificationOption(
                id="OPT_THAN",
                label_vi="Hay khát nước về chiều, dễ tiểu đêm hoặc mỏi bắp chân khi trời lạnh",
            ),
            RectificationOption(
                id="OPT_OTHER_07",
                label_vi="Không có biểu hiện nào trong hai nhóm trên",
            ),
            RectificationOption(id="OPT_NA", label_vi="Không rõ"),
        ],
        likelihood_matrix_micro={
            "OPT_DAN": [
                100000, 100000, 760000, 100000, 100000, 100000,
                100000, 100000, 80000, 100000, 100000, 100000,
            ],
            "OPT_THAN": [
                100000, 100000, 80000, 100000, 100000, 100000,
                100000, 100000, 760000, 100000, 100000, 100000,
            ],
            "OPT_OTHER_07": [
                720000, 720000, 80000, 720000, 720000, 720000,
                720000, 720000, 80000, 720000, 720000, 720000,
            ],
            "OPT_NA": [
                80000, 80000, 80000, 80000, 80000, 80000,
                80000, 80000, 80000, 80000, 80000, 80000,
            ],
        },
        chart_predicates={
            "OPT_DAN": {"op": "shichen_in", "branches": [2]},
            "OPT_THAN": {"op": "shichen_in", "branches": [8]},
            "OPT_OTHER_07": {"op": "otherwise"},
        },
    ),
    RectificationQuestion(
        id="Q-08",
        category="SOMATIC_MEDICAL",
        age_cohort=None,
        min_age=0,
        max_age=120,
        prompt_vi=(
            "Về cơ địa dị ứng hoặc nhạy cảm niêm mạc hàng ngày, bạn hay gặp "
            "tình huống nào hơn?"
        ),
        options=[
            RectificationOption(
                id="OPT_MAO",
                label_vi="Đường ruột nhạy cảm với đồ lạnh hoặc sữa vào buổi sáng sớm",
            ),
            RectificationOption(
                id="OPT_DAU",
                label_vi="Viêm mũi dị ứng hoặc khô rát họng mỗi khi gió lạnh buổi chiều tối",
            ),
            RectificationOption(
                id="OPT_OTHER_08",
                label_vi="Không có cơ địa nhạy cảm ở cả hai nhóm trên",
            ),
            RectificationOption(id="OPT_NA", label_vi="Không rõ"),
        ],
        likelihood_matrix_micro={
            "OPT_MAO": [
                100000, 100000, 100000, 760000, 100000, 100000,
                100000, 100000, 100000, 80000, 100000, 100000,
            ],
            "OPT_DAU": [
                100000, 100000, 100000, 80000, 100000, 100000,
                100000, 100000, 100000, 760000, 100000, 100000,
            ],
            "OPT_OTHER_08": [
                720000, 720000, 720000, 80000, 720000, 720000,
                720000, 720000, 720000, 80000, 720000, 720000,
            ],
            "OPT_NA": [
                80000, 80000, 80000, 80000, 80000, 80000,
                80000, 80000, 80000, 80000, 80000, 80000,
            ],
        },
        chart_predicates={
            "OPT_MAO": {"op": "shichen_in", "branches": [3]},
            "OPT_DAU": {"op": "shichen_in", "branches": [9]},
            "OPT_OTHER_08": {"op": "otherwise"},
        },
    ),
    RectificationQuestion(
        id="Q-09",
        category="SOMATIC_MEDICAL",
        age_cohort=None,
        min_age=0,
        max_age=120,
        prompt_vi=(
            "Trong nhịp sinh hoạt hàng ngày, vấn đề thể chất nào ảnh hưởng "
            "tới bạn rõ rệt hơn?"
        ),
        options=[
            RectificationOption(
                id="OPT_THIN",
                label_vi="Hễ trễ bữa sáng là đau rát thượng vị hoặc cồn cào dạ dày ngay",
            ),
            RectificationOption(
                id="OPT_TUAT",
                label_vi="Khó thư giãn vùng cổ vai gáy vào buổi tối khiến khó vào giấc ngủ sớm",
            ),
            RectificationOption(
                id="OPT_OTHER_09",
                label_vi="Không gặp cả hai vấn đề trên",
            ),
            RectificationOption(id="OPT_NA", label_vi="Không rõ"),
        ],
        likelihood_matrix_micro={
            "OPT_THIN": [
                100000, 100000, 100000, 100000, 760000, 100000,
                100000, 100000, 100000, 100000, 80000, 100000,
            ],
            "OPT_TUAT": [
                100000, 100000, 100000, 100000, 80000, 100000,
                100000, 100000, 100000, 100000, 760000, 100000,
            ],
            "OPT_OTHER_09": [
                720000, 720000, 720000, 720000, 80000, 720000,
                720000, 720000, 720000, 720000, 80000, 720000,
            ],
            "OPT_NA": [
                80000, 80000, 80000, 80000, 80000, 80000,
                80000, 80000, 80000, 80000, 80000, 80000,
            ],
        },
        chart_predicates={
            "OPT_THIN": {"op": "shichen_in", "branches": [4]},
            "OPT_TUAT": {"op": "shichen_in", "branches": [10]},
            "OPT_OTHER_09": {"op": "otherwise"},
        },
    ),
    RectificationQuestion(
        id="Q-10",
        category="KINSHIP_TOPOLOGY",
        age_cohort=None,
        min_age=0,
        max_age=120,
        prompt_vi=(
            "Theo lời kể của mẹ hoặc giấy chứng sinh, ca sinh của bạn diễn ra "
            "trong tình huống nào?"
        ),
        options=[
            RectificationOption(
                id="OPT_TY_SNAKE",
                label_vi="Sinh thường nhanh thuận lợi vào ban ngày trời sáng",
            ),
            RectificationOption(
                id="OPT_HOI",
                label_vi=(
                    "Ca sinh vào đêm muộn hoặc có can thiệp sản khoa "
                    "(sinh khó, sinh mổ, dây rốn quấn cổ)"
                ),
            ),
            RectificationOption(
                id="OPT_OTHER_10",
                label_vi="Ca sinh bình thường nhưng không thuộc hai tình huống trên",
            ),
            RectificationOption(id="OPT_NA", label_vi="Không còn thông tin lúc sinh"),
        ],
        likelihood_matrix_micro={
            "OPT_TY_SNAKE": [
                100000, 100000, 100000, 100000, 100000, 760000,
                100000, 100000, 100000, 100000, 100000, 80000,
            ],
            "OPT_HOI": [
                100000, 100000, 100000, 100000, 100000, 80000,
                100000, 100000, 100000, 100000, 100000, 760000,
            ],
            "OPT_OTHER_10": [
                720000, 720000, 720000, 720000, 720000, 80000,
                720000, 720000, 720000, 720000, 720000, 80000,
            ],
            "OPT_NA": [
                80000, 80000, 80000, 80000, 80000, 80000,
                80000, 80000, 80000, 80000, 80000, 80000,
            ],
        },
        chart_predicates={
            "OPT_TY_SNAKE": {"op": "shichen_in", "branches": [5]},
            "OPT_HOI": {"op": "shichen_in", "branches": [11]},
            "OPT_OTHER_10": {"op": "otherwise"},
        },
    ),
    RectificationQuestion(
        id="Q-11",
        category="KINSHIP_TOPOLOGY",
        age_cohort=None,
        min_age=0,
        max_age=120,
        prompt_vi=(
            "Nghề nghiệp chủ đạo của cha mẹ trong giai đoạn nuôi dưỡng bạn "
            "thuộc nhóm nào?"
        ),
        options=[
            RectificationOption(
                id="OPT_GAP_A",
                label_vi=(
                    "Nghề có tính biến động cao (tự doanh nhỏ, đổi việc hoặc "
                    "chuyển công tác nhiều)"
                ),
            ),
            RectificationOption(
                id="OPT_GAP_B",
                label_vi="Ngành hành chính, giáo dục, y tế hoặc chuyên môn ổn định lâu năm",
            ),
            RectificationOption(
                id="OPT_GAP_C",
                label_vi="Kinh doanh thương mại, kỹ thuật hoặc làm việc ở nơi xa gia đình",
            ),
            RectificationOption(id="OPT_NA", label_vi="Không rõ / Đa dạng khác"),
        ],
        likelihood_matrix_micro={
            "OPT_GAP_A": [
                70000, 760000, 760000, 70000, 70000, 70000,
                70000, 760000, 760000, 70000, 70000, 70000,
            ],
            "OPT_GAP_B": [
                70000, 70000, 70000, 760000, 760000, 70000,
                70000, 70000, 70000, 760000, 760000, 70000,
            ],
            "OPT_GAP_C": [
                760000, 70000, 70000, 70000, 70000, 760000,
                760000, 70000, 70000, 70000, 70000, 760000,
            ],
            "OPT_NA": [
                100000, 100000, 100000, 100000, 100000, 100000,
                100000, 100000, 100000, 100000, 100000, 100000,
            ],
        },
        chart_predicates={
            "OPT_GAP_A": {
                "op": "palace_has_any_star",
                "palace": "Phụ Mẫu",
                "stars": ["Thất Sát", "Phá Quân", "Tham Lang", "Thiên Mã"],
            },
            "OPT_GAP_B": {
                "op": "palace_has_any_star",
                "palace": "Phụ Mẫu",
                "stars": ["Thiên Phủ", "Thiên Lương", "Thiên Tướng", "Văn Xương", "Văn Khúc"],
            },
            "OPT_GAP_C": {
                "op": "palace_has_any_star",
                "palace": "Phụ Mẫu",
                "stars": ["Vũ Khúc", "Thái Dương", "Cự Môn", "Lộc Tồn"],
            },
        },
    ),
    RectificationQuestion(
        id="Q-12",
        category="RETRODICTIVE_TIMELINE",
        age_cohort=None,
        min_age=12,
        max_age=120,
        prompt_vi="Trong giai đoạn 12–18 tuổi, dấu mốc thực tế nổi bật nhất của bạn là gì?",
        options=[
            RectificationOption(
                id="OPT_REV_A",
                label_vi="Chuyển trường chuyên, lớp chọn hoặc chuyển môi trường học xa nhà",
            ),
            RectificationOption(
                id="OPT_REV_B",
                label_vi="Gia đình trải qua biến động rõ rệt về nhà cửa hoặc tài chính",
            ),
            RectificationOption(
                id="OPT_REV_C",
                label_vi=(
                    "Đảm nhận vai trò lớp trưởng, đội trưởng hoặc đạt giải thưởng "
                    "thành tích nổi bật"
                ),
            ),
            RectificationOption(
                id="OPT_NA",
                label_vi="Giai đoạn học tập bình lặng, không có biến cố nổi bật",
            ),
        ],
        likelihood_matrix_micro={
            "OPT_REV_A": [
                70000, 70000, 760000, 760000, 70000, 70000,
                70000, 70000, 760000, 760000, 70000, 70000,
            ],
            "OPT_REV_B": [
                760000, 760000, 70000, 70000, 760000, 760000,
                70000, 70000, 70000, 70000, 70000, 70000,
            ],
            "OPT_REV_C": [
                70000, 70000, 70000, 70000, 70000, 70000,
                760000, 760000, 70000, 70000, 760000, 760000,
            ],
            "OPT_NA": [
                100000, 100000, 100000, 100000, 100000, 100000,
                100000, 100000, 100000, 100000, 100000, 100000,
            ],
        },
        chart_predicates={
            "OPT_REV_A": {
                "op": "or",
                "args": [
                    {
                        "op": "palace_has_any_star",
                        "palace": "Thiên Di",
                        "stars": ["Thiên Mã", "Thái Dương", "Thiên Cơ"],
                    },
                    {
                        "op": "palace_has_sihua",
                        "palace": "Quan Lộc",
                        "transforms": ["Hóa Khoa"],
                    },
                ],
            },
            "OPT_REV_B": {
                "op": "or",
                "args": [
                    {
                        "op": "palace_has_sihua",
                        "palace": "Điền Trạch",
                        "transforms": ["Hóa Kỵ"],
                    },
                    {
                        "op": "palace_has_tuan_triet",
                        "palace": "Phụ Mẫu",
                    },
                ],
            },
            "OPT_REV_C": {
                "op": "or",
                "args": [
                    {
                        "op": "palace_has_sihua",
                        "palace": "Mệnh",
                        "transforms": ["Hóa Quyền", "Hóa Khoa"],
                    },
                    {
                        "op": "palace_has_any_star",
                        "palace": "Mệnh",
                        "stars": ["Tử Vi", "Thái Dương", "Thiên Khôi", "Thiên Việt"],
                    },
                ],
            },
        },
    ),
)


def load_public_rectification_questions() -> list[RectificationQuestion]:
    return list(PUBLIC_RECTIFICATION_QUESTIONS)


def _coerce_question(q: RectificationQuestion | Mapping[str, Any]) -> RectificationQuestion:
    if isinstance(q, RectificationQuestion):
        return q
    cat = str(q.get("category", ""))
    if cat not in ALLOWED_CATEGORIES:
        raise ValueError(
            f"Anti-Barnum violation in question {q.get('id')!r}: category {cat!r} is forbidden; "
            "allowed categories are RETRODICTIVE_TIMELINE, SOMATIC_MEDICAL, KINSHIP_TOPOLOGY"
        )
    raw_opts = q.get("options")
    if not isinstance(raw_opts, Sequence) or isinstance(raw_opts, (str, bytes)):
        raise ValueError(f"Rectification question {q.get('id')!r} must define options list")
    opts = [
        o
        if isinstance(o, RectificationOption)
        else RectificationOption(
            id=str(o["id"]),
            label_vi=str(o.get("labelVi", o.get("label_vi", ""))),
        )
        for o in raw_opts
    ]
    age_cohort = q.get("ageCohort", q.get("age_cohort"))
    min_age = q.get("minAge", q.get("min_age"))
    max_age = q.get("maxAge", q.get("max_age"))
    return RectificationQuestion(
        id=str(q["id"]),
        category=cast(RectificationCategory, cat),
        age_cohort=str(age_cohort) if age_cohort is not None else None,
        min_age=int(min_age) if min_age is not None else None,
        max_age=int(max_age) if max_age is not None else None,
        prompt_vi=str(q.get("promptVi", q.get("prompt_vi", ""))),
        options=opts,
        likelihood_matrix_micro=q.get("likelihoodMatrixMicro", q.get("likelihood_matrix_micro")),
        chart_predicates=q.get("chartPredicates", q.get("chart_predicates")),
    )


def _get_raw_likelihood(
    question: RectificationQuestion,
    opt_idx: int,
    opt_id: str,
    branch: int,
) -> int:
    b = floor_mod(branch, 12)
    mat = question.likelihood_matrix_micro
    if isinstance(mat, Sequence) and not isinstance(mat, (str, bytes)):
        if opt_idx >= len(mat) or b >= len(mat[opt_idx]):
            raise ValueError(
                f"Missing likelihood entry for question {question.id!r}, "
                f"option {opt_id!r}, branch {b}"
            )
        return int(mat[opt_idx][b])
    if isinstance(mat, Mapping):
        entry = mat.get(opt_id)
        if entry is None:
            raise ValueError(
                f"Missing likelihood row for question {question.id!r}, option {opt_id!r}"
            )
        if isinstance(entry, Sequence) and not isinstance(entry, (str, bytes)):
            if b >= len(entry):
                raise ValueError(
                    f"Likelihood array for {question.id!r} option {opt_id!r} missing branch {b}"
                )
            return int(entry[b])
        if isinstance(entry, Mapping):
            val = entry.get(str(b), entry.get(b))
            if val is None:
                raise ValueError(
                    f"Likelihood map for {question.id!r} option {opt_id!r} missing branch {b}"
                )
            return int(val)
    raise ValueError(f"Unsupported likelihoodMatrixMicro format in question {question.id!r}")


def validate_question_bank(
    question_bank: Sequence[RectificationQuestion | Mapping[str, Any]],
) -> list[RectificationQuestion]:
    validated: list[RectificationQuestion] = []
    for raw_q in question_bank:
        if isinstance(raw_q, RectificationQuestion):
            cat_str = str(raw_q.category)
            if cat_str not in ALLOWED_CATEGORIES:
                raise ValueError(
                    f"Anti-Barnum violation in question {raw_q.id!r}: "
                    f"category {cat_str!r} is forbidden"
                )
            q = raw_q
        else:
            q = _coerce_question(raw_q)

        if len(q.options) < 2:
            raise ValueError(f"Rectification question {q.id!r} must define at least 2 options")
        for opt_idx, opt in enumerate(q.options):
            for b in range(12):
                val = _get_raw_likelihood(q, opt_idx, opt.id, b)
                if val <= 0:
                    raise ValueError(
                        f"Invalid likelihood {val} in question {q.id!r} "
                        f"option {opt.id!r} branch {b}"
                    )
        validated.append(q)
    return validated


def _build_normalized_column_matrix(question: RectificationQuestion) -> list[list[int]]:
    opt_count = len(question.options)
    table = [[0] * 12 for _ in range(opt_count)]
    for b in range(12):
        raw_col = [
            _get_raw_likelihood(question, o, question.options[o].id, b) for o in range(opt_count)
        ]
        norm_col = normalize_micro_probs(raw_col)
        for o in range(opt_count):
            table[o][b] = norm_col[o]
    return table


def _is_question_eligible_for_age(q: RectificationQuestion, user_age: int | None) -> bool:
    if user_age is None:
        return True
    if q.min_age is not None and user_age < q.min_age:
        return False
    if q.max_age is not None and user_age > q.max_age:
        return False
    return True


def _summarize_top_two(candidates: Sequence[RectificationCandidate]) -> tuple[int, int, int]:
    ordered = sorted(candidates, key=lambda c: (-c.prob_micro, c.shichen_branch))
    top1 = ordered[0].prob_micro if len(ordered) >= 1 else 0
    top2 = ordered[1].prob_micro if len(ordered) >= 2 else 0
    top_branch = ordered[0].shichen_branch if len(ordered) >= 1 else 0
    return top1, top2, top_branch


def _is_bayesian_locked(top1_prob_micro: int, top2_prob_micro: int) -> bool:
    return (
        top1_prob_micro >= LOCK_PROB_THRESHOLD_MICRO
        and top1_prob_micro >= LOCK_RATIO_MULTIPLIER * top2_prob_micro
    )


def create_initial_rectification_state(
    candidate_branches: Sequence[int] | None = None,
    prior_weights: Sequence[int] | Mapping[int, int] | None = None,
    max_questions: int = 5,
    user_age: int | None = None,
) -> RectificationState:
    raw_branches = candidate_branches if candidate_branches is not None else tuple(range(12))
    branches = sorted({floor_mod(int(b), 12) for b in raw_branches})
    if not branches:
        raise ValueError(
            "create_initial_rectification_state requires at least 1 candidate Shichen branch"
        )

    if prior_weights is None:
        raw_weights = [1] * len(branches)
    elif isinstance(prior_weights, Mapping):
        raw_weights = [int(prior_weights.get(b, 1)) for b in branches]
    else:
        seq_w = [int(x) for x in prior_weights]
        if len(seq_w) == len(branches):
            raw_weights = seq_w
        elif len(seq_w) == 12:
            raw_weights = [seq_w[b] for b in branches]
        else:
            raise ValueError("prior_weights length must match candidate_branches length or 12")

    probs_micro = normalize_micro_probs(raw_weights)
    candidates = [
        RectificationCandidate(
            shichen_branch=b,
            shichen_branch_vi=BRANCHES_VI[b],
            prob_micro=probs_micro[idx],
        )
        for idx, b in enumerate(branches)
    ]

    entropy_millibits = compute_entropy_millibits(probs_micro)
    top1, top2, top_branch = _summarize_top_two(candidates)
    locked = _is_bayesian_locked(top1, top2)

    status: RectificationStatus = (
        "LOCKED" if locked else ("INVARIANT_INTERSECTION" if max_questions <= 0 else "ACTIVE")
    )
    return RectificationState(
        schema_version="1.0.0",
        status=status,
        candidates=candidates,
        entropy_millibits=entropy_millibits,
        asked_question_ids=[],
        answers=[],
        max_questions=max_questions,
        user_age=user_age,
        locked_shichen_branch=top_branch if locked else None,
        top1_prob_micro=top1,
        top2_prob_micro=top2,
    )


def _coerce_state(state: RectificationState | Mapping[str, Any]) -> RectificationState:
    if isinstance(state, RectificationState):
        return state
    return RectificationState.model_validate(state)


def select_next_question(
    state: RectificationState | Mapping[str, Any],
    question_bank: Sequence[RectificationQuestion | Mapping[str, Any]] | None = None,
) -> QuestionSelectionResult | None:
    st = _coerce_state(state)
    bank = validate_question_bank(
        question_bank if question_bank is not None else PUBLIC_RECTIFICATION_QUESTIONS
    )

    if st.status != "ACTIVE" or len(st.answers) >= st.max_questions:
        return None

    asked_set = set(st.asked_question_ids)
    eligible = [
        q for q in bank if q.id not in asked_set and _is_question_eligible_for_age(q, st.user_age)
    ]
    if not eligible:
        return None

    prior_probs = [c.prob_micro for c in st.candidates]
    current_h_float = _entropy_bits_float(prior_probs)
    current_entropy_millibits = js_round(current_h_float * 1000.0)

    best_question: RectificationQuestion | None = None
    best_expected_post_millibits = current_entropy_millibits
    best_gain_millibits = -1
    best_gain_microbits = -1

    for q in eligible:
        col_matrix = _build_normalized_column_matrix(q)
        expected_post_h_float = 0.0

        for o in range(len(q.options)):
            opt_row = col_matrix[o]
            marginal_pico = 0
            unnorm_weights: list[int] = []

            for cand in st.candidates:
                l_micro = opt_row[cand.shichen_branch]
                w_pico = cand.prob_micro * l_micro
                unnorm_weights.append(w_pico)
                marginal_pico += w_pico

            if marginal_pico > 0:
                post_micro = normalize_micro_probs(unnorm_weights)
                post_h = _entropy_bits_float(post_micro)
                p_option = marginal_pico / 1_000_000_000_000.0
                expected_post_h_float += p_option * post_h

        expected_post_millibits = js_round(expected_post_h_float * 1000.0)
        gain_millibits = max(0, current_entropy_millibits - expected_post_millibits)
        gain_microbits = max(0, js_round((current_h_float - expected_post_h_float) * 1_000_000.0))

        is_better = (
            best_question is None
            or gain_millibits > best_gain_millibits
            or (gain_millibits == best_gain_millibits and gain_microbits > best_gain_microbits)
            or (
                gain_millibits == best_gain_millibits
                and gain_microbits == best_gain_microbits
                and q.id < best_question.id
            )
        )

        if is_better:
            best_question = q
            best_expected_post_millibits = expected_post_millibits
            best_gain_millibits = gain_millibits
            best_gain_microbits = gain_microbits

    if best_question is None:
        return None

    return QuestionSelectionResult(
        question=best_question,
        question_id=best_question.id,
        current_entropy_millibits=current_entropy_millibits,
        expected_posterior_entropy_millibits=best_expected_post_millibits,
        expected_info_gain_millibits=best_gain_millibits,
    )


def answer_question(
    state: RectificationState | Mapping[str, Any],
    question_id: str,
    answer_value: str,
    question_bank: Sequence[RectificationQuestion | Mapping[str, Any]] | None = None,
) -> RectificationState:
    st = _coerce_state(state)
    bank = validate_question_bank(
        question_bank if question_bank is not None else PUBLIC_RECTIFICATION_QUESTIONS
    )

    question = next((q for q in bank if q.id == question_id), None)
    if question is None:
        raise ValueError(f"Rectification question {question_id!r} not found in question bank")

    opt_index = next(
        (idx for idx, o in enumerate(question.options) if o.id == answer_value),
        -1,
    )
    if opt_index < 0:
        raise ValueError(
            f"Invalid option {answer_value!r} for rectification question {question_id!r}"
        )

    col_matrix = _build_normalized_column_matrix(question)
    opt_row = col_matrix[opt_index]

    unnorm_weights = [c.prob_micro * opt_row[c.shichen_branch] for c in st.candidates]
    post_micro = normalize_micro_probs(unnorm_weights)

    new_candidates = [
        RectificationCandidate(
            shichen_branch=c.shichen_branch,
            shichen_branch_vi=c.shichen_branch_vi,
            prob_micro=post_micro[idx],
        )
        for idx, c in enumerate(st.candidates)
    ]

    entropy_before = st.entropy_millibits
    entropy_after = compute_entropy_millibits(post_micro)

    asked_ids = (
        list(st.asked_question_ids)
        if question_id in st.asked_question_ids
        else [*st.asked_question_ids, question_id]
    )
    answers = [
        *st.answers,
        RectificationAnswerRecord(
            question_id=question_id,
            option_id=answer_value,
            entropy_before_millibits=entropy_before,
            entropy_after_millibits=entropy_after,
        ),
    ]

    top1, top2, top_branch = _summarize_top_two(new_candidates)
    locked = _is_bayesian_locked(top1, top2)

    asked_set = set(asked_ids)
    remaining_count = sum(
        1 for q in bank if q.id not in asked_set and _is_question_eligible_for_age(q, st.user_age)
    )

    locked_branch: int | None = None
    if locked:
        status: RectificationStatus = "LOCKED"
        locked_branch = top_branch
    elif len(answers) >= st.max_questions or remaining_count == 0:
        status = "INVARIANT_INTERSECTION"
    else:
        status = "ACTIVE"

    return RectificationState(
        schema_version="1.0.0",
        status=status,
        candidates=new_candidates,
        entropy_millibits=entropy_after,
        asked_question_ids=asked_ids,
        answers=answers,
        max_questions=st.max_questions,
        user_age=user_age if (user_age := st.user_age) is not None else None,
        locked_shichen_branch=locked_branch,
        top1_prob_micro=top1,
        top2_prob_micro=top2,
    )


def _coerce_report(item: SolverReportIR | Mapping[str, Any]) -> SolverReportIR:
    if isinstance(item, SolverReportIR):
        return item
    return SolverReportIR.model_validate(item)


def compute_invariant_intersection(
    candidate_reports: Sequence[SolverReportIR | Mapping[str, Any]],
    bazi: SovanaModel | Mapping[str, Any],
    probs_or_state: Sequence[int] | RectificationState | Mapping[str, Any] | None = None,
) -> InvariantIntersectionReport:
    surviving_reports: list[SolverReportIR] = []
    surviving_branches: list[int] = []

    if (
        len(candidate_reports) > 0
        and isinstance(candidate_reports[0], Mapping)
        and "report" in candidate_reports[0]
        and ("probMicro" in candidate_reports[0] or "prob_micro" in candidate_reports[0])
    ):
        weighted = [cast(Mapping[str, Any], x) for x in candidate_reports]
        filtered = [
            w
            for w in weighted
            if int(w.get("probMicro", w.get("prob_micro", 0))) >= SURVIVING_THRESHOLD_MICRO
        ]
        chosen = (
            filtered
            if filtered
            else [max(weighted, key=lambda w: int(w.get("probMicro", w.get("prob_micro", 0))))]
        )
        surviving_reports = [_coerce_report(w["report"]) for w in chosen]
        surviving_branches = sorted(
            int(w.get("shichenBranch", w.get("shichen_branch", idx)))
            for idx, w in enumerate(chosen)
        )
    else:
        plain_reports = [_coerce_report(r) for r in candidate_reports]
        if probs_or_state is None:
            surviving_reports = list(plain_reports)
            surviving_branches = list(range(len(plain_reports)))
        elif isinstance(probs_or_state, (RectificationState, Mapping)):
            st = _coerce_state(probs_or_state)
            indices: list[int] = []
            branches: list[int] = []
            limit = min(len(plain_reports), len(st.candidates))
            for i in range(limit):
                cand = st.candidates[i]
                if cand.prob_micro >= SURVIVING_THRESHOLD_MICRO:
                    indices.append(i)
                    branches.append(cand.shichen_branch)
            if not indices and limit > 0:
                best_idx = max(range(limit), key=lambda k: st.candidates[k].prob_micro)
                indices.append(best_idx)
                branches.append(st.candidates[best_idx].shichen_branch)
            surviving_reports = [plain_reports[i] for i in indices]
            surviving_branches = sorted(branches)
        else:
            probs = [int(p) for p in probs_or_state]
            indices = [
                i
                for i in range(len(plain_reports))
                if (probs[i] if i < len(probs) else 0) >= SURVIVING_THRESHOLD_MICRO
            ]
            if not indices and plain_reports:
                best_idx = max(
                    range(len(plain_reports)),
                    key=lambda k: probs[k] if k < len(probs) else 0,
                )
                indices.append(best_idx)
            surviving_reports = [plain_reports[i] for i in indices]
            surviving_branches = indices

    invariant_nodes: list[ProvenanceNode] = []
    invariant_claims_vi: list[str] = []

    if surviving_reports:
        first_report = surviving_reports[0]
        common_node_ids = {n.node_id for n in first_report.nodes}
        for rep in surviving_reports[1:]:
            common_node_ids &= {n.node_id for n in rep.nodes}

        invariant_nodes = sorted(
            (n for n in first_report.nodes if n.node_id in common_node_ids),
            key=lambda n: (n.stratum, n.node_id),
        )

        common_claims = {n.claim_vi for n in first_report.nodes}
        for rep in surviving_reports[1:]:
            common_claims &= {n.claim_vi for n in rep.nodes}

        seen_claims: set[str] = set()
        for node in first_report.nodes:
            if node.claim_vi in common_claims and node.claim_vi not in seen_claims:
                seen_claims.add(node.claim_vi)
                invariant_claims_vi.append(node.claim_vi)

    bazi_dict = bazi.to_canonical_dict() if isinstance(bazi, SovanaModel) else dict(bazi)
    year_p = PillarPair.model_validate(bazi_dict["yearPillar"]["pillar"])
    month_p = PillarPair.model_validate(bazi_dict["monthPillar"]["pillar"])
    day_p = PillarPair.model_validate(bazi_dict["dayPillar"]["pillar"])

    return InvariantIntersectionReport(
        schema_version="1.0.0",
        mode="INVARIANT_INTERSECTION",
        surviving_candidate_count=len(surviving_reports),
        surviving_branches=surviving_branches,
        invariant_nodes=invariant_nodes,
        invariant_claims_vi=invariant_claims_vi,
        invariant_bazi_pillars=InvariantBaziPillars(
            year_pillar=year_p,
            month_pillar=month_p,
            day_pillar=day_p,
        ),
    )


_MENH_GROUP_BRANCHES: dict[MenhBranchGroup, tuple[int, ...]] = {
    "TU_CHINH": (0, 3, 6, 9),
    "TU_MO": (1, 4, 7, 10),
    "TU_SINH": (2, 5, 8, 11),
}


def _as_dict(obj: SovanaModel | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(obj, SovanaModel):
        return obj.to_canonical_dict()
    return dict(obj)


def _normalize_palace_key(name: str) -> str:
    trimmed = name.strip()
    if trimmed in ("Giao Hữu", "Nô Bộc"):
        return "Nô Bộc"
    return trimmed


def _find_ziwei_palace(ziwei: Mapping[str, Any], palace_query: str) -> Mapping[str, Any] | None:
    target = _normalize_palace_key(palace_query)
    palaces: Sequence[Mapping[str, Any]] = ziwei["palaces"]
    if target == "Thân":
        than_branch = int(ziwei["thanBranch"])
        for p in palaces:
            if p.get("isThan") or int(p["branchIndex"]) == than_branch:
                return p
        return None
    for p in palaces:
        if _normalize_palace_key(str(p["palaceName"])) == target:
            return p
    return None


def compute_certainty_prior_weights(
    mode: BirthTimeCertaintyMode,
    ambiguous_branches: Sequence[int] = (),
    center_branch: int | None = None,
    window: BirthTimeWindow | None = None,
) -> list[int]:
    if mode == "UNKNOWN":
        return [1] * 12
    if mode == "TIME_WINDOW":
        w = [5] * 12
        if window == "SANG":
            for b in (3, 4, 5):
                w[b] = 280
            for b in (2, 6):
                w[b] = 65
            return w
        if window == "TRUA":
            w = [8] * 12
            w[6] = 500
            for b in (5, 7):
                w[b] = 190
            for b in (4, 8):
                w[b] = 30
            return w
        if window == "CHIEU":
            for b in (7, 8, 9):
                w[b] = 280
            for b in (6, 10):
                w[b] = 65
            return w
        if window == "TOI":
            w = [7] * 12
            for b in (9, 10):
                w[b] = 320
            w[11] = 220
            for b in (8, 0):
                w[b] = 45
            return w
        if window == "DEM":
            for b in (11, 0, 1, 2):
                w[b] = 225
            for b in (10, 3):
                w[b] = 35
            return w
        return [1] * 12

    unique_ambig: list[int] = []
    seen_ambig: set[int] = set()
    for b in ambiguous_branches:
        bm = floor_mod(int(b), 12)
        if bm not in seen_ambig:
            seen_ambig.add(bm)
            unique_ambig.append(bm)
    center = (
        floor_mod(int(center_branch), 12)
        if center_branch is not None
        else (unique_ambig[0] if unique_ambig else 0)
    )
    if len(unique_ambig) >= 2:
        w = [10] * 12
        for b in unique_ambig:
            w[b] = 450
        w[center] = 480
        return w
    w = [20] * 12
    w[floor_mod(center - 1, 12)] = 120
    w[floor_mod(center + 1, 12)] = 120
    w[center] = 700
    return w


def eval_chart_predicate(
    predicate: ChartPredicate,
    chart: SovanaModel | Mapping[str, Any],
) -> bool:
    chart_d = _as_dict(chart)
    ziwei = chart_d["ziweiNamPhai"]
    op = predicate["op"]
    if op == "always":
        return True
    if op == "otherwise":
        return False
    if op == "shichen_in":
        shichen = int(chart_d["temporal"]["trueSolarTime"]["shichenBranch"])
        return shichen in [int(x) for x in predicate["branches"]]
    if op == "menh_vo_chinh_dieu":
        menh_idx = int(ziwei["menhBranch"])
        palaces = ziwei["palaces"]
        menh = palaces[menh_idx] if menh_idx < len(palaces) else _find_ziwei_palace(ziwei, "Mệnh")
        return bool(menh["voChinhDieu"]) is bool(predicate["expected"]) if menh else False
    if op == "menh_branch_parity":
        return floor_mod(int(ziwei["menhBranch"]), 2) == int(predicate["parity"])
    if op == "menh_branch_group":
        group = cast(MenhBranchGroup, predicate["group"])
        return floor_mod(int(ziwei["menhBranch"]), 12) in _MENH_GROUP_BRANCHES[group]
    if op == "cuc_in":
        return int(ziwei["cucNumber"]) in [int(x) for x in predicate["cucNumbers"]]
    if op == "than_palace_in":
        than_branch = int(ziwei["thanBranch"])
        than_p = next(
            (
                p
                for p in ziwei["palaces"]
                if p.get("isThan") or int(p["branchIndex"]) == than_branch
            ),
            None,
        )
        if than_p is None:
            return False
        actual = _normalize_palace_key(str(than_p["palaceName"]))
        return any(_normalize_palace_key(str(name)) == actual for name in predicate["palaces"])
    if op == "palace_has_any_star":
        palace = _find_ziwei_palace(ziwei, str(predicate["palace"]))
        if palace is None:
            return False
        star_set = {str(s) for s in predicate["stars"]}
        return any(str(s["name"]) in star_set for s in palace["majorStars"]) or any(
            str(s["name"]) in star_set for s in palace["minorStars"]
        )
    if op == "palace_has_sihua":
        palace = _find_ziwei_palace(ziwei, str(predicate["palace"]))
        if palace is None:
            return False
        t_set = {str(t) for t in predicate["transforms"]}
        return any(
            s.get("sihuaTransform") is not None and str(s["sihuaTransform"]) in t_set
            for s in palace["majorStars"]
        ) or any(
            s.get("sihuaTransform") is not None and str(s["sihuaTransform"]) in t_set
            for s in palace["minorStars"]
        )
    if op == "palace_has_tuan_triet":
        palace = _find_ziwei_palace(ziwei, str(predicate["palace"]))
        if palace is None:
            return False
        return bool(palace.get("tuanTrung") or palace.get("trietLo"))
    if op == "and":
        return all(eval_chart_predicate(arg, chart_d) for arg in predicate["args"])
    if op == "or":
        return any(eval_chart_predicate(arg, chart_d) for arg in predicate["args"])
    raise ValueError(f"Unsupported ChartPredicate op: {op!r}")


def extract_chart_rectification_features(
    chart: SovanaModel | Mapping[str, Any],
) -> ChartRectificationFeatures:
    chart_d = _as_dict(chart)
    tst = chart_d["temporal"]["trueSolarTime"]
    ziwei = chart_d["ziweiNamPhai"]
    menh_idx = int(ziwei["menhBranch"])
    than_idx = int(ziwei["thanBranch"])
    menh_palace = ziwei["palaces"][menh_idx]
    than_palace = next(
        (p for p in ziwei["palaces"] if p.get("isThan") or int(p["branchIndex"]) == than_idx),
        ziwei["palaces"][than_idx],
    )
    palace_tags: dict[str, list[str]] = {}
    for p in ziwei["palaces"]:
        tags: list[str] = []
        for s in p["majorStars"]:
            tags.append(str(s["name"]))
            if s.get("sihuaTransform") is not None:
                tags.append(str(s["sihuaTransform"]))
        for s in p["minorStars"]:
            if s.get("category") != "ring":
                tags.append(str(s["name"]))
            if s.get("sihuaTransform") is not None:
                tags.append(str(s["sihuaTransform"]))
        if p.get("tuanTrung"):
            tags.append("Tuần")
        if p.get("trietLo"):
            tags.append("Triệt")
        palace_tags[str(p["palaceName"])] = tags

    return ChartRectificationFeatures(
        shichen_branch=int(tst["shichenBranch"]),
        shichen_branch_vi=str(tst["shichenBranchVi"]),
        menh_branch=menh_idx,
        than_branch=than_idx,
        than_palace_name=str(than_palace["palaceName"]),
        cuc_number=int(ziwei["cucNumber"]),
        menh_vo_chinh_dieu=bool(menh_palace["voChinhDieu"]),
        menh_parity=floor_mod(menh_idx, 2),
        menh_major_stars=[str(s["name"]) for s in menh_palace["majorStars"]],
        palace_signature_tags=palace_tags,
    )


def _distribute_int_total(total: int, indices: Sequence[int], out: list[int]) -> None:
    n = len(indices)
    if n == 0:
        return
    base = total // n
    rem = total % n
    for i, idx in enumerate(indices):
        out[idx] = base + (1 if i < rem else 0)


def compile_chart_conditioned_bank(
    candidate_charts: Sequence[SovanaModel | Mapping[str, Any]],
    bank: Sequence[RectificationQuestion | Mapping[str, Any]] | None = None,
) -> list[RectificationQuestion]:
    resolved_bank = validate_question_bank(
        bank if bank is not None else PUBLIC_RECTIFICATION_QUESTIONS
    )
    chart_by_branch: dict[int, dict[str, Any]] = {}
    for raw_c in candidate_charts:
        cd = _as_dict(raw_c)
        b = floor_mod(int(cd["temporal"]["trueSolarTime"]["shichenBranch"]), 12)
        chart_by_branch[b] = cd

    compiled: list[RectificationQuestion] = []
    for q in resolved_bank:
        preds = q.chart_predicates
        if preds is None:
            compiled.append(
                RectificationQuestion(
                    id=q.id,
                    category=q.category,
                    age_cohort=q.age_cohort,
                    min_age=q.min_age,
                    max_age=q.max_age,
                    prompt_vi=q.prompt_vi,
                    options=list(q.options),
                    likelihood_matrix_micro=q.likelihood_matrix_micro,
                    chart_predicates=None,
                )
            )
            continue

        opt_count = len(q.options)
        cols = [[0] * 12 for _ in range(opt_count)]
        na_indices: list[int] = []
        sub_indices: list[int] = []
        otherwise_indices: list[int] = []

        for o, opt in enumerate(q.options):
            pred = preds.get(opt.id)
            if pred is None and (opt.id == "OPT_NA" or opt.id.endswith("_NA")):
                na_indices.append(o)
            else:
                sub_indices.append(o)
                if pred is not None and pred.get("op") == "otherwise":
                    otherwise_indices.append(o)

        for b in range(12):
            chart_d = chart_by_branch.get(b)
            if chart_d is None:
                raw_col = [
                    _get_raw_likelihood(q, o, q.options[o].id, b) for o in range(opt_count)
                ]
                norm = normalize_micro_probs(raw_col)
                for o in range(opt_count):
                    cols[o][b] = norm[o]
                continue

            na_prob_total = 80_000 if na_indices else 0
            sub_budget = MICRO_SCALE - na_prob_total
            col = [0] * opt_count
            _distribute_int_total(na_prob_total, na_indices, col)

            hit_indices: list[int] = []
            miss_indices: list[int] = []
            for o in sub_indices:
                pred = preds.get(q.options[o].id)
                if pred is not None and eval_chart_predicate(pred, chart_d):
                    hit_indices.append(o)
                else:
                    miss_indices.append(o)

            if hit_indices and miss_indices:
                hit_budget = 760_000 if na_indices else 820_000
                miss_budget = sub_budget - hit_budget
                _distribute_int_total(hit_budget, hit_indices, col)
                _distribute_int_total(miss_budget, miss_indices, col)
            elif (
                not hit_indices
                and otherwise_indices
                and len(otherwise_indices) < len(sub_indices)
            ):
                non_other = [o for o in sub_indices if o not in otherwise_indices]
                other_budget = 720_000 if na_indices else 780_000
                rem_budget = sub_budget - other_budget
                _distribute_int_total(other_budget, otherwise_indices, col)
                _distribute_int_total(rem_budget, non_other, col)
            else:
                _distribute_int_total(sub_budget, sub_indices, col)

            for o in range(opt_count):
                cols[o][b] = col[o]

        matrix_record = {q.options[o].id: cols[o] for o in range(opt_count)}
        compiled.append(
            RectificationQuestion(
                id=q.id,
                category=q.category,
                age_cohort=q.age_cohort,
                min_age=q.min_age,
                max_age=q.max_age,
                prompt_vi=q.prompt_vi,
                options=list(q.options),
                likelihood_matrix_micro=matrix_record,
                chart_predicates=preds,
            )
        )
    return compiled


def create_rectification_session_from_charts(
    candidate_charts: Sequence[SovanaModel | Mapping[str, Any]],
    mode: BirthTimeCertaintyMode = "UNKNOWN",
    birth_time_window: BirthTimeWindow | None = None,
    ambiguous_branches: Sequence[int] = (),
    center_branch: int | None = None,
    max_questions: int | None = None,
    user_age: int | None = None,
    question_bank: Sequence[RectificationQuestion | Mapping[str, Any]] | None = None,
) -> RectificationSession:
    if not candidate_charts:
        raise ValueError(
            "create_rectification_session_from_charts requires at least 1 candidate ChartIR"
        )
    chart_dicts = [_as_dict(c) for c in candidate_charts]
    sorted_charts = sorted(
        chart_dicts,
        key=lambda c: int(c["temporal"]["trueSolarTime"]["shichenBranch"]),
    )
    candidate_branches = sorted(
        {floor_mod(int(c["temporal"]["trueSolarTime"]["shichenBranch"]), 12) for c in sorted_charts}
    )
    prior_weights = compute_certainty_prior_weights(
        mode=mode,
        ambiguous_branches=ambiguous_branches,
        center_branch=center_branch,
        window=birth_time_window,
    )
    default_max = 6 if mode == "UNKNOWN" else 5
    effective_max_q = max_questions if max_questions is not None else default_max
    state = create_initial_rectification_state(
        candidate_branches=candidate_branches,
        prior_weights=prior_weights,
        max_questions=effective_max_q,
        user_age=user_age,
    )
    compiled_bank = compile_chart_conditioned_bank(sorted_charts, question_bank)
    chart_features = [extract_chart_rectification_features(c) for c in sorted_charts]
    return RectificationSession(
        state=state,
        compiled_bank=compiled_bank,
        chart_features=chart_features,
    )
