---
description: Cast and interpret a deterministic 64-hexagram Chu Dịch (Mai Hoa Dịch Số or 6-line Lục Hào) reading via @sovana/mcp
---

# `/gieo-que` — Deterministic Chu Dịch & Lục Hào Casting

Follow the `thay-gieo-que` skill strictly.

1. Confirm the user's single concrete question and timeframe. Check if they provided 6 coin values bottom-to-top (`[6|7|8|9]`) for *Lục Hào*; otherwise cast *Mai Hoa Dịch Số* at the inquiry instant.
2. Call `cast_iching_hexagram` via `@sovana/mcp` (never fabricate hexagrams, Nạp Giáp, or Six Beasts).
3. Output the Primary → Transformed hexagram, 6-line table (*Thế/Ứng*, *Lục Thân*, *Lục Thú*, *Tuần Không*, *Nguyệt Phá*, *Phục Thần* if needed, `sha256`), clear *Dụng Thần* verdict, timing cues, and 2–3 concrete actions.
