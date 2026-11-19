import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Clock, ShieldCheck, Loader2, FileDown, Sparkles, Upload, Trash2, Brain, ScrollText, Mail, Send, Copy, Cloud, ChevronDown, ChevronUp, TrendingUp, TrendingDown, FolderOpen, Flag } from "lucide-react";
import { Link } from "wouter";
import { KycPanel } from "@/components/kyc-panel";
import { Kyc4uRequestButton } from "@/components/kyc4u-panel";
import { ClientChecksForParty, SendClientChecksButton } from "@/components/kyc-client-checks";
import { PartyReadyToStart, useDealParties } from "@/components/deal-parties";
import { PartyDecisions } from "@/components/deal-party-aml";
import { legacyToCode } from "@shared/deal-status";
import { FLAG_REVIEW_COMMENT_MIN, type KycRedFlag, type SetAsideFlag } from "@shared/kyc-red-flags";
import { precheckDay, type PrecheckCardLine, type PrecheckCompany } from "@shared/kyc-prechecks";
import { getAuthHeaders, queryClient, apiRequest } from "@/lib/queryClient";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

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
  } | null;
  // BGP's checks before asking, per party (BGP staff only).
  prechecks?: Record<string, PartyPrecheck> | null;
  // BGP's sign-off and KYC4U's result (BGP staff only): whether the person
  // may decide, and per party whether BGP may sign it off now.
  decisions?: { canDecide: boolean; mlroAppointed: boolean; parties: Record<string, { blocked: string | null; needsNote: boolean }> } | null;
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
    <div className="rounded-md border border-border bg-card p-2.5 space-y-1.5" data-testid={`kyc-company-${companyId}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Company checked</span>
        <a href={c.registerUrl} target="_blank" rel="noreferrer" className="ml-auto text-[11px] text-primary hover:underline">Companies House register</a>
      </div>
      <div className="text-sm">
        <span className="font-semibold">{c.name}</span>
        <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">{c.number}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">{[c.type, c.status, c.incorporatedOn ? `incorporated ${c.incorporatedOn}` : null].filter(Boolean).join(" · ")}</div>
      {c.warnings.length > 0 && (
        <ul className="text-xs text-red-700 dark:text-red-400 space-y-0.5">{c.warnings.map(w => <li key={w}>{w}</li>)}</ul>
      )}
      <dl className="grid grid-cols-1 gap-y-1 text-xs">
        {c.registeredOffice && <div><dt className="inline text-muted-foreground">Registered office: </dt><dd className="inline">{c.registeredOffice}</dd></div>}
        {c.business.length > 0 && <div><dt className="inline text-muted-foreground">Business: </dt><dd className="inline">{c.business.join("; ")}</dd></div>}
        {c.listing && <div data-testid={`kyc-company-listing-${companyId}`}><dt className="inline text-muted-foreground">Listed: </dt><dd className="inline">{c.listing}. {c.listingNote}</dd></div>}
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
  const [open, setOpen] = useState(false);
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
  const attention = view.lines.filter(l => l.state === "attention").length;
  const icon = (l: PrecheckCardLine) => l.state === "ok" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
    : l.state === "attention" ? <Flag className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
    : l.state === "not_run" ? <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
    : <AlertCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />;
  return (
    <div className="rounded-md border border-border bg-card p-2.5 text-xs space-y-1.5" data-testid={`kyc-prechecks-${companyId}`}>
      <div className="flex items-center gap-2">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground text-[11px]">Checked before asking</span>
        {view.ranAt && !running && <span className="text-[11px] text-muted-foreground">{precheckDay(view.ranAt)}</span>}
        {view.lines.length > 0 && !running && (
          <span className="text-[11px]" data-testid={`kyc-prechecks-summary-${companyId}`}>{attention ? `${attention} to review` : "nothing to review"}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {view.lines.length > 0 && (
            <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => setOpen(o => !o)} data-testid={`kyc-prechecks-toggle-${companyId}`}>
              {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}{open ? "Hide" : "Show"}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" disabled={running} onClick={() => again.mutate()} data-testid={`kyc-prechecks-again-${companyId}`}>
            Run again
          </Button>
        </div>
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
      {(open || (attention > 0 && !running)) && view.lines.length > 0 && (
        <ul className="space-y-1.5" data-testid={`kyc-prechecks-lines-${companyId}`}>
          {view.lines.filter(l => open || l.state === "attention").map(l => (
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
      {open && view.errors.length > 0 && (
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

function RedFlagList({ dealId, role, flags, setAside, canDecide, title, step, testId }: {
  dealId: string; role: string | null; flags: KycRedFlag[]; setAside: SetAsideFlag[]; canDecide: boolean;
  title: string; step: string; testId: string;
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
        <div className="rounded-md border border-red-300 bg-red-50 p-2.5 text-xs text-red-900 dark:bg-red-950/20 dark:text-red-200" data-testid={`${testId}-live`}>
          <div className="flex items-center gap-1.5 text-sm font-semibold"><Flag className="w-3.5 h-3.5 shrink-0" />{title}</div>
          <ul className="mt-1.5 space-y-1.5">
            {flags.map((f, i) => {
              const id = `${f.key}-${i}`;
              const open = openKey === id;
              return (
                <li key={id} className="space-y-0.5" data-testid={`kyc-flag-${f.key}`}>
                  <div className="flex items-start gap-1.5">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{f.label}</div>
                      {f.detail && <div className="text-red-800/80 dark:text-red-200/80 break-words">{f.detail}</div>}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <button type="button" className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline" onClick={() => setOpenKey(open ? null : id)} data-testid={`kyc-flag-detail-${f.key}`}>
                          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}{open ? "Hide detail" : "Detail"}
                        </button>
                        {canDecide && (
                          <button type="button" className="underline-offset-2 hover:underline" onClick={() => setDialog(f)} data-testid={`kyc-flag-set-aside-${f.key}`}>Set aside</button>
                        )}
                      </div>
                      {open && <FlagFacts flag={f} />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5">{step}{canDecide ? " Or, if one is not a concern, set it aside with a comment." : " The MLRO, or an admin until one is appointed, can set one aside with a comment."}</p>
        </div>
      )}
      {setAside.length > 0 && (
        <div className="rounded-md border border-border bg-muted/30 p-2 text-xs" data-testid={`${testId}-aside`}>
          <button type="button" className="flex w-full items-center gap-1 text-left text-muted-foreground hover:text-foreground" onClick={() => setAsideOpen(o => !o)}>
            {asideOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {setAside.length} red flag{setAside.length === 1 ? "" : "s"} set aside
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

function PartyRedFlags({ dealId, data, companyId, role }: { dealId: string; data: DealAmlStatus; companyId: string; role: string }) {
  return (
    <RedFlagList
      dealId={dealId}
      role={role}
      flags={data.redFlags?.parties[companyId] || []}
      setAside={data.redFlags?.setAside?.[companyId] || []}
      canDecide={!!data.decisions?.canDecide}
      title="Red flag: raise with KYC4U"
      step="Press Request KYC4U check below: the red flags are already in its note."
      testId={`kyc-red-flags-${companyId}`}
    />
  );
}

function DealRedFlags({ dealId, data }: { dealId: string; data: DealAmlStatus }) {
  const unchecked = data.redFlags?.unchecked || [];
  return (
    <>
      <RedFlagList
        dealId={dealId}
        role={null}
        flags={data.redFlags?.deal || []}
        setAside={data.redFlags?.dealSetAside || []}
        canDecide={!!data.decisions?.canDecide}
        title="Red flag on the deal record"
        step="It is not tied to one party: Request KYC4U check on the party it concerns carries it in the note."
        testId="kyc-red-flags-deal"
      />
      {unchecked.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="kyc-red-flags-unchecked">
          Red flags could not be checked against: {unchecked.join(", ")}.
        </p>
      )}
    </>
  );
}

// Client checks and KYC4U are about the company that signs: until the deal
// names it, the buttons wait (the server refuses them too).
function PartyActions({ dealId, data, cp, wide }: { dealId: string; data: DealAmlStatus; cp: DealAmlStatus["counterparties"][number]; wide?: boolean }) {
  if (data.prechecks?.[cp.id]?.state === "needs_company") {
    return <p className="text-[11px] text-muted-foreground" data-testid={`kyc-actions-wait-${cp.id}`}>The client checks and a KYC4U request start once the company that signs is set.</p>;
  }
  return (
    <>
      {data.clientChecks && (
        <>
          <SendClientChecksButton dealId={dealId} companyId={cp.id} partyName={cp.kycName || cp.name} className={wide ? "w-full justify-center" : undefined} />
          <ClientChecksForParty dealId={dealId} companyId={cp.id} />
        </>
      )}
      <Kyc4uRequestButton dealId={dealId} companyId={cp.id} role={cp.role} partyName={cp.kycName || cp.name} />
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

export function DealAmlStatusCard({ dealId, dealStatus }: { dealId: string; dealStatus?: string | null }) {
  const { data, isLoading } = useDealAmlStatus(dealId);
  const [expanded, setExpanded] = useState<string | null>(null);
  // BGP's own reads (the checks before asking) come only to BGP staff: the
  // party lines follow them.
  const staffView = !!data?.prechecks;
  const { data: parties } = useDealParties(dealId, staffView);

  if (isLoading) return (
    <Card><CardContent className="py-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin" /></CardContent></Card>
  );
  if (!data) return null;

  // The legacy "both sides need to be linked to invoice" gate previously
  // returned early here, hiding the AML AI augments (MLR scope, AI triage,
  // SoF analysis, MLRO PDF) until both counterparties were set. Those
  // augments are useful from the moment a deal exists, so we now render the
  // warning inline above the AmlAiPanel rather than blocking the whole card.

  if (data.counterparties.length < 2) {
    return (
      <Card data-testid="deal-aml-status-card">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-md text-sm" data-testid="deal-aml-status-incomplete">
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <span>
              {data.counterparties.length === 0 ? "No counterparties linked" : "Only 1 counterparty linked"} to this deal — set the parties on the deal record, then {data.clientChecks ? "send each one the client checks" : "raise each with KYC4U"}.
            </span>
          </div>
          <DealRedFlags dealId={dealId} data={data} />
          {data.counterparties.map(cp => (
            <div key={cp.id} className="space-y-2">
              {staffView && !(cp.isApproved && !cp.isExpired) && <PartyReadyToStart dealId={dealId} companyId={cp.id} />}
              <PartyCompanyFacts data={data} companyId={cp.id} />
              <PartyPrechecks dealId={dealId} data={data} companyId={cp.id} />
              <PartyRedFlags dealId={dealId} data={data} companyId={cp.id} role={cp.role} />
              <PartyActions dealId={dealId} data={data} cp={cp} />
              <PartyDecisions dealId={dealId} data={data} companyId={cp.id} role={cp.role} partyName={cp.kycName || cp.name} approved={cp.isApproved && !cp.isExpired} />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="deal-aml-status-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className={`w-4 h-4 ${data.allApproved ? "text-emerald-600" : "text-muted-foreground"}`} />
            <h3 className="font-semibold text-sm">AML status — both counterparties</h3>
          </div>
          {data.allApproved ? (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200" data-testid="badge-deal-aml-clear">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              AML CLEAR — invoice unlocked
            </Badge>
          ) : (
            <Badge variant="secondary" data-testid="badge-deal-aml-blocked">
              <Clock className="w-3 h-3 mr-1" />
              AML pending
            </Badge>
          )}
        </div>

        <DealRedFlags dealId={dealId} data={data} />

        <div className="grid sm:grid-cols-2 gap-2">
          {data.counterparties.map(cp => {
            const status = cp.isApproved && !cp.isExpired ? "approved" : cp.isExpired ? "expired" : cp.kyc_status || "pending";
            const colour = status === "approved" ? "border-emerald-300 bg-emerald-50/50" :
                          status === "expired" ? "border-red-300 bg-red-50/50" :
                          status === "rejected" ? "border-red-300 bg-red-50/50" :
                          "border-amber-300 bg-amber-50/30";
            const icon = status === "approved" ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> :
                        status === "expired" ? <Clock className="w-4 h-4 text-red-600" /> :
                        <AlertCircle className="w-4 h-4 text-amber-600" />;
            const isOpen = expanded === cp.id;
            return (
              <div key={cp.id} className={`border-2 rounded-lg p-3 ${colour}`} data-testid={`counterparty-${cp.id}`}>
                <div className="flex items-start gap-2">
                  {icon}
                  <div className="flex-1 min-w-0">
                    <Badge variant="outline" className="text-[10px] mb-1 uppercase">{cp.role}</Badge>
                    <Link href={`/companies/${cp.id}`} className="font-medium text-sm hover:underline block truncate">
                      {cp.name}
                    </Link>
                    {cp.signsAs && (
                      <div className="text-[11px] text-muted-foreground mt-0.5 truncate" title={`Checks on ${cp.signsAs}, the company that signs`} data-testid={`counterparty-signs-as-${cp.id}`}>
                        Checks on <span className="text-foreground">{cp.signsAs}</span>, the company that signs
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {status === "approved" ? `Approved${cp.kyc_approved_by ? ` by ${cp.kyc_approved_by}` : ""}` :
                       status === "expired" ? "Expired — re-check needed" :
                       status === "rejected" ? (cp.kycSource === "brand_rejected" ? "Rejected (the brand)" : "Rejected") :
                       status === "in_review" ? "In review" :
                       status === "not_found" ? (parties?.parties.find(p => p.brand.id === cp.id)?.company ? "Brand not on Companies House: the checks read the company that signs" : "Not on Companies House — manual KYC needed") :
                       cp.kycSource === "company" && cp.brandKycStatus === "approved" ? `No checks on ${cp.kycName || "the company that signs"} yet: ${cp.name} is approved, but it is a different company` : "No KYC yet"}
                    </div>
                    {cp.kyc_expires_at && (
                      <div className="text-[11px] text-muted-foreground">
                        {cp.isExpired ? "Was valid until" : "Valid until"} {new Date(cp.kyc_expires_at).toLocaleDateString("en-GB")}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 space-y-2">
                  {/* What the checks still need is moot once the party is approved. */}
                  {staffView && status !== "approved" && <PartyReadyToStart dealId={dealId} companyId={cp.id} />}
                  <PartyCompanyFacts data={data} companyId={cp.id} />
                  <PartyPrechecks dealId={dealId} data={data} companyId={cp.id} />
                  <PartyRedFlags dealId={dealId} data={data} companyId={cp.id} role={cp.role} />
                  <PartyActions dealId={dealId} data={data} cp={cp} wide />
                  <PartyDecisions dealId={dealId} data={data} companyId={cp.id} role={cp.role} partyName={cp.kycName || cp.name} approved={status === "approved"} />
                </div>
              </div>
            );
          })}
        </div>

        {/* "Invoice locked" read as false on deals already Invoiced/Completed
            (and invoices can be drafted before AML clears) — say plainly what
            is outstanding instead (Woody, 2026-09-27). */}
        {!data.allApproved && data.missing.length > 0 && (
          <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-md text-sm" data-testid="deal-aml-blocker">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-medium">{dealStatus && ["INV", "COM"].includes(legacyToCode(dealStatus) || "") ? "AML sign-off still outstanding" : "AML approval needed"}</span> for {data.missing.join(", ")}.{" "}
              {data.clientChecks
                ? <>Send each party's contact the client checks above; a party with a red flag goes to KYC4U. A party clears here when BGP signs it off, or when KYC4U, BGP's MLRO, approves it (their result added here, or after the next sync).</>
                : <>KYC4U are BGP's MLRO — raise each party with Request KYC4U check above; their approval clears it here once their result is added or synced. A routine party can be signed off by BGP.</>}
            </div>
          </div>
        )}

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
