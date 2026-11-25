import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgRoot, '../..');
const dataDir = path.join(pkgRoot, 'data');

fs.mkdirSync(dataDir, { recursive: true });

const filesToCopy = [
  ['specs/axioms/nam-phai.json', 'nam-phai.json'],
  ['specs/axioms/toan-thu.json', 'toan-thu.json'],
  ['specs/axioms/bazi.json', 'bazi.json'],
  ['specs/axioms/liuyao.json', 'liuyao.json'],
];

for (const [srcRel, dstName] of filesToCopy) {
  const src = path.join(repoRoot, srcRel);
  const dst = path.join(dataDir, dstName);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
  }
}
