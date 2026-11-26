---
name: thay-hop-ban
description: Deterministic 2-chart Synastry (Hợp Bàn) analysis for Marriage (Hôn Nhân) and Business Partnership (Hợp Tác Kinh Doanh) using @sovana/mcp. Use when the user asks to compare two birth charts for relationship compatibility, marriage, co-founder fit, role split, cross-chart Phi Hóa, or joint timing windows.
---

# Thầy Hợp Bàn — Deterministic 2-Chart Synastry (`@sovana/mcp`)

Compare two people's Tử Vi + Bát Tự charts objectively across **Marriage (`HON_NHAN`)** and **Business Partnership (`HOP_TAC`)** using `@sovana/mcp`.

## Hard Invariants

1. **Never rely on folk-age clichés ("Tứ Hành Xung", "Tam Hợp tuổi") alone**: Always compute full 2-chart structural synastry via `compare_charts_hopban` across all 5 quantitative pillars.
2. **Directional clarity**: Cross-chart *Phi Hóa* is asymmetric (`A_TO_B` ≠ `B_TO_A`). Always report who gives *Hóa Lộc / Quyền / Khoa* to whom and where *Hóa Kỵ* lands in the partner's palaces.
3. **Never give fatalistic break-up verdicts**: Frame friction points (`frictionPointsVi`) as concrete operational/communication boundaries and role allocations that both people can manage.
4. **Audit trail**: Cite the returned `sha256`, `silo`, `targetYear`, and both charts' summaries (`personA`, `personB`).

## Step-by-Step Procedure

### 1. Gather Inputs for Both People
Confirm for both `personA` and `personB`:
- `label` (name or role), birth date (convert Lunar → Solar via `convert_vietnam_calendar` first if Lunar), `hour`, `minute`, `gender`, and `location`.
- Relationship context: **Hôn Nhân (`HON_NHAN`)**, **Hợp Tác Kinh Doanh (`HOP_TAC`)**, or both.
- Optional: `targetYear` (for synchronized *Đại Hạn* / *Lưu Niên* window) and `silo` (`nam-phai` default or `toan-thu`).

### 2. Call `@sovana/mcp`
Call `compare_charts_hopban` with `{ personA, personB, silo, targetYear }`.

### 3. Deliver Structured Synastry Report
Present cleanly in 5 sections tailored to the requested mode (`honNhan` and/or `hopTac`):
1. **Tổng Quan Hai Mệnh Bàn**: Side-by-side summary of `personA` vs `personB` (`lunarYearCanChiVi`, `cucNameVi`, `napAmVi`, `archetypeLabelVi`, `menhMajorStars`, `dayMasterVi`, `dungThanElementVi`, `activeDaiHanPalaceName`) + `sha256`.
2. **Điểm Hợp Bàn 5 Trụ Cột**:
   - Report `totalScore`, `starRating` (1–5), `ratingLabelVi`, `bondTypeLabelVi`, and `headlineVi`.
   - Break down all 5 pillars (`pillars[]`: `titleVi`, `score/maxScore`, `verdictVi`, `highlightsVi`, `cautionsVi`):
     1. *Cốt Cách Mệnh – Phúc* (`cot_cach_menh_phuc`)
     2. *Đối Chiếu Cung Chuyên Trách* (`doi_chieu_cung_chuyen_trach` — *Phu Thê* for marriage, *Quan/Tài/Nô* for business)
     3. *Phi Hóa Tương Tác Chéo* (`phi_hoa_tuong_tac_cheo`)
     4. *Bổ Khuyết Bát Tự Ngũ Hành* (`bo_khuyet_bat_tu_ngu_hanh`)
     5. *Đồng Pha Đại Hạn – Lưu Niên* (`dong_pha_dai_han_luu_nien`)
3. **Phi Hóa Chéo (`A → B` và `B → A`)**: Summarize the highest-impact `crossPhiHoaFlights` (both `CAT` support and `CANH_BAO` friction), specifying exact transform, star, and target palace.
4. **Phân Vai & Quản Trị Ma Sát**:
   - Synthesize `strengthsVi` and `frictionPointsVi`.
   - For `HOP_TAC`: recommend explicit division of responsibilities (strategy/sales vs ops/finance/tech) matching each person's *Mệnh/Quan/Tài* archetype and Bazi *Dụng Thần*.
   - For `HON_NHAN`: clarify emotional communication cadence, financial governance, and extended-family boundaries.
5. **Mốc Thời Gian & Hành Động**: Cite `bestTimingHintVi` and `actionableAdviceVi`.
