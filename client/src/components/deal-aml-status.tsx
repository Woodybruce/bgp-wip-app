import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, ShieldCheck, Loader2, FileDown, Sparkles, Upload, Trash2, Brain, ScrollText, Mail, Send, Copy, Cloud, ChevronDown, ChevronUp, ChevronRight, TrendingUp, TrendingDown, FolderOpen, Flag, AlertTriangle } from "lucide-react";
import { Link, useLocation } from "wouter";
import { kyc4uDraftState } from "@shared/kyc4u-portal";
import { ClientChecksForParty, SendClientChecksButton, useClientChecks, type ClientChecks, type ClientChecksAgent } from "@/components/kyc-client-checks";
import { PartyDocumentsBox } from "@/components/kyc-documents";
import { PartyFiles } from "@/components/aml-files";
import { SecondReadPanel } from "@/components/aml-second-read";
import { useAmlOfficerLabel } from "@/components/aml-policy-panel";
import { OwnershipTrustPanel, TrustStructurePanel, useOwnershipTrust, trustSummary, useTrustStructure } from "@/components/trust-structure";
import { DealPartyEditor, DealPartyLines, PublicBodyLine, TrustLine, partyAmlFacts, useDealParties, useWorkOutSigningCompanies } from "@/components/deal-parties";
import { SddBox } from "@/components/aml-sdd";
import { RedFlagList, RedFlagLists } from "@/components/aml-red-flags";
import { DealDescribeBox } from "@/components/deal-hots";
import { PartyDecisionButton, PartyDecisions } from "@/components/deal-party-aml";
import { legacyToCode } from "@shared/deal-status";
import { FLAG_REVIEW_COMMENT_MIN, isSanctionsFlag, type KycRedFlag, type SetAsideFlag } from "@shared/kyc-red-flags";
import { personDisplayName, personNamesMatch, precheckDay, type PrecheckCardLine, type PrecheckCompany } from "@shared/kyc-prechecks";
import { type AmlRegime, type JointAgentRule, type JointAskRecord, type PartyDueDiligence } from "@shared/aml-policy";
import { AML_BOX_WHO_WORDS, amlBoxDay, amlNextStep, firmShort, shortReason, type AmlBoxFacts } from "@shared/aml-box";
import { AML_STEP_LABEL, companyStepLine, documentsStepLine, sanctionsStepLine, screeningStepLine, signOffStepLine, type AmlStepState, type ClientRequestStatus, type ScreeningRun } from "@shared/aml-steps";
import { AmlCheckLines, AmlLevelChip, AmlNextBox, AmlScreeningHead, AmlStep, CompanyFactsList, RedFlagChip } from "@/components/aml-frame";
import { type AmlDashboardRow, type AmlStage } from "@shared/aml-dashboard";
import { peopleToReach, type DealPartyRole, type DealPartyView } from "@shared/deal-parties";
import { getAuthHeaders, queryClient, apiRequest } from "@/lib/queryClient";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { RaiseReportButton, RaiseReportDialog } from "@/components/aml-register";
import { DealAgentsAml, useDealAgentsAml } from "@/components/agent-aml";
import { DealSolicitorsAmlPanel, solicitorsSummary, useDealSolicitorsAml } from "@/components/solicitor-aml";
import { AmlCommentaryView } from "@/components/aml-commentary";
import { Kyc4uStatusStrip } from "@/components/kyc4u-panel";
import type { RiskAssessment } from "@shared/aml-risk-assessment";
import type { PersonDetailsView } from "@shared/kyc-person-details";
import { PersonDetailsLine } from "@/components/aml-person-details";
import { CHARITY_ATTRIBUTION, type CharityFacts } from "@shared/charity-register";
import { AmlFileButton } from "@/components/aml-file-button";
import { AmlShareButton } from "@/components/aml-share-button";
import { AbroadTrace, abroadSummary, useDealAbroad } from "@/components/aml-abroad";
import { JointRelianceButton, RelianceCard } from "@/components/aml-reliance";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AskJointAgentButton, AskJointAgentDialog, JointAgentPanel, JointChaseButton, askAgentLabel, currentJointRequest, jointApplies, jointAskable, jointBoxFacts, useJointChecks } from "@/components/joint-agent-checks";
import { AmlStopDialog, useAmlStop } from "@/components/aml-stop";

export interface DealAmlStatus {
  dealId: string;
  dealName: string;
  counterparties: Array<{
    id: string;
    name: string;
    role: string;
    kyc_status: string | null;
    kyc_expires_at: string | null;
    kyc_approved_by: string | null;
    isApproved: boolean;
    isExpired: boolean;
    // Signed off for sanctions checks only (a letting under £10,000 a month), which
    // does not cover this transaction: it needs the full checks (23 November 2026).
    sanctionsOnlyApproval?: { by: string | null; at: string | null; until: string | null } | null;
    // Approved on this small letting for the sanctions checks only (23 November 2026).
    approvalScope?: "sanctions_only" | null;
    // Who the state is about (BGP staff only): the company that signs when
    // the deal names one (2026-11-18), else the brand.
    kycName?: string;
    kycSource?: "brand" | "company" | "same_company" | "brand_rejected";
    brandKycStatus?: string | null;
    signsAs?: string | null;
    // Marked Not required on this deal by the Nominated Officer or the
    // Deputy (BGP's AML policy, 19 November 2026).
    notRequired?: { reason?: string; reasonWords: string; comment?: string; by?: string | null; at?: string | null; asked?: JointAskRecord | null } | null;
    // A Not required mark that no longer counts under HMRC's rules (22
    // November 2026): the joint agent reason on a letting, or on a sale with
    // no record of asking the joint agent. BGP staff only.
    notRequiredLapsed?: { reasonWords: string; comment?: string; by?: string | null; at?: string | null; why: string } | null;
  }>;
  allApproved: boolean;
  canInvoice: boolean;
  missing: string[];
  // In-app AML is on (the old in-app checks, retired in October 2026).
  inAppAml?: boolean;
  clientChecks?: boolean;
  // What makes a party enhanced, the officers' to sign off (BGP staff only; null for anyone else).
  redFlags?: {
    parties: Record<string, KycRedFlag[]>; deal: KycRedFlag[]; unchecked: string[];
    // Set aside by the MLRO with a comment: listed, no longer counted.
    setAside?: Record<string, SetAsideFlag[]>; dealSetAside?: SetAsideFlag[];
    // Each party's level of due diligence under BGP's AML policy.
    levels?: Record<string, PartyDueDiligence>;
  } | null;
  // BGP's checks before asking, per party (BGP staff only).
  prechecks?: Record<string, PartyPrecheck> | null;
  // BGP's sign-off (BGP staff only): whether the person
  // may decide (the Nominated Officer or the Deputy) or sign off (they, and
  // the deal's agents), and per party whether it may be signed off now.
  decisions?: {
    canDecide: boolean; canSignOff?: boolean; mlroAppointed: boolean;
    officers?: { nominated: string | null; deputy: string | null }; officerWords?: string;
    // full: on a letting under £10,000 a month, whether the full checks may be signed off (23 November 2026).
    // fileNote: a listed company's sign-off note, written from the file (24 November 2026).
    parties: Record<string, { blocked: string | null; needsNote: boolean; edd?: boolean; fileNote?: string | null; full?: { blocked: string | null; needsNote: boolean; edd?: boolean; fileNote?: string | null };
      // A private individual's date of birth and nationality (24 November 2026).
      person?: PersonDetailsView | null }>;
    // The officers' setting: BGP does enhanced due diligence itself (21 November 2026).
    inHouseEdd?: boolean;
  } | null;
  // Which checks the deal needs under BGP's AML policy (BGP staff only).
  regime?: { regime: AmlRegime; why: string } | null;
  // HMRC's joint agent route for the deal (22 November 2026; BGP staff only).
  jointRule?: JointAgentRule | null;
}

export interface PartyPrecheck {
  // needs_company: no check runs until the deal names the company that signs.
  state: "done" | "running" | "none" | "cap" | "off" | "waiting" | "needs_company";
  startedAt: string | null;
  ranAt: string | null;
  lines: PrecheckCardLine[];
  errors: string[];
  company?: PrecheckCompany | null;
  // What the app traced past Companies House, also for a company with no UK record.
  trace?: string[];
  // The Charity Commission's register, and the party's own GLEIF record (21 November 2026).
  charity?: CharityFacts | null;
  gleif?: string | null;
  unfinished?: string | null;
  retryAt?: string | null;
}

const clock = (iso: string | null | undefined) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "";
};

// The company the checks are about, as the register gives it (Woody,
// 2026-11-19: "in this box we need to see the company info").
function PartyCompanyFacts({ data, companyId }: { data: DealAmlStatus; companyId: string }) {
  const c = data.prechecks?.[companyId]?.company;
  if (!c) return null;
  // The same list as the client KYC window: one build for AML (24 November 2026).
  return <CompanyFactsList company={c} testKey={companyId} />;
}

