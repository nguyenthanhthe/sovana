"""Historical Vietnam North/South timezone resolver and international zoneinfo fallback."""

from __future__ import annotations

import datetime as dt
import zoneinfo
from functools import lru_cache

from sovana.geo_time.data import load_tz_regimes
from sovana.geo_time.ephemeris import epoch_day_from_civil, format_iso_date
from sovana.geo_time.models import TimezoneResolution, VietnamTzZone

VN_IANA_ALIASES = {"Asia/Ho_Chi_Minh", "Asia/Saigon", "Asia/Hanoi"}


@lru_cache(maxsize=64)
def _get_zoneinfo(iana: str) -> zoneinfo.ZoneInfo:
    return zoneinfo.ZoneInfo(iana)


@lru_cache(maxsize=64)
def _parse_wall_seconds(iso_wall: str) -> int:
    year = int(iso_wall[0:4])
    month = int(iso_wall[5:7])
    day = int(iso_wall[8:10])
    hour = int(iso_wall[11:13])
    minute = int(iso_wall[14:16])
    second = int(iso_wall[17:19])
    ed = epoch_day_from_civil(year, month, day)
    return ed * 86_400 + hour * 3600 + minute * 60 + second


def _format_offset_label(offset_seconds: int) -> str:
    sign = "+" if offset_seconds >= 0 else "-"
    ab = abs(offset_seconds)
    hh = ab // 3600
    mm = (ab % 3600) // 60
    ss = ab % 60
    return f"{sign}{hh:02d}:{mm:02d}" if ss == 0 else f"{sign}{hh:02d}:{mm:02d}:{ss:02d}"


def resolve_historical_timezone(
    year: int,
    month: int,
    day: int,
    hour: int,
    minute: int,
    second: int = 0,
    lat: float | None = None,
    lon: float | None = None,
    tz_zone: VietnamTzZone | None = None,
    iana_time_zone: str | None = None,
) -> TimezoneResolution:
    spec = load_tz_regimes()
    bb = spec["vietnamBoundingBox"]

    in_vn_box = (
        lat is not None
        and lon is not None
        and bb["minLat"] <= lat <= bb["maxLat"]
        and bb["minLon"] <= lon <= bb["maxLon"]
    )
    is_vn = (
        tz_zone is not None
        or in_vn_box
        or (iana_time_zone is not None and iana_time_zone in VN_IANA_ALIASES)
        or (iana_time_zone is None and lat is None and lon is None)
    )

    if is_vn:
        zone: VietnamTzZone = tz_zone or (
            "VN_NORTH_DRV"
            if (lat is not None and lat >= spec["parallel17LatDeg"])
            else "VN_SOUTH_RVN"
        )
        intervals = spec["zones"][zone]
        local_iso = f"{format_iso_date(year, month, day)}T{hour:02d}:{minute:02d}:{second:02d}"
        local_sec = _parse_wall_seconds(local_iso)

        matched_idx = -1
        for i, iv in enumerate(intervals):
            if iv["startLocal"] <= local_iso < iv["endLocal"]:
                matched_idx = i
                break

        is_gap_or_fold = False
        if matched_idx < 0:
            for i, iv in enumerate(intervals):
                if local_iso < iv["startLocal"]:
                    matched_idx = i
                    is_gap_or_fold = True
                    break
            if matched_idx < 0:
                matched_idx = len(intervals) - 1

        iv = intervals[matched_idx]
        if not is_gap_or_fold:
            prev_iv = intervals[matched_idx - 1] if matched_idx > 0 else None
            next_iv = intervals[matched_idx + 1] if matched_idx + 1 < len(intervals) else None
            if prev_iv is not None and prev_iv["utcOffsetSeconds"] != iv["utcOffsetSeconds"]:
                diff = local_sec - _parse_wall_seconds(iv["startLocal"])
                if 0 <= diff < 3600:
                    is_gap_or_fold = True
            if next_iv is not None and next_iv["utcOffsetSeconds"] != iv["utcOffsetSeconds"]:
                diff = _parse_wall_seconds(iv["endLocal"]) - local_sec
                if 0 < diff <= 3600:
                    is_gap_or_fold = True

        return TimezoneResolution(
            source="VN_REGIME",
            zone_id=zone,
            regime_id=iv["id"],
            utc_offset_seconds=iv["utcOffsetSeconds"],
            utc_offset_label=iv["utcOffsetLabel"],
            is_contested_zone=iv["isContestedZone"],
            candidate_offsets_seconds=list(iv["candidateOffsetsSeconds"]),
            decision121_cp_lunar=iv["decision121CpLunar"],
            is_dst_gap_or_fold=is_gap_or_fold,
            historical_note=iv["historicalNote"],
        )

    iana = iana_time_zone or "UTC"
    zi = _get_zoneinfo(iana)
    local_dt = dt.datetime(year, month, day, hour, minute, second, tzinfo=zi)
    utcoff = local_dt.utcoffset()
    offset_seconds = int(utcoff.total_seconds()) if utcoff is not None else 0
    utc_dt = local_dt.astimezone(dt.UTC)
    off_minus = int(
        (utc_dt - dt.timedelta(hours=1)).astimezone(zi).utcoffset().total_seconds()  # type: ignore[union-attr]
    )
    off_plus = int(
        (utc_dt + dt.timedelta(hours=1)).astimezone(zi).utcoffset().total_seconds()  # type: ignore[union-attr]
    )
    return TimezoneResolution(
        source="INTL_IANA",
        zone_id=iana,
        regime_id=f"IANA_{iana}",
        utc_offset_seconds=offset_seconds,
        utc_offset_label=_format_offset_label(offset_seconds),
        is_contested_zone=False,
        candidate_offsets_seconds=[offset_seconds],
        decision121_cp_lunar=False,
        is_dst_gap_or_fold=(off_minus != offset_seconds or off_plus != offset_seconds),
        historical_note=f"OS Intl/IANA tzdb resolution for {iana}",
    )
