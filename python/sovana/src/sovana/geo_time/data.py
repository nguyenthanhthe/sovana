"""Spec data loaders (packaged wheel data or monorepo specs/)."""

from __future__ import annotations

import json
import pathlib
from functools import lru_cache
from typing import Any

from sovana.geo_time.ephemeris import parse_ephemeris
from sovana.geo_time.models import EphemerisTable

_PKG_DIR = pathlib.Path(__file__).resolve().parent


def _resolve_spec_path(pkg_name: str, *repo_parts: str) -> pathlib.Path:
    local_path = _PKG_DIR / "data" / pkg_name
    if local_path.exists():
        return local_path
    for parent in _PKG_DIR.parents:
        candidate = parent / "specs" / pathlib.Path(*repo_parts)
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"SOVANA spec file not found at '{local_path}' or any parent specs/")


@lru_cache(maxsize=1)
def load_ephemeris() -> EphemerisTable:
    path = _resolve_spec_path("ephemeris_1900_2100.bin", "ephemeris", "ephemeris_1900_2100.bin")
    return parse_ephemeris(path.read_bytes())


@lru_cache(maxsize=1)
def load_geo_dataset() -> dict[str, Any]:
    path = _resolve_spec_path("vn_bi_temporal_geo.json", "geo", "vn_bi_temporal_geo.json")
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_tz_regimes() -> dict[str, Any]:
    path = _resolve_spec_path("vn_tz_regimes.json", "geo", "vn_tz_regimes.json")
    return json.loads(path.read_text(encoding="utf-8"))
