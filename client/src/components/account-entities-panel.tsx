// Group entities panel (Delivery 5, Task 7) — ONE deduplicated legal-entity
// list for an account, backed by GET /api/accounts/:id/entities (the
// canonical group view). The header reads "X of Y entities current" with
// the explicit buckets beside it — an approved parent beside an unchecked
// child can never make the summary read "current".
//
// Rows render worst-bucket-first (rejected → expired → unchecked → in
// review → current). Approve/reject actions are MLRO-only and hit the
// per-entity KYC endpoints — a child approve never touches the parent.
// Staff-only server-side: scoped viewers get a 403 and the panel renders
// nothing.
//
// Clicking a row opens the entity's review (Dialog on desktop, bottom sheet
// on phones): register details, officers / PSCs, accounts, covenant, the KYC
// record and its evidence, with Approve / Reject inside — Woody couldn't open
// an entity to check it before deciding (2026-09-28). Everything shown is
// already held by the app; the Companies House register is read live only
// when nothing is saved for that entity yet.

import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthHeaders, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { pillMetrics } from "@/components/ui/pill";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Building2, AlertTriangle, CheckCircle2, AlertCircle, XCircle, ShieldCheck, Clock, ChevronRight, ExternalLink, FileText } from "lucide-react";

interface GroupEntityKyc {
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  expiresAt: string | null;
  nextReviewAt: string | null;
  outstanding: { key: string; label: string }[];
  lastCheckedAt: string | null;
  source: string;
}

interface GroupEntity {
  entityKind: "company" | "trading_entity";
  entityId: string | null;
  name: string;
  companiesHouseNumber: string | null;
  relation: "self" | "parent" | "subsidiary" | "trading_entity";
  relationConfidence: string;
  evidence: string[];
  representationConflicts: string[];
  kyc: GroupEntityKyc | null;
  groupRollupBlocks: boolean;
  tradingAs?: string;
}

interface AccountEntitiesReport {
  accountId: string;
  accountName: string;
  entities: GroupEntity[];
  summary: { total: number; current: number; inReview: number; unchecked: number; expired: number; rejected: number };
}

type Bucket = "current" | "expired" | "inReview" | "rejected" | "unchecked";

function bucketOf(e: GroupEntity): Bucket {
  const kyc = e.kyc;
  if (!kyc) return "unchecked";
  const expires = kyc.expiresAt ? new Date(kyc.expiresAt).getTime() : null;
  if (kyc.status === "approved") return expires == null || expires > Date.now() ? "current" : "expired";
  if (kyc.status === "expired") return "expired";
  if (kyc.status === "in_review") return "inReview";
  if (kyc.status === "rejected") return "rejected";
  return "unchecked";
}

const BUCKET_ORDER: Bucket[] = ["rejected", "expired", "unchecked", "inReview", "current"];

// Static chips on the pill standard (docs/DESIGN.md §3); status colours are
// the semantic KYC map shared with SubCompaniesPanel (companies.tsx).
const chip = cn(pillMetrics, "border border-border text-muted-foreground");
const tone = (cls: string) => cn(pillMetrics, "border border-transparent", cls);
const TONE = {
  current: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  inReview: "bg-yellow-100 text-yellow-700",
  rejected: "bg-red-100 text-red-700",
  expired: "bg-amber-100 text-amber-700",
  unchecked: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function KycChip({ bucket, expiresAt }: { bucket: Bucket; expiresAt?: string | null }) {
  if (bucket === "current") return <span className={tone(TONE.current)}><CheckCircle2 className="w-3 h-3" />KYC approved</span>;
  if (bucket === "inReview") return <span className={tone(TONE.inReview)}><AlertCircle className="w-3 h-3" />In review</span>;
  if (bucket === "rejected") return <span className={tone(TONE.rejected)}><XCircle className="w-3 h-3" />Rejected</span>;
  if (bucket === "expired") return <span className={tone(TONE.expired)}><Clock className="w-3 h-3" />Expired{expiresAt ? ` ${fmtDate(expiresAt)}` : ""}</span>;
  return <span className={chip}><ShieldCheck className="w-3 h-3" />No KYC</span>;
}

const RELATION_LABEL: Record<GroupEntity["relation"], string> = {
  self: "Account",
  parent: "Parent",
  subsidiary: "Subsidiary",
  trading_entity: "Trading entity",
};

const EVIDENCE_LABEL: Record<string, string> = {
  "crm_companies.id": "The account's own CRM record",
  "crm_companies.parent_company_id": "Linked to the account as a subsidiary in the CRM",
  "crm_trading_entities": "On the account's trading-entity list",
  "crm_companies.trading_entities": "On the legacy trading-entities list",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  passport: "Passport", certified_passport: "Certified passport", drivers_licence: "Driving licence",
  proof_of_address: "Proof of address", source_of_funds: "Source of funds", source_of_wealth: "Source of wealth",
  ubo_declaration: "UBO declaration", company_cert: "Company cert", bank_statement: "Bank statement",
  onfido_report: "Onfido report", other: "Other",
};

// "28 Sep", with the year only when it isn't this year (DESIGN.md §15).
function fmtDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-GB", opts);
}

