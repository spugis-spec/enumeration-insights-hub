/// <reference lib="webworker" />
import * as XLSX from "xlsx";

// Parses uploaded spreadsheets off the main thread so the page never freezes.
self.onmessage = (e: MessageEvent<{ id: string; buffer: ArrayBuffer }>) => {
  try {
    const wb = XLSX.read(e.data.buffer, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error("The workbook has no worksheets");
    const ws = wb.Sheets[sheetName];
    if (!ws) throw new Error("The first worksheet could not be read");
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    self.postMessage({ id: e.data.id, rows });
  } catch (err) {
    self.postMessage({ id: e.data.id, error: String(err) });
  }
};
