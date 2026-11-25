import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgRoot, '../..');

let cachedRules: RuleIR[] | null = null;
let cachedTerminology: Record<string, unknown> | null = null;

function resolveSpecFile(pkgFileName: string, repoSubPath: string): string {
  const pkgPath = path.join(pkgRoot, 'data', pkgFileName);
  if (fs.existsSync(pkgPath)) {
    return pkgPath;
  }
  const specPath = path.join(repoRoot, 'specs', 'sample_rules', repoSubPath);
  if (fs.existsSync(specPath)) {
    return specPath;
  }
  throw new Error(`SOVANA solver spec file not found at '${pkgPath}' or '${specPath}'`);
}

function extractRulesArray(raw: unknown): RuleIR[] {
  if (Array.isArray(raw)) {
    return raw as RuleIR[];
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as { rules?: unknown }).rules)) {
    return (raw as { rules: RuleIR[] }).rules;
  }
  throw new Error('Invalid sample rules JSON format: expected RuleIR[] or { rules: RuleIR[] }');
}

export function initSolverBrowser(init: SolverBrowserInit): void {
  if (init.sampleRules !== undefined) {
    cachedRules = extractRulesArray(init.sampleRules);
  }
  if (init.terminologyVi !== undefined) {
    cachedTerminology = { ...init.terminologyVi };
  }
}

export async function preloadSolverData(_urls?: SolverAssetUrls): Promise<void> {
  loadSampleRules();
  loadTerminologyVi();
}

export function loadSampleRules(): RuleIR[] {
  if (!cachedRules) {
    const raw = JSON.parse(
      fs.readFileSync(resolveSpecFile('public_rules_50.json', 'public_rules_50.json'), 'utf-8'),
    ) as unknown;
    cachedRules = extractRulesArray(raw);
  }
  return cachedRules;
}

export function loadTerminologyVi(): Record<string, unknown> {
  if (!cachedTerminology) {
    const raw = JSON.parse(
      fs.readFileSync(resolveSpecFile('terminology_vi.json', 'terminology_vi.json'), 'utf-8'),
    ) as unknown;
    cachedTerminology =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  }
  return cachedTerminology;
}

registerSolverLoaders({
  loadSampleRules,
  loadTerminologyVi,
});