// The Charity Commission's register (Woody, 21 November 2026: "We need
// screening on GLEIF and foundations in the uk"): the charity the party is,
// or acts for as its trustee, with its trustees.
function PartyCharityFacts({ data, companyId }: { data: DealAmlStatus; companyId: string }) {
  const [more, setMore] = useState(false);
  const pre = data.prechecks?.[companyId];
  const c = pre?.charity;
  if (!c) return null;
  if (c.state !== "found") {
    const words = c.state === "ambiguous" ? `${c.candidates} charities could be it (${c.lookedFor}): the charity number is needed to choose.`
      : c.state === "error" ? `The register could not be read${c.error ? ` (${c.error})` : ""}.`
      : `Not on the register under ${c.lookedFor}.`;
    return <p className="text-xs text-muted-foreground" data-testid={`kyc-charity-${companyId}`}>Charity Commission: {words}</p>;
  }
  const trustees = more ? c.trustees : c.trustees.slice(0, 8);
  return (
    <div className="space-y-1.5 border-t border-border/60 pt-2" data-testid={`kyc-charity-${companyId}`}>
      {c.actsAsTrustee && <p className="text-xs">{c.actsAsTrustee}</p>}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
        <span className="font-semibold">{c.name}</span>
        <span className="font-mono tabular-nums text-muted-foreground">charity {c.number}</span>
        {c.registerUrl && <a href={c.registerUrl} target="_blank" rel="noreferrer" className="ml-auto text-[11px] text-primary hover:underline">Register of charities</a>}
      </div>
      <div className="text-[11px] text-muted-foreground">{[c.kind ? c.kind[0].toUpperCase() + c.kind.slice(1) : null, c.status === "Registered" && c.registeredOn ? `Registered ${c.registeredOn}` : c.status].filter(Boolean).join(" · ")}</div>
      {c.warnings.length > 0 && <ul className="text-xs text-red-700 dark:text-red-400 space-y-0.5">{c.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
      <dl className="grid grid-cols-1 gap-y-1 text-xs">
        {c.companyNumber && <div><dt className="inline text-muted-foreground">Companies House number: </dt><dd className="inline font-mono tabular-nums">{c.companyNumber}</dd></div>}
        {c.accounts && <div><dt className="inline text-muted-foreground">Latest accounts: </dt><dd className="inline">{c.accounts}</dd></div>}
        {c.address && <div><dt className="inline text-muted-foreground">Address: </dt><dd className="inline">{c.address}</dd></div>}
        <div data-testid={`kyc-charity-trustees-${companyId}`}><dt className="inline text-muted-foreground">Trustees: </dt><dd className="inline">
          {c.trustees.length ? trustees.map(t => `${t.name}${t.chair ? " (chair)" : ""}${t.organisation ? " (an organisation)" : ""}`).join(", ") : "none listed"}
          {c.trustees.length > 8 && <button type="button" className="ml-1 text-primary hover:underline" onClick={() => setMore(m => !m)}>{more ? "fewer" : `and ${c.trustees.length - 8} more`}</button>}
        </dd></div>
        {c.otherNames.length > 0 && <div><dt className="inline text-muted-foreground">Other names: </dt><dd className="inline">{c.otherNames.join("; ")}</dd></div>}
        {c.activities && <div><dt className="inline text-muted-foreground">What it does: </dt><dd className="inline">{c.activities}</dd></div>}
      </dl>
      <p className="text-[10px] text-muted-foreground">{CHARITY_ATTRIBUTION}</p>
    </div>
  );
}

// The risk assessment (Woody, 24 November 2026, on Vodafone #4664: "we
// allready have all this info highlighted in the parts above? shouldnt this
// be more an AI led commentary with fable 5"): Fable's written view first
// (aml-commentary.tsx), and the full record, in KYC4U's shape, folded under it.
function PartyRiskAssessment({ dealId, role }: { dealId: string; role: string }) {
  const [showRecord, setShowRecord] = useState(false);
  return (
    <div className="space-y-2" data-testid={`aml-risk-assessment-${role}`}>
      <AmlCommentaryView dealId={dealId} role={role} />
      <button type="button" data-view-ok className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowRecord(v => !v)} data-testid={`aml-risk-record-toggle-${role}`}>
        {showRecord ? "Hide the full record" : "Show the full record"}
      </button>
      {showRecord && <PartyRiskRecord dealId={dealId} role={role} />}
    </div>
  );
}

// BGP's written risk assessment for the party, in KYC4U's shape (Woody,
// 21 November 2026: "yes lets do 1 to 4"). The same builder as the AML file
// (shared/aml-risk-assessment.ts), read from GET /api/deals/:id/aml-risk-assessment.
function PartyRiskRecord({ dealId, role }: { dealId: string; role: string }) {
  const { data, isLoading, error } = useQuery<{ riskAssessment: RiskAssessment | null; unread: string[] }>({
    queryKey: ["/api/deals", dealId, "aml-risk-assessment", role],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${encodeURIComponent(dealId)}/aml-risk-assessment?role=${encodeURIComponent(role)}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("The risk assessment could not be read");
      return res.json();
    },
    staleTime: 30_000,
  });
  if (isLoading) return <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Reading the checks…</p>;
  if (error || !data?.riskAssessment) return <p className="text-xs text-amber-800 dark:text-amber-300">The risk assessment could not be read. Try again in a moment.</p>;
  const ra = data.riskAssessment;
  const toneCls = (t: string) => (t === "attention" ? "text-amber-800 dark:text-amber-300" : t === "ok" ? "text-emerald-800 dark:text-emerald-300" : "");
  const Rows = ({ rows }: { rows: Array<{ label: string; value: string; tone: string }> }) => (
    <dl className="grid grid-cols-1 gap-y-1 text-xs">
      {rows.map(r => <div key={`${r.label}-${r.value.slice(0, 20)}`}><dt className="inline text-muted-foreground">{r.label}: </dt><dd className={`inline ${toneCls(r.tone)}`}>{r.value}</dd></div>)}
    </dl>
  );
  const H = ({ children }: { children: ReactNode }) => <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>;
  return (
    <div className="space-y-1.5" data-testid={`aml-risk-record-${role}`}>
      <p className="text-[11px] text-muted-foreground">The full record, read from the checks above. The AML file prints it after BGP's view.</p>
      <Rows rows={ra.job} />
      <H>Risk details</H>
      <ul className="text-xs space-y-0.5">
        {ra.risks.map(h => <li key={h.factor}><span className="text-muted-foreground">{h.label}: </span><span className={h.value === "Higher" ? "font-medium text-amber-800 dark:text-amber-300" : ""}>{h.value}</span>{h.details.length ? <span className="text-muted-foreground"> · {h.details.join("; ")}</span> : null}</li>)}
      </ul>
      <H>Due diligence</H>
      <Rows rows={ra.diligence} />
      {ra.structure.length > 0 && <>
        <H>Structure and evidence</H>
        <ul className="text-xs space-y-1">
          {ra.structure.map(e => <li key={e.name}><span className="font-medium">{e.name}</span> <span className="text-muted-foreground">· {e.location} · country risk {e.countryRisk.toLowerCase()} · {e.orgType.toLowerCase()}</span>
            {e.evidence.length > 0 && <ul className="pl-3 text-muted-foreground">{e.evidence.map(x => <li key={x} className="break-words">{x}</li>)}</ul>}</li>)}
        </ul>
      </>}
      <H>Beneficial owners</H>
      {ra.ownersNote && <p className="text-xs text-muted-foreground">{ra.ownersNote}</p>}
      {ra.owners.length > 0 && <ul className="text-xs space-y-1">
        {ra.owners.map(o => <li key={o.name}><span className="font-medium">{o.name}</span> <span className="text-muted-foreground">· {o.nationality} · {o.residence}</span> · <span className={o.idMethod.startsWith("Not verified") ? "text-amber-800 dark:text-amber-300" : ""}>{o.idMethod}</span> <span className="text-muted-foreground">· risk {o.risk.toLowerCase()} · PEP {o.pep.toLowerCase()}</span></li>)}
      </ul>}
      <H>Risk identified</H>
      <ul className="text-xs space-y-0.5">{(ra.riskIdentified.length ? ra.riskIdentified : ["No risk identified."]).map(x => <li key={x} className={ra.riskIdentified.length ? "text-amber-800 dark:text-amber-300" : ""}>{x}</li>)}</ul>
      {ra.mitigating.length > 0 && <><H>Mitigating factors</H><ul className="text-xs space-y-0.5">{ra.mitigating.map(x => <li key={x}>{x}</li>)}</ul></>}
      <H>Conclusion</H>
      <ul className="text-xs space-y-0.5">{ra.conclusion.map(x => <li key={x}>{x}</li>)}</ul>
      <H>Counterparty</H>
      <Rows rows={ra.counterparty} />
      <H>Approvals</H>
      <Rows rows={ra.approvals} />
      {data.unread.length > 0 && <p className="text-xs text-amber-800 dark:text-amber-300">Could not be read: {data.unread.join("; ")}.</p>}
    </div>
  );
}

// What BGP checked before anyone was asked anything (Woody, 2026-11-17: "we
// need to do everyhting we can before we ask questions on someone"). It
// starts by itself when the card opens; Run again starts it afresh.
// only: the lines to show (the simple sanctions-only view shows the sanctions line alone).
function PartyPrechecks({ dealId, data, companyId, only, level }: { dealId: string; data: DealAmlStatus; companyId: string; only?: string[]; level?: PartyDueDiligence | null }) {
  const { toast } = useToast();
  const view = data.prechecks?.[companyId];
  const again = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/kyc/deal/${dealId}/prechecks`, { companyId })).json(),
    onSuccess: (r: any) => {
      const state = r?.started?.[companyId];
      if (state === "cap") toast({ title: "Not run", description: "Today's limit for these checks is used up. They run again tomorrow." });
      else if (state === "off") toast({ title: "Not run", description: "These checks are switched off." });
      else if (state === "needs_company") toast({ title: "Not run", description: "Set the contracting entity for this party first: the checks are about it, not the brand." });
      queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
    },
    onError: (e: any) => toast({ title: "Not run", description: String(e?.message || e), variant: "destructive" }),
  });
  if (!view || view.state === "off" || view.state === "needs_company") return level ? <AmlScreeningHead level={level} testId={`aml-level-${companyId}`} /> : null;
  const running = view.state === "running" || again.isPending;
  return (
    <div className="text-xs space-y-1.5" data-testid={`kyc-prechecks-${companyId}`}>
      {/* Run again and the level of due diligence on one line, as the client KYC window has them. */}
      <AmlScreeningHead level={only ? null : level} testId={`aml-level-${companyId}`} action={
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={running} onClick={() => again.mutate()} data-testid={`kyc-prechecks-again-${companyId}`}>
          {running && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{view.ranAt ? "Run again" : "Run BGP's checks"}
        </Button>
      } />
      {running && (
        <p className="flex items-center gap-1.5 text-muted-foreground" data-testid={`kyc-prechecks-running-${companyId}`}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />Reading Companies House, screening the sanctions lists and searching the web for public roles and adverse media. This takes a minute or two.
        </p>
      )}
      {!running && view.unfinished && (
        <p className="text-amber-800 dark:text-amber-300" data-testid={`kyc-prechecks-unfinished-${companyId}`}>
          Not finished: Companies House did not answer ({view.unfinished.replace(/^Companies House could not be read \(|\)\.?$/g, "")}). The check runs again by itself when this box is opened{view.retryAt ? ` after ${clock(view.retryAt)}` : ""}, or press Run again.
        </p>
      )}
      {!running && view.state === "cap" && <p className="text-muted-foreground">Today's limit for these checks is used up: they run when the card is next opened tomorrow.</p>}
      {!running && view.state === "waiting" && !view.unfinished && <p className="text-muted-foreground">The last run did not finish. It is tried again shortly, or press Run again.</p>}
      {!running && !view.lines.length && view.state === "none" && <p className="text-muted-foreground">Not run yet.</p>}
      {!running && <AmlCheckLines lines={view.lines} only={only} testId={`kyc-prechecks-lines-${companyId}`} />}
      {view.errors.length > 0 && (
        <p className="text-muted-foreground" data-testid={`kyc-prechecks-errors-${companyId}`}>Could not be read: {view.errors.join("; ")}.</p>
      )}
    </div>
  );
}

// The red flags list is shared with the client KYC window (aml-red-flags.tsx).
function refreshAml(dealId: string) {
  queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
  queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
}

// only: the box draws the red flags under Red flags and the policy's
// higher-risk factors under Due diligence (20 November 2026).
// sanctionsOnly: the simple view of a letting under £10,000 a month lists possible sanctions matches only.
function PartyRedFlags({ dealId, data, companyId, role, only, sanctionsOnly }: { dealId: string; data: DealAmlStatus; companyId: string; role: string; only?: "flags" | "factors"; sanctionsOnly?: boolean }) {
  // The same lists, in the same words, as the client KYC window (aml-red-flags.tsx).
  return <RedFlagLists dealId={dealId} role={role} flags={data.redFlags?.parties[companyId] || []} setAside={data.redFlags?.setAside?.[companyId] || []}
    canDecide={!!data.decisions?.canDecide} whoDecides={data.decisions?.officerWords} only={only} sanctionsOnly={sanctionsOnly} testKey={companyId} />;
}

// A party marked Not required (the other side of a deal a joint agent
// negotiated, or where no deal was done).
function PartyNotRequiredBox({ cp }: { cp: DealAmlStatus["counterparties"][number] }) {
  if (cp.notRequiredLapsed) {
    const l = cp.notRequiredLapsed;
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" data-testid={`aml-not-required-lapsed-${cp.id}`}>
        <div className="font-semibold">Marked Not required, but it no longer counts</div>
        <div>{l.why}</div>
        <div className="opacity-80">{l.reasonWords}{l.comment ? `: “${l.comment}”` : ""}{l.by ? ` (${l.by}${l.at ? `, ${precheckDay(l.at)}` : ""})` : ""}</div>
      </div>
    );
  }
  if (!cp.notRequired) return null;
  const n = cp.notRequired;
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2 text-xs" data-testid={`aml-not-required-${cp.id}`}>
      <div className="font-semibold">Not required</div>
      <div className="text-muted-foreground">{n.reasonWords}{n.comment ? `: “${n.comment}”` : ""}{n.by ? ` (${n.by}${n.at ? `, ${precheckDay(n.at)}` : ""})` : ""}</div>
    </div>
  );
}

function DealRegime({ data }: { data: DealAmlStatus }) {
  if (!data.regime || data.regime.regime === "full") return null;
  return <p className="text-xs text-muted-foreground" data-testid="aml-regime">{data.regime.why}</p>;
}

function DealRedFlags({ dealId, data }: { dealId: string; data: DealAmlStatus }) {
  const unchecked = data.redFlags?.unchecked || [];
  const officer = useAmlOfficerLabel();
  const inHouse = data.decisions?.inHouseEdd !== false;
  return (
    <>
      <RedFlagList
        dealId={dealId}
        role={null}
        flags={(data.redFlags?.deal || []).filter(f => !f.factor)}
        setAside={(data.redFlags?.dealSetAside || []).filter(a => !a.flag.factor)}
        canDecide={!!data.decisions?.canDecide}
        whoDecides={data.decisions?.officerWords}
        title="Red flag on the transaction record"
        step={`It is not tied to one party: raise it with ${officer}.`}
        testId="kyc-red-flags-deal"
      />
      <RedFlagList
        dealId={dealId}
        role={null}
        factors
        flags={(data.redFlags?.deal || []).filter(f => f.factor)}
        setAside={(data.redFlags?.dealSetAside || []).filter(a => a.flag.factor)}
        canDecide={!!data.decisions?.canDecide}
        whoDecides={data.decisions?.officerWords}
        title="A risk factor on the transaction"
        step={`It applies to every party: ${officer} checks it before signing them off.`}
        testId="kyc-policy-factors-deal"
      />
      {unchecked.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="kyc-red-flags-unchecked">
          Red flags could not be checked against: {unchecked.join(", ")}.
        </p>
      )}
    </>
  );
}

export function useDealAmlStatus(dealId: string, enabled = true) {
  return useQuery<DealAmlStatus>({
    enabled,
    queryKey: ["/api/kyc/deal", dealId, "status"],
    // While BGP's checks before asking run, read again every few seconds;
    // otherwise every 30, as every other query does.
    refetchInterval: (q) => Object.values((q.state.data as DealAmlStatus | undefined)?.prechecks || {}).some(p => p.state === "running") ? 5000 : 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/kyc/deal/${dealId}/status`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load AML status");
      const next: DealAmlStatus = await res.json();
      // A run of BGP's checks started or finished since the last read: the
      // people to check and the send window's list are read again (24
      // November 2026, #4664: the list was made before the register was read).
      const before = queryClient.getQueryData<DealAmlStatus>(["/api/kyc/deal", dealId, "status"]);
      const runs = (s?: DealAmlStatus) => JSON.stringify(Object.entries(s?.prechecks || {}).map(([k, p]) => [k, p.state, p.ranAt || null]));
      if (before && runs(before) !== runs(next)) queryClient.invalidateQueries({ queryKey: ["/api/aml/deal", dealId, "client-checks"] });
      return next;
    },
  });
}

