// ponytail: compact prose & lookup tables keep @sovana/solver < 25 KB gzipped without external JSON plumbing
import { BRANCHES_VI, STEMS_VI, floorMod } from '@sovana/geo-time';
import {
  getSihuaTupleByStem,
  type BaziChartIR,
  type ChartIR,
  type SihuaTransform,
  type ZiweiChartIR,
  type ZiweiPalaceIR,
  type ZiweiSilo,
} from '@sovana/kernel';
import type {
  HopBanBondType,
  HopBanCrossPhiHoaFlightIR,
  HopBanMode,
  HopBanModeEvaluationIR,
  HopBanOptions,
  HopBanPersonSummaryIR,
  HopBanPillarScoreIR,
  HopBanReportIR,
} from './types.js';

const SIHUA: readonly SihuaTransform[] = ['Hóa Lộc', 'Hóa Quyền', 'Hóa Khoa', 'Hóa Kỵ'];
const SAT = new Set(['Kình Dương', 'Đà La', 'Hỏa Tinh', 'Linh Tinh', 'Địa Không', 'Địa Kiếp']);
const CAT = new Set(['Tả Phụ', 'Hữu Bật', 'Văn Xương', 'Văn Khúc', 'Thiên Khôi', 'Thiên Việt', 'Lộc Tồn']);
const DAO = new Set(['Hồng Loan', 'Thiên Hỷ', 'Đào Hoa']);
const LH = new Set([1, 23, 34, 49, 58, 67]);
const GEN: Readonly<Record<string, string>> = { Mộc: 'Hỏa', Hỏa: 'Thổ', Thổ: 'Kim', Kim: 'Thủy', Thủy: 'Mộc' };
const GBY: Readonly<Record<string, string>> = { Hỏa: 'Mộc', Thổ: 'Hỏa', Kim: 'Thổ', Thủy: 'Kim', Mộc: 'Thủy' };

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(n)));
const palOf = (z: ZiweiChartIR, name: string): ZiweiPalaceIR =>
  z.palaces.find((p) => p.palaceName === (name === 'Giao Hữu' ? 'Nô Bộc' : name)) ?? z.palaces[z.menhBranch]!;
const majors = (p: ZiweiPalaceIR): string[] => (p.voChinhDieu ? p.borrowedMajorStars : p.majorStars).map((s) => s.name);
const allSt = (p: ZiweiPalaceIR) => [...p.majorStars, ...p.minorStars];
const cnt = (p: ZiweiPalaceIR, s: ReadonlySet<string>): number => allSt(p).filter((x) => s.has(x.name)).length;
const hasSh = (p: ZiweiPalaceIR, t: SihuaTransform): boolean => allSt(p).some((x) => x.sihuaTransform === t);
const hostOf = (z: ZiweiChartIR, star: string): ZiweiPalaceIR =>
  z.palaces.find((p) => allSt(p).some((x) => x.name === star)) ?? z.palaces[z.menhBranch]!;

function triad(z: ZiweiChartIR, b: number): Set<string> {
  const s = new Set<string>();
  for (const d of [0, 4, 8, 6]) for (const n of majors(z.palaces[floorMod(b + d, 12)]!)) s.add(n);
  return s;
}

function inferDungHy(b: BaziChartIR): [string, string] {
  const ext = (b as BaziChartIR & { phuUcDungThan?: { dungThanElementVi: string; hyThanElementVi: string } }).phuUcDungThan;
  if (ext) return [ext.dungThanElementVi, ext.hyThanElementVi];
  const dm = b.dayMasterElementVi;
  if (b.strengthClass === 'THAN_NHUOC') return [GBY[dm] ?? 'Thủy', dm];
  const o = GEN[dm] ?? 'Mộc';
  return [o, GEN[o] ?? 'Hỏa'];
}

