"""Chu Dịch Lục Hào Nạp Giáp state machine & Mai Hoa Dịch Số engine."""

from __future__ import annotations

from collections.abc import Sequence
from typing import cast

from sovana.geo_time.ephemeris import BRANCHES_VI, STEMS_VI, floor_mod
from sovana.geo_time.models import NormalizedBirthTemporal
from sovana.kernel.data import load_liuyao_axiom
from sovana.kernel.models import (
    LiuyaoCastMethod,
    LiuyaoChartIR,
    LiuyaoHexagramSpec,
    LiuyaoHexagramSummaryIR,
    LiuyaoLineIR,
    LiuyaoLineValue,
    LiuyaoPhucThanIR,
)

# Tiên Thiên Bát Quái remainder (sum % 8):
# 1=Càn(111=7), 2=Đoài(011=3), 3=Ly(101=5), 4=Chấn(001=1),
# 5=Tốn(110=6), 6=Khảm(010=2), 7=Cấn(100=4), 0(8)=Khôn(000=0)
_TIEN_THIEN_REM_TO_BITS3: tuple[int, ...] = (0, 7, 3, 5, 1, 6, 2, 4)

_ELEMENT_TO_INDEX: dict[str, int] = {
    "Mộc": 0,
    "Hỏa": 1,
    "Thổ": 2,
    "Kim": 3,
    "Thủy": 4,
}

_RELATIVES_BY_DIFF: tuple[str, ...] = (
    "Huynh Đệ",
    "Tử Tôn",
    "Thê Tài",
    "Quan Quỷ",
    "Phụ Mẫu",
)

_ALL_FIVE_RELATIVES: tuple[str, ...] = (
    "Phụ Mẫu",
    "Huynh Đệ",
    "Tử Tôn",
    "Thê Tài",
    "Quan Quỷ",
)


def compute_liuyao_relative_vi(house_element_vi: str, line_element_vi: str) -> str:
    h_idx = _ELEMENT_TO_INDEX.get(house_element_vi)
    l_idx = _ELEMENT_TO_INDEX.get(line_element_vi)
    if h_idx is None or l_idx is None:
        raise ValueError(
            f"Unknown element in Liuyao relative lookup: {house_element_vi} / {line_element_vi}"
        )
    return _RELATIVES_BY_DIFF[floor_mod(l_idx - h_idx, 5)]


def _to_hexagram_summary(spec: LiuyaoHexagramSpec) -> LiuyaoHexagramSummaryIR:
    return LiuyaoHexagramSummaryIR(
        bits_index=spec.bits_index,
        code6bit=spec.code6bit,
        king_wen_number=spec.king_wen_number,
        name_vi=spec.name_vi,
        upper_trigram=spec.upper_trigram,
        lower_trigram=spec.lower_trigram,
        house_name_vi=spec.house_name_vi,
        house_element_vi=spec.house_element_vi,
        generation_type=spec.generation_type,
        the_line=spec.the_line,
        ung_line=spec.ung_line,
    )


def derive_mai_hoa_lines(temporal: NormalizedBirthTemporal) -> list[LiuyaoLineValue]:
    y_branch = temporal.pillars.lunar_year_pillar.branch_index
    m = temporal.lunar_active.effective_lunar_month
    d = temporal.lunar_active.lunar_day
    h_branch = temporal.true_solar_time.shichen_branch

    upper_rem = (y_branch + 1 + m + d) % 8
    lower_rem = (upper_rem + h_branch + 1) % 8
    rem6 = (y_branch + 1 + m + d + h_branch + 1) % 6
    moving_line = rem6 if rem6 != 0 else 6

    lower_bits = _TIEN_THIEN_REM_TO_BITS3[lower_rem]
    upper_bits = _TIEN_THIEN_REM_TO_BITS3[upper_rem]
    bits6 = lower_bits | (upper_bits << 3)

    lines: list[LiuyaoLineValue] = []
    for i in range(6):
        is_yang = ((bits6 >> i) & 1) == 1
        is_moving = (i + 1) == moving_line
        if is_moving:
            lines.append(9 if is_yang else 6)
        else:
            lines.append(7 if is_yang else 8)
    return lines


