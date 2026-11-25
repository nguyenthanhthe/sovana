"""Compile Vietnam bi-temporal GIS dataset (63 <-> 34 provinces, ~700 districts, 24+ islands/extremes).

Data sources (100% clean-room MIT / CC BY 4.0 / Statutory):
- GeoNames VN.zip (CC BY 4.0): https://download.geonames.org/export/dump/VN.zip
- GSO Administrative Hierarchy: DiaGioiHanhChinhVN (MIT / public GSO codes)
- National Assembly Resolution 202/2025/QH15 (effective 2025-07-01): 63 -> 34 provincial units

Usage:
    uv run python -m geo_compiler.compile_geo
"""

from __future__ import annotations

import datetime as dt
import io
import json
import math
import pathlib
import re
import unicodedata
import urllib.request
import zipfile
from typing import Any

GEONAMES_VN_URL = "https://download.geonames.org/export/dump/VN.zip"
GSO_JSON_URL = "https://raw.githubusercontent.com/kenzouno1/DiaGioiHanhChinhVN/master/data.json"
PARALLEL_17_LAT = 17.006

# Authoritative 34 post-2025 provincial-level units per Resolution 202/2025/QH15
# Partitioning all 63 GSO codes ('01'..'96') into 11 unchanged + 23 merged = 34 units.
PROVINCES_34_SPEC: list[dict[str, Any]] = [
    # --- 11 Unchanged ---
    {"id": "ha-noi", "name": "Thành phố Hà Nội", "shortName": "Hà Nội", "type": "city", "mergedFrom63": ["01"], "isMerged": False},
    {"id": "cao-bang", "name": "Tỉnh Cao Bằng", "shortName": "Cao Bằng", "type": "province", "mergedFrom63": ["04"], "isMerged": False},
    {"id": "dien-bien", "name": "Tỉnh Điện Biên", "shortName": "Điện Biên", "type": "province", "mergedFrom63": ["11"], "isMerged": False},
    {"id": "lai-chau", "name": "Tỉnh Lai Châu", "shortName": "Lai Châu", "type": "province", "mergedFrom63": ["12"], "isMerged": False},
    {"id": "son-la", "name": "Tỉnh Sơn La", "shortName": "Sơn La", "type": "province", "mergedFrom63": ["14"], "isMerged": False},
    {"id": "lang-son", "name": "Tỉnh Lạng Sơn", "shortName": "Lạng Sơn", "type": "province", "mergedFrom63": ["20"], "isMerged": False},
    {"id": "quang-ninh", "name": "Tỉnh Quảng Ninh", "shortName": "Quảng Ninh", "type": "province", "mergedFrom63": ["22"], "isMerged": False},
    {"id": "thanh-hoa", "name": "Tỉnh Thanh Hóa", "shortName": "Thanh Hóa", "type": "province", "mergedFrom63": ["38"], "isMerged": False},
    {"id": "nghe-an", "name": "Tỉnh Nghệ An", "shortName": "Nghệ An", "type": "province", "mergedFrom63": ["40"], "isMerged": False},
    {"id": "ha-tinh", "name": "Tỉnh Hà Tĩnh", "shortName": "Hà Tĩnh", "type": "province", "mergedFrom63": ["42"], "isMerged": False},
    {"id": "hue", "name": "Thành phố Huế", "shortName": "Huế", "type": "city", "mergedFrom63": ["46"], "isMerged": False},
    # --- 23 Merged ---
    {"id": "tuyen-quang", "name": "Tỉnh Tuyên Quang", "shortName": "Tuyên Quang", "type": "province", "mergedFrom63": ["08", "02"], "isMerged": True},
    {"id": "lao-cai", "name": "Tỉnh Lào Cai", "shortName": "Lào Cai", "type": "province", "mergedFrom63": ["10", "15"], "isMerged": True},
    {"id": "thai-nguyen", "name": "Tỉnh Thái Nguyên", "shortName": "Thái Nguyên", "type": "province", "mergedFrom63": ["19", "06"], "isMerged": True},
    {"id": "phu-tho", "name": "Tỉnh Phú Thọ", "shortName": "Phú Thọ", "type": "province", "mergedFrom63": ["25", "26", "17"], "isMerged": True},
    {"id": "bac-ninh", "name": "Tỉnh Bắc Ninh", "shortName": "Bắc Ninh", "type": "province", "mergedFrom63": ["27", "24"], "isMerged": True},
    {"id": "hung-yen", "name": "Tỉnh Hưng Yên", "shortName": "Hưng Yên", "type": "province", "mergedFrom63": ["33", "34"], "isMerged": True},
    {"id": "hai-phong", "name": "Thành phố Hải Phòng", "shortName": "Hải Phòng", "type": "city", "mergedFrom63": ["31", "30"], "isMerged": True},
    {"id": "ninh-binh", "name": "Tỉnh Ninh Bình", "shortName": "Ninh Bình", "type": "province", "mergedFrom63": ["37", "35", "36"], "isMerged": True},
    {"id": "quang-tri", "name": "Tỉnh Quảng Trị", "shortName": "Quảng Trị", "type": "province", "mergedFrom63": ["45", "44"], "isMerged": True},
    {"id": "da-nang", "name": "Thành phố Đà Nẵng", "shortName": "Đà Nẵng", "type": "city", "mergedFrom63": ["48", "49"], "isMerged": True},
    {"id": "quang-ngai", "name": "Tỉnh Quảng Ngãi", "shortName": "Quảng Ngãi", "type": "province", "mergedFrom63": ["51", "62"], "isMerged": True},
    {"id": "gia-lai", "name": "Tỉnh Gia Lai", "shortName": "Gia Lai", "type": "province", "mergedFrom63": ["64", "52"], "isMerged": True},
    {"id": "dak-lak", "name": "Tỉnh Đắk Lắk", "shortName": "Đắk Lắk", "type": "province", "mergedFrom63": ["66", "54"], "isMerged": True},
    {"id": "khanh-hoa", "name": "Tỉnh Khánh Hòa", "shortName": "Khánh Hòa", "type": "province", "mergedFrom63": ["56", "58"], "isMerged": True},
    {"id": "lam-dong", "name": "Tỉnh Lâm Đồng", "shortName": "Lâm Đồng", "type": "province", "mergedFrom63": ["68", "60", "67"], "isMerged": True},
    {"id": "tp-ho-chi-minh", "name": "Thành phố Hồ Chí Minh", "shortName": "TP. Hồ Chí Minh", "type": "city", "mergedFrom63": ["79", "74", "77"], "isMerged": True},
    {"id": "dong-nai", "name": "Tỉnh Đồng Nai", "shortName": "Đồng Nai", "type": "province", "mergedFrom63": ["75", "70"], "isMerged": True},
    {"id": "tay-ninh", "name": "Tỉnh Tây Ninh", "shortName": "Tây Ninh", "type": "province", "mergedFrom63": ["72", "80"], "isMerged": True},
    {"id": "can-tho", "name": "Thành phố Cần Thơ", "shortName": "Cần Thơ", "type": "city", "mergedFrom63": ["92", "94", "93"], "isMerged": True},
    {"id": "vinh-long", "name": "Tỉnh Vĩnh Long", "shortName": "Vĩnh Long", "type": "province", "mergedFrom63": ["86", "83", "84"], "isMerged": True},
    {"id": "dong-thap", "name": "Tỉnh Đồng Tháp", "shortName": "Đồng Tháp", "type": "province", "mergedFrom63": ["87", "82"], "isMerged": True},
    {"id": "an-giang", "name": "Tỉnh An Giang", "shortName": "An Giang", "type": "province", "mergedFrom63": ["89", "91"], "isMerged": True},
    {"id": "ca-mau", "name": "Tỉnh Cà Mau", "shortName": "Cà Mau", "type": "province", "mergedFrom63": ["96", "95"], "isMerged": True},
]

