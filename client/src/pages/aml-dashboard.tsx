// The AML dashboard: every party on a live deal and where its checks stand
// (Woody, 18 November 2026: "a dashboard of all AML / KYC live and finished
// checks ... nice and easy"; step 6 of docs/deal-page-review-2026-11-18.md,
// a pill on Deals beside the deal list and the Letting Tracker). BGP staff
// only: the feed (server/aml-dashboard.ts) refuses anyone else, and the Deals
// hub offers the pill only to staff. The rules are shared/aml-dashboard.ts.
// One line per transaction with each party's checks inside it (Woody,
// 24 November 2026: "combine the 2 (normally) AML checks into just one
// transaction board or line ... That way doesnt get too crowded").
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { AlertCircle, ChevronDown, ExternalLink, Flag, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill, PillCount } from "@/components/ui/pill";
import { ScrollableTable } from "@/components/scrollable-table";
import { DealAmlStatusCard } from "@/components/deal-aml-status";
import { AmlCard, AmlCardGrid, AmlChip, AmlLateChip, AmlLevelChip, AmlStageChip, DealStatusChip as AmlDealStatusChip, KYC_CHIP_TONE, RedFlagChip, storeAmlView, storedAmlView, type AmlListView } from "@/components/aml-frame";
import { ViewToggle } from "@/components/mobile-card-view";
import { AmlFileButton } from "@/components/aml-file-button";
import { AmlPolicyPanel } from "@/components/aml-policy-panel";
import { AmlRegisterBoard, MyRegisterReports, RaiseReportButton } from "@/components/aml-register";
import { AmlTrainingBoard, AmlTrainingPanel } from "@/components/aml-training";
import { AmlRetentionBoard } from "@/components/aml-retention";
import { AmlRulesBoard } from "@/components/aml-rules";
import { AmlDecisionsBoard } from "@/components/aml-decisions";
import { KycEmailsAdmin } from "@/components/kyc-emails-admin";
import { KycCompaniesView, KYC_COMPANIES_KEY } from "@/components/kyc-companies/companies-view";
import { FileThumbGrid } from "@/components/file-popout";
import { fetchPartyTrail, partyFilesForPreview, partyTrailKey, type PartyTrailDocument } from "@/components/aml-files";
import { useIsMobile } from "@/hooks/use-mobile";
import { queryClient } from "@/lib/queryClient";
import { AmlStartBar, type AmlStart } from "@/components/aml-start";
import { LetterRail, WithLetterRail } from "@/components/letter-rail";
import { byName, indexLetter, letterCounts, type IndexLetter } from "@shared/letter-index";

// New Transaction, loaded only when the New transaction box is used: the
// Transactions page's own form (24 November 2026).
const NewTransactionDialog = lazy(() => import("@/pages/deals").then(m => ({ default: m.NewTransactionDialog })));
import { AML_BUCKETS, amlDealStatusWords, groupAmlByTransaction, leadParty, transactionBucketCounts, transactionMatches, type AmlBucket, type AmlDashboardRow, type AmlTransactionRow } from "@shared/aml-dashboard";
import { DEAL_PARTY_LABEL, isDealPartyRole } from "@shared/deal-parties";

interface Feed { rows: AmlDashboardRow[]; unchecked: string[] }
interface Trail {
  documents: PartyTrailDocument[];
  history: Array<{ at: string | null; who: string | null; what: string; detail: string | null }>;
}

// The level of due diligence BGP's AML policy gives the party.
const LEVEL_WORDS: Record<AmlDashboardRow["level"], string> = { simplified: "Simplified", standard: "Standard", enhanced: "Enhanced" };
const LEVEL_TONE: Record<AmlDashboardRow["level"], string> = {
  simplified: "text-muted-foreground",
  standard: "text-foreground",
  enhanced: "text-red-700 dark:text-red-300 font-medium",
};
function LevelCell({ row }: { row: AmlDashboardRow }) {
  // Marked Not required: no checks are needed, so no level applies.
  if (row.stage === "not_required") return <span className="text-muted-foreground" title={row.levelWhy.join("\n")} data-testid={`aml-level-${row.key}`}>—</span>;
  // A letting under £10,000 a month: sanctions checks only, no level of due diligence (23 November 2026).
  if (row.sanctionsOnly) return (
    <span className="flex flex-col text-muted-foreground" title="A letting under £10,000 a month: sanctions checks only" data-testid={`aml-level-${row.key}`}>
      <span className="whitespace-nowrap text-foreground">Sanctions only</span>
      <span className="text-[11px] leading-tight">Letting under £10k a month</span>
    </span>
  );
  return <span className={`whitespace-nowrap ${LEVEL_TONE[row.level]}`} title={row.levelWhy.join("\n")} data-testid={`aml-level-${row.key}`}>{LEVEL_WORDS[row.level]}</span>;
}

