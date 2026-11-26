import { floorMod } from '@sovana/geo-time';
import { loadZiweiPatternCatalog } from './store.js';
import type {
  SihuaTransform,
  ZiweiChartIR,
  ZiweiDinhTapHitIR,
  ZiweiDinhTapReportIR,
  ZiweiPalaceIR,
  ZiweiPatternCatalogSpec,
  ZiweiPatternLevel,
  ZiweiStarIR,
  ZiweiStructuredPatternIR,
} from './types.js';

const TU_SAT = ['Kình Dương', 'Đà La', 'Hỏa Tinh', 'Linh Tinh'] as const;
const KHONG_KIEP = ['Địa Không', 'Địa Kiếp'] as const;
const LUC_SAT = [...TU_SAT, ...KHONG_KIEP] as const;
const BAT_CAT_LOC_MA = [
  'Tả Phụ',
  'Hữu Bật',
  'Văn Xương',
  'Văn Khúc',
  'Thiên Khôi',
  'Thiên Việt',
  'Lộc Tồn',
  'Thiên Mã',
] as const;
const TU_MO = new Set([1, 4, 7, 10]);

const findStar = (p: ZiweiPalaceIR, name: string): ZiweiStarIR | undefined =>
  p.majorStars.find((s) => s.name === name) ?? p.minorStars.find((s) => s.name === name);

const hasStar = (p: ZiweiPalaceIR, name: string): boolean => findStar(p, name) !== undefined;

const findPal = (c: ZiweiChartIR, name: string): ZiweiPalaceIR | undefined =>
  c.palaces.find((p) => hasStar(p, name));

const sfBranches = (b: number): [number, number, number, number] => {
  const x = floorMod(b, 12);
  return [x, (x + 4) % 12, (x + 8) % 12, (x + 6) % 12];
};

const sfSetOf = (c: ZiweiChartIR, b = c.menhBranch): Set<string> => {
  const s = new Set<string>();
  for (const idx of sfBranches(b)) {
    const p = c.palaces[idx]!;
    for (const st of p.majorStars) s.add(st.name);
    for (const st of p.minorStars) s.add(st.name);
  }
  return s;
};

const isClamping = (prev: ZiweiPalaceIR, next: ZiweiPalaceIR, a: string, b: string): boolean =>
  (hasStar(prev, a) && hasStar(next, b)) || (hasStar(prev, b) && hasStar(next, a));

const isBright = (p: ZiweiPalaceIR, name: string): boolean => {
  const b = findStar(p, name)?.brightness;
  return b === 'Miếu' || b === 'Vượng' || b === 'Đắc';
};

const isMiaoWang = (s: ZiweiStarIR): boolean => s.brightness === 'Miếu' || s.brightness === 'Vượng';
const isHam = (p: ZiweiPalaceIR, name: string): boolean => findStar(p, name)?.brightness === 'Hãm';
const getSh = (p: ZiweiPalaceIR, name: string): SihuaTransform | null =>
  findStar(p, name)?.sihuaTransform ?? null;

const palHasSh = (p: ZiweiPalaceIR, t: SihuaTransform): boolean =>
  p.majorStars.some((s) => s.sihuaTransform === t) || p.minorStars.some((s) => s.sihuaTransform === t);

const sfHasSh = (c: ZiweiChartIR, t: SihuaTransform, b = c.menhBranch): boolean =>
  sfBranches(b).some((idx) => palHasSh(c.palaces[idx]!, t));

const countInPal = (p: ZiweiPalaceIR, list: readonly string[]): number =>
  list.reduce((n, st) => n + (hasStar(p, st) ? 1 : 0), 0);

const countInSf = (c: ZiweiChartIR, list: readonly string[], b = c.menhBranch): number =>
  sfBranches(b).reduce((n, idx) => n + countInPal(c.palaces[idx]!, list), 0);

function effectiveTier(
  base: Exclude<ZiweiPatternLevel, 'PHA_CACH'>,
  bonus: readonly string[],
  breaking: readonly string[],
): ZiweiPatternLevel {
  if (base === 'CANH_BAO') return bonus.length >= 2 && breaking.length === 0 ? 'TRUNG_CACH' : 'CANH_BAO';
  if (breaking.length > 0) return 'PHA_CACH';
  if (base === 'CAT_CACH' && bonus.length >= 2) return 'THUONG_CACH';
  if (base === 'TRUNG_CACH' && bonus.length >= 1) return 'CAT_CACH';
  return base;
}

