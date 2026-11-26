---
description: Cast and interpret a zero-hallucination Zi Wei Dou Shu (Tử Vi Đẩu Số) chart via @sovana/mcp (Nam Phái 109 stars & Toàn Thư)
---

# `/tu-vi` — Deterministic Tử Vi Đẩu Số Chart & Reading

Follow the `thay-tu-vi` skill strictly.

1. Parse the user's birth date (Solar or Lunar), clock time (`hour`, `minute`), gender (`male` | `female`), birthplace (`location`), optional `targetYear`, and school (`nam-phai`, `toan-thu`, or `both`). If any required field is missing, ask concisely before calling tools.
2. Never compute lunar dates, timezones, or star positions manually. Invoke `@sovana/mcp` tools:
   - `convert_vietnam_calendar` (`mode: "lunar_to_solar"`) if a Lunar date was supplied.
   - `resolve_vietnam_location` if the birthplace is a district, alias, or pre/post-2025 province name.
   - `compile_ziwei_chart` (`calendarMode: "VN_HISTORICAL"`, `includePatterns: true`, `includeMultiLayerSihua: true` when `targetYear` is set).
3. Surface any `temporal.uncertainty` boundary flags or `empiricalForks` divergences upfront. If the birth hour is unknown or right on a shichen boundary, recommend `/dinh-gio`.
4. Output a crisp, anti-Barnum reading covering Astronomical Profile (`chartSha256`), Mệnh–Thân & Tam Phương Tứ Chính, Tứ Hóa & Patterns, Đại Hạn / Lưu Niên, and 3 concrete actions.
