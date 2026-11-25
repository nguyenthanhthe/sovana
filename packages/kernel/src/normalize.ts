import type {
  BaziAxiomSpec,
  DieuHauEntrySpec,
  HiddenStemSpec,
  LiuyaoAxiomSpec,
  LiuyaoHexagramSpec,
  NapAmEntrySpec,
  ZiweiAxiomSpec,
  ZiweiSilo,
} from './types.js';

const DEFAULT_TRANG_SINH_START: Record<string, number> = {
  '2': 8,
  '3': 11,
  '4': 5,
  '5': 8,
  '6': 2,
};

export function normalizeZiweiAxiom(
  raw: Record<string, unknown>,
  expectedSilo: ZiweiSilo,
): ZiweiAxiomSpec {
  const rawTs = raw['trangSinhRing'];
  let trangSinhStages: string[] = [];
  let trangSinhStartByCuc: Record<string, number> = { ...DEFAULT_TRANG_SINH_START };

  if (Array.isArray(rawTs)) {
    trangSinhStages = rawTs as string[];
    const extStart = (raw['trangSinhStartByCuc'] ?? raw['startBranchByCuc']) as
      | Record<string, number>
      | undefined;
    if (extStart && typeof extStart === 'object') {
      trangSinhStartByCuc = { ...DEFAULT_TRANG_SINH_START, ...extStart };
    }
  } else if (rawTs && typeof rawTs === 'object') {
    const tsObj = rawTs as Record<string, unknown>;
    const stagesCandidate = tsObj['stages'] ?? tsObj['names'] ?? tsObj['ring'] ?? tsObj['stars'];
    if (Array.isArray(stagesCandidate)) {
      trangSinhStages = stagesCandidate as string[];
    }
    const startCandidate = (tsObj['startBranchByCuc'] ??
      tsObj['startByCuc'] ??
      tsObj['cucStartBranch'] ??
      raw['trangSinhStartByCuc']) as Record<string, number> | undefined;
    if (startCandidate && typeof startCandidate === 'object') {
      trangSinhStartByCuc = { ...DEFAULT_TRANG_SINH_START, ...startCandidate };
    }
  }

  const rawKhoiViet = raw['thienKhoiVietByStem'] as unknown[];
  const thienKhoiVietByStem: [number, number][] = rawKhoiViet.map((entry) => {
    if (Array.isArray(entry)) {
      return [Number(entry[0]), Number(entry[1])];
    }
    const obj = entry as Record<string, number>;
    return [Number(obj['khoi'] ?? obj['thienKhoi']), Number(obj['viet'] ?? obj['thienViet'])];
  });

  const rawTriet = raw['trietByStemPair'] as Record<string, [number, number]>;
  const trietByStemPair: Record<string, [number, number]> = {};
  for (const [k, v] of Object.entries(rawTriet)) {
    if (k.includes('/') || k.includes(',')) {
      const firstPart = k.split(/[\/,]/)[0]!.trim();
      trietByStemPair[String(Number(firstPart) % 5)] = [Number(v[0]), Number(v[1])];
    } else {
      trietByStemPair[String(Number(k) % 5)] = [Number(v[0]), Number(v[1])];
    }
  }

  const rawMinorBr = raw['minorStarBrightnessByBranch'] as
    | Record<string, (string | null)[]>
    | undefined;
  const minorStarBrightnessByBranch: Record<string, (string | null)[]> = {};
  if (rawMinorBr && typeof rawMinorBr === 'object') {
    for (const [star, row] of Object.entries(rawMinorBr)) {
      if (Array.isArray(row)) {
        minorStarBrightnessByBranch[star] = row.map((el) =>
          el === null || el === undefined || el === '' ? null : String(el),
        );
      }
    }
  }

  return {
    siloId: (raw['siloId'] as ZiweiSilo) ?? expectedSilo,
    nameVi: String(raw['nameVi']),
    palaceOrderCounterClockwise: raw['palaceOrderCounterClockwise'] as string[],
    sihuaByStem: raw['sihuaByStem'] as Record<string, [string, string, string, string]>,
    brightnessLevels: raw['brightnessLevels'] as string[],
    majorStarBrightnessByBranch: raw['majorStarBrightnessByBranch'] as Record<string, string[]>,
    minorStarBrightnessByBranch,
    thaiTueRing: raw['thaiTueRing'] as string[],
    trangSinhStages,
    trangSinhStartByCuc,
    bacSyRing: raw['bacSyRing'] as string[],
    locTonByStem: (raw['locTonByStem'] as number[]).map(Number),
    thienKhoiVietByStem,
    menhChuByBranch: raw['menhChuByBranch'] as string[],
    thanChuByBranch: raw['thanChuByBranch'] as string[],
    trietByStemPair,
  };
}