const roleWords = (role: string) => (isDealPartyRole(role) ? DEAL_PARTY_LABEL[role] : role);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "");
const moved = (n: number | null) => (n === null ? "—" : n === 0 ? "Today" : n === 1 ? "1 day" : `${n} days`);
const isBucket = (v: string | null): v is AmlBucket => !!v && AML_BUCKETS.some(b => b.key === v);

// The page's sections (19 November 2026): the checks for everyone; the AML
// register and the five-year deletion for the Nominated Officer and the
// Deputy; training for everyone (the officers and admins see everyone's).
// Client check emails for admins (21 November 2026: the preview and test of
// the emails BGP's own client checks send, moved here from the KYC4U page
// when KYC4U went to Subscriptions & APIs).
type Section = "checks" | "companies" | "rules" | "updates" | "policy" | "reports" | "training" | "records" | "emails";
const SECTIONS: Array<{ key: Section; label: string; officer?: boolean; admin?: boolean }> = [
  // Each party on each transaction (the key stays "checks": links carry it).
  { key: "checks", label: "Transactions" },
  // One row per company: its contracting entities, their KYC, its transactions (Woody, 24 November 2026).
  { key: "companies", label: "Companies" },
  // HMRC's rules in short, checked against HMRC every three months (22 November 2026).
  { key: "rules", label: "Rules" },
  // Every AML decision, who made it and when (Jack, 23 November 2026).
  { key: "updates", label: "Updates" },
  // The officers, the documents and the in-house switch: their own pill, so the
  // table starts at the top (Woody, 22 November 2026: "yes go ahead").
  { key: "policy", label: "Policy" },
  { key: "reports", label: "Reports", officer: true },
  { key: "training", label: "Training" },
  { key: "records", label: "Records", officer: true },
  { key: "emails", label: "Client check emails", admin: true },
];
const isSection = (v: string | null): v is Section => !!v && SECTIONS.some(x => x.key === v);
interface PolicyRoles { isOfficer?: boolean; managesTraining?: boolean; inHouseEdd?: { on: boolean } }

// The shared chips (aml-frame.tsx): the same AML stage, Late and transaction status everywhere.
function StageChip({ row }: { row: AmlDashboardRow }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <AmlStageChip stage={row.stage} expiresAt={row.expiresAt} testId={`aml-stage-${row.key}`} />
      {/* Past the point BGP's policy (Issue 4) needs the checks by, and not decided. */}
      {row.late && <AmlLateChip deadline={row.deadline} testId={`aml-late-${row.key}`} />}
    </span>
  );
}

const flagCount = (n: number) => `${n} red flag${n === 1 ? "" : "s"}`;

