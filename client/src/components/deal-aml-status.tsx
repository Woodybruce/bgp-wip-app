import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, CheckCircle2, AlertCircle, Clock, ShieldCheck, Loader2, FileDown, Sparkles, Upload, Trash2, Brain, ScrollText, Mail, Send, Copy, Cloud, ChevronDown, ChevronUp, ChevronRight, TrendingUp, TrendingDown, FolderOpen, Flag, AlertTriangle, Pencil } from "lucide-react";
import { Link, useLocation } from "wouter";
import { KycPanel } from "@/components/kyc-panel";
import { KYC4U_FORM_URL, Kyc4uPackButton, Kyc4uRequestButton, Kyc4uSubmittedButton } from "@/components/kyc4u-panel";
import { kyc4uDraftState } from "@shared/kyc4u-portal";
import { ClientChecksForParty, SendClientChecksButton, useClientChecks, type ClientChecks } from "@/components/kyc-client-checks";
import { SecondReadPanel } from "@/components/aml-second-read";
import { DealPartyEditor, DealPartyLines, TrustLine, partyAmlFacts, useDealParties } from "@/components/deal-parties";
import { JointNotRequiredButton, PartyDecisionButton, PartyDecisions } from "@/components/deal-party-aml";
import { legacyToCode } from "@shared/deal-status";
import { FLAG_REVIEW_COMMENT_MIN, isSanctionsFlag, type KycRedFlag, type SetAsideFlag } from "@shared/kyc-red-flags";
import { personDisplayName, personNamesMatch, precheckDay, type PrecheckCardLine, type PrecheckCompany } from "@shared/kyc-prechecks";
import { type AmlRegime, type JointAgentRule, type JointAskRecord, type PartyDueDiligence } from "@shared/aml-policy";
import { AML_BOX_WHO_WORDS, amlBoxDay, amlNextStep, firmShort, shortReason, type AmlBoxFacts, type AmlBoxTone } from "@shared/aml-box";
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
import type { RiskAssessment } from "@shared/aml-risk-assessment";
import { CHARITY_ATTRIBUTION, type CharityFacts } from "@shared/charity-register";
import { AmlFileButton } from "@/components/aml-file-button";
import { AbroadTrace, abroadSummary, useDealAbroad } from "@/components/aml-abroad";
import { JointRelianceButton, RelianceButton, RelianceCard } from "@/components/aml-reliance";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AskJointAgentButton, JointAgentPanel, JointChaseButton, currentJointRequest, jointApplies, jointBoxFacts, useJointChecks } from "@/components/joint-agent-checks";
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
  // In-app AML is on: the deal offers client checks as well as KYC4U.
  inAppAml?: boolean;
  clientChecks?: boolean;
  // What sends a party to KYC4U (BGP staff only; null for anyone else).
  redFlags?: {
    parties: Record<string, KycRedFlag[]>; deal: KycRedFlag[]; unchecked: string[];
    // Set aside by the MLRO with a comment: listed, no longer counted.
    setAside?: Record<string, SetAsideFlag[]>; dealSetAside?: SetAsideFlag[];
    // Each party's level of due diligence under BGP's AML policy.
    levels?: Record<string, PartyDueDiligence>;
  } | null;
  // BGP's checks before asking, per party (BGP staff only).
  prechecks?: Record<string, PartyPrecheck> | null;
  // BGP's sign-off and KYC4U's result (BGP staff only): whether the person
  // may decide (the Nominated Officer or the Deputy) or sign off (they, and
  // the deal's agents), and per party whether it may be signed off now.
  decisions?: {
    canDecide: boolean; canSignOff?: boolean; mlroAppointed: boolean;
    officers?: { nominated: string | null; deputy: string | null }; officerWords?: string;
    parties: Record<string, { blocked: string | null; needsNote: boolean; edd?: boolean }>;
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
  const [more, setMore] = useState(false);
  const c = data.prechecks?.[companyId]?.company;
  if (!c) return null;
  const directors = more ? c.directors : c.directors.slice(0, 4);
  return (
    <div className="space-y-1.5" data-testid={`kyc-company-${companyId}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
        <span className="font-semibold">{c.name}</span>
        <span className="font-mono tabular-nums text-muted-foreground">{c.number}</span>
        <a href={c.registerUrl} target="_blank" rel="noreferrer" className="ml-auto text-[11px] text-primary hover:underline">Companies House register</a>
      </div>
      <div className="text-[11px] text-muted-foreground">{[c.type, c.status, c.incorporatedOn ? `incorporated ${c.incorporatedOn}` : null].filter(Boolean).join(" · ")}</div>
      {c.warnings.length > 0 && (
        <ul className="text-xs text-red-700 dark:text-red-400 space-y-0.5">{c.warnings.map(w => <li key={w}>{w}</li>)}</ul>
      )}
      <dl className="grid grid-cols-1 gap-y-1 text-xs">
        {c.registeredOffice && <div><dt className="inline text-muted-foreground">Registered office: </dt><dd className="inline">{c.registeredOffice}</dd></div>}
        {c.business.length > 0 && <div><dt className="inline text-muted-foreground">Business: </dt><dd className="inline">{c.business.join("; ")}</dd></div>}
        {c.listing && <div data-testid={`kyc-company-listing-${companyId}`}><dt className="inline text-muted-foreground">Listed: </dt><dd className="inline">{c.listing}. {c.listingNote}</dd></div>}
        {c.overseasEntity && <div data-testid={`kyc-company-overseas-${companyId}`}><dt className="inline text-muted-foreground">Register of Overseas Entities: </dt><dd className="inline">{c.overseasEntity}</dd></div>}
        {directors.length > 0 && (
          <div><dt className="inline text-muted-foreground">Directors: </dt><dd className="inline">{directors.join(", ")}
            {c.directors.length > 4 && <button type="button" className="ml-1 text-primary hover:underline" onClick={() => setMore(m => !m)}>{more ? "fewer" : `and ${c.directors.length - 4} more`}</button>}
          </dd></div>
        )}
        {c.owners.length > 0 && <div><dt className="inline text-muted-foreground">Owners: </dt><dd className="inline">{c.owners.map(o => `${o.name} (${o.control})`).join("; ")}</dd></div>}
        {c.ownerNote && <div><dt className="inline text-muted-foreground">Owners: </dt><dd className="inline">{c.ownerNote}</dd></div>}
        {c.chain.length > 0 && <div><dt className="inline text-muted-foreground">Owned through: </dt><dd className="inline">{c.chain.join(" › ")}</dd></div>}
        {c.accounts && <div><dt className="inline text-muted-foreground">Latest accounts: </dt><dd className="inline">{c.accounts}</dd></div>}
        {c.trading && (
          <div data-testid={`kyc-company-trading-${companyId}`}><dt className="inline text-muted-foreground">Trading: </dt>
            <dd className="inline">{c.trading.words || (c.trading.trading ? "Yes: it files trading accounts" : "Not shown: no accounts filed yet")}</dd></div>
        )}
        {(c.identity?.length ?? 0) > 0 && (
          <div data-testid={`kyc-company-idv-${companyId}`}><dt className="inline text-muted-foreground">Identity verified at Companies House: </dt>
            <dd className="inline">{c.identity!.map((i, n) => (
              <span key={`${i.name}-${n}`} className={i.state === "overdue" ? "text-red-700 dark:text-red-400" : i.state === "verified" ? "" : "text-muted-foreground"}>
                {n ? "; " : ""}{i.name}: {i.state === "verified" ? "yes" : i.words}
              </span>
            ))}. <span className="text-muted-foreground">Information only: BGP still checks identity itself.</span></dd></div>
        )}
        {c.documents.some(d => d.onFile) && <div><dt className="inline text-muted-foreground">On the KYC record: </dt><dd className="inline">{c.documents.filter(d => d.onFile).map(d => d.title).join("; ")}</dd></div>}
        {c.gleif && <div data-testid={`kyc-company-gleif-${companyId}`}><dt className="inline text-muted-foreground">GLEIF: </dt><dd className="inline">{c.gleif.replace(/^GLEIF:\s*/, "")}</dd></div>}
      </dl>
    </div>
  );
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

// BGP's written risk assessment for the party, in KYC4U's shape (Woody,
// 21 November 2026: "yes lets do 1 to 4"). The same builder as the AML file
// (shared/aml-risk-assessment.ts), read from GET /api/deals/:id/aml-risk-assessment.
function PartyRiskAssessment({ dealId, role }: { dealId: string; role: string }) {
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
    <div className="space-y-1.5" data-testid={`aml-risk-assessment-${role}`}>
      <p className="text-[11px] text-muted-foreground">BGP's written assessment in the shape of KYC4U's report, read from the checks above. The AML file prints it first.</p>
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
      <ul className="text-xs space-y-1">
        {ra.owners.map(o => <li key={o.name}><span className="font-medium">{o.name}</span> <span className="text-muted-foreground">· {o.nationality} · {o.residence}</span> · <span className={o.idMethod.startsWith("Not verified") ? "text-amber-800 dark:text-amber-300" : ""}>{o.idMethod}</span> <span className="text-muted-foreground">· risk {o.risk.toLowerCase()} · PEP {o.pep.toLowerCase()}</span></li>)}
      </ul>
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
function PartyPrechecks({ dealId, data, companyId }: { dealId: string; data: DealAmlStatus; companyId: string }) {
  const { toast } = useToast();
  const view = data.prechecks?.[companyId];
  const again = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/kyc/deal/${dealId}/prechecks`, { companyId })).json(),
    onSuccess: (r: any) => {
      const state = r?.started?.[companyId];
      if (state === "cap") toast({ title: "Not run", description: "Today's limit for these checks is used up. They run again tomorrow." });
      else if (state === "off") toast({ title: "Not run", description: "These checks are switched off." });
      else if (state === "needs_company") toast({ title: "Not run", description: "Set the company that signs for this party first: the checks are about it, not the brand." });
      queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
    },
    onError: (e: any) => toast({ title: "Not run", description: String(e?.message || e), variant: "destructive" }),
  });
  if (!view || view.state === "off" || view.state === "needs_company") return null;
  const running = view.state === "running" || again.isPending;
  const rank = (l: PrecheckCardLine) => (l.state === "attention" ? 0 : l.state === "ok" ? 2 : 1);
  const icon = (l: PrecheckCardLine) => l.state === "ok" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
    : l.state === "attention" ? <Flag className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
    : l.state === "not_run" ? <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
    : <AlertCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />;
  return (
    <div className="text-xs space-y-1.5" data-testid={`kyc-prechecks-${companyId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">What BGP checked before asking anyone anything.</span>
        <Button type="button" variant="outline" size="sm" className="ml-auto h-7 px-2 text-xs" disabled={running} onClick={() => again.mutate()} data-testid={`kyc-prechecks-again-${companyId}`}>
          Run again
        </Button>
      </div>
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
      {!running && view.lines.length > 0 && (
        <ul className="space-y-1.5" data-testid={`kyc-prechecks-lines-${companyId}`}>
          {[...view.lines].sort((a, b) => rank(a) - rank(b)).map(l => (
            <li key={l.key} className="flex items-start gap-1.5">
              {icon(l)}
              <div className="min-w-0">
                <div className="text-foreground">{l.label}</div>
                {l.detail && <div className="text-muted-foreground break-words">{l.detail}</div>}
                {l.links.map(link => (
                  <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="block underline underline-offset-2 text-muted-foreground hover:text-foreground break-words">{link.label}</a>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {view.errors.length > 0 && (
        <p className="text-muted-foreground" data-testid={`kyc-prechecks-errors-${companyId}`}>Could not be read: {view.errors.join("; ")}.</p>
      )}
    </div>
  );
}

// A red flag sends the party to KYC4U (Woody, 2026-11-17: "basically we do
// the normal checks expected and if there is a red flag then we get KYC4U").
// Each opens what is behind it, and the MLRO (admins until one is appointed)
// can set one aside with a comment (Woody, 2026-11-19: "We also need to see
// the detail of the red flag and have the option to ignore with a comment as
// comply advantage is picking up things that are not really a massive problem").
function refreshAml(dealId: string) {
  queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
  queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
}

function FlagFacts({ flag }: { flag: KycRedFlag }) {
  const facts = flag.facts || [];
  return (
    <dl className="mt-1 space-y-0.5 rounded border border-border bg-background p-2 text-[11px] text-foreground" data-testid={`kyc-flag-facts-${flag.key}`}>
      {facts.map((f, i) => (
        <div key={i}>
          <dt className="inline text-muted-foreground">{f.label}: </dt>
          <dd className="inline break-words">{f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-primary">{f.value}</a> : f.value}</dd>
        </div>
      ))}
      <div><dt className="inline text-muted-foreground">Found by: </dt><dd className="inline">{flag.source}{flag.at ? `, ${precheckDay(flag.at)}` : ""}</dd></div>
    </dl>
  );
}

function SetAsideDialog({ dealId, role, flag, onClose }: { dealId: string; role: string | null; flag: KycRedFlag; onClose: () => void }) {
  const { toast } = useToast();
  const [comment, setComment] = useState("");
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/red-flags/set-aside`, { role, key: flag.key, comment })).json(),
    onSuccess: () => { refreshAml(dealId); toast({ title: "Set aside", description: "It stays on the KYC record with your comment, and no longer counts as a red flag." }); onClose(); },
    onError: (e: any) => toast({ title: "Not set aside", description: String(e?.message || e).replace(/^\d{3}:\s*/, ""), variant: "destructive" }),
  });
  const short = comment.trim().length < FLAG_REVIEW_COMMENT_MIN;
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="kyc-flag-set-aside-dialog">
        <DialogHeader><DialogTitle>Set this red flag aside</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <div className="font-medium">{flag.label}</div>
            {flag.detail && <div className="text-muted-foreground text-xs mt-0.5">{flag.detail}</div>}
            <FlagFacts flag={flag} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Why it is not a concern</Label>
            <Textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder="e.g. The article is about a merger review by the CMA, cleared in 2016: no finding of wrongdoing." data-testid="input-kyc-flag-comment" />
            <p className="text-[11px] text-muted-foreground">Kept on the KYC record with your name and the date. If the checks find something new about it, it is raised again.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={short || save.isPending} onClick={() => save.mutate()} data-testid="button-kyc-flag-set-aside-save">
            {save.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Set aside
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RedFlagList({ dealId, role, flags, setAside, canDecide, title, step, testId, whoDecides, factors }: {
  dealId: string; role: string | null; flags: KycRedFlag[]; setAside: SetAsideFlag[]; canDecide: boolean;
  title: string; step: string; testId: string; whoDecides?: string;
  // The policy's higher-risk factors: amber, not red, and worded as factors.
  factors?: boolean;
}) {
  const { toast } = useToast();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [asideOpen, setAsideOpen] = useState(false);
  const [dialog, setDialog] = useState<KycRedFlag | null>(null);
  const putBack = useMutation({
    mutationFn: async (reviewId: number) => (await apiRequest("POST", `/api/deals/${dealId}/red-flags/put-back`, { reviewId })).json(),
    onSuccess: () => { refreshAml(dealId); toast({ title: "Put back", description: "It counts as a red flag again." }); },
    onError: (e: any) => toast({ title: "Not put back", description: String(e?.message || e).replace(/^\d{3}:\s*/, ""), variant: "destructive" }),
  });
  if (!flags.length && !setAside.length) return null;
  return (
    <div className="space-y-1.5" data-testid={testId}>
      {flags.length > 0 && (
        <div className={`rounded-md border p-2.5 text-xs ${factors ? "border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100" : "border-red-300 bg-red-50 text-red-900 dark:bg-red-950/20 dark:text-red-200"}`} data-testid={`${testId}-live`}>
          <div className="flex items-center gap-1.5 text-sm font-semibold"><Flag className="w-3.5 h-3.5 shrink-0" />{title}</div>
          <ul className="mt-1.5 space-y-1.5">
            {flags.map((f, i) => {
              const id = `${f.key}-${i}`;
              const open = openKey === id;
              return (
                <li key={id} className="space-y-0.5" data-testid={`kyc-flag-${f.key}`}>
                  <div className="flex items-start gap-1.5">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${factors ? "bg-amber-600" : "bg-red-600"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{f.label}</div>
                      {f.detail && <div className={`${factors ? "text-amber-900/80 dark:text-amber-100/80" : "text-red-800/80 dark:text-red-200/80"} break-words`}>{f.detail}</div>}
                      {f.kind === "sanctions" || (f.kind === "provider_screen" && /sanction/i.test(f.label)) ? (
                        <div className="mt-0.5 font-medium" data-testid={`kyc-flag-ofsi-${f.key}`}>If it is a true match: tell the Nominated Officer now. It is reported to OFSI as soon as practicable, and legal advice is taken before BGP acts further (AML policy J and 3.10).</div>
                      ) : null}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <button type="button" className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline" onClick={() => setOpenKey(open ? null : id)} data-testid={`kyc-flag-detail-${f.key}`}>
                          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}{open ? "Hide detail" : "Detail"}
                        </button>
                        {canDecide && (
                          <button type="button" className="underline-offset-2 hover:underline" onClick={() => setDialog(f)} data-testid={`kyc-flag-set-aside-${f.key}`}>Set aside</button>
                        )}
                        {(f.kind === "sanctions" || (f.kind === "provider_screen" && /sanction/i.test(f.label))) && (
                          <RaiseReportButton variant="text" className="underline-offset-2 hover:underline"
                            label={canDecide ? "Record an OFSI report" : "Tell the Nominated Officer"} kind="sanctions" dealId={dealId} role={role}
                            seed={`${f.label}.${f.detail ? ` ${f.detail}` : ""}`} officer={canDecide} testId={`kyc-flag-ofsi-report-${f.key}`} />
                        )}
                      </div>
                      {open && <FlagFacts flag={f} />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5">{step}{canDecide ? " Or, if one does not apply, set it aside with a comment." : ` ${whoDecides ? whoDecides.charAt(0).toUpperCase() + whoDecides.slice(1) : "The Nominated Officer or the Deputy"} can set one aside with a comment.`}</p>
        </div>
      )}
      {setAside.length > 0 && (
        <div className="rounded-md border border-border bg-muted/30 p-2 text-xs" data-testid={`${testId}-aside`}>
          <button type="button" className="flex w-full items-center gap-1 text-left text-muted-foreground hover:text-foreground" onClick={() => setAsideOpen(o => !o)}>
            {asideOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {setAside.length} {factors ? "factor" : "red flag"}{setAside.length === 1 ? "" : "s"} set aside
          </button>
          {asideOpen && (
            <ul className="mt-1.5 space-y-1.5">
              {setAside.map(({ flag, review }) => (
                <li key={review.id} className="space-y-0.5" data-testid={`kyc-flag-aside-${flag.key}`}>
                  <div className="text-foreground line-through decoration-muted-foreground/60">{flag.label}</div>
                  <div className="text-muted-foreground">Set aside{review.by ? ` by ${review.by}` : ""}{review.at ? `, ${precheckDay(review.at)}` : ""}: “{review.comment}”</div>
                  {canDecide && (
                    <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={putBack.isPending} onClick={() => putBack.mutate(review.id)} data-testid={`kyc-flag-put-back-${flag.key}`}>Put back</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {dialog && <SetAsideDialog dealId={dealId} role={role} flag={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

// only: the box draws the red flags under Red flags and the policy's
// higher-risk factors under Due diligence (20 November 2026).
function PartyRedFlags({ dealId, data, companyId, role, only }: { dealId: string; data: DealAmlStatus; companyId: string; role: string; only?: "flags" | "factors" }) {
  const flags = data.redFlags?.parties[companyId] || [];
  const aside = data.redFlags?.setAside?.[companyId] || [];
  const who = data.decisions?.officerWords;
  return (
    <>
      {only !== "factors" && <RedFlagList
        dealId={dealId}
        role={role}
        flags={flags.filter(f => !f.factor)}
        setAside={aside.filter(a => !a.flag.factor)}
        canDecide={!!data.decisions?.canDecide}
        whoDecides={who}
        title="Red flag: raise with KYC4U"
        step="Press Request KYC4U check: the red flags are already in its note."
        testId={`kyc-red-flags-${companyId}`}
      />}
      {only !== "flags" && <RedFlagList
        dealId={dealId}
        role={role}
        factors
        flags={flags.filter(f => f.factor)}
        setAside={aside.filter(a => a.flag.factor)}
        canDecide={!!data.decisions?.canDecide}
        whoDecides={who}
        title="Enhanced due diligence: higher-risk factors in BGP's AML policy"
        step="Press Request KYC4U check: the factors are in its note, and the Nominated Officer or a Deputy approves the result."
        testId={`kyc-policy-factors-${companyId}`}
      />}
    </>
  );
}

// The party's level of due diligence under BGP's AML policy, and why.
function PartyLevel({ data, companyId }: { data: DealAmlStatus; companyId: string }) {
  const level = data.redFlags?.levels?.[companyId];
  if (!level) return null;
  return (
    <div className="text-xs space-y-0.5" data-testid={`aml-level-${companyId}`}>
      {level.level === "enhanced"
        ? <div className="text-muted-foreground">Enhanced because of: {level.why.join("; ")}.</div>
        : level.why.map(w => <div key={w} className="text-muted-foreground">{w}</div>)}
      {level.toWeigh.length > 0 && <div className="text-muted-foreground" data-testid={`aml-level-weigh-${companyId}`}>To weigh: {level.toWeigh.join("; ")}</div>}
    </div>
  );
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
  return (
    <>
      <RedFlagList
        dealId={dealId}
        role={null}
        flags={(data.redFlags?.deal || []).filter(f => !f.factor)}
        setAside={(data.redFlags?.dealSetAside || []).filter(a => !a.flag.factor)}
        canDecide={!!data.decisions?.canDecide}
        whoDecides={data.decisions?.officerWords}
        title="Red flag on the deal record"
        step="It is not tied to one party: Request KYC4U check on the party it concerns carries it in the note."
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
        title="Enhanced due diligence on the deal: a higher-risk factor in BGP's AML policy"
        step="It applies to every party: Request KYC4U check carries it in the note, and the Nominated Officer or the Deputy approves the result."
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
      return res.json();
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

export const AML_STAGE_TONE: Record<AmlStage, string> = {
  not_started: "bg-muted text-muted-foreground",
  bgp_checked: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  client_sent: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  joint_asked: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  joint_in: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200",
  client_finished: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200",
  relied: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200",
  with_kyc4u: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  expiring: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  expired: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  not_required: "bg-muted text-muted-foreground",
};

type BoxTone = AmlBoxTone | "info";

function BoxToneIcon({ tone }: { tone: BoxTone }) {
  const c = "w-3.5 h-3.5 shrink-0 mt-[2px]";
  if (tone === "done") return <CheckCircle2 className={`${c} text-emerald-600`} />;
  if (tone === "act") return <AlertCircle className={`${c} text-amber-600`} />;
  if (tone === "flag") return <Flag className={`${c} text-red-600`} />;
  if (tone === "wait") return <Clock className={`${c} text-sky-600`} />;
  return <span className={`${c} inline-flex items-center justify-center`}><span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" /></span>;
}

const NEXT_BOX: Record<AmlBoxTone, string> = {
  done: "bg-emerald-50 text-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-100",
  act: "bg-amber-50 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100",
  flag: "bg-red-50 text-red-950 dark:bg-red-950/30 dark:text-red-100",
  wait: "bg-sky-50 text-sky-950 dark:bg-sky-950/20 dark:text-sky-100",
};

type StepState = "done" | "act" | "wait" | "flag" | "todo";

function StepIcon({ n, state }: { n?: number; state: StepState }) {
  const base = "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold";
  if (state === "done") return <span className={`${base} bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300`}><Check className="h-3 w-3" /></span>;
  if (state === "flag") return <span className={`${base} bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300`}><Flag className="h-3 w-3" /></span>;
  const tone = state === "act" ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
    : state === "wait" ? "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200"
    : "bg-muted text-muted-foreground";
  return <span className={`${base} ${tone}`}>{n ?? <span className="h-1.5 w-1.5 rounded-full bg-current" />}</span>;
}

// One step of a party, or one of the deal's own checks: one line, the detail on press.
function StepRow({ id, n, label, state, summary, open, onToggle, children, testId }: {
  id: string; n?: number; label: string; state: StepState; summary: ReactNode; open: boolean; onToggle: () => void; children?: ReactNode; testId: string;
}) {
  return (
    <div id={id} className="border-t border-border/60 first:border-t-0 scroll-mt-4" data-testid={testId}>
      <button type="button" className="flex w-full min-w-0 items-center gap-2.5 rounded px-2.5 py-2 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open} onClick={onToggle} data-testid={`${testId}-toggle`}>
        <StepIcon n={n} state={state} />
        {/* On a phone the label sits over its line, so the line has the width. */}
        <span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-2.5">
          <span className="block text-[13px] font-semibold sm:w-[5.75rem] sm:shrink-0">{label}</span>
          <span className="block min-w-0 break-words text-[13px] leading-snug sm:flex-1">{summary}</span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="space-y-2.5 pb-3 pl-[2.6rem] pr-2.5" data-testid={`${testId}-detail`}>{children}</div>}
    </div>
  );
}

// A part of a step's detail that stays folded until pressed.
function Folded({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={testId}>
      <button type="button" data-no-min-touch className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />{label}
      </button>
      {open && <div className="mt-1.5 space-y-2 pl-4">{children}</div>}
    </div>
  );
}

const SubHead = ({ children }: { children: ReactNode }) => <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>;

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
      if (!res.ok) throw new Error("The deal's AML stages could not be read");
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
const LEVEL_WORDS: Record<PartyDueDiligence["level"], string> = { simplified: "Simplified", standard: "Standard", enhanced: "Enhanced" };
const NOT_REQUIRED_SHORT: Record<string, string> = { joint_agent: "the joint agent's party", no_deal: "no deal with this party" };

/** A party slot on the deal (the Parties card merged into the box, 22 November 2026). */
export interface PartySlot {
  role: DealPartyRole;
  label: string;
  companyId: string | null;
  client: boolean;
  // The deal page's picker: link, change or add the party.
  picker: ReactNode;
}

function PartyAmlBox({ dealId, data, cp, row, party, checks, openAll, startOpen, slot }: {
  dealId: string; data: DealAmlStatus; cp: Counterparty; row: AmlDashboardRow | null; party: DealPartyView | null;
  checks: ClientChecks | undefined; openAll: OpenAll; startOpen?: boolean; slot?: PartySlot | null;
}) {
  const staff = !!data.prechecks;
  const { open, toggle, show } = useOpenSections(STEP_KEYS, openAll);
  // A party still being checked opens on its four steps; a cleared one is one line until opened.
  const [folded, setFolded] = useState(!startOpen && !openAll.all);
  useEffect(() => { if (openAll.at) setFolded(!openAll.all); }, [openAll.at]);
  const [editing, setEditing] = useState(false);
  const [changing, setChanging] = useState(false);
  const drafts = useQuery<any[]>({
    enabled: staff,
    queryKey: ["/api/kyc4u/drafts", dealId, cp.id],
    queryFn: async () => (await apiRequest("GET", `/api/kyc4u/drafts?${new URLSearchParams({ dealId, companyId: cp.id })}`)).json(),
  });
  const kyc4uCompany = useQuery<{ requests: Array<{ status: string | null }> }>({ queryKey: ["/api/kyc4u/company", cp.id], enabled: staff, staleTime: 5 * 60_000 });
  // The joint agent asked for their checks on the party (22 November 2026).
  const jointQ = useJointChecks(dealId, staff && !!data.jointRule && data.jointRule !== "letting_under" && data.jointRule !== "advisory");
  const jointParty = jointApplies(jointQ.data, cp.id);

  const reveal = (k: StepKey) => {
    setFolded(false);
    show(k);
    window.setTimeout(() => document.getElementById(`aml-${cp.id}-${k}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60);
  };

  const partyName = cp.kycName || cp.name;
  const approved = cp.isApproved && !cp.isExpired;
  // What the checks still need is moot once the party is approved or marked Not required.
  const settled = approved || !!cp.notRequired;
  const stage = row?.stage ?? fallbackStage(cp);
  const pre = data.prechecks?.[cp.id] || null;
  const allFlags = data.redFlags?.parties[cp.id] || [];
  const flags = allFlags.filter(f => !f.factor);
  const factors = allFlags.filter(f => f.factor);
  const dealFactors = (data.redFlags?.deal || []).filter(f => f.factor);
  const aside = data.redFlags?.setAside?.[cp.id] || [];
  const level = data.redFlags?.levels?.[cp.id] || null;
  const decision = data.decisions?.parties[cp.id];
  const canSignOff = !!(data.decisions?.canSignOff ?? data.decisions?.canDecide);
  const canDecide = !!data.decisions?.canDecide;
  const sanctionsOnly = data.regime?.regime === "sanctions_only";
  const isCompany = party ? party.brand.kind === "company" : true;
  const isTrust = !!party?.brand.recordTrust;
  // Owned through a company registered abroad: KYC4U find the people behind it (Woody, 21 November 2026).
  const ownedAbroad = pre?.company?.ownersAbroad || [];
  // What the app traced past Companies House and what BGP recorded (21 November 2026).
  const traceLines = pre?.company?.trace || pre?.trace || [];
  const showAbroad = staff && (party ? party.brand.kind === "company" : true) && (ownedAbroad.length > 0 || traceLines.length > 0);
  const abroadQ = useDealAbroad(dealId, cp.role, showAbroad);
  const companyMissing = party ? party.brand.kind === "company" && !party.company && !isTrust : pre?.state === "needs_company";
  const people = checks?.people?.[cp.id] || null;
  const requests = (checks?.requests || []).filter(r => r.companyId === cp.id && !r.person);
  const request = requests.find(r => r.status !== "cancelled") || null;
  const owing = people ? people.people.filter(p => p.outstanding.length) : [];
  const unreachable = party && people ? peopleToReach(people.people, party.people, personNamesMatch) : [];
  const draft = (drafts.data || []).find((d: any) => d.status !== "cancelled") || null;
  // Only a request submitted on KYC4U's portal is with them; one prepared and
  // never submitted for 30 days is stale and offered to cancel (20 November 2026).
  const draftState = kyc4uDraftState(draft);
  const kyc4uState: AmlBoxFacts["kyc4u"] = draftState === "prepared" ? "queued" : draftState === "submitted" ? "raised" : "none";
  const gaps = (party?.gaps || []).filter(g => g.key !== "company")
    .map(g => (g.key === "person" ? "Set who to ask" : `Add an email for ${party?.person?.name || "the person to ask"}`));
  const current = jointParty ? currentJointRequest(jointParty) : null;

  const facts: AmlBoxFacts = {
    role: cp.role, stage, due: row ? row.due : null,
    approvedBy: cp.kyc_approved_by, expiresAt: cp.kyc_expires_at, notRequiredWords: cp.notRequired?.reasonWords || null,
    notRequiredReason: cp.notRequired?.reason || null,
    company: isCompany, companyMissing, gaps, askName: party?.person?.name || null,
    precheckRunning: pre?.state === "running",
    redFlags: flags.length, factors: factors.length + dealFactors.length,
    sanctionsOnly, clientChecks: !!data.clientChecks,
    request: request ? { status: request.status as NonNullable<AmlBoxFacts["request"]>["status"], to: request.recipientName || request.recipientEmail } : null,
    people: owing.map(p => ({ name: personDisplayName(p.name), needs: [...p.outstanding], reachable: !unreachable.includes(p), linked: !!p.own })),
    kyc4u: kyc4uState, canSignOff, canDecide,
    signOffBlocked: decision ? decision.blocked : data.decisions ? "This party could not be read." : null,
    needsNote: !!decision?.needsNote,
    billingDiffers: !!party?.client && party.billing?.state === "different",
    trust: isTrust,
    ownersAbroad: ownedAbroad.length ? ownedAbroad.map(a => `${a.name}, ${a.country}`).join("; ") : null,
    reliance: people?.reliance?.words || null,
    relianceFirm: people?.reliance?.firm || null,
    inHouseEdd: !!data.decisions?.inHouseEdd,
    sanctionsFlags: [...flags, ...(data.redFlags?.deal || [])].filter(isSanctionsFlag).length,
    joint: jointBoxFacts(jointQ.data, cp.id),
  };
  const step = amlNextStep(facts);
  const kyc4uNeeded = step.lead === "Not yet with KYC4U";

  const nextAction: ReactNode = (() => {
    const quiet = "h-7 text-xs bg-background";
    switch (step.action) {
      case "fill_in": return <Button type="button" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)} data-testid={`aml-next-fill-${cp.role}`}>Fill in</Button>;
      case "add_details": return <Button type="button" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)} data-testid={`aml-next-details-${cp.role}`}>Add details</Button>;
      case "send_client_checks": return <SendClientChecksButton dealId={dealId} companyId={cp.id} partyName={partyName} className={quiet} />;
      case "people": return <Button type="button" size="sm" variant="outline" className={quiet} onClick={() => reveal("documents")} data-testid={`aml-next-people-${cp.role}`}>Open</Button>;
      case "request_kyc4u": return <Kyc4uRequestButton dealId={dealId} companyId={cp.id} role={cp.role} partyName={partyName} buttonOnly />;
      case "kyc4u_form": return <>
        {draft?.id && <Kyc4uPackButton draftId={String(draft.id)} />}
        <Kyc4uSubmittedButton dealId={dealId} companyId={cp.id} role={cp.role} partyName={partyName} />
      </>;
      case "kyc4u_result": return <PartyDecisionButton dealId={dealId} data={data} companyId={cp.id} role={cp.role} partyName={partyName} kind="kyc4u_result" />;
      case "sign_off": return <PartyDecisionButton dealId={dealId} data={data} companyId={cp.id} role={cp.role} partyName={partyName} kind="sign_off" />;
      case "red_flags": return <Button type="button" size="sm" variant="outline" className={quiet} onClick={() => reveal("screening")}>See flags</Button>;
      case "billing": return <Button type="button" size="sm" variant="outline" className={quiet} onClick={() => reveal("signs")} data-testid={`aml-next-billing-${cp.role}`}>Who pays</Button>;
      case "joint": return <Button type="button" size="sm" variant="outline" className={quiet} onClick={() => reveal("documents")} data-testid={`aml-next-joint-${cp.role}`}>Open</Button>;
      case "joint_remind": return jointParty && current
        ? <JointChaseButton dealId={dealId} party={jointParty} request={current} label={facts.joint?.chasing ? "Remind now" : "Ask for them"} onNoEmail={() => reveal("documents")} />
        : null;
      default: return null;
    }
  })();

  // ── The four steps' lines.
  const reg = pre?.company || null;
  const charity = pre?.charity?.state === "found" ? pre.charity : null;
  const regWarning = reg?.warnings[0] || charity?.warnings[0] || null;
  const askMissing = !!party && !party.person;
  const askNoEmail = !!party?.person && !party.person.email;
  const signs: { state: StepState; text: ReactNode } = companyMissing
    ? { state: settled ? "todo" : "act", text: <span className="text-amber-800 dark:text-amber-300">Not set</span> }
    : {
        state: regWarning ? "flag" : !settled && (askMissing || askNoEmail || facts.billingDiffers) ? "act" : "done",
        text: <>
          {!isCompany && !party?.company
            ? <>{partyName} <span className="text-muted-foreground">· a person</span></>
            : <><span className="font-medium">{party?.company?.name || charity?.name || cp.signsAs || partyName}</span>
                {(party?.company?.companiesHouseNumber || charity) && <span className="ml-1 whitespace-nowrap font-mono tabular-nums text-muted-foreground">{party?.company?.companiesHouseNumber || `charity ${charity!.number}`}</span>}</>}
          {isTrust && <span className="text-muted-foreground"> · a trust</span>}
          {ownedAbroad.length > 0 && <span className="text-muted-foreground"> · owned from abroad</span>}
          {regWarning && <span className="text-red-700 dark:text-red-400"> · {shortReason(regWarning, 50)}</span>}
          {!settled && askMissing && <span className="text-amber-800 dark:text-amber-300"> · who to ask not set</span>}
          {!settled && askNoEmail && <span className="text-amber-800 dark:text-amber-300"> · no email for {party!.person!.name}</span>}
          {!settled && facts.billingDiffers && <span className="text-amber-800 dark:text-amber-300"> · BGP bills another company</span>}
        </>,
      };

  const attention = pre ? pre.lines.filter(l => l.state === "attention").length : 0;
  const unchecked = data.redFlags?.unchecked || [];
  const flagAside = aside.filter(a => !a.flag.factor).length;
  const screening: { state: StepState; text: ReactNode } | null = (() => {
    if (flags.length) return { state: "flag", text: <span className="text-red-700 dark:text-red-400">{plural(flags.length, "red flag")}: {shortReason(flags[0].label, 60)}</span> };
    if (!pre || pre.state === "off") return data.redFlags ? { state: "done", text: "No red flags" } : null;
    if (pre.state === "needs_company") return { state: "todo", text: <span className="text-muted-foreground">After the company that signs is set</span> };
    if (pre.state === "running") return { state: "wait", text: "Running now" };
    if (pre.state === "cap") return { state: "wait", text: "Runs tomorrow: today's limit is used" };
    if (pre.state === "none") return { state: "wait", text: "Not run yet" };
    if (pre.unfinished || pre.state === "waiting") return { state: "act", text: "Not finished: trying again" };
    if (attention) return { state: "flag", text: `${attention} to look at` };
    const extra = [level?.level === "enhanced" ? "higher risk" : null, flagAside ? `${flagAside} set aside` : null, unchecked.length ? "some records not read" : null].filter(Boolean);
    return { state: level?.level === "enhanced" ? "act" : "done", text: `Clear${pre.ranAt ? ` · ${precheckDay(pre.ranAt)}` : ""}${extra.length ? ` · ${extra.join(" · ")}` : ""}` };
  })();

  const jointMissing = jointParty && current && current.files.length ? Math.max(0, jointParty.gaps.filter(g => !/reliance terms$/.test(g)).length - (jointParty.unread ? 1 : 0)) : 0;
  const letting = data.jointRule === "letting" || data.jointRule === "other";
  const documents: { state: StepState; text: ReactNode } = (() => {
    if (cp.notRequired) return { state: "done", text: "Not needed" };
    if (sanctionsOnly) return { state: "done", text: "Not needed: sanctions checks only" };
    if (people?.reliance) return { state: "done", text: `Relying on ${firmShort(people.reliance.firm)}` };
    if (current && jointParty) {
      const firm = firmShort(current.firm);
      if (current.status === "not_sent") return { state: "act", text: `Asked ${firm}: the email didn't go` };
      if (current.status === "expired") return { state: "act", text: `The link to ${firm} ran out` };
      if (current.status === "sent" || current.status === "opened") return { state: "wait", text: `Asked ${firm} ${day(current.sentAt)} · nothing back yet` };
      if (jointParty.unread) return { state: "act", text: `From ${firm} · ${plural(jointParty.unread, "file")} not read yet` };
      if (jointMissing) return { state: current.nextChaseAt ? "wait" : "act", text: <>From {firm} (joint agent) · <span className="font-medium text-amber-800 dark:text-amber-300">{jointMissing} missing</span></> };
      if (letting && !current.reliance) return { state: "wait", text: `From ${firm} · terms not agreed yet` };
      return { state: "done", text: `From ${firm} · all in` };
    }
    if (draftState === "submitted" || stage === "with_kyc4u") return { state: "wait", text: `With KYC4U${draft?.submitted_at ? ` since ${day(draft.submitted_at)}` : ""}` };
    if (draftState === "prepared" || draftState === "stale") return { state: "flag", text: "KYC4U: prepared, not submitted" };
    if (request) {
      const n = people?.people.length || 0;
      const who = request.recipientName || request.recipientEmail || "the client";
      if (request.status === "not_sent") return { state: "act", text: "The client checks email didn't go" };
      if (request.status === "expired") return { state: "act", text: "The client checks link ran out" };
      if (request.status === "finished" && !owing.length) return { state: "done", text: `From ${who} · all in` };
      return { state: "wait", text: `Sent to ${who}${request.sentAt ? ` ${day(request.sentAt)}` : ""}${n > 1 ? ` · ${n - owing.length} of ${n} people done` : ""}` };
    }
    if (companyMissing) return { state: "todo", text: <span className="text-muted-foreground">After the company that signs is set</span> };
    if (!data.clientChecks) return { state: "act", text: "Send it to KYC4U" };
    return { state: "act", text: "Not asked yet" };
  })();

  const decisionStep: { state: StepState; text: ReactNode } = stage === "rejected" ? { state: "flag", text: "Rejected" }
    : cp.notRequired ? { state: "done", text: `Not required${NOT_REQUIRED_SHORT[cp.notRequired.reason || ""] ? `: ${NOT_REQUIRED_SHORT[cp.notRequired.reason || ""]}` : ""}` }
    : approved ? { state: "done", text: `Cleared${cp.kyc_approved_by ? ` by ${cp.kyc_approved_by}` : ""}${cp.kyc_expires_at ? ` until ${amlBoxDay(cp.kyc_expires_at)}` : ""}` }
    : cp.isExpired ? { state: "flag", text: `Expired${cp.kyc_expires_at ? ` ${amlBoxDay(cp.kyc_expires_at)}` : ""}` }
    // The steps before it come first: their own lines say what is still to do.
    : companyMissing ? { state: "todo", text: <span className="text-muted-foreground">After the company that signs is set</span> }
    : screening && (screening.state === "todo" || screening.state === "wait") ? { state: "todo", text: <span className="text-muted-foreground">After screening</span> }
    : documents.state !== "done" || !decision ? { state: "todo", text: <span className="text-muted-foreground">After the documents</span> }
    : decision.blocked !== null ? { state: "todo", text: <span className="text-muted-foreground">{shortReason(decision.blocked)}</span> }
    : decision.edd ? (canDecide ? { state: "act", text: "Ready: an officer signs off, with a note" } : { state: "wait", text: "Ready: for an officer" })
    : !canSignOff ? { state: "wait", text: "Ready: for an agent or an officer" }
    : { state: "act", text: decision.needsNote ? "Ready: sign off with a note" : "Ready to sign off" };

  const aml = partyAmlFacts(data, cp.id);
  const sid = (k: StepKey) => `aml-${cp.id}-${k}`;
  const tid = (k: StepKey) => `aml-step-${cp.role}-${k}`;
  const roleLabel = slot?.label || (cp.role.charAt(0).toUpperCase() + cp.role.slice(1));

  // The joint agent route: the officers' button beside the evidence.
  const jointDecide = canDecide && current && jointQ.data ? (
    jointQ.data.rule === "sale"
      ? (current.sentAt || current.openedAt || current.manual
          ? <JointNotRequiredButton dealId={dealId} role={cp.role} companyId={cp.id} partyName={partyName} jointRef={current.ref} />
          : null)
      : current.reliance && !people?.reliance
        ? <JointRelianceButton dealId={dealId} role={cp.role} partyName={partyName} gaps={jointParty?.gaps || []} joint={{
            ref: current.ref, firm: current.reliance.firm, supervisor: current.reliance.supervisor, registration: current.reliance.registration,
            contact: [current.reliance.name, current.reliance.position].filter(Boolean).join(", "), agreedOn: current.reliance.agreedAt.slice(0, 10),
          }} />
        : null
  ) : null;
  const kyc4uActive = !!draft || stage === "with_kyc4u";
  const clientRoute = !!request || (!current && !people?.reliance && !kyc4uActive);

  const statusPill = stage === "rejected" ? <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200">Rejected</span>
    : cp.notRequired ? <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Not required</span>
    : approved ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"><Check className="h-3 w-3" />Cleared{cp.kyc_expires_at ? ` until ${amlBoxDay(cp.kyc_expires_at)}` : ""}</span>
    : cp.isExpired ? <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200">Expired</span>
    : null;
  const showNext = !(stage === "approved" || stage === "not_required");

  const nextLine = (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md px-2.5 py-1.5 ${NEXT_BOX[step.tone]} ${kyc4uNeeded ? "border-2 border-red-600" : ""}`} data-testid={`aml-next-${cp.role}`}>
      <BoxToneIcon tone={step.tone} />
      <span className="min-w-0 flex-1 basis-40 text-[13px] leading-snug" data-testid={`aml-next-words-${cp.role}`}>
        <span className="sr-only">{AML_BOX_WHO_WORDS[step.who]}: </span>
        <span className="font-semibold">{step.lead}</span>{step.words ? <> · {step.words}</> : null}
      </span>
      {nextAction && <span className="flex flex-wrap items-center gap-1.5">{nextAction}</span>}
    </div>
  );

  return (
    <div className="min-w-0 rounded-lg border border-border bg-card" data-testid={`counterparty-${cp.id}`}>
      <div className="space-y-2 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {staff ? (
            <button type="button" data-no-min-touch onClick={() => setFolded(f => !f)} aria-expanded={!folded} aria-label={folded ? "Show this party's checks" : "Hide this party's checks"} className="shrink-0 rounded text-muted-foreground hover:text-foreground" data-testid={`aml-box-unfold-${cp.role}`}>
              <ChevronRight className={`h-4 w-4 transition-transform ${folded ? "" : "rotate-90"}`} />
            </button>
          ) : null}
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{roleLabel}</span>
          <Link href={`/companies/${cp.id}`} className="min-w-0 truncate text-sm font-semibold hover:underline">{cp.name}</Link>
          {(slot?.client ?? party?.client) && <span className="text-xs text-muted-foreground">BGP's client</span>}
          {staff && slot?.picker && (
            <button type="button" data-no-min-touch onClick={() => setChanging(c => !c)} className="rounded p-0.5 text-muted-foreground hover:text-foreground" title={`Change the ${roleLabel.toLowerCase()}`} aria-label={`Change the ${roleLabel.toLowerCase()}`} data-testid={`aml-party-relink-${cp.role}`}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            {flags.length > 0 && (
              <button type="button" data-no-min-touch onClick={() => reveal("screening")} className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-950/40 dark:text-red-200" data-testid={`aml-box-flags-${cp.role}`}>
                <Flag className="h-3 w-3" />{flags.length}
              </button>
            )}
            {level && level.level !== "standard" && !cp.notRequired && (
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${level.level === "enhanced" ? "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "bg-muted text-muted-foreground"}`} data-testid={`aml-box-level-${cp.role}`}>{LEVEL_WORDS[level.level]}</span>
            )}
            {statusPill && <span data-testid={`aml-box-stage-${cp.role}`}>{statusPill}</span>}
          </span>
        </div>
        {changing && slot?.picker && (
          <div className="flex flex-wrap items-center gap-2" data-testid={`aml-party-picker-${cp.role}`}>
            <div className="min-w-0 flex-1">{slot.picker}</div>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setChanging(false)}>Done</Button>
          </div>
        )}
        {showNext && (kyc4uNeeded
          ? <div data-testid={`aml-kyc4u-needed-${cp.role}`}>{nextLine}</div>
          : nextLine)}
      </div>

      {staff && !folded && (
        <div className="mx-3 mb-3 rounded-md border border-border/70" data-testid={`aml-steps-${cp.role}`}>
          <StepRow id={sid("signs")} testId={tid("signs")} n={1} label="Who signs" state={signs.state} summary={signs.text} open={open.has("signs")} onToggle={() => toggle("signs")}>
            {settled && companyMissing
              ? <p className="text-xs text-muted-foreground">Not set on this deal.</p>
              : <DealPartyLines dealId={dealId} role={cp.role as DealPartyRole} aml={aml} fullBilling />}
            {party && !settled && <TrustLine dealId={dealId} party={party} compact />}
            {showAbroad && (
              <div className="space-y-1.5" data-testid={`aml-abroad-${cp.role}`}>
                <SubHead>Owners abroad</SubHead>
                <AbroadTrace dealId={dealId} role={cp.role} query={abroadQ} />
              </div>
            )}
            {reg
              ? <Folded label="Company details" testId={`aml-company-details-${cp.role}`}><PartyCompanyFacts data={data} companyId={cp.id} /><PartyCharityFacts data={data} companyId={cp.id} /></Folded>
              : pre?.charity ? <PartyCharityFacts data={data} companyId={cp.id} /> : null}
            {!reg && pre?.gleif && <p className="text-xs text-muted-foreground">{pre.gleif}</p>}
          </StepRow>
          {screening && (
            <StepRow id={sid("screening")} testId={tid("screening")} n={2} label="Screening" state={screening.state} summary={screening.text} open={open.has("screening")} onToggle={() => toggle("screening")}>
              {(flags.length > 0 || flagAside > 0) && <PartyRedFlags dealId={dealId} data={data} companyId={cp.id} role={cp.role} only="flags" />}
              {unchecked.length > 0 && <p className="text-xs text-amber-800 dark:text-amber-300">Not read: {unchecked.join(", ")}.</p>}
              {level && !cp.notRequired && (
                <div className="space-y-1.5">
                  <PartyLevel data={data} companyId={cp.id} />
                  <PartyRedFlags dealId={dealId} data={data} companyId={cp.id} role={cp.role} only="factors" />
                </div>
              )}
              <PartyPrechecks dealId={dealId} data={data} companyId={cp.id} />
            </StepRow>
          )}
          <StepRow id={sid("documents")} testId={tid("documents")} n={3} label="Documents" state={documents.state} summary={documents.text} open={open.has("documents")} onToggle={() => toggle("documents")}>
            {companyMissing && !current
              ? <p className="text-xs text-muted-foreground" data-testid={`kyc-actions-wait-${cp.id}`}>Starts once the company that signs is set.</p>
              : <>
                  {people?.reliance && <RelianceCard dealId={dealId} role={cp.role} reliance={people.reliance} canDecide={canDecide} />}
                  {jointParty && jointQ.data && current && !settled && <JointAgentPanel dealId={dealId} view={jointQ.data} party={jointParty} decide={jointDecide} />}
                  {kyc4uActive && (
                    <div className="space-y-1.5" data-testid={`aml-kyc4u-${cp.role}`}>
                      <SubHead>KYC4U</SubHead>
                      <Kyc4uRequestButton dealId={dealId} companyId={cp.id} role={cp.role} partyName={partyName} />
                      {draftState !== "submitted" && (
                        <div className="flex flex-wrap items-center gap-1.5" data-testid={`aml-kyc4u-portal-${cp.role}`}>
                          {draft?.id && draftState === "prepared" && <Kyc4uPackButton draftId={String(draft.id)} />}
                          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild><a href={KYC4U_FORM_URL} target="_blank" rel="noopener noreferrer">KYC4U's portal</a></Button>
                          <Kyc4uSubmittedButton dealId={dealId} companyId={cp.id} role={cp.role} partyName={partyName} />
                        </div>
                      )}
                    </div>
                  )}
                  {data.clientChecks && clientRoute && !people?.reliance && (
                    <div className="space-y-1.5" data-testid={`aml-client-route-${cp.role}`}>
                      {(request || (people && people.people.length > 0)) && (current || kyc4uActive) && <SubHead>Client checks</SubHead>}
                      {!request && !cp.notRequired && !sanctionsOnly && <SendClientChecksButton dealId={dealId} companyId={cp.id} partyName={partyName} className="h-7 text-xs" />}
                      <ClientChecksForParty dealId={dealId} companyId={cp.id} sanctionsOnly={sanctionsOnly} notRequired={!!cp.notRequired} canDecide={canDecide} part="people" />
                      <ClientChecksForParty dealId={dealId} companyId={cp.id} sanctionsOnly={sanctionsOnly} notRequired={!!cp.notRequired} canDecide={canDecide} part="requests" />
                      {request && <SendClientChecksButton dealId={dealId} companyId={cp.id} partyName={partyName} label="Send them again" className="h-7 text-xs" />}
                    </div>
                  )}
                  {!settled && (
                    <div className="flex flex-wrap items-center gap-1 border-t border-border/60 pt-2 text-xs text-muted-foreground" data-testid={`aml-other-ways-${cp.role}`}>
                      <span className="mr-1">Other ways:</span>
                      {!clientRoute && data.clientChecks && !sanctionsOnly && <SendClientChecksButton dealId={dealId} companyId={cp.id} partyName={partyName} label="Client checks" className="h-7 px-2 text-xs" quiet />}
                      {!current && jointQ.data && jointQ.data.firm && jointParty && <AskJointAgentButton dealId={dealId} view={jointQ.data} party={jointParty} label="Joint agent" quiet />}
                      {canDecide && !sanctionsOnly && !people?.reliance && <RelianceButton dealId={dealId} role={cp.role} partyName={partyName} label="Another firm" />}
                      {!kyc4uActive && <Kyc4uRequestButton dealId={dealId} companyId={cp.id} role={cp.role} partyName={partyName} label="KYC4U" buttonOnly quiet />}
                    </div>
                  )}
                </>}
          </StepRow>
          <StepRow id={sid("decision")} testId={tid("decision")} n={4} label="Sign-off" state={decisionStep.state} summary={decisionStep.text} open={open.has("decision")} onToggle={() => toggle("decision")}>
            <PartyNotRequiredBox cp={cp} />
            <PartyDecisions dealId={dealId} data={data} companyId={cp.id} role={cp.role} partyName={partyName} approved={approved} notRequired={!!cp.notRequired} />
            {canDecide && !cp.notRequired && (
              <Folded label="Risk assessment" testId={`aml-assessment-${cp.role}`}><PartyRiskAssessment dealId={dealId} role={cp.role} /></Folded>
            )}
            {canDecide && level?.level === "enhanced" && !cp.notRequired && <SecondReadPanel dealId={dealId} role={cp.role} partyName={partyName} trust={isTrust} />}
            {canDecide && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid={`aml-file-line-${cp.role}`}>
                <AmlFileButton dealId={dealId} role={cp.role} partyName={partyName} />
              </div>
            )}
          </StepRow>
        </div>
      )}
      {editing && <DealPartyEditor dealId={dealId} role={cp.role as DealPartyRole} aml={aml} onClose={() => setEditing(false)} />}
    </div>
  );
}

// A slot with no party yet: its role and the picker to link one.
function UnsetPartyRow({ slot }: { slot: PartySlot }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-card px-3 py-2.5" data-testid={`aml-party-unset-${slot.role}`}>
      <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{slot.label}</span>
      {slot.client && <span className="text-xs text-muted-foreground">BGP's client</span>}
      <div className="min-w-0 flex-1">{slot.picker}</div>
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
              <DropdownMenuItem className="text-red-700 focus:text-red-800 dark:text-red-400" onSelect={() => setStopping(true)} data-testid="aml-stop-open">Stop acting on this deal</DropdownMenuItem>
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
export function DealAmlStatusCard({ dealId, focusCompanyId, slots, actingFor, footer }: {
  dealId: string; dealStatus?: string | null; focusCompanyId?: string | null;
  slots?: PartySlot[] | null; actingFor?: ReactNode; footer?: ReactNode;
}) {
  const { data, isLoading } = useDealAmlStatus(dealId);
  // BGP's own reads (the checks before asking) come only to BGP staff: the
  // party lines follow them.
  const staffView = !!data?.prechecks;
  const { data: parties } = useDealParties(dealId, staffView);
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
  const agentState: StepState = agentList.some(a => a.state.tone === "red") ? "flag" : agentList.some(a => a.state.tone === "amber") ? "act" : agentList.every(a => a.state.tone === "ok") ? "done" : "todo";
  const agentSummary = agentList.length === 1
    ? `${agentList[0].name}${agentState === "done" ? ": on HMRC's register" : agentState === "flag" ? ": not on HMRC's register" : agentState === "act" ? ": check HMRC's register" : ""}`
    : `${plural(agentList.length, "agent")}${agentState === "flag" ? " · one not on HMRC's register" : agentState === "act" ? ` · ${agentList.filter(a => a.state.tone === "amber").length} to check` : agentState === "done" ? " · all on HMRC's register" : ""}`;
  const sol = solicitorsSummary(solicitors);
  const solState: StepState = sol.tone === "done" ? "done" : sol.tone === "flag" ? "flag" : sol.tone === "act" ? "act" : "todo";
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
            {officer && data.counterparties.length > 0 && <AmlFileButton dealId={dealId} />}
            <AmlBoxMenu dealId={dealId} openAll={openAll.all} onToggleAll={toggleAll} officer={officer} staff={staffView} />
          </span>
        </div>

        {!slots && data.counterparties.length < 2 && (
          <p className="text-xs text-muted-foreground" data-testid="deal-aml-status-incomplete">
            {data.counterparties.length === 0 ? "No parties on this deal yet." : "Only one party on this deal so far."}
          </p>
        )}

        <div className="grid grid-cols-1 gap-2">
          {slots
            ? slots.map(slot => {
                const cp = slot.companyId ? data.counterparties.find(c => c.id === slot.companyId && c.role === slot.role) || data.counterparties.find(c => c.id === slot.companyId) : null;
                return cp ? box(cp, slot) : <UnsetPartyRow key={`unset-${slot.role}`} slot={slot} />;
              })
            : cps.map(cp => box(cp, null))}
        </div>

        {staffView && data.counterparties.length > 0 && (
          <div className="rounded-md border border-border/70" data-testid="aml-deal-sections">
            {(dealFlags.length > 0 || dealAside.length > 0) && (
              <StepRow id={`aml-${dealId}-deal`} testId="aml-section-deal" label="The deal" state={dealFlags.some(f => !f.factor) ? "flag" : dealFlags.length ? "act" : "done"}
                summary={dealFlags.length ? `${plural(dealFlags.length, "red flag")}: ${shortReason(dealFlags[0].label, 60)}` : `${dealAside.length} set aside`}
                open={deal.open.has("deal")} onToggle={() => deal.toggle("deal")}>
                <DealRedFlags dealId={dealId} data={data} />
              </StepRow>
            )}
            {agentList.length > 0 && (
              <StepRow id={`aml-${dealId}-agents`} testId="aml-section-agents" label="Agents" state={agentState} summary={agentSummary}
                open={deal.open.has("agents")} onToggle={() => deal.toggle("agents")}>
                <DealAgentsAml dealId={dealId} bare />
              </StepRow>
            )}
            {/* The other side's solicitors (21 November 2026, "do 7"). */}
            <StepRow id={`aml-${dealId}-solicitors`} testId="aml-section-solicitors" label="Solicitors" state={solState} summary={sol.words}
              open={deal.open.has("solicitors")} onToggle={() => deal.toggle("solicitors")}>
              <DealSolicitorsAmlPanel dealId={dealId} />
            </StepRow>
          </div>
        )}
        {footer}
      </CardContent>
    </Card>
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
// the AI augments alongside their existing per-counterparty KycPanel.
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
      if (!res.ok) throw new Error("deal load failed");
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
              <span className="text-[10px] text-emerald-700 font-medium">Deal can proceed without full CDD</span>
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
