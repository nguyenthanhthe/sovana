import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderStratifiedDagSvg } from '../src/dagSvg.js';
import { SMOKING_GUN_PRESETS, normalizeLocationInput } from '../src/presets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('X-Ray Inspector Presets & Stratified SVG DAG Renderer', () => {
  it('defines all 3 historical Smoking Gun presets and normalizes shorthand locations', () => {
    expect(SMOKING_GUN_PRESETS).toHaveLength(3);
    expect(SMOKING_GUN_PRESETS.map((p) => p.id)).toEqual([
      'tet-mau-than-1968',
      'saigon-1968-utc8',
      'can-canh-1980-fork',
    ]);
    expect(normalizeLocationInput('TP.HCM')).toBe('TP. Hồ Chí Minh');
    expect(normalizeLocationInput('Hà Nội')).toBe('Hà Nội');
  });

  it('renders Stratified SVG Proof-DAG with conflict edges and node attributes', () => {
    const svg = renderStratifiedDagSvg({
      chartAnchorFacts: [{ id: 'IR-STEM', label: 'Năm Canh Thân', sub: 'Can #6' }],
      nodes: [
        {
          nodeId: 'NP-001',
          silo: 'nam-phai',
          stratum: 1,
          domain: 'menh',
          polarity: 'CAT',
          claimVi: 'Thiên Đồng Hóa Khoa',
          classicalSource: 'Tân Biên',
        },
        {
          nodeId: 'TT-001',
          silo: 'toan-thu',
          stratum: 1,
          domain: 'menh',
          polarity: 'HUNG',
          claimVi: 'Thiên Đồng Hóa Kỵ',
          classicalSource: 'Toàn Thư',
        },
      ],
      conflicts: [
        {
          conflictId: 'CF-001',
          domain: 'menh',
          kind: 'CROSS_SILO',
          positiveNodeIds: ['NP-001'],
          negativeNodeIds: ['TT-001'],
          resolutionHintVi: 'Kiểm chứng biến cố thực tế',
        },
      ],
      selectedNodeId: 'CF-001',
    });

    expect(svg).toContain('<svg');
    expect(svg).toContain('data-node-id="NP-001"');
    expect(svg).toContain('data-node-id="CF-001"');
    expect(svg).toContain('stroke="#D4AF37"');
    expect(svg).toContain('stroke="#EF4444"');
  });

  it('mounts the compiled production ESM bundle cleanly and renders all 4 telemetry panels', async () => {
    const bundlePath = path.resolve(__dirname, '../dist/assets/app.js');
    const htmlPath = path.resolve(__dirname, '../dist/index.html');
    expect(fs.existsSync(bundlePath)).toBe(true);
    expect(fs.existsSync(htmlPath)).toBe(true);

    const mod = (await import(`file:///${bundlePath.replace(/\\/g, '/')}`)) as {
      mountXrayApp: (root: unknown) => void;
    };
    const fakeRoot = {
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    mod.mountXrayApp(fakeRoot);

    expect(fakeRoot.innerHTML).toContain('PANEL A');
    expect(fakeRoot.innerHTML).toContain('PANEL B');
    expect(fakeRoot.innerHTML).toContain('PANEL C');
    expect(fakeRoot.innerHTML).toContain('PANEL D');
    expect(fakeRoot.innerHTML).toContain('?xray=1 TELEMETRY ACTIVE');
    expect(fakeRoot.innerHTML).toContain('1968 Tết Mậu Thân');
    expect(fakeRoot.innerHTML).toContain('Sài Gòn 01:15 Sáng');
    expect(fakeRoot.innerHTML).toContain('Can Canh Fork');
    expect(fakeRoot.innerHTML).toContain('SHANNON ENTROPY');
  });
});
