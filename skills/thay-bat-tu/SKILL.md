---
name: thay-bat-tu
description: Zero-hallucination Four Pillars / Bazi (Tứ Trụ Tử Bình) and Cùng Thông Bảo Giám seasonal balance (Điều Hậu) workflow via @sovana/mcp. Use when the user asks for a Bát Tự / Tứ Trụ chart, Nhật Chủ (Day Master) strength, Dụng Thần / Hỷ Thần, Điều Hậu, Thập Thần, or 10-year Đại Vận cycles.
---

# Thầy Bát Tự — Deterministic Four Pillars & Điều Hậu (`@sovana/mcp`)

Compile and interpret Four Pillars (*Tứ Trụ Tử Bình*) charts with **NASA JPL DE440s Solar Term precision** and quantitative Day Master balance via `@sovana/mcp`.

## Hard Invariants

1. **Solar Terms govern Bazi, NOT Lunar New Year**: The Bazi Year pillar changes at exact astronomical *Lập Xuân* (`315°` ecliptic longitude), and each Month pillar changes at the 12 *Tiết Khí* (*Jie*), never on Lunar Day 1. Always read `temporal.pillars.baziYearPillar` and `baziMonthPillar` from `@sovana/mcp`.
2. **Never eyeball element counts**: Always cite quantitative `dayMasterScoreBps`, `strengthClass` (`THAN_VUONG` | `THAN_NHUOC` | `CAN_BANG`), and `elementScoresBps` returned by `compile_bazi_chart`.
3. **Climate & *Điều Hậu* context**: Always inspect `bazi.dieuHau` (*Cùng Thông Bảo Giám* seasonal conditioning) alongside `bazi.climateAuditNote` and `temporal.location.koppenZone` (tropical monsoon Vietnam vs temperate North China).
4. **Audit trail**: Cite `baziSha256`, `temporal.solarTerm.termNameVi`, and `temporal.uncertainty.isSolarTermBoundaryAmbiguous`.

## Step-by-Step Procedure

### 1. Gather Birth Inputs
Confirm:
- Birth date (Solar or Lunar), birth time (`hour`, `minute`), `gender` (`male` | `female`), and `location`.
- If the user provides a Lunar date, call `convert_vietnam_calendar` (`mode: "lunar_to_solar"`) first.
- If the birth hour is missing, still call `compile_bazi_chart` (noting clearly that ONLY Year, Month, and Day pillars are fixed while the Hour pillar is provisional) and offer `thay-dinh-gio`.

### 2. Call `@sovana/mcp`
1. Call `compile_bazi_chart` with `year`, `month`, `day`, `hour`, `minute`, `gender`, `location`, and `calendarMode: "VN_HISTORICAL"`.
2. Check boundary flags in `temporal.uncertainty`:
   - If `isSolarTermBoundaryAmbiguous: true` (`minSecondsToTermBoundary`), explicitly warn that birth occurred very close to a *Tiết Khí* transition (`temporal.solarTerm.termNameVi` → `nextTermNameVi`).
   - If `isShichenBoundaryAmbiguous: true`, note that the Hour Pillar may shift across the adjacent *shichen*.

### 3. Deliver Structured Four Pillars Analysis
Present cleanly in 5 sections:
1. **Tứ Trụ & Tàng Can (4 Pillars & Hidden Stems)**: Table of Year / Month / Day / Hour showing Stem + Branch (`labelVi`), `stemTenGod`, `hiddenStems` (with weights), `napAmVi`, and `tuanKhongVi` — plus `baziSha256`.
2. **Nhật Chủ & Lượng Hóa Ngũ Hành**:
   - `dayMasterStemVi` (`dayMasterElementVi`), `dayMasterScoreBps`, `strengthClass`.
   - 5-element distribution from `elementScoresBps` (Wood / Fire / Earth / Metal / Water) highlighting dominant and deficient elements.
3. **Điều Hậu (Cùng Thông Bảo Giám) & Khí Hậu Bản Địa**:
   - Report `dieuHau.primaryGodStemsVi` and `dieuHau.summaryVi`.
   - Incorporate `climateAuditNote` and `koppenZone` so seasonal temperature/humidity adjustments fit the user's real Vietnamese geography rather than mechanical formulas.
   - Distinguish **Dụng Thần / Hỷ Thần** (rebalancing elements) vs **Kỵ Thần** (excess/disruptive elements) clearly.
4. **Thập Thần & Hành Trình Đại Vận**:
   - Interpret key *Thập Thần* dynamics (Resource *Ấn*, Output *Thực/Thương*, Wealth *Tài*, Authority *Quan/Sát*, Peers *Tỷ/Kiếp*).
   - Walk through `daiVan` (starting at `daiVanStartAgeYears`), identifying past validating cycles, the active 10-year cycle, and the upcoming pivot decade.
5. **Ứng Dụng Thực Tế**: Career environment, working rhythm, partnership/delegation style, and risk management grounded in the active *Đại Vận* and *Điều Hậu* balance.
