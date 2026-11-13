// Landsec logins by role and scheme (docs/landsec-pitch-plan.md, item 6) —
// the admin panel on the Landsec home: every Landsec login with its role
// and schemes, and a form to create one or change it.
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ChevronRight, Trash2, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { LANDSEC_ROLES, type LandsecRole } from "@shared/landsec";

interface AccessUser { id: string; name: string | null; email: string | null; active: boolean; role: LandsecRole | null; schemes: string[]; firm: string | null; notes: string | null }
interface AccessData { users: AccessUser[]; schemes: { key: string; name: string; group: string }[] }
interface Leftovers { schemes: string[]; viewingsCleared: number; checklistItems: number; dealsResponsible: number; briefs: number }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// What a joint agent taken off a scheme (or deactivated) still holds there,
// in words, so BGP knows what to reassign.
function leftoversNote(who: string, lead: string, r: { removed?: Leftovers | null; removedCheckFailed?: boolean }): string | null {
  if (r.removedCheckFailed) return `${lead} What ${who} still holds at those schemes could not be checked: look for viewings, checklist items and briefs in their name and reassign them.`;
  const held = r.removed;
  if (!held) return null;
  const where = held.schemes.length ? `at ${held.schemes.join(", ")}` : "at their schemes";
  const lines: string[] = [];
  if (held.viewingsCleared) lines.push(`${plural(held.viewingsCleared, "viewing", "viewings")} ${where} ${held.viewingsCleared === 1 ? "now has" : "now have"} no agent.`);
  const still: string[] = [];
  if (held.checklistItems) still.push(`${plural(held.checklistItems, "open checklist item", "open checklist items")}`);
  if (held.dealsResponsible) still.push(`${plural(held.dealsResponsible, "deal", "deals")} they are responsible for`);
  if (held.briefs) still.push(`a place on ${plural(held.briefs, "brief", "briefs")}`);
  if (still.length) lines.push(`${who} still has ${still.length > 1 ? `${still.slice(0, -1).join(", ")} and ${still[still.length - 1]}` : still[0]} ${where}.`);
  if (!lines.length) return `${lead} ${who} holds no viewings, checklist items, deals or briefs ${where}.`;
  return `${lead} ${lines.join(" ")} Reassign these on the tracker.`;
}

