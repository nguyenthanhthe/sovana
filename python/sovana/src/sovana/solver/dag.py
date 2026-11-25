"""Stratified Forward-Chaining DAG Engine with Paraconsistent Conflict Tracking."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, cast

from sovana.geo_time.ephemeris import floor_mod
from sovana.geo_time.models import SovanaModel
from sovana.solver.data import load_sample_rules
from sovana.solver.models import (
    ContextFilterEcho,
    ParaconsistentConflict,
    ProvenanceNode,
    RulePolarity,
    RuleSilo,
    SolverReportIR,
)

ELEMENT_INDEX: dict[str, int] = {
    "Mộc": 0,
    "Hỏa": 1,
    "Thổ": 2,
    "Kim": 3,
    "Thủy": 4,
}

BRANCH_ELEMENT_INDEX: tuple[int, ...] = (
    4,  # 0 Tý: Thủy
    2,  # 1 Sửu: Thổ
    0,  # 2 Dần: Mộc
    0,  # 3 Mão: Mộc
    2,  # 4 Thìn: Thổ
    1,  # 5 Tỵ: Hỏa
    1,  # 6 Ngọ: Hỏa
    2,  # 7 Mùi: Thổ
    3,  # 8 Thân: Kim
    3,  # 9 Dậu: Kim
    2,  # 10 Tuất: Thổ
    4,  # 11 Hợi: Thủy
)

TIEN_THAN_PAIRS: frozenset[str] = frozenset(
    {
        "11->0",
        "2->3",
        "5->6",
        "8->9",
        "1->4",
        "4->7",
        "7->10",
    }
)

THOAI_THAN_PAIRS: frozenset[str] = frozenset(
    {
        "0->11",
        "3->2",
        "6->5",
        "9->8",
        "4->1",
        "7->4",
        "10->7",
    }
)


def _as_dict(obj: SovanaModel | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(obj, SovanaModel):
        return obj.to_canonical_dict()
    return dict(obj)


def _sorted_unique(items: Sequence[str]) -> list[str]:
    if not items:
        return []
    return sorted(set(items))


def _normalize_palace_key(name: str) -> str:
    trimmed = name.strip()
    if trimmed in ("Giao Hữu", "Nô Bộc"):
        return "Nô Bộc"
    return trimmed


def _find_palace(ziwei: Mapping[str, Any], palace_query: str) -> Mapping[str, Any] | None:
    target = _normalize_palace_key(palace_query)
    palaces: Sequence[Mapping[str, Any]] = ziwei["palaces"]
    if target == "Thân":
        than_branch = int(ziwei["thanBranch"])
        for p in palaces:
            if p.get("isThan") or int(p["branchIndex"]) == than_branch:
                return p
        return None
    for p in palaces:
        if _normalize_palace_key(str(p["palaceName"])) == target:
            return p
    return None


def _find_palace_by_branch(ziwei: Mapping[str, Any], branch_index: int) -> Mapping[str, Any] | None:
    b = floor_mod(branch_index, 12)
    for p in ziwei["palaces"]:
        if int(p["branchIndex"]) == b:
            return cast(Mapping[str, Any], p)
    return None


def _palace_has_star_or_transform(palace: Mapping[str, Any], star_or_transform: str) -> bool:
    for s in palace["majorStars"]:
        if s["name"] == star_or_transform or s.get("sihuaTransform") == star_or_transform:
            return True
    for s in palace["minorStars"]:
        if s["name"] == star_or_transform or s.get("sihuaTransform") == star_or_transform:
            return True
    if (
        palace.get("thaiTueStar") == star_or_transform
        or palace.get("trangSinhStar") == star_or_transform
        or palace.get("bacSyStar") == star_or_transform
    ):
        return True
    return False


def _select_ziwei_chart(
    chart: Mapping[str, Any],
    rule_silo: str,
    explicit_silo: str | None = None,
) -> tuple[str, Mapping[str, Any]]:
    if explicit_silo in ("nam-phai", "toan-thu"):
        silo_id = explicit_silo
    elif rule_silo == "toan-thu":
        silo_id = "toan-thu"
    else:
        silo_id = "nam-phai"
    ziwei = chart["ziweiToanThu"] if silo_id == "toan-thu" else chart["ziweiNamPhai"]
    return silo_id, cast(Mapping[str, Any], ziwei)


def _bazi_has_ten_god(chart: Mapping[str, Any], ten_god: str) -> bool:
    bazi = chart["bazi"]
    for key in ("yearPillar", "monthPillar", "dayPillar", "hourPillar"):
        p = bazi[key]
        if p.get("position") != "day" and p.get("stemTenGod") == ten_god:
            return True
        for hs in p.get("hiddenStems", ()):
            if hs.get("tenGod") == ten_god:
                return True
    return False


def _compute_the_ung_relation(chart: Mapping[str, Any]) -> str | None:
    ly = chart.get("liuyao")
    if not ly:
        return None
    lines: Sequence[Mapping[str, Any]] = ly["lines"]
    the_line = next((ln for ln in lines if ln.get("isThe")), None)
    ung_line = next((ln for ln in lines if ln.get("isUng")), None)
    if not the_line or not ung_line:
        return None
    e_the = ELEMENT_INDEX.get(str(the_line["elementVi"]))
    e_ung = ELEMENT_INDEX.get(str(ung_line["elementVi"]))
    if e_the is None or e_ung is None:
        return None
    if e_the == e_ung:
        return "TY_HOA"
    if (e_the + 1) % 5 == e_ung:
        return "THE_SINH_UNG"
    if (e_ung + 1) % 5 == e_the:
        return "UNG_SINH_THE"
    if (e_the + 2) % 5 == e_ung:
        return "THE_KHAC_UNG"
    return "UNG_KHAC_THE"


def _eval_liuyao_flag(chart: Mapping[str, Any], flag: str) -> bool:
    ly = chart.get("liuyao")
    if not ly:
        return False
    lines: Sequence[Mapping[str, Any]] = ly["lines"]
    the_line = next((ln for ln in lines if ln.get("isThe")), None)
    ung_line = next((ln for ln in lines if ln.get("isUng")), None)

    if flag == "theTuanKhong":
        return bool(the_line and the_line.get("isTuanKhong"))
    if flag == "theNguyetPha":
        return bool(the_line and the_line.get("isNguyetPha"))
    if flag == "ungTuanKhong":
        return bool(ung_line and ung_line.get("isTuanKhong"))
    if flag == "ungNguyetPha":
        return bool(ung_line and ung_line.get("isNguyetPha"))
    if flag == "theDong":
        return bool(the_line and the_line.get("isMoving"))
    if flag == "ungDong":
        return bool(ung_line and ung_line.get("isMoving"))
    if flag == "hoaTienThan":
        return any(
            ln.get("isMoving")
            and ln.get("transformedBranchIndex") is not None
            and f"{ln['branchIndex']}->{ln['transformedBranchIndex']}" in TIEN_THAN_PAIRS
            for ln in lines
        )
    if flag == "hoaThoaiThan":
        return any(
            ln.get("isMoving")
            and ln.get("transformedBranchIndex") is not None
            and f"{ln['branchIndex']}->{ln['transformedBranchIndex']}" in THOAI_THAN_PAIRS
            for ln in lines
        )
    if flag == "hoaHoiDauSinh":
        for ln in lines:
            if not ln.get("isMoving") or ln.get("transformedElementVi") is None:
                continue
            e_prim = ELEMENT_INDEX.get(str(ln["elementVi"]))
            e_trans = ELEMENT_INDEX.get(str(ln["transformedElementVi"]))
            if e_prim is not None and e_trans is not None and (e_trans + 1) % 5 == e_prim:
                return True
        return False
    if flag == "hoaHoiDauKhac":
        for ln in lines:
            if not ln.get("isMoving") or ln.get("transformedElementVi") is None:
                continue
            e_prim = ELEMENT_INDEX.get(str(ln["elementVi"]))
            e_trans = ELEMENT_INDEX.get(str(ln["transformedElementVi"]))
            if e_prim is not None and e_trans is not None and (e_trans + 2) % 5 == e_prim:
                return True
        return False
    if flag in ("theVuongTuong", "theHuuTu"):
        if not the_line:
            return False
        e_the = ELEMENT_INDEX.get(str(the_line["elementVi"]))
        e_month = BRANCH_ELEMENT_INDEX[floor_mod(int(ly["monthBranchIndex"]), 12)]
        if e_the is None:
            return False
        is_vt = e_the == e_month or (e_month + 1) % 5 == e_the
        return is_vt if flag == "theVuongTuong" else (not is_vt)
    phuc_than: Sequence[Mapping[str, Any]] = ly.get("phucThan", ())
    if flag == "hasPhucThan":
        return len(phuc_than) > 0
    if flag == "phiSinhPhuc":
        for p in phuc_than:
            a = ELEMENT_INDEX.get(str(p["phiThanElementVi"]))
            b = ELEMENT_INDEX.get(str(p["elementVi"]))
            if a is not None and b is not None and (a + 1) % 5 == b:
                return True
        return False
    if flag == "phiKhacPhuc":
        for p in phuc_than:
            a = ELEMENT_INDEX.get(str(p["phiThanElementVi"]))
            b = ELEMENT_INDEX.get(str(p["elementVi"]))
            if a is not None and b is not None and (a + 2) % 5 == b:
                return True
        return False
    if flag == "phiLamKhongPha":
        for p in phuc_than:
            idx = int(p["lineNumber"]) - 1
            if 0 <= idx < len(lines):
                ln = lines[idx]
                if ln.get("isTuanKhong") or ln.get("isNguyetPha"):
                    return True
        return False
    if flag == "theAmDong":
        if not the_line or the_line.get("isMoving"):
            return False
        e_the = ELEMENT_INDEX.get(str(the_line["elementVi"]))
        e_month = BRANCH_ELEMENT_INDEX[floor_mod(int(ly["monthBranchIndex"]), 12)]
        if e_the is None:
            return False
        is_vt = e_the == e_month or (e_month + 1) % 5 == e_the
        nhat_xung = floor_mod(int(ly["nhatThanBranch"]) + 6, 12)
        return is_vt and nhat_xung == int(the_line["branchIndex"])
    raise ValueError(f"Unsupported liuyao_state_flag: {flag!r}")


@dataclass(frozen=True)
class _EvalOutcome:
    matched: bool
    cost: int
    parents: list[str]
    facts: list[str]


_UNMATCHED = _EvalOutcome(matched=False, cost=0, parents=[], facts=[])


def _evaluate_condition(
    cond: Mapping[str, Any],
    chart: Mapping[str, Any],
    rule_silo: str,
    derived_map: Mapping[str, ProvenanceNode],
) -> _EvalOutcome:
    op = str(cond["op"])

    if op == "star_in_palace":
        silo_id, ziwei = _select_ziwei_chart(chart, rule_silo, cond.get("silo"))
        palace_name = str(cond["palace"])
        star_name = str(cond["star"])
        p = _find_palace(ziwei, palace_name)
        if p is None or not _palace_has_star_or_transform(p, star_name):
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"ziwei:{silo_id}:star_in_palace:{palace_name}:{star_name}"],
        )

    if op == "star_in_tam_phuong":
        silo_id, ziwei = _select_ziwei_chart(chart, rule_silo, cond.get("silo"))
        palace_name = str(cond["palace"])
        star_name = str(cond["star"])
        base_p = _find_palace(ziwei, palace_name)
        if base_p is None:
            return _UNMATCHED
        b = int(base_p["branchIndex"])
        branches = (b, (b + 4) % 12, (b + 8) % 12, (b + 6) % 12)
        hit = False
        for br in branches:
            pal = _find_palace_by_branch(ziwei, br)
            if pal is not None and _palace_has_star_or_transform(pal, star_name):
                hit = True
                break
        if not hit:
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"ziwei:{silo_id}:star_in_tam_phuong:{palace_name}:{star_name}"],
        )

    if op == "star_brightness_in":
        silo_id, ziwei = _select_ziwei_chart(chart, rule_silo, cond.get("silo"))
        raw_palace = cond.get("palace")
        palace_str = (
            str(raw_palace) if isinstance(raw_palace, str) and len(raw_palace) > 0 else None
        )
        star_name = str(cond["star"])
        levels = [str(lv) for lv in cond["levels"]]
        if palace_str is not None:
            found_p = _find_palace(ziwei, palace_str)
            search_palaces: Sequence[Mapping[str, Any]] = [found_p] if found_p is not None else []
        else:
            search_palaces = ziwei["palaces"]
        for p in search_palaces:
            all_stars = list(p["majorStars"]) + list(p["minorStars"])
            for s in all_stars:
                if s["name"] == star_name or s.get("sihuaTransform") == star_name:
                    br = s.get("brightness")
                    if br is not None and str(br) in levels:
                        pal_label = palace_str if palace_str is not None else "*"
                        return _EvalOutcome(
                            matched=True,
                            cost=0,
                            parents=[],
                            facts=[
                                f"ziwei:{silo_id}:star_brightness_in:{pal_label}:{star_name}:{br}"
                            ],
                        )
        return _UNMATCHED

    if op == "sihua_in_palace":
        silo_id, ziwei = _select_ziwei_chart(chart, rule_silo, cond.get("silo"))
        palace_name = str(cond["palace"])
        transform = str(cond["transform"])
        p = _find_palace(ziwei, palace_name)
        if p is None or not _palace_has_star_or_transform(p, transform):
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"ziwei:{silo_id}:sihua_in_palace:{palace_name}:{transform}"],
        )

    if op == "palace_has_flag":
        silo_id, ziwei = _select_ziwei_chart(chart, rule_silo, cond.get("silo"))
        palace_name = str(cond["palace"])
        flag_name = str(cond["flag"])
        p = _find_palace(ziwei, palace_name)
        if p is None:
            return _UNMATCHED
        flag_val = bool(p["tuanTrung"]) if flag_name == "tuanTrung" else bool(p["trietLo"])
        if not flag_val:
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"ziwei:{silo_id}:palace_has_flag:{palace_name}:{flag_name}"],
        )

    if op == "palace_branch_in":
        silo_id, ziwei = _select_ziwei_chart(chart, rule_silo, cond.get("silo"))
        palace_name = str(cond["palace"])
        p = _find_palace(ziwei, palace_name)
        if p is None:
            return _UNMATCHED
        b = int(p["branchIndex"])
        allowed_branches = [int(x) for x in cond["branches"]]
        if b not in allowed_branches:
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"ziwei:{silo_id}:palace_branch_in:{palace_name}:{b}"],
        )

    if op == "star_in_relative_palace":
        silo_id, ziwei = _select_ziwei_chart(chart, rule_silo, cond.get("silo"))
        palace_name = str(cond["palace"])
        star_name = str(cond["star"])
        relation = str(cond["relation"])
        base_p = _find_palace(ziwei, palace_name)
        if base_p is None:
            return _UNMATCHED
        b = int(base_p["branchIndex"])
        if relation == "opposite":
            target_branch = (b + 6) % 12
        elif relation == "prev":
            target_branch = (b + 11) % 12
        elif relation == "next":
            target_branch = (b + 1) % 12
        elif relation == "nhi_hop":
            target_branch = (13 - b) % 12
        else:
            raise ValueError(f"Unsupported star_in_relative_palace relation: {relation!r}")
        target_p = _find_palace_by_branch(ziwei, target_branch)
        if target_p is None or not _palace_has_star_or_transform(target_p, star_name):
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"ziwei:{silo_id}:star_in_relative_palace:{palace_name}:{relation}:{star_name}"],
        )

    if op == "palace_major_count":
        silo_id, ziwei = _select_ziwei_chart(chart, rule_silo, cond.get("silo"))
        palace_name = str(cond["palace"])
        p = _find_palace(ziwei, palace_name)
        if p is None:
            return _UNMATCHED
        count = len(p["majorStars"])
        exact_val = cond.get("exact")
        min_val = cond.get("min")
        max_val = cond.get("max")
        if exact_val is not None and count != int(exact_val):
            return _UNMATCHED
        if min_val is not None and count < int(min_val):
            return _UNMATCHED
        if max_val is not None and count > int(max_val):
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"ziwei:{silo_id}:palace_major_count:{palace_name}:{count}"],
        )

    if op == "palace_star_count_in":
        silo_id, ziwei = _select_ziwei_chart(chart, rule_silo, cond.get("silo"))
        palace_name = str(cond["palace"])
        p = _find_palace(ziwei, palace_name)
        if p is None:
            return _UNMATCHED
        unique_stars = list(dict.fromkeys(str(s) for s in cond["stars"]))
        count = sum(1 for s in unique_stars if _palace_has_star_or_transform(p, s))
        min_val = int(cond["min"])
        max_val = cond.get("max")
        if count < min_val or (max_val is not None and count > int(max_val)):
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"ziwei:{silo_id}:palace_star_count_in:{palace_name}:{count}"],
        )

    if op == "star_co_located":
        uniq = _sorted_unique([str(s) for s in cond["stars"]])
        if not uniq:
            return _UNMATCHED
        silo_id, ziwei = _select_ziwei_chart(chart, rule_silo, cond.get("silo"))
        sorted_joined = "+".join(uniq)
        raw_palace = cond.get("palace")
        palace_str = (
            str(raw_palace) if isinstance(raw_palace, str) and len(raw_palace) > 0 else None
        )
        if palace_str is not None:
            p = _find_palace(ziwei, palace_str)
            if p is None or not all(_palace_has_star_or_transform(p, s) for s in uniq):
                return _UNMATCHED
            return _EvalOutcome(
                matched=True,
                cost=0,
                parents=[],
                facts=[f"ziwei:{silo_id}:star_co_located:{palace_str}:{sorted_joined}"],
            )
        sorted_palaces = sorted(ziwei["palaces"], key=lambda pal: int(pal["branchIndex"]))
        for pal in sorted_palaces:
            if all(_palace_has_star_or_transform(pal, s) for s in uniq):
                return _EvalOutcome(
                    matched=True,
                    cost=0,
                    parents=[],
                    facts=[
                        f"ziwei:{silo_id}:star_co_located:"
                        f"palace_{int(pal['branchIndex'])}:{sorted_joined}"
                    ],
                )
        return _UNMATCHED

    if op == "vo_chinh_dieu":
        silo_id, ziwei = _select_ziwei_chart(chart, rule_silo, cond.get("silo"))
        palace_name = str(cond["palace"])
        expected_val = bool(cond["value"])
        p = _find_palace(ziwei, palace_name)
        if p is None or bool(p.get("voChinhDieu")) != expected_val:
            return _UNMATCHED
        label = "true" if expected_val else "false"
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"ziwei:{silo_id}:vo_chinh_dieu:{palace_name}:{label}"],
        )

    if op == "tam_khong_in_tam_phuong":
        silo_id, ziwei = _select_ziwei_chart(chart, rule_silo, cond.get("silo"))
        palace_name = str(cond["palace"])
        min_count = int(cond["minCount"])
        base_p = _find_palace(ziwei, palace_name)
        if base_p is None:
            return _UNMATCHED
        b = int(base_p["branchIndex"])
        found: set[str] = set()
        for br in (b, (b + 4) % 12, (b + 8) % 12, (b + 6) % 12):
            pal = _find_palace_by_branch(ziwei, br)
            if pal is not None:
                for tok in pal.get("tamKhongTypes", ()):
                    found.add(str(tok))
        count = len(found)
        if count < min_count:
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"ziwei:{silo_id}:tam_khong_in_tam_phuong:{palace_name}:{count}"],
        )

    if op == "thai_tue_tu_linh":
        silo_id, ziwei = _select_ziwei_chart(chart, rule_silo, cond.get("silo"))
        scope = str(cond["scope"])
        if scope not in ("tam_hop", "tam_phuong"):
            raise ValueError(f"Unsupported thai_tue_tu_linh scope: {scope!r}")
        tt = ziwei.get("thaiTueTamHopTuLinh") or {}
        in_thai_tue = bool(tt.get("menhInThaiTueTamHop"))
        has_tu_linh = bool(
            tt.get("hasFullTuLinhInMenhTamHop")
            if scope == "tam_hop"
            else tt.get("hasFullTuLinhInMenhTamPhuong")
        )
        if not in_thai_tue or not has_tu_linh:
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"ziwei:{silo_id}:thai_tue_tu_linh:{scope}"],
        )

    if op == "year_stem_in":
        pillars = chart["temporal"]["pillars"]
        y_stem = int(
            pillars["baziYearPillar"]["stemIndex"]
            if rule_silo == "bazi"
            else pillars["lunarYearPillar"]["stemIndex"]
        )
        stems = [int(x) for x in cond["stems"]]
        if y_stem not in stems:
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"stem:year:{y_stem}"],
        )

    if op == "bazi_strength_is":
        target_val = str(cond["value"])
        if str(chart["bazi"]["strengthClass"]) != target_val:
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"bazi:strength:{target_val}"],
        )

    if op == "day_stem_in":
        d_stem = int(chart["temporal"]["pillars"]["dayPillar"]["stemIndex"])
        stems = [int(x) for x in cond["stems"]]
        if d_stem not in stems:
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"bazi:day_stem:{d_stem}"],
        )

    if op == "month_branch_in":
        m_branch = int(chart["temporal"]["pillars"]["baziMonthPillar"]["branchIndex"])
        allowed_branches = [int(x) for x in cond["branches"]]
        if m_branch not in allowed_branches:
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"bazi:month_branch:{m_branch}"],
        )

    if op == "bazi_has_ten_god":
        ten_god = str(cond["tenGod"])
        if not _bazi_has_ten_god(chart, ten_god):
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"bazi:ten_god:{ten_god}"],
        )

    if op == "liuyao_has_moving":
        ly = chart.get("liuyao")
        if not ly:
            return _UNMATCHED
        expected = bool(cond["value"])
        has_moving = len(ly["movingLines"]) > 0
        if has_moving != expected:
            return _UNMATCHED
        label = "true" if expected else "false"
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"liuyao:has_moving:{label}"],
        )

    if op == "liuyao_the_ung_relation":
        expected_rel = str(cond["relation"])
        rel = _compute_the_ung_relation(chart)
        if rel != expected_rel:
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"liuyao:the_ung:{expected_rel}"],
        )

    if op == "liuyao_state_flag":
        flag_str = str(cond["flag"])
        if not _eval_liuyao_flag(chart, flag_str):
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"liuyao:flag:{flag_str}"],
        )

    if op == "derived_node":
        node_id = str(cond["nodeId"])
        parent = derived_map.get(node_id)
        if parent is None:
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=parent.proof_depth,
            parents=[node_id],
            facts=[f"derived:{node_id}"],
        )

    if op == "and":
        args: Sequence[Mapping[str, Any]] = cond["args"]
        if len(args) == 0:
            return _EvalOutcome(matched=True, cost=0, parents=[], facts=[])
        max_cost = 0
        all_parents: list[str] = []
        all_facts: list[str] = []
        for arg in args:
            sub = _evaluate_condition(arg, chart, rule_silo, derived_map)
            if not sub.matched:
                return _UNMATCHED
            if sub.cost > max_cost:
                max_cost = sub.cost
            all_parents.extend(sub.parents)
            all_facts.extend(sub.facts)
        return _EvalOutcome(
            matched=True,
            cost=max_cost,
            parents=_sorted_unique(all_parents),
            facts=_sorted_unique(all_facts),
        )

    if op == "or":
        args_or: Sequence[Mapping[str, Any]] = cond["args"]
        matched_subs: list[_EvalOutcome] = []
        for arg in args_or:
            sub = _evaluate_condition(arg, chart, rule_silo, derived_map)
            if sub.matched:
                matched_subs.append(sub)
        if not matched_subs:
            return _UNMATCHED
        min_cost = min(s.cost for s in matched_subs)
        best_parents: list[str] = []
        best_facts: list[str] = []
        for s in matched_subs:
            if s.cost == min_cost:
                best_parents.extend(s.parents)
                best_facts.extend(s.facts)
        return _EvalOutcome(
            matched=True,
            cost=min_cost,
            parents=_sorted_unique(best_parents),
            facts=_sorted_unique(best_facts),
        )

    if op == "not":
        arg_not = cast(Mapping[str, Any], cond["arg"])
        sub = _evaluate_condition(arg_not, chart, rule_silo, derived_map)
        if sub.matched:
            return _UNMATCHED
        return _EvalOutcome(
            matched=True,
            cost=0,
            parents=[],
            facts=[f"not:{arg_not['op']}"],
        )

    raise ValueError(f"Unsupported ConditionAST operator: {op!r}")


def _passes_context_filter(
    rule: Mapping[str, Any],
    context_filter: Mapping[str, Any] | None,
) -> bool:
    if context_filter is None:
        return True

    career = context_filter.get("careerCategory")
    if career is None:
        career = context_filter.get("career_category")
    if career is not None:
        r_single = rule.get("careerCategory")
        if r_single is not None and r_single != career:
            return False
        r_multi = rule.get("careerCategories")
        if isinstance(r_multi, list) and len(r_multi) > 0 and career not in r_multi:
            return False

    setting = context_filter.get("setting")
    if setting is not None:
        s_single = rule.get("setting")
        if s_single is not None and s_single != setting:
            return False
        s_multi = rule.get("settings")
        if isinstance(s_multi, list) and len(s_multi) > 0 and setting not in s_multi:
            return False

    return True


def _detect_paraconsistent_conflicts(
    nodes: Sequence[ProvenanceNode],
) -> list[ParaconsistentConflict]:
    domains = _sorted_unique([n.domain for n in nodes])
    conflicts: list[ParaconsistentConflict] = []

    for domain in domains:
        dom_nodes = [n for n in nodes if n.domain == domain]

        cross_pos: set[str] = set()
        cross_neg: set[str] = set()
        has_np_tt_pair = False

        for u in dom_nodes:
            if u.polarity != "CAT":
                continue
            for v in dom_nodes:
                if v.polarity != "HUNG" or v.silo == u.silo:
                    continue
                cross_pos.add(u.node_id)
                cross_neg.add(v.node_id)
                if (u.silo == "nam-phai" and v.silo == "toan-thu") or (
                    u.silo == "toan-thu" and v.silo == "nam-phai"
                ):
                    has_np_tt_pair = True

        if cross_pos and cross_neg:
            hint = (
                f"Bất đồng tiên đề Nam Phái ↔ Toàn Thư tại lĩnh vực '{domain}': "
                "bảo toàn cả hai nhánh suy diễn (lưỡng thuyết) và dùng câu hỏi "
                "Định Bàn thực chứng quá khứ để xác lập hệ tiên đề ứng hợp."
                if has_np_tt_pair
                else (
                    f"Đối lập Cát/Hung liên hệ thống tại lĩnh vực '{domain}': "
                    "bảo toàn cả hai mệnh đề và đối chiếu Dụng Thần Bát Tự "
                    "cùng Đại Hạn Tử Vi trước khi kết luận."
                )
            )
            conflicts.append(
                ParaconsistentConflict(
                    conflict_id=f"conflict:{domain}:CROSS_SILO",
                    domain=domain,
                    kind="CROSS_SILO",
                    positive_node_ids=sorted(cross_pos),
                    negative_node_ids=sorted(cross_neg),
                    resolution_hint_vi=hint,
                )
            )

        silos = _sorted_unique([n.silo for n in dom_nodes])
        for silo in silos:
            pos_ids = sorted(n.node_id for n in dom_nodes if n.silo == silo and n.polarity == "CAT")
            neg_ids = sorted(
                n.node_id for n in dom_nodes if n.silo == silo and n.polarity == "HUNG"
            )
            if pos_ids and neg_ids:
                conflicts.append(
                    ParaconsistentConflict(
                        conflict_id=f"conflict:{domain}:INTRA_SILO_PARACONSISTENT:{silo}",
                        domain=domain,
                        kind="INTRA_SILO_PARACONSISTENT",
                        positive_node_ids=pos_ids,
                        negative_node_ids=neg_ids,
                        resolution_hint_vi=(
                            f"Lưỡng thuyết nội phái ({silo}) tại lĩnh vực '{domain}': "
                            "Cát tinh và Hung tinh đồng hiện, bảo toàn cả hai chiều "
                            "thuận–nghịch theo từng giai đoạn vận hạn thay vì triệt tiêu."
                        ),
                    )
                )

    conflicts.sort(key=lambda c: c.conflict_id)
    return conflicts


def evaluate_rules_dag(
    chart: SovanaModel | Mapping[str, Any],
    rules: Sequence[Mapping[str, Any] | SovanaModel] | None = None,
    context_filter: Mapping[str, Any] | SovanaModel | None = None,
) -> SolverReportIR:
    chart_dict = _as_dict(chart)
    filter_dict = _as_dict(context_filter) if context_filter is not None else None

    raw_rules: Sequence[Mapping[str, Any]] = (
        [_as_dict(r) for r in rules] if rules is not None else load_sample_rules()
    )
    active_rules = [r for r in raw_rules if _passes_context_filter(r, filter_dict)]

    by_id: dict[str, Mapping[str, Any]] = {}
    for r in active_rules:
        rid = str(r["id"])
        stratum = r["stratum"]
        if not isinstance(stratum, int) or isinstance(stratum, bool) or stratum < 1:
            raise ValueError(f"Invalid rule stratum for {rid!r}: {stratum!r} (must be int >= 1)")
        if rid not in by_id:
            by_id[rid] = r

    canonical_rules = sorted(by_id.values(), key=lambda r: (int(r["stratum"]), str(r["id"])))
    strata_evaluated = sorted({int(r["stratum"]) for r in canonical_rules})

    derived_map: dict[str, ProvenanceNode] = {}

    for stratum in strata_evaluated:
        stratum_rules = [r for r in canonical_rules if int(r["stratum"]) == stratum]
        changed = True
        while changed:
            changed = False
            for rule in stratum_rules:
                rid = str(rule["id"])
                r_silo = cast(RuleSilo, str(rule["silo"]))
                outcome = _evaluate_condition(
                    cast(Mapping[str, Any], rule["when"]),
                    chart_dict,
                    r_silo,
                    derived_map,
                )
                if not outcome.matched:
                    continue

                candidate_depth = 1 + outcome.cost
                existing = derived_map.get(rid)
                advice_raw = rule.get("actionableAdviceVi", rule.get("actionable_advice_vi"))
                advice_val = str(advice_raw) if advice_raw is not None else None

                if existing is None:
                    derived_map[rid] = ProvenanceNode(
                        node_id=rid,
                        silo=r_silo,
                        stratum=stratum,
                        proof_depth=candidate_depth,
                        domain=str(rule["domain"]),
                        polarity=cast(RulePolarity, str(rule["polarity"])),
                        claim_vi=str(rule["claimVi"]),
                        actionable_advice_vi=advice_val,
                        classical_source=str(rule["classicalSource"]),
                        parent_node_ids=outcome.parents,
                        matched_facts=outcome.facts,
                    )
                    changed = True
                elif candidate_depth < existing.proof_depth or (
                    candidate_depth == existing.proof_depth
                    and (
                        existing.parent_node_ids != outcome.parents
                        or existing.matched_facts != outcome.facts
                    )
                ):
                    merged_parents = (
                        outcome.parents
                        if candidate_depth < existing.proof_depth
                        else _sorted_unique([*existing.parent_node_ids, *outcome.parents])
                    )
                    merged_facts = (
                        outcome.facts
                        if candidate_depth < existing.proof_depth
                        else _sorted_unique([*existing.matched_facts, *outcome.facts])
                    )
                    if (
                        candidate_depth < existing.proof_depth
                        or existing.parent_node_ids != merged_parents
                        or existing.matched_facts != merged_facts
                    ):
                        derived_map[rid] = ProvenanceNode(
                            node_id=existing.node_id,
                            silo=existing.silo,
                            stratum=existing.stratum,
                            proof_depth=candidate_depth,
                            domain=existing.domain,
                            polarity=existing.polarity,
                            claim_vi=existing.claim_vi,
                            actionable_advice_vi=existing.actionable_advice_vi,
                            classical_source=existing.classical_source,
                            parent_node_ids=merged_parents,
                            matched_facts=merged_facts,
                        )
                        changed = True

    nodes = sorted(derived_map.values(), key=lambda n: (n.stratum, n.node_id))
    conflicts = _detect_paraconsistent_conflicts(nodes)

    context_echo: ContextFilterEcho | None = None
    if filter_dict is not None:
        career_v = filter_dict.get("careerCategory", filter_dict.get("career_category"))
        setting_v = filter_dict.get("setting")
        context_echo = ContextFilterEcho(
            career_category=str(career_v) if career_v is not None else None,
            setting=str(setting_v) if setting_v is not None else None,
        )

    return SolverReportIR(
        schema_version="1.0.0",
        total_rules_evaluated=len(canonical_rules),
        strata_evaluated=strata_evaluated,
        context_filter=context_echo,
        nodes=nodes,
        conflicts=conflicts,
    )
