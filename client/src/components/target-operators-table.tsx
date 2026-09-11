// The Operator Targeting Brief's target-operators columns, shared between
// the brief dialog (as its own table) and the Letting Tracker (merged into
// the main run as first-class columns between Client and Team/BGP).
// TargetRowCells renders the seven cells for ONE target — self-contained
// (owns the user / client-contact lookups and the PATCH/DELETE calls) so
// any surface can drop it into a TableRow. TargetOperatorsTable wraps it
// in a standalone table for the brief dialog.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BrandSearchInput } from "@/components/brand-search-input";
import { InlineMultiSelect, InlineLinkSelect } from "@/components/inline-edit";
import { BRIEF_TARGET_STATUSES } from "@shared/schema";

// Display renames — the stored values and API keep the long names so
// existing rows don't need a migration. "Passed" reads as "Rejected"
// (Woody's team, 2026-08); "Meeting Held" / "Inspection Done" / "Heads of
// Terms" truncated in the 124px status chip (Woody, 2026-09-01: "Meeting
// instead of Meeting Held, Inspection instead of Inspection Done").
const TARGET_STATUS_DISPLAY: Record<string, string> = {
  "Passed": "Rejected",
  "Meeting Held": "Meeting",
  "Inspection Done": "Inspection",
  "Heads of Terms": "HOTs",
};
export const targetStatusLabel = (s: string) => TARGET_STATUS_DISPLAY[s] || s;

export const TARGET_STATUS_COLORS: Record<string, string> = {
  "Identified": "bg-gray-500",
  "Approached": "bg-sky-500",
  "Meeting Held": "bg-blue-600",
  "Inspection Done": "bg-violet-500",
  "Offer": "bg-amber-500",
  "Negotiating": "bg-yellow-600",
  "Heads of Terms": "bg-rose-500",
  "In Sols": "bg-orange-500",
  "Let": "bg-green-600",
  "Passed": "bg-zinc-400",
};

// Curated category taxonomy for the Letting Tracker + targeting brief
// (Woody, 2026-08): a short hospitality / leisure list, not the full brand
// companyType set. Exported so the tracker's quick-add can reuse it.
// "Care" was a typo for "Cafe" (team feedback, 2026-08-14) — stored rows are
// healed by the one-off in index.ts.
export const LETTING_CATEGORIES: readonly string[] = ["Cafe", "Grab and go", "Restaurant", "Leisure", "Food market"];

function CategoryItems({ current }: { current: string }) {
  return (
    <SelectContent className="max-h-64">
      {current && !LETTING_CATEGORIES.includes(current) && (
        <SelectItem value={current}>{current}</SelectItem>
      )}
      {LETTING_CATEGORIES.map(ct => (
        <SelectItem key={ct} value={ct}>{ct}</SelectItem>
      ))}
    </SelectContent>
  );
}

// The seven target columns, in canonical order. Surfaces render these
// headers themselves so widths can differ, but the order is fixed here.
export const TARGET_COLUMNS = ["Operator", "Status", "Category", "Priority", "Agent", "Client", "Comments"] as const;

