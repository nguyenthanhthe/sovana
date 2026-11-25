"""SVNEPH01 binary ephemeris parser, binary search, and exact civil calendar primitives."""

from __future__ import annotations

import bisect
import math
import struct

from sovana.geo_time.models import EphemerisTable, SolarTermInfo

MS_PER_DAY = 86_400_000
UNIX_EPOCH_JD = 2440587.5

HEADER_STRUCT = struct.Struct("<8sHHhhIIBB6x")
INT64_STRUCT = struct.Struct("<q")

STEMS_VI = (
    "Giáp", "Ất", "Bính", "Đinh", "Mậu",
    "Kỷ", "Canh", "Tân", "Nhâm", "Quý",
)

BRANCHES_VI = (
    "Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ",
    "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi",
)

SOLAR_TERMS_VI = (
    "Xuân Phân", "Thanh Minh", "Cốc Vũ", "Lập Hạ", "Tiểu Mãn", "Mang Chủng",
    "Hạ Chí", "Tiểu Thử", "Đại Thử", "Lập Thu", "Xử Thử", "Bạch Lộ",
    "Thu Phân", "Hàn Lộ", "Sương Giáng", "Lập Đông", "Tiểu Tuyết", "Đại Tuyết",
    "Đông Chí", "Tiểu Hàn", "Đại Hàn", "Lập Xuân", "Vũ Thủy", "Kinh Trập",
)


def js_round(x: float) -> int:
    """Match ECMAScript Math.round(x) = floor(x + 0.5) for finite numbers."""
    return math.floor(x + 0.5)


def floor_div(a: int, b: int) -> int:
    return a // b


def floor_mod(a: int, b: int) -> int:
    return a % b


def epoch_day_from_civil(year: int, month: int, day: int) -> int:
    y = year - (1 if month <= 2 else 0)
    era = y // 400
    yoe = y - era * 400
    doy = (153 * (month + (-3 if month > 2 else 9)) + 2) // 5 + day - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def civil_from_epoch_day(z: int) -> tuple[int, int, int]:
    z2 = z + 719468
    era = z2 // 146097
    doe = z2 - era * 146097
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    y = yoe + era * 400
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    m = mp + (3 if mp < 10 else -9)
    y += 1 if m <= 2 else 0
    return (y, m, d)


def format_iso_date(year: int, month: int, day: int) -> str:
    return f"{year:04d}-{month:02d}-{day:02d}"


def get_civil_month_days(year: int, month: int) -> int:
    if (
        not isinstance(year, int)
        or isinstance(year, bool)
        or not isinstance(month, int)
        or isinstance(month, bool)
        or month < 1
        or month > 12
    ):
        raise ValueError(f"Invalid civil year/month: {year}-{month}")
    if month == 2:
        return 29 if ((year % 4 == 0 and year % 100 != 0) or year % 400 == 0) else 28
    return 30 if month in (4, 6, 9, 11) else 31


def is_valid_civil_date(year: int, month: int, day: int) -> bool:
    if any(not isinstance(v, int) or isinstance(v, bool) for v in (year, month, day)):
        return False
    if month < 1 or month > 12:
        return False
    return 1 <= day <= get_civil_month_days(year, month)


def local_epoch_day_from_seconds(unix_ms: int, offset_seconds: int) -> int:
    return (unix_ms + offset_seconds * 1000) // MS_PER_DAY


def local_epoch_day(unix_ms: int, offset_minutes: float) -> int:
    return local_epoch_day_from_seconds(unix_ms, js_round(offset_minutes * 60))


def parse_ephemeris(raw: bytes) -> EphemerisTable:
    if len(raw) < HEADER_STRUCT.size:
        raise ValueError(f"Invalid SVNEPH01 buffer length: {len(raw)}")
    magic, version, _, start_year, end_year, nm_count, st_count, first_st, ts_id = (
        HEADER_STRUCT.unpack_from(raw, 0)
    )
    if magic != b"SVNEPH01":
        raise ValueError(f"Invalid ephemeris magic header: {magic!r}")
    if version != 1:
        raise ValueError(f"Unsupported ephemeris version: {version}")
    expected_len = HEADER_STRUCT.size + (nm_count + st_count) * 8
    if len(raw) != expected_len:
        raise ValueError(f"Truncated ephemeris buffer: got {len(raw)}, expected {expected_len}")

    offset = HEADER_STRUCT.size
    new_moons = struct.unpack_from(f"<{nm_count}q", raw, offset)
    offset += nm_count * 8
    solar_terms = struct.unpack_from(f"<{st_count}q", raw, offset)

    return EphemerisTable(
        version=version,
        start_year=start_year,
        end_year=end_year,
        first_solar_term_index=first_st,
        time_scale_id=ts_id,
        new_moons=new_moons,
        solar_terms=solar_terms,
    )


def find_new_moon_bracket(eph: EphemerisTable, unix_ms: int) -> tuple[int, int, int]:
    idx = bisect.bisect_right(eph.new_moons, unix_ms) - 1
    if idx < 0 or idx + 1 >= len(eph.new_moons):
        raise IndexError(f"Timestamp {unix_ms} outside ephemeris new-moon range")
    return idx, eph.new_moons[idx], eph.new_moons[idx + 1]


def find_solar_term_at(eph: EphemerisTable, instant_unix_ms: int) -> SolarTermInfo:
    idx = bisect.bisect_right(eph.solar_terms, instant_unix_ms) - 1
    if idx < 0 or idx + 1 >= len(eph.solar_terms):
        raise IndexError(f"Timestamp {instant_unix_ms} outside ephemeris solar-term range")
    term_index = (eph.first_solar_term_index + idx) % 24
    next_term_index = (term_index + 1) % 24
    start_ms = eph.solar_terms[idx]
    next_ms = eph.solar_terms[idx + 1]
    seconds_to_prev = (instant_unix_ms - start_ms) // 1000
    seconds_to_next = (next_ms - instant_unix_ms) // 1000
    return SolarTermInfo(
        index=idx,
        term_index=term_index,
        term_name_vi=SOLAR_TERMS_VI[term_index],
        is_major_term=(term_index % 2 == 0),
        start_ms=start_ms,
        next_ms=next_ms,
        next_term_index=next_term_index,
        next_term_name_vi=SOLAR_TERMS_VI[next_term_index],
        seconds_to_prev_term=seconds_to_prev,
        seconds_to_next_term=seconds_to_next,
        min_seconds_to_term_boundary=min(seconds_to_prev, seconds_to_next),
    )


def find_lap_xuan_ms(eph: EphemerisTable, greg_year: int) -> int:
    jan1_ms = epoch_day_from_civil(greg_year, 1, 1) * MS_PER_DAY
    idx = max(0, bisect.bisect_right(eph.solar_terms, jan1_ms) - 1)
    while idx < len(eph.solar_terms):
        if (eph.first_solar_term_index + idx) % 24 == 21:
            return eph.solar_terms[idx]
        idx += 1
    raise IndexError(f"Lap Xuan not found for year {greg_year}")
