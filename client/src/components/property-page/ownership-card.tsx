// Ownership & KYC (Woody, 23 November 2026: "rename details to ownership and
// KYC that should be linked to Landreg and flow up to the tabs at the top ...
// and then als linked to our AML stuff", and "the landreg search should really
// feed the inital KYC. We dont need to KYC every building but have the option
// to from there"). The building's registered owner at Land Registry, set up as
// its owner (the pills at the top follow), checked only when a person presses
// for it, and the AML on the transactions here. Feed and actions:
// server/property-ownership.ts; rules: shared/property-ownership.ts.
import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Landmark, Loader2, Search, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { titleUseWords, type PropertyOwnershipView, type ProprietorView, type TitleView } from "@shared/property-ownership";
import { groupAmlByTransaction, type AmlDashboardRow } from "@shared/aml-dashboard";
import { AmlLateChip, AmlStageChip, RedFlagChip } from "@/components/aml-frame";
import { ClientKycDialog } from "@/components/client-kyc/client-kyc-dialog";
import type { AmlDialogDeal } from "@/components/deal-aml-dialog";

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1");
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "");
const money = (v: string | null) => {
  const n = Number(String(v || "").replace(/[^\d.]/g, ""));
  return n > 0 ? `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : null;
};
const sectionHead = "text-[11px] uppercase tracking-wider text-muted-foreground";

function OwnerLine({ propertyId, title, owner, ownerName, storedTitle, onDone }: { propertyId: string; title: TitleView; owner: ProprietorView; ownerName: string | null; storedTitle: string | null; onDone: (view: PropertyOwnershipView | null) => void }) {
  const { toast } = useToast();
  const [kycOpen, setKycOpen] = useState(false);
  const use = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/properties/${propertyId}/ownership/use`, { titleNumber: title.titleNumber, dataset: owner.dataset, position: owner.position })).json(),
    onSuccess: (r: any) => { toast({ title: "Set up from Land Registry", description: r?.message || undefined }); onDone(r?.view || null); },
    onError: (e) => toast({ title: "Not set up", description: plain(e), variant: "destructive" }),
  });
  const where = owner.number ? owner.number : owner.country ? `registered in ${owner.country.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}` : null;
  const label = !owner.use ? ""
    : owner.use.kind === "long_leaseholder" || owner.use.kind === "freeholder" ? owner.use.company === "keep" ? "File it for the AML" : owner.use.kind === "freeholder" ? "Set as freeholder" : "Set as long leaseholder"
    : title.onRecord ? "Set it up" : "Use this owner";
  return (
    <div className="space-y-1.5 py-1.5" data-testid={`ownership-owner-${title.titleNumber}-${owner.dataset}-${owner.position}`}>
      <div className="text-sm min-w-0">
        <span className="font-semibold">{owner.name}</span>
        {where && <span className="text-muted-foreground"> · {where}</span>}
      </div>
      {owner.filed && owner.account ? (
        // The KYC is the shared client KYC window: one build for AML (24 November 2026).
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground" data-testid="ownership-filed">
            Filed under {owner.account.name} for the AML{owner.kyc ? ` · ${owner.kyc.words}` : ""}
          </span>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setKycOpen(true)} data-testid="ownership-open-kyc">
            <ShieldCheck className="w-3.5 h-3.5 mr-1" />KYC
          </Button>
          {kycOpen && <ClientKycDialog companyId={owner.account.id} entityId={owner.filed.entityId} name={owner.filed.name} open={kycOpen}
            onOpenChange={o => { setKycOpen(o); if (!o) onDone(null); }} />}
        </div>
      ) : owner.elsewhere ? (
        <div className="text-xs text-muted-foreground">Filed under <Link href={`/companies/${owner.elsewhere.under.id}`} className="underline decoration-dotted underline-offset-2 hover:text-foreground">{owner.elsewhere.under.name}</Link> in the CRM</div>
      ) : null}
      {owner.use && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" className="h-7 text-xs" disabled={use.isPending} onClick={() => use.mutate()} data-testid="ownership-use-owner">
            {use.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}{label}
          </Button>
          <span className="text-xs text-muted-foreground min-w-0">{titleUseWords(owner.use, { titleNumber: title.titleNumber, ownerName, proprietorName: owner.name, crmName: owner.crm?.name || null, storedTitle, accountName: owner.account?.name || null })}</span>
        </div>
      )}
    </div>
  );
}

