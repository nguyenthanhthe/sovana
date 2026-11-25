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
  computeSexagenaryPillars,
  epochDayFromCivil,
  equationOfTimeCentiseconds,
  findSolarTermAt,
  loadEphemeris,
  loadGeoDataset,
  normalizeBirthTemporal,
  sha256Canonical,
  solarToLunar,
} from '../../packages/geo-time/dist/index.js';

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

function generateAdversarialVectors() {
  const eph = loadEphemeris();
  const geo = loadGeoDataset();
  const rng = makeRng(0x507a4a01);

  const calendarModes = ['VN_UTC7', 'CN_UTC8', 'VN_HISTORICAL'];
  const leapPolicies = ['keep', 'split-15', 'next-month', 'prev-month'];
  const lateZiPolicies = ['next-day', 'current-day'];
  const vectors = [];

  const startDay = epochDayFromCivil(1900, 1, 1);
  const endDay = epochDayFromCivil(2100, 12, 31);
  const spanDays = endDay - startDay + 1;

  const pushAtDay = (epochDay, hour, minute, second, location, opts = {}) => {
    const c = civilFromEpochDay(epochDay);
    vectors.push({
      year: c.year,
      month: c.month,
      day: c.day,
      hour,
      minute,
      second,
      location,
      ...opts,
    });
  };

  // 1. All 63 legacy provinces
  for (const p63 of geo.provincesLegacy63) {
    const d = startDay + (rng() % spanDays);
    pushAtDay(d, rng() % 24, rng() % 60, rng() % 60, p63.code, {
      calendarMode: calendarModes[rng() % 3],
      leapMonthPolicy: leapPolicies[rng() % 4],
      lateZiPolicy: lateZiPolicies[rng() % 2],
    });
  }

  // 2. All 34 post-2025 provinces
  for (const p34 of geo.provincesPost2025) {
    const d = startDay + (rng() % spanDays);
    pushAtDay(d, rng() % 24, rng() % 60, rng() % 60, p34.id, {
      calendarMode: 'VN_HISTORICAL',
      migrationDestination: geo.provincesPost2025[rng() % 34].id,
    });
  }

  // 3. All 696 legacy districts
  for (const dist of geo.districtsLegacy) {
    const d = startDay + (rng() % spanDays);
    pushAtDay(d, rng() % 24, rng() % 60, 0, dist.code, {
      calendarMode: calendarModes[rng() % 3],
      migrationDestination: rng() % 3 === 0 ? geo.provincesLegacy63[rng() % 63].code : undefined,
    });
  }

  // 4. All 26 historical aliases & all 24 islands/extremes
  for (const alias of geo.historicalAliases) {
    const d = epochDayFromCivil(1965, 1, 1) + (rng() % 3650);
    pushAtDay(d, rng() % 24, rng() % 60, 0, alias.name, { calendarMode: 'VN_HISTORICAL' });
  }
  for (const sz of geo.specialZones) {
    const d = startDay + (rng() % spanDays);
    pushAtDay(d, rng() % 24, rng() % 60, 0, sz.id, {
      calendarMode: 'VN_UTC7',
      migrationDestination: 'Hà Nội',
    });
  }

  // 5. Historical Vietnam TZ regimes & 17th parallel & international IANA stress tests
  const historicalProbes = [
    [1904, 3, 15, 0, 30, 'Sài Gòn'],
    [1909, 8, 20, 14, 15, 'Hà Nội'],
    [1942, 12, 31, 22, 55, 'Hà Nội'],
    [1945, 5, 19, 6, 0, 'Nghệ An'],
    [1950, 10, 10, 12, 0, 'Hà Nội'],
    [1968, 1, 29, 0, 5, 'Hà Nội'],
    [1968, 1, 29, 0, 5, 'Sài Gòn'],
    [1968, 5, 15, 1, 15, 'Sài Gòn'],
    [1968, 5, 15, 1, 15, 'Hà Nội'],
    [1970, 7, 1, 23, 10, 'Vĩnh Linh, Quảng Trị'],
    [1970, 7, 1, 23, 10, 'Đông Hà, Quảng Trị'],
    [1975, 6, 12, 23, 30, 'TP. Hồ Chí Minh'],
    [1975, 6, 13, 0, 30, 'TP. Hồ Chí Minh'],
    [1985, 3, 25, 15, 0, 'Huế'],
    [2007, 2, 17, 23, 45, 'Đà Nẵng'],
    [2030, 2, 2, 23, 45, 'Cần Thơ'],
  ];
  for (const [y, m, d, h, min, loc] of historicalProbes) {
    for (const cm of calendarModes) {
      for (const lz of lateZiPolicies) {
        vectors.push({
          year: y, month: m, day: d, hour: h, minute: min, second: 0,
          location: loc, calendarMode: cm, lateZiPolicy: lz,
        });
      }
    }
  }

  // International non-VN locations (coord + IANA)
  const intlLocations = [
    [{ lat: 35.6762, lon: 139.6503 }, 'Asia/Tokyo'],
    [{ lat: 34.0522, lon: -118.2437 }, 'America/Los_Angeles'],
    [{ lat: 48.8566, lon: 2.3522 }, 'Europe/Paris'],
    [{ lat: 51.5074, lon: -0.1278 }, 'Europe/London'],
    [{ lat: -33.8688, lon: 151.2093 }, 'Australia/Sydney'],
  ];
  for (const [coords, tz] of intlLocations) {
    for (let k = 0; k < 20; k++) {
      const ed = epochDayFromCivil(1970, 1, 1) + (rng() % 20000);
      pushAtDay(ed, rng() % 24, rng() % 60, rng() % 60, coords, { ianaTimeZone: tz });
    }
  }

  // 6. Solar term & New Moon boundary vectors (+/- 5s, +/- 59s, +/- 599s, +/- 601s)
  const deltasSec = [-601, -599, -59, -5, 0, 5, 59, 599, 601];
  for (let i = 30; i < eph.solarTerms.length - 30 && vectors.length < 3500; i += 25) {
    const baseMs = eph.solarTerms[i] + 25_200_000; // UTC+7 wall ms
    for (const ds of deltasSec) {
      const wallMs = baseMs + ds * 1000;
      const ed = Math.floor(wallMs / MS_PER_DAY);
      const secOfDay = Math.floor((wallMs - ed * MS_PER_DAY) / 1000);
      const h = Math.floor(secOfDay / 3600);
      const m = Math.floor((secOfDay % 3600) / 60);
      const s = secOfDay % 60;
      const loc = geo.provincesLegacy63[rng() % 63].code;
      pushAtDay(ed, h, m, s, loc, { calendarMode: 'VN_UTC7' });
    }
  }

  // 7. Shichen odd-hour boundary stress tests (22:55..01:05, etc.)
  const shichenHours = [
    [0, 0, 0], [0, 59, 59], [1, 0, 0], [1, 5, 0],
    [22, 55, 0], [23, 0, 0], [23, 15, 0], [23, 59, 59],
  ];
  while (vectors.length < 5500) {
    const ed = startDay + (rng() % spanDays);
    const [h, m, s] = shichenHours[rng() % shichenHours.length];
    const dist = geo.districtsLegacy[rng() % geo.districtsLegacy.length];
    pushAtDay(ed, h, m, s, dist.code, {
      calendarMode: calendarModes[rng() % 3],
      leapMonthPolicy: leapPolicies[rng() % 4],
      lateZiPolicy: lateZiPolicies[rng() % 2],
    });
  }

  // 8. Fill remaining up to exactly 10,000 vectors across random 1900-2100 dates/locations/migrations
  while (vectors.length < 10_000) {
    const ed = startDay + (rng() % spanDays);
    const locObj = rng() % 5 === 0
      ? geo.provincesPost2025[rng() % 34].id
      : geo.districtsLegacy[rng() % geo.districtsLegacy.length].code;
    const mig = rng() % 2 === 0 ? geo.provincesLegacy63[rng() % 63].code : undefined;
    pushAtDay(ed, rng() % 24, rng() % 60, rng() % 60, locObj, {
      calendarMode: calendarModes[rng() % 3],
      leapMonthPolicy: leapPolicies[rng() % 4],
      lateZiPolicy: lateZiPolicies[rng() % 2],
      migrationDestination: mig,
    });
  }

  return vectors;
}

