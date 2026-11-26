# SOVANA Agent Operating Rules

This repository ships the **SOVANA** deterministic astronomical ephemeris (`NASA JPL DE440s`), bi-temporal Vietnam GIS (`63 ↔ 34` provinces under `Nghị quyết 202/2025/QH15`), historical Vietnam timezone resolver, and multi-system symbolic calculation engine (`@sovana/geo-time`, `@sovana/kernel`, `@sovana/solver`, `@sovana/mcp`, and Python `sovana`).

## Mandatory Zero-Hallucination Rules

1. **Never compute astronomical, calendar, or chart data in LLM weights.** Whenever a task involves Vietnamese solar ↔ lunar conversion, historical pre-1975 South/North timezones, Meeus True Solar Time, 24 Solar Terms, Vietnam `63 ↔ 34` province lookup, Zi Wei Dou Shu (*Tử Vi*), Four Pillars (*Bát Tự*), Chu Dịch (*I-Ching*), or 2-chart *Hợp Bàn* synastry, **always invoke the `@sovana/mcp` server tools**:
   - `resolve_vietnam_location`
   - `convert_vietnam_calendar`
   - `compile_ziwei_chart`
   - `compile_bazi_chart`
   - `cast_iching_hexagram`
   - `compare_charts_hopban`
2. **Cite deterministic audit digests.** Include the returned `chartSha256` / `baziSha256` / `sha256` and active calendar/school metadata (`calendarMode`, `silo`, `empiricalForks`) in analytical outputs.
3. **Never silently mix schools or calendars.** Preserve the boundary between Vietnamese *Nam Phái* (`nam-phai`) and *Toàn Thư* (`toan-thu`), and explicitly flag `isLunarDivergentVnCn`, `isContestedTimezone`, and `isShichenBoundaryAmbiguous` whenever returned by the engine.
4. **Follow bundled specialist skills (`skills/`):**
   - `thay-tu-vi` — Zi Wei Dou Shu (*Tử Vi Đẩu Số*)
   - `thay-dinh-gio` — Blind Birth-Hour Rectification (*Định Bàn*)
   - `thay-bat-tu` — Four Pillars (*Bát Tự*) & *Cùng Thông Bảo Giám* (*Điều Hậu*)
   - `thay-gieo-que` — 64-Hexagram Chu Dịch (*Mai Hoa* & *Lục Hào*)
   - `thay-hop-ban` — 2-Chart Synastry (*Hợp Bàn* Marriage & Business Partnership)

## Repository Development Invariants

- **Clean-Room MIT Purity**: Keep this repository 100% clean-room MIT. Never import or cite non-commercial (`CC BY-NC-SA`) corpora or external proprietary rulebooks.
- **Polyglot Lockstep**: Any calculation change in TypeScript (`packages/*`) MUST maintain `0` mismatches against Python (`python/sovana`) via `pnpm verify:lockstep`.
- **Zero Runtime Dependencies**: `@sovana/geo-time`, `@sovana/kernel`, `@sovana/solver`, and `@sovana/mcp` have zero third-party runtime dependencies; preserve this invariant.
