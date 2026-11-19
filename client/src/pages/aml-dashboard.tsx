// The AML dashboard: every party on a live deal and where its checks stand
// (Woody, 18 November 2026: "a dashboard of all AML / KYC live and finished
// checks ... nice and easy"; step 6 of docs/deal-page-review-2026-11-18.md,
// a pill on Deals beside the deal list and the Letting Tracker). BGP staff
// only: the feed (server/aml-dashboard.ts) refuses anyone else, and the Deals
// hub offers the pill only to staff. The rules are shared/aml-dashboard.ts.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { AlertCircle, ExternalLink, FileText, Flag, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill, PillCount } from "@/components/ui/pill";
import { DealAmlStatusCard } from "@/components/deal-aml-status";
import { useIsMobile } from "@/hooks/use-mobile";
import { getAuthHeaders } from "@/lib/queryClient";
import { AML_BUCKETS, AML_STAGE_LABEL, bucketCounts, rowMatches, type AmlBucket, type AmlDashboardRow, type AmlStage } from "@shared/aml-dashboard";
import { DEAL_PARTY_LABEL, isDealPartyRole } from "@shared/deal-parties";
import { legacyToCode } from "@shared/deal-status";

interface Feed { rows: AmlDashboardRow[]; unchecked: string[] }
interface Trail {
  documents: Array<{ id: string; type: string; name: string; url: string; at: string | null; note: string | null; onCompany: boolean }>;
  history: Array<{ at: string | null; who: string | null; what: string; detail: string | null }>;
}

const STAGE_TONE: Record<AmlStage, string> = {
  not_started: "bg-muted text-muted-foreground",
  bgp_checked: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  client_sent: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  client_finished: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200",
  with_kyc4u: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  expiring: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  expired: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

const roleWords = (role: string) => (isDealPartyRole(role) ? DEAL_PARTY_LABEL[role] : role);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "");
const moved = (n: number | null) => (n === null ? "—" : n === 0 ? "Today" : n === 1 ? "1 day" : `${n} days`);
const isBucket = (v: string | null): v is AmlBucket => !!v && AML_BUCKETS.some(b => b.key === v);

function StageChip({ row }: { row: AmlDashboardRow }) {
  const label = row.stage === "expiring" && row.expiresAt ? `Expires ${day(row.expiresAt)}` : AML_STAGE_LABEL[row.stage];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${STAGE_TONE[row.stage]}`} data-testid={`aml-stage-${row.key}`}>{label}</span>;
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

function PartyTrail({ row, onClose }: { row: AmlDashboardRow; onClose: () => void }) {
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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="aml-trail">
        <DialogHeader>
          <DialogTitle>{row.signsAs || row.brandName}</DialogTitle>
          <DialogDescription>
            {roleWords(row.role)} on {row.dealName}{row.signsAs ? ` (${row.brandName})` : ""}.{" "}
            <Link href={`/deals/${row.dealId}`} className="text-primary hover:underline inline-flex items-center gap-1" data-testid="aml-trail-open-deal">Open the deal <ExternalLink className="w-3 h-3" /></Link>
          </DialogDescription>
        </DialogHeader>
        <DealAmlStatusCard dealId={row.dealId} dealStatus={row.dealStatus} />
        <section className="space-y-1.5">
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">Documents on its KYC record</h3>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : !trail?.documents.length ? (
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
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">History</h3>
          {isLoading ? null : !trail?.history.length ? (
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
  const [mine, setMine] = useState(params.get("who") === "mine");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<AmlDashboardRow | null>(null);
  const { data, isLoading, error } = useQuery<Feed>({ queryKey: ["/api/aml-dashboard"] });

  // The view in the address, replaced (a pill change is never a Back step).
  useEffect(() => {
    const next = new URLSearchParams();
    if (bucket !== "todo") next.set("view", bucket);
    if (mine) next.set("who", "mine");
    const target = `${location}${next.toString() ? `?${next}` : ""}`;
    if (`${location}${search ? `?${search}` : ""}` !== target) setLocation(target, { replace: true });
  }, [bucket, mine]);

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
                  <span><span className="text-muted-foreground">Waiting on</span> {r.waitingOn}</span>
                  <span className="text-muted-foreground">{moved(r.movedDays)}</span>
                </div>
                {r.redFlags.length > 0 && <div className="text-xs"><Flags row={r} /></div>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm" data-testid="aml-table">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2">Party</th>
                <th className="text-left font-medium px-3 py-2">Deal</th>
                <th className="text-left font-medium px-3 py-2">Stage</th>
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
                  <td className="px-3 py-2 max-w-[220px] truncate"><Flags row={r} /></td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.waitingOn}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{moved(r.movedDays)}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground">{r.agents.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && <PartyTrail row={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
