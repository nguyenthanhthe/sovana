"""Tests for sovana.solver: Confluence, Paraconsistent DAG, Shannon-Entropy, and Lockstep."""

from __future__ import annotations

import json
import pathlib
import random
import re
import subprocess

import pytest
from sovana.geo_time import canonical_json, normalize_birth_temporal, sha256_canonical
from sovana.kernel import compile_chart_ir
from sovana.solver import (
    PUBLIC_RECTIFICATION_QUESTIONS,
    answer_question,
    compute_certainty_prior_weights,
    compute_entropy_millibits,
    compute_invariant_intersection,
    create_initial_rectification_state,
    create_rectification_session_from_charts,
    eval_chart_predicate,
    evaluate_rules_dag,
    load_sample_rules,
    normalize_micro_probs,
    select_next_question,
    validate_question_bank,
)

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


def test_church_rosser_confluence_20_permutations() -> None:
    rules = load_sample_rules()
    assert len(rules) == 56

    temporal = normalize_birth_temporal(
        1980,
        8,
        15,
        10,
        30,
        "Đà Nẵng",
        migration_destination="TP. Hồ Chí Minh",
    )
    chart = compile_chart_ir(temporal, "male", cast_mai_hoa=True)

    baseline = evaluate_rules_dag(chart, rules)
    baseline_sha = sha256_canonical(baseline)
    baseline_json = canonical_json(baseline)
    assert baseline.total_rules_evaluated == 56
    assert baseline.strata_evaluated == [1, 2]
    assert len(baseline.nodes) > 0

    rng = random.Random(20261125)
    for _ in range(20):
        shuffled = list(rules)
        rng.shuffle(shuffled)
        rep = evaluate_rules_dag(chart, shuffled)
        assert sha256_canonical(rep) == baseline_sha
        assert canonical_json(rep) == baseline_json


def test_paraconsistent_cross_silo_conflict_can_canh() -> None:
    temporal = normalize_birth_temporal(1980, 8, 15, 10, 30, "Đà Nẵng")
    chart = compile_chart_ir(temporal, "male")
    assert chart.temporal.pillars.lunar_year_pillar.stem_index == 6  # Can Canh

    report = evaluate_rules_dag(chart)
    node_ids = {n.node_id for n in report.nodes}

    assert {"NP-017", "TT-007", "NP-018", "TT-008", "CR-006"}.issubset(node_ids)

    cross_conflicts = [c for c in report.conflicts if c.kind == "CROSS_SILO"]
    assert len(cross_conflicts) >= 2

    by_domain = {c.domain: c for c in cross_conflicts}
    assert "TT-007" in by_domain["tai"].positive_node_ids
    assert "NP-017" in by_domain["tai"].negative_node_ids
    assert "NP-018" in by_domain["phuc"].positive_node_ids
    assert "TT-008" in by_domain["phuc"].negative_node_ids


