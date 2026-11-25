"""Jean Meeus Ch. 28 Equation of Time and deterministic True Solar Time calculation."""

from __future__ import annotations

import math

from sovana.geo_time.ephemeris import (
    BRANCHES_VI,
    MS_PER_DAY,
    UNIX_EPOCH_JD,
    civil_from_epoch_day,
    epoch_day_from_civil,
    js_round,
)
from sovana.geo_time.models import TrueSolarTimeResult

DEG2RAD = math.pi / 180.0
RAD2DEG = 180.0 / math.pi


def delta_t_seconds(decimal_year: float) -> float:
    y = decimal_year
    if y < 1900.0:
        t = (y - 1860.0) / 100.0
        return 7.62 + 57.37 * t - 251.75 * t * t + 168.068 * t**3
    if y < 1920.0:
        t = y - 1900.0
        return -2.79 + 1.494119 * t - 0.0598939 * t**2 + 0.0061966 * t**3 - 0.000197 * t**4
    if y < 1941.0:
        t = y - 1920.0
        return 21.2 + 0.84493 * t - 0.0761 * t**2 + 0.0020936 * t**3
    if y < 1961.0:
        t = y - 1950.0
        return 29.07 + 0.407 * t - t**2 / 233.0 + t**3 / 2547.0
    if y < 1986.0:
        t = y - 1975.0
        return 45.45 + 1.067 * t - t**2 / 260.0 - t**3 / 718.0
    if y < 2005.0:
        t = y - 2000.0
        return (
            63.86
            + 0.3345 * t
            - 0.060374 * t**2
            + 0.0017275 * t**3
            + 0.000651814 * t**4
            + 0.00002373599 * t**5
        )
    if y < 2050.0:
        t = y - 2000.0
        return 62.92 + 0.32217 * t + 0.005589 * t**2
    t = (y - 1820.0) / 100.0
    return -20.0 + 32.0 * t**2 - 0.5628 * (2150.0 - y)


def meeus_equation_of_time_seconds(unix_ms: int) -> float:
    jd_ut1 = UNIX_EPOCH_JD + unix_ms / MS_PER_DAY
    approx_year = 2000.0 + (jd_ut1 - 2451545.0) / 365.2425
    jd_tt = jd_ut1 + delta_t_seconds(approx_year) / 86400.0

    t = (jd_tt - 2451545.0) / 36525.0
    tau = t / 10.0

    l0 = (
        280.4664567
        + 360007.6982779 * tau
        + 0.03032028 * tau**2
        + tau**3 / 49931.0
        - tau**4 / 15300.0
        - tau**5 / 2000000.0
    ) % 360.0

    m = 357.5291092 + 35999.0502909 * t - 0.0001536 * t**2 + t**3 / 24490000.0
    m_rad = m * DEG2RAD

    c = (
        (1.914602 - 0.004817 * t - 0.000014 * t**2) * math.sin(m_rad)
        + (0.019993 - 0.000101 * t) * math.sin(2.0 * m_rad)
        + 0.000289 * math.sin(3.0 * m_rad)
    )
    sun_true_lon = l0 + c

    omega = (125.04452 - 1934.136261 * t) * DEG2RAD
    l_sun_rad = l0 * DEG2RAD
    l_moon_rad = (218.3165 + 481267.8813 * t) * DEG2RAD
    dpsi_arcsec = (
        -17.2 * math.sin(omega)
        - 1.32 * math.sin(2.0 * l_sun_rad)
        - 0.23 * math.sin(2.0 * l_moon_rad)
        + 0.21 * math.sin(2.0 * omega)
    )
    deps_arcsec = (
        9.2 * math.cos(omega)
        + 0.57 * math.cos(2.0 * l_sun_rad)
        + 0.1 * math.cos(2.0 * l_moon_rad)
        - 0.09 * math.cos(2.0 * omega)
    )

    apparent_lon = sun_true_lon - 0.00569 - 0.00478 * math.sin(omega)

    u = tau / 10.0
    eps0_arcsec = (
        23.0 * 3600.0
        + 26.0 * 60.0
        + 21.448
        - 4680.93 * u
        - 1.55 * u**2
        + 1999.25 * u**3
        - 51.38 * u**4
        - 249.67 * u**5
        - 39.05 * u**6
        + 7.12 * u**7
        + 27.87 * u**8
        + 5.79 * u**9
        + 2.45 * u**10
    )
    eps = ((eps0_arcsec + deps_arcsec) / 3600.0) * DEG2RAD

    app_lon_rad = apparent_lon * DEG2RAD
    ra_rad = math.atan2(math.cos(eps) * math.sin(app_lon_rad), math.cos(app_lon_rad))
    ra_deg = (ra_rad * RAD2DEG) % 360.0

    eot_raw = l0 - 0.0057183 - ra_deg + (dpsi_arcsec / 3600.0) * math.cos(eps)
    eot_deg = ((eot_raw + 180.0) % 360.0) - 180.0
    return eot_deg * 240.0


