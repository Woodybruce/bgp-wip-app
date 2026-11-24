// The Companies view on Transactions → AML (Woody, 24 November 2026: "We need
// a dashboard so it's easy to search and add a company ... Should auto
// populate with all the companies we have in the transactions list both
// brands and landlords. I can then go over all of them and start adding the
// contracting entities to start KYC", then "Can we delete too select and
// delete / We also want the deals / transactions to also be in there so we
// can aml the transactions too as we currently do").
//
// One row per company from GET /api/aml-dashboard/companies. A row opens the
// company: its contracting entities and their KYC (the company page's own
// Companies and KYC card), its transactions (each opening the transaction's
// own AML box), its people and agents, and KYC4U's past checks. Nothing here
// keeps a second copy of a rule: shared/kyc-companies.ts.
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Building2, ExternalLink, Globe, Loader2, Mail, Phone, Plus, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill, PillCount } from "@/components/ui/pill";
import { ScrollableTable } from "@/components/scrollable-table";
import { AccountEntitiesPanel } from "@/components/account-entities-panel";
import { AML_STAGE_TONE } from "@/components/deal-aml-status";
import { DealAmlDialog, type AmlDialogDeal } from "@/components/deal-aml-dialog";
import { Kyc4uStatusStrip } from "@/components/kyc4u-panel";
import { CrmSelectBar } from "@/components/crm-hub/crm-select-bar";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { AML_STAGE_LABEL, amlDealStatusWords } from "@shared/aml-dashboard";
import { DEAL_PARTY_LABEL, isDealPartyRole } from "@shared/deal-parties";
import { DEAL_STATUS_COLORS } from "@shared/deal-status";
import {
  KYC_COMPANY_FILTERS, kycCompanyCounts, kycCompanyMatchesFilter, kycCompanyMatchesSearch,
  type KycCompanyFilter, type KycCompanyRow, type KycCompanyTransaction,
} from "@shared/kyc-companies";

export const KYC_COMPANIES_KEY = "/api/aml-dashboard/companies";
interface Feed { rows: KycCompanyRow[]; unchecked: string[] }

const KYC_TONE: Record<KycCompanyRow["kyc"]["tone"], string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  bad: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  none: "bg-muted text-muted-foreground",
};
const NEXT_TONE: Record<KycCompanyRow["next"]["tone"], string> = {
  ok: "text-emerald-700 dark:text-emerald-300",
  act: "text-foreground",
  wait: "text-amber-700 dark:text-amber-300",
  bad: "text-red-700 dark:text-red-300",
};
const KIND_WORDS: Record<KycCompanyRow["kind"], string> = { landlord: "Landlord", brand: "Brand", other: "Company" };
const roleWords = (role: string) => (isDealPartyRole(role) ? DEAL_PARTY_LABEL[role] : role);
const errorText = (e: any) => { const m = String(e?.message || e || ""); try { const j = JSON.parse(m.slice(m.indexOf("{"))); return j.message || j.error || m; } catch { return m.replace(/^\d{3}:\s*/, ""); } };

function KycChip({ row }: { row: Pick<KycCompanyRow, "id" | "kyc"> }) {
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", KYC_TONE[row.kyc.tone])} title={row.kyc.title} data-testid={`kyc-company-chip-${row.id}`}>{row.kyc.label}</span>;
}

function NextLine({ row }: { row: Pick<KycCompanyRow, "id" | "next"> }) {
  return (
    <span className={cn("text-xs", NEXT_TONE[row.next.tone])} data-testid={`kyc-company-next-${row.id}`}>
      <span className="font-semibold">{row.next.lead}</span>{row.next.words ? <span> · {row.next.words}</span> : null}
    </span>
  );
}

function StageChip({ t }: { t: KycCompanyTransaction }) {
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", AML_STAGE_TONE[t.stage])}>{AML_STAGE_LABEL[t.stage]}</span>;
}

