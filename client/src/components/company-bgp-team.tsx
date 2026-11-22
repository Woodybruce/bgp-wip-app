import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BrandEmailHistory } from "@/components/brand-email-history";
import { LandlordMeetingsHistory } from "@/components/landlord-meetings-summary";
import { BgpTeamGroup, type BgpTeamPerson } from "@/components/bgp-team-group";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { BGP_ACCOUNT_ROLES, canonicalBgpRole } from "@shared/bgp-account-roles";
import { LANDLORD_TEAM_ROLES, type LandlordRelationshipTeamData, type LandlordTeamMember } from "@shared/landlord-relationship-team";

export type Coverer = { id: string; name: string; email?: string | null; phone?: string | null; role: string | null; bgp_title?: string | null; profile_pic_url?: string | null; threads?: number; last_touch?: string | null };

const SHOWN = 6;
const count = (n: number | undefined, noun: string) => n ? `${n.toLocaleString("en-GB")} ${noun}${n === 1 ? "" : "s"}` : "";

// The BGP team on a landlord or brand page, as the first group of Key
// contacts. The people set on the account (bgp_contact_user_ids, or the
// agents on its deals when nobody is set) are always shown, to every login
// that can open the page. BGP staff on a landlord also get everyone the
// landlord team read finds in the records, with their roles at the
// landlord's properties, suggested roles to confirm, and their emails and
// meetings with the landlord. Replaces the separate landlord team block and
// the brand's team cards (Woody, 2026-11-14).
export function CompanyBgpTeam({ companyId, companyName, coverers, landlord, staff }: {
  companyId: string; companyName: string; coverers: Coverer[]; landlord: boolean; staff: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [activity, setActivity] = useState<{ person: { userId: string; name: string }; kind: "emails" | "meetings" } | null>(null);
  const [placing, setPlacing] = useState<{ userId: string; name: string; role: string; propertyId: string; notes: string } | null>(null);
  const teamKey = ["/api/crm/landlords", companyId, "team"];
  const team = useQuery<LandlordRelationshipTeamData>({
    queryKey: teamKey, staleTime: 60_000, retry: false, enabled: staff && landlord,
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/crm/landlords/${encodeURIComponent(companyId)}/team`, { credentials: "include", headers: getAuthHeaders(), signal });
      if (!r.ok) throw new Error("The BGP team could not be loaded");
      return r.json();
    },
  });
  const { data: allUsers } = useQuery<Array<{ id: string; name: string }>>({ queryKey: ["/api/users"], staleTime: 5 * 60_000, enabled: staff });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "hunter-score"] });
    queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "ai-take"] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", companyId] });
    queryClient.invalidateQueries({ queryKey: ["/api/client-teams", companyId] });
    queryClient.invalidateQueries({ queryKey: ["/api/accounts", companyId] });
    queryClient.invalidateQueries({ queryKey: teamKey });
  };
  const failed = (title: string) => (e: any) => toast({ title, description: e?.message, variant: "destructive" });

  // Who is set on the account: the hand-set list only (a "From transactions"
  // fallback is not a saved list, so ticking someone starts one).
  const setIds = coverers.filter(c => c.role !== "From transactions").map(c => c.id);
  const saveTeam = useMutation({
    mutationFn: async (ids: string[]) => { await apiRequest("PUT", `/api/crm/companies/${companyId}`, { bgpContactUserIds: ids.length ? ids : null, bgpContactCrm: null }); },
    onSuccess: refresh, onError: failed("Couldn't save the BGP team"),
  });
  const toggle = (id: string) => saveTeam.mutate(setIds.includes(id) ? setIds.filter(v => v !== id) : [...setIds, id]);
  const saveRole = useMutation({
    mutationFn: async (v: { userId: string; role: string }) => (await apiRequest("POST", `/api/brand/${companyId}/bgp-role`, v)).json(),
    onSuccess: refresh, onError: failed("Couldn't save the role"),
  });
  const saveContext = useMutation({
    mutationFn: async (v: { userId: string; role: string; propertyId: string | null; notes: string }) =>
      (await apiRequest("POST", `/api/crm/landlords/${encodeURIComponent(companyId)}/team/contexts`, v)).json(),
    onSuccess: () => { setPlacing(null); refresh(); }, onError: failed("Couldn't save the role"),
  });
  const removeContext = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/crm/landlords/${encodeURIComponent(companyId)}/team/contexts/${encodeURIComponent(id)}`)).json(),
    onSuccess: refresh, onError: failed("Couldn't remove the role"),
  });

  const members = new Map<string, LandlordTeamMember>((team.data?.members || []).map(m => [m.id, m]));
  const order = [...coverers.map(c => c.id), ...(team.data?.members || []).map(m => m.id).filter(id => !coverers.some(c => c.id === id))];
  const people: BgpTeamPerson[] = order.map(id => {
    const cov = coverers.find(c => c.id === id);
    const m = members.get(id);
    const accountRole = cov ? (cov.role === "From transactions" ? "From transactions" : canonicalBgpRole(cov.role) || cov.role) : m?.assignedRole || null;
    const placed = (m?.contexts || []).filter(x => x.origin === "manual").map(x => `${x.role}${x.propertyName ? ` · ${x.propertyName}` : ""}`);
    const suggested = (m?.contexts || []).filter(x => x.origin === "suggested").map(x => `${x.role}${x.propertyName ? ` · ${x.propertyName}` : ""}`);
    const name = cov?.name || m?.name || "BGP";
    const history: BgpTeamPerson["history"] = !staff ? [] : m ? [
      { label: count(m.emailCount, "email"), onOpen: () => setActivity({ person: { userId: id, name }, kind: "emails" }) },
      { label: count(m.meetingCount, "meeting"), onOpen: () => setActivity({ person: { userId: id, name }, kind: "meetings" }) },
      { label: count(m.dealCount, "transaction") },
      { label: count(m.conversationCount, "chat message") },
    ] : [{ label: count(cov?.threads, "email") }];
    return {
      id, name,
      title: cov?.bgp_title || m?.title || null,
      email: cov?.email || m?.email || null, phone: cov?.phone || m?.phone || null,
      photo: cov?.profile_pic_url || m?.profilePicUrl || null,
      roles: [...(accountRole ? [accountRole] : []), ...placed.filter(p => p !== accountRole)],
      note: staff && suggested.length ? `Suggested from records: ${suggested.join(", ")}` : null,
      former: m ? !m.active : false,
      history,
      lastAt: staff ? (m?.lastInteractionAt || cov?.last_touch || null) : null,
    };
  });
  const shown = expanded ? people : people.slice(0, SHOWN);

  const menuFor = (p: BgpTeamPerson) => {
    if (!staff) return null;
    const m = members.get(p.id);
    const onTeam = setIds.includes(p.id);
    const current = canonicalBgpRole(coverers.find(c => c.id === p.id)?.role);
    return <>
      <DropdownMenuLabel className="text-[11px]">Role on the account</DropdownMenuLabel>
      {BGP_ACCOUNT_ROLES.map(r => (
        <DropdownMenuItem key={r.role} onSelect={() => { if (!onTeam) toggle(p.id); saveRole.mutate({ userId: p.id, role: r.role }); }}>
          <Check className={`w-3 h-3 mr-2 ${current === r.role ? "opacity-100" : "opacity-0"}`} />{r.role}
        </DropdownMenuItem>
      ))}
      {current && <DropdownMenuItem onSelect={() => saveRole.mutate({ userId: p.id, role: "" })} className="text-muted-foreground">Clear role</DropdownMenuItem>}
      {landlord && m && <>
        <DropdownMenuSeparator />
        {m.contexts.filter(x => x.origin === "suggested").map(x => (
          <DropdownMenuItem key={x.id} onSelect={() => saveContext.mutate({ userId: p.id, role: x.role, propertyId: x.propertyId, notes: x.notes })}>
            Confirm {x.role}{x.propertyName ? ` · ${x.propertyName}` : ""}
          </DropdownMenuItem>
        ))}
        {m.contexts.filter(x => x.origin === "manual").map(x => (
          <DropdownMenuItem key={x.id} onSelect={() => removeContext.mutate(x.id)} className="text-muted-foreground">
            Remove {x.role}{x.propertyName ? ` · ${x.propertyName}` : ""}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => setPlacing({ userId: p.id, name: p.name, role: LANDLORD_TEAM_ROLES[0], propertyId: "", notes: "" })}>Add a role at a property…</DropdownMenuItem>
      </>}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => toggle(p.id)}>{onTeam ? "Take off the account team" : "Put on the account team"}</DropdownMenuItem>
    </>;
  };

  const addControl = staff ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" data-no-min-touch className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5" data-testid={`bgp-team-edit-${companyId}`}>
          <Plus className="w-3 h-3" />{setIds.length ? "Edit team" : "Set BGP team"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 max-h-64 overflow-y-auto">
        {(allUsers || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map(u => (
          <DropdownMenuItem key={u.id} onSelect={e => { e.preventDefault(); toggle(u.id); }}>
            <div className={`w-3 h-3 rounded-sm border mr-2 flex items-center justify-center ${setIds.includes(u.id) ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
              {setIds.includes(u.id) && <Check className="h-2 w-2 text-primary-foreground" />}
            </div>
            {u.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  if (!staff && !people.length) return null;
  return (
    <div className="pb-2 mb-1 border-b border-border/60" data-testid="company-bgp-team">
      <BgpTeamGroup
        people={shown}
        menuFor={menuFor}
        addControl={addControl}
        loading={!people.length && team.isLoading}
        emptyText={staff ? "Nobody at BGP is set on this account yet." : undefined}
        extra={<>
          {people.length > SHOWN && <button type="button" data-no-min-touch className="text-xs text-primary hover:underline" onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer" : `Show all ${people.length}`}</button>}
          {team.isError && <p className="text-xs text-muted-foreground">The records behind the team could not be read. <button className="underline" onClick={() => team.refetch()}>Try again</button></p>}
          {!!team.data?.issues.length && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Some records need checking ({team.data.issues.length})</summary><ul className="list-disc pl-4 mt-1 space-y-1">{team.data.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></details>}
          {placing && (
            <form className="space-y-2 rounded-md border border-border p-2 mt-1" data-testid="bgp-team-place-form"
              onSubmit={e => { e.preventDefault(); saveContext.mutate({ userId: placing.userId, role: placing.role, propertyId: placing.propertyId || null, notes: placing.notes }); }}>
              <p className="text-xs font-medium">{placing.name}: role at a property</p>
              <label className="block text-xs">Role<select value={placing.role} onChange={e => setPlacing({ ...placing, role: e.target.value })} className="mt-1 w-full rounded border border-input bg-background p-2 text-xs">{LANDLORD_TEAM_ROLES.map(r => <option key={r}>{r}</option>)}</select></label>
              <label className="block text-xs">Property<select value={placing.propertyId} onChange={e => setPlacing({ ...placing, propertyId: e.target.value })} className="mt-1 w-full rounded border border-input bg-background p-2 text-xs"><option value="">Account-wide</option>{(team.data?.properties || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <Input value={placing.notes} onChange={e => setPlacing({ ...placing, notes: e.target.value })} maxLength={500} placeholder="Context, represented party or scope" aria-label="Role context" className="h-8 text-xs" />
              <div className="flex gap-2"><Button size="sm" type="submit" disabled={saveContext.isPending}>{saveContext.isPending ? "Saving…" : "Save role"}</Button><Button size="sm" variant="ghost" type="button" onClick={() => setPlacing(null)}><X className="h-3 w-3" />Cancel</Button></div>
            </form>
          )}
        </>}
      />
      {activity?.kind === "emails" && <BrandEmailHistory key={`${companyId}:${activity.person.userId}`} companyId={companyId} companyName={companyName} landlord person={activity.person} open onOpenChange={open => { if (!open) setActivity(null); }} />}
      {activity?.kind === "meetings" && <LandlordMeetingsHistory key={`${companyId}:${activity.person.userId}`} companyId={companyId} companyName={companyName} person={activity.person} initialPeriod="recent" open onOpenChange={open => { if (!open) setActivity(null); }} />}
    </div>
  );
}