// ── The AML box (Woody, 20 November 2026: "minimise each section with the
// detail to pop out"; 22 November 2026: "there is a large amount of text some
// of which is very AI and its very crowded", then "yes go ahead" to four steps
// per party and the Parties card merged into the box). Each party is one
// card: its name, any red flags and the level of checks when it is not
// standard, one Next line (who it waits on or what to do, a few words and one
// button: shared/aml-box.ts) and four steps: Who signs, Screening, Documents
// and Sign-off, each one line that opens its detail. The officers' tools are
// in the box's menu. A status, not an explanation.

// The colours, the Next box and the step lines are the shared ones
// (aml-frame.tsx): one build for every AML screen (Woody, 24 November 2026).
export { AML_STAGE_TONE } from "@/components/aml-frame";

// A part of a step's detail that stays folded until pressed.
function Folded({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={testId}>
      <button type="button" data-no-min-touch data-view-ok className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />{label}
      </button>
      {open && <div className="mt-1.5 space-y-2 pl-4">{children}</div>}
    </div>
  );
}

// A part's name inside a step: plain words, as the client KYC window has them (24 November 2026).
const SubHead = ({ children }: { children: ReactNode }) => <p className="text-xs font-medium text-muted-foreground">{children}</p>;

const OPEN_ALL_KEY = "bgp:aml-box:open-all";
const readOpenAll = (): boolean => { try { return window.localStorage.getItem(OPEN_ALL_KEY) === "1"; } catch { return false; } };
const writeOpenAll = (on: boolean) => { try { if (on) window.localStorage.setItem(OPEN_ALL_KEY, "1"); else window.localStorage.removeItem(OPEN_ALL_KEY); } catch { /* per browser only */ } };
type OpenAll = { all: boolean; at: number };

type StepKey = "signs" | "screening" | "documents" | "decision";
const STEP_KEYS: StepKey[] = ["signs", "screening", "documents", "decision"];

