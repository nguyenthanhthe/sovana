"""Python half of the 1,200-vector End-to-End Full-Stack SHA-256 Lockstep Verifier.

Executes:
  normalize_birth_temporal -> compile_chart_ir (nam-phai + toan-thu + bazi + liuyao)
  -> evaluate_rules_dag (public_rules_50.json) -> Shannon-Entropy Rectification step
and verifies Church-Rosser Confluence in Python as well.
"""

from __future__ import annotations

import hashlib
import inspect
import json
import random
import sys
import time
from pathlib import Path
from typing import Any

import sovana.solver as solver_pkg
from sovana.geo_time import normalize_birth_temporal, sha256_canonical
from sovana.kernel import compile_chart_ir

REPO_ROOT = Path(__file__).resolve().parents[2]


def _init_rect_state(candidate_branches: list[int], user_age: int, max_questions: int) -> Any:
    fn = solver_pkg.create_initial_rectification_state
    sig = inspect.signature(fn)
    params = list(sig.parameters.keys())
    if params and params[0] in ("options", "config", "inp", "input_data"):
        return fn(
            {
                "candidateBranches": candidate_branches,
                "candidateShichenBranches": candidate_branches,
                "userAge": user_age,
                "maxQuestions": max_questions,
            }
        )
    kwargs: dict[str, Any] = {}
    if "candidate_branches" in sig.parameters:
        kwargs["candidate_branches"] = candidate_branches
    elif "candidate_shichen_branches" in sig.parameters:
        kwargs["candidate_shichen_branches"] = candidate_branches
    if "user_age" in sig.parameters:
        kwargs["user_age"] = user_age
    if "max_questions" in sig.parameters:
        kwargs["max_questions"] = max_questions
    return fn(**kwargs)


def _compile_chart(temporal: Any, v: dict[str, Any]) -> Any:
    sig = inspect.signature(compile_chart_ir)
    params = list(sig.parameters.keys())
    liuyao_lines = v["liuyaoLines"] if v["liuyaoMode"] == "manual" else None
    cast_mai_hoa = v["liuyaoMode"] == "mai-hoa"
    if len(params) == 1 and params[0] in ("inp", "input_data", "options", "params"):
        return compile_chart_ir(
            {
                "temporal": temporal,
                "gender": v["gender"],
                "targetYear": v.get("targetYear"),
                "liuyaoLines": liuyao_lines,
                "castMaiHoa": cast_mai_hoa,
            }
        )
    return compile_chart_ir(
        temporal=temporal,
        gender=v["gender"],
        target_year=v.get("targetYear"),
        liuyao_lines=liuyao_lines,
        cast_mai_hoa=cast_mai_hoa,
    )


def evaluate_single_vector(v: dict[str, Any]) -> dict[str, Any]:
    b = v["birth"]
    temporal = normalize_birth_temporal(
        year=b["year"],
        month=b["month"],
        day=b["day"],
        hour=b["hour"],
        minute=b["minute"],
        second=b.get("second", 0),
        location=b["location"],
        iana_time_zone=b.get("ianaTimeZone"),
        calendar_mode=b.get("calendarMode", "VN_HISTORICAL"),
        leap_month_policy=b.get("leapMonthPolicy", "split-15"),
        late_zi_policy=b.get("lateZiPolicy", "next-day"),
        migration_destination=b.get("migrationDestination"),
    )
    chart = _compile_chart(temporal, v)
    dag_report = solver_pkg.evaluate_rules_dag(chart)

    rect_init = _init_rect_state(v["candidateBranches"], v["userAge"], 5)
    next_pick = solver_pkg.select_next_question(rect_init)
    rect_after = rect_init
    chosen_opt_id: str | None = None
    if next_pick is not None:
        q = getattr(next_pick, "question", None) or next_pick["question"]
        opts = list(getattr(q, "options", None) or q["options"])
        q_id = getattr(next_pick, "question_id", None) or next_pick["questionId"]
        gain = getattr(next_pick, "expected_info_gain_millibits", None)
        if gain is None:
            gain = next_pick["expectedInfoGainMillibits"]
        if opts:
            opt = opts[v["answerOptionIdx"] % len(opts)]
            chosen_opt_id = getattr(opt, "id", None) or opt["id"]
            rect_after = solver_pkg.answer_question(rect_init, q_id, chosen_opt_id)
    else:
        q_id = None
        gain = 0

    return {
        "chart": chart,
        "dagReport": dag_report,
        "rectification": {
            "initial": rect_init,
            "selectedQuestionId": q_id,
            "expectedInfoGainMillibits": gain,
            "chosenOptionId": chosen_opt_id,
            "updated": rect_after,
        },
    }


def verify_python_church_rosser(sample_chart: Any) -> bool:
    rules_path = REPO_ROOT / "specs" / "sample_rules" / "public_rules_50.json"
    raw = json.loads(rules_path.read_text(encoding="utf-8"))
    rules = raw if isinstance(raw, list) else raw["rules"]
    base_hash = sha256_canonical(solver_pkg.evaluate_rules_dag(sample_chart, rules))
    rng = random.Random(20261125)
    for _ in range(30):
        perm = list(rules)
        rng.shuffle(perm)
        if sha256_canonical(solver_pkg.evaluate_rules_dag(sample_chart, perm)) != base_hash:
            return False
    return True


def main() -> None:
    in_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])
    payload = json.loads(in_path.read_text(encoding="utf-8"))
    vectors: list[dict[str, Any]] = payload["vectors"]

    # Warmup
    first_out = evaluate_single_vector(vectors[0])
    cr_ok = verify_python_church_rosser(first_out["chart"])
    if not cr_ok:
        raise RuntimeError("Python Church-Rosser Confluence check failed!")

    full_hashes: list[str] = []
    chart_hashes: list[str] = []
    dag_hashes: list[str] = []
    rect_hashes: list[str] = []
    agg = hashlib.sha256()

    t0 = time.perf_counter()
    for v in vectors:
        out = evaluate_single_vector(v)
        ch_h = sha256_canonical(out["chart"])
        dg_h = sha256_canonical(out["dagReport"])
        rc_h = sha256_canonical(out["rectification"])
        fl_h = sha256_canonical(out)

        chart_hashes.append(ch_h)
        dag_hashes.append(dg_h)
        rect_hashes.append(rc_h)
        full_hashes.append(fl_h)
        agg.update(fl_h.encode("ascii"))
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    res = {
        "vectorCount": len(vectors),
        "aggregateSha256": agg.hexdigest(),
        "fullHashes": full_hashes,
        "chartHashes": chart_hashes,
        "dagHashes": dag_hashes,
        "rectHashes": rect_hashes,
        "elapsedMs": round(elapsed_ms, 2),
        "msPerVector": round(elapsed_ms / max(1, len(vectors)), 4),
        "pyChurchRosserVerified": cr_ok,
    }
    out_path.write_text(json.dumps(res), encoding="utf-8")


if __name__ == "__main__":
    main()
