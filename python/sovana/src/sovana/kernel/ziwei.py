"""Deterministic Finite-Ring (Z_10 x Z_12) Multi-Silo Ziwei Dou Shu engine."""

from __future__ import annotations

from sovana.geo_time.ephemeris import BRANCHES_VI, STEMS_VI, floor_mod
from sovana.geo_time.models import NormalizedBirthTemporal
from sovana.kernel.data import load_bazi_axiom, load_ziwei_axiom
from sovana.kernel.models import (
    CucNumber,
    Direction,
    Gender,
    SihuaTransform,
    ZiweiChartIR,
    ZiweiLuuNienIR,
    ZiweiLuuNienSihuaIR,
    ZiweiNguyetHanEntryIR,
    ZiweiPalaceIR,
    ZiweiSilo,
    ZiweiStarCategory,
    ZiweiStarIR,
    ZiweiThaiTueTuLinhIR,
)

_CUC_NAME_BY_NUMBER: dict[CucNumber, str] = {
    2: "Thủy nhị cục",
    3: "Mộc tam cục",
    4: "Kim tứ cục",
    5: "Thổ ngũ cục",
    6: "Hỏa lục cục",
}

_SIHUA_LABELS: tuple[SihuaTransform, SihuaTransform, SihuaTransform, SihuaTransform] = (
    "Hóa Lộc",
    "Hóa Quyền",
    "Hóa Khoa",
    "Hóa Kỵ",
)

_TU_VI_OFFSETS: tuple[tuple[str, int], ...] = (
    ("Tử Vi", 0),
    ("Thiên Cơ", -1),
    ("Thái Dương", -3),
    ("Vũ Khúc", -4),
    ("Thiên Đồng", -5),
    ("Liêm Trinh", 4),
)

_THIEN_PHU_OFFSETS: tuple[tuple[str, int], ...] = (
    ("Thiên Phủ", 0),
    ("Thái Âm", 1),
    ("Tham Lang", 2),
    ("Cự Môn", 3),
    ("Thiên Tướng", 4),
    ("Thiên Lương", 5),
    ("Thất Sát", 6),
    ("Phá Quân", 10),
)

_THIEN_QUAN_BY_STEM = (7, 4, 5, 2, 3, 9, 11, 9, 10, 6)
_THIEN_PHUC_BY_STEM = (9, 8, 0, 11, 3, 2, 6, 5, 6, 5)
_PHA_TOAI_BY_BRANCH_MOD3 = (5, 1, 9)
_LUU_HA_BY_STEM = (9, 10, 7, 4, 5, 6, 8, 3, 11, 2)
_THIEN_TRU_BY_STEM = (5, 6, 0, 5, 6, 8, 2, 6, 9, 10)
_TU_LINH_STARS = frozenset({"Bạch Hổ", "Hoa Cái", "Long Trì", "Phượng Các"})


def sexagenary_index(stem_index: int, branch_index: int) -> int:
    return floor_mod(6 * stem_index - 5 * branch_index, 60)


def compare_code_point(a: str, b: str) -> int:
    return -1 if a < b else (1 if a > b else 0)


def _compute_hoa_linh_starts(y_branch: int) -> tuple[int, int]:
    if y_branch in (2, 6, 10):
        return (1, 3)
    if y_branch in (8, 0, 4):
        return (2, 10)
    if y_branch in (5, 9, 1):
        return (3, 10)
    return (9, 10)


def _compute_thien_ma_branch(y_branch: int) -> int:
    r = y_branch % 4
    if r == 2:
        return 8
    if r == 0:
        return 2
    if r == 1:
        return 11
    return 5


