import type { BaziAxiomSpec, LiuyaoAxiomSpec, ZiweiAxiomSpec, ZiweiSilo } from './types.js';

export interface KernelDataLoaders {
  loadZiweiAxiom: (silo: ZiweiSilo) => ZiweiAxiomSpec;
  loadBaziAxiom: () => BaziAxiomSpec;
  loadLiuyaoAxiom: () => LiuyaoAxiomSpec;
}

let activeLoaders: KernelDataLoaders | null = null;

export function registerKernelLoaders(loaders: KernelDataLoaders): void {
  activeLoaders = loaders;
}

function requireLoaders(): KernelDataLoaders {
  if (!activeLoaders) {
    throw new Error('@sovana/kernel data loaders not registered.');
  }
  return activeLoaders;
}

export function loadZiweiAxiom(silo: ZiweiSilo): ZiweiAxiomSpec {
  return requireLoaders().loadZiweiAxiom(silo);
}

export function loadBaziAxiom(): BaziAxiomSpec {
  return requireLoaders().loadBaziAxiom();
}

export function loadLiuyaoAxiom(): LiuyaoAxiomSpec {
  return requireLoaders().loadLiuyaoAxiom();
}
