// The AML dashboard: every party on a live deal and where its checks stand
// (Woody, 18 November 2026: "a dashboard of all AML / KYC live and finished
// checks ... nice and easy"; step 6 of docs/deal-page-review-2026-11-18.md,
// a pill on Deals beside the deal list and the Letting Tracker). BGP staff
// only: the feed (server/aml-dashboard.ts) refuses anyone else, and the Deals
// hub offers the pill only to staff. The rules are shared/aml-dashboard.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { AlertCircle, ChevronDown, ExternalLink, Flag, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill, PillCount } from "@/components/ui/pill";
import { ScrollableTable } from "@/components/scrollable-table";
import { AML_STAGE_TONE, DealAmlStatusCard } from "@/components/deal-aml-status";
import { AmlFileButton } from "@/components/aml-file-button";
import { AmlPolicyPanel } from "@/components/aml-policy-panel";
import { AmlRegisterBoard, MyRegisterReports, RaiseReportButton } from "@/components/aml-register";
import { AmlTrainingBoard, AmlTrainingPanel } from "@/components/aml-training";
import { AmlRetentionBoard } from "@/components/aml-retention";
import { AmlRulesBoard } from "@/components/aml-rules";
import { AmlDecisionsBoard } from "@/components/aml-decisions";
import { KycEmailsAdmin } from "@/components/kyc-emails-admin";
import { KycCompaniesView } from "@/components/kyc-companies/companies-view";
import { FileThumbGrid } from "@/components/file-popout";
import { fetchPartyTrail, partyFilesForPreview, partyTrailKey, type PartyTrailDocument } from "@/components/aml-files";
import { useIsMobile } from "@/hooks/use-mobile";
import { AML_BUCKETS, AML_STAGE_LABEL, amlDealStatusWords, bucketCounts, rowMatches, type AmlBucket, type AmlDashboardRow } from "@shared/aml-dashboard";
import { DEAL_PARTY_LABEL, isDealPartyRole } from "@shared/deal-parties";
import { DEAL_STATUS_COLORS } from "@shared/deal-status";

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

