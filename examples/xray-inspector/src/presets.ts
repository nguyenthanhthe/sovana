import type { CalendarMode, LeapMonthPolicy } from '@sovana/geo-time';

export interface XrayBirthFormState {
  presetId: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  gender: 'male' | 'female';
  location: string;
  migrationDestination: string;
  calendarMode: CalendarMode;
  leapMonthPolicy: LeapMonthPolicy;
  activeSilo: 'nam-phai' | 'toan-thu';
}

export interface SmokingGunPreset {
  id: string;
  tag: string;
  title: string;
  summary: string;
  spotlightTitle: string;
  spotlightDetail: string;
  form: XrayBirthFormState;
}

const LOCATION_SHORTHANDS: Record<string, string> = {
  'tp.hcm': 'TP. Hồ Chí Minh',
  'tp hcm': 'TP. Hồ Chí Minh',
  tphcm: 'TP. Hồ Chí Minh',
  hcm: 'TP. Hồ Chí Minh',
  hn: 'Hà Nội',
  dn: 'Đà Nẵng',
  'đn': 'Đà Nẵng',
};

export function normalizeLocationInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const lookup = LOCATION_SHORTHANDS[trimmed.toLowerCase()];
  return lookup ?? trimmed;
}

export const SMOKING_GUN_PRESETS: readonly SmokingGunPreset[] = [
  {
    id: 'tet-mau-than-1968',
    tag: 'SMOKING GUN #1 · JPL DE440s LUNAR SPLIT',
    title: '1968 Tết Mậu Thân (29/01/1968 · Hà Nội)',
    summary:
      'Sóc tháng Giêng kẹp giữa 23:00 UTC+7 và 00:00 UTC+8: VN_UTC7 (Quyết định 121-CP) là Mồng 1 Tết Mậu Thân, trong khi CN_UTC8 Bắc Kinh vẫn là 30 Tháng Chạp Đinh Mùi.',
    spotlightTitle: 'Đứt gãy Điểm Sóc NASA JPL DE440s: VN_UTC7 (121-CP) vs CN_UTC8 (Bắc Kinh)',
    spotlightDetail:
      'Điểm Sóc xảy ra lúc 23:29 UTC+7 ngày 29/01/1968 (tức 00:29 UTC+8 ngày 30/01/1968). Bảng ephemeris_1900_2100.bin (21 KB int64) tách chuẩn hai lịch pháp thay vì bị khóa cứng UTC+8 như các thư viện cũ.',
    form: {
      presetId: 'tet-mau-than-1968',
      year: 1968,
      month: 1,
      day: 29,
      hour: 10,
      minute: 30,
      gender: 'male',
      location: 'Hà Nội',
      migrationDestination: '',
      calendarMode: 'VN_UTC7',
      leapMonthPolicy: 'keep',
      activeSilo: 'nam-phai',
    },
  },
  {
    id: 'saigon-1968-utc8',
    tag: 'SMOKING GUN #2 · RVN UTC+8 VS DRV UTC+7',
    title: 'Sài Gòn 01:15 Sáng (15/05/1968 · UTC+8 vs Hà Nội UTC+7)',
    summary:
      'Sài Gòn 1960–1975 dùng giờ VNCH UTC+8 (kinh tuyến chuẩn 120°E), kéo Giờ Mặt Trời Thật lùi -53m12s về 00:25:31 Giờ Tý thay vì Giờ Sửu sai lệch của IANA tzdb!',
    spotlightTitle: 'Hiệu chuẩn Lịch sử Múi Giờ Bắc/Nam & Phương trình Thời gian Meeus',
    spotlightDetail:
      'Tại kinh độ 106.7009°E dưới múi UTC+8 (120°E), độ lệch kinh tuyến là -53m11.78s cộng EoT +3m43.65s → Giờ Mặt Trời Thật lùi về 00:25:31 (Giờ Tý). Cùng 01:15 sáng tại Hà Nội (UTC+7 thực tế, không bị IANA gán nhầm UTC+8) là 01:22:08 (Giờ Sửu).',
    form: {
      presetId: 'saigon-1968-utc8',
      year: 1968,
      month: 5,
      day: 15,
      hour: 1,
      minute: 15,
      gender: 'female',
      location: 'Sài Gòn',
      migrationDestination: '',
      calendarMode: 'VN_HISTORICAL',
      leapMonthPolicy: 'keep',
      activeSilo: 'nam-phai',
    },
  },
  {
    id: 'can-canh-1980-fork',
    tag: 'SMOKING GUN #3 · AXIOMATIC SILO + VINCENTY',
    title: 'Can Canh Fork (15/08/1980 · Đà Nẵng -> TP.HCM)',
    summary:
      'Cô lập Tứ Hóa Can Canh (Thiên Đồng Hóa Khoa / Thái Âm Hóa Kỵ ở Nam Phái vs Thái Âm Hóa Khoa / Thiên Đồng Hóa Kỵ ở Toàn Thư) + Vector Di cư Vincenty 606.1 km + Paraconsistent DAG!',
    spotlightTitle: 'Cô lập Tiên đề Nam Phái ↔ Toàn Thư + Trắc địa Vincenty WGS-84 + Lưỡng thuyết DAG',
    spotlightDetail:
      'Năm Canh Thân (stemIndex=6) kích hoạt xung đột Tứ Hóa kinh điển giữa Nam Phái Thiên Lương và Đẩu Số Toàn Thư. Đồng thời phép chiếu Vincenty Đà Nẵng → TP.HCM đo chính xác 606.07 km, phương vị 195.741° (Cung Mùi, cảnh báo giáp ranh quạt 0.741°).',
    form: {
      presetId: 'can-canh-1980-fork',
      year: 1980,
      month: 8,
      day: 15,
      hour: 9,
      minute: 30,
      gender: 'male',
      location: 'Đà Nẵng',
      migrationDestination: 'TP.HCM',
      calendarMode: 'VN_HISTORICAL',
      leapMonthPolicy: 'keep',
      activeSilo: 'nam-phai',
    },
  },
];
