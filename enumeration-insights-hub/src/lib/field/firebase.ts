import { initializeApp, getApp, deleteApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import { getAuth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { firebaseConfig, getFirebaseAuth, getFs } from "../firebase";

// The Field Manager now runs on the same `spugis` Firebase project and the same
// sign-in session as the rest of the app. (It used to be a separate project.)
export { firebaseConfig };
export const firebaseConfigured = true;

export const auth = (): Auth => getFirebaseAuth();
export const db = (): Firestore => getFs();

/** Used by Users & Staff to create another person's login without signing the admin out. */
export async function withSecondaryAuth<T>(fn: (a: Auth) => Promise<T>): Promise<T> {
  const name = "secondary-" + Date.now();
  const sec = initializeApp(firebaseConfig, name);
  try {
    return await fn(getAuth(sec));
  } finally {
    await deleteApp(getApp(name)).catch(() => {});
  }
}

export async function currentUser() {
  const a = auth();
  await a.authStateReady();
  return a.currentUser;
}
