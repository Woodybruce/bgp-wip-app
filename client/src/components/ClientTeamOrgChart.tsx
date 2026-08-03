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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Loader2, Plus, Building2, Mail, GripVertical, MoreHorizontal, Star, Pencil, Trash2, Check } from "lucide-react";

interface TeamMember {
  id: string;
  client_company_id: string;
  user_id: string;
  team_group: string | null;
  role: string | null;
  reports_to_user_id: string | null;
  sort_order: number;
  is_lead: boolean;
  username: string | null;
  full_name: string | null;
  email: string | null;
  bgp_title: string | null;
  cv_summary: string | null;
  cv_specialisms: string[] | null;
  bio: string | null;
  property_count: number;
  properties?: string[] | null;
}

interface Candidate {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  bgp_title: string | null;
  existing_count?: number;
}

interface PropertyAssignment {
  id: string;
  name: string;
  // Server coalesces address (JSONB) into a single readable line, but in
  // case a future endpoint sends the raw object through, render defensively.
  address: string | { address?: string; street?: string; city?: string; postcode?: string } | null;
  assigned: boolean;
}

function readableAddress(a: PropertyAssignment["address"]): string {
  if (!a) return "";
  if (typeof a === "string") return a;
  return a.address || a.street || a.city || a.postcode || "";
}

interface ColumnDef {
  name: string;
  sort_order: number;
  color_key: string | null;
}

const COLOR_PALETTE: Record<string, { bg: string; border: string; chip: string }> = {
  purple:  { bg: "bg-purple-50/50 dark:bg-purple-950/20", border: "border-purple-200 dark:border-purple-800", chip: "bg-purple-500" },
  emerald: { bg: "bg-emerald-50/50 dark:bg-emerald-950/20", border: "border-emerald-200 dark:border-emerald-800", chip: "bg-emerald-500" },
  amber:   { bg: "bg-amber-50/50 dark:bg-amber-950/20", border: "border-amber-200 dark:border-amber-800", chip: "bg-amber-500" },
  orange:  { bg: "bg-orange-50/50 dark:bg-orange-950/20", border: "border-orange-200 dark:border-orange-800", chip: "bg-orange-500" },
  pink:    { bg: "bg-pink-50/50 dark:bg-pink-950/20", border: "border-pink-200 dark:border-pink-800", chip: "bg-pink-500" },
  sky:     { bg: "bg-sky-50/50 dark:bg-sky-950/20", border: "border-sky-200 dark:border-sky-800", chip: "bg-sky-500" },
  yellow:  { bg: "bg-yellow-50/50 dark:bg-yellow-950/20", border: "border-yellow-200 dark:border-yellow-800", chip: "bg-yellow-500" },
  slate:   { bg: "bg-muted/40", border: "border-border", chip: "bg-gray-400" },
};
// Fallback colour for the 7 default column names — keeps the look
// consistent across clients that haven't customised yet.
const DEFAULT_COLOUR_BY_NAME: Record<string, string> = {
  "Office / Corporate": "purple",
  "Investment": "emerald",
  "Lease Advisory": "amber",
  "National Leasing": "orange",
  "Development": "pink",
  "Tenant Rep": "sky",
  "London Leasing": "yellow",
};

function styleForColumn(col: ColumnDef) {
  const key = col.color_key || DEFAULT_COLOUR_BY_NAME[col.name] || "slate";
  return COLOR_PALETTE[key] || COLOR_PALETTE.slate;
}

