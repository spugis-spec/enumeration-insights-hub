import { createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from "firebase/auth";
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, writeBatch } from "firebase/firestore";
import { auth, db, withSecondaryAuth } from "./firebase";
import { normalizeUsername, validateUsername } from "../username";

export type Role = "admin" | "supervisor";
export type StaffUser = { id: string; email: string; full_name: string; phone: string; role: Role | "none"; username?: string; created_at?: string };
type NewUser = { email: string; password: string; full_name: string; phone?: string };

/** meta/setup exists once the first admin has been created. Readable without signing in. */
export async function adminExists() {
  const s = await getDoc(doc(db(), "meta", "setup"));
  return s.exists();
}

/**
 * First-time setup on the unified project: the person who is already signed in becomes the
 * Field Manager admin. Firestore rules reject this once meta/setup exists.
 */
export async function claimAdmin(full_name?: string) {
  const u = auth().currentUser;
  if (!u) throw new Error("Sign in first");
  if (await adminExists()) throw new Error("An admin already exists. Ask them for access.");
  const b = writeBatch(db());
  b.set(doc(db(), "users", u.uid), profile({ email: u.email ?? "", password: "", full_name: full_name || u.email || "Admin" }, "admin"));
  b.set(doc(db(), "meta", "setup"), { adminUid: u.uid, created_at: new Date().toISOString() });
  await b.commit();
}

function profile(u: NewUser, role: Role) {
  return { email: u.email.trim(), full_name: u.full_name.trim(), phone: (u.phone ?? "").trim(), role, created_at: new Date().toISOString() };
}

async function usernameOwner(username: string): Promise<string | null> {
  const s = await getDoc(doc(db(), "usernames", username));
  return s.exists() ? ((s.data() as { uid?: string }).uid ?? "?") : null;
}

export async function createStaffUser(u: NewUser & { role: Role; username?: string }) {
  if (u.password.length < 8) throw new Error("Password must be at least 8 characters");
  const username = u.username?.trim() ? normalizeUsername(u.username) : "";
  if (username) {
    const bad = validateUsername(username);
    if (bad) throw new Error(bad);
    if (await usernameOwner(username)) throw new Error(`Username "${username}" is already used`);
  }
  const uid = await withSecondaryAuth(async (a) => {
    const cred = await createUserWithEmailAndPassword(a, u.email.trim(), u.password);
    await signOut(a);
    return cred.user.uid;
  });
  const b = writeBatch(db());
  b.set(doc(db(), "users", uid), { ...profile(u, u.role), ...(username ? { username } : {}) });
  if (username) b.set(doc(db(), "usernames", username), { uid, email: u.email.trim() });
  await b.commit();
}

/** Edits an existing login's details, including the username used to sign in. The email itself can't be changed here. */
export async function updateStaffUser(user: StaffUser, patch: { full_name: string; phone: string; role: Role; username: string }) {
  const username = patch.username.trim() ? normalizeUsername(patch.username) : "";
  if (username) {
    const bad = validateUsername(username);
    if (bad) throw new Error(bad);
  }
  if (user.id === auth().currentUser?.uid && patch.role !== user.role) throw new Error("You can't change your own role");
  const prev = user.username ? normalizeUsername(user.username) : "";
  if (username && username !== prev) {
    const owner = await usernameOwner(username);
    if (owner && owner !== user.id) throw new Error(`Username "${username}" is already used`);
  }
  const b = writeBatch(db());
  b.update(doc(db(), "users", user.id), { full_name: patch.full_name.trim(), phone: patch.phone.trim(), role: patch.role, username: username || deleteField() });
  if (prev && prev !== username) b.delete(doc(db(), "usernames", prev));
  if (username) b.set(doc(db(), "usernames", username), { uid: user.id, email: user.email });
  await b.commit();
}

export async function listStaffUsers(): Promise<StaffUser[]> {
  const snap = await getDocs(collection(db(), "users"));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

/** Removes portal access (the role record). The sign-in itself can then no longer read any data. */
export async function revokeStaffUser(id: string) {
  if (id === auth().currentUser?.uid) throw new Error("You can't remove your own account");
  const s = await getDoc(doc(db(), "users", id));
  const username = (s.data() as { username?: string } | undefined)?.username;
  await deleteDoc(doc(db(), "users", id));
  if (username) await deleteDoc(doc(db(), "usernames", normalizeUsername(username))).catch(() => {});
}

export async function sendReset(email: string) {
  await sendPasswordResetEmail(auth(), email);
}
