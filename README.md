<p align="center">
  <img src="./brand/sovana-logo.svg" alt="SOVANA" width="560" />
</p>

<p align="center">
  <strong>Deterministic Astronomical Ephemeris, Bi-Temporal Vietnam GIS, Multi-System Symbolic Kernel &amp; Rule Solver</strong><br/>
  <code>MIT License</code> · <code>TypeScript (@sovana/*)</code> · <code>Python (sovana)</code> · <code>RFC 8785 SHA-256 Lockstep</code>
</p>

---

## Architecture Overview

**SOVANA** is a zero-runtime-dependency calculation engine implemented in lockstep across **TypeScript** (isomorphic browser + Node.js) and **Python**:

1. **Astronomical Ephemeris & Bi-Temporal Vietnam GIS (`@sovana/geo-time` · `sovana.geo_time`):**
   - Pre-compiled `SVNEPH01` little-endian binary (`specs/ephemeris/ephemeris_1900_2100.bin`, `58.9 KB`) generated offline from NASA JPL **`de440s.bsp`** via `skyfield`, avoiding floating-point trigonometric drift across `1900–2100` (`73,414` civil days).
   - Bidirectional lunar ⇄ solar conversion tracking Vietnam `UTC+7` (`Quyết định 121-CP`) vs Beijing `UTC+8` lunisolar divergences (`1968`, `1985`, `2007`, `2030`).
   - Bidirectional Vietnam GIS mapping **63 legacy provinces (~705 districts)** ↔ **34 post-2025 provinces** (**Nghị quyết `202/2025/QH15`**), historical regional timezones (`1945 UTC+9`, `1960–1975` North `UTC+7` vs South `UTC+8`), Meeus Equation of Time, and WGS-84 Vincenty geodesic azimuth.
2. **Deterministic Symbolic Kernel (`@sovana/kernel` · `sovana.kernel`):**
   - Compiles immutable `ChartIR` across isolated classical rule systems (`specs/axioms/`): Tử Vi (`nam-phai` 109-star full placement, *Vô Chính Diệu* opposite-palace borrowing, *Tam Không*, *Tứ Linh*, 12-month *Lưu Động Tinh* & `toan-thu`), quantitative Tứ Trụ Bát Tự (*Cùng Thông Bảo Giám* seasonal balance), and 64-hexagram Chu Dịch Lục Hào / Mai Hoa real-time divination.
3. **Forward-Chaining Rule Solver & Blind Birth-Hour Rectification (`@sovana/solver` · `sovana.solver`):**
   - Stratified forward-chaining DAG evaluation with provenance tracking and cross-school divergence detection.
   - Bayesian birth-hour rectification evaluating objective life-event predicates directly across the 12 candidate `ChartIR`s of a given birth date.
4. **Empirical Classics Verifier (`python/tools/classics_verifier` · `specs/classics/`):**
   - Normalized public-domain classical pattern specifications verified across `100,000` stratified charts (`1900–2100`) to measure exact statistical rarity (`frequencyBps` / `%`) and prove geometric unreachability on corrupted woodblock verses.

## Monorepo Verification

```bash
# TypeScript workspace (Node >= 22, pnpm 10)
pnpm install
pnpm build
pnpm typecheck
pnpm test

# Python workspace (Python >= 3.11, uv)
uv sync --all-packages
uv run ruff check python
uv run mypy python/sovana/src
uv run pytest

# Cross-runtime RFC 8785 Canonical JSON SHA-256 lockstep (73,414 days + 10,000 geo-time + 1,200 full-stack vectors)
pnpm verify:fullstack
```
