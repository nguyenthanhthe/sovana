"""Unit tests for sovana.geo_time."""

import pytest
from sovana.geo_time import (
    canonical_json,
    compute_migration_azimuth,
    compute_true_solar_time,
    convert_lunar_to_solar,
    epoch_day_from_civil,
    get_civil_month_days,
    get_lunar_year_leap_info,
    is_valid_civil_date,
    list_provinces_34,
    list_provinces_63,
    load_ephemeris,
    lunar_to_solar,
    map_34_to_63,
    map_63_to_34,
    normalize_birth_temporal,
    resolve_historical_timezone,
    resolve_location,
    sha256_canonical,
    solar_to_lunar,
)


def test_smoking_gun_1_vn_vs_cn_and_lunar_roundtrip() -> None:
    eph = load_ephemeris()

    d1968 = epoch_day_from_civil(1968, 1, 29)
    vn1968 = solar_to_lunar(eph, d1968, "VN_UTC7")
    cn1968 = solar_to_lunar(eph, d1968, "CN_UTC8")
    assert (vn1968.lunar_year, vn1968.lunar_month, vn1968.lunar_day) == (1968, 1, 1)
    assert (cn1968.lunar_year, cn1968.lunar_month, cn1968.lunar_day) == (1967, 12, 30)

    d1985 = epoch_day_from_civil(1985, 1, 21)
    vn1985 = solar_to_lunar(eph, d1985, "VN_UTC7")
    cn1985 = solar_to_lunar(eph, d1985, "CN_UTC8")
    assert (vn1985.lunar_year, vn1985.lunar_month, vn1985.lunar_day) == (1985, 1, 1)
    assert (cn1985.lunar_year, cn1985.lunar_month, cn1985.lunar_day) == (1984, 12, 1)

    d2030 = epoch_day_from_civil(2030, 2, 2)
    assert solar_to_lunar(eph, d2030, "VN_UTC7").lunar_month == 1
    assert solar_to_lunar(eph, d2030, "CN_UTC8").lunar_month == 12

    rt = lunar_to_solar(eph, 1985, 2, 15, is_leap_month=True, calendar_mode="VN_UTC7")
    back = solar_to_lunar(eph, rt.epoch_day, "VN_UTC7", "split-15")
    assert back.is_leap_month is True
    assert back.effective_lunar_month == 2

    back_16 = solar_to_lunar(eph, rt.epoch_day + 1, "VN_UTC7", "split-15")
    assert back_16.lunar_day == 16
    assert back_16.effective_lunar_month == 3


def test_smoking_gun_3_historical_timezones_and_17th_parallel() -> None:
    hn = normalize_birth_temporal(1968, 5, 15, 1, 15, "Hà Nội")
    sg = normalize_birth_temporal(1968, 5, 15, 1, 15, "Sài Gòn")

    assert hn.timezone.zone_id == "VN_NORTH_DRV"
    assert hn.timezone.utc_offset_seconds == 25_200
    assert sg.timezone.zone_id == "VN_SOUTH_RVN"
    assert sg.timezone.utc_offset_seconds == 28_800
    assert sg.true_solar_time.shichen_branch == 0
    assert hn.true_solar_time.shichen_branch == 1

    hn1945 = resolve_historical_timezone(1945, 6, 1, 12, 0, lat=21.0285, lon=105.8542)
    assert hn1945.regime_id == "VN_1945_JAPAN_UTC9"
    assert hn1945.utc_offset_seconds == 32_400

    hn1950 = resolve_historical_timezone(1950, 6, 1, 12, 0, lat=21.0285, lon=105.8542)
    assert hn1950.is_contested_zone is True
    assert hn1950.candidate_offsets_seconds == [25_200, 28_800]

    sg1975 = resolve_historical_timezone(1975, 6, 13, 8, 0, lat=10.7769, lon=106.7009)
    assert sg1975.utc_offset_seconds == 25_200

    assert resolve_location("Vĩnh Linh, Quảng Trị").tz_zone == "VN_NORTH_DRV"
    assert resolve_location("Đông Hà, Quảng Trị").tz_zone == "VN_SOUTH_RVN"


