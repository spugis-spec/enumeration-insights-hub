import { get, onValue, ref } from "firebase/database";
import { doc, getDoc } from "firebase/firestore";
import { getDb, getFirebaseAuth, getFs } from "./firebase";

export type StepStatus = "ok" | "slow" | "fail";
export type Step = { id: string; label: string; status: StepStatus; ms: number | null; detail: string };

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`No answer after ${Math.round(ms / 1000)} seconds`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });

const errText = (e: unknown) => {
  const x = e as { code?: string; message?: string };
  return [x?.code, x?.message].filter(Boolean).join(": ") || String(e);
};

async function timed(id: string, label: string, slowAfterMs: number, run: () => Promise<string>, timeoutMs = 12000): Promise<Step> {
  const t0 = performance.now();
  try {
    const detail = await withTimeout(run(), timeoutMs);
    const ms = Math.round(performance.now() - t0);
    return { id, label, status: ms > slowAfterMs ? "slow" : "ok", ms, detail };
  } catch (e) {
    return { id, label, status: "fail", ms: Math.round(performance.now() - t0), detail: errText(e) };
  }
}

export function networkStep(): Step {
  const c = (navigator as unknown as { connection?: { effectiveType?: string; rtt?: number; downlink?: number } }).connection;
  if (!navigator.onLine) return { id: "net", label: "Your internet", status: "fail", ms: null, detail: "The browser reports you are offline." };
  const bits = [c?.effectiveType && `type ${c.effectiveType}`, c?.rtt != null && `~${c.rtt} ms round trip`, c?.downlink != null && `~${c.downlink} Mbps`].filter(Boolean);
  const weak = c?.effectiveType === "slow-2g" || c?.effectiveType === "2g" || c?.effectiveType === "3g";
  return {
    id: "net", label: "Your internet", status: weak ? "slow" : "ok", ms: null,
    detail: bits.length ? `Online (${bits.join(", ")}; browser estimate)` : "Online (this browser gives no speed estimate)",
  };
}

/** Quick checks: each one answers "can this device reach that part of Firebase, and how fast?" */
export async function* runConnectionCheck(): AsyncGenerator<Step> {
  yield networkStep();

  yield await timed("auth", "Sign-in session", 3000, async () => {
    const a = getFirebaseAuth();
    await a.authStateReady();
    return a.currentUser?.email ? `Signed in as ${a.currentUser.email}` : "Not signed in (public data still loads)";
  });

  yield await timed("rtdb-connect", "Realtime Database connection (Dashboard, GIS Map)", 3000, () =>
    new Promise<string>((res) => {
      const off = onValue(ref(getDb(), ".info/connected"), (s) => {
        if (s.val() === true) { off(); res("Connected"); }
      });
    }),
  );

  yield await timed("rtdb-read", "Realtime Database small read", 1500, async () => {
    const s = await get(ref(getDb(), "lastFid"));
    return s.exists() ? "Read OK" : "Read OK (empty)";
  });

  yield await timed("firestore", "Firestore (Field Manager, Weekly Report)", 2500, async () => {
    try {
      await getDoc(doc(getFs(), "meta", "setup"));
    } catch (e) {
      // "permission-denied" still proves the server answered.
      if ((e as { code?: string })?.code === "permission-denied") return "Reached (rules refused this test read, which is fine)";
      throw e;
    }
    return "Reached";
  });
}

/** Downloads the Dashboard's data once and reports size and speed. */
export async function runDownloadTest(): Promise<Step> {
  const t0 = performance.now();
  try {
    const snap = await withTimeout(get(ref(getDb(), "dashboardData")), 60000);
    const ms = Math.round(performance.now() - t0);
    const bytes = snap.exists() ? JSON.stringify(snap.val()).length : 0;
    const kb = Math.round(bytes / 1024);
    const speed = ms > 0 ? Math.round(bytes / 1024 / (ms / 1000)) : 0;
    return {
      id: "download", label: "Dashboard data download", status: ms > 8000 ? "slow" : "ok", ms,
      detail: bytes ? `${kb.toLocaleString()} KB in ${(ms / 1000).toFixed(1)} s (about ${speed.toLocaleString()} KB/s)` : "No dashboard data saved yet",
    };
  } catch (e) {
    return { id: "download", label: "Dashboard data download", status: "fail", ms: Math.round(performance.now() - t0), detail: errText(e) };
  }
}

export function verdict(steps: Step[]): string {
  const by = Object.fromEntries(steps.map((s) => [s.id, s]));
  if (by["net"]?.status === "fail") return "This device is offline. Check Wi-Fi or mobile data, then run the check again.";
  if (by["rtdb-connect"]?.status === "fail")
    return "The browser could not open a connection to the Realtime Database. Usual causes: very weak or filtered network (some Wi-Fi, VPNs and proxies block it), or a Firebase outage. Try mobile data or another network.";
  if (by["rtdb-read"]?.status === "fail") return "Connected, but reading failed. The message above says why (for example a rules refusal).";
  if (by["firestore"]?.status === "fail") return "The Realtime Database works but Firestore (Field Manager, Weekly Report) could not be reached. Check the message above.";
  const slow = steps.filter((s) => s.status === "slow");
  if (slow.length)
    return "Everything is reachable, but some steps are slow right now. That points to the network (latency or weak signal) rather than a fault in the app. The database is hosted in the US, so each request costs a long round trip from Nigeria, and pages that make several requests add up.";
  return "Everything is reachable and fast right now. If the Dashboard was slow earlier, it was probably a temporary network dip or a large data download (use the download test).";
}
