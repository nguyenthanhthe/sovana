"""Tests for Vietnam bi-temporal GIS (63<->34 provinces) and historical timezone regimes."""

import json

from geo_compiler.compile_geo import PARALLEL_17_LAT, repo_root


def test_vn_bi_temporal_geo_invariants() -> None:
    root = repo_root()
    geo_path = root / "specs" / "geo" / "vn_bi_temporal_geo.json"
    tz_path = root / "specs" / "geo" / "vn_tz_regimes.json"

    assert geo_path.exists()
    assert tz_path.exists()

    geo = json.loads(geo_path.read_text(encoding="utf-8"))
    assert len(geo["provincesPost2025"]) == 34
    assert len(geo["provincesLegacy63"]) == 63
    assert len(geo["districtsLegacy"]) >= 690
    assert len(geo["specialZones"]) >= 20
    assert geo["stats"]["districtCoordSources"].get("province_fallback", 0) == 0

    # Surjective partition: every 63 province maps to one of the 34 post-2025 units
    p34_ids = {p["id"] for p in geo["provincesPost2025"]}
    covered_63 = []
    for p34 in geo["provincesPost2025"]:
        covered_63.extend(p34["mergedFrom63Codes"])
    assert len(covered_63) == 63
    assert len(set(covered_63)) == 63
    for p63 in geo["provincesLegacy63"]:
        assert p63["post2025Id"] in p34_ids

    # Check 17th parallel split inside Quang Tri (Vinh Linh north vs Dong Ha south)
    dists_by_name = {d["name"]: d for d in geo["districtsLegacy"]}
    vinh_linh = dists_by_name["Huyện Vĩnh Linh"]
    dong_ha = dists_by_name["Thành phố Đông Hà"]
    assert vinh_linh["lat"] >= PARALLEL_17_LAT and vinh_linh["tzZone"] == "VN_NORTH_DRV"
    assert dong_ha["lat"] < PARALLEL_17_LAT and dong_ha["tzZone"] == "VN_SOUTH_RVN"

    # Check wide-longitude merged province warning
    p34_by_id = {p["id"]: p for p in geo["provincesPost2025"]}
    assert p34_by_id["lam-dong"]["wideLongitudeWarning"] is True
    assert p34_by_id["dak-lak"]["wideLongitudeWarning"] is True

    # Verify TZ regimes structure
    tz = json.loads(tz_path.read_text(encoding="utf-8"))
    assert set(tz["zones"].keys()) == {"VN_NORTH_DRV", "VN_SOUTH_RVN"}
    for zone_name, intervals in tz["zones"].items():
        for i in range(len(intervals) - 1):
            assert intervals[i]["endLocal"] <= intervals[i + 1]["startLocal"], f"Overlap in {zone_name}"