# Pre-1997 / Pre-2008 historical provinces & common aliases -> legacy 63 GSO code(s)
HISTORICAL_ALIASES: list[dict[str, Any]] = [
    {"name": "Sài Gòn", "aliases": ["Sai Gon", "Saigon", "Thành phố Sài Gòn"], "legacy63Codes": ["79"], "lat": 10.7769, "lon": 106.7009, "note": "Pre-1976 name of Ho Chi Minh City"},
    {"name": "Gia Định", "aliases": ["Gia Dinh", "Tỉnh Gia Định"], "legacy63Codes": ["79"], "lat": 10.8016, "lon": 106.6953, "note": "Historical province merged into Saigon/HCMC in 1976"},
    {"name": "Chợ Lớn", "aliases": ["Cho Lon"], "legacy63Codes": ["79"], "lat": 10.7518, "lon": 106.6598, "note": "Historical urban zone merged into Saigon/HCMC"},
    {"name": "Hà Tây", "aliases": ["Ha Tay", "Tỉnh Hà Tây"], "legacy63Codes": ["01"], "lat": 20.9714, "lon": 105.7788, "note": "Merged into Ha Noi on 2008-08-01"},
    {"name": "Hà Đông", "aliases": ["Ha Dong"], "legacy63Codes": ["01"], "lat": 20.9714, "lon": 105.7788, "note": "Historical province merged into Ha Tay (1965) -> Ha Noi (2008)"},
    {"name": "Sơn Tây", "aliases": ["Son Tay"], "legacy63Codes": ["01"], "lat": 21.1391, "lon": 105.5050, "note": "Historical province merged into Ha Tay (1965) -> Ha Noi (2008)"},
    {"name": "Hà Sơn Bình", "aliases": ["Ha Son Binh"], "legacy63Codes": ["01", "17"], "lat": 20.8500, "lon": 105.4500, "note": "1975-1991 province (Ha Tay + Hoa Binh)"},
    {"name": "Hà Nam Ninh", "aliases": ["Ha Nam Ninh"], "legacy63Codes": ["35", "36", "37"], "lat": 20.4333, "lon": 106.1667, "note": "1975-1991 province (Ha Nam + Nam Dinh + Ninh Binh)"},
    {"name": "Hải Hưng", "aliases": ["Hai Hung"], "legacy63Codes": ["30", "33"], "lat": 20.8000, "lon": 106.2000, "note": "1968-1996 province (Hai Duong + Hung Yen)"},
    {"name": "Hà Bắc", "aliases": ["Ha Bac"], "legacy63Codes": ["24", "27"], "lat": 21.2200, "lon": 106.1500, "note": "1962-1996 province (Bac Giang + Bac Ninh)"},
    {"name": "Vĩnh Phú", "aliases": ["Vinh Phu"], "legacy63Codes": ["25", "26"], "lat": 21.3167, "lon": 105.4000, "note": "1968-1996 province (Vinh Phuc + Phu Tho)"},
    {"name": "Bắc Thái", "aliases": ["Bac Thai"], "legacy63Codes": ["06", "19"], "lat": 21.7500, "lon": 105.8333, "note": "1965-1996 province (Bac Kan + Thai Nguyen)"},
    {"name": "Cao Lạng", "aliases": ["Cao Lang"], "legacy63Codes": ["04", "20"], "lat": 22.2500, "lon": 106.5000, "note": "1975-1978 province (Cao Bang + Lang Son)"},
    {"name": "Hà Tuyên", "aliases": ["Ha Tuyen"], "legacy63Codes": ["02", "08"], "lat": 22.3500, "lon": 105.1000, "note": "1975-1991 province (Ha Giang + Tuyen Quang)"},
    {"name": "Hoàng Liên Sơn", "aliases": ["Hoang Lien Son"], "legacy63Codes": ["10", "15"], "lat": 22.0000, "lon": 104.5000, "note": "1975-1991 province (Lao Cai + Yen Bai)"},
    {"name": "Nghệ Tĩnh", "aliases": ["Nghe Tinh"], "legacy63Codes": ["40", "42"], "lat": 18.6700, "lon": 105.6800, "note": "1976-1991 province (Nghe An + Ha Tinh)"},
    {"name": "Bình Trị Thiên", "aliases": ["Binh Tri Thien"], "legacy63Codes": ["44", "45", "46"], "lat": 16.8000, "lon": 107.1000, "note": "1976-1989 province (Quang Binh + Quang Tri + Thua Thien Hue)"},
    {"name": "Quảng Nam - Đà Nẵng", "aliases": ["Quang Nam - Da Nang", "Quang Nam Da Nang"], "legacy63Codes": ["48", "49"], "lat": 15.8800, "lon": 108.2500, "note": "1975-1996 province (Da Nang + Quang Nam)"},
    {"name": "Nghĩa Bình", "aliases": ["Nghia Binh"], "legacy63Codes": ["51", "52"], "lat": 14.4000, "lon": 108.9500, "note": "1975-1989 province (Quang Ngai + Binh Dinh)"},
    {"name": "Phú Khánh", "aliases": ["Phu Khanh"], "legacy63Codes": ["54", "56"], "lat": 12.6500, "lon": 109.2500, "note": "1975-1989 province (Phu Yen + Khanh Hoa)"},
    {"name": "Thuận Hải", "aliases": ["Thuan Hai"], "legacy63Codes": ["58", "60"], "lat": 11.2500, "lon": 108.5000, "note": "1976-1991 province (Ninh Thuan + Binh Thuan)"},
    {"name": "Sông Bé", "aliases": ["Song Be"], "legacy63Codes": ["70", "74"], "lat": 11.3000, "lon": 106.7000, "note": "1976-1996 province (Binh Phuoc + Binh Duong)"},
    {"name": "Cửu Long", "aliases": ["Cuu Long"], "legacy63Codes": ["84", "86"], "lat": 10.1000, "lon": 106.1500, "note": "1976-1991 province (Vinh Long + Tra Vinh)"},
    {"name": "Minh Hải", "aliases": ["Minh Hai"], "legacy63Codes": ["95", "96"], "lat": 9.2200, "lon": 105.4000, "note": "1976-1996 province (Bac Lieu + Ca Mau)"},
    {"name": "Đà Lạt", "aliases": ["Da Lat", "Dalat"], "legacy63Codes": ["68"], "lat": 11.9404, "lon": 108.4583, "note": "Provincial capital of Lam Dong"},
    {"name": "Thừa Thiên Huế", "aliases": ["Thua Thien Hue", "Thua Thien - Hue"], "legacy63Codes": ["46"], "lat": 16.4637, "lon": 107.5909, "note": "Pre-2025 name before elevation to Hue City"},
]

