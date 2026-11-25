# Credits, Attributions & Clean-Room Provenance

All code and compiled data specifications in `nguyenthanhthe/sovana` are original clean-room implementations released under the **MIT License** (`LICENSE`).

## 1. Astronomical & Mathematical Foundations

* **NASA JPL Development Ephemeris (`DE440s`):** Solar and Lunar orbital state vectors (1849–2150) computed offline via **Skyfield** (`rhodesmill.org/skyfield/`, MIT) from NASA Jet Propulsion Laboratory public-domain `de440s.bsp` planetary ephemeris kernels.
* **Jean Meeus — *Astronomical Algorithms* (2nd ed., 1998):** Chapter 28 high-precision Equation of Time formulation and ΔT polynomial approximations (Espenak & Meeus).
* **TS. Hồ Ngọc Đức:** Vietnamese Lunar Calendar computation methodology (`Lịch Việt`, UTC+7 Hanoi meridian) and formalization of Quyết định `121-CP` (08/08/1967).
* **T. Vincenty (1975):** *Direct and Inverse Solutions of Geodesics on the Ellipsoid with Application of Nested Equations* (WGS-84 ellipsoid inverse distance and forward azimuth).
* **RFC 8785 (JSON Canonicalization Scheme — JCS):** Deterministic cross-runtime Canonical JSON serialization for bit-exact `SHA-256` verification.

## 2. Historical Timezones & Administrative GIS Sources

* **Statutory Vietnam Administrative Reorganization:**
  * National Assembly Resolution **Nghị quyết `202/2025/QH15`** (passed 12/06/2025, effective 01/07/2025) reorganizing 63 provincial-level units into 34 provincial-level units.
  * Government Council Decision **Quyết định `121-CP`** (08/08/1967, effective 01/01/1968) establishing UTC+7 (105°E) for official Vietnamese lunar calendar calculations.
  * Historical Vietnamese timezone decrees (`1945` UTC+9, `1947–1955` contested zones, `1960–1975` RVN UTC+8 vs DRV UTC+7, `13/06/1975` PRG unification to UTC+7) and pre-1911 French Indochina LMT records.
* **GeoNames (`https://download.geonames.org/export/dump/VN.zip`):** WGS-84 geographic coordinates for Vietnamese districts, towns, and offshore islands — used under **Creative Commons Attribution 4.0 International (`CC BY 4.0`)** with attribution preserved here.
* **Open-Source Vietnamese GSO Administrative Code Lists (`DiaGioiHanhChinhVN`):** Statutory 63-province / ~705-district GSO hierarchy codes.

## 3. Classical Texts & Open-Source Reference Inspiration (MIT / Public Domain)

* **Public-Domain Classical Corpora (Ming / Qing / Early-20th-Century Public Domain):**
  * *Tử Vi Đẩu Số Toàn Thư* (《紫微斗數全書》 — incl. Quyển 1 *Đẩu Số Cách Cục*, *Đẩu Số Cốt Tủy Phú*, *Thái Vi Phú*)
  * *Trích Thiên Tủy* (《滴天髓》)
  * *Uyên Hải Tử Bình* (《淵海子平》)
  * *Tử Bình Chân Thuyên* (《子平真詮》)
  * *Cùng Thông Bảo Giám* (《窮通寶鑑》)
  * *Tam Mệnh Thông Hội* (《三命通會》)
  * *Thần Phong Thông Khảo* (《神峰通考》)
  * *Tăng San Bốc Dịch* (《增刪卜易》 — Dã Hạc Lão Nhân)
  * *Mai Hoa Dịch Số* (《梅花易數》 — Thiệu Khang Tiết)
  * *Quốc Văn Chu Dịch Diễn Giải* — Cụ Phan Bội Châu (public-domain Vietnamese classical scholarship)
* **Clean-Room Mathematical Formula References (`ACADEMIC_REFERENCE_LOCAL_ONLY`, zero verbatim modern prose):**
  * *Tử Vi Đẩu Số Tân Biên* — Vân Đằng Thái Thứ Lang (clean-room star placement tables and brightness matrix references only)
  * *Tử Vi Nghiệm Lý Toàn Thư* — Cụ Thiên Lương (clean-room mathematical/structural axiom references only)
* **Open-Source Prior Art (MIT Reference Inspiration):**
  * `doanguyen/lasotuvi` (`engines/lasotuvi-vn`, `MIT License, Copyright (c) 2016 doanguyen`) — Vietnamese Nam Phái star placement & brightness reference tables (`DiaBan.py`, `Sao.py`, `AmDuong.py`).
  * `Renhuai123/ziwei-doushu` (`engines/ziwei-doushu`, `MIT License, Copyright (c) 2026 紫微研究`) — technical reference for `patterns-ding*.ts` covering the 49 *Tử Vi Đẩu Số Toàn Thư* Q.1 patterns and geometric unreachability proofs.
  * `cosinekitty/astronomy` (Astronomy Engine, MIT)
  * `SylarLong/iztro` (MIT)
  * `6tail/lunar-typescript` (MIT)

## 4. Non-Contamination Pledge (`CC BY-NC-SA 4.0` Exclusion)

`nguyenthanhthe/sovana` strictly maintains **clean-room MIT licensing**. No source code, rules, corpora, or non-commercial datasets licensed under `CC BY-NC-SA 4.0` (such as `nihai-*`, `nihai-tianji-corpus`, `nihai-diji-corpus`, `ni-haixia-reasoning-chain`, or `tianji-ziwei/`) or non-commercial GIS dumps (such as `GADM`) are read, copied, embedded, cited, or derived in this repository.