function archOf(z: ZiweiChartIR): Pick<HopBanPersonSummaryIR, 'archetypeId' | 'archetypeLabelVi'> {
  const s = triad(z, z.menhBranch);
  if (s.has('Thất Sát') || s.has('Phá Quân') || s.has('Tham Lang')) return { archetypeId: 'SAT_PHA_THAM', archetypeLabelVi: 'Sát Phá Tham (Khai phá)' };
  if (['Tử Vi', 'Thiên Phủ', 'Vũ Khúc', 'Thiên Tướng'].filter((x) => s.has(x)).length >= 2) return { archetypeId: 'TU_PHU_VU_TUONG', archetypeLabelVi: 'Tử Phủ Vũ Tướng (Quản trị)' };
  if (['Thiên Cơ', 'Thái Âm', 'Thiên Đồng', 'Thiên Lương'].filter((x) => s.has(x)).length >= 3) return { archetypeId: 'CO_NGUYET_DONG_LUONG', archetypeLabelVi: 'Cơ Nguyệt Đồng Lương (Mưu lược)' };
  if (s.has('Cự Môn') || s.has('Thái Dương')) return { archetypeId: 'CU_NHAT', archetypeLabelVi: 'Cự Nhật (Minh triết)' };
  return { archetypeId: 'HON_HOP', archetypeLabelVi: 'Đa Hệ Linh Hoạt' };
}

function summarize(c: ChartIR, z: ZiweiChartIR, label: string, yr: number): HopBanPersonSummaryIR {
  const age = yr - c.temporal.lunarActive.lunarYear + 1;
  const dx = z.palaces.find((p) => age >= p.daiHanStartAge && age <= p.daiHanEndAge) ?? z.palaces[z.menhBranch]!;
  const [dungThanElementVi, hyThanElementVi] = inferDungHy(c.bazi);
  return {
    label,
    gender: c.gender,
    lunarYearCanChiVi: c.temporal.pillars.lunarYearPillar.labelVi,
    cucNameVi: z.cucNameVi,
    napAmVi: z.banMenhNapAmVi,
    ...archOf(z),
    menhBranchVi: z.palaces[z.menhBranch]!.branchVi,
    menhMajorStars: majors(z.palaces[z.menhBranch]!),
    phuTheMajorStars: majors(palOf(z, 'Phu Thê')),
    phucDucMajorStars: majors(palOf(z, 'Phúc Đức')),
    quanLocMajorStars: majors(palOf(z, 'Quan Lộc')),
    taiBachMajorStars: majors(palOf(z, 'Tài Bạch')),
    dayMasterVi: c.bazi.dayMasterStemVi,
    dayMasterElementVi: c.bazi.dayMasterElementVi,
    dungThanElementVi,
    hyThanElementVi,
    activeDaiHanRange: age < z.cucNumber ? `Đồng hạn (${Math.max(1, age)}t)` : `${dx.daiHanStartAge}–${dx.daiHanEndAge}t`,
    activeDaiHanPalaceName: dx.palaceName,
  };
}

function buildFlights(cA: ChartIR, zA: ZiweiChartIR, lA: string, cB: ChartIR, zB: ZiweiChartIR, lB: string): HopBanCrossPhiHoaFlightIR[] {
  const out: HopBanCrossPhiHoaFlightIR[] = [];
  const keyAll = new Set(['Mệnh', 'Phu Thê', 'Phúc Đức', 'Quan Lộc', 'Tài Bạch', 'Điền Trạch']);
  const emit = (dir: 'A_TO_B' | 'B_TO_A', from: string, to: string, stem: number, dst: ZiweiChartIR) => {
    const tup = getSihuaTupleByStem(stem, dst.silo);
    const stemVi = STEMS_VI[stem]!;
    for (let i = 0; i < 4; i++) {
      const tr = SIHUA[i]!;
      const star = tup[i]!;
      const h = hostOf(dst, star);
      const opp = dst.palaces[(h.branchIndex + 6) % 12]!.palaceName;
      const isKey = keyAll.has(h.palaceName);
      let impact: 'CAT' | 'TRUNG' | 'CANH_BAO' = 'TRUNG';
      let noteVi = `${from} (${stemVi}) phi ${tr} (${star}) → ${h.palaceName} của ${to}.`;
      if ((tr === 'Hóa Lộc' || tr === 'Hóa Khoa') && isKey) {
        impact = 'CAT';
        noteVi = `${from} phi ${tr} (${star}) nhập ${h.palaceName} của ${to}: tăng phúc duyên, trợ lực rõ.`;
      } else if (tr === 'Hóa Kỵ' && (['Mệnh', 'Phu Thê', 'Quan Lộc', 'Tài Bạch'].includes(h.palaceName) || opp === 'Mệnh' || opp === 'Phu Thê')) {
        impact = 'CANH_BAO';
        noteVi = `${from} phi Hóa Kỵ (${star}) vào ${h.palaceName} (xung ${opp}) của ${to}: dễ kỳ vọng cao hoặc hiểu lầm.`;
      }
      out.push({
        direction: dir,
        fromPersonLabel: from,
        toPersonLabel: to,
        stemIndex: stem,
        stemVi,
        transform: tr,
        starName: star,
        targetBranchIndex: h.branchIndex,
        targetBranchVi: h.branchVi,
        targetPalaceName: h.palaceName,
        impact,
        noteVi,
      });
    }
  };
  emit('A_TO_B', lA, lB, cA.temporal.pillars.lunarYearPillar.stemIndex, zB);
  emit('B_TO_A', lB, lA, cB.temporal.pillars.lunarYearPillar.stemIndex, zA);
  return out;
}