# 24 Special Islands & Extreme Geographical Points
SPECIAL_ISLANDS_AND_EXTREMES: list[dict[str, Any]] = [
    {"id": "hoang-sa", "name": "Huyện đảo Hoàng Sa", "shortName": "Hoàng Sa", "lat": 16.5333, "lon": 111.6167, "legacy63Code": "48", "post2025Id": "da-nang", "kind": "island"},
    {"id": "truong-sa", "name": "Huyện đảo Trường Sa", "shortName": "Trường Sa", "lat": 8.6442, "lon": 111.9197, "legacy63Code": "56", "post2025Id": "khanh-hoa", "kind": "island"},
    {"id": "phu-quoc", "name": "Thành phố Phú Quốc", "shortName": "Phú Quốc", "lat": 10.2289, "lon": 103.9572, "legacy63Code": "91", "post2025Id": "an-giang", "kind": "island"},
    {"id": "con-dao", "name": "Huyện Côn Đảo", "shortName": "Côn Đảo", "lat": 8.6870, "lon": 106.6080, "legacy63Code": "77", "post2025Id": "tp-ho-chi-minh", "kind": "island"},
    {"id": "bach-long-vi", "name": "Huyện Bạch Long Vĩ", "shortName": "Bạch Long Vĩ", "lat": 20.1333, "lon": 107.7333, "legacy63Code": "31", "post2025Id": "hai-phong", "kind": "island"},
    {"id": "con-co", "name": "Huyện Cồn Cỏ", "shortName": "Cồn Cỏ", "lat": 17.1583, "lon": 107.3389, "legacy63Code": "45", "post2025Id": "quang-tri", "kind": "island"},
    {"id": "ly-son", "name": "Huyện Lý Sơn", "shortName": "Lý Sơn", "lat": 15.3833, "lon": 109.1167, "legacy63Code": "51", "post2025Id": "quang-ngai", "kind": "island"},
    {"id": "phu-quy", "name": "Huyện Phú Quý", "shortName": "Phú Quý", "lat": 10.5167, "lon": 108.9333, "legacy63Code": "60", "post2025Id": "lam-dong", "kind": "island"},
    {"id": "co-to", "name": "Huyện Cô Tô", "shortName": "Cô Tô", "lat": 20.9717, "lon": 107.7636, "legacy63Code": "22", "post2025Id": "quang-ninh", "kind": "island"},
    {"id": "van-don", "name": "Huyện Vân Đồn", "shortName": "Vân Đồn", "lat": 21.0667, "lon": 107.4667, "legacy63Code": "22", "post2025Id": "quang-ninh", "kind": "island"},
    {"id": "cat-ba", "name": "Đảo Cát Bà (Cát Hải)", "shortName": "Cát Bà", "lat": 20.7278, "lon": 107.0472, "legacy63Code": "31", "post2025Id": "hai-phong", "kind": "island"},
    {"id": "tho-chu", "name": "Quần đảo Thổ Chu", "shortName": "Thổ Chu", "lat": 9.2958, "lon": 103.4750, "legacy63Code": "91", "post2025Id": "an-giang", "kind": "island"},
    {"id": "nam-du", "name": "Quần đảo Nam Du (Kiên Hải)", "shortName": "Nam Du", "lat": 9.6833, "lon": 104.3500, "legacy63Code": "91", "post2025Id": "an-giang", "kind": "island"},
    {"id": "hon-khoai", "name": "Đảo Hòn Khoai", "shortName": "Hòn Khoai", "lat": 8.4333, "lon": 104.8333, "legacy63Code": "96", "post2025Id": "ca-mau", "kind": "island"},
    {"id": "hon-chuoi", "name": "Đảo Hòn Chuối", "shortName": "Hòn Chuối", "lat": 8.9472, "lon": 104.5250, "legacy63Code": "96", "post2025Id": "ca-mau", "kind": "island"},
    {"id": "cu-lao-cham", "name": "Cù Lao Chàm", "shortName": "Cù Lao Chàm", "lat": 15.9539, "lon": 108.5144, "legacy63Code": "49", "post2025Id": "da-nang", "kind": "island"},
    {"id": "binh-ba", "name": "Đảo Bình Ba (Cam Ranh)", "shortName": "Bình Ba", "lat": 11.8367, "lon": 109.2356, "legacy63Code": "56", "post2025Id": "khanh-hoa", "kind": "island"},
    {"id": "binh-hung", "name": "Đảo Bình Hưng", "shortName": "Bình Hưng", "lat": 11.7867, "lon": 109.2175, "legacy63Code": "56", "post2025Id": "khanh-hoa", "kind": "island"},
    {"id": "dao-tran", "name": "Đảo Trần", "shortName": "Đảo Trần", "lat": 21.2333, "lon": 107.9667, "legacy63Code": "22", "post2025Id": "quang-ninh", "kind": "island"},
    {"id": "hon-me", "name": "Đảo Hòn Mê", "shortName": "Hòn Mê", "lat": 19.3750, "lon": 105.9167, "legacy63Code": "38", "post2025Id": "thanh-hoa", "kind": "island"},
    {"id": "lung-cu", "name": "Cực Bắc Lũng Cú", "shortName": "Lũng Cú", "lat": 23.3667, "lon": 105.3167, "legacy63Code": "02", "post2025Id": "tuyen-quang", "kind": "extreme"},
    {"id": "a-pa-chai", "name": "Cực Tây A Pa Chải", "shortName": "A Pa Chải", "lat": 22.3986, "lon": 102.1444, "legacy63Code": "11", "post2025Id": "dien-bien", "kind": "extreme"},
    {"id": "mui-doi", "name": "Cực Đông Mũi Đôi", "shortName": "Mũi Đôi", "lat": 12.6486, "lon": 109.4631, "legacy63Code": "56", "post2025Id": "khanh-hoa", "kind": "extreme"},
    {"id": "mui-ca-mau", "name": "Cực Nam Mũi Cà Mau", "shortName": "Mũi Cà Mau", "lat": 8.6000, "lon": 104.7167, "legacy63Code": "96", "post2025Id": "ca-mau", "kind": "extreme"},
]

