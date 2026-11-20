// Each deal party's company that signs and the person BGP asks for its
// checks (Woody, 2026-11-18: "most importantly adding the billing entities
// so can AML. Also when doing that if the AML hasnt started need the ability
// to add in all the info so it can start such as email phone numbers etc").
// BGP staff only: the server (server/deal-parties.ts) refuses anyone else,
// and the callers draw these only for staff. The rules are
// shared/deal-parties.ts. Every change saves straight away.
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, CheckCircle2, Loader2, Plus, ShieldCheck, UserRound } from "lucide-react";
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
import { useClientChecks } from "@/components/kyc-client-checks";
import { OFFER_WORDS, SIGNING_COMPANY_WORDS, partyAmlFacts, partyAmlQuietWords, peopleToReach, type DealPartyRole, type DealPartyView, type PartyAmlFacts } from "@shared/deal-parties";
import { personDisplayName, personNamesMatch } from "@shared/kyc-prechecks";
import { PARTY_PEOPLE_BASIS_WORDS, type KycPartyPerson, type PartyPeople } from "@shared/kyc-people";

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
const capital = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

// Sets the company that signs: one filed under the brand, or the brand's own
// registered company, filed under it first (from Companies House, with no
// Xero contact: BGP bills one side, and "Bill to … in Xero" makes it).
function useSetSigningCompany(dealId: string, role: DealPartyRole) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (pick: { companyId: string } | { brandId: string; number: string }) => {
      let companyId = "companyId" in pick ? pick.companyId : "";
      if (!("companyId" in pick)) {
        const r = await apiRequest("POST", "/api/billing-entities", { brandId: pick.brandId, companyNumber: pick.number, xero: false });
        const made = await r.json();
        companyId = String(made?.entity?.id || "");
        if (!companyId) throw new Error("The company was not saved.");
      }
      return (await apiRequest("PUT", `/api/deals/${dealId}/parties/${role}`, { companyId })).json() as Promise<DealParties>;
    },
    onSuccess: (d) => refresh(dealId, d),
    onError: (e) => toast({ title: "Not set", description: plain(e), variant: "destructive" }),
  });
}

// When the deal names no company that signs: the one to offer first (the
// company on the unit's lease, the brand's main one, its only one) or the
// brand's own registered company, each a press away, and the full list.
export function PartyCompanyChoice({ dealId, party, onChoose }: { dealId: string; party: DealPartyView; onChoose: () => void }) {
  const set = useSetSigningCompany(dealId, party.role);
  if (party.brand.kind !== "company" || party.company) return null;
  return (
    <div className="space-y-1.5" data-testid={`deal-party-choice-${party.role}`}>
      {party.offer && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0"><span className="font-medium">{companyWords(party.offer)}</span> <span className="text-muted-foreground">({OFFER_WORDS[party.offer.why]})</span></span>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={set.isPending} onClick={() => set.mutate({ companyId: party.offer!.id })} data-testid={`deal-party-use-offer-${party.role}`}>
            {set.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Use it
          </Button>
        </div>
      )}
      {party.brandOwn && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0"><span className="font-medium">{party.brandOwn.name} · {party.brandOwn.number}</span> <span className="text-muted-foreground">({party.brand.name}'s own registered company)</span></span>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={set.isPending} onClick={() => set.mutate({ brandId: party.brand.id, number: party.brandOwn!.number })} data-testid={`deal-party-use-brand-own-${party.role}`}>
            {set.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Use it
          </Button>
        </div>
      )}
      <Button type="button" size="sm" variant={party.offer || party.brandOwn ? "ghost" : "outline"} className="h-7 text-xs" onClick={onChoose} data-testid={`deal-party-choose-${party.role}`}>
        {party.offer || party.brandOwn ? "Choose another" : "Choose the company"}
      </Button>
    </div>
  );
}

