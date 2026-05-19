import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { Link } from "wouter";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Building2, Mail, GripVertical } from "lucide-react";

interface TeamMember {
  id: string;
  client_company_id: string;
  user_id: string;
  team_group: string | null;
  role: string | null;
  reports_to_user_id: string | null;
  sort_order: number;
  username: string | null;
  full_name: string | null;
  email: string | null;
  bgp_title: string | null;
  cv_summary: string | null;
  cv_specialisms: string[] | null;
  bio: string | null;
  property_count: number;
}

interface Candidate {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  bgp_title: string | null;
}

interface PropertyAssignment {
  id: string;
  name: string;
  address: string | null;
  assigned: boolean;
}

// Kanban columns — same 7 teams as the /team org chart, with Unassigned
// pinned to the end so freshly added members are visible until someone
// drops them into a real team.
const COLUMNS = [
  "Office / Corporate",
  "Investment",
  "Lease Advisory",
  "National Leasing",
  "Development",
  "Tenant Rep",
  "London Leasing",
  "Unassigned",
];

const COLUMN_STYLES: Record<string, { bg: string; border: string; chip: string }> = {
  "Office / Corporate": { bg: "bg-purple-50/50 dark:bg-purple-950/20", border: "border-purple-200 dark:border-purple-800", chip: "bg-purple-500" },
  "Investment":          { bg: "bg-emerald-50/50 dark:bg-emerald-950/20", border: "border-emerald-200 dark:border-emerald-800", chip: "bg-emerald-500" },
  "Lease Advisory":      { bg: "bg-amber-50/50 dark:bg-amber-950/20", border: "border-amber-200 dark:border-amber-800", chip: "bg-amber-500" },
  "National Leasing":    { bg: "bg-orange-50/50 dark:bg-orange-950/20", border: "border-orange-200 dark:border-orange-800", chip: "bg-orange-500" },
  "Development":         { bg: "bg-pink-50/50 dark:bg-pink-950/20", border: "border-pink-200 dark:border-pink-800", chip: "bg-pink-500" },
  "Tenant Rep":          { bg: "bg-sky-50/50 dark:bg-sky-950/20", border: "border-sky-200 dark:border-sky-800", chip: "bg-sky-500" },
  "London Leasing":      { bg: "bg-yellow-50/50 dark:bg-yellow-950/20", border: "border-yellow-200 dark:border-yellow-800", chip: "bg-yellow-500" },
  "Unassigned":          { bg: "bg-muted/40", border: "border-border", chip: "bg-gray-400" },
};

function normaliseGroup(g: string | null | undefined): string {
  if (!g) return "Unassigned";
  // If the stored group matches a column exactly, use it; otherwise drop
  // to Unassigned so the card is at least visible.
  return COLUMNS.includes(g) ? g : "Unassigned";
}

function MemberCard({ member, onClick, onDragStart }: {
  member: TeamMember;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const photoUrl = `/api/hr/photo/${member.user_id}`;
  const displayName = member.full_name || member.username || "Unknown";
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="group relative w-full text-left bg-card border rounded-lg shadow-sm hover:shadow-md hover:border-primary/40 transition-all px-2.5 py-2"
      data-testid={`team-member-card-${member.id}`}
    >
      {member.property_count > 0 && (
        <div className="absolute -top-1.5 -right-1.5 bg-indigo-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center shadow">
          {member.property_count}
        </div>
      )}
      <div className="flex items-center gap-2">
        <GripVertical className="w-3 h-3 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0" />
        <img
          src={photoUrl}
          alt={displayName}
          className="w-9 h-9 rounded-full object-cover border bg-muted shrink-0"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
        />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[12px] leading-tight truncate" title={displayName}>{displayName}</div>
          {member.bgp_title && <div className="text-[10px] text-muted-foreground truncate" title={member.bgp_title}>{member.bgp_title}</div>}
          {member.role && (
            <div className="text-[10px] text-indigo-600 dark:text-indigo-400 truncate mt-0.5" title={member.role}>{member.role}</div>
          )}
        </div>
      </div>
    </button>
  );
}

