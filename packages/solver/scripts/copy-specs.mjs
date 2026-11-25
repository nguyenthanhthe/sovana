import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgRoot, '../..');
const dataDir = path.join(pkgRoot, 'data');

fs.mkdirSync(dataDir, { recursive: true });

const filesToCopy = [
  ['specs/sample_rules/public_rules_50.json', 'public_rules_50.json'],
  ['specs/sample_rules/terminology_vi.json', 'terminology_vi.json'],
];

for (const [srcRel, dstName] of filesToCopy) {
  const src = path.join(repoRoot, srcRel);
  const dst = path.join(dataDir, dstName);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
  }
}
