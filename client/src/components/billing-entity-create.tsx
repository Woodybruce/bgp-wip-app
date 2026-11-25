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
import { Globe2, Landmark, Loader2, UserRound } from "lucide-react";
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
export type SavedCompany = { id: string; name: string; companiesHouseNumber: string | null; kind?: "company" | "individual"; contactId?: string | null;
  // A company registered abroad (23 November 2026).
  abroad?: { country: string; registrationNumber: string | null; registerUrl: string | null } };

// Countries offered as the box is typed in; any other can be typed.
interface GleifHit { lei: string; name: string; country: string | null; jurisdiction: string | null; registeredAs: string | null; status: string | null }
// A GLEIF country code in words ("US" is "United States").
function countryWords(code: string | null | undefined): string {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return c;
  try { return new Intl.DisplayNames(["en-GB"], { type: "region" }).of(c) || c; } catch { return c; }
}
const COUNTRIES = ["Australia", "Austria", "Belgium", "Bermuda", "British Virgin Islands", "Canada", "Cayman Islands", "China", "Cyprus", "Czech Republic",
  "Denmark", "Finland", "France", "Germany", "Gibraltar", "Greece", "Guernsey", "Hong Kong", "India", "Ireland", "Isle of Man", "Israel", "Italy", "Japan",
  "Jersey", "Liechtenstein", "Luxembourg", "Malta", "Monaco", "Netherlands", "New Zealand", "Norway", "Poland", "Portugal", "Qatar", "Saudi Arabia",
  "Singapore", "South Africa", "Spain", "Sweden", "Switzerland", "Turkey", "United Arab Emirates", "United States"];
// Companies House statuses that cannot be billed (the server refuses them too).
const CLOSED = new Set(["dissolved", "converted-closed", "removed", "closed"]);