def test_shortest_proof_depth_and_extended_ast_ops() -> None:
    temporal = normalize_birth_temporal(1996, 5, 20, 4, 0, "Hà Nội")
    chart = compile_chart_ir(temporal, "female", liuyao_lines=[9, 7, 8, 6, 7, 8])

    custom_rules = [
        {
            "id": "R-S1-FAST",
            "silo": "bazi",
            "stratum": 1,
            "domain": "quan",
            "polarity": "CAT",
            "when": {
                "op": "day_stem_in",
                "stems": [chart.temporal.pillars.day_pillar.stem_index],
            },
            "claimVi": "Nhật can hợp cách",
            "actionableAdviceVi": "Phát huy chuyên môn cốt lõi",
            "classicalSource": "Cùng Thông Bảo Giám",
            "careerCategories": ["TECH", "RESEARCH"],
        },
        {
            "id": "R-S1-MONTH",
            "silo": "bazi",
            "stratum": 1,
            "domain": "quan",
            "polarity": "HUNG",
            "when": {
                "op": "and",
                "args": [
                    {
                        "op": "month_branch_in",
                        "branches": [chart.temporal.pillars.bazi_month_pillar.branch_index],
                    },
                    {"op": "liuyao_has_moving", "value": True},
                ],
            },
            "claimVi": "Nguyệt lệnh kiêm hào động cảnh báo biến chuyển",
            "classicalSource": "Tăng San Bốc Dịch",
        },
        {
            "id": "R-S2-CHAIN",
            "silo": "bazi",
            "stratum": 2,
            "domain": "quan",
            "polarity": "CAT",
            "when": {"op": "derived_node", "nodeId": "R-S1-FAST"},
            "claimVi": "Suy diễn tầng 2",
            "classicalSource": "Test",
        },
        {
            "id": "R-S3-DIAMOND",
            "silo": "cross",
            "stratum": 3,
            "domain": "quan",
            "polarity": "CAT",
            "when": {
                "op": "or",
                "args": [
                    {"op": "derived_node", "nodeId": "R-S2-CHAIN"},
                    {"op": "derived_node", "nodeId": "R-S1-FAST"},
                ],
            },
            "claimVi": "Hội tụ đường chứng minh ngắn nhất",
            "classicalSource": "Test",
        },
    ]

    rep_ok = evaluate_rules_dag(chart, custom_rules, {"careerCategory": "TECH"})
    diamond = next(n for n in rep_ok.nodes if n.node_id == "R-S3-DIAMOND")
    assert diamond.proof_depth == 2
    assert diamond.parent_node_ids == ["R-S1-FAST"]
    assert any(
        c.kind == "INTRA_SILO_PARACONSISTENT" and c.domain == "quan" for c in rep_ok.conflicts
    )

    rep_filtered = evaluate_rules_dag(chart, custom_rules, {"careerCategory": "FINANCE"})
    assert all(n.node_id != "R-S1-FAST" for n in rep_filtered.nodes)


def test_anti_barnum_guard_rejects_personality_questions() -> None:
    bad_bank = [
        {
            "id": "BARNUM-001",
            "category": "PERSONALITY_TRAIT",
            "promptVi": "Bạn có phải người vừa cầu toàn vừa linh hoạt không?",
            "options": [
                {"id": "YES", "labelVi": "Có"},
                {"id": "NO", "labelVi": "Không"},
            ],
            "likelihoodMatrixMicro": {
                "YES": [500_000] * 12,
                "NO": [500_000] * 12,
            },
        }
    ]
    with pytest.raises(ValueError, match="Anti-Barnum violation"):
        validate_question_bank(bad_bank)


def test_shannon_entropy_convergence_gio_dan_and_all_12_shichen() -> None:
    for true_branch in range(12):
        state = create_initial_rectification_state(user_age=28)
        assert state.entropy_millibits == 3585
        assert sum(c.prob_micro for c in state.candidates) == 1_000_000

        steps = 0
        while state.status == "ACTIVE":
            sel = select_next_question(state, PUBLIC_RECTIFICATION_QUESTIONS)
            assert sel is not None
            assert sel.expected_info_gain_millibits > 0

            q = sel.question
            mat = q.likelihood_matrix_micro
            best_opt_id = max(q.options, key=lambda o: mat[o.id][true_branch]).id
            state = answer_question(state, q.id, best_opt_id, PUBLIC_RECTIFICATION_QUESTIONS)
            assert sum(c.prob_micro for c in state.candidates) == 1_000_000
            steps += 1

        assert steps <= 4
        assert state.status == "LOCKED"
        assert state.locked_shichen_branch == true_branch
        assert state.top1_prob_micro >= 800_000
        assert state.top1_prob_micro >= 3 * state.top2_prob_micro


def test_safety_brake_invariant_intersection_fallback() -> None:
    state = create_initial_rectification_state(candidate_branches=[1, 2], max_questions=5)
    assert compute_entropy_millibits(normalize_micro_probs([1, 1])) == 1000

    while state.status == "ACTIVE":
        sel = select_next_question(state)
        assert sel is not None
        state = answer_question(state, sel.question_id, "OPT_NA")

    assert state.status == "INVARIANT_INTERSECTION"
    assert state.locked_shichen_branch is None
    assert len(state.answers) == 5

    t_suu = normalize_birth_temporal(1990, 6, 15, 2, 0, "Hà Nội")
    t_dan = normalize_birth_temporal(1990, 6, 15, 4, 0, "Hà Nội")
    c_suu = compile_chart_ir(t_suu, "male")
    c_dan = compile_chart_ir(t_dan, "male")
    r_suu = evaluate_rules_dag(c_suu)
    r_dan = evaluate_rules_dag(c_dan)

    inter = compute_invariant_intersection([r_suu, r_dan], c_dan.bazi, state)
    assert inter.mode == "INVARIANT_INTERSECTION"
    assert inter.surviving_candidate_count == 2
    assert inter.surviving_branches == [1, 2]
    assert inter.invariant_bazi_pillars.day_pillar == c_suu.bazi.day_pillar.pillar

    suu_ids = {n.node_id for n in r_suu.nodes}
    dan_ids = {n.node_id for n in r_dan.nodes}
    for node in inter.invariant_nodes:
        assert node.node_id in suu_ids
        assert node.node_id in dan_ids


