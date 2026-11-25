"""Lunisolar calendar conversion (VN_UTC7 / CN_UTC8) and Sexagenary Pillars."""

from __future__ import annotations

import bisect
from dataclasses import dataclass
from typing import Any, Literal

from sovana.geo_time.data import load_ephemeris
from sovana.geo_time.ephemeris import (
    BRANCHES_VI,
    MS_PER_DAY,
    STEMS_VI,
    civil_from_epoch_day,
    epoch_day_from_civil,
    find_lap_xuan_ms,
    find_solar_term_at,
    format_iso_date,
    local_epoch_day_from_seconds,
)
from sovana.geo_time.geo import resolve_location
from sovana.geo_time.models import (
    CalendarMode,
    ConvertLunarToSolarResult,
    EphemerisTable,
    LateZiPolicy,
    LeapMonthPolicy,
    LunarDateResult,
    LunarMonthMeta,
    LunarYearLeapInfo,
    PillarPair,
    SexagenaryPillars,
    SolarDateResult,
)
from sovana.geo_time.tz import resolve_historical_timezone


@dataclass(frozen=True)
class _SuiMonthLabel:
    k: int
    day_start: int
    day_end: int
    lunar_year: int
    lunar_month: int
    is_leap_month: bool


def _get_offset_seconds(calendar_mode: CalendarMode, offset_seconds_override: int | None) -> int:
    if offset_seconds_override is not None:
        return offset_seconds_override
    return 28_800 if calendar_mode == "CN_UTC8" else 25_200


def _find_dong_chi_day(eph: EphemerisTable, approx_greg_year: int, offset_seconds: int) -> int:
    jan1_ms = epoch_day_from_civil(approx_greg_year, 1, 1) * MS_PER_DAY
    idx = max(0, bisect.bisect_right(eph.solar_terms, jan1_ms) - 1)
    while idx < len(eph.solar_terms):
        if (eph.first_solar_term_index + idx) % 24 == 18:
            d = local_epoch_day_from_seconds(eph.solar_terms[idx], offset_seconds)
            yr = civil_from_epoch_day(d)[0]
            if yr == approx_greg_year:
                return d
            if yr > approx_greg_year:
                break
        idx += 1
    raise IndexError(f"Dong Chi not found for year {approx_greg_year}")


def _new_moon_day_at(eph: EphemerisTable, k: int, offset_seconds: int) -> int:
    return local_epoch_day_from_seconds(eph.new_moons[k], offset_seconds)


def _find_k11_for_year(eph: EphemerisTable, greg_year: int, offset_seconds: int) -> int:
    dc_day = _find_dong_chi_day(eph, greg_year, offset_seconds)
    dc_ms_est = dc_day * MS_PER_DAY - offset_seconds * 1000 + MS_PER_DAY
    k = min(len(eph.new_moons) - 2, max(0, bisect.bisect_right(eph.new_moons, dc_ms_est) - 1))
    while k > 0 and _new_moon_day_at(eph, k, offset_seconds) > dc_day:
        k -= 1
    while k + 1 < len(eph.new_moons) and _new_moon_day_at(eph, k + 1, offset_seconds) <= dc_day:
        k += 1
    return k


def _month_has_zhongqi(eph: EphemerisTable, day0: int, day1: int, offset_seconds: int) -> bool:
    ms_low = day0 * MS_PER_DAY - offset_seconds * 1000 - MS_PER_DAY
    idx = max(0, bisect.bisect_right(eph.solar_terms, ms_low) - 1)
    while idx < len(eph.solar_terms):
        term_idx = (eph.first_solar_term_index + idx) % 24
        t_day = local_epoch_day_from_seconds(eph.solar_terms[idx], offset_seconds)
        if t_day >= day1:
            break
        if t_day >= day0 and term_idx % 2 == 0:
            return True
        idx += 1
    return False


_SUI_LABEL_CACHE: dict[tuple[int, int, int], list[_SuiMonthLabel]] = {}


