import type { EphemerisTable, GeoDataset, TzRegimesSpec } from './types.js';

export interface GeoTimeDataLoaders {
  loadEphemeris: () => EphemerisTable;
  loadGeoDataset: () => GeoDataset;
  loadTzRegimes: () => TzRegimesSpec;
}

let activeLoaders: GeoTimeDataLoaders | null = null;

export function registerGeoTimeLoaders(loaders: GeoTimeDataLoaders): void {
  activeLoaders = loaders;
}

function requireLoaders(): GeoTimeDataLoaders {
  if (!activeLoaders) {
    throw new Error('@sovana/geo-time data loaders not registered.');
  }
  return activeLoaders;
}

export function loadEphemeris(): EphemerisTable {
  return requireLoaders().loadEphemeris();
}

export function loadGeoDataset(): GeoDataset {
  return requireLoaders().loadGeoDataset();
}

export function loadTzRegimes(): TzRegimesSpec {
  return requireLoaders().loadTzRegimes();
}
