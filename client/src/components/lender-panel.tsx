// Lender board — the lender-specific boards on a Lender company page, set
// into the shared company profile (profile card, conversation, contacts,
// compliance, news) like the landlord and agent layouts. Answers two
// questions: what are they lending on (properties where they're the senior
// or junior lender, with the facility events that name them), and on what
// terms do they lend.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Pill, pillMetrics, pillActive, pillInactive } from "@/components/ui/pill";
import { Pencil, Check, X, Landmark, Building2 } from "lucide-react";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { gbDate } from "@/lib/format";
import { moneyM, debtEventLabel } from "@/components/account-team-views";
import { useToast } from "@/hooks/use-toast";
import type { CrmCompany } from "@shared/schema";

const LENDER_TYPE_LABELS: Record<string, string> = {
  clearing_bank: "Clearing bank",
  investment_bank: "Investment bank",
  insurance: "Insurance",
  pension: "Pension",
  debt_fund: "Debt fund",
  private_credit: "Private credit",
  mezzanine: "Mezzanine",
  bridging: "Bridging",
  development: "Development",
  building_society: "Building society",
};

const ASSET_CLASS_OPTIONS = ["Office", "Retail", "Industrial", "Residential", "Mixed Use", "Hotel", "Student", "Healthcare", "BTR"];
const GEOGRAPHY_OPTIONS = ["London", "SE England", "UK Wide", "International"];
const LOAN_TERM_OPTIONS = ["Short (<3y)", "Medium (3-7y)", "Long (7y+)"];
const LOAN_STRUCTURE_OPTIONS = ["Senior", "Mezzanine", "Whole Loan", "Construction"];
const RECOURSE_OPTIONS = ["Full", "Limited", "Non-recourse"];
const LENDER_TYPE_OPTIONS = Object.keys(LENDER_TYPE_LABELS);

type SecuredProperty = {
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  interestType: "senior" | "junior";
  borrowerId?: string | null;
  borrowerName?: string | null;
};

type DebtEvent = {
  id: string;
  eventType: string;
  eventDate: string | null;
  lender: string | null;
  amount: number | null;
  notes: string | null;
  propertyId: string | null;
  propertyName: string | null;
  borrowerId: string | null;
  borrowerName: string | null;
};

type LrCharge = {
  titleNumber: string;
  propertyId?: string;
  propertyName?: string;
  chargeDate: string;
  amount?: number;
  notes?: string;
};

type FormState = {
  lenderType: string;
  lendingActive: boolean;
  typicalLoanSizeMinM: string;
  typicalLoanSizeMaxM: string;
  typicalLtvMax: string;
  typicalMarginBps: string;
  typicalLoanTerm: string;
  typicalLoanStructure: string;
  recourse: string;
  preferredAssetClasses: string[];
  preferredGeographies: string[];
  lendingAppetiteNotes: string;
};

function buildForm(company: CrmCompany): FormState {
  const c = company as any;
  return {
    lenderType: c.lenderType || "",
    lendingActive: c.lendingActive ?? true,
    typicalLoanSizeMinM: c.typicalLoanSizeMinM != null ? String(c.typicalLoanSizeMinM) : "",
    typicalLoanSizeMaxM: c.typicalLoanSizeMaxM != null ? String(c.typicalLoanSizeMaxM) : "",
    typicalLtvMax: c.typicalLtvMax != null ? String(c.typicalLtvMax) : "",
    typicalMarginBps: c.typicalMarginBps != null ? String(c.typicalMarginBps) : "",
    typicalLoanTerm: c.typicalLoanTerm || "",
    typicalLoanStructure: c.typicalLoanStructure || "",
    recourse: c.recourse || "",
    preferredAssetClasses: c.preferredAssetClasses || [],
    preferredGeographies: c.preferredGeographies || [],
    lendingAppetiteNotes: c.lendingAppetiteNotes || "",
  };
}

const fetchJson = async <T,>(url: string): Promise<T[]> => {
  const res = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
  if (!res.ok) return [];
  const body = await res.json();
  return Array.isArray(body) ? body : [];
};

const fmtDate = (d: string | null | undefined) => d ? gbDate(d, { day: "numeric", month: "short", year: "numeric" }) : null;
const rowPill = (active: boolean) => `${pillMetrics} ${active ? pillActive : pillInactive}`;
const sectionLabel = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

