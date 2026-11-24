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

import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthHeaders, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AML_CHIP_BASE, KYC_CHIP_TONE } from "@/components/aml-frame";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Building2, AlertTriangle, CheckCircle2, AlertCircle, XCircle, ShieldCheck, Clock, ChevronRight, ExternalLink, FileText } from "lucide-react";
import { approverWords } from "@shared/party-kyc";
import { ClientKycDialog } from "@/components/client-kyc/client-kyc-dialog";
import { CreateBillingEntityDialog } from "@/components/billing-entity-create";
import { SuggestedCompanies } from "@/components/kyc-companies/suggested-companies";
import { clientInstructionLabel, clientKycSummary, clientKycWords } from "@shared/client-kyc";
import { looksLikeSiteMenu } from "@shared/brand-compliance-status";

interface GroupEntityKyc {
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  expiresAt: string | null;
  nextReviewAt: string | null;
  outstanding: { key: string; label: string }[];
  lastCheckedAt: string | null;
  source: string;
  // Approved on a letting under £10,000 a month: the sanctions checks only (23 November 2026).
  scope?: "sanctions_only" | null;
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
  registeredName?: string | null;
  // The transactions whose AML checks this entity (23 November 2026).
  transactions?: { id: string; name: string; ref: number | null; status: string | null; role: string }[];
  // Its client KYC with no transaction (24 November 2026; server/account-entities.ts GroupEntityClientKyc).
  client?: {
    companyId: string; entityId: string | null; kind: "company" | "person" | "abroad";
    checksAt: string | null; running: boolean;
    file: { openedAt: string | null; instruction: string | null } | null;
    request: { status: "sent" | "finished" | "cancelled" | "expired" | "not_sent"; sentAt: string | null; to: string | null } | null;
    xero: { id: string; name: string } | null;
  };
}

