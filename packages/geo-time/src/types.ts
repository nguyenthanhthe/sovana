export type CalendarMode = 'VN_UTC7' | 'CN_UTC8' | 'VN_HISTORICAL';
export type LeapMonthPolicy = 'keep' | 'split-15' | 'next-month' | 'prev-month';
export type LateZiPolicy = 'next-day' | 'current-day';
export type VietnamTzZone = 'VN_NORTH_DRV' | 'VN_SOUTH_RVN';

export interface EphemerisTable {
  version: number;
  startYear: number;
  endYear: number;
  firstSolarTermIndex: number;
  timeScaleId: number;
  newMoons: number[];
  solarTerms: number[];
}

export interface ProvincePost2025 {
  id: string;
  name: string;
  shortName: string;
  type: 'city' | 'province';
  isMerged: boolean;
  effectiveFrom: string;
  mergedFrom63Codes: string[];
  mergedFrom63Names: string[];
  lat: number;
  lon: number;
  minLon: number;
  maxLon: number;
  lonSpanDeg: number;
  wideLongitudeWarning: boolean;
  tzZone: VietnamTzZone;
  koppenZone: string;
}

export interface ProvinceLegacy63 {
  code: string;
  name: string;
  shortName: string;
  lat: number;
  lon: number;
  minLon: number;
  maxLon: number;
  tzZone: VietnamTzZone;
  koppenZone: string;
  post2025Id: string;
  post2025Name: string;
}

export interface DistrictLegacy {
  code: string;
  name: string;
  province63Code: string;
  province63Name: string;
  post2025Id: string;
  post2025Name: string;
  lat: number;
  lon: number;
  tzZone: VietnamTzZone;
  koppenZone: string;
  coordSource: string;
}

export interface HistoricalAlias {
  name: string;
  aliases: string[];
  legacy63Codes: string[];
  lat: number;
  lon: number;
  note: string;
}

export interface SpecialZone {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lon: number;
  legacy63Code: string;
  post2025Id: string;
  kind: string;
  tzZone: VietnamTzZone;
  koppenZone: string;
}

export interface GeoDataset {
  schemaVersion: string;
  provincesPost2025: ProvincePost2025[];
  provincesLegacy63: ProvinceLegacy63[];
  districtsLegacy: DistrictLegacy[];
  historicalAliases: HistoricalAlias[];
  specialZones: SpecialZone[];
}

export interface TzRegimeInterval {
  id: string;
  startLocal: string;
  endLocal: string;
  utcOffsetSeconds: number;
  utcOffsetLabel: string;
  isContestedZone: boolean;
  candidateOffsetsSeconds: number[];
  decision121CpLunar: boolean;
  historicalNote: string;
}

export interface TzRegimesSpec {
  schemaVersion: string;
  parallel17LatDeg: number;
  vietnamBoundingBox: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
  zones: Record<VietnamTzZone, TzRegimeInterval[]>;
}

export interface LocationQueryObject {
  code?: string;
  name?: string;
  lat?: number;
  lon?: number;
}

export type LocationQuery = string | LocationQueryObject;

export interface ResolvedLocation {
  matchedBy: 'special_zone' | 'legacy63' | 'post2025' | 'district' | 'historical_alias' | 'coordinates';
  query: string;
  canonicalName: string;
  province63Code: string | null;
  province63Name: string | null;
  post2025Id: string | null;
  post2025Name: string | null;
  districtCode: string | null;
  districtName: string | null;
  latMicroDeg: number;
  lonMicroDeg: number;
  lat: number;
  lon: number;
  tzZone: VietnamTzZone | null;
  koppenZone: string | null;
  wideLongitudeWarning: boolean;
  lonSpanDeg: number;
}

export interface TimezoneQuery {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
  lat?: number | undefined;
  lon?: number | undefined;
  tzZone?: VietnamTzZone | null | undefined;
  ianaTimeZone?: string | undefined;
}

export interface TimezoneResolution {
  source: 'VN_REGIME' | 'INTL_IANA';
  zoneId: string;
  regimeId: string;
  utcOffsetSeconds: number;
  utcOffsetLabel: string;
  isContestedZone: boolean;
  candidateOffsetsSeconds: number[];
  decision121CpLunar: boolean;
  isDstGapOrFold: boolean;
  historicalNote: string;
}

export interface TrueSolarTimeInput {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
  lon: number;
  utcOffsetSeconds: number;
}