function dxGrade(z: ZiweiChartIR, birthYr: number, yr: number): 0 | 1 | 2 {
  const age = Math.max(1, yr - birthYr + 1);
  const dx = z.palaces.find((p) => age >= p.daiHanStartAge && age <= p.daiHanEndAge) ?? z.palaces[z.menhBranch]!;
  const m = dx.voChinhDieu ? dx.borrowedMajorStars : dx.majorStars;
  const bright = m.some((s) => s.brightness === 'Miếu' || s.brightness === 'Vượng' || s.brightness === 'Đắc');
  const sat = cnt(dx, SAT);
  const ky = hasSh(dx, 'Hóa Kỵ');
  const cat = cnt(dx, CAT) >= 1 || hasSh(dx, 'Hóa Lộc') || hasSh(dx, 'Hóa Quyền') || hasSh(dx, 'Hóa Khoa');
  return (bright || cat) && sat <= 1 && !ky ? 2 : ky || sat >= 2 ? 0 : 1;
}

function strongEls(b: BaziChartIR): Set<string> {
  const e = Object.entries(b.elementScoresBps).sort((a, c) => c[1] - a[1]);
  const s = new Set([b.dayMasterElementVi]);
  for (const x of e.slice(0, 2)) if (x[1] >= 2200) s.add(x[0]);
  return s;
}

const RATINGS: readonly [number, 1 | 2 | 3 | 4 | 5, string][] = [
  [82, 5, 'Thiên Tác Tương Thành'],
  [70, 4, 'Tương Đắc Bền Vững'],
  [56, 3, 'Hòa Hợp Có Điều Kiện'],
  [42, 2, 'Khác Biệt Cần Thấu Hiểu'],
  [0, 1, 'Thử Thách Cần Thận Trọng'],
];