def test_cross_runtime_ts_python_sha256_lockstep() -> None:
    solver_dist = REPO_ROOT / "packages" / "solver" / "dist" / "index.js"
    if not solver_dist.exists():
        pytest.skip("@sovana/solver dist not built yet")

    temporal = normalize_birth_temporal(
        1980,
        8,
        15,
        10,
        30,
        "Đà Nẵng",
        migration_destination="TP. Hồ Chí Minh",
    )
    chart = compile_chart_ir(temporal, "male", cast_mai_hoa=True)
    dag_sha_py = sha256_canonical(evaluate_rules_dag(chart))

    st = create_initial_rectification_state(user_age=30)
    sel_sha_py = sha256_canonical(select_next_question(st))
    st = answer_question(st, "Q-02", "OPT_HOA_CUC")
    st = answer_question(st, "Q-01", "OPT_DAWN_MORN")
    st = answer_question(st, "Q-03", "OPT_TU_SINH")
    rect_sha_py = sha256_canonical(st)

    node_script = (
        "import { normalizeBirthTemporal } from './packages/geo-time/dist/index.js';"
        "import { compileChartIR } from './packages/kernel/dist/index.js';"
        "import { answerQuestion, createInitialRectificationState, evaluateRulesDAG, "
        "selectNextQuestion, sha256Canonical } from './packages/solver/dist/index.js';"
        "const t = normalizeBirthTemporal({ year: 1980, month: 8, day: 15, hour: 10, "
        "minute: 30, location: 'Đà Nẵng', migrationDestination: 'TP. Hồ Chí Minh' });"
        "const c = compileChartIR({ temporal: t, gender: 'male', castMaiHoa: true });"
        "const dagSha = sha256Canonical(evaluateRulesDAG(c));"
        "let st = createInitialRectificationState({ userAge: 30 });"
        "const selSha = sha256Canonical(selectNextQuestion(st));"
        "st = answerQuestion(st, 'Q-02', 'OPT_HOA_CUC');"
        "st = answerQuestion(st, 'Q-01', 'OPT_DAWN_MORN');"
        "st = answerQuestion(st, 'Q-03', 'OPT_TU_SINH');"
        "const rectSha = sha256Canonical(st);"
        "console.log(JSON.stringify({ dagSha, selSha, rectSha }));"
    )
    out = subprocess.check_output(
        ["node", "--input-type=module", "-e", node_script],
        cwd=REPO_ROOT,
        text=True,
        encoding="utf-8",
    )
    ts_hashes = json.loads(out.strip())
    assert dag_sha_py == ts_hashes["dagSha"]
    assert sel_sha_py == ts_hashes["selSha"]
    assert rect_sha_py == ts_hashes["rectSha"]


