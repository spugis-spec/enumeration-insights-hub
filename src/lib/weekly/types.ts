// Feeder lookup mapping
export interface FeederLookup {
  [code: string]: string;
}

// Asset data row from uploaded files
export interface AssetRow {
  time?: string | Date;
  feeder?: string;
  _11kv_feeder?: string;
  _33kv_feeder?: string;
  [key: string]: unknown;
}

// Unmatched feeder from issue log needing correction
export interface UnmatchedFeeder {
  originalName: string;
  correctedName: string;
  count: number;
}

// Generated report data per feeder
export interface FeederReportRow {
  feederName: string;
  rawFeederName: string; // Original name before lookup
  mappedDTWeek: number;
  mappedDTTotal: number;
  htPolesWeek: number;
  htPolesTotal: number;
  ltPolesWeek: number;
  ltPolesTotal: number;
  consumerPointsWeek: number;
  consumerPointsTotal: number;
  issueLogWeek: number;
  issueLogTotal: number;
  isEdited?: boolean;
}

// Saved report structure
export interface SavedReport {
  data: FeederReportRow[];
  dateRange: { start: string; end: string };
  savedAt: string;
  weekLabel: string;
}

// Saved week with week number
export interface SavedWeek {
  id?: string;
  weekNumber: number;
  data: FeederReportRow[];
  dateRange: { start: string; end: string };
  savedAt: string;
  weekLabel: string;
}

// Comparison row for side-by-side view
export interface ComparisonRow {
  feederName: string;
  prev: {
    mappedDTWeek: number;
    mappedDTTotal: number;
    htPolesWeek: number;
    htPolesTotal: number;
    ltPolesWeek: number;
    ltPolesTotal: number;
    consumerPointsWeek: number;
    consumerPointsTotal: number;
    issueLogWeek: number;
    issueLogTotal: number;
  };
  current: {
    mappedDTWeek: number;
    mappedDTTotal: number;
    htPolesWeek: number;
    htPolesTotal: number;
    ltPolesWeek: number;
    ltPolesTotal: number;
    consumerPointsWeek: number;
    consumerPointsTotal: number;
    issueLogWeek: number;
    issueLogTotal: number;
  };
  diff: {
    mappedDTWeek: number;
    mappedDTTotal: number;
    htPolesWeek: number;
    htPolesTotal: number;
    ltPolesWeek: number;
    ltPolesTotal: number;
    consumerPointsWeek: number;
    consumerPointsTotal: number;
    issueLogWeek: number;
    issueLogTotal: number;
  };
}