function StatusChip({ t }: { t: KycCompanyTransaction }) {
  const s = amlDealStatusWords({ dealStatus: t.status, dealType: t.dealType });
  if (!s.words) return null;
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", s.code ? DEAL_STATUS_COLORS[s.code] : "bg-muted text-muted-foreground")}>{s.words}</span>;
}

function EntitiesCell({ row }: { row: KycCompanyRow }) {
  if (!row.entities.length) return <span className="text-xs text-amber-700 dark:text-amber-300">None yet</span>;
  return (
    <span className="flex flex-col gap-0.5 text-xs">
      {row.entities.slice(0, 2).map(e => (
        <span key={e.id || e.name} className="break-words">
          {e.name}{e.number && <span className="ml-1 font-mono text-muted-foreground">{e.number}</span>}
          {e.kind === "abroad" && <span className="ml-1 text-muted-foreground">(abroad)</span>}
          {e.kind === "person" && <span className="ml-1 text-muted-foreground">(person)</span>}
        </span>
      ))}
      {row.entities.length > 2 && <span className="text-muted-foreground">+{row.entities.length - 2} more</span>}
    </span>
  );
}

function TransactionsCell({ row }: { row: KycCompanyRow }) {
  if (!row.transactions.length) return <span className="text-xs text-muted-foreground">None</span>;
  return (
    <span className="flex flex-col gap-1 text-xs">
      {row.transactions.slice(0, 2).map(t => (
        <span key={`${t.id}:${t.role}`} className="flex flex-wrap items-center gap-1">
          <span className="font-mono text-muted-foreground">{t.ref != null ? `#${t.ref}` : ""}</span>
          <span className="truncate max-w-[160px]" title={t.name}>{t.name}</span>
          <StageChip t={t} />
          {t.late && <span className="rounded-full bg-red-100 px-1.5 text-[10px] font-medium text-red-800 dark:bg-red-950/40 dark:text-red-200">Late</span>}
        </span>
      ))}
      {row.transactions.length > 2 && <span className="text-muted-foreground">+{row.transactions.length - 2} more</span>}
    </span>
  );
}

function PeopleCell({ row }: { row: KycCompanyRow }) {
  const firms = [...new Set(row.agents.map(a => a.firm).filter((x): x is string => !!x))];
  return (
    <span className="flex flex-col gap-0.5 text-xs">
      <span>{row.people.count ? `${row.people.count} ${row.people.count === 1 ? "person" : "people"}${row.people.first[0] ? ` · ${row.people.first[0].name}` : ""}` : <span className="text-muted-foreground">No people</span>}</span>
      {firms.length > 0 && <span className="text-muted-foreground truncate max-w-[200px]" title={firms.join(", ")}>Agents: {firms.join(", ")}</span>}
    </span>
  );
}

function CompanyCell({ row }: { row: KycCompanyRow }) {
  return (
    <span className="flex flex-col gap-0.5 min-w-0">
      <span className="font-medium break-words">{row.name}</span>
      <span className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
        <span>{KIND_WORDS[row.kind]}</span>
        {row.website && <span className="truncate max-w-[160px]">· {row.website}</span>}
        {row.sanctionsOnly.on && <span className="rounded-full border px-1.5" title="Lettings under £10,000 a month: the sanctions checks only">Sanctions only</span>}
      </span>
    </span>
  );
}

