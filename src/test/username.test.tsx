import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fs = vi.hoisted(() => {
  const docs = new Map<string, any>();
  const batch = { update: vi.fn(), set: vi.fn(), delete: vi.fn(), commit: vi.fn(async () => {}) };
  return {
    docs, batch,
    doc: vi.fn((_db: unknown, col: string, id: string) => ({ col, id, path: `${col}/${id}` })),
    getDoc: vi.fn(async (ref: { path: string }) => ({ exists: () => docs.has(ref.path), data: () => docs.get(ref.path) })),
    deleteField: vi.fn(() => "__DELETE__"),
    writeBatch: vi.fn(() => batch),
  };
});
vi.mock("firebase/firestore", () => ({ doc: fs.doc, getDoc: fs.getDoc, deleteField: fs.deleteField, writeBatch: fs.writeBatch, collection: vi.fn(), getDocs: vi.fn(), deleteDoc: vi.fn() }));
const authMock = vi.hoisted(() => ({ signIn: vi.fn(async () => ({})), currentUser: { uid: "admin1" } as any }));
vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: authMock.signIn, onAuthStateChanged: (_a: unknown, cb: (u: unknown) => void) => { cb(null); return () => {}; },
  signOut: vi.fn(), createUserWithEmailAndPassword: vi.fn(), sendPasswordResetEmail: vi.fn(),
}));
vi.mock("@/lib/firebase", () => ({ getFs: () => ({}), getFirebaseAuth: () => authMock, getDb: () => ({}), firebaseConfig: {} }));
vi.mock("@/lib/field/firebase", () => ({ auth: () => authMock, db: () => ({}), withSecondaryAuth: vi.fn() }));

import { friendlyAuthError, normalizeUsername, resolveLoginEmail, validateUsername } from "@/lib/username";
import { AuthProvider, useAuth } from "@/lib/auth";
import { updateStaffUser, type StaffUser } from "@/lib/field/users";

beforeEach(() => { vi.clearAllMocks(); fs.docs.clear(); authMock.currentUser = { uid: "admin1" }; });

describe("username helpers", () => {
  it("normalizes and validates", () => {
    expect(normalizeUsername("  Ada.Sup ")).toBe("ada.sup");
    expect(validateUsername("ada.sup")).toBeNull();
    for (const bad of ["ab", "has space", "me@x.com", "a".repeat(31), ""]) expect(validateUsername(bad)).not.toBeNull();
  });
  it("uses an email as typed, and looks a username up", async () => {
    expect(await resolveLoginEmail(" me@x.com ")).toBe("me@x.com");
    fs.docs.set("usernames/ada.sup", { uid: "u1", email: "ada@x.com" });
    expect(await resolveLoginEmail("Ada.Sup")).toBe("ada@x.com");
  });
  it("gives the same message for an unknown username as for a wrong password", async () => {
    await expect(resolveLoginEmail("nobody")).rejects.toThrow("Wrong username/email or password.");
    expect(friendlyAuthError({ code: "auth/invalid-credential" })).toBe("Wrong username/email or password.");
  });
});

describe("signing in", () => {
  function Probe({ id }: { id: string }) {
    const { login } = useAuth();
    return <button onClick={() => void login(id, "pw12345678")}>go</button>;
  }
  const go = (id: string) => render(<QueryClientProvider client={new QueryClient()}><AuthProvider><Probe id={id} /></AuthProvider></QueryClientProvider>);

  it("signs in with a username by finding its email", async () => {
    fs.docs.set("usernames/ada.sup", { uid: "u1", email: "ada@x.com" });
    go("ada.sup");
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(authMock.signIn).toHaveBeenCalledWith(expect.anything(), "ada@x.com", "pw12345678"));
  });
  it("still signs in with an email", async () => {
    go("boss@x.com");
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(authMock.signIn).toHaveBeenCalledWith(expect.anything(), "boss@x.com", "pw12345678"));
  });
});

describe("updateStaffUser", () => {
  const sup: StaffUser = { id: "sup1", email: "sup@x.com", full_name: "Sade", phone: "", role: "supervisor" };

  it("gives an existing supervisor a username", async () => {
    await updateStaffUser(sup, { full_name: "Sade S", phone: "0801", role: "supervisor", username: "Sade.Sup" });
    expect(fs.batch.update).toHaveBeenCalledWith(expect.objectContaining({ path: "users/sup1" }), expect.objectContaining({ username: "sade.sup", full_name: "Sade S", phone: "0801", role: "supervisor" }));
    expect(fs.batch.set).toHaveBeenCalledWith(expect.objectContaining({ path: "usernames/sade.sup" }), { uid: "sup1", email: "sup@x.com" });
    expect(fs.batch.commit).toHaveBeenCalled();
  });
  it("moves the lookup when the username changes", async () => {
    await updateStaffUser({ ...sup, username: "old.name" }, { full_name: "Sade", phone: "", role: "supervisor", username: "new.name" });
    expect(fs.batch.delete).toHaveBeenCalledWith(expect.objectContaining({ path: "usernames/old.name" }));
    expect(fs.batch.set).toHaveBeenCalledWith(expect.objectContaining({ path: "usernames/new.name" }), expect.anything());
  });
  it("refuses a username someone else already has", async () => {
    fs.docs.set("usernames/taken", { uid: "other", email: "o@x.com" });
    await expect(updateStaffUser(sup, { full_name: "S", phone: "", role: "supervisor", username: "taken" })).rejects.toThrow(/already used/);
    expect(fs.batch.commit).not.toHaveBeenCalled();
  });
  it("lets you keep your own username", async () => {
    fs.docs.set("usernames/mine", { uid: "sup1", email: "sup@x.com" });
    await updateStaffUser({ ...sup, username: "mine" }, { full_name: "S", phone: "", role: "supervisor", username: "mine" });
    expect(fs.batch.commit).toHaveBeenCalled();
  });
  it("removes the username when emptied, and blocks changing your own role", async () => {
    await updateStaffUser({ ...sup, username: "gone" }, { full_name: "S", phone: "", role: "supervisor", username: "" });
    expect(fs.batch.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ username: "__DELETE__" }));
    expect(fs.batch.delete).toHaveBeenCalledWith(expect.objectContaining({ path: "usernames/gone" }));
    await expect(updateStaffUser({ ...sup, id: "admin1", role: "admin" }, { full_name: "S", phone: "", role: "supervisor", username: "" })).rejects.toThrow(/own role/);
  });
  it("rejects a bad username before writing", async () => {
    await expect(updateStaffUser(sup, { full_name: "S", phone: "", role: "supervisor", username: "a b" })).rejects.toThrow(/3 to 30/);
  });
});
