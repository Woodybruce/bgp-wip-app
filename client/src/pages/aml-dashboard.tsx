// The AML dashboard: every party on a live deal and where its checks stand
// (Woody, 18 November 2026: "a dashboard of all AML / KYC live and finished
// checks ... nice and easy"; step 6 of docs/deal-page-review-2026-11-18.md,
// a pill on Deals beside the deal list and the Letting Tracker). BGP staff
// only: the feed (server/aml-dashboard.ts) refuses anyone else, and the Deals
// hub offers the pill only to staff. The rules are shared/aml-dashboard.ts.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { AlertCircle, ChevronDown, ExternalLink, FileText, Flag, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
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
import { KycEmailsAdmin } from "@/components/kyc-emails-admin";
import { useIsMobile } from "@/hooks/use-mobile";
import { getAuthHeaders } from "@/lib/queryClient";
import { AML_BUCKETS, AML_STAGE_LABEL, amlNeedsKyc4u, bucketCounts, rowMatches, type AmlBucket, type AmlDashboardRow } from "@shared/aml-dashboard";
import { DEAL_PARTY_LABEL, isDealPartyRole } from "@shared/deal-parties";
import { legacyToCode } from "@shared/deal-status";

interface Feed { rows: AmlDashboardRow[]; unchecked: string[] }
interface Trail {
  documents: Array<{ id: string; type: string; name: string; url: string; at: string | null; note: string | null; onCompany: boolean }>;
  history: Array<{ at: string | null; who: string | null; what: string; detail: string | null }>;
}

// The level of due diligence BGP's AML policy gives the party.
const LEVEL_WORDS: Record<AmlDashboardRow["level"], string> = { simplified: "Simplified", standard: "Standard", enhanced: "Enhanced" };
const LEVEL_TONE: Record<AmlDashboardRow["level"], string> = {
  simplified: "text-muted-foreground",
  standard: "text-foreground",
  enhanced: "text-red-700 dark:text-red-300 font-medium",
};
function LevelCell({ row, inHouseEdd = false }: { row: AmlDashboardRow; inHouseEdd?: boolean }) {
  // Marked Not required: no checks are needed, so no level applies.
  if (row.stage === "not_required") return <span className="text-muted-foreground" title={row.levelWhy.join("\n")} data-testid={`aml-level-${row.key}`}>—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`whitespace-nowrap ${LEVEL_TONE[row.level]}`} title={row.levelWhy.join("\n")} data-testid={`aml-level-${row.key}`}>{LEVEL_WORDS[row.level]}</span>
      {/* With the officers' in-house setting on, enhanced due diligence is BGP's own: no KYC4U mark (21 November 2026). */}
      {!inHouseEdd && amlNeedsKyc4u(row.level, row.stage, !!row.ownersAbroad?.length) && (
        <span className="whitespace-nowrap rounded border border-red-600 bg-red-50 px-1 text-[10px] font-semibold uppercase text-red-700 dark:bg-red-950/40 dark:text-red-300"
          title={row.level === "enhanced" ? "Enhanced: request the KYC4U check and submit it on KYC4U's portal" : `Owned through a company registered abroad (${(row.ownersAbroad || []).join("; ")}): request the KYC4U check and submit it on KYC4U's portal`}
          data-testid={`aml-kyc4u-needed-${row.key}`}>Not with KYC4U</span>
      )}
    </span>
  );
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
type Section = "checks" | "rules" | "reports" | "training" | "records" | "emails";
const SECTIONS: Array<{ key: Section; label: string; officer?: boolean; admin?: boolean }> = [
  { key: "checks", label: "Checks" },
  // HMRC's rules in short, checked against HMRC every three months (22 November 2026).
  { key: "rules", label: "Rules" },
  { key: "reports", label: "Reports", officer: true },
  { key: "training", label: "Training" },
  { key: "records", label: "Records", officer: true },
  { key: "emails", label: "Client check emails", admin: true },
];
const isSection = (v: string | null): v is Section => !!v && SECTIONS.some(x => x.key === v);
interface PolicyRoles { isOfficer?: boolean; managesTraining?: boolean; inHouseEdd?: { on: boolean } }

