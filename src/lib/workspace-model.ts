export type FieldAsset = { id: string; feeder: string; transformer: string; staff: string; status: string };
export type Projection = { id: string; feeder: string; points: number; captured: number; staff: number; target: number };
export type WeeklyRow = { id: string; feeder: string; previous: number; current: number; target: number };
export type Device = { id: string; name: string; serial: string; holder: string; status: "Available" | "Collected"; collected: string; returned: string };

export function completion(points: number, captured: number, staff: number, target: number) {
  const remaining = Math.max(0, points - captured);
  const capacity = staff * target;
  return { remaining, days: remaining === 0 ? 0 : capacity > 0 ? Math.ceil(remaining / capacity) : null };
}

export function finishDate(start: string, days: number | null) {
  if (!start || days === null) return "—";
  const date = new Date(`${start}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "—";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function collectDevice(device: Device, holder: string, date: string): Device {
  if (device.status !== "Available" || !holder.trim()) return device;
  return { ...device, holder: holder.trim(), status: "Collected", collected: date, returned: "" };
}

export function returnDevice(device: Device, date: string): Device {
  if (device.status !== "Collected") return device;
  return { ...device, status: "Available", holder: "", returned: date };
}

export function exportCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map(row => row.map(value => {
    const text = String(value);
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}