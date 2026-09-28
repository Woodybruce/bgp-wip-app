// Staff controls on a company page for how it is billed and reached:
// "PO on invoices" (clients like Canary Wharf Group only pay invoices that
// quote a PO number — deals billed to them warn before an invoice goes out)
// and "Move email domain" (canarywharf.com → cwg.com for this company's
// contacts only; previewed before anything changes).
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, Loader2, Mail, Receipt } from "lucide-react";
import type { CrmCompany } from "@shared/schema";

type MoveRow = { id: string; name: string; from: string; to: string; skipped: string | null };
type MoveResult = { from: string; to: string; applied: boolean; changed: number; rows: MoveRow[] };

export function CompanyInvoicingControls({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const { data: company } = useQuery<CrmCompany>({ queryKey: ["/api/crm/companies", companyId] });
  const requiresPo = !!company?.requiresPo;
  // Only companies BGP bills carry the PO setting (not every tenant brand).
  const billable = requiresPo || /client|landlord|billing|vendor|purchaser|investor/i.test(company?.companyType || "");
  const togglePo = useMutation({
    mutationFn: async (next: boolean) => (await apiRequest("PUT", `/api/crm/companies/${companyId}`, { requiresPo: next })).json(),
    onSuccess: (_d, next) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", companyId] });
      toast({ title: next ? "Invoices need a PO number" : "PO number no longer required", description: next ? "Deals billed to this company warn before an invoice goes out without one." : undefined });
    },
    onError: (e: any) => toast({ title: "Couldn't change the PO setting", description: e?.message, variant: "destructive" }),
  });

  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preview, setPreview] = useState<MoveResult | null>(null);
  const move = useMutation({
    mutationFn: async (apply: boolean) => (await apiRequest("POST", `/api/crm/companies/${companyId}/contacts/move-email-domain`, { from, to, apply })).json() as Promise<MoveResult>,
    onSuccess: (out) => {
      if (!out.applied) { setPreview(out); return; }
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId] });
      toast({ title: `${out.changed} contact${out.changed === 1 ? "" : "s"} moved to ${out.to}` });
      setOpen(false); setPreview(null);
    },
    onError: (e: any) => toast({ title: "Couldn't move the email domain", description: e?.message, variant: "destructive" }),
  });
  const movable = preview ? preview.rows.filter(r => !r.skipped).length : 0;

  return (
    <>
      {billable && (
      <Button variant="outline" size="sm" onClick={() => togglePo.mutate(!requiresPo)} disabled={togglePo.isPending}
        title={requiresPo ? "Invoices to this company (and its subsidiaries) need a PO number — click to turn off" : "Make invoices to this company (and its subsidiaries) need a PO number"} data-testid="button-toggle-requires-po">
        {requiresPo ? <Check /> : <Receipt />}{requiresPo ? "PO on invoices" : "Needs PO?"}
      </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => { setOpen(true); setPreview(null); }} data-testid="button-move-email-domain">
        <Mail />Move email domain
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPreview(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Move email domain</DialogTitle>
            <DialogDescription>Changes this company's contacts only — the part before the @ stays the same.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">From</Label>
              <Input value={from} onChange={e => { setFrom(e.target.value); setPreview(null); }} placeholder="canarywharf.com" data-testid="input-move-domain-from" />
            </div>
            <div>
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">To</Label>
              <Input value={to} onChange={e => { setTo(e.target.value); setPreview(null); }} placeholder="cwg.com" data-testid="input-move-domain-to" />
            </div>
          </div>
          {preview && (
            <div className="max-h-64 overflow-y-auto border border-border rounded-md divide-y divide-border" data-testid="move-domain-preview">
              {preview.rows.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No contacts on {preview.from} at this company.</p>
              ) : preview.rows.map(r => (
                <div key={r.id} className="px-3 py-2 text-sm">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-[11px] text-muted-foreground font-mono">{r.from} → {r.to}</p>
                  {r.skipped && <p className="text-[11px] text-amber-700 dark:text-amber-400">Skipped: {r.skipped}</p>}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => move.mutate(false)} disabled={!from.trim() || !to.trim() || move.isPending} data-testid="button-move-domain-preview">
              {move.isPending && !preview ? <Loader2 className="animate-spin" /> : null}Preview
            </Button>
            <Button onClick={() => move.mutate(true)} disabled={!preview || movable === 0 || move.isPending} data-testid="button-move-domain-apply">
              {move.isPending && preview ? <Loader2 className="animate-spin" /> : null}Move <span className="font-mono tabular-nums">{movable}</span> contact{movable === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
