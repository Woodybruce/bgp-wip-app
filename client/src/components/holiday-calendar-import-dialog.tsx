import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Holiday calendar spreadsheet → approved holiday requests + this year's
// entitlement (Woody, 2026-10-28). Upload, see every run of leave it will
// add per person, then Apply. Dates that already have a request are left
// alone; notes on the sheet (wedding, study, unpaid) are listed, not
// imported. The file isn't kept.
const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
const range = (r: { start: string; end: string }) => (r.start === r.end ? fmt(r.start) : `${fmt(r.start)} – ${fmt(r.end)}`);

export function HolidayCalendarImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const send = async (f: File, dryRun: boolean) => {
    const fd = new FormData();
    fd.append("file", f);
    if (dryRun) fd.append("dryRun", "1");
    const r = await fetch("/api/hr/import-holidays", { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Import failed");
    return j;
  };
  const preview = async (f: File) => {
    setFile(f); setBusy(true); setPlan(null);
    try { setPlan(await send(f, true)); } catch (e: any) { toast({ title: "Couldn't read the calendar", description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const apply = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await send(file, false);
      toast({ title: "Holidays imported", description: `${r.requests} holidays (${r.days} days) for ${r.people} people · ${r.entitlements} entitlements set` });
      queryClient.invalidateQueries();
      setPlan(null); setFile(null); onClose();
    } catch (e: any) { toast({ title: "Couldn't apply it", description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const close = () => { setPlan(null); setFile(null); onClose(); };
  const canApply = !!(plan?.totals?.requests || plan?.totals?.entitlements);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-3xl max-h-[88dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import holiday calendar</DialogTitle>
          <DialogDescription>Reads every holiday-year sheet (1 May – 30 April) and adds each run of leave as an approved holiday, so the app's used / remaining match the calendar. Dates that already have a request are skipped, and the current year's entitlement is set from the Holiday column. Notes on the sheet (wedding, study, unpaid) are listed, not imported. The file isn't stored.</DialogDescription>
        </DialogHeader>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void preview(f); }} />
        <Button variant="outline" className="rounded-full w-fit" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="button-choose-holiday-calendar">
          {busy && !plan ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}{file ? "Choose another file" : "Choose the calendar spreadsheet"}
        </Button>
        {plan && (
          <div className="text-sm space-y-3">
            <p className="text-xs text-muted-foreground tabular-nums">
              {plan.sheets.map((s: any) => `${s.label}${s.current ? " (this year)" : ""}: ${s.people} people`).join(" · ")}
            </p>
            <p className="text-xs tabular-nums">
              <span className="font-medium">{plan.totals.requests} holidays</span> ({plan.totals.days} days) to add for {plan.totals.people} people · {plan.totals.entitlements} entitlements to set for {plan.currentYear}
              {plan.unmatched.length > 0 && <span className="text-amber-600"> · not matched to a login: {plan.unmatched.join(", ")}</span>}
            </p>
            {plan.people.length === 0 ? <p className="text-xs text-muted-foreground">Nothing to add — every holiday on the sheet is already in the app.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-xs"><tbody>
                {plan.people.map((p: any) => (
                  <tr key={p.userId} className="border-t align-top">
                    <td className="py-1 pr-3 whitespace-nowrap">
                      <div className="font-medium">{p.appName}</div>
                      {p.sheetName.toLowerCase() !== String(p.appName).toLowerCase() && <div className="text-muted-foreground">sheet: {p.sheetName} ({p.matchedBy})</div>}
                      {p.entitlement && <div className="text-muted-foreground">entitlement {p.entitlement.year}: {p.entitlement.from ?? "none"} → <span className="text-foreground">{p.entitlement.to}</span></div>}
                      {p.alreadyThere > 0 && <div className="text-muted-foreground">{p.alreadyThere} already in the app ({p.alreadyThereDays} days)</div>}
                    </td>
                    <td className="py-1 tabular-nums">
                      {p.requests.map((r: any, i: number) => <div key={i}>{range(r)} <span className="text-muted-foreground">· {r.days} {r.days === 1 ? "day" : "days"} · {r.year}</span></div>)}
                    </td>
                  </tr>
                ))}
              </tbody></table></div>
            )}
            {plan.notes.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">{plan.notes.length} notes on the sheet not imported (wedding, study, unpaid…)</summary>
                <div className="mt-1 space-y-0.5">{plan.notes.map((n: any, i: number) => <div key={i}>{fmt(n.date)} · {n.name}: {n.text}</div>)}</div>
              </details>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={close}>Close</Button>
          <Button className="rounded-full" disabled={!canApply || busy} onClick={apply} data-testid="button-apply-holiday-calendar">
            {busy && plan && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
