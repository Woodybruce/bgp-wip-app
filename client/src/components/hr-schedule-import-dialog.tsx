import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// HR schedule → HR profiles (Woody, 2026-10-12). Upload the spreadsheet,
// see exactly which empty fields it fills for whom, then Apply. Nothing
// already in the app is overwritten; the file isn't kept.
const money = (pence: number) => `£${(pence / 100).toLocaleString("en-GB")}`;

export function HrScheduleImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const send = async (f: File, dryRun: boolean) => {
    const fd = new FormData();
    fd.append("file", f);
    if (dryRun) fd.append("dryRun", "1");
    const r = await fetch("/api/hr/import-schedule", { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Import failed");
    return j;
  };
  const preview = async (f: File) => {
    setFile(f); setBusy(true); setPlan(null);
    try { setPlan(await send(f, true)); } catch (e: any) { toast({ title: "Couldn't read the sheet", description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const apply = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await send(file, false);
      toast({ title: "HR profiles updated", description: `${r.salaries} salaries updated · ${r.fields} empty fields filled for ${r.people} people` });
      queryClient.invalidateQueries();
      setPlan(null); setFile(null); onClose();
    } catch (e: any) { toast({ title: "Couldn't apply it", description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const close = () => { setPlan(null); setFile(null); onClose(); };
  const show = (_k: string, v: any) => String(v);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-3xl max-h-[88dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Update from HR schedule</DialogTitle>
          <DialogDescription>Updates each person's salary to the sheet's figure (the old one stays in their salary history) and fills job title, date of birth, home address and start date where they're empty. People are matched by work email. The file isn't stored.</DialogDescription>
        </DialogHeader>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void preview(f); }} />
        <Button variant="outline" className="rounded-full w-fit" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="button-choose-hr-schedule">
          {busy && !plan ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}{file ? "Choose another file" : "Choose the spreadsheet"}
        </Button>
        {plan && (
          <div className="text-sm space-y-2">
            <p className="text-xs text-muted-foreground tabular-nums">{plan.rows} rows · {plan.salaryChanges?.length || 0} salaries to update · {plan.fills.length} people with gaps to fill{plan.unmatched.length ? ` · not matched: ${plan.unmatched.join(", ")}` : ""}</p>
            {plan.salaryChanges?.length > 0 && (
              <div className="overflow-x-auto"><table className="w-full text-xs tabular-nums"><tbody>
                {plan.salaryChanges.map((c: any) => (
                  <tr key={c.userId} className="border-t"><td className="py-1 pr-3 font-medium">{c.appName}</td><td className="py-1 pr-3 text-muted-foreground">{c.fromPence != null ? money(c.fromPence) : "none"}</td><td className="py-1">→ {money(c.toPence)}</td></tr>
                ))}
              </tbody></table></div>
            )}
            {plan.fills.length === 0 ? <p className="text-xs text-muted-foreground">No empty fields to fill.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-xs"><tbody>
                {plan.fills.map((f: any) => (
                  <tr key={f.userId} className="border-t align-top">
                    <td className="py-1 pr-3"><div className="font-medium">{f.appName}</div>{f.sheetName.toLowerCase() !== String(f.appName).toLowerCase() && <div className="text-muted-foreground">sheet: {f.sheetName} ({f.matchedBy})</div>}</td>
                    <td className="py-1">{Object.entries(f.fields).map(([k, v]) => <div key={k}><span className="text-muted-foreground">{plan.labels[k] || k}:</span> {show(k, v)}</div>)}</td>
                  </tr>
                ))}
              </tbody></table></div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={close}>Close</Button>
          <Button className="rounded-full" disabled={!(plan?.fills?.length || plan?.salaryChanges?.length) || busy} onClick={apply} data-testid="button-apply-hr-schedule">
            {busy && plan && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
