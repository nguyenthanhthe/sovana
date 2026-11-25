import { BRANCHES_VI, STEMS_VI, floorMod, type NormalizedBirthTemporal } from '@sovana/geo-time';
import { loadBaziAxiom, loadZiweiAxiom } from './store.js';
import type {
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
} from './types.js';

const CUC_NAME_BY_NUMBER: Record<2 | 3 | 4 | 5 | 6, string> = {
  2: 'Thủy nhị cục',
  3: 'Mộc tam cục',
  4: 'Kim tứ cục',
  5: 'Thổ ngũ cục',
  6: 'Hỏa lục cục',
};

const SIHUA_LABELS: readonly SihuaTransform[] = [
  'Hóa Lộc',
  'Hóa Quyền',
  'Hóa Khoa',
  'Hóa Kỵ',
];

const TU_VI_OFFSETS: ReadonlyArray<readonly [string, number]> = [
  ['Tử Vi', 0],
  ['Thiên Cơ', -1],
  ['Thái Dương', -3],
  ['Vũ Khúc', -4],
  ['Thiên Đồng', -5],
  ['Liêm Trinh', 4],
];

const THIEN_PHU_OFFSETS: ReadonlyArray<readonly [string, number]> = [
  ['Thiên Phủ', 0],
  ['Thái Âm', 1],
  ['Tham Lang', 2],
  ['Cự Môn', 3],
  ['Thiên Tướng', 4],
  ['Thiên Lương', 5],
  ['Thất Sát', 6],
  ['Phá Quân', 10],
];

const THIEN_QUAN_BY_STEM = [7, 4, 5, 2, 3, 9, 11, 9, 10, 6] as const;
const THIEN_PHUC_BY_STEM = [9, 8, 0, 11, 3, 2, 6, 5, 6, 5] as const;
const PHA_TOAI_BY_BRANCH_MOD3 = [5, 1, 9] as const;
const LUU_HA_BY_STEM = [9, 10, 7, 4, 5, 6, 8, 3, 11, 2] as const;
const THIEN_TRU_BY_STEM = [5, 6, 0, 5, 6, 8, 2, 6, 9, 10] as const;
const TU_LINH_STARS = new Set(['Bạch Hổ', 'Hoa Cái', 'Long Trì', 'Phượng Các']);

export function sexagenaryIndex(stemIndex: number, branchIndex: number): number {
  return floorMod(6 * stemIndex - 5 * branchIndex, 60);
}

export function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function computeHoaLinhStarts(yBranch: number): [number, number] {
  if (yBranch === 2 || yBranch === 6 || yBranch === 10) {
    return [1, 3];
  }
  if (yBranch === 8 || yBranch === 0 || yBranch === 4) {
    return [2, 10];
  }
  if (yBranch === 5 || yBranch === 9 || yBranch === 1) {
    return [3, 10];
  }
  return [9, 10];
}

function computeThienMaBranch(yBranch: number): number {
  const r = yBranch % 4;
  if (r === 2) return 8;
  if (r === 0) return 2;
  if (r === 1) return 11;
  return 5;
}

