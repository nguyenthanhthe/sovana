import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as zlib from 'node:zlib';

import {
  MS_PER_DAY,
  canonicalJson,
  civilFromEpochDay,
  epochDayFromCivil,
  loadEphemeris,
  loadGeoDataset,
  normalizeBirthTemporal,
  sha256Canonical,
} from '../../packages/geo-time/dist/index.js';
import { castDivinationAtInstant, castZiweiChart, compileChartIR } from '../../packages/kernel/dist/index.js';
import * as solverPkg from '../../packages/solver/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  };
}

function initRectState(candidateBranches, userAge, maxQuestions) {
  const fn = solverPkg.createInitialRectificationState;
  if (fn.length >= 2) {
    return fn(candidateBranches, { userAge, maxQuestions });
  }
  return fn({ candidateBranches, candidateShichenBranches: candidateBranches, userAge, maxQuestions });
}

function buildFullStackVectors(targetCount = 1200) {
  const eph = loadEphemeris();
  const geo = loadGeoDataset();
  const rng = makeRng(0x507a2026);

  const calendarModes = ['VN_UTC7', 'CN_UTC8', 'VN_HISTORICAL'];
  const leapPolicies = ['keep', 'split-15', 'next-month', 'prev-month'];
  const lateZiPolicies = ['next-day', 'current-day'];
  const genders = ['male', 'female'];
  const lineChoices = [6, 7, 8, 9];
  const vectors = [];

  // 1. Curated Historical Smoking Guns & Leap/Can-Canh/Can-Nham Edge Cases
  const curated = [
    { year: 1968, month: 1, day: 29, hour: 0, minute: 15, location: 'Hà Nội', calendarMode: 'VN_UTC7' },
    { year: 1968, month: 1, day: 29, hour: 0, minute: 15, location: 'Hà Nội', calendarMode: 'CN_UTC8' },
    { year: 1968, month: 5, day: 15, hour: 1, minute: 15, location: 'Sài Gòn', calendarMode: 'VN_HISTORICAL' },
    { year: 1968, month: 5, day: 15, hour: 1, minute: 15, location: 'Hà Nội', calendarMode: 'VN_HISTORICAL' },
    {
      year: 1980, month: 8, day: 15, hour: 9, minute: 30,
      location: 'Đà Nẵng', migrationDestination: 'TP. Hồ Chí Minh', calendarMode: 'VN_UTC7',
    },
    { year: 1985, month: 3, day: 25, hour: 14, minute: 0, location: 'Huế', leapMonthPolicy: 'split-15' },
    { year: 1985, month: 4, day: 10, hour: 14, minute: 0, location: 'Huế', leapMonthPolicy: 'split-15' },
    { year: 1985, month: 4, day: 10, hour: 14, minute: 0, location: 'Huế', leapMonthPolicy: 'keep' },
    { year: 1992, month: 10, day: 12, hour: 23, minute: 10, location: 'Cần Thơ', lateZiPolicy: 'next-day' },
    { year: 1992, month: 10, day: 12, hour: 23, minute: 10, location: 'Cần Thơ', lateZiPolicy: 'current-day' },
    { year: 2004, month: 2, day: 4, hour: 19, minute: 50, location: 'Hải Phòng', calendarMode: 'VN_UTC7' },
    { year: 2007, month: 2, day: 17, hour: 23, minute: 45, location: 'Đà Nẵng', calendarMode: 'VN_HISTORICAL' },
  ];

  for (let i = 0; i < curated.length; i++) {
    const b = curated[i];
    vectors.push({
      birth: {
        second: 0,
        calendarMode: 'VN_HISTORICAL',
        leapMonthPolicy: 'split-15',
        lateZiPolicy: 'next-day',
        ...b,
      },
      gender: genders[i % 2],
      targetYear: i % 2 === 0 ? 2026 : 2027,
      liuyaoMode: i % 3 === 0 ? 'manual' : i % 3 === 1 ? 'mai-hoa' : 'none',
      liuyaoLines: i % 3 === 0 ? [6, 7, 8, 9, 7, 8] : undefined,
      userAge: 28 + (i % 35),
      answerOptionIdx: i % 3,
      candidateBranches: i % 2 === 0 ? [0, 1] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    });
  }

  const startDay = epochDayFromCivil(1905, 1, 1);
  const endDay = epochDayFromCivil(2095, 12, 31);
  const spanDays = endDay - startDay + 1;

  // 2. Solar term boundaries, all 63 & 34 provinces, islands, migrations, Liuyao 64-hex coverage
  for (let idx = vectors.length; idx < targetCount; idx++) {
    let ed;
    let hour;
    let minute;
    let second;

    if (idx < 250) {
      const termMs = eph.solarTerms[40 + ((idx * 17) % (eph.solarTerms.length - 80))] + 25_200_000;
      const delta = (idx % 5 - 2) * 180_000;
      const wallMs = termMs + delta;
      ed = Math.floor(wallMs / MS_PER_DAY);
      const secDay = Math.floor((wallMs - ed * MS_PER_DAY) / 1000);
      hour = Math.floor(secDay / 3600);
      minute = Math.floor((secDay % 3600) / 60);
      second = secDay % 60;
    } else {
      ed = startDay + (rng() % spanDays);
      hour = rng() % 24;
      minute = rng() % 60;
      second = idx % 4 === 0 ? rng() % 60 : 0;
    }

    const c = civilFromEpochDay(ed);
    let location;
    if (idx % 5 === 0) {
      location = geo.provincesPost2025[rng() % geo.provincesPost2025.length].id;
    } else if (idx % 5 === 1) {
      location = geo.provincesLegacy63[rng() % geo.provincesLegacy63.length].code;
    } else if (idx % 11 === 0) {
      location = geo.specialZones[rng() % geo.specialZones.length].id;
    } else {
      location = geo.districtsLegacy[rng() % geo.districtsLegacy.length].code;
    }

    const migrationDestination =
      idx % 3 === 0 ? geo.provincesPost2025[rng() % geo.provincesPost2025.length].id : undefined;

    const liuyaoMode = idx % 3 === 0 ? 'manual' : idx % 3 === 1 ? 'mai-hoa' : 'none';
    const liuyaoLines =
      liuyaoMode === 'manual'
        ? Array.from({ length: 6 }, () => lineChoices[rng() % 4])
        : undefined;

    const b0 = rng() % 12;
    const candidateBranches =
      idx % 2 === 0 ? [b0, (b0 + 1) % 12] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

    vectors.push({
      birth: {
        year: c.year,
        month: c.month,
        day: c.day,
        hour,
        minute,
        second,
        location,
        calendarMode: calendarModes[rng() % 3],
        leapMonthPolicy: leapPolicies[rng() % 4],
        lateZiPolicy: lateZiPolicies[rng() % 2],
        migrationDestination,
      },
      gender: genders[rng() % 2],
      targetYear: idx % 4 === 0 ? undefined : 2025 + (rng() % 4),
      liuyaoMode,
      liuyaoLines,
      userAge: 16 + (rng() % 60),
      answerOptionIdx: rng() % 6,
      candidateBranches,
    });
  }

  return vectors;
}