function TitleBlock({ propertyId, title, ownerName, storedTitle, onDone }: { propertyId: string; title: TitleView; ownerName: string | null; storedTitle: string | null; onDone: (view: PropertyOwnershipView | null) => void }) {
  const paid = money(title.pricePaid);
  return (
    <div className="rounded-md border border-border px-3 py-2" data-testid={`ownership-title-${title.titleNumber}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <span className="font-semibold text-foreground">Title {title.titleNumber}</span>
        {title.tenure && <span className="text-muted-foreground">{title.tenure}</span>}
        {title.onRecord && <span className="rounded-full border border-border px-2 py-[2px] text-[11px] text-foreground">On the building's record</span>}
        {(title.dateAdded || paid) && <span className="text-muted-foreground">{[title.dateAdded ? `owner since ${day(title.dateAdded)}` : "", paid ? `paid ${paid}` : ""].filter(Boolean).join(" · ")}</span>}
      </div>
      {title.propertyAddress && <div className="text-xs text-muted-foreground">{title.propertyAddress}</div>}
      <div className="divide-y divide-border">
        {title.proprietors.map(o => <OwnerLine key={`${o.dataset}-${o.position}`} propertyId={propertyId} title={title} owner={o} ownerName={ownerName} storedTitle={storedTitle} onDone={onDone} />)}
      </div>
    </div>
  );
}

// A lease of a unit here: a tenant's, one line, no actions.
function UnitLeaseLine({ title }: { title: TitleView }) {
  return (
    <div className="flex flex-wrap gap-x-2 text-xs py-0.5" data-testid={`ownership-unit-lease-${title.titleNumber}`}>
      <span className="font-medium text-foreground">{title.titleNumber}</span>
      <span className="text-muted-foreground min-w-0">{title.propertyAddress}</span>
      <span className="text-foreground">{title.proprietors.map(p => p.name).join(", ")}</span>
    </div>
  );
}

// No freehold among the building's titles: what was found beyond its postcode, and a title number to look up.
function FreeholdSearch({ propertyId, data, ownerName, onDone }: { propertyId: string; data: PropertyOwnershipView; ownerName: string | null; onDone: (view: PropertyOwnershipView | null) => void }) {
  const [typed, setTyped] = useState("");
  const [showStreet, setShowStreet] = useState(false);
  const { toast } = useToast();
  const look = useMutation({
    mutationFn: async (title: string) => (await apiRequest("GET", `/api/properties/${propertyId}/ownership?title=${encodeURIComponent(title)}`)).json() as Promise<PropertyOwnershipView>,
    onError: (e) => toast({ title: "Not looked up", description: plain(e), variant: "destructive" }),
  });
  const found = data.freeholds!;
  const named = found.titles.filter(t => t.fit === "elsewhere");
  const street = found.titles.filter(t => t.fit === "street");
  const s = found.searched;
  const storedTitle = data.stored?.titleNumber || null;
  const result = look.data;
  return (
    <div className="space-y-2 rounded-md border border-dashed border-border px-3 py-2" data-testid="ownership-freehold-search">
      <div className="text-xs text-foreground">
        No freehold found{data.property.postcode ? ` in ${data.property.postcode}` : ""}. A big site's freehold is often registered at another address, or with no postcode.
      </div>
      {named.length > 0 && (
        <div className="space-y-2">
          <div className={sectionHead}>Freeholds naming {s.name ? s.name.replace(/\b\w/g, c => c.toUpperCase()) : "the building"}{s.town ? ` in ${s.town}` : ""}</div>
          {named.map(t => <TitleBlock key={t.titleNumber} propertyId={propertyId} title={t} ownerName={ownerName} storedTitle={storedTitle} onDone={onDone} />)}
        </div>
      )}
      {street.length > 0 && (
        <div className="space-y-2">
          <button type="button" className="text-xs underline decoration-dotted underline-offset-2 text-muted-foreground hover:text-foreground" onClick={() => setShowStreet(v => !v)} data-testid="ownership-street-freeholds">
            {showStreet ? "Hide" : "Show"} {street.length} freehold{street.length === 1 ? "" : "s"} on {s.street}
          </button>
          {showStreet && street.map(t => <TitleBlock key={t.titleNumber} propertyId={propertyId} title={t} ownerName={ownerName} storedTitle={storedTitle} onDone={onDone} />)}
        </div>
      )}
      {!named.length && !street.length && (
        <div className="text-xs text-muted-foreground">
          {s.name || s.street ? `Nothing at Land Registry names ${[s.name ? s.name.replace(/\b\w/g, c => c.toUpperCase()) : "", s.street || ""].filter(Boolean).join(" or ")}${s.town ? ` in ${s.town}` : ""} as a freehold.` : "The building's name and street are too general to search for."}
          {" "}A freehold owned by a person is not in Land Registry's company lists.
        </div>
      )}
      {/* No <form>: the card also sits inside the new property set-up dialog. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Have the freehold's title number? It is on the long lease's register.</span>
        <Input value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && typed.trim()) { e.preventDefault(); look.mutate(typed.trim()); } }}
          placeholder="WM123456" className="h-7 w-32 text-xs" data-testid="ownership-title-lookup-input" />
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={!typed.trim() || look.isPending} onClick={() => look.mutate(typed.trim())} data-testid="ownership-title-lookup">
          {look.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Search className="w-3.5 h-3.5 mr-1" />}Look it up
        </Button>
      </div>
      {result && result.typedNumber && (
        result.typed
          ? <TitleBlock propertyId={propertyId} title={result.typed} ownerName={ownerName} storedTitle={storedTitle} onDone={v => { look.reset(); onDone(v); }} />
          : <div className="text-xs text-muted-foreground" data-testid="ownership-title-lookup-none">Title {result.typedNumber} is not in Land Registry's company lists: its owner may be a person, or the lists are out of date.</div>
      )}
    </div>
  );
}

function TransactionsAml({ propertyId, onOpenAml }: { propertyId: string; onOpenAml: (deal: AmlDialogDeal) => void }) {
  const { data, isLoading, isError } = useQuery<{ rows: AmlDashboardRow[] }>({
    queryKey: ["/api/aml-dashboard", { propertyId }],
    queryFn: async () => (await apiRequest("GET", `/api/aml-dashboard?propertyId=${encodeURIComponent(propertyId)}`)).json(),
  });
  // One line per transaction, its parties inside it: the AML page's own grouping (24 November 2026).
  const transactions = groupAmlByTransaction(data?.rows || []);
  return (
    <div className="space-y-1.5" data-testid="ownership-transactions-aml">
      <div className={sectionHead}>AML on transactions here</div>
      {isLoading ? <div className="text-xs text-muted-foreground">Reading…</div>
        : isError ? <div className="text-xs text-muted-foreground">The transactions' AML could not be read.</div>
        : transactions.length === 0 ? <div className="text-xs text-muted-foreground">No open transactions. When an instruction comes in, its AML starts on the transaction, with the owner set up here offered as the contracting entity.</div>
        : transactions.map(({ parties: rows }) => {
          const first = rows[0];
          return (
            <div key={first.dealId} className="flex flex-wrap items-start gap-2 rounded-md border border-border px-3 py-2 text-xs">
              <div className="min-w-0 flex-1 space-y-0.5">
                <Link href={`/deals/${first.dealId}?section=parties`} className="font-semibold hover:underline">{first.dealRef != null ? `#${first.dealRef} ` : ""}{first.dealName}</Link>
                {/* The company being checked first, then the shared chips: every AML screen's look (24 November 2026). */}
                {rows.map(r => (
                  <div key={r.key} className="flex flex-wrap items-center gap-1.5" data-testid={`ownership-aml-row-${r.key}`}>
                    <span className="text-foreground">{r.signsAs || r.brandName}</span>
                    <span className="text-muted-foreground">· <span className="capitalize">{r.role}</span>{r.signsAs ? ` · ${r.brandName}` : ""}</span>
                    <AmlStageChip stage={r.stage} expiresAt={r.expiresAt} />
                    {r.late && <AmlLateChip deadline={r.deadline} />}
                    <RedFlagChip count={r.redFlags.length} />
                  </div>
                ))}
              </div>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => onOpenAml({ id: first.dealId, name: first.dealName, dealRef: first.dealRef, status: first.dealStatus })} data-testid={`ownership-open-aml-${first.dealId}`}>
                <ShieldCheck className="w-3.5 h-3.5 mr-1" />Open AML
              </Button>
            </div>
          );
        })}
    </div>
  );
}

