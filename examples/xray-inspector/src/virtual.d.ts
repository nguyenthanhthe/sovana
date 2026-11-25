declare module 'virtual:sovana-brand' {
  export const SOVANA_LOGO_SVG: string;
  export const SOVANA_MARK_SVG: string;
  export const PUBLIC_RULES_50: readonly import('@sovana/solver').RuleIR[];
  export const SOVANA_SHOWCASE_SPECS: {
    ephemerisBase64: string;
    geoDataset: import('@sovana/geo-time').GeoDataset;
    tzRegimes: import('@sovana/geo-time').TzRegimesSpec;
    namPhai: Record<string, unknown>;
    toanThu: Record<string, unknown>;
    bazi: Record<string, unknown>;
    liuyao: Record<string, unknown>;
    terminologyVi: Record<string, unknown>;
  };
}
