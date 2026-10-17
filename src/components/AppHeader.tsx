import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export function AppHeader() {
  const { user, ready, login, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const linkCls = "shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground";
  const active = { className: "shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-semibold bg-primary text-primary-foreground" };

  return (
    <header className="sticky top-0 z-[1000] border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-2 sm:px-4">
        <div className="flex shrink-0 items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary font-mono text-xs font-bold text-primary-foreground">GIS</span>
          <span className="hidden font-semibold xl:inline">AEDC Enumeration</span>
        </div>
        <nav aria-label="Main navigation" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          <Link to="/" className={linkCls} activeProps={active} activeOptions={{ exact: true }}>Dashboard</Link>
          <Link to="/map" className={linkCls} activeProps={active}>GIS Map</Link>
          <Link to="/analytics" className={linkCls} activeProps={active}>Analytics</Link>
          <Link to="/field-manager" className={linkCls} activeProps={active}>Field Manager</Link>
          <Link to="/projections" className={linkCls} activeProps={active}>Projections</Link>
          <Link to="/weekly-report" className={linkCls} activeProps={active}>Weekly Report</Link>
          <Link to="/mobile-devices" className={linkCls} activeProps={active}>Mobile Devices</Link>
        </nav>
        <div className="relative ml-auto shrink-0">
          {!ready ? (
            <span className="text-xs text-muted-foreground">Checking session…</span>
          ) : user ? (
            <div className="flex items-center gap-2">
              <span className="hidden max-w-40 truncate bg-secondary px-2 py-1 text-xs font-medium 2xl:inline">{user.email}</span>
              <Button size="sm" variant="outline" onClick={() => logout()}>Sign out</Button>
            </div>
          ) : (
            <Button size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Admin sign in</Button>
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
              <input aria-label="Admin email" autoComplete="username" className="w-full rounded-md border bg-background px-3 py-2 text-sm" type="email" placeholder="Admin email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <input aria-label="Password" autoComplete="current-password" className="w-full rounded-md border bg-background px-3 py-2 text-sm" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} required />
              {err && <p className="text-xs text-destructive">{err}</p>}
              <Button disabled={busy} className="w-full">{busy ? "Signing in…" : "Sign in"}</Button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