# Exact overrides for districts with orthography/recent-merger differences in GeoNames
EXACT_DISTRICT_OVERRIDES: dict[str, tuple[float, float]] = {
    "049": (22.5419, 106.4475),  # Huyện Quảng Hòa, Cao Bằng
    "467": (16.5978, 106.9578),  # Huyện Đa Krông (Đakrông), Quảng Trị
    "516": (15.0253, 108.0594),  # Huyện Nam Trà My, Quảng Nam
    "576": (8.6442, 111.9197),   # Huyện Trường Sa, Khánh Hòa
    "618": (14.0750, 107.4750),  # Huyện Ia H' Drai, Kon Tum
    "655": (12.4878, 108.0406),  # Huyện Krông A Na (Krông Ana), Đắk Lắk
    "726": (11.1233, 106.8453),  # Huyện Bắc Tân Uyên, Bình Dương
}

# Authoritative provincial capital coordinates (WGS84) for all 63 legacy provinces
PROVINCE_63_COORDS: dict[str, tuple[float, float]] = {
    "01": (21.0285, 105.8542), "02": (22.8233, 104.9836), "04": (22.6657, 106.2579),
    "06": (22.1470, 105.8348), "08": (21.8236, 105.2142), "10": (22.4856, 103.9707),
    "11": (21.3860, 103.0230), "12": (22.3864, 103.4703), "14": (21.3256, 103.9188),
    "15": (21.7229, 104.9113), "17": (20.8172, 105.3376), "19": (21.5942, 105.8482),
    "20": (21.8537, 106.7615), "22": (20.9505, 107.0734), "24": (21.2731, 106.1946),
    "25": (21.3227, 105.4020), "26": (21.3089, 105.6049), "27": (21.1861, 106.0763),
    "30": (20.9373, 106.3146), "31": (20.8449, 106.6881), "33": (20.6464, 106.0511),
    "34": (20.4463, 106.3366), "35": (20.5453, 105.9122), "36": (20.4388, 106.1621),
    "37": (20.2506, 105.9745), "38": (19.8067, 105.7852), "40": (18.6796, 105.6813),
    "42": (18.3428, 105.9057), "44": (17.4689, 106.6223), "45": (16.8163, 107.1003),
    "46": (16.4637, 107.5909), "48": (16.0544, 108.2022), "49": (15.5736, 108.4740),
    "51": (15.1205, 108.7923), "52": (13.7830, 109.2197), "54": (13.0955, 109.2961),
    "56": (12.2388, 109.1967), "58": (11.5646, 108.9886), "60": (10.9289, 108.1021),
    "62": (14.3498, 108.0005), "64": (13.9833, 108.0000), "66": (12.6667, 108.0500),
    "67": (12.0042, 107.6907), "68": (11.9404, 108.4583), "70": (11.5350, 106.9056),
    "72": (11.3100, 106.0983), "74": (10.9804, 106.6519), "75": (10.9574, 106.8427),
    "77": (10.3460, 107.0843), "79": (10.7769, 106.7009), "80": (10.5333, 106.4167),
    "82": (10.3600, 106.3600), "83": (10.2415, 106.3759), "84": (9.9347, 106.3453),
    "86": (10.2537, 105.9722), "87": (10.4602, 105.6329), "89": (10.3864, 105.4352),
    "91": (10.0125, 105.0809), "92": (10.0452, 105.7469), "93": (9.7845, 105.4701),
    "94": (9.6025, 105.9739), "95": (9.2941, 105.7278), "96": (9.1768, 105.1524),
}


