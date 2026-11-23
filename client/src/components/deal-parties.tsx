// Each deal party's company that signs and the person BGP asks for its
// checks (Woody, 2026-11-18: "most importantly adding the billing entities
// so can AML. Also when doing that if the AML hasnt started need the ability
// to add in all the info so it can start such as email phone numbers etc").
// BGP staff only: the server (server/deal-parties.ts) refuses anyone else,
// and the callers draw these only for staff. The rules are
// shared/deal-parties.ts. Every change saves straight away.
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, CheckCircle2, Loader2, Plus, Receipt, ShieldCheck, UserRound, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { CreateBillingEntityDialog, type SavedCompany } from "@/components/billing-entity-create";
import { leaseCompaniesKey } from "@/components/lease-company-picker";
import { AddPersonButton, useClientChecks } from "@/components/kyc-client-checks";
import { DealHotsButton } from "@/components/deal-hots";
import { OFFER_WORDS, OWN_NAME_WORDS, SIGNING_COMPANY_WORDS, partyAmlFacts, partyAmlQuietWords, peopleToReach, type DealPartyBilling, type DealPartyPayer, type DealPartyRole, type DealPartyView, type PartyAmlFacts } from "@shared/deal-parties";
import { PAYER_NOTE_MIN, PAYER_RELATIONSHIPS } from "@shared/deal-billing";
import { GUARANTOR_CHECKS_WORDS, isGuaranteedRole, type DealGuarantorView } from "@shared/deal-guarantor";
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

// Work out the company that signs (Woody, 23 November 2026: "it should just
// work out what the contracting entity is"): a party with none, whose unit's
// lease names a company filed under it, gets that company set by itself, once
// per transaction and party (the PUT writes its own history line).
const workedOut = new Set<string>();
export function useWorkOutSigningCompanies(dealId: string, data: DealParties | undefined) {
  useEffect(() => {
    if (!data) return;
    for (const p of data.parties) {
      if (p.company || p.offer?.why !== "lease" || p.brand.recordTrust || p.brand.recordIndividual) continue;
      const key = `${dealId}:${p.role}:${p.offer.id}`;
      if (workedOut.has(key)) continue;
      workedOut.add(key);
      apiRequest("PUT", `/api/deals/${dealId}/parties/${p.role}`, { companyId: p.offer.id })
        .then(r => r.json()).then((d: DealParties) => refresh(dealId, d)).catch(() => undefined);
    }
  }, [dealId, data]);
}

const companyWords = (c: { name: string; companiesHouseNumber: string | null; kind?: string }) =>
  `${c.name}${c.kind === "individual" ? " · a person" : c.companiesHouseNumber ? ` · ${c.companiesHouseNumber}` : ""}`;

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

// Records the party itself as a private individual, or undoes it (Woody,
// 20 November 2026: Sandy Macaskill (private) was asked for "the company
// buying"). The record is shared, so every deal with it follows.
function useMarkIndividual(dealId: string, role: DealPartyRole) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (individual: boolean) =>
      (await apiRequest("PUT", `/api/deals/${dealId}/parties/${role}/individual`, { individual })).json() as Promise<DealParties>,
    onSuccess: (d) => { refresh(dealId, d); queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] }); },
    onError: (e) => toast({ title: "Not recorded", description: plain(e), variant: "destructive" }),
  });
}

function useMarkTrust(dealId: string, role: DealPartyRole) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (trust: boolean) =>
      (await apiRequest("PUT", `/api/deals/${dealId}/parties/${role}/trust`, { trust })).json() as Promise<DealParties>,
    onSuccess: (d) => {
      refresh(dealId, d);
      queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
      queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0] || "").startsWith(`/api/kyc/deal/${dealId}`) });
    },
    onError: (e) => toast({ title: "Not recorded", description: plain(e), variant: "destructive" }),
  });
}

function useMarkPublicBody(dealId: string, role: DealPartyRole) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (publicBody: boolean) =>
      (await apiRequest("PUT", `/api/deals/${dealId}/parties/${role}/public-body`, { publicBody })).json() as Promise<DealParties>,
    onSuccess: (d) => {
      refresh(dealId, d);
      queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
      queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0] || "").startsWith(`/api/kyc/deal/${dealId}`) });
    },
    onError: (e) => toast({ title: "Not recorded", description: plain(e), variant: "destructive" }),
  });
}

