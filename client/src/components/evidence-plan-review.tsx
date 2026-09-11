import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isValidPolygon } from "@shared/plan-geometry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ReviewUnit = {
  id: string; unit_ref: string; tenant_name: string | null; level_id: string | null;
  polygon: { x: number; y: number }[] | null; source?: string | null;
  ts_linked?: boolean; ts_link_status?: string;
};
type ReviewLevel = { id: string; name: string };
type Queue = "outlines" | "links" | "evidence";

export function EvidencePlanReview({ open, onOpenChange, units, levels, activeLevelId, propertyLinked, unlinkedCount, evidence, onSelect }: {
  open: boolean; onOpenChange: (open: boolean) => void; units: ReviewUnit[]; levels: ReviewLevel[];
  activeLevelId: string | null; propertyLinked: boolean; unlinkedCount: number; evidence: ReactNode;
  onSelect: (id: string) => void;
}) {
  const [queue, setQueue] = useState<Queue>("outlines");
  const [level, setLevel] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => { if (open) { setLevel(activeLevelId || "all"); setPage(0); } }, [open, activeLevelId]);
  useEffect(() => setPage(0), [queue, level, search]);
  const issues = useMemo(() => units.map(unit => ({
    unit,
    outline: !isValidPolygon(unit.polygon) ? "Missing or invalid boundary"
      : /^unlabelled\b/i.test(unit.unit_ref) ? "Needs a unit reference"
      : unit.source === "ai" ? "AI outline — check against the drawing" : null,
    link: unit.ts_link_status === "missing" ? "Selected schedule row is missing"
      : unit.ts_link_status === "ambiguous" ? "Multiple schedule rows match"
      : propertyLinked && !unit.ts_linked ? "Choose the matching schedule row" : null,
  })), [units, propertyLinked]);
  const outlineCount = issues.filter(i => i.outline).length;
  const linkCount = issues.filter(i => i.link).length;
  const filtered = issues.filter(i => (queue === "outlines" ? i.outline : i.link)
    && (level === "all" || (i.unit.level_id || levels[0]?.id) === level)
    && `${i.unit.unit_ref} ${i.unit.tenant_name || ""}`.toLowerCase().includes(search.toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 8));
  const currentPage = Math.min(page, pages - 1);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto max-md:top-auto max-md:bottom-0 max-md:translate-y-0 max-md:rounded-b-none" data-testid="plan-review-dialog">
      <DialogHeader>
        <DialogTitle>Review this plan</DialogTitle>
        <DialogDescription>Check boundaries, choose the matching lease details and assign evidence to the right unit.</DialogDescription>
      </DialogHeader>
      <div className="flex gap-2 flex-wrap">
        <Pill active={queue === "outlines"} onClick={() => setQueue("outlines")} data-testid="review-outlines">Outlines · {outlineCount}</Pill>
        <Pill active={queue === "links"} onClick={() => setQueue("links")} data-testid="review-links">Schedule links · {linkCount}</Pill>
        <Pill active={queue === "evidence"} onClick={() => setQueue("evidence")} data-testid="review-evidence">Evidence · {unlinkedCount}</Pill>
      </div>
      {queue === "evidence" ? <div>{unlinkedCount ? evidence : <p className="text-sm text-muted-foreground">All evidence entries are linked. Check their assigned units when reviewing boundaries.</p>}</div> : <>
        <p className="text-sm text-muted-foreground">{queue === "outlines" ? "Start with missing, unnamed or AI-created outlines. A four-sided boundary can be correct; check it against the source plan. Other edited outlines may still need checking." : propertyLinked ? "Compare the original schedule rows before choosing. Similar names or duplicate references do not establish which lease is current." : "Link this plan to its property to review tenancy-schedule matches."}</p>
        <div className="flex gap-2 flex-wrap">
          <Input className="flex-1 min-w-0" aria-label="Search plan review" placeholder="Find unit or tenant…" value={search} onChange={e => setSearch(e.target.value)} />
          <select className="min-h-11 rounded-md border border-input bg-background px-2 text-sm max-w-full" aria-label="Review level" value={level} onChange={e => setLevel(e.target.value)}>
            <option value="all">All levels</option>
            {levels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">{filtered.length} to review in this view</p>
        <div className="space-y-2">
          {filtered.slice(currentPage * 8, currentPage * 8 + 8).map(item => <button key={item.unit.id} className="w-full min-h-11 rounded-xl border border-border bg-card p-3 text-left hover:border-primary" data-testid={`review-unit-${item.unit.id}`} onClick={() => { onOpenChange(false); onSelect(item.unit.id); }}>
            <span className="block text-sm font-semibold">{item.unit.unit_ref} · {item.unit.tenant_name || "Tenant not entered"}</span>
            <span className="block text-[11px] text-muted-foreground">{levels.find(l => l.id === (item.unit.level_id || levels[0]?.id))?.name} · {queue === "outlines" ? item.outline : item.link}</span>
          </button>)}
          {!filtered.length && <p className="text-sm text-muted-foreground">No items match this view.</p>}
        </div>
        {pages > 1 && <div className="flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
          <span className="font-mono text-[11px]">{currentPage + 1} / {pages}</span>
          <Button variant="outline" size="sm" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</Button>
        </div>}
      </>}
    </DialogContent>
  </Dialog>;
}
