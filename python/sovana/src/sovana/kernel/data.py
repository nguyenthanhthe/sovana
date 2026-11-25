"""Axiom specification loaders (packaged wheel data or monorepo specs/axioms/)."""

from __future__ import annotations

import json
import pathlib
import re
from functools import lru_cache
from typing import Any, cast

from sovana.kernel.models import (
    BaziAxiomSpec,
    CucNumber,
    DieuHauEntrySpec,
    HiddenStemSpec,
    LiuyaoAxiomSpec,
    LiuyaoHexagramSpec,
    NapAmEntrySpec,
    ZiweiAxiomSpec,
    ZiweiSilo,
)

_PKG_DIR = pathlib.Path(__file__).resolve().parent

_DEFAULT_TRANG_SINH_START: dict[str, int] = {
    "2": 8,
    "3": 11,
    "4": 5,
    "5": 8,
    "6": 2,
}

_ELEMENTS_BY_INDEX = ("Mộc", "Hỏa", "Thổ", "Kim", "Thủy")

_TRIGRAM_BITS3_BY_NAME: dict[str, int] = {
    "Khôn": 0,
    "Chấn": 1,
    "Khảm": 2,
    "Đoài": 3,
    "Cấn": 4,
    "Ly": 5,
    "Tốn": 6,
    "Càn": 7,
}


def _resolve_axiom_path(file_name: str) -> pathlib.Path:
    local_path = _PKG_DIR / "data" / file_name
    if local_path.exists():
        return local_path
    for parent in _PKG_DIR.parents:
        candidate = parent / "specs" / "axioms" / file_name
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        f"SOVANA axiom file not found at '{local_path}' or any parent specs/axioms/"
    )


def _normalize_ziwei_axiom(raw: dict[str, Any], expected_silo: ZiweiSilo) -> ZiweiAxiomSpec:
    raw_ts = raw.get("trangSinhRing")
    trang_sinh_stages: list[str] = []
    trang_sinh_start_by_cuc: dict[str, int] = dict(_DEFAULT_TRANG_SINH_START)

    if isinstance(raw_ts, list):
        trang_sinh_stages = [str(x) for x in raw_ts]
        ext_start = raw.get("trangSinhStartByCuc") or raw.get("startBranchByCuc")
        if isinstance(ext_start, dict):
            for k, v in ext_start.items():
                trang_sinh_start_by_cuc[str(k)] = int(v)
    elif isinstance(raw_ts, dict):
        stages_candidate = (
            raw_ts.get("stages")
            or raw_ts.get("names")
            or raw_ts.get("ring")
            or raw_ts.get("stars")
        )
        if isinstance(stages_candidate, list):
            trang_sinh_stages = [str(x) for x in stages_candidate]
        start_candidate = (
            raw_ts.get("startBranchByCuc")
            or raw_ts.get("startByCuc")
            or raw_ts.get("cucStartBranch")
            or raw.get("trangSinhStartByCuc")
        )
        if isinstance(start_candidate, dict):
            for k, v in start_candidate.items():
                trang_sinh_start_by_cuc[str(k)] = int(v)

    raw_khoi_viet = raw["thienKhoiVietByStem"]
    thien_khoi_viet: list[tuple[int, int]] = []
    for entry in raw_khoi_viet:
        if isinstance(entry, list):
            thien_khoi_viet.append((int(entry[0]), int(entry[1])))
        else:
            khoi_val = entry.get("khoi", entry.get("thienKhoi"))
            viet_val = entry.get("viet", entry.get("thienViet"))
            thien_khoi_viet.append((int(khoi_val), int(viet_val)))

    raw_triet: dict[str, Any] = raw["trietByStemPair"]
    triet_by_stem_pair: dict[str, tuple[int, int]] = {}
    for k, v in raw_triet.items():
        first_part = re.split(r"[/,]", str(k))[0].strip()
        triet_by_stem_pair[str(int(first_part) % 5)] = (int(v[0]), int(v[1]))

    sihua_by_stem: dict[str, tuple[str, str, str, str]] = {}
    for k, v in raw["sihuaByStem"].items():
        sihua_by_stem[str(k)] = (str(v[0]), str(v[1]), str(v[2]), str(v[3]))

    major_brightness: dict[str, tuple[str, ...]] = {
        str(star): tuple(str(lvl) for lvl in row)
        for star, row in raw["majorStarBrightnessByBranch"].items()
    }

    raw_minor_br = raw.get("minorStarBrightnessByBranch") or {}
    minor_brightness: dict[str, tuple[str | None, ...]] = {
        str(star): tuple(None if (lvl is None or lvl == "") else str(lvl) for lvl in row)
        for star, row in raw_minor_br.items()
    }

    silo_val = cast(ZiweiSilo, raw.get("siloId") or expected_silo)
    return ZiweiAxiomSpec(
        silo_id=silo_val,
        name_vi=str(raw["nameVi"]),
        palace_order_counter_clockwise=tuple(str(x) for x in raw["palaceOrderCounterClockwise"]),
        sihua_by_stem=sihua_by_stem,
        brightness_levels=tuple(str(x) for x in raw["brightnessLevels"]),
        major_star_brightness_by_branch=major_brightness,
        minor_star_brightness_by_branch=minor_brightness,
        thai_tue_ring=tuple(str(x) for x in raw["thaiTueRing"]),
        trang_sinh_stages=tuple(trang_sinh_stages),
        trang_sinh_start_by_cuc=trang_sinh_start_by_cuc,
        bac_sy_ring=tuple(str(x) for x in raw["bacSyRing"]),
        loc_ton_by_stem=tuple(int(x) for x in raw["locTonByStem"]),
        thien_khoi_viet_by_stem=tuple(thien_khoi_viet),
        menh_chu_by_branch=tuple(str(x) for x in raw["menhChuByBranch"]),
        than_chu_by_branch=tuple(str(x) for x in raw["thanChuByBranch"]),
        triet_by_stem_pair=triet_by_stem_pair,
    )


