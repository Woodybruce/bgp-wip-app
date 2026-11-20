import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Clock, ShieldCheck, Loader2, FileDown, Sparkles, Upload, Trash2, Brain, ScrollText, Mail, Send, Copy, Cloud, ChevronDown, ChevronUp, TrendingUp, TrendingDown, FolderOpen, Flag } from "lucide-react";
import { Link } from "wouter";
import { KycPanel } from "@/components/kyc-panel";
import { KYC4U_FORM_URL, Kyc4uRequestButton } from "@/components/kyc4u-panel";
import { ClientChecksForParty, SendClientChecksButton, useClientChecks, type ClientChecks } from "@/components/kyc-client-checks";
import { DealPartyEditor, PartyReadyToStart, partyAmlFacts, useDealParties } from "@/components/deal-parties";
import { PartyDecisionButton, PartyDecisions } from "@/components/deal-party-aml";
import { legacyToCode } from "@shared/deal-status";
import { FLAG_REVIEW_COMMENT_MIN, type KycRedFlag, type SetAsideFlag } from "@shared/kyc-red-flags";
import { personDisplayName, personNamesMatch, precheckDay, type PrecheckCardLine, type PrecheckCompany } from "@shared/kyc-prechecks";
import { type AmlRegime, type PartyDueDiligence } from "@shared/aml-policy";
import { AML_BOX_WHO_WORDS, amlBoxDay, amlNextStep, andList, type AmlBoxFacts, type AmlBoxTone } from "@shared/aml-box";
import { AML_STAGE_LABEL, type AmlDashboardRow, type AmlStage } from "@shared/aml-dashboard";
import { SIGNING_COMPANY_WORDS, peopleToReach, type DealPartyRole, type DealPartyView } from "@shared/deal-parties";
import { getAuthHeaders, queryClient, apiRequest } from "@/lib/queryClient";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { RaiseReportButton } from "@/components/aml-register";
import { DealAgentsAml, useDealAgentsAml } from "@/components/agent-aml";
import { AmlFileButton } from "@/components/aml-file-button";

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
    notRequired?: { reason?: string; reasonWords: string; comment?: string; by?: string | null; at?: string | null } | null;
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
    parties: Record<string, { blocked: string | null; needsNote: boolean }>;
  } | null;
  // Which checks the deal needs under BGP's AML policy (BGP staff only).
  regime?: { regime: AmlRegime; why: string } | null;
}

