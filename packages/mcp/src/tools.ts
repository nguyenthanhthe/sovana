import {
  convertLunarToSolar,
  map34To63,
  map63To34,
  normalizeBirthTemporal,
  resolveLocation,
  sha256Canonical,
  type CalendarMode,
  type LateZiPolicy,
  type LeapMonthPolicy,
  type LocationQuery,
} from '@sovana/geo-time';
import {
  analyzeZiweiMultiLayerSihua,
  castDivinationAtInstant,
  compileChartIR,
  detectStructuredPatterns,
  type Gender,
  type LiuyaoLineValue,
  type ZiweiSilo,
} from '@sovana/kernel';
import { evaluateHopBan } from '@sovana/solver';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const SOVANA_MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'resolve_vietnam_location',
    description:
      'Resolve any Vietnamese province, district, historical alias (e.g. Sài Gòn, Gia Định, Hà Tây), or WGS-84 coordinate with bidirectional 63 legacy <-> 34 post-2025 province mapping (Nghị quyết 202/2025/QH15), Köppen climate zone, and historical timezone zone.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Province/district/city name, GSO code, or historical alias (e.g. "Sài Gòn", "Huế", "Hà Nội", "Thái Bình").',
        },
        lat: { type: 'number', description: 'Optional WGS-84 latitude when resolving by coordinates.' },
        lon: { type: 'number', description: 'Optional WGS-84 longitude when resolving by coordinates.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'convert_vietnam_calendar',
    description:
      'Deterministic NASA JPL DE440s (1900-2100) solar <-> lunar calendar conversion, Meeus True Solar Time, 24 Solar Terms, historical Vietnam timezones (1960-1975 South UTC+8 vs North UTC+7), and Vietnam UTC+7 (121-CP) vs Beijing UTC+8 divergence check.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['solar_to_lunar', 'lunar_to_solar'],
          description: 'Conversion direction. Defaults to "solar_to_lunar".',
        },
        year: { type: 'integer', minimum: 1900, maximum: 2100, description: 'Gregorian year (solar_to_lunar) or lunar year (lunar_to_solar).' },
        month: { type: 'integer', minimum: 1, maximum: 12, description: 'Month (1-12).' },
        day: { type: 'integer', minimum: 1, maximum: 31, description: 'Day of month.' },
        hour: { type: 'integer', minimum: 0, maximum: 23, description: 'Local clock hour (0-23, default 12).' },
        minute: { type: 'integer', minimum: 0, maximum: 59, description: 'Local clock minute (0-59, default 0).' },
        second: { type: 'integer', minimum: 0, maximum: 59, description: 'Local clock second (0-59, default 0).' },
        isLeapMonth: { type: 'boolean', description: 'For lunar_to_solar: whether the lunar month is a leap month.' },
        location: { type: 'string', description: 'Vietnam location name/alias (default "Hà Nội").' },
        calendarMode: {
          type: 'string',
          enum: ['VN_HISTORICAL', 'VN_UTC7', 'CN_UTC8'],
          description: 'Calendar regime (default "VN_HISTORICAL").',
        },
        leapMonthPolicy: {
          type: 'string',
          enum: ['keep', 'split-15', 'next-month', 'prev-month'],
          description: 'Leap month handling policy (default "keep").',
        },
        lateZiPolicy: {
          type: 'string',
          enum: ['next-day', 'current-day'],
          description: 'Late Zi (23:00-24:00) day rollover policy (default "next-day").',
        },
      },
      required: ['year', 'month', 'day'],
      additionalProperties: false,
    },
  },
  {
    name: 'compile_ziwei_chart',
    description:
      'Compile a deterministic 12-palace Zi Wei Dou Shu (Tử Vi Đẩu Số) chart across Vietnamese Nam Phái (109 stars) and Toàn Thư schools, including Vô Chính Diệu, Tam Không, Tứ Linh, multi-layer Tứ Hóa, structured classical patterns, Đại Hạn, Lưu Niên, and RFC 8785 SHA-256 verification digest.',
    inputSchema: {
      type: 'object',
      properties: {
        year: { type: 'integer', minimum: 1900, maximum: 2100 },
        month: { type: 'integer', minimum: 1, maximum: 12 },
        day: { type: 'integer', minimum: 1, maximum: 31 },
        hour: { type: 'integer', minimum: 0, maximum: 23 },
        minute: { type: 'integer', minimum: 0, maximum: 59, description: 'Default 0.' },
        gender: { type: 'string', enum: ['male', 'female'] },
        location: { type: 'string', description: 'Birthplace in Vietnam (default "Hà Nội").' },
        calendarMode: { type: 'string', enum: ['VN_HISTORICAL', 'VN_UTC7', 'CN_UTC8'] },
        silo: {
          type: 'string',
          enum: ['nam-phai', 'toan-thu', 'both'],
          description: 'School to return (default "nam-phai"; "both" returns Nam Phái + Toàn Thư side-by-side).',
        },
        targetYear: { type: 'integer', minimum: 1900, maximum: 2100, description: 'Optional transit year for Lưu Niên & Nguyệt Hạn.' },
        includePatterns: { type: 'boolean', description: 'Include structured classical patterns (default true).' },
        includeMultiLayerSihua: { type: 'boolean', description: 'Include multi-layer Tứ Hóa analysis (default false).' },
      },
      required: ['year', 'month', 'day', 'hour', 'gender'],
      additionalProperties: false,
    },
  },
  {
    name: 'compile_bazi_chart',
    description:
      'Compile a deterministic Four Pillars (Tứ Trụ Bát Tự) chart with hidden stems, Ten Gods (Thập Thần), quantitative Day Master strength (bps), 5-element weights, 10-year Đại Vận cycles, and Cùng Thông Bảo Giám seasonal balance (Điều Hậu) adjusted for birthplace Köppen climate.',
    inputSchema: {
      type: 'object',
      properties: {
        year: { type: 'integer', minimum: 1900, maximum: 2100 },
        month: { type: 'integer', minimum: 1, maximum: 12 },
        day: { type: 'integer', minimum: 1, maximum: 31 },
        hour: { type: 'integer', minimum: 0, maximum: 23 },
        minute: { type: 'integer', minimum: 0, maximum: 59 },
        gender: { type: 'string', enum: ['male', 'female'] },
        location: { type: 'string', description: 'Birthplace in Vietnam (default "Hà Nội").' },
        calendarMode: { type: 'string', enum: ['VN_HISTORICAL', 'VN_UTC7', 'CN_UTC8'] },
      },
      required: ['year', 'month', 'day', 'hour', 'gender'],
      additionalProperties: false,
    },
  },
  {
    name: 'cast_iching_hexagram',
    description:
      'Cast a deterministic 64-hexagram Chu Dịch (I-Ching) reading via Mai Hoa Dịch Số (timestamp-based) or 6-line Lục Hào (coin values 6, 7, 8, 9 from bottom to top), returning primary & transformed hexagrams, Nạp Giáp, Lục Thân, Lục Thú, Thế/Ứng, moving lines, and Tuần Không.',
    inputSchema: {
      type: 'object',
      properties: {
        nowMs: { type: 'integer', description: 'Optional Unix timestamp in milliseconds (defaults to current time).' },
        location: { type: 'string', description: 'Location for Vietnam UTC+7 inquiry time (default "Hà Nội").' },
        lines: {
          type: 'array',
          items: { type: 'integer', enum: [6, 7, 8, 9] },
          minItems: 6,
          maxItems: 6,
          description: 'Optional 6 coin-toss values bottom-to-top (6=Old Yin, 7=Young Yang, 8=Young Yin, 9=Old Yang). Omit for Mai Hoa.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'compare_charts_hopban',
    description:
      'Compare two birth charts deterministically (Hợp Bàn) across Marriage (HON_NHAN) and Business Partnership (HOP_TAC) modes: 5-pillar compatibility scoring, cross-chart Phi Hóa flights (A->B and B->A), Bazi element complementarity, strengths, friction points, and timing windows.',
    inputSchema: {
      type: 'object',
      properties: {
        personA: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            year: { type: 'integer', minimum: 1900, maximum: 2100 },
            month: { type: 'integer', minimum: 1, maximum: 12 },
            day: { type: 'integer', minimum: 1, maximum: 31 },
            hour: { type: 'integer', minimum: 0, maximum: 23 },
            minute: { type: 'integer', minimum: 0, maximum: 59 },
            gender: { type: 'string', enum: ['male', 'female'] },
            location: { type: 'string' },
          },
          required: ['year', 'month', 'day', 'hour', 'gender'],
        },
        personB: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            year: { type: 'integer', minimum: 1900, maximum: 2100 },
            month: { type: 'integer', minimum: 1, maximum: 12 },
            day: { type: 'integer', minimum: 1, maximum: 31 },
            hour: { type: 'integer', minimum: 0, maximum: 23 },
            minute: { type: 'integer', minimum: 0, maximum: 59 },
            gender: { type: 'string', enum: ['male', 'female'] },
            location: { type: 'string' },
          },
          required: ['year', 'month', 'day', 'hour', 'gender'],
        },
        silo: { type: 'string', enum: ['nam-phai', 'toan-thu'] },
        targetYear: { type: 'integer', minimum: 1900, maximum: 2100 },
      },
      required: ['personA', 'personB'],
      additionalProperties: false,
    },
  },
] as const;

