// Each deal party's company that signs and the person BGP asks for its
// checks (Woody, 2026-11-18: "most importantly adding the billing entities
// so can AML. Also when doing that if the AML hasnt started need the ability
// to add in all the info so it can start such as email phone numbers etc").
// BGP staff only: the server (server/deal-parties.ts) refuses anyone else,
// and the callers draw these only for staff. The rules are
// shared/deal-parties.ts. Every change saves straight away.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Building2, CheckCircle2, Loader2, Plus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { CreateBillingEntityDialog, type SavedCompany } from "@/components/billing-entity-create";
import { leaseCompaniesKey } from "@/components/lease-company-picker";
import { OFFER_WORDS, type DealPartyRole, type DealPartyView } from "@shared/deal-parties";

interface DealParties { deal: { id: string; name: string }; parties: DealPartyView[] }

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "");
export const dealPartiesKey = (dealId: string) => ["/api/deals", dealId, "parties"];

export function useDealParties(dealId: string | null | undefined, enabled = true) {
  return useQuery<DealParties>({
    enabled: !!dealId && enabled,
    queryKey: dealPartiesKey(String(dealId)),
    queryFn: async () => {
      const res = await fetch(`/api/deals/${dealId}/parties`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(plain(await res.text()));
      return res.json();
    },
    staleTime: 15_000,
  });
}

function refresh(dealId: string, data?: DealParties) {
  if (data) queryClient.setQueryData(dealPartiesKey(dealId), data);
  else queryClient.invalidateQueries({ queryKey: dealPartiesKey(dealId) });
  // The checks run on the company that signs, and the client checks ask the
  // person: both screens read them.
  queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
  queryClient.invalidateQueries({ queryKey: ["/api/aml/deal", dealId, "client-checks"] });
  queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId] });
}

const companyWords = (c: { name: string; companiesHouseNumber: string | null }) => `${c.name}${c.companiesHouseNumber ? ` · ${c.companiesHouseNumber}` : ""}`;

// The lines under a party on the deal page: who signs, who is billed, who is
// asked, and anything still missing before the checks can start.
export function DealPartyLines({ dealId, role }: { dealId: string; role: DealPartyRole }) {
  const { data } = useDealParties(dealId);
  const [open, setOpen] = useState(false);
  const party = data?.parties.find(p => p.role === role);
  if (!party) return null;
  return (
    <div className="space-y-0.5 text-[11px]" data-testid={`deal-party-lines-${role}`}>
      {party.brand.kind === "company" && (
        <div className="flex items-baseline gap-1 min-w-0">
          <span className="text-muted-foreground shrink-0">Signs as</span>
          {party.company
            ? <span className="font-medium truncate" data-testid={`deal-party-company-${role}`}>{companyWords(party.company)}</span>
            : party.brand.companiesHouseNumber
              ? <span className="truncate">{companyWords({ name: party.brand.name, companiesHouseNumber: party.brand.companiesHouseNumber })}</span>
              : <span className="text-muted-foreground italic">not set</span>}
        </div>
      )}
      {party.xero && (
        <div className="flex items-baseline gap-1 min-w-0">
          <span className="text-muted-foreground shrink-0">Billed to</span>
          <span className="truncate">{party.xero.name || "a Xero contact"}</span>
        </div>
      )}
      <div className="flex items-baseline gap-1 min-w-0">
        <span className="text-muted-foreground shrink-0">Ask</span>
        {party.person
          ? <span className="truncate" data-testid={`deal-party-person-${role}`}>{party.person.name}{party.person.email ? ` · ${party.person.email}` : ""}</span>
          : <span className="text-muted-foreground italic">nobody set</span>}
      </div>
      {party.gaps.length > 0 && (
        <p className="flex items-start gap-1 text-amber-700" data-testid={`deal-party-gaps-${role}`}>
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          <span>Needed for the checks: {party.gaps.map(g => g.short).join(", ")}</span>
        </p>
      )}
      <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 -ml-1.5 text-[11px]" onClick={() => setOpen(true)} data-testid={`deal-party-edit-${role}`}>
        {party.gaps.length ? "Fill in" : "Change"}
      </Button>
      {open && <DealPartyEditor dealId={dealId} role={role} onClose={() => setOpen(false)} />}
    </div>
  );
}

