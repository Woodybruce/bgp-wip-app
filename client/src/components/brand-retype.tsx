// Sort brands into the categories of Landsec's agency brief (Woody,
// 2026-11-16: "go ahead with the catagories"): the admin's preview of a better
// type for brands on a catch-all type, read from the name or description by
// rules (shared/brand-retype.ts, server/brand-retype.ts). Nothing changes until
// an admin ticks brands and presses Apply; Undo puts the last apply back.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Shapes, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill, PillCount } from "@/components/ui/pill";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const KEY = "/api/admin/brand-retype";
type Row = { id: string; name: string; from: string; to: string; fromCategory: string | null; toCategory: string | null; reason: string };
type Last = { at: string; byName: string | null; changes: Array<{ id: string; name: string; from: string; to: string }>; undoneAt?: string | null; undoneByName?: string | null };
type Preview = { rows: Row[]; catchAll: number; last: Last | null };

const day = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
const short = (type: string) => type.replace(/^Tenant - /, "") || type;
// apiRequest errors read "409: {"error":"…"}"; show the sentence.
const errorText = (e: any) => { const m = String(e?.message || ""); try { return JSON.parse(m.slice(m.indexOf("{"))).error || m; } catch { return m; } };
const plural = (n: number, word: string) => `${n.toLocaleString("en-GB")} ${word}${n === 1 ? "" : "s"}`;

export function BrandRetypeButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid="brand-retype-open"><Shapes className="w-3 h-3 mr-1" /> Sort categories</Button>
      {open && <BrandRetypeDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function BrandRetypeDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<Preview>({ queryKey: [KEY], staleTime: 0 });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState<string | null>(null);
  const rows = data?.rows || [];
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) if (row.toCategory) counts.set(row.toCategory, (counts.get(row.toCategory) || 0) + 1);
    return Array.from(counts, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  }, [rows]);
  const shown = category ? rows.filter(row => row.toCategory === category) : rows;
  const tickedRows = rows.filter(row => ticked.has(row.id));
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [KEY] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
  };
  const apply = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${KEY}/apply`, { changes: tickedRows.map(({ id, from, to }) => ({ id, from, to })) })).json(),
    onSuccess: (r: any) => {
      const applied = r?.applied?.length ?? 0;
      toast({ title: `${plural(applied, "brand")} re-typed`, description: r?.skipped ? `${plural(r.skipped, "brand")} had changed since the list was read and were left alone.` : undefined });
      setTicked(new Set());
      refresh();
    },
    onError: (e: any) => toast({ title: "Nothing was changed", description: errorText(e), variant: "destructive" }),
  });
  const undo = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${KEY}/undo`, {})).json(),
    onSuccess: (r: any) => { toast({ title: `${plural(r?.restored ?? 0, "brand")} put back` }); refresh(); },
    onError: (e: any) => toast({ title: "Nothing was put back", description: errorText(e), variant: "destructive" }),
  });
  const toggle = (id: string, on: boolean) => setTicked(prev => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });
  const last = data?.last || null;

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="brand-retype-dialog">
        <DialogHeader>
          <DialogTitle>Sort brands into the brief's categories</DialogTitle>
          <DialogDescription>
            Brands on a catch-all type (Restaurant, Leisure, Experiential and the like) whose name or description points to a category of Landsec's agency brief: a quick-service brand under Restaurant, a padel club under Leisure. Nothing changes until you tick a brand and press Apply.
          </DialogDescription>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Reading the brands…</p>}
        {error && <p role="status" className="text-sm text-muted-foreground">The list could not be read.</p>}
        {last && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-[13px]" data-testid="brand-retype-last">
            <span className="text-muted-foreground">
              Last applied {day(last.at)}{last.byName ? ` by ${last.byName}` : ""}: {plural(last.changes.length, "brand")}.
              {last.undoneAt && ` Undone ${day(last.undoneAt)}${last.undoneByName ? ` by ${last.undoneByName}` : ""}.`}
            </span>
            {!last.undoneAt && (
              <Button variant="outline" size="sm" className="h-7 text-xs ml-auto" disabled={undo.isPending} onClick={() => undo.mutate()} data-testid="brand-retype-undo">
                <Undo2 className="w-3 h-3 mr-1" />{undo.isPending ? "Putting back…" : "Undo"}
              </Button>
            )}
          </div>
        )}
        {data && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground" data-testid="brand-retype-summary">
              {rows.length ? `${plural(rows.length, "suggestion")} among ${plural(data.catchAll, "brand")} on a catch-all type.` : `No suggestions among ${plural(data.catchAll, "brand")} on a catch-all type.`}
            </p>
            {categories.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                <Pill active={!category} onClick={() => setCategory(null)} data-testid="brand-retype-cat-all">All<PillCount n={rows.length} active={!category} /></Pill>
                {categories.map(c => (
                  <Pill key={c.label} active={category === c.label} onClick={() => setCategory(category === c.label ? null : c.label)}>{c.label}<PillCount n={c.count} active={category === c.label} /></Pill>
                ))}
              </div>
            )}
            {shown.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button type="button" className="underline underline-offset-2 text-muted-foreground hover:text-foreground" onClick={() => setTicked(prev => new Set([...Array.from(prev), ...shown.map(row => row.id)]))} data-testid="brand-retype-tick-shown">Tick all shown</button>
                  {ticked.size > 0 && <button type="button" className="underline underline-offset-2 text-muted-foreground hover:text-foreground" onClick={() => setTicked(new Set())}>Clear ticks</button>}
                </div>
                <div className="divide-y divide-border rounded-md border border-border">
                  {shown.map(row => (
                    <label key={row.id} className="flex items-start gap-2.5 px-2.5 py-2 text-[13px] cursor-pointer hover:bg-muted/50" data-testid={`brand-retype-row-${row.id}`}>
                      <Checkbox checked={ticked.has(row.id)} onCheckedChange={v => toggle(row.id, v === true)} className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <Link href={`/companies/${row.id}`} className="font-medium hover:underline" onClick={e => e.stopPropagation()}>{row.name}</Link>
                          <span className="text-muted-foreground">{short(row.from)} → <span className="text-foreground font-medium">{short(row.to)}</span></span>
                        </span>
                        <span className="block text-xs text-muted-foreground">{row.reason}{row.toCategory ? ` · ${row.toCategory}` : ""}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          <Button size="sm" disabled={!tickedRows.length || apply.isPending} onClick={() => apply.mutate()} data-testid="brand-retype-apply">
            {apply.isPending ? "Applying…" : `Apply ${tickedRows.length ? tickedRows.length : ""}`.trim()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
