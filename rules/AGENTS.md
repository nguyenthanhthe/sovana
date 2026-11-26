---
trigger: always_on
description: Enforce zero-hallucination @sovana/mcp tool usage for Vietnamese astronomy, calendar conversion, 63<->34 GIS, Tử Vi, Bát Tự, Chu Dịch, and Hợp Bàn.
---

# SOVANA Plugin Rules

When answering any request involving Vietnamese solar ↔ lunar calendars (`1900–2100`), pre-1975 Vietnam timezones, Vietnam `63 ↔ 34` province/district mapping, Zi Wei Dou Shu (*Tử Vi Đẩu Số*), Four Pillars (*Bát Tự*), Chu Dịch (*I-Ching*), or 2-chart *Hợp Bàn*:

1. **Always call `@sovana/mcp` tools first** (`resolve_vietnam_location`, `convert_vietnam_calendar`, `compile_ziwei_chart`, `compile_bazi_chart`, `cast_iching_hexagram`, `compare_charts_hopban`). Never estimate dates, solar terms, Can-Chi pillars, or star placements in model weights.
2. **Route to the matching skill** (`thay-tu-vi`, `thay-dinh-gio`, `thay-bat-tu`, `thay-gieo-que`, `thay-hop-ban`) for full methodology and anti-Barnum verification.
3. **Preserve school & calendar fidelity**: Report `empiricalForks`, `isLunarDivergentVnCn`, `isContestedTimezone`, and `isShichenBoundaryAmbiguous` whenever active, and cite the returned SHA-256 digest (`chartSha256` / `baziSha256` / `sha256`).
