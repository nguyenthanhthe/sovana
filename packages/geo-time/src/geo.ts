import { loadGeoDataset } from './store.js';
import type {
  DistrictLegacy,
  GeoDataset,
  HistoricalAlias,
  LocationQuery,
  ProvinceLegacy63,
  ProvincePost2025,
  ResolvedLocation,
  SpecialZone,
} from './types.js';

export function stripAccents(text: string): string {
  return text
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC');
}

export function normalizeSearchKey(text: string, stripAdminPrefix = true): string {
  let s = stripAccents(text).toLowerCase().trim();
  s = s.replace(/[-_/,.()]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (stripAdminPrefix) {
    for (const pfx of ['thanh pho ', 'thi xa ', 'tinh ', 'quan ', 'huyen ', 'tp ', 'tx ']) {
      if (s.startsWith(pfx)) {
        s = s.slice(pfx.length).trim();
        break;
      }
    }
  }
  s = s.replace(/\bqui\b/g, 'quy').replace(/\s+/g, ' ').trim();
  return s;
}

function makeCoords(lat: number, lon: number): { latMicroDeg: number; lonMicroDeg: number; lat: number; lon: number } {
  const latMicroDeg = Math.round(lat * 1_000_000);
  const lonMicroDeg = Math.round(lon * 1_000_000);
  return {
    latMicroDeg,
    lonMicroDeg,
    lat: latMicroDeg / 1_000_000,
    lon: lonMicroDeg / 1_000_000,
  };
}

interface IndexedDistrict {
  order: number;
  dist: DistrictLegacy;
  fullKey: string;
  prov63Key: string;
  post2025Key: string;
}

interface GeoIndex {
  geo: GeoDataset;
  p34ById: Map<string, ProvincePost2025>;
  p34ByKey: Map<string, ProvincePost2025>;
  p63ByCode: Map<string, ProvinceLegacy63>;
  p63ByKey: Map<string, ProvinceLegacy63>;
  szByKey: Map<string, SpecialZone>;
  distByCode: Map<string, IndexedDistrict>;
  distByFullKey: Map<string, IndexedDistrict[]>;
  distByKey: Map<string, IndexedDistrict[]>;
  aliasByKey: Map<string, HistoricalAlias>;
}

let cachedIndex: GeoIndex | null = null;

function addToBucket(map: Map<string, IndexedDistrict[]>, k: string, item: IndexedDistrict): void {
  let arr = map.get(k);
  if (!arr) {
    arr = [];
    map.set(k, arr);
  }
  if (!arr.includes(item)) {
    arr.push(item);
  }
}

function getGeoIndex(): GeoIndex {
  if (cachedIndex) return cachedIndex;
  const geo = loadGeoDataset();

  const p34ById = new Map<string, ProvincePost2025>();
  const p34ByKey = new Map<string, ProvincePost2025>();
  for (const p of geo.provincesPost2025) {
    p34ById.set(p.id, p);
    for (const k of [normalizeSearchKey(p.shortName), normalizeSearchKey(p.name)]) {
      if (!p34ByKey.has(k)) p34ByKey.set(k, p);
    }
  }

  const p63ByCode = new Map<string, ProvinceLegacy63>();
  const p63ByKey = new Map<string, ProvinceLegacy63>();
  for (const p of geo.provincesLegacy63) {
    p63ByCode.set(p.code, p);
    for (const k of [normalizeSearchKey(p.shortName), normalizeSearchKey(p.name)]) {
      if (!p63ByKey.has(k)) p63ByKey.set(k, p);
    }
  }

  const szByKey = new Map<string, SpecialZone>();
  for (const sz of geo.specialZones) {
    for (const k of [
      sz.id,
      normalizeSearchKey(sz.shortName),
      normalizeSearchKey(sz.name),
      normalizeSearchKey(sz.name, false),
    ]) {
      if (!szByKey.has(k)) szByKey.set(k, sz);
    }
  }

  const distByCode = new Map<string, IndexedDistrict>();
  const distByFullKey = new Map<string, IndexedDistrict[]>();
  const distByKey = new Map<string, IndexedDistrict[]>();
  for (let i = 0; i < geo.districtsLegacy.length; i++) {
    const dist = geo.districtsLegacy[i]!;
    const fullKey = normalizeSearchKey(dist.name, false);
    const shortKey = normalizeSearchKey(dist.name, true);
    const item: IndexedDistrict = {
      order: i,
      dist,
      fullKey,
      prov63Key: normalizeSearchKey(dist.province63Name),
      post2025Key: normalizeSearchKey(dist.post2025Name),
    };
    distByCode.set(dist.code, item);
    addToBucket(distByFullKey, fullKey, item);
    addToBucket(distByKey, shortKey, item);
  }

  const aliasByKey = new Map<string, HistoricalAlias>();
  for (const alias of geo.historicalAliases) {
    for (const n of [alias.name, ...alias.aliases]) {
      for (const k of [normalizeSearchKey(n), normalizeSearchKey(n, false)]) {
        if (!aliasByKey.has(k)) aliasByKey.set(k, alias);
      }
    }
  }

  cachedIndex = {
    geo,
    p34ById,
    p34ByKey,
    p63ByCode,
    p63ByKey,
    szByKey,
    distByCode,
    distByFullKey,
    distByKey,
    aliasByKey,
  };
  return cachedIndex;
}

export function listProvinces34(): readonly ProvincePost2025[] {
  return getGeoIndex().geo.provincesPost2025;
}

export function listProvinces63(): readonly ProvinceLegacy63[] {
  return getGeoIndex().geo.provincesLegacy63;
}

export function map63To34(codeOrName: string): ProvincePost2025 {
  const idx = getGeoIndex();
  const trimmed = codeOrName.trim();
  const p63 = idx.p63ByCode.get(trimmed) ?? idx.p63ByKey.get(normalizeSearchKey(trimmed));
  if (!p63) {
    throw new Error(`Legacy 63 province not found: ${codeOrName}`);
  }
  const p34 = idx.p34ById.get(p63.post2025Id);
  if (!p34) {
    throw new Error(`Post-2025 province missing for code ${p63.code}`);
  }
  return p34;
}

export function map34To63(idOrName: string): ProvinceLegacy63[] {
  const idx = getGeoIndex();
  const trimmed = idOrName.trim();
  const p34 = idx.p34ById.get(trimmed) ?? idx.p34ByKey.get(normalizeSearchKey(trimmed));
  if (!p34) {
    throw new Error(`Post-2025 province not found: ${idOrName}`);
  }
  return p34.mergedFrom63Codes.map((c) => idx.p63ByCode.get(c)!);
}

export function resolveLocation(query: LocationQuery): ResolvedLocation {
  const idx = getGeoIndex();

  if (typeof query !== 'string') {
    if (query.code || query.name) {
      return resolveLocation(query.code ?? query.name ?? '');
    }
    if (query.lat !== undefined && query.lon !== undefined) {
      const c = makeCoords(query.lat, query.lon);
      const inVn = c.lat >= 8.0 && c.lat <= 23.5 && c.lon >= 102.0 && c.lon <= 117.5;
      return {
        matchedBy: 'coordinates',
        query: `${c.lat},${c.lon}`,
        canonicalName: `${c.lat}, ${c.lon}`,
        province63Code: null,
        province63Name: null,
        post2025Id: null,
        post2025Name: null,
        districtCode: null,
        districtName: null,
        ...c,
        tzZone: inVn ? (c.lat >= 17.006 ? 'VN_NORTH_DRV' : 'VN_SOUTH_RVN') : null,
        koppenZone: null,
        wideLongitudeWarning: false,
        lonSpanDeg: 0,
      };
    }
    throw new Error('LocationQuery object must provide code, name, or lat/lon');
  }

  const rawQuery = query.trim();
  const commaIdx = rawQuery.indexOf(',');
  const hasComma = commaIdx !== -1;
  const primaryRaw = hasComma ? rawQuery.slice(0, commaIdx).trim() : rawQuery;
  const lastComma = hasComma ? rawQuery.lastIndexOf(',') : -1;
  const provFilterKey = hasComma ? normalizeSearchKey(rawQuery.slice(lastComma + 1).trim()) : null;
  const key = normalizeSearchKey(primaryRaw);
  const fullKey = normalizeSearchKey(rawQuery, false);

  // 1. Special zones & islands
  const sz = idx.szByKey.get(rawQuery.toLowerCase()) ?? idx.szByKey.get(key) ?? idx.szByKey.get(fullKey);
  if (sz) {
    const p63 = idx.p63ByCode.get(sz.legacy63Code);
    const p34 = idx.p34ById.get(sz.post2025Id);
    const c = makeCoords(sz.lat, sz.lon);
    return {
      matchedBy: 'special_zone',
      query: rawQuery,
      canonicalName: sz.name,
      province63Code: p63?.code ?? sz.legacy63Code,
      province63Name: p63?.shortName ?? null,
      post2025Id: p34?.id ?? sz.post2025Id,
      post2025Name: p34?.shortName ?? null,
      districtCode: null,
      districtName: sz.shortName,
      ...c,
      tzZone: sz.tzZone,
      koppenZone: sz.koppenZone,
      wideLongitudeWarning: false,
      lonSpanDeg: 0,
    };
  }

  // 2 & 3. Legacy 63 & Post-2025 34 provinces
  if (!hasComma) {
    const p63 = idx.p63ByCode.get(rawQuery) ?? idx.p63ByKey.get(key);
    if (p63) {
      const p34 = idx.p34ById.get(p63.post2025Id);
      const c = makeCoords(p63.lat, p63.lon);
      return {
        matchedBy: 'legacy63',
        query: rawQuery,
        canonicalName: p63.name,
        province63Code: p63.code,
        province63Name: p63.shortName,
        post2025Id: p63.post2025Id,
        post2025Name: p63.post2025Name,
        districtCode: null,
        districtName: null,
        ...c,
        tzZone: p63.tzZone,
        koppenZone: p63.koppenZone,
        wideLongitudeWarning: p34?.wideLongitudeWarning ?? false,
        lonSpanDeg: p34?.lonSpanDeg ?? Math.round((p63.maxLon - p63.minLon) * 10000) / 10000,
      };
    }

    const p34 = idx.p34ById.get(rawQuery.toLowerCase()) ?? idx.p34ByKey.get(key);
    if (p34) {
      const leadCode = p34.mergedFrom63Codes[0]!;
      const c = makeCoords(p34.lat, p34.lon);
      return {
        matchedBy: 'post2025',
        query: rawQuery,
        canonicalName: p34.name,
        province63Code: leadCode,
        province63Name: idx.p63ByCode.get(leadCode)?.shortName ?? null,
        post2025Id: p34.id,
        post2025Name: p34.shortName,
        districtCode: null,
        districtName: null,
        ...c,
        tzZone: p34.tzZone,
        koppenZone: p34.koppenZone,
        wideLongitudeWarning: p34.wideLongitudeWarning,
        lonSpanDeg: p34.lonSpanDeg,
      };
    }
  }

  // 4. Legacy districts (~696)
  const rawPrimaryNormFull = normalizeSearchKey(primaryRaw, false);
  const byCode = idx.distByCode.get(rawQuery);
  let matchedDistricts: IndexedDistrict[];
  if (byCode) {
    matchedDistricts = [byCode];
  } else {
    const a = idx.distByFullKey.get(rawPrimaryNormFull) ?? [];
    const b = idx.distByKey.get(key) ?? [];
    if (a.length === 0) {
      matchedDistricts = b;
    } else if (b.length === 0) {
      matchedDistricts = a;
    } else {
      const set = new Set<IndexedDistrict>([...a, ...b]);
      matchedDistricts = [...set].sort((x, y) => x.order - y.order);
    }
  }

  if (matchedDistricts.length > 0) {
    let chosen = matchedDistricts[0]!;
    if (provFilterKey) {
      const filtered = matchedDistricts.find(
        (m) =>
          m.prov63Key === provFilterKey ||
          m.post2025Key === provFilterKey ||
          m.dist.post2025Id === provFilterKey,
      );
      if (filtered) chosen = filtered;
    } else if (matchedDistricts.length > 1) {
      const exactFull = matchedDistricts.find((m) => m.fullKey === rawPrimaryNormFull);
      if (exactFull) chosen = exactFull;
    }
    const d = chosen.dist;
    const c = makeCoords(d.lat, d.lon);
    return {
      matchedBy: 'district',
      query: rawQuery,
      canonicalName: `${d.name}, ${d.province63Name}`,
      province63Code: d.province63Code,
      province63Name: d.province63Name,
      post2025Id: d.post2025Id,
      post2025Name: d.post2025Name,
      districtCode: d.code,
      districtName: d.name,
      ...c,
      tzZone: d.tzZone,
      koppenZone: d.koppenZone,
      wideLongitudeWarning: false,
      lonSpanDeg: 0,
    };
  }

  // 5. Historical aliases
  const alias = idx.aliasByKey.get(key) ?? idx.aliasByKey.get(fullKey);
  if (alias) {
    const leadCode = alias.legacy63Codes[0]!;
    const p63 = idx.p63ByCode.get(leadCode)!;
    const p34 = idx.p34ById.get(p63.post2025Id)!;
    const c = makeCoords(alias.lat, alias.lon);
    return {
      matchedBy: 'historical_alias',
      query: rawQuery,
      canonicalName: alias.name,
      province63Code: p63.code,
      province63Name: p63.shortName,
      post2025Id: p34.id,
      post2025Name: p34.shortName,
      districtCode: null,
      districtName: null,
      ...c,
      tzZone: c.lat >= 17.006 ? 'VN_NORTH_DRV' : 'VN_SOUTH_RVN',
      koppenZone: p63.koppenZone,
      wideLongitudeWarning: p34.wideLongitudeWarning,
      lonSpanDeg: p34.lonSpanDeg,
    };
  }

  throw new Error(`Unable to resolve Vietnam location: '${rawQuery}'`);
}