export function TargetRowCells({ target: t, clientCompanyId, onChanged, showDelete = true, operatorExtra, visibleCols }: {
  target: any;
  clientCompanyId?: string | null;
  onChanged: () => void;
  showDelete?: boolean;
  /** Rendered after the delete button in the Operator cell — e.g. the
      tracker's small + add-target trigger on the first row of a unit. */
  operatorExtra?: React.ReactNode;
  /** Per-column visibility (Letting Tracker's Columns menu). Omitted = all shown.
      The Operator cell is always rendered. */
  visibleCols?: { status?: boolean; category?: boolean; priority?: boolean; agent?: boolean; client?: boolean; comments?: boolean };
}) {
  const vis = { status: true, category: true, priority: true, agent: true, client: true, comments: true, ...(visibleCols || {}) };
  // Unlinked operators (free-text, no CRM brand) render plain — clicking
  // one opens a brand search seeded with the name to link or create it
  // (Woody, 2026-09-01: "Sticks and Sushi … are black … can have ability
  // to create a brand or edit when I click one?").
  const [linkingBrand, setLinkingBrand] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const { data: users = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/users"],
    staleTime: 5 * 60_000,
  });
  // Agent pills offer only the BGP people allocated to this client (the
  // client-team board, e.g. Landsec's team) — fall back to the full user
  // list when the unit has no client company or no team is set up yet.
  const { data: clientTeam = [] } = useQuery<any[]>({
    queryKey: ["/api/client-teams", clientCompanyId],
    queryFn: async () => {
      const r = await fetch(`/api/client-teams/${clientCompanyId}`, { headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!clientCompanyId,
    staleTime: 60_000,
  });
  const agentOptions = useMemo(() => {
    const teamById = new Map<string, string>();
    for (const m of clientTeam) {
      // Agents are BGP people only — the client-team board also carries the
      // client's own logins (Mark, Jonny), who belong in Client Contact,
      // not Agent.
      const isBgp = (m.email || "").toLowerCase().endsWith("@brucegillinghampollard.com");
      if (m.user_id && isBgp) teamById.set(String(m.user_id), m.full_name || m.username || "Unknown");
    }
    // Keep any already-assigned agent visible even if they're not on the
    // client team (so existing pills don't render as bare ids).
    for (const id of (t.agentUserIds || [])) {
      if (!teamById.has(String(id))) {
        const u = users.find(x => String(x.id) === String(id));
        if (u) teamById.set(String(u.id), u.name);
      }
    }
    const pool = teamById.size > 0
      ? Array.from(teamById.entries()).map(([id, name]) => ({ label: name, value: id }))
      : users.map(u => ({ label: u.name, value: u.id }));
    return pool.sort((a, b) => a.label.localeCompare(b.label));
  }, [clientTeam, users, t.agentUserIds]);
  const { data: clientContacts = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/contacts", "by-company", clientCompanyId],
    queryFn: async () => {
      const r = await fetch(`/api/crm/contacts?companyId=${clientCompanyId}&limit=500`, { headers: getAuthHeaders() });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : (d.contacts || []);
    },
    enabled: !!clientCompanyId,
    staleTime: 60_000,
  });
  const clientContactOptions = useMemo(() => {
    const all = clientContacts
      .map((c: any) => ({ id: String(c.id), name: c.name || [c.firstName, c.lastName].filter(Boolean).join(" "), role: String(c.role || "").trim().toLowerCase() }))
      .filter(c => c.name);
    // The tracker's client contact is the client-side DIRECTOR running the
    // account (Landsec: Mark Warne / Jonny Rushton — Woody, 2026-08-04:
    // "should just be Mark Warne or Jonathan Rushton"), not all 20+ people
    // on the company. Clients with no Director-role contact keep the full
    // list, and an already-saved contact stays selectable either way.
    const directors = all.filter(c => c.role === "director");
    let pool = directors.length > 0 ? directors : all;
    const savedId = (t as any).clientContactId ? String((t as any).clientContactId) : null;
    if (savedId && !pool.some(c => c.id === savedId)) {
      const cur = all.find(c => c.id === savedId);
      if (cur) pool = [...pool, cur];
    }
    return pool.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [clientContacts, (t as any).clientContactId]);

  const patchTarget = async (data: Record<string, unknown>) => {
    try {
      await apiRequest("PATCH", `/api/unit-briefs/targets/${t.id}`, data);
      onChanged();
    } catch (e: any) {
      toast({ title: "Couldn't update target", description: e?.message, variant: "destructive" });
    }
  };
  const deleteTarget = async () => {
    try {
      await apiRequest("DELETE", `/api/unit-briefs/targets/${t.id}`);
      onChanged();
    } catch (e: any) {
      toast({ title: "Couldn't remove target", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <>
      <TableCell className="text-xs font-medium">
        <div className="flex items-center gap-1">
          {!t.companyId && linkingBrand ? (
            <BrandSearchInput
              className="h-6 w-[160px] text-[11px]"
              placeholder="Link or create brand…"
              value=""
              allowCreate
              openOnMount
              initialQuery={t.operatorName || ""}
              onPick={p => {
                setLinkingBrand(false);
                if (p.companyId) patchTarget({ companyId: p.companyId, operatorName: p.name });
              }}
              testId={`link-brand-${t.id}`}
            />
          ) : (
          <span className="truncate">
            {t.companyId ? (
              <a href={`/companies/${t.companyId}`} className="hover:underline text-primary">{t.operatorName}</a>
            ) : (
              <button
                type="button"
                className="text-left hover:underline underline-offset-2 decoration-dotted"
                title={`"${t.operatorName}" isn't in the brand list — click to link or create it`}
                onClick={() => setLinkingBrand(true)}
                data-testid={`button-link-brand-${t.id}`}
              >{t.operatorName}</button>
            )}
          </span>
          )}
          {showDelete && (
            <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 opacity-40 hover:opacity-100" onClick={deleteTarget} data-testid={`button-delete-target-${t.id}`}>
              <Trash2 className="h-3 w-3 text-muted-foreground" />
            </Button>
          )}
          {operatorExtra}
        </div>
      </TableCell>
      {vis.status && (
      <TableCell>
        <Select value={t.status || "Identified"} onValueChange={v => patchTarget({ status: v })}>
          <SelectTrigger className="h-7 text-xs w-[124px]">
            <SelectValue>
              <Badge variant="outline" className={`border-transparent text-[10px] text-white ${TARGET_STATUS_COLORS[t.status || "Identified"]}`}>{targetStatusLabel(t.status || "Identified")}</Badge>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {BRIEF_TARGET_STATUSES.map(s => <SelectItem key={s} value={s}>{targetStatusLabel(s)}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>
      )}
      {vis.category && (
      <TableCell>
        <Select value={t.category || ""} onValueChange={v => patchTarget({ category: v })}>
          <SelectTrigger className="h-7 text-xs w-[140px]"><SelectValue placeholder="—" /></SelectTrigger>
          <CategoryItems current={t.category || ""} />
        </Select>
      </TableCell>
      )}
      {vis.priority && (
      <TableCell>
        <Select value={t.priority || "B"} onValueChange={v => patchTarget({ priority: v })}>
          <SelectTrigger className="h-7 text-xs w-[54px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="A">A</SelectItem>
            <SelectItem value="B">B</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      )}
      {vis.agent && (
      <TableCell className="max-w-[140px]">
        <InlineMultiSelect
          value={t.agentUserIds || []}
          options={agentOptions}
          placeholder="Set agent"
          onSave={v => patchTarget({ agentUserIds: v.length > 0 ? v : null })}
          testId={`target-agent-${t.id}`}
        />
      </TableCell>
      )}
      {vis.client && (
      <TableCell className="max-w-[150px]">
        <InlineLinkSelect
          value={t.clientContactId}
          options={clientContactOptions}
          href={t.clientContactId ? `/contacts/${t.clientContactId}` : undefined}
          onSave={v => patchTarget({ clientContactId: v })}
          onCreate={clientCompanyId ? async (name) => {
            try {
              const r = await apiRequest("POST", "/api/crm/contacts", { name, companyId: clientCompanyId });
              const c = await r.json();
              queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts", "by-company", clientCompanyId] });
              await patchTarget({ clientContactId: String(c.id) });
            } catch (e: any) {
              toast({ title: "Couldn't add contact", description: e?.message, variant: "destructive" });
            }
          } : undefined}
          placeholder={clientCompanyId ? "Link client contact" : "No client company"}
        />
      </TableCell>
      )}
      {vis.comments && (
      <TableCell className="text-xs max-w-[150px]">
        <TargetComments
          comments={t.comments}
          onAdd={text => {
            const existing = Array.isArray(t.comments) ? t.comments : [];
            patchTarget({ comments: [...existing, { userId: me?.id || null, userName: me?.name || me?.username || "Unknown", text, at: new Date().toISOString() }] });
          }}
          onReplace={next => patchTarget({ comments: next })}
        />
      </TableCell>
      )}
    </>
  );
}

export function TargetOperatorsTable({ targets, clientCompanyId, ensureBriefId, onChanged }: {
  targets: any[];
  clientCompanyId?: string | null;
  ensureBriefId: () => Promise<string>;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [newTarget, setNewTarget] = useState<{ operatorName: string; companyId: string | null; category: string; priority: string }>({ operatorName: "", companyId: null, category: "", priority: "B" });
  const [adding, setAdding] = useState(false);
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });

  const addTarget = async () => {
    if (!newTarget.operatorName) return;
    setAdding(true);
    try {
      const briefId = await ensureBriefId();
      await apiRequest("POST", `/api/unit-briefs/${briefId}/targets`, {
        ...newTarget,
        agentUserIds: me?.id ? [String(me.id)] : undefined,
      });
      setNewTarget({ operatorName: "", companyId: null, category: "", priority: "B" });
      onChanged();
    } catch (e: any) {
      toast({ title: "Couldn't add target", description: e?.message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold flex items-center gap-2">
        Target operators
        <Badge variant="outline" className="text-[10px]">{targets.length}</Badge>
      </h4>
      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[160px]">Operator</TableHead>
              <TableHead className="w-[140px]">Status</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="w-[70px]">Priority</TableHead>
              <TableHead className="w-[130px]">Agent</TableHead>
              <TableHead className="w-[140px]">Client</TableHead>
              <TableHead>Comments</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {targets.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground text-xs py-6">
                  No target operators yet — add them below or extract from the client brief
                </TableCell>
              </TableRow>
            )}
            {targets.map(t => (
              <TableRow key={t.id} data-testid={`row-target-${t.id}`}>
                <TargetRowCells target={t} clientCompanyId={clientCompanyId} onChanged={onChanged} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center gap-2">
        <BrandSearchInput
          className="max-w-[200px] w-[200px]"
          placeholder="Operator name…"
          value={newTarget.operatorName}
          companyId={newTarget.companyId}
          allowCreate
          inline
          onPick={p => setNewTarget(prev => {
            // Brand companyTypes carry a "Tenant - " prefix ("Tenant - Restaurant"),
            // so compare against the bare category label or the autofill never fires.
            const ct = (p.companyType || "").replace(/^Tenant - /i, "");
            return { ...prev, operatorName: p.name, companyId: p.companyId, category: LETTING_CATEGORIES.includes(ct) ? ct : prev.category };
          })}
          testId="input-new-target-name"
        />
        <Select value={newTarget.category} onValueChange={v => setNewTarget(p => ({ ...p, category: v }))}>
          <SelectTrigger className="h-8 text-xs w-[180px]"><SelectValue placeholder="Category…" /></SelectTrigger>
          <CategoryItems current={newTarget.category} />
        </Select>
        <Select value={newTarget.priority} onValueChange={v => setNewTarget(p => ({ ...p, priority: v }))}>
          <SelectTrigger className="h-8 text-xs w-[60px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="A">A</SelectItem>
            <SelectItem value="B">B</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="h-8"
          disabled={!newTarget.operatorName || adding}
          onClick={addTarget}
          data-testid="button-add-target"
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}

// Attributed comment log on a target — each entry names its author so the
// thread reads "who said what" rather than one anonymous free-text blob.
function TargetComments({ comments, onAdd, onReplace }: {
  comments: unknown;
  onAdd: (text: string) => void;
  // Full-list replacement — powers edit + delete (team feedback 2026-08-14).
  onReplace?: (next: Array<{ userId?: string | null; userName?: string; text?: string; at?: string; editedAt?: string }>) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const list: Array<{ userId?: string | null; userName?: string; text?: string; at?: string; editedAt?: string }> = Array.isArray(comments) ? comments : [];

  const saveEdit = (i: number) => {
    const text = editText.trim();
    setEditIdx(null);
    if (!onReplace || !text || text === list[i]?.text) return;
    const next = list.map((c, ci) => ci === i ? { ...c, text, editedAt: new Date().toISOString() } : c);
    onReplace(next);
  };
  const remove = (i: number) => {
    if (!onReplace) return;
    if (!confirm("Delete this comment?")) return;
    onReplace(list.filter((_, ci) => ci !== i));
  };

  return (
    <div className="space-y-1 min-w-[120px]">
      {/* Long threads scroll instead of stretching the row (Woody,
          2026-09-01) — the add-comment input stays outside the scroll. */}
      <div className="max-h-[76px] overflow-y-auto space-y-1">
      {list.map((c, i) => editIdx === i ? (
        <input
          key={i}
          autoFocus
          value={editText}
          onChange={e => setEditText(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") saveEdit(i);
            if (e.key === "Escape") setEditIdx(null);
          }}
          onBlur={() => saveEdit(i)}
          className="w-full bg-transparent border-0 border-b border-primary/50 text-[11px] focus:outline-none"
          data-testid={`edit-target-comment-${i}`}
        />
      ) : (
        <div key={i} className="group/comment text-[11px] leading-tight flex items-start gap-1" title={c.at ? new Date(c.at).toLocaleString("en-GB") : undefined}>
          <span className="min-w-0">
            <span className="font-semibold text-primary">{c.userName || "Unknown"}</span>
            {c.at && <span className="text-muted-foreground/70 text-[10px]"> {new Date(c.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
            {c.editedAt && <span className="text-muted-foreground/50 text-[10px]"> (edited)</span>}{" "}
            <span>{c.text}</span>
          </span>
          {onReplace && (
            <span className="shrink-0 flex gap-0.5 opacity-0 group-hover/comment:opacity-100 transition-opacity">
              <button type="button" className="text-muted-foreground hover:text-foreground" title="Edit comment" onClick={() => { setEditIdx(i); setEditText(c.text || ""); }} data-testid={`button-edit-comment-${i}`}>✎</button>
              <button type="button" className="text-muted-foreground hover:text-red-600" title="Delete comment" onClick={() => remove(i)} data-testid={`button-delete-comment-${i}`}>✕</button>
            </span>
          )}
        </div>
      ))}
      </div>
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && draft.trim()) { onAdd(draft.trim()); setDraft(""); }
        }}
        placeholder="Add comment…"
        className="w-full bg-transparent border-0 border-b border-dashed border-muted-foreground/30 text-[11px] focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/50"
        data-testid="input-target-comment"
      />
    </div>
  );
}
