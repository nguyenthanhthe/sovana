"""Tests for Tier-2 streaming `.jsonl.zst` differential fuzzer & `lasotuvi-vn` oracle check."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest
from oracle_fuzzer.fuzz_v4_and_lasotuvi import (
    DEFAULT_LASOTUVI_DIR,
    DEFAULT_V4_DIR,
    EXPECTED_13_DOMAINS,
    _KernelToanThuMingCache,
    fuzz_lasotuvi_vn,
    stream_verify_zst_file,
    sweep_v4_dataset,
)


def _has_sovana_kernel() -> bool:
    return importlib.util.find_spec("sovana.kernel") is not None


def _compress_zstd_bytes(raw: bytes) -> bytes:
    try:
        from compression import zstd as stdlib_zstd  # type: ignore[import-not-found]

        return stdlib_zstd.compress(raw)
    except ImportError:
        import zstandard  # type: ignore[import-not-found]

        return zstandard.ZstdCompressor().compress(raw)


@pytest.mark.skipif(not _has_sovana_kernel(), reason="sovana.kernel not yet installed")
def test_synthetic_zst_stream_verifier_and_tamper_detection(tmp_path: Path) -> None:
    cache = _KernelToanThuMingCache()
    stars_day = cache.ming_stars_for_solar_day(1968, 5, 15)

    lines: list[str] = []
    for h in range(12):
        expected_ms, all_zh = stars_day[h]
        co_text = "、".join(all_zh) if all_zh else "命宫空宫"
        for g in ("male", "female"):
            row = {
                "k": f"1968-05-15-{h}-{g}",
                "y": 1968,
                "m": 5,
                "d": 15,
                "h": h,
                "g": g,
                "ms": expected_ms,
                "t": dict.fromkeys(EXPECTED_13_DOMAINS, 100),
                "c": dict.fromkeys(EXPECTED_13_DOMAINS, f"本宫主星：{co_text}"),
            }
            lines.append(json.dumps(row, ensure_ascii=False))

    good_zst = tmp_path / "year-1968.jsonl.zst"
    good_zst.write_bytes(_compress_zstd_bytes(("\n".join(lines) + "\n").encode("utf-8")))

    res = stream_verify_zst_file(good_zst, cache)
    assert res.rows == 24
    assert res.days == 1
    assert res.mismatches == 0
    assert res.first_mismatch is None

    # Tamper with row 0's major star and verify the fuzzer flags the exact mismatch
    bad_row0 = json.loads(lines[0])
    bad_row0["ms"] = "贪狼" if bad_row0["ms"] != "贪狼" else "紫微"
    bad_lines = [json.dumps(bad_row0, ensure_ascii=False), *lines[1:]]
    bad_zst = tmp_path / "year-1969.jsonl.zst"
    bad_zst.write_bytes(_compress_zstd_bytes(("\n".join(bad_lines) + "\n").encode("utf-8")))

    bad_res = stream_verify_zst_file(bad_zst, cache)
    assert bad_res.mismatches == 1
    assert bad_res.first_mismatch is not None
    assert bad_res.first_mismatch["row"] == 1


@pytest.mark.skipif(
    not (_has_sovana_kernel() and DEFAULT_V4_DIR.exists()),
    reason="Quarantined v4.0-13d dataset or sovana.kernel unavailable in this environment",
)
def test_v4_streaming_smoke_1968_and_1985() -> None:
    for yr, expected_rows in ((1968, 8784), (1985, 8760)):
        summary = sweep_v4_dataset(
            dataset_dir=DEFAULT_V4_DIR,
            year_glob=f"year-{yr}.jsonl.zst",
            max_workers=2,
        )
        assert summary.files_swept == 1
        assert summary.total_rows == expected_rows
        assert summary.mismatches == 0
        assert summary.current_rss_mb < 150.0


@pytest.mark.skipif(
    not (_has_sovana_kernel() and DEFAULT_LASOTUVI_DIR.exists()),
    reason="Quarantined lasotuvi-vn oracle or sovana.kernel unavailable in this environment",
)
def test_lasotuvi_1000_non_leap_and_1985_leap_month_split() -> None:
    diff = fuzz_lasotuvi_vn(lasotuvi_dir=DEFAULT_LASOTUVI_DIR, non_leap_target=1000)
    assert diff.non_leap_charts_checked == 1000
    assert diff.non_leap_mismatches == 0
    assert diff.can_canh_charts_verified >= 80
    assert diff.can_nham_charts_verified >= 80
    assert diff.leap_1985_total_days == 30
    assert diff.leap_1985_first_half_matches == 15
    assert diff.leap_1985_second_half_split_fixes == 15
    assert diff.leap_1985_keep_policy_exact_matches == 30