function evalMode(
  mode: HopBanMode,
  cA: ChartIR,
  zA: ZiweiChartIR,
  sA: HopBanPersonSummaryIR,
  cB: ChartIR,
  zB: ZiweiChartIR,
  sB: HopBanPersonSummaryIR,
  flights: readonly HopBanCrossPhiHoaFlightIR[],
  yr: number,
): HopBanModeEvaluationIR {
  const mar = mode === 'HON_NHAN';
  const tA = triad(zA, zA.menhBranch);
  const tB = triad(zB, zB.menhBranch);
  const [aA, aB] = [sA.archetypeId, sB.archetypeId];
  const mk = (id: HopBanPillarScoreIR['id'], titleVi: string, score: number, maxScore: number, v: [string, string, string], th: [number, number], h: string[], c: string[]): HopBanPillarScoreIR => ({
    id,
    titleVi,
    score,
    maxScore,
    verdictVi: score >= th[0] ? v[0] : score >= th[1] ? v[1] : v[2],
    highlightsVi: h,
    cautionsVi: c,
  });

  // 1. Cốt cách Mệnh – Phúc
  let p1 = 15;
  const p1H: string[] = [];
  const p1C: string[] = [];
  if (aA === aB) {
    if (aA === 'SAT_PHA_THAM') {
      p1 = mar ? 11 : 15;
      (mar ? p1C : p1H).push(mar ? 'Cùng hệ Sát Phá Tham cá tính mạnh, cần nhường nhịn khi bất đồng.' : 'Cùng hệ Sát Phá Tham quyết đoán, cần phân rõ người chốt cuối.');
    } else {
      p1 = 17;
      p1H.push(`Đồng điệu cốt cách ${sA.archetypeLabelVi.split(' (')[0]}, chung hệ giá trị.`);
    }
  } else if ((aA === 'TU_PHU_VU_TUONG' && aB === 'CO_NGUYET_DONG_LUONG') || (aB === 'TU_PHU_VU_TUONG' && aA === 'CO_NGUYET_DONG_LUONG')) {
    p1 = 18;
    p1H.push('Quân Thần – Mưu Lược bổ trợ lý tưởng: tổ chức vững và kế hoạch chu toàn.');
  } else if (aA === 'SAT_PHA_THAM' || aB === 'SAT_PHA_THAM') {
    p1 = 16;
    p1H.push('Thế Động – Tĩnh bù trừ: người tiên phong khai phá, người giữ hậu phương.');
  } else {
    p1H.push(`Cốt cách ${sA.label} và ${sB.label} hài hòa, dễ bổ sung góc nhìn.`);
  }
  const ph = (z: ZiweiChartIR) => cnt(palOf(z, 'Phúc Đức'), SAT) + (hasSh(palOf(z, 'Phúc Đức'), 'Hóa Kỵ') ? 1 : 0);
  const [plA, plB] = [ph(zA), ph(zB)];
  if (plA <= 1 && plB <= 1) { p1 += 2; p1H.push('Phúc Đức đôi bên bình ổn, giàu bao dung.'); }
  else if (plA >= 2 && plB >= 2) { p1 -= 2; p1C.push('Phúc Đức đôi bên có áp lực nội tâm, cần khoảng nghỉ tinh thần.'); }
  p1 = clamp(p1, 4, 20);

  // 2. Cung chuyên trách
  let p2 = 14;
  const p2H: string[] = [];
  const p2C: string[] = [];
  if (mar) {
    const mA = new Set(sA.menhMajorStars);
    const mB = new Set(sB.menhMajorStars);
    const abM = sA.phuTheMajorStars.some((s) => mB.has(s));
    const baM = sB.phuTheMajorStars.some((s) => mA.has(s));
    const abT = sA.phuTheMajorStars.some((s) => tB.has(s));
    const baT = sB.phuTheMajorStars.some((s) => tA.has(s));
    if (abM && baM) { p2 += 9; p2H.push('Thiên Tác Chi Hợp hai chiều: Phu Thê ứng thẳng Mệnh đối phương.'); }
    else if (abM || baM) { p2 += 6; p2H.push('Phu Thê ứng trực tiếp Chính tinh Mệnh đối phương.'); }
    else if (abT && baT) { p2 += 5; p2H.push('Phu Thê hai bên giao hội Tam Phương Mệnh của nhau.'); }
    else if (abT || baT) { p2 += 2; p2H.push('Phu Thê có mạch liên thông Tam Hợp Mệnh đối phương.'); }
    for (const [c, z, lb] of [[cA, zA, sA.label], [cB, zB, sB.label]] as const) {
      const tg = c.gender === 'female' ? 'Thái Dương' : 'Thái Âm';
      const st = allSt(hostOf(z, tg)).find((x) => x.name === tg);
      if (st && (st.brightness === 'Miếu' || st.brightness === 'Vượng')) { p2 += 1; p2H.push(`${tg} (${lb}) ${st.brightness}, trợ hòa khí.`); }
      else if (st?.sihuaTransform === 'Hóa Kỵ' && st.brightness === 'Hãm') { p2 -= 2; p2C.push(`${tg} (${lb}) hãm gặp Kỵ: cần khéo dung hòa gia đạo.`); }
      const pt = palOf(z, 'Phu Thê');
      if (hasSh(pt, 'Hóa Kỵ') || cnt(pt, SAT) >= 2) { p2 -= 2; p2C.push(`Phu Thê ${lb} hội sát/Kỵ: nên thống nhất nguyên tắc rõ ràng.`); }
    }
  } else {
    const ab = [...sA.quanLocMajorStars, ...sA.taiBachMajorStars].some((s) => tB.has(s));
    const ba = [...sB.quanLocMajorStars, ...sB.taiBachMajorStars].some((s) => tA.has(s));
    if (ab && ba) { p2 += 7; p2H.push('Trục Quan – Tài ăn khớp hai chiều Tam Hợp Mệnh, thuận phân vai.'); }
    else if (ab || ba) { p2 += 4; p2H.push('Quan – Tài giao thoa chuyên môn rõ với bản mệnh cộng sự.'); }
    for (const [z, lb] of [[zA, sA.label], [zB, sB.label]] as const) {
      const nb = palOf(z, 'Nô Bộc');
      const hd = palOf(z, 'Huynh Đệ');
      const ky = hasSh(nb, 'Hóa Kỵ') || hasSh(hd, 'Hóa Kỵ');
      if (cnt(nb, CAT) + cnt(hd, CAT) >= 2 && !ky) { p2 += 2; p2H.push(`Huynh – Nô ${lb} hội cát tinh, chủ chữ tín.`); }
      if (ky || (majors(nb).includes('Cự Môn') && cnt(nb, SAT) >= 1)) { p2 -= 2; p2C.push(`Cung cộng tác ${lb} dễ khẩu thiệt; cần hợp đồng minh bạch.`); }
    }
  }
  p2 = clamp(p2, 5, 25);

  // 3. Phi Hóa chéo
  let p3 = 15;
  const p3H: string[] = [];
  const p3C: string[] = [];
  const kPal = new Set(mar ? ['Mệnh', 'Phu Thê', 'Phúc Đức', 'Điền Trạch', 'Tài Bạch'] : ['Mệnh', 'Quan Lộc', 'Tài Bạch', 'Thiên Di', 'Nô Bộc']);
  let [lkAB, lkBA, qn] = [0, 0, 0];
  let [kyAB, kyBA] = [false, false];
  for (const fl of flights) {
    const opp = (fl.direction === 'A_TO_B' ? zB : zA).palaces[(fl.targetBranchIndex + 6) % 12]!.palaceName;
    if ((fl.transform === 'Hóa Lộc' || fl.transform === 'Hóa Khoa') && kPal.has(fl.targetPalaceName)) {
      p3 += fl.transform === 'Hóa Lộc' ? 4 : 3;
      if (fl.direction === 'A_TO_B') lkAB++; else lkBA++;
      p3H.push(fl.noteVi);
    } else if (fl.transform === 'Hóa Quyền' && kPal.has(fl.targetPalaceName)) {
      p3 += 2; qn++; p3H.push(fl.noteVi);
    } else if (fl.transform === 'Hóa Kỵ' && (kPal.has(fl.targetPalaceName) || opp === 'Mệnh' || (mar ? opp === 'Phu Thê' : opp === 'Quan Lộc' || opp === 'Tài Bạch'))) {
      p3 -= 4;
      if (fl.direction === 'A_TO_B') kyAB = true; else kyBA = true;
      p3C.push(fl.noteVi);
    }
  }
  p3 = clamp(p3, 4, 25);

  let bondType: HopBanBondType = 'BINH_HOA_DONG_HANH';
  let bondTypeLabelVi = 'Bình Hòa Đồng Hành';
  if (kyAB && kyBA && lkAB + lkBA === 0) { bondType = 'NGHICH_DUYEN_CAN_TU'; bondTypeLabelVi = 'Duyên Nợ Thử Thách'; }
  else if (lkAB >= 1 && lkBA >= 1) { bondType = 'SONG_LOC_GIAO_DUYEN'; bondTypeLabelVi = 'Song Lộc Khoa Tương Sinh'; }
  else if (lkAB + lkBA >= 2) { bondType = 'KHOA_LOC_TUONG_TRO'; bondTypeLabelVi = 'Khoa Lộc Tương Trợ'; }
  else if (qn >= 1 && lkAB + lkBA >= 1) { bondType = 'QUYEN_LOC_BO_KHUYET'; bondTypeLabelVi = 'Quyền Lộc Phối Hợp'; }

  // 4. Bát Tự bổ khuyết
  let p4 = 8;
  const p4H: string[] = [];
  const p4C: string[] = [];
  const [elA, elB] = [cA.bazi.dayMasterElementVi, cB.bazi.dayMasterElementVi];
  if (Math.abs(cA.bazi.dayMasterStemIndex - cB.bazi.dayMasterStemIndex) === 5) {
    p4 += 4; p4H.push(`Nhật Chủ ${sA.dayMasterVi} – ${sB.dayMasterVi} Ngũ Hợp, tâm đầu ý hợp.`);
  } else if (GEN[elA] === elB || GEN[elB] === elA) {
    p4 += 2; p4H.push(`Nhật Chủ ${elA} – ${elB} tương sinh, dễ tiếp sức.`);
  }
  const [dA, dB] = [cA.bazi.dayPillar.pillar.branchIndex, cB.bazi.dayPillar.pillar.branchIndex];
  const diff = floorMod(dA - dB, 12);
  if (LH.has(Math.min(dA, dB) * 10 + Math.max(dA, dB)) || diff === 4 || diff === 8) {
    p4 += 2; p4H.push(`Trụ Ngày ${BRANCHES_VI[dA]} – ${BRANCHES_VI[dB]} tương hợp.`);
  } else if (diff === 6) {
    p4 -= 2; p4C.push(`Trụ Ngày ${BRANCHES_VI[dA]} – ${BRANCHES_VI[dB]} lục xung: khác nhịp sinh hoạt.`);
  }
  const [stA, stB] = [strongEls(cA.bazi), strongEls(cB.bazi)];
  const abH = stA.has(sB.dungThanElementVi) || stA.has(sB.hyThanElementVi);
  const baH = stB.has(sA.dungThanElementVi) || stB.has(sA.hyThanElementVi);
  if (abH && baH) { p4 += 3; p4H.push(`Bổ khuyết hai chiều Dụng/Hỷ Thần (${sA.dungThanElementVi} & ${sB.dungThanElementVi}).`); }
  else if (abH || baH) { p4 += 2; p4H.push(`Khí vượng ${abH ? sA.label : sB.label} trợ Dụng Thần ${abH ? sB.dungThanElementVi : sA.dungThanElementVi}.`); }
  p4 = clamp(p4, 3, 15);

  // 5. Đồng pha Đại Hạn & Lưu Niên
  let p5 = 11;
  const p5H: string[] = [];
  const p5C: string[] = [];
  const [gA, gB] = [dxGrade(zA, cA.temporal.lunarActive.lunarYear, yr), dxGrade(zB, cB.temporal.lunarActive.lunarYear, yr)];
  if (gA === 2 && gB === 2) { p5 = 14; p5H.push(`Năm ${yr} cả hai hành Đại Hạn thuận lợi, đẹp cho cam kết lớn.`); }
  else if (gA === 0 && gB === 0) { p5 = 7; p5C.push(`Năm ${yr} Đại Hạn đôi bên có thử thách, ưu tiên củng cố nền tảng.`); }
  else if (gA === 2 || gB === 2) { p5 = 12; p5H.push(`${gA === 2 ? sA.label : sB.label} ở Đại Hạn vượng, hợp làm điểm tựa.`); }
  else { p5H.push('Đại Hạn đôi bên bình ổn, thuận vun đắp từng bước.'); }
  const tyB = floorMod(yr - 4, 12);
  const [lnA, lnB] = [zA.palaces[tyB]!.palaceName, zB.palaces[tyB]!.palaceName];
  if (mar && (lnA === 'Phu Thê' || lnB === 'Phu Thê' || cnt(zA.palaces[tyB]!, DAO) > 0)) {
    p5 = clamp(p5 + 1, 4, 15); p5H.push(`Lưu Niên ${yr} kích hoạt tín hiệu nhân duyên / hỷ tín.`);
  } else if (!mar && ['Quan Lộc', 'Tài Bạch'].some((n) => lnA === n || lnB === n)) {
    p5 = clamp(p5 + 1, 4, 15); p5H.push(`Lưu Niên ${yr} vào trục Quan – Tài, thuận mở dự án.`);
  }

  const pillars: HopBanPillarScoreIR[] = [
    mk('cot_cach_menh_phuc', 'Cốt Cách Mệnh – Phúc Đức', p1, 20, ['Đồng điệu cao', 'Hài hòa', 'Cần nhường nhịn'], [16, 13], p1H, p1C),
    mk('doi_chieu_cung_chuyen_trach', mar ? 'Phu Thê ↔ Mệnh & Nhật Nguyệt' : 'Trục Quan – Tài – Cộng Sự', p2, 25, ['Ứng hợp sâu', 'Thuận lợi', 'Cần quy ước rõ'], [20, 15], p2H, p2C),
    mk('phi_hoa_tuong_tac_cheo', 'Phi Hóa Tương Tác Chéo', p3, 25, [bondTypeLabelVi, bondTypeLabelVi, bondTypeLabelVi], [20, 15], p3H, p3C),
    mk('bo_khuyet_bat_tu_ngu_hanh', 'Bổ Khuyết Bát Tự & Dụng Thần', p4, 15, ['Tương trợ mạnh', 'Cân bằng', 'Cần dung hòa'], [12, 9], p4H, p4C),
    mk('dong_pha_dai_han_luu_nien', `Đồng Pha Đại Hạn (${yr})`, p5, 15, ['Thuận thời điểm', 'Ổn định', 'Củng cố nội lực'], [13, 10], p5H, p5C),
  ];

  const totalScore = clamp(p1 + p2 + p3 + p4 + p5, 15, 99);
  const [, starRating, ratingLabelVi] = RATINGS.find(([min]) => totalScore >= min) ?? RATINGS[4]!;
  const strengthsVi = pillars.flatMap((p) => p.highlightsVi).slice(0, 5);
  const frictionPointsVi = pillars.flatMap((p) => p.cautionsVi).slice(0, 4);

  return {
    mode,
    modeLabelVi: mar ? 'Hợp Hôn & Tình Duyên Gia Đạo' : 'Hợp Tác Kinh Doanh & Đồng Sự',
    totalScore,
    starRating,
    ratingLabelVi,
    bondType,
    bondTypeLabelVi,
    headlineVi: `${mar ? 'Mối duyên' : 'Sự hợp tác'} giữa ${sA.label} & ${sB.label} đạt ${totalScore}/100 (${ratingLabelVi}), nổi bật thế "${bondTypeLabelVi}".`,
    pillars,
    strengthsVi,
    frictionPointsVi,
    actionableAdviceVi: mar
      ? [
          'Lấy Phúc Đức và sự tôn trọng nhịp riêng làm gốc khi trao đổi việc lớn.',
          kyAB || kyBA ? 'Có mạch Hóa Kỵ bay chéo: tránh suy diễn, nói thẳng nhu cầu cụ thể.' : 'Phát huy mạch cát hóa để lập kế hoạch tích sản Điền – Tài 3–5 năm.',
          `Phân vai theo cốt cách: ${sA.label} (${sA.archetypeLabelVi.split(' (')[0]}) & ${sB.label} (${sB.archetypeLabelVi.split(' (')[0]}).`,
        ]
      : [
          'Phân vai theo tinh bàn: hệ Khai phá mở thị trường, hệ Quản trị nắm dòng tiền.',
          frictionPointsVi.length > 0 ? 'Lập thỏa thuận cổ đông bằng văn bản để khóa rủi ro Nô Bộc / Hóa Kỵ.' : 'Thiết lập báo cáo tài chính minh bạch định kỳ theo trục Quan – Tài.',
          `Căn cứ nhịp Đại Hạn ${yr} để giải ngân vừa sức, ưu tiên dòng tiền thực.`,
        ],
    bestTimingHintVi: mar
      ? `Giai đoạn ${yr}–${yr + 2}, năm Lưu Niên ghé Phu Thê/Phúc Đức hoặc hội Đào Hồng – Hóa Lộc rất thuận việc lớn.`
      : `Giai đoạn ${yr}–${yr + 2}, ưu tiên ký kết vào tháng Nguyệt Hạn ghé Quan/Tài hội Lưu Lộc – Lưu Khoa.`,
  };
}

