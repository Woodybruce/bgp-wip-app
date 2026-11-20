// Create billing entity (Woody, 2026-11-17: "if cant find a billing entity
// for tenant then should be able to create one and search companies house?
// Its saying not on xero but is connected to Xero just new billing entity for
// the brand"). Opened from the Xero contact picker when Xero has no match and
// the picker knows the brand. The person finds the company at Companies
// House; POST /api/billing-entities (server/billing-entity.ts) saves it under
// the brand and makes it a contact in the firm's Xero, and that contact is
// handed back for the picker to select. Nothing else on the form is saved.
//
// Or a person (Woody, 20 November 2026: "need ability to create billing
// entity or contracting entity as a person we will then KYC them"): their
// name, email and mobile, filed under the brand as a person and added to the
// CRM; the deal then checks them as a private individual.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Landmark, Loader2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/queryClient";
import type { XeroContact } from "@/components/xero-contact-picker";

type ChHit = { companyNumber: string; title: string; companyStatus?: string | null; addressSnippet?: string | null };
// The company as saved under the brand (crm_trading_entities): the deal
// records it as the company that signs for the party (2026-11-18).
// kind "individual": a person who signs or is billed in their own name.
export type SavedCompany = { id: string; name: string; companiesHouseNumber: string | null; kind?: "company" | "individual"; contactId?: string | null };
// Companies House statuses that cannot be billed (the server refuses them too).
const CLOSED = new Set(["dissolved", "converted-closed", "removed", "closed"]);

