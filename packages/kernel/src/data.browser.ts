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

const cachedZiwei: Partial<Record<ZiweiSilo, ZiweiAxiomSpec>> = {};
let cachedBazi: BaziAxiomSpec | null = null;
let cachedLiuyao: LiuyaoAxiomSpec | null = null;
let inflightPreload: Promise<void> | null = null;

async function fetchJson(url: string, label: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch @sovana/kernel ${label} (${res.status} ${res.statusText}) from ${url}`,
    );
  }
  return (await res.json()) as Record<string, unknown>;
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

export async function preloadKernelData(urls?: KernelAssetUrls): Promise<void> {
  if (!urls && cachedZiwei['nam-phai'] && cachedZiwei['toan-thu'] && cachedBazi && cachedLiuyao) {
    return;
  }
  if (!urls && inflightPreload) {
    return inflightPreload;
  }

  const run = async (): Promise<void> => {
    const namPhaiUrl = urls?.namPhaiUrl ?? new URL('../data/nam-phai.json', import.meta.url).href;
    const toanThuUrl = urls?.toanThuUrl ?? new URL('../data/toan-thu.json', import.meta.url).href;
    const baziUrl = urls?.baziUrl ?? new URL('../data/bazi.json', import.meta.url).href;
    const liuyaoUrl = urls?.liuyaoUrl ?? new URL('../data/liuyao.json', import.meta.url).href;

    const [npRaw, ttRaw, bzRaw, lyRaw] = await Promise.all([
      cachedZiwei['nam-phai'] && !urls?.namPhaiUrl
        ? Promise.resolve(null)
        : fetchJson(namPhaiUrl, 'nam-phai'),
      cachedZiwei['toan-thu'] && !urls?.toanThuUrl
        ? Promise.resolve(null)
        : fetchJson(toanThuUrl, 'toan-thu'),
      cachedBazi && !urls?.baziUrl ? Promise.resolve(null) : fetchJson(baziUrl, 'bazi'),
      cachedLiuyao && !urls?.liuyaoUrl ? Promise.resolve(null) : fetchJson(liuyaoUrl, 'liuyao'),
    ]);

    if (npRaw) cachedZiwei['nam-phai'] = normalizeZiweiAxiom(npRaw, 'nam-phai');
    if (ttRaw) cachedZiwei['toan-thu'] = normalizeZiweiAxiom(ttRaw, 'toan-thu');
    if (bzRaw) cachedBazi = normalizeBaziAxiom(bzRaw);
    if (lyRaw) cachedLiuyao = normalizeLiuyaoAxiom(lyRaw);
  };

  if (!urls) {
    inflightPreload = run().catch((err) => {
      inflightPreload = null;
      throw err;
    });
    return inflightPreload;
  }
  return run();
}

export function loadZiweiAxiom(silo: ZiweiSilo): ZiweiAxiomSpec {
  const existing = cachedZiwei[silo];
  if (!existing) {
    throw new Error(
      `@sovana/kernel browser data not loaded for '${silo}'. Call await preloadKernelData() or initKernelBrowser(...) first.`,
    );
  }
  return existing;
}

export function loadBaziAxiom(): BaziAxiomSpec {
  if (!cachedBazi) {
    throw new Error(
      '@sovana/kernel browser data not loaded. Call await preloadKernelData() or initKernelBrowser(...) first.',
    );
  }
  return cachedBazi;
}

export function loadLiuyaoAxiom(): LiuyaoAxiomSpec {
  if (!cachedLiuyao) {
    throw new Error(
      '@sovana/kernel browser data not loaded. Call await preloadKernelData() or initKernelBrowser(...) first.',
    );
  }
  return cachedLiuyao;
}

registerKernelLoaders({
  loadZiweiAxiom,
  loadBaziAxiom,
  loadLiuyaoAxiom,
});