export function evaluateHopBan(chartA: ChartIR, chartB: ChartIR, options?: HopBanOptions): HopBanReportIR {
  const silo: ZiweiSilo = options?.silo ?? 'nam-phai';
  const zA = silo === 'nam-phai' ? chartA.ziweiNamPhai : chartA.ziweiToanThu;
  const zB = silo === 'nam-phai' ? chartB.ziweiNamPhai : chartB.ziweiToanThu;
  const targetYear = options?.targetYear ?? zA.luuNien?.targetYear ?? zB.luuNien?.targetYear ?? new Date(Date.now() + 7 * 3600_000).getUTCFullYear();
  const labelA = options?.labelA?.trim() || 'Người thứ nhất (A)';
  const labelB = options?.labelB?.trim() || 'Người thứ hai (B)';
  const personA = summarize(chartA, zA, labelA, targetYear);
  const personB = summarize(chartB, zB, labelB, targetYear);
  const crossPhiHoaFlights = buildFlights(chartA, zA, labelA, chartB, zB, labelB);
  return {
    schemaVersion: '1.0.0',
    silo,
    targetYear,
    personA,
    personB,
    crossPhiHoaFlights,
    honNhan: evalMode('HON_NHAN', chartA, zA, personA, chartB, zB, personB, crossPhiHoaFlights, targetYear),
    hopTac: evalMode('HOP_TAC', chartA, zA, personA, chartB, zB, personB, crossPhiHoaFlights, targetYear),
  };
}