function useOpenSections<K extends string>(keys: K[], openAll: OpenAll) {
  const [open, setOpen] = useState<Set<K>>(() => new Set(openAll.all ? keys : []));
  useEffect(() => { if (openAll.at) setOpen(new Set(openAll.all ? keys : [])); }, [openAll.at]);
  const toggle = (k: K) => setOpen(prev => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
  const show = (k: K) => setOpen(prev => new Set(prev).add(k));
  return { open, toggle, show };
}

// Each party's stage by the AML dashboard's own rule, read for this deal.
function useDealAmlRows(dealId: string, enabled: boolean) {
  return useQuery<{ rows: AmlDashboardRow[] }>({
    enabled,
    queryKey: ["/api/aml-dashboard", "deal", dealId],
    queryFn: async () => {
      const res = await fetch(`/api/aml-dashboard?dealId=${encodeURIComponent(dealId)}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("The transaction's AML stages could not be read");
      return res.json();
    },
  });
}

type Counterparty = DealAmlStatus["counterparties"][number];

// The stage from the AML status alone, when the dashboard's row is not read.
function fallbackStage(cp: Counterparty): AmlStage | null {
  if (String(cp.kyc_status || "").toLowerCase() === "rejected") return "rejected";
  if (cp.notRequired) return "not_required";
  if (cp.isApproved) return cp.isExpired ? "expired" : "approved";
  return null;
}

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) : "");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const NOT_REQUIRED_SHORT: Record<string, string> = { joint_agent: "the joint agent's party", no_deal: "no transaction with this party", advisory_other_side: "advisory work: only BGP's client is checked" };

/** A party slot on the deal (the Parties card merged into the box, 22 November 2026). */
export interface PartySlot {
  role: DealPartyRole;
  label: string;
  companyId: string | null;
  client: boolean;
  // The deal page's picker: link, change or add the party.
  picker: ReactNode;
  // The same picker as one pencil for the card's heading, which already shows the
  // name: one press opens the search (Woody, 23 November 2026: "two edit buttons to
  // change the Landlord? we only need one?").
  change?: ReactNode;
}

function PartyAmlBox({ dealId, data, cp, row, party, checks, openAll, startOpen, slot, mirror }: {
  dealId: string; data: DealAmlStatus; cp: Counterparty; row: AmlDashboardRow | null; party: DealPartyView | null;
  checks: ClientChecks | undefined; openAll: OpenAll; startOpen?: boolean; slot?: PartySlot | null;
  // The transaction page's read-only copy (Woody, 25 November 2026): the steps open in
  // place to read ("PROBLEM HERE SEEING THE DROP DOWN INFO ON THE CHECKS PUT THAT BACK"),
  // every action is left to the AML board ("this is view only in transactions").
  mirror?: (role: string) => void;
}) {
  const staff = !!data.prechecks;
  const sections = useOpenSections(STEP_KEYS, openAll);
  const kyc4uQ = useQuery<{ requests: Array<{ listId: string; itemId: string; entityName: string | null; createdAt: string | null; modifiedAt: string | null }> }>({
    queryKey: ["/api/kyc4u/company", cp.id], enabled: staff, staleTime: 5 * 60_000,
  });
  const open = sections.open;
  const toggle = (k: StepKey) => sections.toggle(k);
  const show = sections.show;
  // A party still being checked opens on its four steps; a cleared one is one line until opened.
  // Opened by name from the address (?full=<role>, Group entities' Start full KYC): unfolded.
  const [folded, setFolded] = useState(() => {
    if (startOpen || openAll.all) return false;
    try { return new URLSearchParams(window.location.search).get("full") !== cp.role; } catch { return true; }
  });
  useEffect(() => { if (openAll.at) setFolded(!openAll.all); }, [openAll.at]);
  const [editing, setEditing] = useState(false);
  // The joint agent asked for the party's documents, from Send client checks or step 1 (25 November 2026).
  const [askingJoint, setAskingJoint] = useState(false);
  const drafts = useQuery<any[]>({
    enabled: staff,
    queryKey: ["/api/kyc4u/drafts", dealId, cp.id],
    queryFn: async () => (await apiRequest("GET", `/api/kyc4u/drafts?${new URLSearchParams({ dealId, companyId: cp.id })}`)).json(),
  });
  // The joint agent asked for their checks on the party (22 November 2026).
  const jointQ = useJointChecks(dealId, staff && !!data.jointRule && data.jointRule !== "letting_under" && data.jointRule !== "advisory");
  const jointParty = jointApplies(jointQ.data, cp.id);
  // Any party BGP does not act for can be asked about through an agent (22 November 2026).
  const askParty = jointAskable(jointQ.data, cp.id);
  // The party's own agent passes the standard checks on to their client (Woody,
  // 23 November 2026: "with the agent acting for the tenant or against us we
  // need them to pass on the standard KYC requests for their clients").
  // Who to ask chosen as their agent or the joint agent (25 November 2026): that decides the email.
  const askRelation = party?.person?.from === "party" ? party.person.relation || "party" : "party";
  const askedAgent: ClientChecksAgent | null = askRelation === "own_agent" && party?.person ? {
    firm: party.person.firm || party.person.name, companyId: null, contactId: party.person.id,
    contacts: [{ id: party.person.id, name: party.person.name, email: party.person.email }], words: "their agent",
  } : null;
  const theirAgent: ClientChecksAgent | null = askedAgent || (askParty ? {
    firm: askParty.agent?.name || "", companyId: askParty.agent?.companyId || null, contactId: askParty.agent?.contactId || null,
    contacts: askParty.agent?.contacts || [], words: askParty.agentWords,
  } : null);

  // The joint agent can be asked for this party's documents while nothing is out to them yet.
  const jointAsk = jointQ.data && askParty && !currentJointRequest(askParty) ? () => setAskingJoint(true) : undefined;

  const reveal = (k: StepKey) => {
    setFolded(false);
    show(k);
    window.setTimeout(() => document.getElementById(`aml-${cp.id}-${k}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60);
  };

  const partyName = cp.kycName || cp.name;
  // A letting under £10,000 a month needs the sanctions checks only: a simple view of
  // three steps, Who signs, Sanctions and Sign-off (Woody, 23 November 2026: "we have a
  // sanctions only version for AML'S which is much simpler so not to confuse everyone").
  // "Show the full checks" opens the four steps and the full checks themselves: client
  // checks and a full sign-off, which also covers a sale or a bigger letting (Woody, the
  // same day: AG Hondo "is approved KYC for deals under £10k sanction only ... option to
  // start full KYC"). Group entities' Start full KYC opens it (?full=<role>). A trust keeps its own.
  const smallLetting = data.regime?.regime === "sanctions_only";
  const isTrust = !!party?.brand.recordTrust;
  const [fullView, setFullView] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("full") === cp.role; } catch { return false; }
  });
  const fullOnSmall = smallLetting && fullView && !isTrust;
  // An approval on this letting that covers the sanctions checks only is not the full checks.
  const approved = cp.isApproved && !cp.isExpired && !(fullOnSmall && cp.approvalScope === "sanctions_only");
  // What the checks still need is moot once the party is approved or marked Not required.
  const settled = approved || !!cp.notRequired;
  const pre = data.prechecks?.[cp.id] || null;
  // The full checks on a small letting: a sanctions-only approval is not where they stand.
  const stage: AmlStage | null = fullOnSmall && cp.approvalScope === "sanctions_only" && (!row || row.stage === "approved" || row.stage === "expiring")
    ? (pre?.ranAt ? "bgp_checked" : "not_started")
    : row?.stage ?? fallbackStage(cp);
  const allFlags = data.redFlags?.parties[cp.id] || [];
  const flags = allFlags.filter(f => !f.factor);
  const factors = allFlags.filter(f => f.factor);
  const dealFactors = (data.redFlags?.deal || []).filter(f => f.factor);
  const aside = data.redFlags?.setAside?.[cp.id] || [];
  const level = data.redFlags?.levels?.[cp.id] || null;
  const decision = data.decisions?.parties[cp.id];
  const canSignOff = !!(data.decisions?.canSignOff ?? data.decisions?.canDecide);
  const canDecide = !!data.decisions?.canDecide;
  const sanctionsOnly = smallLetting && !fullOnSmall;
  const isCompany = party ? party.brand.kind === "company" : true;
  const simple = smallLetting && !isTrust && !fullView;
  const officer = useAmlOfficerLabel();
  // A UK public body: simplified due diligence, no company that signs (23 November 2026).
  const isPublicBody = !!party?.brand.recordPublicBody && !party?.company;
  // A trust's structure, recorded by BGP (23 November 2026): checked by the officers, never KYC4U.
  const trustQ = useTrustStructure(cp.id, staff && isTrust);
  const trustRecordedGaps = isTrust ? (trustQ.data?.gaps || []).filter(g => g.from === "recorded").map(g => g.words) : [];
  // A trust in the ownership (25 November 2026): Jack's trust record, kept on a record of its own.
  const ownershipTrust = useOwnershipTrust(dealId, cp.role, staff && !isTrust && !sanctionsOnly);
  // Owned through a company registered abroad: the officers find the people behind it.
  const ownedAbroad = pre?.company?.ownersAbroad || [];
  // What the app traced past Companies House and what BGP recorded (21 November 2026).
  const traceLines = pre?.company?.trace || pre?.trace || [];
  const showAbroad = staff && (party ? party.brand.kind === "company" : true) && (ownedAbroad.length > 0 || traceLines.length > 0 || !!pre?.company?.partnership);
  const abroadQ = useDealAbroad(dealId, cp.role, showAbroad);
  const companyMissing = party ? party.brand.kind === "company" && !party.company && !isTrust && !isPublicBody : pre?.state === "needs_company";
  const people = checks?.people?.[cp.id] || null;
  const requests = (checks?.requests || []).filter(r => r.companyId === cp.id && !r.person);
  const request = requests.find(r => r.status !== "cancelled") || null;
  const owing = people ? people.people.filter(p => p.outstanding.length) : [];
  const unreachable = party && people ? peopleToReach(people.people, party.people, personNamesMatch) : [];
  const draft = (drafts.data || []).find((d: any) => d.status !== "cancelled") || null;
  // Only a request submitted on KYC4U's portal is with them; one prepared and
  // never submitted for 30 days is stale and offered to cancel (20 November 2026).
  const draftState = kyc4uDraftState(draft);
  // Through the party's own agent nobody at the party is needed (23 November 2026).
  const agentRoute = !!request?.viaAgent || (!request && !!theirAgent?.firm && (!party?.person || askRelation === "own_agent" || askRelation === "joint_agent"));
  const gaps = agentRoute ? [] : (party?.gaps || []).filter(g => g.key !== "company")
    .map(g => (g.key === "person" ? "Set who to ask" : `Add an email for ${party?.person?.name || "the person to ask"}`));
  const current = jointParty ? currentJointRequest(jointParty) : null;

  const facts: AmlBoxFacts = {
    role: cp.role, stage, due: row ? row.due : null,
    approvedBy: cp.kyc_approved_by, expiresAt: cp.kyc_expires_at, notRequiredWords: cp.notRequired?.reasonWords || null,
    notRequiredReason: cp.notRequired?.reason || null,
    company: isCompany, companyMissing, gaps, askName: askRelation === "own_agent" || askRelation === "joint_agent" ? null : party?.person?.name || null, theirAgent: theirAgent?.firm || null,
    askJointAgent: askRelation === "joint_agent" ? party?.person?.name || null : null,
    precheckRunning: pre?.state === "running",
    redFlags: flags.length, factors: factors.length + dealFactors.length,
    sanctionsOnly, clientChecks: !!data.clientChecks,
    // Through the party's agent: the agent until they pass it on (23 November 2026).
    request: request ? { status: request.status as NonNullable<AmlBoxFacts["request"]>["status"], to: request.viaAgent
      ? (request.viaAgent.passedOn.length ? request.recipientName || request.viaAgent.passedOn[request.viaAgent.passedOn.length - 1].name : firmShort(request.viaAgent.firm))
      : request.recipientName || request.recipientEmail } : null,
    people: owing.map(p => ({ name: personDisplayName(p.name), needs: [...p.outstanding], reachable: !unreachable.includes(p), linked: !!p.own })),
    canSignOff, canDecide,
    signOffBlocked: decision ? decision.blocked : data.decisions ? "This party could not be read." : null,
    needsNote: !!decision?.needsNote,
    billingDiffers: !!party?.client && party.billing?.state === "different",
    trust: isTrust,
    trustGaps: trustRecordedGaps,
    ownershipTrustGaps: !isTrust && !sanctionsOnly ? ownershipTrust.data?.view?.gaps || [] : [],
    publicBodyHint: !!party?.brand.publicBodyHint && !party?.brand.recordPublicBody,
    ownersAbroad: ownedAbroad.length ? ownedAbroad.map(a => `${a.name}, ${a.country}`).join("; ") : null,
    reliance: people?.reliance?.words || null,
    relianceFirm: people?.reliance?.firm || null,
    inHouseEdd: true,
    sanctionsFlags: [...flags, ...(data.redFlags?.deal || [])].filter(isSanctionsFlag).length,
    joint: jointBoxFacts(jointQ.data, cp.id),
    // A private individual's date of birth, before a sanctions-only sign-off (24 November 2026).
    dobNeeded: !settled && !!decision?.person?.needed && !decision.person.details,
  };
  const step = amlNextStep(facts);

  const nextAction: ReactNode = (() => {
    const quiet = "h-7 text-xs bg-background";
    if (mirror) return step.action
      ? <Button type="button" size="sm" variant="outline" className={quiet} onClick={() => mirror(cp.role)} data-testid={`aml-next-open-board-${cp.role}`}>Do it on the AML board</Button>
      : null;
    switch (step.action) {
      case "trust": return <Button type="button" size="sm" variant="outline" className={quiet} onClick={() => reveal("signs")} data-testid={`aml-next-trust-${cp.role}`}>Add trust information</Button>;
      case "person_details": return <Button type="button" size="sm" variant="outline" className={quiet} onClick={() => reveal("signs")} data-testid={`aml-next-dob-${cp.role}`}>Add it</Button>;
      case "fill_in": return <Button type="button" size="sm" variant="outline" className={quiet} onClick={() => setEditing(true)} data-testid={`aml-next-fill-${cp.role}`}>Fill in</Button>;
      case "add_details": return <Button type="button" size="sm" variant="outline" className={quiet} onClick={() => setEditing(true)} data-testid={`aml-next-details-${cp.role}`}>Add details</Button>;
      case "send_client_checks": return <SendClientChecksButton dealId={dealId} companyId={cp.id} partyName={partyName} className={quiet} agent={theirAgent} viaAgent={!!request?.viaAgent} onJointAgent={jointAsk} />;
      case "send_via_agent": return <SendClientChecksButton dealId={dealId} companyId={cp.id} partyName={partyName} className={quiet} label="Send" agent={theirAgent} viaAgent />;
      case "people": return <Button type="button" size="sm" variant="outline" className={quiet} onClick={() => reveal("documents")} data-testid={`aml-next-people-${cp.role}`}>Open</Button>;
      case "sign_off": return <PartyDecisionButton dealId={dealId} data={data} companyId={cp.id} role={cp.role} partyName={partyName} kind="sign_off" full={fullOnSmall} />;
      case "red_flags": return <Button type="button" size="sm" variant="outline" className={quiet} onClick={() => reveal("screening")}>See flags</Button>;
      case "billing": return <Button type="button" size="sm" variant="outline" className={quiet} onClick={() => reveal("signs")} data-testid={`aml-next-billing-${cp.role}`}>Who pays</Button>;
      case "joint": return <Button type="button" size="sm" variant="outline" className={quiet} onClick={() => reveal("documents")} data-testid={`aml-next-joint-${cp.role}`}>Open</Button>;
      case "joint_ask": return jointQ.data && askParty
        ? <AskJointAgentButton dealId={dealId} view={jointQ.data} party={askParty} label="Ask them" quiet
            person={party?.person ? { id: party.person.id, name: party.person.name, email: party.person.email, firm: party.person.firm || null } : null} />
        : <Button type="button" size="sm" variant="outline" className={quiet} onClick={() => reveal("documents")} data-testid={`aml-next-joint-ask-${cp.role}`}>Open</Button>;
      case "joint_remind": return jointParty && current
        ? <JointChaseButton dealId={dealId} party={jointParty} request={current} label={facts.joint?.chasing ? "Remind now" : "Ask for them"} onNoEmail={() => reveal("documents")} />
        : null;
      default: return null;
    }
  })();

  // ── The four steps' lines, by the one rule every AML screen uses (shared/aml-steps.ts).
  const reg = pre?.company || null;
  const charity = pre?.charity?.state === "found" ? pre.charity : null;
  const regWarning = reg?.warnings[0] || charity?.warnings[0] || null;
  // Nobody is asked anything on a sanctions-only letting.
  const askMissing = !!party && !party.person && !sanctionsOnly;
  const askNoEmail = !!party?.person && !party.person.email && !sanctionsOnly;
  // The guarantors (23 November 2026): named on the line, and to do while BGP's checks on one have not run.
  const guarantors = party?.guarantors || [];
  const guarantorOpen = guarantors.some(g => g.checks.state === "not_run" || g.checks.state === "stale");
  // The other companies that sign for the party (24 November 2026): the same way.
  const otherSigners = party?.signers || [];
  const signerOpen = otherSigners.some(g => g.checks.state === "not_run" || g.checks.state === "stale");
  const signs = companyStepLine({
    missing: companyMissing,
    kind: !isCompany && !party?.company ? "a person" : isPublicBody ? "a UK public body"
      : isTrust ? `a trust${trustQ.data ? `: ${trustSummary(trustQ.data)}` : ""}` : charity ? `charity ${charity.number}` : null,
    warning: regWarning,
    gaps: settled ? [] : [
      askMissing ? "who to ask not set" : null,
      askNoEmail ? `no email for ${party!.person!.name}` : null,
      facts.billingDiffers ? "BGP bills another company" : null,
      trustRecordedGaps.length ? "trust information to add" : null,
      facts.dobNeeded ? "date of birth to add" : null,
      guarantorOpen ? "guarantor checks to run" : null,
      signerOpen ? "checks to run on the other contracting entity" : null,
    ].filter((g): g is string => !!g),
    notes: [
      decision?.person?.details && decision.person.words ? decision.person.words.replace(/^Born /, "born ") : null,
      party?.person && !askNoEmail && !sanctionsOnly && !settled ? `ask ${party.person.name}` : null,
      ownedAbroad.length ? "owned from abroad" : null,
      otherSigners.length ? `also signs: ${otherSigners.map(g => g.name).join(", ")}` : null,
      guarantors.length ? `guarantor${guarantors.length > 1 ? "s" : ""}: ${guarantors.map(g => g.name).join(", ")}` : null,
    ].filter((g): g is string => !!g),
  });

  const unchecked = data.redFlags?.unchecked || [];
  const flagAside = aside.filter(a => !a.flag.factor).length;
  const run: ScreeningRun = !pre || pre.state === "off" ? "off" : pre.state === "needs_company" ? "needs_company" : pre.state === "running" ? "running"
    : pre.state === "cap" ? "cap" : pre.state === "none" ? "none" : pre.unfinished || pre.state === "waiting" ? "unfinished" : "done";
  // A list or ComplyAdvantage failed someone: not a clear screen (22 November 2026).
  const failedLine = pre?.lines.find(l => l.failed) || null;
  const screening = screeningStepLine({
    run, ranAt: pre?.ranAt || null, redFlags: flags.map(f => f.label),
    attention: pre ? pre.lines.filter(l => l.state === "attention").length : 0,
    failed: failedLine ? (failedLine.key === "sanctions" ? "sanctions" : "provider") : null,
    enhanced: level?.level === "enhanced", setAside: flagAside, unread: unchecked.length > 0, flagsRead: !!data.redFlags,
  });

  const jointMissing = jointParty && current && current.files.length ? Math.max(0, jointParty.gaps.filter(g => !/reliance terms$/.test(g)).length - (jointParty.unread ? 1 : 0)) : 0;
  const letting = data.jointRule === "letting" || data.jointRule === "other";
  const documents = documentsStepLine({
    notRequired: !!cp.notRequired, sanctionsOnly, cleared: approved, reliance: people?.reliance?.firm || null,
    joint: current && jointParty ? {
      firm: current.firm, who: current.who || null, sentAt: current.sentAt || null,
      status: current.status === "not_sent" || current.status === "expired" || current.status === "sent" || current.status === "opened" ? current.status : "in",
      unread: jointParty.unread || 0, missing: jointMissing, chasing: !!current.nextChaseAt, termsPending: letting && !current.reliance,
    } : null,
    request: request ? { status: request.status as ClientRequestStatus, who: request.recipientName || request.recipientEmail || "the client", sentAt: request.sentAt || null } : null,
    people: people ? { total: people.people.length, owing: owing.length } : null,
    companyMissing, clientChecks: !!data.clientChecks,
  });

  // The simple view's second step: the sanctions screen alone.
  const sanctionsFlagCount = [...flags, ...(data.redFlags?.deal || [])].filter(isSanctionsFlag).length;
  const sanctionsLine = pre?.lines.find(l => l.key === "sanctions") || null;
  const sanctionsStep = sanctionsStepLine({
    run: companyMissing ? "needs_company" : run === "unfinished" ? "done" : run, ranAt: pre?.ranAt || null,
    match: sanctionsFlagCount > 0, read: !!sanctionsLine && !sanctionsLine.failed, officer,
  });
  const gateStep = simple ? sanctionsStep : screening;

  const decisionStep = signOffStepLine({
    rejected: stage === "rejected",
    notRequired: cp.notRequired ? (NOT_REQUIRED_SHORT[cp.notRequired.reason || ""] || "") : null,
    approved: approved ? { by: cp.kyc_approved_by || null, until: cp.kyc_expires_at || null } : null,
    expired: cp.isExpired ? { on: cp.kyc_expires_at || null } : null,
    companyMissing, screeningPending: !!gateStep?.pending, sanctionsView: simple,
    documentsDone: documents.state === "done", decisionRead: !!decision,
    blocked: decision?.blocked ?? null, edd: !!decision?.edd, canDecide, canSignOff, needsNote: !!decision?.needsNote,
  });

  const aml = partyAmlFacts(data, cp.id);
  const sid = (k: StepKey) => `aml-${cp.id}-${k}`;
  const tid = (k: StepKey) => `aml-step-${cp.role}-${k}`;
  const roleLabel = slot?.label || (cp.role.charAt(0).toUpperCase() + cp.role.slice(1));

  // The joint agent route: the officers' button beside the evidence.
  // A reliance agreed before 23 November 2026 can still be recorded; a sale is
  // signed off on BGP's own check of the documents, as a letting is (policy Issue 4).
  const jointDecide = canDecide && current && jointQ.data && current.reliance && !people?.reliance
    ? <JointRelianceButton dealId={dealId} role={cp.role} partyName={partyName} gaps={jointParty?.gaps || []} joint={{
            ref: current.ref, firm: current.reliance.firm, supervisor: current.reliance.supervisor, registration: current.reliance.registration,
            contact: [current.reliance.name, current.reliance.position].filter(Boolean).join(", "), agreedOn: current.reliance.agreedAt.slice(0, 10),
          }} />
    : null;
  // KYC4U is no longer used (Woody, 23 November 2026): a request made before
  // then is history on the party, and holds nothing up.
  const clientRoute = !!request || (!current && !people?.reliance);
  // Joint agent under Other ways asks them for the documents by email; reliance is not offered (Woody, 23 November 2026: "we cant agree reliance").

  // The Next box always shows, "Cleared · until …" included: it is the party's status (24 November 2026).
  const nextLine = (
    <AmlNextBox tone={step.tone} lead={step.lead} words={step.words} action={nextAction} who={AML_BOX_WHO_WORDS[step.who]}
      testId={`aml-next-${cp.role}`} wordsTestId={`aml-next-words-${cp.role}`} />
  );

  // When the checks must be complete (Issue 4 of BGP's policy), and in red once
  // the transaction has passed that point with the party not decided.
  const sanctionsOnlyLine = cp.sanctionsOnlyApproval ? (
    <p className="text-xs text-amber-800 dark:text-amber-300" data-testid={`aml-sanctions-only-approval-${cp.role}`}>
      Signed off{cp.sanctionsOnlyApproval.at ? ` ${amlBoxDay(cp.sanctionsOnlyApproval.at)}` : ""}{cp.sanctionsOnlyApproval.by ? ` by ${cp.sanctionsOnlyApproval.by}` : ""} for sanctions checks only, on a smaller letting. This transaction needs the full checks.
    </p>
  ) : null;
  // KYC4U's past checks on this party, by the brand or a company it names (Woody,
  // 25 November 2026, on Karve: "we at least need to match KYC4U historic data
  // base so we know if its been considered"). KYC4U's folders carry no verdict:
  // their result is recorded by an admin, under Documents.
  const kyc4uPast = (kyc4uQ.data?.requests || []).filter(r => r.listId !== "manual");
  const kyc4uRecorded = (kyc4uQ.data?.requests || []).some(r => r.listId === "manual");
  const kyc4uLine = staff && kyc4uPast.length > 0 && !settled ? (
    <button type="button" className="block text-left text-xs text-amber-800 hover:underline dark:text-amber-300" onClick={() => reveal("documents")} data-testid={`aml-kyc4u-considered-${cp.role}`}>
      KYC4U considered it: {kyc4uPast.slice(0, 2).map(r => `${r.itemId}${r.entityName ? ` ${r.entityName}` : ""}${r.createdAt || r.modifiedAt ? `, ${amlBoxDay(String(r.createdAt || r.modifiedAt))}` : ""}`).join("; ")}
      {kyc4uPast.length > 2 ? ` and ${kyc4uPast.length - 2} more` : ""}. {kyc4uRecorded ? "A KYC4U result is recorded." : "Their result isn't recorded in the app yet."}
    </button>
  ) : null;
  const deadline = row && !settled && !cp.notRequired && row.deadline ? (
    <p className={`text-xs ${row.late ? "font-medium text-red-700 dark:text-red-300" : "text-muted-foreground"}`} data-testid={`aml-deadline-${cp.role}`}>
      {row.late ? "Late: needed " : "Needed "}{row.deadline}
    </p>
  ) : null;

  // The heading leads with the company being checked, as the client KYC window
  // does; the role, the brand and its register sit in grey under it (Woody, 24
  // November 2026). With no company that signs set, the heading is the brand.
  const company = party?.company || null;
  const register = company
    ? (company.kind === "individual" ? "a person" : company.abroad ? [company.abroad.country, company.abroad.registrationNumber].filter(Boolean).join(" · ")
      : company.companiesHouseNumber ? `Companies House ${company.companiesHouseNumber}` : null)
    : charity ? `charity ${charity.number}` : null;
  const isClient = !!(slot?.client ?? party?.client);
  const subParts: ReactNode[] = [
    roleLabel,
    partyName !== cp.name ? <Link key="brand" href={`/companies/${cp.id}`} className="hover:underline" data-testid={`aml-box-brand-${cp.role}`}>{cp.name}</Link> : null,
    isClient ? "BGP's client" : null,
    register,
    companyMissing ? "the contracting entity is not set yet" : null,
  ].filter(Boolean);

  return (
    <div className="min-w-0 rounded-lg border border-border bg-card" data-testid={`counterparty-${cp.id}`}>
      <div className="space-y-2 px-4 pt-3 pb-2">
        <div className="flex items-start gap-2">
          {staff ? (
            <button type="button" data-no-min-touch onClick={() => setFolded(f => !f)} aria-expanded={!folded} aria-label={folded ? "Show this party's checks" : "Hide this party's checks"} className="mt-1 shrink-0 rounded text-muted-foreground hover:text-foreground" data-testid={`aml-box-unfold-${cp.role}`}>
              <ChevronDown className={`h-4 w-4 transition-transform ${folded ? "-rotate-90" : ""}`} />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {partyName === cp.name
                ? <Link href={`/companies/${cp.id}`} className="min-w-0 break-words text-base font-semibold hover:underline" data-testid={`aml-box-title-${cp.role}`}>{partyName}</Link>
                : <span className="min-w-0 break-words text-base font-semibold" data-testid={`aml-box-title-${cp.role}`}>{partyName}</span>}
              {staff && !mirror && slot?.change}
              <span className="ml-auto flex flex-wrap items-center gap-1.5">
                <RedFlagChip count={flags.length} onClick={() => reveal("screening")} testId={`aml-box-flags-${cp.role}`} />
                {level && !cp.notRequired && <AmlLevelChip level={level.level} testId={`aml-box-level-${cp.role}`} />}
              </span>
            </div>
            <div className="text-sm text-muted-foreground" data-testid={`aml-box-sub-${cp.role}`}>
              {subParts.map((part, i) => <span key={i}>{i ? " · " : ""}{part}</span>)}
            </div>
          </div>
        </div>
        {nextLine}
        {sanctionsOnlyLine}
        {kyc4uLine}
        {deadline}
        {/* Simplified due diligence, said out loud, with its note of reasons (Layla, 23 November 2026). */}
        {staff && !mirror && level?.level === "simplified" && level.sdd && !cp.notRequired && (
          <SddBox dealId={dealId} role={cp.role} roleLabel={roleLabel} sdd={level.sdd} partyName={partyName}
            dealName={row?.dealName || null} dealRef={row?.dealRef || null} contactName={party?.person?.name || null} isClient={!!party?.client} canSave={canSignOff} />
        )}
      </div>

      {staff && !folded && (
        <div className={`px-4 pb-2${mirror ? " aml-view-only" : ""}`} data-testid={`aml-steps-${cp.role}`} data-view-only={mirror ? "true" : undefined}>
          <AmlStep id={sid("signs")} testId={tid("signs")} n={1} label={!isCompany && !company ? AML_STEP_LABEL.person : company?.kind === "individual" ? AML_STEP_LABEL.person : AML_STEP_LABEL.company}
            state={signs.state} summary={signs.words} open={open.has("signs")} onToggle={() => toggle("signs")}>
            {/* Change the company, run BGP's checks again, or open it in the CRM, from the step itself (Woody, 25 November 2026). */}
            <CompanyStepActions dealId={dealId} companyId={cp.id} role={cp.role} canRun={!!pre && pre.state !== "off"} onChange={() => setEditing(true)} />
            {settled && companyMissing
              ? <p className="text-xs text-muted-foreground">Not set on this transaction.</p>
              : <DealPartyLines dealId={dealId} role={cp.role as DealPartyRole} aml={aml} fullBilling />}
            {/* The joint agent beside who to ask (Woody, 25 November 2026: "we need to send to joint agent ... the joint agent should upload the details"). */}
            {jointAsk && !settled && !sanctionsOnly && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid={`aml-joint-ask-line-${cp.role}`}>
                <span>Or the joint agent uploads their documents:</span>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={jointAsk} data-testid={`aml-joint-ask-${cp.role}`}>Ask the joint agent</Button>
              </div>
            )}
            {decision?.person && (
              <PersonDetailsLine view={decision.person} url={`/api/deals/${dealId}/parties/${cp.role}/person-details`} testKey={cp.role}
                onSaved={() => {
                  queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
                }} />
            )}
            {party && !settled && <PublicBodyLine dealId={dealId} party={party} compact />}
            {party && !settled && <TrustLine dealId={dealId} party={party} compact />}
            {isTrust && <TrustStructurePanel companyId={cp.id} dealId={dealId} partyName={partyName} onPeople={() => reveal("documents")} />}
            {!isTrust && !sanctionsOnly && <OwnershipTrustPanel dealId={dealId} role={cp.role} />}
            {showAbroad && (
              <div className="space-y-1.5" data-testid={`aml-abroad-${cp.role}`}>
                {/* The party itself registered abroad, with no UK record (23 November 2026): not a parent. */}
                <SubHead>{pre?.company?.partnership ? "Partners" : abroadQ.data?.trace?.party ? "Registered abroad" : ownedAbroad.length ? "Owners abroad" : "Parent companies"}</SubHead>
                <AbroadTrace dealId={dealId} role={cp.role} query={abroadQ} sanctionsOnly={sanctionsOnly} />
              </div>
            )}
            {/* The company as the register gives it, in the same list as the client KYC window. */}
            {reg && <div data-testid={`aml-company-details-${cp.role}`}><PartyCompanyFacts data={data} companyId={cp.id} /></div>}
            {pre?.charity && <PartyCharityFacts data={data} companyId={cp.id} />}
            {!reg && pre?.gleif && <p className="text-xs text-muted-foreground">{pre.gleif}</p>}
          </AmlStep>
          {simple ? (
            <>
              <AmlStep id={sid("screening")} testId={`aml-step-${cp.role}-sanctions`} n={2} label={AML_STEP_LABEL.sanctions} state={sanctionsStep.state} summary={sanctionsStep.words} open={open.has("screening")} onToggle={() => toggle("screening")}>
                <PartyPrechecks dealId={dealId} data={data} companyId={cp.id} only={["sanctions"]} />
                {sanctionsFlagCount > 0 && <PartyRedFlags dealId={dealId} data={data} companyId={cp.id} role={cp.role} only="flags" sanctionsOnly />}
              </AmlStep>
              <AmlStep id={sid("decision")} testId={tid("decision")} n={3} label={AML_STEP_LABEL.signOff} state={decisionStep.state} summary={decisionStep.words} open={open.has("decision")} onToggle={() => toggle("decision")}>
                <PartyNotRequiredBox cp={cp} />
                <PartyDecisions dealId={dealId} data={data} companyId={cp.id} role={cp.role} partyName={partyName} approved={approved} notRequired={!!cp.notRequired} notRequiredByRule={cp.notRequired?.reason === "advisory_other_side"} pastKyc4u={!!draft} full={fullOnSmall} />
                {canDecide && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid={`aml-file-line-${cp.role}`}>
                    <AmlFileButton dealId={dealId} role={cp.role} partyName={partyName} />
                  </div>
                )}
              </AmlStep>
            </>
          ) : (
            <>
            {screening && (
              <AmlStep id={sid("screening")} testId={tid("screening")} n={2} label={AML_STEP_LABEL.screening} state={screening.state} summary={screening.words} open={open.has("screening")} onToggle={() => toggle("screening")}>
                {/* Run again and the level first, then each check, then the red flags: the client KYC window's order. */}
                <PartyPrechecks dealId={dealId} data={data} companyId={cp.id} level={cp.notRequired ? null : level} />
                {(flags.length > 0 || flagAside > 0) && <PartyRedFlags dealId={dealId} data={data} companyId={cp.id} role={cp.role} only="flags" />}
                {level && !cp.notRequired && <PartyRedFlags dealId={dealId} data={data} companyId={cp.id} role={cp.role} only="factors" />}
                {unchecked.length > 0 && <p className="text-xs text-amber-800 dark:text-amber-300">Not read: {unchecked.join(", ")}.</p>}
              </AmlStep>
            )}
            <AmlStep id={sid("documents")} testId={tid("documents")} n={3} label={AML_STEP_LABEL.documents} state={documents.state} summary={documents.words} open={open.has("documents")} onToggle={() => toggle("documents")}>
              {/* Every file on the party's record as a thumbnail that pops out (Woody, 23 November 2026). */}
              <PartyFiles dealId={dealId} role={cp.role} />
              {kyc4uPast.length > 0 && <Kyc4uStatusStrip companyId={cp.id} party={{ dealId, role: cp.role }} />}
              {companyMissing && !current
                ? <p className="text-xs text-muted-foreground" data-testid={`kyc-actions-wait-${cp.id}`}>Starts once the contracting entity is set.</p>
                : <>
                    {people?.reliance && <RelianceCard dealId={dealId} role={cp.role} reliance={people.reliance} canDecide={canDecide} />}
                    {jointParty && jointQ.data && current && !settled && <JointAgentPanel dealId={dealId} view={jointQ.data} party={jointParty} decide={jointDecide} />}
                    {draft && (
                      <p className="text-xs text-muted-foreground" data-testid={`aml-kyc4u-${cp.role}`}>
                        KYC4U (no longer used): a request was {draftState === "submitted"
                          ? `submitted${draft.submitted_at ? ` on ${day(draft.submitted_at)}` : ""}${draft.submitted_ref ? ` (${draft.submitted_ref})` : ""}`
                          : `prepared${draft.created_at ? ` on ${day(draft.created_at)}` : ""} and not submitted`}. It holds nothing up; anything KYC4U sent stays on the party's record.
                      </p>
                    )}
                    {data.clientChecks && clientRoute && !people?.reliance && (
                      <div className="space-y-1.5" data-testid={`aml-client-route-${cp.role}`}>
                        {(request || (people && people.people.length > 0)) && (current || draft) && <SubHead>Client checks</SubHead>}
                        {!request && !cp.notRequired && !sanctionsOnly && <SendClientChecksButton dealId={dealId} companyId={cp.id} partyName={partyName} className="h-7 text-xs" agent={theirAgent} onJointAgent={jointAsk} />}
                        <ClientChecksForParty dealId={dealId} companyId={cp.id} sanctionsOnly={sanctionsOnly} notRequired={!!cp.notRequired} canDecide={canDecide} part="people" />
                        <ClientChecksForParty dealId={dealId} companyId={cp.id} sanctionsOnly={sanctionsOnly} notRequired={!!cp.notRequired} canDecide={canDecide} part="requests" />
                        {request && <SendClientChecksButton dealId={dealId} companyId={cp.id} partyName={partyName} label="Send them again" className="h-7 text-xs" agent={theirAgent} viaAgent={!!request.viaAgent} />}
                      </div>
                    )}
                    {/* Certified copies and other documents BGP holds, read and checked (23 November 2026). */}
                    <PartyDocumentsBox dealId={dealId} role={cp.role} partyName={partyName} canDecide={canDecide} />
                    {!settled && (
                      <div className="flex flex-wrap items-center gap-1 border-t border-border/60 pt-2 text-xs text-muted-foreground" data-testid={`aml-other-ways-${cp.role}`}>
                        <span className="mr-1">Other ways:</span>
                        {!clientRoute && data.clientChecks && !sanctionsOnly && <SendClientChecksButton dealId={dealId} companyId={cp.id} partyName={partyName} label="Client checks" className="h-7 px-2 text-xs" quiet agent={theirAgent} onJointAgent={jointAsk} />}
                        {!request && data.clientChecks && !sanctionsOnly && !cp.notRequired && theirAgent && askParty && <SendClientChecksButton dealId={dealId} companyId={cp.id} partyName={partyName} label={askAgentLabel(askParty)} className="h-7 px-2 text-xs" quiet agent={theirAgent} viaAgent />}
                        {!current && jointQ.data && askParty && <AskJointAgentButton dealId={dealId} view={jointQ.data} party={askParty} label="Joint agent" quiet />}
                        {/* The report so far, with what is still needed, for a supplier if the officers ever use one (Woody, 23 November 2026). */}
                        {canDecide && <AmlFileButton dealId={dealId} role={cp.role} partyName={partyName} label="Report so far" quiet />}
                      </div>
                    )}
                  </>}
            </AmlStep>
            <AmlStep id={sid("decision")} testId={tid("decision")} n={4} label={AML_STEP_LABEL.signOff} state={decisionStep.state} summary={decisionStep.words} open={open.has("decision")} onToggle={() => toggle("decision")}>
              <PartyNotRequiredBox cp={cp} />
              <PartyDecisions dealId={dealId} data={data} companyId={cp.id} role={cp.role} partyName={partyName} approved={approved} notRequired={!!cp.notRequired} notRequiredByRule={cp.notRequired?.reason === "advisory_other_side"} pastKyc4u={!!draft} full={fullOnSmall} />
              {canDecide && !cp.notRequired && (
                <Folded label="Risk assessment" testId={`aml-assessment-${cp.role}`}><PartyRiskAssessment dealId={dealId} role={cp.role} /></Folded>
              )}
              {canDecide && level?.level === "enhanced" && !cp.notRequired && <SecondReadPanel dealId={dealId} role={cp.role} partyName={partyName} trust={isTrust} />}
              {canDecide && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid={`aml-file-line-${cp.role}`}>
                  <AmlFileButton dealId={dealId} role={cp.role} partyName={partyName} />
                  {/* Their documents sent on to another agent for its own checks (Jack, 27 November 2026). */}
                  <AmlShareButton dealId={dealId} role={cp.role} partyName={partyName} />
                </div>
              )}
            </AmlStep>
            </>
          )}
          {smallLetting && !isTrust && (
            <div className="border-t border-border py-1.5 text-[11px]">
              <button type="button" data-view-ok className="text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setFullView(v => !v)} data-testid={`aml-full-view-${cp.role}`}>
                {fullView ? "Show the simple view" : "Show the full checks"}
              </button>
            </div>
          )}
        </div>
      )}
      {askingJoint && jointQ.data && askParty && (
        <AskJointAgentDialog dealId={dealId} view={jointQ.data} party={askParty}
          person={party?.person && (askRelation === "joint_agent") ? { id: party.person.id, name: party.person.name, email: party.person.email || null, firm: party.person.firm || null } : null}
          onClose={() => setAskingJoint(false)} />
      )}
      {editing && <DealPartyEditor dealId={dealId} role={cp.role as DealPartyRole} aml={aml} onClose={() => setEditing(false)} />}
    </div>
  );
}

