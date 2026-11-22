import { doc, getDoc } from "firebase/firestore";
import { getFs } from "./firebase";

// Firebase signs people in with an email. A username is just a lookup: usernames/{username} holds the
// email, so "ada.s" and "ada@example.com" both end up signing in with the same account.

export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
export const normalizeUsername = (s: string) => s.trim().toLowerCase();

/** Returns a message when the username isn't allowed, otherwise null. */
export function validateUsername(s: string): string | null {
  return USERNAME_RE.test(normalizeUsername(s)) ? null : "Username must be 3 to 30 characters: letters, numbers, dot, dash or underscore (no spaces or @).";
}

/** Whatever the person typed in the sign-in box (email or username) becomes the email to sign in with. */
export async function resolveLoginEmail(identifier: string): Promise<string> {
  const id = identifier.trim();
  if (!id) throw new Error("Enter your username or email.");
  if (id.includes("@")) return id;
  let email: string | undefined;
  try {
    const snap = await getDoc(doc(getFs(), "usernames", normalizeUsername(id)));
    email = snap.exists() ? (snap.data() as { email?: string }).email : undefined;
  } catch {
    /* treated as unknown below, so the message never says whether a username exists */
  }
  if (!email) throw new Error("Wrong username/email or password.");
  return email;
}

/** Friendly text for the usual Firebase sign-in errors. */
export function friendlyAuthError(e: unknown): string {
  const x = e as { code?: string; message?: string };
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(x?.code ?? "")) return "Wrong username/email or password.";
  if (x?.code === "auth/too-many-requests") return "Too many attempts. Wait a few minutes and try again.";
  if (x?.code === "auth/network-request-failed") return "Network problem. Check your connection and try again.";
  return x?.message || "Couldn't sign in.";
}
