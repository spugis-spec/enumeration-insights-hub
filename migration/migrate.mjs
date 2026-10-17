#!/usr/bin/env node
// Copies data from the old standalone Firebase projects into the single `spugis` project.
//
//   node migrate.mjs --dry-run          show what would be copied, write nothing
//   node migrate.mjs                    copy (documents that already exist in spugis are skipped)
//   node migrate.mjs --overwrite        copy and replace documents that already exist
//   node migrate.mjs --config other.json
//
// Read README.md in this folder first: it explains how to get the service-account keys.

import { readFileSync, existsSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  FIELD_COLLECTIONS, DEVICE_COLLECTIONS, WEEKLY_COLLECTIONS,
  remapDoc, hashOptions, toImportRecord,
} from "./lib.mjs";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DRY = flag("--dry-run");
const OVERWRITE = flag("--overwrite");
const configPath = opt("--config", "./config.json");

if (!existsSync(configPath)) {
  console.error(`Missing ${configPath}. Copy config.example.json to config.json and fill it in.`);
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(configPath, "utf8"));
if (!cfg.target?.serviceAccount) { console.error("config.target.serviceAccount is required (the spugis key)."); process.exit(1); }

const appFor = (name, section) =>
  initializeApp({ credential: cert(JSON.parse(readFileSync(section.serviceAccount, "utf8"))) }, name);

const targetApp = appFor("target", cfg.target);
const tgtDb = getFirestore(targetApp);
const tgtAuth = getAuth(targetApp);

const summary = [];
const note = (area, what, n, extra = "") => { summary.push({ area, what, n, extra }); console.log(`  ${what}: ${n}${extra ? "  " + extra : ""}`); };

console.log(DRY ? "DRY RUN: nothing will be written.\n" : "Writing to the spugis project.\n");

/* ---------- generic Firestore copy ---------- */
async function copyCollection(srcDb, srcName, tgtName, transform) {
  let read = 0, written = 0, skipped = 0, failed = 0;
  const writer = DRY ? null : tgtDb.bulkWriter();
  if (writer) writer.onWriteError((e) => { failed++; console.error(`    write failed (${e.documentRef.path}): ${e.message}`); return false; });
  for await (const snap of srcDb.collection(srcName).stream()) {
    read++;
    const { id, data } = transform ? transform(snap.id, snap.data()) : { id: snap.id, data: snap.data() };
    if (DRY) continue;
    const ref = tgtDb.collection(tgtName).doc(id);
    if (OVERWRITE) { writer.set(ref, data); written++; continue; }
    // create() fails with ALREADY_EXISTS when the document is there: that is a skip, not an error.
    writer.create(ref, data).then(() => { written++; }, (e) => { if (e?.code === 6 || /ALREADY_EXISTS/.test(String(e?.message))) skipped++; });
  }
  if (writer) await writer.close();
  return { read, written, skipped, failed };
}

async function runCopies(area, srcDb, pairs, transformFor) {
  for (const [src, tgt] of pairs) {
    const r = await copyCollection(srcDb, src, tgt, transformFor?.(src));
    note(area, `${src} -> ${tgt}`, r.read, DRY ? "(would copy)" : `copied ${r.written}, skipped ${r.skipped} already there${r.failed ? `, FAILED ${r.failed}` : ""}`);
  }
}

/* ---------- Auth users (Field Manager logins) ---------- */
async function listAllUsers(auth) {
  const out = []; let token;
  do { const r = await auth.listUsers(1000, token); out.push(...r.users); token = r.pageToken; } while (token);
  return out;
}
const exists = async (fn) => { try { await fn(); return true; } catch (e) { if (String(e?.code).includes("user-not-found")) return false; throw e; } };

async function moveUsers(srcAuth, hash, filter) {
  const uidMap = new Map();
  const users = (await listAllUsers(srcAuth)).filter((u) => u.email && (!filter || filter(u)));
  const toImport = [];
  let merged = 0;
  for (const u of users) {
    let existing = null;
    try { existing = await tgtAuth.getUserByEmail(u.email); } catch (e) { if (!String(e?.code).includes("user-not-found")) throw e; }
    if (existing) { uidMap.set(u.uid, existing.uid); merged++; continue; }
    if (await exists(() => tgtAuth.getUser(u.uid))) { console.error(`    uid clash for ${u.email}: skipped, add this person by hand.`); continue; }
    uidMap.set(u.uid, u.uid);
    toImport.push(u);
  }
  const opts = hashOptions(hash);
  note("auth", "logins found", users.length, `already in spugis (matched by email): ${merged}, to import: ${toImport.length}`);
  if (!DRY && toImport.length) {
    for (let i = 0; i < toImport.length; i += 1000) {
      const chunk = toImport.slice(i, i + 1000).map((u) => toImportRecord(u, !!opts));
      const res = await tgtAuth.importUsers(chunk, opts ?? undefined);
      if (res.failureCount) for (const e of res.errors) console.error(`    import failed for ${chunk[e.index]?.email}: ${e.error.message}`);
    }
    note("auth", "logins imported", toImport.length, opts ? "passwords kept" : "NO passwords: each person must use 'Forgot password' / be sent a reset");
  }
  return { uidMap, imported: toImport };
}

/* ---------- 1. Field Manager ---------- */
if (cfg.field) {
  console.log("Field Manager (dt-field-manager)");
  const fApp = appFor("field", cfg.field);
  const { uidMap } = await moveUsers(getAuth(fApp), cfg.field.hash, null);
  // users/{uid}, allocations.allocated_by, dts.updated_by and meta.adminUid follow the new uids
  // (they only change when a login was matched to an account that already exists in spugis).
  await runCopies("field", getFirestore(fApp), FIELD_COLLECTIONS.map((c) => [c, c]), (col) => (id, data) => remapDoc(col, id, data, uidMap));
  console.log("");
}

/* ---------- 2. Mobile Devices portal ---------- */
if (cfg.devices) {
  console.log("Mobile Devices portal (device-collection-database)");
  const dApp = appFor("devices", cfg.devices);
  await runCopies("devices", getFirestore(dApp), DEVICE_COLLECTIONS.map((c) => [c, c]));
  if (cfg.devices.importPinAccounts) {
    await moveUsers(getAuth(dApp), cfg.devices.hash, (u) => /@device-portal\.local$/i.test(u.email));
  } else {
    console.log("  PIN logins (admin@device-portal.local, receiver@device-portal.local) not copied.");
    console.log("  Create them in Firebase console > Authentication > Add user, with the PINs you want.");
  }
  console.log("");
}

/* ---------- 3. Weekly Report (Feeder Dashboard) ---------- */
if (cfg.weekly) {
  console.log("Weekly Report (feeder-dashboard)");
  const wApp = appFor("weekly", cfg.weekly);
  await runCopies("weekly", getFirestore(wApp), Object.entries(WEEKLY_COLLECTIONS));
  console.log("  Its old `users` collection (username + SHA-256 password) is not copied: the single sign-in replaces it.\n");
}

console.log(DRY ? "Dry run finished. Run again without --dry-run to copy." : "Done.");
