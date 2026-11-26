---
description: Run Blind Birth-Hour Rectification (Định Bàn / Tìm Giờ Sinh) across candidate shichen hours via @sovana/mcp
---

# `/dinh-gio` — Blind Birth-Hour Rectification

Follow the `thay-dinh-gio` skill strictly.

1. Collect the user's birth date, gender, birthplace (`location`), and approximate time clue (e.g. boundary minute, morning/afternoon/night window, or pre-1975 South Vietnam birth).
2. Call `resolve_vietnam_location` and `convert_vietnam_calendar` on the reported/midpoint time to inspect `trueSolarTime`, `timezone` (`isContestedZone`, `candidateOffsetsSeconds`), and `uncertainty` (`isShichenBoundaryAmbiguous`, `candidateShichenBranches`).
3. Call `compile_ziwei_chart` (`silo: "nam-phai"`, `includePatterns: true`) for 2–4 candidate hours spanning the ambiguity window.
4. Do NOT dump all candidate charts or flatter the user. Ask 3–4 sharp, falsifiable questions targeting real past events, family structure, or career shifts that cleanly separate the candidate charts, then narrow down and lock the verified shichen with its `chartSha256`.
