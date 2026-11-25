import { registerSolverLoaders } from './store.js';
import type { RuleIR } from './types.js';

export interface SolverBrowserInit {
  sampleRules?: readonly RuleIR[] | { rules: readonly RuleIR[] } | undefined;
  terminologyVi?: Record<string, unknown> | undefined;
}

export interface SolverAssetUrls {
  sampleRulesUrl?: string | undefined;
  terminologyViUrl?: string | undefined;
}

let cachedRules: RuleIR[] | null = null;
let cachedTerminology: Record<string, unknown> | null = null;
let inflightPreload: Promise<void> | null = null;

function extractRulesArray(raw: unknown): RuleIR[] {
  if (Array.isArray(raw)) {
    return raw as RuleIR[];
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as { rules?: unknown }).rules)) {
    return (raw as { rules: RuleIR[] }).rules;
  }
  throw new Error('Invalid sample rules JSON format: expected RuleIR[] or { rules: RuleIR[] }');
}

async function fetchJson(url: string, label: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch @sovana/solver ${label} (${res.status} ${res.statusText}) from ${url}`,
    );
  }
  return (await res.json()) as unknown;
}

export function initSolverBrowser(init: SolverBrowserInit): void {
  if (init.sampleRules !== undefined) {
    cachedRules = extractRulesArray(init.sampleRules);
  }
  if (init.terminologyVi !== undefined) {
    cachedTerminology = { ...init.terminologyVi };
  }
}

export async function preloadSolverData(urls?: SolverAssetUrls): Promise<void> {
  if (!urls && cachedRules && cachedTerminology) {
    return;
  }
  if (!urls && inflightPreload) {
    return inflightPreload;
  }

  const run = async (): Promise<void> => {
    const rulesUrl =
      urls?.sampleRulesUrl ?? new URL('../data/public_rules_50.json', import.meta.url).href;
    const termUrl =
      urls?.terminologyViUrl ?? new URL('../data/terminology_vi.json', import.meta.url).href;

    const [rulesRaw, termRaw] = await Promise.all([
      cachedRules && !urls?.sampleRulesUrl
        ? Promise.resolve(null)
        : fetchJson(rulesUrl, 'sampleRules'),
      cachedTerminology && !urls?.terminologyViUrl
        ? Promise.resolve(null)
        : fetchJson(termUrl, 'terminologyVi'),
    ]);

    if (rulesRaw !== null) {
      cachedRules = extractRulesArray(rulesRaw);
    }
    if (termRaw !== null) {
      cachedTerminology =
        termRaw && typeof termRaw === 'object' ? (termRaw as Record<string, unknown>) : {};
    }
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

export function loadSampleRules(): RuleIR[] {
  if (!cachedRules) {
    throw new Error(
      '@sovana/solver browser data not loaded. Call await preloadSolverData() or initSolverBrowser(...) first.',
    );
  }
  return cachedRules;
}

export function loadTerminologyVi(): Record<string, unknown> {
  if (!cachedTerminology) {
    throw new Error(
      '@sovana/solver browser data not loaded. Call await preloadSolverData() or initSolverBrowser(...) first.',
    );
  }
  return cachedTerminology;
}

registerSolverLoaders({
  loadSampleRules,
  loadTerminologyVi,
});