const words = (v: any) => {
  const s = String(v || "").replace(/[-_]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
};

const fmtAddress = (a: any): string | null => {
  if (!a) return null;
  if (typeof a === "string") return a;
  return [a.care_of, a.po_box, a.premises, a.address_line_1, a.address_line_2, a.locality, a.region, a.postal_code, a.country]
    .filter(Boolean).join(", ") || null;
};

const CH_BASE = "https://find-and-update.company-information.service.gov.uk/company";

export function AccountEntitiesPanel({ companyId, hideSingleEntity = false }: { companyId: string; hideSingleEntity?: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // Approve / reject are the MLRO's decisions (MLR 2017 Reg 21).
  const { data: aml } = useQuery<{ isMlro: boolean }>({ queryKey: ["/api/aml/me"], staleTime: 5 * 60_000 });
  const isMlro = !!aml?.isMlro;
  const [review, setReview] = useState<{ key: string; rejecting: boolean } | null>(null);

  const { data } = useQuery<AccountEntitiesReport>({
    queryKey: ["/api/accounts", companyId, "entities"],
    enabled: !!companyId,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/accounts/${companyId}/entities`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/accounts", companyId, "entities"] });
  const approve = useMutation({
    mutationFn: async (e: GroupEntity) => apiRequest("POST", `/api/entities/${e.entityKind}/${e.entityId}/kyc/approve`, {}),
    onSuccess: (_r, e) => { invalidate(); setReview(null); toast({ title: "KYC approved", description: e.name }); },
    onError: (err: any) => toast({ title: "Approve failed", description: err?.message, variant: "destructive" }),
  });
  const reject = useMutation({
    mutationFn: async ({ e, reason }: { e: GroupEntity; reason: string }) => apiRequest("POST", `/api/entities/${e.entityKind}/${e.entityId}/kyc/reject`, { reason }),
    onSuccess: (_r, { e }) => { invalidate(); setReview(null); toast({ title: "KYC rejected", description: e.name }); },
    onError: (err: any) => toast({ title: "Reject failed", description: err?.message, variant: "destructive" }),
  });

  // Staff-only / any error → render nothing (same convention as the other
  // account workspace cards).
  if (!data) return null;
  // A brand with one legal entity already shows it (and its sign-off) in
  // Compliance & KYC — a second strip at the top double-counted it
  // (Woody, 2026-09-23). Groups with several entities keep the list.
  if (hideSingleEntity && data.entities.length <= 1) return null;

  const s = data.summary;
  const rowKey = (e: GroupEntity, i: number) => `${e.entityKind}-${e.entityId ?? `jsonb-${i}`}`;
  const rows = data.entities
    .map((e, i) => ({ e, key: rowKey(e, i) }))
    .sort((a, b) => BUCKET_ORDER.indexOf(bucketOf(a.e)) - BUCKET_ORDER.indexOf(bucketOf(b.e)));
  const bucketBadges: [number, string, string][] = [
    [s.unchecked, "unchecked", TONE.unchecked],
    [s.inReview, "in review", TONE.inReview],
    [s.expired, "expired", TONE.expired],
    [s.rejected, "rejected", TONE.rejected],
  ];
  const reviewing = review ? rows.find(r => r.key === review.key)?.e ?? null : null;

  return (
    <Card data-testid={`account-entities-${companyId}`}>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-[11px] flex items-center gap-2 uppercase tracking-wider text-muted-foreground flex-wrap">
          <Building2 className="w-3.5 h-3.5" /> Group entities
          <span className={tone(s.current === s.total ? TONE.current : TONE.expired)} data-testid="entities-current-summary">
            <span className="font-mono tabular-nums">{s.current}</span> of <span className="font-mono tabular-nums">{s.total}</span> KYC approved
          </span>
          {bucketBadges.filter(([n]) => n > 0).map(([n, label, cls]) => (
            <span key={label} className={tone(cls)}><span className="font-mono tabular-nums">{n}</span> {label}</span>
          ))}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {/* Name gets the width and wraps to two lines; the chips drop
            beneath it until the card is wide enough to sit them alongside —
            side by side they cut the name to "THE ARD…" (Woody, 2026-09-28). */}
        <div className="max-h-96 overflow-y-auto divide-y divide-border [container-type:inline-size]">
          {rows.map(({ e, key }) => {
            const bucket = bucketOf(e);
            const actionable = isMlro && e.entityId;
            return (
              <div key={key} className="flex items-start gap-1.5 py-1.5" data-testid={`entity-row-${e.entityId ?? key}`}>
                <button
                  type="button"
                  onClick={() => setReview({ key, rejecting: false })}
                  className="flex-1 min-w-0 text-left rounded-md -mx-1 px-1 py-0.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex flex-col gap-1 [@container(min-width:560px)]:flex-row [@container(min-width:560px)]:items-center [@container(min-width:560px)]:gap-2"
                  aria-label={`Review ${e.name}`}
                  data-testid={`entity-open-${e.entityId ?? key}`}
                >
                  <span className="flex items-start gap-1.5 min-w-0 [@container(min-width:560px)]:flex-1">
                    <Building2 className="w-3.5 h-3.5 mt-px text-muted-foreground shrink-0" />
                    <span className="min-w-0 flex flex-col leading-tight">
                      <span className="text-xs font-medium line-clamp-2 break-words">{e.name}</span>
                      {e.tradingAs && <span className="text-[11px] text-muted-foreground line-clamp-1 break-words">trading as {e.tradingAs}</span>}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1 pl-5 [@container(min-width:560px)]:pl-0 [@container(min-width:560px)]:shrink-0 [@container(min-width:560px)]:justify-end">
                    {e.companiesHouseNumber ? (
                      <span className={chip}>CH <span className="font-mono">{e.companiesHouseNumber}</span></span>
                    ) : (
                      <span className={tone(TONE.expired)}>No CH no.</span>
                    )}
                    <span className={chip}>{RELATION_LABEL[e.relation]}</span>
                    {e.representationConflicts.length > 0 && (
                      <span title={e.representationConflicts.join("\n")} data-testid={`entity-conflict-${e.entityId ?? key}`}>
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      </span>
                    )}
                    {e.kyc && e.kyc.outstanding.length > 0 && (
                      <span className={chip} title={e.kyc.outstanding.map(o => o.label).join("\n")}>
                        <span className="font-mono tabular-nums">{e.kyc.outstanding.length}</span> outstanding
                      </span>
                    )}
                    {e.kyc?.nextReviewAt && bucket === "current" && (
                      <span className="text-[11px] text-muted-foreground">review {fmtDate(e.kyc.nextReviewAt)}</span>
                    )}
                    <KycChip bucket={bucket} expiresAt={e.kyc?.expiresAt} />
                  </span>
                </button>
                <span className="flex items-center gap-0.5 shrink-0 pt-px">
                  {actionable && bucket !== "current" && (
                    <Button
                      size="sm" variant="ghost" className="h-6 text-[11px] px-1.5"
                      disabled={approve.isPending}
                      onClick={() => approve.mutate(e)}
                      data-testid={`entity-approve-${e.entityId}`}
                    >Approve</Button>
                  )}
                  {actionable && bucket !== "rejected" && bucket !== "current" && (
                    <Button
                      size="sm" variant="ghost" className="h-6 text-[11px] px-1.5 text-rose-500"
                      disabled={reject.isPending}
                      onClick={() => setReview({ key, rejecting: true })}
                      data-testid={`entity-reject-${e.entityId}`}
                    >Reject</Button>
                  )}
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                </span>
              </div>
            );
          })}
        </div>
        {rows.some(r => !r.e.entityId) && (
          <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
            Rows without an id come from the legacy trading-entities list only — resolve the representation conflict before KYC can be recorded on them.
          </p>
        )}
      </CardContent>
      <EntityReview
        entity={reviewing}
        accountId={companyId}
        accountName={data.accountName}
        rejecting={!!review?.rejecting}
        onRejectingChange={(rejecting) => setReview(r => (r ? { ...r, rejecting } : r))}
        onClose={() => setReview(null)}
        isMlro={isMlro}
        approving={approve.isPending}
        rejectPending={reject.isPending}
        onApprove={(e) => approve.mutate(e)}
        onReject={(e, reason) => reject.mutate({ e, reason })}
      />
    </Card>
  );
}

const sectionLabel = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === false || children === "") return null;
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 text-sm min-w-0">
      <span className="text-[11px] text-muted-foreground pt-0.5">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function Section({ title, children, testId }: { title: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <section className="space-y-1.5 border-t border-border pt-3 first:border-t-0 first:pt-0" data-testid={testId}>
      <h3 className={cn(sectionLabel, "flex items-center gap-2 flex-wrap")}>{title}</h3>
      {children}
    </section>
  );
}

function ShowAllList<T>({ items, cap, render, testId }: { items: T[]; cap: number; render: (item: T, i: number) => React.ReactNode; testId?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, cap);
  return (
    <>
      <ul className="space-y-1" data-testid={testId}>{shown.map(render)}</ul>
      {items.length > cap && (
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAll(v => !v)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}

function EntityReview({
  entity, accountId, accountName, rejecting, onRejectingChange, onClose, isMlro, approving, rejectPending, onApprove, onReject,
}: {
  entity: GroupEntity | null;
  accountId: string;
  accountName: string;
  rejecting: boolean;
  onRejectingChange: (v: boolean) => void;
  onClose: () => void;
  isMlro: boolean;
  approving: boolean;
  rejectPending: boolean;
  onApprove: (e: GroupEntity) => void;
  onReject: (e: GroupEntity, reason: string) => void;
}) {
  const isMobile = useIsMobile();
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [entity?.entityId]);
  const open = !!entity;
  const isCompany = entity?.entityKind === "company" && !!entity.entityId;
  const id = entity?.entityId || "";
  const chNumber = (entity?.companiesHouseNumber || "").trim();

  // The entity's own saved records — the same reads its company page and
  // Compliance & KYC card make.
  const company = useQuery<any>({ queryKey: ["/api/crm/companies", id], enabled: open && isCompany, retry: false, staleTime: 60_000 });
  const kycState = useQuery<any>({ queryKey: ["/api/kyc/company", id], enabled: open && isCompany, retry: false, staleTime: 60_000 });
  const history = useQuery<{ investigations: any[] }>({
    queryKey: isCompany ? ["/api/kyc-clouseau/history/crm", id] : ["/api/kyc-clouseau/history", chNumber],
    enabled: open && (isCompany || !!chNumber),
    retry: false,
    staleTime: 60_000,
  });

  const saved = company.data?.companiesHouseData || null;
  const savedProfile = saved?.profile || null;
  // Nothing saved yet → read the public register (free) so the reviewer
  // still sees who the entity is. Never a paid lookup.
  const needLive = open && !!chNumber && (!isCompany || (company.isFetched && !savedProfile));
  const liveProfile = useQuery<any>({ queryKey: ["/api/companies-house/company", chNumber], enabled: needLive, retry: false, staleTime: 60 * 60_000 });
  const liveOfficers = useQuery<{ officers: any[] }>({ queryKey: ["/api/companies-house/officers", chNumber], enabled: needLive, retry: false, staleTime: 60 * 60_000 });
  const livePscs = useQuery<{ pscs: any[] }>({ queryKey: ["/api/companies-house/pscs", chNumber], enabled: needLive, retry: false, staleTime: 60 * 60_000 });
  // Same key as the Compliance & KYC card's covenant tick, so an open brand
  // page serves it from cache.
  const covenant = useQuery<any>({
    queryKey: ["covenant", chNumber],
    queryFn: async () => (await apiRequest("GET", `/api/covenant/${encodeURIComponent(chNumber)}`)).json(),
    enabled: open && !!chNumber,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  if (!entity) return null;

  const bucket = bucketOf(entity);
  const kyc = entity.kyc;
  const profile = savedProfile || liveProfile.data || null;
  const profileFromLive = !savedProfile && !!liveProfile.data;
  const officersAll: any[] = (savedProfile ? (saved?.officers || company.data?.companiesHouseOfficers) : liveOfficers.data?.officers) || [];
  const officers = officersAll.filter(o => !o?.resignedOn);
  const pscs: any[] = ((savedProfile ? saved?.pscs : livePscs.data?.pscs) || []).filter((p: any) => !p?.ceasedOn);
  const overseas = /^OE/i.test(chNumber) || profile?.companyType === "registered-overseas-entity";
  const chUrl = chNumber ? `${CH_BASE}/${encodeURIComponent(chNumber)}` : null;
  const extracted = saved?.latestAccountsExtracted || null;
  const k = kycState.data?.company || null;
  const checklistOpen: { id: string; label: string }[] = kycState.data?.outstanding || [];
  const documents: any[] = kycState.data?.documents || [];
  const investigations = history.data?.investigations || [];
  const latestInvestigation = investigations[0] || null;
  const kycHubHref = latestInvestigation
    ? `/kyc-clouseau?tab=investigator&investigation=${encodeURIComponent(latestInvestigation.id)}`
    : isCompany ? `/kyc-clouseau?company=${encodeURIComponent(id)}` : null;
  const loadingRegister = (isCompany && company.isLoading) || (needLive && liveProfile.isLoading);
  const canDecide = isMlro && !!entity.entityId && bucket !== "current";
  const canReject = canDecide && bucket !== "rejected";
  const relationLine = entity.relation === "self"
    ? `The ${accountName} account's own legal entity`
    : entity.relation === "subsidiary" ? `Subsidiary of ${accountName}`
    : entity.relation === "parent" ? `Parent of ${accountName}`
    : `Trading entity of ${accountName}`;

  const close = () => { setReason(""); onClose(); };
  const title = entity.name;
  const description = [entity.tradingAs ? `Trading as ${entity.tradingAs}` : null, relationLine].filter(Boolean).join(" · ");

  const body = (
    <div className="space-y-4" data-testid="entity-review">
      <div className="flex flex-wrap items-center gap-1">
        <KycChip bucket={bucket} expiresAt={kyc?.expiresAt} />
        <span className={chip}>{RELATION_LABEL[entity.relation]}</span>
        {chNumber ? <span className={chip}>CH <span className="font-mono">{chNumber}</span></span> : <span className={tone(TONE.expired)}>No CH no.</span>}
        {overseas && <span className={chip}>Overseas entity</span>}
        {k?.aml_risk_level && <span className={chip}>{words(k.aml_risk_level)} risk</span>}
        {k?.aml_edd_required && <span className={tone(TONE.expired)}>EDD required</span>}
      </div>

      <Section title="Companies House" testId="entity-review-register">
        {loadingRegister ? (
          <div className="space-y-1.5"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-2/3" /></div>
        ) : !chNumber ? (
          <p className="text-sm text-muted-foreground">No Companies House number recorded for this entity yet.</p>
        ) : (
          <div className="space-y-1">
            <Field label="Registered name">{profile?.companyName || entity.name}</Field>
            <Field label="Number">
              <a href={chUrl!} target="_blank" rel="noopener noreferrer" className="font-mono text-primary hover:underline inline-flex items-center gap-1" data-testid="entity-review-ch-link">
                {chNumber} <ExternalLink className="w-3 h-3" />
              </a>
              {overseas && <span className="block text-[11px] text-muted-foreground">Register of Overseas Entities — the UK register for an overseas company that owns UK land.</span>}
            </Field>
            <Field label="Status">{profile?.companyStatus ? words(profile.companyStatus) : null}</Field>
            <Field label="Type">{profile?.companyType ? words(profile.companyType) : null}</Field>
            <Field label={overseas ? "Registered" : "Incorporated"}>{fmtDate(profile?.dateOfCreation)}</Field>
            <Field label="Registered office">{fmtAddress(profile?.registeredOfficeAddress)}</Field>
            <Field label="SIC">{Array.isArray(profile?.sicCodes) && profile.sicCodes.length ? <span className="font-mono">{profile.sicCodes.join(", ")}</span> : null}</Field>
            <Field label="Flags">
              {profile ? [
                profile.hasInsolvencyHistory ? "Insolvency history" : null,
                profile.hasCharges ? "Charges registered" : null,
                profile.accountsOverdue ? "Accounts overdue" : null,
                profile.confirmationStatementOverdue ? "Confirmation statement overdue" : null,
              ].filter(Boolean).join(" · ") || "None — no insolvency, charges or overdue filings" : null}
            </Field>
            <p className="text-[11px] text-muted-foreground">
              {profileFromLive ? "Read live from the public register — not yet saved to this entity." : saved?.checkedAt ? `Saved from Companies House ${fmtDate(saved.checkedAt)}.` : null}
            </p>
          </div>
        )}
      </Section>

      {chNumber && (
        <Section title={<>Officers <span className="font-mono tabular-nums normal-case">{officers.length}</span></>} testId="entity-review-officers">
          {officers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{loadingRegister || liveOfficers.isLoading ? "Loading…" : "No current officers saved."}</p>
          ) : (
            <ShowAllList items={officers} cap={6} render={(o: any, i) => (
              <li key={`${o.name}-${i}`} className="text-sm leading-snug">
                <span className="font-medium">{o.name}</span>
                <span className="text-[11px] text-muted-foreground"> · {words(o.officerRole)}{o.appointedOn ? ` · since ${fmtDate(o.appointedOn)}` : ""}{o.nationality ? ` · ${o.nationality}` : ""}</span>
              </li>
            )} />
          )}
          {officersAll.length > officers.length && (
            <p className="text-[11px] text-muted-foreground"><span className="font-mono tabular-nums">{officersAll.length - officers.length}</span> resigned officers not shown.</p>
          )}
        </Section>
      )}

      {chNumber && (
        <Section title={<>{overseas ? "Beneficial owners" : "PSCs"} <span className="font-mono tabular-nums normal-case">{pscs.length}</span></>} testId="entity-review-pscs">
          {pscs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {loadingRegister || livePscs.isLoading ? "Loading…" : overseas ? "None disclosed on the register." : "None on the PSC register."}
              {chUrl && <> <a href={`${chUrl}/persons-with-significant-control`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">Open on Companies House <ExternalLink className="w-3 h-3" /></a></>}
            </p>
          ) : (
            <ShowAllList items={pscs} cap={6} render={(p: any, i) => (
              <li key={`${p.name}-${i}`} className="text-sm leading-snug">
                <span className="font-medium">{p.name}</span>
                {Array.isArray(p.naturesOfControl) && p.naturesOfControl.length > 0 && (
                  <span className="text-[11px] text-muted-foreground"> · {p.naturesOfControl.map((n: string) => words(n).replace(/ percent\b/i, "%")).join("; ")}</span>
                )}
              </li>
            )} />
          )}
        </Section>
      )}

      {chNumber && (
        <Section title="Accounts & covenant" testId="entity-review-accounts">
          <div className="space-y-1">
            <Field label="Latest accounts">
              {profile?.lastAccountsMadeUpTo
                ? `Made up to ${fmtDate(profile.lastAccountsMadeUpTo)}`
                : overseas ? "Overseas entities don't file UK accounts" : "None saved"}
            </Field>
            {extracted && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                {([["Turnover", extracted.turnover], ["Operating profit", extracted.operatingProfit], ["Profit before tax", extracted.profitBeforeTax], ["Net assets", extracted.netAssets], ["Cash", extracted.cash], ["Employees", extracted.employees]] as [string, any][])
                  .filter(([, v]) => v != null && v !== "").map(([label, v]) => (
                    <div key={label} className="rounded-md border border-border px-2 py-1.5">
                      <div className="text-[11px] text-muted-foreground">{label}</div>
                      <div className="text-sm font-mono tabular-nums">{v}</div>
                    </div>
                  ))}
              </div>
            )}
            <Field label="Covenant">
              {covenant.isLoading ? <Skeleton className="h-4 w-32" />
                : covenant.data?.grade ? (
                  <span>
                    <span className="font-semibold">{covenant.data.grade}</span>
                    <span className="font-mono tabular-nums text-muted-foreground"> · {covenant.data.score}/100</span>
                    {covenant.data.verdict && <span className="block text-[11px] text-muted-foreground line-clamp-3">{covenant.data.verdict}</span>}
                  </span>
                ) : "Not graded yet"}
            </Field>
            {chUrl && (
              <a href={`${chUrl}/filing-history`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                Filing history on Companies House <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </Section>
      )}

      <Section title="KYC record" testId="entity-review-kyc">
        <div className="space-y-1">
          <Field label="Status"><KycChip bucket={bucket} expiresAt={kyc?.expiresAt} /></Field>
          <Field label="Last checked">{fmtDate(kyc?.lastCheckedAt)}</Field>
          <Field label="Approved">{kyc?.approvedBy || kyc?.approvedAt ? [kyc?.approvedBy, fmtDate(kyc?.approvedAt)].filter(Boolean).join(" · ") : null}</Field>
          <Field label="Re-check due">{fmtDate(kyc?.nextReviewAt || kyc?.expiresAt)}</Field>
          <Field label="Record">{kyc ? (kyc.source === "crm_entity_kyc" ? "Per-entity sign-off" : "The company's own KYC record") : "No KYC recorded yet"}</Field>
          <Field label="PEP">{k?.aml_pep_status ? words(k.aml_pep_status) : null}</Field>
          <Field label="EDD">{k?.aml_edd_required ? (k.aml_edd_reason || "Required") : null}</Field>
        </div>
        {k?.aml_notes && (
          <div className="rounded-md border border-border bg-muted/40 p-2.5 text-sm whitespace-pre-line break-words" data-testid="entity-review-notes">{k.aml_notes}</div>
        )}
        {kyc && kyc.outstanding.length > 0 && (
          <div>
            <div className="text-[11px] text-muted-foreground mb-0.5">Outstanding on this entity's sign-off</div>
            <ShowAllList items={kyc.outstanding} cap={6} render={(o, i) => <li key={`${o.key}-${i}`} className="text-sm leading-snug">• {o.label}</li>} />
          </div>
        )}
        {checklistOpen.length > 0 && (
          <div data-testid="entity-review-checklist">
            <div className="text-[11px] text-muted-foreground mb-0.5">
              Checklist items not ticked on the company's Compliance &amp; KYC (<span className="font-mono tabular-nums">{checklistOpen.length}</span>)
            </div>
            <ShowAllList items={checklistOpen} cap={5} render={(o, i) => <li key={`${o.id}-${i}`} className="text-sm leading-snug">• {o.label}</li>} />
          </div>
        )}
      </Section>

      <Section title={<>Evidence <span className="font-mono tabular-nums normal-case">{documents.length + investigations.length}</span></>} testId="entity-review-evidence">
        {documents.length === 0 && investigations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No KYC documents or KYC Hub checks saved for this entity yet.</p>
        ) : (
          <ul className="space-y-1">
            {documents.map((doc: any) => (
              <li key={doc.id} className="text-sm flex items-center gap-1.5 min-w-0">
                <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-primary hover:underline">{doc.file_name}</a>
                <span className="text-[11px] text-muted-foreground shrink-0">{DOC_TYPE_LABELS[doc.doc_type] || words(doc.doc_type)} · {fmtDate(doc.uploaded_at)}</span>
              </li>
            ))}
            {investigations.slice(0, 5).map((inv: any) => (
              <li key={inv.id} className="text-sm flex items-center gap-1.5 min-w-0">
                <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <Link href={`/kyc-clouseau?tab=investigator&investigation=${encodeURIComponent(inv.id)}`} className="min-w-0 truncate text-primary hover:underline">
                  KYC Hub check · {fmtDate(inv.conducted_at)}
                </Link>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {words(inv.risk_level)} risk{inv.risk_score != null ? <> · <span className="font-mono tabular-nums">{inv.risk_score}</span></> : null}{inv.sanctions_match ? " · sanctions match" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Why it's in this group" testId="entity-review-relation">
        <p className="text-sm">{relationLine}{entity.relationConfidence && entity.relationConfidence !== "confirmed" ? ` (${words(entity.relationConfidence).toLowerCase()})` : ""}.</p>
        <ul className="space-y-0.5">
          {entity.evidence.map(ev => <li key={ev} className="text-[11px] text-muted-foreground">• {EVIDENCE_LABEL[ev] || ev}</li>)}
        </ul>
        {entity.representationConflicts.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs space-y-0.5">
            {entity.representationConflicts.map(c => <p key={c} className="flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-px" />{c}</p>)}
          </div>
        )}
      </Section>

      <div className="flex flex-wrap gap-2 pt-1">
        {kycHubHref && (
          <Button variant="outline" size="sm" asChild>
            <Link href={kycHubHref} onClick={close} data-testid="entity-review-kyc-hub">Open in KYC Hub <ChevronRight /></Link>
          </Button>
        )}
        {isCompany && id !== accountId && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/companies/${id}`} onClick={close} data-testid="entity-review-company">Open company page <ChevronRight /></Link>
          </Button>
        )}
        {chUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={chUrl} target="_blank" rel="noopener noreferrer">Open in Companies House <ExternalLink /></a>
          </Button>
        )}
      </div>
    </div>
  );

  const actions = (
    <div className="shrink-0 border-t border-border pt-3 space-y-2">
      {rejecting && canReject ? (
        <>
          <label htmlFor="entity-reject-reason" className={sectionLabel}>Reason for rejecting</label>
          <Textarea
            id="entity-reject-reason"
            autoFocus
            rows={3}
            value={reason}
            onChange={(ev) => setReason(ev.target.value)}
            placeholder="e.g. Beneficial owners not verified — no UBO declaration received"
            data-testid="entity-reject-reason"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => onRejectingChange(false)} disabled={rejectPending}>Back</Button>
            <Button variant="destructive" disabled={!reason.trim() || rejectPending} onClick={() => onReject(entity, reason.trim())} data-testid="entity-review-reject-confirm">
              {rejectPending ? "Rejecting…" : "Reject KYC"}
            </Button>
          </div>
        </>
      ) : canDecide ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {checklistOpen.length > 0 && (
            <p className="mr-auto text-[11px] text-muted-foreground">
              <span className="font-mono tabular-nums">{checklistOpen.length}</span> checklist items still open.
            </p>
          )}
          {canReject && <Button variant="outline" onClick={() => onRejectingChange(true)} disabled={approving} data-testid="entity-review-reject">Reject</Button>}
          <Button onClick={() => onApprove(entity)} disabled={approving || rejectPending} data-testid="entity-review-approve">
            {approving ? "Approving…" : "Approve KYC"}
          </Button>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {bucket === "current"
            ? `Approved${kyc?.approvedBy ? ` by ${kyc.approvedBy}` : ""}${kyc?.nextReviewAt ? ` — re-check due ${fmtDate(kyc.nextReviewAt)}` : ""}.`
            : !entity.entityId ? "Resolve the representation conflict before KYC can be recorded on this entity."
            : "Only the MLRO can approve or reject."}
        </p>
      )}
    </div>
  );

  const onOpenChange = (v: boolean) => { if (!v) close(); };
  return isMobile ? (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex flex-col max-h-[92dvh] rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] gap-3" data-testid="entity-review-sheet">
        <SheetHeader className="shrink-0 text-left pr-8">
          <SheetTitle className="break-words">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 overflow-y-auto">{body}</div>
        {actions}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col max-w-2xl max-h-[85dvh] gap-3" data-testid="entity-review-dialog">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="break-words">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto pr-1">{body}</div>
        {actions}
      </DialogContent>
    </Dialog>
  );
}
