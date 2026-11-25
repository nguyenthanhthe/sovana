"""Quantitative Four Pillars (Bazi / Tứ Trụ Tử Bình) engine."""

from __future__ import annotations

from sovana.geo_time.data import load_ephemeris
from sovana.geo_time.ephemeris import BRANCHES_VI, STEMS_VI, floor_mod, js_round
from sovana.geo_time.models import NormalizedBirthTemporal, PillarPair
from sovana.kernel.data import load_bazi_axiom
from sovana.kernel.models import (
    BaziChartIR,
    BaziDaiVanIR,
    BaziDieuHauIR,
    BaziHiddenStemIR,
    BaziPillarDetailIR,
    BaziPillarPosition,
    BaziStrengthClass,
    Direction,
    Gender,
)
from sovana.kernel.ziwei import sexagenary_index

ELEMENTS_VI: tuple[str, str, str, str, str] = ("Mộc", "Hỏa", "Thổ", "Kim", "Thủy")

_BRANCH_ELEMENTS_VI: tuple[str, ...] = (
    "Thủy",
    "Thổ",
    "Mộc",
    "Mộc",
    "Thổ",
    "Hỏa",
    "Hỏa",
    "Thổ",
    "Kim",
    "Kim",
    "Thổ",
    "Thủy",
)

_CLIMATE_AUDIT_NOTES: dict[str, str] = {
    "Cwa": (
        "Köppen Cwa (Cận nhiệt đới ẩm mùa đông khô lạnh): Có mùa đông lạnh rõ rệt tương đồng "
        "lưu vực Hoa Nam/Giang Nam; áp dụng trực tiếp Điều Hầu Cùng Thông Bảo Giám "
        "(0% chỉnh số Ngũ Hành)."
    ),
    "Cwb": (
        "Köppen Cwb (Cao nguyên cận nhiệt đới ôn hòa): Nền nhiệt mát quanh năm và biên độ ngày "
        "đêm lớn; đối chiếu song song Điều Hầu cổ điển với thực địa cao nguyên "
        "(0% chỉnh số Ngũ Hành)."
    ),
    "Am": (
        "Köppen Am (Nhiệt đới gió mùa ẩm): Mùa thu–đông mưa ẩm thay vì băng tuyết cực đoan; "
        "đối chiếu song song Điều Hầu cổ điển với độ ẩm thực địa (0% chỉnh số Ngũ Hành)."
    ),
    "Aw": (
        "Köppen Aw (Nhiệt đới xavan hai mùa mưa–khô): Nền nhiệt cao quanh năm không có sương "
        "tuyết mùa đông; giữ nguyên cấu trúc Tứ Trụ và ghi nhận độ lệch vĩ độ khi đọc Điều Hầu "
        "mùa Đông (0% chỉnh số Ngũ Hành)."
    ),
}

_DEFAULT_CLIMATE_AUDIT_NOTE = (
    "Đối chiếu song song Điều Hầu Dụng Thần cổ điển với vùng khí hậu thực địa theo tọa độ "
    "vĩ độ nơi sinh (0% chỉnh số Ngũ Hành)."
)


def stem_element_index(stem_index: int) -> int:
    return stem_index // 2


def compute_ten_god_index(day_master_stem: int, target_stem: int) -> int:
    dm_elem = stem_element_index(day_master_stem)
    t_elem = stem_element_index(target_stem)
    rel = floor_mod(t_elem - dm_elem, 5)
    polarity_offset = 0 if (day_master_stem % 2 == target_stem % 2) else 1
    return rel * 2 + polarity_offset


def _make_pillar_pair(stem_index: int, branch_index: int) -> PillarPair:
    s = floor_mod(stem_index, 10)
    b = floor_mod(branch_index, 12)
    return PillarPair(
        stem_index=s,
        branch_index=b,
        stem_vi=STEMS_VI[s],
        branch_vi=BRANCHES_VI[b],
        label_vi=f"{STEMS_VI[s]} {BRANCHES_VI[b]}",
    )


