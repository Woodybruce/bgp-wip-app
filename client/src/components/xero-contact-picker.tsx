import { getAuthHeaders, queryClient, startXeroConnect } from "@/lib/queryClient";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Receipt, X, Loader2, Plus } from "lucide-react";
import { CreateBillingEntityDialog, type SavedCompany } from "@/components/billing-entity-create";
import { leaseCompaniesKey } from "@/components/lease-company-picker";

export interface XeroContact {
  ContactID: string;
  Name: string;
  AccountNumber: string | null;
  EmailAddress: string | null;
  BillingAddress: any | null;
  Addresses?: any[];
}

interface Props {
  value: string | null | undefined;
  cachedName?: string | null;
  cachedAccountNumber?: string | null;
  cachedAddress?: any | null;
  // `company`: the company filed under the party that the contact was made
  // from, when the pick came from one (a filed company, or Create billing
  // entity). The deal records it as the company that signs (2026-11-18).
  onChange: (contact: XeroContact | null, company?: SavedCompany | null) => void;
  placeholder?: string;
  testIdPrefix?: string;
  compact?: boolean;
  // The landlord or brand the billing entity belongs to (Woody, 2026-11-17:
  // "tenant and Landlord first then the billing entity comes up linked to that
  // tenant or landlord"). Given, the box lists the companies filed under it
  // first, picking one finds or makes its Xero contact, and Create billing
  // entity files a new one under it (Companies House, then the CRM and the
  // firm's Xero; client/src/components/billing-entity-create.tsx).
  createFor?: { id: string; name: string } | null;
}

type FiledCompany = { id: string; name: string; companiesHouseNumber: string | null; isDefault?: boolean; entityKind?: string | null; contactId?: string | null };
const isPerson = (f: FiledCompany) => String(f.entityKind || "").toLowerCase() === "individual";

function formatAddress(addr: any): string {
  if (!addr) return "";
  const parts = [addr.AddressLine1, addr.AddressLine2, addr.City, addr.Region, addr.PostalCode, addr.Country].filter(Boolean);
  return parts.join(", ");
}

