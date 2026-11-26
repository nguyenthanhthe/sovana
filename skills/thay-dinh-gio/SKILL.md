---
name: thay-dinh-gio
description: Blind Birth-Hour Rectification (Định Bàn / Tìm Giờ Sinh) workflow using @sovana/mcp when birth hour is unknown, approximate, near a True Solar Time shichen boundary, or affected by pre-1975 South Vietnam UTC+8 vs UTC+7 timezones. Use when the user does not know their exact birth hour or wants to verify which shichen matches their real life history.
---

# Thầy Định Giờ — Blind Birth-Hour Rectification (`@sovana/mcp`)

Narrow an uncertain birth time down to a verified 2-hour *shichen* (*giờ Tý → Hợi*) using deterministic True Solar Time boundary checks and falsifiable life-history discriminators.

## Hard Invariants

1. **Never guess a birth hour from personality flattering**: Distinguish candidate charts ONLY using falsifiable structural differences (past timeline milestones, family/kinship topology, physical/somatic signatures, career pivots, or major relocations).
2. **Always check True Solar Time & historical timezone first**: A clock time like `11:05` in Tây Nguyên or `01:15` in pre-1975 Sài Gòn (`UTC+8`) often belongs to the adjacent *shichen* under Meeus True Solar Time.
3. **No premature lock**: If multiple candidate hours remain plausible after questioning, state the surviving branches transparently and report only the **invariant facts** shared across surviving candidates (e.g., Year/Month/Day Bazi pillars).

## Step-by-Step Procedure

### 1. Define the Candidate Search Window
Collect:
- Birth date (Solar or Lunar), `gender`, `location`, and whatever time hint the user remembers:
  - **Boundary case** (e.g. `12:55`, `23:05`, pre-1975 South Vietnam): test the reported time and adjacent ±1 *shichen* (2–3 candidates).
  - **Window case** (e.g. "buổi sáng", "sau bữa trưa", "gần nửa đêm"): test the 2–4 *shichen* branches spanning that window.
  - **Unknown full day**: start by inspecting the 3 invariant Bazi pillars via `compile_bazi_chart` and ask the user whether family memory narrows day vs night before enumerating representative hours (`00:00, 02:00, 04:00, ..., 22:00`).

### 2. Inspect Astronomical Boundaries via `@sovana/mcp`
1. Call `resolve_vietnam_location` for the exact birthplace (longitude shifts True Solar Time by 4 minutes per degree from the standard meridian).
2. Call `convert_vietnam_calendar` on the reported time (or midpoint of the window) and inspect:
   - `temporal.timezone.utcOffsetLabel`, `isContestedZone`, `candidateOffsetsSeconds`
   - `temporal.trueSolarTime.formattedTime`, `shichenBranchVi`, `isLateZi`, `secondsToShichenBoundary`
   - `temporal.uncertainty.isShichenBoundaryAmbiguous`, `candidateShichenBranches`, `wideLongitudeWarning`
3. Call `compile_ziwei_chart` (`silo: "nam-phai"`, `includePatterns: true`) for each candidate hour (`2–4` focused candidates first).

### 3. Build a Discriminator Matrix (Before Asking the User)
Compare the candidate charts and isolate **3–4 sharpest structural contrasts** where Candidate A and Candidate B predict opposite, easily verifiable real-world facts:
- **Mệnh / Thân axis**: *Vô Chính Diệu* vs strong *Chính Tinh*, early vs late-blooming *Thân* placement (*Mệnh/Phúc/Quan/Thiên Di/Tài/Phu Thê*).
- **Major *Đại Hạn* turning points**: Exact 10-year age brackets (`daiHanStartAge`–`daiHanEndAge`) and *Hóa Kỵ / Hóa Lộc* triggers for past years (education shift, first job, marriage, major family/health event).
- **Kinship & Environment**: *Phụ Mẫu*, *Huynh Đệ*, *Điền Trạch* (*Sát Tinh / Hóa Kỵ / Tuần-Triệt* signatures).
- **Career archetype**: *Sát Phá Tham* vs *Cơ Nguyệt Đồng Lương* vs *Tử Phủ Vũ Tướng* vs *Cự Nhật*.

### 4. Ask Targeted Verification Questions
- Ask **3–4 concrete, closed/falsifiable questions** (no leading astrology jargon, no cold-reading).
- Wait for the user's answers, score each candidate explicitly against their real facts, eliminate contradicted candidates, and ask 1 follow-up round only if two candidates tie.

### 5. Lock or Report Invariant Consensus
- **Locked (1 clear winner)**: Declare the verified *shichen*, True Solar Time window, `chartSha256`, and summarize the exact 3+ real-life matches that ruled out competing hours. Offer to proceed with full reading (`thay-tu-vi` / `thay-bat-tu`).
- **Ambiguous (2+ survivors)**: Clearly state which candidates remain possible, explain what single future/past fact separates them, and avoid fabricating certainty.
