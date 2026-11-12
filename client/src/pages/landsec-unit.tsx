// The single Landsec unit page (docs/landsec-pitch-plan.md, item 2):
// everything on Victoria's list in one place — availability, ERV and target
// rent, incentives, target brands, plans, square footage by level, marketing
// details, leasing plan, heads of terms, who to report to, who checks heads,
// solicitors' details and legal progress. Reads one endpoint; each editable
// field saves to the table that owns it through PUT /api/landsec/unit/:id.
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Clock, FileText, Image as ImageIcon, Map, Pencil, Check, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";
import { DEAL_STATUS_LABELS, type DealStatusCode } from "@shared/deal-status";
import { StatusPill } from "./landsec-scheme";
import { LANDSEC_BRIEF_CATEGORIES, LANDSEC_WAITING_PARTIES, briefStatus, type LandsecAgreedBrief, type LandsecBriefSigner, type LandsecDealClock, type LandsecNer } from "@shared/landsec";
import { BriefCheck } from "./landsec-deals";
import { UnitBriefDialog } from "@/components/unit-brief-dialog";
import { BriefChip } from "@/components/unit-brief/brief-chip";

interface Contact { id: string; name: string; role: string | null; email: string | null; phone: string | null }
interface UnitData {
  unit: {
    id: string; propertyId: string; propertyName: string; schemeKey: string | null; schemeName: string;
    grouping: string | null; unit: string | null; floor: string | null; status: string | null; vacant: boolean;
    tenant: string | null; tradingName: string | null; use: string | null; tenantMix: string | null;
    leaseStart: string | null; leaseExpiry: string | null; breakDate: string | null; breakDetails: string | null; nextReviewDate: string | null; termYears: number | null; outsideLtAct: string | null;
    areas: Record<string, number | null>;
    passingRent: number | null; marketingRent: number | null; erv: number | null; ervProfile: string | null; rentPsf: number | null;
    rentFreeValue: number | null; capexValue: number | null; rateableValue: number | null; ratesPayable: number | null; serviceCharge: number | null;
    targetTenants: string | null; leasingComments: string | null; comments: string | null; epcRating: string | null;
    marketingActive: boolean; marketingReason: string | null;
  };
  leasing: { id: string; targetBrands: string | null; optimumTarget: string | null; priority: string | null; status: string | null; updates: string | null; positioning: string | null; zone: string | null; matPsqft: number | null; lflPercent: number | null; occCostPercent: number | null } | null;
  tracker: {
    id: string; marketingStatus: string | null; askingRent: number | null; rentPoa: boolean; leaseTerms: string | null; availableDate: string | null;
    showOnWebsite: boolean; marketingStartDate: string | null; viewingsCount: number | null; lastViewingDate: string | null; notes: string | null; restrictions: string | null;
    hotsContent: string | null; hotsUpdatedAt: string | null;
    files: { id: string; name: string; category: string; mimeType: string | null; url: string; createdAt: string }[];
    viewings: { id: string; company_name: string | null; contact_name: string | null; viewing_date: string; viewing_time: string | null; outcome: string | null; status: string | null }[];
    offers: { id: string; company_name: string | null; offer_date: string; rent_pa: number | null; rent_free_months: number | null; term_years: number | null; break_option: string | null; incentives: string | null; premium: number | null; fitting_out_contribution: number | null; status: string | null; ner: LandsecNer | null; briefCheck: "pass" | "fail" | null }[];
  } | null;
  brief: { id: string; title: string | null; objective: string | null; targetCriteria: string | null; priorityCategories: string | null; agentInstruction: string | null; status: string | null; instructedDate: string | null; signoff: { total: number; agreed: number } | null; agreedAt: string | null; targets: { id: string; operator_name: string; category: string | null; priority: string | null; status: string | null; feedback: string | null }[] } | null;
  deal: {
    id: string; ref: number | null; name: string; status: string | null; code: DealStatusCode | null; live: boolean; stage: string | null; stageEnteredAt: string | null; days: number | null;
    dealType: string | null; tenant: string | null; instructedAt: string | null; targetDate: string | null; exchangedAt: string | null; completedAt: string | null; updatedAt: string | null;
    terms: { rentPa: number | null; rentFree: number | null; capitalContribution: number | null; leaseLength: string | null; breakOption: string | null; breakParty: string | null };
    solicitors: { firm: string | null; contact: string | null; instructedAt: string | null; draftLeaseReceivedAt: string | null; commentsReturnedAt: string | null; engrossmentAt: string | null; notes: string | null };
    comments: string | null; jointAgent: string | null; fee?: number | null; agents?: string[] | null;
    ner: LandsecNer | null; briefCheck: "pass" | "fail" | null; clock: LandsecDealClock | null;
  } | null;
  schemeLiveDeals: { id: string; ref: number | null; name: string; unit: string | null }[];
  people: { bgp: { id: string; name: string; email: string; role: string | null }[]; landsec: Contact[] };
  plans: { id: string; floor: string; source: string | null; notes: string | null }[];
  landsec: {
    reportToContactId: string | null; reportToName: string | null; hotsCheckerContactId: string | null; hotsCheckerName: string | null;
    incentives: string | null; leasingPlan: string | null; marketingDetails: string | null; legalProgress: string | null;
    solicitorCatchups: { at: string; note: string; byName: string | null }[]; updatedAt: string | null; updatedByName: string | null;
  } | null;
  agreedBrief: LandsecAgreedBrief | null;
  viewer: { isClient: boolean; role?: string };
}

