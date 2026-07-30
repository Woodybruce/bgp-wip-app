// The Operator Targeting Brief's target-operators columns, shared between
// the brief dialog (as its own table) and the Letting Tracker (merged into
// the main run as first-class columns between Client and Team/BGP).
// TargetRowCells renders the seven cells for ONE target — self-contained
// (owns the user / client-contact lookups and the PATCH/DELETE calls) so
// any surface can drop it into a TableRow. TargetOperatorsTable wraps it
// in a standalone table for the brief dialog.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { CRM_OPTIONS } from "@/lib/crm-options";
import { BRIEF_TARGET_STATUSES } from "@shared/schema";

export const TARGET_STATUS_COLORS: Record<string, string> = {
  "Identified": "bg-gray-500",
  "Approached": "bg-sky-500",
  "Meeting Held": "bg-blue-600",
  "Inspection Done": "bg-violet-500",
  "Offer": "bg-amber-500",
  "Let": "bg-green-600",
  "Passed": "bg-zinc-400",
};

const BRAND_CATEGORIES = CRM_OPTIONS.companyType as readonly string[];

function CategoryItems({ current }: { current: string }) {
  return (
    <SelectContent className="max-h-64">
      {current && !BRAND_CATEGORIES.includes(current) && (
        <SelectItem value={current}>{current}</SelectItem>
      )}
      {BRAND_CATEGORIES.filter(ct => ct !== "Landlord").map(ct => (
        <SelectItem key={ct} value={ct}>{ct.replace(/^Tenant - /, "")}</SelectItem>
      ))}
    </SelectContent>
  );
}

// The seven target columns, in canonical order. Surfaces render these
// headers themselves so widths can differ, but the order is fixed here.
export const TARGET_COLUMNS = ["Operator", "Category", "Priority", "Status", "Agent", "Client", "Comments"] as const;

export function TargetRowCells({ target: t, clientCompanyId, onChanged, showDelete = true, operatorExtra }: {
  target: any;
  clientCompanyId?: string | null;
  onChanged: () => void;
  showDelete?: boolean;
  /** Rendered after the delete button in the Operator cell — e.g. the
      tracker's small + add-target trigger on the first row of a unit. */
  operatorExtra?: React.ReactNode;
}) {
  const { toast } = useToast();
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const { data: users = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/users"],
    staleTime: 5 * 60_000,
  });
  const agentOptions = useMemo(
    () => users.map(u => ({ label: u.name, value: u.id })).sort((a, b) => a.label.localeCompare(b.label)),
    [users]
  );
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
  const clientContactOptions = useMemo(
    () => clientContacts
      .map((c: any) => ({ id: String(c.id), name: c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") }))
      .filter(c => c.name)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [clientContacts]
  );

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
          <span className="truncate">
            {t.companyId ? (
              <a href={`/companies/${t.companyId}`} className="hover:underline text-primary">{t.operatorName}</a>
            ) : t.operatorName}
          </span>
          {showDelete && (
            <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 opacity-40 hover:opacity-100" onClick={deleteTarget} data-testid={`button-delete-target-${t.id}`}>
              <Trash2 className="h-3 w-3 text-muted-foreground" />
            </Button>
          )}
          {operatorExtra}
        </div>
      </TableCell>
      <TableCell>
        <Select value={t.category || ""} onValueChange={v => patchTarget({ category: v })}>
          <SelectTrigger className="h-7 text-xs w-[140px]"><SelectValue placeholder="—" /></SelectTrigger>
          <CategoryItems current={t.category || ""} />
        </Select>
      </TableCell>
      <TableCell>
        <Select value={t.priority || "B"} onValueChange={v => patchTarget({ priority: v })}>
          <SelectTrigger className="h-7 text-xs w-[54px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="A">A</SelectItem>
            <SelectItem value="B">B</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select value={t.status || "Identified"} onValueChange={v => patchTarget({ status: v })}>
          <SelectTrigger className="h-7 text-xs w-[124px]">
            <SelectValue>
              <Badge className={`text-[10px] text-white ${TARGET_STATUS_COLORS[t.status || "Identified"]}`}>{t.status || "Identified"}</Badge>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {BRIEF_TARGET_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="max-w-[140px]">
        <InlineMultiSelect
          value={t.agentUserIds || []}
          options={agentOptions}
          placeholder="Set agent"
          onSave={v => patchTarget({ agentUserIds: v.length > 0 ? v : null })}
          testId={`target-agent-${t.id}`}
        />
      </TableCell>
      <TableCell className="max-w-[150px]">
        <InlineLinkSelect
          value={t.clientContactId}
          options={clientContactOptions}
          href={t.clientContactId ? `/contacts/${t.clientContactId}` : undefined}
          onSave={v => patchTarget({ clientContactId: v })}
          placeholder={clientCompanyId ? "Link client contact" : "No client company"}
          compact
        />
      </TableCell>
      <TableCell className="text-xs max-w-[220px]">
        <TargetComments
          comments={t.comments}
          onAdd={text => {
            const existing = Array.isArray(t.comments) ? t.comments : [];
            patchTarget({ comments: [...existing, { userId: me?.id || null, userName: me?.name || me?.username || "Unknown", text, at: new Date().toISOString() }] });
          }}
        />
      </TableCell>
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
              <TableHead>Category</TableHead>
              <TableHead className="w-[70px]">Priority</TableHead>
              <TableHead className="w-[140px]">Status</TableHead>
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
          onPick={p => setNewTarget(prev => ({ ...prev, operatorName: p.name, companyId: p.companyId, category: p.companyType || prev.category }))}
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
function TargetComments({ comments, onAdd }: { comments: unknown; onAdd: (text: string) => void }) {
  const [draft, setDraft] = useState("");
  const list: Array<{ userName?: string; text?: string; at?: string }> = Array.isArray(comments) ? comments : [];
  return (
    <div className="space-y-1 min-w-[160px]">
      {list.map((c, i) => (
        <div key={i} className="text-[11px] leading-tight" title={c.at ? new Date(c.at).toLocaleString("en-GB") : undefined}>
          <span className="font-semibold text-primary">{c.userName || "Unknown"}</span>{" "}
          <span>{c.text}</span>
        </div>
      ))}
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
