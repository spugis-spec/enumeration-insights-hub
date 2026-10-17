// Pure helpers (no Firebase imports) so they can be tested without any credentials.

/** Firestore collections copied from the old DT Field Manager project (same names in spugis). */
export const FIELD_COLLECTIONS = [
  "meta", "users", "feeders", "dts", "enumerators", "allocations", "submissions",
  "vehicles", "trips", "capture_issues", "snapshots", "snapshot_chunks", "uploads",
];

/** Mobile Devices portal collections (same names in spugis). */
export const DEVICE_COLLECTIONS = ["portal", "records"];

/** Old Feeder Dashboard collection -> new name in spugis. Its own `users` (SHA-256 hashes) is NOT copied. */
export const WEEKLY_COLLECTIONS = {
  feederLookup: "weekly_feederLookup",
  currentReport: "weekly_currentReport",
  previousReport: "weekly_previousReport",
  savedWeeks: "weekly_savedWeeks",
};

/** Fields that store a Firebase Auth uid, per collection. */
export const UID_FIELDS = {
  allocations: ["allocated_by"],
  dts: ["updated_by"],
  meta: ["adminUid"],
};

/**
 * Re-key a Field Manager document after its Auth users were moved.
 * - users/{oldUid} becomes users/{newUid}
 * - uid-valued fields (allocated_by, updated_by, meta.adminUid) follow the same mapping
 * Anything not in uidMap is left exactly as it was.
 */
export function remapDoc(collection, id, data, uidMap) {
  const newId = collection === "users" && uidMap.has(id) ? uidMap.get(id) : id;
  const out = { ...data };
  for (const f of UID_FIELDS[collection] ?? []) {
    if (typeof out[f] === "string" && uidMap.has(out[f])) out[f] = uidMap.get(out[f]);
  }
  return { id: newId, data: out };
}

/** Build Firebase importUsers() hash options from the settings shown in Console > Authentication > Users > Password hash parameters. */
export function hashOptions(h) {
  if (!h) return null;
  const b = (s) => Buffer.from(String(s), "base64");
  return {
    hash: {
      algorithm: h.algorithm ?? "SCRYPT",
      key: b(h.key),
      saltSeparator: b(h.saltSeparator ?? ""),
      rounds: Number(h.rounds ?? 8),
      memoryCost: Number(h.memoryCost ?? 14),
    },
  };
}

/** Turn an Auth UserRecord into an importUsers() record. Password hash is kept only when hash options exist. */
export function toImportRecord(u, keepPassword) {
  const rec = {
    uid: u.uid,
    email: u.email,
    emailVerified: u.emailVerified,
    displayName: u.displayName,
    phoneNumber: u.phoneNumber,
    disabled: u.disabled,
  };
  if (keepPassword && u.passwordHash) {
    rec.passwordHash = Buffer.from(u.passwordHash, "base64");
    if (u.passwordSalt) rec.passwordSalt = Buffer.from(u.passwordSalt, "base64");
  }
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return rec;
}