export function castZiweiChart(
  temporal: NormalizedBirthTemporal,
  gender: Gender,
  silo: ZiweiSilo,
  targetYear?: number,
): ZiweiChartIR {
  if (gender !== 'male' && gender !== 'female') {
    throw new RangeError(`Invalid gender: ${String(gender)}`);
  }
  if (silo !== 'nam-phai' && silo !== 'toan-thu') {
    throw new RangeError(`Invalid Ziwei silo: ${String(silo)}`);
  }

  const axiom = loadZiweiAxiom(silo);
  const baziAxiom = loadBaziAxiom();

  const m = temporal.lunarActive.effectiveLunarMonth;
  const d = temporal.lunarActive.lunarDay;
  const yStem = temporal.pillars.lunarYearPillar.stemIndex;
  const yBranch = temporal.pillars.lunarYearPillar.branchIndex;
  const hBranch = temporal.trueSolarTime.shichenBranch;

  const isYangStem = yStem % 2 === 0;
  const direction: 1 | -1 = isYangStem === (gender === 'male') ? 1 : -1;
  const yinYangLabelVi = `${isYangStem ? 'Dương' : 'Âm'} ${gender === 'male' ? 'Nam' : 'Nữ'}`;

  const menhBranch = floorMod(2 + (m - 1) - hBranch, 12);
  const thanBranch = floorMod(2 + (m - 1) + hBranch, 12);
  const tigerStem = ((yStem % 5) * 2 + 2) % 10;

  const palaceStem = (b: number): number => (tigerStem + floorMod(b - 2, 12)) % 10;

  const menhSexIdx = sexagenaryIndex(palaceStem(menhBranch), menhBranch);
  const cucEntry = baziAxiom.napAm60[menhSexIdx]!;
  const cucNumber = cucEntry.cucNumber;
  const cucNameVi = CUC_NAME_BY_NUMBER[cucNumber];

  const yearSexIdx = sexagenaryIndex(yStem, yBranch);
  const banMenhNapAmVi = baziAxiom.napAm60[yearSexIdx]!.napAmVi;

  const rem = d % cucNumber;
  const x = rem === 0 ? 0 : cucNumber - rem;
  const q = Math.trunc((d + x) / cucNumber);
  const tuViBranch =
    x % 2 === 0 ? floorMod(2 + q - 1 + x, 12) : floorMod(2 + q - 1 - x, 12);
  const thienPhuBranch = floorMod(4 - tuViBranch, 12);

  const sihuaTuple = axiom.sihuaByStem[String(yStem)]!;
  const sihuaMap = new Map<string, SihuaTransform>();
  for (let i = 0; i < 4; i++) {
    sihuaMap.set(sihuaTuple[i]!, SIHUA_LABELS[i]!);
  }

  const majorBuckets: ZiweiStarIR[][] = Array.from({ length: 12 }, () => []);
  const minorBuckets: ZiweiStarIR[][] = Array.from({ length: 12 }, () => []);

  const addMajor = (starName: string, branch: number): void => {
    const brightnessRow = axiom.majorStarBrightnessByBranch[starName];
    const brightness = brightnessRow ? (brightnessRow[branch] ?? null) : null;
    majorBuckets[branch]!.push({
      name: starName,
      category: 'major',
      brightness,
      sihuaTransform: sihuaMap.get(starName) ?? null,
    });
  };

  const addMinor = (starName: string, branch: number, category: ZiweiStarCategory): void => {
    const brightnessRow = axiom.minorStarBrightnessByBranch[starName];
    const brightness = brightnessRow ? (brightnessRow[branch] ?? null) : null;
    minorBuckets[branch]!.push({
      name: starName,
      category,
      brightness,
      sihuaTransform: sihuaMap.get(starName) ?? null,
    });
  };

  for (const [starName, offset] of TU_VI_OFFSETS) {
    addMajor(starName, floorMod(tuViBranch + offset, 12));
  }
  for (const [starName, offset] of THIEN_PHU_OFFSETS) {
    addMajor(starName, floorMod(thienPhuBranch + offset, 12));
  }

  // Deterministic auxiliary & sha stars
  const taPhuBranch = floorMod(4 + (m - 1), 12);
  const huuBatBranch = floorMod(10 - (m - 1), 12);
  const vanKhucBranch = floorMod(4 + hBranch, 12);
  const vanXuongBranch = floorMod(10 - hBranch, 12);
  addMinor('Tả Phụ', taPhuBranch, 'auxiliary');
  addMinor('Hữu Bật', huuBatBranch, 'auxiliary');
  addMinor('Văn Khúc', vanKhucBranch, 'auxiliary');
  addMinor('Văn Xương', vanXuongBranch, 'auxiliary');

  const locTonBranch = axiom.locTonByStem[yStem]!;
  addMinor('Lộc Tồn', locTonBranch, 'auxiliary');
  addMinor('Kình Dương', floorMod(locTonBranch + 1, 12), 'sha');
  addMinor('Đà La', floorMod(locTonBranch - 1, 12), 'sha');

  const [khoiBranch, vietBranch] = axiom.thienKhoiVietByStem[yStem]!;
  addMinor('Thiên Khôi', khoiBranch, 'auxiliary');
  addMinor('Thiên Việt', vietBranch, 'auxiliary');

  addMinor('Địa Kiếp', floorMod(11 + hBranch, 12), 'sha');
  addMinor('Địa Không', floorMod(11 - hBranch, 12), 'sha');

  const [hoaStart, linhStart] = computeHoaLinhStarts(yBranch);
  addMinor('Hỏa Tinh', floorMod(hoaStart + direction * hBranch, 12), 'sha');
  addMinor('Linh Tinh', floorMod(linhStart - direction * hBranch, 12), 'sha');

  const thienMaBranch = computeThienMaBranch(yBranch);
  addMinor('Thiên Mã', thienMaBranch, 'auxiliary');
  const hongLoanBranch = floorMod(3 - yBranch, 12);
  addMinor('Hồng Loan', hongLoanBranch, 'auxiliary');
  addMinor('Thiên Hỷ', floorMod(hongLoanBranch + 6, 12), 'auxiliary');
  addMinor('Thiên Hình', floorMod(9 + (m - 1), 12), 'sha');
  addMinor('Thiên Riêu', floorMod(1 + (m - 1), 12), 'sha');

  // Extended Nam Phái / Toàn Thư auxiliary & sha stars
  if (silo === 'nam-phai') {
    addMinor('Thiên Không', floorMod(yBranch + 1, 12), 'sha');
  }
  addMinor('Nguyệt Đức', silo === 'nam-phai' ? floorMod(5 + yBranch, 12) : yBranch, 'auxiliary');
  addMinor('Thiên Đức', floorMod(9 + yBranch, 12), 'auxiliary');
  addMinor('Long Trì', floorMod(4 + yBranch, 12), 'auxiliary');
  addMinor('Phượng Các', floorMod(10 - yBranch, 12), 'auxiliary');
  addMinor('Giải Thần', floorMod(10 - yBranch, 12), 'auxiliary');
  addMinor('Tam Thai', floorMod(taPhuBranch + (d - 1), 12), 'auxiliary');
  addMinor('Bát Tọa', floorMod(huuBatBranch - (d - 1), 12), 'auxiliary');
  const anQuangBranch = floorMod(vanXuongBranch + d - 2, 12);
  addMinor('Ân Quang', anQuangBranch, 'auxiliary');
  addMinor('Thiên Quý', floorMod(2 - anQuangBranch, 12), 'auxiliary');
  addMinor('Thiên Hư', floorMod(6 + yBranch, 12), 'sha');
  addMinor('Thiên Khốc', floorMod(6 - yBranch, 12), 'sha');
  addMinor('Thiên Tài', floorMod(menhBranch + yBranch, 12), 'auxiliary');
  addMinor('Thiên Thọ', floorMod(thanBranch + yBranch, 12), 'auxiliary');
  addMinor('Thiên Quan', THIEN_QUAN_BY_STEM[yStem]!, 'auxiliary');
  addMinor('Thiên Phúc', THIEN_PHUC_BY_STEM[yStem]!, 'auxiliary');
  addMinor('Thiên Y', floorMod(1 + (m - 1), 12), 'auxiliary');
  const coThanBranch = floorMod(Math.trunc(((yBranch + 1) % 12) / 3) * 3 + 2, 12);
  addMinor('Cô Thần', coThanBranch, 'sha');
  addMinor('Quả Tú', floorMod(coThanBranch - 4, 12), 'sha');
  addMinor('Văn Tinh', floorMod(locTonBranch + 3, 12), 'auxiliary');
  addMinor('Đường Phù', floorMod(locTonBranch + 5, 12), 'auxiliary');
  addMinor('Quốc Ấn', floorMod(locTonBranch + 8, 12), 'auxiliary');
  addMinor('Thai Phụ', floorMod(6 + hBranch, 12), 'auxiliary');
  addMinor('Phong Cáo', floorMod(2 + hBranch, 12), 'auxiliary');
  addMinor('Thiên Giải', floorMod(8 + (m - 1), 12), 'auxiliary');
  addMinor('Địa Giải', floorMod(7 + (m - 1), 12), 'auxiliary');
  addMinor('Thiên La', 4, 'sha');
  addMinor('Địa Võng', 10, 'sha');
  addMinor('Thiên Thương', floorMod(menhBranch + 5, 12), 'sha');
  addMinor('Thiên Sứ', floorMod(menhBranch + 7, 12), 'sha');
  addMinor('Hoa Cái', floorMod(thienMaBranch + 2, 12), 'auxiliary');
  addMinor('Kiếp Sát', floorMod(thienMaBranch + 3, 12), 'sha');
  addMinor('Đào Hoa', floorMod(thienMaBranch + 7, 12), 'auxiliary');
  addMinor('Phá Toái', PHA_TOAI_BY_BRANCH_MOD3[yBranch % 3]!, 'sha');
  addMinor('Đẩu Quân', floorMod(yBranch - (m - 1) + hBranch, 12), 'sha');
  addMinor('Lưu Hà', LUU_HA_BY_STEM[yStem]!, 'sha');
  addMinor('Thiên Trù', THIEN_TRU_BY_STEM[yStem]!, 'auxiliary');

  // Tuần Trung & Triệt Lộ
  const endBranch = floorMod(yBranch + (9 - yStem), 12);
  const tuanTrungBranches: [number, number] = [
    floorMod(endBranch + 1, 12),
    floorMod(endBranch + 2, 12),
  ];
  const trietLoBranches: [number, number] = axiom.trietByStemPair[String(yStem % 5)]!;

  // Tiểu Hạn & 3 Rings
  const khoiTieuHan = floorMod(10 - 3 * yBranch, 12);
  const genderSign = gender === 'male' ? 1 : -1;
  const trangSinhStart = axiom.trangSinhStartByCuc[String(cucNumber)]!;

  const palaces: ZiweiPalaceIR[] = [];
  for (let b = 0; b < 12; b++) {
    const sIdx = palaceStem(b);
    const ccwIdx = floorMod(menhBranch - b, 12);
    const palaceName = axiom.palaceOrderCounterClockwise[ccwIdx]!;

    const daiHanStep = floorMod(direction * (b - menhBranch), 12);
    const daiHanStartAge = cucNumber + daiHanStep * 10;
    const daiHanEndAge = daiHanStartAge + 9;

    const tieuHanBranchIndex = floorMod(
      yBranch + genderSign * floorMod(b - khoiTieuHan, 12),
      12,
    );

    const thaiTueStar = axiom.thaiTueRing[floorMod(b - yBranch, 12)]!;
    const trangSinhStar =
      axiom.trangSinhStages[floorMod(direction * (b - trangSinhStart), 12)]!;
    const bacSyStar = axiom.bacSyRing[floorMod(direction * (b - locTonBranch), 12)]!;

    addMinor(thaiTueStar, b, 'ring');
    addMinor(trangSinhStar, b, 'ring');
    addMinor(bacSyStar, b, 'ring');

    const sortedMajor = [...majorBuckets[b]!].sort((x, y) => compareCodePoint(x.name, y.name));
    const sortedMinor = [...minorBuckets[b]!].sort((x, y) => compareCodePoint(x.name, y.name));
    const isTuan = b === tuanTrungBranches[0] || b === tuanTrungBranches[1];
    const isTriet = b === trietLoBranches[0] || b === trietLoBranches[1];

    const tamKhongTypes: string[] = [];
    if (isTuan) tamKhongTypes.push('Tuần');
    if (isTriet) tamKhongTypes.push('Triệt');
    const tuLinhPresent: string[] = [];
    for (const s of sortedMinor) {
      if (s.name === 'Thiên Không' || s.name === 'Địa Không') {
        tamKhongTypes.push(s.name);
      }
      if (TU_LINH_STARS.has(s.name)) {
        tuLinhPresent.push(s.name);
      }
    }
    tamKhongTypes.sort(compareCodePoint);

    palaces.push({
      branchIndex: b,
      branchVi: BRANCHES_VI[b]!,
      stemIndex: sIdx,
      stemVi: STEMS_VI[sIdx]!,
      palaceName,
      isMenh: b === menhBranch,
      isThan: b === thanBranch,
      tuanTrung: isTuan,
      trietLo: isTriet,
      daiHanStartAge,
      daiHanEndAge,
      tieuHanBranchIndex,
      tieuHanBranchVi: BRANCHES_VI[tieuHanBranchIndex]!,
      thaiTueStar,
      trangSinhStar,
      bacSyStar,
      majorStars: sortedMajor,
      minorStars: sortedMinor,
      voChinhDieu: sortedMajor.length === 0,
      borrowedMajorStars: [],
      tamKhongTypes,
      tuLinhPresent,
    });
  }

  for (let b = 0; b < 12; b++) {
    const p = palaces[b]!;
    if (p.voChinhDieu) {
      p.borrowedMajorStars = palaces[(b + 6) % 12]!.majorStars.map((s) => ({ ...s }));
    }
  }

  const menhTamHopSet = new Set<string>();
  for (const br of [menhBranch, (menhBranch + 4) % 12, (menhBranch + 8) % 12]) {
    for (const st of palaces[br]!.tuLinhPresent) {
      menhTamHopSet.add(st);
    }
  }
  const menhTamPhuongSet = new Set<string>(menhTamHopSet);
  for (const st of palaces[(menhBranch + 6) % 12]!.tuLinhPresent) {
    menhTamPhuongSet.add(st);
  }
  const menhTamHopTuLinhStars = Array.from(menhTamHopSet).sort(compareCodePoint);
  const menhTamPhuongTuLinhStars = Array.from(menhTamPhuongSet).sort(compareCodePoint);
  const menhInThaiTueTamHop = floorMod(menhBranch - yBranch, 4) === 0;
  const thanInThaiTueTamHop = floorMod(thanBranch - yBranch, 4) === 0;
  const hasFullTuLinhInMenhTamHop = menhTamHopTuLinhStars.length === 4;
  const hasFullTuLinhInMenhTamPhuong = menhTamPhuongTuLinhStars.length === 4;
  const thaiTueTamHopTuLinh: ZiweiThaiTueTuLinhIR = {
    menhInThaiTueTamHop,
    thanInThaiTueTamHop,
    menhTamHopTuLinhStars,
    menhTamPhuongTuLinhStars,
    hasFullTuLinhInMenhTamHop,
    hasFullTuLinhInMenhTamPhuong,
    isThaiTueTuLinhWay: menhInThaiTueTamHop && hasFullTuLinhInMenhTamHop,
  };

  let luuNien: ZiweiLuuNienIR | null = null;
  if (targetYear !== undefined) {
    if (!Number.isInteger(targetYear)) {
      throw new RangeError(`targetYear must be an integer; received ${targetYear}`);
    }
    const tyStem = floorMod(targetYear - 4, 10);
    const tyBranch = floorMod(targetYear - 4, 12);
    const nominalAge = targetYear - temporal.lunarActive.lunarYear + 1;
    const tieuHanPalaceBranch = floorMod(
      khoiTieuHan + genderSign * floorMod(tyBranch - yBranch, 12),
      12,
    );
    const activeDaiHan = palaces.find(
      (p) => nominalAge >= p.daiHanStartAge && nominalAge <= p.daiHanEndAge,
    );

    const luuLocTonBranch = axiom.locTonByStem[tyStem]!;
    const luuDongTinhByBranch: string[][] = Array.from({ length: 12 }, () => []);
    luuDongTinhByBranch[tyBranch]!.push('Lưu Thái Tuế');
    luuDongTinhByBranch[floorMod(tyBranch + 2, 12)]!.push('Lưu Tang Môn');
    luuDongTinhByBranch[floorMod(tyBranch + 8, 12)]!.push('Lưu Bạch Hổ');
    luuDongTinhByBranch[floorMod(6 - tyBranch, 12)]!.push('Lưu Thiên Khốc');
    luuDongTinhByBranch[floorMod(6 + tyBranch, 12)]!.push('Lưu Thiên Hư');
    luuDongTinhByBranch[luuLocTonBranch]!.push('Lưu Lộc Tồn');
    luuDongTinhByBranch[floorMod(luuLocTonBranch + 1, 12)]!.push('Lưu Kình Dương');
    luuDongTinhByBranch[floorMod(luuLocTonBranch - 1, 12)]!.push('Lưu Đà La');
    luuDongTinhByBranch[computeThienMaBranch(tyBranch)]!.push('Lưu Thiên Mã');
    for (const bucket of luuDongTinhByBranch) {
      bucket.sort(compareCodePoint);
    }

    const luuSihuaTuple = axiom.sihuaByStem[String(tyStem)]!;
    const luuNienSihua: ZiweiLuuNienSihuaIR[] = [];
    for (let i = 0; i < 4; i++) {
      const starName = luuSihuaTuple[i]!;
      const transform = SIHUA_LABELS[i]!;
      const host = palaces.find(
        (p) =>
          p.majorStars.some((s) => s.name === starName) ||
          p.minorStars.some((s) => s.name === starName),
      )!;
      luuNienSihua.push({
        transform,
        starName,
        branchIndex: host.branchIndex,
        palaceName: host.palaceName,
      });
    }

    const month1Branch = floorMod(tieuHanPalaceBranch - (m - 1) + hBranch, 12);
    const nguyetHan: ZiweiNguyetHanEntryIR[] = [];
    for (let lunarMonth = 1; lunarMonth <= 12; lunarMonth++) {
      const bIdx = floorMod(month1Branch + (lunarMonth - 1), 12);
      const pal = palaces[bIdx]!;
      nguyetHan.push({
        lunarMonth,
        branchIndex: bIdx,
        branchVi: pal.branchVi,
        palaceName: pal.palaceName,
      });
    }

    luuNien = {
      targetYear,
      yearStemIndex: tyStem,
      yearBranchIndex: tyBranch,
      yearCanChiVi: `${STEMS_VI[tyStem]} ${BRANCHES_VI[tyBranch]}`,
      nominalAge,
      luuNienPalaceBranch: tyBranch,
      tieuHanPalaceBranch,
      activeDaiHanPalaceBranch: activeDaiHan ? activeDaiHan.branchIndex : null,
      luuDongTinhByBranch,
      luuNienSihua,
      nguyetHan,
    };
  }

  return {
    silo,
    siloNameVi: axiom.nameVi,
    gender,
    yinYangLabelVi,
    direction,
    menhBranch,
    thanBranch,
    menhChuStar: axiom.menhChuByBranch[menhBranch]!,
    thanChuStar: axiom.thanChuByBranch[yBranch]!,
    cucNumber,
    cucNameVi,
    banMenhNapAmVi,
    tuViBranch,
    thienPhuBranch,
    tuanTrungBranches,
    trietLoBranches,
    palaces,
    thaiTueTamHopTuLinh,
    luuNien,
  };
}