def equation_of_time_centiseconds(unix_ms: int) -> int:
    return js_round(meeus_equation_of_time_seconds(unix_ms) * 100.0)


def longitude_correction_ms(lon_micro_deg: int, utc_offset_seconds: int) -> int:
    num = lon_micro_deg * 240 - utc_offset_seconds * 1_000_000
    if num >= 0:
        return (num + 500) // 1000
    return -((-num + 500) // 1000)


def branch_from_solar_ms_of_day(ms_of_day: int) -> int:
    if ms_of_day >= 82_800_000 or ms_of_day < 3_600_000:
        return 0
    return (ms_of_day - 3_600_000) // 7_200_000 + 1


def compute_true_solar_time(
    year: int,
    month: int,
    day: int,
    hour: int,
    minute: int,
    second: int = 0,
    lon: float = 105.0,
    utc_offset_seconds: int = 25_200,
) -> TrueSolarTimeResult:
    local_ed = epoch_day_from_civil(year, month, day)
    local_wall_ms = local_ed * MS_PER_DAY + (hour * 3600 + minute * 60 + second) * 1000
    instant_unix_ms = local_wall_ms - utc_offset_seconds * 1000

    lon_micro_deg = js_round(lon * 1_000_000)
    lon_corr_ms = longitude_correction_ms(lon_micro_deg, utc_offset_seconds)
    eot_cs = equation_of_time_centiseconds(instant_unix_ms)
    eot_ms = eot_cs * 10
    total_corr_ms = lon_corr_ms + eot_ms

    true_solar_wall_ms = local_wall_ms + total_corr_ms
    ts_epoch_day = true_solar_wall_ms // MS_PER_DAY
    ms_of_day = true_solar_wall_ms % MS_PER_DAY
    day_offset = ts_epoch_day - local_ed

    ts_year, ts_month, ts_day = civil_from_epoch_day(ts_epoch_day)
    total_sec_of_day = ms_of_day // 1000
    ts_hour = total_sec_of_day // 3600
    ts_minute = (total_sec_of_day % 3600) // 60
    ts_second = total_sec_of_day % 60
    shichen_branch = branch_from_solar_ms_of_day(ms_of_day)
    is_late_zi = shichen_branch == 0 and ms_of_day >= 82_800_000

    min_dist_ms = MS_PER_DAY
    for k in range(12):
        b_ms = (2 * k + 1) * 3_600_000
        raw = abs(ms_of_day - b_ms)
        wrapped = min(raw, MS_PER_DAY - raw)
        if wrapped < min_dist_ms:
            min_dist_ms = wrapped
    sec_to_shichen = min_dist_ms // 1000
    sec_to_midnight = min(ms_of_day, MS_PER_DAY - ms_of_day) // 1000

    return TrueSolarTimeResult(
        instant_unix_ms=instant_unix_ms,
        local_epoch_day=local_ed,
        true_solar_epoch_day=ts_epoch_day,
        day_offset=day_offset,
        year=ts_year,
        month=ts_month,
        day=ts_day,
        hour=ts_hour,
        minute=ts_minute,
        second=ts_second,
        formatted_time=f"{ts_hour:02d}:{ts_minute:02d}:{ts_second:02d}",
        lon_micro_deg=lon_micro_deg,
        longitude_correction_ms=lon_corr_ms,
        eot_centiseconds=eot_cs,
        eot_ms=eot_ms,
        total_correction_ms=total_corr_ms,
        shichen_branch=shichen_branch,
        shichen_branch_vi=BRANCHES_VI[shichen_branch],
        is_late_zi=is_late_zi,
        seconds_to_shichen_boundary=sec_to_shichen,
        seconds_to_midnight_boundary=sec_to_midnight,
    )