export function ClientTeamOrgChart({ clientCompanyId }: { clientCompanyId: string }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<TeamMember | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const draggingId = useRef<string | null>(null);

  const { data: members = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/client-teams", clientCompanyId],
    queryFn: async () => {
      const r = await fetch(`/api/client-teams/${clientCompanyId}`, { headers: getAuthHeaders() });
      if (!r.ok) throw new Error("LOAD_FAILED");
      return r.json();
    },
    enabled: !!clientCompanyId,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: any }) => apiRequest("PATCH", `/api/client-teams/member/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/client-teams", clientCompanyId] }),
  });

  // Bucket members into columns; track the account-lead (highest property
  // count, ties broken by name) so it can sit as an apex card above.
  const byColumn = useMemo(() => {
    const map: Record<string, TeamMember[]> = {};
    for (const c of COLUMNS) map[c] = [];
    for (const m of members) map[normaliseGroup(m.team_group)].push(m);
    for (const c of COLUMNS) {
      map[c].sort((a, b) => (a.sort_order - b.sort_order) || (a.full_name || "").localeCompare(b.full_name || ""));
    }
    return map;
  }, [members]);

  const apex = useMemo<TeamMember | null>(() => {
    if (members.length === 0) return null;
    // Whoever has the most properties on this client is the account lead.
    // Falls back to first by name if everyone's on zero.
    return [...members].sort((a, b) =>
      (b.property_count - a.property_count) || (a.full_name || "").localeCompare(b.full_name || "")
    )[0];
  }, [members]);

  useEffect(() => {
    if (selected) {
      const fresh = members.find(m => m.id === selected.id);
      if (fresh) setSelected(fresh);
    }
  }, [members]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDrop = (column: string) => {
    setDragOver(null);
    const id = draggingId.current;
    draggingId.current = null;
    if (!id) return;
    const m = members.find(x => x.id === id);
    if (!m) return;
    const currentColumn = normaliseGroup(m.team_group);
    if (currentColumn === column) return;
    // Persist the move via PATCH. Optimistic update keeps the card in
    // the new column while the request is in flight.
    queryClient.setQueryData<TeamMember[]>(["/api/client-teams", clientCompanyId], (prev) => {
      if (!prev) return prev;
      return prev.map(x => x.id === id ? { ...x, team_group: column === "Unassigned" ? null : column } : x);
    });
    updateMutation.mutate({ id, patch: { team_group: column === "Unassigned" ? null : column } });
  };

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading team...</div>;
  }

  return (
    <div className="space-y-3" data-testid="client-team-orgchart">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">{members.length} team member{members.length === 1 ? "" : "s"}</Badge>
          {apex && (
            <span className="text-[11px] text-muted-foreground">Lead: <span className="font-medium text-foreground">{apex.full_name || apex.username}</span></span>
          )}
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAdd(true)} data-testid="btn-add-team-member">
          <Plus className="w-3 h-3 mr-1" />Add to team
        </Button>
      </div>

      {members.length === 0 ? (
        <div className="border rounded-lg py-12 flex flex-col items-center justify-center text-muted-foreground text-sm">
          <Building2 className="w-8 h-8 opacity-30 mb-2" />
          <div>No BGP team assigned yet</div>
          <div className="text-xs mt-1">Click "Add to team" to get started</div>
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-2 min-w-max">
            {COLUMNS.map(col => {
              const style = COLUMN_STYLES[col];
              const peeps = byColumn[col] || [];
              const isOver = dragOver === col;
              return (
                <div
                  key={col}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(col); }}
                  onDragLeave={() => setDragOver(prev => prev === col ? null : prev)}
                  onDrop={() => handleDrop(col)}
                  className={`w-[220px] shrink-0 rounded-lg border ${style.border} ${isOver ? "ring-2 ring-primary/60 ring-offset-1" : ""} ${style.bg} p-2 flex flex-col gap-2`}
                  data-testid={`team-column-${col.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${style.chip}`} />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{col}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground/70">{peeps.length}</span>
                  </div>
                  {peeps.length === 0 ? (
                    <div className="flex-1 min-h-[60px] flex items-center justify-center text-[11px] text-muted-foreground/50 italic">
                      drop here
                    </div>
                  ) : (
                    peeps.map(m => (
                      <MemberCard
                        key={m.id}
                        member={m}
                        onClick={() => setSelected(m)}
                        onDragStart={(e) => {
                          draggingId.current = m.id;
                          e.dataTransfer.effectAllowed = "move";
                        }}
                      />
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selected && (
        <MemberSheet
          member={selected}
          allMembers={members}
          clientCompanyId={clientCompanyId}
          onClose={() => setSelected(null)}
          onChange={() => queryClient.invalidateQueries({ queryKey: ["/api/client-teams", clientCompanyId] })}
        />
      )}

      {showAdd && (
        <AddMemberDialog
          clientCompanyId={clientCompanyId}
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            queryClient.invalidateQueries({ queryKey: ["/api/client-teams", clientCompanyId] });
          }}
        />
      )}
    </div>
  );
}

function MemberSheet({ member, allMembers, clientCompanyId, onClose, onChange }: {
  member: TeamMember;
  allMembers: TeamMember[];
  clientCompanyId: string;
  onClose: () => void;
  onChange: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useTryToast();
  const [teamGroup, setTeamGroup] = useState(member.team_group || "Unassigned");
  const [role, setRole] = useState(member.role || "");
  const [reportsTo, setReportsTo] = useState(member.reports_to_user_id || "");
  const [propBusy, setPropBusy] = useState(false);

  useEffect(() => {
    setTeamGroup(member.team_group || "Unassigned");
    setRole(member.role || "");
    setReportsTo(member.reports_to_user_id || "");
  }, [member.id]);

  const photoUrl = `/api/hr/photo/${member.user_id}`;
  const displayName = member.full_name || member.username || "Unknown";

  const updateMutation = useMutation({
    mutationFn: (patch: any) => apiRequest("PATCH", `/api/client-teams/member/${member.id}`, patch),
    onSuccess: () => { onChange(); toast({ title: "Updated" }); },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/client-teams/member/${member.id}`),
    onSuccess: () => { onChange(); onClose(); toast({ title: "Removed from team" }); },
    onError: (e: any) => toast({ title: "Remove failed", description: e.message, variant: "destructive" }),
  });

  const propertiesQuery = useQuery<PropertyAssignment[]>({
    queryKey: ["/api/client-teams", clientCompanyId, "member", member.user_id, "properties"],
    queryFn: async () => {
      const r = await fetch(`/api/client-teams/${clientCompanyId}/member/${member.user_id}/properties`, { headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const toggleProperty = async (propertyId: string, assigned: boolean) => {
    setPropBusy(true);
    // Optimistic flip.
    queryClient.setQueryData<PropertyAssignment[]>(
      ["/api/client-teams", clientCompanyId, "member", member.user_id, "properties"],
      (prev) => prev?.map(p => p.id === propertyId ? { ...p, assigned: !assigned } : p)
    );
    try {
      const body = assigned ? { remove: [propertyId] } : { add: [propertyId] };
      await apiRequest("POST", `/api/client-teams/${clientCompanyId}/member/${member.user_id}/properties`, body);
      // Refresh property_count badge on the card by re-querying the team.
      queryClient.invalidateQueries({ queryKey: ["/api/client-teams", clientCompanyId] });
    } catch (e: any) {
      // Roll back optimistic flip.
      queryClient.setQueryData<PropertyAssignment[]>(
        ["/api/client-teams", clientCompanyId, "member", member.user_id, "properties"],
        (prev) => prev?.map(p => p.id === propertyId ? { ...p, assigned } : p)
      );
      toast({ title: "Allocation failed", description: e.message, variant: "destructive" });
    } finally {
      setPropBusy(false);
    }
  };

  const bossOptions = useMemo(() => allMembers.filter(m => m.user_id !== member.user_id), [allMembers, member.user_id]);

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-[440px] sm:max-w-[440px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{displayName}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-3">
          <div className="flex items-start gap-3">
            <img
              src={photoUrl}
              alt={displayName}
              className="w-20 h-20 rounded-full object-cover border bg-gray-100 dark:bg-gray-800 flex-shrink-0"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
            />
            <div className="flex-1 min-w-0 space-y-1">
              {member.bgp_title && <div className="text-sm">{member.bgp_title}</div>}
              {member.email && (
                <a href={`mailto:${member.email}`} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                  <Mail className="w-3 h-3" />{member.email}
                </a>
              )}
              <div className="text-xs text-muted-foreground">{member.property_count} {member.property_count === 1 ? "property" : "properties"} on this client</div>
              <Link href={`/hr/staff/${member.user_id}`} className="text-xs text-indigo-500 hover:underline inline-block">Open full HR profile →</Link>
            </div>
          </div>

          <div className="space-y-2 border-t pt-3">
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Team group</label>
              <Select
                value={teamGroup}
                onValueChange={(v) => {
                  setTeamGroup(v);
                  updateMutation.mutate({ team_group: v === "Unassigned" ? null : v });
                }}
              >
                <SelectTrigger className="h-8 text-sm" data-testid="member-team-group">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COLUMNS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Role on this client</label>
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                onBlur={() => { if (role !== (member.role || "")) updateMutation.mutate({ role: role || null }); }}
                placeholder="ED, Head — Investment"
                className="h-8 text-sm"
                data-testid="member-role"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Reports to</label>
              <select
                value={reportsTo}
                onChange={(e) => { setReportsTo(e.target.value); updateMutation.mutate({ reports_to_user_id: e.target.value || null }); }}
                className="h-8 text-sm w-full border rounded px-2 bg-white dark:bg-gray-800"
                data-testid="member-reports-to"
              >
                <option value="">— No one (top of tree)</option>
                {bossOptions.map(b => (
                  <option key={b.id} value={b.user_id}>{b.full_name || b.username}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="border-t pt-3">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Properties on this client</label>
            {propertiesQuery.isLoading ? (
              <div className="text-xs text-muted-foreground flex items-center gap-2 mt-2"><Loader2 className="w-3 h-3 animate-spin" />Loading properties…</div>
            ) : (propertiesQuery.data || []).length === 0 ? (
              <div className="text-xs text-muted-foreground mt-2 italic">This client has no properties yet.</div>
            ) : (
              <div className="mt-2 max-h-[260px] overflow-y-auto border rounded-md divide-y">
                {(propertiesQuery.data || []).map(p => (
                  <label key={p.id} className="flex items-start gap-2 px-2 py-1.5 hover:bg-accent/40 cursor-pointer text-xs">
                    <Checkbox
                      checked={p.assigned}
                      disabled={propBusy}
                      onCheckedChange={() => toggleProperty(p.id, p.assigned)}
                      className="mt-0.5"
                      data-testid={`property-allocation-${p.id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.name}</div>
                      {p.address && <div className="text-[10px] text-muted-foreground truncate">{p.address}</div>}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {(member.cv_summary || member.bio) && (
            <div className="border-t pt-3 space-y-2">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">From HR</div>
              {member.cv_summary && <div className="text-xs leading-relaxed whitespace-pre-wrap">{member.cv_summary}</div>}
              {!member.cv_summary && member.bio && <div className="text-xs leading-relaxed whitespace-pre-wrap">{member.bio}</div>}
              {member.cv_specialisms && member.cv_specialisms.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {member.cv_specialisms.map((s, i) => <Badge key={i} variant="outline" className="text-[10px]">{s}</Badge>)}
                </div>
              )}
            </div>
          )}

          <div className="border-t pt-3">
            <Button
              variant="destructive"
              size="sm"
              className="text-xs h-7"
              onClick={() => { if (confirm(`Remove ${displayName} from this client's team?`)) removeMutation.mutate(); }}
              disabled={removeMutation.isPending}
              data-testid="btn-remove-member"
            >
              Remove from team
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AddMemberDialog({ clientCompanyId, onClose, onAdded }: {
  clientCompanyId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { toast } = useTryToast();
  const [search, setSearch] = useState("");
  const { data: candidates = [], isLoading } = useQuery<Candidate[]>({
    queryKey: ["/api/client-teams", clientCompanyId, "candidates"],
    queryFn: async () => {
      const r = await fetch(`/api/client-teams/${clientCompanyId}/candidates`, { headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: (user_id: string) => apiRequest("POST", `/api/client-teams/${clientCompanyId}/member`, { user_id, team_group: "Unassigned" }),
    onSuccess: () => { toast({ title: "Added to team" }); onAdded(); },
    onError: (e: any) => toast({ title: "Add failed", description: e.message, variant: "destructive" }),
  });

  const filtered = candidates.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (c.full_name || "").toLowerCase().includes(q)
      || (c.username || "").toLowerCase().includes(q)
      || (c.email || "").toLowerCase().includes(q);
  });

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add to team</SheetTitle>
        </SheetHeader>
        <div className="mt-3 space-y-2">
          <Input placeholder="Search BGP staff..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-sm" data-testid="add-member-search" />
          {isLoading ? (
            <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" />Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center">No candidates — everyone on the BGP team is already on this client.</div>
          ) : (
            <div className="space-y-1">
              {filtered.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => addMutation.mutate(c.id)}
                  disabled={addMutation.isPending}
                  className="w-full flex items-center gap-2 p-2 border rounded hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                  data-testid={`add-member-candidate-${c.id}`}
                >
                  <img
                    src={`/api/hr/photo/${c.id}`}
                    alt={c.full_name || c.username || ""}
                    className="w-8 h-8 rounded-full object-cover border bg-gray-100 flex-shrink-0"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{c.full_name || c.username}</div>
                    {c.bgp_title && <div className="text-[10px] text-muted-foreground truncate">{c.bgp_title}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function useTryToast() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useToast } = require("@/hooks/use-toast");
    return useToast();
  } catch {
    return { toast: () => {} };
  }
}
