"""Tests for NASA JPL ephemeris compilation and Smoking Gun #1 VN vs CN divergences."""

import json
import pathlib

from ephemeris_compiler.compile_ephemeris import HEADER_STRUCT, MAGIC, repo_root
from ephemeris_compiler.verify_jpl_sweep import run_verification


def test_ephemeris_binary_and_jpl_sweep() -> None:
    root = repo_root()
    bin_path = root / "specs" / "ephemeris" / "ephemeris_1900_2100.bin"
    div_path = root / "specs" / "ephemeris" / "vn_cn_divergences.json"

    assert bin_path.exists()
    assert div_path.exists()

    raw = bin_path.read_bytes()
    magic, ver, _, start_y, end_y, nm_count, st_count, _, ts_id = HEADER_STRUCT.unpack_from(raw, 0)
    assert magic == MAGIC
    assert ver == 1
    assert start_y == 1899
    assert end_y == 2102
    assert ts_id == 1
    assert len(raw) == HEADER_STRUCT.size + (nm_count + st_count) * 8

    summary = run_verification()
    assert summary["totalDaysSwept"] == 73414
    assert summary["maxSolarTermErrorSec"] < 60.0
    assert summary["maxNewMoonErrorSec"] < 60.0
    assert summary["maxEotErrorSec"] < 15.0

    report = json.loads(div_path.read_text(encoding="utf-8"))
    tet_by_year = {x["year"]: x for x in report["tetDivergences"]}
    assert 1968 in tet_by_year
    assert tet_by_year[1968]["vnTetDate"] == "1968-01-29"
    assert tet_by_year[1968]["cnTetDate"] == "1968-01-30"
    assert 2030 in tet_by_year
    assert tet_by_year[2030]["vnTetDate"] == "2030-02-02"
    assert tet_by_year[2030]["cnTetDate"] == "2030-02-03"

    leap_by_year = {x["lunarYear"]: x for x in report["leapMonthDivergences"]}
    assert 1984 in leap_by_year or 1985 in leap_by_year