def repo_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parents[3]


def strip_accents(text: str) -> str:
    s = text.replace("đ", "d").replace("Đ", "D")
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return unicodedata.normalize("NFC", s)


def normalize_admin_name(name: str, is_province: bool = False) -> str:
    s = strip_accents(name).lower().strip()
    s = re.sub(r"[-_/,.()]+", " ", s)
    if is_province:
        for prefix in ("thanh pho ", "tinh ", "tp. ", "tp "):
            if s.startswith(prefix):
                s = s[len(prefix):]
                break
    else:
        for prefix in ("thanh pho ", "thi xa ", "quan ", "huyen ", "tp. ", "tp ", "tx. ", "tx "):
            if s.startswith(prefix):
                s = s[len(prefix):]
                break
    # Canonicalize common Vietnamese orthography variants (Hoa/Hòa, Thuy/Thủy, Qui/Quy)
    s = re.sub(r"\bqui\b", "quy", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def download_cached(url: str, dest: pathlib.Path) -> pathlib.Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 10_000:
        return dest
    print(f"Downloading {url} -> {dest}")
    req = urllib.request.Request(url, headers={"User-Agent": "SovanaGeoCompiler/0.1"})
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    with urllib.request.urlopen(req, timeout=60) as resp, open(tmp, "wb") as f:
        while chunk := resp.read(256 * 1024):
            f.write(chunk)
    tmp.replace(dest)
    return dest


def koppen_zone_for(lat: float, lon: float, code: str) -> str:
    # Highland temperate / tropical highland zones
    if code in {"02", "04", "10", "11", "12", "14", "15", "62", "64", "66", "67", "68"}:
        return "Cwb" if lat < 15.0 else "Cwa"
    if lat >= 19.5:
        return "Cwa"
    if lat >= 13.0:
        return "Am"
    return "Aw"


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def parse_geonames(zip_path: pathlib.Path) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    """Return (by_norm_name, all_features) from GeoNames VN.txt."""
    by_name: dict[str, list[dict[str, Any]]] = {}
    features: list[dict[str, Any]] = []
    relevant_codes = {"ADM1", "ADM2", "PPLC", "PPLA", "PPLA2", "PPL", "PPLX", "ISL", "ISLS"}
    with zipfile.ZipFile(zip_path) as zf:
        raw = zf.read("VN.txt").decode("utf-8")
    for line in raw.splitlines():
        if not line:
            continue
        cols = line.split("\t")
        if len(cols) < 15:
            continue
        fcode = cols[7]
        if fcode not in relevant_codes:
            continue
        rec = {
            "geonameId": int(cols[0]),
            "name": cols[1],
            "asciiName": cols[2],
            "altNames": [x.strip() for x in cols[3].split(",") if x.strip()],
            "lat": float(cols[4]),
            "lon": float(cols[5]),
            "fcode": fcode,
            "adm1": cols[10],
            "population": int(cols[14]) if cols[14].isdigit() else 0,
        }
        features.append(rec)
        keys = {normalize_admin_name(rec["name"], is_province=False), normalize_admin_name(rec["asciiName"], is_province=False)}
        for alt in rec["altNames"]:
            if len(alt) <= 48:
                keys.add(normalize_admin_name(alt, is_province=False))
                keys.add(normalize_admin_name(alt, is_province=True))
        for k in keys:
            if k:
                by_name.setdefault(k, []).append(rec)
    return by_name, features


def match_district_coords(
    dist_name: str,
    prov_lat: float,
    prov_lon: float,
    by_name: dict[str, list[dict[str, Any]]],
) -> tuple[float, float, str]:
    norm = normalize_admin_name(dist_name, is_province=False)
    # Strip trailing '1', '2', etc. if needed only after exact match
    candidates = list(by_name.get(norm, []))
    # Also try replacing "tp " or keeping "quan N" variants
    if not candidates and dist_name.lower().startswith("quận "):
        num_key = normalize_admin_name("district " + norm, is_province=False)
        candidates = list(by_name.get(num_key, []))

    # Filter candidates reasonably close to province center (< 220 km, or < 450 km for islands)
    scored: list[tuple[int, float, dict[str, Any]]] = []
    fcode_priority = {"ADM2": 0, "PPLA2": 1, "PPLA": 2, "PPLC": 2, "PPL": 3, "PPLX": 4, "ISL": 5}
    for c in candidates:
        dist_km = haversine_km(prov_lat, prov_lon, c["lat"], c["lon"])
        if dist_km <= 220.0 or (c["fcode"] == "ISL" and dist_km <= 600.0):
            prio = fcode_priority.get(c["fcode"], 9)
            scored.append((prio, dist_km, c))

    if scored:
        scored.sort(key=lambda x: (x[0], x[1]))
        best = scored[0][2]
        return round(best["lat"], 6), round(best["lon"], 6), f"geonames_{best['fcode'].lower()}"

    # Fallback: deterministic slight offset only when genuinely absent; here return province center
    return round(prov_lat, 6), round(prov_lon, 6), "province_fallback"


def compile_geo(out_dir: pathlib.Path | None = None, cache_dir: pathlib.Path | None = None) -> pathlib.Path:
    root = repo_root()
    if out_dir is None:
        out_dir = root / "specs" / "geo"
    if cache_dir is None:
        cache_dir = root / ".cache" / "geo"
    out_dir.mkdir(parents=True, exist_ok=True)

    vn_zip = download_cached(GEONAMES_VN_URL, cache_dir / "VN.zip")
    gso_json_path = download_cached(GSO_JSON_URL, cache_dir / "DiaGioiHanhChinhVN.json")

    by_name, _ = parse_geonames(vn_zip)
    gso_data: list[dict[str, Any]] = json.loads(gso_json_path.read_text(encoding="utf-8"))

    # Map legacy 63 code -> post2025 spec
    legacy_to_34: dict[str, dict[str, Any]] = {}
    for p34 in PROVINCES_34_SPEC:
        for code in p34["mergedFrom63"]:
            legacy_to_34[code] = p34

    assert len(PROVINCES_34_SPEC) == 34
    assert len(legacy_to_34) == 63

    provinces_63: list[dict[str, Any]] = []
    districts_legacy: list[dict[str, Any]] = []
    coord_source_counts: dict[str, int] = {}

    for prov in gso_data:
        code = str(prov["Id"]).zfill(2)
        name = str(prov["Name"]).strip()
        short_name = name
        for pfx in ("Thành phố ", "Tỉnh "):
            if short_name.startswith(pfx):
                short_name = short_name[len(pfx):]
                break
        lat, lon = PROVINCE_63_COORDS[code]
        p34 = legacy_to_34[code]
        tz_zone = "VN_NORTH_DRV" if lat >= PARALLEL_17_LAT else "VN_SOUTH_RVN"
        koppen = koppen_zone_for(lat, lon, code)

        dist_lons: list[float] = [lon]
        for dist in prov.get("Districts", []):
            d_code = str(dist["Id"]).zfill(3)
            d_name = str(dist["Name"]).strip()
            if d_code in EXACT_DISTRICT_OVERRIDES:
                d_lat, d_lon = EXACT_DISTRICT_OVERRIDES[d_code]
                c_src = "statutory_override"
            else:
                d_lat, d_lon, c_src = match_district_coords(d_name, lat, lon, by_name)
            coord_source_counts[c_src] = coord_source_counts.get(c_src, 0) + 1
            d_tz = "VN_NORTH_DRV" if d_lat >= PARALLEL_17_LAT else "VN_SOUTH_RVN"
            dist_lons.append(d_lon)
            districts_legacy.append({
                "code": d_code,
                "name": d_name,
                "province63Code": code,
                "province63Name": short_name,
                "post2025Id": p34["id"],
                "post2025Name": p34["shortName"],
                "lat": d_lat,
                "lon": d_lon,
                "tzZone": d_tz,
                "koppenZone": koppen,
                "coordSource": c_src,
            })

        provinces_63.append({
            "code": code,
            "name": name,
            "shortName": short_name,
            "lat": lat,
            "lon": lon,
            "minLon": round(min(dist_lons), 4),
            "maxLon": round(max(dist_lons), 4),
            "tzZone": tz_zone,
            "koppenZone": koppen,
            "post2025Id": p34["id"],
            "post2025Name": p34["shortName"],
        })

    prov63_by_code = {p["code"]: p for p in provinces_63}
    districts_by_34: dict[str, list[dict[str, Any]]] = {}
    for d in districts_legacy:
        districts_by_34.setdefault(d["post2025Id"], []).append(d)

    provinces_post_2025: list[dict[str, Any]] = []
    for p34 in PROVINCES_34_SPEC:
        lead_code = p34["mergedFrom63"][0]
        lead = prov63_by_code[lead_code]
        constituent_dists = districts_by_34.get(p34["id"], [])
        all_lons = [prov63_by_code[c]["lon"] for c in p34["mergedFrom63"]] + [d["lon"] for d in constituent_dists]
        min_lon = round(min(all_lons), 4)
        max_lon = round(max(all_lons), 4)
        lon_span = round(max_lon - min_lon, 4)
        # Wide longitude span (> 1.0 deg = > 4 min solar time error across merged province)
        wide_warning = lon_span >= 1.0
        provinces_post_2025.append({
            "id": p34["id"],
            "name": p34["name"],
            "shortName": p34["shortName"],
            "type": p34["type"],
            "isMerged": p34["isMerged"],
            "effectiveFrom": "2025-07-01",
            "mergedFrom63Codes": p34["mergedFrom63"],
            "mergedFrom63Names": [prov63_by_code[c]["shortName"] for c in p34["mergedFrom63"]],
            "lat": lead["lat"],
            "lon": lead["lon"],
            "minLon": min_lon,
            "maxLon": max_lon,
            "lonSpanDeg": lon_span,
            "wideLongitudeWarning": wide_warning,
            "tzZone": lead["tzZone"],
            "koppenZone": lead["koppenZone"],
        })

    # Attach tzZone and koppenZone to special islands
    special_items: list[dict[str, Any]] = []
    for item in SPECIAL_ISLANDS_AND_EXTREMES:
        p63 = prov63_by_code[item["legacy63Code"]]
        special_items.append({
            **item,
            "tzZone": "VN_NORTH_DRV" if item["lat"] >= PARALLEL_17_LAT else "VN_SOUTH_RVN",
            "koppenZone": p63["koppenZone"],
        })

    doc = {
        "schemaVersion": "1.0.0",
        "generatedAt": dt.datetime(2026, 11, 25, tzinfo=dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "legalBasis": "National Assembly Resolution 202/2025/QH15 (passed 2025-06-12, effective 2025-07-01)",
        "sources": [
            "GeoNames VN.zip (CC BY 4.0)",
            "GSO Vietnam Administrative Codes (63 provinces / districts)",
        ],
        "stats": {
            "post2025Count": len(provinces_post_2025),
            "legacy63Count": len(provinces_63),
            "legacyDistrictCount": len(districts_legacy),
            "historicalAliasCount": len(HISTORICAL_ALIASES),
            "specialZoneCount": len(special_items),
            "districtCoordSources": coord_source_counts,
        },
        "provincesPost2025": provinces_post_2025,
        "provincesLegacy63": provinces_63,
        "districtsLegacy": districts_legacy,
        "historicalAliases": HISTORICAL_ALIASES,
        "specialZones": special_items,
    }

    out_path = out_dir / "vn_bi_temporal_geo.json"
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out_path}: stats={json.dumps(doc['stats'])}")
    return out_path


if __name__ == "__main__":
    compile_geo()