def test_extended_ziwei_ops_and_liuyao_flags_lockstep() -> None:
    solver_dist = REPO_ROOT / "packages" / "solver" / "dist" / "index.js"
    if not solver_dist.exists():
        pytest.skip("@sovana/solver dist not built yet")

    temporal = normalize_birth_temporal(1980, 8, 15, 0, 30, "Đà Nẵng")
    base_chart = compile_chart_ir(temporal, "male", liuyao_lines=[7, 8, 7, 8, 7, 8])
    chart_dict = base_chart.to_canonical_dict()

    zw_np = chart_dict["ziweiNamPhai"]
    zw_tt = chart_dict["ziweiToanThu"]
    menh_p = next(p for p in zw_np["palaces"] if p["palaceName"] == "Mệnh")
    than_p = next(
        p for p in zw_np["palaces"] if p["isThan"] or p["branchIndex"] == zw_np["thanBranch"]
    )
    no_boc_tt = next(p for p in zw_tt["palaces"] if p["palaceName"] == "Nô Bộc")
    vcd_palace = next(p for p in zw_np["palaces"] if len(p["majorStars"]) == 0)
    pop_palace = next(p for p in zw_np["palaces"] if len(p["majorStars"]) >= 1)

    b_menh = int(menh_p["branchIndex"])
    rel_targets = {
        "opposite": (b_menh + 6) % 12,
        "prev": (b_menh + 11) % 12,
        "next": (b_menh + 1) % 12,
        "nhi_hop": (13 - b_menh) % 12,
    }

    def first_star(branch_idx: int) -> str:
        pal = next(p for p in zw_np["palaces"] if p["branchIndex"] == branch_idx)
        if pal["majorStars"]:
            return str(pal["majorStars"][0]["name"])
        if pal["minorStars"]:
            return str(pal["minorStars"][0]["name"])
        return str(pal["thaiTueStar"])

    two_star_pal = next(
        p
        for p in sorted(zw_np["palaces"], key=lambda x: int(x["branchIndex"]))
        if len(p["majorStars"]) + len(p["minorStars"]) >= 2
    )
    two_stars = [
        str(s["name"]) for s in (two_star_pal["majorStars"] + two_star_pal["minorStars"])[:2]
    ]
    sorted_two = sorted(set(two_stars))

    ly = chart_dict["liuyao"]
    assert ly is not None
    the_idx = next(i for i, ln in enumerate(ly["lines"]) if ln["isThe"])
    the_branch = int(ly["lines"][the_idx]["branchIndex"])
    mod_lines = []
    for i, ln in enumerate(ly["lines"]):
        copy_ln = dict(ln)
        if i == the_idx:
            copy_ln["isMoving"] = False
            copy_ln["elementVi"] = "Hỏa"
            copy_ln["isTuanKhong"] = True
            copy_ln["isNguyetPha"] = False
        elif i == 0:
            copy_ln["isTuanKhong"] = False
            copy_ln["isNguyetPha"] = True
        else:
            copy_ln["isTuanKhong"] = False
            copy_ln["isNguyetPha"] = False
        mod_lines.append(copy_ln)

    chart_dict["liuyao"] = {
        **ly,
        "monthBranchIndex": 2,
        "nhatThanBranch": (the_branch + 6) % 12,
        "lines": mod_lines,
        "phucThan": [
            {
                "lineNumber": 1,
                "missingRelativeVi": "Thê Tài",
                "stemIndex": 0,
                "branchIndex": 4,
                "branchVi": "Thìn",
                "elementVi": "Hỏa",
                "phiThanBranchVi": "Dần",
                "phiThanElementVi": "Mộc",
                "phiThanRelativeVi": "Huynh Đệ",
            },
            {
                "lineNumber": 2,
                "missingRelativeVi": "Quan Quỷ",
                "stemIndex": 1,
                "branchIndex": 6,
                "branchVi": "Ngọ",
                "elementVi": "Mộc",
                "phiThanBranchVi": "Thân",
                "phiThanElementVi": "Kim",
                "phiThanRelativeVi": "Phụ Mẫu",
            },
        ],
    }

    rules = [
        {
            "id": "PY-BRANCH-THAN",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "CAT",
            "when": {
                "op": "palace_branch_in",
                "palace": "Thân",
                "branches": [than_p["branchIndex"]],
            },
            "claimVi": "Cung Thân hợp chi",
            "classicalSource": "Test",
        },
        {
            "id": "PY-BRANCH-NOBOC-TT",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "CAT",
            "when": {
                "op": "palace_branch_in",
                "palace": "Giao Hữu",
                "branches": [no_boc_tt["branchIndex"]],
                "silo": "toan-thu",
            },
            "claimVi": "Giao Hữu Toàn Thư",
            "classicalSource": "Test",
        },
        {
            "id": "PY-REL-OPP",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "CAT",
            "when": {
                "op": "star_in_relative_palace",
                "palace": "Mệnh",
                "relation": "opposite",
                "star": first_star(rel_targets["opposite"]),
            },
            "claimVi": "Đối cung",
            "classicalSource": "Test",
        },
        {
            "id": "PY-REL-PREV",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "CAT",
            "when": {
                "op": "star_in_relative_palace",
                "palace": "Mệnh",
                "relation": "prev",
                "star": first_star(rel_targets["prev"]),
            },
            "claimVi": "Giáp tiền",
            "classicalSource": "Test",
        },
        {
            "id": "PY-REL-NEXT",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "CAT",
            "when": {
                "op": "star_in_relative_palace",
                "palace": "Mệnh",
                "relation": "next",
                "star": first_star(rel_targets["next"]),
            },
            "claimVi": "Giáp hậu",
            "classicalSource": "Test",
        },
        {
            "id": "PY-REL-NHIHOP",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "CAT",
            "when": {
                "op": "star_in_relative_palace",
                "palace": "Mệnh",
                "relation": "nhi_hop",
                "star": first_star(rel_targets["nhi_hop"]),
            },
            "claimVi": "Nhị hợp",
            "classicalSource": "Test",
        },
        {
            "id": "PY-MAJOR-VCD",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "TRUNG",
            "when": {"op": "palace_major_count", "palace": vcd_palace["palaceName"], "exact": 0},
            "claimVi": "Vô Chính Diệu",
            "classicalSource": "Test",
        },
        {
            "id": "PY-MAJOR-RANGE",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "CAT",
            "when": {
                "op": "palace_major_count",
                "palace": pop_palace["palaceName"],
                "min": len(pop_palace["majorStars"]),
                "max": len(pop_palace["majorStars"]),
            },
            "claimVi": "Đúng số chính tinh",
            "classicalSource": "Test",
        },
        {
            "id": "PY-STAR-COUNT",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "CAT",
            "when": {
                "op": "palace_star_count_in",
                "palace": two_star_pal["palaceName"],
                "stars": [two_stars[0], two_stars[0], two_stars[1], "KhongTonTai"],
                "min": 2,
                "max": 2,
            },
            "claimVi": "Đếm sao duy nhất",
            "classicalSource": "Test",
        },
        {
            "id": "PY-COLOC-PALACE",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "CAT",
            "when": {
                "op": "star_co_located",
                "palace": two_star_pal["palaceName"],
                "stars": [two_stars[1], two_stars[0], two_stars[1]],
            },
            "claimVi": "Đồng cung tại cung",
            "classicalSource": "Test",
        },
        {
            "id": "PY-COLOC-ANY",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "CAT",
            "when": {"op": "star_co_located", "stars": [two_stars[1], two_stars[0]]},
            "claimVi": "Đồng cung bất kỳ",
            "classicalSource": "Test",
        },
        {
            "id": "PY-COLOC-EMPTY",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "HUNG",
            "when": {"op": "star_co_located", "stars": []},
            "claimVi": "Rỗng không khớp",
            "classicalSource": "Test",
        },
        {
            "id": "PY-LY-HAS-PHUC",
            "silo": "liuyao",
            "stratum": 1,
            "domain": "quan",
            "polarity": "TRUNG",
            "when": {"op": "liuyao_state_flag", "flag": "hasPhucThan"},
            "claimVi": "Có Phục Thần",
            "classicalSource": "Test",
        },
        {
            "id": "PY-LY-PHI-SINH",
            "silo": "liuyao",
            "stratum": 1,
            "domain": "quan",
            "polarity": "CAT",
            "when": {"op": "liuyao_state_flag", "flag": "phiSinhPhuc"},
            "claimVi": "Phi sinh Phục",
            "classicalSource": "Test",
        },
        {
            "id": "PY-LY-PHI-KHAC",
            "silo": "liuyao",
            "stratum": 1,
            "domain": "quan",
            "polarity": "HUNG",
            "when": {"op": "liuyao_state_flag", "flag": "phiKhacPhuc"},
            "claimVi": "Phi khắc Phục",
            "classicalSource": "Test",
        },
        {
            "id": "PY-LY-PHI-KP",
            "silo": "liuyao",
            "stratum": 1,
            "domain": "quan",
            "polarity": "HUNG",
            "when": {"op": "liuyao_state_flag", "flag": "phiLamKhongPha"},
            "claimVi": "Phi lâm Không Phá",
            "classicalSource": "Test",
        },
        {
            "id": "PY-LY-THE-AMDONG",
            "silo": "liuyao",
            "stratum": 1,
            "domain": "quan",
            "polarity": "CAT",
            "when": {"op": "liuyao_state_flag", "flag": "theAmDong"},
            "claimVi": "Thế Ám Động",
            "classicalSource": "Test",
        },
    ]

    rep = evaluate_rules_dag(chart_dict, rules)
    by_id = {n.node_id: n for n in rep.nodes}
    assert "PY-COLOC-EMPTY" not in by_id
    assert len(by_id) == len(rules) - 1
    assert by_id["PY-COLOC-PALACE"].matched_facts == [
        f"ziwei:nam-phai:star_co_located:{two_star_pal['palaceName']}:{'+'.join(sorted_two)}"
    ]
    assert by_id["PY-COLOC-ANY"].matched_facts == [
        f"ziwei:nam-phai:star_co_located:palace_{two_star_pal['branchIndex']}:{'+'.join(sorted_two)}"
    ]
    assert by_id["PY-LY-THE-AMDONG"].matched_facts == ["liuyao:flag:theAmDong"]

    py_sha = sha256_canonical(rep)
    node_script = (
        "import fs from 'node:fs';"
        "import { evaluateRulesDAG, sha256Canonical } from './packages/solver/dist/index.js';"
        "const payload = JSON.parse(fs.readFileSync(0, 'utf-8'));"
        "console.log(sha256Canonical(evaluateRulesDAG(payload.chart, payload.rules)));"
    )
    ts_sha = subprocess.check_output(
        ["node", "--input-type=module", "-e", node_script],
        cwd=REPO_ROOT,
        input=json.dumps({"chart": chart_dict, "rules": rules}),
        text=True,
        encoding="utf-8",
    ).strip()
    assert py_sha == ts_sha


