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
import { Landmark, Loader2, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { titleUseWords, type OwnershipChecks, type PropertyOwnershipView, type ProprietorView, type TitleView } from "@shared/property-ownership";
import { AML_STAGE_LABEL, type AmlDashboardRow } from "@shared/aml-dashboard";
import type { AmlDialogDeal } from "@/components/deal-aml-dialog";

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1");
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "");
const money = (v: string | null) => {
  const n = Number(String(v || "").replace(/[^\d.]/g, ""));
  return n > 0 ? `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : null;
};
const sectionHead = "text-[11px] uppercase tracking-wider text-muted-foreground";

function ChecksLine({ checks, onRun, running }: { checks: OwnershipChecks; onRun: (again: boolean) => void; running: boolean }) {
  const [open, setOpen] = useState(false);
  const busy = running || checks.running;
  const summary = checks.running ? "Being checked now"
    : !checks.ranAt ? "BGP's checks not run"
    : checks.unfinished ? `Checked ${day(checks.ranAt)}: not finished (${checks.unfinished})`
    : `Checked ${day(checks.ranAt)} · ${checks.sanctions === "possible" ? "possible sanctions match" : checks.sanctions === "clear" ? "sanctions clear" : "sanctions not screened"} · ${checks.redFlags.length ? `${checks.redFlags.length} red flag${checks.redFlags.length === 1 ? "" : "s"}` : "no red flags"}`;
  const warn = checks.sanctions === "possible" || checks.redFlags.length > 0;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={warn ? "text-red-700 dark:text-red-400" : "text-muted-foreground"} data-testid="ownership-checks-summary">{summary}</span>
        {checks.lines.length > 0 && <button type="button" className="text-xs underline decoration-dotted underline-offset-2 text-muted-foreground hover:text-foreground" onClick={() => setOpen(o => !o)}>{open ? "Hide" : "Show"}</button>}
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => onRun(!!checks.ranAt)} data-testid="ownership-run-checks">
          {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 mr-1" />}{checks.ranAt ? "Run again" : "Run checks"}
        </Button>
      </div>
      {open && (
        <ul className="space-y-0.5 text-xs" data-testid="ownership-checks-lines">
          {checks.redFlags.map(f => <li key={`flag-${f}`} className="text-red-700 dark:text-red-400">Red flag: {f}</li>)}
          {checks.lines.map((l, i) => (
            <li key={i} className={l.state === "attention" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>
              {l.label}{l.detail ? `: ${l.detail}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OwnerLine({ propertyId, title, owner, ownerName, storedTitle, onDone }: { propertyId: string; title: TitleView; owner: ProprietorView; ownerName: string | null; storedTitle: string | null; onDone: (view: PropertyOwnershipView | null) => void }) {
  const { toast } = useToast();
  const use = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/properties/${propertyId}/ownership/use`, { titleNumber: title.titleNumber, dataset: owner.dataset, position: owner.position })).json(),
    onSuccess: (r: any) => { toast({ title: "Set up from Land Registry", description: r?.message || undefined }); onDone(r?.view || null); },
    onError: (e) => toast({ title: "Not set up", description: plain(e), variant: "destructive" }),
  });
  const check = useMutation({
    mutationFn: async (again: boolean) => (await apiRequest("POST", `/api/properties/${propertyId}/ownership/check`, { entityId: owner.filed?.entityId, again })).json(),
    onSuccess: (r: any) => { toast({ title: r?.message || "Checking" }); onDone(null); },
    onError: (e) => toast({ title: "Not checked", description: plain(e), variant: "destructive" }),
  });
  const where = owner.number ? owner.number : owner.country ? `registered in ${owner.country.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}` : null;
  return (
    <div className="space-y-1.5 py-1.5" data-testid={`ownership-owner-${title.titleNumber}-${owner.dataset}-${owner.position}`}>
      <div className="text-sm min-w-0">
        <span className="font-semibold">{owner.name}</span>
        {where && <span className="text-muted-foreground"> · {where}</span>}
      </div>
      {owner.filed ? (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Filed under {ownerName || "the owner"} for the AML{owner.kyc ? ` · ${owner.kyc.words}` : ""}</div>
          {owner.checks && <ChecksLine checks={owner.checks} running={check.isPending} onRun={again => check.mutate(again)} />}
        </div>
      ) : owner.elsewhere ? (
        <div className="text-xs text-muted-foreground">Filed under <Link href={`/companies/${owner.elsewhere.under.id}`} className="underline decoration-dotted underline-offset-2 hover:text-foreground">{owner.elsewhere.under.name}</Link> in the CRM</div>
      ) : null}
      {owner.use && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" className="h-7 text-xs" disabled={use.isPending} onClick={() => use.mutate()} data-testid="ownership-use-owner">
            {use.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}{owner.use.kind === "long_leaseholder" ? "Set as long leaseholder" : title.onRecord ? "Set it up" : "Use this owner"}
          </Button>
          <span className="text-xs text-muted-foreground min-w-0">{titleUseWords(owner.use, { titleNumber: title.titleNumber, ownerName, proprietorName: owner.name, crmName: owner.crm?.name || null, storedTitle })}</span>
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

function TransactionsAml({ propertyId, onOpenAml }: { propertyId: string; onOpenAml: (deal: AmlDialogDeal) => void }) {
  const { data, isLoading, isError } = useQuery<{ rows: AmlDashboardRow[] }>({
    queryKey: ["/api/aml-dashboard", { propertyId }],
    queryFn: async () => (await apiRequest("GET", `/api/aml-dashboard?propertyId=${encodeURIComponent(propertyId)}`)).json(),
  });
  const byDeal = new Map<string, AmlDashboardRow[]>();
  for (const r of data?.rows || []) byDeal.set(r.dealId, [...(byDeal.get(r.dealId) || []), r]);
  return (
    <div className="space-y-1.5" data-testid="ownership-transactions-aml">
      <div className={sectionHead}>AML on transactions here</div>
      {isLoading ? <div className="text-xs text-muted-foreground">Reading…</div>
        : isError ? <div className="text-xs text-muted-foreground">The transactions' AML could not be read.</div>
        : byDeal.size === 0 ? <div className="text-xs text-muted-foreground">No open transactions. When an instruction comes in, its AML starts on the transaction, with the owner set up here offered as the company that signs.</div>
        : [...byDeal.values()].map(rows => {
          const first = rows[0];
          return (
            <div key={first.dealId} className="flex flex-wrap items-start gap-2 rounded-md border border-border px-3 py-2 text-xs">
              <div className="min-w-0 flex-1 space-y-0.5">
                <Link href={`/deals/${first.dealId}?section=parties`} className="font-semibold hover:underline">{first.dealRef != null ? `#${first.dealRef} ` : ""}{first.dealName}</Link>
                {rows.map(r => (
                  <div key={r.key} className="text-muted-foreground">
                    <span className="capitalize">{r.role}</span> {r.brandName}{r.signsAs ? ` (${r.signsAs})` : ""}: <span className={r.late ? "text-red-700 dark:text-red-400" : r.stage === "approved" ? "text-emerald-700 dark:text-emerald-400" : "text-foreground"}>{AML_STAGE_LABEL[r.stage] || r.stage}{r.late ? " · late" : ""}</span>
                    {r.redFlags.length > 0 && <span className="text-red-700 dark:text-red-400"> · {r.redFlags.length} red flag{r.redFlags.length === 1 ? "" : "s"}</span>}
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
  const key = ["/api/properties", propertyId, "ownership"];
  const { data, isLoading, isError } = useQuery<PropertyOwnershipView>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/properties/${propertyId}/ownership`)).json(),
    // Reads again while BGP's checks run, then stops.
    refetchInterval: (q) => ((q.state.data as PropertyOwnershipView | undefined)?.titles || []).some(t => t.proprietors.some(p => p.checks?.running)) ? 5000 : false,
  });
  const done = (view: PropertyOwnershipView | null) => {
    if (view) queryClient.setQueryData(key, view);
    else queryClient.invalidateQueries({ queryKey: key });
    // The pills at the top and the owner's compliance card follow.
    queryClient.invalidateQueries({ queryKey: ["/api/crm/properties", propertyId] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
    queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
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
