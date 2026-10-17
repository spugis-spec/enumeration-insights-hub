import assert from "node:assert/strict";
import { remapDoc, toImportRecord, hashOptions } from "./lib.mjs";

const map = new Map([["oldA", "newA"]]);

// users doc follows the uid map
assert.deepEqual(remapDoc("users", "oldA", { role: "admin" }, map), { id: "newA", data: { role: "admin" } });
// unknown uid is untouched
assert.equal(remapDoc("users", "zzz", { role: "supervisor" }, map).id, "zzz");
// uid fields are rewritten, other fields kept
assert.deepEqual(remapDoc("allocations", "x1", { allocated_by: "oldA", dt_id: "5" }, map).data, { allocated_by: "newA", dt_id: "5" });
assert.equal(remapDoc("dts", "d1", { updated_by: "oldA" }, map).data.updated_by, "newA");
assert.equal(remapDoc("meta", "setup", { adminUid: "oldA" }, map).data.adminUid, "newA");
// null allocated_by (older rows) stays null
assert.equal(remapDoc("allocations", "x2", { allocated_by: null }, map).data.allocated_by, null);
// other collections ignore uid mapping
assert.equal(remapDoc("feeders", "oldA", { a: 1 }, map).id, "oldA");

// import record: password kept only when asked
const u = { uid: "u1", email: "a@b.c", emailVerified: true, passwordHash: "aGFzaA", passwordSalt: "c2FsdA", disabled: false };
assert.equal(toImportRecord(u, false).passwordHash, undefined);
assert.equal(toImportRecord(u, true).passwordHash.toString(), "hash");
assert.equal(toImportRecord(u, true).passwordSalt.toString(), "salt");
assert.equal("displayName" in toImportRecord(u, true), false);

// hash options
assert.equal(hashOptions(null), null);
const h = hashOptions({ key: "a2V5", saltSeparator: "c2VwDQ==", rounds: 8, memoryCost: 14 });
assert.equal(h.hash.algorithm, "SCRYPT");
assert.equal(h.hash.key.toString(), "key");

console.log("migration helpers: all checks passed");