export function detectStructuredPatterns(chart: ZiweiChartIR): ZiweiStructuredPatternIR[] {
  const cat: ZiweiPatternCatalogSpec = loadZiweiPatternCatalog();
  const out: ZiweiStructuredPatternIR[] = [];
  const ming = chart.palaces[chart.menhBranch]!;
  const oppMing = chart.palaces[(chart.menhBranch + 6) % 12]!;
  const prevMing = chart.palaces[floorMod(chart.menhBranch - 1, 12)]!;
  const nextMing = chart.palaces[floorMod(chart.menhBranch + 1, 12)]!;
  const sf = sfSetOf(chart);
  const mingSfBr = sfBranches(chart.menhBranch);

  const emit = (
    id: string,
    palaces: string[],
    required: string[],
    bonus: string[] = [],
    breaking: string[] = [],
    overrideName?: string,
    overrideBase?: Exclude<ZiweiPatternLevel, 'PHA_CACH'>,
  ) => {
    const meta = cat.patterns[id];
    if (!meta) return;
    const baseLevel = overrideBase ?? meta[2];
    const eff = effectiveTier(baseLevel, bonus, breaking);
    out.push({
      id,
      nameVi: overrideName ?? meta[0],
      hanziOriginal: meta[1],
      baseLevel,
      effectiveLevel: eff,
      isBroken: eff === 'PHA_CACH',
      palaces,
      classicalSource: meta[3],
      conditions: { required, bonus, breaking },
      descriptionVi: meta[4],
      adviceVi: meta[5],
    });
  };

  if (hasStar(ming, 'Tử Vi') && sf.has('Tả Phụ') && sf.has('Hữu Bật')) {
    const bn: string[] = [];
    const br: string[] = [];
    if (sf.has('Văn Xương') || sf.has('Văn Khúc')) bn.push('Hội thêm Văn Xương / Văn Khúc');
    if (sf.has('Thiên Khôi') || sf.has('Thiên Việt')) bn.push('Có Khôi Việt quý nhân chiếu trợ');
    if (getSh(ming, 'Tử Vi') === 'Hóa Quyền' || getSh(ming, 'Tử Vi') === 'Hóa Khoa') bn.push('Tử Vi đắc Hóa Quyền / Hóa Khoa');
    if (countInSf(chart, KHONG_KIEP) >= 2) br.push('Địa Không – Địa Kiếp hội chiếu');
    if (ming.trietLo) br.push('Triệt Lộ đóng tại Mệnh');
    emit('PAT-01', ['Mệnh'], ['Tử Vi tọa thủ Mệnh', 'Tả Phụ – Hữu Bật đồng hội'], bn, br);
  }

  const zwPal = findPal(chart, 'Tử Vi');
  const tpPal = findPal(chart, 'Thiên Phủ');
  if (zwPal && tpPal && zwPal.branchIndex === tpPal.branchIndex) {
    const inM = zwPal.branchIndex === chart.menhBranch;
    const bn: string[] = [];
    const br: string[] = [];
    if (sf.has('Tả Phụ') && sf.has('Hữu Bật')) bn.push('Tả Phụ – Hữu Bật hội đủ');
    if (hasStar(zwPal, 'Lộc Tồn') || palHasSh(zwPal, 'Hóa Lộc')) bn.push('Hội Lộc tại cung Tử Phủ');
    if (countInPal(zwPal, KHONG_KIEP) > 0) br.push('Cung Tử Phủ gặp Không / Kiếp');
    if (countInPal(zwPal, TU_SAT) >= 2) br.push('Song sát đồng độ');
    emit('PAT-02', [zwPal.palaceName], [`Tử Vi – Thiên Phủ đồng cung tại ${zwPal.palaceName}`], bn, br, undefined, inM ? 'THUONG_CACH' : 'CAT_CACH');
  }

  const ttPal = findPal(chart, 'Thiên Tướng');
  if (
    tpPal &&
    ttPal &&
    tpPal.branchIndex !== ttPal.branchIndex &&
    mingSfBr.includes(tpPal.branchIndex) &&
    mingSfBr.includes(ttPal.branchIndex)
  ) {
    const bn: string[] = [];
    const br: string[] = [];
    if (hasStar(ming, 'Lộc Tồn') || sfHasSh(chart, 'Hóa Lộc')) bn.push('Tam phương hội Lộc dưỡng Ấn – Khố');
    if (sf.has('Tả Phụ') || sf.has('Hữu Bật')) bn.push('Có Phụ Bật nâng đỡ');
    if (ttPal.trietLo) br.push('Thiên Tướng gặp Triệt Lộ');
    if (countInSf(chart, TU_SAT) >= 3) br.push('Tam phương hội nhiều sát tinh');
    emit('PAT-03', [tpPal.palaceName, ttPal.palaceName], ['Thiên Phủ và Thiên Tướng chầu về Mệnh'], bn, br);
  }

  if (sf.has('Thái Dương') && sf.has('Thiên Lương') && sf.has('Văn Xương') && sf.has('Lộc Tồn')) {
    const sPal = findPal(chart, 'Thái Dương')!;
    const lPal = findPal(chart, 'Thiên Lương')!;
    const bn: string[] = [];
    const br: string[] = [];
    if (isBright(sPal, 'Thái Dương')) bn.push('Thái Dương miếu vượng');
    if (isBright(lPal, 'Thiên Lương')) bn.push('Thiên Lương đắc địa');
    if (sfHasSh(chart, 'Hóa Khoa')) bn.push('Gia hội Hóa Khoa');
    if (isHam(sPal, 'Thái Dương')) br.push('Thái Dương lạc hãm');
    if (countInSf(chart, TU_SAT) >= 2) br.push('Tam phương sát tinh nặng');
    emit('PAT-04', [sPal.palaceName, lPal.palaceName], ['Thái Dương, Thiên Lương, Văn Xương, Lộc Tồn hội Mệnh'], bn, br);
  }

  const thamPal = findPal(chart, 'Tham Lang');
  if (thamPal && mingSfBr.includes(thamPal.branchIndex)) {
    for (const [shaName, patId] of [['Hỏa Tinh', 'PAT-05'], ['Linh Tinh', 'PAT-06']] as const) {
      const shaPal = findPal(chart, shaName);
      if (shaPal && sfBranches(thamPal.branchIndex).includes(shaPal.branchIndex)) {
        const same = thamPal.branchIndex === shaPal.branchIndex;
        const bn: string[] = [];
        const br: string[] = [];
        if (same) bn.push(`Tham Lang đồng độ ${shaName}`);
        if (isBright(thamPal, 'Tham Lang')) bn.push('Tham Lang miếu vượng');
        if (getSh(thamPal, 'Tham Lang') === 'Hóa Lộc' || getSh(thamPal, 'Tham Lang') === 'Hóa Quyền') bn.push('Tham Lang Hóa Lộc / Quyền');
        if (countInPal(thamPal, ['Kình Dương', 'Đà La']) > 0) br.push('Lẫn Kình Dương / Đà La');
        if (countInPal(thamPal, KHONG_KIEP) > 0 || getSh(thamPal, 'Tham Lang') === 'Hóa Kỵ') br.push('Gặp Không Kiếp / Hóa Kỵ');
        emit(patId, same ? [thamPal.palaceName] : [thamPal.palaceName, shaPal.palaceName], [`Tham Lang ${same ? 'đồng cung' : 'hội chiếu'} ${shaName}`], bn, br, undefined, same ? 'THUONG_CACH' : 'CAT_CACH');
      }
    }
  }

  const vuPal = findPal(chart, 'Vũ Khúc');
  if (
    vuPal &&
    thamPal &&
    (vuPal.branchIndex === thamPal.branchIndex || (vuPal.branchIndex + 6) % 12 === thamPal.branchIndex) &&
    (mingSfBr.includes(vuPal.branchIndex) || mingSfBr.includes(thamPal.branchIndex))
  ) {
    const bn: string[] = [];
    const br: string[] = [];
    if (sf.has('Hỏa Tinh') || sf.has('Linh Tinh')) bn.push('Hội Hỏa / Linh Tinh');
    if (getSh(vuPal, 'Vũ Khúc') === 'Hóa Lộc' || getSh(vuPal, 'Vũ Khúc') === 'Hóa Quyền') bn.push('Vũ Khúc Hóa Lộc / Quyền');
    if (countInPal(vuPal, ['Kình Dương', 'Đà La', ...KHONG_KIEP]) > 0) br.push('Vướng Kình Đà / Không Kiếp');
    emit('PAT-07', [vuPal.palaceName], ['Vũ Khúc – Tham Lang hội trục Sửu/Mùi'], bn, br);
  }

  if (sf.has('Thất Sát') && sf.has('Phá Quân') && sf.has('Tham Lang')) {
    const bn: string[] = [];
    const br: string[] = [];
    if (sfHasSh(chart, 'Hóa Lộc') || sfHasSh(chart, 'Hóa Quyền')) bn.push('Đắc Hóa Lộc / Hóa Quyền');
    if (sf.has('Tả Phụ') && sf.has('Hữu Bật')) bn.push('Tả Hữu đồng hội');
    if (countInSf(chart, TU_SAT) >= 3) br.push('Tứ Sát hội dày');
    if (countInPal(ming, KHONG_KIEP) > 0) br.push('Mệnh tọa Không Kiếp');
    emit('PAT-08', ['Mệnh', 'Quan Lộc', 'Tài Bạch'], ['Thất Sát, Phá Quân, Tham Lang tam hợp Mệnh'], bn, br);
  }

  const cmdl = ['Thiên Cơ', 'Thái Âm', 'Thiên Đồng', 'Thiên Lương'].filter((s) => sf.has(s));
  if (cmdl.length === 4) {
    const bn: string[] = [];
    const br: string[] = [];
    if (sf.has('Văn Xương') || sf.has('Văn Khúc')) bn.push('Hội Xương Khúc');
    if (sfHasSh(chart, 'Hóa Khoa') || sfHasSh(chart, 'Hóa Lộc')) bn.push('Đắc Hóa Khoa / Hóa Lộc');
    if (countInSf(chart, TU_SAT) >= 3 || countInPal(ming, TU_SAT) > 0) br.push('Sát tinh xâm phạm hệ tĩnh');
    emit('PAT-09', ['Mệnh', 'Quan Lộc', 'Tài Bạch'], ['Cơ – Nguyệt – Đồng – Lương tề hội'], bn, br);
  } else if (cmdl.length === 3) {
    emit('PAT-34', ['Mệnh'], [`Tam phương hội 3/4 sao (${cmdl.join(', ')})`]);
  }

  const liemPal = findPal(chart, 'Liêm Trinh');
  if (liemPal && ttPal && liemPal.branchIndex === ttPal.branchIndex) {
    const bn: string[] = [];
    const br: string[] = [];
    if (hasStar(liemPal, 'Lộc Tồn') || getSh(liemPal, 'Liêm Trinh') === 'Hóa Lộc') bn.push('Gặp Lộc thanh hóa');
    if (hasStar(liemPal, 'Kình Dương')) br.push('Đồng cung Kình Dương (Hình Tù Giáp Ấn)');
    if (getSh(liemPal, 'Liêm Trinh') === 'Hóa Kỵ') br.push('Liêm Trinh Hóa Kỵ');
    emit('PAT-10', [liemPal.palaceName], [`Liêm Trinh – Thiên Tướng đồng cung tại ${liemPal.branchVi}`], bn, br);
  }

  const satPal = findPal(chart, 'Thất Sát');
  if (vuPal && satPal && vuPal.branchIndex === satPal.branchIndex && mingSfBr.includes(vuPal.branchIndex)) {
    const bn: string[] = [];
    const br: string[] = [];
    if (getSh(vuPal, 'Vũ Khúc') === 'Hóa Quyền' || getSh(vuPal, 'Vũ Khúc') === 'Hóa Lộc') bn.push('Vũ Khúc Hóa Quyền / Lộc');
    if (getSh(vuPal, 'Vũ Khúc') === 'Hóa Kỵ') br.push('Vũ Khúc Hóa Kỵ');
    if (countInPal(vuPal, TU_SAT) > 0) br.push('Thêm Tứ Sát đồng cung');
    emit('PAT-11', [vuPal.palaceName], [`Vũ Khúc – Thất Sát đồng cung tại ${vuPal.branchVi}`], bn, br);
  }

  const dongPal = findPal(chart, 'Thiên Đồng');
  const luongPal = findPal(chart, 'Thiên Lương');
  if (dongPal && luongPal && dongPal.branchIndex === luongPal.branchIndex && mingSfBr.includes(dongPal.branchIndex)) {
    const bn: string[] = [];
    const br: string[] = [];
    if (getSh(dongPal, 'Thiên Đồng') === 'Hóa Lộc' || getSh(dongPal, 'Thiên Lương') === 'Hóa Khoa') bn.push('Đắc Lộc / Khoa');
    if (countInPal(dongPal, TU_SAT) > 0) br.push('Sát tinh đồng độ');
    emit('PAT-12', [dongPal.palaceName], [`Thiên Đồng – Thiên Lương đồng cung tại ${dongPal.branchVi}`], bn, br);
  }

  const sunPal = findPal(chart, 'Thái Dương');
  const moonPal = findPal(chart, 'Thái Âm');
  if (sunPal && moonPal && sunPal.branchIndex === moonPal.branchIndex && mingSfBr.includes(sunPal.branchIndex)) {
    const bn: string[] = [];
    const br: string[] = [];
    if (sunPal.tuanTrung || sunPal.trietLo) bn.push('Tuần / Triệt phản vi kỳ cách');
    if (sf.has('Văn Xương') && sf.has('Văn Khúc')) bn.push('Xương Khúc hội chiếu');
    if (countInPal(sunPal, TU_SAT) > 0) br.push('Tứ Sát đồng độ');
    emit('PAT-13', [sunPal.palaceName], [`Thái Dương – Thái Âm đồng cung tại ${sunPal.branchVi}`], bn, br);
  }

  if (isClamping(prevMing, nextMing, 'Thái Dương', 'Thái Âm')) {
    const sP = hasStar(prevMing, 'Thái Dương') ? prevMing : nextMing;
    const mP = hasStar(prevMing, 'Thái Âm') ? prevMing : nextMing;
    emit(
      'PAT-14',
      ['Mệnh', prevMing.palaceName, nextMing.palaceName],
      ['Thái Dương và Thái Âm giáp hai bên cung Mệnh'],
      isBright(sP, 'Thái Dương') && isBright(mP, 'Thái Âm') ? ['Nhật Nguyệt đều sáng'] : [],
      isHam(sP, 'Thái Dương') || isHam(mP, 'Thái Âm') ? ['Nhật hoặc Nguyệt lạc hãm'] : [],
    );
  }

  const cuPal = findPal(chart, 'Cự Môn');
  if (cuPal && sunPal && cuPal.branchIndex === sunPal.branchIndex && mingSfBr.includes(cuPal.branchIndex)) {
    const bn: string[] = [];
    const br: string[] = [];
    if (cuPal.branchIndex === 2) bn.push('Cự Nhật tại Dần mặt trời bình minh');
    if (getSh(cuPal, 'Cự Môn') === 'Hóa Lộc' || getSh(cuPal, 'Cự Môn') === 'Hóa Quyền') bn.push('Cự Môn Hóa Lộc / Quyền');
    if (getSh(cuPal, 'Cự Môn') === 'Hóa Kỵ' || getSh(cuPal, 'Thái Dương') === 'Hóa Kỵ') br.push('Cự / Nhật Hóa Kỵ');
    emit('PAT-15', [cuPal.palaceName], [`Cự Môn – Thái Dương đồng cung tại ${cuPal.branchVi}`], bn, br, undefined, cuPal.branchIndex === 2 ? 'THUONG_CACH' : 'CAT_CACH');
  }

  if (hasStar(ming, 'Cự Môn') && (ming.branchIndex === 0 || ming.branchIndex === 6)) {
    const bn: string[] = [];
    const br: string[] = [];
    if (getSh(ming, 'Cự Môn') === 'Hóa Lộc' || getSh(ming, 'Cự Môn') === 'Hóa Quyền' || sfHasSh(chart, 'Hóa Khoa')) bn.push('Đắc Lộc / Quyền / Khoa');
    if (getSh(ming, 'Cự Môn') === 'Hóa Kỵ') br.push('Cự Môn Hóa Kỵ');
    if (countInPal(ming, TU_SAT) > 0) br.push('Sát tinh đồng cung');
    emit('PAT-16', ['Mệnh'], [`Cự Môn thủ Mệnh tại ${ming.branchVi}`], bn, br);
  }

  if (ming.branchIndex === 7 && ming.voChinhDieu && hasStar(oppMing, 'Thái Dương') && hasStar(oppMing, 'Thái Âm')) {
    emit(
      'PAT-17',
      ['Mệnh', 'Thiên Di'],
      ['Mệnh Vô Chính Diệu tại Mùi, Nhật Nguyệt Sửu cung xung chiếu'],
      sf.has('Văn Xương') || sf.has('Văn Khúc') ? ['Hội Xương Khúc'] : [],
      countInSf(chart, TU_SAT) >= 2 ? ['Sát tinh xâm phạm'] : [],
    );
  }

  if (hasStar(ming, 'Tử Vi') && ming.majorStars.length === 1) {
    const bn = sf.has('Tả Phụ') || sf.has('Hữu Bật') ? ['Có Tả / Hữu phò tá'] : [];
    const br: string[] = [];
    if (!sf.has('Tả Phụ') && !sf.has('Hữu Bật')) br.push('Thiếu Tả Hữu (Tại Dã Cô Quân)');
    if (countInPal(ming, KHONG_KIEP) > 0) br.push('Tử Vi gặp Không Kiếp');
    emit('PAT-18', ['Mệnh'], [`Tử Vi độc tọa Mệnh (${ming.branchVi})`], bn, br);
  }

  if (isClamping(prevMing, nextMing, 'Tả Phụ', 'Hữu Bật')) {
    emit('PAT-19', ['Mệnh', prevMing.palaceName, nextMing.palaceName], ['Tả Phụ – Hữu Bật giáp Mệnh']);
  }
  if (isClamping(prevMing, nextMing, 'Văn Xương', 'Văn Khúc')) {
    emit('PAT-20', ['Mệnh', prevMing.palaceName, nextMing.palaceName], ['Văn Xương – Văn Khúc giáp Mệnh']);
  }
  if (isClamping(prevMing, nextMing, 'Thiên Khôi', 'Thiên Việt')) {
    emit('PAT-21', ['Mệnh', prevMing.palaceName, nextMing.palaceName], ['Thiên Khôi – Thiên Việt giáp Mệnh']);
  }

  if (sf.has('Lộc Tồn') && sfHasSh(chart, 'Hóa Lộc')) {
    emit('PAT-22', ['Mệnh', 'Tài Bạch', 'Quan Lộc'], ['Lộc Tồn và Hóa Lộc đồng hội tam phương'], [], countInPal(ming, KHONG_KIEP) > 0 ? ['Mệnh gặp Không Kiếp'] : []);
  }

  const hLoc = sfHasSh(chart, 'Hóa Lộc');
  const hQuyen = sfHasSh(chart, 'Hóa Quyền');
  const hKhoa = sfHasSh(chart, 'Hóa Khoa');
  if (hLoc && hQuyen && hKhoa) {
    emit('PAT-23', ['Mệnh', 'Tài Bạch', 'Quan Lộc'], ['Hóa Lộc, Hóa Quyền, Hóa Khoa tề hội'], [], countInSf(chart, KHONG_KIEP) >= 2 ? ['Không Kiếp hội nặng'] : []);
  } else if (hQuyen && hKhoa) {
    emit('PAT-24', ['Mệnh'], ['Hóa Khoa và Hóa Quyền đồng hội tam phương']);
  }

  const luMing = ming.majorStars.find((s) => s.sihuaTransform === 'Hóa Lộc');
  if (luMing) emit('PAT-25', ['Mệnh'], [`${luMing.name} Hóa Lộc tọa thủ Mệnh`], [], [], `${luMing.name} Hóa Lộc Thủ Mệnh`);

  const taiPal = chart.palaces.find((p) => p.palaceName === 'Tài Bạch');
  const luTai = taiPal?.majorStars.find((s) => s.sihuaTransform === 'Hóa Lộc');
  if (taiPal && luTai) emit('PAT-26', ['Tài Bạch'], [`${luTai.name} Hóa Lộc nhập Tài Bạch`]);

  const quanPal = chart.palaces.find((p) => p.palaceName === 'Quan Lộc');
  const qQuan = quanPal?.majorStars.find((s) => s.sihuaTransform === 'Hóa Quyền');
  if (quanPal && qQuan) emit('PAT-27', ['Quan Lộc'], [`${qQuan.name} Hóa Quyền nhập Quan Lộc`]);

  const thanPal = chart.palaces[chart.thanBranch]!;
  for (const tPal of [ming, thanPal]) {
    const kStar = [...tPal.majorStars, ...tPal.minorStars].find((s) => s.sihuaTransform === 'Hóa Khoa');
    if (kStar) {
      emit('PAT-28', [tPal.palaceName], [`${kStar.name} Hóa Khoa tọa ${tPal.palaceName}`], [], [], tPal.isMenh ? 'Hóa Khoa Thủ Mệnh' : 'Hóa Khoa Cư Thân');
      break;
    }
  }

  const ltPal = findPal(chart, 'Lộc Tồn');
  if (ltPal && (ltPal.branchIndex === chart.menhBranch || ltPal.branchIndex === chart.thanBranch)) {
    emit('PAT-29', [ltPal.palaceName], [`Lộc Tồn tọa thủ ${ltPal.palaceName}`], [], [], ltPal.isMenh ? 'Lộc Tồn Thủ Mệnh' : 'Lộc Tồn Thủ Thân');
  }

  const maPal = findPal(chart, 'Thiên Mã');
  if (maPal && (maPal.branchIndex === chart.menhBranch || maPal.branchIndex === oppMing.branchIndex)) {
    const withLu = sf.has('Lộc Tồn') || hLoc;
    emit(
      'PAT-30',
      [maPal.palaceName],
      [`Thiên Mã tại ${maPal.palaceName}`, ...(withLu ? ['Hội Lộc Tồn / Hóa Lộc'] : [])],
      [],
      maPal.trietLo || maPal.tuanTrung ? ['Thiên Mã gặp Tuần / Triệt'] : [],
      withLu ? 'Lộc Mã Giao Trì' : maPal.isMenh ? 'Thiên Mã Thủ Mệnh' : 'Thiên Mã Cư Thiên Di',
      withLu ? 'THUONG_CACH' : 'TRUNG_CACH',
    );
  }

  if (sf.has('Văn Xương') && sf.has('Văn Khúc')) {
    const xkKy =
      getSh(findPal(chart, 'Văn Xương')!, 'Văn Xương') === 'Hóa Kỵ' ||
      getSh(findPal(chart, 'Văn Khúc')!, 'Văn Khúc') === 'Hóa Kỵ';
    emit('PAT-31', ['Mệnh'], ['Văn Xương – Văn Khúc đồng hội tam phương'], [], xkKy ? ['Xương / Khúc Hóa Kỵ'] : []);
  }
  if (sf.has('Tả Phụ') && sf.has('Hữu Bật')) emit('PAT-32', ['Mệnh'], ['Tả Phụ – Hữu Bật đồng hội tam phương']);
  if (sf.has('Thiên Khôi') && sf.has('Thiên Việt')) emit('PAT-33', ['Mệnh'], ['Thiên Khôi – Thiên Việt đồng hội tam phương']);

  for (const p of [ming, oppMing]) {
    const ky = [...p.majorStars, ...p.minorStars].find((s) => s.sihuaTransform === 'Hóa Kỵ');
    if (ky) {
      const inM = p.branchIndex === chart.menhBranch;
      emit(
        'PAT-35',
        [p.palaceName],
        [`${ky.name} Hóa Kỵ tọa tại ${p.palaceName}`],
        p.tuanTrung || p.trietLo ? ['Tuần / Triệt chế giảm xung lực Hóa Kỵ'] : [],
        [],
        inM ? `${ky.name} Hóa Kỵ Thủ Mệnh` : `${ky.name} Hóa Kỵ Xung Mệnh`,
      );
    }
  }

  if (palHasSh(ming, 'Hóa Kỵ') && isClamping(prevMing, nextMing, 'Kình Dương', 'Đà La')) {
    emit('PAT-36', ['Mệnh', prevMing.palaceName, nextMing.palaceName], ['Mệnh tọa Hóa Kỵ bị Kình – Đà giáp']);
  }
  if (isClamping(prevMing, nextMing, 'Hỏa Tinh', 'Linh Tinh')) {
    emit('PAT-37', ['Mệnh', prevMing.palaceName, nextMing.palaceName], ['Hỏa Tinh – Linh Tinh giáp Mệnh'], hasStar(ming, 'Tham Lang') ? ['Mệnh có Tham Lang'] : []);
  }
  if (isClamping(prevMing, nextMing, 'Địa Không', 'Địa Kiếp')) {
    emit('PAT-38', ['Mệnh', prevMing.palaceName, nextMing.palaceName], ['Địa Không – Địa Kiếp giáp Mệnh']);
  }
  if (sf.has('Liêm Trinh') && sf.has('Thất Sát') && sf.has('Kình Dương')) {
    emit('PAT-39', ['Mệnh'], ['Liêm Trinh, Thất Sát, Kình Dương hội tam phương'], hKhoa || sf.has('Thiên Khôi') ? ['Có Khoa / Khôi chế hóa'] : []);
  }
  if (sf.has('Cự Môn') && sf.has('Hỏa Tinh') && sf.has('Kình Dương')) {
    emit('PAT-40', ['Mệnh'], ['Cự Môn, Hỏa Tinh, Kình Dương hội tam phương']);
  }
  if (sf.has('Linh Tinh') && sf.has('Văn Xương') && sf.has('Đà La') && sf.has('Vũ Khúc')) {
    emit('PAT-41', ['Mệnh'], ['Linh Tinh, Văn Xương, Đà La, Vũ Khúc tứ tinh hội']);
  }
  if (ming.branchIndex === 6 && hasStar(ming, 'Kình Dương')) {
    const bn: string[] = [];
    if (sf.has('Thất Sát') || sf.has('Phá Quân') || hasStar(ming, 'Thiên Đồng')) bn.push('Hội Thất Sát / Phá Quân / Đồng Lương');
    if (sf.has('Thiên Khôi') || sf.has('Thiên Việt') || hQuyen) bn.push('Đắc Quyền / Khôi Việt gia trì');
    emit('PAT-42', ['Mệnh'], ['Kình Dương cư Ngọ thủ Mệnh'], bn);
  }

  return out;
}