def _compute_seconds_to_target_jie(
    temporal: NormalizedBirthTemporal,
    direction: Direction,
) -> int:
    eph = load_ephemeris()
    instant_ms = temporal.true_solar_time.instant_unix_ms
    cur_idx = temporal.solar_term.index

    if direction == 1:
        k = cur_idx + 1
        while k < len(eph.solar_terms):
            if (eph.first_solar_term_index + k) % 2 == 1:
                diff = eph.solar_terms[k] - instant_ms
                return max(0, diff // 1000)
            k += 1
        raise IndexError(f"Next Jie solar term out of ephemeris bounds for {instant_ms}")

    k = cur_idx
    while k >= 0:
        if (eph.first_solar_term_index + k) % 2 == 1:
            diff = instant_ms - eph.solar_terms[k]
            return max(0, diff // 1000)
        k -= 1
    raise IndexError(f"Previous Jie solar term out of ephemeris bounds for {instant_ms}")


def cast_bazi_chart(temporal: NormalizedBirthTemporal, gender: Gender) -> BaziChartIR:
    if gender not in ("male", "female"):
        raise ValueError(f"Invalid gender: {gender!r}")

    axiom = load_bazi_axiom()
    dm_stem = temporal.pillars.day_pillar.stem_index
    dm_elem_idx = stem_element_index(dm_stem)
    dm_elem_vi = ELEMENTS_VI[dm_elem_idx]
    month_branch = temporal.pillars.bazi_month_pillar.branch_index

    is_yang_year = temporal.pillars.bazi_year_pillar.stem_index % 2 == 0
    direction: Direction = 1 if is_yang_year == (gender == "male") else -1

    def ten_god_name(target_stem: int) -> str:
        return axiom.ten_gods_names_vi[compute_ten_god_index(dm_stem, target_stem)]

    def build_pillar_detail(
        position: BaziPillarPosition,
        pillar: PillarPair,
    ) -> BaziPillarDetailIR:
        s = pillar.stem_index
        b = pillar.branch_index
        stem_elem = ELEMENTS_VI[stem_element_index(s)]
        branch_elem = _BRANCH_ELEMENTS_VI[b]
        stem_ten_god = "Nhật Chủ" if position == "day" else ten_god_name(s)

        raw_hidden = axiom.hidden_stems_by_branch[str(b)]
        hidden_stems = [
            BaziHiddenStemIR(
                stem_index=hs.stem_index,
                stem_vi=STEMS_VI[hs.stem_index],
                element_vi=ELEMENTS_VI[stem_element_index(hs.stem_index)],
                weight_bps=hs.weight_bps,
                ten_god=ten_god_name(hs.stem_index),
            )
            for hs in raw_hidden
        ]

        nap_am_entry = axiom.nap_am60[sexagenary_index(s, b)]
        tk0 = floor_mod(b + 9 - s + 1, 12)
        tk1 = floor_mod(b + 9 - s + 2, 12)

        return BaziPillarDetailIR(
            position=position,
            pillar=pillar,
            stem_element_vi=stem_elem,
            branch_element_vi=branch_elem,
            stem_ten_god=stem_ten_god,
            hidden_stems=hidden_stems,
            nap_am_vi=nap_am_entry.nap_am_vi,
            nap_am_element_vi=nap_am_entry.element_vi,
            tuan_khong_branches=(tk0, tk1),
            tuan_khong_vi=(BRANCHES_VI[tk0], BRANCHES_VI[tk1]),
        )

    year_pillar = build_pillar_detail("year", temporal.pillars.bazi_year_pillar)
    month_pillar = build_pillar_detail("month", temporal.pillars.bazi_month_pillar)
    day_pillar = build_pillar_detail("day", temporal.pillars.day_pillar)
    hour_pillar = build_pillar_detail("hour", temporal.pillars.hour_pillar)

    four_pillars = (year_pillar, month_pillar, day_pillar, hour_pillar)

    elem_raw = [0, 0, 0, 0, 0]
    for p in four_pillars:
        s_elem_idx = stem_element_index(p.pillar.stem_index)
        elem_raw[s_elem_idx] += 1_000_000
        for hs in p.hidden_stems:
            h_elem_idx = stem_element_index(hs.stem_index)
            h_elem_vi = ELEMENTS_VI[h_elem_idx]
            seasonal_mult = axiom.seasonal_multiplier_bps[h_elem_vi][month_branch]
            elem_raw[h_elem_idx] += hs.weight_bps * seasonal_mult

    total_raw = sum(elem_raw)
    resource_elem_idx = floor_mod(dm_elem_idx - 1, 5)
    support_raw = elem_raw[dm_elem_idx] + elem_raw[resource_elem_idx]
    day_master_score_bps = js_round((support_raw * 10_000) / total_raw)

    strength_class: BaziStrengthClass
    if day_master_score_bps >= 5200:
        strength_class = "THAN_VUONG"
    elif day_master_score_bps <= 4400:
        strength_class = "THAN_NHUOC"
    else:
        strength_class = "CAN_BANG"

    element_scores_bps: dict[str, int] = {
        ELEMENTS_VI[i]: js_round((elem_raw[i] * 10_000) / total_raw)
        for i in range(len(ELEMENTS_VI))
    }

    seconds_to_target_jie = _compute_seconds_to_target_jie(temporal, direction)
    dai_van_start_age_months = seconds_to_target_jie // 21_600
    dai_van_start_age_years = js_round(seconds_to_target_jie / 259_200)

    dai_van: list[BaziDaiVanIR] = []
    for k in range(1, 9):
        dv_pillar = _make_pillar_pair(
            temporal.pillars.bazi_month_pillar.stem_index + direction * k,
            temporal.pillars.bazi_month_pillar.branch_index + direction * k,
        )
        start_age = dai_van_start_age_years + (k - 1) * 10
        nap_am = axiom.nap_am60[sexagenary_index(dv_pillar.stem_index, dv_pillar.branch_index)]
        dai_van.append(
            BaziDaiVanIR(
                index=k,
                pillar=dv_pillar,
                start_age=start_age,
                end_age=start_age + 9,
                stem_ten_god=ten_god_name(dv_pillar.stem_index),
                nap_am_vi=nap_am.nap_am_vi,
            )
        )

    raw_dieu_hau = axiom.cung_thong_bao_giam_dieu_hau[str(dm_stem)][str(month_branch)]
    dieu_hau = BaziDieuHauIR(
        primary_god_stem_indices=list(raw_dieu_hau.primary_god_stem_indices),
        primary_god_stems_vi=[STEMS_VI[idx] for idx in raw_dieu_hau.primary_god_stem_indices],
        summary_vi=raw_dieu_hau.summary_vi,
    )

    koppen = temporal.location.koppen_zone
    climate_audit_note = (
        _CLIMATE_AUDIT_NOTES.get(koppen, _DEFAULT_CLIMATE_AUDIT_NOTE)
        if koppen is not None
        else _DEFAULT_CLIMATE_AUDIT_NOTE
    )

    return BaziChartIR(
        gender=gender,
        direction=direction,
        day_master_stem_index=dm_stem,
        day_master_stem_vi=STEMS_VI[dm_stem],
        day_master_element_vi=dm_elem_vi,
        year_pillar=year_pillar,
        month_pillar=month_pillar,
        day_pillar=day_pillar,
        hour_pillar=hour_pillar,
        day_master_score_bps=day_master_score_bps,
        strength_class=strength_class,
        element_scores_bps=element_scores_bps,
        seconds_to_target_jie=seconds_to_target_jie,
        dai_van_start_age_months=dai_van_start_age_months,
        dai_van_start_age_years=dai_van_start_age_years,
        dai_van=dai_van,
        dieu_hau=dieu_hau,
        climate_audit_note=climate_audit_note,
    )