function measureCoreBundleGzipped() {
  const distDir = path.join(repoRoot, 'packages', 'geo-time', 'dist');
  const jsFiles = fs.readdirSync(distDir).filter((f) => f.endsWith('.js')).sort();
  let rawBytes = 0;
  let combined = '';
  for (const f of jsFiles) {
    const txt = fs.readFileSync(path.join(distDir, f), 'utf-8');
    rawBytes += Buffer.byteLength(txt, 'utf-8');
    combined += txt + '\n';
  }
  const gzippedBytes = zlib.gzipSync(Buffer.from(combined, 'utf-8'), { level: 9 }).byteLength;
  return { jsFilesCount: jsFiles.length, rawBytes, gzippedBytes };
}

function main() {
  const eph = loadEphemeris();
  const startDay = epochDayFromCivil(1900, 1, 1);
  const endDay = epochDayFromCivil(2100, 12, 31);
  const window73050End = startDay + 73050 - 1; // 2100-01-01

  // 1. TS Daily Sweep (73,414 days)
  const tsDayHashes = [];
  const tsDayAgg = createHash('sha256');
  const t0Day = performance.now();
  for (let d = startDay; d <= endDay; d++) {
    const noonMs = d * MS_PER_DAY + 43_200_000;
    const vnL = solarToLunar(eph, d, 'VN_UTC7', 'split-15');
    const cnL = solarToLunar(eph, d, 'CN_UTC8', 'split-15');
    const term = findSolarTermAt(eph, noonMs);
    const eotCs = equationOfTimeCentiseconds(noonMs);
    const pillars = computeSexagenaryPillars(eph, noonMs, vnL.lunarYear, d, 6, false, 'next-day');
    const rec = {
      d,
      vn: vnL,
      cn: cnL,
      st: term.termIndex,
      eot: eotCs,
      p: pillars,
    };
    const h = createHash('sha256').update(canonicalJson(rec), 'utf8').digest('hex');
    tsDayHashes.push(h);
    tsDayAgg.update(h, 'ascii');
  }
  const tsDayMs = performance.now() - t0Day;
  const tsDayRoot = tsDayAgg.digest('hex');

  // 2. TS 10,000-Vector Sweep
  const vectors = generateAdversarialVectors();
  normalizeBirthTemporal({ year: 2000, month: 1, day: 1, hour: 12, minute: 0, location: 'Hà Nội' });

  const tsVecHashes = [];
  const tsVecAgg = createHash('sha256');
  const t0Vec = performance.now();
  for (const v of vectors) {
    const res = normalizeBirthTemporal(v);
    const h = sha256Canonical(res);
    tsVecHashes.push(h);
    tsVecAgg.update(h, 'ascii');
  }
  const tsVecMs = performance.now() - t0Vec;
  const tsVecRoot = tsVecAgg.digest('hex');

  // 3. Run Python Lockstep Runner
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovana-lockstep-'));
  const inFile = path.join(tmpDir, 'vectors.json');
  const outFile = path.join(tmpDir, 'py_out.json');
  fs.writeFileSync(inFile, JSON.stringify({ vectors }), 'utf-8');

  const uvExe = 'uv';
  execFileSync(uvExe, ['run', 'python', 'python/tools/verify_lockstep.py', inFile, outFile], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  const pyOut = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // 4. Bit-Exact SHA-256 Comparison
  let dayMismatches = 0;
  let firstDayMismatch = null;
  for (let i = 0; i < tsDayHashes.length; i++) {
    if (tsDayHashes[i] !== pyOut.dayHashes[i]) {
      dayMismatches++;
      if (!firstDayMismatch) {
        const c = civilFromEpochDay(startDay + i);
        firstDayMismatch = { index: i, date: c, ts: tsDayHashes[i], py: pyOut.dayHashes[i] };
      }
    }
  }

  let vecMismatches = 0;
  let firstVecMismatch = null;
  for (let i = 0; i < tsVecHashes.length; i++) {
    if (tsVecHashes[i] !== pyOut.vectorHashes[i]) {
      vecMismatches++;
      if (!firstVecMismatch) {
        firstVecMismatch = { index: i, input: vectors[i], ts: tsVecHashes[i], py: pyOut.vectorHashes[i] };
      }
    }
  }

  const bundleStats = measureCoreBundleGzipped();
  const tsVecMsPerOp = Math.round((tsVecMs / vectors.length) * 10000) / 10000;

  if (dayMismatches > 0 || tsDayRoot !== pyOut.dayAggregateSha256) {
    console.error('DAILY SWEEP LOCKSTEP FAILURE:', { dayMismatches, firstDayMismatch });
    process.exit(1);
  }
  if (vecMismatches > 0 || tsVecRoot !== pyOut.vectorAggregateSha256) {
    console.error('10K VECTOR LOCKSTEP FAILURE:', { vecMismatches, firstVecMismatch });
    process.exit(1);
  }
  if (bundleStats.gzippedBytes >= 25_600) {
    console.error('BUNDLE SIZE GATE FAILURE (>= 25 KB gzipped):', bundleStats);
    process.exit(1);
  }
  // ponytail: keep strict < 0.5 ms/op gate on V8 core; allow 1.5 ms/op for Python 3.12 Pydantic + JCS SHA-256 on shared CI VMs
  if (tsVecMsPerOp >= 0.5 || pyOut.vectorMsPerOp >= 1.5) {
    console.error('LATENCY GATE FAILURE:', { tsVecMsPerOp, pyMsPerOp: pyOut.vectorMsPerOp });
    process.exit(1);
  }

  const manifest = {
    schemaVersion: '1.0.0',
    dailySweep: {
      startDate: '1900-01-01',
      endDate: '2100-12-31',
      totalDays: tsDayHashes.length,
      window73050InclusiveEndDate: '2100-01-01',
      window73050Days: window73050End - startDay + 1,
      mismatches: dayMismatches,
      aggregateSha256: tsDayRoot,
      tsElapsedMs: Math.round(tsDayMs * 100) / 100,
      pyElapsedMs: pyOut.dayElapsedMs,
    },
    adversarialVectors: {
      totalVectors: vectors.length,
      mismatches: vecMismatches,
      aggregateSha256: tsVecRoot,
      tsElapsedMs: Math.round(tsVecMs * 100) / 100,
      tsMsPerOp: tsVecMsPerOp,
      pyElapsedMs: pyOut.vectorElapsedMs,
      pyMsPerOp: pyOut.vectorMsPerOp,
      sampleVectors: [0, 1, 100, 843, 1500, 5000, 9999].map((idx) => ({
        index: idx,
        input: vectors[idx],
        sha256: tsVecHashes[idx],
      })),
    },
    bundleStats,
  };

  const manifestPath = path.join(repoRoot, 'tests', 'golden', 'manifest_sha256.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log('LOCKSTEP VERIFIED 100% BIT-EXACT:', JSON.stringify(manifest, null, 2));
}

main();