def _normalize_bazi_axiom(raw: dict[str, Any]) -> BaziAxiomSpec:
    raw_hidden = raw["hiddenStemsByBranch"]
    hidden_stems_by_branch: dict[str, tuple[HiddenStemSpec, ...]] = {}
    if isinstance(raw_hidden, list):
        for i, entries in enumerate(raw_hidden):
            hidden_stems_by_branch[str(i)] = tuple(
                HiddenStemSpec(stem_index=int(e["stemIndex"]), weight_bps=int(e["weightBps"]))
                for e in entries
            )
    else:
        for k, entries in raw_hidden.items():
            hidden_stems_by_branch[str(k)] = tuple(
                HiddenStemSpec(stem_index=int(e["stemIndex"]), weight_bps=int(e["weightBps"]))
                for e in entries
            )

    raw_seasonal = raw["seasonalMultiplierBps"]
    seasonal_multiplier_bps: dict[str, tuple[int, ...]] = {}
    if isinstance(raw_seasonal, list):
        for i, elem_name in enumerate(_ELEMENTS_BY_INDEX):
            seasonal_multiplier_bps[elem_name] = tuple(int(x) for x in raw_seasonal[i])
    else:
        for k, row in raw_seasonal.items():
            key_str = str(k)
            if key_str.isdigit() and 0 <= int(key_str) < 5:
                seasonal_multiplier_bps[_ELEMENTS_BY_INDEX[int(key_str)]] = tuple(
                    int(x) for x in row
                )
            else:
                seasonal_multiplier_bps[key_str] = tuple(int(x) for x in row)

    raw_dieu_hau = raw["cungThongBaoGiamDieuHau"]
    cung_thong: dict[str, dict[str, DieuHauEntrySpec]] = {}
    for s in range(10):
        s_key = str(s)
        cung_thong[s_key] = {}
        row = raw_dieu_hau[s] if isinstance(raw_dieu_hau, list) else raw_dieu_hau.get(s_key)
        if isinstance(row, list):
            for b in range(12):
                val = row[b]
                cung_thong[s_key][str(b)] = DieuHauEntrySpec(
                    primary_god_stem_indices=tuple(int(x) for x in val["primaryGodStemIndices"]),
                    summary_vi=str(val["summaryVi"]),
                )
        elif isinstance(row, dict):
            for b_key, val in row.items():
                cung_thong[s_key][str(b_key)] = DieuHauEntrySpec(
                    primary_god_stem_indices=tuple(int(x) for x in val["primaryGodStemIndices"]),
                    summary_vi=str(val["summaryVi"]),
                )

    nap_am60 = tuple(
        NapAmEntrySpec(
            index=int(item["index"]),
            can_chi_vi=str(item["canChiVi"]),
            nap_am_vi=str(item["napAmVi"]),
            element_vi=str(item["elementVi"]),
            cuc_number=cast(CucNumber, int(item["cucNumber"])),
        )
        for item in raw["napAm60"]
    )

    return BaziAxiomSpec(
        hidden_stems_by_branch=hidden_stems_by_branch,
        ten_gods_names_vi=tuple(str(x) for x in raw["tenGodsNamesVi"]),
        nap_am60=nap_am60,
        seasonal_multiplier_bps=seasonal_multiplier_bps,
        cung_thong_bao_giam_dieu_hau=cung_thong,
    )


def _format_lsb6(bits_index: int) -> str:
    return "".join(str((bits_index >> i) & 1) for i in range(6))


