import { useEffect, useState } from "react";

/**
 * Settings shared between the legacy dashboard (iframe, same origin) and the React pages.
 * Stored in localStorage; changes broadcast via the "storage" event (other frames/tabs)
 * and a custom "eih:setting" event (same window).
 */
export const SHARED_KEYS = {
  dailyTarget: "eih.dailyTarget",
  projectionBuffer: "eih.projectionBuffer",
  currentDashboardDate: "eih.currentDashboardDate",
} as const;

export const DEFAULT_DAILY_TARGET = 30;

export function readNumber(key: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  const v = Number(window.localStorage.getItem(key));
  return Number.isFinite(v) && window.localStorage.getItem(key) !== null ? v : fallback;
}

export function writeSetting(key: string, value: string | number) {
  window.localStorage.setItem(key, String(value));
  window.dispatchEvent(new CustomEvent("eih:setting", { detail: { key } }));
}

export function useSharedNumber(key: string, fallback: number): [number, (v: number) => void] {
  const [v, setV] = useState(fallback);
  useEffect(() => {
    const sync = () => setV(readNumber(key, fallback));
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("eih:setting", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("eih:setting", sync);
    };
  }, [key, fallback]);
  return [v, (n: number) => writeSetting(key, n)];
}

export function useDailyTarget() {
  return useSharedNumber(SHARED_KEYS.dailyTarget, DEFAULT_DAILY_TARGET);
}