// "Ready to start" in the AML box: what is missing for one party (by its
// brand), filled in place.
export function PartyReadyToStart({ dealId, companyId }: { dealId: string; companyId: string }) {
  const { data } = useDealParties(dealId);
  const [open, setOpen] = useState(false);
  const party = data?.parties.find(p => p.brand.id === companyId);
  if (!party) return null;
  return (
    <>
      {party.gaps.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950 space-y-1" data-testid={`kyc-ready-${companyId}`}>
          <div className="font-semibold">Before the checks can start</div>
          <ul className="list-disc pl-4 space-y-0.5">
            {party.gaps.map(g => <li key={g.key}>{g.words}</li>)}
          </ul>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs bg-background" onClick={() => setOpen(true)} data-testid={`kyc-ready-fill-${companyId}`}>
            Fill in
          </Button>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground" data-testid={`kyc-ready-set-${companyId}`}>
          {party.brand.kind === "company" && party.company ? <>Signs as <span className="text-foreground font-medium">{companyWords(party.company)}</span> · </> : null}
          {party.person ? <>Ask {party.person.name}{party.person.email ? ` (${party.person.email})` : ""} · </> : null}
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setOpen(true)} data-testid={`kyc-ready-change-${companyId}`}>Change</button>
        </p>
      )}
      {open && <DealPartyEditor dealId={dealId} role={party.role} onClose={() => setOpen(false)} />}
    </>
  );
}