// What the deal's AML status says about a party (approved, Not required, a
// letting that asks no one for anything): shared/deal-parties.ts. The callers
// hold the status and pass it down.
export { partyAmlFacts, type PartyAmlFacts };
const quietWords = partyAmlQuietWords;

const joinNames = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// The people a party's AML checks need, as the deal card's People to check
// reads them (shared/kyc-people.ts): null while they cannot be known (a
// private individual, no company that signs, the client checks off).
function usePartyPeople(dealId: string, party: DealPartyView | null | undefined) {
  const wanted = !!party && party.brand.kind === "company" && !!party.company;
  const checks = useClientChecks(dealId, wanted);
  const people: PartyPeople | null = wanted ? checks.data?.people?.[party!.brand.id] ?? null : null;
  return { people, loading: wanted && checks.isLoading, refetch: checks.refetch };
}

const roleWords = (p: KycPartyPerson) =>
  [p.roles.includes("owner") ? "Owner" : null, p.roles.includes("acting") ? "dealing with us" : null].filter(Boolean).join(", ") || "Director";

// Names the people still to reach, with the box a press away (the Kick off
// AML step, the AML box, the Parties card): Woody, 20 November 2026, "these
// owners need to AML and prompt for contact details at that stage". Drawn
// only once the deal's AML status is read, and never for a party approved,
// marked Not required, or on a letting that asks no one for anything.
function PeopleToReachLine({ party, people, aml, onOpen }: { party: DealPartyView; people: PartyPeople | null; aml: PartyAmlFacts | null | undefined; onOpen: () => void }) {
  if (!aml || quietWords(aml) || !people || people.basis === "individual") return null;
  if (people.basis === "not_read") {
    return (
      <p className="text-[11px] text-muted-foreground" data-testid={`deal-party-people-unread-${party.role}`}>
        The owners of {party.company?.name} are not read from Companies House yet. <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onOpen}>Read them</button>
      </p>
    );
  }
  const missing = peopleToReach(people.people, party.people, personNamesMatch);
  if (!missing.length) return null;
  return (
    <p className="text-[11px] text-amber-700 dark:text-amber-400" data-testid={`deal-party-people-to-reach-${party.role}`}>
      {joinNames(missing.map(p => personDisplayName(p.name)))} {missing.length === 1 ? "needs" : "need"} AML checks: no email or mobile held for them yet. <button type="button" className="underline underline-offset-2" onClick={onOpen} data-testid={`deal-party-people-add-${party.role}`}>Add their details</button>
    </p>
  );
}