// The company step's own actions: change who signs, run the checks again, open the record.
function CompanyStepActions({ dealId, companyId, role, canRun, onChange }: { dealId: string; companyId: string; role: string; canRun: boolean; onChange: () => void }) {
  const { toast } = useToast();
  const again = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/kyc/deal/${dealId}/prechecks`, { companyId })).json(),
    onSuccess: (r: any) => {
      const state = r?.started?.[companyId];
      if (state === "cap") toast({ title: "Not run", description: "Today's limit for these checks is used up. They run again tomorrow." });
      else if (state === "needs_company") toast({ title: "Not run", description: "Set the contracting entity for this party first." });
      else toast({ title: "Running BGP's checks", description: "Companies House, the sanctions lists and the web search: a minute or two." });
      queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
    },
    onError: (e: any) => toast({ title: "Not run", description: String(e?.message || e), variant: "destructive" }),
  });
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid={`aml-company-actions-${role}`}>
      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onChange} data-testid={`aml-company-change-${role}`}>Change the company</Button>
      {canRun && (
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={again.isPending} onClick={() => again.mutate()} data-testid={`aml-company-run-${role}`}>
          {again.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Run the checks again
        </Button>
      )}
      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" asChild>
        <Link href={`/companies/${companyId}`} data-testid={`aml-company-crm-${role}`}>Open in the CRM</Link>
      </Button>
    </div>
  );
}

// A slot with no party yet: its role and the picker to link one.
function UnsetPartyRow({ slot, mirror }: { slot: PartySlot; mirror?: (role: string) => void }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-card px-3 py-2.5" data-testid={`aml-party-unset-${slot.role}`}>
      <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{slot.label}</span>
      {slot.client && <span className="text-xs text-muted-foreground">BGP's client</span>}
      <div className="min-w-0 flex-1">{mirror
        ? <button type="button" className="text-sm text-muted-foreground hover:text-foreground hover:underline" onClick={() => mirror(slot.role)} data-testid={`aml-party-unset-open-${slot.role}`}>Not set · set it on the AML board</button>
        : slot.picker}</div>
    </div>
  );
}

// The box's menu: everyone's tools, then the officers'.
function AmlBoxMenu({ dealId, openAll, onToggleAll, officer, staff }: { dealId: string; openAll: boolean; onToggleAll: () => void; officer: boolean; staff: boolean }) {
  const [, navigate] = useLocation();
  const [report, setReport] = useState(false);
  const [stopping, setStopping] = useState(false);
  const stop = useAmlStop(dealId, staff);
  if (!staff) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" data-testid="aml-box-menu">More<ChevronDown className="ml-1 h-3.5 w-3.5" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onSelect={onToggleAll} data-testid="aml-box-open-all">{openAll ? "Hide the detail" : "Show all detail"}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate("/deals/aml?section=rules")} data-testid="aml-box-rules">The rules in short</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setReport(true)} data-testid="deal-aml-raise-report">Report a concern to the Nominated Officer</DropdownMenuItem>
          {officer && stop.data && !stop.data.stopped && stop.data.canDecide && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-700 focus:text-red-800 dark:text-red-400" onSelect={() => setStopping(true)} data-testid="aml-stop-open">Stop acting on this transaction</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {report && <RaiseReportDialog dealId={dealId} officer={officer} onClose={() => setReport(false)} />}
      {stopping && <AmlStopDialog dealId={dealId} onClose={() => setStopping(false)} />}
    </>
  );
}

// focusCompanyId: the AML checks page's party (its trail), drawn first and open;
// the deal's other parties follow, each on its Next line until opened.
// slots: on the deal page, the Parties card merged in (22 November 2026): one
// card per party slot, an unset one with its picker; actingFor: BGP acts for.
// mirror: the transaction page's copy, read only (Woody, 25 November 2026: "all
// amls are being done in the AML pages ... just show it in parties and Aml on the
// transaction page with ability to open the AML board and amend"). It draws the
// same board; every button opens the AML board at that party instead.
export function DealAmlStatusCard({ dealId, focusCompanyId, slots, actingFor, footer, mirror }: {
  dealId: string; dealStatus?: string | null; focusCompanyId?: string | null;
  slots?: PartySlot[] | null; actingFor?: ReactNode; footer?: ReactNode;
  mirror?: (role?: string) => void;
}) {
  const { data, isLoading } = useDealAmlStatus(dealId);
  // BGP's own reads (the checks before asking) come only to BGP staff: the
  // party lines follow them.
  const staffView = !!data?.prechecks;
  const { data: parties } = useDealParties(dealId, staffView);
  // The company on the unit's lease is set as the company that signs by itself (23 November 2026).
  useWorkOutSigningCompanies(dealId, staffView ? parties : undefined);
  const { data: checks } = useClientChecks(dealId, staffView && !!data?.clientChecks);
  const { data: board } = useDealAmlRows(dealId, staffView);
  const { data: agents } = useDealAgentsAml(dealId, staffView);
  const { data: solicitors } = useDealSolicitorsAml(dealId, staffView);
  const stopQ = useAmlStop(dealId, staffView);
  const [openAll, setOpenAll] = useState<OpenAll>(() => ({ all: readOpenAll(), at: 0 }));
  const deal = useOpenSections<"deal" | "agents" | "solicitors">(["deal", "agents", "solicitors"], openAll);

  if (isLoading) return (
    <Card><CardContent className="py-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin" /></CardContent></Card>
  );
  if (!data) return null;

  const toggleAll = () => setOpenAll(o => { const all = !o.all; writeOpenAll(all); return { all, at: o.at + 1 }; });
  const officer = !!data.decisions?.canDecide;
  const cps = focusCompanyId
    ? [...data.counterparties].sort((a, b) => Number(b.id === focusCompanyId) - Number(a.id === focusCompanyId))
    : data.counterparties;
  const isSettled = (cp: Counterparty) => (cp.isApproved && !cp.isExpired) || !!cp.notRequired;
  const settled = data.counterparties.filter(isSettled).length;
  const dealFlags = data.redFlags?.deal || [];
  const dealAside = data.redFlags?.dealSetAside || [];
  const agentList = agents?.agents || [];
  // Red for an agent off HMRC's register; a tick when every one is on it (the shared step look).
  const agentState: AmlStepState = agentList.some(a => a.state.tone === "red") ? "flag" : agentList.length && agentList.every(a => a.state.tone === "ok") ? "done" : "todo";
  const agentSummary = agentList.length === 1
    ? `${agentList[0].name}${agentState === "done" ? ": on HMRC's register" : agentState === "flag" ? ": not on HMRC's register" : agentList[0].state.tone === "amber" ? ": check HMRC's register" : ""}`
    : `${plural(agentList.length, "agent")}${agentState === "flag" ? " · one not on HMRC's register" : agentList.some(a => a.state.tone === "amber") ? ` · ${agentList.filter(a => a.state.tone === "amber").length} to check` : agentState === "done" ? " · all on HMRC's register" : ""}`;
  const sol = solicitorsSummary(solicitors);
  const solState: AmlStepState = sol.tone === "done" ? "done" : sol.tone === "flag" ? "flag" : "todo";
  const box = (cp: Counterparty, slot: PartySlot | null) => (
    <PartyAmlBox
      key={`${cp.role}-${cp.id}`}
      dealId={dealId}
      data={data}
      cp={cp}
      row={board?.rows.find(r => r.brandId === cp.id && r.role === cp.role) || null}
      party={parties?.parties.find(p => p.brand.id === cp.id && p.role === cp.role) || parties?.parties.find(p => p.brand.id === cp.id) || null}
      checks={checks}
      openAll={openAll}
      startOpen={focusCompanyId ? cp.id === focusCompanyId : !isSettled(cp)}
      slot={slot}
      mirror={mirror}
    />
  );

  return (
    <Card data-testid="deal-aml-status-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className={`w-4 h-4 ${data.allApproved ? "text-emerald-600" : "text-muted-foreground"}`} />
          <h3 className="font-semibold text-sm">{slots ? "Parties and AML" : "AML"}</h3>
          {data.counterparties.length > 0 && (data.allApproved
            ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200" data-testid="badge-deal-aml-clear"><CheckCircle2 className="w-3 h-3 mr-1" />All cleared</Badge>
            : <Badge variant="secondary" data-testid="badge-deal-aml-blocked">{settled} of {data.counterparties.length} cleared</Badge>)}
          {data.regime?.regime === "sanctions_only" && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground" title={data.regime.why} data-testid="deal-aml-regime">Sanctions only</span>}
          {stopQ.data?.stopped && <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200" data-testid="aml-stop-mark">BGP stopped acting</span>}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {actingFor}
            {mirror ? (
              <Button type="button" size="sm" className="h-7 text-xs" onClick={() => mirror()} data-testid="aml-open-board">Open the AML board</Button>
            ) : (<>
              {officer && data.counterparties.length > 0 && <AmlFileButton dealId={dealId} />}
              <AmlBoxMenu dealId={dealId} openAll={openAll.all} onToggleAll={toggleAll} officer={officer} staff={staffView} />
            </>)}
          </span>
        </div>

        {/* Type the transaction out, or drop the heads of terms (Woody, 23 November 2026). */}
        {staffView && slots && !mirror && <DealDescribeBox dealId={dealId} />}

        {!slots && data.counterparties.length < 2 && (
          <p className="text-xs text-muted-foreground" data-testid="deal-aml-status-incomplete">
            {data.counterparties.length === 0 ? "No parties on this transaction yet." : "Only one party on this transaction so far."}
          </p>
        )}

        <div className="grid grid-cols-1 gap-2">
          {slots
            ? slots.map(slot => {
                const cp = slot.companyId ? data.counterparties.find(c => c.id === slot.companyId && c.role === slot.role) || data.counterparties.find(c => c.id === slot.companyId) : null;
                return cp ? box(cp, slot) : <UnsetPartyRow key={`unset-${slot.role}`} slot={slot} mirror={mirror} />;
              })
            : cps.map(cp => box(cp, null))}
        </div>

        {staffView && data.counterparties.length > 0 && (
          // The transaction's own lines, in the parties' card and step look (24 November 2026).
          <div className={`rounded-lg border border-border bg-card px-4 py-1${mirror ? " aml-view-only" : ""}`} data-testid="aml-deal-sections" data-view-only={mirror ? "true" : undefined}>
            {(dealFlags.length > 0 || dealAside.length > 0) && (
              <AmlStep id={`aml-${dealId}-deal`} testId="aml-section-deal" label="The transaction" state={dealFlags.some(f => !f.factor) ? "flag" : dealFlags.length ? "todo" : "done"}
                summary={dealFlags.length ? `${plural(dealFlags.length, "red flag")}: ${shortReason(dealFlags[0].label, 60)}` : `${dealAside.length} set aside`}
                open={deal.open.has("deal")} onToggle={() => deal.toggle("deal")}>
                <DealRedFlags dealId={dealId} data={data} />
              </AmlStep>
            )}
            {agentList.length > 0 && (
              <AmlStep id={`aml-${dealId}-agents`} testId="aml-section-agents" label="Agents" state={agentState} summary={agentSummary}
                open={deal.open.has("agents")} onToggle={() => deal.toggle("agents")}>
                <DealAgentsAml dealId={dealId} bare />
              </AmlStep>
            )}
            {/* The other side's solicitors (21 November 2026, "do 7"). */}
            <AmlStep id={`aml-${dealId}-solicitors`} testId="aml-section-solicitors" label="Solicitors" state={solState} summary={sol.words}
              open={deal.open.has("solicitors")} onToggle={() => deal.toggle("solicitors")}>
              <DealSolicitorsAmlPanel dealId={dealId} />
            </AmlStep>
          </div>
        )}
        {staffView && !mirror && data.counterparties.length > 0 && <AmlCompleteButton dealId={dealId} ready={data.allApproved} missing={data.missing || []} />}
        {footer}
      </CardContent>
    </Card>
  );
}

// Complete (Jack, 26 November 2026): grey until every party is cleared or
// needs no checks, then pressed once; the transaction's history keeps who and when.
function AmlCompleteButton({ dealId, ready, missing }: { dealId: string; ready: boolean; missing: string[] }) {
  const { toast } = useToast();
  const key = ["/api/deals", dealId, "aml-complete"];
  const q = useQuery<{ complete: { by: string | null; at: string } | null }>({
    queryKey: key, enabled: !!dealId, staleTime: 30_000,
    queryFn: async () => (await apiRequest("GET", `/api/deals/${dealId}/aml-complete`)).json(),
  });
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/aml-complete`, {})).json(),
    onSuccess: (r: any) => {
      queryClient.setQueryData(key, r);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId] });
      toast({ title: "AML complete", description: "Recorded on the transaction's history." });
    },
    onError: (e: any) => toast({ title: "Not complete yet", description: String(e?.message || e).replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*?)".*\}$/, "$1"), variant: "destructive" }),
  });
  const done = ready ? q.data?.complete || null : null;
  const when = done ? new Date(done.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  return (
    <div className="pt-1" data-testid="aml-complete">
      {done ? (
        <div className="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" data-testid="aml-complete-done">
          <CheckCircle2 className="h-4 w-4" />Completed{done.by ? ` by ${done.by}` : ""} · {when}
        </div>
      ) : (
        <Button type="button" size="lg" className="h-12 w-full text-base font-semibold disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100" disabled={!ready || save.isPending || q.isLoading}
          onClick={() => save.mutate()} data-testid="button-aml-complete">
          {save.isPending ? "Saving…" : "Complete"}
        </Button>
      )}
      {!ready && <p className="mt-1 text-center text-xs text-muted-foreground" data-testid="aml-complete-waiting">{missing.length ? `Still to clear: ${missing.join(", ")}.` : "Every party needs to be cleared first."}</p>}
    </div>
  );
}