const fmtDate = (d: string | null | undefined, withDay = false) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-GB", withDay ? { day: "numeric", month: "short", year: "numeric" } : { month: "short", year: "numeric" });
};
const fmtSqft = (n: number | null | undefined) => (n ? `${Math.round(n).toLocaleString("en-GB")} sq ft` : "—");
const toInputDate = (d: string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export default function LandsecUnit() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryKey = [`/api/landsec/unit/${id}`];
  const { data, isLoading, error } = useQuery<UnitData>({ queryKey, staleTime: 30 * 1000 });

  const save = useMutation({
    mutationFn: async (body: Record<string, any>) => {
      const res = await apiRequest("PUT", `/api/landsec/unit/${id}`, body);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: any) => toast({ title: "Not saved", description: e?.message, variant: "destructive" }),
  });
  const saveLandsec = (patch: Record<string, any>) => save.mutate({ landsec: patch });
  const saveClock = useMutation({
    mutationFn: async (body: Record<string, any>) => {
      const res = await apiRequest("PUT", `/api/landsec/deal/${deal!.id}/clock`, body);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); queryClient.invalidateQueries({ queryKey: ["/api/landsec/deals"] }); },
    onError: (e: any) => toast({ title: "Not saved", description: e?.message, variant: "destructive" }),
  });
  // The Targeting Brief (the same dialog as the Letting Tracker): opens on
  // the unit's tracker row; a unit not yet on the tracker is added with its
  // brief in one step.
  const [briefOpen, setBriefOpen] = useState(false);
  const [startedTrackerId, setStartedTrackerId] = useState<string | null>(null);
  const startBrief = useMutation({
    mutationFn: async (body: { propertyId: string; unitName: string }) => (await apiRequest("POST", "/api/unit-briefs/start", body)).json(),
    onSuccess: (r: any) => { setStartedTrackerId(r?.unit?.id || null); queryClient.invalidateQueries({ queryKey }); setBriefOpen(true); },
    onError: (e: any) => toast({ title: "The brief could not be started", description: e?.message, variant: "destructive" }),
  });
  const sign = useMutation({
    mutationFn: async (body: { role: LandsecBriefSigner; withdraw?: boolean }) => {
      const res = await apiRequest("POST", `/api/landsec/unit/${id}/brief/sign`, body);
      return res.json();
    },
    onSuccess: (r: any, v) => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: v.withdraw ? "Signature withdrawn" : "Brief signed", description: v.withdraw ? undefined : (briefStatus(r?.agreedBrief) === "agreed" ? "Both signatures are on the brief — marketing can start." : "Waiting for the other signature.") });
    },
    onError: (e: any) => toast({ title: "Not signed", description: e?.message, variant: "destructive" }),
  });

  if (error) return <div className="p-4 md:p-6"><p className="text-sm text-muted-foreground">This unit could not be opened. {(error as any)?.message || ""}</p></div>;
  if (isLoading || !data) return <div className="p-4 md:p-6 space-y-3"><Skeleton className="h-10 w-80" /><Skeleton className="h-64 rounded-lg" /></div>;

  const { unit, leasing, tracker, brief, deal, people, plans, landsec, viewer, agreedBrief, schemeLiveDeals } = data;
  const trackerId = tracker?.id || startedTrackerId;
  const bStatus = briefStatus(agreedBrief);
  const marketingWithoutBrief = bStatus !== "agreed" && (!!tracker || unit.marketingActive || unit.vacant);
  const a = unit.areas;
  const levels = [
    { label: "Basement", gia: a.basementGia, nia: a.basementNia },
    { label: "Ground", gia: a.groundGia, nia: a.groundNia, itza: a.groundItza },
    { label: "First", gia: a.firstGia, nia: a.firstNia },
    { label: "Other", gia: a.otherGia, nia: a.otherNia },
  ].filter(l => l.gia || l.nia || (l as any).itza);
  const targetRent = tracker?.askingRent ?? unit.marketingRent ?? null;
  const hotsFiles = tracker?.files.filter(f => /hots|heads/i.test(f.category) || /hots|heads of terms/i.test(f.name)) || [];
  const otherFiles = tracker?.files.filter(f => !hotsFiles.includes(f)) || [];
  const stageLabel = deal?.code ? DEAL_STATUS_LABELS[deal.code] : deal?.status || null;

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="landsec-unit">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            <Link href="/" className="hover:text-foreground">Landsec portfolio</Link> › {unit.schemeKey ? <Link href={`/landsec/scheme/${unit.schemeKey}`} className="hover:text-foreground">{unit.schemeName}</Link> : unit.schemeName}
          </p>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 flex-wrap">
            {unit.unit || "Unit"} <StatusPill status={unit.status} vacant={unit.vacant} />
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {[unit.grouping, unit.floor, unit.tenant ? `Let to ${unit.tenant}` : unit.vacant ? "Available" : null, unit.use].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {deal && (
            <Link href={`/deals/${deal.id}`}>
              <Button variant="outline" size="sm">Deal{deal.ref ? ` #${deal.ref}` : ""}</Button>
            </Link>
          )}
          <Link href={`/properties/${unit.propertyId}`}><Button variant="outline" size="sm">Property record</Button></Link>
        </div>
      </div>

      {deal && (
        <div className="rounded-lg border px-3 py-2 space-y-1.5" data-testid="landsec-unit-deal-clock">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="rounded-full bg-foreground text-background px-2 py-px text-[10px] font-semibold uppercase tracking-wide">{stageLabel}</span>
            <span className="font-medium">{deal.tenant || deal.name}</span>
            {deal.days !== null && <span className="flex items-center gap-1 text-muted-foreground tabular-nums"><Clock className="w-3.5 h-3.5" /> {deal.days} days at this stage</span>}
            {deal.ner && <span className="tabular-nums" title={`${formatCurrency(deal.ner.headlinePa)} headline · ${deal.ner.termCertainYears} yr term certain${deal.ner.assumedTerm ? " (assumed)" : ""} · ${deal.ner.rentFreeMonths} mo rent free · ${formatCurrency(deal.ner.capital)} capital`}>NER {formatCurrency(deal.ner.nerPa)} pa</span>}
            {(deal.briefCheck || bStatus !== "empty") && <BriefCheck brief={bStatus === "agreed" ? "agreed" : bStatus === "empty" ? null : "drafted"} check={deal.briefCheck} />}
            {deal.jointAgent && <span className="text-muted-foreground">Joint agent: {deal.jointAgent}</span>}
          </div>
          <WaitingOn clock={deal.clock} schemeDeals={schemeLiveDeals.filter(d => d.id !== deal.id)} onSave={patch => saveClock.mutate(patch)} saving={saveClock.isPending} />
        </div>
      )}

      <div className="rounded-lg border px-3 py-2 flex flex-wrap items-center justify-between gap-2" data-testid="landsec-unit-targeting-brief">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Targeting brief</h2>
          {trackerId
            ? <BriefChip brief={brief ? { id: brief.id, signoff: brief.signoff, agreedAt: brief.agreedAt } : null} onClick={() => setBriefOpen(true)} testId="landsec-unit-brief-chip" />
            : <span className="text-xs text-muted-foreground">This unit is not on the letting tracker yet.</span>}
          <span className="text-xs text-muted-foreground">The brief, commercials, who is involved, plans and files, comments and sign-off.</span>
        </div>
        {trackerId
          ? <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setBriefOpen(true)} data-testid="landsec-unit-open-brief">{brief ? "Open the brief" : "Start the brief"}</Button>
          : viewer.role !== "joint_agent" && unit.unit
            ? <Button variant="outline" size="sm" className="h-7 text-xs" disabled={startBrief.isPending} onClick={() => startBrief.mutate({ propertyId: unit.propertyId, unitName: unit.unit! })} data-testid="landsec-unit-add-brief">Add to the tracker and start the brief</Button>
            : null}
      </div>
      <UnitBriefDialog
        unit={trackerId ? { id: trackerId, unitName: unit.unit || "Unit", propertyId: unit.propertyId } : null}
        open={briefOpen && !!trackerId}
        onClose={() => { setBriefOpen(false); queryClient.invalidateQueries({ queryKey }); }}
      />

      <AgreedBriefCard
        brief={agreedBrief}
        status={bStatus}
        warn={marketingWithoutBrief}
        fallbackTargetBrands={leasing?.targetBrands ?? unit.targetTenants ?? null}
        fallbackUse={unit.use}
        onSave={patch => save.mutate({ agreedBrief: patch })}
        onSign={(role, withdraw) => sign.mutate({ role, withdraw })}
        signing={sign.isPending}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Availability">
          <Row label="Status" value={unit.status || "—"} />
          <Row label="Available from" value={tracker?.availableDate || (unit.vacant ? "Now" : "—")} />
          <Row label="Marketing" value={tracker ? `${tracker.marketingStatus || "On tracker"}${tracker.showOnWebsite ? " · on website" : ""}${tracker.marketingStartDate ? ` since ${tracker.marketingStartDate}` : ""}` : unit.marketingActive ? "Active" : "Not marketed"} />
          {unit.tenant && <Row label="Tenant" value={`${unit.tenant}${unit.tradingName && unit.tradingName !== unit.tenant ? ` (${unit.tradingName})` : ""}`} />}
          <Row label="Lease" value={unit.leaseExpiry ? `Expires ${fmtDate(unit.leaseExpiry)}${unit.breakDate ? ` · break ${fmtDate(unit.breakDate)}` : ""}${unit.nextReviewDate ? ` · review ${fmtDate(unit.nextReviewDate)}` : ""}` : "—"} />
          {unit.breakDetails && <Row label="Break terms" value={unit.breakDetails} />}
          <Row label="Use" value={unit.use || "—"} />
          {unit.epcRating && <Row label="EPC" value={unit.epcRating} />}
        </Section>

        <Section title="Rent">
          <Row label="Passing rent" value={unit.passingRent ? `${formatCurrency(unit.passingRent)} pa${unit.rentPsf ? ` · £${Math.round(unit.rentPsf)} psf` : ""}` : "—"} />
          <EditRow label="ERV" value={unit.erv} kind="money" onSave={v => save.mutate({ erv: v })} />
          <EditRow label="Target rent" value={targetRent} kind="money" hint={tracker ? undefined : "Put the unit on the letting tracker to set a target rent"} onSave={tracker ? v => save.mutate({ askingRent: v }) : undefined} />
          <EditRow label="Incentives" value={landsec?.incentives ?? null} kind="text" placeholder="e.g. up to 12 months rent free, no capital contribution" onSave={v => saveLandsec({ incentives: v })} />
          <EditRow label="Lease terms" value={tracker?.leaseTerms ?? null} kind="text" onSave={tracker ? v => save.mutate({ leaseTerms: v }) : undefined} />
          {(unit.rateableValue || unit.serviceCharge) && <Row label="Occupancy" value={[unit.rateableValue ? `RV ${formatCurrency(unit.rateableValue)}` : null, unit.ratesPayable ? `rates ${formatCurrency(unit.ratesPayable)}` : null, unit.serviceCharge ? `SC ${formatCurrency(unit.serviceCharge)}` : null].filter(Boolean).join(" · ")} />}
          {leasing && (leasing.matPsqft || leasing.occCostPercent) && <Row label="Trading" value={[leasing.matPsqft ? `MAT £${Math.round(leasing.matPsqft)} psf` : null, leasing.lflPercent != null ? `LfL ${leasing.lflPercent}%` : null, leasing.occCostPercent != null ? `occ. cost ${leasing.occCostPercent}%` : null].filter(Boolean).join(" · ")} />}
        </Section>

        <Section title="Target brands">
          <EditRow label="Target brands" value={leasing?.targetBrands ?? unit.targetTenants ?? null} kind="textarea" onSave={v => save.mutate(leasing ? { targetBrands: v, targetTenants: v } : { targetTenants: v })} />
          {leasing?.optimumTarget && <Row label="Optimum target" value={leasing.optimumTarget} />}
          {leasing?.priority && <Row label="Priority" value={leasing.priority} />}
          {brief && (
            <div className="pt-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Brief{brief.title ? ` · ${brief.title}` : ""}{brief.status ? ` · ${brief.status}` : ""}</p>
              {brief.priorityCategories && <p className="text-sm">{brief.priorityCategories}</p>}
              {brief.targets.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-1">
                  {brief.targets.map(t => (
                    <li key={t.id} className="rounded-full border px-2 py-px text-xs">{t.operator_name}{t.priority ? ` · ${t.priority}` : ""}{t.status ? ` · ${t.status}` : ""}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Section>

        <Section title="Space">
          {levels.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="text-left font-medium py-1">Level</th><th className="text-right font-medium py-1">GIA</th><th className="text-right font-medium py-1">NIA</th><th className="text-right font-medium py-1">ITZA</th></tr></thead>
              <tbody>
                {levels.map(l => (
                  <tr key={l.label} className="border-t"><td className="py-1">{l.label}</td><td className="py-1 text-right tabular-nums">{fmtSqft(l.gia)}</td><td className="py-1 text-right tabular-nums">{fmtSqft(l.nia)}</td><td className="py-1 text-right tabular-nums">{fmtSqft((l as any).itza)}</td></tr>
                ))}
                <tr className="border-t font-medium"><td className="py-1">Total</td><td className="py-1 text-right tabular-nums">{fmtSqft(a.giaSqft)}</td><td className="py-1 text-right tabular-nums">{fmtSqft(a.niaSqft)}</td><td className="py-1 text-right tabular-nums">{fmtSqft(a.itzaSqft)}</td></tr>
              </tbody>
            </table>
          ) : (
            <Row label="Area" value={[a.giaSqft ? `GIA ${fmtSqft(a.giaSqft)}` : null, a.niaSqft ? `NIA ${fmtSqft(a.niaSqft)}` : null, a.itzaSqft ? `ITZA ${fmtSqft(a.itzaSqft)}` : null].filter(Boolean).join(" · ") || "No areas recorded"} />
          )}
          <div className="pt-1 flex items-center gap-2 text-sm">
            <Map className="w-3.5 h-3.5 text-muted-foreground" />
            {plans.length > 0
              ? <Link href={`/properties/${unit.propertyId}`} className="hover:underline">{plans.length} plan{plans.length === 1 ? "" : "s"} on the property record ({plans.map(p => p.floor).join(", ")})</Link>
              : <span className="text-muted-foreground">No plans on the property record yet</span>}
          </div>
        </Section>

        <Section title="Marketing">
          <EditRow label="Marketing details" value={landsec?.marketingDetails ?? null} kind="textarea" placeholder="Brochure status, website listing, photography, signage, launch date" onSave={v => saveLandsec({ marketingDetails: v })} />
          {tracker && <Row label="Viewings" value={`${tracker.viewingsCount || tracker.viewings.length || 0}${tracker.lastViewingDate ? ` · last ${tracker.lastViewingDate}` : ""}`} />}
          {otherFiles.length > 0 && (
            <ul className="space-y-1 pt-1">
              {otherFiles.map(f => (
                <li key={f.id} className="flex items-center gap-2 text-sm">
                  {f.mimeType?.startsWith("image/") ? <ImageIcon className="w-3.5 h-3.5 text-muted-foreground" /> : <FileText className="w-3.5 h-3.5 text-muted-foreground" />}
                  <a href={f.url} target="_blank" rel="noreferrer" className="hover:underline truncate">{f.name}</a>
                  <span className="text-[11px] text-muted-foreground">{f.category}</span>
                </li>
              ))}
            </ul>
          )}
          {tracker?.restrictions && <Row label="Restrictions" value={tracker.restrictions} />}
        </Section>

        <Section title="Leasing plan">
          <EditRow label="Plan" value={landsec?.leasingPlan ?? null} kind="textarea" placeholder="The agreed route to a letting: use, timing, who is being approached and in what order" onSave={v => saveLandsec({ leasingPlan: v })} />
          {leasing?.updates && <Row label="Schedule updates" value={leasing.updates} />}
          {unit.leasingComments && <Row label="Leasing comments" value={unit.leasingComments} />}
        </Section>

        <Section title="Heads of terms">
          {deal ? (
            <>
              <Row label="Tenant" value={deal.tenant || deal.name} />
              <Row label="Rent" value={deal.terms.rentPa ? `${formatCurrency(deal.terms.rentPa)} pa` : "—"} />
              <Row label="Rent free" value={deal.terms.rentFree != null ? `${deal.terms.rentFree} months` : "—"} />
              <Row label="Capital contribution" value={deal.terms.capitalContribution ? formatCurrency(deal.terms.capitalContribution) : "—"} />
              <Row label="Term" value={[deal.terms.leaseLength, deal.terms.breakOption ? `break ${deal.terms.breakOption}${deal.terms.breakParty ? ` (${deal.terms.breakParty})` : ""}` : null].filter(Boolean).join(" · ") || "—"} />
              {!viewer.isClient && deal.fee != null && <Row label="Fee (BGP only)" value={formatCurrency(deal.fee)} />}
            </>
          ) : <p className="text-sm text-muted-foreground">No deal on this unit yet.</p>}
          {tracker?.hotsContent && <Row label="Draft heads" value={`On the tracker${tracker.hotsUpdatedAt ? `, updated ${fmtDate(tracker.hotsUpdatedAt, true)}` : ""}`} />}
          {hotsFiles.length > 0 && (
            <ul className="space-y-1 pt-1">
              {hotsFiles.map(f => (
                <li key={f.id} className="flex items-center gap-2 text-sm"><FileText className="w-3.5 h-3.5 text-muted-foreground" /><a href={f.url} target="_blank" rel="noreferrer" className="hover:underline truncate">{f.name}</a></li>
              ))}
            </ul>
          )}
          {tracker && tracker.offers.length > 0 && (
            <div className="pt-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Offers</p>
              <ul className="space-y-1">
                {tracker.offers.slice(0, 5).map(o => (
                  <li key={o.id} className="text-sm flex flex-wrap gap-x-2">
                    <span className="font-medium">{o.company_name || "—"}</span>
                    <span className="tabular-nums">{o.rent_pa ? `${formatCurrency(o.rent_pa)} pa` : ""}</span>
                    {o.ner && <span className="tabular-nums text-muted-foreground" title={`${o.ner.termCertainYears} yr term certain${o.ner.assumedTerm ? " (assumed)" : ""}`}>NER {formatCurrency(o.ner.nerPa)}</span>}
                    {o.briefCheck && <BriefCheck brief={null} check={o.briefCheck} />}
                    {o.rent_free_months != null && <span className="text-muted-foreground">{o.rent_free_months}m rent free</span>}
                    {o.term_years != null && <span className="text-muted-foreground">{o.term_years}y</span>}
                    <span className="text-muted-foreground">{o.status || ""} · {fmtDate(o.offer_date, true)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section title="People">
          <PersonRow label="Report to" contacts={people.landsec} contactId={landsec?.reportToContactId ?? null} name={landsec?.reportToName ?? null}
            onSave={(contactId, name) => saveLandsec({ reportToContactId: contactId, reportToName: name })} />
          <PersonRow label="Checks heads" contacts={people.landsec} contactId={landsec?.hotsCheckerContactId ?? null} name={landsec?.hotsCheckerName ?? null}
            onSave={(contactId, name) => saveLandsec({ hotsCheckerContactId: contactId, hotsCheckerName: name })} />
          {people.bgp.length > 0 && <Row label="BGP" value={people.bgp.map(p => `${p.name}${p.role ? ` (${p.role})` : ""}`).join(", ")} />}
          {deal?.jointAgent && <Row label="Joint agent" value={deal.jointAgent} />}
        </Section>

        <Section title="Solicitors & legal progress">
          {deal ? (
            <SolicitorBlock deal={deal} onSave={patch => save.mutate({ dealId: deal.id, solicitors: patch })} />
          ) : <p className="text-sm text-muted-foreground">Solicitors are recorded on the deal once there is one.</p>}
          <EditRow label="Legal progress" value={landsec?.legalProgress ?? null} kind="textarea" placeholder="Where the lease is: draft issued, comments returned, engrossments, completion target" onSave={v => saveLandsec({ legalProgress: v })} />
          <Catchups items={landsec?.solicitorCatchups || []} onAdd={note => saveLandsec({ addCatchup: { note } })} />
        </Section>
      </div>

      {landsec?.updatedAt && (
        <p className="text-[11px] text-muted-foreground">Landsec fields last updated {fmtDate(landsec.updatedAt, true)}{landsec.updatedByName ? ` by ${landsec.updatedByName}` : ""}.</p>
      )}
    </div>
  );
}

// The agreed brief: use and category, net effective rent floor, incentive
// ceiling, capex envelope and target brands, signed by the Landsec leasing
// manager and the asset manager before marketing starts. Editing the terms
// withdraws both signatures.
function AgreedBriefCard({ brief, status, warn, fallbackTargetBrands, fallbackUse, onSave, onSign, signing }: {
  brief: LandsecAgreedBrief | null; status: ReturnType<typeof briefStatus>; warn: boolean;
  fallbackTargetBrands: string | null; fallbackUse: string | null;
  onSave: (patch: Record<string, any>) => void; onSign: (role: LandsecBriefSigner, withdraw?: boolean) => void; signing: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const blank = { use: fallbackUse || "", category: "", nerFloor: "", incentiveCeiling: "", capexEnvelope: "", targetBrands: fallbackTargetBrands || "", notes: "" };
  const fromBrief = (b: LandsecAgreedBrief | null) => b ? { use: b.use || "", category: b.category || "", nerFloor: b.nerFloor == null ? "" : String(b.nerFloor), incentiveCeiling: b.incentiveCeiling || "", capexEnvelope: b.capexEnvelope == null ? "" : String(b.capexEnvelope), targetBrands: b.targetBrands || "", notes: b.notes || "" } : blank;
  const [form, setForm] = useState(fromBrief(brief));
  useEffect(() => { if (!editing) setForm(fromBrief(brief)); }, [brief, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  const label = status === "agreed" ? "Brief agreed" : status === "awaiting_am" ? "Awaiting asset manager" : status === "awaiting_leasing" ? "Awaiting leasing manager" : status === "unsigned" ? "Brief not yet signed" : "No brief yet";
  const tone = status === "agreed" ? "border-emerald-600/60 text-emerald-700 dark:text-emerald-400" : status === "empty" ? "border-border text-muted-foreground" : "border-amber-500/60 text-amber-700 dark:text-amber-400";

  return (
    <Card data-testid="landsec-unit-brief">
      <CardContent className="p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agreed brief</h2>
            <span className={`rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide ${tone}`} data-testid="landsec-unit-brief-status">{label}</span>
          </div>
          {!editing && <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)} data-testid="landsec-unit-brief-edit"><Pencil className="w-3 h-3 mr-1" /> {status === "empty" ? "Write the brief" : "Edit brief"}</Button>}
        </div>
        {warn && status !== "agreed" && (
          <p className="text-xs rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1.5">
            {status === "empty" ? "This unit is available or being marketed without a brief. Agree use, rent floor, incentives and targets before approaches start." : "Marketing is under way before both signatures are on the brief."}
          </p>
        )}
        {editing ? (
          <div className="space-y-1.5 text-sm">
            <div className="grid sm:grid-cols-2 gap-1.5">
              <label className="text-xs text-muted-foreground">Use<Input value={form.use} onChange={f("use")} placeholder="e.g. Restaurant, 120 covers, external seating" className="h-8 text-sm" /></label>
              <label className="text-xs text-muted-foreground">Category
                <select className="h-8 w-full rounded-md border bg-background px-2 text-sm" value={form.category} onChange={f("category")}>
                  <option value="">— choose —</option>
                  {LANDSEC_BRIEF_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">Net effective rent floor (£ pa)<Input value={form.nerFloor} onChange={f("nerFloor")} inputMode="numeric" placeholder="e.g. 95000" className="h-8 text-sm" /></label>
              <label className="text-xs text-muted-foreground">Capex envelope (£)<Input value={form.capexEnvelope} onChange={f("capexEnvelope")} inputMode="numeric" placeholder="e.g. 250000" className="h-8 text-sm" /></label>
            </div>
            <label className="text-xs text-muted-foreground block">Incentive ceiling<Input value={form.incentiveCeiling} onChange={f("incentiveCeiling")} placeholder="e.g. up to 12 months rent free, no capital contribution" className="h-8 text-sm" /></label>
            <label className="text-xs text-muted-foreground block">Target brands<Textarea value={form.targetBrands} onChange={f("targetBrands")} rows={2} className="text-sm" placeholder="Named operators to approach, in order" /></label>
            <label className="text-xs text-muted-foreground block">Notes<Textarea value={form.notes} onChange={f("notes")} rows={2} className="text-sm" placeholder="Anything else both sides have agreed" /></label>
            {status !== "empty" && status !== "unsigned" && <p className="text-xs text-muted-foreground">Saving a change withdraws the existing signatures; both sides sign again.</p>}
            <div className="flex gap-1 justify-end">
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" data-testid="landsec-unit-brief-save" onClick={() => { onSave({ use: form.use, category: form.category, nerFloor: form.nerFloor === "" ? null : Number(form.nerFloor.replace(/[£,\s]/g, "")), incentiveCeiling: form.incentiveCeiling, capexEnvelope: form.capexEnvelope === "" ? null : Number(form.capexEnvelope.replace(/[£,\s]/g, "")), targetBrands: form.targetBrands, notes: form.notes }); setEditing(false); }}>Save brief</Button>
            </div>
          </div>
        ) : brief && status !== "empty" ? (
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <Row label="Use" value={brief.use || "—"} />
            <Row label="Category" value={brief.category || "—"} />
            <Row label="NER floor" value={brief.nerFloor ? `${formatCurrency(brief.nerFloor)} pa` : "—"} />
            <Row label="Capex envelope" value={brief.capexEnvelope ? formatCurrency(brief.capexEnvelope) : "—"} />
            <Row label="Incentive ceiling" value={brief.incentiveCeiling || "—"} />
            <Row label="Target brands" value={brief.targetBrands || "—"} />
            {brief.notes && <div className="sm:col-span-2"><Row label="Notes" value={brief.notes} /></div>}
          </div>
        ) : null}
        {status !== "empty" && !editing && (
          <div className="grid sm:grid-cols-2 gap-1.5 pt-1">
            {(["leasing", "am"] as LandsecBriefSigner[]).map(role => {
              const sgn = role === "leasing" ? brief!.leasing : brief!.am;
              const who = role === "leasing" ? "Landsec leasing manager" : "Landsec asset manager";
              return (
                <div key={role} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{who}</p>
                    {sgn.at ? <p className="truncate">Signed by {sgn.by} · {fmtDate(sgn.at, true)}</p> : <p className="text-muted-foreground italic">Not signed</p>}
                  </div>
                  {sgn.at
                    ? <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" disabled={signing} onClick={() => onSign(role, true)}>Withdraw</Button>
                    : <Button size="sm" className="h-7 text-xs shrink-0" disabled={signing} onClick={() => onSign(role)} data-testid={`landsec-unit-brief-sign-${role}`}>Sign as {role === "am" ? "asset manager" : "leasing manager"}</Button>}
                </div>
              );
            })}
          </div>
        )}
        {brief?.updatedAt && !editing && <p className="text-[11px] text-muted-foreground">Brief last changed {fmtDate(brief.updatedAt, true)}{brief.updatedByName ? ` by ${brief.updatedByName}` : ""}.</p>}
      </CardContent>
    </Card>
  );
}

// Who the deal is waiting on, since when, and the deal it depends on.
function WaitingOn({ clock, schemeDeals, onSave, saving }: {
  clock: LandsecDealClock | null; schemeDeals: { id: string; ref: number | null; name: string; unit: string | null }[];
  onSave: (patch: Record<string, any>) => void; saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ party: clock?.waitingOnParty || "", name: clock?.waitingOnName || "", since: toInputDate(clock?.waitingSince), note: clock?.waitingNote || "", dependsOn: clock?.dependsOnDealId || "" });
  useEffect(() => { if (!editing) setForm({ party: clock?.waitingOnParty || "", name: clock?.waitingOnName || "", since: toInputDate(clock?.waitingSince), note: clock?.waitingNote || "", dependsOn: clock?.dependsOnDealId || "" }); }, [clock, editing]);
  const waitingDays = clock?.waitingSince ? Math.max(0, Math.floor((Date.now() - new Date(clock.waitingSince).getTime()) / 86400000)) : null;
  if (editing) {
    return (
      <div className="grid sm:grid-cols-2 gap-1.5 text-sm" data-testid="landsec-unit-waiting-form">
        <label className="text-xs text-muted-foreground">Waiting on
          <select className="h-8 w-full rounded-md border bg-background px-2 text-sm" value={form.party} onChange={e => setForm(p => ({ ...p, party: e.target.value }))}>
            <option value="">— no one / not waiting —</option>
            {LANDSEC_WAITING_PARTIES.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">Who (name)<Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. the asset manager's name" className="h-8 text-sm" /></label>
        <label className="text-xs text-muted-foreground">Since<Input type="date" value={form.since} onChange={e => setForm(p => ({ ...p, since: e.target.value }))} className="h-8 text-sm" /></label>
        <label className="text-xs text-muted-foreground">Depends on deal
          <select className="h-8 w-full rounded-md border bg-background px-2 text-sm" value={form.dependsOn} onChange={e => setForm(p => ({ ...p, dependsOn: e.target.value }))}>
            <option value="">— none —</option>
            {schemeDeals.map(d => <option key={d.id} value={d.id}>{d.unit ? `${d.unit} · ` : ""}{d.name}{d.ref ? ` #${d.ref}` : ""}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground sm:col-span-2">What for<Input value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} placeholder="e.g. heads of terms sign-off; CAPR approval; draft lease comments" className="h-8 text-sm" /></label>
        <div className="sm:col-span-2 flex justify-end gap-1">
          <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          <Button size="sm" disabled={saving} data-testid="landsec-unit-waiting-save" onClick={() => { onSave({ waitingOnParty: form.party || null, waitingOnName: form.name || null, waitingSince: form.since || undefined, waitingNote: form.note || null, dependsOnDealId: form.dependsOn || null }); setEditing(false); }}>Save</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {clock?.waitingOnParty ? (
        <span>Waiting on <span className="font-medium">{clock.waitingOnParty}</span>{clock.waitingOnName ? ` (${clock.waitingOnName})` : ""}{waitingDays != null ? <span className="text-muted-foreground tabular-nums"> · {waitingDays} days</span> : null}{clock.waitingNote ? <span className="text-muted-foreground"> · {clock.waitingNote}</span> : null}</span>
      ) : <span className="text-muted-foreground italic">No one named as waiting on</span>}
      {clock?.dependsOn && <span className="text-muted-foreground">Depends on <Link href={`/deals/${clock.dependsOn.id}`} className="hover:underline text-foreground">{clock.dependsOn.unit || clock.dependsOn.name}{clock.dependsOn.ref ? ` #${clock.dependsOn.ref}` : ""}</Link></span>}
      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setEditing(true)} data-testid="landsec-unit-waiting-edit"><Pencil className="w-3 h-3 mr-1" /> {clock?.waitingOnParty ? "Change" : "Set waiting on"}</Button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-3 space-y-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {children}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="whitespace-pre-wrap break-words">{value}</span>
    </div>
  );
}

// Click the pencil to edit; Enter (or the tick) saves, Escape cancels.
function EditRow({ label, value, kind, onSave, placeholder, hint }: {
  label: string; value: string | number | null; kind: "money" | "text" | "textarea";
  onSave?: (v: string | number | null) => void; placeholder?: string; hint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => { if (!editing) setDraft(value == null ? "" : String(value)); }, [value, editing]);
  const display = value == null || value === "" ? null : kind === "money" ? `${formatCurrency(Number(value))} pa` : String(value);
  const commit = () => {
    if (!onSave) return;
    const v = draft.trim();
    onSave(kind === "money" ? (v === "" ? null : Number(v.replace(/[£,\s]/g, ""))) : (v === "" ? null : v));
    setEditing(false);
  };
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 text-sm items-start">
      <span className="text-muted-foreground pt-0.5">{label}</span>
      {editing ? (
        <div className="flex items-start gap-1">
          {kind === "textarea"
            ? <Textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setEditing(false); }} rows={3} className="text-sm" placeholder={placeholder} />
            : <Input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} className="h-8 text-sm" placeholder={placeholder} inputMode={kind === "money" ? "numeric" : undefined} />}
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={commit} title="Save"><Check className="w-4 h-4" /></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setEditing(false)} title="Cancel"><X className="w-4 h-4" /></Button>
        </div>
      ) : (
        <button
          type="button"
          className={`group text-left flex items-start gap-1.5 ${onSave ? "hover:text-foreground" : "cursor-default"}`}
          onClick={() => onSave && setEditing(true)}
          title={onSave ? `Edit ${label.toLowerCase()}` : hint}
          data-testid={`landsec-unit-edit-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          <span className={`whitespace-pre-wrap break-words ${display ? "" : "text-muted-foreground italic"}`}>{display || (onSave ? placeholder || "Add" : hint || "—")}</span>
          {onSave && <Pencil className="w-3 h-3 mt-1 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />}
        </button>
      )}
    </div>
  );
}

// Pick a Landsec contact on the scheme, or type a name.
function PersonRow({ label, contacts, contactId, name, onSave }: { label: string; contacts: Contact[]; contactId: string | null; name: string | null; onSave: (contactId: string | null, name: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [pick, setPick] = useState(contactId || "");
  const [typed, setTyped] = useState(name || "");
  const current = contacts.find(c => c.id === contactId);
  const display = current ? `${current.name}${current.role ? ` · ${current.role}` : ""}` : name || null;
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 text-sm items-start">
      <span className="text-muted-foreground pt-0.5">{label}</span>
      {editing ? (
        <div className="space-y-1">
          {contacts.length > 0 && (
            <select className="h-8 w-full rounded-md border bg-background px-2 text-sm" value={pick} onChange={e => setPick(e.target.value)}>
              <option value="">— pick a Landsec contact —</option>
              {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.role ? ` · ${c.role}` : ""}</option>)}
            </select>
          )}
          <div className="flex items-center gap-1">
            <Input value={typed} onChange={e => setTyped(e.target.value)} placeholder="or type a name" className="h-8 text-sm" />
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" title="Save" onClick={() => { const c = contacts.find(x => x.id === pick); onSave(c ? c.id : null, c ? c.name : typed.trim() || null); setEditing(false); }}><Check className="w-4 h-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" title="Cancel" onClick={() => setEditing(false)}><X className="w-4 h-4" /></Button>
          </div>
        </div>
      ) : (
        <button type="button" className="group text-left flex items-start gap-1.5 hover:text-foreground" onClick={() => setEditing(true)} data-testid={`landsec-unit-person-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          <span className={display ? "" : "text-muted-foreground italic"}>{display || "Not set"}</span>
          {current?.email && <a href={`mailto:${current.email}`} className="text-xs text-muted-foreground hover:underline" onClick={e => e.stopPropagation()}>{current.email}</a>}
          <Pencil className="w-3 h-3 mt-1 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
        </button>
      )}
    </div>
  );
}

function SolicitorBlock({ deal, onSave }: { deal: NonNullable<UnitData["deal"]>; onSave: (patch: Record<string, any>) => void }) {
  const s = deal.solicitors;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ firm: s.firm || "", contact: s.contact || "", instructedAt: toInputDate(s.instructedAt), draftLeaseReceivedAt: toInputDate(s.draftLeaseReceivedAt), commentsReturnedAt: toInputDate(s.commentsReturnedAt), engrossmentAt: toInputDate(s.engrossmentAt), notes: s.notes || "" });
  useEffect(() => { if (!editing) setForm({ firm: s.firm || "", contact: s.contact || "", instructedAt: toInputDate(s.instructedAt), draftLeaseReceivedAt: toInputDate(s.draftLeaseReceivedAt), commentsReturnedAt: toInputDate(s.commentsReturnedAt), engrossmentAt: toInputDate(s.engrossmentAt), notes: s.notes || "" }); }, [s.firm, s.contact, s.instructedAt, s.draftLeaseReceivedAt, s.commentsReturnedAt, s.engrossmentAt, s.notes, editing]);
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  if (editing) {
    return (
      <div className="space-y-1.5 text-sm">
        <div className="grid grid-cols-2 gap-1.5">
          <Input value={form.firm} onChange={f("firm")} placeholder="Solicitors' firm" className="h-8 text-sm" />
          <Input value={form.contact} onChange={f("contact")} placeholder="Solicitor contact" className="h-8 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {([["instructedAt", "Instructed"], ["draftLeaseReceivedAt", "Draft lease received"], ["commentsReturnedAt", "Comments returned"], ["engrossmentAt", "Engrossment"]] as const).map(([k, l]) => (
            <label key={k} className="text-xs text-muted-foreground">{l}<Input type="date" value={form[k]} onChange={f(k)} className="h-8 text-sm" /></label>
          ))}
        </div>
        <Textarea value={form.notes} onChange={f("notes")} placeholder="Solicitor notes" rows={2} className="text-sm" />
        <div className="flex gap-1 justify-end">
          <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          <Button size="sm" onClick={() => { onSave({ firm: form.firm, contact: form.contact, instructedAt: form.instructedAt || null, draftLeaseReceivedAt: form.draftLeaseReceivedAt || null, commentsReturnedAt: form.commentsReturnedAt || null, engrossmentAt: form.engrossmentAt || null, notes: form.notes }); setEditing(false); }}>Save</Button>
        </div>
      </div>
    );
  }
  const steps = [["Instructed", s.instructedAt], ["Draft lease", s.draftLeaseReceivedAt], ["Comments back", s.commentsReturnedAt], ["Engrossment", s.engrossmentAt], ["Exchanged", deal.exchangedAt], ["Completed", deal.completedAt]] as const;
  return (
    <div className="space-y-1.5">
      <Row label="Solicitors" value={[s.firm, s.contact].filter(Boolean).join(" · ") || "Not yet instructed"} />
      <div className="grid grid-cols-[7.5rem_1fr] gap-2 text-sm">
        <span className="text-muted-foreground">Legal steps</span>
        <ol className="flex flex-wrap gap-1">
          {steps.map(([l, d]) => (
            <li key={l} className={`rounded-full border px-2 py-px text-[10px] uppercase tracking-wide ${d ? "border-foreground text-foreground" : "text-muted-foreground/60"}`} title={d ? fmtDate(d, true) : "Not yet"}>{l}{d ? ` ${fmtDate(d)}` : ""}</li>
          ))}
        </ol>
      </div>
      {s.notes && <Row label="Notes" value={s.notes} />}
      <div><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(true)} data-testid="landsec-unit-solicitors-edit"><Pencil className="w-3 h-3 mr-1" /> Solicitors' details</Button></div>
    </div>
  );
}

function Catchups({ items, onAdd }: { items: { at: string; note: string; byName: string | null }[]; onAdd: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <div className="pt-1">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Catch-ups with solicitors</p>
      <div className="flex items-center gap-1 mb-1.5">
        <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note from today's call" className="h-8 text-sm" onKeyDown={e => { if (e.key === "Enter" && note.trim()) { onAdd(note); setNote(""); } }} />
        <Button size="sm" className="h-8" disabled={!note.trim()} onClick={() => { onAdd(note); setNote(""); }} data-testid="landsec-unit-catchup-add">Add</Button>
      </div>
      {items.length === 0 ? <p className="text-xs text-muted-foreground">No catch-ups logged.</p> : (
        <ul className="space-y-1">
          {items.slice(0, 8).map((c, i) => (
            <li key={i} className="text-sm"><span className="text-xs text-muted-foreground tabular-nums">{fmtDate(c.at, true)}{c.byName ? ` · ${c.byName}` : ""}</span><br />{c.note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