// A UK public body (Layla, 23 November 2026, on #3965, The Crown Estate: "this
// is too intense for the crown estate"). Recorded, it is simplified due
// diligence: no company that signs and no owners to verify. A name that reads
// like one is a suggestion a person presses, never applied by itself, because
// a joint venture or company the body has an interest in is not the body.
export function PublicBodyLine({ dealId, party, compact }: { dealId: string; party: DealPartyView; compact?: boolean }) {
  const mark = useMarkPublicBody(dealId, party.role);
  if (party.brand.kind !== "company" || party.brand.recordTrust || party.company) return null;
  if (party.brand.recordPublicBody) {
    if (compact) return null;
    return (
      <div className="space-y-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100" data-testid={`deal-party-public-body-${party.role}`}>
        <p><strong>Recorded as a UK public body{party.brand.publicBodyKnown ? `: ${party.brand.publicBodyKnown}` : ""}.</strong> Simplified due diligence (SDD): there is no company to find and no owners to verify. It is screened against the sanctions lists by name.</p>
        <p>Still needed: who instructs us and proof they can act for it, and the SDD note (drafted for you on Parties &amp; AML).</p>
        <button type="button" className="underline underline-offset-2 disabled:opacity-50" disabled={mark.isPending} onClick={() => mark.mutate(false)} data-testid={`deal-party-unmark-public-body-${party.role}`}>Not the public body itself? Undo</button>
      </div>
    );
  }
  if (party.brand.companiesHouseNumber) return null;
  if (!party.brand.publicBodyHint) {
    if (compact) return null;
    return (
      <p className="text-xs text-muted-foreground" data-testid={`deal-party-public-body-option-${party.role}`}>
        Is {party.brand.name} a UK public body (a council, a government department, a statutory corporation)?{" "}
        <button type="button" className="underline underline-offset-2 hover:text-foreground disabled:opacity-50" disabled={mark.isPending} onClick={() => mark.mutate(true)} data-testid={`deal-party-mark-public-body-${party.role}`}>Record as a public body</button>
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100" data-testid={`deal-party-public-body-hint-${party.role}`}>
      <span className="min-w-0 flex-1">
        <strong>{party.brand.publicBodyKnown ? `${party.brand.name} is ${party.brand.publicBodyKnown}, a UK public body.` : "Reads like a UK public body."}</strong> It only needs simplified due diligence (SDD): no company to find, no owners to verify. Confirm it is the body itself, not a joint venture or company it has an interest in.
      </span>
      <Button type="button" size="sm" className="h-7 text-xs" disabled={mark.isPending} onClick={() => mark.mutate(true)} data-testid={`deal-party-mark-public-body-${party.role}`}>
        {mark.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Yes, record as a public body
      </Button>
    </div>
  );
}

// A trust (Jack, 20 November 2026: URC Thames North Trust, the vendor on
// Fortis Green, read as an ordinary company). Recorded, it is enhanced and BGP's
// officers check it from its structure, never KYC4U (Jack, 23 November 2026:
// "Remove KYC4u on trusts"). A name that reads like a trust is a suggestion a
// person presses, never applied by itself.
export function TrustLine({ dealId, party, compact }: { dealId: string; party: DealPartyView; compact?: boolean }) {
  const mark = useMarkTrust(dealId, party.role);
  // Enhanced due diligence is the officers' (KYC4U is no longer used, 23 November 2026).
  const who = "BGP records its structure and the officers check it";
  if (party.brand.kind !== "company" && !party.brand.recordTrust) return null;
  if (party.brand.recordTrust) {
    if (compact) return null;
    return (
      <div className="rounded-md border border-red-300 bg-red-50 px-2.5 py-2 text-xs text-red-900 dark:bg-red-950/30 dark:text-red-200 space-y-1" data-testid={`deal-party-trust-${party.role}`}>
        {party.brand.foundationHint
          ? <p><strong>Recorded as a foundation</strong>: enhanced checks, {who}.</p>
          : <p><strong>Recorded as a trust</strong>: enhanced checks, {who}. If a company is the trustee, set it as the company that signs.</p>}
        <button type="button" className="underline underline-offset-2 disabled:opacity-50" disabled={mark.isPending} onClick={() => mark.mutate(false)} data-testid={`deal-party-unmark-trust-${party.role}`}>{party.brand.foundationHint ? "Not a foundation?" : "Not a trust?"} Undo</button>
      </div>
    );
  }
  // Asked only when the name reads like a trust, foundation or charity (Woody,
  // 23 November 2026, on Inception T2: "we dont need this commnetry").
  if (!party.brand.trustHint) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" data-testid={`deal-party-trust-hint-${party.role}`}>
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
      <span className="min-w-0 flex-1">{party.brand.foundationHint
        ? <>Reads like a foundation. If it is one, record it: {who}.</>
        : party.brand.charityHint && !/\btrust(ees)?\b|\bsettlement\b/i.test(party.brand.name)
          ? <>Reads like a charity. If it's a charitable trust or a CIO, record it. A charitable company is set as the company that signs.</>
          : <>Reads like a trust. If it is one, or holds the property as trustee, record it: {who}.</>}</span>
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs bg-background" disabled={mark.isPending} onClick={() => mark.mutate(true)} data-testid={`deal-party-mark-trust-${party.role}`}>
        {mark.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}{party.brand.foundationHint ? "Record as a foundation" : party.brand.charityHint && !/\btrust(ees)?\b|\bsettlement\b/i.test(party.brand.name) ? "Record as a charity or foundation" : "Record as a trust"}
      </Button>
    </div>
  );
}

// The suggestion when the CRM name says private: one press records the party
// as a private individual, so there is no company to find.
function PrivateIndividualSuggestion({ dealId, party }: { dealId: string; party: DealPartyView }) {
  const mark = useMarkIndividual(dealId, party.role);
  if (!party.brand.privateMark || party.brand.companiesHouseNumber || party.company || party.brand.kind !== "company") return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid={`deal-party-private-${party.role}`}>
      <span className="min-w-0 flex-1"><span className="font-medium">{party.brand.name}</span> is marked private in the CRM: if they {OWN_NAME_WORDS[party.role]}, there is no company to find.</span>
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={mark.isPending} onClick={() => mark.mutate(true)} data-testid={`deal-party-mark-individual-${party.role}`}>
        {mark.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <UserRound className="w-3.5 h-3.5 mr-1" />}A private individual
      </Button>
    </div>
  );
}

