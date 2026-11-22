/**
 * Reads the capture time from an uploaded file into an ISO string.
 *
 * Why this exists: `new Date("12/10/2026")` reads month-first, so 12 October became 10 December
 * (a date in the future). This app's exports are day-first, so slash/dash/dot dates are read
 * day-first, like the Dashboard does. The wall-clock digits are kept as written (no timezone shift),
 * so a capture at 00:05 stays on its own day.
 */
/** How slash/dash/dot dates such as 11/04/2026 are read: day first, month first, or guessed (auto). */
export type DateOrder = "auto" | "dmy" | "mdy";
let sessionOrder: DateOrder = "auto";
/** Set once per upload (the Data Uploads tab asks when a file's dates can be read two ways). */
export const setDateOrder = (o: DateOrder) => { sessionOrder = o; };
export const getDateOrder = (): DateOrder => sessionOrder;

export function parseCaptureTime(v: string | null | undefined, now: Date = new Date(), order: DateOrder = sessionOrder): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;

  // Already ISO (Excel date cells arrive like this)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) || d.getTime() > now.getTime() + 86400000 ? null : d.toISOString();
  }

  // Excel serial number, e.g. 46307 or 46307.5
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
      return d.getTime() > now.getTime() + 86400000 ? null : d.toISOString();
    }
  }

  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    let hh = m[4] ? Number(m[4]) : 0;
    const mi = m[5] ? Number(m[5]) : 0;
    const ss = m[6] ? Number(m[6]) : 0;
    const ap = m[7]?.toUpperCase();
    if (ap === "PM" && hh < 12) hh += 12;
    if (ap === "AM" && hh === 12) hh = 0;

    const build = (day: number, month: number): Date | null => {
      if (month < 1 || month > 12 || day < 1 || day > 31 || hh > 23 || mi > 59 || ss > 59) return null;
      const d = new Date(Date.UTC(year, month - 1, day, hh, mi, ss));
      return d.getUTCMonth() === month - 1 ? d : null; // rejects 31/02 etc.
    };

    const limit = now.getTime() + 86400000; // a day of slack for clocks and time zones
    let d: Date | null;
    if (a > 12) d = build(a, b); // can only be the day
    else if (b > 12) d = build(b, a); // month-first file
    else if (order === "mdy") d = build(b, a); // the user chose month first
    else if (order === "dmy") d = build(a, b); // the user chose day first
    else {
      d = build(a, b); // ambiguous: day-first
      if (d && d.getTime() > limit) {
        const swapped = build(b, a);
        if (swapped && swapped.getTime() <= limit) d = swapped;
      }
    }
    if (!d || d.getTime() > limit) return null;
    return d.toISOString();
  }

  const d = new Date(s);
  if (isNaN(d.getTime()) || d.getTime() > now.getTime() + 86400000) return null;
  return d.toISOString();
}

export type DateOrderInfo = {
  /** Slash dates read. */ total: number;
  /** Dates that fit both orders (both parts 12 or less, and different). */ ambiguous: number;
  /** Dates that can only be day first (first part above 12). */ definiteDmy: number;
  /** Dates that can only be month first (second part above 12). */ definiteMdy: number;
  /** One real example as written in the file. */ sample: string | null;
  dmy: { min: string | null; max: string | null; future: number };
  mdy: { min: string | null; max: string | null; future: number };
  /** The order the file itself proves (for example a 25/11 row), or null. */ evidence: DateOrder | null;
  /** True when the dates can be read two ways and the file does not prove which. */ needsChoice: boolean;
};

/** Looks at the date cells of an upload and tells whether they can be read two ways (11/04/2026 = 11 April or 4 November). */
export function detectDateOrder(values: (string | null | undefined)[], now: Date = new Date()): DateOrderInfo {
  const info: DateOrderInfo = {
    total: 0, ambiguous: 0, definiteDmy: 0, definiteMdy: 0, sample: null,
    dmy: { min: null, max: null, future: 0 }, mdy: { min: null, max: null, future: 0 }, evidence: null, needsChoice: false,
  };
  const limit = now.getTime() + 86400000;
  const rx = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})(?!\d)(?:[ T,]+(\d{1,2}):(\d{2}))?/;
  const build = (day: number, month: number, year: number): Date | null => {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day));
    return d.getUTCMonth() === month - 1 ? d : null;
  };
  const note = (side: DateOrderInfo["dmy"], d: Date | null) => {
    if (!d) return;
    if (d.getTime() > limit) { side.future++; return; }
    const day = d.toISOString().slice(0, 10);
    if (!side.min || day < side.min) side.min = day;
    if (!side.max || day > side.max) side.max = day;
  };
  for (const v of values) {
    const m = v == null ? null : String(v).trim().match(rx);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    info.total++;
    if (a > 12 && b <= 12) info.definiteDmy++;
    else if (b > 12 && a <= 12) info.definiteMdy++;
    else if (a <= 12 && b <= 12 && a !== b) {
      info.ambiguous++;
      if (!info.sample) info.sample = String(v).trim();
      note(info.dmy, build(a, b, year));
      note(info.mdy, build(b, a, year));
    }
  }
  if (info.definiteDmy > 0 && info.definiteMdy === 0) info.evidence = "dmy";
  else if (info.definiteMdy > 0 && info.definiteDmy === 0) info.evidence = "mdy";
  info.needsChoice = info.ambiguous > 0 && !info.evidence;
  return info;
}