const ELEMENTS_BY_INDEX = ['Mộc', 'Hỏa', 'Thổ', 'Kim', 'Thủy'] as const;

export function normalizeBaziAxiom(raw: Record<string, unknown>): BaziAxiomSpec {
  const rawHidden = raw['hiddenStemsByBranch'] as
    | Record<string, HiddenStemSpec[]>
    | HiddenStemSpec[][];
  const hiddenStemsByBranch: Record<string, HiddenStemSpec[]> = {};
  if (Array.isArray(rawHidden)) {
    for (let i = 0; i < rawHidden.length; i++) {
      hiddenStemsByBranch[String(i)] = rawHidden[i]!;
    }
  } else {
    for (const [k, v] of Object.entries(rawHidden)) {
      hiddenStemsByBranch[String(k)] = v;
    }
  }

  const rawSeasonal = raw['seasonalMultiplierBps'] as Record<string, number[]> | number[][];
  const seasonalMultiplierBps: Record<string, number[]> = {};
  if (Array.isArray(rawSeasonal)) {
    for (let i = 0; i < ELEMENTS_BY_INDEX.length; i++) {
      seasonalMultiplierBps[ELEMENTS_BY_INDEX[i]!] = rawSeasonal[i]!;
    }
  } else {
    for (const [k, v] of Object.entries(rawSeasonal)) {
      const maybeIdx = Number(k);
      if (Number.isInteger(maybeIdx) && maybeIdx >= 0 && maybeIdx < 5) {
        seasonalMultiplierBps[ELEMENTS_BY_INDEX[maybeIdx]!] = v;
      } else {
        seasonalMultiplierBps[k] = v;
      }
    }
  }

  const rawDieuHau = raw['cungThongBaoGiamDieuHau'] as
    | Record<string, Record<string, DieuHauEntrySpec> | DieuHauEntrySpec[]>
    | DieuHauEntrySpec[][];
  const cungThongBaoGiamDieuHau: Record<string, Record<string, DieuHauEntrySpec>> = {};
  for (let s = 0; s < 10; s++) {
    const sKey = String(s);
    cungThongBaoGiamDieuHau[sKey] = {};
    const row = Array.isArray(rawDieuHau) ? rawDieuHau[s] : rawDieuHau[sKey];
    if (Array.isArray(row)) {
      for (let b = 0; b < 12; b++) {
        cungThongBaoGiamDieuHau[sKey]![String(b)] = row[b]!;
      }
    } else if (row && typeof row === 'object') {
      for (const [bKey, val] of Object.entries(row)) {
        cungThongBaoGiamDieuHau[sKey]![String(bKey)] = val;
      }
    }
  }

  return {
    hiddenStemsByBranch,
    tenGodsNamesVi: raw['tenGodsNamesVi'] as string[],
    napAm60: raw['napAm60'] as NapAmEntrySpec[],
    seasonalMultiplierBps,
    cungThongBaoGiamDieuHau,
  };
}

