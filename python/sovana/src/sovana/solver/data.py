"""Spec data loaders for sovana.solver (packaged wheel data or monorepo specs/sample_rules/)."""

from __future__ import annotations

import json
import pathlib
from functools import lru_cache
from typing import Any

_PKG_DIR = pathlib.Path(__file__).resolve().parent


def _resolve_sample_rule_path(file_name: str) -> pathlib.Path:
    local_path = _PKG_DIR / "data" / file_name
    if local_path.exists():
        return local_path
    geo_data_path = _PKG_DIR.parent / "geo_time" / "data" / file_name
    if geo_data_path.exists():
        return geo_data_path
    for parent in _PKG_DIR.parents:
        candidate = parent / "specs" / "sample_rules" / file_name
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        f"SOVANA sample rules file '{file_name}' not found in "
        "package data/ or parent specs/sample_rules/"
    )


@lru_cache(maxsize=1)
def _load_sample_rules_cached() -> tuple[dict[str, Any], ...]:
    path = _resolve_sample_rule_path("public_rules_50.json")
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return tuple(raw)
    if isinstance(raw, dict) and isinstance(raw.get("rules"), list):
        return tuple(raw["rules"])
    raise ValueError("Invalid sample rules JSON format: expected list or {'rules': [...]}")


def load_sample_rules() -> list[dict[str, Any]]:
    return [dict(r) for r in _load_sample_rules_cached()]


@lru_cache(maxsize=1)
def _load_terminology_cached() -> dict[str, Any]:
    try:
        path = _resolve_sample_rule_path("terminology_vi.json")
    except FileNotFoundError:
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    return dict(raw) if isinstance(raw, dict) else {}


def load_terminology_vi() -> dict[str, Any]:
    return dict(_load_terminology_cached())