def test_m3_ziwei_ast_ops_lockstep() -> None:
    solver_dist = REPO_ROOT / "packages" / "solver" / "dist" / "index.js"
    if not solver_dist.exists():
        pytest.skip("@sovana/solver dist not built yet")

    t_vcd = normalize_birth_temporal(1980, 8, 15, 0, 30, "Đà Nẵng")
    c_vcd = compile_chart_ir(t_vcd, "male")
    c_vcd_dict = c_vcd.to_canonical_dict()
    pop_pal = next(p for p in c_vcd_dict["ziweiNamPhai"]["palaces"] if not p["voChinhDieu"])

    c_tu_linh = c_vcd
    for h in range(0, 24, 2):
        t_cand = normalize_birth_temporal(1985, 6, 15, h, 0, "Hà Nội")
        cand = compile_chart_ir(t_cand, "female")
        if cand.ziwei_nam_phai.thai_tue_tam_hop_tu_linh.is_thai_tue_tu_linh_way:
            c_tu_linh = cand
            break
    assert c_tu_linh.ziwei_nam_phai.thai_tue_tam_hop_tu_linh.is_thai_tue_tu_linh_way is True

    rules_vcd = [
        {
            "id": "M3-VCD-T",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "TRUNG",
            "when": {"op": "vo_chinh_dieu", "palace": "Mệnh", "value": True},
            "claimVi": "VCD",
            "classicalSource": "Test",
        },
        {
            "id": "M3-VCD-F",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "CAT",
            "when": {"op": "vo_chinh_dieu", "palace": pop_pal["palaceName"], "value": False},
            "claimVi": "Non-VCD",
            "classicalSource": "Test",
        },
        {
            "id": "M3-TK",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "CAT",
            "when": {"op": "tam_khong_in_tam_phuong", "palace": "Mệnh", "minCount": 1},
            "claimVi": "Tam Khong",
            "classicalSource": "Test",
        },
    ]
    rules_tl = [
        {
            "id": "M3-TL-HOP",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "CAT",
            "when": {"op": "thai_tue_tu_linh", "scope": "tam_hop"},
            "claimVi": "Tu Linh tam hop",
            "classicalSource": "Test",
        },
        {
            "id": "M3-TL-PHUONG",
            "silo": "nam-phai",
            "stratum": 1,
            "domain": "menh",
            "polarity": "CAT",
            "when": {"op": "thai_tue_tu_linh", "scope": "tam_phuong"},
            "claimVi": "Tu Linh tam phuong",
            "classicalSource": "Test",
        },
    ]

    rep1 = evaluate_rules_dag(c_vcd, rules_vcd)
    rep2 = evaluate_rules_dag(c_tu_linh, rules_tl)
    assert [n.node_id for n in rep1.nodes] == ["M3-TK", "M3-VCD-F", "M3-VCD-T"]
    assert [n.node_id for n in rep2.nodes] == ["M3-TL-HOP", "M3-TL-PHUONG"]

    node_script = (
        "import fs from 'node:fs';"
        "import { evaluateRulesDAG, sha256Canonical } from './packages/solver/dist/index.js';"
        "const payload = JSON.parse(fs.readFileSync(0, 'utf-8'));"
        "const out = payload.map((x) => sha256Canonical(evaluateRulesDAG(x.chart, x.rules)));"
        "console.log(JSON.stringify(out));"
    )
    ts_shas = json.loads(
        subprocess.check_output(
            ["node", "--input-type=module", "-e", node_script],
            cwd=REPO_ROOT,
            input=json.dumps([
                {"chart": c_vcd.to_canonical_dict(), "rules": rules_vcd},
                {"chart": c_tu_linh.to_canonical_dict(), "rules": rules_tl},
            ]),
            text=True,
            encoding="utf-8",
        ).strip()
    )
    assert [sha256_canonical(rep1), sha256_canonical(rep2)] == ts_shas