export function DealPartyEditor({ dealId, role, onClose }: { dealId: string; role: DealPartyRole; onClose: () => void }) {
  const { toast } = useToast();
  const { data, isLoading, error } = useDealParties(dealId);
  const party = data?.parties.find(p => p.role === role) || null;
  const [finding, setFinding] = useState(false);
  const [adding, setAdding] = useState(false);
  const [person, setPerson] = useState({ name: "", jobTitle: "", email: "", mobile: "" });

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiRequest("PUT", `/api/deals/${dealId}/parties/${role}`, body)).json() as Promise<DealParties>,
    onSuccess: (d) => refresh(dealId, d),
    onError: (e) => toast({ title: "Not saved", description: plain(e), variant: "destructive" }),
  });
  const add = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/parties/${role}/person`, {
      name: person.name, jobTitle: person.jobTitle || null, email: person.email || null, mobile: person.mobile || null,
    })).json(),
    onSuccess: (d: any) => {
      refresh(dealId, { deal: d.deal, parties: d.parties });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      toast({ title: d.created ? "Added to the CRM" : "Found in the CRM", description: `${person.name} is the person to ask.` });
      setAdding(false);
      setPerson({ name: "", jobTitle: "", email: "", mobile: "" });
    },
    onError: (e) => toast({ title: "Not added", description: plain(e), variant: "destructive" }),
  });
  // Bill to the company in Xero: the billing entity route finds its contact
  // or makes one, as the deal form does.
  const bill = useMutation({
    mutationFn: async () => {
      if (!party?.company?.companiesHouseNumber) throw new Error("The company has no Companies House number.");
      const r = await apiRequest("POST", "/api/billing-entities", { brandId: party.brand.id, companyNumber: party.company.companiesHouseNumber });
      const b = await r.json();
      if (!b?.contact?.ContactID) throw new Error(b?.xeroError || "Xero did not make the contact.");
      return (await apiRequest("PUT", `/api/deals/${dealId}/parties/${role}`, { xero: { contactId: b.contact.ContactID, name: b.contact.Name } })).json() as Promise<DealParties>;
    },
    onSuccess: (d) => refresh(dealId, d),
    onError: (e) => toast({ title: "Not billed in Xero", description: plain(e), variant: "destructive" }),
  });

  const pickCompany = (company: SavedCompany, contact?: { ContactID: string; Name: string } | null) => {
    save.mutate({ companyId: company.id, ...(contact && !party?.xero ? { xero: { contactId: contact.ContactID, name: contact.Name } } : {}) });
    if (party) queryClient.invalidateQueries({ queryKey: leaseCompaniesKey(party.brand.id) });
  };

  const busy = save.isPending || add.isPending || bill.isPending;
  const billedElsewhere = !!party?.company && (!party.xero || (party.xero.name || "").trim().toLowerCase() !== party.company.name.trim().toLowerCase());

  return (
    <Dialog open onOpenChange={o => { if (!o && !finding) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid={`deal-party-editor-${role}`}>
        <DialogHeader>
          <DialogTitle>{party ? `${party.label}: ${party.brand.name}` : "Party"}</DialogTitle>
          <DialogDescription>Who signs, and who BGP asks for the checks. Each change saves straight away.</DialogDescription>
        </DialogHeader>
        {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>}
        {error && <p className="text-sm text-red-700">{plain(error)}</p>}
        {!isLoading && !error && !party && <p className="text-sm text-muted-foreground">Set the {role} on the deal first.</p>}
        {party && (
          <div className="space-y-5 text-sm">
            <section className="space-y-2" data-testid="deal-party-company-section">
              <h4 className="flex items-center gap-1.5 font-semibold"><Building2 className="w-4 h-4 text-muted-foreground" />The company that signs</h4>
              {party.brand.kind === "individual" ? (
                <p className="text-xs text-muted-foreground">{party.brand.name} is recorded as a private individual, so there is no company to pick. Their date of birth and home address are asked for in the client checks.</p>
              ) : (
                <>
                  {party.offer && (
                    <div className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-2 text-xs dark:bg-sky-950/20" data-testid="deal-party-offer">
                      <span className="min-w-0 flex-1"><strong>{companyWords(party.offer)}</strong><span className="block text-muted-foreground">Suggested: {OFFER_WORDS[party.offer.why]}</span></span>
                      <Button type="button" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => pickCompany(party.offer!)} data-testid="deal-party-use-offer">Use it</Button>
                    </div>
                  )}
                  {party.companies.length > 0 ? (
                    <ul className="divide-y rounded-md border">
                      {party.companies.map(c => {
                        const chosen = party.company?.id === c.id;
                        return (
                          <li key={c.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs" data-testid={`deal-party-company-option-${c.id}`}>
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">{c.name}</span>
                              <span className="ml-1.5 text-muted-foreground">{c.companiesHouseNumber || "no Companies House number"}</span>
                              {c.isDefault && <Badge variant="outline" className="ml-1.5 text-[10px]">Main</Badge>}
                            </span>
                            {chosen
                              ? <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" />Signs</span>
                              : <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[11px]" disabled={busy} onClick={() => pickCompany(c)}>Use</Button>}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">No company is filed under {party.brand.name} yet.{party.brand.companiesHouseNumber ? ` Until one is set, the checks read ${party.brand.name}'s own Companies House record (${party.brand.companiesHouseNumber}).` : ""}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => setFinding(true)} data-testid="deal-party-find-company">
                      <Plus className="w-3.5 h-3.5 mr-1" />Find it at Companies House
                    </Button>
                    {party.company && (
                      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" disabled={busy} onClick={() => save.mutate({ companyId: null })}>Clear</Button>
                    )}
                  </div>
                  <div className="rounded-md bg-muted/50 px-2.5 py-2 text-xs space-y-1" data-testid="deal-party-billing">
                    <div><span className="text-muted-foreground">Billed to (Xero): </span>{party.xero ? (party.xero.name || "a Xero contact") : "not set"}</div>
                    {billedElsewhere && party.company?.companiesHouseNumber && (
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs bg-background" disabled={busy} onClick={() => bill.mutate()} data-testid="deal-party-bill">
                        {bill.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Bill to {party.company.name} in Xero
                      </Button>
                    )}
                  </div>
                </>
              )}
            </section>

            <section className="space-y-2" data-testid="deal-party-person-section">
              <h4 className="flex items-center gap-1.5 font-semibold"><UserRound className="w-4 h-4 text-muted-foreground" />Who to ask</h4>
              <p className="text-xs text-muted-foreground">The client checks go to them, and they are named on a KYC4U request.</p>
              {party.person && (
                <div className="rounded-md border px-2.5 py-2 text-xs" data-testid="deal-party-person-current">
                  <div className="font-medium">{party.person.name}{party.person.jobTitle ? <span className="font-normal text-muted-foreground"> · {party.person.jobTitle}</span> : null}</div>
                  <div className="text-muted-foreground">{[party.person.email || "no email", party.person.mobile].filter(Boolean).join(" · ")}</div>
                  {party.person.from === "client" && <div className="text-muted-foreground italic">The deal's client contact</div>}
                </div>
              )}
              {party.people.length > 0 && (
                <Select value={party.person?.from === "party" ? party.person.id : undefined} onValueChange={v => save.mutate({ personId: v })} disabled={busy}>
                  <SelectTrigger className="h-8 text-xs" data-testid="deal-party-person-select"><SelectValue placeholder={`Pick someone at ${party.brand.name}`} /></SelectTrigger>
                  <SelectContent>
                    {party.people.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.email ? ` · ${p.email}` : " · no email"}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {adding ? (
                <div className="space-y-2 rounded-md border p-2.5" data-testid="deal-party-add-person">
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div className="space-y-1"><Label className="text-[11px]">Name</Label><Input value={person.name} onChange={e => setPerson(p => ({ ...p, name: e.target.value }))} data-testid="input-party-person-name" /></div>
                    <div className="space-y-1"><Label className="text-[11px]">Job title</Label><Input value={person.jobTitle} onChange={e => setPerson(p => ({ ...p, jobTitle: e.target.value }))} /></div>
                    <div className="space-y-1"><Label className="text-[11px]">Email</Label><Input type="email" value={person.email} onChange={e => setPerson(p => ({ ...p, email: e.target.value }))} data-testid="input-party-person-email" /></div>
                    <div className="space-y-1"><Label className="text-[11px]">Mobile</Label><Input value={person.mobile} onChange={e => setPerson(p => ({ ...p, mobile: e.target.value }))} /></div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Saved to the CRM under {party.brand.name}. Someone already there with that email is used, with any blank details filled in.</p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" className="h-7 text-xs" disabled={busy || !person.name.trim() || (!person.email.trim() && !person.mobile.trim())} onClick={() => add.mutate()} data-testid="button-party-person-save">
                      {add.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Save
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdding(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAdding(true)} data-testid="deal-party-add-person-open">
                  <Plus className="w-3.5 h-3.5 mr-1" />Add someone
                </Button>
              )}
            </section>

            {party.gaps.length > 0 ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-950" data-testid="deal-party-editor-gaps">
                <div className="font-semibold">Still needed before the checks can start</div>
                <ul className="list-disc pl-4">{party.gaps.map(g => <li key={g.key}>{g.words}</li>)}</ul>
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-emerald-700" data-testid="deal-party-editor-ready"><CheckCircle2 className="w-3.5 h-3.5" />Everything the checks need is here.</p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose} data-testid="deal-party-editor-done">Done</Button>
        </DialogFooter>
        {party && finding && (
          <CreateBillingEntityDialog
            open
            onOpenChange={v => { if (!v) setFinding(false); }}
            brand={{ id: party.brand.id, name: party.brand.name }}
            initialQuery={party.brand.name}
            onCreated={(contact, company) => { if (company) pickCompany(company, contact); setFinding(false); }}
            onSavedWithoutXero={company => { pickCompany(company); setFinding(false); }}
            testIdPrefix={`deal-party-${role}-find`}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
