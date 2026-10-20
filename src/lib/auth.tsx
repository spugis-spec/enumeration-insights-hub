import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { getFirebaseAuth } from "./firebase";
import { resolveLoginEmail } from "./username";

type AuthState = {
  user: User | null;
  ready: boolean;
  /** `identifier` is an email or a username. */
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();
  const lastUid = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, (u) => {
      // Field Manager / Weekly Report data is cached per session: drop it when the person changes.
      const uid = u?.uid ?? null;
      if (lastUid.current !== undefined && lastUid.current !== uid) qc.clear();
      lastUid.current = uid;
      setUser(u);
      setReady(true);
    });
  }, [qc]);

  const value: AuthState = {
    user,
    ready,
    login: async (identifier, password) => {
      const email = await resolveLoginEmail(identifier);
      await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
    },
    logout: () => signOut(getFirebaseAuth()),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
