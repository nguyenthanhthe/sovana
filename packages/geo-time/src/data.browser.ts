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

let cachedEphemeris: EphemerisTable | null = null;
let cachedGeo: GeoDataset | null = null;
let cachedTz: TzRegimesSpec | null = null;
let inflightPreload: Promise<void> | null = null;

async function fetchBinary(url: string, label: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch @sovana/geo-time ${label} (${res.status} ${res.statusText}) from ${url}`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchJson<T>(url: string, label: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch @sovana/geo-time ${label} (${res.status} ${res.statusText}) from ${url}`,
    );
  }
  return (await res.json()) as T;
}

export function initGeoTimeBrowser(init: GeoTimeBrowserInit): void {
  cachedEphemeris =
    init.ephemeris instanceof Uint8Array ? parseEphemeris(init.ephemeris) : init.ephemeris;
  cachedGeo = init.geoDataset;
  cachedTz = init.tzRegimes;
}

export async function preloadGeoTimeData(urls?: GeoTimeAssetUrls): Promise<void> {
  if (!urls && cachedEphemeris && cachedGeo && cachedTz) {
    return;
  }
  if (!urls && inflightPreload) {
    return inflightPreload;
  }

  const run = async (): Promise<void> => {
    const ephUrl =
      urls?.ephemerisUrl ?? new URL('../data/ephemeris_1900_2100.bin', import.meta.url).href;
    const geoUrl =
      urls?.geoDatasetUrl ?? new URL('../data/vn_bi_temporal_geo.json', import.meta.url).href;
    const tzUrl =
      urls?.tzRegimesUrl ?? new URL('../data/vn_tz_regimes.json', import.meta.url).href;

    const [ephBytes, geoData, tzData] = await Promise.all([
      cachedEphemeris && !urls?.ephemerisUrl
        ? Promise.resolve(null)
        : fetchBinary(ephUrl, 'ephemeris'),
      cachedGeo && !urls?.geoDatasetUrl
        ? Promise.resolve(null)
        : fetchJson<GeoDataset>(geoUrl, 'geoDataset'),
      cachedTz && !urls?.tzRegimesUrl
        ? Promise.resolve(null)
        : fetchJson<TzRegimesSpec>(tzUrl, 'tzRegimes'),
    ]);

    if (ephBytes) cachedEphemeris = parseEphemeris(ephBytes);
    if (geoData) cachedGeo = geoData;
    if (tzData) cachedTz = tzData;
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

export function loadEphemeris(): EphemerisTable {
  if (!cachedEphemeris) {
    throw new Error(
      '@sovana/geo-time browser data not loaded. Call await preloadGeoTimeData() or initGeoTimeBrowser(...) first.',
    );
  }
  return cachedEphemeris;
}

export function loadGeoDataset(): GeoDataset {
  if (!cachedGeo) {
    throw new Error(
      '@sovana/geo-time browser data not loaded. Call await preloadGeoTimeData() or initGeoTimeBrowser(...) first.',
    );
  }
  return cachedGeo;
}

export function loadTzRegimes(): TzRegimesSpec {
  if (!cachedTz) {
    throw new Error(
      '@sovana/geo-time browser data not loaded. Call await preloadGeoTimeData() or initGeoTimeBrowser(...) first.',
    );
  }
  return cachedTz;
}

registerGeoTimeLoaders({
  loadEphemeris,
  loadGeoDataset,
  loadTzRegimes,
});