function StageChip({ row }: { row: AmlDashboardRow }) {
  const label = row.stage === "expiring" && row.expiresAt ? `Expires ${day(row.expiresAt)}` : AML_STAGE_LABEL[row.stage];
  return (
    <span className="flex flex-col items-start gap-1">
      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${AML_STAGE_TONE[row.stage]}`} data-testid={`aml-stage-${row.key}`}>{label}</span>
      {/* Past the point BGP's policy (Issue 4) needs the checks by, and not decided. */}
      {row.late && <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 whitespace-nowrap dark:bg-red-950/40 dark:text-red-200" title={`Needed ${row.deadline}`} data-testid={`aml-late-${row.key}`}>Late</span>}
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
function DiligenceCell({ row, onOpen }: { row: AmlDashboardRow; onOpen: (row: AmlDashboardRow) => void }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <LevelCell row={row} />
      {row.redFlags.length > 0 && <Flags row={row} onOpen={onOpen} />}
    </div>
  );
}

// Every agent on the transaction, one to a line (Woody, 23 November 2026:
// "dont let the agents responsible leak off the page they should be listed").
function AgentsCell({ row }: { row: AmlDashboardRow }) {
  if (!row.agents.length) return <span>—</span>;
  return (
    <ul className="space-y-0.5" data-testid={`aml-agents-${row.key}`}>
      {row.agents.map(a => <li key={a} className="whitespace-nowrap">{a}</li>)}
    </ul>
  );
}

function PartyCell({ row }: { row: AmlDashboardRow }) {
  return (
    <div className="min-w-0">
      <div className="font-medium truncate">{row.brandName}</div>
      <div className="text-[11px] text-muted-foreground truncate">
        {roleWords(row.role)}{row.signsAs ? <> · signs as {row.signsAs}</> : null}
      </div>
    </div>
  );
}

function DealCell({ row }: { row: AmlDashboardRow }) {
  return (
    <div className="min-w-0">
      <div className="truncate">{row.dealRef != null ? <span className="font-mono text-muted-foreground mr-1">#{row.dealRef}</span> : null}{row.dealName}</div>
      {row.propertyName && <div className="text-[11px] text-muted-foreground truncate">{row.propertyName}</div>}
    </div>
  );
}

// The transaction's own status (Woody, 23 November 2026), in the Transactions
// board's words and colours.
function DealStatusChip({ row }: { row: AmlDashboardRow }) {
  const { code, words } = amlDealStatusWords(row);
  if (!words) return <span className="text-muted-foreground">—</span>;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${code ? DEAL_STATUS_COLORS[code] : "bg-muted text-muted-foreground"}`} data-testid={`aml-deal-status-${row.key}`}>{words}</span>;
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
  const [open, setOpen] = useState<AmlDashboardRow | null>(null);
  const { data, isLoading, error } = useQuery<Feed>({ queryKey: ["/api/aml-dashboard"], enabled: section === "checks" });
  const { data: roles } = useQuery<PolicyRoles>({ queryKey: ["/api/aml-policy"] });
  const { data: me } = useQuery<{ isAdmin?: boolean } | null>({ queryKey: ["/api/auth/me"] });
  const sections = SECTIONS.filter(x => (!x.officer || roles?.isOfficer) && (!x.admin || me?.isAdmin));
  const shownSection: Section = sections.some(x => x.key === section) ? section : "checks";

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

  const scoped = useMemo(() => (data?.rows || []).filter(r => (!mine || r.mine) && (!lateOnly || r.late) && rowMatches(r, query)), [data, mine, lateOnly, query]);
  const counts = useMemo(() => bucketCounts(scoped), [scoped]);
  const lateCount = useMemo(() => (data?.rows || []).filter(r => r.late && (!mine || r.mine) && rowMatches(r, query)).length, [data, mine, query]);
  // Late first: past the point the policy needs the checks by.
  const shown = useMemo(() => scoped.filter(r => r.bucket === bucket)
    .sort((a, b) => (Number(b.late) - Number(a.late)) || (b.redFlags.length - a.redFlags.length) || ((b.movedDays ?? -1) - (a.movedDays ?? -1))), [scoped, bucket]);

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
  const foldedTop = folded && !isMobile && shownSection === "checks";
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

      {shownSection === "policy" && <AmlPolicyPanel />}

      {shownSection === "rules" && <AmlRulesBoard />}
      {shownSection === "updates" && <AmlDecisionsBoard />}
      {shownSection === "reports" && <AmlRegisterBoard />}
      {shownSection === "records" && <AmlRetentionBoard />}
      {shownSection === "training" && (roles?.managesTraining ? <AmlTrainingBoard /> : <AmlTrainingPanel userId="me" isOwn />)}
      {shownSection === "checks" && !foldedTop && <MyRegisterReports />}
      {shownSection === "emails" && <KycEmailsAdmin />}
      {shownSection === "companies" && <KycCompaniesView isAdmin={!!me?.isAdmin} />}

      {shownSection === "checks" && <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Where the checks stand">
          {AML_BUCKETS.map(b => (
            <Pill key={b.key} active={bucket === b.key} onClick={() => setBucket(b.key)} data-testid={`aml-pill-${b.key}`}>
              {b.label}<PillCount n={counts[b.key]} active={bucket === b.key} />
            </Pill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 md:ml-auto">
          <Pill active={!mine} onClick={() => setMine(false)} data-testid="aml-who-all">All</Pill>
          <Pill active={mine} onClick={() => setMine(true)} data-testid="aml-who-mine">Mine</Pill>
          <Pill active={lateOnly} onClick={() => setLateOnly(v => !v)} data-testid="aml-late-only">Late<PillCount n={lateCount} active={lateOnly} /></Pill>
          {/* Full width on a phone: at 56 it ran off the screen there. */}
          <div className="relative w-full sm:w-auto">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Party, transaction, status, property, agent" className="h-8 pl-7 w-full sm:w-56 text-sm" data-testid="aml-search" />
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
      ) : !shown.length ? (
        <p className="text-sm text-muted-foreground" data-testid="aml-empty">Nothing here{lateOnly ? " that is late" : ""}{mine ? " on your transactions" : ""}{query ? " for that search" : ""}.</p>
      ) : isMobile ? (
        <ul className="space-y-2" data-testid="aml-cards">
          {shown.map(r => (
            <li key={r.key}>
              <button type="button" onClick={() => setOpen(r)} className="w-full text-left rounded-lg border bg-card p-3 space-y-1.5" data-testid={`aml-row-${r.key}`}>
                <div className="flex items-start justify-between gap-2"><PartyCell row={r} /><StageChip row={r} /></div>
                <div className="flex items-start justify-between gap-2 text-xs"><DealCell row={r} /><DealStatusChip row={r} /></div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <LevelCell row={r} />
                  <span><span className="text-muted-foreground">Waiting on</span> {r.waitingOn}</span>
                  <span className="text-muted-foreground">{moved(r.movedDays)}</span>
                </div>
                {r.redFlags.length > 0 && <div className="text-xs"><Flags row={r} /></div>}
              </button>
            </li>
          ))}
        </ul>
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
                <th className="text-left font-medium px-3 py-2">Party</th>
                <th className="text-left font-medium px-3 py-2">Transaction</th>
                <th className="text-left font-medium px-3 py-2">Transaction status</th>
                <th className="text-left font-medium px-3 py-2">AML stage</th>
                <th className="text-left font-medium px-3 py-2">Due diligence and red flags</th>
                <th className="text-left font-medium px-3 py-2">Waiting on</th>
                <th className="text-right font-medium px-3 py-2">Last moved</th>
                <th className="text-left font-medium px-3 py-2">Agents</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map(r => (
                <tr key={r.key} onClick={() => setOpen(r)} className="cursor-pointer hover:bg-muted/40" data-testid={`aml-row-${r.key}`}>
                  {/* Narrower below 1536px so every column, the agents included, fits a laptop screen from 1280px (Woody, 23 November 2026). */}
                  <td className="px-3 py-2 max-w-[170px] 2xl:max-w-[230px]"><PartyCell row={r} /></td>
                  <td className="px-3 py-2 max-w-[190px] 2xl:max-w-[260px]"><DealCell row={r} /></td>
                  <td className="px-3 py-2"><DealStatusChip row={r} /></td>
                  <td className="px-3 py-2"><StageChip row={r} /></td>
                  <td className="px-3 py-2 max-w-[240px]"><DiligenceCell row={r} onOpen={setOpen} /></td>
                  <td className="px-3 py-2 min-w-[120px] max-w-[200px]">{r.waitingOn}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{moved(r.movedDays)}</td>
                  <td className="px-3 py-2 text-muted-foreground"><AgentsCell row={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </ScrollableTable>
        </div>
      )}

      </>}

      {open && <PartyTrail row={open} onClose={() => setOpen(null)} officer={!!roles?.isOfficer} />}
    </div>
  );
}