export function CreateBillingEntityDialog({ open, onOpenChange, brand, initialQuery, onCreated, onSavedWithoutXero, testIdPrefix = "billing-entity", xero = true, startAsPerson = false }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brand: { id: string; name: string };
  initialQuery: string;
  onCreated: (contact: XeroContact, company: SavedCompany | null) => void;
  // Given, a company saved under the brand counts even when Xero made no
  // contact (the deal's parties need the company; billing can follow).
  onSavedWithoutXero?: (company: SavedCompany, reason: string) => void;
  testIdPrefix?: string;
  // false: filed under the brand with no Xero contact (a party BGP does not
  // bill: the one that signs for it is still checked).
  xero?: boolean;
  startAsPerson?: boolean;
}) {
  const [mode, setMode] = useState<"company" | "person">(startAsPerson ? "person" : "company");
  const [person, setPerson] = useState({ name: "", email: "", mobile: "" });
  useEffect(() => { if (open) { setMode(startAsPerson ? "person" : "company"); setPerson({ name: "", email: "", mobile: "" }); } }, [open, startAsPerson]);
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
        body: JSON.stringify({ brandId: brand.id, companyNumber: hit.companyNumber, ...(xero ? {} : { xero: false }) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setProblem(body?.message || "The billing entity could not be made. Try again."); return; }
      const company: SavedCompany | null = body?.entity?.id ? { id: String(body.entity.id), name: String(body.entity.name || hit.title), companiesHouseNumber: body.entity.companiesHouseNumber || hit.companyNumber } : null;
      if (body?.contact?.ContactID) {
        onCreated(body.contact as XeroContact, company);
        toast({
          title: body.xeroCreated ? "Billing entity created" : "Billing entity linked",
          description: `${body.contact.Name}: saved under ${brand.name}${body.xeroCreated ? " and added to Xero" : ", and already in Xero"}.`,
        });
        onOpenChange(false);
      } else if (company && onSavedWithoutXero) {
        onSavedWithoutXero(company, body?.xeroError || "The Xero contact was not made.");
        toast({ title: "Company saved", description: `${company.name} is saved under ${brand.name}. Not in Xero: ${body?.xeroError || "the Xero contact was not made."}` });
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

  const savePerson = async () => {
    if (busy) return;
    setBusy("person");
    setProblem(null);
    try {
      const res = await fetch("/api/billing-entities", {
        method: "POST",
        credentials: "include",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: brand.id, person: { name: person.name, email: person.email || null, mobile: person.mobile || null }, ...(xero ? {} : { xero: false }) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setProblem(body?.message || "The person could not be saved. Try again."); return; }
      const company: SavedCompany = { id: String(body.entity.id), name: String(body.entity.name || person.name), companiesHouseNumber: null, kind: "individual", contactId: body.entity.contactId || null };
      if (body?.contact?.ContactID) {
        onCreated(body.contact as XeroContact, company);
        toast({ title: "Person added", description: `${company.name}: saved under ${brand.name}${body.xeroCreated ? " and added to Xero" : ", and already in Xero"}. They are checked as a private individual.` });
        onOpenChange(false);
      } else if (onSavedWithoutXero) {
        onSavedWithoutXero(company, body?.xeroError || (xero ? "The Xero contact was not made." : "Not added to Xero: BGP does not bill this party."));
        toast({ title: "Person added", description: `${company.name} is saved under ${brand.name}. They are checked as a private individual.${xero && body?.xeroError ? ` Not in Xero: ${body.xeroError}` : ""}` });
        onOpenChange(false);
      } else {
        setProblem(`${company.name} is saved under ${brand.name}. ${body?.xeroError || "The Xero contact was not made."}`);
      }
    } catch {
      setProblem("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };
  const personReady = person.name.trim().split(/\s+/).length >= 2 && (!person.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email.trim()));

  const hits = ch.data || [];
  return (
    <Dialog open={open} onOpenChange={v => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-md" data-testid={`${testIdPrefix}-dialog`}>
        <DialogHeader>
          <DialogTitle>{xero ? "Create billing entity" : "Who signs"}</DialogTitle>
          <DialogDescription>
            {mode === "person"
              ? <>A person who signs{xero ? " or is billed" : ""} in their own name. They are saved under {brand.name}{xero ? " and added to the firm's Xero" : ""}, and checked as a private individual: an identity check and a proof of address.</>
              : <>Find the company at Companies House. It is saved under {brand.name}{xero ? " and added to the firm's Xero as a contact" : ""}.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-1.5" role="tablist" data-testid={`${testIdPrefix}-mode`}>
          <Button type="button" size="sm" variant={mode === "company" ? "default" : "outline"} className="h-7 rounded-full text-xs" onClick={() => { setMode("company"); setProblem(null); }} data-testid={`${testIdPrefix}-mode-company`}>
            <Landmark className="mr-1 h-3.5 w-3.5" />A company
          </Button>
          <Button type="button" size="sm" variant={mode === "person" ? "default" : "outline"} className="h-7 rounded-full text-xs" onClick={() => { setMode("person"); setProblem(null); }} data-testid={`${testIdPrefix}-mode-person`}>
            <UserRound className="mr-1 h-3.5 w-3.5" />A person
          </Button>
        </div>
        {mode === "person" ? (
          // No form element here: this dialog opens inside the deal form, and React carries
          // a submit through the portal to that form, which then saved the deal
          // (20 November 2026). Enter in a box still saves the person.
          <div className="space-y-2.5" data-testid={`${testIdPrefix}-person`}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (personReady) void savePerson(); } }}>
            <div className="space-y-1">
              <Label htmlFor={`${testIdPrefix}-person-name`} className="text-xs">Full name</Label>
              <Input id={`${testIdPrefix}-person-name`} autoFocus value={person.name} onChange={e => setPerson(p => ({ ...p, name: e.target.value }))} placeholder="First name and surname" data-testid={`${testIdPrefix}-person-name`} />
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`${testIdPrefix}-person-email`} className="text-xs">Email (for the client checks)</Label>
                <Input id={`${testIdPrefix}-person-email`} type="email" value={person.email} onChange={e => setPerson(p => ({ ...p, email: e.target.value }))} placeholder="name@example.com" data-testid={`${testIdPrefix}-person-email`} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${testIdPrefix}-person-mobile`} className="text-xs">Mobile (optional)</Label>
                <Input id={`${testIdPrefix}-person-mobile`} type="tel" value={person.mobile} onChange={e => setPerson(p => ({ ...p, mobile: e.target.value }))} data-testid={`${testIdPrefix}-person-mobile`} />
              </div>
            </div>
            <Button type="button" size="sm" disabled={!personReady || !!busy} onClick={() => void savePerson()} data-testid={`${testIdPrefix}-person-save`}>
              {busy === "person" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}Save {person.name.trim() || "the person"}
            </Button>
          </div>
        ) : (<>
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
        </>)}
        {problem && <p className="text-xs text-destructive" role="alert" data-testid={`${testIdPrefix}-problem`}>{problem}</p>}
      </DialogContent>
    </Dialog>
  );
}
