"""Empirical 100,000-chart Classics Rarity & Structural Invariant Verifier.

Samples deterministic birth dates across 1900-2100 (73,414 calendar days via
coprime stride 49999), casts dual-silo Ziwei charts (nam-phai and toan-thu),
evaluates all 49 Toàn Thư Quyển 1 patterns, key verses, and Nam Phái classical
patterns, and proves all 7 mathematical structural invariants plus 6 unreachable
patterns == 0 hits.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import time
from collections.abc import Mapping, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sovana.geo_time import normalize_birth_temporal
from sovana.geo_time.ephemeris import civil_from_epoch_day, epoch_day_from_civil, floor_mod
from sovana.kernel import cast_ziwei_chart
from sovana.kernel.models import ZiweiChartIR, ZiweiSilo

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUT_PATH = REPO_ROOT / "specs" / "classics" / "empirical_rarity_report.json"
TOAN_THU_SPEC_PATH = REPO_ROOT / "specs" / "classics" / "ziwei_toan_thu_cach_cuc.json"
NAM_PHAI_SPEC_PATH = REPO_ROOT / "specs" / "classics" / "nam_phai_phu_co_vn.json"

START_EPOCH_DAY = epoch_day_from_civil(1900, 1, 1)
END_EPOCH_DAY = epoch_day_from_civil(2100, 12, 31)
SPAN_DAYS = END_EPOCH_DAY - START_EPOCH_DAY + 1  # 73,414 days
COPRIME_STRIDE = 49999  # gcd(49999, 73414) == 1

# Minor-star and classical brightness tables (index 0..11 = Tý..Hợi)
# Toan Thu canonical table aligned with zh_ziwei_doushu_quanshu.md (L1358-1538) & MIT SB_QS
TOAN_THU_CLASSICAL_BRIGHTNESS: dict[str, tuple[str, ...]] = {
    "Tham Lang": (
        "Vượng", "Miếu", "Bình", "Lợi", "Miếu", "Hãm",
        "Vượng", "Miếu", "Bình", "Lợi", "Miếu", "Hãm",
    ),
    "Hỏa Tinh": (
        "Hãm", "Đắc", "Miếu", "Lợi", "Hãm", "Đắc",
        "Miếu", "Lợi", "Hãm", "Đắc", "Miếu", "Lợi",
    ),
    "Linh Tinh": (
        "Hãm", "Đắc", "Miếu", "Lợi", "Hãm", "Đắc",
        "Miếu", "Lợi", "Hãm", "Đắc", "Miếu", "Lợi",
    ),
    "Kình Dương": (
        "Hãm", "Miếu", "Bình", "Hãm", "Miếu", "Bình",
        "Hãm", "Miếu", "Bình", "Hãm", "Miếu", "Bình",
    ),
    "Đà La": (
        "Bình", "Miếu", "Hãm", "Bình", "Miếu", "Hãm",
        "Bình", "Miếu", "Hãm", "Bình", "Miếu", "Hãm",
    ),
    "Địa Không": (
        "Bình", "Hãm", "Hãm", "Bình", "Hãm", "Miếu",
        "Miếu", "Bình", "Miếu", "Miếu", "Hãm", "Hãm",
    ),
    "Địa Kiếp": (
        "Hãm", "Hãm", "Bình", "Bình", "Hãm", "Bất",
        "Miếu", "Bình", "Miếu", "Bình", "Bình", "Hãm",
    ),
    "Văn Xương": (
        "Đắc", "Miếu", "Hãm", "Vượng", "Đắc", "Miếu",
        "Hãm", "Lợi", "Đắc", "Miếu", "Hãm", "Lợi",
    ),
    "Văn Khúc": (
        "Đắc", "Miếu", "Bình", "Vượng", "Đắc", "Miếu",
        "Hãm", "Vượng", "Đắc", "Miếu", "Hãm", "Vượng",
    ),
    "Lộc Tồn": (
        "Miếu", "Bình", "Miếu", "Miếu", "Bình", "Miếu",
        "Miếu", "Bình", "Miếu", "Miếu", "Bình", "Miếu",
    ),
    "Thiên Mã": (
        "Bình", "Bình", "Vượng", "Bình", "Bình", "Bình",
        "Bình", "Bình", "Vượng", "Bình", "Bình", "Bình",
    ),
}

# Nam Phái minor-star brightness aligned with MIT engines/lasotuvi-vn/lasotuvi/DiaBan.py
NAM_PHAI_MINOR_BRIGHTNESS: dict[str, tuple[str, ...]] = {
    "Kình Dương": (
        "Hãm", "Đắc", "Hãm", "Hãm", "Đắc", "Hãm",
        "Hãm", "Đắc", "Hãm", "Hãm", "Đắc", "Hãm",
    ),
    "Đà La": (
        "Hãm", "Đắc", "Hãm", "Hãm", "Đắc", "Hãm",
        "Hãm", "Đắc", "Hãm", "Hãm", "Đắc", "Hãm",
    ),
    "Hỏa Tinh": (
        "Hãm", "Hãm", "Đắc", "Đắc", "Đắc", "Đắc",
        "Đắc", "Hãm", "Hãm", "Hãm", "Hãm", "Hãm",
    ),
    "Linh Tinh": (
        "Hãm", "Hãm", "Đắc", "Đắc", "Đắc", "Đắc",
        "Đắc", "Hãm", "Hãm", "Hãm", "Hãm", "Hãm",
    ),
    "Địa Không": (
        "Hãm", "Hãm", "Đắc", "Hãm", "Hãm", "Đắc",
        "Hãm", "Hãm", "Đắc", "Hãm", "Hãm", "Đắc",
    ),
    "Địa Kiếp": (
        "Hãm", "Hãm", "Đắc", "Hãm", "Hãm", "Đắc",
        "Hãm", "Hãm", "Đắc", "Hãm", "Hãm", "Đắc",
    ),
    "Văn Xương": (
        "Hãm", "Đắc", "Hãm", "Đắc", "Hãm", "Đắc",
        "Hãm", "Đắc", "Hãm", "Hãm", "Đắc", "Đắc",
    ),
    "Văn Khúc": (
        "Hãm", "Đắc", "Hãm", "Đắc", "Hãm", "Đắc",
        "Hãm", "Đắc", "Hãm", "Hãm", "Đắc", "Đắc",
    ),
    "Thiên Mã": (
        "Bình", "Bình", "Đắc", "Bình", "Bình", "Đắc",
        "Bình", "Bình", "Bình", "Bình", "Bình", "Bình",
    ),
    "Thiên Hình": (
        "Bình", "Bình", "Đắc", "Đắc", "Bình", "Bình",
        "Bình", "Bình", "Đắc", "Đắc", "Bình", "Bình",
    ),
    "Thiên Riêu": (
        "Bình", "Bình", "Đắc", "Đắc", "Bình", "Bình",
        "Bình", "Bình", "Bình", "Đắc", "Đắc", "Bình",
    ),
}

SHA6_STARS = frozenset({"Kình Dương", "Đà La", "Hỏa Tinh", "Linh Tinh", "Địa Không", "Địa Kiếp"})
SHA4_STARS = ("Kình Dương", "Đà La", "Hỏa Tinh", "Linh Tinh")
JI_STARS = frozenset(
    {
        "Tả Phụ",
        "Hữu Bật",
        "Văn Xương",
        "Văn Khúc",
        "Thiên Khôi",
        "Thiên Việt",
        "Lộc Tồn",
        "Thiên Mã",
    }
)
MU_BRANCHES = frozenset({1, 4, 7, 10})


@dataclass(slots=True)
class ChartIndex:
    """O(1) lookup index over a cast ZiweiChartIR."""

    silo: ZiweiSilo
    y_stem: int
    y_branch: int
    birth_lunar_year: int
    h_branch: int
    menh_branch: int
    than_branch: int
    palace_by_name: dict[str, int]
    stars_at: list[set[str]]
    major_stars_at: list[list[tuple[str, str | None, str | None]]]
    minor_stars_at: list[list[tuple[str, str | None, str | None]]]
    star_branches: dict[str, list[int]]
    tuan_trung: list[bool]
    triet_lo: list[bool]
    tam_khong_at: list[tuple[str, ...]]
    menh_in_thai_tue_tam_hop: bool
    has_full_tu_linh_tam_hop: bool
    has_full_tu_linh_tam_phuong: bool
    dai_han_sorted: list[tuple[int, int, int]]  # (start_age, end_age, branch_index)


def build_chart_index(
    chart: ZiweiChartIR,
    y_stem: int,
    y_branch: int,
    birth_lunar_year: int,
    h_branch: int,
) -> ChartIndex:
    palace_by_name: dict[str, int] = {"Thân": chart.than_branch}
    stars_at: list[set[str]] = [set() for _ in range(12)]
    major_stars_at: list[list[tuple[str, str | None, str | None]]] = [[] for _ in range(12)]
    minor_stars_at: list[list[tuple[str, str | None, str | None]]] = [[] for _ in range(12)]
    star_branches: dict[str, list[int]] = {}
    tuan_trung = [False] * 12
    triet_lo = [False] * 12
    tam_khong_at: list[tuple[str, ...]] = [() for _ in range(12)]
    dai_han_list: list[tuple[int, int, int]] = []

    minor_table = (
        TOAN_THU_CLASSICAL_BRIGHTNESS if chart.silo == "toan-thu" else NAM_PHAI_MINOR_BRIGHTNESS
    )

    for p in chart.palaces:
        b = p.branch_index
        norm_name = "Nô Bộc" if p.palace_name in ("Giao Hữu", "Nô Bộc") else p.palace_name
        palace_by_name[norm_name] = b
        tuan_trung[b] = p.tuan_trung
        triet_lo[b] = p.triet_lo
        tam_khong_at[b] = tuple(p.tam_khong_types)
        dai_han_list.append((p.dai_han_start_age, p.dai_han_end_age, b))

        bucket = stars_at[b]
        for s in p.major_stars:
            bucket.add(s.name)
            star_branches.setdefault(s.name, []).append(b)
            if s.sihua_transform is not None:
                bucket.add(s.sihua_transform)
                star_branches.setdefault(s.sihua_transform, []).append(b)
            major_stars_at[b].append((s.name, s.brightness, s.sihua_transform))

        for s in p.minor_stars:
            bucket.add(s.name)
            star_branches.setdefault(s.name, []).append(b)
            if s.sihua_transform is not None:
                bucket.add(s.sihua_transform)
                star_branches.setdefault(s.sihua_transform, []).append(b)
            eff_br = s.brightness
            if eff_br is None and s.name in minor_table:
                eff_br = minor_table[s.name][b]
            minor_stars_at[b].append((s.name, eff_br, s.sihua_transform))

        for ring_star in (p.thai_tue_star, p.trang_sinh_star, p.bac_sy_star):
            bucket.add(ring_star)
            star_branches.setdefault(ring_star, []).append(b)

    dai_han_list.sort(key=lambda item: item[0])
    return ChartIndex(
        silo=chart.silo,
        y_stem=y_stem,
        y_branch=y_branch,
        birth_lunar_year=birth_lunar_year,
        h_branch=h_branch,
        menh_branch=chart.menh_branch,
        than_branch=chart.than_branch,
        palace_by_name=palace_by_name,
        stars_at=stars_at,
        major_stars_at=major_stars_at,
        minor_stars_at=minor_stars_at,
        star_branches=star_branches,
        tuan_trung=tuan_trung,
        triet_lo=triet_lo,
        tam_khong_at=tam_khong_at,
        menh_in_thai_tue_tam_hop=chart.thai_tue_tam_hop_tu_linh.menh_in_thai_tue_tam_hop,
        has_full_tu_linh_tam_hop=chart.thai_tue_tam_hop_tu_linh.has_full_tu_linh_in_menh_tam_hop,
        has_full_tu_linh_tam_phuong=chart.thai_tue_tam_hop_tu_linh.has_full_tu_linh_in_menh_tam_phuong,
        dai_han_sorted=dai_han_list,
    )


def _normalize_palace_key(name: str) -> str:
    trimmed = name.strip()
    return "Nô Bộc" if trimmed in ("Giao Hữu", "Nô Bộc") else trimmed


def _resolve_palace_branch(idx: ChartIndex, palace_name: str) -> int | None:
    return idx.palace_by_name.get(_normalize_palace_key(palace_name))


def _effective_star_brightness(
    idx: ChartIndex, star_name: str, branch: int, ir_brightness: str | None
) -> str | None:
    if idx.silo == "toan-thu" and star_name in TOAN_THU_CLASSICAL_BRIGHTNESS:
        if ir_brightness is None or star_name == "Tham Lang":
            return TOAN_THU_CLASSICAL_BRIGHTNESS[star_name][branch]
    if ir_brightness is not None:
        return ir_brightness
    table = TOAN_THU_CLASSICAL_BRIGHTNESS if idx.silo == "toan-thu" else NAM_PHAI_MINOR_BRIGHTNESS
    row = table.get(star_name)
    return row[branch] if row is not None else None


def eval_condition_ast(
    cond: Mapping[str, Any],
    idx: ChartIndex,
    use_canonical_quanshu_brightness: bool = False,
) -> bool:
    """Evaluate a ConditionAST node against ChartIndex in O(1)."""
    op = str(cond["op"])

    if op == "star_in_palace":
        b = _resolve_palace_branch(idx, str(cond["palace"]))
        return b is not None and str(cond["star"]) in idx.stars_at[b]

    if op == "star_in_tam_phuong":
        b = _resolve_palace_branch(idx, str(cond["palace"]))
        if b is None:
            return False
        star = str(cond["star"])
        return any(star in idx.stars_at[(b + off) % 12] for off in (0, 4, 8, 6))

    if op == "star_brightness_in":
        star = str(cond["star"])
        levels = set(str(lv) for lv in cond["levels"])
        palace_raw = cond.get("palace")
        if isinstance(palace_raw, str) and palace_raw:
            b = _resolve_palace_branch(idx, palace_raw)
            branches: Sequence[int] = (b,) if b is not None else ()
        else:
            branches = range(12)
        for br in branches:
            for name, ir_br, sihua in idx.major_stars_at[br]:
                if name == star or sihua == star:
                    eff = (
                        _effective_star_brightness(idx, name, br, ir_br)
                        if use_canonical_quanshu_brightness
                        else ir_br
                    )
                    if eff is not None and eff in levels:
                        return True
            for name, ir_br, sihua in idx.minor_stars_at[br]:
                if name == star or sihua == star:
                    eff = (
                        _effective_star_brightness(idx, name, br, ir_br)
                        if use_canonical_quanshu_brightness
                        else ir_br
                    )
                    if eff is not None and eff in levels:
                        return True
        return False

    if op == "sihua_in_palace":
        b = _resolve_palace_branch(idx, str(cond["palace"]))
        return b is not None and str(cond["transform"]) in idx.stars_at[b]

    if op == "palace_has_flag":
        b = _resolve_palace_branch(idx, str(cond["palace"]))
        if b is None:
            return False
        return idx.tuan_trung[b] if cond["flag"] == "tuanTrung" else idx.triet_lo[b]

    if op == "year_stem_in":
        return idx.y_stem in cond["stems"]

    if op == "palace_branch_in":
        b = _resolve_palace_branch(idx, str(cond["palace"]))
        return b is not None and b in cond["branches"]

    if op == "star_in_relative_palace":
        b = _resolve_palace_branch(idx, str(cond["palace"]))
        if b is None:
            return False
        rel = str(cond["relation"])
        if rel == "opposite":
            target_b = (b + 6) % 12
        elif rel == "prev":
            target_b = (b + 11) % 12
        elif rel == "next":
            target_b = (b + 1) % 12
        elif rel == "nhi_hop":
            target_b = (13 - b) % 12
        else:
            raise ValueError(f"Unknown relative palace relation: {rel!r}")
        return str(cond["star"]) in idx.stars_at[target_b]

    if op == "palace_major_count":
        b = _resolve_palace_branch(idx, str(cond["palace"]))
        if b is None:
            return False
        cnt = len(idx.major_stars_at[b])
        if "exact" in cond and cond["exact"] is not None and cnt != int(cond["exact"]):
            return False
        if "min" in cond and cond["min"] is not None and cnt < int(cond["min"]):
            return False
        if "max" in cond and cond["max"] is not None and cnt > int(cond["max"]):
            return False
        return True

    if op == "palace_star_count_in":
        b = _resolve_palace_branch(idx, str(cond["palace"]))
        if b is None:
            return False
        bucket = idx.stars_at[b]
        unique_stars = list(dict.fromkeys(str(s) for s in cond["stars"]))
        cnt = sum(1 for s in unique_stars if s in bucket)
        if cnt < int(cond["min"]):
            return False
        if "max" in cond and cond["max"] is not None and cnt > int(cond["max"]):
            return False
        return True

    if op == "star_co_located":
        stars = [str(s) for s in cond["stars"]]
        palace_raw = cond.get("palace")
        if isinstance(palace_raw, str) and palace_raw:
            b = _resolve_palace_branch(idx, palace_raw)
            return b is not None and all(s in idx.stars_at[b] for s in stars)
        return any(all(s in idx.stars_at[br] for s in stars) for br in range(12))

    if op == "vo_chinh_dieu":
        b = _resolve_palace_branch(idx, str(cond["palace"]))
        if b is None:
            return False
        return (len(idx.major_stars_at[b]) == 0) == bool(cond["value"])

    if op == "tam_khong_in_tam_phuong":
        b = _resolve_palace_branch(idx, str(cond["palace"]))
        if b is None:
            return False
        found = {tok for off in (0, 4, 8, 6) for tok in idx.tam_khong_at[(b + off) % 12]}
        return len(found) >= int(cond["minCount"])

    if op == "thai_tue_tu_linh":
        scope = str(cond["scope"])
        if scope == "tam_hop":
            return idx.menh_in_thai_tue_tam_hop and idx.has_full_tu_linh_tam_hop
        if scope == "tam_phuong":
            return idx.menh_in_thai_tue_tam_hop and idx.has_full_tu_linh_tam_phuong
        raise ValueError(f"Unsupported thai_tue_tu_linh scope: {scope!r}")

    if op == "and":
        return all(
            eval_condition_ast(arg, idx, use_canonical_quanshu_brightness)
            for arg in cond["args"]
        )

    if op == "or":
        return any(
            eval_condition_ast(arg, idx, use_canonical_quanshu_brightness)
            for arg in cond["args"]
        )

    if op == "not":
        return not eval_condition_ast(cond["arg"], idx, use_canonical_quanshu_brightness)

    raise ValueError(f"Unsupported ConditionAST op in classics verifier: {op!r}")


# ─────────── Special & Temporal Evaluators matching MIT patterns-ding*.ts ───────────


def _is_kong(idx: ChartIndex, b: int) -> bool:
    return idx.tuan_trung[b] or idx.triet_lo[b]


def _is_weak_palace(idx: ChartIndex, b: int) -> bool:
    majors = idx.major_stars_at[b]
    return len(majors) == 0 or all(br == "Hãm" for _, br, _ in majors)


def _is_strong_palace(idx: ChartIndex, b: int) -> bool:
    return any(br in ("Miếu", "Vượng") for _, br, _ in idx.major_stars_at[b])


def _ji_count_in(idx: ChartIndex, branches: Sequence[int]) -> int:
    total = 0
    for b in branches:
        bucket = idx.stars_at[b]
        total += sum(1 for s in JI_STARS if s in bucket)
        for _, _, sihua in idx.major_stars_at[b]:
            if sihua in ("Hóa Lộc", "Hóa Quyền", "Hóa Khoa"):
                total += 1
        for _, _, sihua in idx.minor_stars_at[b]:
            if sihua in ("Hóa Lộc", "Hóa Quyền", "Hóa Khoa"):
                total += 1
    return total


def _sha_count_in(idx: ChartIndex, branches: Sequence[int]) -> int:
    total = 0
    for b in branches:
        bucket = idx.stars_at[b]
        total += sum(1 for s in SHA6_STARS if s in bucket)
    return total


def _is_xian_hao(idx: ChartIndex, b: int) -> bool:
    if not _is_strong_palace(idx, b):
        return False
    sf = (b, (b + 4) % 12, (b + 8) % 12, (b + 6) % 12)
    return _ji_count_in(idx, sf) >= 2 and _sha_count_in(idx, sf) <= 1


def _liu_nian_grade(idx: ChartIndex, age: int) -> str:
    b = floor_mod(idx.birth_lunar_year + age - 1 - 4, 12)
    bucket = idx.stars_at[b]
    sha_in_ming = sum(1 for s in SHA6_STARS if s in bucket)
    if "Hóa Kỵ" in bucket or sha_in_ming >= 2:
        return "xiong"
    sf = (b, (b + 4) % 12, (b + 8) % 12, (b + 6) % 12)
    has_lu = any("Lộc Tồn" in idx.stars_at[x] or "Hóa Lộc" in idx.stars_at[x] for x in sf)
    if has_lu or _ji_count_in(idx, sf) >= 2:
        return "ji"
    return "ping"


def _eval_unreachable_literal_probe(eval_key: str, idx: ChartIndex) -> bool:
    """Actually execute the literal impossible condition to empirically confirm 0 hits."""
    if eval_key == "tt_df_01_unreachable":
        for pal_name in ("Mệnh", "Điền Trạch"):
            b = idx.palace_by_name[pal_name]
            if "Thiên Tướng" in idx.stars_at[b]:
                p, n = (b + 11) % 12, (b + 1) % 12
                if (
                    ("Vũ Khúc" in idx.stars_at[p] and "Thiên Lương" in idx.stars_at[n])
                    or ("Thiên Lương" in idx.stars_at[p] and "Vũ Khúc" in idx.stars_at[n])
                ):
                    return True
        return False

    if eval_key == "tt_df_04_unreachable":
        b = idx.than_branch
        sf = (b, (b + 4) % 12, (b + 8) % 12, (b + 6) % 12)
        if idx.palace_by_name["Điền Trạch"] != b:
            return False
        has_luong = any("Thiên Lương" in idx.stars_at[x] for x in sf)
        has_tuong = any("Thiên Tướng" in idx.stars_at[x] for x in sf)
        return has_luong and has_tuong

    if eval_key == "tt_dq_07_unreachable":
        for pal_name in ("Mệnh", "Tài Bạch"):
            b = idx.palace_by_name[pal_name]
            if "Lộc Tồn" in idx.stars_at[b]:
                p, n = (b + 11) % 12, (b + 1) % 12
                if (
                    ("Thiên Lương" in idx.stars_at[p] and "Thiên Tướng" in idx.stars_at[n])
                    or ("Thiên Tướng" in idx.stars_at[p] and "Thiên Lương" in idx.stars_at[n])
                ):
                    return True
        return False

    if eval_key == "tt_dq_10_unreachable":
        return any(
            "Thiên Mã" in idx.stars_at[b] and "Kình Dương" in idx.stars_at[b]
            for b in range(12)
        )

    if eval_key == "tt_dq_21_unreachable":
        b = idx.menh_branch
        p, n = (b + 11) % 12, (b + 1) % 12
        return (
            ("Văn Xương" in idx.stars_at[p] and "Văn Khúc" in idx.stars_at[n])
            or ("Văn Khúc" in idx.stars_at[p] and "Văn Xương" in idx.stars_at[n])
        )

    if eval_key == "tt_dq_27_unreachable":
        b = idx.menh_branch
        if "Tử Vi" not in idx.stars_at[b]:
            return False
        p, n = (b + 11) % 12, (b + 1) % 12
        return (
            ("Thái Dương" in idx.stars_at[p] and "Thái Âm" in idx.stars_at[n])
            or ("Thái Âm" in idx.stars_at[p] and "Thái Dương" in idx.stars_at[n])
        )

    raise ValueError(f"Unknown unreachable key: {eval_key!r}")


def eval_toan_thu_pattern(pattern: Mapping[str, Any], idx: ChartIndex) -> tuple[bool, int]:
    """Return (chart_hit, unit_hits) for a Toàn Thư pattern."""
    status = str(pattern["status"])
    eval_key = str(pattern.get("evaluatorKey", ""))

    if status == "unreachable":
        hit = _eval_unreachable_literal_probe(eval_key, idx)
        return hit, (1 if hit else 0)

    unit = str(pattern["unit"])
    if unit == "chart":
        if eval_key == "tt_dq_17_tham_hoa_tuong_phung":
            b = idx.menh_branch
            if "Tham Lang" not in idx.stars_at[b] or "Hỏa Tinh" not in idx.stars_at[b]:
                return False, 0
            tl_br = _effective_star_brightness(idx, "Tham Lang", b, None)
            ht_br = _effective_star_brightness(idx, "Hỏa Tinh", b, None)
            hit = tl_br in ("Miếu", "Vượng") and ht_br in ("Miếu", "Vượng")
            return hit, (1 if hit else 0)

        if eval_key == "tt_dq_22_quyen_loc_sinh_phung":
            b = idx.menh_branch
            if "Hóa Quyền" not in idx.stars_at[b] or "Hóa Lộc" not in idx.stars_at[b]:
                return False, 0
            all_s = idx.major_stars_at[b] + idx.minor_stars_at[b]
            hua_stars = [
                (name, br) for name, br, sihua in all_s if sihua in ("Hóa Quyền", "Hóa Lộc")
            ]
            hit = len(hua_stars) >= 1 and all(
                _effective_star_brightness(idx, name, b, br) != "Hãm" for name, br in hua_stars
            )
            return hit, (1 if hit else 0)

        if eval_key == "tt_db_07_quan_tu_tai_da":
            b = idx.menh_branch
            bucket = idx.stars_at[b]
            sha_in_m = [n for n in SHA4_STARS if n in bucket]
            if len(sha_in_m) < 2:
                return False, 0
            hit = any(_effective_star_brightness(idx, n, b, None) == "Hãm" for n in sha_in_m)
            return hit, (1 if hit else 0)

        pred = pattern["predicate"]
        hit = eval_condition_ast(pred, idx, use_canonical_quanshu_brightness=True)
        return hit, (1 if hit else 0)

    # Định Tạp Cục (dai_han / luu_nien)
    dxs = idx.dai_han_sorted
    if eval_key == "tt_dt_01_phong_van_te_hoi":
        if not (_is_weak_palace(idx, idx.menh_branch) and _is_weak_palace(idx, idx.than_branch)):
            return False, 0
        hits = 0
        for _, _, b in dxs:
            sf = (b, (b + 4) % 12, (b + 8) % 12, (b + 6) % 12)
            has_lu = any("Lộc Tồn" in idx.stars_at[x] or "Hóa Lộc" in idx.stars_at[x] for x in sf)
            has_ma = any("Thiên Mã" in idx.stars_at[x] for x in sf)
            if has_lu and has_ma:
                hits += 1
        return hits > 0, hits

    if eval_key == "tt_dt_02_cam_thuong_thiem_hoa":
        hits = 0
        for _, _, b in dxs:
            if any(s in idx.stars_at[b] for s in SHA6_STARS) and _is_xian_hao(idx, b):
                hits += 1
        return hits > 0, hits

    if eval_key == "tt_dt_03_loc_suy_ma_khon":
        loc_bs = idx.star_branches.get("Lộc Tồn", ())
        ma_bs = idx.star_branches.get("Thiên Mã", ())
        if not (loc_bs and ma_bs):
            return False, 0
        if not (all(_is_kong(idx, x) for x in loc_bs) and all(_is_kong(idx, x) for x in ma_bs)):
            return False, 0
        hits = 0
        for _, _, b in dxs:
            sf = (b, (b + 4) % 12, (b + 8) % 12, (b + 6) % 12)
            if any("Thất Sát" in idx.stars_at[x] for x in sf):
                hits += 1
        return hits > 0, hits

    if eval_key == "tt_dt_04_y_cam_hoan_huong":
        hits = sum(1 for sa, _, b in dxs if sa >= 40 and b in MU_BRANCHES)
        return hits > 0, hits

    if eval_key == "tt_dt_05_bo_so_vo_y":
        hits = 0
        for i in range(1, len(dxs)):
            if _is_weak_palace(idx, dxs[i - 1][2]) and _is_weak_palace(idx, dxs[i][2]):
                hits += 1
        return hits > 0, hits

    if eval_key == "tt_dt_06_thuy_thuong_gia_tinh":
        last_age = dxs[-1][1] if dxs else 100
        hits = 0
        prev_grade = _liu_nian_grade(idx, 1)
        for age in range(1, last_age):
            next_grade = _liu_nian_grade(idx, age + 1)
            if (prev_grade == "ji" and next_grade == "xiong") or (
                prev_grade == "xiong" and next_grade == "ji"
            ):
                hits += 1
            prev_grade = next_grade
        return hits > 0, hits

    if eval_key == "tt_dt_07_cat_hung_tuong_ban":
        if len(idx.major_stars_at[idx.menh_branch]) == 0:
            return False, 0
        hits = sum(1 for _, _, b in dxs if _is_xian_hao(idx, b))
        return hits > 0, hits

    if eval_key == "tt_dt_08_kho_moc_phung_xuan":
        if not _is_weak_palace(idx, idx.menh_branch):
            return False, 0
        hits = sum(1 for _, _, b in dxs if _is_xian_hao(idx, b))
        return hits > 0, hits

    raise ValueError(f"Unknown Định Tạp Cục evaluatorKey: {eval_key!r}")


def eval_nam_phai_pattern(pattern: Mapping[str, Any], idx: ChartIndex) -> bool:
    """Evaluate a Nam Phái pattern using its full classical predicate."""
    pred = pattern.get("predicate")
    if pred is None:
        return False
    return eval_condition_ast(pred, idx, use_canonical_quanshu_brightness=True)


# ─────────── Worker & Aggregation ───────────

_WORKER_STATE: dict[str, Any] = {}


def _init_worker(tt_spec: dict[str, Any], np_spec: dict[str, Any]) -> None:
    _WORKER_STATE["tt_patterns"] = tt_spec["patterns"]
    _WORKER_STATE["tt_verses"] = tt_spec["keyVerses"]
    _WORKER_STATE["np_patterns"] = np_spec["patterns"]


def _process_chunk(args: tuple[int, int]) -> dict[str, Any]:
    start_idx, end_idx = args
    tt_patterns = _WORKER_STATE["tt_patterns"]
    tt_verses = _WORKER_STATE["tt_verses"]
    np_patterns = _WORKER_STATE["np_patterns"]

    silos: tuple[ZiweiSilo, ZiweiSilo] = ("nam-phai", "toan-thu")
    tt_hits: dict[str, list[int]] = {
        silo: [0] * len(tt_patterns) for silo in silos
    }
    tt_unit_hits: dict[str, list[int]] = {
        silo: [0] * len(tt_patterns) for silo in silos
    }
    tt_samples: dict[str, list[dict[str, Any] | None]] = {
        silo: [None] * len(tt_patterns) for silo in silos
    }
    verse_hits: dict[str, list[int]] = {
        silo: [0] * len(tt_verses) for silo in silos
    }
    verse_samples: dict[str, list[dict[str, Any] | None]] = {
        silo: [None] * len(tt_verses) for silo in silos
    }
    np_hits: dict[str, list[int]] = {
        silo: [0] * len(np_patterns) for silo in silos
    }
    np_samples: dict[str, list[dict[str, Any] | None]] = {
        silo: [None] * len(np_patterns) for silo in silos
    }
    strict_3ham_hits: dict[str, int] = {silo: 0 for silo in silos}

    # 7 Mathematical Structural Invariant trackers per silo
    inv_tuong_luong: dict[str, set[int]] = {s: set() for s in silos}
    inv_vu_tuong: dict[str, set[int]] = {s: set() for s in silos}
    inv_xuong_khuc: dict[str, set[int]] = {s: set() for s in silos}
    inv_tu_vi_duong: dict[str, set[int]] = {s: set() for s in silos}
    inv_ma_kinh: dict[str, set[int]] = {s: set() for s in silos}
    inv_liem_vu: dict[str, set[int]] = {s: set() for s in silos}
    inv_khong_kiep_hours: dict[str, set[int]] = {s: set() for s in silos}
    inv_khong_kiep_mismatch: dict[str, int] = {s: 0 for s in silos}

    for i in range(start_idx, end_idx):
        ed = START_EPOCH_DAY + ((i * COPRIME_STRIDE) % SPAN_DAYS)
        y, m, d = civil_from_epoch_day(ed)
        h_branch = (i * 7 + (i // 12)) % 12
        gender: str = "male" if (i % 2 == 0) else "female"

        temporal = normalize_birth_temporal(
            year=y,
            month=m,
            day=d,
            hour=h_branch * 2,
            minute=30,
            location="Hà Nội",
            calendar_mode="VN_UTC7",
        )
        y_stem = temporal.pillars.lunar_year_pillar.stem_index
        y_branch = temporal.pillars.lunar_year_pillar.branch_index
        lunar_year = temporal.lunar_active.lunar_year
        tst_h = temporal.true_solar_time.shichen_branch
        sample_rec = {
            "year": y,
            "month": m,
            "day": d,
            "hourBranch": tst_h,
            "gender": gender,
        }

        for silo in silos:
            chart = cast_ziwei_chart(temporal, gender, silo)  # type: ignore[arg-type]
            idx = build_chart_index(chart, y_stem, y_branch, lunar_year, tst_h)

            # Record 7 structural invariants
            b_tuong = idx.star_branches["Thiên Tướng"][0]
            b_luong = idx.star_branches["Thiên Lương"][0]
            b_vu = idx.star_branches["Vũ Khúc"][0]
            b_xuong = idx.star_branches["Văn Xương"][0]
            b_khuc = idx.star_branches["Văn Khúc"][0]
            b_tu_vi = idx.star_branches["Tử Vi"][0]
            b_duong = idx.star_branches["Thái Dương"][0]
            b_ma = idx.star_branches["Thiên Mã"][0]
            b_kinh = idx.star_branches["Kình Dương"][0]
            b_liem = idx.star_branches["Liêm Trinh"][0]
            b_dk = idx.star_branches["Địa Không"][0]
            b_dj = idx.star_branches["Địa Kiếp"][0]

            inv_tuong_luong[silo].add((b_luong - b_tuong) % 12)
            inv_vu_tuong[silo].add((b_tuong - b_vu) % 12)
            inv_xuong_khuc[silo].add((b_khuc - b_xuong) % 12)
            inv_tu_vi_duong[silo].add((b_duong - b_tu_vi) % 12)
            inv_ma_kinh[silo].add((b_kinh - b_ma) % 12)
            inv_liem_vu[silo].add((b_vu - b_liem) % 12)
            same_kj = b_dk == b_dj
            if same_kj:
                inv_khong_kiep_hours[silo].add(tst_h)
            if same_kj != (tst_h in (0, 6)):
                inv_khong_kiep_mismatch[silo] += 1

            # Strict 3-Hãm probe for TT-DB-04 (Nhật Nguyệt Tàng Huy)
            b_am = idx.star_branches["Thái Âm"][0]
            b_cu = idx.star_branches["Cự Môn"][0]
            sun_ham = any(
                n == "Thái Dương" and br == "Hãm" for n, br, _ in idx.major_stars_at[b_duong]
            )
            moon_ham = any(
                n == "Thái Âm" and br == "Hãm" for n, br, _ in idx.major_stars_at[b_am]
            )
            cu_ham = any(
                n == "Cự Môn" and br == "Hãm" for n, br, _ in idx.major_stars_at[b_cu]
            )
            sf_m = {
                idx.menh_branch,
                (idx.menh_branch + 4) % 12,
                (idx.menh_branch + 8) % 12,
                (idx.menh_branch + 6) % 12,
            }
            if sun_ham and moon_ham and cu_ham and b_cu in sf_m:
                strict_3ham_hits[silo] += 1

            for j, pat in enumerate(tt_patterns):
                c_hit, u_hits = eval_toan_thu_pattern(pat, idx)
                if c_hit:
                    tt_hits[silo][j] += 1
                    if tt_samples[silo][j] is None:
                        tt_samples[silo][j] = sample_rec
                if u_hits:
                    tt_unit_hits[silo][j] += u_hits

            for j, verse in enumerate(tt_verses):
                if eval_condition_ast(
                    verse["predicate"], idx, use_canonical_quanshu_brightness=True
                ):
                    verse_hits[silo][j] += 1
                    if verse_samples[silo][j] is None:
                        verse_samples[silo][j] = sample_rec

            for j, pat in enumerate(np_patterns):
                if eval_nam_phai_pattern(pat, idx):
                    np_hits[silo][j] += 1
                    if np_samples[silo][j] is None:
                        np_samples[silo][j] = sample_rec

    return {
        "tt_hits": tt_hits,
        "tt_unit_hits": tt_unit_hits,
        "tt_samples": tt_samples,
        "verse_hits": verse_hits,
        "verse_samples": verse_samples,
        "np_hits": np_hits,
        "np_samples": np_samples,
        "strict_3ham_hits": strict_3ham_hits,
        "inv": {
            "tuong_luong": inv_tuong_luong,
            "vu_tuong": inv_vu_tuong,
            "xuong_khuc": inv_xuong_khuc,
            "tu_vi_duong": inv_tu_vi_duong,
            "ma_kinh": inv_ma_kinh,
            "liem_vu": inv_liem_vu,
            "khong_kiep_hours": inv_khong_kiep_hours,
            "khong_kiep_mismatch": inv_khong_kiep_mismatch,
        },
    }


def _merge_partials(
    partials: list[dict[str, Any]], tt_n: int, v_n: int, np_n: int
) -> dict[str, Any]:
    silos: tuple[ZiweiSilo, ZiweiSilo] = ("nam-phai", "toan-thu")
    merged: dict[str, Any] = {
        "tt_hits": {s: [0] * tt_n for s in silos},
        "tt_unit_hits": {s: [0] * tt_n for s in silos},
        "tt_samples": {s: [None] * tt_n for s in silos},
        "verse_hits": {s: [0] * v_n for s in silos},
        "verse_samples": {s: [None] * v_n for s in silos},
        "np_hits": {s: [0] * np_n for s in silos},
        "np_samples": {s: [None] * np_n for s in silos},
        "strict_3ham_hits": {s: 0 for s in silos},
        "inv": {
            "tuong_luong": {s: set() for s in silos},
            "vu_tuong": {s: set() for s in silos},
            "xuong_khuc": {s: set() for s in silos},
            "tu_vi_duong": {s: set() for s in silos},
            "ma_kinh": {s: set() for s in silos},
            "liem_vu": {s: set() for s in silos},
            "khong_kiep_hours": {s: set() for s in silos},
            "khong_kiep_mismatch": {s: 0 for s in silos},
        },
    }

    for part in partials:
        for s in silos:
            merged["strict_3ham_hits"][s] += part["strict_3ham_hits"][s]
            for j in range(tt_n):
                merged["tt_hits"][s][j] += part["tt_hits"][s][j]
                merged["tt_unit_hits"][s][j] += part["tt_unit_hits"][s][j]
                if merged["tt_samples"][s][j] is None and part["tt_samples"][s][j] is not None:
                    merged["tt_samples"][s][j] = part["tt_samples"][s][j]
            for j in range(v_n):
                merged["verse_hits"][s][j] += part["verse_hits"][s][j]
                if (
                    merged["verse_samples"][s][j] is None
                    and part["verse_samples"][s][j] is not None
                ):
                    merged["verse_samples"][s][j] = part["verse_samples"][s][j]
            for j in range(np_n):
                merged["np_hits"][s][j] += part["np_hits"][s][j]
                if merged["np_samples"][s][j] is None and part["np_samples"][s][j] is not None:
                    merged["np_samples"][s][j] = part["np_samples"][s][j]
            for k in (
                "tuong_luong",
                "vu_tuong",
                "xuong_khuc",
                "tu_vi_duong",
                "ma_kinh",
                "liem_vu",
                "khong_kiep_hours",
            ):
                merged["inv"][k][s].update(part["inv"][k][s])
            merged["inv"]["khong_kiep_mismatch"][s] += part["inv"]["khong_kiep_mismatch"][s]
    return merged


def run_verification(count: int = 100_000, workers: int | None = None) -> dict[str, Any]:
    if count <= 0:
        raise ValueError(f"count must be positive; got {count}")

    t0 = time.perf_counter()
    tt_spec = json.loads(TOAN_THU_SPEC_PATH.read_text(encoding="utf-8"))
    np_spec = json.loads(NAM_PHAI_SPEC_PATH.read_text(encoding="utf-8"))

    tt_patterns = tt_spec["patterns"]
    tt_verses = tt_spec["keyVerses"]
    np_patterns = np_spec["patterns"]

    effective_workers = workers if workers is not None else min(os.cpu_count() or 4, 8)
    if count < 500 or effective_workers <= 1:
        _init_worker(tt_spec, np_spec)
        partials = [_process_chunk((0, count))]
        effective_workers = 1
    else:
        chunk_size = math.ceil(count / effective_workers)
        ranges = [
            (s, min(count, s + chunk_size))
            for s in range(0, count, chunk_size)
        ]
        with ProcessPoolExecutor(
            max_workers=effective_workers,
            initializer=_init_worker,
            initargs=(tt_spec, np_spec),
        ) as pool:
            partials = list(pool.map(_process_chunk, ranges))

    merged = _merge_partials(partials, len(tt_patterns), len(tt_verses), len(np_patterns))
    elapsed = round(time.perf_counter() - t0, 3)

    silos: tuple[ZiweiSilo, ZiweiSilo] = ("nam-phai", "toan-thu")
    inv_raw = merged["inv"]

    structural_invariants: list[dict[str, Any]] = []
    invariant_specs = [
        (
            "INV-01",
            "delta(Thiên Tướng -> Thiên Lương) == {1}",
            "Proves #1 Tài Ấm Giáp Ấn, #4 Ấm Ấn Củng Thân, #13 Tài Ấn Giáp Lộc unreachable",
            lambda s: sorted(inv_raw["tuong_luong"][s]) == [1],
            lambda s: sorted(inv_raw["tuong_luong"][s]),
        ),
        (
            "INV-02",
            "delta(Vũ Khúc -> Thiên Tướng) subset {0, 2, 4, 6, 8, 10}",
            "Proves #1 Tài Ấm Giáp Ấn unreachable (Vũ Khúc never ±1 adjacent to Thiên Tướng)",
            lambda s: inv_raw["vu_tuong"][s].issubset({0, 2, 4, 6, 8, 10})
            and len(inv_raw["vu_tuong"][s]) > 0,
            lambda s: sorted(inv_raw["vu_tuong"][s]),
        ),
        (
            "INV-03",
            "delta(Văn Xương -> Văn Khúc) subset {0, 2, 4, 6, 8, 10}",
            (
                "Proves Xương-Khúc separation is strictly even (never ±1 adjacent; "
                "±1 flanking = delta 2 IS reachable for TT-DQ-21, correcting "
                "MIT patterns-dinggui.ts:392)"
            ),
            lambda s: inv_raw["xuong_khuc"][s].issubset({0, 2, 4, 6, 8, 10})
            and len(inv_raw["xuong_khuc"][s]) > 0,
            lambda s: sorted(inv_raw["xuong_khuc"][s]),
        ),
        (
            "INV-04",
            "delta(Tử Vi -> Thái Dương) == {9}",
            "Proves #33 Kim Dư Phù Giá unreachable (Thái Dương never ±1 adjacent to Tử Vi)",
            lambda s: sorted(inv_raw["tu_vi_duong"][s]) == [9],
            lambda s: sorted(inv_raw["tu_vi_duong"][s]),
        ),
        (
            "INV-05",
            "0 not in delta(Thiên Mã -> Kình Dương)",
            "Proves #16 Mã Đầu Đới Kiếm (Toàn Thư literal Thiên Mã+Kình Dương) unreachable",
            lambda s: 0 not in inv_raw["ma_kinh"][s] and len(inv_raw["ma_kinh"][s]) > 0,
            lambda s: sorted(inv_raw["ma_kinh"][s]),
        ),
        (
            "INV-06",
            "delta(Liêm Trinh -> Vũ Khúc) == {4}",
            "Proves #38 Tài Dữ Tù Cừu cannot co-locate; splits Mệnh & Thân",
            lambda s: sorted(inv_raw["liem_vu"][s]) == [4],
            lambda s: sorted(inv_raw["liem_vu"][s]),
        ),
        (
            "INV-07",
            "Địa Không == Địa Kiếp iff h_branch in {0, 6}",
            "Proves #35 Lộc Phùng Lưỡng Sát shichen-restricted rarity (Tý/Ngọ only)",
            lambda s: inv_raw["khong_kiep_mismatch"][s] == 0
            and sorted(inv_raw["khong_kiep_hours"][s]) == [0, 6],
            lambda s: {
                "coLocatedHours": sorted(inv_raw["khong_kiep_hours"][s]),
                "mismatches": inv_raw["khong_kiep_mismatch"][s],
            },
        ),
    ]

    for inv_id, formula, implies, check_fn, obs_fn in invariant_specs:
        per_silo = {
            s: {"passed": bool(check_fn(s)), "observed": obs_fn(s)}
            for s in silos
        }
        structural_invariants.append({
            "id": inv_id,
            "formula": formula,
            "implies": implies,
            "passed": all(v["passed"] for v in per_silo.values()),
            "bySilo": per_silo,
        })

    def _stats_entry(hits: int, sample: dict[str, Any] | None) -> dict[str, Any]:
        return {
            "hitCount": hits,
            "frequencyBps": round(hits * 10_000 / count),
            "rarityPct": round(hits * 100.0 / count, 4),
            "sampleBirth": sample,
        }

    toan_thu_report = []
    unreachable_failures: list[str] = []
    for j, pat in enumerate(tt_patterns):
        unit = str(pat["unit"])
        denom_units = (
            count * 12 if unit == "dai_han" else (count * 99 if unit == "luu_nien" else count)
        )
        by_silo: dict[str, Any] = {}
        for s in silos:
            entry = _stats_entry(merged["tt_hits"][s][j], merged["tt_samples"][s][j])
            if unit in ("dai_han", "luu_nien"):
                uh = merged["tt_unit_hits"][s][j]
                entry["unitHitCount"] = uh
                entry["unitRarityPct"] = round(uh * 100.0 / denom_units, 4)
            if pat["id"] == "TT-DB-04":
                entry["strict3HamHitCount"] = merged["strict_3ham_hits"][s]
            by_silo[s] = entry
        if pat["status"] == "unreachable" and by_silo["toan-thu"]["hitCount"] != 0:
            unreachable_failures.append(pat["id"])
        toan_thu_report.append({
            "id": pat["id"],
            "no": pat["no"],
            "group": pat["group"],
            "name": pat["nameVi"],
            "nameZh": pat["nameZh"],
            "status": pat["status"],
            "unit": unit,
            "bySilo": by_silo,
        })

    key_verses_report = []
    for j, verse in enumerate(tt_verses):
        key_verses_report.append({
            "id": verse["id"],
            "group": verse["group"],
            "name": verse["nameVi"],
            "status": verse["status"],
            "bySilo": {
                s: _stats_entry(merged["verse_hits"][s][j], merged["verse_samples"][s][j])
                for s in silos
            },
        })

    nam_phai_report = []
    for j, pat in enumerate(np_patterns):
        m3_stars = pat.get("requiresM3Stars") or []
        nam_phai_report.append({
            "id": pat["id"],
            "name": pat["nameVi"],
            "status": pat["status"],
            "requiresM3Stars": m3_stars,
            "m3Pending": False,
            "evaluatedScope": "full",
            "bySilo": {
                s: _stats_entry(merged["np_hits"][s][j], merged["np_samples"][s][j])
                for s in silos
            },
        })

    all_invariants_passed = all(inv["passed"] for inv in structural_invariants)
    unreachable_all_zero = len(unreachable_failures) == 0

    return {
        "schemaVersion": "1.0.0",
        "totalCharts": count,
        "dateRange": "1900-01-01..2100-12-31",
        "calendarDaysSpan": SPAN_DAYS,
        "coprimeStride": COPRIME_STRIDE,
        "silos": list(silos),
        "workersUsed": effective_workers,
        "elapsedSeconds": elapsed,
        "notes": {
            "minorStarBrightness": (
                "cast_ziwei_chart populates minorStarBrightnessByBranch on minorStars from "
                "specs/axioms/{nam-phai,toan-thu}.json; verifier uses Toàn Thư L1358-1538 / SB_QS "
                "canonical brightness for Tham Lang (Miếu at Sửu/Thìn/Mùi/Tuất, Vượng at Tý/Ngọ "
                "for TT-DQ-17)."
            ),
            "m3PendingPatterns": [],
        },
        "allPassed": all_invariants_passed and unreachable_all_zero,
        "unreachableAllZero": unreachable_all_zero,
        "unreachableFailures": unreachable_failures,
        "structuralInvariants": structural_invariants,
        "toanThu49": toan_thu_report,
        "toanThuKeyVerses": key_verses_report,
        "namPhaiPatterns": nam_phai_report,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify classical Ziwei patterns across real 1900-2100 charts."
    )
    parser.add_argument("--count", type=int, default=100_000, help="Number of charts to sample")
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT_PATH,
        help="Output path for empirical_rarity_report.json",
    )
    parser.add_argument(
        "--workers", type=int, default=None, help="ProcessPoolExecutor worker count"
    )
    args = parser.parse_args(argv)

    report = run_verification(count=args.count, workers=args.workers)
    out_path: Path = args.out
    if not out_path.is_absolute():
        out_path = REPO_ROOT / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        f"Verified {report['totalCharts']} dual-silo charts in {report['elapsedSeconds']}s "
        f"(workers={report['workersUsed']}): allPassed={report['allPassed']}, "
        f"unreachableAllZero={report['unreachableAllZero']}"
    )
    if not report["allPassed"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
