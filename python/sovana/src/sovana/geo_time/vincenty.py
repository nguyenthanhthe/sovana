"""WGS-84 Vincenty inverse geodesic distance and 12-Palace azimuth projection."""

from __future__ import annotations

import math

from sovana.geo_time.ephemeris import BRANCHES_VI, js_round
from sovana.geo_time.models import MigrationAzimuthResult

WGS84_A = 6378137.0
WGS84_F = 1.0 / 298.257223563
WGS84_B = WGS84_A * (1.0 - WGS84_F)
DEG2RAD = math.pi / 180.0
RAD2DEG = 180.0 / math.pi


def compute_migration_azimuth(
    origin_lat_deg: float,
    origin_lon_deg: float,
    dest_lat_deg: float,
    dest_lon_deg: float,
) -> MigrationAzimuthResult:
    phi1 = origin_lat_deg * DEG2RAD
    phi2 = dest_lat_deg * DEG2RAD
    big_l = (dest_lon_deg - origin_lon_deg) * DEG2RAD

    if abs(phi1 - phi2) < 1e-12 and abs(big_l) < 1e-12:
        return MigrationAzimuthResult(
            distance_meters=0,
            forward_azimuth_milli_deg=0,
            forward_azimuth_deg=0.0,
            palace_branch=0,
            palace_branch_vi=BRANCHES_VI[0],
            is_significant_migration=False,
            is_sector_boundary_ambiguous=False,
            min_sector_boundary_milli_deg=15_000,
        )

    u1 = math.atan((1.0 - WGS84_F) * math.tan(phi1))
    u2 = math.atan((1.0 - WGS84_F) * math.tan(phi2))
    sin_u1 = math.sin(u1)
    cos_u1 = math.cos(u1)
    sin_u2 = math.sin(u2)
    cos_u2 = math.cos(u2)

    lam = big_l
    sin_sigma = 0.0
    cos_sigma = 0.0
    sigma = 0.0
    sin_alpha = 0.0
    cos2_alpha = 0.0
    cos2_sigma_m = 0.0
    converged = False

    for _ in range(200):
        sin_lam = math.sin(lam)
        cos_lam = math.cos(lam)
        term_a = (cos_u2 * sin_lam) ** 2
        term_b = (cos_u1 * sin_u2 - sin_u1 * cos_u2 * cos_lam) ** 2
        sin_sigma = math.sqrt(term_a + term_b)
        if sin_sigma == 0.0:
            converged = True
            break
        cos_sigma = sin_u1 * sin_u2 + cos_u1 * cos_u2 * cos_lam
        sigma = math.atan2(sin_sigma, cos_sigma)
        sin_alpha = (cos_u1 * cos_u2 * sin_lam) / sin_sigma
        cos2_alpha = 1.0 - sin_alpha**2
        cos2_sigma_m = (
            cos_sigma - (2.0 * sin_u1 * sin_u2) / cos2_alpha if cos2_alpha != 0.0 else 0.0
        )
        big_c = (WGS84_F / 16.0) * cos2_alpha * (4.0 + WGS84_F * (4.0 - 3.0 * cos2_alpha))
        lam_prev = lam
        lam = big_l + (1.0 - big_c) * WGS84_F * sin_alpha * (
            sigma
            + big_c
            * sin_sigma
            * (cos2_sigma_m + big_c * cos_sigma * (-1.0 + 2.0 * cos2_sigma_m**2))
        )
        if abs(lam - lam_prev) < 1e-12:
            converged = True
            break

    if converged and sin_sigma > 0.0:
        u_sq = (cos2_alpha * (WGS84_A**2 - WGS84_B**2)) / (WGS84_B**2)
        big_a = 1.0 + (u_sq / 16384.0) * (
            4096.0 + u_sq * (-768.0 + u_sq * (320.0 - 175.0 * u_sq))
        )
        big_b = (u_sq / 1024.0) * (256.0 + u_sq * (-128.0 + u_sq * (74.0 - 47.0 * u_sq)))
        delta_sigma = big_b * sin_sigma * (
            cos2_sigma_m
            + (big_b / 4.0)
            * (
                cos_sigma * (-1.0 + 2.0 * cos2_sigma_m**2)
                - (big_b / 6.0)
                * cos2_sigma_m
                * (-3.0 + 4.0 * sin_sigma**2)
                * (-3.0 + 4.0 * cos2_sigma_m**2)
            )
        )
        s = WGS84_B * big_a * (sigma - delta_sigma)
        alpha1 = math.atan2(
            cos_u2 * math.sin(lam), cos_u1 * sin_u2 - sin_u1 * cos_u2 * math.cos(lam)
        )
        distance_meters = js_round(s)
        alpha1_deg = alpha1 * RAD2DEG
    else:
        cos_d = (
            math.sin(phi1) * math.sin(phi2)
            + math.cos(phi1) * math.cos(phi2) * math.cos(big_l)
        )
        d_sigma = math.acos(max(-1.0, min(1.0, cos_d)))
        distance_meters = js_round(6371008.8 * d_sigma)
        y = math.sin(big_l) * math.cos(phi2)
        x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(big_l)
        alpha1_deg = math.atan2(y, x) * RAD2DEG

    forward_milli = js_round(alpha1_deg * 1000.0) % 360_000
    shifted = (forward_milli + 15_000) % 360_000
    palace_branch = shifted // 30_000
    rem = shifted % 30_000
    min_sector_milli = min(rem, 30_000 - rem)

    return MigrationAzimuthResult(
        distance_meters=distance_meters,
        forward_azimuth_milli_deg=forward_milli,
        forward_azimuth_deg=forward_milli / 1000.0,
        palace_branch=palace_branch,
        palace_branch_vi=BRANCHES_VI[palace_branch],
        is_significant_migration=(distance_meters >= 30_000),
        is_sector_boundary_ambiguous=(min_sector_milli <= 2_000),
        min_sector_boundary_milli_deg=min_sector_milli,
    )
