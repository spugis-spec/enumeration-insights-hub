import { get, ref } from "firebase/database";
import { getDb } from "./firebase";

// Where the Dashboard keeps this data in the Realtime Database:
//   mappings/{aedc|bss|nysc}/{username} = full name
//   enumeratorPhones/{username in lowercase} = phone
//   pairings/teams[] = { name, members: [{ group, username }] }   (older saves: aedcNysc / bssNysc)
//   supervisionList = [usernames on the supervision list]
const GROUPS = ["aedc", "bss", "nysc"] as const;

type Raw = Record<string, unknown> | null;
type Member = { group: string; username: string };
type Team = { name: string; members: Member[] };

const toArr = (x: unknown): any[] =>
  Array.isArray(x) ? x.filter(Boolean) : x && typeof x === "object" ? Object.values(x as object).filter(Boolean) : [];

function readTeams(raw: Raw): Team[] {
  if (!raw) return [];
  const clean = (ms: unknown): Member[] =>
    toArr(ms)
      .filter((m) => m?.username && (GROUPS as readonly string[]).includes(m.group))
      .map((m) => ({ group: String(m.group), username: String(m.username) }));
  const teams = toArr(raw["teams"]);
  if (teams.length) return teams.map((t, i) => ({ name: String(t.name || `Team ${i + 1}`), members: clean(t.members) }));
  const out: Team[] = [];
  ([["aedcNysc", "aedc", "A"], ["bssNysc", "bss", "B"]] as const).forEach(([key, grp, pre]) => {
    toArr(raw[key]).forEach((p, i) => {
      const members: Member[] = [];
      if (p.staffUsername) members.push({ group: grp, username: String(p.staffUsername) });
      if (p.nyscUsername) members.push({ group: "nysc", username: String(p.nyscUsername) });
      out.push({ name: `Team ${pre}${i + 1}`, members });
    });
  });
  return out;
}

export type EnumeratorExport = {
  enumerators: (string | number)[][];
  enumeratorHeader: string[];
  teams: (string | number)[][];
  teamHeader: string[];
  counts: { enumerators: number; teams: number; withPhone: number };
};

export async function loadEnumeratorExport(): Promise<EnumeratorExport> {
  const db = getDb();
  const [m, p, t, s] = await Promise.all(
    ["mappings", "enumeratorPhones", "pairings", "supervisionList"].map((path) => get(ref(db, path)).then((x) => x.val())),
  );
  return buildEnumeratorExport(m, p, t, s);
}

/** Pure: turns the four raw cloud nodes into export rows (kept separate so it can be tested). */
export function buildEnumeratorExport(m: unknown, p: unknown, t: unknown, s: unknown): EnumeratorExport {
  const mappings = (m ?? {}) as Record<string, Record<string, string> | undefined>;
  const phones = (p ?? {}) as Record<string, string>;
  const teams = readTeams(t as Raw);
  const supervised = new Set(toArr(s).map((u) => String(u).toLowerCase()));

  const key = (g: string, u: string) => `${g}::${u.toLowerCase()}`;
  const names = new Map<string, string>();
  const display = new Map<string, { group: string; username: string }>();
  for (const g of GROUPS) {
    for (const [u, n] of Object.entries(mappings[g] ?? {})) {
      names.set(key(g, u), String(n ?? ""));
      display.set(key(g, u), { group: g, username: u });
    }
  }
  // Anyone in a team who is missing from the mappings still gets a row.
  for (const tm of teams) for (const mem of tm.members) if (!display.has(key(mem.group, mem.username))) display.set(key(mem.group, mem.username), mem);

  const teamOf = new Map<string, Team>();
  for (const tm of teams) for (const mem of tm.members) teamOf.set(key(mem.group, mem.username), tm);

  const phoneOf = (u: string) => String(phones[u.toLowerCase()] ?? phones[u] ?? "");
  const nameOf = (g: string, u: string) => names.get(key(g, u)) ?? "";

  const rows = [...display.entries()]
    .map(([k, d]) => {
      const tm = teamOf.get(k);
      const mates = (tm?.members ?? [])
        .filter((x) => key(x.group, x.username) !== k)
        .map((x) => `${nameOf(x.group, x.username) || x.username} (${x.group.toUpperCase()}: ${x.username})`)
        .join("; ");
      return [
        d.group.toUpperCase(), d.username, nameOf(d.group, d.username), phoneOf(d.username),
        tm?.name ?? "", mates, supervised.has(d.username.toLowerCase()) ? "Yes" : "No",
      ];
    })
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2] || a[1]).localeCompare(String(b[2] || b[1])));

  const teamHeader = ["Team"];
  for (let i = 1; i <= 3; i++) teamHeader.push(`Member ${i} group`, `Member ${i} username`, `Member ${i} name`, `Member ${i} phone`);
  const teamRows = teams.map((tm) => {
    const r: (string | number)[] = [tm.name];
    for (let i = 0; i < 3; i++) {
      const x = tm.members[i];
      r.push(x ? x.group.toUpperCase() : "", x?.username ?? "", x ? nameOf(x.group, x.username) : "", x ? phoneOf(x.username) : "");
    }
    return r;
  });

  return {
    enumeratorHeader: ["Group", "Username", "Full name", "Phone", "Team", "Paired with", "On supervision list"],
    enumerators: rows,
    teamHeader,
    teams: teamRows,
    counts: { enumerators: rows.length, teams: teams.length, withPhone: rows.filter((r) => r[3]).length },
  };
}

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export async function downloadEnumerators(format: "xlsx" | "csv") {
  const data = await loadEnumeratorExport();
  const XLSX = await import("xlsx");
  const main = XLSX.utils.aoa_to_sheet([data.enumeratorHeader, ...data.enumerators]);
  main["!cols"] = [{ wch: 8 }, { wch: 24 }, { wch: 32 }, { wch: 16 }, { wch: 20 }, { wch: 60 }, { wch: 12 }];
  if (format === "csv") {
    // BOM so Excel opens names with accents correctly
    save(new Blob(["\ufeff" + XLSX.utils.sheet_to_csv(main)], { type: "text/csv;charset=utf-8" }), `enumerators-${stamp()}.csv`);
  } else {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, main, "Enumerators");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([data.teamHeader, ...data.teams]), "Teams");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    save(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `enumerators-${stamp()}.xlsx`);
  }
  return data.counts;
}
