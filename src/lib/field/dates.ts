/**
 * Reads the capture time from an uploaded file into an ISO string.
 *
 * Why this exists: `new Date("12/10/2026")` reads month-first, so 12 October became 10 December
 * (a date in the future). This app's exports are day-first, so slash/dash/dot dates are read
 * day-first, like the Dashboard does. The wall-clock digits are kept as written (no timezone shift),
 * so a capture at 00:05 stays on its own day.
 */
export function parseCaptureTime(v: string | null | undefined, now: Date = new Date()): string | null {
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
