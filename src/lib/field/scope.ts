import { useSyncExternalStore } from "react";

/**
 * Which feeders (and dates) the person is working on right now. Every upload check and the DT work log use it, so rows
 * for any other feeder are ignored. `feeders: null` means every feeder in the uploaded lookup.
 */
export type Scope = { feeders: string[] | null; from: string; to: string };

const KEY = "fm.scope.v1";
const EMPTY: Scope = { feeders: null, from: "", to: "" };
let cur: Scope = (() => {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (j && typeof j === "object") return { feeders: Array.isArray(j.feeders) ? j.feeders : null, from: j.from ?? "", to: j.to ?? "" };
  } catch { /* storage unavailable */ }
  return EMPTY;
})();
const listeners = new Set<() => void>();

export const getScope = () => cur;
export function setScope(patch: Partial<Scope>) {
  cur = { ...cur, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
export function useScope(): Scope {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getScope, getScope);
}

/** The feeder IDs in force: the chosen ones that are really in the lookup, or all lookup feeders when none were chosen. */
export function scopeFeederIds(scope: Scope, lookupFeederIds: string[]): Set<string> {
  const all = new Set(lookupFeederIds);
  if (!scope.feeders) return all;
  return new Set(scope.feeders.filter((f) => all.has(f)));
}
export const inDateRange = (day: string | null | undefined, scope: Pick<Scope, "from" | "to">) =>
  !day || ((!scope.from || day >= scope.from) && (!scope.to || day <= scope.to));