// Where each entity is checked: its transactions' Parties & AML (Woody, 23
// November 2026: "can we add some links to these ie in review takes to that AML").
function EntityTransactions({ e, max = 2 }: { e: GroupEntity; max?: number }) {
  const list = e.transactions || [];
  if (!list.length) return <span className="text-[11px] text-muted-foreground">Not on a transaction</span>;
  return (
    <span className="text-[11px] text-muted-foreground" data-testid={`entity-transactions-${e.entityId}`}>
      AML on{" "}
      {list.slice(0, max).map((t, i) => (
        <span key={t.id}>{i > 0 && ", "}<Link href={`/deals/${t.id}?section=parties`} className="text-primary hover:underline">{t.name}{t.ref != null ? ` #${t.ref}` : ""}</Link></span>
      ))}
      {list.length > max && ` and ${list.length - max} more`}
      {/* Approved for the sanctions checks only: the full checks start on its transaction (23 November 2026). */}
      {e.kyc?.status === "approved" && e.kyc.scope === "sanctions_only" && (
        <> · <Link href={`/deals/${list[0].id}?section=parties&full=${encodeURIComponent(list[0].role)}`} className="text-primary hover:underline" data-testid={`entity-start-full-kyc-${e.entityId}`}>Start full KYC</Link></>
      )}
    </span>
  );
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
// The shared chip size and colours (aml-frame.tsx): one KYC chip everywhere (24 November 2026).
const chip = cn(AML_CHIP_BASE, "border border-border text-muted-foreground");
const tone = (cls: string) => cn(AML_CHIP_BASE, cls);
const TONE = {
  current: KYC_CHIP_TONE.ok,
  inReview: KYC_CHIP_TONE.warn,
  rejected: KYC_CHIP_TONE.bad,
  expired: KYC_CHIP_TONE.bad,
  unchecked: KYC_CHIP_TONE.none,
};

// Woody, 23 November 2026, on AG Hondo Brixton Village BV: "is approved KYC for deals under £10k
// sanction only needs to be clear here and option to start full KYC".
const SANCTIONS_ONLY_TITLE = "Signed off on a letting under £10,000 a month: the sanctions checks only. A sale, or a letting at £10,000 a month or more, needs the full checks.";

function KycChip({ bucket, expiresAt, scope, started }: { bucket: Bucket; expiresAt?: string | null; scope?: "sanctions_only" | null; started?: boolean }) {
  if (bucket === "current" && scope === "sanctions_only") return <span className={tone(TONE.current)} title={SANCTIONS_ONLY_TITLE} data-testid="entity-kyc-sanctions-only"><CheckCircle2 className="w-3 h-3" />Sanctions only · under £10k a month</span>;
  if (bucket === "current") return <span className={tone(TONE.current)}><CheckCircle2 className="w-3 h-3" />Cleared</span>;
  if (bucket === "inReview") return <span className={tone(TONE.inReview)}><AlertCircle className="w-3 h-3" />In review</span>;
  if (bucket === "rejected") return <span className={tone(TONE.rejected)}><XCircle className="w-3 h-3" />Rejected</span>;
  if (bucket === "expired") return <span className={tone(TONE.expired)}><Clock className="w-3 h-3" />Expired{expiresAt ? ` ${fmtDate(expiresAt)}` : ""}</span>;
  // Checks run, a client file open or a request sent with no decision yet: the CRM chip's "in progress" (24 November 2026).
  if (started) return <span className={tone(TONE.inReview)} data-testid="entity-kyc-in-progress"><AlertCircle className="w-3 h-3" />In progress</span>;
  return <span className={chip}><ShieldCheck className="w-3 h-3" />No KYC</span>;
}

// The same test as the header's chip (clientKycSummary's started).
const clientStarted = (e: GroupEntity) => !!(e.client && (e.client.checksAt || e.client.running || e.client.file || (e.client.request && e.client.request.status !== "not_sent")));

const RELATION_LABEL: Record<GroupEntity["relation"], string> = {
  self: "Account",
  parent: "Parent",
  subsidiary: "Subsidiary",
  // A company filed under the account: an SPV, the company that signs, a billing entity (24 November 2026: "sub companies").
  trading_entity: "Sub company",
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

// A company's client KYC in one line: BGP's checks, the client checks, the
// open file and its Xero contact (24 November 2026).
function ClientKycLine({ e, bulk }: { e: GroupEntity; bulk?: string }) {
  const c = e.client!;
  const parts: Array<{ text: string; cls?: string; testId?: string }> = [];
  if (bulk === "waiting") parts.push({ text: "Checks waiting to run", cls: "text-sky-700" });
  else if (bulk === "running" || c.running) parts.push({ text: "BGP's checks running", cls: "text-sky-700" });
  else if (bulk === "cap") parts.push({ text: "Today's checks allowance used: run tomorrow", cls: "text-amber-700" });
  else if (c.checksAt) parts.push({ text: `Checked ${fmtDate(c.checksAt)}` });
  else parts.push({ text: "Not checked", cls: "text-muted-foreground" });
  if (c.request) parts.push({ text: c.request.status === "finished" ? `Client checks back${c.request.to ? ` from ${c.request.to}` : ""}` : c.request.status === "sent" ? `Client checks sent${c.request.to ? ` to ${c.request.to}` : ""}` : `Client checks ${c.request.status.replace("_", " ")}` });
  if (c.file?.instruction) parts.push({ text: clientInstructionLabel(c.file.instruction) || "" });
  parts.push(c.xero ? { text: `Xero: ${c.xero.name}`, testId: `entity-xero-${e.entityId}` } : { text: "Not in Xero", cls: "text-muted-foreground" });
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] leading-tight" data-testid={`entity-client-kyc-${e.entityId}`}>
      {parts.filter(p => p.text).map((p, i) => <span key={i} className={p.cls} data-testid={p.testId}>{p.text}</span>)}
    </span>
  );
}

