"""Bi-temporal Vietnam GIS resolver (63 legacy <-> 34 post-2025 provinces, districts, islands)."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from sovana.geo_time.data import load_geo_dataset
from sovana.geo_time.ephemeris import js_round
from sovana.geo_time.models import ResolvedLocation

_PUNCT_RE = re.compile(r"[-_/,.()]+")
_SPACE_RE = re.compile(r"\s+")
_QUI_RE = re.compile(r"\bqui\b")


def strip_accents(text: str) -> str:
    s = text.replace("đ", "d").replace("Đ", "D")
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return unicodedata.normalize("NFC", s)


def normalize_search_key(text: str, strip_admin_prefix: bool = True) -> str:
    s = strip_accents(text).lower().strip()
    s = _SPACE_RE.sub(" ", _PUNCT_RE.sub(" ", s)).strip()
    if strip_admin_prefix:
        for pfx in ("thanh pho ", "thi xa ", "tinh ", "quan ", "huyen ", "tp ", "tx "):
            if s.startswith(pfx):
                s = s[len(pfx):].strip()
                break
    s = _SPACE_RE.sub(" ", _QUI_RE.sub("quy", s)).strip()
    return s


def _make_coords(lat: float, lon: float) -> tuple[int, int, float, float]:
    lat_micro = js_round(lat * 1_000_000)
    lon_micro = js_round(lon * 1_000_000)
    return lat_micro, lon_micro, lat_micro / 1_000_000, lon_micro / 1_000_000


@dataclass(frozen=True, slots=True)
class _IndexedDistrict:
    order: int
    dist: dict[str, Any]
    full_key: str
    prov63_key: str
    post2025_key: str


@dataclass(frozen=True, slots=True)
class _GeoIndex:
    geo: dict[str, Any]
    p34_by_id: dict[str, dict[str, Any]]
    p34_by_key: dict[str, dict[str, Any]]
    p63_by_code: dict[str, dict[str, Any]]
    p63_by_key: dict[str, dict[str, Any]]
    sz_by_key: dict[str, dict[str, Any]]
    dist_by_code: dict[str, _IndexedDistrict]
    dist_by_full_key: dict[str, list[_IndexedDistrict]]
    dist_by_key: dict[str, list[_IndexedDistrict]]
    alias_by_key: dict[str, dict[str, Any]]


@lru_cache(maxsize=1)
def _get_geo_index() -> _GeoIndex:
    geo = load_geo_dataset()

    p34_by_id: dict[str, dict[str, Any]] = {}
    p34_by_key: dict[str, dict[str, Any]] = {}
    for p in geo["provincesPost2025"]:
        p34_by_id[p["id"]] = p
        for k in (normalize_search_key(p["shortName"]), normalize_search_key(p["name"])):
            p34_by_key.setdefault(k, p)

    p63_by_code: dict[str, dict[str, Any]] = {}
    p63_by_key: dict[str, dict[str, Any]] = {}
    for p in geo["provincesLegacy63"]:
        p63_by_code[p["code"]] = p
        for k in (normalize_search_key(p["shortName"]), normalize_search_key(p["name"])):
            p63_by_key.setdefault(k, p)

    sz_by_key: dict[str, dict[str, Any]] = {}
    for sz in geo["specialZones"]:
        for k in (
            sz["id"],
            normalize_search_key(sz["shortName"]),
            normalize_search_key(sz["name"]),
            normalize_search_key(sz["name"], False),
        ):
            sz_by_key.setdefault(k, sz)

    dist_by_code: dict[str, _IndexedDistrict] = {}
    dist_by_full_key: dict[str, list[_IndexedDistrict]] = {}
    dist_by_key: dict[str, list[_IndexedDistrict]] = {}
    for i, d in enumerate(geo["districtsLegacy"]):
        full_k = normalize_search_key(d["name"], False)
        short_k = normalize_search_key(d["name"], True)
        item = _IndexedDistrict(
            order=i,
            dist=d,
            full_key=full_k,
            prov63_key=normalize_search_key(d["province63Name"]),
            post2025_key=normalize_search_key(d["post2025Name"]),
        )
        dist_by_code[d["code"]] = item
        dist_by_full_key.setdefault(full_k, []).append(item)
        if short_k != full_k:
            dist_by_key.setdefault(short_k, []).append(item)
        else:
            dist_by_key.setdefault(short_k, []).append(item)

    alias_by_key: dict[str, dict[str, Any]] = {}
    for alias in geo["historicalAliases"]:
        for n in (alias["name"], *alias["aliases"]):
            for k in (normalize_search_key(n), normalize_search_key(n, False)):
                alias_by_key.setdefault(k, alias)

    return _GeoIndex(
        geo=geo,
        p34_by_id=p34_by_id,
        p34_by_key=p34_by_key,
        p63_by_code=p63_by_code,
        p63_by_key=p63_by_key,
        sz_by_key=sz_by_key,
        dist_by_code=dist_by_code,
        dist_by_full_key=dist_by_full_key,
        dist_by_key=dist_by_key,
        alias_by_key=alias_by_key,
    )


def list_provinces_34() -> list[dict[str, Any]]:
    return list(_get_geo_index().geo["provincesPost2025"])


def list_provinces_63() -> list[dict[str, Any]]:
    return list(_get_geo_index().geo["provincesLegacy63"])


def map_63_to_34(code_or_name: str) -> dict[str, Any]:
    idx = _get_geo_index()
    raw = code_or_name.strip()
    p63 = idx.p63_by_code.get(raw) or idx.p63_by_key.get(normalize_search_key(raw))
    if p63 is None:
        raise KeyError(f"Legacy 63 province not found: {code_or_name}")
    return idx.p34_by_id[p63["post2025Id"]]


def map_34_to_63(id_or_name: str) -> list[dict[str, Any]]:
    idx = _get_geo_index()
    raw = id_or_name.strip()
    p34 = idx.p34_by_id.get(raw) or idx.p34_by_key.get(normalize_search_key(raw))
    if p34 is None:
        raise KeyError(f"Post-2025 province not found: {id_or_name}")
    return [idx.p63_by_code[c] for c in p34["mergedFrom63Codes"]]


def resolve_location(query: str | dict[str, Any]) -> ResolvedLocation:
    idx = _get_geo_index()

    if isinstance(query, dict):
        if query.get("code") or query.get("name"):
            return resolve_location(str(query.get("code") or query.get("name")))
        if query.get("lat") is not None and query.get("lon") is not None:
            lat_m, lon_m, lat_v, lon_v = _make_coords(float(query["lat"]), float(query["lon"]))
            in_vn = 8.0 <= lat_v <= 23.5 and 102.0 <= lon_v <= 117.5
            return ResolvedLocation(
                matched_by="coordinates",
                query=f"{lat_v},{lon_v}",
                canonical_name=f"{lat_v}, {lon_v}",
                lat_micro_deg=lat_m,
                lon_micro_deg=lon_m,
                lat=lat_v,
                lon=lon_v,
                tz_zone=("VN_NORTH_DRV" if lat_v >= 17.006 else "VN_SOUTH_RVN") if in_vn else None,
            )
        raise ValueError("Location query dict must provide code, name, or lat/lon")

    raw_query = query.strip()
    has_comma = "," in raw_query
    if has_comma:
        parts = [s.strip() for s in raw_query.split(",") if s.strip()]
        primary_raw = parts[0] if parts else raw_query
        prov_filter_key = normalize_search_key(parts[-1]) if len(parts) > 1 else None
        single_token = len(parts) == 1
    else:
        primary_raw = raw_query
        prov_filter_key = None
        single_token = True

    key = normalize_search_key(primary_raw)
    full_key = normalize_search_key(raw_query, strip_admin_prefix=False)

    # 1. Special zones & islands
    sz = (
        idx.sz_by_key.get(raw_query.lower())
        or idx.sz_by_key.get(key)
        or idx.sz_by_key.get(full_key)
    )
    if sz is not None:
        p63 = idx.p63_by_code.get(sz["legacy63Code"])
        p34 = idx.p34_by_id.get(sz["post2025Id"])
        lat_m, lon_m, lat_v, lon_v = _make_coords(sz["lat"], sz["lon"])
        return ResolvedLocation(
            matched_by="special_zone",
            query=raw_query,
            canonical_name=sz["name"],
            province63_code=p63["code"] if p63 else sz["legacy63Code"],
            province63_name=p63["shortName"] if p63 else None,
            post2025_id=p34["id"] if p34 else sz["post2025Id"],
            post2025_name=p34["shortName"] if p34 else None,
            district_code=None,
            district_name=sz["shortName"],
            lat_micro_deg=lat_m,
            lon_micro_deg=lon_m,
            lat=lat_v,
            lon=lon_v,
            tz_zone=sz["tzZone"],
            koppen_zone=sz["koppenZone"],
            wide_longitude_warning=False,
            lon_span_deg=0.0,
        )

    # 2 & 3. Legacy 63 & Post-2025 34 provinces
    if single_token:
        p63 = idx.p63_by_code.get(raw_query) or idx.p63_by_key.get(key)
        if p63 is not None:
            p34 = idx.p34_by_id.get(p63["post2025Id"])
            lat_m, lon_m, lat_v, lon_v = _make_coords(p63["lat"], p63["lon"])
            return ResolvedLocation(
                matched_by="legacy63",
                query=raw_query,
                canonical_name=p63["name"],
                province63_code=p63["code"],
                province63_name=p63["shortName"],
                post2025_id=p63["post2025Id"],
                post2025_name=p63["post2025Name"],
                lat_micro_deg=lat_m,
                lon_micro_deg=lon_m,
                lat=lat_v,
                lon=lon_v,
                tz_zone=p63["tzZone"],
                koppen_zone=p63["koppenZone"],
                wide_longitude_warning=p34["wideLongitudeWarning"] if p34 else False,
                lon_span_deg=(
                    p34["lonSpanDeg"]
                    if p34
                    else round(p63["maxLon"] - p63["minLon"], 4)
                ),
            )

        p34 = idx.p34_by_id.get(raw_query.lower()) or idx.p34_by_key.get(key)
        if p34 is not None:
            lead_code = p34["mergedFrom63Codes"][0]
            lat_m, lon_m, lat_v, lon_v = _make_coords(p34["lat"], p34["lon"])
            return ResolvedLocation(
                matched_by="post2025",
                query=raw_query,
                canonical_name=p34["name"],
                province63_code=lead_code,
                province63_name=idx.p63_by_code[lead_code]["shortName"],
                post2025_id=p34["id"],
                post2025_name=p34["shortName"],
                lat_micro_deg=lat_m,
                lon_micro_deg=lon_m,
                lat=lat_v,
                lon=lon_v,
                tz_zone=p34["tzZone"],
                koppen_zone=p34["koppenZone"],
                wide_longitude_warning=p34["wideLongitudeWarning"],
                lon_span_deg=p34["lonSpanDeg"],
            )

    # 4. Legacy districts (~696)
    raw_primary_full = normalize_search_key(primary_raw, strip_admin_prefix=False)
    by_code = idx.dist_by_code.get(raw_query)
    if by_code is not None:
        matched_districts = [by_code]
    else:
        a = idx.dist_by_full_key.get(raw_primary_full, [])
        b = idx.dist_by_key.get(key, [])
        if not a:
            matched_districts = b
        elif not b:
            matched_districts = a
        else:
            seen: dict[int, _IndexedDistrict] = {m.order: m for m in a}
            for m in b:
                seen[m.order] = m
            matched_districts = [seen[k] for k in sorted(seen)]

    if matched_districts:
        chosen_item = matched_districts[0]
        if prov_filter_key:
            filtered = next(
                (
                    m
                    for m in matched_districts
                    if m.prov63_key == prov_filter_key
                    or m.post2025_key == prov_filter_key
                    or m.dist["post2025Id"] == prov_filter_key
                ),
                None,
            )
            if filtered is not None:
                chosen_item = filtered
        elif len(matched_districts) > 1:
            exact_full = next(
                (m for m in matched_districts if m.full_key == raw_primary_full),
                None,
            )
            if exact_full is not None:
                chosen_item = exact_full
        chosen = chosen_item.dist
        lat_m, lon_m, lat_v, lon_v = _make_coords(chosen["lat"], chosen["lon"])
        return ResolvedLocation(
            matched_by="district",
            query=raw_query,
            canonical_name=f"{chosen['name']}, {chosen['province63Name']}",
            province63_code=chosen["province63Code"],
            province63_name=chosen["province63Name"],
            post2025_id=chosen["post2025Id"],
            post2025_name=chosen["post2025Name"],
            district_code=chosen["code"],
            district_name=chosen["name"],
            lat_micro_deg=lat_m,
            lon_micro_deg=lon_m,
            lat=lat_v,
            lon=lon_v,
            tz_zone=chosen["tzZone"],
            koppen_zone=chosen["koppenZone"],
            wide_longitude_warning=False,
            lon_span_deg=0.0,
        )

    # 5. Historical aliases
    alias = idx.alias_by_key.get(key) or idx.alias_by_key.get(full_key)
    if alias is not None:
        lead_code = alias["legacy63Codes"][0]
        p63 = idx.p63_by_code[lead_code]
        p34 = idx.p34_by_id[p63["post2025Id"]]
        lat_m, lon_m, lat_v, lon_v = _make_coords(alias["lat"], alias["lon"])
        return ResolvedLocation(
            matched_by="historical_alias",
            query=raw_query,
            canonical_name=alias["name"],
            province63_code=p63["code"],
            province63_name=p63["shortName"],
            post2025_id=p34["id"],
            post2025_name=p34["shortName"],
            lat_micro_deg=lat_m,
            lon_micro_deg=lon_m,
            lat=lat_v,
            lon=lon_v,
            tz_zone="VN_NORTH_DRV" if lat_v >= 17.006 else "VN_SOUTH_RVN",
            koppen_zone=p63["koppenZone"],
            wide_longitude_warning=p34["wideLongitudeWarning"],
            lon_span_deg=p34["lonSpanDeg"],
        )

    raise KeyError(f"Unable to resolve Vietnam location: '{raw_query}'")