export function KycCompaniesView({ isAdmin }: { isAdmin: boolean }) {
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<KycCompanyFilter>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { data, isLoading, error } = useQuery<Feed>({ queryKey: [KYC_COMPANIES_KEY] });
  const searched = useMemo(() => (data?.rows || []).filter(r => kycCompanyMatchesSearch(r, query)), [data, query]);
  const counts = useMemo(() => kycCompanyCounts(searched), [searched]);
  const shown = useMemo(() => searched.filter(r => kycCompanyMatchesFilter(r, filter)), [searched, filter]);
  const openRow = (data?.rows || []).find(r => r.id === openId) || null;
  const onRow = (r: KycCompanyRow) => {
    if (!selecting) return setOpenId(r.id);
    setPicked(prev => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; });
  };

  return (
    <div className="space-y-3" data-testid="kyc-companies">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Which companies">
          {KYC_COMPANY_FILTERS.map(f => (
            <Pill key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)} data-testid={`kyc-companies-filter-${f.key}`}>
              {f.label}<PillCount n={counts[f.key]} active={filter === f.key} />
            </Pill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 md:ml-auto">
          <div className="relative w-full sm:w-auto">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Company, entity, transaction, Ref, agent" className="h-8 pl-7 w-full sm:w-64 text-sm" data-testid="kyc-companies-search" />
          </div>
          <Button size="sm" className="h-8" onClick={() => setAdding(true)} data-testid="kyc-companies-add"><Plus className="w-3.5 h-3.5 mr-1" />Add a company</Button>
          {isAdmin && !selecting && <Button size="sm" variant="outline" className="h-8" onClick={() => { setSelecting(true); setPicked(new Set()); }} data-testid="kyc-companies-select">Select</Button>}
        </div>
      </div>

      {selecting && (
        <CrmSelectBar kind="kyc" words={{ one: "company", many: "companies" }} picked={picked} onPick={setPicked}
          shown={shown.map(r => ({ id: r.id, name: r.name }))} onDone={() => { setSelecting(false); setPicked(new Set()); }}
          onDeleted={() => queryClient.invalidateQueries({ queryKey: [KYC_COMPANIES_KEY] })} />
      )}

      {!!data?.unchecked.length && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="kyc-companies-unchecked">
          <AlertCircle className="w-3.5 h-3.5" />Could not be read just now: {data.unchecked.join(", ")}.
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Reading every company on a transaction…</div>
      ) : error ? (
        <p className="text-sm text-destructive">The companies could not be read.</p>
      ) : !shown.length ? (
        <p className="text-sm text-muted-foreground" data-testid="kyc-companies-empty">No companies here{query ? " for that search" : ""}.</p>
      ) : isMobile ? (
        <ul className="space-y-2" data-testid="kyc-companies-cards">
          {shown.map(r => (
            <li key={r.id}>
              <button type="button" onClick={() => onRow(r)} className={cn("w-full text-left rounded-lg border bg-card p-3 space-y-1.5", picked.has(r.id) && "ring-2 ring-primary")} data-testid={`kyc-company-row-${r.id}`}>
                <div className="flex items-start justify-between gap-2"><CompanyCell row={r} /><KycChip row={r} /></div>
                <NextLine row={r} />
                <div className="text-xs text-muted-foreground">
                  {r.entities.length ? `${r.entities.length} contracting ${r.entities.length === 1 ? "entity" : "entities"}` : "No contracting entity"}
                  {" · "}{r.transactions.length} transaction{r.transactions.length === 1 ? "" : "s"}
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border overflow-hidden" data-testid="kyc-companies-table-box">
          <ScrollableTable minWidth={1080} topScrollbar>
            <table className="w-full text-sm" data-testid="kyc-companies-table">
              <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  {selecting && <th className="w-8 px-2 py-2" />}
                  <th className="text-left font-medium px-3 py-2">Company</th>
                  <th className="text-left font-medium px-3 py-2">Contracting entities</th>
                  <th className="text-left font-medium px-3 py-2">KYC</th>
                  <th className="text-left font-medium px-3 py-2">Transactions</th>
                  <th className="text-left font-medium px-3 py-2">People and agents</th>
                  <th className="text-left font-medium px-3 py-2">Next</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map(r => (
                  <tr key={r.id} onClick={() => onRow(r)} className={cn("cursor-pointer hover:bg-muted/40 align-top", picked.has(r.id) && "bg-primary/5")} data-testid={`kyc-company-row-${r.id}`}>
                    {selecting && <td className="px-2 py-2"><input type="checkbox" readOnly checked={picked.has(r.id)} className="h-4 w-4 accent-primary" aria-label={`Select ${r.name}`} /></td>}
                    <td className="px-3 py-2 max-w-[220px]"><CompanyCell row={r} /></td>
                    <td className="px-3 py-2 max-w-[240px]"><EntitiesCell row={r} /></td>
                    <td className="px-3 py-2"><KycChip row={r} /></td>
                    <td className="px-3 py-2 max-w-[300px]"><TransactionsCell row={r} /></td>
                    <td className="px-3 py-2 max-w-[220px]"><PeopleCell row={r} /></td>
                    <td className="px-3 py-2 max-w-[240px]"><NextLine row={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        </div>
      )}

      {openRow && <CompanyKycWindow row={openRow} onClose={() => setOpenId(null)} />}
      <AddKycCompanyDialog open={adding} onOpenChange={setAdding} onAdded={id => { setAdding(false); setOpenId(id); }} />
    </div>
  );
}

// ── One company ─────────────────────────────────────────────────────────────

function SanctionsOnlySwitch({ row }: { row: KycCompanyRow }) {
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: async (on: boolean | null) => apiRequest("PUT", `/api/aml-dashboard/companies/${encodeURIComponent(row.id)}/sanctions-only`, { on }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KYC_COMPANIES_KEY] }),
    onError: (e: any) => toast({ title: "Not changed", description: errorText(e), variant: "destructive" }),
  });
  const state = row.sanctionsOnly;
  const choice = state.set === null ? "auto" : state.set ? "on" : "off";
  const autoWords = state.auto ? "sanctions only: every transaction is a letting under £10k a month" : "full checks";
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="kyc-company-sanctions-switch">
      <span className="text-xs text-muted-foreground">Checks:</span>
      <Pill active={choice === "auto"} onClick={() => save.mutate(null)} disabled={save.isPending} data-testid="kyc-sanctions-auto" title={`Worked out from its transactions: ${autoWords}`}>Automatic ({state.auto ? "sanctions only" : "full"})</Pill>
      <Pill active={choice === "on"} onClick={() => save.mutate(true)} disabled={save.isPending} data-testid="kyc-sanctions-on" title="Lettings under £10,000 a month: the sanctions checks only">Sanctions only</Pill>
      <Pill active={choice === "off"} onClick={() => save.mutate(false)} disabled={save.isPending} data-testid="kyc-sanctions-off">Full checks</Pill>
    </div>
  );
}

