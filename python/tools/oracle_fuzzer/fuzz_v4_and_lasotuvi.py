"""Tier-2 674,976-Chart Streaming Differential Fuzzer & Read-Only Oracle Verifier.

Verifies `sovana.kernel` + `sovana.geo_time` against two external quarantined lab oracles
without ever copying or decompressing dataset/oracle files to disk:
1. `datasets/v4.0-13d/year-*.jsonl.zst` (77 archives, 1950-2026, 674,976 charts, CN_UTC8 toan-thu)
2. `engines/lasotuvi-vn` (1,000 non-leap VN_UTC7 nam-phai charts + 1985 leap-month split proof)
"""

from __future__ import annotations

import argparse
import ctypes
import importlib
import io
import json
import os
import subprocess
import sys
import threading
import time
import warnings
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from ctypes import wintypes
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from sovana.geo_time import (
    LeapMonthPolicy,
    civil_from_epoch_day,
    epoch_day_from_civil,
    load_ephemeris,
    normalize_birth_temporal,
    solar_to_lunar,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
LAB_ROOT = REPO_ROOT.parent
DEFAULT_V4_DIR = Path(
    os.environ.get("SOVANA_V4_DATASET_DIR", str(LAB_ROOT / "datasets" / "v4.0-13d"))
)
DEFAULT_LASOTUVI_DIR = Path(
    os.environ.get("SOVANA_LASOTUVI_DIR", str(LAB_ROOT / "engines" / "lasotuvi-vn"))
)

VI_TO_ZH_MAJOR: dict[str, str] = {
    "Tử Vi": "紫微",
    "Thiên Cơ": "天机",
    "Thái Dương": "太阳",
    "Vũ Khúc": "武曲",
    "Thiên Đồng": "天同",
    "Liêm Trinh": "廉贞",
    "Thiên Phủ": "天府",
    "Thái Âm": "太阴",
    "Tham Lang": "贪狼",
    "Cự Môn": "巨门",
    "Thiên Tướng": "天相",
    "Thiên Lương": "天梁",
    "Thất Sát": "七杀",
    "Phá Quân": "破军",
}

TUVI_GROUP_VI: frozenset[str] = frozenset(
    {"Tử Vi", "Thiên Cơ", "Thái Dương", "Vũ Khúc", "Thiên Đồng", "Liêm Trinh"}
)

LASOTUVI_ID_TO_VI: dict[int, str] = {
    1: "Tử Vi",
    2: "Liêm Trinh",
    3: "Thiên Đồng",
    4: "Vũ Khúc",
    5: "Thái Dương",
    6: "Thiên Cơ",
    7: "Thiên Phủ",
    8: "Thái Âm",
    9: "Tham Lang",
    10: "Cự Môn",
    11: "Thiên Tướng",
    12: "Thiên Lương",
    13: "Thất Sát",
    14: "Phá Quân",
}

SIHUA_ID_TO_VI: dict[int, str] = {
    94: "Hóa Lộc",
    93: "Hóa Quyền",
    92: "Hóa Khoa",
    95: "Hóa Kỵ",
}

EXPECTED_13_DOMAINS: frozenset[str] = frozenset(
    {
        "overview",
        "personality",
        "love",
        "career",
        "wealth",
        "health",
        "family",
        "children",
        "move",
        "friends",
        "home",
        "spirit",
        "parents",
    }
)


class _ProcessMemoryCounters(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


def get_process_rss_mb() -> tuple[float, float]:
    """Return (current_rss_mb, peak_rss_mb) for the current Python process."""
    if sys.platform == "win32":
        counters = _ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(_ProcessMemoryCounters)
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        get_proc = k32.GetCurrentProcess
        get_proc.restype = wintypes.HANDLE
        get_mem = getattr(k32, "K32GetProcessMemoryInfo", None)
        if get_mem is None:
            psapi = ctypes.WinDLL("psapi", use_last_error=True)
            get_mem = psapi.GetProcessMemoryInfo
        get_mem.argtypes = [
            wintypes.HANDLE,
            ctypes.POINTER(_ProcessMemoryCounters),
            wintypes.DWORD,
        ]
        get_mem.restype = wintypes.BOOL
        if get_mem(get_proc(), ctypes.byref(counters), counters.cb):
            cur_mb = counters.WorkingSetSize / (1024.0 * 1024.0)
            peak_mb = counters.PeakWorkingSetSize / (1024.0 * 1024.0)
            return round(cur_mb, 2), round(peak_mb, 2)
    else:
        import resource

        usage = resource.getrusage(resource.RUSAGE_SELF)
        scale = 1024.0 if sys.platform == "darwin" else 1.0
        peak_mb = (usage.ru_maxrss * scale) / (1024.0 * 1024.0)
        return round(peak_mb, 2), round(peak_mb, 2)
    return 0.0, 0.0


@contextmanager
def open_zst_binary_lines(path: Path) -> Iterator[io.BufferedReader | Any]:
    """Stream-decompress a `.jsonl.zst` archive (`--long=27` / 256MB window) in memory."""
    try:
        from compression import zstd as stdlib_zstd  # type: ignore[import-not-found]

        with stdlib_zstd.open(
            path,
            "rb",
            options={stdlib_zstd.DecompressionParameter.window_log_max: 28},
        ) as zf:
            yield zf
        return
    except ImportError:
        pass

    try:
        import zstandard  # type: ignore[import-not-found]

        with open(path, "rb") as raw_f:
            dctx = zstandard.ZstdDecompressor(max_window_size=1 << 28)
            with dctx.stream_reader(raw_f) as reader:
                yield io.BufferedReader(reader, buffer_size=131072)
        return
    except ImportError:
        pass

    proc = subprocess.Popen(
        ["zstd", "-dc", "--long=27", str(path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert proc.stdout is not None
    try:
        yield proc.stdout
    finally:
        proc.stdout.close()
        if proc.stderr is not None:
            proc.stderr.close()
        rc = proc.wait()
        if rc != 0:
            raise RuntimeError(f"zstd subprocess exited with code {rc} on {path}")


def _load_cast_ziwei():
    kernel_mod = importlib.import_module("sovana.kernel")
    return kernel_mod.cast_ziwei_chart


def _palace_branch(palace: Any) -> int:
    for attr in ("branch_index", "branch"):
        val = getattr(palace, attr, None)
        if isinstance(val, int):
            return val
    raise AttributeError(f"Cannot read branch index from palace: {palace!r}")


def _palace_name(palace: Any) -> str:
    for attr in ("name_vi", "name", "palace_name_vi", "palace_name"):
        val = getattr(palace, attr, None)
        if isinstance(val, str):
            return val
    raise AttributeError(f"Cannot read palace name from palace: {palace!r}")


def _star_name(star: Any) -> str:
    for attr in ("name", "name_vi"):
        val = getattr(star, attr, None)
        if isinstance(val, str):
            return val
    raise AttributeError(f"Cannot read star name from star: {star!r}")


def _star_sihua(star: Any) -> str | None:
    for attr in ("sihua_transform", "sihua"):
        val = getattr(star, attr, None)
        if val is not None:
            return str(val)
    return None


def _extract_chart_summary(chart: Any) -> dict[str, Any]:
    palaces = list(chart.palaces)
    menh_b: int | None = getattr(chart, "menh_branch", None)
    than_b: int | None = getattr(chart, "than_branch", None)

    major_by_branch: dict[int, list[str]] = {b: [] for b in range(12)}
    sihua_branches: dict[str, int] = {}
    sihua_stars: dict[str, str] = {}
    tuan_branches: list[int] = []
    triet_branches: list[int] = []

    for p in palaces:
        b = _palace_branch(p)
        pname = _palace_name(p)
        if menh_b is None and pname == "Mệnh":
            menh_b = b
        if than_b is None and bool(getattr(p, "is_than", getattr(p, "is_body_palace", False))):
            than_b = b
        if bool(getattr(p, "tuan_trung", False)):
            tuan_branches.append(b)
        if bool(getattr(p, "triet_lo", False)):
            triet_branches.append(b)

        majors = list(getattr(p, "major_stars", []))
        minors = list(getattr(p, "minor_stars", []))
        for s in majors:
            sname = _star_name(s)
            major_by_branch[b].append(sname)
            sh = _star_sihua(s)
            if sh:
                sihua_branches[sh] = b
                sihua_stars[sh] = sname
        for s in minors:
            sname = _star_name(s)
            sh = _star_sihua(s)
            if sh:
                sihua_branches[sh] = b
                sihua_stars[sh] = sname
        major_by_branch[b].sort()

    if not tuan_branches:
        raw_tuan = getattr(chart, "tuan_trung_branches", getattr(chart, "tuan_branches", None))
        if raw_tuan is not None:
            tuan_branches = sorted(int(x) for x in raw_tuan)
    if not triet_branches:
        raw_triet = getattr(chart, "triet_lo_branches", getattr(chart, "triet_branches", None))
        if raw_triet is not None:
            triet_branches = sorted(int(x) for x in raw_triet)

    assert menh_b is not None, "Could not locate Mệnh palace branch on ZiweiChartIR"
    assert than_b is not None, "Could not locate Thân palace branch on ZiweiChartIR"
    return {
        "menh": menh_b,
        "than": than_b,
        "majorByBranch": major_by_branch,
        "sihuaBranches": sihua_branches,
        "sihuaStars": sihua_stars,
        "tuan": sorted(tuan_branches),
        "triet": sorted(triet_branches),
    }


def _primary_ms_zh_from_majors(majors_vi: list[str]) -> str | None:
    """Map Mệnh major stars to v4.0-13d `ms` primary star (Tử Vi group precedes Thiên Phủ)."""
    if not majors_vi:
        return None
    for s in majors_vi:
        if s in TUVI_GROUP_VI:
            return VI_TO_ZH_MAJOR[s]
    return VI_TO_ZH_MAJOR[majors_vi[0]]


class _KernelToanThuMingCache:
    """Thread-safe memoizer calling real `sovana.kernel.cast_ziwei_chart` per lunar state."""

    def __init__(self) -> None:
        self._eph = load_ephemeris()
        self._cast_ziwei = _load_cast_ziwei()
        self._lock = threading.Lock()
        self._state_cache: dict[tuple[int, int, int, int], tuple[str | None, tuple[str, ...]]] = {}

    @property
    def unique_kernel_states(self) -> int:
        return len(self._state_cache)

    def ming_stars_for_solar_day(
        self, y: int, m: int, d: int
    ) -> list[tuple[str | None, tuple[str, ...]]]:
        ed = epoch_day_from_civil(y, m, d)
        lun = solar_to_lunar(self._eph, ed, "CN_UTC8", "split-15")
        y_stem = (lun.lunar_year - 4) % 10
        eff_m = lun.effective_lunar_month
        ld = lun.lunar_day

        day_res: list[tuple[str | None, tuple[str, ...]]] = []
        for h in range(12):
            key = (y_stem, eff_m, ld, h)
            cached = self._state_cache.get(key)
            if cached is None:
                wall_h = 0 if h == 0 else h * 2
                wall_min = 30 if h == 0 else 0
                temporal = normalize_birth_temporal(
                    year=y,
                    month=m,
                    day=d,
                    hour=wall_h,
                    minute=wall_min,
                    location={"lat": 39.9042, "lon": 120.0},
                    iana_time_zone="Etc/GMT-8",
                    calendar_mode="CN_UTC8",
                    leap_month_policy="split-15",
                )
                chart = self._cast_ziwei(temporal, "male", "toan-thu")
                summary = _extract_chart_summary(chart)
                majors_vi = summary["majorByBranch"][summary["menh"]]
                primary_zh = _primary_ms_zh_from_majors(majors_vi)
                all_zh = tuple(VI_TO_ZH_MAJOR[s] for s in majors_vi)
                cached = (primary_zh, all_zh)
                with self._lock:
                    self._state_cache[key] = cached
            day_res.append(cached)
        return day_res


@dataclass(frozen=True)
class V4FileResult:
    file_name: str
    rows: int
    days: int
    mismatches: int
    first_mismatch: dict[str, Any] | None


@dataclass(frozen=True)
class V4SweepSummary:
    files_swept: int
    total_rows: int
    total_days: int
    unique_kernel_charts_compiled: int
    mismatches: int
    full_13d_spot_checks: int
    elapsed_seconds: float
    charts_per_second: float
    current_rss_mb: float
    peak_rss_mb: float
    first_mismatch: dict[str, Any] | None


def stream_verify_zst_file(
    path: Path,
    kernel_cache: _KernelToanThuMingCache | None = None,
) -> V4FileResult:
    """Stream one `year-YYYY.jsonl.zst` archive and verify every row against `sovana.kernel`."""
    cache = kernel_cache or _KernelToanThuMingCache()
    day_lookup: dict[tuple[int, int, int], list[tuple[str | None, tuple[str, ...]]]] = {}
    day_seen_slots: dict[tuple[int, int, int], int] = {}

    rows = 0
    mismatches = 0
    first_mismatch: dict[str, Any] | None = None
    marker = b',"t":'

    with open_zst_binary_lines(path) as stream:
        for raw_line in stream:
            line = raw_line.strip()
            if not line:
                continue
            rows += 1
            if not line.endswith(b"}"):
                mismatches += 1
                if first_mismatch is None:
                    first_mismatch = {"file": path.name, "row": rows, "reason": "truncated_json"}
                continue

            idx = line.find(marker)
            if idx != -1:
                hdr = json.loads(line[:idx] + b"}")
            else:
                hdr = json.loads(line)

            y = int(hdr["y"])
            m = int(hdr["m"])
            d = int(hdr["d"])
            h = int(hdr["h"])
            g = str(hdr["g"])
            ms = hdr["ms"]
            expected_k = f"{y:04d}-{m:02d}-{d:02d}-{h}-{g}"

            ymd = (y, m, d)
            day_stars = day_lookup.get(ymd)
            if day_stars is None:
                day_stars = cache.ming_stars_for_solar_day(y, m, d)
                day_lookup[ymd] = day_stars
                day_seen_slots[ymd] = 0

            slot_bit = 1 << (h * 2 + (0 if g == "male" else 1))
            day_seen_slots[ymd] |= slot_bit

            expected_ms, expected_all_zh = day_stars[h]
            if hdr["k"] != expected_k or ms != expected_ms:
                mismatches += 1
                if first_mismatch is None:
                    first_mismatch = {
                        "file": path.name,
                        "row": rows,
                        "k": hdr.get("k"),
                        "expectedK": expected_k,
                        "datasetMs": ms,
                        "sovanaMs": expected_ms,
                    }

            # Full 13-domain spot check on row 1 of each archive
            if rows == 1 and idx != -1:
                full_obj = json.loads(line)
                t_keys = set(full_obj.get("t", {}).keys())
                c_keys = set(full_obj.get("c", {}).keys())
                overview = str(full_obj.get("c", {}).get("overview", ""))
                if t_keys != EXPECTED_13_DOMAINS or c_keys != EXPECTED_13_DOMAINS:
                    mismatches += 1
                    if first_mismatch is None:
                        first_mismatch = {
                            "file": path.name,
                            "row": rows,
                            "reason": "domain_keys_mismatch",
                        }
                for zh_star in expected_all_zh:
                    if zh_star not in overview:
                        mismatches += 1
                        if first_mismatch is None:
                            first_mismatch = {
                                "file": path.name,
                                "row": rows,
                                "reason": f"missing_co_star_{zh_star}_in_overview",
                            }

    for ymd, mask in day_seen_slots.items():
        if mask != (1 << 24) - 1:
            mismatches += 1
            if first_mismatch is None:
                first_mismatch = {
                    "file": path.name,
                    "ymd": ymd,
                    "reason": "incomplete_24_chart_day",
                    "slotMask": bin(mask),
                }

    return V4FileResult(
        file_name=path.name,
        rows=rows,
        days=len(day_lookup),
        mismatches=mismatches,
        first_mismatch=first_mismatch,
    )


def sweep_v4_dataset(
    dataset_dir: Path = DEFAULT_V4_DIR,
    year_glob: str = "year-*.jsonl.zst",
    max_workers: int = 2,
) -> V4SweepSummary:
    """Stream-verify all matching `.jsonl.zst` archives in `dataset_dir` (< 100 MB RAM)."""
    files = sorted(dataset_dir.glob(year_glob))
    if not files:
        raise FileNotFoundError(f"No {year_glob} archives found in {dataset_dir}")

    kernel_cache = _KernelToanThuMingCache()
    t0 = time.perf_counter()
    total_rows = 0
    total_days = 0
    total_mismatches = 0
    first_mismatch: dict[str, Any] | None = None

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        for res in pool.map(lambda p: stream_verify_zst_file(p, kernel_cache), files):
            total_rows += res.rows
            total_days += res.days
            total_mismatches += res.mismatches
            if first_mismatch is None and res.first_mismatch is not None:
                first_mismatch = res.first_mismatch

    elapsed = time.perf_counter() - t0
    cur_rss, peak_rss = get_process_rss_mb()
    return V4SweepSummary(
        files_swept=len(files),
        total_rows=total_rows,
        total_days=total_days,
        unique_kernel_charts_compiled=kernel_cache.unique_kernel_states,
        mismatches=total_mismatches,
        full_13d_spot_checks=len(files),
        elapsed_seconds=round(elapsed, 3),
        charts_per_second=round(total_rows / max(elapsed, 1e-6), 1),
        current_rss_mb=cur_rss,
        peak_rss_mb=peak_rss,
        first_mismatch=first_mismatch,
    )


@dataclass(frozen=True)
class LasotuviDiffSummary:
    non_leap_charts_checked: int
    non_leap_mismatches: int
    can_canh_charts_verified: int
    can_nham_charts_verified: int
    leap_1985_total_days: int
    leap_1985_first_half_matches: int
    leap_1985_second_half_split_fixes: int
    leap_1985_keep_policy_exact_matches: int
    elapsed_seconds: float
    first_mismatch: dict[str, Any] | None


def _load_lasotuvi_readonly(lasotuvi_dir: Path) -> tuple[Any, Any, Any]:
    if not lasotuvi_dir.exists():
        raise FileNotFoundError(f"lasotuvi-vn directory not found: {lasotuvi_dir}")

    prev_dont_write = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    path_str = str(lasotuvi_dir)
    added = False
    if path_str not in sys.path:
        sys.path.insert(0, path_str)
        added = True
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", SyntaxWarning)
            app_mod = importlib.import_module("lasotuvi.App")
            diaban_mod = importlib.import_module("lasotuvi.DiaBan")
            amduong_mod = importlib.import_module("lasotuvi.AmDuong")
            return app_mod.lapDiaBan, diaban_mod.diaBan, amduong_mod.S2L
    finally:
        sys.dont_write_bytecode = prev_dont_write
        if added and path_str in sys.path:
            sys.path.remove(path_str)


def _extract_lasotuvi_chart(
    lap_dia_ban: Any,
    dia_ban_cls: Any,
    y: int,
    m: int,
    d: int,
    h_branch: int,
    gender: str,
) -> dict[str, Any]:
    gio_sinh = h_branch + 1
    gioi_tinh = 1 if gender == "male" else -1
    db = lap_dia_ban(dia_ban_cls, d, m, y, gio_sinh, gioi_tinh, True, 7)

    major_by_branch: dict[int, list[str]] = {b: [] for b in range(12)}
    sihua_branches: dict[str, int] = {}
    tuan_branches: list[int] = []
    triet_branches: list[int] = []

    for cung_idx in range(1, 13):
        b = cung_idx - 1
        cung = db.thapNhiCung[cung_idx]
        if getattr(cung, "tuanTrung", False):
            tuan_branches.append(b)
        if getattr(cung, "trietLo", False):
            triet_branches.append(b)
        for s in cung.cungSao:
            sid = int(s["saoID"])
            if sid in LASOTUVI_ID_TO_VI:
                major_by_branch[b].append(LASOTUVI_ID_TO_VI[sid])
            elif sid in SIHUA_ID_TO_VI:
                sihua_branches[SIHUA_ID_TO_VI[sid]] = b
        major_by_branch[b].sort()

    return {
        "menh": int(db.cungMenh) - 1,
        "than": int(db.cungThan) - 1,
        "majorByBranch": major_by_branch,
        "sihuaBranches": sihua_branches,
        "tuan": sorted(tuan_branches),
        "triet": sorted(triet_branches),
    }


def _cast_sovana_vn_utc7(
    cast_ziwei: Any,
    y: int,
    m: int,
    d: int,
    h_branch: int,
    gender: str,
    leap_policy: LeapMonthPolicy,
    silo: str = "nam-phai",
) -> tuple[dict[str, Any], int]:
    wall_h = 0 if h_branch == 0 else h_branch * 2
    wall_min = 30 if h_branch == 0 else 0
    temporal = normalize_birth_temporal(
        year=y,
        month=m,
        day=d,
        hour=wall_h,
        minute=wall_min,
        location={"lat": 21.0285, "lon": 105.0},
        iana_time_zone="Asia/Bangkok",
        calendar_mode="VN_UTC7",
        leap_month_policy=leap_policy,
    )
    chart = cast_ziwei(temporal, gender, silo)
    return _extract_chart_summary(chart), temporal.pillars.lunar_year_pillar.stem_index


def fuzz_lasotuvi_vn(
    lasotuvi_dir: Path = DEFAULT_LASOTUVI_DIR,
    non_leap_target: int = 1000,
) -> LasotuviDiffSummary:
    """Differential test `sovana.kernel` (`nam-phai`) vs read-only `lasotuvi-vn`."""
    lap_dia_ban, dia_ban_cls, s2l_fn = _load_lasotuvi_readonly(lasotuvi_dir)
    cast_ziwei = _load_cast_ziwei()
    eph = load_ephemeris()

    t0 = time.perf_counter()
    start_ed = epoch_day_from_civil(1950, 1, 1)
    end_ed = epoch_day_from_civil(2025, 12, 31)
    step = max(1, (end_ed - start_ed) // (non_leap_target + 120))

    checked = 0
    mismatches = 0
    can_canh = 0
    can_nham = 0
    first_mismatch: dict[str, Any] | None = None

    ed = start_ed
    while checked < non_leap_target and ed <= end_ed:
        lun = solar_to_lunar(eph, ed, "VN_UTC7", "keep")
        if not lun.is_leap_month:
            y, m, d = civil_from_epoch_day(ed)
            h_branch = checked % 12
            gender = "male" if checked % 2 == 0 else "female"

            sov_full, y_stem = _cast_sovana_vn_utc7(
                cast_ziwei, y, m, d, h_branch, gender, "split-15", "nam-phai"
            )
            sov = {k: v for k, v in sov_full.items() if k != "sihuaStars"}
            ora = _extract_lasotuvi_chart(lap_dia_ban, dia_ban_cls, y, m, d, h_branch, gender)

            if y_stem == 6:
                can_canh += 1
                sov_tt_full, _ = _cast_sovana_vn_utc7(
                    cast_ziwei, y, m, d, h_branch, gender, "split-15", "toan-thu"
                )
                if sov_full["sihuaStars"] == sov_tt_full["sihuaStars"]:
                    mismatches += 1
                    if first_mismatch is None:
                        first_mismatch = {
                            "date": f"{y:04d}-{m:02d}-{d:02d}",
                            "reason": "can_canh_silo_not_diverging_from_toan_thu",
                        }
            elif y_stem == 8:
                can_nham += 1

            if sov != ora:
                mismatches += 1
                if first_mismatch is None:
                    first_mismatch = {
                        "date": f"{y:04d}-{m:02d}-{d:02d}",
                        "hBranch": h_branch,
                        "gender": gender,
                        "sovana": sov,
                        "lasotuvi": ora,
                    }
            checked += 1
        ed += step

    # 1985 Vietnamese Leap Month 2 (1985-03-21 .. 1985-04-19 = 30 days)
    leap_total = 0
    first_half_matches = 0
    second_half_fixes = 0
    keep_matches = 0

    for ed_1985 in range(epoch_day_from_civil(1985, 3, 21), epoch_day_from_civil(1985, 4, 19) + 1):
        y, m, d = civil_from_epoch_day(ed_1985)
        lun_vn = solar_to_lunar(eph, ed_1985, "VN_UTC7", "split-15")
        s2l_res = s2l_fn(d, m, y, timeZone=7)
        assert lun_vn.is_leap_month and lun_vn.lunar_month == 2 and s2l_res[3] == 1

        leap_total += 1
        h_branch = leap_total % 12
        gender = "male" if leap_total % 2 == 0 else "female"

        ora_1985 = _extract_lasotuvi_chart(lap_dia_ban, dia_ban_cls, y, m, d, h_branch, gender)
        sov_split_full, _ = _cast_sovana_vn_utc7(
            cast_ziwei, y, m, d, h_branch, gender, "split-15", "nam-phai"
        )
        sov_keep_full, _ = _cast_sovana_vn_utc7(
            cast_ziwei, y, m, d, h_branch, gender, "keep", "nam-phai"
        )
        sov_split = {k: v for k, v in sov_split_full.items() if k != "sihuaStars"}
        sov_keep = {k: v for k, v in sov_keep_full.items() if k != "sihuaStars"}

        if sov_keep == ora_1985:
            keep_matches += 1
        if lun_vn.lunar_day <= 15:
            if sov_split == ora_1985:
                first_half_matches += 1
        else:
            expected_shifted_menh = (ora_1985["menh"] + 1) % 12
            if sov_split["menh"] == expected_shifted_menh and sov_split != ora_1985:
                second_half_fixes += 1

    elapsed = time.perf_counter() - t0
    return LasotuviDiffSummary(
        non_leap_charts_checked=checked,
        non_leap_mismatches=mismatches,
        can_canh_charts_verified=can_canh,
        can_nham_charts_verified=can_nham,
        leap_1985_total_days=leap_total,
        leap_1985_first_half_matches=first_half_matches,
        leap_1985_second_half_split_fixes=second_half_fixes,
        leap_1985_keep_policy_exact_matches=keep_matches,
        elapsed_seconds=round(elapsed, 3),
        first_mismatch=first_mismatch,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="SOVANA Tier-2 674,976-Chart Streaming Fuzzer & lasotuvi-vn Verifier"
    )
    parser.add_argument("--v4-dir", type=Path, default=DEFAULT_V4_DIR)
    parser.add_argument("--lasotuvi-dir", type=Path, default=DEFAULT_LASOTUVI_DIR)
    parser.add_argument("--year-glob", type=str, default="year-*.jsonl.zst")
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--non-leap-count", type=int, default=1000)
    args = parser.parse_args()

    v4_summary = sweep_v4_dataset(
        dataset_dir=args.v4_dir,
        year_glob=args.year_glob,
        max_workers=args.workers,
    )
    lasotuvi_summary = fuzz_lasotuvi_vn(
        lasotuvi_dir=args.lasotuvi_dir,
        non_leap_target=args.non_leap_count,
    )

    report = {
        "v4StreamingSweep": asdict(v4_summary),
        "lasotuviDifferential": asdict(lasotuvi_summary),
    }
    print(json.dumps(report, indent=2, ensure_ascii=False))

    if v4_summary.mismatches > 0 or v4_summary.total_rows != 674_976:
        raise SystemExit(1)
    if (
        lasotuvi_summary.non_leap_mismatches > 0
        or lasotuvi_summary.leap_1985_first_half_matches != 15
        or lasotuvi_summary.leap_1985_second_half_split_fixes != 15
    ):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
