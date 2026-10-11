import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";

export function AppHeader() {
  const { user, ready, login, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const linkCls = "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground";
  const active = { className: "rounded-md px-3 py-1.5 text-sm font-semibold bg-primary text-primary-foreground" };

  return (
    <header className="sticky top-0 z-[1000] border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary font-mono text-xs font-bold text-primary-foreground">GIS</span>
          <span className="hidden font-semibold sm:inline">AEDC Enumeration</span>
        </div>
        <nav className="flex gap-1">
          <Link to="/" className={linkCls} activeProps={active} activeOptions={{ exact: true }}>Dashboard</Link>
          <Link to="/map" className={linkCls} activeProps={active}>GIS Map</Link>
          <Link to="/analytics" className={linkCls} activeProps={active}>Analytics</Link>
        </nav>
        <div className="relative ml-auto">
          {!ready ? (
            <span className="text-xs text-muted-foreground">Checking session…</span>
          ) : user ? (
            <div className="flex items-center gap-2">
              <span className="hidden rounded-full bg-secondary px-3 py-1 text-xs font-medium md:inline">🔑 {user.email}</span>
              <button onClick={() => logout()} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Sign out</button>
            </div>
          ) : (
            <button onClick={() => setOpen((o) => !o)} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Admin sign in</button>
          )}
          {open && !user && (
            <form
              className="absolute right-0 top-11 w-72 space-y-2 rounded-lg border bg-popover p-4 shadow-lg"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setErr("");
                try {
                  await login(email, pw);
                  setOpen(false);
                  setPw("");
                } catch (e) {
                  setErr((e as Error).message || "Invalid credentials");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <input className="w-full rounded-md border bg-background px-3 py-2 text-sm" type="email" placeholder="Admin email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <input className="w-full rounded-md border bg-background px-3 py-2 text-sm" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} required />
              {err && <p className="text-xs text-destructive">{err}</p>}
              <button disabled={busy} className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">{busy ? "Signing in…" : "Sign in"}</button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
