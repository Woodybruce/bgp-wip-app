import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Fill blanks from Xero (Woody, 2026-10-12). Preview first; Apply writes
// only empty fields and adds only contacts whose email isn't in the CRM.
type Kind = "staff" | "companies";
const LABEL: Record<string, string> = { dob: "Date of birth", address: "Home address", personal_email: "Personal email" };

export function XeroFillDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [kind, setKind] = useState<Kind>("staff");
  const [plan, setPlan] = useState<any>(null);
  const preview = useMutation({
    mutationFn: async (k: Kind) => (await apiRequest("GET", `/api/admin/xero-fill/${k}/preview`)).json(),
    onSuccess: (r) => setPlan(r),
    onError: (e: any) => toast({ title: "Couldn't read Xero", description: e?.message, variant: "destructive" }),
  });
  const apply = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/xero-fill/${kind}/apply`)).json(),
    onSuccess: (r: any) => {
      toast({ title: "Filled from Xero", description: kind === "staff" ? `${r.fields} details on ${r.people} people` : `${r.phones} phones, ${r.addresses} addresses, ${r.contacts} new contacts` });
      queryClient.invalidateQueries();
      setPlan(null);
    },
    onError: (e: any) => toast({ title: "Couldn't apply it", description: e?.message, variant: "destructive" }),
  });
  const pick = (k: Kind) => { setKind(k); setPlan(null); preview.mutate(k); };
  const count = plan?.fills?.length || 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setPlan(null); onClose(); } }}>
      <DialogContent className="max-w-3xl max-h-[88dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fill from Xero</DialogTitle>
          <DialogDescription>Only empty fields are filled — nothing already in the app is changed, and nothing is sent to Xero. Check the list, then Apply.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button size="sm" variant={kind === "staff" && plan ? "default" : "outline"} className="rounded-full" disabled={preview.isPending} onClick={() => pick("staff")}>Staff from Xero Payroll</Button>
          <Button size="sm" variant={kind === "companies" && plan ? "default" : "outline"} className="rounded-full" disabled={preview.isPending} onClick={() => pick("companies")}>CRM companies from Xero contacts</Button>
        </div>
        {preview.isPending && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Reading Xero…</p>}
        {plan && kind === "staff" && (
          <div className="text-sm space-y-2">
            <p className="text-xs text-muted-foreground">Date of birth, home address and personal email for staff linked to Xero Payroll (HR → Link to Xero). Payroll phone numbers aren't copied — the profile phone shows on business cards.</p>
            {plan.unlinked?.length > 0 && <p className="text-xs text-muted-foreground">Not linked to payroll yet (skipped): {plan.unlinked.join(", ")}</p>}
            {count === 0 ? <p>Nothing to fill.</p> : <div className="overflow-x-auto"><table className="w-full text-xs"><tbody>
              {plan.fills.map((f: any) => <tr key={f.userId} className="border-t align-top"><td className="py-1 pr-3 font-medium">{f.name}</td><td className="py-1">{Object.entries(f.fields).map(([k, v]) => <div key={k}><span className="text-muted-foreground">{LABEL[k] || k}:</span> {String(v)}</div>)}</td></tr>)}
            </tbody></table></div>}
          </div>
        )}
        {plan && kind === "companies" && (
          <div className="text-sm space-y-2">
            <p className="text-xs text-muted-foreground">{plan.xeroContacts} Xero contacts, {plan.matched} matched to a CRM company by exact name. Fills a blank phone / head office address and adds Xero's contact people whose email isn't in the CRM yet.</p>
            {count === 0 ? <p>Nothing to fill.</p> : <div className="overflow-x-auto"><table className="w-full text-xs"><tbody>
              {plan.fills.map((f: any) => <tr key={f.companyId} className="border-t align-top"><td className="py-1 pr-3 font-medium">{f.company}</td><td className="py-1">
                {f.phone && <div><span className="text-muted-foreground">Phone:</span> {f.phone}</div>}
                {f.address && <div><span className="text-muted-foreground">Address:</span> {f.address.address}</div>}
                {f.newContacts.map((c: any) => <div key={c.email}><span className="text-muted-foreground">New contact:</span> {c.name} · {c.email}</div>)}
              </td></tr>)}
            </tbody></table></div>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={onClose}>Close</Button>
          <Button className="rounded-full" disabled={!plan || count === 0 || apply.isPending}
            onClick={() => { if (confirm(`Fill ${count} ${kind === "staff" ? "people" : "companies"} from Xero? Only empty fields are filled.`)) apply.mutate(); }}
            data-testid="button-apply-xero-fill">
            {apply.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
