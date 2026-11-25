"""Pydantic v2 models for sovana.solver (100% Canonical JSON lockstep with @sovana/solver)."""

from __future__ import annotations

from typing import Any, Literal

from sovana.geo_time.models import PillarPair, SovanaModel

RuleSilo = Literal["nam-phai", "toan-thu", "bazi", "liuyao", "cross"]
RulePolarity = Literal["CAT", "HUNG", "TRUNG"]
ConflictKind = Literal["CROSS_SILO", "INTRA_SILO_PARACONSISTENT"]
RectificationCategory = Literal[
    "RETRODICTIVE_TIMELINE",
    "SOMATIC_MEDICAL",
    "KINSHIP_TOPOLOGY",
]
RectificationStatus = Literal["ACTIVE", "LOCKED", "INVARIANT_INTERSECTION"]
BirthTimeCertaintyMode = Literal["EXACT_TIME", "TIME_WINDOW", "UNKNOWN"]
BirthTimeWindow = Literal["SANG", "TRUA", "CHIEU", "TOI", "DEM"]
MenhBranchGroup = Literal["TU_CHINH", "TU_MO", "TU_SINH"]
ChartPredicate = dict[str, Any]


class ContextFilterEcho(SovanaModel):
    career_category: str | None = None
    setting: str | None = None


class ProvenanceNode(SovanaModel):
    node_id: str
    silo: RuleSilo
    stratum: int
    proof_depth: int
    domain: str
    polarity: RulePolarity
    claim_vi: str
    actionable_advice_vi: str | None = None
    classical_source: str
    parent_node_ids: list[str]
    matched_facts: list[str]


class ParaconsistentConflict(SovanaModel):
    conflict_id: str
    domain: str
    kind: ConflictKind
    positive_node_ids: list[str]
    negative_node_ids: list[str]
    resolution_hint_vi: str


class SolverReportIR(SovanaModel):
    schema_version: str = "1.0.0"
    total_rules_evaluated: int
    strata_evaluated: list[int]
    context_filter: ContextFilterEcho | None = None
    nodes: list[ProvenanceNode]
    conflicts: list[ParaconsistentConflict]


class RectificationOption(SovanaModel):
    id: str
    label_vi: str


class RectificationQuestion(SovanaModel):
    id: str
    category: RectificationCategory
    age_cohort: str | None = None
    min_age: int | None = None
    max_age: int | None = None
    prompt_vi: str
    options: list[RectificationOption]
    likelihood_matrix_micro: Any
    chart_predicates: dict[str, ChartPredicate] | None = None


class ChartRectificationFeatures(SovanaModel):
    shichen_branch: int
    shichen_branch_vi: str
    menh_branch: int
    than_branch: int
    than_palace_name: str
    cuc_number: int
    menh_vo_chinh_dieu: bool
    menh_parity: int
    menh_major_stars: list[str]
    palace_signature_tags: dict[str, list[str]]


class RectificationCandidate(SovanaModel):
    shichen_branch: int
    shichen_branch_vi: str
    prob_micro: int


class RectificationAnswerRecord(SovanaModel):
    question_id: str
    option_id: str
    entropy_before_millibits: int
    entropy_after_millibits: int


class RectificationState(SovanaModel):
    schema_version: str = "1.0.0"
    status: RectificationStatus
    candidates: list[RectificationCandidate]
    entropy_millibits: int
    asked_question_ids: list[str]
    answers: list[RectificationAnswerRecord]
    max_questions: int
    user_age: int | None = None
    locked_shichen_branch: int | None = None
    top1_prob_micro: int
    top2_prob_micro: int


class QuestionSelectionResult(SovanaModel):
    question: RectificationQuestion
    question_id: str
    current_entropy_millibits: int
    expected_posterior_entropy_millibits: int
    expected_info_gain_millibits: int


class InvariantBaziPillars(SovanaModel):
    year_pillar: PillarPair
    month_pillar: PillarPair
    day_pillar: PillarPair


class InvariantIntersectionReport(SovanaModel):
    schema_version: str = "1.0.0"
    mode: Literal["INVARIANT_INTERSECTION"] = "INVARIANT_INTERSECTION"
    surviving_candidate_count: int
    surviving_branches: list[int]
    invariant_nodes: list[ProvenanceNode]
    invariant_claims_vi: list[str]
    invariant_bazi_pillars: InvariantBaziPillars


class RectificationSession(SovanaModel):
    state: RectificationState
    compiled_bank: list[RectificationQuestion]
    chart_features: list[ChartRectificationFeatures]
