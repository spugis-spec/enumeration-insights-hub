import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { readTeams } from "../enumeratorExport";
import type { Enumerator } from "./data";
import { fetchPairingsRaw, type PairingsRaw } from "./pairingsApi";

/** A team from the Dashboard's Team Pairing Configuration, with each member matched to the Field Manager staff list. */
export type PairMember = { group: string; username: string; name: string; enumeratorId: string | null };
export type PairTeam = { key: string; name: string; members: PairMember[] };

export type { PairingsRaw };

const norm = (s: string) => s.trim().toLowerCase();

/** Pure: joins pairing teams with names and with Field Manager enumerators (matched by username). */
export function buildPairTeams(raw: PairingsRaw | null | undefined, enumerators: Enumerator[]): PairTeam[] {
  if (!raw) return [];
  const mappings = (raw.mappings ?? {}) as Record<string, Record<string, string> | undefined>;
  const byUser = new Map(enumerators.map((e) => [norm(e.username), e]));
  const teams = readTeams((raw.pairings ?? null) as Record<string, unknown> | null);
  return teams
    .map((t, i) => ({
      key: `${i}:${t.name}`,
      name: t.name,
      members: t.members.map((m) => {
        const en = byUser.get(norm(m.username));
        const dashName = mappings[m.group]?.[m.username] ?? "";
        return { group: m.group, username: m.username, name: en?.full_name || dashName || m.username, enumeratorId: en?.id ?? null };
      }),
    }))
    .filter((t) => t.members.length > 0);
}

/** True when the search text matches the team name or ANY member's name or username, so the whole team shows. */
export function teamMatches(t: PairTeam, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return t.name.toLowerCase().includes(s) || t.members.some((m) => `${m.name} ${m.username}`.toLowerCase().includes(s));
}

export function usePairTeams(enumerators: Enumerator[]) {
  const q = useQuery({ queryKey: ["dashboard-pairings"], queryFn: fetchPairingsRaw, staleTime: 5 * 60 * 1000, retry: 1 });
  const teams = useMemo(() => buildPairTeams(q.data, enumerators), [q.data, enumerators]);
  return { teams, loading: q.isLoading, failed: q.isError, refetch: q.refetch };
}
