---
name: thay-gieo-que
description: Deterministic 64-hexagram Chu Dịch / I-Ching divination workflow supporting both Mai Hoa Dịch Số (timestamp-based) and 6-line Lục Hào (coin values 6, 7, 8, 9) via @sovana/mcp. Use when the user wants to cast a hexagram, interpret coin tosses, or analyze a specific concrete decision with Chu Dịch.
---

# Thầy Gieo Quẻ — Deterministic Chu Dịch & Lục Hào (`@sovana/mcp`)

Cast and interpret 64-hexagram Chu Dịch readings (*Mai Hoa Dịch Số* and *Lục Hào Nạp Giáp*) deterministically through `@sovana/mcp`.

## Hard Invariants

1. **One concrete question per cast**: Before casting, ensure the question has a clear subject, direction, and timeframe (e.g. "Nhận offer công ty X trong tháng tới có thuận không?"). Do not cast blindly for vague "xem chung vận hạn".
2. **Never fabricate hexagrams, Nạp Giáp, or Six Beasts**: Always call `cast_iching_hexagram` and read `primaryHexagram`, `transformedHexagram`, `movingLines`, `lines[]`, and `phucThan` directly from the tool output.
3. **No repeated re-casting ("bất tái độc")**: Do not re-cast the same question in the same session to fish for a happier hexagram; work honestly with the first cast and cite its `sha256`.

## Step-by-Step Procedure

### 1. Select Casting Method
- **Lục Hào (Manual 6-line coin toss)**: If the user provides 6 coin values bottom-to-top (`6` Old Yin / Lão Âm, `7` Young Yang / Thiếu Dương, `8` Young Yin / Thiếu Âm, `9` Old Yang / Lão Dương), pass `lines: [l1, l2, l3, l4, l5, l6]`.
- **Mai Hoa Dịch Số (Instant timestamp)**: If the user asks to cast now without coins, omit `lines` (optionally pass `location` for Vietnam `UTC+7` inquiry time and explicit `nowMs` if analyzing a recorded moment).

### 2. Call `@sovana/mcp`
Call `cast_iching_hexagram` with `{ location }` (plus `lines` and/or `nowMs` when supplied).

### 3. Identify the *Dụng Thần* (Focus Relative)
Map the user's question to the classical *Lục Thân* relative in `divination.liuyao.lines`:
- Self / overall situation → **Hào Thế** (`isThe: true`) vs counterparty / destination → **Hào Ứng** (`isUng: true`)
- Money, business profit, investment, wife (traditional) → **Thê Tài**
- Job, title, legal authority, exams, husband (traditional) → **Quan Quỷ**
- Contracts, documents, studies, parents, house, vehicle → **Phụ Mẫu**
- Solutions, medical recovery, creative output, children, subordinates → **Tử Tôn**
- Competitors, peers, siblings, cash drain / cost sharing → **Huynh Đệ**
- If the focus relative is absent from the 6 primary lines, inspect `phucThan` (*Phục Thần* hidden beneath *Phi Thần*).

### 4. Deliver 3-Tier Anti-Barnum Reading
1. **Tượng Quẻ & Audit**:
   - State `primaryHexagram.nameVi` (`kingWenNumber`, `upperTrigram` / `lowerTrigram`, `houseNameVi` / `houseElementVi`) → `transformedHexagram.nameVi` (if `movingLines.length > 0`).
   - Show the 6-line table (`lineNumber` 6 down to 1): Yin/Yang, Moving marker, `stemVi`+`branchVi` (`elementVi`), `relativeVi`, `beastVi`, `Thế`/`Ứng`, `Tuần Không` (`isTuanKhong`), `Nguyệt Phá` (`isNguyetPha`), and transformed line (`transformedBranchVi` / `transformedRelativeVi`) — plus `sha256`.
2. **Luận Thế – Ứng, Dụng Thần & Hào Động**:
   - Evaluate interaction between *Thế* and *Ứng* (support, clash, alliance, or void).
   - Diagnose the *Dụng Thần* strength, whether it is *Tuần Không* (hollow/delayed until filled) or *Nguyệt Phá* (pressured/broken), and how each moving line transforms (*Tiến Thần / Thoái Thần / Hồi Đầu Sinh / Hồi Đầu Khắc*).
   - Give a clear, falsifiable bottom-line verdict (Thuận / Chậm nhưng thành / Trở ngại cần đổi hướng / Nên dừng).
3. **Hành Động & Mốc Ứng Kỳ**:
   - Concrete timing cues (when *Tuần Không* fills or key branch arrives) and 2–3 actionable steps the user controls right now.