def _build_sui_labels(eph: EphemerisTable, y0: int, offset_seconds: int) -> list[_SuiMonthLabel]:
    cache_key = (id(eph), y0, offset_seconds)
    cached = _SUI_LABEL_CACHE.get(cache_key)
    if cached is not None:
        return cached

    k_start = _find_k11_for_year(eph, y0, offset_seconds)
    k_end = _find_k11_for_year(eph, y0 + 1, offset_seconds)
    has_leap = (k_end - k_start) == 13
    leap_assigned = False
    month_num = 10
    lunar_year = y0
    labels: list[_SuiMonthLabel] = []

    for k in range(k_start, k_end):
        day_start = _new_moon_day_at(eph, k, offset_seconds)
        day_end = _new_moon_day_at(eph, k + 1, offset_seconds) - 1
        is_leap = False
        if k == k_start:
            month_num = 11
            lunar_year = y0
        elif (
            has_leap
            and not leap_assigned
            and not _month_has_zhongqi(eph, day_start, day_end + 1, offset_seconds)
        ):
            is_leap = True
            leap_assigned = True
        else:
            month_num += 1
            if month_num > 12:
                month_num = 1
            if month_num == 1:
                lunar_year = y0 + 1
        labels.append(
            _SuiMonthLabel(
                k=k,
                day_start=day_start,
                day_end=day_end,
                lunar_year=lunar_year,
                lunar_month=month_num,
                is_leap_month=is_leap,
            )
        )
    if len(_SUI_LABEL_CACHE) > 2048:
        _SUI_LABEL_CACHE.clear()
    _SUI_LABEL_CACHE[cache_key] = labels
    return labels


def compute_effective_lunar_month(
    lunar_month: int,
    lunar_day: int,
    is_leap_month: bool,
    policy: LeapMonthPolicy,
) -> int:
    if not is_leap_month:
        return lunar_month
    if policy == "next-month":
        return (lunar_month % 12) + 1
    if policy == "split-15":
        return lunar_month if lunar_day <= 15 else (lunar_month % 12) + 1
    return lunar_month


def solar_to_lunar(
    eph: EphemerisTable,
    epoch_day: int,
    calendar_mode: CalendarMode = "VN_UTC7",
    leap_month_policy: LeapMonthPolicy = "keep",
    offset_seconds_override: int | None = None,
) -> LunarDateResult:
    offset_seconds = _get_offset_seconds(calendar_mode, offset_seconds_override)
    greg_year = civil_from_epoch_day(epoch_day)[0]
    max_sui = eph.end_year - 2
    init_sui = max(eph.start_year, min(max_sui, greg_year - 1))

    labels = _build_sui_labels(eph, init_sui, offset_seconds)
    if epoch_day > labels[-1].day_end and init_sui + 1 <= max_sui:
        labels = _build_sui_labels(eph, init_sui + 1, offset_seconds)
    elif epoch_day < labels[0].day_start and init_sui - 1 >= eph.start_year:
        labels = _build_sui_labels(eph, init_sui - 1, offset_seconds)

    for m in labels:
        if m.day_start <= epoch_day <= m.day_end:
            lunar_day = epoch_day - m.day_start + 1
            month_len = m.day_end - m.day_start + 1
            return LunarDateResult(
                lunar_year=m.lunar_year,
                lunar_month=m.lunar_month,
                lunar_day=lunar_day,
                is_leap_month=m.is_leap_month,
                effective_lunar_month=compute_effective_lunar_month(
                    m.lunar_month, lunar_day, m.is_leap_month, leap_month_policy
                ),
                month_length_days=month_len,
                calendar_mode=calendar_mode,
                offset_seconds=offset_seconds,
                leap_month_policy=leap_month_policy,
            )
    raise IndexError(f"Epoch day {epoch_day} outside lunar Sui bounds")