def _parse_bits_from_code(
    code: str | int,
    fallback_idx: int | None = None,
) -> tuple[int, str]:
    if isinstance(code, int) and not isinstance(code, bool):
        return code, _format_lsb6(code)
    trimmed = str(code).strip()
    if re.fullmatch(r"[01]{6}", trimmed):
        if fallback_idx is not None and 0 <= fallback_idx < 64:
            return fallback_idx, _format_lsb6(fallback_idx)
        lsb_val = 0
        for i, ch in enumerate(trimmed):
            if ch == "1":
                lsb_val |= 1 << i
        return lsb_val, trimmed
    parsed = int(trimmed)
    if 0 <= parsed < 64:
        return parsed, _format_lsb6(parsed)
    raise ValueError(f"Invalid hexagram code6bit: {code!r}")


def _normalize_liuyao_axiom(raw: dict[str, Any]) -> LiuyaoAxiomSpec:
    hex_source = raw.get("hexagrams") or raw.get("hexagramsByCode") or raw.get("hexagrams64")
    if hex_source is None:
        raise ValueError("Missing hexagrams collection in liuyao.json")

    raw_entries: list[tuple[str | int, dict[str, Any]]]
    if isinstance(hex_source, list):
        raw_entries = [(idx, item) for idx, item in enumerate(hex_source)]
    else:
        raw_entries = list(hex_source.items())

    by_bits: list[LiuyaoHexagramSpec | None] = [None] * 64
    for key, item in raw_entries:
        lower_name = str(item.get("lowerTrigram", ""))
        upper_name = str(item.get("upperTrigram", ""))
        lower_bits = _TRIGRAM_BITS3_BY_NAME.get(lower_name)
        upper_bits = _TRIGRAM_BITS3_BY_NAME.get(upper_name)
        trigram_derived_bits = (
            (lower_bits | (upper_bits << 3))
            if lower_bits is not None and upper_bits is not None
            else None
        )

        explicit_int: int | None
        if isinstance(item.get("linesBitsInt"), int):
            explicit_int = int(item["linesBitsInt"])
        elif isinstance(item.get("bitsIndex"), int):
            explicit_int = int(item["bitsIndex"])
        else:
            explicit_int = trigram_derived_bits

        raw_code = item.get("code6bit")
        code_arg: str | int = raw_code if raw_code is not None else key
        bits_index, code6bit = _parse_bits_from_code(code_arg, explicit_int)

        by_bits[bits_index] = LiuyaoHexagramSpec(
            bits_index=bits_index,
            code6bit=code6bit,
            king_wen_number=int(item["kingWenNumber"]),
            name_vi=str(item["nameVi"]),
            upper_trigram=upper_name,
            lower_trigram=lower_name,
            house_name_vi=str(item["houseNameVi"]),
            house_element_vi=str(item["houseElementVi"]),
            generation_type=str(item["generationType"]),
            the_line=int(item["theLine"]),
            ung_line=int(item["ungLine"]),
            line_branches=tuple(int(x) for x in item["lineBranches"]),
            line_stems=tuple(int(x) for x in item["lineStems"]),
            line_elements_vi=tuple(str(x) for x in item["lineElementsVi"]),
            line_relatives_vi=tuple(str(x) for x in item["lineRelativesVi"]),
        )

    missing = [idx for idx, spec in enumerate(by_bits) if spec is None]
    if missing:
        raise ValueError(f"Incomplete 64-hexagram table in liuyao.json; missing bits: {missing}")

    raw_beasts = raw["sixBeastsByDayStem"]
    six_beasts_by_day_stem: dict[str, tuple[str, ...]] = {}
    if isinstance(raw_beasts, list):
        for i, beasts in enumerate(raw_beasts):
            six_beasts_by_day_stem[str(i)] = tuple(str(x) for x in beasts)
    else:
        for k, beasts in raw_beasts.items():
            six_beasts_by_day_stem[str(k)] = tuple(str(x) for x in beasts)

    return LiuyaoAxiomSpec(
        hexagrams_by_bits=tuple(spec for spec in by_bits if spec is not None),
        six_beasts_by_day_stem=six_beasts_by_day_stem,
    )


@lru_cache(maxsize=2)
def load_ziwei_axiom(silo: ZiweiSilo) -> ZiweiAxiomSpec:
    if silo not in ("nam-phai", "toan-thu"):
        raise ValueError(f"Invalid Ziwei silo: {silo!r}")
    file_name = "nam-phai.json" if silo == "nam-phai" else "toan-thu.json"
    raw = json.loads(_resolve_axiom_path(file_name).read_text(encoding="utf-8"))
    return _normalize_ziwei_axiom(raw, silo)


@lru_cache(maxsize=1)
def load_bazi_axiom() -> BaziAxiomSpec:
    raw = json.loads(_resolve_axiom_path("bazi.json").read_text(encoding="utf-8"))
    return _normalize_bazi_axiom(raw)


@lru_cache(maxsize=1)
def load_liuyao_axiom() -> LiuyaoAxiomSpec:
    raw = json.loads(_resolve_axiom_path("liuyao.json").read_text(encoding="utf-8"))
    return _normalize_liuyao_axiom(raw)
