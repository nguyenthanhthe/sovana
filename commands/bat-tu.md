---
description: Compile and interpret a deterministic Four Pillars / Bazi (Tứ Trụ Tử Bình) & Điều Hậu chart via @sovana/mcp
---

# `/bat-tu` — Deterministic Four Pillars (Bát Tự) & Điều Hậu

Follow the `thay-bat-tu` skill strictly.

1. Parse birth date (convert Lunar → Solar via `convert_vietnam_calendar` if Lunar), birth time, gender, and birthplace (`location`).
2. Call `compile_bazi_chart` (`calendarMode: "VN_HISTORICAL"`) via `@sovana/mcp`. Never derive Year/Month pillars from Lunar New Year — rely exclusively on the DE440s Solar Term (`Lập Xuân` & 12 *Tiết Khí*) output.
3. Present the 4 Pillars + Hidden Stems table (`baziSha256`), quantitative Day Master strength (`dayMasterScoreBps`, `strengthClass`, `elementScoresBps`), *Cùng Thông Bảo Giám* `dieuHau` adjusted by `climateAuditNote` / `koppenZone`, active 10-year `daiVan`, and practical recommendations.