// When the deal names no company that signs: the one to offer first (the
// company on the unit's lease, the brand's main one, its only one) or the
// brand's own registered company, each a press away, and the full list.
export function PartyCompanyChoice({ dealId, party, onChoose }: { dealId: string; party: DealPartyView; onChoose: () => void }) {
  const set = useSetSigningCompany(dealId, party.role);
  if (party.brand.kind !== "company" || party.company) return null;
  return (
    <div className="space-y-1.5" data-testid={`deal-party-choice-${party.role}`}>
      <PrivateIndividualSuggestion dealId={dealId} party={party} />
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

// More than one private individual on one side (Jack, 20 November 2026): who
// is named alongside them, and Add another person (their own checks).
function IndividualSidePeople({ dealId, companyId }: { dealId: string; companyId: string }) {
  const { data } = useClientChecks(dealId, true);
  const party = data?.parties.find(p => p.companyId === companyId) || null;
  if (!data || !party) return null;
  const others = (data.people?.[companyId]?.people || []).filter(p => p.roles.includes("joint"));
  return (
    <div className="space-y-1 pt-1" data-testid="deal-party-individual-people">
      <p className="text-xs text-muted-foreground">
        {others.length
          ? <>Also on this side, each with their own checks: {others.map(p => p.name).join(", ")}. Their progress is under People in the AML box.</>
          : <>More than one person buying, selling or renting together? Add each of them: they get their own checks.</>}
      </p>
      <AddPersonButton dealId={dealId} data={data} party={party} />
    </div>
  );
}

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
  [p.roles.includes("owner") ? "Owner" : null, p.roles.includes("acting") ? "dealing with us" : null, p.roles.includes("joint") ? "alongside them" : null].filter(Boolean).join(", ") || "Director";

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
        Owners not read from Companies House yet · <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onOpen}>Read them</button>
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
            ? "Each gets their own link: add an email or mobile."
            : PARTY_PEOPLE_BASIS_WORDS[people.basis])}
      </p>
      {!!people.ownersAbroad?.length && (
        <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" data-testid="deal-party-owners-abroad">
          Owned through {people.ownersAbroad.map(o => `${o.name} (${o.country})`).join(" and ")}: registered abroad, so Companies House cannot show who owns {people.ownersAbroad.length === 1 ? "it" : "them"}.{" "}
          {people.ownersAbroad.every(o => o.answered)
            ? "The people recorded behind it in the AML box (Owners abroad) are listed below."
            : "The AML box's Owners abroad section traces what it can, and the client checks ask for a structure chart up to the people and their IDs."}
        </p>
      )}
      {people.people.length > 0 && <ul className="space-y-1.5">{people.people.map(p => <PersonToReach key={p.key} dealId={dealId} party={party} person={p} busy={busy} quiet={!!quiet} onAsk={onAsk} />)}</ul>}
      {people.directors.length > 0 && (
        <p className="text-[11px] text-muted-foreground">Directors, no ID needed (sanctions checks only): {people.directors.map(d => personDisplayName(d.name)).join(", ")}.</p>
      )}
    </div>
  );
}

// ── Who pays BGP's invoice (Woody, 20 November 2026) ────────────────────────
// "the Xero billing entity and the aml entity need to be flagged if they are
// different ... Should we need to change the billing entity it's done on the
// deal page as add billing entity which also needs its own KYC no?", then
// "yes biuild". BGP's client is billed as the company that signs; another
// company is flagged, with three ways out: they are the same company, a third
// party pays (recorded with how it is related, and checked), or bill the
// company that signs instead. The rules are shared/deal-billing.ts.

const BILLING_TONE: Record<DealPartyBilling["tone"], string> = {
  done: "text-muted-foreground",
  info: "text-muted-foreground",
  act: "text-amber-800 dark:text-amber-300",
  flag: "text-red-700 dark:text-red-400",
};

function refreshBilling(dealId: string, data?: DealParties) {
  refresh(dealId, data);
  queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId, "payer"] });
  queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
}

