"""Tests for the 4 normalized classics JSONs and empirical classics verifier."""

from __future__ import annotations

import json
import sys
from pathlib import Path

TOOLS_ROOT = Path(__file__).resolve().parents[1]
if str(TOOLS_ROOT) not in sys.path:
    sys.path.insert(0, str(TOOLS_ROOT))

from classics_verifier.verify_classics import (  # noqa: E402
    DEFAULT_OUT_PATH,
    NAM_PHAI_SPEC_PATH,
    REPO_ROOT,
    TOAN_THU_SPEC_PATH,
    run_verification,
)

BAZI_SPEC_PATH = REPO_ROOT / "specs" / "classics" / "bazi_cung_thong_trich_thien.json"
LIUYAO_SPEC_PATH = REPO_ROOT / "specs" / "classics" / "liuyao_tang_san_canonical.json"


def test_classics_json_schemas_and_quarantine() -> None:
    forbidden = ("nihai-", "ni-haixia-reasoning-chain", "tianji-ziwei")
    for p in (TOAN_THU_SPEC_PATH, NAM_PHAI_SPEC_PATH, BAZI_SPEC_PATH, LIUYAO_SPEC_PATH):
        assert p.exists(), f"Missing classics JSON: {p}"
        raw = p.read_text(encoding="utf-8")
        low = raw.lower()
        for token in forbidden:
            assert token not in low, f"Quarantine violation {token!r} in {p}"

    tt = json.loads(TOAN_THU_SPEC_PATH.read_text(encoding="utf-8"))
    patterns = tt["patterns"]
    assert len(patterns) == 49
    assert sum(1 for x in patterns if x["status"] == "verified") == 35
    assert sum(1 for x in patterns if x["status"] == "unreachable") == 5
    assert sum(1 for x in patterns if x["status"] == "disputed") == 9
    for x in patterns:
        if x["status"] == "unreachable":
            assert x["predicate"] is None
            assert isinstance(x["whyUnreachable"], str) and len(x["whyUnreachable"]) > 20
        else:
            assert x["predicate"] is not None
        assert x["hanziOriginal"]
        assert x["hanViet"]
        assert x["literalMeaningVi"]
        assert x["modernInterpretationVi"]
        assert x["actionableAdviceVi"]
    assert len(tt["keyVerses"]) >= 12

    np = json.loads(NAM_PHAI_SPEC_PATH.read_text(encoding="utf-8"))
    assert len(np["patterns"]) >= 26
    for x in np["patterns"]:
        assert isinstance(x["requiresM3Stars"], list)
        assert x["siloDivergenceNote"]
        assert x["predicate"] is not None
        assert x["modernInterpretationVi"]
        assert x["actionableAdviceVi"]

    bz = json.loads(BAZI_SPEC_PATH.read_text(encoding="utf-8"))
    assert len(bz["cungThongBaoGiam"]) == 120
    ids = {e["id"] for e in bz["cungThongBaoGiam"]}
    assert len(ids) == 120
    for s in range(10):
        for b in range(12):
            assert f"CTBG-{s}-{b}" in ids
    assert len(bz["diTianSui"]) >= 20
    assert len(bz["yuanHaiZiPing"]) >= 8
    assert len(bz["ziPingZhenQuan"]) >= 6

    ly = json.loads(LIUYAO_SPEC_PATH.read_text(encoding="utf-8"))
    assert len(ly["tuanKhongSixPairs"]) == 6
    assert len(ly["tienThanPairs"]) == 7
    assert len(ly["thoaiThanPairs"]) == 7
    used_flags = set()
    for entry in ly["zengShanBuYi"]:
        raw_pred = json.dumps(entry["predicate"])
        for f in ("hasPhucThan", "phiSinhPhuc", "phiKhacPhuc", "phiLamKhongPha", "theAmDong"):
            if f in raw_pred:
                used_flags.add(f)
    expected_flags = {
        "hasPhucThan",
        "phiSinhPhuc",
        "phiKhacPhuc",
        "phiLamKhongPha",
        "theAmDong",
    }
    assert used_flags == expected_flags
    assert len(ly["meiHuaYiShu"]) >= 6
    assert len(ly["phanBoiChauTerms"]) >= 6


def test_fast_empirical_invariants_and_silo_divergences() -> None:
    report = run_verification(count=600, workers=1)
    assert report["totalCharts"] == 600
    assert report["allPassed"] is True
    assert report["unreachableAllZero"] is True
    assert report["unreachableFailures"] == []

    assert len(report["structuralInvariants"]) == 7
    for inv in report["structuralInvariants"]:
        assert inv["passed"] is True, f"Invariant failed: {inv}"

    tt_by_id = {x["id"]: x for x in report["toanThu49"]}
    for uid in ("TT-DF-01", "TT-DF-04", "TT-DQ-07", "TT-DQ-10", "TT-DQ-27"):
        assert tt_by_id[uid]["status"] == "unreachable"
        assert tt_by_id[uid]["bySilo"]["toan-thu"]["hitCount"] == 0
        assert tt_by_id[uid]["bySilo"]["nam-phai"]["hitCount"] == 0
    # TT-DQ-21 (Văn Tinh Ám Củng / Xương Khúc Giáp Mệnh) is reachable (delta == 2 even)
    assert tt_by_id["TT-DQ-21"]["status"] == "verified"
    assert tt_by_id["TT-DQ-21"]["bySilo"]["toan-thu"]["hitCount"] > 0

    np_by_id = {x["id"]: x for x in report["namPhaiPatterns"]}
    # Silo divergence 1: Mã Đầu Đới Kiếm (Toàn Thư unreachable == 0 vs Nam Phái Ngọ > 0)
    assert tt_by_id["TT-DQ-10"]["bySilo"]["toan-thu"]["hitCount"] == 0
    assert np_by_id["NP-PC-08"]["bySilo"]["nam-phai"]["hitCount"] > 0

    # Silo divergence 2: Minh Lộc Ám Lộc (đối cung vs nhị hợp)
    assert tt_by_id["TT-DQ-25"]["bySilo"]["toan-thu"]["hitCount"] > 0
    assert np_by_id["NP-PC-13"]["bySilo"]["nam-phai"]["hitCount"] > 0

    # Silo divergence 3: Nhật Nguyệt Chiếu Bích (same palace vs opposite palace)
    assert tt_by_id["TT-DF-05"]["bySilo"]["toan-thu"]["hitCount"] > 0
    assert np_by_id["NP-PC-06"]["bySilo"]["nam-phai"]["hitCount"] > 0


def test_full_100k_report_if_present() -> None:
    if not DEFAULT_OUT_PATH.exists():
        return
    report = json.loads(DEFAULT_OUT_PATH.read_text(encoding="utf-8"))
    if report.get("totalCharts") != 100_000:
        return
    assert report["allPassed"] is True
    assert report["unreachableAllZero"] is True
    for pat in report["toanThu49"]:
        if pat["status"] == "unreachable":
            assert pat["bySilo"]["toan-thu"]["hitCount"] == 0
        else:
            assert pat["bySilo"]["toan-thu"]["hitCount"] >= 1, f"0 hits on judgeable {pat['id']}"