def test_bi_temporal_gis_and_vincenty() -> None:
    assert len(list_provinces_34()) == 34
    assert len(list_provinces_63()) == 63

    hy = map_63_to_34("Thái Bình")
    assert hy["id"] == "hung-yen"
    assert sorted(p["shortName"] for p in map_34_to_63("hung-yen")) == ["Hưng Yên", "Thái Bình"]

    pq = resolve_location("Phú Quốc")
    assert pq.matched_by == "special_zone"
    assert pq.post2025_id == "an-giang"

    assert resolve_location("lam-dong").wide_longitude_warning is True

    hn = resolve_location("Hà Nội")
    hcm = resolve_location("TP. Hồ Chí Minh")
    mig = compute_migration_azimuth(hn.lat, hn.lon, hcm.lat, hcm.lon)
    assert mig.is_significant_migration is True
    assert 1_130_000 < mig.distance_meters < 1_165_000
    assert mig.palace_branch_vi == "Ngọ"


def test_canonical_json_and_true_solar_boundary() -> None:
    tst = compute_true_solar_time(2000, 6, 15, 1, 2, 0, lon=105.0, utc_offset_seconds=25_200)
    assert tst.seconds_to_shichen_boundary <= 900

    assert canonical_json({"b": 1, "a": -0.0, "c": 105.0}) == '{"a":0,"b":1,"c":105}'
    norm = normalize_birth_temporal(
        2025, 8, 15, 9, 30, "Hà Nội", migration_destination="TP. Hồ Chí Minh"
    )
    assert len(sha256_canonical(norm)) == 64


def test_full_73414_day_lunar_roundtrip_vn_and_cn() -> None:
    eph = load_ephemeris()
    start_day = epoch_day_from_civil(1900, 1, 1)
    end_day = epoch_day_from_civil(2100, 12, 31)
    assert end_day - start_day + 1 == 73_414

    for mode in ("VN_UTC7", "CN_UTC8"):
        for d in range(start_day, end_day + 1):
            lunar = solar_to_lunar(eph, d, mode)
            solar = lunar_to_solar(
                eph,
                lunar.lunar_year,
                lunar.lunar_month,
                lunar.lunar_day,
                is_leap_month=lunar.is_leap_month,
                calendar_mode=mode,
            )
            assert solar.epoch_day == d


def test_convert_lunar_to_solar_leap_info_and_civil_dates() -> None:
    b_start = convert_lunar_to_solar(1899, 12, 1, calendar_mode="VN_UTC7")
    assert b_start.iso_date == "1900-01-01"
    b_end = convert_lunar_to_solar(1899, 12, 30, calendar_mode="VN_UTC7")
    assert b_end.iso_date == "1900-01-30"

    sg1968 = convert_lunar_to_solar(
        1968, 1, 1, calendar_mode="VN_HISTORICAL", location="Sài Gòn"
    )
    assert sg1968.effective_lunar_calendar == "CN_UTC8"
    assert sg1968.iso_date == "1968-01-30"
    hn1968 = convert_lunar_to_solar(
        1968, 1, 1, calendar_mode="VN_HISTORICAL", location="Hà Nội"
    )
    assert hn1968.effective_lunar_calendar == "VN_UTC7"
    assert hn1968.iso_date == "1968-01-29"

    leap_info = get_lunar_year_leap_info(1985, "VN_UTC7")
    assert leap_info.leap_month == 2
    assert len(leap_info.months) == 13
    leap_1985 = convert_lunar_to_solar(1985, 2, 15, is_leap_month=True, calendar_mode="VN_UTC7")
    assert leap_1985.is_leap_month is True
    assert leap_1985.iso_date == "1985-04-04"

    short_month = next(m for m in leap_info.months if m.length_days == 29)
    with pytest.raises(ValueError, match="Invalid lunar day"):
        convert_lunar_to_solar(
            1985,
            short_month.lunar_month,
            30,
            is_leap_month=short_month.is_leap_month,
            calendar_mode="VN_UTC7",
        )

    assert get_civil_month_days(2024, 2) == 29
    assert get_civil_month_days(2025, 2) == 28
    assert get_civil_month_days(1900, 2) == 28
    assert get_civil_month_days(2000, 2) == 29
    assert get_civil_month_days(2025, 4) == 30
    assert is_valid_civil_date(2025, 2, 30) is False
    assert is_valid_civil_date(2025, 2, 29) is False
    assert is_valid_civil_date(2024, 2, 29) is True
    assert is_valid_civil_date(2025, 4, 31) is False