def cast_ziwei_chart(
    temporal: NormalizedBirthTemporal,
    gender: Gender,
    silo: ZiweiSilo,
    target_year: int | None = None,
) -> ZiweiChartIR:
    if gender not in ("male", "female"):
        raise ValueError(f"Invalid gender: {gender!r}")
    if silo not in ("nam-phai", "toan-thu"):
        raise ValueError(f"Invalid Ziwei silo: {silo!r}")

    axiom = load_ziwei_axiom(silo)
    bazi_axiom = load_bazi_axiom()

    m = temporal.lunar_active.effective_lunar_month
    d = temporal.lunar_active.lunar_day
    y_stem = temporal.pillars.lunar_year_pillar.stem_index
    y_branch = temporal.pillars.lunar_year_pillar.branch_index
    h_branch = temporal.true_solar_time.shichen_branch

    is_yang_stem = y_stem % 2 == 0
    direction: Direction = 1 if is_yang_stem == (gender == "male") else -1
    yin_yang_label_vi = f"{'Dương' if is_yang_stem else 'Âm'} {'Nam' if gender == 'male' else 'Nữ'}"

    menh_branch = floor_mod(2 + (m - 1) - h_branch, 12)
    than_branch = floor_mod(2 + (m - 1) + h_branch, 12)
    tiger_stem = ((y_stem % 5) * 2 + 2) % 10

    def palace_stem(b: int) -> int:
        return (tiger_stem + floor_mod(b - 2, 12)) % 10

    menh_sex_idx = sexagenary_index(palace_stem(menh_branch), menh_branch)
    cuc_entry = bazi_axiom.nap_am60[menh_sex_idx]
    cuc_number = cuc_entry.cuc_number
    cuc_name_vi = _CUC_NAME_BY_NUMBER[cuc_number]

    year_sex_idx = sexagenary_index(y_stem, y_branch)
    ban_menh_nap_am_vi = bazi_axiom.nap_am60[year_sex_idx].nap_am_vi

    rem = d % cuc_number
    x = 0 if rem == 0 else cuc_number - rem
    q = (d + x) // cuc_number
    tu_vi_branch = (
        floor_mod(2 + q - 1 + x, 12) if x % 2 == 0 else floor_mod(2 + q - 1 - x, 12)
    )
    thien_phu_branch = floor_mod(4 - tu_vi_branch, 12)

    sihua_tuple = axiom.sihua_by_stem[str(y_stem)]
    sihua_map: dict[str, SihuaTransform] = {
        sihua_tuple[i]: _SIHUA_LABELS[i] for i in range(4)
    }

    major_buckets: list[list[ZiweiStarIR]] = [[] for _ in range(12)]
    minor_buckets: list[list[ZiweiStarIR]] = [[] for _ in range(12)]

    def add_major(star_name: str, branch: int) -> None:
        brightness_row = axiom.major_star_brightness_by_branch.get(star_name)
        brightness = (
            brightness_row[branch]
            if brightness_row is not None and branch < len(brightness_row)
            else None
        )
        major_buckets[branch].append(
            ZiweiStarIR(
                name=star_name,
                category="major",
                brightness=brightness,
                sihua_transform=sihua_map.get(star_name),
            )
        )

    def add_minor(star_name: str, branch: int, category: ZiweiStarCategory) -> None:
        brightness_row = axiom.minor_star_brightness_by_branch.get(star_name)
        brightness = (
            brightness_row[branch]
            if brightness_row is not None and branch < len(brightness_row)
            else None
        )
        minor_buckets[branch].append(
            ZiweiStarIR(
                name=star_name,
                category=category,
                brightness=brightness,
                sihua_transform=sihua_map.get(star_name),
            )
        )

    for star_name, offset in _TU_VI_OFFSETS:
        add_major(star_name, floor_mod(tu_vi_branch + offset, 12))
    for star_name, offset in _THIEN_PHU_OFFSETS:
        add_major(star_name, floor_mod(thien_phu_branch + offset, 12))

    # Deterministic auxiliary & sha stars
    ta_phu_branch = floor_mod(4 + (m - 1), 12)
    huu_bat_branch = floor_mod(10 - (m - 1), 12)
    van_khuc_branch = floor_mod(4 + h_branch, 12)
    van_xuong_branch = floor_mod(10 - h_branch, 12)
    add_minor("Tả Phụ", ta_phu_branch, "auxiliary")
    add_minor("Hữu Bật", huu_bat_branch, "auxiliary")
    add_minor("Văn Khúc", van_khuc_branch, "auxiliary")
    add_minor("Văn Xương", van_xuong_branch, "auxiliary")

    loc_ton_branch = axiom.loc_ton_by_stem[y_stem]
    add_minor("Lộc Tồn", loc_ton_branch, "auxiliary")
    add_minor("Kình Dương", floor_mod(loc_ton_branch + 1, 12), "sha")
    add_minor("Đà La", floor_mod(loc_ton_branch - 1, 12), "sha")

    khoi_branch, viet_branch = axiom.thien_khoi_viet_by_stem[y_stem]
    add_minor("Thiên Khôi", khoi_branch, "auxiliary")
    add_minor("Thiên Việt", viet_branch, "auxiliary")

    add_minor("Địa Kiếp", floor_mod(11 + h_branch, 12), "sha")
    add_minor("Địa Không", floor_mod(11 - h_branch, 12), "sha")

    hoa_start, linh_start = _compute_hoa_linh_starts(y_branch)
    add_minor("Hỏa Tinh", floor_mod(hoa_start + direction * h_branch, 12), "sha")
    add_minor("Linh Tinh", floor_mod(linh_start - direction * h_branch, 12), "sha")

    thien_ma_branch = _compute_thien_ma_branch(y_branch)
    add_minor("Thiên Mã", thien_ma_branch, "auxiliary")
    hong_loan_branch = floor_mod(3 - y_branch, 12)
    add_minor("Hồng Loan", hong_loan_branch, "auxiliary")
    add_minor("Thiên Hỷ", floor_mod(hong_loan_branch + 6, 12), "auxiliary")
    add_minor("Thiên Hình", floor_mod(9 + (m - 1), 12), "sha")
    add_minor("Thiên Riêu", floor_mod(1 + (m - 1), 12), "sha")

    # Extended Nam Phái / Toàn Thư auxiliary & sha stars
    if silo == "nam-phai":
        add_minor("Thiên Không", floor_mod(y_branch + 1, 12), "sha")
    add_minor(
        "Nguyệt Đức",
        floor_mod(5 + y_branch, 12) if silo == "nam-phai" else y_branch,
        "auxiliary",
    )
    add_minor("Thiên Đức", floor_mod(9 + y_branch, 12), "auxiliary")
    add_minor("Long Trì", floor_mod(4 + y_branch, 12), "auxiliary")
    add_minor("Phượng Các", floor_mod(10 - y_branch, 12), "auxiliary")
    add_minor("Giải Thần", floor_mod(10 - y_branch, 12), "auxiliary")
    add_minor("Tam Thai", floor_mod(ta_phu_branch + (d - 1), 12), "auxiliary")
    add_minor("Bát Tọa", floor_mod(huu_bat_branch - (d - 1), 12), "auxiliary")
    an_quang_branch = floor_mod(van_xuong_branch + d - 2, 12)
    add_minor("Ân Quang", an_quang_branch, "auxiliary")
    add_minor("Thiên Quý", floor_mod(2 - an_quang_branch, 12), "auxiliary")
    add_minor("Thiên Hư", floor_mod(6 + y_branch, 12), "sha")
    add_minor("Thiên Khốc", floor_mod(6 - y_branch, 12), "sha")
    add_minor("Thiên Tài", floor_mod(menh_branch + y_branch, 12), "auxiliary")
    add_minor("Thiên Thọ", floor_mod(than_branch + y_branch, 12), "auxiliary")
    add_minor("Thiên Quan", _THIEN_QUAN_BY_STEM[y_stem], "auxiliary")
    add_minor("Thiên Phúc", _THIEN_PHUC_BY_STEM[y_stem], "auxiliary")
    add_minor("Thiên Y", floor_mod(1 + (m - 1), 12), "auxiliary")
    co_than_branch = floor_mod((((y_branch + 1) % 12) // 3) * 3 + 2, 12)
    add_minor("Cô Thần", co_than_branch, "sha")
    add_minor("Quả Tú", floor_mod(co_than_branch - 4, 12), "sha")
    add_minor("Văn Tinh", floor_mod(loc_ton_branch + 3, 12), "auxiliary")
    add_minor("Đường Phù", floor_mod(loc_ton_branch + 5, 12), "auxiliary")
    add_minor("Quốc Ấn", floor_mod(loc_ton_branch + 8, 12), "auxiliary")
    add_minor("Thai Phụ", floor_mod(6 + h_branch, 12), "auxiliary")
    add_minor("Phong Cáo", floor_mod(2 + h_branch, 12), "auxiliary")
    add_minor("Thiên Giải", floor_mod(8 + (m - 1), 12), "auxiliary")
    add_minor("Địa Giải", floor_mod(7 + (m - 1), 12), "auxiliary")
    add_minor("Thiên La", 4, "sha")
    add_minor("Địa Võng", 10, "sha")
    add_minor("Thiên Thương", floor_mod(menh_branch + 5, 12), "sha")
    add_minor("Thiên Sứ", floor_mod(menh_branch + 7, 12), "sha")
    add_minor("Hoa Cái", floor_mod(thien_ma_branch + 2, 12), "auxiliary")
    add_minor("Kiếp Sát", floor_mod(thien_ma_branch + 3, 12), "sha")
    add_minor("Đào Hoa", floor_mod(thien_ma_branch + 7, 12), "auxiliary")
    add_minor("Phá Toái", _PHA_TOAI_BY_BRANCH_MOD3[y_branch % 3], "sha")
    add_minor("Đẩu Quân", floor_mod(y_branch - (m - 1) + h_branch, 12), "sha")
    add_minor("Lưu Hà", _LUU_HA_BY_STEM[y_stem], "sha")
    add_minor("Thiên Trù", _THIEN_TRU_BY_STEM[y_stem], "auxiliary")

    # Tuần Trung & Triệt Lộ
    end_branch = floor_mod(y_branch + (9 - y_stem), 12)
    tuan_trung_branches: tuple[int, int] = (
        floor_mod(end_branch + 1, 12),
        floor_mod(end_branch + 2, 12),
    )
    triet_lo_branches = axiom.triet_by_stem_pair[str(y_stem % 5)]

    # Tiểu Hạn & 3 Rings
    khoi_tieu_han = floor_mod(10 - 3 * y_branch, 12)
    gender_sign = 1 if gender == "male" else -1
    trang_sinh_start = axiom.trang_sinh_start_by_cuc[str(cuc_number)]

    sorted_majors_by_branch: list[list[ZiweiStarIR]] = []
    sorted_minors_by_branch: list[list[ZiweiStarIR]] = []
    tam_khong_by_branch: list[list[str]] = []
    tu_linh_by_branch: list[list[str]] = []
    palace_records: list[tuple[int, str, int, int, int, str, str, str]] = []

    for b in range(12):
        s_idx = palace_stem(b)
        ccw_idx = floor_mod(menh_branch - b, 12)
        palace_name = axiom.palace_order_counter_clockwise[ccw_idx]

        dai_han_step = floor_mod(direction * (b - menh_branch), 12)
        dai_han_start_age = cuc_number + dai_han_step * 10
        dai_han_end_age = dai_han_start_age + 9

        tieu_han_branch_index = floor_mod(
            y_branch + gender_sign * floor_mod(b - khoi_tieu_han, 12),
            12,
        )

        thai_tue_star = axiom.thai_tue_ring[floor_mod(b - y_branch, 12)]
        trang_sinh_star = axiom.trang_sinh_stages[
            floor_mod(direction * (b - trang_sinh_start), 12)
        ]
        bac_sy_star = axiom.bac_sy_ring[floor_mod(direction * (b - loc_ton_branch), 12)]

        add_minor(thai_tue_star, b, "ring")
        add_minor(trang_sinh_star, b, "ring")
        add_minor(bac_sy_star, b, "ring")

        sorted_major = sorted(major_buckets[b], key=lambda s: s.name)
        sorted_minor = sorted(minor_buckets[b], key=lambda s: s.name)
        is_tuan = b in tuan_trung_branches
        is_triet = b in triet_lo_branches

        tam_khong: list[str] = []
        if is_tuan:
            tam_khong.append("Tuần")
        if is_triet:
            tam_khong.append("Triệt")
        tu_linh: list[str] = []
        for s in sorted_minor:
            if s.name in ("Thiên Không", "Địa Không"):
                tam_khong.append(s.name)
            if s.name in _TU_LINH_STARS:
                tu_linh.append(s.name)
        tam_khong.sort()

        sorted_majors_by_branch.append(sorted_major)
        sorted_minors_by_branch.append(sorted_minor)
        tam_khong_by_branch.append(tam_khong)
        tu_linh_by_branch.append(tu_linh)
        palace_records.append(
            (
                s_idx,
                palace_name,
                dai_han_start_age,
                dai_han_end_age,
                tieu_han_branch_index,
                thai_tue_star,
                trang_sinh_star,
                bac_sy_star,
            )
        )

    palaces: list[ZiweiPalaceIR] = []
    for b in range(12):
        (
            s_idx,
            palace_name,
            dai_han_start_age,
            dai_han_end_age,
            tieu_han_branch_index,
            thai_tue_star,
            trang_sinh_star,
            bac_sy_star,
        ) = palace_records[b]
        sorted_major = sorted_majors_by_branch[b]
        vcd = len(sorted_major) == 0
        borrowed = (
            [s.model_copy() for s in sorted_majors_by_branch[(b + 6) % 12]] if vcd else []
        )
        palaces.append(
            ZiweiPalaceIR(
                branch_index=b,
                branch_vi=BRANCHES_VI[b],
                stem_index=s_idx,
                stem_vi=STEMS_VI[s_idx],
                palace_name=palace_name,
                is_menh=(b == menh_branch),
                is_than=(b == than_branch),
                tuan_trung=(b in tuan_trung_branches),
                triet_lo=(b in triet_lo_branches),
                dai_han_start_age=dai_han_start_age,
                dai_han_end_age=dai_han_end_age,
                tieu_han_branch_index=tieu_han_branch_index,
                tieu_han_branch_vi=BRANCHES_VI[tieu_han_branch_index],
                thai_tue_star=thai_tue_star,
                trang_sinh_star=trang_sinh_star,
                bac_sy_star=bac_sy_star,
                major_stars=sorted_major,
                minor_stars=sorted_minors_by_branch[b],
                vo_chinh_dieu=vcd,
                borrowed_major_stars=borrowed,
                tam_khong_types=tam_khong_by_branch[b],
                tu_linh_present=tu_linh_by_branch[b],
            )
        )

    menh_tam_hop_set: set[str] = set()
    for br in (menh_branch, (menh_branch + 4) % 12, (menh_branch + 8) % 12):
        menh_tam_hop_set.update(palaces[br].tu_linh_present)
    menh_tam_phuong_set = set(menh_tam_hop_set)
    menh_tam_phuong_set.update(palaces[(menh_branch + 6) % 12].tu_linh_present)

    menh_tam_hop_stars = sorted(menh_tam_hop_set)
    menh_tam_phuong_stars = sorted(menh_tam_phuong_set)
    menh_in_tt_th = floor_mod(menh_branch - y_branch, 4) == 0
    than_in_tt_th = floor_mod(than_branch - y_branch, 4) == 0
    has_full_hop = len(menh_tam_hop_stars) == 4
    has_full_phuong = len(menh_tam_phuong_stars) == 4
    thai_tue_tam_hop_tu_linh = ZiweiThaiTueTuLinhIR(
        menh_in_thai_tue_tam_hop=menh_in_tt_th,
        than_in_thai_tue_tam_hop=than_in_tt_th,
        menh_tam_hop_tu_linh_stars=menh_tam_hop_stars,
        menh_tam_phuong_tu_linh_stars=menh_tam_phuong_stars,
        has_full_tu_linh_in_menh_tam_hop=has_full_hop,
        has_full_tu_linh_in_menh_tam_phuong=has_full_phuong,
        is_thai_tue_tu_linh_way=(menh_in_tt_th and has_full_hop),
    )

    luu_nien: ZiweiLuuNienIR | None = None
    if target_year is not None:
        if isinstance(target_year, bool) or not isinstance(target_year, int):
            raise ValueError(f"target_year must be an integer; received {target_year!r}")
        ty_stem = floor_mod(target_year - 4, 10)
        ty_branch = floor_mod(target_year - 4, 12)
        nominal_age = target_year - temporal.lunar_active.lunar_year + 1
        tieu_han_palace_branch = floor_mod(
            khoi_tieu_han + gender_sign * floor_mod(ty_branch - y_branch, 12),
            12,
        )
        active_dai_han = next(
            (
                p
                for p in palaces
                if p.dai_han_start_age <= nominal_age <= p.dai_han_end_age
            ),
            None,
        )

        luu_loc_ton_branch = axiom.loc_ton_by_stem[ty_stem]
        luu_dong_tinh: list[list[str]] = [[] for _ in range(12)]
        luu_dong_tinh[ty_branch].append("Lưu Thái Tuế")
        luu_dong_tinh[floor_mod(ty_branch + 2, 12)].append("Lưu Tang Môn")
        luu_dong_tinh[floor_mod(ty_branch + 8, 12)].append("Lưu Bạch Hổ")
        luu_dong_tinh[floor_mod(6 - ty_branch, 12)].append("Lưu Thiên Khốc")
        luu_dong_tinh[floor_mod(6 + ty_branch, 12)].append("Lưu Thiên Hư")
        luu_dong_tinh[luu_loc_ton_branch].append("Lưu Lộc Tồn")
        luu_dong_tinh[floor_mod(luu_loc_ton_branch + 1, 12)].append("Lưu Kình Dương")
        luu_dong_tinh[floor_mod(luu_loc_ton_branch - 1, 12)].append("Lưu Đà La")
        luu_dong_tinh[_compute_thien_ma_branch(ty_branch)].append("Lưu Thiên Mã")
        for bucket in luu_dong_tinh:
            bucket.sort()

        luu_sihua_tuple = axiom.sihua_by_stem[str(ty_stem)]
        luu_nien_sihua: list[ZiweiLuuNienSihuaIR] = []
        for idx_sh in range(4):
            star_name = luu_sihua_tuple[idx_sh]
            transform = _SIHUA_LABELS[idx_sh]
            host = next(
                p
                for p in palaces
                if any(s.name == star_name for s in p.major_stars)
                or any(s.name == star_name for s in p.minor_stars)
            )
            luu_nien_sihua.append(
                ZiweiLuuNienSihuaIR(
                    transform=transform,
                    star_name=star_name,
                    branch_index=host.branch_index,
                    palace_name=host.palace_name,
                )
            )

        month1_branch = floor_mod(tieu_han_palace_branch - (m - 1) + h_branch, 12)
        nguyet_han: list[ZiweiNguyetHanEntryIR] = []
        for lunar_month in range(1, 13):
            b_idx = floor_mod(month1_branch + (lunar_month - 1), 12)
            pal = palaces[b_idx]
            nguyet_han.append(
                ZiweiNguyetHanEntryIR(
                    lunar_month=lunar_month,
                    branch_index=b_idx,
                    branch_vi=pal.branch_vi,
                    palace_name=pal.palace_name,
                )
            )

        luu_nien = ZiweiLuuNienIR(
            target_year=target_year,
            year_stem_index=ty_stem,
            year_branch_index=ty_branch,
            year_can_chi_vi=f"{STEMS_VI[ty_stem]} {BRANCHES_VI[ty_branch]}",
            nominal_age=nominal_age,
            luu_nien_palace_branch=ty_branch,
            tieu_han_palace_branch=tieu_han_palace_branch,
            active_dai_han_palace_branch=(
                active_dai_han.branch_index if active_dai_han is not None else None
            ),
            luu_dong_tinh_by_branch=luu_dong_tinh,
            luu_nien_sihua=luu_nien_sihua,
            nguyet_han=nguyet_han,
        )

    return ZiweiChartIR(
        silo=silo,
        silo_name_vi=axiom.name_vi,
        gender=gender,
        yin_yang_label_vi=yin_yang_label_vi,
        direction=direction,
        menh_branch=menh_branch,
        than_branch=than_branch,
        menh_chu_star=axiom.menh_chu_by_branch[menh_branch],
        than_chu_star=axiom.than_chu_by_branch[y_branch],
        cuc_number=cuc_number,
        cuc_name_vi=cuc_name_vi,
        ban_menh_nap_am_vi=ban_menh_nap_am_vi,
        tu_vi_branch=tu_vi_branch,
        thien_phu_branch=thien_phu_branch,
        tuan_trung_branches=tuan_trung_branches,
        triet_lo_branches=triet_lo_branches,
        palaces=palaces,
        thai_tue_tam_hop_tu_linh=thai_tue_tam_hop_tu_linh,
        luu_nien=luu_nien,
    )
