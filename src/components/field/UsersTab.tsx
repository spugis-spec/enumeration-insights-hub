import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createStaffUser, listStaffUsers, revokeStaffUser, sendReset } from "@/lib/field/users";
import { removeRow, upsertMany } from "@/lib/field/db";
import { useRefresh, type Model } from "@/lib/field/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section, selectCls } from "./common";

export function UsersTab({ m }: { m: Model }) {
  const qc = useQueryClient();
  const refresh = useRefresh();
  const { data: users } = useQuery({ queryKey: ["staffusers"], queryFn: listStaffUsers });
  const [f, setF] = useState({ full_name: "", email: "", phone: "", password: "", role: "supervisor" as "supervisor" | "admin" });
  const [en, setEn] = useState({ username: "", full_name: "", phone: "", supervisor: "" });

  const [saving, setSaving] = useState(false);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const email = f.email.trim().toLowerCase();
    if (users?.some((u) => u.email.toLowerCase() === email)) return toast.error(`${email} already has a login`);
    setSaving(true);
    const t = toast.loading(`Creating ${f.role} login for ${email}…`);
    try {
      await createStaffUser({ ...f, email });
      // Show the new person in the list straight away.
      qc.setQueryData<any[]>(["staffusers"], (old) => [{ id: `new-${email}`, email, full_name: f.full_name, phone: f.phone, role: f.role }, ...(old ?? [])]);
      toast.success(`${f.role} account created for ${email}`, { id: t });
      setF({ full_name: "", email: "", phone: "", password: "", role: "supervisor" });
      qc.refetchQueries({ queryKey: ["staffusers"] });
    } catch (err: any) { toast.error(err.message, { id: t }); }
    finally { setSaving(false); }
  }

  async function addEnum(e: React.FormEvent) {
    e.preventDefault();
    try { await upsertMany("enumerators", [{ ...en, username: en.username.trim(), active: true }], (r) => r.username.toLowerCase()); }
    catch (err: any) { return toast.error(err.message); }
    toast.success(`${en.full_name || en.username} saved`);
    setEn({ username: "", full_name: "", phone: "", supervisor: "" });
    await refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Portal logins (admins & supervisors)">
        <form onSubmit={add} className="grid grid-cols-2 gap-2 mb-4">
          <Input required placeholder="Full name" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
          <Input required type="email" placeholder="Login email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Input placeholder="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <Input required minLength={8} type="text" placeholder="Password (min 8)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <select className={selectCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as any })}>
            <option value="supervisor">Supervisor</option><option value="admin">Admin</option>
          </select>
          <Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create login"}</Button>
        </form>
        <table className="w-full text-sm">
          <tbody>
            {users?.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="p-2 font-bold">{u.full_name}<div className="text-xs font-normal text-muted-foreground">{u.email}</div></td>
                <td className="uppercase text-xs font-bold">{u.role}</td>
                <td className="text-right space-x-1">
                  <Button size="sm" variant="outline" onClick={async () => {
                    if (!confirm(`Send a password-reset email to ${u.email}?`)) return;
                    try { await sendReset(u.email); toast.success("Reset email sent"); } catch (e: any) { toast.error(e.message); }
                  }}>Send reset email</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                    if (!confirm(`Remove portal access for ${u.email}?`)) return;
                    try { await revokeStaffUser(u.id); qc.setQueryData<any[]>(["staffusers"], (old) => (old ?? []).filter((x) => x.id !== u.id)); toast.success("Access removed"); qc.refetchQueries({ queryKey: ["staffusers"] }); } catch (e: any) { toast.error(e.message); }
                  }}>Remove access</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={`Enumerators (${m.enumerators.length})`}>
        <form onSubmit={addEnum} className="grid grid-cols-2 gap-2 mb-4">
          <Input required placeholder="Username (as in capture app)" value={en.username} onChange={(e) => setEn({ ...en, username: e.target.value })} />
          <Input placeholder="Full name" value={en.full_name} onChange={(e) => setEn({ ...en, full_name: e.target.value })} />
          <Input placeholder="Phone" value={en.phone} onChange={(e) => setEn({ ...en, phone: e.target.value })} />
          <Input placeholder="Supervisor" value={en.supervisor} onChange={(e) => setEn({ ...en, supervisor: e.target.value })} />
          <Button type="submit" className="col-span-2">Add / update enumerator</Button>
        </form>
        <div className="max-h-[480px] overflow-y-auto">
          <table className="w-full text-sm">
            <tbody>
              {m.enumerators.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="p-2 font-semibold">{e.full_name || "—"}<div className="text-xs text-muted-foreground">@{e.username}</div></td>
                  <td className="text-xs">{e.phone}</td><td className="text-xs">{e.supervisor}</td>
                  <td className="text-right"><Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                    if (!confirm(`Remove ${e.username}? Their allocations are removed too.`)) return;
                    for (const a of m.allocations.filter((a) => a.enumerator_id === e.id)) await removeRow("allocations", a.id);
                    await removeRow("enumerators", e.id); toast.success(`${e.username} removed`); await refresh();
                  }}>Remove</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