export interface PartyPrecheck {
  // needs_company: no check runs until the deal names the company that signs.
  state: "done" | "running" | "none" | "cap" | "off" | "waiting" | "needs_company";
  startedAt: string | null;
  ranAt: string | null;
  lines: PrecheckCardLine[];
  errors: string[];
  company?: PrecheckCompany | null;
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
        {c.documents.some(d => d.onFile) && <div><dt className="inline text-muted-foreground">On the KYC record: </dt><dd className="inline">{c.documents.filter(d => d.onFile).map(d => d.title).join("; ")}</dd></div>}
      </dl>
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

// ── The AML box, shortened (Woody, 20 November 2026) ─────────────────────────
// "on this page can you build to minimise each section with the detail to pop
// out so people can clearly see whats happening and whats needed its pretty
// overwhelming for them but clearly we need that info displayed for the AML
// officers". Each party opens on its stage (the AML dashboard's rule, read for
// this deal), a Next line (what happens next, who it waits on, and the one
// button that moves it on: shared/aml-box.ts) and one line per section; a line
// opens its detail. Show all detail opens every section of every party,
// remembered per browser, for the officers who want everything in front of them.

export const AML_STAGE_TONE: Record<AmlStage, string> = {
  not_started: "bg-muted text-muted-foreground",
  bgp_checked: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  client_sent: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  client_finished: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200",
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
  done: "border-emerald-200 bg-emerald-50/70 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100",
  act: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100",
  flag: "border-red-300 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950/20 dark:text-red-100",
  wait: "border-sky-200 bg-sky-50/70 text-sky-950 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-100",
};

// One section of a party (or of the deal): one line, the detail on press.
function BoxSection({ id, label, tone, summary, open, onToggle, children, testId }: {
  id: string; label: string; tone: BoxTone; summary: ReactNode; open: boolean; onToggle: () => void; children?: ReactNode; testId: string;
}) {
  return (
    <div id={id} className="border-t border-border/60 first:border-t-0 scroll-mt-4" data-testid={testId}>
      <button type="button" className="flex w-full min-w-0 items-start gap-2 py-1.5 text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open} onClick={onToggle} data-testid={`${testId}-toggle`}>
        <BoxToneIcon tone={tone} />
        {/* On a phone the label sits over its line, so the line has the width. */}
        <span className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-2">
          <span className="block sm:w-[6.25rem] sm:shrink-0 text-[11px] font-semibold uppercase tracking-wider leading-[18px] text-muted-foreground">{label}</span>
          <span className="block min-w-0 sm:flex-1 break-words text-xs leading-[18px] text-foreground">{summary}</span>
        </span>
        <ChevronDown className={`mt-[2px] h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="space-y-2 pb-3 pl-[1.375rem]" data-testid={`${testId}-detail`}>{children}</div>}
    </div>
  );
}

const OPEN_ALL_KEY = "bgp:aml-box:open-all";
const readOpenAll = (): boolean => { try { return window.localStorage.getItem(OPEN_ALL_KEY) === "1"; } catch { return false; } };
const writeOpenAll = (on: boolean) => { try { if (on) window.localStorage.setItem(OPEN_ALL_KEY, "1"); else window.localStorage.removeItem(OPEN_ALL_KEY); } catch { /* per browser only */ } };
type OpenAll = { all: boolean; at: number };

type SectionKey = "company" | "checks" | "level" | "people" | "client" | "flags" | "kyc4u" | "decision";
const SECTION_KEYS: SectionKey[] = ["company", "checks", "level", "people", "client", "flags", "kyc4u", "decision"];

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

const REQUEST_WORDS: Record<string, string> = {
  not_sent: "Not sent", sent: "Sent", opened: "Opened", in_progress: "In progress", finished: "Finished", expired: "Link ran out",
};
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) : "");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// "BGP's checks" keeps its capitals mid-sentence; "Enhanced due diligence" reads on.
const onInSentence = (t: string) => (!t || /^[A-Z][A-Z]/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));
const LEVEL_WORDS: Record<PartyDueDiligence["level"], string> = { simplified: "Simplified", standard: "Standard", enhanced: "Enhanced" };

function PartyAmlBox({ dealId, data, cp, row, party, checks, openAll, startFolded }: {
  dealId: string; data: DealAmlStatus; cp: Counterparty; row: AmlDashboardRow | null; party: DealPartyView | null;
  checks: ClientChecks | undefined; openAll: OpenAll; startFolded?: boolean;
}) {
  const staff = !!data.prechecks;
  const { open, toggle, show } = useOpenSections(SECTION_KEYS, openAll);
  const [folded, setFolded] = useState(!!startFolded && !openAll.all);
  useEffect(() => { if (openAll.at && openAll.all) setFolded(false); }, [openAll.at]);
  const [editing, setEditing] = useState(false);
  const drafts = useQuery<any[]>({
    enabled: staff,
    queryKey: ["/api/kyc4u/drafts", dealId, cp.id],
    queryFn: async () => (await apiRequest("GET", `/api/kyc4u/drafts?${new URLSearchParams({ dealId, companyId: cp.id })}`)).json(),
  });
  const kyc4uCompany = useQuery<{ requests: Array<{ status: string | null }> }>({ queryKey: ["/api/kyc4u/company", cp.id], enabled: staff, staleTime: 5 * 60_000 });

  const reveal = (k: SectionKey) => {
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
  const companyMissing = party ? party.brand.kind === "company" && !party.company : pre?.state === "needs_company";
  const people = checks?.people?.[cp.id] || null;
  const requests = (checks?.requests || []).filter(r => r.companyId === cp.id && !r.person);
  const request = requests.find(r => r.status !== "cancelled") || null;
  const owing = people && people.basis !== "individual" ? people.people.filter(p => p.outstanding.length) : [];
  const unreachable = party && people ? peopleToReach(people.people, party.people, personNamesMatch) : [];
  const draft = (drafts.data || []).find((d: any) => d.status !== "cancelled") || null;
  const kyc4uState: AmlBoxFacts["kyc4u"] = draft?.status === "queued" ? "queued" : draft ? "raised" : "none";
  const gaps = (party?.gaps || []).filter(g => g.key !== "company")
    .map(g => (g.key === "person" ? "Set who to ask for the checks: their name and email" : `Add an email for ${party?.person?.name || "the person to ask"}`));

  const facts: AmlBoxFacts = {
    role: cp.role, stage, due: row ? row.due : null,
    approvedBy: cp.kyc_approved_by, expiresAt: cp.kyc_expires_at, notRequiredWords: cp.notRequired?.reasonWords || null,
    company: isCompany, companyMissing, gaps, askName: party?.person?.name || null,
    precheckRunning: pre?.state === "running",
    redFlags: flags.length, factors: factors.length + dealFactors.length,
    sanctionsOnly, clientChecks: !!data.clientChecks,
    request: request ? { status: request.status as NonNullable<AmlBoxFacts["request"]>["status"], to: request.recipientName || request.recipientEmail } : null,
    people: owing.map(p => ({ name: personDisplayName(p.name), needs: [...p.outstanding], reachable: !unreachable.includes(p), linked: !!p.own })),
    kyc4u: kyc4uState, canSignOff, canDecide,
    signOffBlocked: decision ? decision.blocked : data.decisions ? "This party could not be read." : null,
    needsNote: !!decision?.needsNote,
  };
  const step = amlNextStep(facts);

  const nextAction: ReactNode = (() => {
    switch (step.action) {
      case "fill_in": return <Button type="button" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)} data-testid={`aml-next-fill-${cp.role}`}>Fill in</Button>;
      case "add_details": return <Button type="button" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)} data-testid={`aml-next-details-${cp.role}`}>Add their details</Button>;
      case "send_client_checks": return <SendClientChecksButton dealId={dealId} companyId={cp.id} partyName={partyName} />;
      case "people": return <Button type="button" size="sm" variant="outline" className="h-7 text-xs bg-background" onClick={() => reveal("people")} data-testid={`aml-next-people-${cp.role}`}>Open People</Button>;
      case "request_kyc4u": return <Kyc4uRequestButton dealId={dealId} companyId={cp.id} role={cp.role} partyName={partyName} buttonOnly />;
      case "kyc4u_form": return <Button type="button" size="sm" variant="outline" className="h-7 text-xs bg-background" asChild><a href={KYC4U_FORM_URL} target="_blank" rel="noopener noreferrer">Open KYC4U's form</a></Button>;
      case "kyc4u_result": return <PartyDecisionButton dealId={dealId} data={data} companyId={cp.id} role={cp.role} partyName={partyName} kind="kyc4u_result" />;
      case "sign_off": return <PartyDecisionButton dealId={dealId} data={data} companyId={cp.id} role={cp.role} partyName={partyName} kind="sign_off" />;
      case "red_flags": return <Button type="button" size="sm" variant="outline" className="h-7 text-xs bg-background" onClick={() => reveal("flags")}>See the red flags</Button>;
      default: return null;
    }
  })();

  // ── Each section's line.
  const reg = pre?.company || null;
  const companyLine: { tone: BoxTone; summary: ReactNode } = party?.company
    ? {
        tone: reg?.warnings.length ? "flag" : "done",
        summary: <><span className="font-medium">{party.company.name}</span>{party.company.companiesHouseNumber ? <span className="ml-1 font-mono tabular-nums text-muted-foreground">{party.company.companiesHouseNumber}</span> : null}
          {reg ? <span className="text-muted-foreground"> · {[reg.status && reg.status.toLowerCase(), reg.listing ? "listed" : null, reg.owners.length ? plural(reg.owners.length, "owner") : null].filter(Boolean).join(" · ")}</span> : null}
          {reg?.warnings.length ? <span className="text-red-700 dark:text-red-400"> · {reg.warnings[0]}</span> : null}</>,
      }
    : companyMissing
      ? { tone: settled ? "info" : "act", summary: <span className={settled ? "text-muted-foreground" : "text-amber-800 dark:text-amber-300"}>Not set: {SIGNING_COMPANY_WORDS[cp.role as DealPartyRole] || "the company that signs"}</span> }
      : { tone: "info", summary: <span className="text-muted-foreground">{cp.signsAs || "Not read yet"}</span> };

  const attention = pre ? pre.lines.filter(l => l.state === "attention").length : 0;
  const namesakes = pre?.lines.find(l => l.key === "namesakes") || null;
  const checksLine: { tone: BoxTone; summary: string } | null = !pre || pre.state === "off" ? null
    : pre.state === "running" ? { tone: "wait", summary: "Running now: Companies House, the sanctions lists and a web search" }
    : pre.state === "needs_company" ? { tone: "info", summary: "Waiting for the company that signs" }
    : pre.state === "cap" ? { tone: "wait", summary: "Today's limit is used: they run tomorrow" }
    : pre.state === "none" ? { tone: "wait", summary: "Not run yet: they start when this box opens" }
    : pre.unfinished || pre.state === "waiting" ? { tone: "act", summary: "Not finished: Companies House did not answer. They run again by themselves" }
    : {
        tone: attention ? "flag" : "done",
        summary: `${pre.ranAt ? `${precheckDay(pre.ranAt)} · ` : ""}${attention ? `${attention} to review` : "nothing to review"}${namesakes ? ` · ${namesakes.label.toLowerCase()}` : ""}`,
      };

  const levelLine: { tone: BoxTone; summary: string } | null = !level || cp.notRequired ? null : {
    tone: level.level === "enhanced" ? "act" : "done",
    summary: [
      `${LEVEL_WORDS[level.level]}, approval lasts ${plural(level.recheckYears, "year")}`,
      factors.length + dealFactors.length ? plural(factors.length + dealFactors.length, "higher-risk factor") : null,
      level.toWeigh.length ? `${level.toWeigh.length} to weigh` : null,
    ].filter(Boolean).join(" · "),
  };

  const peopleLine: { tone: BoxTone; summary: string } | null = (() => {
    if (!data.clientChecks || !people || people.basis === "individual" || cp.notRequired || !isCompany) return null;
    const possible = [...people.people.map(p => p.sanctions), ...people.directors.map(d => d.sanctions)].includes("possible");
    if (sanctionsOnly) {
      const n = people.people.length + people.directors.length;
      return { tone: possible ? "flag" : "done", summary: `${plural(n, "person", "people")} screened, sanctions only: ${possible ? "a possible match" : "no match"}` };
    }
    if (people.basis === "not_read") return { tone: "wait", summary: "Not read yet: the owners come from Companies House" };
    const n = people.people.length;
    const done = n - owing.length;
    const directors = people.directors.length ? ` · ${plural(people.directors.length, "director")}, sanctions only` : "";
    if (!n) return { tone: "info", summary: `No one to verify${directors}` };
    const summary = owing.length
      ? `${done} of ${n} done · waiting on ${andList(owing.map(p => personDisplayName(p.name)))}${directors}`
      : `${n === 1 ? "Done" : `All ${n} done`}${directors}`;
    return { tone: possible ? "flag" : unreachable.length || owing.some(p => !p.own) ? "act" : owing.length ? "wait" : "done", summary: possible ? `${summary} · a possible sanctions match` : summary };
  })();

  const clientLine: { tone: BoxTone; summary: string } | null = !data.clientChecks || cp.notRequired ? null
    : companyMissing ? { tone: "info", summary: "Start once the company that signs is set" }
    : !request ? (sanctionsOnly ? { tone: "done", summary: "Not needed: sanctions checks only" }
      : { tone: "act", summary: (checks?.requests || []).some(r => r.companyId === cp.id && r.person && r.status !== "cancelled")
          ? "Not sent to the person dealing with us yet (the owners have links of their own)" : "Not sent yet" })
    : {
        tone: request.status === "finished" ? "done" : request.status === "not_sent" || request.status === "expired" ? "act" : "wait",
        summary: [REQUEST_WORDS[request.status] || request.status, request.recipientName || request.recipientEmail, request.sentAt ? `sent ${day(request.sentAt)}` : null,
          request.finishedAt ? `finished ${day(request.finishedAt)}` : null].filter(Boolean).join(" · "),
      };

  const unchecked = data.redFlags?.unchecked || [];
  const flagAside = aside.filter(a => !a.flag.factor).length;
  const flagsLine: { tone: BoxTone; summary: string } | null = !data.redFlags ? null
    : flags.length
      ? { tone: "flag", summary: `${plural(flags.length, "red flag")}: ${flags[0].label}${flags.length > 1 ? `, and ${flags.length - 1} more` : ""}` }
      : { tone: unchecked.length ? "act" : "done", summary: `None${flagAside ? ` · ${flagAside} set aside` : ""}${unchecked.length ? " · some records could not be read" : ""}` };

  const kyc4uReq = kyc4uCompany.data?.requests?.[0] || null;
  const kyc4uLine: { tone: BoxTone; summary: string } | null = !staff || cp.notRequired ? null
    : draft?.status === "queued" ? { tone: "act", summary: "Ready for KYC4U's form: press your Send to ChatBGP bookmark there" }
    : draft?.status === "filled" ? { tone: "wait", summary: `Filled on KYC4U's form ${day(draft.filled_at)}: submit it there` }
    : draft ? { tone: "wait", summary: `Raised · ${draft.request_status || "no status yet"}` }
    : kyc4uReq ? { tone: "info", summary: `KYC4U's record: ${kyc4uReq.status || "no status yet"}` }
    : { tone: flags.length || factors.length ? "act" : "info", summary: flags.length || factors.length ? "Not raised: the red flags go to KYC4U" : "Not raised: needed only for a red flag or enhanced due diligence" };

  const decisionLine: { tone: BoxTone; summary: string } = stage === "rejected" ? { tone: "flag", summary: "Rejected" }
    : cp.notRequired ? { tone: "done", summary: `Not required: ${cp.notRequired.reasonWords}` }
    : approved ? { tone: "done", summary: `Approved${cp.kyc_approved_by ? ` by ${cp.kyc_approved_by}` : ""}${cp.kyc_expires_at ? `, valid until ${amlBoxDay(cp.kyc_expires_at)}` : ""}` }
    : cp.isExpired ? { tone: "flag", summary: `Expired${cp.kyc_expires_at ? ` on ${amlBoxDay(cp.kyc_expires_at)}` : ""}: check it again` }
    : !data.decisions ? { tone: "info", summary: "An agent on the deal, the Nominated Officer or a Deputy signs it off" }
    : decision && decision.blocked === null && canSignOff ? { tone: decision.needsNote ? "info" : "act", summary: decision.needsNote ? "Can be signed off now, with a note: the client checks are not finished" : "Ready to sign off" }
    : { tone: "wait", summary: `Not yet: ${decision?.blocked ? onInSentence(decision.blocked) : "this party could not be read"}` };

  const aml = partyAmlFacts(data, cp.id);
  const sid = (k: SectionKey) => `aml-${cp.id}-${k}`;
  const tid = (k: SectionKey) => `aml-section-${cp.role}-${k}`;

  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3 space-y-2.5" data-testid={`counterparty-${cp.id}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] uppercase">{cp.role}</Badge>
            <Link href={`/companies/${cp.id}`} className="font-medium text-sm hover:underline truncate">{cp.name}</Link>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 break-words" data-testid={`counterparty-signs-as-${cp.id}`}>
            {party?.company || cp.signsAs
              ? <>Signs as <span className="text-foreground">{party?.company?.name || cp.signsAs}</span></>
              : isCompany ? <span className="text-amber-700 dark:text-amber-400">Company that signs not set</span> : "A private individual"}
            {party && <> · {party.person
              ? <>Ask <span className="text-foreground">{party.person.name}</span>{party.person.email ? null : <span className="text-amber-700 dark:text-amber-400"> (no email)</span>}</>
              : <span className="text-amber-700 dark:text-amber-400">nobody to ask yet</span>}</>}
            {party && staff && <> · <button type="button" data-no-min-touch className="underline underline-offset-2 hover:text-foreground" onClick={() => setEditing(true)} data-testid={`aml-party-change-${cp.role}`}>Change</button></>}
          </div>
        </div>
        {stage
          ? <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${AML_STAGE_TONE[stage]}`} data-testid={`aml-box-stage-${cp.role}`}>
              {stage === "expiring" && cp.kyc_expires_at ? `Expires ${amlBoxDay(cp.kyc_expires_at)}` : AML_STAGE_LABEL[stage]}
            </span>
          : <Badge variant="secondary" className="shrink-0 text-[11px]">In progress</Badge>}
      </div>

      <div className={`rounded-md border px-2.5 py-2 ${NEXT_BOX[step.tone]}`} data-testid={`aml-next-${cp.role}`}>
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5">
          <BoxToneIcon tone={step.tone} />
          <div className="min-w-0 flex-1 basis-48">
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{step.tone === "done" ? "Done" : AML_BOX_WHO_WORDS[step.who]}</div>
            <div className="text-[13px] leading-snug" data-testid={`aml-next-words-${cp.role}`}>{step.words}</div>
          </div>
          {(nextAction || (flags.length > 0 && step.action === "request_kyc4u")) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {nextAction}
              {flags.length > 0 && step.action === "request_kyc4u" && (
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => reveal("flags")} data-testid={`aml-next-see-flags-${cp.role}`}>See them</Button>
              )}
            </div>
          )}
        </div>
      </div>

      {staff && (folded ? (
        <button type="button" data-no-min-touch className="text-xs text-primary hover:underline" onClick={() => setFolded(false)} data-testid={`aml-box-unfold-${cp.role}`}>
          Show this party's checks
        </button>
      ) : (
        <div className="rounded-md border border-border/70 px-2.5" data-testid={`aml-sections-${cp.role}`}>
          {isCompany && (
            <BoxSection id={sid("company")} testId={tid("company")} label="Company" tone={companyLine.tone} summary={companyLine.summary} open={open.has("company")} onToggle={() => toggle("company")}>
              {companyMissing
                ? (settled ? <p className="text-xs text-muted-foreground">Not set on this deal.</p> : <PartyReadyToStart dealId={dealId} companyId={cp.id} aml={aml} />)
                : reg ? <PartyCompanyFacts data={data} companyId={cp.id} />
                : <p className="text-xs text-muted-foreground">BGP's checks before asking read the company from Companies House.</p>}
            </BoxSection>
          )}
          {checksLine && (
            <BoxSection id={sid("checks")} testId={tid("checks")} label="BGP's checks" tone={checksLine.tone} summary={checksLine.summary} open={open.has("checks")} onToggle={() => toggle("checks")}>
              <PartyPrechecks dealId={dealId} data={data} companyId={cp.id} />
            </BoxSection>
          )}
          {levelLine && (
            <BoxSection id={sid("level")} testId={tid("level")} label="Due diligence" tone={levelLine.tone} summary={levelLine.summary} open={open.has("level")} onToggle={() => toggle("level")}>
              <PartyLevel data={data} companyId={cp.id} />
              <PartyRedFlags dealId={dealId} data={data} companyId={cp.id} role={cp.role} only="factors" />
            </BoxSection>
          )}
          {peopleLine && (
            <BoxSection id={sid("people")} testId={tid("people")} label="People" tone={peopleLine.tone} summary={peopleLine.summary} open={open.has("people")} onToggle={() => toggle("people")}>
              {unreachable.length > 0 && (
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  No email or mobile held for {andList(unreachable.map(p => personDisplayName(p.name)))}. <button type="button" data-no-min-touch className="underline underline-offset-2" onClick={() => setEditing(true)}>Add their details</button>
                </p>
              )}
              <ClientChecksForParty dealId={dealId} companyId={cp.id} sanctionsOnly={sanctionsOnly} notRequired={!!cp.notRequired} canDecide={canDecide} part="people" />
            </BoxSection>
          )}
          {clientLine && (
            <BoxSection id={sid("client")} testId={tid("client")} label="Client checks" tone={clientLine.tone} summary={clientLine.summary} open={open.has("client")} onToggle={() => toggle("client")}>
              {companyMissing
                ? <p className="text-xs text-muted-foreground" data-testid={`kyc-actions-wait-${cp.id}`}>The client checks and a KYC4U request start once the company that signs is set.</p>
                : <>
                    <SendClientChecksButton dealId={dealId} companyId={cp.id} partyName={partyName} label={request ? "Send them again" : "Send client checks"} />
                    <ClientChecksForParty dealId={dealId} companyId={cp.id} sanctionsOnly={sanctionsOnly} notRequired={!!cp.notRequired} canDecide={canDecide} part="requests" />
                  </>}
            </BoxSection>
          )}
          {flagsLine && (
            <BoxSection id={sid("flags")} testId={tid("flags")} label="Red flags" tone={flagsLine.tone} summary={flagsLine.summary} open={open.has("flags")} onToggle={() => toggle("flags")}>
              {flags.length || flagAside ? <PartyRedFlags dealId={dealId} data={data} companyId={cp.id} role={cp.role} only="flags" /> : <p className="text-xs text-muted-foreground">Nothing found that sends this party to KYC4U.</p>}
              {unchecked.length > 0 && <p className="text-xs text-amber-800 dark:text-amber-300">Red flags could not be checked against: {unchecked.join(", ")}.</p>}
            </BoxSection>
          )}
          {kyc4uLine && (
            <BoxSection id={sid("kyc4u")} testId={tid("kyc4u")} label="KYC4U" tone={kyc4uLine.tone} summary={kyc4uLine.summary} open={open.has("kyc4u")} onToggle={() => toggle("kyc4u")}>
              {companyMissing
                ? <p className="text-xs text-muted-foreground">The client checks and a KYC4U request start once the company that signs is set.</p>
                : <Kyc4uRequestButton dealId={dealId} companyId={cp.id} role={cp.role} partyName={partyName} />}
            </BoxSection>
          )}
          <BoxSection id={sid("decision")} testId={tid("decision")} label="Sign-off" tone={decisionLine.tone} summary={decisionLine.summary} open={open.has("decision")} onToggle={() => toggle("decision")}>
            <PartyNotRequiredBox cp={cp} />
            <PartyDecisions dealId={dealId} data={data} companyId={cp.id} role={cp.role} partyName={partyName} approved={approved} notRequired={!!cp.notRequired} />
            {canDecide && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid={`aml-file-line-${cp.role}`}>
                <AmlFileButton dealId={dealId} role={cp.role} partyName={partyName} />
                <span>This party's report and documents, for HMRC or KYC4U.</span>
              </div>
            )}
            {!data.decisions && <p className="text-xs text-muted-foreground">A standard party is signed off by an agent on the deal, the Nominated Officer or a Deputy; an enhanced one by the Nominated Officer or a Deputy.</p>}
          </BoxSection>
        </div>
      ))}
      {editing && <DealPartyEditor dealId={dealId} role={cp.role as DealPartyRole} aml={aml} onClose={() => setEditing(false)} />}
    </div>
  );
}

// focusCompanyId: the AML checks page's party (its trail), drawn first and in
// full; the deal's other parties follow, each on its Next line until opened.
export function DealAmlStatusCard({ dealId, dealStatus, focusCompanyId }: { dealId: string; dealStatus?: string | null; focusCompanyId?: string | null }) {
  const { data, isLoading } = useDealAmlStatus(dealId);
  // BGP's own reads (the checks before asking) come only to BGP staff: the
  // party lines follow them.
  const staffView = !!data?.prechecks;
  const { data: parties } = useDealParties(dealId, staffView);
  const { data: checks } = useClientChecks(dealId, staffView && !!data?.clientChecks);
  const { data: board } = useDealAmlRows(dealId, staffView);
  const { data: agents } = useDealAgentsAml(dealId, staffView);
  const [openAll, setOpenAll] = useState<OpenAll>(() => ({ all: readOpenAll(), at: 0 }));
  const deal = useOpenSections<"deal" | "agents">(["deal", "agents"], openAll);
  const [howOpen, setHowOpen] = useState(false);

  if (isLoading) return (
    <Card><CardContent className="py-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin" /></CardContent></Card>
  );
  if (!data) return null;

  const toggleAll = () => setOpenAll(o => { const all = !o.all; writeOpenAll(all); return { all, at: o.at + 1 }; });
  const cps = focusCompanyId
    ? [...data.counterparties].sort((a, b) => Number(b.id === focusCompanyId) - Number(a.id === focusCompanyId))
    : data.counterparties;
  const settled = data.counterparties.filter(cp => (cp.isApproved && !cp.isExpired) || cp.notRequired).length;
  const dealFlags = data.redFlags?.deal || [];
  const dealAside = data.redFlags?.dealSetAside || [];
  const agentList = agents?.agents || [];
  const agentTone: BoxTone = agentList.some(a => a.state.tone === "red") ? "flag" : agentList.some(a => a.state.tone === "amber") ? "act" : agentList.every(a => a.state.tone === "ok") ? "done" : "info";
  const agentSummary = agentList.length === 1
    ? `${agentList[0].roleWords}: ${agentList[0].name}${agentTone === "done" ? ", checked" : agentTone === "flag" ? ", not on HMRC's register" : agentTone === "act" ? ", to check on HMRC's register" : ""}`
    : `${plural(agentList.length, "agent")}${agentTone === "flag" ? " · one is not on HMRC's register" : agentTone === "act" ? ` · ${agentList.filter(a => a.state.tone === "amber").length} to check on HMRC's register` : agentTone === "done" ? " · all checked" : ""}`;

  return (
    <Card data-testid="deal-aml-status-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className={`w-4 h-4 ${data.allApproved ? "text-emerald-600" : "text-muted-foreground"}`} />
          <h3 className="font-semibold text-sm">AML</h3>
          {data.allApproved ? (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200" data-testid="badge-deal-aml-clear">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              AML clear: invoice unlocked
            </Badge>
          ) : (
            <Badge variant="secondary" data-testid="badge-deal-aml-blocked">
              <Clock className="w-3 h-3 mr-1" />
              {data.counterparties.length ? `${settled} of ${data.counterparties.length} done` : "AML pending"}
            </Badge>
          )}
          {staffView && (
            <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={toggleAll} data-testid="aml-box-open-all">
              {openAll.all ? <ChevronUp className="w-3.5 h-3.5 mr-1" /> : <ChevronDown className="w-3.5 h-3.5 mr-1" />}{openAll.all ? "Hide the detail" : "Show all detail"}
            </Button>
          )}
          {/* The officers' AML file for the whole deal (20 November 2026). */}
          {data.decisions?.canDecide && data.counterparties.length > 0 && <AmlFileButton dealId={dealId} />}
        </div>

        {data.counterparties.length < 2 && (
          <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-md text-sm dark:bg-amber-950/20 dark:border-amber-900" data-testid="deal-aml-status-incomplete">
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <span>{data.counterparties.length === 0 ? "No parties on this deal yet" : "Only one party on this deal so far"}: set them on the deal record, and each gets its checks here.</span>
          </div>
        )}
        <DealRegime data={data} />

        {staffView && (dealFlags.length > 0 || dealAside.length > 0 || agentList.length > 0) && (
          <div className="rounded-md border border-border/70 px-2.5" data-testid="aml-deal-sections">
            {(dealFlags.length > 0 || dealAside.length > 0) && (
              <BoxSection id={`aml-${dealId}-deal`} testId="aml-section-deal" label="Deal record" tone={dealFlags.some(f => !f.factor) ? "flag" : dealFlags.length ? "act" : "done"}
                summary={dealFlags.length ? `${plural(dealFlags.length, "red flag")} on the deal itself: ${dealFlags[0].label}` : `None · ${dealAside.length} set aside`}
                open={deal.open.has("deal")} onToggle={() => deal.toggle("deal")}>
                <DealRedFlags dealId={dealId} data={data} />
              </BoxSection>
            )}
            {agentList.length > 0 && (
              <BoxSection id={`aml-${dealId}-agents`} testId="aml-section-agents" label="Agents" tone={agentTone} summary={agentSummary}
                open={deal.open.has("agents")} onToggle={() => deal.toggle("agents")}>
                {staffView && <DealAgentsAml dealId={dealId} bare />}
              </BoxSection>
            )}
          </div>
        )}

        {/* grid-cols-1, not a bare grid: an implicit column grows to its
            widest line, which pushed the boxes past a phone's width. */}
        <div className={`grid grid-cols-1 gap-3 ${focusCompanyId || cps.length < 2 ? "" : "xl:grid-cols-2"}`}>
          {cps.map(cp => (
            <PartyAmlBox
              key={cp.id}
              dealId={dealId}
              data={data}
              cp={cp}
              row={board?.rows.find(r => r.brandId === cp.id && r.role === cp.role) || null}
              party={parties?.parties.find(p => p.brand.id === cp.id) || null}
              checks={checks}
              openAll={openAll}
              startFolded={!!focusCompanyId && cp.id !== focusCompanyId}
            />
          ))}
        </div>

        {/* "Invoice locked" read as false on deals already Invoiced/Completed
            (and invoices can be drafted before AML clears) — say plainly what
            is outstanding instead (Woody, 2026-09-27). */}
        {!data.allApproved && data.missing.length > 0 && (
          <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs" data-testid="deal-aml-blocker">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span><span className="font-medium">{dealStatus && ["INV", "COM"].includes(legacyToCode(dealStatus) || "") ? "AML sign-off still outstanding" : "Still to approve"}:</span> {data.missing.join(", ")}.</span>
              <button type="button" data-no-min-touch className="text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setHowOpen(o => !o)} data-testid="deal-aml-how">
                {howOpen ? "Hide" : "How a party clears"}
              </button>
            </div>
            {howOpen && (
              <p className="mt-1.5 text-muted-foreground">
                {data.clientChecks
                  ? <>Send each party's contact the client checks; a party needing enhanced due diligence goes to KYC4U, BGP's outsourced KYC provider. A party clears when an agent on the deal, the Nominated Officer or a Deputy signs it off, or when KYC4U approves it (their result added here by the Nominated Officer or a Deputy, or after the next sync).</>
                  : <>Raise each party with Request KYC4U check (KYC4U are BGP's outsourced KYC provider); their approval clears it here once their result is added or synced. A standard party can be signed off by an agent on the deal, the Nominated Officer or a Deputy.</>}
              </p>
            )}
          </div>
        )}

        {staffView && <DealSuspicionLine dealId={dealId} officer={!!data.decisions?.canDecide} />}
      </CardContent>
    </Card>
  );
}

// Anything that seems wrong about the deal goes to the Nominated Officer, in
// confidence (BGP's AML policy, I.b): never discussed with the client or
// colleagues.
function DealSuspicionLine({ dealId, officer }: { dealId: string; officer: boolean }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-testid="deal-aml-suspicion">
      Something about this deal seems wrong? Tell the Nominated Officer in confidence, not the client or colleagues.
      <RaiseReportButton dealId={dealId} officer={officer} label="Report to the Nominated Officer" className="h-7 text-xs" testId="deal-aml-raise-report" />
    </p>
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
