// Preview-then-apply for a landlord's weekly leasing minutes (CWG "Retail
// Leasing Minutes"): the latest visible week's tab updates this estate's
// leasing schedule — sections become schemes, units are matched by the
// landlord's unit code then by name, offers / comments land in Updates.
// Nothing is written until Apply. Staff only (callers hide it for clients).
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import type { SharePointCandidate } from "@/components/sharepoint-file-picker";

export type MinutesSource = { kind: "file"; file: File } | { kind: "sharepoint"; candidate: SharePointCandidate };

type MinutesRow = { action: "create" | "update" | "unchanged"; unitId: string | null; unitName: string; scheme: string; sourceRow: number; changes: Array<{ field: string; from: string | null; to: string | null }> };
type MinutesResult = {
  dryRun: boolean; fileName: string | null; sheetName: string; weekLabel: string | null; weeklySheets: number;
  schemes: Array<{ name: string; code: string | null; exists: boolean }>;
  counts: { create: number; update: number; unchanged: number; statusChanges: number };
  rows: MinutesRow[]; notInMinutes: Array<{ id: string; unitName: string | null; zone: string | null }>;
  warnings: string[]; message: string;
};

const FIELD_LABELS: Record<string, string> = {
  zone: "scheme", unit_code: "unit code", tenant_name: "tenant", sqft: "sq ft", status: "status",
  updates: "updates", financial_notes: "figures", lease_expiry: "expiry", lease_break: "break",
};

async function runImport(propertyId: string, source: MinutesSource, dryRun: boolean, keepStatus: boolean): Promise<MinutesResult> {
  let r: Response;
  if (source.kind === "file") {
    const fd = new FormData();
    fd.append("file", source.file);
    fd.append("dryRun", String(dryRun));
    fd.append("keepStatus", String(keepStatus));
    r = await fetch(`/api/leasing-schedule/property/${propertyId}/minutes/import-excel`, { method: "POST", headers: getAuthHeaders(), body: fd, credentials: "include" });
  } else {
    const c = source.candidate;
    r = await fetch(`/api/leasing-schedule/property/${propertyId}/minutes/import-excel-from-sharepoint`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ driveId: c.driveId, itemId: c.itemId, webUrl: c.webUrl, dryRun, keepStatus }),
    });
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

export function LeasingMinutesImportDialog({ propertyId, source, onClose }: { propertyId: string; source: MinutesSource | null; onClose: () => void }) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<MinutesResult | null>(null);
  const [showAll, setShowAll] = useState(false);
  // An older week's minutes can lag the deals; untick to leave statuses alone.
  const [moveStatus, setMoveStatus] = useState(true);
  const previewRun = useMutation({ mutationFn: (s: MinutesSource) => runImport(propertyId, s, true, !moveStatus), onSuccess: setPreview });
  const apply = useMutation({
    mutationFn: (s: MinutesSource) => runImport(propertyId, s, false, !moveStatus),
    onSuccess: (out) => {
      for (const key of [["/api/leasing-schedule/property", propertyId], ["/api/leasing-schedule"], ["/api/properties", propertyId, "schemes"], ["/api/tenancy-schedule/property", propertyId], ["/api/available-units"]]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast({ title: "Minutes imported", description: out.message });
      onClose();
    },
    onError: (e: any) => toast({ title: "Import failed", description: e?.message, variant: "destructive" }),
  });
  useEffect(() => {
    setPreview(null); setShowAll(false);
    if (source) previewRun.mutate(source);
  }, [source, moveStatus]);
  useEffect(() => { setMoveStatus(true); }, [source]);

  const changed = (preview?.rows || []).filter(r => r.action !== "unchanged");
  const listed = showAll ? changed : changed.slice(0, 40);
  const newSchemes = (preview?.schemes || []).filter(s => !s.exists);

  return (
    <Dialog open={!!source} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="leasing-minutes-dialog">
        <DialogHeader>
          <DialogTitle>Import leasing minutes</DialogTitle>
          <DialogDescription>
            {preview ? `${preview.fileName || "Workbook"} — the latest week is "${preview.sheetName}"${preview.weeklySheets > 1 ? ` (of ${preview.weeklySheets} weekly tabs)` : ""}. Review, then apply.` : "Reading the workbook…"}
          </DialogDescription>
        </DialogHeader>
        {previewRun.isPending && <div className="space-y-2"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-24 w-full" /></div>}
        {previewRun.isError && <p className="text-sm text-muted-foreground">{(previewRun.error as Error).message}</p>}
        {preview && (
          <div className="space-y-3 text-sm">
            <p className="text-sm" data-testid="minutes-counts">
              <span className="font-mono tabular-nums">{preview.counts.create}</span> new units · <span className="font-mono tabular-nums">{preview.counts.update}</span> updated · <span className="font-mono tabular-nums">{preview.counts.unchanged}</span> unchanged · <span className="font-mono tabular-nums">{preview.counts.statusChanges}</span> status moves
            </p>
            {(preview.counts.statusChanges > 0 || !moveStatus) && (
              <label className="flex items-center gap-2 text-sm" data-testid="minutes-move-status">
                <Checkbox checked={moveStatus} onCheckedChange={(v) => setMoveStatus(v === true)} />
                Move statuses to what these minutes say
                <span className="text-[11px] text-muted-foreground">— untick if the week is older than the deals</span>
              </label>
            )}
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Schemes</div>
              <p className="text-sm">{preview.schemes.map(s => `${s.name}${s.code ? ` (${s.code})` : ""}${s.exists ? "" : " — new"}`).join(" · ") || "None found"}</p>
              {newSchemes.length > 0 && <p className="text-[11px] text-muted-foreground mt-0.5">New schemes are added to the property; set their landlord entity on the property page.</p>}
            </div>
            {changed.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Changes</div>
                <div className="border border-border rounded-md divide-y divide-border">
                  {listed.map(r => (
                    <div key={`${r.sourceRow}-${r.unitName}`} className="px-3 py-1.5 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate">{r.unitName}</p>
                        <p className="text-[11px] text-muted-foreground">{r.scheme} · row <span className="font-mono tabular-nums">{r.sourceRow}</span></p>
                      </div>
                      <span className="text-[11px] text-muted-foreground text-right shrink-0">
                        {r.action === "create" ? "New unit" : r.changes.map(c => c.field === "status" ? `${c.from || "—"} → ${c.to}` : FIELD_LABELS[c.field] || c.field).join(", ")}
                      </span>
                    </div>
                  ))}
                </div>
                {changed.length > listed.length && <button type="button" className="text-[11px] text-primary hover:underline mt-1" onClick={() => setShowAll(true)}>Show all {changed.length}</button>}
              </div>
            )}
            {preview.notInMinutes.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">On the schedule, not in these minutes</div>
                <p className="text-[11px] text-muted-foreground">Left as they are. If one is a new unit above under another name, merge them after importing.</p>
                <p className="text-sm mt-0.5">{preview.notInMinutes.map(u => u.unitName || "Unnamed").join(" · ")}</p>
              </div>
            )}
            {preview.warnings.length > 0 && (
              <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5">
                {preview.warnings.slice(0, 12).map(w => <li key={w}>{w}</li>)}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => source && apply.mutate(source)} disabled={!preview || apply.isPending || (preview.counts.create + preview.counts.update === 0)} data-testid="button-apply-minutes">
            {apply.isPending ? "Applying…" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