// ────────────────── 8 CÁCH VẬN HẠN〈ĐỊNH TẠP CỤC〉──────────────────

const isWeakPal = (c: ZiweiChartIR, b: number): boolean => {
  const m = c.palaces[floorMod(b, 12)]!.majorStars;
  return m.length === 0 || m.every((s) => s.brightness === 'Hãm');
};

const isStrongPal = (c: ZiweiChartIR, b: number): boolean =>
  c.palaces[floorMod(b, 12)]!.majorStars.some(isMiaoWang);

const countCatBr = (c: ZiweiChartIR, brs: readonly number[]): number =>
  brs.reduce((n, b) => {
    const p = c.palaces[floorMod(b, 12)]!;
    return (
      n +
      countInPal(p, BAT_CAT_LOC_MA) +
      p.majorStars.filter((s) => s.sihuaTransform && s.sihuaTransform !== 'Hóa Kỵ').length
    );
  }, 0);

const countSatBr = (c: ZiweiChartIR, brs: readonly number[]): number =>
  brs.reduce((n, b) => n + countInPal(c.palaces[floorMod(b, 12)]!, LUC_SAT), 0);

const isHanHao = (c: ZiweiChartIR, b: number): boolean => {
  if (!isStrongPal(c, b)) return false;
  const sf = sfBranches(b);
  return countCatBr(c, sf) >= 2 && countSatBr(c, sf) <= 1;
};