// The red flags as a count; pressing it shows what each one is, with the way to
// the party's checks or the transaction (Woody, 23 November 2026: "lets not show
// the actual problem in the table just 2 flags but click and it shows the
// explanations as pop up and can take to the AML board"). On a phone the card
// itself opens the checks, so the count is plain text there.
function Flags({ row, onOpen }: { row: AmlDashboardRow; onOpen?: (row: AmlDashboardRow) => void }) {
  if (!row.redFlags.length) return <span className="text-muted-foreground">—</span>;
  const count = <><Flag className="w-3.5 h-3.5 shrink-0" />{flagCount(row.redFlags.length)}</>;
  if (!onOpen) return <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-300" data-testid={`aml-flags-${row.key}`}>{count}</span>;
  const details = row.flagDetails?.length ? row.flagDetails : row.redFlags.map(label => ({ label, detail: null, source: null }));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 rounded text-red-700 underline-offset-2 hover:underline dark:text-red-300" data-testid={`aml-flags-${row.key}`}>
          {count}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0 text-xs" onClick={e => e.stopPropagation()} data-testid={`aml-flags-pop-${row.key}`}>
        <div className="border-b px-3 py-2 font-semibold">{flagCount(details.length)} · {row.brandName}</div>
        <ul className="max-h-72 space-y-2 overflow-y-auto px-3 py-2">
          {details.map((f, i) => (
            <li key={`${f.label}-${i}`} className="space-y-0.5">
              <p className="flex items-start gap-1.5 font-medium text-red-700 dark:text-red-300"><Flag className="mt-0.5 h-3 w-3 shrink-0" />{f.label}</p>
              {f.detail && <p className="pl-[1.125rem] text-muted-foreground">{f.detail}</p>}
              {f.source && <p className="pl-[1.125rem] text-[11px] text-muted-foreground">From {f.source}</p>}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
          <button type="button" className="rounded-md border bg-background px-2 py-1 font-medium hover:bg-muted" onClick={() => onOpen(row)} data-testid={`aml-flags-open-${row.key}`}>Open the checks</button>
          <Link href={`/deals/${row.dealId}?section=parties`} className="inline-flex items-center gap-1 text-primary hover:underline" data-testid={`aml-flags-deal-${row.key}`}>Go to the transaction <ExternalLink className="h-3 w-3" /></Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// The level of due diligence with the party's red flags under it, as Late
// sits under the AML stage (Woody, 23 November 2026: "combined due diligence
// and red flags same as stage to sit under each").
function DiligenceCell({ row, onOpen }: { row: AmlDashboardRow; onOpen?: (row: AmlDashboardRow) => void }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <LevelCell row={row} />
      {row.redFlags.length > 0 && <Flags row={row} onOpen={onOpen} />}
    </div>
  );
}

// Every agent on the transaction, one to a line (Woody, 23 November 2026:
// "dont let the agents responsible leak off the page they should be listed").
function AgentsCell({ agents, testId }: { agents: string[]; testId: string }) {
  if (!agents.length) return <span>—</span>;
  return (
    <ul className="space-y-0.5" data-testid={testId}>
      {agents.map(a => <li key={a} className="whitespace-nowrap">{a}</li>)}
    </ul>
  );
}

// The company being checked first, its role and brand in grey under it: every AML screen's heading (24 November 2026).
function PartyCell({ row }: { row: AmlDashboardRow }) {
  return (
    <div className="min-w-0">
      {/* Two lines before it is cut, now each transaction has the height (24 November 2026). */}
      <div className="font-medium line-clamp-2 break-words" title={row.signsAs || row.brandName}>{row.signsAs || row.brandName}</div>
      <div className="text-[11px] text-muted-foreground truncate" title={row.signsAs ? row.brandName : undefined}>
        {roleWords(row.role)}{row.signsAs ? <> · {row.brandName}</> : null}
      </div>
    </div>
  );
}

// The transaction by the building, or by the brand when BGP acts for the tenant
// (Woody, 25 November 2026: "lead with the building or brand depending on if we
// are acting on the building or then acting on the brand"): shared/aml-dashboard.ts
// transactionLead. Under it, what else tells it apart, and the Ref.
function TransactionSub({ t }: { t: AmlTransactionRow }) {
  if (!t.sub && t.dealRef == null) return null;
  return <>{t.sub}{t.dealRef != null && <span className="font-mono">{t.sub ? " · " : ""}#{t.dealRef}</span>}</>;
}

function DealCell({ t }: { t: AmlTransactionRow }) {
  return (
    <div className="min-w-0" title={t.dealName} data-testid={`aml-transaction-lead-${t.dealId}`}>
      <div className="font-medium line-clamp-2 break-words">{t.lead}</div>
      <div className="text-[11px] text-muted-foreground line-clamp-2 break-words"><TransactionSub t={t} /></div>
    </div>
  );
}

// The transaction's own status (Woody, 23 November 2026), in the Transactions
// board's words and colours: the shared chip.
function DealStatusChip({ row }: { row: AmlDashboardRow }) {
  if (!amlDealStatusWords(row).words) return <span className="text-muted-foreground">—</span>;
  return <AmlDealStatusChip status={row.dealStatus} dealType={row.dealType} testId={`aml-deal-status-${row.key}`} />;
}

// One transaction in the table: the transaction, its status and its agents
// once, and each party's checks on a line of its own under each other (Woody,
// 24 November 2026: "combine the 2 (normally) AML checks into just one
// transaction board or line"). A party's line opens that party; the
// transaction's own cells open the party on the pill shown.
function TransactionRows({ t, bucket, onOpen }: { t: AmlTransactionRow; bucket: AmlBucket; onOpen: (row: AmlDashboardRow) => void }) {
  const n = t.parties.length;
  const first = t.parties[0];
  const openLead = (e: React.MouseEvent) => { e.stopPropagation(); onOpen(leadParty(t, bucket)); };
  const block = "px-3 py-2 align-top group-hover/txn:bg-muted/30";
  const cell = (i: number) => `px-3 py-2 align-top group-hover/txn:bg-muted/30 [tr:hover>&]:bg-muted/60${i ? " border-t border-dashed border-border" : ""}`;
  return (
    <tbody className="group/txn border-t border-border" data-testid={`aml-transaction-${t.dealId}`}>
      {t.parties.map((r, i) => (
        <tr key={r.key} onClick={() => onOpen(r)} className="cursor-pointer" data-testid={`aml-row-${r.key}`}>
          {i === 0 && <>
            {/* Narrower below 1536px so every column, the agents included, fits a laptop screen from 1280px (Woody, 23 November 2026). */}
            <td rowSpan={n} onClick={openLead} className={`${block} max-w-[190px] 2xl:max-w-[260px]`}><DealCell t={t} /></td>
            <td rowSpan={n} onClick={openLead} className={block}><DealStatusChip row={first} /></td>
          </>}
          <td className={`${cell(i)} max-w-[170px] 2xl:max-w-[230px]`}><PartyCell row={r} /></td>
          <td className={cell(i)}><StageChip row={r} /></td>
          <td className={`${cell(i)} max-w-[240px]`}><DiligenceCell row={r} onOpen={onOpen} /></td>
          <td className={`${cell(i)} min-w-[120px] max-w-[200px]`}>{r.waitingOn}</td>
          <td className={`${cell(i)} text-right tabular-nums whitespace-nowrap`}>{moved(r.movedDays)}</td>
          {i === 0 && <td rowSpan={n} onClick={openLead} className={`${block} text-muted-foreground`}><AgentsCell agents={t.agents} testId={`aml-agents-${t.dealId}`} /></td>}
        </tr>
      ))}
    </tbody>
  );
}

// A party's checks on its line of a transaction card; pressing it opens the party.
function PartyLine({ row, onOpen }: { row: AmlDashboardRow; onOpen: (row: AmlDashboardRow) => void }) {
  const open = (e: React.SyntheticEvent) => { e.stopPropagation(); onOpen(row); };
  const when = row.movedDays === null ? null : row.movedDays === 0 ? "moved today" : `moved ${moved(row.movedDays)} ago`;
  return (
    <div role="button" tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(e); } }}
      className="-mx-1 space-y-1 rounded px-1 py-0.5 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`aml-row-${row.key}`}>
      <div className="font-medium leading-snug">{row.signsAs || row.brandName}{row.signsAs ? <span className="font-normal text-muted-foreground"> · {row.brandName}</span> : null}</div>
      <div className="flex flex-wrap items-center gap-1">
        <AmlStageChip stage={row.stage} expiresAt={row.expiresAt} testId={`aml-stage-${row.key}`} />
        {row.late && <AmlLateChip deadline={row.deadline} testId={`aml-late-${row.key}`} />}
        {row.sanctionsOnly ? <AmlChip className={KYC_CHIP_TONE.none} title="A letting under £10,000 a month: sanctions checks only">Sanctions only</AmlChip>
          : row.stage !== "not_required" && <AmlLevelChip level={row.level} title={row.levelWhy.join("\n")} />}
        <RedFlagChip count={row.redFlags.length} testId={`aml-flags-${row.key}`} />
      </div>
      {(row.waitingOn !== "Nobody" || when) && (
        <div className="text-xs text-muted-foreground">
          {row.waitingOn !== "Nobody" && <>Waiting on: <span className="text-foreground">{row.waitingOn}</span></>}
          {row.waitingOn !== "Nobody" && when ? " · " : ""}{when}
        </div>
      )}
    </div>
  );
}

// One transaction as a card, its parties inside it, on a phone and in the Cards
// view (Woody, 24 November 2026: "can we have a cards view of the AML checks?
// like we do with CRM", then one line per transaction the same day).
function AmlTransactionCard({ t, bucket, onOpen }: { t: AmlTransactionRow; bucket: AmlBucket; onOpen: (row: AmlDashboardRow) => void }) {
  const first = t.parties[0];
  return (
    <AmlCard testId={`aml-transaction-${t.dealId}`} onOpen={() => onOpen(leadParty(t, bucket))}
      title={t.lead}
      sub={<TransactionSub t={t} />}
      chips={<DealStatusChip row={first} />}
      rows={t.parties.map((r): [string, React.ReactNode] => [roleWords(r.role), <PartyLine row={r} onOpen={onOpen} />])}
      footer={t.agents.length ? <>Agents: {t.agents.join(", ")}</> : null}
    />
  );
}

// The party's trail (20 November 2026, Woody: "minimise each section with the
// detail to pop out"): the deal's AML box opens on this party, the deal's
// other parties on their Next line, and the documents and history each on one
// line until opened.
// officer: the Nominated Officer or a Deputy, who can make the party's AML file.
function PartyTrail({ row, onClose, officer }: { row: AmlDashboardRow; onClose: () => void; officer: boolean }) {
  const [docsOpen, setDocsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data: trail, isLoading } = useQuery<Trail>({
    queryKey: partyTrailKey(row.dealId, row.role),
    queryFn: () => fetchPartyTrail(row.dealId, row.role),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="aml-trail">
        <DialogHeader>
          <DialogTitle>{row.signsAs || row.brandName}</DialogTitle>
          <DialogDescription>
            {roleWords(row.role)} on {row.dealName}{row.signsAs ? ` (${row.brandName})` : ""}.{" "}
            <Link href={`/deals/${row.dealId}`} className="text-primary hover:underline inline-flex items-center gap-1" data-testid="aml-trail-open-deal">Open the transaction <ExternalLink className="w-3 h-3" /></Link>
          </DialogDescription>
          {officer && (
            <div className="pt-1" data-testid="aml-trail-file">
              <AmlFileButton dealId={row.dealId} role={row.role} partyName={row.signsAs || row.brandName} />
            </div>
          )}
        </DialogHeader>
        <DealAmlStatusCard dealId={row.dealId} dealStatus={row.dealStatus} focusCompanyId={row.brandId} />
        <section className="space-y-1.5">
          <button type="button" className="flex w-full items-center gap-2 text-left" aria-expanded={docsOpen} onClick={() => setDocsOpen(o => !o)} data-testid="aml-trail-documents-toggle">
            <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">Documents on its KYC record</h3>
            <span className="text-xs text-muted-foreground">{isLoading ? "…" : trail?.documents.length ? `${trail.documents.length}` : "none yet"}</span>
            <ChevronDown className={`ml-auto w-3.5 h-3.5 text-muted-foreground transition-transform ${docsOpen ? "rotate-180" : ""}`} />
          </button>
          {!docsOpen ? null : isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : !trail?.documents.length ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            // Thumbnails that open in the pop-out, not a list of downloads (Woody, 23 November 2026).
            <FileThumbGrid files={partyFilesForPreview(trail.documents)} testId="aml-trail-documents" limit={24} />
          )}
        </section>
        <section className="space-y-1.5">
          <button type="button" className="flex w-full items-center gap-2 text-left" aria-expanded={historyOpen} onClick={() => setHistoryOpen(o => !o)} data-testid="aml-trail-history-toggle">
            <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">History</h3>
            <span className="text-xs text-muted-foreground">{isLoading ? "…" : trail?.history.length ? `${trail.history.length} entries` : "nothing yet"}</span>
            <ChevronDown className={`ml-auto w-3.5 h-3.5 text-muted-foreground transition-transform ${historyOpen ? "rotate-180" : ""}`} />
          </button>
          {!historyOpen || isLoading ? null : !trail?.history.length ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm" data-testid="aml-trail-history">
              {trail.history.map((h, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-[11px] text-muted-foreground w-24 shrink-0 pt-0.5">{day(h.at)}</span>
                  <span className="min-w-0 break-words">{h.detail || h.what.replace(/_/g, " ")}{h.who ? <span className="text-muted-foreground"> · {h.who}</span> : null}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

export default function AmlDashboard() {
  const isMobile = useIsMobile();
  const search = useSearch();
  const [location, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const [bucket, setBucket] = useState<AmlBucket>(() => (isBucket(params.get("view")) ? (params.get("view") as AmlBucket) : "todo"));
  const [section, setSection] = useState<Section>(() => (isSection(params.get("section")) ? (params.get("section") as Section) : "checks"));
  const [mine, setMine] = useState(params.get("who") === "mine");
  const [lateOnly, setLateOnly] = useState(params.get("late") === "1");
  const [query, setQuery] = useState("");
  // A letter down the right picks the transactions known by a name under it (25 November 2026).
  const [letter, setLetter] = useState<IndexLetter | null>(null);
  const [open, setOpen] = useState<AmlDashboardRow | null>(null);
  // Started from the top of the page (Woody, 24 November 2026): a new
  // transaction typed out or from its heads of terms, or a company to add.
  const [startTx, setStartTx] = useState<AmlStart | null>(null);
  const [addCompany, setAddCompany] = useState(false);
  // Table or cards, as the CRM lists have it, remembered in this browser; a phone has cards.
  const [view, setView] = useState<AmlListView>(() => storedAmlView("checks"));
  const chooseView = (next: "table" | "card" | "board") => {
    const picked: AmlListView = next === "table" ? "table" : "card";
    setView(picked);
    if (!isMobile) storeAmlView("checks", picked);
  };
  const { data, isLoading, error } = useQuery<Feed>({ queryKey: ["/api/aml-dashboard"], enabled: section === "checks" });
  const { data: roles } = useQuery<PolicyRoles>({ queryKey: ["/api/aml-policy"] });
  const { data: me } = useQuery<{ isAdmin?: boolean } | null>({ queryKey: ["/api/auth/me"] });
  const sections = SECTIONS.filter(x => (!x.officer || roles?.isOfficer) && (!x.admin || me?.isAdmin));
  const shownSection: Section = sections.some(x => x.key === section) ? section : "checks";
  // Transactions and Companies share one top (Woody, 24 November 2026: "make the
  // company page the same format as the transactions page on the top so they
  // match up in terms of design and obviously have the new box"): the start bar
  // above both, the pills and controls laid out alike, and both fold on scroll.
  const startsHere = shownSection === "checks" || shownSection === "companies";
  // Add a company opens the Companies view's own Add a company, once.
  useEffect(() => { if (addCompany && shownSection === "companies") setAddCompany(false); }, [addCompany, shownSection]);

  // The view in the address, replaced (a pill change is never a Back step).
  useEffect(() => {
    const next = new URLSearchParams();
    if (shownSection !== "checks") next.set("section", shownSection);
    if (shownSection === "checks" && bucket !== "todo") next.set("view", bucket);
    if (shownSection === "checks" && mine) next.set("who", "mine");
    if (shownSection === "checks" && lateOnly) next.set("late", "1");
    const target = `${location}${next.toString() ? `?${next}` : ""}`;
    if (`${location}${search ? `?${search}` : ""}` !== target) setLocation(target, { replace: true });
  }, [bucket, mine, lateOnly, shownSection]);

  // One line per transaction, its parties inside it; a pill, Late, Mine and the
  // search pick transactions, and each line shows every party.
  const transactions = useMemo(() => groupAmlByTransaction(data?.rows || []), [data]);
  const inLetter = (t: AmlTransactionRow) => !letter || indexLetter(t.lead) === letter;
  const searchedTx = useMemo(() => transactions.filter(t => (!mine || t.mine) && (!lateOnly || t.late) && transactionMatches(t, query)), [transactions, mine, lateOnly, query]);
  const scoped = useMemo(() => searchedTx.filter(inLetter), [searchedTx, letter]);
  const counts = useMemo(() => transactionBucketCounts(scoped), [scoped]);
  const lateCount = useMemo(() => transactions.filter(t => t.late && (!mine || t.mine) && transactionMatches(t, query) && inLetter(t)).length, [transactions, mine, query, letter]);
  // The letters with something under them on this pill, before a letter is picked.
  const letters = useMemo(() => letterCounts(searchedTx.filter(t => t.buckets.includes(bucket)).map(t => t.lead)), [searchedTx, bucket]);
  // Late first: past the point the policy needs the checks by; then the most red flags, then the longest still.
  // Under a letter, A to Z by what the transaction is known by.
  const stalest = (t: AmlTransactionRow) => Math.max(-1, ...t.parties.map(p => p.movedDays ?? -1));
  const shown = useMemo(() => scoped.filter(t => t.buckets.includes(bucket))
    .sort((a, b) => letter ? byName(a.lead, b.lead) : (Number(b.late) - Number(a.late)) || (b.redFlags - a.redFlags) || (stalest(b) - stalest(a))), [scoped, bucket, letter]);

  // The top folds once the table is scrolled, so the rows get the screen and
  // the title and pills stay (Woody, 22 November 2026: "the top of the pages
  // shrink and the table is larger when start scrolling but keep the main
  // headings"). The Investment Tracker's pattern; never on a phone, where the
  // whole page scrolls.
  const [folded, setFolded] = useState(false);
  const [pageEl, setPageEl] = useState<HTMLDivElement | null>(null);
  const foldedAtRef = useRef(0);
  const lastTopRef = useRef(0);
  useEffect(() => {
    const page = pageEl;
    if (!page || isMobile) return;
    // Folding makes the table taller, which can pull a short list back to its
    // top: that is not the person scrolling up, so it is ignored for a moment.
    const settled = () => Date.now() - foldedAtRef.current > 400;
    const onScroll = (e: Event) => {
      const table = e.target instanceof HTMLElement && e.target.classList.contains("table-scroll-container") ? e.target : null;
      if (!table) return;
      const cameUp = lastTopRef.current > 0;
      lastTopRef.current = table.scrollTop;
      if (table.scrollTop > 48) setFolded(was => { if (!was) foldedAtRef.current = Date.now(); return true; });
      else if (table.scrollTop <= 0 && cameUp && settled()) setFolded(false);
    };
    const onWheel = (e: WheelEvent) => {
      const table = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(".table-scroll-container") : null;
      if (table && e.deltaY < 0 && table.scrollTop <= 0 && settled()) setFolded(false);
    };
    page.addEventListener("scroll", onScroll, { capture: true, passive: true });
    page.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      page.removeEventListener("scroll", onScroll, { capture: true });
      page.removeEventListener("wheel", onWheel);
    };
  }, [pageEl, isMobile]);
  // A fold belongs to the table that was scrolled: changing view opens the top again.
  useEffect(() => { setFolded(false); lastTopRef.current = 0; }, [shownSection]);
  const foldedTop = folded && !isMobile && startsHere;
  // The table measures the room below it on a window resize: folding moves its
  // top without one, so ask it to measure again once the fold has drawn.
  useEffect(() => {
    const id = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    return () => cancelAnimationFrame(id);
  }, [foldedTop]);

  return (
    <div ref={setPageEl} className={`${foldedTop ? "px-4 md:px-6 py-2 space-y-2" : "p-4 md:p-6 space-y-3"} max-w-[1400px]`} data-testid="aml-dashboard" data-folded={foldedTop ? "true" : "false"}>
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${foldedTop ? "" : "border-b pb-2"}`} data-testid="aml-sections">
        <h1 className={`${foldedTop ? "text-lg" : "text-xl"} font-semibold whitespace-nowrap`}>AML checks</h1>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sections">
          {sections.map(x => (
            <Pill key={x.key} active={shownSection === x.key} onClick={() => setSection(x.key)} data-testid={`aml-section-${x.key}`}>{x.label}</Pill>
          ))}
        </div>
        <div className="md:ml-auto"><RaiseReportButton label="Report a concern" officer={!!roles?.isOfficer} testId="aml-raise-report" /></div>
      </div>

      {startsHere && !foldedTop && <AmlStartBar onTransaction={setStartTx} onCompany={() => { setAddCompany(true); setSection("companies"); }} />}

      {shownSection === "policy" && <AmlPolicyPanel />}

      {shownSection === "rules" && <AmlRulesBoard />}
      {shownSection === "updates" && <AmlDecisionsBoard />}
      {shownSection === "reports" && <AmlRegisterBoard />}
      {shownSection === "records" && <AmlRetentionBoard />}
      {shownSection === "training" && (roles?.managesTraining ? <AmlTrainingBoard /> : <AmlTrainingPanel userId="me" isOwn />)}
      {shownSection === "checks" && !foldedTop && <MyRegisterReports />}
      {shownSection === "emails" && <KycEmailsAdmin />}
      {shownSection === "companies" && <KycCompaniesView isAdmin={!!me?.isAdmin} startAdding={addCompany} />}

      {shownSection === "checks" && <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Where the checks stand">
          {AML_BUCKETS.map(b => (
            <Pill key={b.key} active={bucket === b.key} onClick={() => setBucket(b.key)} data-testid={`aml-pill-${b.key}`}>
              {b.label}<PillCount n={counts[b.key]} active={bucket === b.key} />
            </Pill>
          ))}
        </div>
        <div className="flex w-full flex-wrap items-center gap-1.5 md:ml-auto md:w-auto">
          <Pill active={!mine} onClick={() => setMine(false)} data-testid="aml-who-all">All</Pill>
          <Pill active={mine} onClick={() => setMine(true)} data-testid="aml-who-mine">Mine</Pill>
          <Pill active={lateOnly} onClick={() => setLateOnly(v => !v)} data-testid="aml-late-only">Late<PillCount n={lateCount} active={lateOnly} /></Pill>
          <div className="hidden md:block" data-testid="aml-view-toggle"><ViewToggle view={view} onToggle={chooseView} /></div>
          {/* Full width on a phone: at 56 it ran off the screen there. */}
          <div className="relative w-full sm:w-auto">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Party, transaction, status, property, agent" className="h-8 pl-7 w-full sm:w-64 text-sm" data-testid="aml-search" />
          </div>
        </div>
      </div>

      {!!data?.unchecked.length && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="aml-unchecked">
          <AlertCircle className="w-3.5 h-3.5" />Could not be read just now, so red flags may be missing: {data.unchecked.join(", ")}.
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Reading every live transaction's parties…</div>
      ) : error ? (
        <p className="text-sm text-destructive">The AML dashboard could not be read.</p>
      ) : (
      <WithLetterRail testId="aml-list" rail={<LetterRail counts={letters} active={letter} onPick={setLetter} testId="aml-letters" />}>
      {!shown.length ? (
        <p className="text-sm text-muted-foreground" data-testid="aml-empty">Nothing here{letter ? ` under ${letter}` : ""}{lateOnly ? " that is late" : ""}{mine ? " on your transactions" : ""}{query ? " for that search" : ""}.</p>
      ) : isMobile || view === "card" ? (
        <AmlCardGrid key={letter || "all"} items={shown} testId="aml-cards" render={t => <AmlTransactionCard key={t.key} t={t} bucket={bucket} onOpen={setOpen} />} />
      ) : (
        // A scroll bar above the table as well as below it, and the heading row
        // stays in view while the rows scroll under it (Woody, 2026-11-20:
        // "can you put a scroll bar at the top and fix the heading as scroll
        // down"): the rows scroll inside the box, which the sticky heading needs.
        <div className="rounded-lg border overflow-hidden" data-testid="aml-table-box">
          <ScrollableTable minWidth={1120} topScrollbar>
          <table className="w-full text-sm" data-testid="aml-table">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2">Transaction</th>
                <th className="text-left font-medium px-3 py-2">Transaction status</th>
                <th className="text-left font-medium px-3 py-2">Party</th>
                <th className="text-left font-medium px-3 py-2">AML stage</th>
                <th className="text-left font-medium px-3 py-2">Due diligence and red flags</th>
                <th className="text-left font-medium px-3 py-2">Waiting on</th>
                <th className="text-right font-medium px-3 py-2">Last moved</th>
                <th className="text-left font-medium px-3 py-2">Agents</th>
              </tr>
            </thead>
            {shown.map(t => <TransactionRows key={t.key} t={t} bucket={bucket} onOpen={setOpen} />)}
          </table>
          </ScrollableTable>
        </div>
      )}
      </WithLetterRail>
      )}

      </>}

      {open && <PartyTrail row={open} onClose={() => setOpen(null)} officer={!!roles?.isOfficer} />}
      {startTx && (
        <Suspense fallback={null}>
          <NewTransactionDialog
            open
            onOpenChange={o => { if (!o) { setStartTx(null); queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] }); queryClient.invalidateQueries({ queryKey: [KYC_COMPANIES_KEY] }); } }}
            initialNote={startTx.note || null}
            initialHotsFile={startTx.file || null}
          />
        </Suspense>
      )}
    </div>
  );
}
