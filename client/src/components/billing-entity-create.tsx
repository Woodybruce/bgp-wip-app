// Create billing entity (Woody, 2026-11-17: "if cant find a billing entity
// for tenant then should be able to create one and search companies house?
// Its saying not on xero but is connected to Xero just new billing entity for
// the brand"). Opened from the Xero contact picker when Xero has no match and
// the picker knows the brand. The person finds the company at Companies
// House; POST /api/billing-entities (server/billing-entity.ts) saves it under
// the brand and makes it a contact in the firm's Xero, and that contact is
// handed back for the picker to select. Nothing else on the form is saved.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Landmark, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/queryClient";
import type { XeroContact } from "@/components/xero-contact-picker";

type ChHit = { companyNumber: string; title: string; companyStatus?: string | null; addressSnippet?: string | null };
// Companies House statuses that cannot be billed (the server refuses them too).
const CLOSED = new Set(["dissolved", "converted-closed", "removed", "closed"]);

export function CreateBillingEntityDialog({ open, onOpenChange, brand, initialQuery, onCreated, testIdPrefix = "billing-entity" }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brand: { id: string; name: string };
  initialQuery: string;
  onCreated: (contact: XeroContact) => void;
  testIdPrefix?: string;
}) {
  const { toast } = useToast();
  const [term, setTerm] = useState(initialQuery);
  const [q, setQ] = useState(initialQuery.trim());
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { if (open) { setTerm(initialQuery); setQ(initialQuery.trim()); setProblem(null); } }, [open, initialQuery]);
  useEffect(() => { const t = setTimeout(() => setQ(term.trim()), 300); return () => clearTimeout(t); }, [term]);

  const ch = useQuery<ChHit[], Error>({
    queryKey: ["/api/companies-house/search", q, "billing-entity"],
    enabled: open && q.length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const r = await fetch(`/api/companies-house/search?q=${encodeURIComponent(q)}`, { credentials: "include", headers: getAuthHeaders() });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error || body?.message || "Companies House could not be searched. Try again.");
      return Array.isArray(body?.items) ? body.items : [];
    },
  });

  const create = async (hit: ChHit) => {
    if (busy) return;
    setBusy(hit.companyNumber);
    setProblem(null);
    try {
      const res = await fetch("/api/billing-entities", {
        method: "POST",
        credentials: "include",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: brand.id, companyNumber: hit.companyNumber }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setProblem(body?.message || "The billing entity could not be made. Try again."); return; }
      if (body?.contact?.ContactID) {
        onCreated(body.contact as XeroContact);
        toast({
          title: body.xeroCreated ? "Billing entity created" : "Billing entity linked",
          description: `${body.contact.Name}: saved under ${brand.name}${body.xeroCreated ? " and added to Xero" : ", and already in Xero"}.`,
        });
        onOpenChange(false);
      } else {
        // The company is saved under the brand; the Xero step said why it did not happen.
        setProblem(`${body?.entity?.name || hit.title} is saved under ${brand.name}. ${body?.xeroError || "The Xero contact was not made."}`);
      }
    } catch {
      setProblem("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const hits = ch.data || [];
  return (
    <Dialog open={open} onOpenChange={v => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-md" data-testid={`${testIdPrefix}-dialog`}>
        <DialogHeader>
          <DialogTitle>Create billing entity</DialogTitle>
          <DialogDescription>
            Find the company at Companies House. It is saved under {brand.name} and added to the firm's Xero as a contact.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={term}
          onChange={e => setTerm(e.target.value)}
          placeholder="Company name or number"
          aria-label="Search Companies House"
          data-testid={`${testIdPrefix}-search`}
        />
        <div className="max-h-72 space-y-0.5 overflow-y-auto" data-testid={`${testIdPrefix}-results`}>
          {q.length < 2 && <p className="px-1 py-1 text-xs text-muted-foreground">Type at least two letters.</p>}
          {q.length >= 2 && ch.isFetching && !ch.data && (
            <p className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking up…</p>
          )}
          {q.length >= 2 && ch.error && <p className="px-1 py-1 text-xs text-destructive" role="alert">{ch.error.message}</p>}
          {q.length >= 2 && ch.data && hits.length === 0 && <p className="px-1 py-1 text-xs text-muted-foreground">Companies House has nothing by that name.</p>}
          {hits.map(hit => {
            const closed = CLOSED.has(String(hit.companyStatus || "").toLowerCase());
            return (
              <button
                key={hit.companyNumber}
                type="button"
                disabled={closed || !!busy}
                onClick={() => void create(hit)}
                className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                title={closed ? "Closed at Companies House: it cannot be billed" : `Save under ${brand.name} and add to Xero`}
                data-testid={`${testIdPrefix}-pick-${hit.companyNumber}`}
              >
                {busy === hit.companyNumber
                  ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                  : <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0">
                  <span className="block truncate font-medium">{hit.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[hit.companyNumber, hit.companyStatus, hit.addressSnippet].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {problem && <p className="text-xs text-destructive" role="alert" data-testid={`${testIdPrefix}-problem`}>{problem}</p>}
      </DialogContent>
    </Dialog>
  );
}
