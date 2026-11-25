"""Pydantic v2 models and typed structures matching @sovana/geo-time."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

CalendarMode = Literal["VN_UTC7", "CN_UTC8", "VN_HISTORICAL"]
LeapMonthPolicy = Literal["keep", "split-15", "next-month", "prev-month"]
LateZiPolicy = Literal["next-day", "current-day"]
VietnamTzZone = Literal["VN_NORTH_DRV", "VN_SOUTH_RVN"]


def _to_camel(snake: str) -> str:
    parts = snake.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


class SovanaModel(BaseModel):
    model_config = ConfigDict(
        frozen=True,
        populate_by_name=True,
        alias_generator=_to_camel,
    )

    def to_canonical_dict(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True)


class EphemerisTable(BaseModel):
    model_config = ConfigDict(frozen=True)

    version: int
    start_year: int
    end_year: int
    first_solar_term_index: int
    time_scale_id: int
    new_moons: tuple[int, ...]
    solar_terms: tuple[int, ...]


class ResolvedLocation(SovanaModel):
    matched_by: Literal[
        "special_zone",
        "legacy63",
        "post2025",
        "district",
        "historical_alias",
        "coordinates",
    ]
    query: str
    canonical_name: str
    province63_code: str | None = None
    province63_name: str | None = None
    post2025_id: str | None = None
    post2025_name: str | None = None
    district_code: str | None = None
    district_name: str | None = None
    lat_micro_deg: int
    lon_micro_deg: int
    lat: float
    lon: float
    tz_zone: VietnamTzZone | None = None
    koppen_zone: str | None = None
    wide_longitude_warning: bool = False
    lon_span_deg: float = 0.0


class TimezoneResolution(SovanaModel):
    source: Literal["VN_REGIME", "INTL_IANA"]
    zone_id: str
    regime_id: str
    utc_offset_seconds: int
    utc_offset_label: str
    is_contested_zone: bool
    candidate_offsets_seconds: list[int]
    decision121_cp_lunar: bool
    is_dst_gap_or_fold: bool
    historical_note: str


class TrueSolarTimeResult(SovanaModel):
    instant_unix_ms: int
    local_epoch_day: int
    true_solar_epoch_day: int
    day_offset: int
    year: int
    month: int
    day: int
    hour: int
    minute: int
    second: int
    formatted_time: str
    lon_micro_deg: int
    longitude_correction_ms: int
    eot_centiseconds: int
    eot_ms: int
    total_correction_ms: int
    shichen_branch: int
    shichen_branch_vi: str
    is_late_zi: bool
    seconds_to_shichen_boundary: int
    seconds_to_midnight_boundary: int


class SolarTermInfo(SovanaModel):
    index: int
    term_index: int
    term_name_vi: str
    is_major_term: bool
    start_ms: int
    next_ms: int
    next_term_index: int
    next_term_name_vi: str
    seconds_to_prev_term: int
    seconds_to_next_term: int
    min_seconds_to_term_boundary: int


class LunarDateResult(SovanaModel):
    lunar_year: int
    lunar_month: int
    lunar_day: int
    is_leap_month: bool
    effective_lunar_month: int
    month_length_days: int
    calendar_mode: CalendarMode
    offset_seconds: int
    leap_month_policy: LeapMonthPolicy


class SolarDateResult(SovanaModel):
    year: int
    month: int
    day: int
    epoch_day: int
    iso_date: str


class ConvertLunarToSolarInput(SovanaModel):
    lunar_year: int
    lunar_month: int
    lunar_day: int
    is_leap_month: bool = False
    calendar_mode: CalendarMode = "VN_UTC7"
    location: str | dict[str, Any] | None = None
    offset_seconds_override: int | None = None


class ConvertLunarToSolarResult(SolarDateResult):
    lunar_year: int
    lunar_month: int
    lunar_day: int
    is_leap_month: bool
    month_length_days: int
    calendar_mode: CalendarMode
    effective_lunar_calendar: Literal["VN_UTC7", "CN_UTC8"]
    offset_seconds: int


class LunarMonthMeta(SovanaModel):
    lunar_month: int
    is_leap_month: bool
    length_days: int
    start_iso_date: str
    end_iso_date: str


class LunarYearLeapInfo(SovanaModel):
    lunar_year: int
    calendar_mode: CalendarMode
    offset_seconds: int
    leap_month: int | None = None
    months: list[LunarMonthMeta]


class PillarPair(SovanaModel):
    stem_index: int
    branch_index: int
    stem_vi: str
    branch_vi: str
    label_vi: str


class SexagenaryPillars(SovanaModel):
    lunar_year_pillar: PillarPair
    bazi_year_pillar: PillarPair
    bazi_month_pillar: PillarPair
    day_pillar: PillarPair
    hour_pillar: PillarPair
    late_zi_policy: LateZiPolicy


class MigrationAzimuthResult(SovanaModel):
    distance_meters: int
    forward_azimuth_milli_deg: int
    forward_azimuth_deg: float
    palace_branch: int
    palace_branch_vi: str
    is_significant_migration: bool
    is_sector_boundary_ambiguous: bool
    min_sector_boundary_milli_deg: int


class BoundaryUncertainty(SovanaModel):
    is_shichen_boundary_ambiguous: bool
    seconds_to_shichen_boundary: int
    is_solar_term_boundary_ambiguous: bool
    min_seconds_to_term_boundary: int
    is_contested_timezone: bool
    is_dst_gap_or_fold: bool
    wide_longitude_warning: bool
    is_boundary_ambiguous: bool
    candidate_shichen_branches: list[int]


class InputEcho(SovanaModel):
    iso_wall_clock: str
    calendar_mode: CalendarMode
    leap_month_policy: LeapMonthPolicy
    late_zi_policy: LateZiPolicy


class NormalizedBirthTemporal(SovanaModel):
    schema_version: str
    input_echo: InputEcho
    location: ResolvedLocation
    timezone: TimezoneResolution
    true_solar_time: TrueSolarTimeResult
    solar_term: SolarTermInfo
    lunar_vn: LunarDateResult
    lunar_cn: LunarDateResult
    lunar_active: LunarDateResult
    pillars: SexagenaryPillars
    uncertainty: BoundaryUncertainty
    migration: MigrationAzimuthResult | None = None