export interface TrueSolarTimeResult {
  instantUnixMs: number;
  localEpochDay: number;
  trueSolarEpochDay: number;
  dayOffset: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  formattedTime: string;
  lonMicroDeg: number;
  longitudeCorrectionMs: number;
  eotCentiseconds: number;
  eotMs: number;
  totalCorrectionMs: number;
  shichenBranch: number;
  shichenBranchVi: string;
  isLateZi: boolean;
  secondsToShichenBoundary: number;
  secondsToMidnightBoundary: number;
}

export interface SolarTermInfo {
  index: number;
  termIndex: number;
  termNameVi: string;
  isMajorTerm: boolean;
  startMs: number;
  nextMs: number;
  nextTermIndex: number;
  nextTermNameVi: string;
  secondsToPrevTerm: number;
  secondsToNextTerm: number;
  minSecondsToTermBoundary: number;
}

export interface LunarDateResult {
  lunarYear: number;
  lunarMonth: number;
  lunarDay: number;
  isLeapMonth: boolean;
  effectiveLunarMonth: number;
  monthLengthDays: number;
  calendarMode: CalendarMode;
  offsetSeconds: number;
  leapMonthPolicy: LeapMonthPolicy;
}

export interface SolarDateResult {
  year: number;
  month: number;
  day: number;
  epochDay: number;
  isoDate: string;
}

export interface ConvertLunarToSolarInput {
  lunarYear: number;
  lunarMonth: number;
  lunarDay: number;
  isLeapMonth?: boolean | undefined;
  calendarMode?: CalendarMode | undefined;
  location?: LocationQuery | undefined;
  offsetSecondsOverride?: number | undefined;
}

export interface ConvertLunarToSolarResult extends SolarDateResult {
  lunarYear: number;
  lunarMonth: number;
  lunarDay: number;
  isLeapMonth: boolean;
  monthLengthDays: number;
  calendarMode: CalendarMode;
  effectiveLunarCalendar: 'VN_UTC7' | 'CN_UTC8';
  offsetSeconds: number;
}

export interface LunarMonthMeta {
  lunarMonth: number;
  isLeapMonth: boolean;
  lengthDays: number;
  startIsoDate: string;
  endIsoDate: string;
}

export interface LunarYearLeapInfo {
  lunarYear: number;
  calendarMode: CalendarMode;
  offsetSeconds: number;
  leapMonth: number | null;
  months: LunarMonthMeta[];
}

export interface PillarPair {
  stemIndex: number;
  branchIndex: number;
  stemVi: string;
  branchVi: string;
  labelVi: string;
}

export interface SexagenaryPillars {
  lunarYearPillar: PillarPair;
  baziYearPillar: PillarPair;
  baziMonthPillar: PillarPair;
  dayPillar: PillarPair;
  hourPillar: PillarPair;
  lateZiPolicy: LateZiPolicy;
}

export interface MigrationAzimuthResult {
  distanceMeters: number;
  forwardAzimuthMilliDeg: number;
  forwardAzimuthDeg: number;
  palaceBranch: number;
  palaceBranchVi: string;
  isSignificantMigration: boolean;
  isSectorBoundaryAmbiguous: boolean;
  minSectorBoundaryMilliDeg: number;
}

export interface BoundaryUncertainty {
  isShichenBoundaryAmbiguous: boolean;
  secondsToShichenBoundary: number;
  isSolarTermBoundaryAmbiguous: boolean;
  minSecondsToTermBoundary: number;
  isContestedTimezone: boolean;
  isDstGapOrFold: boolean;
  wideLongitudeWarning: boolean;
  isBoundaryAmbiguous: boolean;
  candidateShichenBranches: number[];
}

export interface NormalizeBirthInput {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
  location: LocationQuery;
  ianaTimeZone?: string;
  calendarMode?: CalendarMode;
  leapMonthPolicy?: LeapMonthPolicy;
  lateZiPolicy?: LateZiPolicy;
  migrationDestination?: LocationQuery;
}

export interface NormalizedBirthTemporal {
  schemaVersion: string;
  inputEcho: {
    isoWallClock: string;
    calendarMode: CalendarMode;
    leapMonthPolicy: LeapMonthPolicy;
    lateZiPolicy: LateZiPolicy;
  };
  location: ResolvedLocation;
  timezone: TimezoneResolution;
  trueSolarTime: TrueSolarTimeResult;
  solarTerm: SolarTermInfo;
  lunarVn: LunarDateResult;
  lunarCn: LunarDateResult;
  lunarActive: LunarDateResult;
  pillars: SexagenaryPillars;
  uncertainty: BoundaryUncertainty;
  migration: MigrationAzimuthResult | null;
}
