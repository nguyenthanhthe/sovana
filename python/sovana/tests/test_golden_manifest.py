"""Golden SHA-256 manifest regression checks for sovana.geo_time."""

import json
import pathlib

from sovana.geo_time import normalize_birth_temporal, sha256_canonical


def test_golden_manifest_sample_vectors() -> None:
    repo_root = pathlib.Path(__file__).resolve().parents[3]
    manifest = json.loads(
        (repo_root / "tests" / "golden" / "manifest_sha256.json").read_text(encoding="utf-8")
    )
    assert manifest["dailySweep"]["totalDays"] == 73_414
    assert manifest["dailySweep"]["window73050Days"] == 73_050
    assert manifest["dailySweep"]["mismatches"] == 0
    assert manifest["adversarialVectors"]["totalVectors"] == 10_000
    assert manifest["adversarialVectors"]["mismatches"] == 0

    for sample in manifest["adversarialVectors"]["sampleVectors"]:
        inp = sample["input"]
        res = normalize_birth_temporal(
            year=inp["year"],
            month=inp["month"],
            day=inp["day"],
            hour=inp["hour"],
            minute=inp["minute"],
            second=inp.get("second", 0),
            location=inp["location"],
            iana_time_zone=inp.get("ianaTimeZone"),
            calendar_mode=inp.get("calendarMode", "VN_HISTORICAL"),
            leap_month_policy=inp.get("leapMonthPolicy", "keep"),
            late_zi_policy=inp.get("lateZiPolicy", "next-day"),
            migration_destination=inp.get("migrationDestination"),
        )
        assert sha256_canonical(res) == sample["sha256"]