function MemberCard({ member, onClick, onDragStart, isLead, onDragOver, onDrop, readOnly }: {
  member: TeamMember;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  isLead: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  readOnly?: boolean;
}) {
  const photoUrl = `/api/hr/photo/${member.user_id}`;
  const displayName = member.full_name || member.username || "Unknown";
  return (
    <button
      type="button"
      draggable={!readOnly}
      onDragStart={readOnly ? undefined : onDragStart}
      onDragOver={readOnly ? undefined : onDragOver}
      onDrop={readOnly ? undefined : onDrop}
      onClick={readOnly ? undefined : onClick}
      className={`group relative w-full text-left bg-card border rounded-lg shadow-sm transition-all px-2.5 py-2 ${readOnly ? "cursor-default" : "hover:shadow-md hover:border-primary/40"} ${isLead ? "border-amber-300/70 dark:border-amber-700/60" : ""}`}
      data-testid={`team-member-card-${member.id}`}
    >
      {isLead && (
        <div className="absolute -top-1.5 -left-1.5 bg-amber-400 text-white rounded-full w-5 h-5 flex items-center justify-center shadow" title="Account lead">
          <Star className="w-3 h-3" fill="currentColor" />
        </div>
      )}
      {member.property_count > 0 && (
        <div className="absolute -top-1.5 -right-1.5 bg-indigo-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center shadow">
          {member.property_count}
        </div>
      )}
      <div className="flex items-center gap-2">
        {!readOnly && <GripVertical className="w-3 h-3 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0" />}
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
          {Array.isArray(member.properties) && member.properties.length > 0 && (
            <div
              className="text-[10px] text-muted-foreground truncate mt-0.5"
              title={member.properties.join(", ")}
            >
              {member.properties.slice(0, 2).join(", ")}
              {member.properties.length > 2 ? ` +${member.properties.length - 2}` : ""}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

export function ClientTeamOrgChart({ clientCompanyId }: { clientCompanyId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useTryToast();
  const [selected, setSelected] = useState<TeamMember | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const draggingId = useRef<string | null>(null);
  const [renamingCol, setRenamingCol] = useState<string | null>(null);
  const [newColName, setNewColName] = useState("");
  const [showAddCol, setShowAddCol] = useState(false);
  const [addColName, setAddColName] = useState("");

  // The client (Landsec) app gets the SAME board as the internal client
  // page — bench visible, fully editable (Woody, 2026-07: the Landsec app
  // "should mirror our internal client Landsec board"). Server-side the
  // client-teams writes are opened in index.ts's client write allowlist.
  const readOnly = false;

  const { data: members = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/client-teams", clientCompanyId],
    queryFn: async () => {
      const r = await fetch(`/api/client-teams/${clientCompanyId}`, { headers: getAuthHeaders() });
      if (!r.ok) throw new Error("LOAD_FAILED");
      return r.json();
    },
    enabled: !!clientCompanyId,
  });

  const { data: columns = [] } = useQuery<ColumnDef[]>({
    queryKey: ["/api/client-teams", clientCompanyId, "columns"],
    queryFn: async () => {
      const r = await fetch(`/api/client-teams/${clientCompanyId}/columns`, { headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!clientCompanyId,
  });

  // Columns list always includes Unassigned at the end as a catch-all so
  // a freshly added member or a deleted-column orphan is never invisible.
  const columnList = useMemo<ColumnDef[]>(() => {
    const base = [...columns].sort((a, b) => a.sort_order - b.sort_order);
    if (!base.find(c => c.name === "Unassigned")) {
      base.push({ name: "Unassigned", sort_order: 999, color_key: "slate" });
    }
    return base;
  }, [columns]);

  // Bucket members by column name. Anything whose team_group doesn't
  // match a real column falls into Unassigned so the card stays visible.
  const byColumn = useMemo(() => {
    const valid = new Set(columnList.map(c => c.name));
    const map: Record<string, TeamMember[]> = {};
    for (const c of columnList) map[c.name] = [];
    for (const m of members) {
      const key = m.team_group && valid.has(m.team_group) ? m.team_group : "Unassigned";
      map[key].push(m);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => (a.sort_order - b.sort_order) || (a.full_name || "").localeCompare(b.full_name || ""));
    }
    return map;
  }, [members, columnList]);

  // Count what's actually rendered — the badge lied when hidden buckets
  // dropped members ("12 team members" over 8 cards).
  const visibleMemberCount = useMemo(() => {
    const ids = new Set<string>();
    for (const list of Object.values(byColumn)) for (const m of list) ids.add(m.user_id);
    return ids.size;
  }, [byColumn]);

  // Pinned lead wins; otherwise fall back to highest property_count as a
  // hint until the user nominates someone explicitly.
  const lead = useMemo<TeamMember | null>(() => {
    const pinned = members.find(m => m.is_lead);
    if (pinned) return pinned;
    if (members.length === 0) return null;
    const sorted = [...members].sort((a, b) =>
      (b.property_count - a.property_count) || (a.full_name || "").localeCompare(b.full_name || "")
    );
    return sorted[0].property_count > 0 ? sorted[0] : null;
  }, [members]);

  useEffect(() => {
    if (selected) {
      // Fall back to user_id — editing an auto-included "pa-…" row converts
      // it to a curated row with a fresh id, and the sheet must re-bind to
      // that row or every subsequent edit re-converts (duplicating them).
      const fresh = members.find(m => m.id === selected.id)
        || members.find(m => m.user_id === selected.user_id);
      if (fresh) setSelected(fresh);
    }
  }, [members]); // eslint-disable-line react-hooks/exhaustive-deps

  const reorderMutation = useMutation({
    mutationFn: (items: Array<{ id: string; team_group: string | null; sort_order: number }>) =>
      apiRequest("POST", `/api/client-teams/${clientCompanyId}/reorder`, { items }),
    onError: (e: any) => toast({ title: "Move failed", description: e?.message || "Unknown error", variant: "destructive" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/client-teams", clientCompanyId] }),
  });

  // Compute the new in-column stack after a drag, then ship a single
  // bulk-reorder so sort_order is consistent across the whole column.
  const handleDropOnCard = (targetMember: TeamMember) => {
    const id = draggingId.current;
    draggingId.current = null;
    setDragOverCol(null);
    if (!id || id === targetMember.id) return;
    const dragged = members.find(m => m.id === id);
    if (!dragged) return;
    const targetCol = targetMember.team_group || "Unassigned";
    // Build the new ordered list for the target column with the dragged
    // member inserted directly *above* the target card.
    const existing = byColumn[targetCol].filter(m => m.id !== dragged.id);
    const idx = existing.findIndex(m => m.id === targetMember.id);
    const before = existing.slice(0, idx);
    const after = existing.slice(idx);
    const newOrder = [...before, { ...dragged, team_group: targetCol === "Unassigned" ? null : targetCol }, ...after];
    const items = newOrder.map((m, i) => ({ id: m.id, team_group: m.team_group ?? "Unassigned", sort_order: i }));
    // Optimistic — update the cache so the card visibly lands in place.
    queryClient.setQueryData<TeamMember[]>(["/api/client-teams", clientCompanyId], (prev) => {
      if (!prev) return prev;
      const next = prev.map(m => {
        const it = items.find(x => x.id === m.id);
        if (!it) return m;
        return { ...m, team_group: it.team_group === "Unassigned" ? null : it.team_group, sort_order: it.sort_order };
      });
      return next;
    });
    reorderMutation.mutate(items);
  };

  const handleDropOnColumn = (column: string) => {
    const id = draggingId.current;
    draggingId.current = null;
    setDragOverCol(null);
    if (!id) return;
    const dragged = members.find(m => m.id === id);
    if (!dragged) return;
    if ((dragged.team_group || "Unassigned") === column) return;
    // Append to the bottom of the destination column.
    const dest = (byColumn[column] || []).filter(m => m.id !== dragged.id);
    const items = [
      ...dest.map((m, i) => ({ id: m.id, team_group: column, sort_order: i })),
      { id: dragged.id, team_group: column, sort_order: dest.length },
    ];
    queryClient.setQueryData<TeamMember[]>(["/api/client-teams", clientCompanyId], (prev) => {
      if (!prev) return prev;
      return prev.map(m => {
        if (m.id === dragged.id) return { ...m, team_group: column === "Unassigned" ? null : column, sort_order: dest.length };
        return m;
      });
    });
    reorderMutation.mutate(items);
  };

  // --- Column management ---

  const renameColumn = useMutation({
    mutationFn: ({ oldName, name }: { oldName: string; name: string }) =>
      apiRequest("PATCH", `/api/client-teams/${clientCompanyId}/columns/${encodeURIComponent(oldName)}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-teams", clientCompanyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/client-teams", clientCompanyId, "columns"] });
    },
    onError: (e: any) => {
      toast({ title: "Rename failed", description: e?.message || "Unknown error", variant: "destructive" });
    },
  });
  const deleteColumn = useMutation({
    mutationFn: (name: string) =>
      apiRequest("DELETE", `/api/client-teams/${clientCompanyId}/columns/${encodeURIComponent(name)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-teams", clientCompanyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/client-teams", clientCompanyId, "columns"] });
    },
    onError: (e: any) => {
      toast({ title: "Delete failed", description: e?.message || "Unknown error", variant: "destructive" });
    },
  });
  const addColumn = useMutation({
    mutationFn: (name: string) =>
      apiRequest("POST", `/api/client-teams/${clientCompanyId}/columns`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-teams", clientCompanyId, "columns"] });
      setShowAddCol(false);
      setAddColName("");
      toast({ title: "Column added" });
    },
    onError: (e: any) => {
      toast({ title: "Add column failed", description: e?.message || "Unknown error", variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading team...</div>;
  }

  return (
    <div className="space-y-3" data-testid="client-team-orgchart">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">{visibleMemberCount} team member{visibleMemberCount === 1 ? "" : "s"}</Badge>
          {lead ? (
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Star className="w-3 h-3 text-amber-500" fill="currentColor" />
              Lead: <span className="font-medium text-foreground">{lead.full_name || lead.username}</span>
              {!lead.is_lead && !readOnly && <span className="text-[10px] text-muted-foreground/70">(auto)</span>}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground italic">{readOnly ? "" : "No lead pinned"}</span>
          )}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAddCol(true)} data-testid="btn-add-column">
              <Plus className="w-3 h-3 mr-1" />Add column
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAdd(true)} data-testid="btn-add-team-member">
              <Plus className="w-3 h-3 mr-1" />Add to team
            </Button>
          </div>
        )}
      </div>

      {showAddCol && (
        <div className="flex items-center gap-2 bg-muted/50 p-2 rounded-md">
          <Input
            autoFocus
            value={addColName}
            onChange={(e) => setAddColName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && addColName.trim()) addColumn.mutate(addColName.trim());
              if (e.key === "Escape") { setShowAddCol(false); setAddColName(""); }
            }}
            placeholder="New column name (e.g. Asset Management)"
            className="h-7 text-sm"
            data-testid="input-new-column-name"
          />
          <Button size="sm" className="h-7 text-xs" onClick={() => addColName.trim() && addColumn.mutate(addColName.trim())} disabled={addColumn.isPending}>
            Add
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowAddCol(false); setAddColName(""); }}>
            Cancel
          </Button>
        </div>
      )}

      {members.length === 0 ? (
        <div className="border rounded-lg py-12 flex flex-col items-center justify-center text-muted-foreground text-sm">
          <Building2 className="w-8 h-8 opacity-30 mb-2" />
          <div>No BGP team assigned yet</div>
          <div className="text-xs mt-1">{readOnly ? "Your BGP team hasn't been set up yet — ask your BGP team." : 'Click "Add to team" to get started'}</div>
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-2 w-full">
            {columnList
              // Hide the auto-added Unassigned column when nothing's
              // in it — it's a catch-all for orphans, not a column
              // the user explicitly created. If something gets
              // dragged into it later it reappears automatically.
              .filter(col => col.name !== "Unassigned" || (byColumn[col.name] || []).length > 0)
              .map(col => {
              const style = styleForColumn(col);
              const peeps = byColumn[col.name] || [];
              const isOver = dragOverCol === col.name;
              const isDefault = col.name in DEFAULT_COLOUR_BY_NAME;
              const isUnassigned = col.name === "Unassigned";
              return (
                <div
                  key={col.name}
                  onDragOver={readOnly ? undefined : (e) => { e.preventDefault(); setDragOverCol(col.name); }}
                  onDragLeave={readOnly ? undefined : () => setDragOverCol(prev => prev === col.name ? null : prev)}
                  onDrop={readOnly ? undefined : () => handleDropOnColumn(col.name)}
                  className={`flex-none w-[185px] rounded-lg border ${style.border} ${isOver ? "ring-2 ring-primary/60 ring-offset-1" : ""} ${style.bg} p-2 flex flex-col gap-2`}
                  data-testid={`team-column-${col.name.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  <div className="flex items-center justify-between px-1 group">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <span className={`w-2 h-2 rounded-full ${style.chip} shrink-0`} />
                      {renamingCol === col.name ? (
                        <Input
                          autoFocus
                          value={newColName}
                          onChange={(e) => setNewColName(e.target.value)}
                          onBlur={() => {
                            if (newColName.trim() && newColName.trim() !== col.name) {
                              renameColumn.mutate({ oldName: col.name, name: newColName.trim() });
                            }
                            setRenamingCol(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setRenamingCol(null);
                          }}
                          className="h-6 text-[10px] uppercase tracking-wider font-semibold flex-1 min-w-0"
                          data-testid={`input-rename-column-${col.name}`}
                        />
                      ) : (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">{col.name}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground/70">{peeps.length}</span>
                      {!isUnassigned && !readOnly && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent"
                              data-testid={`btn-column-menu-${col.name}`}
                            >
                              <MoreHorizontal className="w-3 h-3 text-muted-foreground" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="text-xs">
                            <DropdownMenuItem
                              onClick={() => { setRenamingCol(col.name); setNewColName(col.name); }}
                              data-testid={`menu-rename-${col.name}`}
                            >
                              <Pencil className="w-3 h-3 mr-1.5" /> Rename
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => {
                                if (peeps.length > 0 && !confirm(`Delete "${col.name}"? Its ${peeps.length} member${peeps.length === 1 ? "" : "s"} will fall back to Unassigned.`)) return;
                                deleteColumn.mutate(col.name);
                              }}
                              className="text-destructive focus:text-destructive"
                              data-testid={`menu-delete-${col.name}`}
                            >
                              <Trash2 className="w-3 h-3 mr-1.5" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                  {peeps.length === 0 ? (
                    <div className="flex-1 min-h-[60px] flex items-center justify-center text-[11px] text-muted-foreground/50 italic">
                      {readOnly ? "" : "drop here"}
                    </div>
                  ) : (
                    peeps.map(m => (
                      <MemberCard
                        key={m.id}
                        member={m}
                        isLead={!!m.is_lead}
                        readOnly={readOnly}
                        onClick={() => setSelected(m)}
                        onDragStart={(e) => {
                          draggingId.current = m.id;
                          e.dataTransfer.effectAllowed = "move";
                          // Stop the column-level drop handler from firing
                          // when we land on a card — it'd otherwise treat
                          // the drop as a column-end append.
                          e.stopPropagation();
                        }}
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverCol(col.name); }}
                        onDrop={() => handleDropOnCard(m)}
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
          columnNames={columnList.map(c => c.name)}
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

function MemberSheet({ member, allMembers, clientCompanyId, columnNames, onClose, onChange }: {
  member: TeamMember;
  allMembers: TeamMember[];
  clientCompanyId: string;
  columnNames: string[];
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

  // "pa-…" rows are synthesized from property assignments — there's no
  // board row to PATCH/DELETE, so edits convert them to a curated row first.
  const isSynth = member.id.startsWith("pa-");

  const updateMutation = useMutation({
    mutationFn: (patch: any) =>
      isSynth
        ? apiRequest("POST", `/api/client-teams/${clientCompanyId}/member`, {
            user_id: member.user_id,
            team_group: member.team_group,
            role: member.role,
            reports_to_user_id: member.reports_to_user_id,
            sort_order: member.sort_order,
            ...patch,
          })
        : apiRequest("PATCH", `/api/client-teams/member/${member.id}`, patch),
    onSuccess: () => { onChange(); toast({ title: "Updated" }); },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    // Auto-included ("pa-") members have no board row — the server removes their
    // property assignments instead, so it needs to know which client we're on.
    mutationFn: async () => {
      const r = await apiRequest("DELETE", `/api/client-teams/member/${member.id}?clientCompanyId=${encodeURIComponent(clientCompanyId)}`);
      return await r.json().catch(() => ({}));
    },
    onSuccess: (res: any) => {
      onChange(); onClose();
      const n = res?.removedPropertyAssignments;
      toast({
        title: "Removed from team",
        description: n ? `Unassigned from ${n} propert${n === 1 ? "y" : "ies"} on this client.` : undefined,
      });
    },
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

  const assignedCount = useMemo(
    () => (propertiesQuery.data || []).filter(p => p.assigned).length,
    [propertiesQuery.data]
  );

  const toggleProperty = async (propertyId: string, assigned: boolean) => {
    setPropBusy(true);
    queryClient.setQueryData<PropertyAssignment[]>(
      ["/api/client-teams", clientCompanyId, "member", member.user_id, "properties"],
      (prev) => prev?.map(p => p.id === propertyId ? { ...p, assigned: !assigned } : p)
    );
    try {
      const body = assigned ? { remove: [propertyId] } : { add: [propertyId] };
      await apiRequest("POST", `/api/client-teams/${clientCompanyId}/member/${member.user_id}/properties`, body);
      queryClient.invalidateQueries({ queryKey: ["/api/client-teams", clientCompanyId] });
    } catch (e: any) {
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
      <SheetContent side="right" className="w-[460px] sm:max-w-[460px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {displayName}
            {member.is_lead && <Star className="w-4 h-4 text-amber-500" fill="currentColor" />}
          </SheetTitle>
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
              <Link href={`/hr?person=${member.user_id}`} className="text-xs text-indigo-500 hover:underline inline-block">Open full HR profile →</Link>
            </div>
          </div>

          <div className="border-t pt-3">
            <Button
              size="sm"
              variant={member.is_lead ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => updateMutation.mutate({ is_lead: !member.is_lead })}
              disabled={updateMutation.isPending}
              data-testid="btn-toggle-lead"
            >
              {member.is_lead ? <><Check className="w-3 h-3 mr-1.5" />Account lead</> : <><Star className="w-3 h-3 mr-1.5" />Set as account lead</>}
            </Button>
            {member.is_lead && <span className="text-[10px] text-muted-foreground ml-2">Pinned for this client</span>}
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
                  {columnNames.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
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
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Properties on this client</label>
              <span className="text-[10px] text-muted-foreground">{assignedCount} assigned</span>
            </div>
            {propertiesQuery.isLoading ? (
              <div className="text-xs text-muted-foreground flex items-center gap-2 mt-2"><Loader2 className="w-3 h-3 animate-spin" />Loading properties…</div>
            ) : (propertiesQuery.data || []).length === 0 ? (
              <div className="text-xs text-muted-foreground mt-2 italic">This client has no properties yet.</div>
            ) : (
              <div className="mt-1 max-h-[260px] overflow-y-auto border rounded-md divide-y">
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
                      {readableAddress(p.address) && <div className="text-[10px] text-muted-foreground truncate">{readableAddress(p.address)}</div>}
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
              onClick={() => {
                if (isSynth) {
                  toast({
                    title: "Auto-included from property assignments",
                    description: `${displayName} appears here because they're assigned to this client's properties. Untick their properties above to take them off the board.`,
                  });
                  return;
                }
                if (confirm(`Remove ${displayName} from this client's team?`)) removeMutation.mutate();
              }}
              disabled={removeMutation.isPending}
              data-testid="btn-remove-member"
            >
              Remove from team
            </Button>
            {isSynth && (
              <div className="text-[10px] text-muted-foreground mt-1.5">
                Auto-included via property assignments — remove their properties above to take them off the board.
              </div>
            )}
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
            <div className="text-xs text-muted-foreground py-4 text-center">No active BGP staff match.</div>
          ) : (
            <div className="space-y-1">
              {filtered.map(c => {
                const already = c.existing_count || 0;
                return (
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
                      <div className="text-sm font-medium truncate flex items-center gap-1.5">
                        {c.full_name || c.username}
                        {already > 0 && (
                          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">already × {already}</Badge>
                        )}
                      </div>
                      {c.bgp_title && <div className="text-[10px] text-muted-foreground truncate">{c.bgp_title}</div>}
                    </div>
                  </button>
                );
              })}
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