// One person the checks need, in the party box: their contact details as the
// CRM holds them under the party, or a place to give them (saved to the CRM,
// blank fields only, by POST /api/deals/:id/parties/:role/owner).
function PersonToReach({ dealId, party, person, busy, quiet, onAsk }: { dealId: string; party: DealPartyView; person: KycPartyPerson; busy: boolean; quiet: boolean; onAsk: (contactId: string) => void }) {
  const { toast } = useToast();
  const contact = party.people.find(c => personNamesMatch(person.name, c.name) && (c.email || c.mobile)) || null;
  const [email, setEmail] = useState(contact?.email || "");
  const [mobile, setMobile] = useState(contact?.mobile || "");
  const asked = !!party.person && personNamesMatch(person.name, party.person.name);
  const name = personDisplayName(person.name);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/parties/${party.role}/owner`, {
      key: person.key, email: email.trim() || null, mobile: mobile.trim() || null,
    })).json(),
    onSuccess: (r: any) => {
      refresh(dealId, { deal: r.deal, parties: r.parties });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      toast(r.kept
        ? { title: `Kept the email already held for ${name}`, description: `The CRM has ${r.kept}; any blank details were filled in.` }
        : { title: r.created ? "Added to the CRM" : "Saved to the CRM", description: `${name}'s details are under ${party.brand.name}.` });
    },
    onError: (e) => toast({ title: "Not saved", description: plain(e), variant: "destructive" }),
  });
  const needs = !quiet && person.outstanding.length > 0 && !person.own;
  return (
    <li className="rounded-md border px-2.5 py-2 text-xs space-y-1" data-testid={`deal-party-check-person-${person.key}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium">{name}</span>
        <span className="text-muted-foreground">{roleWords(person)}</span>
        {asked && <Badge variant="outline" className="text-[10px]">Who to ask</Badge>}
      </div>
      {person.ownerDetail && <div className="text-muted-foreground">{person.ownerDetail}</div>}
      {!quiet && (
        <div className="text-muted-foreground">
          {person.outstanding.length ? `Still to do: ${person.outstanding.join(" and ")}` : "Checks done"}
          {person.own ? ` · has their own link (${person.own.ref})` : ""}
        </div>
      )}
      {contact?.email ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-foreground">{[contact.email, contact.mobile].filter(Boolean).join(" · ")}</span>
          {!asked && <button type="button" className="underline underline-offset-2 text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => onAsk(contact.id)} data-testid={`deal-party-ask-${person.key}`}>Make them who to ask</button>}
        </div>
      ) : needs || (contact && !quiet) ? (
        <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-center">
          <Input type="email" className="h-8 text-xs" placeholder="Their email" value={email} onChange={e => setEmail(e.target.value)} data-testid={`input-check-person-email-${person.key}`} />
          <Input className="h-8 text-xs" placeholder="Mobile" value={mobile} onChange={e => setMobile(e.target.value)} data-testid={`input-check-person-mobile-${person.key}`} />
          <Button type="button" size="sm" className="h-8 text-xs" disabled={busy || save.isPending || (!email.trim() && !mobile.trim())} onClick={() => save.mutate()} data-testid={`button-check-person-save-${person.key}`}>
            {save.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Save
          </Button>
        </div>
      ) : null}
    </li>
  );
}

// The people the party's checks need, at the top of Who to ask.
function PartyPeopleToCheck({ dealId, party, busy, aml, onAsk }: { dealId: string; party: DealPartyView; busy: boolean; aml: PartyAmlFacts | null | undefined; onAsk: (contactId: string) => void }) {
  const { toast } = useToast();
  const { people, loading, refetch } = usePartyPeople(dealId, party);
  const [reading, setReading] = useState(false);
  const read = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/kyc/deal/${dealId}/prechecks`, { companyId: party.brand.id })).json(),
    onSuccess: () => setReading(true),
    onError: (e) => toast({ title: "Not started", description: plain(e), variant: "destructive" }),
  });
  // While Companies House is read, ask again every few seconds (for up to two minutes).
  useEffect(() => {
    if (!reading) return;
    if (people && people.basis !== "not_read") { setReading(false); return; }
    const tick = setInterval(() => { void refetch(); }, 4000);
    const stop = setTimeout(() => setReading(false), 120_000);
    return () => { clearInterval(tick); clearTimeout(stop); };
  }, [reading, people?.basis]);
  if (party.brand.kind === "individual") return null;
  if (!party.company) {
    return <p className="text-xs text-muted-foreground" data-testid="deal-party-people-need-company">Set the company that signs first: the people its checks need are read from Companies House.</p>;
  }
  if (loading) return <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />Finding who the checks need…</p>;
  if (!people) return null;
  if (people.basis === "not_read") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="deal-party-people-unread">
        <span>The owners of {party.company.name} are read from Companies House by BGP's checks before asking.</span>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={read.isPending || reading} onClick={() => read.mutate()} data-testid="deal-party-people-read">
          {read.isPending || reading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}{reading ? "Reading Companies House…" : "Read them now"}
        </Button>
      </div>
    );
  }
  const quiet = quietWords(aml);
  return (
    <div className="space-y-1.5" data-testid="deal-party-people-to-check">
      <p className="text-xs text-muted-foreground" data-testid={quiet ? "deal-party-people-quiet" : undefined}>
        {quiet
          ?? (people.basis === "owners"
            ? `Companies House names these people for ${party.company.name}. Each does an identity check and sends a proof of address through a link of their own: give each one's email (or a mobile) here.`
            : PARTY_PEOPLE_BASIS_WORDS[people.basis])}
      </p>
      {people.people.length > 0 && <ul className="space-y-1.5">{people.people.map(p => <PersonToReach key={p.key} dealId={dealId} party={party} person={p} busy={busy} quiet={!!quiet} onAsk={onAsk} />)}</ul>}
      {people.directors.length > 0 && (
        <p className="text-[11px] text-muted-foreground">Directors, no ID needed (sanctions checks only): {people.directors.map(d => personDisplayName(d.name)).join(", ")}.</p>
      )}
    </div>
  );
}

