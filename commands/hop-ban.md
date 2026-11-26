---
description: Compare two birth charts deterministically (Hợp Bàn) for Marriage or Business Partnership via @sovana/mcp
---

# `/hop-ban` — Deterministic 2-Chart Synastry (Hợp Bàn)

Follow the `thay-hop-ban` skill strictly.

1. Collect `personA` and `personB` birth details (convert any Lunar dates via `convert_vietnam_calendar` first), relationship goal (`HON_NHAN` Marriage, `HOP_TAC` Business Partnership, or both), and optional `targetYear`.
2. Call `compare_charts_hopban` via `@sovana/mcp`.
3. Present both chart summaries (`sha256`), the 5-pillar quantitative breakdown (`totalScore`, `starRating`, `bondTypeLabelVi`), directional cross-chart *Phi Hóa* (`A_TO_B` and `B_TO_A`), Bazi element complementarity, role/boundary recommendations, and timing windows (`bestTimingHintVi`).