function parseBitsFromCode(
  code: string | number,
  fallbackIdx?: number,
): { bitsIndex: number; code6bit: string } {
  if (typeof code === 'number') {
    const bitsIndex = code;
    let s = '';
    for (let i = 0; i < 6; i++) {
      s += String((bitsIndex >> i) & 1);
    }
    return { bitsIndex, code6bit: s };
  }
  const trimmed = code.trim();
  if (/^[01]{6}$/.test(trimmed)) {
    if (fallbackIdx !== undefined && Number.isInteger(fallbackIdx) && fallbackIdx >= 0 && fallbackIdx < 64) {
      let canonical = '';
      for (let i = 0; i < 6; i++) {
        canonical += String((fallbackIdx >> i) & 1);
      }
      return { bitsIndex: fallbackIdx, code6bit: canonical };
    }
    let lsbVal = 0;
    for (let i = 0; i < 6; i++) {
      if (trimmed[i] === '1') lsbVal |= 1 << i;
    }
    return { bitsIndex: lsbVal, code6bit: trimmed };
  }
  const parsed = Number(trimmed);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed < 64) {
    let canonical = '';
    for (let i = 0; i < 6; i++) {
      canonical += String((parsed >> i) & 1);
    }
    return { bitsIndex: parsed, code6bit: canonical };
  }
  throw new Error(`Invalid hexagram code6bit: ${String(code)}`);
}

const TRIGRAM_BITS3_BY_NAME: Record<string, number> = {
  Khôn: 0,
  Chấn: 1,
  Khảm: 2,
  Đoài: 3,
  Cấn: 4,
  Ly: 5,
  Tốn: 6,
  Càn: 7,
};

export function normalizeLiuyaoAxiom(raw: Record<string, unknown>): LiuyaoAxiomSpec {
  const hexSource = (raw['hexagrams'] ?? raw['hexagramsByCode'] ?? raw['hexagrams64']) as
    | Record<string, Record<string, unknown>>
    | Record<string, unknown>[];

  const hexagramsByBits: LiuyaoHexagramSpec[] = new Array(64);
  const rawEntries: Array<[string | number, Record<string, unknown>]> = Array.isArray(hexSource)
    ? hexSource.map((item, idx) => [idx, item])
    : Object.entries(hexSource);

  for (const [key, item] of rawEntries) {
    const lowerName = String(item['lowerTrigram'] ?? '');
    const upperName = String(item['upperTrigram'] ?? '');
    const lowerBits = TRIGRAM_BITS3_BY_NAME[lowerName];
    const upperBits = TRIGRAM_BITS3_BY_NAME[upperName];
    const trigramDerivedBits =
      lowerBits !== undefined && upperBits !== undefined ? lowerBits | (upperBits << 3) : undefined;

    const explicitInt =
      typeof item['linesBitsInt'] === 'number'
        ? (item['linesBitsInt'] as number)
        : typeof item['bitsIndex'] === 'number'
          ? (item['bitsIndex'] as number)
          : trigramDerivedBits;

    const { bitsIndex, code6bit } = parseBitsFromCode(
      (item['code6bit'] as string | number | undefined) ?? key,
      explicitInt,
    );

    hexagramsByBits[bitsIndex] = {
      bitsIndex,
      code6bit,
      kingWenNumber: Number(item['kingWenNumber']),
      nameVi: String(item['nameVi']),
      upperTrigram: upperName,
      lowerTrigram: lowerName,
      houseNameVi: String(item['houseNameVi']),
      houseElementVi: String(item['houseElementVi']),
      generationType: String(item['generationType']),
      theLine: Number(item['theLine']),
      ungLine: Number(item['ungLine']),
      lineBranches: (item['lineBranches'] as number[]).map(Number),
      lineStems: (item['lineStems'] as number[]).map(Number),
      lineElementsVi: item['lineElementsVi'] as string[],
      lineRelativesVi: item['lineRelativesVi'] as string[],
    };
  }

  const rawBeasts = raw['sixBeastsByDayStem'] as Record<string, string[]> | string[][];
  const sixBeastsByDayStem: Record<string, string[]> = {};
  if (Array.isArray(rawBeasts)) {
    for (let i = 0; i < rawBeasts.length; i++) {
      sixBeastsByDayStem[String(i)] = rawBeasts[i]!;
    }
  } else {
    for (const [k, v] of Object.entries(rawBeasts)) {
      sixBeastsByDayStem[String(k)] = v;
    }
  }

  return {
    hexagramsByBits,
    sixBeastsByDayStem,
  };
}
