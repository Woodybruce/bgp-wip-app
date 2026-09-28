// Plans from what the property already holds (Woody, 2026-09-28: "why are
// plans not being loaded up? you have them from the brochures"). The Plans
// board suggests the brochure pages that read as floor / site plans, and its
// "Add from" menu picks brochure pages or a SharePoint plan file. Everything
// goes through the server's plan PDF path; pages or files already on the
// board are skipped. Staff only — the panel hides these for client logins.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/queryClient";
import { SharePointFilePicker, candidateKey, type SharePointCandidate } from "@/components/sharepoint-file-picker";
import { CheckCircle2, FileText, FolderOpen, Plus } from "lucide-react";

type BrochurePlanPage = { page: number; name: string | null; kind: "floor" | "site" | null; imported: boolean };
type BrochurePages = { id: string; name: string; type: string; pageCount: number | null; pages: BrochurePlanPage[]; imported: number[]; error?: string };
type ImportResult = { plans?: Array<{ id: string }>; pages?: number; scanning?: number; duplicate?: boolean };

const pagesKey = (propertyId: string) => ["/api/properties", propertyId, "plans", "brochure-pages"];

async function send(url: string, body: unknown): Promise<ImportResult> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || "That didn't work — try again in a moment.");
  return json;
}

function useBrochurePages(propertyId: string, enabled: boolean) {
  return useQuery<{ brochures: BrochurePages[] }>({
    queryKey: pagesKey(propertyId),
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const response = await fetch(`/api/properties/${propertyId}/plans/brochure-pages`, { credentials: "include", headers: getAuthHeaders() });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "Couldn't look through the brochures.");
      return json;
    },
  });
}

const typeLabel = (type: string) => type === "investment" ? "investment" : "leasing";
const pending = (b: BrochurePages) => b.pages.filter(p => !p.imported);

function scanNote(result: { scanning: number }) {
  return result.scanning ? "Scanning for units — Review scan when it's ready." : "Double-click a floor name to rename it.";
}

/** "3 plan pages found in the leasing brochure" above the board, until they
 *  are added or dismissed. */
export function BrochurePlansBanner({ propertyId, onImported }: { propertyId: string; onImported: (planId: string) => void }) {
  const pagesQ = useBrochurePages(propertyId, true);
  const [open, setOpen] = useState(false);
  const withPlans = (pagesQ.data?.brochures || []).filter(b => pending(b).length);
  const signature = withPlans.flatMap(b => pending(b).map(p => `${b.id}:${p.page}`)).join(",");
  const storageKey = `bgp.plans.brochureSuggestion.${propertyId}`;
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => { try { setDismissed(localStorage.getItem(storageKey)); } catch { setDismissed(null); } }, [storageKey]);
  if (!signature || dismissed === signature) return null;
  const count = withPlans.reduce((n, b) => n + pending(b).length, 0);
  const types = [...new Set(withPlans.map(b => typeLabel(b.type)))];
  const where = withPlans.length === 1 ? `the ${types[0]} brochure` : `the ${types.join(" and ")} brochures`;
  return <>
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2" data-testid="plans-brochure-suggestion">
      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="text-sm flex-1 min-w-[12rem]">{count} plan page{count === 1 ? "" : "s"} found in {where}</span>
      <Button size="sm" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid="button-plans-from-brochure-suggestion">Add them</Button>
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { try { localStorage.setItem(storageKey, signature); } catch { /* per-viewer only */ } setDismissed(signature); }}>Not now</Button>
    </div>
    {open && <BrochurePagesDialog propertyId={propertyId} onClose={() => setOpen(false)} onImported={onImported} />}
  </>;
}

/** The board's "Add from" menu: brochure pages or a SharePoint plan file. */
export function PlanSourcesMenu({ propertyId, onImported }: { propertyId: string; onImported: (planId: string) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [brochuresOpen, setBrochuresOpen] = useState(false);
  const [sharePointOpen, setSharePointOpen] = useState(false);
  const spUrl = `/api/properties/${propertyId}/plans/sharepoint-candidates`;
  const fromSharePoint = useMutation({
    mutationFn: (c: SharePointCandidate) => send(`/api/properties/${propertyId}/plans/from-sharepoint`, { driveId: c.driveId, itemId: c.itemId, webUrl: c.webUrl }),
    onSuccess: (result, c) => {
      const plans = result.plans || [];
      if (plans[0]) onImported(plans[0].id);
      toast(result.duplicate
        ? { title: "Already on the Plans board", description: c.name }
        : { title: `Added ${plans.length} plan${plans.length === 1 ? "" : "s"} from SharePoint`, description: `${c.name}. ${scanNote({ scanning: result.scanning || 0 })}` });
      void queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "plans"] });
      void queryClient.invalidateQueries({ queryKey: [spUrl] });
    },
    onError: (error: Error) => toast({ title: "Couldn't add the plan", description: error.message, variant: "destructive" }),
  });
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="h-8 text-xs" data-testid="button-plan-sources"><Plus className="w-3.5 h-3.5 mr-1" />Add from</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setBrochuresOpen(true)} data-testid="button-plans-from-brochure"><FileText className="w-3.5 h-3.5 mr-2" />Brochure pages</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setSharePointOpen(true)} data-testid="button-plans-from-sharepoint"><FolderOpen className="w-3.5 h-3.5 mr-2" />SharePoint</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {brochuresOpen && <BrochurePagesDialog propertyId={propertyId} onClose={() => setBrochuresOpen(false)} onImported={onImported} />}
    <SharePointFilePicker
      open={sharePointOpen}
      onClose={() => setSharePointOpen(false)}
      title="Add a plan from SharePoint"
      url={spUrl}
      importLabel="Add as plan"
      importingKey={fromSharePoint.isPending && fromSharePoint.variables ? candidateKey(fromSharePoint.variables) : null}
      onImport={c => fromSharePoint.mutate(c)}
    />
  </>;
}