export function LenderPanel({ companyId, company, canEdit = true }: { companyId: string; company: CrmCompany; canEdit?: boolean }) {
  const c = company as any;
  const { data: securedProperties = [] } = useQuery<SecuredProperty[]>({
    queryKey: ["/api/lenders/secured-properties", companyId],
    queryFn: () => fetchJson<SecuredProperty>(`/api/lenders/secured-properties?companyId=${companyId}`),
  });
  const { data: debtEvents = [] } = useQuery<DebtEvent[]>({
    queryKey: ["/api/lenders/debt-events", companyId],
    queryFn: () => fetchJson<DebtEvent>(`/api/lenders/debt-events?companyId=${companyId}`),
  });
  const { data: lrCharges = [] } = useQuery<LrCharge[]>({
    queryKey: ["/api/lenders/lr-charges", companyId],
    queryFn: () => fetchJson<LrCharge>(`/api/lenders/lr-charges?companyId=${companyId}`),
  });

  return (
    <div className="grid gap-3 [@container(min-width:900px)]:grid-cols-[3fr_2fr] items-start" data-testid="lender-panel">
      <LoansBoard securedProperties={securedProperties} debtEvents={debtEvents} lrCharges={lrCharges} />
      <LendingTermsBoard companyId={companyId} company={company} canEdit={canEdit} key={c.id} />
    </div>
  );
}