function asInt(val: unknown, name: string, min: number, max: number, fallback?: number): number {
  if (val === undefined || val === null) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required integer field '${name}'`);
  }
  const n = typeof val === 'number' ? Math.trunc(val) : Number.parseInt(String(val), 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`Field '${name}' must be an integer in [${min}, ${max}], got ${String(val)}`);
  }
  return n;
}

function asGender(val: unknown): Gender {
  if (val === 'male' || val === 'female') return val;
  throw new Error(`Field 'gender' must be "male" or "female", got ${String(val)}`);
}

function asCalendarMode(val: unknown): CalendarMode {
  if (val === undefined || val === null) return 'VN_HISTORICAL';
  if (val === 'VN_HISTORICAL' || val === 'VN_UTC7' || val === 'CN_UTC8') return val;
  throw new Error(`Invalid calendarMode: ${String(val)}`);
}

function asLeapPolicy(val: unknown): LeapMonthPolicy {
  if (val === undefined || val === null) return 'keep';
  if (val === 'keep' || val === 'split-15' || val === 'next-month' || val === 'prev-month') {
    return val;
  }
  throw new Error(`Invalid leapMonthPolicy: ${String(val)}`);
}

function asLateZiPolicy(val: unknown): LateZiPolicy {
  if (val === undefined || val === null) return 'next-day';
  if (val === 'next-day' || val === 'current-day') return val;
  throw new Error(`Invalid lateZiPolicy: ${String(val)}`);
}

function asSilo(val: unknown): ZiweiSilo {
  if (val === undefined || val === null || val === 'nam-phai') return 'nam-phai';
  if (val === 'toan-thu') return 'toan-thu';
  throw new Error(`Invalid silo: ${String(val)}`);
}

function compilePerson(obj: Record<string, unknown>, targetYear?: number) {
  const year = asInt(obj.year, 'year', 1900, 2100);
  const month = asInt(obj.month, 'month', 1, 12);
  const day = asInt(obj.day, 'day', 1, 31);
  const hour = asInt(obj.hour, 'hour', 0, 23);
  const minute = asInt(obj.minute, 'minute', 0, 59, 0);
  const gender = asGender(obj.gender);
  const location = typeof obj.location === 'string' && obj.location.trim() ? obj.location.trim() : 'Hà Nội';
  const calendarMode = asCalendarMode(obj.calendarMode);

  const temporal = normalizeBirthTemporal({
    year,
    month,
    day,
    hour,
    minute,
    second: 0,
    location,
    calendarMode,
  });
  const chart = compileChartIR({
    temporal,
    gender,
    ...(targetYear !== undefined ? { targetYear } : {}),
  });
  return { temporal, chart };
}

export function callSovanaTool(name: string, args: Record<string, unknown>): Record<string, unknown> {
  switch (name) {
    case 'resolve_vietnam_location': {
      let query: LocationQuery;
      if (typeof args.lat === 'number' && typeof args.lon === 'number') {
        query = { lat: args.lat, lon: args.lon };
      } else if (typeof args.query === 'string' && args.query.trim()) {
        query = args.query.trim();
      } else {
        throw new Error('Provide either non-empty string "query" or numeric "lat" & "lon"');
      }
      const resolved = resolveLocation(query);
      const mapped34 = resolved.province63Code ? map63To34(resolved.province63Code) : null;
      const mapped63 = resolved.post2025Id ? map34To63(resolved.post2025Id) : [];
      return {
        resolved,
        post2025Province: mapped34,
        mergedFromLegacy63: mapped63.map((p) => ({ code: p.code, name: p.name })),
      };
    }

    case 'convert_vietnam_calendar': {
      const mode = args.mode === 'lunar_to_solar' ? 'lunar_to_solar' : 'solar_to_lunar';
      const calendarMode = asCalendarMode(args.calendarMode);
      const location =
        typeof args.location === 'string' && args.location.trim() ? args.location.trim() : 'Hà Nội';

      if (mode === 'lunar_to_solar') {
        const lunarYear = asInt(args.year, 'year', 1900, 2100);
        const lunarMonth = asInt(args.month, 'month', 1, 12);
        const lunarDay = asInt(args.day, 'day', 1, 30);
        const solar = convertLunarToSolar({
          lunarYear,
          lunarMonth,
          lunarDay,
          isLeapMonth: Boolean(args.isLeapMonth),
          calendarMode,
          location,
        });
        return { mode, solar };
      }

      const year = asInt(args.year, 'year', 1900, 2100);
      const month = asInt(args.month, 'month', 1, 12);
      const day = asInt(args.day, 'day', 1, 31);
      const hour = asInt(args.hour, 'hour', 0, 23, 12);
      const minute = asInt(args.minute, 'minute', 0, 59, 0);
      const second = asInt(args.second, 'second', 0, 59, 0);
      const temporal = normalizeBirthTemporal({
        year,
        month,
        day,
        hour,
        minute,
        second,
        location,
        calendarMode,
        leapMonthPolicy: asLeapPolicy(args.leapMonthPolicy),
        lateZiPolicy: asLateZiPolicy(args.lateZiPolicy),
      });
      const isLunarDivergentVnCn =
        temporal.lunarVn.lunarYear !== temporal.lunarCn.lunarYear ||
        temporal.lunarVn.lunarMonth !== temporal.lunarCn.lunarMonth ||
        temporal.lunarVn.lunarDay !== temporal.lunarCn.lunarDay ||
        temporal.lunarVn.isLeapMonth !== temporal.lunarCn.isLeapMonth;
      return {
        mode,
        isLunarDivergentVnCn,
        sha256: sha256Canonical(temporal),
        temporal,
      };
    }

    case 'compile_ziwei_chart': {
      const targetYear =
        args.targetYear !== undefined && args.targetYear !== null
          ? asInt(args.targetYear, 'targetYear', 1900, 2100)
          : undefined;
      const { temporal, chart } = compilePerson(args, targetYear);
      const siloArg = args.silo ?? 'nam-phai';
      if (siloArg !== 'nam-phai' && siloArg !== 'toan-thu' && siloArg !== 'both') {
        throw new Error(`Invalid silo: ${String(siloArg)}`);
      }
      const includePatterns = args.includePatterns !== false;
      const includeMultiLayerSihua = args.includeMultiLayerSihua === true;
      const primary = siloArg === 'toan-thu' ? chart.ziweiToanThu : chart.ziweiNamPhai;

      return {
        schemaVersion: chart.schemaVersion,
        chartSha256: sha256Canonical(chart),
        gender: chart.gender,
        temporal,
        empiricalForks: chart.empiricalForks,
        ziwei:
          siloArg === 'both'
            ? { namPhai: chart.ziweiNamPhai, toanThu: chart.ziweiToanThu }
            : primary,
        ...(includePatterns ? { structuredPatterns: detectStructuredPatterns(primary) } : {}),
        ...(includeMultiLayerSihua
          ? {
              multiLayerSihua: analyzeZiweiMultiLayerSihua(
                primary,
                temporal,
                targetYear !== undefined ? { targetYear } : undefined,
              ),
            }
          : {}),
      };
    }

    case 'compile_bazi_chart': {
      const { temporal, chart } = compilePerson(args);
      return {
        schemaVersion: chart.schemaVersion,
        baziSha256: sha256Canonical(chart.bazi),
        gender: chart.gender,
        temporal,
        bazi: chart.bazi,
      };
    }

    case 'cast_iching_hexagram': {
      const location =
        typeof args.location === 'string' && args.location.trim() ? args.location.trim() : 'Hà Nội';
      const nowMs =
        args.nowMs !== undefined && args.nowMs !== null
          ? asInt(args.nowMs, 'nowMs', -2208988800000, 4133980800000)
          : undefined;
      let lines: [
        LiuyaoLineValue,
        LiuyaoLineValue,
        LiuyaoLineValue,
        LiuyaoLineValue,
        LiuyaoLineValue,
        LiuyaoLineValue,
      ] | undefined;
      if (args.lines !== undefined && args.lines !== null) {
        if (!Array.isArray(args.lines) || args.lines.length !== 6) {
          throw new Error('Field "lines" must be an array of exactly 6 integers from {6, 7, 8, 9}');
        }
        const parsed = args.lines.map((v) => {
          if (v === 6 || v === 7 || v === 8 || v === 9) return v as LiuyaoLineValue;
          throw new Error(`Invalid coin line value: ${String(v)} (expected 6, 7, 8, or 9)`);
        });
        lines = parsed as [
          LiuyaoLineValue,
          LiuyaoLineValue,
          LiuyaoLineValue,
          LiuyaoLineValue,
          LiuyaoLineValue,
          LiuyaoLineValue,
        ];
      }
      const divination = castDivinationAtInstant({
        location,
        ...(nowMs !== undefined ? { nowMs } : {}),
        ...(lines !== undefined ? { lines } : {}),
      });
      return {
        sha256: sha256Canonical(divination),
        divination,
      };
    }

    case 'compare_charts_hopban': {
      if (!args.personA || typeof args.personA !== 'object' || Array.isArray(args.personA)) {
        throw new Error('Missing required object field "personA"');
      }
      if (!args.personB || typeof args.personB !== 'object' || Array.isArray(args.personB)) {
        throw new Error('Missing required object field "personB"');
      }
      const pAObj = args.personA as Record<string, unknown>;
      const pBObj = args.personB as Record<string, unknown>;
      const targetYear =
        args.targetYear !== undefined && args.targetYear !== null
          ? asInt(args.targetYear, 'targetYear', 1900, 2100)
          : undefined;
      const silo = asSilo(args.silo);
      const { chart: chartA } = compilePerson(pAObj, targetYear);
      const { chart: chartB } = compilePerson(pBObj, targetYear);
      const labelA = typeof pAObj.label === 'string' && pAObj.label.trim() ? pAObj.label.trim() : 'Person A';
      const labelB = typeof pBObj.label === 'string' && pBObj.label.trim() ? pBObj.label.trim() : 'Person B';
      const report = evaluateHopBan(chartA, chartB, {
        silo,
        labelA,
        labelB,
        ...(targetYear !== undefined ? { targetYear } : {}),
      });
      return {
        sha256: sha256Canonical(report),
        report,
      };
    }

    default:
      throw new Error(`Unknown SOVANA MCP tool: ${name}`);
  }
}
