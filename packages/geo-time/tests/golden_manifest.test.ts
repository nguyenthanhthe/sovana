import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { normalizeBirthTemporal, sha256Canonical } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

describe('Ring 1 golden manifest & bundle size gates', () => {
  it('matches golden SHA-256 sample vectors from manifest_sha256.json', () => {
    const manifestPath = path.join(repoRoot, 'tests', 'golden', 'manifest_sha256.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    expect(manifest.dailySweep.totalDays).toBe(73_414);
    expect(manifest.dailySweep.window73050Days).toBe(73_050);
    expect(manifest.dailySweep.mismatches).toBe(0);
    expect(manifest.adversarialVectors.totalVectors).toBe(10_000);
    expect(manifest.adversarialVectors.mismatches).toBe(0);

    for (const sample of manifest.adversarialVectors.sampleVectors) {
      const digest = sha256Canonical(normalizeBirthTemporal(sample.input));
      expect(digest).toBe(sample.sha256);
    }
  });

  it('keeps @sovana/geo-time core JS under 25 KB gzipped', () => {
    const distDir = path.join(repoRoot, 'packages', 'geo-time', 'dist');
    const jsFiles = fs.readdirSync(distDir).filter((f) => f.endsWith('.js')).sort();
    let combined = '';
    for (const f of jsFiles) {
      combined += fs.readFileSync(path.join(distDir, f), 'utf-8') + '\n';
    }
    const gzippedBytes = zlib.gzipSync(Buffer.from(combined, 'utf-8'), { level: 9 }).byteLength;
    expect(gzippedBytes).toBeLessThan(25_600);
  });
});