function Section({ title, children, testId, action }: { title: string; children: React.ReactNode; testId?: string; action?: React.ReactNode }) {
  return (
    <section className="space-y-1.5" data-testid={testId}>
      <div className="flex items-center gap-2 border-b pb-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  );
}

// "Add a transaction" from the company: New Transaction with it filled in, on the side it is usually on.
const newTransactionHref = (row: KycCompanyRow) =>
  `/deals?new=1&${row.kind === "brand" ? "tenantId" : "landlordId"}=${encodeURIComponent(row.id)}`;

function CompanyKycWindow({ row, onClose }: { row: KycCompanyRow; onClose: () => void }) {
  const [aml, setAml] = useState<AmlDialogDeal | null>(null);
  const [allPeople, setAllPeople] = useState(false);
  return (
    <Dialog open onOpenChange={o => { if (!o) { onClose(); queryClient.invalidateQueries({ queryKey: [KYC_COMPANIES_KEY] }); } }}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="kyc-company-window" onOpenAutoFocus={e => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <Building2 className="w-4 h-4 text-muted-foreground" />{row.name}
            <span className="text-xs font-normal text-muted-foreground">{KIND_WORDS[row.kind]}{row.companyType && row.companyType !== KIND_WORDS[row.kind] ? ` · ${row.companyType}` : ""}</span>
            <KycChip row={row} />
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <NextLine row={row} />
              {row.website && <a href={`https://${row.website}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><Globe className="w-3 h-3" />{row.website}</a>}
              <Link href={`/companies/${row.id}`} className="inline-flex items-center gap-1 text-primary hover:underline" data-testid="kyc-company-open-crm"><ExternalLink className="w-3 h-3" />Open in the CRM</Link>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <SanctionsOnlySwitch row={row} />

          {/* The company page's own card: one version everywhere. */}
          <AccountEntitiesPanel companyId={row.id} />

          <Section title={`Transactions (${row.transactions.length})`} testId="kyc-company-transactions"
            action={<Button size="sm" variant="outline" className="h-7 text-xs" asChild><Link href={newTransactionHref(row)} data-testid="kyc-company-add-transaction"><Plus className="w-3 h-3 mr-1" />Add a transaction</Link></Button>}>
            {!row.transactions.length ? (
              <p className="text-xs text-muted-foreground">Not on a transaction the AML board covers.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {row.transactions.map(t => (
                  <li key={`${t.id}:${t.role}`} className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-xs" data-testid={`kyc-company-transaction-${t.id}`}>
                    <span className="font-mono text-muted-foreground w-12 shrink-0">{t.ref != null ? `#${t.ref}` : ""}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium break-words">{t.name}</span>
                      <span className="block text-muted-foreground">{roleWords(t.role)}{t.signsAs ? ` · signs as ${t.signsAs}` : " · no company that signs yet"}{t.waitingOn ? ` · waiting on ${t.waitingOn}` : ""}</span>
                    </span>
                    <StatusChip t={t} />
                    <StageChip t={t} />
                    {t.late && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-950/40 dark:text-red-200">Late</span>}
                    <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={() => setAml({ id: t.id, name: t.name, dealRef: t.ref, status: t.status })} data-testid={`kyc-company-aml-${t.id}`}>AML</Button>
                    <Link href={`/deals/${t.id}?section=parties`} className="text-primary hover:underline">Open</Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="People and agents" testId="kyc-company-people">
            {!row.people.count && !row.agents.length && <p className="text-xs text-muted-foreground">No people or agents recorded. Add them in the CRM.</p>}
            {row.people.count > 0 && (
              <ul className="space-y-1 text-xs">
                {row.people.first.slice(0, allPeople ? 4 : 3).map(p => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-2">
                    <Users className="w-3 h-3 text-muted-foreground" /><span className="font-medium">{p.name}</span>
                    {p.role && <span className="text-muted-foreground">{p.role}</span>}
                    {p.email && <a href={`mailto:${p.email}`} className="inline-flex items-center gap-0.5 text-primary hover:underline"><Mail className="w-3 h-3" />{p.email}</a>}
                    {p.phone && <a href={`tel:${p.phone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-0.5 text-primary hover:underline"><Phone className="w-3 h-3" />{p.phone}</a>}
                  </li>
                ))}
                {row.people.count > 3 && !allPeople && <li><button type="button" className="text-primary hover:underline" onClick={() => setAllPeople(true)}>Show more</button></li>}
                {row.people.count > 4 && allPeople && <li><Link href={`/companies/${row.id}`} className="text-primary hover:underline">All {row.people.count} in the CRM</Link></li>}
              </ul>
            )}
            {row.agents.length > 0 && (
              <ul className="space-y-1 text-xs">
                {row.agents.map((a, i) => (
                  <li key={`${a.firmId || a.firm}-${a.contactId || a.person}-${i}`} className="flex flex-wrap items-center gap-x-2">
                    <Building2 className="w-3 h-3 text-muted-foreground" />
                    {a.firmId ? <Link href={`/companies/${a.firmId}`} className="font-medium hover:underline">{a.firm || "Agent"}</Link> : <span className="font-medium">{a.firm || "Agent"}</span>}
                    {a.person && <span>{a.person}</span>}
                    {a.email && <a href={`mailto:${a.email}`} className="inline-flex items-center gap-0.5 text-primary hover:underline"><Mail className="w-3 h-3" />{a.email}</a>}
                    <span className="text-muted-foreground">{a.on}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="KYC4U's past checks" testId="kyc-company-kyc4u">
            <Kyc4uStatusStrip companyId={row.id} />
          </Section>
        </div>
        <DealAmlDialog deal={aml} onClose={() => { setAml(null); queryClient.invalidateQueries({ queryKey: [KYC_COMPANIES_KEY] }); }} />
      </DialogContent>
    </Dialog>
  );
}

// ── Add a company ───────────────────────────────────────────────────────────

interface SearchHit { id: string; name: string; companyType: string | null; website: string | null; transactions: number; listed: boolean }

function AddKycCompanyDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; onAdded: (id: string) => void }) {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [type, setType] = useState<"Landlord" | "Tenant">("Landlord");
  const term = q.trim();
  const { data, isFetching } = useQuery<{ results: SearchHit[] }>({
    queryKey: ["/api/aml-dashboard/companies/search", term],
    enabled: open && term.length >= 2,
    queryFn: async () => {
      const res = await fetch(`/api/aml-dashboard/companies/search?q=${encodeURIComponent(term)}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
  const list = useMutation({
    mutationFn: async (companyId: string) => { await apiRequest("POST", "/api/aml-dashboard/companies/list", { companyId }); return companyId; },
    onSuccess: async id => { await queryClient.invalidateQueries({ queryKey: [KYC_COMPANIES_KEY] }); setQ(""); onAdded(id); },
    onError: (e: any) => toast({ title: "Not added", description: errorText(e), variant: "destructive" }),
  });
  // Not in the CRM yet: made there first (the one way a company is added), then listed here.
  const create = useMutation({
    mutationFn: async () => {
      const made = await (await apiRequest("POST", "/api/crm/companies", { name: term, companyType: type })).json();
      await apiRequest("POST", "/api/aml-dashboard/companies/list", { companyId: made.id });
      return String(made.id);
    },
    onSuccess: async id => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies-basic"] });
      await queryClient.invalidateQueries({ queryKey: [KYC_COMPANIES_KEY] });
      setQ(""); onAdded(id);
    },
    onError: (e: any) => toast({ title: "Not created", description: errorText(e), variant: "destructive" }),
  });
  const hits = data?.results || [];
  const exact = hits.some(h => h.name.toLowerCase() === term.toLowerCase());
  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) setQ(""); }}>
      <DialogContent className="max-w-lg" data-testid="kyc-add-company">
        <DialogHeader>
          <DialogTitle>Add a company</DialogTitle>
          <DialogDescription>Find it in the CRM, or add it. Then add its contracting entities and start their KYC.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Company or brand name, or its website" className="pl-7" data-testid="kyc-add-company-search" />
          </div>
          {isFetching && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />Searching the CRM…</p>}
          {hits.length > 0 && (
            <ul className="divide-y rounded-md border max-h-72 overflow-y-auto">
              {hits.map(h => (
                <li key={h.id}>
                  <button type="button" disabled={list.isPending} onClick={() => list.mutate(h.id)} className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-muted/60" data-testid={`kyc-add-company-hit-${h.id}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium break-words">{h.name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {[h.companyType, h.website, h.transactions ? `${h.transactions} transaction${h.transactions === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="text-xs text-primary">{h.listed || h.transactions ? "Open" : "Add"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {term.length >= 2 && !isFetching && !exact && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2" data-testid="kyc-add-company-create">
              <span className="text-xs">Not in the CRM: add <span className="font-medium">{term}</span> as</span>
              <Pill active={type === "Landlord"} onClick={() => setType("Landlord")}>Landlord</Pill>
              <Pill active={type === "Tenant"} onClick={() => setType("Tenant")}>Brand</Pill>
              <Button size="sm" className="h-7 text-xs ml-auto" disabled={create.isPending} onClick={() => create.mutate()} data-testid="kyc-add-company-create-button">
                {create.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Add to the CRM
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