export function XeroContactPicker({
  value,
  cachedName,
  cachedAccountNumber,
  cachedAddress,
  onChange,
  placeholder = "Search Xero contacts…",
  testIdPrefix = "xero-contact",
  compact,
  createFor,
}: Props) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);   // the search the Create billing entity dialog opened with
  const inputRef = useRef<HTMLInputElement>(null);
  // Opening from a linked contact ("Change") swaps the card for the search
  // box — focus it so typing works straight away (Layla, 2026-10-13: a
  // linked contact left no way to type a different one).
  useEffect(() => { if (open && value) inputRef.current?.focus(); }, [open, value]);

  const trimmed = search.trim();
  // Track Xero auth state separately so we can distinguish "no contacts"
  // from "not connected" in the empty UI. Surfaces the actionable error
  // ("Connect Xero in Settings") rather than the misleading "no contacts found".
  const [notConnected, setNotConnected] = useState(false);
  // Xero refusing → the server lists contacts already linked on deals.
  const [fromApp, setFromApp] = useState(false);
  const { data: contacts = [], isFetching, error } = useQuery<XeroContact[]>({
    queryKey: ["/api/xero/contacts", trimmed],
    queryFn: async () => {
      const url = trimmed
        ? `/api/xero/contacts?search=${encodeURIComponent(trimmed)}`
        : `/api/xero/contacts`;
      const res = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) {
        if (res.status === 401) {
          setNotConnected(true);
          return [];
        }
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `Xero search failed (${res.status})`);
      }
      setNotConnected(false);
      setFromApp(res.headers.get("X-Xero-Contacts-Source") === "app");
      return res.json();
    },
    enabled: open,
    retry: false,
    staleTime: 60_000,
  });

  // Nothing at all came back — ask the server which Xero organisation it
  // searched, so the empty list says why (Layla, 2026-10-13).
  const emptyAnswer = open && !isFetching && !notConnected && !error && contacts.length === 0;
  const { data: check, isFetching: checking } = useQuery<any>({
    queryKey: ["/api/xero/contacts-check"],
    queryFn: async () => {
      const r = await fetch("/api/xero/contacts-check", { credentials: "include", headers: getAuthHeaders() });
      return r.ok ? r.json() : null;
    },
    enabled: emptyAnswer,
    staleTime: 30_000,
    retry: false,
  });
  const describe = (label: string, x: any) => !x?.connected ? `${label}: not signed in`
    : x.error ? `${label}: Xero said "${x.error}"`
    : `${label}: ${x.org || "unknown organisation"}, ${x.contacts} contacts${x.moved ? " (moved to the firm's organisation — search again)" : ""}${x.orgs?.length > 1 ? ` · your Xero login sees ${x.orgs.join(", ")}` : ""}`;
  // The firm's Xero link answered with its contacts, so a search with no match
  // means the company is not in Xero yet, not a connection problem (Woody,
  // 2026-11-17: "Its saying not on xero but is connected to Xero just new
  // billing entity for the brand"). The reconnect advice is kept for a real
  // connection problem; the person's own sign-in does not matter here.
  const firmAnswers = !!check?.firm?.connected && !check.firm.error && Number(check.firm.contacts) > 0;
  const notInXero = emptyAnswer && !!trimmed && firmAnswers;
  const stillChecking = emptyAnswer && !!trimmed && !check && checking;

  const showSelected = !!value;
  const selectedAddress = cachedAddress ? formatAddress(cachedAddress) : "";

  // The companies filed under the landlord or brand, listed first.
  const partyId = createFor?.id || "";
  const { data: filed = [] } = useQuery<FiledCompany[]>({
    queryKey: leaseCompaniesKey(partyId),
    queryFn: async () => {
      const r = await fetch(`/api/crm/companies/${encodeURIComponent(partyId)}/trading-entities`, { credentials: "include", headers: getAuthHeaders() });
      return r.ok ? r.json() : [];
    },
    enabled: open && !!partyId,
    staleTime: 60_000,
  });
  const lower = trimmed.toLowerCase();
  const filedShown = filed.filter(f => !lower || f.name.toLowerCase().includes(lower) || String(f.companiesHouseNumber || "").toLowerCase().includes(lower));
  // Picking a filed company with a Companies House number goes through the
  // billing entity route, which keeps it under the party and finds its Xero
  // contact by name, or makes one. Without a number, its name is searched in Xero.
  const [linking, setLinking] = useState<string | null>(null);
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  const pickFiled = async (f: FiledCompany) => {
    setLinkProblem(null);
    // A person filed under the party (20 November 2026): their Xero contact by name, found or made.
    if (isPerson(f) && createFor?.id) {
      setLinking(f.id);
      try {
        const r = await fetch("/api/billing-entities", {
          method: "POST", credentials: "include",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ brandId: createFor.id, person: { name: f.name } }),
        });
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.message || `The person could not be linked (${r.status})`);
        const company: SavedCompany = { id: String(body?.entity?.id || f.id), name: String(body?.entity?.name || f.name), companiesHouseNumber: null, kind: "individual", contactId: body?.entity?.contactId || f.contactId || null };
        if (body?.contact?.ContactID) { onChange(body.contact, company); setSearch(""); setOpen(false); }
        else setLinkProblem(`${f.name}: ${body?.xeroError || "the Xero contact was not made."}`);
      } catch (e: any) {
        setLinkProblem(e?.message || "The person could not be linked");
      } finally {
        setLinking(null);
      }
      return;
    }
    if (!f.companiesHouseNumber || !createFor?.id) { setSearch(f.name); return; }
    setLinking(f.id);
    try {
      const r = await fetch("/api/billing-entities", {
        method: "POST", credentials: "include",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: createFor.id, companyNumber: f.companiesHouseNumber }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.message || `The company could not be linked (${r.status})`);
      if (body?.contact?.ContactID) {
        onChange(body.contact, body?.entity?.id ? { id: String(body.entity.id), name: String(body.entity.name || f.name), companiesHouseNumber: body.entity.companiesHouseNumber || f.companiesHouseNumber } : { id: f.id, name: f.name, companiesHouseNumber: f.companiesHouseNumber });
        setSearch("");
        setOpen(false);
      } else {
        setLinkProblem(`${f.name}: ${body?.xeroError || "the Xero contact was not made."}`);
      }
    } catch (e: any) {
      setLinkProblem(e?.message || "The company could not be linked");
    } finally {
      setLinking(null);
    }
  };

  if (showSelected && !open && creating === null) {
    return (
      <div className={`flex items-start gap-2 rounded-md border bg-background px-3 py-2 ${compact ? "" : "min-h-[44px]"}`} data-testid={`${testIdPrefix}-selected`}>
        <Receipt className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{cachedName || "Xero contact"}</span>
            {cachedAccountNumber && (
              <Badge variant="outline" className="text-[10px]">A/C {cachedAccountNumber}</Badge>
            )}
          </div>
          {selectedAddress && !compact && (
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{selectedAddress}</div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 rounded-full text-[11px] flex-shrink-0"
          onClick={() => setOpen(true)}
          data-testid={`${testIdPrefix}-change`}
        >
          Change
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={() => onChange(null)}
          data-testid={`${testIdPrefix}-clear`}
          title="Clear Xero contact"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        data-testid={`${testIdPrefix}-search`}
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-lg max-h-64 overflow-y-auto">
          {createFor?.id && (filedShown.length > 0 ? (
            <div className="border-b" data-testid={`${testIdPrefix}-filed`}>
              <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Filed under {createFor.name}</div>
              {filedShown.map(f => (
                <button
                  key={f.id}
                  className="w-full text-left px-3 py-2 hover:bg-accent disabled:opacity-60"
                  disabled={!!linking}
                  onMouseDown={(e) => { e.preventDefault(); void pickFiled(f); }}
                  data-testid={`${testIdPrefix}-filed-${f.id}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {linking === f.id && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span className="text-sm font-medium">{f.name}</span>
                    {isPerson(f) && <Badge variant="outline" className="text-[10px]">A person</Badge>}
                    {f.companiesHouseNumber && <Badge variant="outline" className="text-[10px]">{f.companiesHouseNumber}</Badge>}
                    {f.isDefault && <Badge variant="outline" className="text-[10px]">Default</Badge>}
                  </div>
                </button>
              ))}
            </div>
          ) : !trimmed && (
            <div className="px-3 py-2 text-[11px] text-muted-foreground border-b" data-testid={`${testIdPrefix}-filed-none`}>
              No company filed under {createFor.name} yet. Search Xero, or add one below.
            </div>
          ))}
          {isFetching && (
            <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              Searching Xero…
            </div>
          )}
          {!isFetching && notConnected && (
            <div className="px-3 py-2 text-xs text-muted-foreground space-y-1.5">
              <p>You're not signed in to Xero.</p>
              <Button
                size="sm"
                className="h-7 rounded-full"
                onMouseDown={(e) => { e.preventDefault(); void startXeroConnect({ returnTo: window.location.pathname + window.location.search }); }}
                data-testid={`${testIdPrefix}-connect`}
              >
                Connect to Xero
              </Button>
            </div>
          )}
          {!isFetching && !notConnected && error && (
            <div className="px-3 py-2 text-xs text-destructive" data-testid={`${testIdPrefix}-error`}>
              Xero search didn't work: {(error as Error).message.slice(0, 200)}
            </div>
          )}
          {!isFetching && !notConnected && !error && contacts.length === 0 && (notInXero ? (
            <div className="px-3 py-2 text-xs text-muted-foreground space-y-1.5" data-testid={`${testIdPrefix}-not-in-xero`}>
              <p>“{trimmed}” is not in Xero yet.</p>
              {createFor?.id && (
                <Button
                  size="sm"
                  className="h-7 rounded-full"
                  onMouseDown={(e) => { e.preventDefault(); setCreating(trimmed); setOpen(false); }}
                  data-testid={`${testIdPrefix}-create`}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Create billing entity
                </Button>
              )}
            </div>
          ) : (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {trimmed
                  ? stillChecking ? "No match in Xero. Checking the Xero link…" : "No Xero contacts found"
                  : "Type to search Xero contacts"}
              {check && (
                <div className="mt-1 space-y-0.5 text-[11px]" data-testid={`${testIdPrefix}-check`}>
                  <p>{describe("Your Xero sign-in", check.mine)}</p>
                  <p>{describe("Firm Xero link", check.firm)}</p>
                </div>
              )}
            </div>
          ))}
          {!isFetching && fromApp && contacts.length > 0 && (
            <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-b">Xero is busy — these are Xero contacts already used on other transactions.</div>
          )}
          {contacts.map((c) => {
            const addr = formatAddress(c.BillingAddress);
            return (
              <button
                key={c.ContactID}
                className="w-full text-left px-3 py-2 hover:bg-accent border-b last:border-b-0"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(c);
                  setSearch("");
                  setOpen(false);
                }}
                data-testid={`${testIdPrefix}-option-${c.ContactID}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{c.Name}</span>
                  {c.AccountNumber && (
                    <Badge variant="outline" className="text-[10px]">A/C {c.AccountNumber}</Badge>
                  )}
                </div>
                {addr && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{addr}</div>}
              </button>
            );
          })}
          {createFor?.id && !notInXero && (
            <button
              className="w-full text-left px-3 py-2 text-xs font-medium hover:bg-accent border-t flex items-center gap-1.5"
              onMouseDown={(e) => { e.preventDefault(); setCreating(trimmed); setOpen(false); }}
              data-testid={`${testIdPrefix}-create-new`}
            >
              <Plus className="w-3.5 h-3.5" /> New billing entity for {createFor.name}: a company or a person
            </button>
          )}
          {!isFetching && !notConnected && !notInXero && !stillChecking && (
            <button
              className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-accent border-t"
              onMouseDown={(e) => { e.preventDefault(); void startXeroConnect({ returnTo: window.location.pathname + window.location.search }); }}
              data-testid={`${testIdPrefix}-reconnect`}
            >
              Connect to Xero again (switch organisation or fix missing contacts)
            </button>
          )}
        </div>
      )}
      {linkProblem && <p className="mt-1 text-[11px] text-destructive" data-testid={`${testIdPrefix}-link-problem`}>{linkProblem}</p>}
      {createFor?.id && creating !== null && (
        <CreateBillingEntityDialog
          open
          onOpenChange={(v) => { if (!v) setCreating(null); }}
          brand={createFor}
          initialQuery={creating}
          onCreated={(c, company) => { onChange(c, company); setSearch(""); setCreating(null); queryClient.invalidateQueries({ queryKey: leaseCompaniesKey(createFor.id) }); }}
          testIdPrefix={`${testIdPrefix}-billing-entity`}
        />
      )}
    </div>
  );
}
