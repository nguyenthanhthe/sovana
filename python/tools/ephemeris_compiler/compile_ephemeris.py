"""Compile NASA JPL DE440s ephemeris into SVNEPH01 binary + VN/CN divergence report.

Usage:
    uv run python -m ephemeris_compiler.compile_ephemeris
"""

from __future__ import annotations

import datetime as dt
import gzip
import json
import pathlib
import struct
import urllib.request
from typing import Any

from skyfield import almanac
from skyfield.api import Loader
from skyfield.framelib import ecliptic_frame
from skyfield.nutationlib import iau2000b_radians

TAU = 6.283185307179586
MAGIC = b"SVNEPH01"
HEADER_STRUCT = struct.Struct("<8sHHhhIIBB6x")
INT64_STRUCT = struct.Struct("<q")

UNIX_EPOCH_JD = 2440587.5
MS_PER_DAY = 86_400_000

JPL_URLS = [
    "https://ssd.jpl.nasa.gov/ftp/eph/planets/bsp/de440s.bsp",
    "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp",
]

SOLAR_TERM_NAMES_VI = [
    "Xuân Phân", "Thanh Minh", "Cốc Vũ", "Lập Hạ", "Tiểu Mãn", "Mang Chủng",
    "Hạ Chí", "Tiểu Thử", "Đại Thử", "Lập Thu", "Xử Thử", "Bạch Lộ",
    "Thu Phân", "Hàn Lộ", "Sương Giáng", "Lập Đông", "Tiểu Tuyết", "Đại Tuyết",
    "Đông Chí", "Tiểu Hàn", "Đại Hàn", "Lập Xuân", "Vũ Thủy", "Kinh Trập",
]

SOLAR_TERM_NAMES_ZH = [
    "春分", "清明", "谷雨", "立夏", "小满", "芒种",
    "夏至", "小暑", "大暑", "立秋", "处暑", "白露",
    "秋分", "寒露", "霜降", "立冬", "小雪", "大雪",
    "冬至", "小寒", "大寒", "立春", "雨水", "惊蛰",
]


def repo_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parents[3]


def ensure_de440s(cache_dir: pathlib.Path) -> pathlib.Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    bsp_path = cache_dir / "de440s.bsp"
    if bsp_path.exists() and bsp_path.stat().st_size > 30_000_000:
        return bsp_path

    last_err: Exception | None = None
    for url in JPL_URLS:
        try:
            print(f"Downloading JPL de440s.bsp from {url} ...")
            req = urllib.request.Request(url, headers={"User-Agent": "SovanaEphemerisCompiler/0.1"})
            tmp_path = cache_dir / "de440s.bsp.tmp"
            with urllib.request.urlopen(req, timeout=120) as resp, open(tmp_path, "wb") as f:
                while chunk := resp.read(1024 * 256):
                    f.write(chunk)
            tmp_path.replace(bsp_path)
            print(f"Saved {bsp_path} ({bsp_path.stat().st_size:,} bytes)")
            return bsp_path
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            print(f"Failed from {url}: {exc}")
    raise RuntimeError(f"Unable to download de440s.bsp from any JPL mirror: {last_err}")