function evaluateSingleFullStackVector(v) {
  const temporal = normalizeBirthTemporal(v.birth);
  const chart = compileChartIR({
    temporal,
    gender: v.gender,
    targetYear: v.targetYear,
    liuyaoLines: v.liuyaoMode === 'manual' ? v.liuyaoLines : undefined,
    castMaiHoa: v.liuyaoMode === 'mai-hoa',
  });
  const dagReport = solverPkg.evaluateRulesDAG(chart);

  const rectInit = initRectState(v.candidateBranches, v.userAge, 5);
  const nextPick = solverPkg.selectNextQuestion(rectInit);
  let rectAfter = rectInit;
  let chosenOptionId = null;
  if (nextPick && nextPick.question && Array.isArray(nextPick.question.options) && nextPick.question.options.length > 0) {
    const opt = nextPick.question.options[v.answerOptionIdx % nextPick.question.options.length];
    chosenOptionId = opt.id;
    rectAfter = solverPkg.answerQuestion(rectInit, nextPick.questionId, chosenOptionId);
  }

  return {
    chart,
    dagReport,
    rectification: {
      initial: rectInit,
      selectedQuestionId: nextPick ? nextPick.questionId : null,
      expectedInfoGainMillibits: nextPick ? nextPick.expectedInfoGainMillibits : 0,
      chosenOptionId,
      updated: rectAfter,
    },
  };
}

