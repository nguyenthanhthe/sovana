"""Pydantic v2 IR models and axiom spec structures matching @sovana/kernel."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from sovana.geo_time.models import NormalizedBirthTemporal, PillarPair, SovanaModel

Gender = Literal["male", "female"]
ZiweiSilo = Literal["nam-phai", "toan-thu"]
SihuaTransform = Literal["Hóa Lộc", "Hóa Quyền", "Hóa Khoa", "Hóa Kỵ"]
ZiweiStarCategory = Literal["major", "auxiliary", "sha", "ring"]
BaziStrengthClass = Literal["THAN_VUONG", "THAN_NHUOC", "CAN_BANG"]
LiuyaoLineValue = Literal[6, 7, 8, 9]
LiuyaoCastMethod = Literal["manual-lines", "mai-hoa"]
CucNumber = Literal[2, 3, 4, 5, 6]
Direction = Literal[1, -1]
BaziPillarPosition = Literal["year", "month", "day", "hour"]


# --- Axiom Spec Models (internal normalized structures) ---


class ZiweiAxiomSpec(BaseModel):
    model_config = ConfigDict(frozen=True)

    silo_id: ZiweiSilo
    name_vi: str
    palace_order_counter_clockwise: tuple[str, ...]
    sihua_by_stem: dict[str, tuple[str, str, str, str]]
    brightness_levels: tuple[str, ...]
    major_star_brightness_by_branch: dict[str, tuple[str, ...]]
    minor_star_brightness_by_branch: dict[str, tuple[str | None, ...]] = Field(
        default_factory=dict
    )
    thai_tue_ring: tuple[str, ...]
    trang_sinh_stages: tuple[str, ...]
    trang_sinh_start_by_cuc: dict[str, int]
    bac_sy_ring: tuple[str, ...]
    loc_ton_by_stem: tuple[int, ...]
    thien_khoi_viet_by_stem: tuple[tuple[int, int], ...]
    menh_chu_by_branch: tuple[str, ...]
    than_chu_by_branch: tuple[str, ...]
    triet_by_stem_pair: dict[str, tuple[int, int]]


class NapAmEntrySpec(BaseModel):
    model_config = ConfigDict(frozen=True)

    index: int
    can_chi_vi: str
    nap_am_vi: str
    element_vi: str
    cuc_number: CucNumber


class HiddenStemSpec(BaseModel):
    model_config = ConfigDict(frozen=True)

    stem_index: int
    weight_bps: int


class DieuHauEntrySpec(BaseModel):
    model_config = ConfigDict(frozen=True)

    primary_god_stem_indices: tuple[int, ...]
    summary_vi: str


class BaziAxiomSpec(BaseModel):
    model_config = ConfigDict(frozen=True)

    hidden_stems_by_branch: dict[str, tuple[HiddenStemSpec, ...]]
    ten_gods_names_vi: tuple[str, ...]
    nap_am60: tuple[NapAmEntrySpec, ...]
    seasonal_multiplier_bps: dict[str, tuple[int, ...]]
    cung_thong_bao_giam_dieu_hau: dict[str, dict[str, DieuHauEntrySpec]]


class LiuyaoHexagramSpec(BaseModel):
    model_config = ConfigDict(frozen=True)

    bits_index: int
    code6bit: str
    king_wen_number: int
    name_vi: str
    upper_trigram: str
    lower_trigram: str
    house_name_vi: str
    house_element_vi: str
    generation_type: str
    the_line: int
    ung_line: int
    line_branches: tuple[int, ...]
    line_stems: tuple[int, ...]
    line_elements_vi: tuple[str, ...]
    line_relatives_vi: tuple[str, ...]


class LiuyaoAxiomSpec(BaseModel):
    model_config = ConfigDict(frozen=True)

    hexagrams_by_bits: tuple[LiuyaoHexagramSpec, ...]
    six_beasts_by_day_stem: dict[str, tuple[str, ...]]


# --- Public Canonical ChartIR Models (1:1 camelCase via SovanaModel) ---


class ZiweiStarIR(SovanaModel):
    name: str
    category: ZiweiStarCategory
    brightness: str | None = None
    sihua_transform: SihuaTransform | None = None


class ZiweiPalaceIR(SovanaModel):
    branch_index: int
    branch_vi: str
    stem_index: int
    stem_vi: str
    palace_name: str
    is_menh: bool
    is_than: bool
    tuan_trung: bool
    triet_lo: bool
    dai_han_start_age: int
    dai_han_end_age: int
    tieu_han_branch_index: int
    tieu_han_branch_vi: str
    thai_tue_star: str
    trang_sinh_star: str
    bac_sy_star: str
    major_stars: list[ZiweiStarIR]
    minor_stars: list[ZiweiStarIR]
    vo_chinh_dieu: bool
    borrowed_major_stars: list[ZiweiStarIR]
    tam_khong_types: list[str]
    tu_linh_present: list[str]


class ZiweiLuuNienSihuaIR(SovanaModel):
    transform: SihuaTransform
    star_name: str
    branch_index: int
    palace_name: str


class ZiweiNguyetHanEntryIR(SovanaModel):
    lunar_month: int
    branch_index: int
    branch_vi: str
    palace_name: str


class ZiweiThaiTueTuLinhIR(SovanaModel):
    menh_in_thai_tue_tam_hop: bool
    than_in_thai_tue_tam_hop: bool
    menh_tam_hop_tu_linh_stars: list[str]
    menh_tam_phuong_tu_linh_stars: list[str]
    has_full_tu_linh_in_menh_tam_hop: bool
    has_full_tu_linh_in_menh_tam_phuong: bool
    is_thai_tue_tu_linh_way: bool


class ZiweiLuuNienIR(SovanaModel):
    target_year: int
    year_stem_index: int
    year_branch_index: int
    year_can_chi_vi: str
    nominal_age: int
    luu_nien_palace_branch: int
    tieu_han_palace_branch: int
    active_dai_han_palace_branch: int | None = None
    luu_dong_tinh_by_branch: list[list[str]]
    luu_nien_sihua: list[ZiweiLuuNienSihuaIR]
    nguyet_han: list[ZiweiNguyetHanEntryIR]


class ZiweiChartIR(SovanaModel):
    silo: ZiweiSilo
    silo_name_vi: str
    gender: Gender
    yin_yang_label_vi: str
    direction: Direction
    menh_branch: int
    than_branch: int
    menh_chu_star: str
    than_chu_star: str
    cuc_number: CucNumber
    cuc_name_vi: str
    ban_menh_nap_am_vi: str
    tu_vi_branch: int
    thien_phu_branch: int
    tuan_trung_branches: tuple[int, int]
    triet_lo_branches: tuple[int, int]
    palaces: list[ZiweiPalaceIR]
    thai_tue_tam_hop_tu_linh: ZiweiThaiTueTuLinhIR
    luu_nien: ZiweiLuuNienIR | None = None


class ForkedStarDetailIR(SovanaModel):
    star_name: str
    branch_index: int
    palace_name: str
    nam_phai_sihua: SihuaTransform | None = None
    toan_thu_sihua: SihuaTransform | None = None


class EmpiricalForkIR(SovanaModel):
    has_sihua_fork: bool
    forked_stars: list[ForkedStarDetailIR]
    brightness_diff_count: int
    is_lunar_divergent_vn_cn: bool
    is_boundary_ambiguous: bool
    consensus_mode: bool


class BaziHiddenStemIR(SovanaModel):
    stem_index: int
    stem_vi: str
    element_vi: str
    weight_bps: int
    ten_god: str


class BaziPillarDetailIR(SovanaModel):
    position: BaziPillarPosition
    pillar: PillarPair
    stem_element_vi: str
    branch_element_vi: str
    stem_ten_god: str
    hidden_stems: list[BaziHiddenStemIR]
    nap_am_vi: str
    nap_am_element_vi: str
    tuan_khong_branches: tuple[int, int]
    tuan_khong_vi: tuple[str, str]


class BaziDaiVanIR(SovanaModel):
    index: int
    pillar: PillarPair
    start_age: int
    end_age: int
    stem_ten_god: str
    nap_am_vi: str


class BaziDieuHauIR(SovanaModel):
    primary_god_stem_indices: list[int]
    primary_god_stems_vi: list[str]
    summary_vi: str


class BaziChartIR(SovanaModel):
    gender: Gender
    direction: Direction
    day_master_stem_index: int
    day_master_stem_vi: str
    day_master_element_vi: str
    year_pillar: BaziPillarDetailIR
    month_pillar: BaziPillarDetailIR
    day_pillar: BaziPillarDetailIR
    hour_pillar: BaziPillarDetailIR
    day_master_score_bps: int
    strength_class: BaziStrengthClass
    element_scores_bps: dict[str, int]
    seconds_to_target_jie: int
    dai_van_start_age_months: int
    dai_van_start_age_years: int
    dai_van: list[BaziDaiVanIR]
    dieu_hau: BaziDieuHauIR
    climate_audit_note: str


class LiuyaoHexagramSummaryIR(SovanaModel):
    bits_index: int
    code6bit: str
    king_wen_number: int
    name_vi: str
    upper_trigram: str
    lower_trigram: str
    house_name_vi: str
    house_element_vi: str
    generation_type: str
    the_line: int
    ung_line: int


class LiuyaoLineIR(SovanaModel):
    line_number: int
    raw_value: LiuyaoLineValue
    is_yang: bool
    is_moving: bool
    is_the: bool
    is_ung: bool
    stem_index: int
    stem_vi: str
    branch_index: int
    branch_vi: str
    element_vi: str
    relative_vi: str
    beast_vi: str
    is_tuan_khong: bool
    is_nguyet_pha: bool
    transformed_branch_index: int | None = None
    transformed_branch_vi: str | None = None
    transformed_element_vi: str | None = None
    transformed_relative_vi: str | None = None


class LiuyaoPhucThanIR(SovanaModel):
    line_number: int
    missing_relative_vi: str
    stem_index: int
    branch_index: int
    branch_vi: str
    element_vi: str
    phi_than_branch_vi: str
    phi_than_element_vi: str
    phi_than_relative_vi: str


class LiuyaoChartIR(SovanaModel):
    method: LiuyaoCastMethod
    line_values: list[int]
    primary_hexagram: LiuyaoHexagramSummaryIR
    transformed_hexagram: LiuyaoHexagramSummaryIR
    has_moving_lines: bool
    moving_lines: list[int]
    month_branch_index: int
    nguyet_pha_branch: int
    nhat_than_branch: int
    tuan_khong_branches: tuple[int, int]
    lines: list[LiuyaoLineIR]
    phuc_than: list[LiuyaoPhucThanIR]


class ChartIR(SovanaModel):
    schema_version: str
    gender: Gender
    temporal: NormalizedBirthTemporal
    ziwei_nam_phai: ZiweiChartIR
    ziwei_toan_thu: ZiweiChartIR
    empirical_forks: EmpiricalForkIR
    bazi: BaziChartIR
    liuyao: LiuyaoChartIR | None = None


class InquiryDivinationIR(SovanaModel):
    now_ms: int
    utc7_iso_wall_clock: str
    inquiry_time_label_vi: str
    inquiry_temporal: NormalizedBirthTemporal
    liuyao: LiuyaoChartIR
