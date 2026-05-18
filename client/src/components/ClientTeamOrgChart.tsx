import { useMemo, useState, useEffect } from "react";
import { ReactFlow, Background, Controls, MiniMap, Handle, Position } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { Link } from "wouter";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, X, Building2, Mail } from "lucide-react";

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

// Card dimensions used by the layout algorithm. Kept consistent so the
// auto-layout's coordinate math matches the rendered size.
const NODE_W = 200;
const NODE_H = 96;
const COL_GAP = 40;
const ROW_GAP = 32;

// Custom node — headshot, name, BGP title, role pill. Click opens the
// side sheet (handled by the parent via onNodeClick).
function MemberNode({ data }: { data: any }) {
  const m = data.member as TeamMember;
  const photoUrl = `/api/hr/photo/${m.user_id}`;
  const displayName = m.full_name || m.username || "Unknown";
  return (
    <div
      className="relative bg-white dark:bg-gray-900 border rounded-lg shadow-sm hover:shadow-md transition-shadow"
      style={{ width: NODE_W, height: NODE_H }}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-300 !w-2 !h-2" />
      {m.property_count > 0 && (
        <div className="absolute -top-2 -right-2 bg-indigo-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center shadow">
          {m.property_count}
        </div>
      )}
      <div className="flex items-center gap-2 p-2 h-full">
        <img
          src={photoUrl}
          alt={displayName}
          className="w-14 h-14 rounded-full object-cover border bg-gray-100 dark:bg-gray-800 flex-shrink-0"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
        />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-xs truncate" title={displayName}>{displayName}</div>
          {m.bgp_title && <div className="text-[10px] text-muted-foreground truncate" title={m.bgp_title}>{m.bgp_title}</div>}
          {m.role && (
            <div className="text-[10px] text-indigo-600 dark:text-indigo-400 truncate mt-0.5" title={m.role}>{m.role}</div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-300 !w-2 !h-2" />
    </div>
  );
}

// Team-group header chip — narrow, light-bg cards above the column.
function GroupHeaderNode({ data }: { data: any }) {
  return (
    <div
      className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-center text-[11px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200 px-2 py-1.5 shadow-sm"
      style={{ width: data.width, minHeight: 36 }}
    >
      {data.label}
    </div>
  );
}

const nodeTypes = { member: MemberNode, groupHeader: GroupHeaderNode };

// Auto-layout — group members by team_group, compute depth via reports_to
// BFS, and place each member in (column = team_group index, row = depth).
// Roots without a team_group sit centred above the columns as the apex.
function autoLayout(members: TeamMember[]) {
  const byId = new Map(members.map(m => [m.user_id, m] as const));
  // depth per user_id — climb the reports_to chain
  const depthCache = new Map<string, number>();
  const computeDepth = (m: TeamMember, seen = new Set<string>()): number => {
    if (depthCache.has(m.user_id)) return depthCache.get(m.user_id)!;
    if (!m.reports_to_user_id || !byId.has(m.reports_to_user_id) || seen.has(m.user_id)) {
      depthCache.set(m.user_id, 0);
      return 0;
    }
    const seenNext = new Set(seen);
    seenNext.add(m.user_id);
    const d = 1 + computeDepth(byId.get(m.reports_to_user_id)!, seenNext);
    depthCache.set(m.user_id, d);
    return d;
  };
  for (const m of members) computeDepth(m);

  // Apex = the root with the most direct reports (Managing Director slot).
  // Others-without-a-reports_to drop into depth 1.
  const directReportCount = new Map<string, number>();
  for (const m of members) {
    if (m.reports_to_user_id) {
      directReportCount.set(m.reports_to_user_id, (directReportCount.get(m.reports_to_user_id) || 0) + 1);
    }
  }
  const roots = members.filter(m => !m.reports_to_user_id || !byId.has(m.reports_to_user_id || ""));
  roots.sort((a, b) => (directReportCount.get(b.user_id) || 0) - (directReportCount.get(a.user_id) || 0));
  const apex = roots[0] || null;
  const apexId = apex?.user_id || null;

  // Columns = distinct team_group values, sorted alphabetically except a
  // pinned "Unassigned" at the end. The apex sits above all columns.
  const groups = [...new Set(members
    .filter(m => m.user_id !== apexId)
    .map(m => m.team_group || "Unassigned")
  )];
  groups.sort((a, b) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    return a.localeCompare(b);
  });
  const colX = (group: string) => groups.indexOf(group) * (NODE_W + COL_GAP);
  const totalWidth = groups.length * (NODE_W + COL_GAP) - COL_GAP;

  const nodes: any[] = [];
  const edges: any[] = [];

  // Apex node centred above the columns.
  if (apex) {
    nodes.push({
      id: `m-${apex.id}`,
      type: "member",
      position: { x: Math.max(0, totalWidth / 2 - NODE_W / 2), y: 0 },
      data: { member: apex },
    });
  }

  // Team-group headers — one row beneath the apex.
  for (const g of groups) {
    nodes.push({
      id: `g-${g}`,
      type: "groupHeader",
      position: { x: colX(g), y: apex ? NODE_H + ROW_GAP : 0 },
      data: { label: g, width: NODE_W },
      draggable: false,
      selectable: false,
    });
  }

  // For each column, rank members by depth (smallest first), break ties by
  // sort_order then full_name.
  const headerY = (apex ? NODE_H + ROW_GAP : 0) + 36 + ROW_GAP;
  const colCursor = new Map<string, number>(groups.map(g => [g, 0]));
  const ordered = [...members].filter(m => m.user_id !== apexId);
  ordered.sort((a, b) => {
    const da = computeDepth(a);
    const db = computeDepth(b);
    if (da !== db) return da - db;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return (a.full_name || "").localeCompare(b.full_name || "");
  });
  for (const m of ordered) {
    const g = m.team_group || "Unassigned";
    const row = colCursor.get(g) || 0;
    nodes.push({
      id: `m-${m.id}`,
      type: "member",
      position: { x: colX(g), y: headerY + row * (NODE_H + ROW_GAP) },
      data: { member: m },
    });
    colCursor.set(g, row + 1);
  }

  // Edges — only render reports_to lines for users who have a known boss
  // also on the team.
  for (const m of members) {
    if (!m.reports_to_user_id) continue;
    const boss = members.find(x => x.user_id === m.reports_to_user_id);
    if (!boss) continue;
    edges.push({
      id: `e-${boss.id}-${m.id}`,
      source: `m-${boss.id}`,
      target: `m-${m.id}`,
      type: "smoothstep",
      style: { stroke: "#94a3b8", strokeWidth: 1.5 },
    });
  }

  return { nodes, edges };
}

export function ClientTeamOrgChart({ clientCompanyId }: { clientCompanyId: string }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<TeamMember | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const { data: members = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/client-teams", clientCompanyId],
    queryFn: async () => {
      const r = await fetch(`/api/client-teams/${clientCompanyId}`, { headers: getAuthHeaders() });
      if (!r.ok) throw new Error("LOAD_FAILED");
      return r.json();
    },
    enabled: !!clientCompanyId,
  });

  const { nodes, edges } = useMemo(() => autoLayout(members), [members]);

  // Keep the side-sheet's member object in sync with the latest server data
  // so edits to role / team_group / reports_to reflect without re-clicking.
  useEffect(() => {
    if (selected) {
      const fresh = members.find(m => m.id === selected.id);
      if (fresh && fresh !== selected) setSelected(fresh);
    }
  }, [members]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading team...</div>;
  }

  return (
    <div className="space-y-3" data-testid="client-team-orgchart">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">{members.length} team member{members.length === 1 ? "" : "s"}</Badge>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAdd(true)} data-testid="btn-add-team-member">
          <Plus className="w-3 h-3 mr-1" />Add to team
        </Button>
      </div>

      <div className="border rounded-lg" style={{ height: 600 }}>
        {members.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 text-sm">
            <Building2 className="w-8 h-8 opacity-30 mb-2" />
            <div>No BGP team assigned yet</div>
            <div className="text-xs mt-1">Click "Add to team" to get started</div>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            onNodeClick={(_, node) => {
              if (node.type !== "member") return;
              const m = (node.data as any).member as TeamMember;
              setSelected(m);
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} color="#e2e8f0" />
            <Controls showInteractive={false} />
            <MiniMap zoomable pannable className="!bg-white dark:!bg-gray-900 !border" />
          </ReactFlow>
        )}
      </div>

      {selected && (
        <MemberSheet
          member={selected}
          allMembers={members}
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

function MemberSheet({ member, allMembers, onClose, onChange }: {
  member: TeamMember;
  allMembers: TeamMember[];
  onClose: () => void;
  onChange: () => void;
}) {
  const { toast } = useTryToast();
  const [teamGroup, setTeamGroup] = useState(member.team_group || "");
  const [role, setRole] = useState(member.role || "");
  const [reportsTo, setReportsTo] = useState(member.reports_to_user_id || "");

  useEffect(() => {
    setTeamGroup(member.team_group || "");
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

  const groupOptions = useMemo(() => {
    const s = new Set<string>();
    for (const m of allMembers) if (m.team_group) s.add(m.team_group);
    return [...s].sort();
  }, [allMembers]);

  const bossOptions = useMemo(() => allMembers.filter(m => m.user_id !== member.user_id), [allMembers, member.user_id]);

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] overflow-y-auto">
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
              <Input
                value={teamGroup}
                onChange={(e) => setTeamGroup(e.target.value)}
                onBlur={() => { if (teamGroup !== (member.team_group || "")) updateMutation.mutate({ team_group: teamGroup || null }); }}
                placeholder="Investment / Lease Advisory / ..."
                list={`team-groups-${member.id}`}
                className="h-8 text-sm"
                data-testid="member-team-group"
              />
              <datalist id={`team-groups-${member.id}`}>
                {groupOptions.map(g => <option key={g} value={g} />)}
              </datalist>
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

// Toast helper — falls back to a no-op when the toast provider isn't
// mounted, so the org chart works embedded anywhere on the company page.
function useTryToast() {
  try {
    // Lazy require so we don't crash builds that don't ship the hook.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useToast } = require("@/hooks/use-toast");
    return useToast();
  } catch {
    return { toast: () => {} };
  }
}
