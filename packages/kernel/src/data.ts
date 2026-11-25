import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeBaziAxiom,
  normalizeLiuyaoAxiom,
  normalizeZiweiAxiom,
} from './normalize.js';
import { registerKernelLoaders } from './store.js';
import type { BaziAxiomSpec, LiuyaoAxiomSpec, ZiweiAxiomSpec, ZiweiSilo } from './types.js';

export interface KernelBrowserInit {
  namPhai?: Record<string, unknown> | ZiweiAxiomSpec | undefined;
  toanThu?: Record<string, unknown> | ZiweiAxiomSpec | undefined;
  bazi?: Record<string, unknown> | BaziAxiomSpec | undefined;
  liuyao?: Record<string, unknown> | LiuyaoAxiomSpec | undefined;
}

export interface KernelAssetUrls {
  namPhaiUrl?: string | undefined;
  toanThuUrl?: string | undefined;
  baziUrl?: string | undefined;
  liuyaoUrl?: string | undefined;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgRoot, '../..');

const cachedZiwei: Partial<Record<ZiweiSilo, ZiweiAxiomSpec>> = {};
let cachedBazi: BaziAxiomSpec | null = null;
let cachedLiuyao: LiuyaoAxiomSpec | null = null;

function resolveAxiomFile(fileName: string): string {
  const pkgPath = path.join(pkgRoot, 'data', fileName);
  if (fs.existsSync(pkgPath)) {
    return pkgPath;
  }
  const specPath = path.join(repoRoot, 'specs', 'axioms', fileName);
  if (fs.existsSync(specPath)) {
    return specPath;
  }
  throw new Error(`SOVANA axiom file not found at '${pkgPath}' or '${specPath}'`);
}

function asZiweiSpec(
  val: Record<string, unknown> | ZiweiAxiomSpec,
  silo: ZiweiSilo,
): ZiweiAxiomSpec {
  if ('trangSinhStages' in val && Array.isArray(val.trangSinhStages)) {
    return val as ZiweiAxiomSpec;
  }
  return normalizeZiweiAxiom(val as Record<string, unknown>, silo);
}

function asBaziSpec(val: Record<string, unknown> | BaziAxiomSpec): BaziAxiomSpec {
  const obj = val as Record<string, unknown>;
  const seasonal = obj['seasonalMultiplierBps'];
  if (
    !Array.isArray(obj['hiddenStemsByBranch']) &&
    seasonal &&
    typeof seasonal === 'object' &&
    !Array.isArray(seasonal) &&
    'Mộc' in seasonal &&
    !Array.isArray(obj['cungThongBaoGiamDieuHau'])
  ) {
    return val as BaziAxiomSpec;
  }
  return normalizeBaziAxiom(obj);
}

function asLiuyaoSpec(val: Record<string, unknown> | LiuyaoAxiomSpec): LiuyaoAxiomSpec {
  if ('hexagramsByBits' in val && Array.isArray(val.hexagramsByBits)) {
    return val as LiuyaoAxiomSpec;
  }
  return normalizeLiuyaoAxiom(val as Record<string, unknown>);
}

export function initKernelBrowser(init: KernelBrowserInit): void {
  if (init.namPhai) cachedZiwei['nam-phai'] = asZiweiSpec(init.namPhai, 'nam-phai');
  if (init.toanThu) cachedZiwei['toan-thu'] = asZiweiSpec(init.toanThu, 'toan-thu');
  if (init.bazi) cachedBazi = asBaziSpec(init.bazi);
  if (init.liuyao) cachedLiuyao = asLiuyaoSpec(init.liuyao);
}

export async function preloadKernelData(_urls?: KernelAssetUrls): Promise<void> {
  loadZiweiAxiom('nam-phai');
  loadZiweiAxiom('toan-thu');
  loadBaziAxiom();
  loadLiuyaoAxiom();
}

export function loadZiweiAxiom(silo: ZiweiSilo): ZiweiAxiomSpec {
  const existing = cachedZiwei[silo];
  if (existing) return existing;
  const fileName = silo === 'nam-phai' ? 'nam-phai.json' : 'toan-thu.json';
  const raw = JSON.parse(fs.readFileSync(resolveAxiomFile(fileName), 'utf-8')) as Record<
    string,
    unknown
  >;
  const parsed = normalizeZiweiAxiom(raw, silo);
  cachedZiwei[silo] = parsed;
  return parsed;
}

export function loadBaziAxiom(): BaziAxiomSpec {
  if (!cachedBazi) {
    const raw = JSON.parse(fs.readFileSync(resolveAxiomFile('bazi.json'), 'utf-8')) as Record<
      string,
      unknown
    >;
    cachedBazi = normalizeBaziAxiom(raw);
  }
  return cachedBazi;
}

export function loadLiuyaoAxiom(): LiuyaoAxiomSpec {
  if (!cachedLiuyao) {
    const raw = JSON.parse(fs.readFileSync(resolveAxiomFile('liuyao.json'), 'utf-8')) as Record<
      string,
      unknown
    >;
    cachedLiuyao = normalizeLiuyaoAxiom(raw);
  }
  return cachedLiuyao;
}

registerKernelLoaders({
  loadZiweiAxiom,
  loadBaziAxiom,
  loadLiuyaoAxiom,
});