// One labelled line of a party.
function PartyRow({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-x-3 gap-y-0.5" data-testid={testId}>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

// A party on the deal page's Parties card (Woody, 19 November 2026: "the
// landlord and tenant have numbers but its not clear if there is a billing
// company? The brand is different normally to the billing or contracting
// entity which is critical for the AML"). The brand is the card's heading;
// under it, each on its own labelled line: the company that signs (never
// the brand's number standing in for it), who is billed in Xero, and who
// BGP asks for the checks.
export function DealPartyLines({ dealId, role, aml }: { dealId: string; role: DealPartyRole; aml?: PartyAmlFacts | null }) {
  const { data } = useDealParties(dealId);
  const [open, setOpen] = useState(false);
  const party = data?.parties.find(p => p.role === role);
  const { people } = usePartyPeople(dealId, party);
  if (!party) return null;
  return (
    <div className="space-y-2" data-testid={`deal-party-lines-${role}`}>
      <dl className="space-y-1.5">
        {party.brand.kind === "company" ? (
          <PartyRow label="Company that signs" testId={`deal-party-row-company-${role}`}>
            {party.company ? (
              <span data-testid={`deal-party-company-${role}`}>
                <span className="font-medium">{party.company.name}</span>
                {party.company.companiesHouseNumber && <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">{party.company.companiesHouseNumber}</span>}
              </span>
            ) : (
              <span className="text-amber-700 dark:text-amber-400" data-testid={`deal-party-company-missing-${role}`}>Not set: {SIGNING_COMPANY_WORDS[role]}, needed for the AML checks</span>
            )}
          </PartyRow>
        ) : (
          <PartyRow label="Signs as">A private individual</PartyRow>
        )}
        <PartyRow label="Billed to (Xero)" testId={`deal-party-row-billing-${role}`}>
          {party.xero ? <span>{party.xero.name || "a Xero contact"}</span> : <span className="text-muted-foreground">Not set</span>}
        </PartyRow>
        <PartyRow label="Who to ask" testId={`deal-party-row-person-${role}`}>
          {party.person
            ? <span data-testid={`deal-party-person-${role}`}>{party.person.name}{party.person.email ? <span className="text-muted-foreground"> · {party.person.email}</span> : <span className="text-amber-700 dark:text-amber-400"> · no email</span>}</span>
            : <span className="text-amber-700 dark:text-amber-400">Nobody set, needed for the client checks</span>}
        </PartyRow>
      </dl>
      <PeopleToReachLine party={party} people={people} aml={aml} onOpen={() => setOpen(true)} />
      {!party.company && party.brand.kind === "company" && <PartyCompanyChoice dealId={dealId} party={party} onChoose={() => setOpen(true)} />}
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid={`deal-party-edit-${role}`}>
        {party.gaps.length ? "Fill in" : "Change"}
      </Button>
      {open && <DealPartyEditor dealId={dealId} role={role} aml={aml} onClose={() => setOpen(false)} />}
    </div>
  );
}

// "Before the checks can start" in the AML box and the Kick off AML step:
// what is missing for one party (by its brand), filled in place, with the
// company that signs a press away where the app can offer one.
export function PartyReadyToStart({ dealId, companyId, aml }: { dealId: string; companyId: string; aml?: PartyAmlFacts | null }) {
  const { data } = useDealParties(dealId);
  const [open, setOpen] = useState(false);
  const party = data?.parties.find(p => p.brand.id === companyId);
  const { people } = usePartyPeople(dealId, party);
  if (!party) return null;
  return (
    <>
      <PeopleToReachLine party={party} people={people} aml={aml} onOpen={() => setOpen(true)} />
      {party.gaps.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950 space-y-1.5 dark:bg-amber-950/20 dark:text-amber-100" data-testid={`kyc-ready-${companyId}`}>
          <div className="font-semibold">Before the checks can start</div>
          <ul className="list-disc pl-4 space-y-0.5">
            {party.gaps.map(g => <li key={g.key}>{g.words}</li>)}
          </ul>
          {party.gaps.some(g => g.key === "company") && (
            <div className="rounded border border-amber-200 bg-background p-2 text-foreground">
              <PartyCompanyChoice dealId={dealId} party={party} onChoose={() => setOpen(true)} />
            </div>
          )}
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
      {open && <DealPartyEditor dealId={dealId} role={party.role} aml={aml} onClose={() => setOpen(false)} />}
    </>
  );
}

export function DealPartyEditor({ dealId, role, aml, onClose }: { dealId: string; role: DealPartyRole; aml?: PartyAmlFacts | null; onClose: () => void }) {
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

  const setOwn = useSetSigningCompany(dealId, role);
  const busy = save.isPending || add.isPending || bill.isPending || setOwn.isPending;
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
                  <p className="text-xs text-muted-foreground">{capital(SIGNING_COMPANY_WORDS[role])}. The checks are about it, not {party.brand.name}: the brand is usually a different company.</p>
                  {party.offer && (
                    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs" data-testid="deal-party-offer">
                      <span className="min-w-0 flex-1"><strong>{companyWords(party.offer)}</strong><span className="block text-muted-foreground">Suggested: {OFFER_WORDS[party.offer.why]}</span></span>
                      <Button type="button" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => pickCompany(party.offer!)} data-testid="deal-party-use-offer">Use it</Button>
                    </div>
                  )}
                  {party.brandOwn && (
                    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs" data-testid="deal-party-brand-own">
                      <span className="min-w-0 flex-1"><strong>{party.brandOwn.name} · {party.brandOwn.number}</strong><span className="block text-muted-foreground">{party.brand.name}'s own registered company: use it only if it is the one that signs</span></span>
                      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy || setOwn.isPending} onClick={() => setOwn.mutate({ brandId: party.brand.id, number: party.brandOwn!.number })} data-testid="deal-party-use-brand-own">
                        {setOwn.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Use it
                      </Button>
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
                    <p className="text-xs text-muted-foreground">No company is filed under {party.brand.name} yet. Find it at Companies House{party.brandOwn ? ", or use the brand's own company above if it is the one that signs" : ""}.</p>
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

            {party.brand.kind === "company" && (
              <section className="space-y-2" data-testid="deal-party-people-section">
                <h4 className="flex items-center gap-1.5 font-semibold"><ShieldCheck className="w-4 h-4 text-muted-foreground" />Who the AML checks need</h4>
                <PartyPeopleToCheck dealId={dealId} party={party} busy={busy} aml={aml} onAsk={(id) => save.mutate({ personId: id })} />
              </section>
            )}

            <section className="space-y-2" data-testid="deal-party-person-section">
              <h4 className="flex items-center gap-1.5 font-semibold"><UserRound className="w-4 h-4 text-muted-foreground" />Who to ask</h4>
              <p className="text-xs text-muted-foreground">
                {party.brand.kind === "company"
                  ? "The person dealing with us for the company, often one of the people above: the client checks go to them first, and they are named on a KYC4U request."
                  : "The client checks go to them, and they are named on a KYC4U request."}
              </p>
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
