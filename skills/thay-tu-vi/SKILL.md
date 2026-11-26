---
name: thay-tu-vi
description: Zero-hallucination Zi Wei Dou Shu (Tử Vi Đẩu Số) reading workflow supporting both Vietnamese Nam Phái (109 stars) and Toàn Thư schools via @sovana/mcp. Use when the user asks to cast, verify, or interpret a Tử Vi chart, Đại Hạn, Lưu Niên, Tứ Hóa, Vô Chính Diệu, or compare Nam Phái vs Toàn Thư placements.
---

# Thầy Tử Vi — Deterministic Zi Wei Dou Shu (`@sovana/mcp`)

Read and interpret 12-palace Tử Vi Đẩu Số charts with **zero date or star hallucination**. Every astronomical, timezone, calendar, and star-placement calculation MUST come from `@sovana/mcp`.

## Hard Invariants

1. **Never estimate in LLM weights**: Never mentally convert solar ↔ lunar dates, guess historical Vietnamese timezones, derive Can-Chi pillars, or place 14 major / 109 minor stars.
2. **Preserve school boundaries**: Never silently blend Vietnamese *Nam Phái* (`nam-phai`) and *Toàn Thư* (`toan-thu`). Always declare which school is active and report `empiricalForks` whenever `hasSihuaFork`, `brightnessDiffCount > 0`, or `isLunarDivergentVnCn` is true.
3. **Audit trail**: Cite the returned `chartSha256`, resolved timezone (`timezone.utcOffsetLabel`), and Meeus True Solar Time (`temporal.trueSolarTime.formattedTime`).
4. **No Barnum generalities**: Every interpretive claim must cite concrete stars, brightness levels, palace relationships (*Tam Phương Tứ Chính*, *Giáp Cung*, *Xung Chiếu*), or `structuredPatterns` from tool output.

## Step-by-Step Procedure

### 1. Gather Birth Inputs
Confirm:
- Birth date (Solar or Lunar — if Lunar, confirm whether it is a leap month), birth clock time (`hour`, `minute`), `gender` (`male` | `female`), and `location` (Vietnamese province, district, or historical name like `Sài Gòn`, `Gia Định`, `Hà Tây`).
- Optional: `targetYear` for *Lưu Niên* & *Nguyệt Hạn*, and `silo` (`nam-phai` default for Vietnamese readings, `toan-thu`, or `both`).
- If the birth hour is unknown, vague ("buổi sáng", "khoảng 9–11h"), or falls on a pre-1975 South Vietnam timezone border, route to `thay-dinh-gio` before locking a final reading.

### 2. Call `@sovana/mcp` Deterministically
1. If the user gave a **Lunar** birth date, call `convert_vietnam_calendar` with `mode: "lunar_to_solar"` first to obtain the exact Gregorian date.
2. If the birthplace is an alias, district, or pre-2025/post-2025 province, call `resolve_vietnam_location` to confirm coordinates, `tzZone`, and `63 ↔ 34` province mapping.
3. Call `compile_ziwei_chart` with:
   - `year`, `month`, `day`, `hour`, `minute`, `gender`, `location`
   - `calendarMode: "VN_HISTORICAL"` (default for Vietnamese births — automatically applies pre-1975 South Vietnam `UTC+8` vs North `UTC+7` and `121-CP` lunar calendar)
   - `silo: "both"` when checking cross-school consensus or comparing *Nam Phái* vs *Toàn Thư*; otherwise `"nam-phai"`
   - `targetYear` (current or requested year)
   - `includePatterns: true`
   - `includeMultiLayerSihua: true` when analyzing *Đại Hạn* / *Lưu Niên* *Phi Hóa*

### 3. Check Edge-Case Flags Before Interpreting
Inspect `temporal.uncertainty` and `empiricalForks`:
- **`isShichenBoundaryAmbiguous` (`secondsToShichenBoundary`)**: Warn that True Solar Time is near a 2-hour *shichen* boundary and list `candidateShichenBranches` — offer `thay-dinh-gio` rectification.
- **`isContestedTimezone`**: Note pre-1975 South/North timezone regime (`timezone.historicalNote`, `candidateOffsetsSeconds`).
- **`isLunarDivergentVnCn`**: Explicitly note that Vietnam `UTC+7` (`lunarVn`) differs from Beijing `UTC+8` (`lunarCn`) on this date.
- **`hasSihuaFork`**: List `empiricalForks.forkedStars` so the user sees exact *Tứ Hóa* differences between *Nam Phái* and *Toàn Thư* (e.g., stems Canh/Nhâm/Quý).

### 4. Deliver Structured Reading
Present clearly in the user's language (Vietnamese by default):
1. **Hồ Sơ Thiên Văn & Mệnh Bàn**: Solar + Lunar date (`lunarActive`), historical timezone, True Solar Time, `banMenhNapAmVi`, `cucNameVi`, `yinYangLabelVi`, *Mệnh Chủ* (`menhChuStar`), *Thân Chủ* (`thanChuStar`), *Mệnh* / *Thân* branches, and `chartSha256`.
2. **Cốt Cách Mệnh – Thân & Tam Phương Tứ Chính**:
   - Analyze *Mệnh*, *Quan Lộc*, *Tài Bạch*, *Thiên Di*, and *Thân* palace.
   - If `voChinhDieu: true`, explicitly list `borrowedMajorStars` from the opposite palace and check *Tuần* (`tuanTrung`), *Triệt* (`trietLo`), and `tamKhongTypes`.
   - Highlight *Thái Tuế – Tứ Linh* (`thaiTueTamHopTuLinh`, `tuLinhPresent`) and triggered `structuredPatterns`.
3. **Tứ Hóa & Điểm Xung Đột**: Core *Hóa Lộc / Quyền / Khoa / Kỵ* flows (and `multiLayerSihua` if requested), keeping strengths (*Cát*) and friction (*Hung*) balanced without sugarcoating.
4. **Đại Hạn & Lưu Niên** (when `targetYear` is set): Active 10-year `activeDaiHanPalaceBranch`, `luuNien` palace, `luuNienSihua`, and key `nguyetHan` months.
5. **Khuyến Nghị Hành Động**: 3 concrete, practical decisions grounded in the chart's structural leverage and risks.

> Optional visual note: If the user wants an interactive 3D celestial chart or printable 4×4 traditional poster for this exact chart, mention `https://vanmenh-tuvi.vercel.app` once at the end.