export function CreateBillingEntityDialog({ open, onOpenChange, brand, initialQuery, initialPersonName = "", onCreated, onSavedWithoutXero, testIdPrefix = "billing-entity", xero = true, startAsPerson = false, startAs }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brand: { id: string; name: string };
  initialQuery: string;
  /** The person's name to start with (the heads of terms named them, 23 November 2026). */
  initialPersonName?: string;
  onCreated: (contact: XeroContact, company: SavedCompany | null) => void;
  // Given, a company saved under the brand counts even when Xero made no
  // contact (the deal's parties need the company; billing can follow).
  onSavedWithoutXero?: (company: SavedCompany, reason: string) => void;
  testIdPrefix?: string;
  // false: filed under the brand with no Xero contact (a party BGP does not
  // bill: the one that signs for it is still checked).
  xero?: boolean;
  startAsPerson?: boolean;
  // Which way to open: a company at Companies House, a person, or a company registered abroad.
  startAs?: "company" | "person" | "abroad";
}) {
  const firstMode = startAs || (startAsPerson ? "person" : "company");
  const [mode, setMode] = useState<"company" | "person" | "abroad">(firstMode);
  const [person, setPerson] = useState({ name: "", email: "", mobile: "" });
  const [abroad, setAbroad] = useState({ name: "", country: "", registrationNumber: "", registerUrl: "" });
  useEffect(() => {
    if (open) {
      setMode(firstMode);
      setPerson({ name: initialPersonName, email: "", mobile: "" });
      setAbroad({ name: firstMode === "abroad" ? initialQuery : "", country: "", registrationNumber: "", registerUrl: "" });
    }
  }, [open, firstMode, initialPersonName, initialQuery]);
  const { toast } = useToast();
  const [term, setTerm] = useState(initialQuery);
  const [q, setQ] = useState(initialQuery.trim());
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { if (open) { setTerm(initialQuery); setQ(initialQuery.trim()); setProblem(null); } }, [open, initialQuery]);
  useEffect(() => { const t = setTimeout(() => setQ(term.trim()), 300); return () => clearTimeout(t); }, [term]);

  // GLEIF, searched as the name is typed in the Registered abroad box (Woody,
  // 25 November 2026: "same as companies house can we search up GLEIF that
  // way?"). Picking a record fills the country, number and register link.
  const [gleifPicked, setGleifPicked] = useState<string | null>(null);
  const [gleifTerm, setGleifTerm] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setGleifTerm(abroad.name.trim()), 350);
    return () => window.clearTimeout(t);
  }, [abroad.name]);
  const gleif = useQuery<GleifHit[], Error>({
    queryKey: ["/api/billing-entities/gleif-search", gleifTerm],
    enabled: open && mode === "abroad" && gleifTerm.length >= 3 && gleifPicked !== gleifTerm,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => {
      const r = await fetch(`/api/billing-entities/gleif-search?q=${encodeURIComponent(gleifTerm)}`, { credentials: "include", headers: getAuthHeaders() });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.message || "GLEIF could not be searched. Try again.");
      return Array.isArray(body?.results) ? body.results : [];
    },
  });
  const pickGleif = (h: GleifHit) => {
    const name = h.name;
    setGleifPicked(name.trim());
    setAbroad({ name, country: countryWords(h.country), registrationNumber: h.registeredAs || "", registerUrl: `https://search.gleif.org/#/record/${h.lei}` });
  };
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
        toast({ title: "Company saved", description: xero ? `${company.name} is saved under ${brand.name}. Not in Xero: ${body?.xeroError || "the Xero contact was not made."}` : `${company.name} is saved under ${brand.name}.` });
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

  // A company registered abroad (23 November 2026): Companies House has no
  // record of it; its own register's extract is read in the app.
  const saveAbroad = async () => {
    if (busy) return;
    setBusy("abroad");
    setProblem(null);
    try {
      const res = await fetch("/api/billing-entities", {
        method: "POST",
        credentials: "include",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: brand.id, abroad: { name: abroad.name, country: abroad.country, registrationNumber: abroad.registrationNumber || null, registerUrl: abroad.registerUrl || null }, ...(xero ? {} : { xero: false }) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setProblem(body?.message || "The company could not be saved. Try again."); return; }
      const company: SavedCompany = {
        id: String(body.entity.id), name: String(body.entity.name || abroad.name), companiesHouseNumber: null, kind: "company",
        abroad: { country: abroad.country.trim(), registrationNumber: abroad.registrationNumber.trim() || null, registerUrl: abroad.registerUrl.trim() || null },
      };
      if (body?.contact?.ContactID) {
        onCreated(body.contact as XeroContact, company);
        toast({ title: "Company saved", description: `${company.name} (${company.abroad!.country}): saved under ${brand.name}${body.xeroCreated ? " and added to Xero" : ", and already in Xero"}.` });
        onOpenChange(false);
      } else if (onSavedWithoutXero) {
        onSavedWithoutXero(company, body?.xeroError || (xero ? "The Xero contact was not made." : "Not added to Xero: BGP does not bill this party."));
        toast({ title: "Company saved", description: `${company.name} (${company.abroad!.country}) is saved under ${brand.name}. Ask the client for its register extract: the app reads it.` });
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
  const abroadReady = abroad.name.trim().length >= 2 && abroad.country.trim().length >= 2;

  const hits = ch.data || [];
  return (
    <Dialog open={open} onOpenChange={v => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-md" data-testid={`${testIdPrefix}-dialog`}>
        <DialogHeader>
          <DialogTitle>{xero ? "Create billing entity" : "Who signs"}</DialogTitle>
          <DialogDescription>
            {mode === "person"
              ? <>A person who signs{xero ? " or is billed" : ""} in their own name. They are saved under {brand.name}{xero ? " and added to the firm's Xero" : ""}, and checked as a private individual: an identity check and a proof of address.</>
              : mode === "abroad"
              ? <>A company registered outside the UK. It is saved under {brand.name}; its own register's extract is read in the app when the client sends it.</>
              : <>Find the company at Companies House. It is saved under {brand.name}{xero ? " and added to the firm's Xero as a contact" : ""}.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-1.5" role="tablist" data-testid={`${testIdPrefix}-mode`}>
          <Button type="button" size="sm" variant={mode === "company" ? "default" : "outline"} className="h-7 rounded-full text-xs" onClick={() => { setMode("company"); setProblem(null); }} data-testid={`${testIdPrefix}-mode-company`}>
            <Landmark className="mr-1 h-3.5 w-3.5" />A company
          </Button>
          <Button type="button" size="sm" variant={mode === "abroad" ? "default" : "outline"} className="h-7 rounded-full text-xs" onClick={() => { setMode("abroad"); setProblem(null); }} data-testid={`${testIdPrefix}-mode-abroad`}>
            <Globe2 className="mr-1 h-3.5 w-3.5" />Registered abroad
          </Button>
          <Button type="button" size="sm" variant={mode === "person" ? "default" : "outline"} className="h-7 rounded-full text-xs" onClick={() => { setMode("person"); setProblem(null); }} data-testid={`${testIdPrefix}-mode-person`}>
            <UserRound className="mr-1 h-3.5 w-3.5" />A person
          </Button>
        </div>
        {mode === "abroad" ? (
          // No form element here, for the same reason as the person's below.
          <div className="space-y-2.5" data-testid={`${testIdPrefix}-abroad`}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (abroadReady) void saveAbroad(); } }}>
            <div className="space-y-1">
              <Label htmlFor={`${testIdPrefix}-abroad-name`} className="text-xs">Company name, as its register shows it</Label>
              <Input id={`${testIdPrefix}-abroad-name`} autoFocus value={abroad.name} onChange={e => { setAbroad(a => ({ ...a, name: e.target.value })); setGleifPicked(null); }} placeholder="Type the name to search GLEIF, e.g. Google LLC" data-testid={`${testIdPrefix}-abroad-name`} />
              {gleifPicked === null && gleifTerm.length >= 3 && (
                gleif.isFetching ? <p className="text-[11px] text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Searching GLEIF…</p>
                : gleif.isError ? <p className="text-[11px] text-muted-foreground">{gleif.error.message} Fill in the boxes yourself.</p>
                : (gleif.data || []).length === 0 ? <p className="text-[11px] text-muted-foreground">Not on GLEIF under that name: fill in the boxes yourself.</p>
                : (
                  <ul className="max-h-48 divide-y overflow-y-auto rounded-md border" data-testid={`${testIdPrefix}-gleif-hits`}>
                    {gleif.data!.map(h => (
                      <li key={h.lei}>
                        <button type="button" className="flex w-full flex-col items-start px-2.5 py-1.5 text-left text-xs hover:bg-muted" onClick={() => pickGleif(h)} data-testid={`${testIdPrefix}-gleif-${h.lei}`}>
                          <span className="font-medium">{h.name}</span>
                          <span className="text-muted-foreground">{[h.jurisdiction || countryWords(h.country), h.registeredAs ? `no. ${h.registeredAs}` : null, String(h.status || "").toUpperCase() === "ACTIVE" ? null : (h.status || "").toLowerCase(), `LEI ${h.lei}`].filter(Boolean).join(" · ")}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              )}
              {gleifPicked !== null && abroad.registerUrl.includes("search.gleif.org") && (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400" data-testid={`${testIdPrefix}-gleif-picked`}>From GLEIF: check the boxes below, then save. BGP's checks follow its owners from there.</p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`${testIdPrefix}-abroad-country`} className="text-xs">Country it is registered in</Label>
                <Input id={`${testIdPrefix}-abroad-country`} list={`${testIdPrefix}-abroad-countries`} value={abroad.country} onChange={e => setAbroad(a => ({ ...a, country: e.target.value }))} placeholder="e.g. Germany" data-testid={`${testIdPrefix}-abroad-country`} />
                <datalist id={`${testIdPrefix}-abroad-countries`}>{COUNTRIES.map(c => <option key={c} value={c} />)}</datalist>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${testIdPrefix}-abroad-number`} className="text-xs">Registration number (if known)</Label>
                <Input id={`${testIdPrefix}-abroad-number`} value={abroad.registrationNumber} onChange={e => setAbroad(a => ({ ...a, registrationNumber: e.target.value }))} placeholder="e.g. HRB 123456" data-testid={`${testIdPrefix}-abroad-number`} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${testIdPrefix}-abroad-link`} className="text-xs">Link to its register entry (optional)</Label>
              <Input id={`${testIdPrefix}-abroad-link`} type="url" value={abroad.registerUrl} onChange={e => setAbroad(a => ({ ...a, registerUrl: e.target.value }))} placeholder="https://" data-testid={`${testIdPrefix}-abroad-link`} />
            </div>
            <Button type="button" size="sm" disabled={!abroadReady || !!busy} onClick={() => void saveAbroad()} data-testid={`${testIdPrefix}-abroad-save`}>
              {busy === "abroad" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}Save {abroad.name.trim() || "the company"}
            </Button>
          </div>
        ) : mode === "person" ? (
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
