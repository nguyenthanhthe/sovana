"""Comprehensive unit and algebraic invariant tests for sovana.kernel."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from sovana.geo_time import (
    canonical_json,
    civil_from_epoch_day,
    epoch_day_from_civil,
    find_lap_xuan_ms,
    load_ephemeris,
    normalize_birth_temporal,
    sha256_canonical,
)
from sovana.kernel import (
    Gender,
    ZiweiSilo,
    cast_bazi_chart,
    cast_divination_at_instant,
    cast_liuyao_chart,
    cast_ziwei_chart,
    compile_chart_ir,
    derive_mai_hoa_lines,
)

EXPECTED_14_MAJOR_STARS = frozenset(
    {
        "Tử Vi",
        "Thiên Cơ",
        "Thái Dương",
        "Vũ Khúc",
        "Thiên Đồng",
        "Liêm Trinh",
        "Thiên Phủ",
        "Thái Âm",
        "Tham Lang",
        "Cự Môn",
        "Thiên Tướng",
        "Thiên Lương",
        "Thất Sát",
        "Phá Quân",
    }
)

EXPECTED_5_RELATIVES = frozenset(
    {"Phụ Mẫu", "Huynh Đệ", "Tử Tôn", "Thê Tài", "Quan Quỷ"}
)


def _star_branch_map(ziwei_chart: object, major_only: bool = False) -> dict[str, int]:
    from sovana.kernel.models import ZiweiChartIR

    assert isinstance(ziwei_chart, ZiweiChartIR)
    out: dict[str, int] = {}
    for palace in ziwei_chart.palaces:
        for s in palace.major_stars:
            out[s.name] = palace.branch_index
        if not major_only:
            for s in palace.minor_stars:
                out[s.name] = palace.branch_index
    return out


def _sihua_by_star(ziwei_chart: object) -> dict[str, str]:
    from sovana.kernel.models import ZiweiChartIR

    assert isinstance(ziwei_chart, ZiweiChartIR)
    out: dict[str, str] = {}
    for palace in ziwei_chart.palaces:
        for s in (*palace.major_stars, *palace.minor_stars):
            if s.sihua_transform is not None:
                out[s.name] = s.sihua_transform
    return out


def test_canonical_schema_camel_case_and_determinism() -> None:
    temporal = normalize_birth_temporal(
        1980, 8, 15, 10, 30, "Đà Nẵng", migration_destination="TP. Hồ Chí Minh"
    )
    chart = compile_chart_ir(
        temporal=temporal,
        gender="male",
        target_year=2026,
        liuyao_lines=[6, 7, 8, 9, 7, 8],
    )
    payload = canonical_json(chart)
    digest = sha256_canonical(chart)
    assert len(digest) == 64

    parsed = json.loads(payload)
    assert set(parsed.keys()) == {
        "schemaVersion",
        "gender",
        "temporal",
        "ziweiNamPhai",
        "ziweiToanThu",
        "empiricalForks",
        "bazi",
        "liuyao",
    }
    assert parsed["ziweiNamPhai"]["luuNien"]["targetYear"] == 2026
    assert "dayMasterScoreBps" in parsed["bazi"]
    assert "elementScoresBps" in parsed["bazi"]
    assert "daiVanStartAgeMonths" in parsed["bazi"]
    assert "daiVanStartAgeYears" in parsed["bazi"]
    assert "code6bit" in parsed["liuyao"]["primaryHexagram"]
    assert "bitsIndex" in parsed["liuyao"]["primaryHexagram"]

    # Re-compiling produces bit-exact SHA-256
    chart_again = compile_chart_ir(
        temporal=temporal,
        gender="male",
        target_year=2026,
        liuyao_lines=[6, 7, 8, 9, 7, 8],
    )
    assert sha256_canonical(chart_again) == digest


def test_smoking_gun_2_can_canh_and_can_nham_silo_isolation() -> None:
    # 1. Can Canh (1980 Canh Thân -> stem_index == 6)
    t_canh = normalize_birth_temporal(1980, 8, 15, 10, 30, "Đà Nẵng")
    assert t_canh.pillars.lunar_year_pillar.stem_index == 6

    ir_canh = compile_chart_ir(t_canh, "male")
    np_sihua = _sihua_by_star(ir_canh.ziwei_nam_phai)
    tt_sihua = _sihua_by_star(ir_canh.ziwei_toan_thu)

    assert np_sihua == {
        "Thái Dương": "Hóa Lộc",
        "Vũ Khúc": "Hóa Quyền",
        "Thiên Đồng": "Hóa Khoa",
        "Thái Âm": "Hóa Kỵ",
    }
    assert tt_sihua == {
        "Thái Dương": "Hóa Lộc",
        "Vũ Khúc": "Hóa Quyền",
        "Thái Âm": "Hóa Khoa",
        "Thiên Đồng": "Hóa Kỵ",
    }
    assert ir_canh.empirical_forks.has_sihua_fork is True
    assert ir_canh.empirical_forks.consensus_mode is False
    assert [f.star_name for f in ir_canh.empirical_forks.forked_stars] == [
        "Thiên Đồng",
        "Thái Âm",
    ]

    # 2. Can Nhâm (1992 Nhâm Thân -> stem_index == 8): Thiên Phủ vs Tả Phụ Hóa Khoa
    t_nham = normalize_birth_temporal(1992, 6, 20, 8, 0, "Hà Nội")
    assert t_nham.pillars.lunar_year_pillar.stem_index == 8

    ir_nham = compile_chart_ir(t_nham, "female")
    assert _sihua_by_star(ir_nham.ziwei_nam_phai)["Thiên Phủ"] == "Hóa Khoa"
    assert "Tả Phụ" not in _sihua_by_star(ir_nham.ziwei_nam_phai)
    assert _sihua_by_star(ir_nham.ziwei_toan_thu)["Tả Phụ"] == "Hóa Khoa"
    assert "Thiên Phủ" not in _sihua_by_star(ir_nham.ziwei_toan_thu)
    assert ir_nham.empirical_forks.has_sihua_fork is True
    assert {f.star_name for f in ir_nham.empirical_forks.forked_stars} == {
        "Thiên Phủ",
        "Tả Phụ",
    }

    # 3. Consensus stem (1984 Giáp Tý -> stem_index == 0, non-ambiguous hour)
    t_giap = normalize_birth_temporal(1984, 6, 15, 10, 0, "Hà Nội")
    assert t_giap.pillars.lunar_year_pillar.stem_index == 0
    assert t_giap.uncertainty.is_boundary_ambiguous is False
    ir_giap = compile_chart_ir(t_giap, "male")
    assert ir_giap.empirical_forks.has_sihua_fork is False
    assert ir_giap.empirical_forks.forked_stars == []
    assert ir_giap.empirical_forks.consensus_mode is True


def test_ziwei_algebraic_invariants_across_600_charts() -> None:
    base_day = epoch_day_from_civil(1950, 1, 1)
    checked = 0

    for i in range(300):
        # Deterministic prime-stride sweep across 1950..2035 covering all months, days, leap months
        ed = base_day + i * 103
        yr, mo, dy = civil_from_epoch_day(ed)
        hour = ((i % 12) * 2) % 24
        minute = 30
        gender: Gender = "male" if i % 2 == 0 else "female"
        temporal = normalize_birth_temporal(yr, mo, dy, hour, minute, "Hà Nội")

        silos: tuple[ZiweiSilo, ZiweiSilo] = ("nam-phai", "toan-thu")
        for silo in silos:
            zw = cast_ziwei_chart(temporal, gender, silo)
            checked += 1

            # 1. 12 palaces partition Z_12 bijectively
            assert [p.branch_index for p in zw.palaces] == list(range(12))
            assert len({p.palace_name for p in zw.palaces}) == 12
            assert sum(1 for p in zw.palaces if p.is_menh) == 1
            assert sum(1 for p in zw.palaces if p.is_than) == 1
            assert zw.palaces[zw.menh_branch].palace_name == "Mệnh"
            assert zw.palaces[zw.than_branch].is_than is True

            # 2. Conservation of all 14 major stars (each appears exactly once)
            all_majors = [s.name for p in zw.palaces for s in p.major_stars]
            assert len(all_majors) == 14
            assert frozenset(all_majors) == EXPECTED_14_MAJOR_STARS

            # 3. Core reflection symmetries on Z_12
            pos_major = _star_branch_map(zw, major_only=True)
            pos_all = _star_branch_map(zw, major_only=False)
            assert pos_major["Tử Vi"] == zw.tu_vi_branch
            assert pos_major["Thiên Phủ"] == zw.thien_phu_branch
            assert (pos_major["Tử Vi"] + pos_major["Thiên Phủ"]) % 12 == 4
            assert (pos_all["Tả Phụ"] + pos_all["Hữu Bật"]) % 12 == 2
            assert (pos_all["Văn Khúc"] + pos_all["Văn Xương"]) % 12 == 2
            assert (pos_all["Địa Kiếp"] + pos_all["Địa Không"]) % 12 == 10

            # 4. Tuần Trung & Triệt Lộ each hit 2 distinct palaces
            assert sum(1 for p in zw.palaces if p.tuan_trung) == 2
            assert sum(1 for p in zw.palaces if p.triet_lo) == 2

            # 5. Exactly 4 distinct Tứ Hóa transforms attached across chart
            sihua_map = _sihua_by_star(zw)
            assert set(sihua_map.values()) == {
                "Hóa Lộc",
                "Hóa Quyền",
                "Hóa Khoa",
                "Hóa Kỵ",
            }

            # 6. Deterministic code-point sorting & Đại Hạn partition
            for p in zw.palaces:
                assert [s.name for s in p.major_stars] == sorted(
                    s.name for s in p.major_stars
                )
                assert [s.name for s in p.minor_stars] == sorted(
                    s.name for s in p.minor_stars
                )
                for ms in p.major_stars:
                    assert ms.brightness in (
                        "Miếu",
                        "Vượng",
                        "Đắc",
                        "Lợi",
                        "Bình",
                        "Bất",
                        "Hãm",
                    )

            expected_starts = {zw.cuc_number + 10 * k for k in range(12)}
            assert {p.dai_han_start_age for p in zw.palaces} == expected_starts

    assert checked == 600


def test_bazi_lap_xuan_exact_minute_transition_and_scoring() -> None:
    eph = load_ephemeris()
    lap_xuan_2024_ms = find_lap_xuan_ms(eph, 2024)

    # Convert exact Lập Xuân instant +/- 120 seconds into UTC+7 wall clock (Hà Nội)
    before_dt = datetime.fromtimestamp(
        (lap_xuan_2024_ms - 120_000) / 1000.0, tz=UTC
    )
    after_dt = datetime.fromtimestamp(
        (lap_xuan_2024_ms + 120_000) / 1000.0, tz=UTC
    )

    # Shift to UTC+7 wall clock
    before_vn = datetime.fromtimestamp(before_dt.timestamp() + 7 * 3600, tz=UTC)
    after_vn = datetime.fromtimestamp(after_dt.timestamp() + 7 * 3600, tz=UTC)

    t_before = normalize_birth_temporal(
        before_vn.year,
        before_vn.month,
        before_vn.day,
        before_vn.hour,
        before_vn.minute,
        "Hà Nội",
        second=before_vn.second,
    )
    t_after = normalize_birth_temporal(
        after_vn.year,
        after_vn.month,
        after_vn.day,
        after_vn.hour,
        after_vn.minute,
        "Hà Nội",
        second=after_vn.second,
    )

    bz_before = cast_bazi_chart(t_before, "male")
    bz_after = cast_bazi_chart(t_after, "male")

    assert bz_before.year_pillar.pillar.label_vi == "Quý Mão"
    assert bz_before.month_pillar.pillar.branch_vi == "Sửu"
    assert bz_before.direction == -1  # Quý (Yin) + male -> -1

    assert bz_after.year_pillar.pillar.label_vi == "Giáp Thìn"
    assert bz_after.month_pillar.pillar.branch_vi == "Dần"
    assert bz_after.direction == 1  # Giáp (Yang) + male -> +1

    # Right after Lập Xuân, Yin-Female (-1) counts backward to Lập Xuân (~120 seconds -> 0 years)
    bz_after_female = cast_bazi_chart(t_after, "female")
    assert bz_after_female.direction == -1
    assert 0 <= bz_after_female.seconds_to_target_jie <= 180
    assert bz_after_female.dai_van_start_age_months == 0
    assert bz_after_female.dai_van_start_age_years == 0

    # Quantitative scoring & Climate audit note checks
    assert bz_after.day_pillar.stem_ten_god == "Nhật Chủ"
    assert 0 <= bz_after.day_master_score_bps <= 10_000
    assert len(bz_after.dai_van) == 8
    assert len(bz_after.dieu_hau.primary_god_stem_indices) >= 1
    assert bz_after.dieu_hau.summary_vi != ""
    assert "Köppen Cwa" in bz_after.climate_audit_note

    t_hcm = normalize_birth_temporal(1995, 7, 10, 14, 0, "TP. Hồ Chí Minh")
    bz_hcm = cast_bazi_chart(t_hcm, "female")
    assert "Köppen Aw" in bz_hcm.climate_audit_note


def test_liuyao_all_64_hexagrams_phuc_than_and_mai_hoa() -> None:
    temporal = normalize_birth_temporal(2024, 5, 18, 9, 30, "Hà Nội")
    king_wen_numbers: set[int] = set()
    phuc_than_non_empty_count = 0

    for bits in range(64):
        static_lines = [7 if ((bits >> i) & 1) == 1 else 8 for i in range(6)]
        ly = cast_liuyao_chart(temporal, static_lines)

        assert ly.primary_hexagram.bits_index == bits
        assert ly.transformed_hexagram.bits_index == bits
        assert ly.has_moving_lines is False
        assert ly.moving_lines == []
        assert len(ly.primary_hexagram.code6bit) == 6
        king_wen_numbers.add(ly.primary_hexagram.king_wen_number)

        # Thế - Ứng invariant: separated by 3 lines
        the_l = ly.primary_hexagram.the_line
        ung_l = ly.primary_hexagram.ung_line
        assert 1 <= the_l <= 6
        assert 1 <= ung_l <= 6
        assert abs(the_l - ung_l) == 3
        assert sum(1 for ln in ly.lines if ln.is_the) == 1
        assert sum(1 for ln in ly.lines if ln.is_ung) == 1

        # 8-pure hexagrams always contain all 5 Lục Thân -> no Phục Thần needed
        if ly.primary_hexagram.upper_trigram == ly.primary_hexagram.lower_trigram:
            assert ly.phuc_than == []

        if ly.phuc_than:
            phuc_than_non_empty_count += 1

        # Fundamental Tăng San Bốc Dịch invariant:
        # Visible relatives U Phục Thần missing relatives === all 5 Lục Thân!
        visible_rels = {ln.relative_vi for ln in ly.lines}
        hidden_rels = {pt.missing_relative_vi for pt in ly.phuc_than}
        assert visible_rels.isdisjoint(hidden_rels)
        assert (visible_rels | hidden_rels) == EXPECTED_5_RELATIVES

    assert king_wen_numbers == set(range(1, 65))
    assert phuc_than_non_empty_count > 0

    # Moving lines transformation: 6 (Lão Âm -> Dương 1) & 9 (Lão Dương -> Âm 0)
    # Primary all-Yang Càn (bits 63 = [9,9,9,9,9,9]) transforms to all-Yin Khôn (bits 0)
    ly_can_to_khon = cast_liuyao_chart(temporal, [9, 9, 9, 9, 9, 9])
    assert ly_can_to_khon.primary_hexagram.bits_index == 63
    assert ly_can_to_khon.transformed_hexagram.bits_index == 0
    assert ly_can_to_khon.has_moving_lines is True
    assert ly_can_to_khon.moving_lines == [1, 2, 3, 4, 5, 6]
    for ln in ly_can_to_khon.lines:
        assert ln.transformed_branch_index is not None
        assert ln.transformed_relative_vi in EXPECTED_5_RELATIVES

    # Mai Hoa Dịch Số derivation
    mh_lines = derive_mai_hoa_lines(temporal)
    assert len(mh_lines) == 6
    assert sum(1 for v in mh_lines if v in (6, 9)) == 1
    ir_mh = compile_chart_ir(temporal, "male", cast_mai_hoa=True)
    assert ir_mh.liuyao is not None
    assert ir_mh.liuyao.method == "mai-hoa"
    assert ir_mh.liuyao.line_values == mh_lines


def test_kernel_input_validation_errors() -> None:
    temporal = normalize_birth_temporal(2000, 1, 1, 12, 0, "Hà Nội")

    with pytest.raises(ValueError):
        cast_ziwei_chart(temporal, "other", "nam-phai")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        cast_ziwei_chart(temporal, "male", "other")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        cast_ziwei_chart(temporal, "male", "nam-phai", target_year=True)
    with pytest.raises(ValueError):
        cast_bazi_chart(temporal, "other")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        cast_liuyao_chart(temporal, [7, 7, 7])
    with pytest.raises(ValueError):
        cast_liuyao_chart(temporal, [7, 7, 7, 7, 7, 5])
    with pytest.raises(ValueError):
        cast_liuyao_chart(temporal, [True, 7, 7, 7, 7, 7])


def test_nam_phai_105_stars_vcd_tu_linh_luu_nien_and_real_time_divination() -> None:
    t_vcd = normalize_birth_temporal(1980, 8, 15, 0, 30, "Đà Nẵng")
    ir = compile_chart_ir(t_vcd, "male", target_year=2026)
    np = ir.ziwei_nam_phai
    tt = ir.ziwei_toan_thu

    assert sum(len(p.minor_stars) for p in np.palaces) == 91
    assert sum(len(p.minor_stars) for p in tt.palaces) == 90

    np_map = _star_branch_map(np)
    tt_map = _star_branch_map(tt)
    yb = t_vcd.pillars.lunar_year_pillar.branch_index
    eff_m = t_vcd.lunar_active.effective_lunar_month
    hb = t_vcd.true_solar_time.shichen_branch

    assert "Thiên Không" in np_map
    assert "Thiên Không" not in tt_map
    assert np_map["Thiên Không"] == (yb + 1) % 12
    assert np_map["Nguyệt Đức"] == (5 + yb) % 12
    assert tt_map["Nguyệt Đức"] == yb
    assert np_map["Thiên Giải"] == (8 + eff_m - 1) % 12
    assert np_map["Linh Tinh"] == (10 - np.direction * hb) % 12

    nam_phai_17 = (
        "Kình Dương", "Đà La", "Hỏa Tinh", "Linh Tinh", "Văn Xương", "Văn Khúc",
        "Địa Không", "Địa Kiếp", "Đại Hao", "Tiểu Hao", "Thiên Khốc", "Thiên Hư",
        "Thiên Mã", "Thiên Hình", "Thiên Riêu", "Tang Môn", "Bạch Hổ",
    )
    minor_by_name = {s.name: s for p in np.palaces for s in p.minor_stars}
    for s_name in nam_phai_17:
        assert minor_by_name[s_name].brightness in ("Đắc", "Hãm")

    menh_p = np.palaces[np.menh_branch]
    opp_p = np.palaces[(np.menh_branch + 6) % 12]
    assert menh_p.vo_chinh_dieu is True
    assert menh_p.borrowed_major_stars == opp_p.major_stars

    # Yin year Tứ Linh invariant
    t_yin = normalize_birth_temporal(1985, 6, 15, 10, 0, "Hà Nội")
    c_yin = cast_ziwei_chart(t_yin, "female", "nam-phai")
    yb_yin = t_yin.pillars.lunar_year_pillar.branch_index
    assert yb_yin % 2 == 1
    c_yin_map = _star_branch_map(c_yin)
    tt_branches = {yb_yin, (yb_yin + 4) % 12, (yb_yin + 8) % 12}
    for tl_star in ("Long Trì", "Phượng Các", "Bạch Hổ", "Hoa Cái"):
        assert c_yin_map[tl_star] in tt_branches

    assert np.luu_nien is not None
    ln = np.luu_nien
    assert len(ln.luu_dong_tinh_by_branch) == 12
    assert sum(len(b) for b in ln.luu_dong_tinh_by_branch) == 9
    assert [x.transform for x in ln.luu_nien_sihua] == [
        "Hóa Lộc", "Hóa Quyền", "Hóa Khoa", "Hóa Kỵ"
    ]
    assert [x.lunar_month for x in ln.nguyet_han] == list(range(1, 13))
    assert len({x.branch_index for x in ln.nguyet_han}) == 12

    # Real-time divination at 2026-05-15T16:30:00Z == 23:30:00 UTC+7
    now_ms = int(datetime(2026, 5, 15, 16, 30, 0, tzinfo=UTC).timestamp() * 1000)
    inq = cast_divination_at_instant(now_ms=now_ms, location="Hà Nội")
    assert inq.utc7_iso_wall_clock == "2026-05-15T23:30:00"
    assert "Thời khắc hiện tại: 23:30 · 15/05/2026" in inq.inquiry_time_label_vi
    assert inq.liuyao.method == "mai-hoa"

    manual = cast_divination_at_instant(now_ms=now_ms, location="Sài Gòn", lines=[6, 7, 8, 9, 7, 8])
    assert manual.liuyao.method == "manual-lines"
    assert manual.liuyao.line_values == [6, 7, 8, 9, 7, 8]
