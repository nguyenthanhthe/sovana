import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEphemeris } from './ephemeris.js';
import { registerGeoTimeLoaders } from './store.js';
import type { EphemerisTable, GeoDataset, TzRegimesSpec } from './types.js';

export interface GeoTimeBrowserInit {
  ephemeris: Uint8Array | EphemerisTable;
  geoDataset: GeoDataset;
  tzRegimes: TzRegimesSpec;
}

export interface GeoTimeAssetUrls {
  ephemerisUrl?: string | undefined;
  geoDatasetUrl?: string | undefined;
  tzRegimesUrl?: string | undefined;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgRoot, '../..');

let cachedEphemeris: EphemerisTable | null = null;
let cachedGeo: GeoDataset | null = null;
let cachedTz: TzRegimesSpec | null = null;

function resolveDataFile(pkgRel: string, repoRel: string): string {
  const pkgPath = path.join(pkgRoot, 'data', pkgRel);
  if (fs.existsSync(pkgPath)) {
    return pkgPath;
  }
  const specPath = path.join(repoRoot, 'specs', repoRel);
  if (fs.existsSync(specPath)) {
    return specPath;
  }
  throw new Error(`SOVANA spec file not found at '${pkgPath}' or '${specPath}'`);
}

export function initGeoTimeBrowser(init: GeoTimeBrowserInit): void {
  cachedEphemeris =
    init.ephemeris instanceof Uint8Array ? parseEphemeris(init.ephemeris) : init.ephemeris;
  cachedGeo = init.geoDataset;
  cachedTz = init.tzRegimes;
}

export async function preloadGeoTimeData(_urls?: GeoTimeAssetUrls): Promise<void> {
  loadEphemeris();
  loadGeoDataset();
  loadTzRegimes();
}

export function loadEphemeris(): EphemerisTable {
  if (!cachedEphemeris) {
    const filePath = resolveDataFile(
      'ephemeris_1900_2100.bin',
      path.join('ephemeris', 'ephemeris_1900_2100.bin'),
    );
    const raw = fs.readFileSync(filePath);
    cachedEphemeris = parseEphemeris(raw);
  }
  return cachedEphemeris;
}

export function loadGeoDataset(): GeoDataset {
  if (!cachedGeo) {
    const filePath = resolveDataFile(
      'vn_bi_temporal_geo.json',
      path.join('geo', 'vn_bi_temporal_geo.json'),
    );
    cachedGeo = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as GeoDataset;
  }
  return cachedGeo;
}

export function loadTzRegimes(): TzRegimesSpec {
  if (!cachedTz) {
    const filePath = resolveDataFile('vn_tz_regimes.json', path.join('geo', 'vn_tz_regimes.json'));
    cachedTz = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TzRegimesSpec;
  }
  return cachedTz;
}

registerGeoTimeLoaders({
  loadEphemeris,
  loadGeoDataset,
  loadTzRegimes,
});