function LoansBoard({ securedProperties, debtEvents, lrCharges }: { securedProperties: SecuredProperty[]; debtEvents: DebtEvent[]; lrCharges: LrCharge[] }) {
  const [showAllEvents, setShowAllEvents] = useState(false);
  const now = Date.now();
  // Each secured property carries its facility size (the latest drawdown /
  // refinance that names this lender) and the next maturity still ahead.
  const facilityFor = (propertyId: string) => {
    const rows = debtEvents.filter(e => e.propertyId === propertyId);
    // An event naming two lenders ("Barclays (senior) / Vahid (junior)")
    // carries the senior amount — prefer this lender's own events, so the
    // junior notes read £5m, not the £30m senior facility.
    const own = rows.filter(e => !/\s\/\s/.test(e.lender || ""));
    const drawdown = (e: DebtEvent) => !!e.amount && /refinance|fundraise|acquisition/i.test(e.eventType);
    const sized = own.find(drawdown) || own.find(e => e.amount) || rows.find(drawdown) || rows.find(e => e.amount);
    const next = rows
      .filter(e => /maturity/i.test(e.eventType) && e.eventDate && new Date(e.eventDate).getTime() >= now)
      .sort((a, b) => new Date(a.eventDate!).getTime() - new Date(b.eventDate!).getTime())[0];
    return { amount: sized ? moneyM(sized.amount) : null, nextMaturity: next ? fmtDate(next.eventDate) : null };
  };
  const shownEvents = showAllEvents ? debtEvents : debtEvents.slice(0, 5);
  const count = securedProperties.length;
  return (
    <Card data-testid="lender-loans">
      <CardHeader className="p-3 pb-2">
        <CardTitle className={`${sectionLabel} flex items-center gap-2`}>
          <Building2 className="w-3.5 h-3.5" /> Loans on properties
          {count > 0 && <span className="font-mono tabular-nums normal-case tracking-normal">{count}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        {count === 0 ? (
          <p className="text-sm text-muted-foreground">No loans recorded yet — set this lender on a property's Ownership board.</p>
        ) : (
          <div className="space-y-1.5">
            {securedProperties.map(p => {
              const f = facilityFor(p.propertyId);
              return (
                <div key={`${p.propertyId}-${p.interestType}`} className="rounded-lg border border-border bg-card px-3 py-2 min-w-0" data-testid={`lender-loan-${p.propertyId}`}>
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="min-w-0">
                      <Link href={`/properties/${p.propertyId}`} className="text-sm font-medium hover:underline break-words">{p.propertyName}</Link>
                      {p.propertyAddress && <p className="text-[11px] text-muted-foreground truncate">{p.propertyAddress}</p>}
                    </div>
                    {f.amount && <span className="text-sm font-mono tabular-nums shrink-0">{f.amount}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[11px] text-muted-foreground">
                    <span className={rowPill(p.interestType === "senior")}>{p.interestType === "senior" ? "Senior lender" : "Junior lender"}</span>
                    {p.borrowerName && (p.borrowerId
                      ? <span>Borrower <Link href={`/companies/${p.borrowerId}`} className="text-foreground hover:underline">{p.borrowerName}</Link></span>
                      : <span>Borrower <span className="text-foreground">{p.borrowerName}</span></span>)}
                    {f.nextMaturity && <span>Next maturity <span className="font-mono tabular-nums text-foreground">{f.nextMaturity}</span></span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {debtEvents.length > 0 && (
          <div className="space-y-1.5 pt-1" data-testid="lender-debt-events">
            <div className={sectionLabel}>Facility events <span className="font-mono tabular-nums normal-case tracking-normal">{debtEvents.length}</span></div>
            <div className="divide-y divide-border">
              {shownEvents.map(e => (
                <div key={e.id} className="py-1.5 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 min-w-0">
                    <p className="text-sm min-w-0 truncate">
                      <span className="font-medium">{debtEventLabel(e.eventType)}</span>
                      {e.propertyName && <> · {e.propertyId ? <Link href={`/properties/${e.propertyId}`} className="hover:underline">{e.propertyName}</Link> : e.propertyName}</>}
                    </p>
                    <span className="text-[11px] font-mono tabular-nums text-muted-foreground shrink-0">{fmtDate(e.eventDate) || "No date"}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2 break-words">
                    {[moneyM(e.amount), e.borrowerName, e.notes].filter(Boolean).join(" · ")}
                  </p>
                </div>
              ))}
            </div>
            {debtEvents.length > 5 && (
              <button type="button" onClick={() => setShowAllEvents(v => !v)} className="text-xs text-primary hover:underline">
                {showAllEvents ? "Show fewer" : `Show all ${debtEvents.length}`}
              </button>
            )}
          </div>
        )}

        {lrCharges.length > 0 && (
          <div className="space-y-1.5 pt-1" data-testid="lender-lr-charges">
            <div className={sectionLabel}>Land Registry charges <span className="font-mono tabular-nums normal-case tracking-normal">{lrCharges.length}</span></div>
            <div className="divide-y divide-border">
              {lrCharges.map((ch, i) => (
                <div key={i} className="py-1.5 flex items-baseline justify-between gap-2 min-w-0" data-testid={`lr-charge-card-${i}`}>
                  <p className="text-sm min-w-0 truncate">
                    <span className="font-mono text-[11px] text-muted-foreground mr-1.5">{ch.titleNumber}</span>
                    {ch.propertyId ? <Link href={`/properties/${ch.propertyId}`} className="hover:underline">{ch.propertyName || ch.titleNumber}</Link> : ch.propertyName}
                  </p>
                  <span className="text-[11px] font-mono tabular-nums text-muted-foreground shrink-0">
                    {[ch.amount != null ? `£${Number(ch.amount).toLocaleString("en-GB")}` : null, fmtDate(ch.chargeDate)].filter(Boolean).join(" · ")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LendingTermsBoard({ companyId, company, canEdit }: { companyId: string; company: CrmCompany; canEdit: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(buildForm(company));
  const c = company as any;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        lender_type: form.lenderType || null,
        lending_active: form.lendingActive,
        typical_loan_size_min_m: form.typicalLoanSizeMinM !== "" ? parseFloat(form.typicalLoanSizeMinM) : null,
        typical_loan_size_max_m: form.typicalLoanSizeMaxM !== "" ? parseFloat(form.typicalLoanSizeMaxM) : null,
        typical_ltv_max: form.typicalLtvMax !== "" ? parseFloat(form.typicalLtvMax) : null,
        typical_margin_bps: form.typicalMarginBps !== "" ? parseInt(form.typicalMarginBps, 10) : null,
        typical_loan_term: form.typicalLoanTerm || null,
        typical_loan_structure: form.typicalLoanStructure || null,
        recourse: form.recourse || null,
        preferred_asset_classes: form.preferredAssetClasses,
        preferred_geographies: form.preferredGeographies,
        lending_appetite_notes: form.lendingAppetiteNotes || null,
      };
      return apiRequest("PATCH", `/api/crm/companies/${companyId}`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      setEditing(false);
      toast({ title: "Lending terms saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const toggleArray = (key: "preferredAssetClasses" | "preferredGeographies", value: string) => {
    setForm((f) => {
      const current = f[key];
      return { ...f, [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] };
    });
  };

  // Only what someone has actually recorded — a grid of "—" boxes said
  // nothing, and "Paused" was the column default, not a fact.
  const facts: Array<[string, string]> = [
    ["Type", c.lenderType ? (LENDER_TYPE_LABELS[c.lenderType] || String(c.lenderType).replace(/_/g, " ")) : ""],
    ["Loan size", c.typicalLoanSizeMinM != null || c.typicalLoanSizeMaxM != null
      ? (c.typicalLoanSizeMinM != null && c.typicalLoanSizeMaxM != null ? `£${c.typicalLoanSizeMinM}m–£${c.typicalLoanSizeMaxM}m` : c.typicalLoanSizeMaxM != null ? `up to £${c.typicalLoanSizeMaxM}m` : `from £${c.typicalLoanSizeMinM}m`)
      : ""],
    ["Max LTV", c.typicalLtvMax != null ? `${c.typicalLtvMax}%` : ""],
    ["Margin", c.typicalMarginBps != null ? `${c.typicalMarginBps}bps over SONIA` : ""],
    ["Term", c.typicalLoanTerm || ""],
    ["Structure", c.typicalLoanStructure || ""],
    ["Recourse", c.recourse || ""],
  ].filter(([, v]) => !!v) as Array<[string, string]>;
  const assetClasses: string[] = c.preferredAssetClasses || [];
  const geographies: string[] = c.preferredGeographies || [];
  const curated = facts.length > 0 || assetClasses.length > 0 || geographies.length > 0 || !!c.lendingAppetiteNotes;
  const numericFacts = new Set(["Loan size", "Max LTV", "Margin"]);

  return (
    <Card data-testid="lender-terms">
      <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className={`${sectionLabel} flex items-center gap-2`}>
          <Landmark className="w-3.5 h-3.5" /> Lending terms
          {curated && <span className={rowPill(c.lendingActive !== false)}>{c.lendingActive !== false ? "Lending" : "Not lending"}</span>}
        </CardTitle>
        {canEdit && (
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { if (!editing) setForm(buildForm(company)); setEditing(v => !v); }} aria-label={editing ? "Close lending terms editor" : "Edit lending terms"} data-testid="button-lender-edit">
            {editing ? <X className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Lender type</Label>
                <select className="h-9 text-sm w-full border border-input rounded-md bg-background px-2" value={form.lenderType} onChange={(e) => setForm({ ...form, lenderType: e.target.value })}>
                  <option value="">Not set</option>
                  {LENDER_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{LENDER_TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Currently lending</Label>
                <div className="flex items-center gap-1.5 mt-2">
                  <Pill active={form.lendingActive} onClick={() => setForm({ ...form, lendingActive: true })}>Lending</Pill>
                  <Pill active={!form.lendingActive} onClick={() => setForm({ ...form, lendingActive: false })}>Not lending</Pill>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["typicalLoanSizeMinM", "Loan size min (£m)"],
                ["typicalLoanSizeMaxM", "Loan size max (£m)"],
                ["typicalLtvMax", "Max LTV (%)"],
                ["typicalMarginBps", "Margin (bps)"],
              ] as const).map(([key, label]) => (
                <div key={key}>
                  <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
                  <Input type="number" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="h-9 text-sm font-mono" />
                </div>
              ))}
              {([
                ["typicalLoanTerm", "Loan term", LOAN_TERM_OPTIONS],
                ["typicalLoanStructure", "Structure", LOAN_STRUCTURE_OPTIONS],
                ["recourse", "Recourse", RECOURSE_OPTIONS],
              ] as const).map(([key, label, options]) => (
                <div key={key}>
                  <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
                  <select className="h-9 text-sm w-full border border-input rounded-md bg-background px-2" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
                    <option value="">Not set</option>
                    {options.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Asset classes</Label>
              <div className="flex flex-wrap gap-1.5">
                {ASSET_CLASS_OPTIONS.map((a) => <Pill key={a} active={form.preferredAssetClasses.includes(a)} onClick={() => toggleArray("preferredAssetClasses", a)}>{a}</Pill>)}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Geographies</Label>
              <div className="flex flex-wrap gap-1.5">
                {GEOGRAPHY_OPTIONS.map((g) => <Pill key={g} active={form.preferredGeographies.includes(g)} onClick={() => toggleArray("preferredGeographies", g)}>{g}</Pill>)}
              </div>
            </div>
            <div>
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Appetite notes</Label>
              <Textarea value={form.lendingAppetiteNotes} onChange={(e) => setForm({ ...form, lendingAppetiteNotes: e.target.value })} className="text-sm min-h-[60px] mt-1" placeholder="Sectors, deal types, current appetite…" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                <Check className="w-3.5 h-3.5 mr-1" /> Save
              </Button>
            </div>
          </div>
        ) : !curated ? (
          <p className="text-sm text-muted-foreground">No lending terms recorded yet{canEdit ? " — edit to add their loan sizes, LTV and appetite." : "."}</p>
        ) : (
          <div className="space-y-2.5">
            {facts.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                {facts.map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
                    <dd className={`text-sm break-words ${numericFacts.has(label) ? "font-mono tabular-nums" : ""}`}>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {(assetClasses.length > 0 || geographies.length > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {[...assetClasses, ...geographies].map(v => <span key={v} className={rowPill(false)}>{v}</span>)}
              </div>
            )}
            {c.lendingAppetiteNotes && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{c.lendingAppetiteNotes}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