export function AccountEntitiesPanel({ companyId, hideSingleEntity = false, label }: {
  companyId: string;
  hideSingleEntity?: boolean;
  /** Whose companies these are, where the page shows more than one account ("Long leaseholder" on a property). */
  label?: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // Approve / reject are the MLRO's decisions (MLR 2017 Reg 21).
  // In-app AML is retired (the route answers 410 unless it is switched back
  // on): one ask per open, no retries and no 30 second repeat.
  const { data: aml } = useQuery<{ isMlro: boolean }>({ queryKey: ["/api/aml/me"], staleTime: 5 * 60_000, retry: false, refetchInterval: false });
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
  // A "company" read from a website's menu (TPG's "Platforms Wealth Solutions News &
  // Insights About LP"): removed with a press; the server refuses if anything points at it.
  const remove = useMutation({
    mutationFn: async (e: GroupEntity) => apiRequest("DELETE", `/api/crm/trading-entities/${e.entityId}`),
    onSuccess: (_r, e) => { invalidate(); toast({ title: "Removed", description: e.name }); },
    onError: (err: any) => toast({ title: "Not removed", description: err?.message, variant: "destructive" }),
  });

  // Client KYC with no transaction (Woody, 24 November 2026: "aml all the sub
  // companies within each company ... and use those for xero invoicing too"):
  // a KYC box per company, several checked at once, a company added, each
  // linked to Xero.
  const [kycFor, setKycFor] = useState<GroupEntity | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const clientRows = (data?.entities || []).filter(e => e.client);
  const accounts = [...new Set(clientRows.map(e => e.client!.companyId))];
  const bulk = useQuery<{ state: Record<string, string> }>({
    queryKey: ["/api/client-kyc", companyId, "checks"],
    enabled: !!data && accounts.length > 0,
    retry: false,
    queryFn: async () => {
      const states: Record<string, string> = {};
      for (const a of accounts) {
        const res = await fetch(`/api/client-kyc/${encodeURIComponent(a)}/checks`, { credentials: "include", headers: getAuthHeaders() });
        if (res.ok) Object.assign(states, (await res.json()).state || {});
      }
      return { state: states };
    },
    refetchInterval: q => (Object.values(q.state.data?.state || {}).some(v => v === "waiting" || v === "running") ? 4000 : false),
  });
  const bulkState = bulk.data?.state || {};
  const bulkBusy = Object.values(bulkState).some(v => v === "waiting" || v === "running");
  const wasBusy = useRef(false);
  useEffect(() => {
    // When a run finishes, the rows' dates follow.
    if (wasBusy.current && !bulkBusy) invalidate();
    wasBusy.current = bulkBusy;
  }, [bulkBusy]);
  const runChecks = useMutation({
    mutationFn: async (rows: GroupEntity[]) => {
      let queued = 0;
      for (const a of [...new Set(rows.map(r => r.client!.companyId))]) {
        const ids = rows.filter(r => r.client!.companyId === a && r.client!.entityId).map(r => r.client!.entityId!);
        if (!ids.length) continue;
        const res = await apiRequest("POST", `/api/client-kyc/${encodeURIComponent(a)}/checks`, { entityIds: ids });
        queued += Number((await res.json()).queued || 0);
      }
      return queued;
    },
    onSuccess: n => { setPicked(new Set()); void bulk.refetch(); toast({ title: n ? `BGP's checks started on ${n}` : "Nothing new to check", description: n ? "They run one at a time. The rows show each as it finishes." : "Those were checked in the last 30 days, or are running." }); },
    onError: (err: any) => toast({ title: "Checks not started", description: err?.message, variant: "destructive" }),
  });
  const linkXero = useMutation({
    mutationFn: async (rows: GroupEntity[]) => {
      let linked = 0;
      const failed: string[] = [];
      for (const r of rows) {
        if (!r.client?.entityId || r.client.xero) continue;
        try { await apiRequest("POST", `/api/billing-entities/${encodeURIComponent(r.client.entityId)}/xero`, {}); linked++; }
        catch (e: any) { failed.push(`${r.name}: ${String(e?.message || e).replace(/^\d{3}:\s*/, "")}`); }
      }
      return { linked, failed };
    },
    onSuccess: ({ linked, failed }) => { invalidate(); setPicked(new Set()); toast({ title: `${linked} linked to Xero`, description: failed.length ? failed.slice(0, 2).join("; ") : undefined, variant: failed.length && !linked ? "destructive" : undefined }); },
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const removeMany = useMutation({
    mutationFn: async (rows: GroupEntity[]) => {
      const deleted: string[] = [];
      const kept: string[] = [];
      for (const r of rows) {
        try { await apiRequest("DELETE", `/api/crm/trading-entities/${encodeURIComponent(r.client!.entityId!)}`); deleted.push(r.name); }
        catch (e: any) {
          const m = String(e?.message || e);
          let why = m.replace(/^\d{3}:\s*/, "");
          try { why = JSON.parse(m.slice(m.indexOf("{"))).error || why; } catch { /* plain text */ }
          kept.push(`${r.name}: ${why}`);
        }
      }
      return { deleted, kept };
    },
    onSuccess: ({ deleted, kept }) => {
      invalidate(); setPicked(new Set()); setConfirmDelete(false);
      queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard/companies"] });
      toast({ title: deleted.length ? `${deleted.length} deleted` : "Nothing deleted", description: kept.length ? `Kept: ${kept.slice(0, 3).join("; ")}` : undefined, variant: kept.length && !deleted.length ? "destructive" : undefined });
    },
  });
  const addSelf = useMutation({
    mutationFn: async (e: GroupEntity) => apiRequest("POST", "/api/billing-entities", { brandId: companyId, companyNumber: e.companiesHouseNumber, xero: false }),
    onSuccess: (_r, e) => { invalidate(); toast({ title: "Added as a company to check", description: e.registeredName || e.name }); },
    onError: (err: any) => toast({ title: "Not added", description: err?.message, variant: "destructive" }),
  });

  // Staff-only / any error → render nothing (same convention as the other
  // account workspace cards).
  if (!data) return null;
  // A brand with one legal entity already shows it (and its sign-off) in
  // Compliance & KYC — a second strip at the top double-counted it
  // (Woody, 2026-09-23). Groups with several entities keep the list.
  // A brand with no company of its own to check yet still offers to add one (24 November 2026).
  if (hideSingleEntity && data.entities.length <= 1 && !data.entities.some(e => e.client)) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid={`account-entities-empty-${companyId}`}>
        <Building2 className="w-3.5 h-3.5" />No company filed under {data.accountName} to check yet.
        <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={() => setAdding(true)} data-testid="entities-add-company">Add a company</Button>
        <SuggestedCompanies companyId={companyId} onAdded={invalidate} />
        <CreateBillingEntityDialog open={adding} onOpenChange={setAdding} brand={{ id: companyId, name: data.accountName }} initialQuery="" xero={false} testIdPrefix="entities-add"
          onCreated={() => { setAdding(false); invalidate(); }} onSavedWithoutXero={() => { setAdding(false); invalidate(); }} />
      </div>
    );
  }

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
  // The companies checked for KYC (the sub companies, or the record itself when a person,
  // trust or public body), counted with the CRM chip's own words (24 November 2026).
  const subjects = data.entities.filter(e => e.client);
  const chipWords = subjects.length ? clientKycWords(clientKycSummary(subjects.map(e => ({
    status: e.kyc?.status ?? null, expiresAt: e.kyc?.expiresAt ?? null, scope: e.kyc?.scope ?? null,
    started: !!(e.client!.checksAt || e.client!.file || (e.client!.request && e.client!.request.status !== "not_sent")),
  })), new Date())) : null;
  const CHIP_TONE = KYC_CHIP_TONE;
  return (
    <Card data-testid={`account-entities-${companyId}`}>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-[11px] flex items-center gap-2 uppercase tracking-wider text-muted-foreground flex-wrap">
          <Building2 className="w-3.5 h-3.5" /> Companies and KYC
          {label && <span className="normal-case tracking-normal text-xs font-medium text-foreground" data-testid="entities-label">{label}: {data.accountName}</span>}
          {chipWords ? (
            <span className={tone(CHIP_TONE[chipWords.tone])} title={chipWords.title} data-testid="entities-current-summary">{chipWords.label}</span>
          ) : (
            <>
              <span className={tone(s.current === s.total ? TONE.current : TONE.expired)} data-testid="entities-current-summary">
                <span className="font-mono tabular-nums">{s.current}</span> of <span className="font-mono tabular-nums">{s.total}</span> cleared
              </span>
              {bucketBadges.filter(([n]) => n > 0).map(([n, label, cls]) => (
                <span key={label} className={tone(cls)}><span className="font-mono tabular-nums">{n}</span> {label}</span>
              ))}
            </>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {/* Add a company to check, and check several at once (24 November 2026). */}
        <div className="flex flex-wrap items-center gap-1.5 pb-1.5" data-testid="entities-toolbar">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAdding(true)} data-testid="entities-add-company">Add a company</Button>
          {clientRows.length > 0 && (
            <Button size="sm" variant={selecting ? "secondary" : "ghost"} className="h-7 text-xs" onClick={() => { setSelecting(v => !v); setPicked(new Set()); }} data-testid="entities-select">
              {selecting ? "Done" : "Select"}
            </Button>
          )}
          {selecting && (
            <>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPicked(new Set(clientRows.filter(r => r.client!.entityId).map(r => r.client!.entityId!)))} data-testid="entities-select-all">Select all</Button>
              <Button size="sm" className="h-7 text-xs" disabled={!picked.size || runChecks.isPending}
                onClick={() => runChecks.mutate(clientRows.filter(r => r.client!.entityId && picked.has(r.client!.entityId)))} data-testid="entities-run-checks">
                Run BGP's checks{picked.size ? ` on ${picked.size}` : ""}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!picked.size || linkXero.isPending}
                onClick={() => linkXero.mutate(clientRows.filter(r => r.client!.entityId && picked.has(r.client!.entityId)))} data-testid="entities-link-xero">
                Link to Xero{picked.size ? ` (${picked.size})` : ""}
              </Button>
              {/* Delete ticked sub companies (24 November 2026: "Can we delete too select and delete"). The server keeps one that signs,
                  pays or guarantees a transaction, or has AML records, and says why. */}
              {confirmDelete ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-1.5 py-0.5 text-xs">
                  Delete {picked.size} for good?
                  <Button size="sm" variant="destructive" className="h-6 text-[11px] px-2" disabled={removeMany.isPending}
                    onClick={() => removeMany.mutate(clientRows.filter(r => r.client!.entityId && picked.has(r.client!.entityId)))} data-testid="entities-delete-apply">
                    {removeMany.isPending ? "Deleting…" : "Delete"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[11px] px-1.5" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" disabled={!picked.size} onClick={() => setConfirmDelete(true)} data-testid="entities-delete">
                  Delete{picked.size ? ` ${picked.size}` : ""}
                </Button>
              )}
            </>
          )}
          {!selecting && <SuggestedCompanies companyId={companyId} onAdded={invalidate} />}
        </div>
        {/* Name gets the width and wraps to two lines; the chips drop
            beneath it until the card is wide enough to sit them alongside —
            side by side they cut the name to "THE ARD…" (Woody, 2026-09-28). */}
        <div className="max-h-96 overflow-y-auto divide-y divide-border [container-type:inline-size]">
          {rows.map(({ e, key }) => {
            const bucket = bucketOf(e);
            const actionable = isMlro && e.entityId;
            const menuRead = e.entityKind === "trading_entity" && !e.companiesHouseNumber && looksLikeSiteMenu(e.name);
            return (
              <div key={key} className="flex items-start gap-1.5 py-1.5" data-testid={`entity-row-${e.entityId ?? key}`}>
                {selecting && (e.client?.entityId ? (
                  <input type="checkbox" className="mt-1.5 h-4 w-4 shrink-0 accent-primary" aria-label={`Select ${e.name}`}
                    checked={picked.has(e.client.entityId)}
                    onChange={ev => setPicked(prev => { const next = new Set(prev); if (ev.target.checked) next.add(e.client!.entityId!); else next.delete(e.client!.entityId!); return next; })}
                    data-testid={`entity-pick-${e.entityId}`} />
                ) : <span className="w-4 shrink-0" />)}
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
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
                      {/* The account's own company by its Companies House name (it read "Review account entity"). */}
                      <span className="text-xs font-medium line-clamp-2 break-words">{e.relation === "self" ? (e.registeredName || e.name) : e.name}</span>
                      {e.tradingAs && <span className="text-[11px] text-muted-foreground line-clamp-1 break-words">trading as {e.tradingAs}</span>}
                      {menuRead && <span className="text-[11px] text-amber-700 dark:text-amber-300">Read from a website menu, not a company</span>}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1 pl-5 [@container(min-width:560px)]:pl-0 [@container(min-width:560px)]:shrink-0 [@container(min-width:560px)]:justify-end">
                    {e.companiesHouseNumber ? (
                      <span className={chip}>CH <span className="font-mono">{e.companiesHouseNumber}</span></span>
                    ) : e.client?.kind === "person" ? (
                      <span className={chip}>Person</span>
                    ) : e.client?.kind === "abroad" ? (
                      <span className={chip}>Registered abroad</span>
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
                    <KycChip bucket={bucket} expiresAt={e.kyc?.expiresAt} scope={e.kyc?.scope} started={clientStarted(e)} />
                  </span>
                </button>
                {e.entityId && !menuRead && <span className="pl-5"><EntityTransactions e={e} /></span>}
                {e.client && <span className="pl-5"><ClientKycLine e={e} bulk={e.client.entityId ? bulkState[e.client.entityId] : undefined} /></span>}
                </div>
                <span className="flex items-center gap-0.5 shrink-0 pt-px">
                  {e.client && !menuRead && (
                    <Button size="sm" variant="outline" className="h-6 text-[11px] px-1.5" onClick={() => setKycFor(e)} data-testid={`entity-kyc-${e.entityId}`}>KYC</Button>
                  )}
                  {!e.client && e.relation === "self" && e.entityKind === "company" && !!e.companiesHouseNumber
                    && !data.entities.some(x => x.entityKind === "trading_entity" && (x.companiesHouseNumber || "").toUpperCase() === (e.companiesHouseNumber || "").toUpperCase()) && (
                    <Button size="sm" variant="ghost" className="h-6 text-[11px] px-1.5" disabled={addSelf.isPending} onClick={() => addSelf.mutate(e)}
                      title="File this company under the account so it can be checked" data-testid={`entity-add-self-${e.entityId}`}>Add to check</Button>
                  )}
                  {menuRead && e.entityId && !(e.transactions || []).length && (
                    <Button
                      size="sm" variant="ghost" className="h-6 text-[11px] px-1.5"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(e)}
                      data-testid={`entity-remove-${e.entityId}`}
                    >Remove</Button>
                  )}
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
      {kycFor?.client && (
        <ClientKycDialog companyId={kycFor.client.companyId} entityId={kycFor.client.entityId} name={kycFor.name} open={!!kycFor}
          onOpenChange={o => { if (!o) { setKycFor(null); invalidate(); } }} />
      )}
      <CreateBillingEntityDialog open={adding} onOpenChange={setAdding} brand={{ id: companyId, name: data.accountName }} initialQuery="" xero={false} testIdPrefix="entities-add"
        onCreated={() => { setAdding(false); invalidate(); }} onSavedWithoutXero={() => { setAdding(false); invalidate(); }} />
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
  // The in-app investigator is retired (KYC4U is BGP's MLRO, 2026-10-05).
  const kycHubHref: string | null = latestInvestigation ? null : null;
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
        <KycChip bucket={bucket} expiresAt={kyc?.expiresAt} scope={kyc?.scope} />
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

      {/* KYC record + evidence retired 2026-10-05 — KYC4U is BGP's MLRO;
          the entity's status shows in the header chip. */}
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

  // The checks run on each transaction's Parties & AML: the window says where
  // (Woody, 23 November 2026: "Are these all linked to the AML?").
  const txns = entity?.transactions || [];
  const actions = (
    <div className="shrink-0 border-t border-border pt-3 space-y-2" data-testid="entity-review-aml">
      <p className="text-[11px] text-muted-foreground">
        {bucket === "current" && kyc?.scope === "sanctions_only"
          ? `Sanctions checks only, signed off${kyc?.approvedBy ? ` by ${approverWords(kyc.approvedBy)}` : ""} on a letting under £10,000 a month. A sale, or a letting at £10,000 a month or more, needs the full checks.`
          : bucket === "current"
          ? `Approved${kyc?.approvedBy ? ` by ${approverWords(kyc.approvedBy)}` : ""}${kyc?.nextReviewAt ? `, re-check due ${fmtDate(kyc.nextReviewAt)}` : ""}.`
          : bucket === "inReview" && kyc?.lastCheckedAt
            ? `In review since ${fmtDate(kyc.lastCheckedAt)}.`
            : "Not checked yet."}
        {" "}The checks run on a transaction's Parties &amp; AML.
      </p>
      {txns.length > 0 ? (
        <ul className="space-y-1">
          {txns.map(t => (
            <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{t.name}{t.ref != null ? <span className="text-muted-foreground"> #{t.ref}</span> : null}<span className="text-[11px] text-muted-foreground"> · the {t.role}</span></span>
              <span className="flex shrink-0 items-center gap-3">
                {/* The full checks on the small letting itself: its AML box opens on them. */}
                {bucket === "current" && kyc?.scope === "sanctions_only" && (
                  <Link href={`/deals/${t.id}?section=parties&full=${encodeURIComponent(t.role)}`} className="text-xs text-primary hover:underline" data-testid={`entity-review-full-kyc-${t.id}`}>Start full KYC</Link>
                )}
                <Link href={`/deals/${t.id}?section=parties`} className="text-xs text-primary hover:underline" data-testid={`entity-review-aml-${t.id}`}>Open its AML</Link>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="text-[11px] text-muted-foreground">It is not a party to any transaction yet.</p>}
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
