import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgRoot, '../..');
const dataDir = path.join(pkgRoot, 'data');

fs.mkdirSync(dataDir, { recursive: true });

const filesToCopy = [
  ['specs/ephemeris/ephemeris_1900_2100.bin', 'ephemeris_1900_2100.bin'],
  ['specs/geo/vn_bi_temporal_geo.json', 'vn_bi_temporal_geo.json'],
  ['specs/geo/vn_tz_regimes.json', 'vn_tz_regimes.json'],
];

for (const [srcRel, dstName] of filesToCopy) {
  const src = path.join(repoRoot, srcRel);
  const dst = path.join(dataDir, dstName);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
  }
}
