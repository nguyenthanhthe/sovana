"""Python half of the cross-runtime bit-exact SHA-256 lockstep verifier.

Reads JSON instructions from a temp file path passed as argv[1] and outputs
compact per-day / per-vector SHA-256 hashes + latency telemetry as JSON.
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
from typing import Any

from sovana.geo_time import (
    MS_PER_DAY,
    canonical_json,
    compute_sexagenary_pillars,
    epoch_day_from_civil,
    equation_of_time_centiseconds,
    find_solar_term_at,
    load_ephemeris,
    normalize_birth_temporal,
    sha256_canonical,
    solar_to_lunar,
)


def run_daily_sweep(start_day: int, end_day: int) -> tuple[list[str], str, float]:
    eph = load_ephemeris()
    hashes: list[str] = []
    agg = hashlib.sha256()

    t0 = time.perf_counter()
    for d in range(start_day, end_day + 1):
        noon_ms = d * MS_PER_DAY + 43_200_000
        vn_l = solar_to_lunar(eph, d, "VN_UTC7", "split-15")
        cn_l = solar_to_lunar(eph, d, "CN_UTC8", "split-15")
        term = find_solar_term_at(eph, noon_ms)
        eot_cs = equation_of_time_centiseconds(noon_ms)
        pillars = compute_sexagenary_pillars(
            eph=eph,
            instant_unix_ms=noon_ms,
            lunar_year=vn_l.lunar_year,
            true_solar_epoch_day=d,
            shichen_branch=6,
            is_late_zi=False,
            late_zi_policy="next-day",
        )
        rec = {
            "d": d,
            "vn": vn_l,
            "cn": cn_l,
            "st": term.term_index,
            "eot": eot_cs,
            "p": pillars,
        }
        cjson = canonical_json(rec)
        h = hashlib.sha256(cjson.encode("utf-8")).hexdigest()
        hashes.append(h)
        agg.update(h.encode("ascii"))
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    return hashes, agg.hexdigest(), elapsed_ms


def run_vectors(vectors: list[dict[str, Any]]) -> tuple[list[str], str, float]:
    # Warm up spec caches before timing
    _ = normalize_birth_temporal(2000, 1, 1, 12, 0, "Hà Nội")

    hashes: list[str] = []
    agg = hashlib.sha256()

    t0 = time.perf_counter()
    for v in vectors:
        res = normalize_birth_temporal(
            year=v["year"],
            month=v["month"],
            day=v["day"],
            hour=v["hour"],
            minute=v["minute"],
            second=v.get("second", 0),
            location=v["location"],
            iana_time_zone=v.get("ianaTimeZone"),
            calendar_mode=v.get("calendarMode", "VN_HISTORICAL"),
            leap_month_policy=v.get("leapMonthPolicy", "keep"),
            late_zi_policy=v.get("lateZiPolicy", "next-day"),
            migration_destination=v.get("migrationDestination"),
        )
        h = sha256_canonical(res)
        hashes.append(h)
        agg.update(h.encode("ascii"))
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    return hashes, agg.hexdigest(), elapsed_ms


def main() -> None:
    payload_path = sys.argv[1]
    out_path = sys.argv[2]
    with open(payload_path, encoding="utf-8") as f:
        payload = json.load(f)

    start_day = epoch_day_from_civil(1900, 1, 1)
    end_day = epoch_day_from_civil(2100, 12, 31)
    day_hashes, day_agg, day_ms = run_daily_sweep(start_day, end_day)
    vec_hashes, vec_agg, vec_ms = run_vectors(payload["vectors"])

    result = {
        "dayCount": len(day_hashes),
        "dayAggregateSha256": day_agg,
        "dayHashes": day_hashes,
        "dayElapsedMs": round(day_ms, 2),
        "vectorCount": len(vec_hashes),
        "vectorAggregateSha256": vec_agg,
        "vectorHashes": vec_hashes,
        "vectorElapsedMs": round(vec_ms, 2),
        "vectorMsPerOp": round(vec_ms / max(1, len(vec_hashes)), 4),
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f)


if __name__ == "__main__":
    main()