def _lunar_to_solar_meta(
    eph: EphemerisTable,
    lunar_year: int,
    lunar_month: int,
    lunar_day: int,
    is_leap_month: bool = False,
    calendar_mode: CalendarMode = "VN_UTC7",
    offset_seconds_override: int | None = None,
) -> tuple[SolarDateResult, int, int]:
    if not isinstance(lunar_year, int) or isinstance(lunar_year, bool):
        raise ValueError(f"Invalid lunar year: {lunar_year}")
    if (
        not isinstance(lunar_month, int)
        or isinstance(lunar_month, bool)
        or lunar_month < 1
        or lunar_month > 12
    ):
        raise ValueError(f"Invalid lunar month: {lunar_month}")
    if (
        not isinstance(lunar_day, int)
        or isinstance(lunar_day, bool)
        or lunar_day < 1
        or lunar_day > 30
    ):
        raise ValueError(f"Invalid lunar day: {lunar_day}")
    sui_year = lunar_year if lunar_month >= 11 else lunar_year - 1
    if sui_year < eph.start_year or sui_year > eph.end_year - 2:
        raise ValueError(
            f"Lunar date {lunar_year}-{lunar_month}-{lunar_day} outside ephemeris bounds"
        )

    offset_seconds = _get_offset_seconds(calendar_mode, offset_seconds_override)
    labels = _build_sui_labels(eph, sui_year, offset_seconds)
    match = next(
        (
            m
            for m in labels
            if m.lunar_year == lunar_year
            and m.lunar_month == lunar_month
            and m.is_leap_month == is_leap_month
        ),
        None,
    )
    if match is None:
        leap_tag = " (leap)" if is_leap_month else ""
        raise ValueError(f"Lunar month {lunar_year}-{lunar_month}{leap_tag} does not exist")
    month_len = match.day_end - match.day_start + 1
    if lunar_day < 1 or lunar_day > month_len:
        raise ValueError(f"Invalid lunar day {lunar_day} for month length {month_len}")
    epoch_day = match.day_start + lunar_day - 1
    yr, mo, dy = civil_from_epoch_day(epoch_day)
    solar = SolarDateResult(
        year=yr,
        month=mo,
        day=dy,
        epoch_day=epoch_day,
        iso_date=format_iso_date(yr, mo, dy),
    )
    return solar, month_len, offset_seconds


def lunar_to_solar(
    eph: EphemerisTable,
    lunar_year: int,
    lunar_month: int,
    lunar_day: int,
    is_leap_month: bool = False,
    calendar_mode: CalendarMode = "VN_UTC7",
    offset_seconds_override: int | None = None,
) -> SolarDateResult:
    solar, _, _ = _lunar_to_solar_meta(
        eph,
        lunar_year,
        lunar_month,
        lunar_day,
        is_leap_month,
        calendar_mode,
        offset_seconds_override,
    )
    return solar


def convert_lunar_to_solar(
    lunar_year: int,
    lunar_month: int,
    lunar_day: int,
    is_leap_month: bool = False,
    calendar_mode: CalendarMode = "VN_UTC7",
    location: str | dict[str, Any] | None = None,
    offset_seconds_override: int | None = None,
) -> ConvertLunarToSolarResult:
    eph = load_ephemeris()
    effective_cal: Literal["VN_UTC7", "CN_UTC8"]
    if calendar_mode == "CN_UTC8":
        effective_cal = "CN_UTC8"
    elif calendar_mode == "VN_UTC7":
        effective_cal = "VN_UTC7"
    else:
        try:
            tentative = lunar_to_solar(
                eph,
                lunar_year,
                lunar_month,
                lunar_day,
                is_leap_month,
                "VN_UTC7",
                offset_seconds_override,
            )
        except ValueError:
            tentative = lunar_to_solar(
                eph,
                lunar_year,
                lunar_month,
                1,
                False,
                "VN_UTC7",
                offset_seconds_override,
            )
        loc = resolve_location(location if location is not None else "Hà Nội")
        tz = resolve_historical_timezone(
            year=tentative.year,
            month=tentative.month,
            day=tentative.day,
            hour=12,
            minute=0,
            lat=loc.lat,
            lon=loc.lon,
            tz_zone=loc.tz_zone,
        )
        effective_cal = (
            "CN_UTC8"
            if (not tz.decision121_cp_lunar and tz.utc_offset_seconds == 28_800)
            else "VN_UTC7"
        )

    solar, month_len, offset_seconds = _lunar_to_solar_meta(
        eph,
        lunar_year,
        lunar_month,
        lunar_day,
        is_leap_month,
        effective_cal,
        offset_seconds_override,
    )
    return ConvertLunarToSolarResult(
        year=solar.year,
        month=solar.month,
        day=solar.day,
        epoch_day=solar.epoch_day,
        iso_date=solar.iso_date,
        lunar_year=lunar_year,
        lunar_month=lunar_month,
        lunar_day=lunar_day,
        is_leap_month=is_leap_month,
        month_length_days=month_len,
        calendar_mode=calendar_mode,
        effective_lunar_calendar=effective_cal,
        offset_seconds=offset_seconds,
    )


