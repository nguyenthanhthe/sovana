"""Public exports and unified ChartIR compiler for sovana.kernel."""

from __future__ import annotations

import time
from collections.abc import Sequence
from typing import Any

from sovana.geo_time import MS_PER_DAY, civil_from_epoch_day, normalize_birth_temporal
from sovana.geo_time.models import CalendarMode, NormalizedBirthTemporal
from sovana.kernel.bazi import (
    ELEMENTS_VI,
    cast_bazi_chart,
    compute_ten_god_index,
    stem_element_index,
)
from sovana.kernel.data import load_bazi_axiom, load_liuyao_axiom, load_ziwei_axiom
from sovana.kernel.liuyao import (
    cast_liuyao_chart,
    compute_liuyao_relative_vi,
    derive_mai_hoa_lines,
)
from sovana.kernel.models import (
    BaziAxiomSpec,
    BaziChartIR,
    BaziDaiVanIR,
    BaziDieuHauIR,
    BaziHiddenStemIR,
    BaziPillarDetailIR,
    BaziPillarPosition,
    BaziStrengthClass,
    ChartIR,
    CucNumber,
    DieuHauEntrySpec,
    Direction,
    EmpiricalForkIR,
    ForkedStarDetailIR,
    Gender,
    HiddenStemSpec,
    InquiryDivinationIR,
    LiuyaoAxiomSpec,
    LiuyaoCastMethod,
    LiuyaoChartIR,
    LiuyaoHexagramSpec,
    LiuyaoHexagramSummaryIR,
    LiuyaoLineIR,
    LiuyaoLineValue,
    LiuyaoPhucThanIR,
    NapAmEntrySpec,
    SihuaTransform,
    ZiweiAxiomSpec,
    ZiweiChartIR,
    ZiweiLuuNienIR,
    ZiweiLuuNienSihuaIR,
    ZiweiNguyetHanEntryIR,
    ZiweiPalaceIR,
    ZiweiSilo,
    ZiweiStarCategory,
    ZiweiStarIR,
    ZiweiThaiTueTuLinhIR,
)
from sovana.kernel.ziwei import cast_ziwei_chart, compare_code_point, sexagenary_index


def compute_empirical_forks(
    temporal: NormalizedBirthTemporal,
    nam_phai: ZiweiChartIR,
    toan_thu: ZiweiChartIR,
) -> EmpiricalForkIR:
    forked_stars: list[ForkedStarDetailIR] = []
    brightness_diff_count = 0

    for b in range(12):
        p_nam = nam_phai.palaces[b]
        p_toan = toan_thu.palaces[b]

        for s_nam, s_toan in zip(p_nam.major_stars, p_toan.major_stars, strict=True):
            if s_nam.brightness != s_toan.brightness:
                brightness_diff_count += 1
            if s_nam.sihua_transform != s_toan.sihua_transform:
                forked_stars.append(
                    ForkedStarDetailIR(
                        star_name=s_nam.name,
                        branch_index=b,
                        palace_name=p_nam.palace_name,
                        nam_phai_sihua=s_nam.sihua_transform,
                        toan_thu_sihua=s_toan.sihua_transform,
                    )
                )

        toan_minor_by_name = {s.name: s for s in p_toan.minor_stars}
        for s_nam in p_nam.minor_stars:
            s_toan_minor = toan_minor_by_name.get(s_nam.name)
            toan_sihua = s_toan_minor.sihua_transform if s_toan_minor is not None else None
            if s_nam.sihua_transform != toan_sihua:
                forked_stars.append(
                    ForkedStarDetailIR(
                        star_name=s_nam.name,
                        branch_index=b,
                        palace_name=p_nam.palace_name,
                        nam_phai_sihua=s_nam.sihua_transform,
                        toan_thu_sihua=toan_sihua,
                    )
                )

    forked_stars.sort(key=lambda f: f.star_name)
    has_sihua_fork = len(forked_stars) > 0
    is_lunar_divergent_vn_cn = (
        temporal.lunar_vn.lunar_year != temporal.lunar_cn.lunar_year
        or temporal.lunar_vn.lunar_month != temporal.lunar_cn.lunar_month
        or temporal.lunar_vn.lunar_day != temporal.lunar_cn.lunar_day
        or temporal.lunar_vn.is_leap_month != temporal.lunar_cn.is_leap_month
    )
    is_boundary_ambiguous = temporal.uncertainty.is_boundary_ambiguous

    return EmpiricalForkIR(
        has_sihua_fork=has_sihua_fork,
        forked_stars=forked_stars,
        brightness_diff_count=brightness_diff_count,
        is_lunar_divergent_vn_cn=is_lunar_divergent_vn_cn,
        is_boundary_ambiguous=is_boundary_ambiguous,
        consensus_mode=(not has_sihua_fork and not is_boundary_ambiguous),
    )