// Guarantors (Woody, 23 November 2026, on Inception T2: "one is signing
// cornhill bar and the other is guaranteeing so should be able to allocate
// add as the guarantor"). HMRC treats a guarantor as a party to the tenancy:
// BGP's checks run on it, and its owners are checked with the party.
function useGuarantorActions(dealId: string) {
  const { toast } = useToast();
  const done = (d?: DealParties) => {
    refreshBilling(dealId, d);
    queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
  };
  const add = useMutation({
    mutationFn: async (v: { role: DealPartyRole; companyId: string }) => (await apiRequest("POST", `/api/deals/${dealId}/guarantors`, v)).json() as Promise<DealParties & { started?: string | null }>,
    onSuccess: (d) => {
      done({ deal: d.deal, parties: d.parties });
      // BGP's checks on the guarantor run in the background: read again once they have had time.
      setTimeout(() => done(), 20000);
    },
    onError: (e) => toast({ title: "Guarantor not added", description: plain(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/deals/${dealId}/guarantors/${id}`)).json() as Promise<DealParties>,
    onSuccess: (d) => done(d),
    onError: (e) => toast({ title: "Not taken off", description: plain(e), variant: "destructive" }),
  });
  const run = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/deals/${dealId}/guarantors/${id}/checks`, {})).json(),
    onSuccess: () => { done(); setTimeout(() => done(), 20000); toast({ title: "BGP's checks on the guarantor started" }); },
    onError: (e) => toast({ title: "Checks not started", description: plain(e), variant: "destructive" }),
  });
  return { add, remove, run, busy: add.isPending || remove.isPending || run.isPending };
}

const guarantorWho = (g: DealGuarantorView) => g.kind === "individual" ? "a person" : g.companiesHouseNumber || "no Companies House number";

// One guarantor: who it is and where BGP's checks on it stand, with Run checks
// when they have not run (or are old) and, in the party box, Remove.
function GuarantorItem({ dealId, g, canRemove }: { dealId: string; g: DealGuarantorView; canRemove?: boolean }) {
  const { remove, run, busy } = useGuarantorActions(dealId);
  const state = g.checks.state;
  const flags = state === "done" || state === "stale"
    ? g.checks.redFlags ? <span className="text-red-700 dark:text-red-400"> · {g.checks.redFlags} red flag{g.checks.redFlags === 1 ? "" : "s"} (in Screening)</span> : <span className="text-muted-foreground"> · no red flags</span>
    : null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid={`deal-guarantor-${g.entityId}`}>
      <span className="min-w-0">
        <span className="font-medium">{g.name}</span>
        <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">{guarantorWho(g)}</span>
        <span className={state === "not_run" || state === "stale" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}> · {GUARANTOR_CHECKS_WORDS[state]}</span>
        {flags}
      </span>
      {(state === "not_run" || state === "stale") && (
        <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[11px]" disabled={busy} onClick={() => run.mutate(g.id)} data-testid={`deal-guarantor-run-${g.entityId}`}>
          {run.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}Run checks
        </Button>
      )}
      {state === "running" && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      {canRemove && (
        <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-muted-foreground" disabled={busy} onClick={() => remove.mutate(g.id)} data-testid={`deal-guarantor-remove-${g.entityId}`}>
          Remove
        </Button>
      )}
    </div>
  );
}

interface PayerView { role: DealPartyRole; payer: DealPartyPayer | null; checks: { state: string; ranAt: string | null; lines: Array<{ key: string; label: string; state: string; detail: string | null }>; company: { owners: Array<{ name: string; control: string }> } | null } | null }

export function usePayerChecks(dealId: string, enabled: boolean) {
  return useQuery<PayerView>({
    enabled,
    queryKey: ["/api/deals", dealId, "payer"],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${dealId}/payer`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(plain(await res.text()));
      return res.json();
    },
    refetchInterval: (q) => ((q.state.data as PayerView | undefined)?.checks?.state === "running" ? 5000 : false),
  });
}

/** Who BGP's client is billed as, and what to do when it is another company. compact: the Parties card's line. */
export function PartyBillingDetail({ dealId, party, compact }: { dealId: string; party: DealPartyView; compact?: boolean }) {
  const { toast } = useToast();
  const [paying, setPaying] = useState(false);
  const b = party.billing;
  const same = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/billing/same-company`, {})).json() as Promise<DealParties>,
    onSuccess: (d) => { refreshBilling(dealId, d); toast({ title: "Recorded as the same company", description: "The Xero contact is kept on the company that signs." }); },
    onError: (e) => toast({ title: "Not saved", description: plain(e), variant: "destructive" }),
  });
  const signing = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/billing/signing`, {})).json() as Promise<DealParties>,
    onSuccess: (d) => { refreshBilling(dealId, d); toast({ title: `Billed as ${party.company?.name || "the company that signs"}` }); },
    onError: (e) => toast({ title: "Not saved", description: plain(e), variant: "destructive" }),
  });
  const payerChecks = usePayerChecks(dealId, !compact && !!b?.payer);
  const again = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/payer/checks`, {})).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId, "payer"] }); queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] }); },
    onError: (e) => toast({ title: "Not started", description: plain(e), variant: "destructive" }),
  });
  if (!b || b.state === "individual") return null;
  const busy = same.isPending || signing.isPending;
  const checks = payerChecks.data?.checks || null;
  const attention = checks?.lines.filter(l => l.state === "attention") || [];
  return (
    <div className="space-y-1.5 text-xs" data-testid={`deal-billing-${party.role}`}>
      <p className={BILLING_TONE[b.tone]} data-testid={`deal-billing-words-${party.role}`}>
        {compact && (b.state === "same" || b.state === "signing")
          ? <><span className="text-foreground">{b.state === "same" ? b.billed?.name : party.company?.name}</span>, the company that signs</>
          : b.words}
      </p>
      {b.state === "payer" && b.payer && !compact && (
        <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1" data-testid={`deal-billing-payer-${party.role}`}>
          <div><span className="font-medium text-foreground">{b.payer.name}</span>{b.payer.companiesHouseNumber ? <span className="ml-1 font-mono tabular-nums text-muted-foreground">{b.payer.companiesHouseNumber}</span> : null}</div>
          <div className="text-muted-foreground">How it is related: {b.payer.relationshipWords}{b.payer.note ? `. ${b.payer.note}` : ""}</div>
          {checks && (
            <div className="space-y-0.5" data-testid={`deal-billing-payer-checks-${party.role}`}>
              <div className="text-muted-foreground">
                BGP's checks on it: {checks.state === "running" ? "running now" : checks.ranAt ? `${new Date(checks.ranAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${attention.length ? `${attention.length} to review` : "nothing to review"}` : "not run yet"}
                {" · "}<button type="button" data-no-min-touch className="underline underline-offset-2 hover:text-foreground disabled:opacity-50" disabled={again.isPending || checks.state === "running"} onClick={() => again.mutate()}>Run again</button>
              </div>
              {attention.map(l => <div key={l.key} className="text-amber-800 dark:text-amber-300">{l.label}{l.detail ? `: ${l.detail}` : ""}</div>)}
              {!!checks.company?.owners.length && (
                <div className="text-muted-foreground">Owners to identify and verify: {checks.company.owners.map(o => o.name).join("; ")}</div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {b.state === "different" && (
          <>
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs bg-background" disabled={busy} onClick={() => same.mutate()} data-testid={`deal-billing-same-${party.role}`}>They are the same company</Button>
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs bg-background" disabled={busy} onClick={() => setPaying(true)} data-testid={`deal-billing-payer-open-${party.role}`}>Record who pays</Button>
          </>
        )}
        {(b.state === "different" || b.state === "payer") && party.company && (
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => signing.mutate()} data-testid={`deal-billing-signing-${party.role}`}>
            {signing.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Bill {party.company.name} instead
          </Button>
        )}
        {b.state === "payer" && !compact && (
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => setPaying(true)} data-testid={`deal-billing-payer-change-${party.role}`}>Change who pays</Button>
        )}
        {(b.state === "same" || b.state === "signing") && !compact && (
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPaying(true)} data-testid={`deal-billing-third-party-${party.role}`}>A third party pays</Button>
        )}
      </div>
      {paying && <PayerDialog dealId={dealId} party={party} onClose={() => setPaying(false)} />}
    </div>
  );
}

// The third party that pays BGP's invoice for the client: a company filed
// under the client (found at Companies House, which also makes its Xero
// contact), how it is related, and a note. BGP's checks before asking start on
// it when it is saved.
export function PayerDialog({ dealId, party, onClose }: { dealId: string; party: DealPartyView; onClose: () => void }) {
  const { toast } = useToast();
  const current = party.billing?.payer || null;
  const [companyId, setCompanyId] = useState<string | null>(current?.id || null);
  const [relationship, setRelationship] = useState<string>(current?.relationship || "");
  const [note, setNote] = useState(current?.note || "");
  const [finding, setFinding] = useState(false);
  const choices = party.companies.filter(c => c.id !== party.company?.id);
  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiRequest("PUT", `/api/deals/${dealId}/payer`, body)).json(),
    onSuccess: (d: any, body) => {
      refreshBilling(dealId, { deal: d.deal, parties: d.parties });
      toast(body.companyId
        ? { title: "Recorded who pays", description: d.started === "started" ? "BGP's checks before asking are running on it now." : "BGP's checks before asking are on it." }
        : { title: "Taken off", description: `The invoice goes back to ${party.company?.name || "the company that signs"}.` });
      onClose();
    },
    onError: (e) => toast({ title: "Not saved", description: plain(e), variant: "destructive" }),
  });
  const needsNote = relationship === "other" && note.trim().length < PAYER_NOTE_MIN;
  return (
    <Dialog open onOpenChange={o => { if (!o && !finding) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="deal-payer-dialog">
        <DialogHeader>
          <DialogTitle>Who pays BGP's invoice</DialogTitle>
          <DialogDescription>
            When a company other than {party.company?.name || "the company that signs"} pays. It gets BGP's checks too.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <section className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">The company that pays</Label>
            {choices.length > 0 ? (
              <ul className="divide-y rounded-md border">
                {choices.map(c => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs">
                      <input type="radio" name="payer-company" checked={companyId === c.id} onChange={() => setCompanyId(c.id)} />
                      <span className="min-w-0 flex-1"><span className="font-medium">{c.name}</span><span className="ml-1.5 text-muted-foreground">{c.companiesHouseNumber || "no Companies House number"}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No other company is filed under {party.brand.name}. Find the one that pays at Companies House.</p>
            )}
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFinding(true)} data-testid="deal-payer-find">
              <Plus className="w-3.5 h-3.5 mr-1" />Find it at Companies House
            </Button>
          </section>
          <section className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">How it is related to {party.brand.name}</Label>
            <div className="space-y-1">
              {PAYER_RELATIONSHIPS.map(r => (
                <label key={r.key} className="flex cursor-pointer items-start gap-2 text-xs">
                  <input type="radio" name="payer-relationship" className="mt-0.5" checked={relationship === r.key} onChange={() => setRelationship(r.key)} data-testid={`deal-payer-relationship-${r.key}`} />
                  <span className={r.clear ? "" : "text-red-700 dark:text-red-400"}>{r.words}{r.clear ? "" : ": a red flag"}</span>
                </label>
              ))}
            </div>
            <Textarea rows={2} className="text-xs" value={note} onChange={e => setNote(e.target.value)} placeholder="What you know, e.g. the tenant's parent company pays all its agents' fees" data-testid="deal-payer-note" />
            {relationship === "other" && <p className="text-[11px] text-muted-foreground">Say in the note how they are related.</p>}
          </section>
        </div>
        <DialogFooter className="gap-2">
          {current && (
            <Button type="button" variant="ghost" className="mr-auto" disabled={save.isPending} onClick={() => save.mutate({ companyId: null })} data-testid="deal-payer-remove">Take it off</Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={save.isPending || !companyId || !relationship || needsNote}
            onClick={() => save.mutate({ companyId, relationship, note: note.trim() || null })} data-testid="deal-payer-save">
            {save.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Save
          </Button>
        </DialogFooter>
        {finding && (
          <CreateBillingEntityDialog
            open
            onOpenChange={v => { if (!v) setFinding(false); }}
            brand={{ id: party.brand.id, name: party.brand.name }}
            initialQuery=""
            onCreated={(_contact, company) => {
              if (company) { setCompanyId(company.id); queryClient.invalidateQueries({ queryKey: dealPartiesKey(dealId) }); }
              setFinding(false);
            }}
            onSavedWithoutXero={company => { setCompanyId(company.id); queryClient.invalidateQueries({ queryKey: dealPartiesKey(dealId) }); setFinding(false); }}
            testIdPrefix="deal-payer-find"
          />
        )}
      </DialogContent>
    </Dialog>
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
// fullBilling: who pays BGP's invoice with its third-party payer and checks
// (inside the AML box's Who signs step), not the one-line summary.
export function DealPartyLines({ dealId, role, aml, fullBilling }: { dealId: string; role: DealPartyRole; aml?: PartyAmlFacts | null; fullBilling?: boolean }) {
  const { data } = useDealParties(dealId);
  const [open, setOpen] = useState(false);
  const party = data?.parties.find(p => p.role === role);
  const { people } = usePartyPeople(dealId, party);
  if (!party) return null;
  // Signed off, not required, or a letting under £10,000 a month (sanctions only): nobody
  // has to be asked, so who to ask is not a gap (Woody, 23 November 2026, on The Ugly Duck).
  const askQuiet = !!aml && (aml.sanctionsOnly || !!aml.done);
  const gaps = askQuiet ? party.gaps.filter(g => g.key !== "person" && g.key !== "email") : party.gaps;
  return (
    <div className="space-y-2" data-testid={`deal-party-lines-${role}`}>
      <dl className="space-y-1.5">
        {party.brand.kind === "company" || party.company ? (
          <PartyRow label={party.company?.kind === "individual" ? "Who signs" : "Company that signs"} testId={`deal-party-row-company-${role}`}>
            {party.company ? (
              <span data-testid={`deal-party-company-${role}`}>
                <span className="font-medium">{party.company.name}</span>
                {party.company.kind === "individual"
                  ? <span className="ml-1.5 text-muted-foreground">a person, checked as a private individual</span>
                  : party.company.companiesHouseNumber && <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">{party.company.companiesHouseNumber}</span>}
              </span>
            ) : (
              <span className="text-amber-700 dark:text-amber-400" data-testid={`deal-party-company-missing-${role}`}>Not set: {SIGNING_COMPANY_WORDS[role]}, needed for the AML checks</span>
            )}
          </PartyRow>
        ) : (
          <PartyRow label="Signs as">A private individual</PartyRow>
        )}
        {/* Only BGP's client is billed (20 November 2026): as its company that signs, unless the deal says otherwise. */}
        {party.client && party.billing && party.billing.state !== "individual" && (
          <PartyRow label="Billed to" testId={`deal-party-row-billing-${role}`}>
            <PartyBillingDetail dealId={dealId} party={party} compact={!fullBilling} />
          </PartyRow>
        )}
        <PartyRow label="Who to ask" testId={`deal-party-row-person-${role}`}>
          {party.person
            ? <span data-testid={`deal-party-person-${role}`}>{party.person.name}{party.person.email ? <span className="text-muted-foreground"> · {party.person.email}</span> : askQuiet ? null : <span className="text-amber-700 dark:text-amber-400"> · no email</span>}</span>
            : askQuiet
              ? <span className="text-muted-foreground" data-testid={`deal-party-person-not-needed-${role}`}>Not needed: {aml!.done === "approved" ? "signed off" : aml!.done === "not_required" ? "not required" : "sanctions checks only"}</span>
              : <span className="text-amber-700 dark:text-amber-400">Nobody set, needed for the client checks</span>}
        </PartyRow>
        {isGuaranteedRole(role) && (party.guarantors || []).length > 0 && (
          <PartyRow label={(party.guarantors || []).length > 1 ? "Guarantors" : "Guarantor"} testId={`deal-party-row-guarantor-${role}`}>
            <div className="space-y-1">{party.guarantors!.map(g => <GuarantorItem key={g.id} dealId={dealId} g={g} />)}</div>
          </PartyRow>
        )}
      </dl>
      <PeopleToReachLine party={party} people={people} aml={aml} onOpen={() => setOpen(true)} />
      {!party.company && party.brand.kind === "company" && <PartyCompanyChoice dealId={dealId} party={party} onChoose={() => setOpen(true)} />}
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid={`deal-party-edit-${role}`}>
        {gaps.length ? "Fill in" : "Change"}
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
          {party.company ? <>Signs as <span className="text-foreground font-medium">{companyWords(party.company)}</span> · </> : null}
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
  useWorkOutSigningCompanies(dealId, data);
  const party = data?.parties.find(p => p.role === role) || null;
  // "person": the dialog opens on a person who signs (2026-11-20).
  const [finding, setFinding] = useState<boolean | "person">(false);
  // Finding a guarantor at Companies House, or adding a person who guarantees (23 November 2026).
  const [guarantorFinding, setGuarantorFinding] = useState<false | "company" | "person">(false);
  const guarantor = useGuarantorActions(dealId);
  // The heads of terms' dialog is open over this one: it must not close under it.
  const [hotsOpen, setHotsOpen] = useState(false);
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
  const markIndividual = useMarkIndividual(dealId, role);
  const busy = save.isPending || add.isPending || bill.isPending || setOwn.isPending || markIndividual.isPending;
  const billedElsewhere = !!party?.company && (!party.xero || (party.xero.name || "").trim().toLowerCase() !== party.company.name.trim().toLowerCase());

  return (
    <Dialog open onOpenChange={o => { if (!o && !finding && !hotsOpen && !guarantorFinding) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid={`deal-party-editor-${role}`}>
        <DialogHeader>
          <DialogTitle>{party ? `${party.label}: ${party.brand.name}` : "Party"}</DialogTitle>
          <DialogDescription>Changes save straight away.</DialogDescription>
        </DialogHeader>
        {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>}
        {error && <p className="text-sm text-red-700">{plain(error)}</p>}
        {!isLoading && !error && !party && <p className="text-sm text-muted-foreground">Set the {role} on the transaction first.</p>}
        {party && (
          <div className="space-y-5 text-sm">
            <section className="space-y-2" data-testid="deal-party-company-section">
              <h4 className="flex items-center gap-1.5 font-semibold"><Building2 className="w-4 h-4 text-muted-foreground" />Who signs</h4>
              {party.brand.recordIndividual && !party.company ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">{party.brand.name} is recorded as a private individual, so there is no company to pick. Their date of birth and home address are asked for in the client checks.</p>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" disabled={busy || markIndividual.isPending}
                    onClick={() => markIndividual.mutate(false)} data-testid="deal-party-unmark-individual">
                    {markIndividual.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Not a private individual? Undo
                  </Button>
                  <IndividualSidePeople dealId={dealId} companyId={party.brand.id} />
                </div>
              ) : party.brand.recordPublicBody && !party.company ? (
                <PublicBodyLine dealId={dealId} party={party} />
              ) : (
                <>
                  <PublicBodyLine dealId={dealId} party={party} />
                  <TrustLine dealId={dealId} party={party} />
                  {/* The heads of terms name the company that signs (Woody, 23 November 2026: "where is the upload HOTs place?"). */}
                  {!party.company && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-2 text-xs" data-testid="deal-party-hots">
                      <span className="min-w-0 flex-1 text-muted-foreground">The heads of terms name it.</span>
                      <DealHotsButton dealId={dealId} label="Read the heads of terms" testId="deal-party-hots-button" inEditor onOpenChange={setHotsOpen} />
                    </div>
                  )}
                  {party.brand.privateMark && !party.company && !party.brand.companiesHouseNumber && (
                    <div className="rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs">
                      <PrivateIndividualSuggestion dealId={dealId} party={party} />
                    </div>
                  )}
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
                        // One company signs; another of the brand's can guarantee it (Woody, 23 November 2026).
                        const guarantees = (party.guarantors || []).find(g => g.entityId === c.id) || null;
                        return (
                          <li key={c.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs" data-testid={`deal-party-company-option-${c.id}`}>
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">{c.name}</span>
                              <span className="ml-1.5 text-muted-foreground">{c.kind === "individual" ? "a person" : c.companiesHouseNumber || "no Companies House number"}</span>
                              {c.isDefault && <Badge variant="outline" className="ml-1.5 text-[10px]">Main</Badge>}
                            </span>
                            {chosen
                              ? <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" />Signs</span>
                              : guarantees
                                ? <span className="flex items-center gap-1 text-emerald-700" data-testid={`deal-party-guarantees-${c.id}`}><ShieldCheck className="w-3.5 h-3.5" />Guarantor</span>
                                : <>
                                    <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[11px]" disabled={busy} onClick={() => pickCompany(c)}>Use</Button>
                                    {isGuaranteedRole(role) && (
                                      <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[11px]" disabled={busy || guarantor.busy}
                                        onClick={() => guarantor.add.mutate({ role, companyId: c.id })} data-testid={`deal-party-make-guarantor-${c.id}`}>
                                        Guarantor
                                      </Button>
                                    )}
                                  </>}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">No company filed under {party.brand.name} yet.</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => setFinding(true)} data-testid="deal-party-find-company">
                      <Plus className="w-3.5 h-3.5 mr-1" />Find it at Companies House
                    </Button>
                    {/* A person who signs in their own name, checked as a private individual (2026-11-20). */}
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => setFinding("person")} data-testid="deal-party-add-person-signs">
                      <UserRound className="w-3.5 h-3.5 mr-1" />A person signs
                    </Button>
                    {party.company && (
                      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" disabled={busy} onClick={() => save.mutate({ companyId: null })}>Clear</Button>
                    )}
                  </div>
                  {!party.company && !party.brand.companiesHouseNumber && !party.brand.privateMark && (
                    <p className="text-xs text-muted-foreground" data-testid="deal-party-individual-option">
                      Is {party.brand.name} a person, not a company?{" "}
                      <button type="button" className="underline underline-offset-2 hover:text-foreground disabled:opacity-50" disabled={busy || markIndividual.isPending}
                        onClick={() => markIndividual.mutate(true)} data-testid="deal-party-mark-individual">Record them as a private individual</button>
                    </p>
                  )}
                  {party.client && <div className="rounded-md bg-muted/50 px-2.5 py-2 text-xs space-y-1" data-testid="deal-party-billing">
                    <div><span className="text-muted-foreground">Billed to (Xero): </span>{party.xero ? (party.xero.name || "a Xero contact") : "not set"}</div>
                    {billedElsewhere && party.company?.companiesHouseNumber && (
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs bg-background" disabled={busy} onClick={() => bill.mutate()} data-testid="deal-party-bill">
                        {bill.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Bill to {party.company.name} in Xero
                      </Button>
                    )}
                  </div>}
                </>
              )}
            </section>

            {isGuaranteedRole(role) && (
              <section className="space-y-2" data-testid="deal-party-guarantor-section">
                <h4 className="flex items-center gap-1.5 font-semibold"><ShieldCheck className="w-4 h-4 text-muted-foreground" />Guarantor</h4>
                {(party.guarantors || []).length > 0 && (
                  <div className="space-y-1.5 rounded-md border px-2.5 py-2 text-xs" data-testid="deal-party-guarantors">
                    {party.guarantors!.map(g => <GuarantorItem key={g.id} dealId={dealId} g={g} canRemove />)}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={busy || guarantor.busy} onClick={() => setGuarantorFinding("company")} data-testid="deal-party-find-guarantor">
                    <Plus className="w-3.5 h-3.5 mr-1" />Find the guarantor at Companies House
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={busy || guarantor.busy} onClick={() => setGuarantorFinding("person")} data-testid="deal-party-add-person-guarantor">
                    <UserRound className="w-3.5 h-3.5 mr-1" />A person guarantees
                  </Button>
                </div>
              </section>
            )}

            {party.client && party.billing && party.billing.state !== "individual" && !(party.brand.recordPublicBody && party.billing.state === "no_company") && (
              <section className="space-y-2" data-testid="deal-party-pays-section">
                <h4 className="flex items-center gap-1.5 font-semibold"><Receipt className="w-4 h-4 text-muted-foreground" />Who pays BGP's invoice</h4>
                <PartyBillingDetail dealId={dealId} party={party} />
              </section>
            )}

            {party.brand.kind === "company" && !(party.brand.recordPublicBody && !party.company) && (
              <section className="space-y-2" data-testid="deal-party-people-section">
                <h4 className="flex items-center gap-1.5 font-semibold"><ShieldCheck className="w-4 h-4 text-muted-foreground" />Who the AML checks need</h4>
                <PartyPeopleToCheck dealId={dealId} party={party} busy={busy} aml={aml} onAsk={(id) => save.mutate({ personId: id })} />
              </section>
            )}

            <section className="space-y-2" data-testid="deal-party-person-section">
              <h4 className="flex items-center gap-1.5 font-semibold"><UserRound className="w-4 h-4 text-muted-foreground" />Who to ask</h4>
              {party.person && (
                <div className="rounded-md border px-2.5 py-2 text-xs" data-testid="deal-party-person-current">
                  <div className="font-medium">{party.person.name}{party.person.jobTitle ? <span className="font-normal text-muted-foreground"> · {party.person.jobTitle}</span> : null}</div>
                  <div className="text-muted-foreground">{[party.person.email || "no email", party.person.mobile].filter(Boolean).join(" · ")}</div>
                  {party.person.from === "client" && <div className="text-muted-foreground italic">The transaction's client contact</div>}
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
            xero={!!party.client}
            startAsPerson={finding === "person"}
            onCreated={(contact, company) => { if (company) pickCompany(company, contact); setFinding(false); }}
            onSavedWithoutXero={company => { pickCompany(company); setFinding(false); }}
            testIdPrefix={`deal-party-${role}-find`}
          />
        )}
        {party && guarantorFinding && (
          <CreateBillingEntityDialog
            open
            onOpenChange={v => { if (!v) setGuarantorFinding(false); }}
            brand={{ id: party.brand.id, name: party.brand.name }}
            initialQuery=""
            xero={false}
            startAsPerson={guarantorFinding === "person"}
            onCreated={(_contact, company) => { if (company) guarantor.add.mutate({ role, companyId: company.id }); setGuarantorFinding(false); }}
            onSavedWithoutXero={company => { guarantor.add.mutate({ role, companyId: company.id }); setGuarantorFinding(false); }}
            testIdPrefix={`deal-party-${role}-guarantor-find`}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