def get_lunar_year_leap_info(
    lunar_year: int,
    calendar_mode: CalendarMode = "VN_UTC7",
    offset_seconds_override: int | None = None,
) -> LunarYearLeapInfo:
    if not isinstance(lunar_year, int) or isinstance(lunar_year, bool):
        raise ValueError(f"Invalid lunar year: {lunar_year}")
    eph = load_ephemeris()
    offset_seconds = _get_offset_seconds(calendar_mode, offset_seconds_override)
    max_sui = eph.end_year - 2
    collected: list[_SuiMonthLabel] = []
    if eph.start_year <= lunar_year - 1 <= max_sui:
        collected.extend(_build_sui_labels(eph, lunar_year - 1, offset_seconds))
    if eph.start_year <= lunar_year <= max_sui:
        collected.extend(_build_sui_labels(eph, lunar_year, offset_seconds))
    year_labels = [m for m in collected if m.lunar_year == lunar_year]
    if not year_labels:
        raise ValueError(f"Lunar year {lunar_year} outside ephemeris bounds")

    months: list[LunarMonthMeta] = []
    leap_month: int | None = None
    for m in year_labels:
        sy, sm, sd = civil_from_epoch_day(m.day_start)
        ey, em, ed = civil_from_epoch_day(m.day_end)
        if m.is_leap_month and leap_month is None:
            leap_month = m.lunar_month
        months.append(
            LunarMonthMeta(
                lunar_month=m.lunar_month,
                is_leap_month=m.is_leap_month,
                length_days=m.day_end - m.day_start + 1,
                start_iso_date=format_iso_date(sy, sm, sd),
                end_iso_date=format_iso_date(ey, em, ed),
            )
        )
    return LunarYearLeapInfo(
        lunar_year=lunar_year,
        calendar_mode=calendar_mode,
        offset_seconds=offset_seconds,
        leap_month=leap_month,
        months=months,
    )


def _make_pillar(stem_index: int, branch_index: int) -> PillarPair:
    s = stem_index % 10
    b = branch_index % 12
    return PillarPair(
        stem_index=s,
        branch_index=b,
        stem_vi=STEMS_VI[s],
        branch_vi=BRANCHES_VI[b],
        label_vi=f"{STEMS_VI[s]} {BRANCHES_VI[b]}",
    )


def compute_sexagenary_pillars(
    eph: EphemerisTable,
    instant_unix_ms: int,
    lunar_year: int,
    true_solar_epoch_day: int,
    shichen_branch: int,
    is_late_zi: bool,
    late_zi_policy: LateZiPolicy = "next-day",
) -> SexagenaryPillars:
    lunar_year_pillar = _make_pillar(lunar_year - 4, lunar_year - 4)

    approx_ed = local_epoch_day_from_seconds(instant_unix_ms, 0)
    greg_year = civil_from_epoch_day(approx_ed)[0]
    lap_xuan_ms = find_lap_xuan_ms(eph, greg_year)
    bazi_year = greg_year - 1 if instant_unix_ms < lap_xuan_ms else greg_year
    bazi_year_pillar = _make_pillar(bazi_year - 4, bazi_year - 4)

    term = find_solar_term_at(eph, instant_unix_ms)
    bazi_month_branch = (((term.term_index - 21) % 24) // 2 + 2) % 12
    first_month_stem = ((bazi_year_pillar.stem_index % 5) * 2 + 2) % 10
    bazi_month_stem = (first_month_stem + ((bazi_month_branch - 2) % 12)) % 10
    bazi_month_pillar = _make_pillar(bazi_month_stem, bazi_month_branch)

    day_epoch = true_solar_epoch_day + (1 if (is_late_zi and late_zi_policy == "next-day") else 0)
    jdn = day_epoch + 2440588
    day_idx = (jdn + 49) % 60
    day_pillar = _make_pillar(day_idx % 10, day_idx % 12)

    first_hour_stem = (day_pillar.stem_index % 5) * 2
    hour_pillar = _make_pillar(first_hour_stem + shichen_branch, shichen_branch)

    return SexagenaryPillars(
        lunar_year_pillar=lunar_year_pillar,
        bazi_year_pillar=bazi_year_pillar,
        bazi_month_pillar=bazi_month_pillar,
        day_pillar=day_pillar,
        hour_pillar=hour_pillar,
        late_zi_policy=late_zi_policy,
    )