function run10kAlgebraicAndConfluenceGates() {
  const rng = makeRng(0x14_04_12_10);
  const startDay = epochDayFromCivil(1900, 2, 1);
  const endDay = epochDayFromCivil(2099, 11, 30);
  const spanDays = endDay - startDay + 1;
  const geo = loadGeoDataset();

  const baseTemp = normalizeBirthTemporal({
    year: 1980, month: 8, day: 15, hour: 12, minute: 0, location: 'Hà Nội', calendarMode: 'VN_UTC7',
  });

  // 10,000-trial algebraic invariant sweep on Ziwei Finite-Ring Z_12
  const trials = 10_000;
  let canCanhCount = 0;
  let canNhamCount = 0;
  const t0Alg = performance.now();

  for (let i = 0; i < trials; i++) {
    const ed = startDay + (rng() % spanDays);
    const c = civilFromEpochDay(ed);
    const loc = geo.provincesLegacy63[i % geo.provincesLegacy63.length].code;
    const gender = i % 2 === 0 ? 'male' : 'female';
    const temporal = normalizeBirthTemporal({
      year: c.year,
      month: c.month,
      day: c.day,
      hour: rng() % 24,
      minute: rng() % 60,
      location: loc,
      calendarMode: i % 3 === 0 ? 'CN_UTC8' : 'VN_UTC7',
      leapMonthPolicy: i % 2 === 0 ? 'split-15' : 'keep',
    });

    for (const silo of ['nam-phai', 'toan-thu']) {
      const zw = castZiweiChart(temporal, gender, silo);
      if (zw.palaces.length !== 12) {
        throw new Error(`Trial ${i} (${silo}): expected 12 palaces, got ${zw.palaces.length}`);
      }
      const branches = new Set();
      const palaceNames = new Set();
      const majors = [];
      let tuanCount = 0;
      let trietCount = 0;
      let tuViPos = -1;
      let thienPhuPos = -1;

      for (const p of zw.palaces) {
        branches.add(p.branchIndex);
        palaceNames.add(p.palaceName);
        if (p.tuanTrung) tuanCount++;
        if (p.trietLo) trietCount++;
        for (const s of p.majorStars) {
          majors.push(s.name);
          if (s.name === 'Tử Vi') tuViPos = p.branchIndex;
          if (s.name === 'Thiên Phủ') thienPhuPos = p.branchIndex;
        }
      }

      if (branches.size !== 12 || palaceNames.size !== 12) {
        throw new Error(`Trial ${i} (${silo}): palaces failed Z_12 bijection`);
      }
      if (majors.length !== 14 || new Set(majors).size !== 14) {
        throw new Error(`Trial ${i} (${silo}): 14 major stars conservation violated (${majors.length})`);
      }
      if ((tuViPos + thienPhuPos) % 12 !== 4) {
        throw new Error(`Trial ${i} (${silo}): mirror symmetry violated: (${tuViPos} + ${thienPhuPos}) % 12 !== 4`);
      }
      if (tuanCount !== 2 || trietCount !== 2) {
        throw new Error(`Trial ${i} (${silo}): expected 2 Tuan & 2 Triet palaces, got ${tuanCount}/${trietCount}`);
      }
    }

    const yStem = temporal.pillars.lunarYearPillar.stemIndex;
    if (yStem === 6 || yStem === 8) {
      const ir = compileChartIR({ temporal, gender });
      if (!ir.empiricalForks.hasSihuaFork) {
        throw new Error(`Trial ${i}: expected hasSihuaFork=true on stemIndex=${yStem}`);
      }
      if (yStem === 6) canCanhCount++;
      if (yStem === 8) canNhamCount++;
    }
  }
  const algElapsedMs = performance.now() - t0Alg;

  // Church-Rosser Confluence test across 100 random rule permutations
  const rulesPath = path.join(repoRoot, 'specs', 'sample_rules', 'public_rules_50.json');
  const rawRulesPayload = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
  const baseRules = Array.isArray(rawRulesPayload) ? rawRulesPayload : rawRulesPayload.rules;
  const chartCanh = compileChartIR({ temporal: baseTemp, gender: 'male', castMaiHoa: true });
  const baselineReportHash = sha256Canonical(solverPkg.evaluateRulesDAG(chartCanh, baseRules));

  for (let p = 0; p < 100; p++) {
    const perm = [...baseRules];
    for (let j = perm.length - 1; j > 0; j--) {
      const k = rng() % (j + 1);
      [perm[j], perm[k]] = [perm[k], perm[j]];
    }
    const h = sha256Canonical(solverPkg.evaluateRulesDAG(chartCanh, perm));
    if (h !== baselineReportHash) {
      throw new Error(`Church-Rosser Confluence violated at permutation ${p}: ${h} !== ${baselineReportHash}`);
    }
  }

  // Kernel latency benchmark (< 0.5 ms/op gate)
  const benchIters = 2000;
  const t0Bench = performance.now();
  for (let b = 0; b < benchIters; b++) {
    compileChartIR({ temporal: baseTemp, gender: b % 2 === 0 ? 'male' : 'female' });
  }
  const kernelMsPerOp = (performance.now() - t0Bench) / benchIters;

  // Bundle gzipped size check across core ESM packages
  const measurePkgGzip = (pkgName) => {
    const distDir = path.join(repoRoot, 'packages', pkgName, 'dist');
    const jsFiles = fs.readdirSync(distDir).filter((f) => f.endsWith('.js')).sort();
    let combined = '';
    for (const f of jsFiles) {
      combined += fs.readFileSync(path.join(distDir, f), 'utf-8') + '\n';
    }
    return {
      rawBytes: Buffer.byteLength(combined, 'utf-8'),
      gzippedBytes: zlib.gzipSync(Buffer.from(combined, 'utf-8'), { level: 9 }).byteLength,
    };
  };

  const bundleSizes = {
    geoTime: measurePkgGzip('geo-time'),
    kernel: measurePkgGzip('kernel'),
    solver: measurePkgGzip('solver'),
  };

  // Synthetic lockstep gate covering all 5 new ConditionAST operators + 5 LiuyaoStateFlag values
  const astVectors = [];
  const sampleDates = [
    { year: 1980, month: 8, day: 15, hour: 0, minute: 30, location: 'Đà Nẵng', gender: 'male' },
    { year: 1995, month: 3, day: 21, hour: 1, minute: 15, location: 'Hà Nội', gender: 'female' },
    { year: 2002, month: 11, day: 4, hour: 21, minute: 40, location: 'TP. Hồ Chí Minh', gender: 'male' },
  ];
  for (let i = 0; i < sampleDates.length; i++) {
    const sd = sampleDates[i];
    const t = normalizeBirthTemporal({
      year: sd.year,
      month: sd.month,
      day: sd.day,
      hour: sd.hour,
      minute: sd.minute,
      location: sd.location,
    });
    const ch = compileChartIR({
      temporal: t,
      gender: sd.gender,
      liuyaoLines: i === 0 ? [7, 8, 7, 8, 7, 8] : [6, 7, 8, 9, 7, 8],
    });
    const zw = ch.ziweiNamPhai;
    const menh = zw.palaces.find((p) => p.palaceName === 'Mệnh');
    const than = zw.palaces.find((p) => p.isThan || p.branchIndex === zw.thanBranch);
    const vcd = zw.palaces.find((p) => p.majorStars.length === 0) ?? zw.palaces[0];
    const twoStarPal = [...zw.palaces]
      .sort((a, b) => a.branchIndex - b.branchIndex)
      .find((p) => p.majorStars.length + p.minorStars.length >= 2);
    const pairStars = [...twoStarPal.majorStars, ...twoStarPal.minorStars]
      .slice(0, 2)
      .map((s) => s.name);
    const pickStar = (b) => {
      const pal = zw.palaces.find((p) => p.branchIndex === ((b % 12) + 12) % 12);
      return pal.majorStars[0]?.name ?? pal.minorStars[0]?.name ?? pal.thaiTueStar;
    };

    const ly = ch.liuyao;
    const theIdx = ly.lines.findIndex((l) => l.isThe);
    const theBranch = ly.lines[theIdx].branchIndex;
    const synthChart = {
      ...ch,
      liuyao: {
        ...ly,
        monthBranchIndex: 2,
        nhatThanBranch: (theBranch + 6) % 12,
        lines: ly.lines.map((l, idx) =>
          idx === theIdx
            ? { ...l, isMoving: false, elementVi: 'Hỏa', isTuanKhong: true, isNguyetPha: false }
            : idx === 0
              ? { ...l, isTuanKhong: false, isNguyetPha: true }
              : { ...l, isTuanKhong: false, isNguyetPha: false },
        ),
        phucThan: [
          {
            lineNumber: 1,
            missingRelativeVi: 'Thê Tài',
            stemIndex: 0,
            branchIndex: 4,
            branchVi: 'Thìn',
            elementVi: 'Hỏa',
            phiThanBranchVi: 'Dần',
            phiThanElementVi: 'Mộc',
            phiThanRelativeVi: 'Huynh Đệ',
          },
          {
            lineNumber: 2,
            missingRelativeVi: 'Quan Quỷ',
            stemIndex: 1,
            branchIndex: 6,
            branchVi: 'Ngọ',
            elementVi: 'Mộc',
            phiThanBranchVi: 'Thân',
            phiThanElementVi: 'Kim',
            phiThanRelativeVi: 'Phụ Mẫu',
          },
        ],
      },
    };

    const astRules = [
      {
        id: 'LS-BRANCH-THAN',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: { op: 'palace_branch_in', palace: 'Thân', branches: [than.branchIndex] },
        claimVi: 'Thân branch',
        classicalSource: 'Lockstep',
      },
      {
        id: 'LS-BRANCH-GIAOHUU',
        silo: 'toan-thu',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: {
          op: 'palace_branch_in',
          palace: 'Giao Hữu',
          branches: [ch.ziweiToanThu.palaces.find((p) => p.palaceName === 'Nô Bộc').branchIndex],
        },
        claimVi: 'Giao Hữu branch',
        classicalSource: 'Lockstep',
      },
      ...(['opposite', 'prev', 'next', 'nhi_hop']).map((rel, rIdx) => {
        const b = menh.branchIndex;
        const target =
          rel === 'opposite'
            ? (b + 6) % 12
            : rel === 'prev'
              ? (b + 11) % 12
              : rel === 'next'
                ? (b + 1) % 12
                : (13 - b) % 12;
        return {
          id: `LS-REL-${rIdx}-${rel}`,
          silo: 'nam-phai',
          stratum: 1,
          domain: 'menh',
          polarity: 'CAT',
          when: {
            op: 'star_in_relative_palace',
            palace: 'Mệnh',
            relation: rel,
            star: pickStar(target),
          },
          claimVi: `Rel ${rel}`,
          classicalSource: 'Lockstep',
        };
      }),
      {
        id: 'LS-MAJOR-COUNT',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'TRUNG',
        when: { op: 'palace_major_count', palace: vcd.palaceName, exact: vcd.majorStars.length },
        claimVi: 'Major count',
        classicalSource: 'Lockstep',
      },
      {
        id: 'LS-STAR-COUNT',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: {
          op: 'palace_star_count_in',
          palace: twoStarPal.palaceName,
          stars: [pairStars[0], pairStars[0], pairStars[1]],
          min: 2,
          max: 2,
        },
        claimVi: 'Star count',
        classicalSource: 'Lockstep',
      },
      {
        id: 'LS-COLOC-PAL',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: { op: 'star_co_located', palace: twoStarPal.palaceName, stars: [pairStars[1], pairStars[0]] },
        claimVi: 'Co-located palace',
        classicalSource: 'Lockstep',
      },
      {
        id: 'LS-COLOC-ANY',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: { op: 'star_co_located', stars: [pairStars[1], pairStars[0]] },
        claimVi: 'Co-located any',
        classicalSource: 'Lockstep',
      },
      ...['hasPhucThan', 'phiSinhPhuc', 'phiKhacPhuc', 'phiLamKhongPha', 'theAmDong'].map((flag) => ({
        id: `LS-LY-${flag}`,
        silo: 'liuyao',
        stratum: 1,
        domain: 'quan',
        polarity: 'CAT',
        when: { op: 'liuyao_state_flag', flag },
        claimVi: `Liuyao ${flag}`,
        classicalSource: 'Lockstep',
      })),
      {
        id: 'LS-VCD-FLAG',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'TRUNG',
        when: { op: 'vo_chinh_dieu', palace: vcd.palaceName, value: vcd.voChinhDieu },
        claimVi: 'VCD flag',
        classicalSource: 'Lockstep',
      },
      {
        id: 'LS-TAM-KHONG-0',
        silo: 'nam-phai',
        stratum: 1,
        domain: 'menh',
        polarity: 'CAT',
        when: { op: 'tam_khong_in_tam_phuong', palace: 'Mệnh', minCount: 0 },
        claimVi: 'Tam Khong check',
        classicalSource: 'Lockstep',
      },
    ];

    const tsRep = solverPkg.evaluateRulesDAG(synthChart, astRules);
    if (tsRep.nodes.length !== astRules.length) {
      throw new Error(
        `Extended ConditionAST/LiuyaoStateFlag gate matched ${tsRep.nodes.length}/${astRules.length} rules at index ${i}`,
      );
    }
    astVectors.push({
      chart: synthChart,
      rules: astRules,
      tsSha256: sha256Canonical(tsRep),
    });
  }

  const pyAstScript = [
    'import json, sys',
    'from sovana.geo_time import sha256_canonical',
    'from sovana.solver import evaluate_rules_dag',
    'vecs = json.load(sys.stdin)',
    'print(json.dumps([sha256_canonical(evaluate_rules_dag(v["chart"], v["rules"])) for v in vecs]))',
  ].join('\n');
  const pyAstOut = execFileSync('uv', ['run', 'python', '-c', pyAstScript], {
    cwd: repoRoot,
    input: JSON.stringify(astVectors.map((v) => ({ chart: v.chart, rules: v.rules }))),
    encoding: 'utf-8',
  });
  const pyAstShas = JSON.parse(pyAstOut.trim());
  for (let i = 0; i < astVectors.length; i++) {
    if (astVectors[i].tsSha256 !== pyAstShas[i]) {
      throw new Error(
        `Extended ConditionAST/LiuyaoStateFlag lockstep mismatch at index ${i}: ${astVectors[i].tsSha256} !== ${pyAstShas[i]}`,
      );
    }
  }

  // Real-time divination TZ-free TS <-> Python lockstep gate
  const inquiryTimes = [
    Date.UTC(2026, 4, 15, 16, 30, 0),
    Date.UTC(2026, 0, 1, 0, 0, 0),
    Date.UTC(1999, 11, 31, 17, 5, 30),
  ];
  const tsInqShas = inquiryTimes.map((ms, idx) =>
    sha256Canonical(
      castDivinationAtInstant({
        nowMs: ms,
        location: idx % 2 === 0 ? 'Hà Nội' : 'Sài Gòn',
        lines: idx === 2 ? [6, 7, 8, 9, 7, 8] : undefined,
      }),
    ),
  );
  const pyInqScript = [
    'import json, sys',
    'from sovana.geo_time import sha256_canonical',
    'from sovana.kernel import cast_divination_at_instant',
    'times = json.load(sys.stdin)',
    'out = [sha256_canonical(cast_divination_at_instant(now_ms=ms, location=("Hà Nội" if idx % 2 == 0 else "Sài Gòn"), lines=([6, 7, 8, 9, 7, 8] if idx == 2 else None))) for idx, ms in enumerate(times)]',
    'print(json.dumps(out))',
  ].join('\n');
  const pyInqShas = JSON.parse(
    execFileSync('uv', ['run', 'python', '-c', pyInqScript], {
      cwd: repoRoot,
      input: JSON.stringify(inquiryTimes),
      encoding: 'utf-8',
    }).trim(),
  );
  for (let i = 0; i < inquiryTimes.length; i++) {
    if (tsInqShas[i] !== pyInqShas[i]) {
      throw new Error(`castDivinationAtInstant lockstep mismatch at ${i}: ${tsInqShas[i]} !== ${pyInqShas[i]}`);
    }
  }

  return {
    algebraicTrials: trials,
    algebraicElapsedMs: Math.round(algElapsedMs * 100) / 100,
    canCanhForksVerified: canCanhCount,
    canNhamForksVerified: canNhamCount,
    churchRosserPermutations: 100,
    churchRosserBaselineSha256: baselineReportHash,
    extendedSolverAstLockstepVectors: astVectors.length,
    kernelBenchIterations: benchIters,
    kernelMsPerOp: Math.round(kernelMsPerOp * 10000) / 10000,
    bundleSizes,
  };
}

