"""RFC 8785 Canonical JSON serialization, SHA-256 hashing, and unified birth normalizer."""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from sovana.geo_time.data import load_ephemeris
from sovana.geo_time.ephemeris import find_solar_term_at, format_iso_date, js_round
from sovana.geo_time.geo import resolve_location
from sovana.geo_time.lunar import compute_sexagenary_pillars, solar_to_lunar
from sovana.geo_time.models import (
    BoundaryUncertainty,
    CalendarMode,
    InputEcho,
    LateZiPolicy,
    LeapMonthPolicy,
    NormalizedBirthTemporal,
    SovanaModel,
)
from sovana.geo_time.solar_time import compute_true_solar_time
from sovana.geo_time.tz import resolve_historical_timezone
from sovana.geo_time.vincenty import compute_migration_azimuth


def _serialize_canonical(value: Any) -> str:
    if isinstance(value, SovanaModel):
        value = value.to_canonical_dict()
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"Non-finite float not allowed in canonical JSON: {value}")
        if value == 0.0:
            return "0"
        if value.is_integer():
            return str(int(value))
        return json.dumps(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_serialize_canonical(item) for item in value) + "]"
    if isinstance(value, dict):
        items = sorted((str(k), v) for k, v in value.items())
        return "{" + ",".join(
            f"{json.dumps(k, ensure_ascii=False)}:{_serialize_canonical(v)}" for k, v in items
        ) + "}"
    raise TypeError(f"Unsupported canonical JSON value type: {type(value).__name__}")


def canonical_json(value: Any) -> str:
    return _serialize_canonical(value)


def sha256_canonical(value: Any) -> str:
    payload = canonical_json(value).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def normalize_birth_temporal(
    year: int,
    month: int,
    day: int,
    hour: int,
    minute: int,
    location: str | dict[str, Any],
    second: int = 0,
    iana_time_zone: str | None = None,
    calendar_mode: CalendarMode = "VN_HISTORICAL",
    leap_month_policy: LeapMonthPolicy = "keep",
    late_zi_policy: LateZiPolicy = "next-day",
    migration_destination: str | dict[str, Any] | None = None,
) -> NormalizedBirthTemporal:
    eph = load_ephemeris()
    loc = resolve_location(location)
    tz = resolve_historical_timezone(
        year=year,
        month=month,
        day=day,
        hour=hour,
        minute=minute,
        second=second,
        lat=loc.lat,
        lon=loc.lon,
        tz_zone=loc.tz_zone,
        iana_time_zone=iana_time_zone,
    )

    tst = compute_true_solar_time(
        year=year,
        month=month,
        day=day,
        hour=hour,
        minute=minute,
        second=second,
        lon=loc.lon,
        utc_offset_seconds=tz.utc_offset_seconds,
    )

    solar_term = find_solar_term_at(eph, tst.instant_unix_ms)
    lunar_vn = solar_to_lunar(eph, tst.true_solar_epoch_day, "VN_UTC7", leap_month_policy)
    lunar_cn = solar_to_lunar(eph, tst.true_solar_epoch_day, "CN_UTC8", leap_month_policy)

    if calendar_mode == "CN_UTC8":
        lunar_active = lunar_cn
    elif calendar_mode == "VN_UTC7":
        lunar_active = lunar_vn
    else:
        if tz.decision121_cp_lunar:
            lunar_active = lunar_vn
        elif tz.utc_offset_seconds == 28_800:
            lunar_active = lunar_cn
        else:
            lunar_active = lunar_vn

    pillars = compute_sexagenary_pillars(
        eph=eph,
        instant_unix_ms=tst.instant_unix_ms,
        lunar_year=lunar_active.lunar_year,
        true_solar_epoch_day=tst.true_solar_epoch_day,
        shichen_branch=tst.shichen_branch,
        is_late_zi=tst.is_late_zi,
        late_zi_policy=late_zi_policy,
    )

    is_shichen_ambig = tst.seconds_to_shichen_boundary <= 900
    is_term_ambig = solar_term.min_seconds_to_term_boundary <= 600
    candidates = [tst.shichen_branch]
    if is_shichen_ambig:
        ms_mod = (tst.hour * 3600 + tst.minute * 60 + tst.second) * 1000
        nearest_odd_idx = js_round((ms_mod - 3_600_000) / 7_200_000)
        boundary_ms = nearest_odd_idx * 7_200_000 + 3_600_000
        adj = (
            (tst.shichen_branch - 1) % 12
            if ms_mod >= boundary_ms
            else (tst.shichen_branch + 1) % 12
        )
        if adj not in candidates:
            candidates.append(adj)

    migration = None
    if migration_destination is not None:
        dest = resolve_location(migration_destination)
        migration = compute_migration_azimuth(loc.lat, loc.lon, dest.lat, dest.lon)

    iso_wall = (
        f"{format_iso_date(year, month, day)}T{hour:02d}:{minute:02d}:{second:02d}"
    )
    return NormalizedBirthTemporal(
        schema_version="1.0.0",
        input_echo=InputEcho(
            iso_wall_clock=iso_wall,
            calendar_mode=calendar_mode,
            leap_month_policy=leap_month_policy,
            late_zi_policy=late_zi_policy,
        ),
        location=loc,
        timezone=tz,
        true_solar_time=tst,
        solar_term=solar_term,
        lunar_vn=lunar_vn,
        lunar_cn=lunar_cn,
        lunar_active=lunar_active,
        pillars=pillars,
        uncertainty=BoundaryUncertainty(
            is_shichen_boundary_ambiguous=is_shichen_ambig,
            seconds_to_shichen_boundary=tst.seconds_to_shichen_boundary,
            is_solar_term_boundary_ambiguous=is_term_ambig,
            min_seconds_to_term_boundary=solar_term.min_seconds_to_term_boundary,
            is_contested_timezone=tz.is_contested_zone,
            is_dst_gap_or_fold=tz.is_dst_gap_or_fold,
            wide_longitude_warning=loc.wide_longitude_warning,
            is_boundary_ambiguous=(
                is_shichen_ambig or is_term_ambig or tz.is_contested_zone or tz.is_dst_gap_or_fold
            ),
            candidate_shichen_branches=candidates,
        ),
        migration=migration,
    )