def test_public_rectification_questions_zero_chi_leaks() -> None:
    leak_re = re.compile(r"\b(Tý|Sửu|Dần|Mão|Thìn|Tỵ|Ngọ|Mùi|Thân|Dậu|Tuất|Hợi|Dương chi|Âm chi)\b")
    assert len(PUBLIC_RECTIFICATION_QUESTIONS) == 12
    for q in PUBLIC_RECTIFICATION_QUESTIONS:
        assert leak_re.search(q.prompt_vi) is None
        for opt in q.options:
            assert leak_re.search(opt.label_vi) is None
        assert q.chart_predicates is not None


def test_eval_chart_predicate_ignores_borrowed_major_stars_on_vcd() -> None:
    t_vcd = normalize_birth_temporal(1980, 8, 15, 0, 30, "Đà Nẵng")
    chart = compile_chart_ir(t_vcd, "male")
    vcd_palace = next(
        p
        for p in chart.ziwei_nam_phai.palaces
        if p.vo_chinh_dieu and len(p.borrowed_major_stars) > 0
    )
    borrowed_name = vcd_palace.borrowed_major_stars[0].name
    assert (
        eval_chart_predicate(
            {
                "op": "palace_has_any_star",
                "palace": vcd_palace.palace_name,
                "stars": [borrowed_name],
            },
            chart,
        )
        is False
    )