const sitsKong = (c: ZiweiChartIR, starName: string): boolean => {
  const p = findPal(c, starName);
  return Boolean(
    p &&
      (p.tuanTrung ||
        p.trietLo ||
        hasStar(p, 'Địa Không') ||
        hasStar(p, 'Địa Kiếp') ||
        hasStar(p, 'Thiên Không')),
  );
};

function lnGrade(c: ZiweiChartIR, birthYear: number, age: number): 'CAT' | 'HUNG' | 'BINH' {
  const b = floorMod(birthYear + age - 5, 12);
  const p = c.palaces[b]!;
  if (palHasSh(p, 'Hóa Kỵ') || countInPal(p, LUC_SAT) >= 2) return 'HUNG';
  const sf = sfBranches(b);
  const hasLu = sf.some((x) => hasStar(c.palaces[x]!, 'Lộc Tồn') || palHasSh(c.palaces[x]!, 'Hóa Lộc'));
  return hasLu || countCatBr(c, sf) >= 2 ? 'CAT' : 'BINH';
}

export function detectDinhTapCuc(
  chart: ZiweiChartIR,
  lunarBirthYear: number,
  options?: { readonly targetYear?: number | undefined },
): ZiweiDinhTapReportIR {
  const cat = loadZiweiPatternCatalog();
  const sortedDx = [...chart.palaces].sort((a, b) => a.daiHanStartAge - b.daiHanStartAge);
  const allHits: ZiweiDinhTapHitIR[] = [];

  const pushDx = (id: string, dx: ZiweiPalaceIR, prefixVi?: string) => {
    const meta = cat.dinhTap[id];
    if (!meta) return;
    allHits.push({
      id,
      no: meta[0],
      nameVi: meta[1],
      hanziOriginal: meta[2],
      classicalNote: meta[3],
      status: meta[4],
      unit: 'DAI_HAN',
      polarity: meta[5],
      startAge: dx.daiHanStartAge,
      endAge: dx.daiHanEndAge,
      startYear: lunarBirthYear + dx.daiHanStartAge - 1,
      endYear: lunarBirthYear + dx.daiHanEndAge - 1,
      palaceBranch: dx.branchIndex,
      palaceBranchVi: dx.branchVi,
      palaceName: dx.palaceName,
      detailVi: `${prefixVi ?? `Đại Hạn ${dx.daiHanStartAge}–${dx.daiHanEndAge}t (${dx.palaceName} · ${dx.branchVi})`}: ${meta[6]}`,
      adviceVi: meta[7],
    });
  };

  if (isWeakPal(chart, chart.menhBranch) && isWeakPal(chart, chart.thanBranch)) {
    for (const dx of sortedDx) {
      const sf = sfBranches(dx.branchIndex);
      if (
        sf.some((b) => hasStar(chart.palaces[b]!, 'Lộc Tồn') || palHasSh(chart.palaces[b]!, 'Hóa Lộc')) &&
        sf.some((b) => hasStar(chart.palaces[b]!, 'Thiên Mã'))
      ) {
        pushDx('DT-01', dx);
      }
    }
  }

  for (const dx of sortedDx) {
    if (countInPal(dx, LUC_SAT) >= 1 && isHanHao(chart, dx.branchIndex)) pushDx('DT-02', dx);
  }

  if (sitsKong(chart, 'Lộc Tồn') && sitsKong(chart, 'Thiên Mã')) {
    for (const dx of sortedDx) {
      if (sfBranches(dx.branchIndex).some((b) => hasStar(chart.palaces[b]!, 'Thất Sát'))) pushDx('DT-03', dx);
    }
  }

  for (const dx of sortedDx) {
    if (dx.daiHanStartAge >= 40 && TU_MO.has(dx.branchIndex) && isStrongPal(chart, dx.branchIndex)) {
      pushDx('DT-04', dx);
    }
  }

  for (let i = 1; i < sortedDx.length; i++) {
    const prev = sortedDx[i - 1]!;
    const cur = sortedDx[i]!;
    if (isWeakPal(chart, prev.branchIndex) && isWeakPal(chart, cur.branchIndex)) {
      pushDx('DT-05', cur, `Nối tiếp ${prev.daiHanStartAge}–${prev.daiHanEndAge}t sang ${cur.daiHanStartAge}–${cur.daiHanEndAge}t (${cur.palaceName})`);
    }
  }

  const dt06 = cat.dinhTap['DT-06'];
  const maxAge = Math.min(95, sortedDx[sortedDx.length - 1]?.daiHanEndAge ?? 90);
  if (dt06) {
    for (let age = 1; age < maxAge; age++) {
      const g1 = lnGrade(chart, lunarBirthYear, age);
      const g2 = lnGrade(chart, lunarBirthYear, age + 1);
      if ((g1 === 'CAT' && g2 === 'HUNG') || (g1 === 'HUNG' && g2 === 'CAT')) {
        const y1 = lunarBirthYear + age - 1;
        const b2 = floorMod(y1 - 3, 12);
        const pal2 = chart.palaces[b2]!;
        allHits.push({
          id: 'DT-06',
          no: dt06[0],
          nameVi: dt06[1],
          hanziOriginal: dt06[2],
          classicalNote: dt06[3],
          status: dt06[4],
          unit: 'LUU_NIEN',
          polarity: g2 === 'CAT' ? 'CAT' : 'TRUNG',
          startAge: age,
          endAge: age + 1,
          startYear: y1,
          endYear: y1 + 1,
          palaceBranch: b2,
          palaceBranchVi: pal2.branchVi,
          palaceName: pal2.palaceName,
          detailVi: `Năm ${y1}–${y1 + 1} (${age}–${age + 1}t Âm, cung ${pal2.palaceName}): ${dt06[6]}`,
          adviceVi: dt06[7],
        });
      }
    }
  }

  const mingWeak = isWeakPal(chart, chart.menhBranch);
  const mingHasMaj = chart.palaces[chart.menhBranch]!.majorStars.length > 0;
  for (const dx of sortedDx) {
    if (!isHanHao(chart, dx.branchIndex)) continue;
    if (mingWeak) pushDx('DT-08', dx);
    else if (mingHasMaj) pushDx('DT-07', dx);
  }

  allHits.sort((a, b) => a.no - b.no || a.startAge - b.startAge);
  const effectiveYear = options?.targetYear ?? chart.luuNien?.targetYear ?? null;
  const targetAge = effectiveYear !== null ? effectiveYear - lunarBirthYear + 1 : null;
  const activeHits =
    targetAge !== null
      ? allHits.filter((h) =>
          h.unit === 'DAI_HAN'
            ? targetAge >= h.startAge && targetAge <= h.endAge
            : targetAge === h.startAge || targetAge === h.endAge,
        )
      : [];

  return { targetYear: effectiveYear, targetAge, allHits, activeHits };
}