function StageChip({ row }: { row: AmlDashboardRow }) {
  const label = row.stage === "expiring" && row.expiresAt ? `Expires ${day(row.expiresAt)}` : AML_STAGE_LABEL[row.stage];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${AML_STAGE_TONE[row.stage]}`} data-testid={`aml-stage-${row.key}`}>{label}</span>;
}

function Flags({ row }: { row: AmlDashboardRow }) {
  if (!row.redFlags.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-300" title={row.redFlags.join("\n")} data-testid={`aml-flags-${row.key}`}>
      <Flag className="w-3.5 h-3.5 shrink-0" />{row.redFlags.length === 1 ? row.redFlags[0] : `${row.redFlags.length} red flags`}
    </span>
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
      <div className="text-[11px] text-muted-foreground truncate">{[legacyToCode(row.dealStatus || "") || row.dealStatus, row.propertyName].filter(Boolean).join(" · ")}</div>
    </div>
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
    queryKey: ["/api/aml-dashboard/party", row.dealId, row.role],
    queryFn: async () => {
      const res = await fetch(`/api/aml-dashboard/party?dealId=${encodeURIComponent(row.dealId)}&role=${encodeURIComponent(row.role)}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("The party's trail could not be read");
      return res.json();
    },
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="aml-trail">
        <DialogHeader>
          <DialogTitle>{row.signsAs || row.brandName}</DialogTitle>
          <DialogDescription>
            {roleWords(row.role)} on {row.dealName}{row.signsAs ? ` (${row.brandName})` : ""}.{" "}
            <Link href={`/deals/${row.dealId}`} className="text-primary hover:underline inline-flex items-center gap-1" data-testid="aml-trail-open-deal">Open the deal <ExternalLink className="w-3 h-3" /></Link>
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
            <ul className="divide-y rounded-md border" data-testid="aml-trail-documents">
              {trail.documents.map(d => (
                <li key={d.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                  <FileText className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="hover:underline break-words">{d.name}</a>
                    <div className="text-[11px] text-muted-foreground break-words">{[day(d.at), d.type.replace(/_/g, " "), d.onCompany ? "the company that signs" : null, d.note].filter(Boolean).join(" · ")}</div>
                  </div>
                </li>
              ))}
            </ul>
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
    const target = `${location}${next.toString() ? `?${next}` : ""}`;
    if (`${location}${search ? `?${search}` : ""}` !== target) setLocation(target, { replace: true });
  }, [bucket, mine, shownSection]);

  const scoped = useMemo(() => (data?.rows || []).filter(r => (!mine || r.mine) && rowMatches(r, query)), [data, mine, query]);
  const counts = useMemo(() => bucketCounts(scoped), [scoped]);
  const shown = useMemo(() => scoped.filter(r => r.bucket === bucket)
    .sort((a, b) => (b.redFlags.length - a.redFlags.length) || ((b.movedDays ?? -1) - (a.movedDays ?? -1))), [scoped, bucket]);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px]" data-testid="aml-dashboard">
      <div>
        <h1 className="text-xl font-semibold">AML checks</h1>
        <p className="text-sm text-muted-foreground">Every party on a live deal: BGP's checks, the client checks, KYC4U and approvals. A party is To do once HMRC expects its checks: a landlord or seller on any live deal, a tenant or buyer from Heads of Terms.</p>
      </div>

      <AmlPolicyPanel />

      <div className="flex flex-wrap items-center gap-2 border-b pb-2" data-testid="aml-sections">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sections">
          {sections.map(x => (
            <Pill key={x.key} active={shownSection === x.key} onClick={() => setSection(x.key)} data-testid={`aml-section-${x.key}`}>{x.label}</Pill>
          ))}
        </div>
        <div className="md:ml-auto"><RaiseReportButton label="Report to the Nominated Officer" officer={!!roles?.isOfficer} testId="aml-raise-report" /></div>
      </div>

      {shownSection === "rules" && <AmlRulesBoard />}
      {shownSection === "reports" && <AmlRegisterBoard />}
      {shownSection === "records" && <AmlRetentionBoard />}
      {shownSection === "training" && (roles?.managesTraining ? <AmlTrainingBoard /> : <AmlTrainingPanel userId="me" isOwn />)}
      {shownSection === "checks" && <MyRegisterReports />}
      {shownSection === "emails" && <KycEmailsAdmin />}

      {shownSection === "checks" && <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Where the checks stand">
          {AML_BUCKETS.map(b => (
            <Pill key={b.key} active={bucket === b.key} onClick={() => setBucket(b.key)} data-testid={`aml-pill-${b.key}`}>
              {b.label}<PillCount n={counts[b.key]} active={bucket === b.key} />
            </Pill>
          ))}
        </div>
        <div className="flex items-center gap-1.5 md:ml-auto">
          <Pill active={!mine} onClick={() => setMine(false)} data-testid="aml-who-all">All</Pill>
          <Pill active={mine} onClick={() => setMine(true)} data-testid="aml-who-mine">Mine</Pill>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Party, deal, property, agent" className="h-8 pl-7 w-56 text-sm" data-testid="aml-search" />
          </div>
        </div>
      </div>

      {!!data?.unchecked.length && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="aml-unchecked">
          <AlertCircle className="w-3.5 h-3.5" />Could not be read just now, so red flags may be missing: {data.unchecked.join(", ")}.
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Reading every live deal's parties…</div>
      ) : error ? (
        <p className="text-sm text-destructive">The AML dashboard could not be read.</p>
      ) : !shown.length ? (
        <p className="text-sm text-muted-foreground" data-testid="aml-empty">Nothing here{mine ? " on your deals" : ""}{query ? " for that search" : ""}.</p>
      ) : isMobile ? (
        <ul className="space-y-2" data-testid="aml-cards">
          {shown.map(r => (
            <li key={r.key}>
              <button type="button" onClick={() => setOpen(r)} className="w-full text-left rounded-lg border bg-card p-3 space-y-1.5" data-testid={`aml-row-${r.key}`}>
                <div className="flex items-start justify-between gap-2"><PartyCell row={r} /><StageChip row={r} /></div>
                <div className="text-xs"><DealCell row={r} /></div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <LevelCell row={r} inHouseEdd={!!roles?.inHouseEdd?.on} />
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
          <ScrollableTable minWidth={1180} topScrollbar>
          <table className="w-full text-sm" data-testid="aml-table">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2">Party</th>
                <th className="text-left font-medium px-3 py-2">Deal</th>
                <th className="text-left font-medium px-3 py-2">Stage</th>
                <th className="text-left font-medium px-3 py-2">Due diligence</th>
                <th className="text-left font-medium px-3 py-2">Red flags</th>
                <th className="text-left font-medium px-3 py-2">Waiting on</th>
                <th className="text-right font-medium px-3 py-2">Last moved</th>
                <th className="text-left font-medium px-3 py-2">Agents</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map(r => (
                <tr key={r.key} onClick={() => setOpen(r)} className="cursor-pointer hover:bg-muted/40" data-testid={`aml-row-${r.key}`}>
                  <td className="px-3 py-2 max-w-[260px]"><PartyCell row={r} /></td>
                  <td className="px-3 py-2 max-w-[300px]"><DealCell row={r} /></td>
                  <td className="px-3 py-2"><StageChip row={r} /></td>
                  <td className="px-3 py-2"><LevelCell row={r} inHouseEdd={!!roles?.inHouseEdd?.on} /></td>
                  <td className="px-3 py-2 max-w-[220px] truncate"><Flags row={r} /></td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.waitingOn}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{moved(r.movedDays)}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground">{r.agents.join(", ") || "—"}</td>
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