function BrochurePagesDialog({ propertyId, onClose, onImported }: { propertyId: string; onClose: () => void; onImported: (planId: string) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const pagesQ = useBrochurePages(propertyId, true);
  const brochures = pagesQ.data?.brochures || [];
  const [picked, setPicked] = useState<Record<string, number[]> | null>(null);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (picked || !pagesQ.data) return;
    setPicked(Object.fromEntries(pagesQ.data.brochures.map(b => [b.id, pending(b).map(p => p.page)])));
  }, [pagesQ.data, picked]);
  const chosen = picked || {};
  const total = Object.values(chosen).reduce((n, pages) => n + pages.length, 0);
  const add = useMutation({
    mutationFn: async () => {
      let added = 0, scanning = 0, firstId: string | null = null;
      for (const b of brochures) {
        const pages = chosen[b.id] || [];
        if (!pages.length) continue;
        if (pages.length > 10) throw new Error(`Pick up to 10 pages at a time from the ${typeLabel(b.type)} brochure.`);
        const result = await send(`/api/properties/${propertyId}/plans/from-brochure`, { brochureId: b.id, pages });
        added += result.plans?.length || 0; scanning += result.scanning || 0;
        firstId ||= result.plans?.[0]?.id || null;
      }
      return { added, scanning, firstId };
    },
    onSuccess: result => {
      if (result.firstId) onImported(result.firstId);
      toast(result.added
        ? { title: `Added ${result.added} plan${result.added === 1 ? "" : "s"} from the brochures`, description: `${scanNote(result)} The pages are kept as the plan's original PDF.` }
        : { title: "Already on the Plans board", description: "Those brochure pages were added before." });
      onClose();
    },
    onError: (error: Error) => toast({ title: "Couldn't add the pages", description: error.message, variant: "destructive" }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "plans"] }); },
  });
  function toggle(brochureId: string, page: number, on: boolean) {
    setPicked(current => {
      const pages = new Set(current?.[brochureId] || []);
      if (on) pages.add(page); else pages.delete(page);
      return { ...(current || {}), [brochureId]: [...pages].sort((a, b) => a - b) };
    });
  }
  return <Dialog open onOpenChange={value => { if (!value && !add.isPending) onClose(); }}>
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Add plans from the brochures</DialogTitle>
        <DialogDescription className="text-xs">Pages that read as floor or site plans are ticked. Each becomes a plan, rendered at print quality, named from its title and scanned for units.</DialogDescription>
      </DialogHeader>
      {pagesQ.isPending ? <div className="grid grid-cols-2 sm:grid-cols-4 gap-2"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
        : pagesQ.isError ? <p role="alert" className="text-sm text-destructive">{pagesQ.error.message} <button className="underline" onClick={() => pagesQ.refetch()}>Retry</button></p>
        : !brochures.length ? <p className="text-sm text-muted-foreground">No brochures on this property yet — upload one in Brochures.</p>
        : <div className="space-y-4">{brochures.map(b => {
          const detected = new Map(b.pages.map(p => [p.page, p]));
          const done = new Set(b.imported);
          const all = showAll[b.id];
          const pages = all ? Array.from({ length: Math.min(b.pageCount || 0, 60) }, (_, i) => i + 1) : b.pages.map(p => p.page);
          return <section key={b.id} className="space-y-2" data-testid="plans-brochure-section">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex-1 min-w-0 truncate" title={b.name}>{typeLabel(b.type)} brochure · {b.name}</p>
              {!!b.pageCount && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAll(current => ({ ...current, [b.id]: !all }))}>{all ? "Plan pages only" : `Show all ${b.pageCount} pages`}</Button>}
            </div>
            {b.error ? <p className="text-sm text-muted-foreground">{b.error}</p>
              : !pages.length ? <p className="text-sm text-muted-foreground">No plan pages found — show all pages to pick one.</p>
              : <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{pages.map(page => {
                const info = detected.get(page);
                const onBoard = done.has(page);
                const checked = (chosen[b.id] || []).includes(page);
                return <label key={page} className={`block rounded-lg border p-1.5 ${checked ? "border-foreground" : "border-border"} ${onBoard ? "opacity-60" : "cursor-pointer hover:bg-muted/40"}`} data-testid="plans-brochure-page">
                  <img src={`/api/properties/${propertyId}/plans/brochure-pages/${b.id}/${page}/thumb`} alt={`Page ${page}`} loading="lazy" className="w-full h-24 object-contain bg-muted/30 rounded" />
                  <span className="mt-1 flex items-center gap-1.5 text-xs">
                    {onBoard ? <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <input type="checkbox" checked={checked} onChange={event => toggle(b.id, page, event.target.checked)} aria-label={`Add page ${page}`} />}
                    <span className="truncate">Page <span className="font-mono tabular-nums">{page}</span>{info ? ` · ${info.name || (info.kind === "site" ? "Site plan" : "Floor plan")}` : ""}</span>
                  </span>
                  {onBoard && <span className="block text-[11px] text-muted-foreground">On the board</span>}
                </label>;
              })}</div>}
          </section>;
        })}</div>}
      <DialogFooter>
        <Button variant="outline" disabled={add.isPending} onClick={onClose}>Cancel</Button>
        <Button disabled={add.isPending || !total} onClick={() => add.mutate()} data-testid="button-add-brochure-plans">{add.isPending ? "Adding…" : `Add ${total} plan${total === 1 ? "" : "s"}`}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
