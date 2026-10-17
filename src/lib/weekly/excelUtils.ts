import * as XLSX from 'xlsx';
import type { FeederLookup, AssetRow, FeederReportRow, SavedReport } from './types';

// Parse Excel file to JSON
export async function parseExcelFile(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet);
        resolve(json as Record<string, unknown>[]);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
}

// Parse feeder lookup file
export async function parseFeederLookup(file: File): Promise<FeederLookup> {
  const data = await parseExcelFile(file);
  const lookup: FeederLookup = {};
  
  data.forEach((row) => {
    const keys = Object.keys(row);
    if (keys.length >= 2) {
      const code = String(row[keys[0]] || '').trim();
      const name = String(row[keys[1]] || '').trim();
      if (code) {
        // Store code -> name mapping (lowercase for matching)
        lookup[code.toLowerCase()] = name || code;
        // Also store the full name for reverse lookup
        if (name) {
          lookup[name.toLowerCase()] = name;
        }
      }
    }
  });
  
  return lookup;
}

// Smart feeder matching - matches short codes like "L36" to full names like "132KV KUKWABA TS_33KV FDR L36_PL_PL"
export function smartMatchFeeder(feederValue: string, lookup: FeederLookup, allFeeders: string[]): { matched: string; raw: string } {
  const trimmed = feederValue.trim();
  if (!trimmed) return { matched: '', raw: '' };
  
  const lowerValue = trimmed.toLowerCase();
  
  // Direct match in lookup
  if (lookup[lowerValue]) {
    return { matched: lookup[lowerValue], raw: trimmed };
  }
  
  // Check if it's already a full feeder name
  for (const feeder of allFeeders) {
    if (feeder.toLowerCase() === lowerValue) {
      return { matched: feeder, raw: trimmed };
    }
  }
  
  // Smart match: check if the short code exists within any full feeder name
  // E.g., "L36" should match "132KV KUKWABA TS_33KV FDR L36_PL_PL"
  for (const feeder of allFeeders) {
    // Check if feeder name contains the code as a distinct segment
    const segments = feeder.split(/[\s_-]+/);
    for (const segment of segments) {
      if (segment.toLowerCase() === lowerValue) {
        return { matched: feeder, raw: trimmed };
      }
    }
  }
  
  // Partial match - check if code is contained in feeder name
  for (const feeder of allFeeders) {
    if (feeder.toLowerCase().includes(lowerValue)) {
      return { matched: feeder, raw: trimmed };
    }
  }
  
  // No match found, return original value as both
  return { matched: trimmed, raw: trimmed };
}

// Get all unique feeder names from lookup
export function getAllFeederNames(lookup: FeederLookup): string[] {
  const feeders = new Set<string>();
  Object.values(lookup).forEach(name => {
    if (name) feeders.add(name);
  });
  return Array.from(feeders).sort();
}

// Parse asset file to AssetRow array
export async function parseAssetFile(file: File): Promise<AssetRow[]> {
  const data = await parseExcelFile(file);
  return data.map((row) => {
    const assetRow: AssetRow = {};
    Object.entries(row).forEach(([key, value]) => {
      // Keep original key for flexibility
      assetRow[key] = value;
      // Also add normalized key
      const normalizedKey = key.toLowerCase().trim().replace(/\s+/g, '_');
      assetRow[normalizedKey] = value;
    });
    return assetRow;
  });
}

// Get feeder name from row - combines 11kv and 33kv feeder columns
export function getFeederFromRow(row: AssetRow, lookup: FeederLookup, allFeeders: string[]): { matched: string; raw: string } {
  // Priority order for feeder columns - check for actual feeder name columns
  const feederColumns = [
    'feeder', 'Feeder', 'FEEDER',
    '_11kv_feeder', '_33kv_feeder',
    '11kv_feeder', '33kv_feeder',
    '_11kv_Feeder', '_33kv_Feeder',
    '11kv_Feeder', '33kv_Feeder'
  ];
  
  for (const col of feederColumns) {
    const value = row[col];
    if (value && String(value).trim()) {
      const feederValue = String(value).trim();
      return smartMatchFeeder(feederValue, lookup, allFeeders);
    }
  }
  
  // Check all keys for any containing 'feeder'
  for (const key of Object.keys(row)) {
    if (key.toLowerCase().includes('feeder')) {
      const value = row[key];
      if (value && String(value).trim()) {
        const feederValue = String(value).trim();
        return smartMatchFeeder(feederValue, lookup, allFeeders);
      }
    }
  }
  
  return { matched: '', raw: '' };
}

// Get time/date value from row
export function getTimeFromRow(row: AssetRow): Date | null {
  const timeColumns = ['time', 'Time', 'TIME', 'date', 'Date', 'DATE', 'timestamp', 'Timestamp'];
  
  for (const col of timeColumns) {
    const value = row[col];
    if (value) {
      if (value instanceof Date) {
        return value;
      }
      const parsed = new Date(String(value));
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }
  
  // Check all keys for time/date columns
  for (const key of Object.keys(row)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('time') || lowerKey.includes('date')) {
      const value = row[key];
      if (value) {
        if (value instanceof Date) {
          return value;
        }
        const parsed = new Date(String(value));
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }
  }
  
  return null;
}

// Check if date is within range
export function isDateInRange(date: Date | null, startDate: Date, endDate: Date): boolean {
  if (!date) return false;
  
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const startOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  
  return dateOnly >= startOnly && dateOnly <= endOnly;
}

// Export report to Excel
export function exportReportToExcel(data: FeederReportRow[], filename: string, dateRange: { start: string; end: string }): void {
  const ws = XLSX.utils.json_to_sheet(data.map(row => ({
    'Feeder Name': row.feederName,
    'Mapped DT (Week)': row.mappedDTWeek,
    'Mapped DT (Total)': row.mappedDTTotal,
    'HT Poles (Week)': row.htPolesWeek,
    'HT Poles (Total)': row.htPolesTotal,
    'LT Poles (Week)': row.ltPolesWeek,
    'LT Poles (Total)': row.ltPolesTotal,
    'Consumer Points (Week)': row.consumerPointsWeek,
    'Consumer Points (Total)': row.consumerPointsTotal,
    'Issue Log (Week)': row.issueLogWeek,
    'Issue Log (Total)': row.issueLogTotal,
  })));
  
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Report ${dateRange.start} to ${dateRange.end}`);
  XLSX.writeFile(wb, filename);
}

// Save report to localStorage
export function saveReportToStorage(report: SavedReport, key: string = 'savedReport'): void {
  localStorage.setItem(key, JSON.stringify(report));
}

// Load report from localStorage
export function loadReportFromStorage(key: string = 'savedReport'): SavedReport | null {
  const data = localStorage.getItem(key);
  if (!data) return null;
  try {
    return JSON.parse(data) as SavedReport;
  } catch {
    return null;
  }
}

// Get format date for display
export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
}

// Get week label from date range
export function getWeekLabel(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