function firstDiffOffset(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      return {
        offset: i,
        tsSnippet: a.slice(Math.max(0, i - 60), i + 120),
        pySnippet: b.slice(Math.max(0, i - 60), i + 120),
      };
    }
  }
  return { offset: len, tsSnippet: a.slice(-100), pySnippet: b.slice(-100) };
}

function main() {
  const vectors = buildFullStackVectors(1200);

  // Warmup
  evaluateSingleFullStackVector(vectors[0]);

  const tsHashes = [];
  const tsChartHashes = [];
  const tsDagHashes = [];
  const tsRectHashes = [];
  const tsAgg = createHash('sha256');

  const t0 = performance.now();
  for (const v of vectors) {
    const out = evaluateSingleFullStackVector(v);
    const chHash = sha256Canonical(out.chart);
    const dgHash = sha256Canonical(out.dagReport);
    const rcHash = sha256Canonical(out.rectification);
    const fullHash = sha256Canonical(out);

    tsChartHashes.push(chHash);
    tsDagHashes.push(dgHash);
    tsRectHashes.push(rcHash);
    tsHashes.push(fullHash);
    tsAgg.update(fullHash, 'ascii');
  }
  const tsElapsedMs = performance.now() - t0;
  const tsRoot = tsAgg.digest('hex');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovana-fullstack-lockstep-'));
  const inFile = path.join(tmpDir, 'vectors.json');
  const outFile = path.join(tmpDir, 'py_out.json');
  fs.writeFileSync(inFile, JSON.stringify({ vectors }), 'utf-8');

  execFileSync('uv', ['run', 'python', 'python/tools/verify_full_stack_lockstep.py', inFile, outFile], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  const pyOut = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
  fs.rmSync(tmpDir, { recursive: true, force: true });

  let mismatches = 0;
  let firstMismatch = null;
  for (let i = 0; i < vectors.length; i++) {
    if (tsHashes[i] !== pyOut.fullHashes[i]) {
      mismatches++;
      if (!firstMismatch) {
        const tsOut = evaluateSingleFullStackVector(vectors[i]);
        const tsCjson = canonicalJson(tsOut);
        firstMismatch = {
          index: i,
          vector: vectors[i],
          stageMismatches: {
            chart: tsChartHashes[i] !== pyOut.chartHashes[i],
            dagReport: tsDagHashes[i] !== pyOut.dagHashes[i],
            rectification: tsRectHashes[i] !== pyOut.rectHashes[i],
          },
          tsFullSha256: tsHashes[i],
          pyFullSha256: pyOut.fullHashes[i],
          diff: pyOut.firstSampleCanonicalJson
            ? firstDiffOffset(tsCjson, pyOut.firstSampleCanonicalJson)
            : null,
        };
      }
    }
  }

  if (mismatches > 0 || tsRoot !== pyOut.aggregateSha256) {
    console.error('FULL-STACK LOCKSTEP MISMATCH:', JSON.stringify({ mismatches, firstMismatch }, null, 2));
    process.exit(1);
  }

  const gates = run10kAlgebraicAndConfluenceGates();
  if (gates.kernelMsPerOp >= 0.5) {
    console.error('KERNEL LATENCY GATE FAILED (>= 0.5 ms/op):', gates.kernelMsPerOp);
    process.exit(1);
  }
  if (
    gates.bundleSizes.geoTime.gzippedBytes >= 25_600 ||
    gates.bundleSizes.kernel.gzippedBytes >= 25_600 ||
    gates.bundleSizes.solver.gzippedBytes >= 25_600
  ) {
    console.error('CORE PACKAGE GZIPPED SIZE GATE FAILED (>= 25 KB):', gates.bundleSizes);
    process.exit(1);
  }

  const summary = {
    schemaVersion: '1.0.0',
    fullStackLockstep: {
      totalVectors: vectors.length,
      mismatches,
      aggregateSha256: tsRoot,
      tsElapsedMs: Math.round(tsElapsedMs * 100) / 100,
      tsMsPerVector: Math.round((tsElapsedMs / vectors.length) * 10000) / 10000,
      pyElapsedMs: pyOut.elapsedMs,
      pyMsPerVector: pyOut.msPerVector,
      pyChurchRosserVerified: pyOut.pyChurchRosserVerified,
    },
    gates,
  };

  console.log('FULL-STACK LOCKSTEP & 10K ALGEBRAIC GATES 100% GREEN:', JSON.stringify(summary, null, 2));
}

main();