// ── AI AML augments — MLR scope, AI triage, SoF analyses, MLRO PDF ──────────

interface DealAmlAi {
  id: string;
  name: string;
  amlEddRequired: boolean | null;
  amlEddReason: string | null;
  amlSourceOfFunds: string | null;
  amlAiTriage: {
    verdict?: "clear" | "review" | "escalate";
    recommendation?: string;
    rationale?: string[];
    mlroAction?: string;
    generatedAt?: string;
  } | null;
  amlSofAnalysis: { items?: Array<{
    documentType: string;
    summary: string;
    declaredSourceMatchesDocument: boolean | null;
    inferredAnnualIncomePence: number | null;
    redFlags: string[];
    evidence: string[];
    generatedAt: string;
  }> } | null;
  amlMarketData: {
    listed: boolean;
    ticker: string | null;
    exchange: string | null;
    marketCapGBP: number | null;
    fiftyTwoWeekChange: number | null;
    signals: {
      largeCap: boolean;
      midCap: boolean;
      sharpDrop: boolean;
      strongMomentum: boolean;
      halted: boolean;
    };
    creditSafe?: { configured: boolean; score?: number | null; riskBand?: string | null; insolvencyFlag?: boolean };
    fetchedAt: string;
  } | null;
}

// Exported so the Compliance Board (and other KYC review surfaces) can drop
// the AI augments alongside each party's checks.
export function AmlAiPanel({ dealId, dealName }: { dealId: string; dealName: string }) {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Pull deal-level AML AI fields directly from the deal record. The
  // /api/kyc/deal/:id/status endpoint above doesn't include these, so we
  // hit /api/deals/:id and pluck the columns we need.
  const { data: deal } = useQuery<DealAmlAi>({
    queryKey: ["/api/crm/deals", dealId, "aml-ai"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/deals/${dealId}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("transaction load failed");
      const d = await res.json();
      return {
        id: d.id, name: d.name,
        amlEddRequired: d.amlEddRequired ?? d.aml_edd_required,
        amlEddReason: d.amlEddReason ?? d.aml_edd_reason,
        amlSourceOfFunds: d.amlSourceOfFunds ?? d.aml_source_of_funds,
        amlAiTriage: d.amlAiTriage ?? d.aml_ai_triage ?? null,
        amlSofAnalysis: d.amlSofAnalysis ?? d.aml_sof_analysis ?? null,
        amlMarketData: d.amlMarketData ?? d.aml_market_data ?? null,
      };
    },
  });

  const { data: scope, refetch: refetchScope } = useQuery<{ current: any; suggestion: { suggestedScope: string; reason: string } }>({
    queryKey: ["/api/aml/deal", dealId, "mlr-scope"],
    queryFn: async () => {
      const res = await fetch(`/api/aml/deal/${dealId}/mlr-scope`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("scope load failed");
      return res.json();
    },
  });

  const setScope = useMutation({
    mutationFn: async (body: { scope: string; reason: string }) =>
      apiRequest("POST", `/api/aml/deal/${dealId}/mlr-scope`, body),
    onSuccess: () => {
      refetchScope();
      toast({ title: "MLR scope saved" });
    },
  });

  const deleteSof = useMutation({
    mutationFn: async (idx: number) => apiRequest("DELETE", `/api/aml/deal/${dealId}/sof/${idx}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId, "aml-ai"] }),
  });

  const uploadSof = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (deal?.amlSourceOfFunds) fd.append("declaredSource", deal.amlSourceOfFunds);
      const res = await fetch(`/api/aml/deal/${dealId}/sof`, {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId, "aml-ai"] });
      toast({ title: "Source-of-funds analysis complete" });
    } catch (e: any) {
      toast({ title: "Analysis failed", description: e?.message?.slice(0, 200), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const triage = deal?.amlAiTriage;
  const triageColor = triage?.verdict === "clear" ? "border-emerald-300 bg-emerald-50/50"
    : triage?.verdict === "escalate" ? "border-red-300 bg-red-50/50"
    : "border-amber-300 bg-amber-50/30";
  const sofItems = deal?.amlSofAnalysis?.items || [];

  return (
    <div className="space-y-3 pt-2 border-t">
      {/* MLR scope */}
      <div className="flex items-start gap-2 p-2.5 rounded-md border bg-card">
        <ScrollText className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-wide">MLR 2017 scope</span>
            {scope?.current?.scope ? (
              <Badge variant="outline" className="text-[10px] capitalize">{String(scope.current.scope).replace(/_/g, " ")}</Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">Not assessed</Badge>
            )}
          </div>
          {scope?.suggestion && (
            <p className="text-[11px] text-muted-foreground mt-1">
              <span className="font-medium">Suggested:</span> {scope.suggestion.suggestedScope.replace(/_/g, " ")} — {scope.suggestion.reason}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <Select
              value={scope?.current?.scope || ""}
              onValueChange={(v) => setScope.mutate({ scope: v, reason: scope?.suggestion?.reason || "" })}
            >
              <SelectTrigger className="h-7 text-xs w-56" data-testid="select-mlr-scope">
                <SelectValue placeholder="Set scope…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in_scope">In scope — full CDD required</SelectItem>
                <SelectItem value="out_of_scope_below_threshold">Out of scope — below MLR threshold</SelectItem>
                <SelectItem value="simplified_dd">Simplified DD (Reg 37)</SelectItem>
              </SelectContent>
            </Select>
            {scope?.current?.scope === "out_of_scope_below_threshold" && (
              <span className="text-[10px] text-emerald-700 font-medium">Transaction can proceed without full CDD</span>
            )}
          </div>
        </div>
      </div>

      {/* Auto-EDD reason */}
      {deal?.amlEddRequired && (
        <div className="flex items-start gap-2 p-2.5 rounded-md border border-orange-300 bg-orange-50">
          <AlertCircle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-orange-800">Enhanced Due Diligence required</div>
            <p className="text-[11px] text-orange-900 mt-0.5">{deal.amlEddReason || "Set by AML rules engine."}</p>
          </div>
        </div>
      )}

      {/* Market data — Yahoo Finance for listed entities, Creditsafe when wired */}
      {deal?.amlMarketData && (deal.amlMarketData.listed || deal.amlMarketData.creditSafe?.score != null) && (
        <div className="flex items-start gap-2 p-2.5 rounded-md border bg-card" data-testid="market-data-card">
          {deal.amlMarketData.signals.sharpDrop || deal.amlMarketData.signals.halted
            ? <TrendingDown className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            : <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wide">Market data</span>
              {deal.amlMarketData.listed && (
                <Badge variant="outline" className="text-[10px]">
                  {deal.amlMarketData.ticker}{deal.amlMarketData.exchange ? ` · ${deal.amlMarketData.exchange}` : ""}
                </Badge>
              )}
              {deal.amlMarketData.signals.largeCap && <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700 bg-emerald-50">Large cap</Badge>}
              {deal.amlMarketData.signals.midCap && <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-700 bg-blue-50">Mid cap</Badge>}
              {deal.amlMarketData.signals.strongMomentum && <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700 bg-emerald-50">Strong momentum</Badge>}
              {deal.amlMarketData.signals.sharpDrop && <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 bg-red-50">Sharp drop</Badge>}
              {deal.amlMarketData.signals.halted && <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 bg-red-50">Halted</Badge>}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap gap-x-3">
              {deal.amlMarketData.marketCapGBP != null && (
                <span>Mkt cap: £{(deal.amlMarketData.marketCapGBP / 1e6).toFixed(0)}m</span>
              )}
              {deal.amlMarketData.fiftyTwoWeekChange != null && (
                <span>52w: {(deal.amlMarketData.fiftyTwoWeekChange * 100).toFixed(1)}%</span>
              )}
              {deal.amlMarketData.creditSafe?.score != null && (
                <span>Creditsafe: {deal.amlMarketData.creditSafe.score}{deal.amlMarketData.creditSafe.riskBand ? ` (${deal.amlMarketData.creditSafe.riskBand})` : ""}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI triage */}
      {triage && (
        <div className={`p-2.5 rounded-md border ${triageColor}`} data-testid="ai-triage-card">
          <div className="flex items-center gap-2 mb-1">
            <Brain className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">AI triage</span>
            <Badge variant="outline" className="text-[10px] uppercase">{triage.verdict}</Badge>
          </div>
          <p className="text-[12px] leading-relaxed">{triage.recommendation}</p>
          {Array.isArray(triage.rationale) && triage.rationale.length > 0 && (
            <ul className="mt-1.5 list-disc list-inside text-[11px] text-muted-foreground space-y-0.5">
              {triage.rationale.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
          {triage.mlroAction && (
            <p className="text-[11px] mt-2"><span className="font-semibold">MLRO action:</span> {triage.mlroAction}</p>
          )}
        </div>
      )}

      {/* Source of Funds analyses */}
      <div className="rounded-md border p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-y-1.5 mb-1.5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap">AI Source-of-Funds</span>
            <Badge variant="outline" className="text-[10px]">{sofItems.length} doc{sofItems.length === 1 ? "" : "s"}</Badge>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => fileInput.current?.click()} disabled={uploading} data-testid="button-upload-sof">
            {uploading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
            {uploading ? "Analysing…" : "Add document"}
          </Button>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSof(f); e.target.value = ""; }}
          />
        </div>
        {sofItems.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic">Drop a bank statement, payslip or tax return — Claude will extract the figures, summarise the income picture and flag inconsistencies vs declared source.</p>
        ) : (
          <div className="space-y-2">
            {sofItems.map((s, i) => (
              <div key={i} className="rounded border p-2 bg-card" data-testid={`sof-doc-${i}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] capitalize">{s.documentType?.replace(/_/g, " ")}</Badge>
                      {typeof s.declaredSourceMatchesDocument === "boolean" && (
                        <Badge className={`text-[10px] ${s.declaredSourceMatchesDocument ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {s.declaredSourceMatchesDocument ? "Matches declared" : "Mismatch"}
                        </Badge>
                      )}
                      {s.inferredAnnualIncomePence != null && (
                        <span className="text-[11px] text-muted-foreground">~£{(s.inferredAnnualIncomePence/100).toLocaleString()}/yr inferred</span>
                      )}
                    </div>
                    <p className="text-[12px] mt-1 leading-snug">{s.summary}</p>
                    {Array.isArray(s.redFlags) && s.redFlags.length > 0 && (
                      <ul className="text-[11px] text-red-700 mt-1 list-disc list-inside space-y-0.5">
                        {s.redFlags.map((f, j) => <li key={j}>{f}</li>)}
                      </ul>
                    )}
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-muted-foreground hover:text-destructive" onClick={() => deleteSof.mutate(i)} title="Delete this analysis">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MLRO Report PDF — download or save to SharePoint */}
      <MlroReportButtons dealId={dealId} />
    </div>
  );
}

function MlroReportButtons({ dealId }: { dealId: string }) {
  const { toast } = useToast();
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/aml/deal/${dealId}/mlro-report/save`);
      return r.json();
    },
    onSuccess: (data) => {
      setSavedUrl(data.webUrl);
      toast({ title: "Saved to SharePoint", description: `${data.filename} (${data.sizeMB?.toFixed?.(2) ?? "?"} MB)` });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message?.slice(0, 200), variant: "destructive" }),
  });

  return (
    <div className="flex items-center justify-end gap-2 flex-wrap">
      {savedUrl && (
        <a href={savedUrl} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline">SP file ↗</a>
      )}
      <Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-mlro-save-sp">
        {save.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5 mr-1.5" />}
        Save to SharePoint
      </Button>
      <Button size="sm" variant="outline" asChild data-testid="button-mlro-report">
        <a href={`/api/aml/deal/${dealId}/mlro-report`} target="_blank" rel="noreferrer">
          <FileDown className="w-3.5 h-3.5 mr-1.5" />
          Download MLRO Report PDF
        </a>
      </Button>
    </div>
  );
}