def compile_chart_ir(
    temporal: NormalizedBirthTemporal,
    gender: Gender,
    target_year: int | None = None,
    liuyao_lines: Sequence[int] | None = None,
    cast_mai_hoa: bool = False,
) -> ChartIR:
    ziwei_nam_phai = cast_ziwei_chart(temporal, gender, "nam-phai", target_year)
    ziwei_toan_thu = cast_ziwei_chart(temporal, gender, "toan-thu", target_year)
    empirical_forks = compute_empirical_forks(temporal, ziwei_nam_phai, ziwei_toan_thu)
    bazi = cast_bazi_chart(temporal, gender)

    liuyao: LiuyaoChartIR | None = None
    if liuyao_lines is not None:
        liuyao = cast_liuyao_chart(temporal, liuyao_lines, "manual-lines")
    elif cast_mai_hoa is True:
        liuyao = cast_liuyao_chart(temporal, derive_mai_hoa_lines(temporal), "mai-hoa")

    return ChartIR(
        schema_version="1.0.0",
        gender=gender,
        temporal=temporal,
        ziwei_nam_phai=ziwei_nam_phai,
        ziwei_toan_thu=ziwei_toan_thu,
        empirical_forks=empirical_forks,
        bazi=bazi,
        liuyao=liuyao,
    )


def cast_divination_at_instant(
    now_ms: int | None = None,
    location: str | dict[str, Any] = "Hà Nội",
    calendar_mode: CalendarMode = "VN_UTC7",
    lines: Sequence[int] | None = None,
) -> InquiryDivinationIR:
    effective_now_ms = int(now_ms if now_ms is not None else int(time.time() * 1000))
    utc7_ms = effective_now_ms + 25_200_000
    epoch_day = utc7_ms // MS_PER_DAY
    ms_of_day = utc7_ms % MS_PER_DAY
    year, month, day = civil_from_epoch_day(epoch_day)
    total_seconds = ms_of_day // 1000
    hour = total_seconds // 3600
    minute = (total_seconds % 3600) // 60
    second = total_seconds % 60

    inquiry_temporal = normalize_birth_temporal(
        year=year,
        month=month,
        day=day,
        hour=hour,
        minute=minute,
        second=second,
        location=location,
        calendar_mode=calendar_mode,
    )

    method: LiuyaoCastMethod = "manual-lines" if lines is not None else "mai-hoa"
    effective_lines: Sequence[int] = (
        lines if lines is not None else derive_mai_hoa_lines(inquiry_temporal)
    )
    liuyao = cast_liuyao_chart(inquiry_temporal, effective_lines, method)

    utc7_iso_wall_clock = (
        f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:{second:02d}"
    )
    shichen_vi = inquiry_temporal.true_solar_time.shichen_branch_vi
    day_can_chi = inquiry_temporal.pillars.day_pillar.label_vi
    inquiry_time_label_vi = (
        f"Thời khắc hiện tại: {hour:02d}:{minute:02d} · "
        f"{day:02d}/{month:02d}/{year:04d} (Giờ {shichen_vi} · {day_can_chi})"
    )

    return InquiryDivinationIR(
        now_ms=effective_now_ms,
        utc7_iso_wall_clock=utc7_iso_wall_clock,
        inquiry_time_label_vi=inquiry_time_label_vi,
        inquiry_temporal=inquiry_temporal,
        liuyao=liuyao,
    )


__all__ = [
    "BaziAxiomSpec",
    "BaziChartIR",
    "BaziDaiVanIR",
    "BaziDieuHauIR",
    "BaziHiddenStemIR",
    "BaziPillarDetailIR",
    "BaziPillarPosition",
    "BaziStrengthClass",
    "ChartIR",
    "CucNumber",
    "DieuHauEntrySpec",
    "Direction",
    "ELEMENTS_VI",
    "EmpiricalForkIR",
    "ForkedStarDetailIR",
    "Gender",
    "HiddenStemSpec",
    "InquiryDivinationIR",
    "LiuyaoAxiomSpec",
    "LiuyaoCastMethod",
    "LiuyaoChartIR",
    "LiuyaoHexagramSpec",
    "LiuyaoHexagramSummaryIR",
    "LiuyaoLineIR",
    "LiuyaoLineValue",
    "LiuyaoPhucThanIR",
    "NapAmEntrySpec",
    "SihuaTransform",
    "ZiweiAxiomSpec",
    "ZiweiChartIR",
    "ZiweiLuuNienIR",
    "ZiweiLuuNienSihuaIR",
    "ZiweiNguyetHanEntryIR",
    "ZiweiPalaceIR",
    "ZiweiSilo",
    "ZiweiStarCategory",
    "ZiweiStarIR",
    "ZiweiThaiTueTuLinhIR",
    "cast_bazi_chart",
    "cast_divination_at_instant",
    "cast_liuyao_chart",
    "cast_ziwei_chart",
    "compare_code_point",
    "compile_chart_ir",
    "compute_empirical_forks",
    "compute_liuyao_relative_vi",
    "compute_ten_god_index",
    "derive_mai_hoa_lines",
    "load_bazi_axiom",
    "load_liuyao_axiom",
    "load_ziwei_axiom",
    "sexagenary_index",
    "stem_element_index",
]