def cast_liuyao_chart(
    temporal: NormalizedBirthTemporal,
    line_values: Sequence[int],
    method: LiuyaoCastMethod = "manual-lines",
) -> LiuyaoChartIR:
    if len(line_values) != 6:
        raise ValueError(
            f"Liuyao requires exactly 6 line values; received {len(line_values)}"
        )
    validated_lines: list[LiuyaoLineValue] = []
    for i, v in enumerate(line_values):
        if isinstance(v, bool) or v not in (6, 7, 8, 9):
            raise ValueError(f"Invalid Liuyao line value at line {i + 1}: {v!r}")
        validated_lines.append(cast(LiuyaoLineValue, v))

    axiom = load_liuyao_axiom()

    primary_bits = 0
    transformed_bits = 0
    moving_lines: list[int] = []

    for i, v in enumerate(validated_lines):
        p_bit = 1 if v in (7, 9) else 0
        t_bit = 1 if v in (7, 6) else 0
        if p_bit == 1:
            primary_bits |= 1 << i
        if t_bit == 1:
            transformed_bits |= 1 << i
        if v in (6, 9):
            moving_lines.append(i + 1)

    primary_spec = axiom.hexagrams_by_bits[primary_bits]
    transformed_spec = axiom.hexagrams_by_bits[transformed_bits]

    day_stem = temporal.pillars.day_pillar.stem_index
    day_branch = temporal.pillars.day_pillar.branch_index
    month_branch = temporal.pillars.bazi_month_pillar.branch_index
    nguyet_pha_branch = floor_mod(month_branch + 6, 12)

    tk0 = floor_mod(day_branch + 9 - day_stem + 1, 12)
    tk1 = floor_mod(day_branch + 9 - day_stem + 2, 12)
    tuan_khong_branches: tuple[int, int] = (tk0, tk1)

    beasts = axiom.six_beasts_by_day_stem[str(day_stem)]

    lines: list[LiuyaoLineIR] = []
    present_relatives: set[str] = set()

    for i in range(6):
        line_num = i + 1
        raw_val = validated_lines[i]
        is_yang = raw_val in (7, 9)
        is_moving = raw_val in (6, 9)
        s_idx = primary_spec.line_stems[i]
        b_idx = primary_spec.line_branches[i]
        elem_vi = primary_spec.line_elements_vi[i]
        rel_vi = primary_spec.line_relatives_vi[i]
        present_relatives.add(rel_vi)

        t_branch_idx: int | None = None
        t_branch_vi: str | None = None
        t_elem_vi: str | None = None
        t_rel_vi: str | None = None

        if is_moving:
            t_branch_idx = transformed_spec.line_branches[i]
            t_branch_vi = BRANCHES_VI[t_branch_idx]
            t_elem_vi = transformed_spec.line_elements_vi[i]
            t_rel_vi = compute_liuyao_relative_vi(primary_spec.house_element_vi, t_elem_vi)

        lines.append(
            LiuyaoLineIR(
                line_number=line_num,
                raw_value=raw_val,
                is_yang=is_yang,
                is_moving=is_moving,
                is_the=(line_num == primary_spec.the_line),
                is_ung=(line_num == primary_spec.ung_line),
                stem_index=s_idx,
                stem_vi=STEMS_VI[s_idx],
                branch_index=b_idx,
                branch_vi=BRANCHES_VI[b_idx],
                element_vi=elem_vi,
                relative_vi=rel_vi,
                beast_vi=beasts[i],
                is_tuan_khong=(b_idx in tuan_khong_branches),
                is_nguyet_pha=(b_idx == nguyet_pha_branch),
                transformed_branch_index=t_branch_idx,
                transformed_branch_vi=t_branch_vi,
                transformed_element_vi=t_elem_vi,
                transformed_relative_vi=t_rel_vi,
            )
        )

    pure_base_spec = next(
        (
            h
            for h in axiom.hexagrams_by_bits
            if h.house_name_vi == primary_spec.house_name_vi
            and h.upper_trigram == h.lower_trigram
        ),
        None,
    )
    if pure_base_spec is None:
        raise ValueError(
            f"Pure base hexagram not found for house {primary_spec.house_name_vi!r}"
        )

    phuc_than: list[LiuyaoPhucThanIR] = []
    missing_relatives = [r for r in _ALL_FIVE_RELATIVES if r not in present_relatives]

    if missing_relatives:
        missing_set = set(missing_relatives)
        for i in range(6):
            base_rel = pure_base_spec.line_relatives_vi[i]
            if base_rel in missing_set:
                p_stem = pure_base_spec.line_stems[i]
                p_branch = pure_base_spec.line_branches[i]
                p_elem = pure_base_spec.line_elements_vi[i]
                phi_line = lines[i]
                phuc_than.append(
                    LiuyaoPhucThanIR(
                        line_number=i + 1,
                        missing_relative_vi=base_rel,
                        stem_index=p_stem,
                        branch_index=p_branch,
                        branch_vi=BRANCHES_VI[p_branch],
                        element_vi=p_elem,
                        phi_than_branch_vi=phi_line.branch_vi,
                        phi_than_element_vi=phi_line.element_vi,
                        phi_than_relative_vi=phi_line.relative_vi,
                    )
                )

    return LiuyaoChartIR(
        method=method,
        line_values=list(validated_lines),
        primary_hexagram=_to_hexagram_summary(primary_spec),
        transformed_hexagram=_to_hexagram_summary(transformed_spec),
        has_moving_lines=(len(moving_lines) > 0),
        moving_lines=moving_lines,
        month_branch_index=month_branch,
        nguyet_pha_branch=nguyet_pha_branch,
        nhat_than_branch=day_branch,
        tuan_khong_branches=tuan_khong_branches,
        lines=lines,
        phuc_than=phuc_than,
    )