def test_12_chart_blind_rectification_convergence_and_lockstep() -> None:
    def build_12_charts(y: int, m: int, d: int, g: str) -> list[object]:
        return [
            compile_chart_ir(normalize_birth_temporal(y, m, d, (b * 2) % 24, 0, "Hà Nội"), g)  # type: ignore[arg-type]
            for b in range(12)
        ]

    def run_to_lock(session: object, true_branch: int) -> tuple[object, int]:
        from sovana.solver import RectificationSession

        assert isinstance(session, RectificationSession)
        state = session.state
        steps = 0
        while state.status == "ACTIVE":
            sel = select_next_question(state, session.compiled_bank)
            assert sel is not None
            q = sel.question
            mat = q.likelihood_matrix_micro
            best_opt = max(q.options, key=lambda o: mat[o.id][true_branch]).id
            state = answer_question(state, q.id, best_opt, session.compiled_bank)
            steps += 1
        return state, steps

    window_branches = {
        "SANG": (3, 4, 5),
        "TRUA": (6,),
        "CHIEU": (7, 8, 9),
        "TOI": (9, 10, 11),
        "DEM": (11, 0, 1, 2),
    }

    for y, m, d, g in (
        (1990, 6, 15, "male"),
        (1980, 8, 15, "male"),
        (1985, 3, 25, "female"),
    ):
        charts = build_12_charts(y, m, d, g)
        for b in range(12):
            ex_sess = create_rectification_session_from_charts(
                charts, mode="EXACT_TIME", center_branch=b, user_age=28  # type: ignore[arg-type]
            )
            st_ex, steps_ex = run_to_lock(ex_sess, b)
            assert st_ex.status == "LOCKED"
            assert st_ex.locked_shichen_branch == b
            assert steps_ex <= 5

            uk_sess = create_rectification_session_from_charts(
                charts, mode="UNKNOWN", user_age=28  # type: ignore[arg-type]
            )
            assert uk_sess.state.entropy_millibits == 3585
            st_uk, steps_uk = run_to_lock(uk_sess, b)
            assert st_uk.status == "LOCKED"
            assert st_uk.locked_shichen_branch == b
            assert steps_uk <= 6

        for win, branches in window_branches.items():
            for b in branches:
                wn_sess = create_rectification_session_from_charts(
                    charts,  # type: ignore[arg-type]
                    mode="TIME_WINDOW",
                    birth_time_window=win,  # type: ignore[arg-type]
                    user_age=32,
                )
                st_wn, steps_wn = run_to_lock(wn_sess, b)
                assert st_wn.status == "LOCKED"
                assert st_wn.locked_shichen_branch == b
                assert steps_wn <= 5

    assert compute_certainty_prior_weights("UNKNOWN") == [1] * 12

    solver_dist = REPO_ROOT / "packages" / "solver" / "dist" / "index.js"
    if not solver_dist.exists():
        pytest.skip("@sovana/solver dist not built yet")

    sample_charts = build_12_charts(1980, 8, 15, "male")
    s_ex = create_rectification_session_from_charts(
        sample_charts, mode="EXACT_TIME", ambiguous_branches=[0, 1], center_branch=0, user_age=30  # type: ignore[arg-type]
    )
    s_wn = create_rectification_session_from_charts(
        sample_charts, mode="TIME_WINDOW", birth_time_window="SANG", user_age=30  # type: ignore[arg-type]
    )
    s_uk = create_rectification_session_from_charts(
        sample_charts, mode="UNKNOWN", user_age=30  # type: ignore[arg-type]
    )
    pk = select_next_question(s_uk.state, s_uk.compiled_bank)
    assert pk is not None
    af = answer_question(s_uk.state, pk.question_id, pk.question.options[0].id, s_uk.compiled_bank)
    py_shas = [
        sha256_canonical(s_ex),
        sha256_canonical(s_wn),
        sha256_canonical(s_uk),
        sha256_canonical(pk),
        sha256_canonical(af),
    ]

    node_script = (
        "import fs from 'node:fs';"
        "import { answerQuestion, createRectificationSessionFromCharts,"
        " selectNextQuestion, sha256Canonical } from './packages/solver/dist/index.js';"
        "const charts = JSON.parse(fs.readFileSync(0, 'utf-8'));"
        "const sEx = createRectificationSessionFromCharts(charts, "
        "{ mode: 'EXACT_TIME', ambiguousBranches: [0, 1], centerBranch: 0, userAge: 30 });"
        "const sWn = createRectificationSessionFromCharts(charts, "
        "{ mode: 'TIME_WINDOW', birthTimeWindow: 'SANG', userAge: 30 });"
        "const sUk = createRectificationSessionFromCharts(charts, "
        "{ mode: 'UNKNOWN', userAge: 30 });"
        "const pk = selectNextQuestion(sUk.state, sUk.compiledBank);"
        "const af = answerQuestion(sUk.state, pk.questionId,"
        " pk.question.options[0].id, sUk.compiledBank);"
        "console.log(JSON.stringify(["
        "sha256Canonical(sEx), sha256Canonical(sWn), sha256Canonical(sUk),"
        " sha256Canonical(pk), sha256Canonical(af)]));"
    )
    ts_shas = json.loads(
        subprocess.check_output(
            ["node", "--input-type=module", "-e", node_script],
            cwd=REPO_ROOT,
            input=json.dumps([c.to_canonical_dict() for c in sample_charts]),  # type: ignore[attr-defined]
            text=True,
            encoding="utf-8",
        ).strip()
    )
    assert py_shas == ts_shas