def solar_terms_24(ephemeris: Any) -> Any:
    earth = ephemeris["earth"]
    sun = ephemeris["sun"]

    def solar_term_at(t: Any) -> Any:
        t._nutation_angles_radians = iau2000b_radians(t)
        e = earth.at(t)
        _, slon, _ = e.observe(sun).apparent().frame_latlon(ecliptic_frame)
        return (slon.radians // (TAU / 24.0) % 24).astype(int)

    solar_term_at.step_days = 10.0
    return solar_term_at


def time_to_ut1_unix_ms(t: Any) -> list[int]:
    return [int(round((ut1_jd - UNIX_EPOCH_JD) * MS_PER_DAY)) for ut1_jd in t.ut1]


def local_epoch_day(unix_ms: int, offset_minutes: int) -> int:
    return (unix_ms + offset_minutes * 60_000) // MS_PER_DAY


def epoch_day_to_iso(epoch_day: int) -> str:
    d = dt.date(1970, 1, 1) + dt.timedelta(days=epoch_day)
    return d.isoformat()


def iso_to_epoch_day(iso_str: str) -> int:
    d = dt.date.fromisoformat(iso_str)
    return (d - dt.date(1970, 1, 1)).days


def build_lunar_day_table(
    new_moons: list[int],
    solar_terms: list[int],
    first_term_idx: int,
    offset_minutes: int,
    start_day: int,
    end_day: int,
) -> dict[int, tuple[int, int, int, bool]]:
    """Map local epoch day -> (lunar_year, lunar_month, lunar_day, is_leap)."""
    nm_days = [local_epoch_day(ms, offset_minutes) for ms in new_moons]
    term_days = [
        (local_epoch_day(ms, offset_minutes), (first_term_idx + i) % 24)
        for i, ms in enumerate(solar_terms)
    ]

    # Map Dong Chi (term_idx == 18, 270 deg) for each Gregorian year 1899..2100
    # Find month index k11(Y) containing Dong Chi of year Y
    dong_chi_by_year: dict[int, int] = {}
    for t_day, t_idx in term_days:
        if t_idx == 18:
            yr = (dt.date(1970, 1, 1) + dt.timedelta(days=t_day)).year
            dong_chi_by_year[yr] = t_day

    import bisect

    k11_by_year: dict[int, int] = {}
    for yr, dc_day in dong_chi_by_year.items():
        idx = bisect.bisect_right(nm_days, dc_day) - 1
        k11_by_year[yr] = idx

    # Pre-index major solar terms (Zhongqi, term_idx % 2 == 0) per month k
    zhongqi_days = sorted(t_day for t_day, t_idx in term_days if t_idx % 2 == 0)

    def month_has_zhongqi(k: int) -> bool:
        d0 = nm_days[k]
        d1 = nm_days[k + 1]
        pos = bisect.bisect_left(zhongqi_days, d0)
        return pos < len(zhongqi_days) and zhongqi_days[pos] < d1

    # Label every lunar month k between k11(1899) and k11(2100)
    month_labels: dict[int, tuple[int, int, bool]] = {}
    years = sorted(k11_by_year.keys())
    for i in range(len(years) - 1):
        y0 = years[i]
        k_start = k11_by_year[y0]
        k_end = k11_by_year[y0 + 1]
        span = k_end - k_start
        has_leap = span == 13
        leap_assigned = False
        month_num = 10  # increments before assignment so k_start gets 11
        lunar_year = y0

        for k in range(k_start, k_end):
            is_leap = False
            if k == k_start:
                month_num = 11
                lunar_year = y0
            elif has_leap and not leap_assigned and not month_has_zhongqi(k):
                is_leap = True
                leap_assigned = True
            else:
                month_num += 1
                if month_num > 12:
                    month_num = 1
                if month_num == 1 and not is_leap:
                    lunar_year = y0 + 1
            month_labels[k] = (lunar_year, month_num, is_leap)

    result: dict[int, tuple[int, int, int, bool]] = {}
    for d in range(start_day, end_day + 1):
        k = bisect.bisect_right(nm_days, d) - 1
        ly, lm, leap = month_labels[k]
        ld = d - nm_days[k] + 1
        result[d] = (ly, lm, ld, leap)
    return result


def compile_all(
    out_dir: pathlib.Path | None = None,
    cache_dir: pathlib.Path | None = None,
) -> tuple[pathlib.Path, pathlib.Path]:
    root = repo_root()
    if out_dir is None:
        out_dir = root / "specs" / "ephemeris"
    if cache_dir is None:
        cache_dir = root / ".cache" / "skyfield"
    out_dir.mkdir(parents=True, exist_ok=True)

    bsp_path = ensure_de440s(cache_dir)
    load = Loader(str(cache_dir))
    ts = load.timescale()
    eph = load(bsp_path.name)

    t0 = ts.ut1(1899, 10, 1, 0, 0, 0)
    t1 = ts.ut1(2102, 2, 1, 0, 0, 0)

    print("Computing NASA JPL DE440s New Moons (1899-10-01 .. 2102-02-01)...")
    nm_times, nm_phases = almanac.find_discrete(t0, t1, almanac.moon_phases(eph))
    new_moons = time_to_ut1_unix_ms(nm_times[nm_phases == 0])

    print("Computing NASA JPL DE440s 24 Solar Terms (1899-10-01 .. 2102-02-01)...")
    st_times, st_indices = almanac.find_discrete(t0, t1, solar_terms_24(eph))
    solar_terms = time_to_ut1_unix_ms(st_times)
    st_idx_list = [int(x) for x in st_indices]

    assert len(new_moons) > 2400
    assert len(solar_terms) > 4800
    assert all(new_moons[i] < new_moons[i + 1] for i in range(len(new_moons) - 1))
    assert all(solar_terms[i] < solar_terms[i + 1] for i in range(len(solar_terms) - 1))
    first_st = st_idx_list[0]
    for i, idx in enumerate(st_idx_list):
        expected = (first_st + i) % 24
        if idx != expected:
            raise ValueError(f"Non-sequential solar term at {i}: got {idx}, expected {expected}")

    bin_path = out_dir / "ephemeris_1900_2100.bin"
    header = HEADER_STRUCT.pack(
        MAGIC,
        1,          # version
        0,          # flags
        1899,       # start_year
        2102,       # end_year
        len(new_moons),
        len(solar_terms),
        first_st,
        1,          # time_scale_id = 1 (UT1 Unix ms)
    )
    with open(bin_path, "wb") as f:
        f.write(header)
        for ms in new_moons:
            f.write(INT64_STRUCT.pack(ms))
        for ms in solar_terms:
            f.write(INT64_STRUCT.pack(ms))

    raw_bytes = bin_path.read_bytes()
    gz_bytes = gzip.compress(raw_bytes, compresslevel=9)
    print(
        f"Wrote {bin_path} ({len(raw_bytes):,} bytes raw, {len(gz_bytes):,} bytes gzipped; "
        f"{len(new_moons)} new moons, {len(solar_terms)} solar terms)"
    )

    # Sweep 1900-01-01 .. 2100-12-31 (73,414 days) + track 73,050-day 1900-01-01..2100-01-01 window
    start_day = iso_to_epoch_day("1900-01-01")
    end_day = iso_to_epoch_day("2100-12-31")
    window_73050_end = start_day + 73050 - 1  # 2099-12-31

    vn_table = build_lunar_day_table(new_moons, solar_terms, first_st, 420, start_day, end_day)
    cn_table = build_lunar_day_table(new_moons, solar_terms, first_st, 480, start_day, end_day)

    divergent_days: list[dict[str, Any]] = []
    tet_divergences: list[dict[str, Any]] = []
    leap_divergences_by_year: dict[int, dict[str, Any]] = {}

    # Detect leap months per lunar year for VN vs CN
    vn_leaps: dict[int, int] = {}
    cn_leaps: dict[int, int] = {}
    for d in range(start_day, end_day + 1):
        v_ly, v_lm, v_ld, v_leap = vn_table[d]
        c_ly, c_lm, c_ld, c_leap = cn_table[d]
        if v_leap and v_ly not in vn_leaps:
            vn_leaps[v_ly] = v_lm
        if c_leap and c_ly not in cn_leaps:
            cn_leaps[c_ly] = c_lm
        if (v_ly, v_lm, v_ld, v_leap) != (c_ly, c_lm, c_ld, c_leap):
            divergent_days.append({
                "date": epoch_day_to_iso(d),
                "vn": {"year": v_ly, "month": v_lm, "day": v_ld, "leap": v_leap},
                "cn": {"year": c_ly, "month": c_lm, "day": c_ld, "leap": c_leap},
            })
        if (v_lm == 1 and v_ld == 1 and not v_leap) or (c_lm == 1 and c_ld == 1 and not c_leap):
            if (v_lm, v_ld, v_leap) != (c_lm, c_ld, c_leap):
                # Record Tết date divergence once per solar year
                solar_year = int(epoch_day_to_iso(d)[:4])
                existing = next((x for x in tet_divergences if x["year"] == solar_year), None)
                if existing is None:
                    existing = {"year": solar_year}
                    tet_divergences.append(existing)
                if v_lm == 1 and v_ld == 1 and not v_leap:
                    existing["vnTetDate"] = epoch_day_to_iso(d)
                if c_lm == 1 and c_ld == 1 and not c_leap:
                    existing["cnTetDate"] = epoch_day_to_iso(d)

    for y in range(1899, 2101):
        vl = vn_leaps.get(y)
        cl = cn_leaps.get(y)
        if vl != cl:
            leap_divergences_by_year[y] = {"lunarYear": y, "vnLeapMonth": vl, "cnLeapMonth": cl}

    # Compress divergent days into contiguous date spans for concise readability
    contiguous_spans: list[dict[str, Any]] = []
    for item in divergent_days:
        d_ord = iso_to_epoch_day(item["date"])
        if contiguous_spans and contiguous_spans[-1]["_endOrd"] == d_ord - 1:
            contiguous_spans[-1]["_endOrd"] = d_ord
            contiguous_spans[-1]["endDate"] = item["date"]
            contiguous_spans[-1]["days"] += 1
        else:
            contiguous_spans.append({
                "_endOrd": d_ord,
                "startDate": item["date"],
                "endDate": item["date"],
                "days": 1,
                "sample": item,
            })
    for s in contiguous_spans:
        s.pop("_endOrd", None)

    divergent_in_73050 = sum(
        1 for x in divergent_days if iso_to_epoch_day(x["date"]) <= window_73050_end
    )

    report = {
        "schemaVersion": "1.0.0",
        "sourceKernel": "NASA JPL DE440s (de440s.bsp)",
        "timeScale": "UT1-aligned Unix epoch ms",
        "decisionReference": "Decision 121-CP (1967-08-08, effective 1968-01-01): VN UTC+7 (105E) vs Beijing UTC+8 (120E)",
        "sweepRange": {
            "startDate": "1900-01-01",
            "endDate": "2100-12-31",
            "totalDays": end_day - start_day + 1,
            "window73050End": epoch_day_to_iso(window_73050_end),
            "divergentDaysTotal": len(divergent_days),
            "divergentDaysIn73050Window": divergent_in_73050,
            "contiguousSpanCount": len(contiguous_spans),
            "tetDivergenceCount": len(tet_divergences),
            "leapMonthDivergenceCount": len(leap_divergences_by_year),
        },
        "tetDivergences": tet_divergences,
        "leapMonthDivergences": list(leap_divergences_by_year.values()),
        "contiguousSpans": contiguous_spans,
    }

    div_path = out_dir / "vn_cn_divergences.json"
    div_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {div_path} ({len(divergent_days)} divergent days across {len(contiguous_spans)} spans; "
        f"{len(tet_divergences)} Tet diffs; {len(leap_divergences_by_year)} leap-month diffs)"
    )
    return bin_path, div_path


if __name__ == "__main__":
    compile_all()