export function PropertyOwnershipCard({ propertyId, onOpenAml, showAml = true }: { propertyId: string; onOpenAml: (deal: AmlDialogDeal) => void; showAml?: boolean }) {
  const [showNearby, setShowNearby] = useState(false);
  const [showUnits, setShowUnits] = useState(false);
  const key = ["/api/properties", propertyId, "ownership"];
  const { data, isLoading, isError } = useQuery<PropertyOwnershipView>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/properties/${propertyId}/ownership`)).json(),
  });
  const done = (view: PropertyOwnershipView | null) => {
    if (view) queryClient.setQueryData(key, view);
    else queryClient.invalidateQueries({ queryKey: key });
    // The pills at the top and the owner's compliance card follow.
    queryClient.invalidateQueries({ queryKey: ["/api/crm/properties", propertyId] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
    queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
  };
  const ownerName = data?.owner?.name || null;
  const lrLink = data?.property.postcode ? `/land-registry?postcode=${encodeURIComponent(data.property.postcode)}` : "/land-registry";
  return (
    <Card className="p-3 space-y-3" data-testid="property-ownership-card">
      <div className="flex items-center gap-2">
        <Landmark className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold flex-1">Ownership</h3>
        <Link href={lrLink} className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground" data-testid="ownership-land-registry-link">Land Registry search</Link>
      </div>
      {isLoading ? <div className="text-xs text-muted-foreground">Reading Land Registry…</div>
        : isError || !data ? <div className="text-xs text-muted-foreground">The building's ownership could not be read.</div>
        : (
          <>
            <div className="space-y-2">
              <div className={sectionHead}>Registered owner at Land Registry</div>
              {!data.landRegistry.available ? (
                <div className="text-xs text-muted-foreground">Land Registry's company ownership lists are not loaded on this server.</div>
              ) : !data.property.postcode && !data.stored?.titleNumber ? (
                <div className="text-xs text-muted-foreground">Add the building's postcode to look it up.</div>
              ) : data.titles.length === 0 ? (
                <div className="text-xs text-muted-foreground">Nothing at Land Registry names {data.property.number && data.property.street ? `${data.property.number} ${data.property.street}` : "this building"}{data.property.postcode ? ` in ${data.property.postcode}` : ""}. Land Registry's lists hold company owners only: a building owned by a person is not in them.</div>
              ) : (
                <div className="space-y-2">{data.titles.map(t => <TitleBlock key={t.titleNumber} propertyId={propertyId} title={t} ownerName={ownerName} storedTitle={data.stored?.titleNumber || null} onDone={done} />)}</div>
              )}
              {data.freeholds && <FreeholdSearch propertyId={propertyId} data={data} ownerName={ownerName} onDone={done} />}
              {data.unitLeases.length > 0 && (
                <div className="space-y-1">
                  <button type="button" className="text-xs underline decoration-dotted underline-offset-2 text-muted-foreground hover:text-foreground" onClick={() => setShowUnits(s => !s)} data-testid="ownership-unit-leases">
                    {showUnits ? "Hide" : "Show"} {data.unitLeases.length} lease{data.unitLeases.length === 1 ? "" : "s"} of units here
                  </button>
                  {showUnits && <div className="rounded-md border border-border px-3 py-1.5">{data.unitLeases.map(t => <UnitLeaseLine key={t.titleNumber} title={t} />)}</div>}
                </div>
              )}
              {data.postcodeTitles.length > 0 && (
                <div className="space-y-2">
                  <button type="button" className="text-xs underline decoration-dotted underline-offset-2 text-muted-foreground hover:text-foreground" onClick={() => setShowNearby(s => !s)} data-testid="ownership-postcode-titles">
                    {showNearby ? "Hide" : "Show"} {data.postcodeTitles.length} title{data.postcodeTitles.length === 1 ? "" : "s"} in {data.property.postcode}
                  </button>
                  {showNearby && data.postcodeTitles.map(t => <TitleBlock key={t.titleNumber} propertyId={propertyId} title={t} ownerName={ownerName} storedTitle={data.stored?.titleNumber || null} onDone={done} />)}
                </div>
              )}
              {data.landRegistry.available && (data.landRegistry.loadedOn || data.landRegistry.refreshFailed) && (
                <div className="text-[11px] text-muted-foreground">
                  {data.landRegistry.loadedOn ? `Land Registry's lists as loaded ${day(data.landRegistry.loadedOn)}.` : ""}
                  {data.landRegistry.refreshFailed ? ` The monthly update has not loaded since ${day(data.landRegistry.refreshFailed)}: check the title before relying on it.` : ""}
                </div>
              )}
            </div>
            {showAml && <TransactionsAml propertyId={propertyId} onOpenAml={onOpenAml} />}
          </>
        )}
    </Card>
  );
}
