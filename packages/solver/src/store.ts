import type { RuleIR } from './types.js';

export interface SolverDataLoaders {
  loadSampleRules: () => RuleIR[];
  loadTerminologyVi: () => Record<string, unknown>;
}

let activeLoaders: SolverDataLoaders | null = null;

export function registerSolverLoaders(loaders: SolverDataLoaders): void {
  activeLoaders = loaders;
}

function requireLoaders(): SolverDataLoaders {
  if (!activeLoaders) {
    throw new Error('@sovana/solver data loaders not registered.');
  }
  return activeLoaders;
}

export function loadSampleRules(): RuleIR[] {
  return requireLoaders().loadSampleRules();
}

export function loadTerminologyVi(): Record<string, unknown> {
  return requireLoaders().loadTerminologyVi();
}