export function LandsecAccessPanel() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { data } = useQuery<AccessData>({ queryKey: ["/api/landsec/access"], enabled: open, staleTime: 30 * 1000 });
  // No role is chosen for a new login: two of the three roles give the full
  // Landsec view, so the admin picks one before Save is offered.
  const blank = { email: "", name: "", role: "" as LandsecRole | "", schemes: [] as string[], firm: "", password: "" };
  const [form, setForm] = useState(blank);
  const [shown, setShown] = useState<{ email: string; password: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (body: typeof form & { confirmFullView?: boolean }) => (await apiRequest("POST", "/api/landsec/access", { ...body, password: body.password || undefined })).json(),
    onSuccess: (r: any, v) => {
      queryClient.invalidateQueries({ queryKey: ["/api/landsec/access"] });
      if (r?.tempPassword) setShown({ email: v.email, password: r.tempPassword });
      toast({ title: "Login saved", description: r?.tempPassword ? "Copy the password now — it is not shown again." : undefined });
      const who = v.name || v.email;
      setNote(leftoversNote(who, `${who} was taken off a scheme.`, r || {}));
      setForm(blank);
    },
    onError: (e: any) => toast({ title: "Not saved", description: e?.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (u: AccessUser) => (await apiRequest("DELETE", `/api/landsec/access/${u.id}`)).json(),
    onSuccess: (r: any, u) => {
      queryClient.invalidateQueries({ queryKey: ["/api/landsec/access"] });
      const who = u.name || u.email || "The joint agent";
      if (r?.deactivated) {
        toast({ title: "Login deactivated", description: `${who} can no longer sign in.` });
        setNote(leftoversNote(who, `${who}'s login was deactivated.`, r));
      } else {
        setNote(null);
      }
    },
    onError: (e: any) => toast({ title: "Not changed", description: e?.message, variant: "destructive" }),
  });
  // A joint agent is an outside firm's login: taking its role away would
  // leave it with the full Landsec view, so the login is deactivated instead.
  const removeRole = (u: AccessUser) => {
    if (u.role === "joint_agent" && !window.confirm(`Deactivate ${u.name || u.email || "this login"}? They will be signed out and will not be able to sign in again. Viewings they are the agent on that are still to happen will show as having no agent.`)) return;
    remove.mutate(u);
  };
  // A joint agent is an outside firm's login. Saving it with another role
  // gives it the full Landsec view, so the admin is asked first (the server
  // refuses the save without that answer).
  const saveLogin = () => {
    const email = form.email.trim().toLowerCase();
    const stored = (data?.users || []).find(u => (u.email || "").toLowerCase() === email);
    if (stored?.role === "joint_agent" && form.role !== "joint_agent") {
      if (!window.confirm(`${stored.name || stored.email || "This login"} is a joint agent. Changing the role gives this login the full Landsec view: all 14 schemes, BGP's brand pages and chat. Only do this for Landsec's own staff. Save it?`)) return;
      save.mutate({ ...form, confirmFullView: true });
      return;
    }
    save.mutate(form);
  };
  const schemesByGroup = useMemo(() => {
    const g: Record<string, { key: string; name: string }[]> = {};
    for (const s of data?.schemes || []) (g[s.group] ||= []).push(s);
    return g;
  }, [data]);
  // A joint agent is held to the schemes ticked (at least one). An asset
  // manager sees what Landsec leasing sees (Woody, 2026-11-13): the schemes
  // ticked are the ones that person answers for, and none is needed.
  const pickSchemes = form.role === "asset_manager" || form.role === "joint_agent";
  const schemeNames = (keys: string[]) => keys.map(k => data?.schemes.find(s => s.key === k)?.name || k).join(", ");
  const edit = (u: AccessUser) => { setForm({ email: u.email || "", name: u.name || "", role: u.role || "leasing_manager", schemes: u.schemes || [], firm: u.firm || "", password: "" }); setShown(null); };

  return (
    <section className="space-y-2" data-testid="landsec-access-panel">
      <button type="button" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground flex items-center gap-1" onClick={() => setOpen(v => !v)} data-testid="landsec-access-toggle">
        <ChevronRight className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} /> Landsec logins by role and scheme — BGP admin only
      </button>
      {open && data && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border divide-y text-sm">
            {data.users.length === 0 && <p className="p-3 text-muted-foreground">No Landsec logins yet.</p>}
            {data.users.map(u => (
              <div key={u.id} className="p-2.5 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{u.name || u.email}{!u.active && <span className="text-xs text-muted-foreground"> · deactivated</span>}</p>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  <p className="text-xs">
                    {u.role ? LANDSEC_ROLES.find(r => r.key === u.role)?.label : "Full Landsec view (no role set — treated as a leasing manager)"}
                    {u.role === "joint_agent" && <span className="text-muted-foreground"> · {schemeNames(u.schemes) || "no schemes"}</span>}
                    {u.role === "asset_manager" && <span className="text-muted-foreground"> · sees all schemes, as Landsec leasing{u.schemes.length > 0 && `; answers for ${schemeNames(u.schemes)}`}</span>}
                    {u.firm && <span className="text-muted-foreground"> · {u.firm}</span>}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => edit(u)}>Edit</Button>
                  {u.role === "joint_agent"
                    ? u.active && <Button variant="ghost" size="icon" className="h-7 w-7" title="Deactivate this login" aria-label="Deactivate this login" disabled={remove.isPending} onClick={() => removeRole(u)} data-testid={`landsec-access-deactivate-${u.id}`}><UserX className="w-3.5 h-3.5" /></Button>
                    : u.role && <Button variant="ghost" size="icon" className="h-7 w-7" title={u.role === "asset_manager" ? "Remove the role label (access does not change)" : "Remove the role (back to the full Landsec view)"} disabled={remove.isPending} onClick={() => removeRole(u)}><Trash2 className="w-3.5 h-3.5" /></Button>}
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border p-3 space-y-2 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Create or change a login</p>
            <div className="grid sm:grid-cols-2 gap-1.5">
              <Input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="Email (their login)" className="h-8 text-sm" data-testid="landsec-access-email" />
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Name" className="h-8 text-sm" />
              <select className="h-8 rounded-md border bg-background px-2 text-sm" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value as LandsecRole | "" }))} aria-label="Role" data-testid="landsec-access-role">
                <option value="">Choose a role</option>
                {LANDSEC_ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <Input value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="Password (blank = generate one)" className="h-8 text-sm" type="text" />
              {form.role === "joint_agent" && <Input value={form.firm} onChange={e => setForm(p => ({ ...p, firm: e.target.value }))} placeholder="Firm, e.g. CBRE" className="h-8 text-sm sm:col-span-2" />}
            </div>
            <p className="text-xs text-muted-foreground">{LANDSEC_ROLES.find(r => r.key === form.role)?.scope || "Choose a role. A joint agent is held to the schemes ticked; a leasing manager or an asset manager sees all of Landsec."}</p>
            {pickSchemes && (
              <div className="space-y-1">
                <p className="text-xs font-medium" data-testid="landsec-access-schemes-label">
                  {form.role === "joint_agent" ? "Schemes on this login (at least one)" : "Schemes this person answers for (optional: does not limit what they see)"}
                </p>
                {Object.entries(schemesByGroup).map(([group, list]) => (
                  <div key={group} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground w-14">{group}</span>
                    {list.map(s => (
                      <label key={s.key} className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={form.schemes.includes(s.key)} onChange={e => setForm(p => ({ ...p, schemes: e.target.checked ? [...p.schemes, s.key] : p.schemes.filter(k => k !== s.key) }))} data-testid={`landsec-access-scheme-${s.key}`} />
                        {s.name}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="outline" onClick={() => { setForm(blank); setShown(null); }}>Clear</Button>
              <Button size="sm" disabled={save.isPending || !form.email || !form.role} title={!form.role ? "Choose a role first" : undefined} onClick={saveLogin} data-testid="landsec-access-save">Save login</Button>
            </div>
            {note && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-2 text-xs" role="status" data-testid="landsec-access-note">
                <p>{note}</p>
                <button type="button" className="mt-1 underline text-muted-foreground hover:text-foreground" onClick={() => setNote(null)}>Dismiss</button>
              </div>
            )}
            {shown && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-2 text-xs">
                <p className="font-medium">Give these to {shown.email} — the password is not shown again.</p>
                <p className="font-mono mt-1">{shown.email} / {shown.password}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
