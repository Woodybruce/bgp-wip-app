// The Landsec schemes as cards, in one place
// (docs/landsec-menu-plan-2026-11-12.md, part 3): the 14 schemes in their four
// groups, one card per scheme with its units, vacancy, occupancy, the live
// lettings by stage, passing rent and the longest a deal in negotiation has
// been at its stage. The Properties page (the "Schemes" view for a Landsec
// viewer) and the older Landsec home both draw them from here, with the stage
// pills, the duplicate-record merge and the BGP-only "Landsec admin" block.
//
// The figures come from GET /api/landsec/home, which counts once
// (server/landsec-counts.ts) and is already cut to the schemes the viewer can
// see. Nothing here counts for itself.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Building2, ChevronRight, Clock, Merge } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PillCount, pillInactive, pillMetrics } from "@/components/ui/pill";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DEAL_STATUS_LABELS } from "@shared/deal-status";
import { LANDSEC_STUCK_DAYS } from "@shared/landsec";
import { LandsecAccessPanel } from "@/components/landsec-access-panel";
import { rowPill } from "@/components/landsec/deal-clock";

export type LandsecStage = "AVA" | "NEG" | "HOT" | "SOL";
export const LANDSEC_STAGE_LIST: { code: LandsecStage; label: string; short: string }[] = [
  { code: "AVA", label: "Marketing", short: "Mkt" },
  { code: "NEG", label: "Negotiating", short: "Neg" },
  { code: "HOT", label: "HOTs", short: "HOTs" },
  { code: "SOL", label: "Solicitors", short: "Sols" },
];

export interface LandsecSchemeRecord { id: string; name: string; units: number; deals: number; files: number }
export interface LandsecHomeScheme {
  key: string; name: string; town: string; group: string;
  propertyId: string | null; recordCount: number;
  units: number; vacant: number; passingRent: number; rentUnits: number;
  pipeline: { tracker: Record<LandsecStage, number>; liveLettings: number; liveDeals: number; stuck: number; oldestLiveDays: number | null };
  // BGP staff only.
  records?: LandsecSchemeRecord[];
  trackerCheck?: { differ: boolean; trackerRows: number; rowsWithoutLetting: number; lettingsWithoutRow: number };
}
export interface LandsecOutsideSchemes {
  properties: { id: string; name: string; units: number; deals: number; liveDeals: number; trackerRows: number }[];
  deals: {
    id: string; ref: number | null; name: string | null; dealType: string | null; status: string | null; live: boolean;
    propertyId: string | null; propertyName: string | null; via: "property" | "company";
  }[];
  counts: { properties: number; deals: number; liveDeals: number; onOutsideProperties: number; byCompanyLink: number; listed: number; trackerRows: number };
}
export interface LandsecHomeData {
  companyId: string;
  groups: { group: string; schemes: LandsecHomeScheme[] }[];
  // The caller's Landsec role, as the server resolved it.
  viewer?: { role: string; restricted: boolean };
  totals: { units: number; vacant: number; liveLettings: number; liveDeals: number; stuck: number; tracker: Record<LandsecStage, number>; withRecord: number };
  // BGP staff only: absent for every client login.
  outOfScope?: { id: string; name: string; units: number; deals: number }[];
  outsideSchemes?: LandsecOutsideSchemes | null;
  trackerCheck?: { differ: boolean; trackerRows: number; liveLettings: number; rowsWithoutLetting: number; lettingsWithoutRow: number; report: string };
}

export const LANDSEC_HOME_KEY = ["/api/landsec/home"] as const;

// The server sends the staff fields to BGP staff only, so their presence is
// the test: a client login never has them, whatever the screen thinks.
export const landsecHomeIsStaff = (data: LandsecHomeData | undefined) => !!data && data.outOfScope !== undefined;

export const landsecSchemeCount = (data: LandsecHomeData | undefined) => data?.groups.reduce((n, g) => n + g.schemes.length, 0) ?? 0;

const num = (n: number) => n.toLocaleString("en-GB");

// The header line: schemes, units, vacant, live lettings.
export function landsecTotalsLine(data: LandsecHomeData): string {
  const schemes = landsecSchemeCount(data);
  return `${schemes} scheme${schemes === 1 ? "" : "s"} · ${num(data.totals.units)} units · ${num(data.totals.vacant)} vacant · ${num(data.totals.liveLettings)} live letting${data.totals.liveLettings === 1 ? "" : "s"}`;
}

// The four live stages as pills, each a link. They are the page's stats: the
// same counts as the scheme cards, added up. Where hrefFor gives null the
// pill is a plain count: an asset manager has no tracker or Deals page to
// open, so theirs are not links.
export function LandsecStagePills({ tracker, hrefFor, titleFor, stuck, stuckHref, testId = "landsec-stage-pills" }: {
  tracker: Record<LandsecStage, number>;
  hrefFor: (code: LandsecStage) => string | null;
  titleFor?: (label: string) => string;
  // The stuck count and where it opens. Left out, no Stuck pill is drawn.
  stuck?: number; stuckHref?: string;
  testId?: string;
}) {
  const link = cn(pillMetrics, pillInactive, "bg-card");
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid={testId}>
      {LANDSEC_STAGE_LIST.map(s => {
        // A stage with nothing at it is a plain count: Deals drops an empty
        // stage filter and would list every deal.
        const href = (tracker[s.code] ?? 0) > 0 ? hrefFor(s.code) : null;
        const count = <>{s.label} <PillCount n={tracker[s.code] ?? 0} /></>;
        const title = titleFor ? titleFor(s.label) : s.label;
        return href
          ? <Link key={s.code} href={href} className={link} title={title} data-no-min-touch data-testid={`${testId}-${s.code.toLowerCase()}`}>{count}</Link>
          : <span key={s.code} className={cn(pillMetrics, "border border-border text-muted-foreground")} title={title} data-testid={`${testId}-${s.code.toLowerCase()}`}>{count}</span>;
      })}
      {stuckHref && stuck !== undefined && (stuck > 0
        ? <Link href={stuckHref} className={link} title={`Deals in negotiation, HOTs or solicitors at the same stage for ${LANDSEC_STUCK_DAYS} days or more`} data-no-min-touch data-testid={`${testId}-stuck`}>
          Stuck {LANDSEC_STUCK_DAYS}d+ <PillCount n={stuck} />
        </Link>
        : <span className={cn(pillMetrics, "border border-border text-muted-foreground")} title="No deal has been at the same stage for that long" data-testid={`${testId}-stuck`}>
          Stuck {LANDSEC_STUCK_DAYS}d+ <PillCount n={0} />
        </span>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-1 py-1 min-w-0">
      <p className="text-sm font-bold font-mono tabular-nums leading-tight">{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">{label}</p>
    </div>
  );
}

// One scheme. With an href the whole card opens it; a scheme with no property
// record yet is drawn as a card that goes nowhere.
export function SchemeCard({ scheme, href, isStaff, isAdmin, onMerge }: {
  scheme: LandsecHomeScheme;
  href: string | null;
  isStaff?: boolean; isAdmin?: boolean;
  // Given, an admin gets the merge button on the card. Left out, staff see
  // only how many records the scheme has (the merge is in the admin block).
  onMerge?: () => void;
}) {
  const hasRecord = !!scheme.propertyId;
  const occupied = scheme.units - scheme.vacant;
  const occupancy = scheme.units > 0 ? Math.round((occupied / scheme.units) * 100) : null;
  const body = (
    <CardContent className="p-3 flex flex-col gap-2 h-full">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold leading-tight truncate">{scheme.name}</p>
          <p className="text-xs text-muted-foreground truncate">{scheme.town}</p>
        </div>
        <Building2 className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
      </div>
      {hasRecord ? (
        <>
          <div className="grid grid-cols-3 gap-1 text-center">
            <Stat label="Units" value={num(scheme.units)} />
            <Stat label="Vacant" value={num(scheme.vacant)} />
            <Stat label="Occupancy" value={occupancy === null ? "—" : `${occupancy}%`} />
          </div>
          <div className="flex flex-wrap gap-1" data-testid={`landsec-scheme-stages-${scheme.key}`}>
            {LANDSEC_STAGE_LIST.map(s => {
              const n = scheme.pipeline.tracker[s.code] ?? 0;
              return (
                <span key={s.code} className={cn(rowPill, "gap-1 px-1.5", n > 0 ? "border-border text-foreground" : "border-transparent text-muted-foreground/70")} title={`${s.label}: ${n} live letting${n === 1 ? "" : "s"}`}>
                  {s.short} <span className="font-mono tabular-nums">{n}</span>
                </span>
              );
            })}
          </div>
          <div className="mt-auto flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate">
              {scheme.rentUnits > 0
                ? <><span className="font-mono tabular-nums">{formatCurrency(scheme.passingRent)}</span> pa on <span className="font-mono tabular-nums">{num(scheme.rentUnits)}</span> units</>
                : "No rents recorded"}
            </span>
            {scheme.pipeline.oldestLiveDays !== null && (
              <span
                className={cn("flex items-center gap-1 font-mono tabular-nums shrink-0", scheme.pipeline.oldestLiveDays >= LANDSEC_STUCK_DAYS && "font-semibold text-amber-700 dark:text-amber-400")}
                title="Longest a deal in negotiation, HOTs or solicitors has been at its stage, in days"
              >
                <Clock className="w-3 h-3" /> {scheme.pipeline.oldestLiveDays}d
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">No property record yet.</p>
      )}
    </CardContent>
  );

  const multi = !!isStaff && scheme.recordCount > 1;
  return (
    <Card
      className={cn("h-full relative transition-colors", href ? "hover:border-foreground/30" : "bg-muted/20")}
      data-testid={`landsec-scheme-${scheme.key}`}
      aria-disabled={href ? undefined : true}
    >
      {href ? <Link href={href} className="block h-full" data-testid={`landsec-scheme-link-${scheme.key}`}>{body}</Link> : body}
      {multi && (
        <div className="absolute top-2 right-8">
          {isAdmin && onMerge ? (
            <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={onMerge} data-testid={`landsec-merge-${scheme.key}`}>
              <Merge className="w-3 h-3 mr-1" /> {scheme.recordCount} records
            </Button>
          ) : (
            <span className={cn(rowPill, "border-border bg-card px-1.5 text-muted-foreground")} title="This scheme still has more than one property record">
              <span className="font-mono tabular-nums mr-1">{scheme.recordCount}</span> records
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

// The four groups (North, South, Outlets, London), a card per scheme.
export function SchemeGroups({ groups, hrefFor, isStaff, isAdmin, onMerge }: {
  groups: LandsecHomeData["groups"];
  hrefFor: (scheme: LandsecHomeScheme) => string | null;
  isStaff?: boolean; isAdmin?: boolean;
  onMerge?: (scheme: LandsecHomeScheme) => void;
}) {
  return (
    <>
      {groups.map(g => (
        <section key={g.group} className="space-y-2" data-testid={`landsec-group-${g.group.toLowerCase()}`}>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {g.group} <span className="font-mono tabular-nums font-normal">{g.schemes.length}</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {g.schemes.map(s => (
              <SchemeCard
                key={s.key} scheme={s} href={hrefFor(s)} isStaff={isStaff} isAdmin={isAdmin}
                onMerge={onMerge ? () => onMerge(s) : undefined}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

// Fold a scheme's duplicate records into one keeper. The keeper defaults to
// the record with the most units; every other record's deals, units, files
// and links move onto it and the duplicate row is removed.
export function MergeDialog({ scheme, onClose }: { scheme: LandsecHomeScheme; onClose: () => void }) {
  const { toast } = useToast();
  const records = scheme.records || [];
  const [keepId, setKeepId] = useState<string>(scheme.propertyId || records[0]?.id || "");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(records.filter(r => r.id !== (scheme.propertyId || records[0]?.id)).map(r => r.id)));

  const merge = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/landsec/schemes/${scheme.key}/merge`, { keepId, mergeIds: Array.from(selected) });
      return res.json();
    },
    onSuccess: (r: any) => {
      const failed = (r?.results || []).filter((x: any) => !x.ok);
      toast({
        title: failed.length ? `Merged with ${failed.length} failure(s)` : "Records merged",
        description: failed.length ? failed.map((f: any) => f.error).join("; ") : `${scheme.name} now has one record.`,
        variant: failed.length ? "destructive" : undefined,
      });
      queryClient.invalidateQueries({ queryKey: LANDSEC_HOME_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Merge failed", description: e?.message, variant: "destructive" }),
  });

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge {scheme.name} records</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Pick the record to keep; the ticked records' deals, units, files and links move onto it and the duplicates are removed. This cannot be undone.
        </p>
        <div className="space-y-1.5">
          {records.map(r => (
            <div key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm ${r.id === keepId ? "border-foreground" : "border-border"}`}>
              <label className="flex items-center gap-1.5 text-xs shrink-0">
                <input type="radio" name="keep" checked={r.id === keepId} onChange={() => { setKeepId(r.id); setSelected(prev => { const n = new Set(prev); n.delete(r.id); return n; }); }} />
                Keep
              </label>
              <label className="flex items-center gap-1.5 text-xs shrink-0">
                <input type="checkbox" disabled={r.id === keepId} checked={r.id !== keepId && selected.has(r.id)} onChange={() => toggle(r.id)} />
                Merge
              </label>
              <span className="truncate flex-1 min-w-[8rem]">{r.name}</span>
              <span className="text-xs text-muted-foreground font-mono tabular-nums shrink-0">{r.units} units · {r.deals} deals · {r.files} files</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!keepId || selected.size === 0 || merge.isPending} onClick={() => merge.mutate()} data-testid="landsec-merge-confirm">
            {merge.isPending ? "Merging…" : `Merge ${selected.size} into keeper`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const sectionLabel = "text-xs font-semibold uppercase tracking-wider text-muted-foreground";
const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const statusLabel = (code: string | null) => (code && (DEAL_STATUS_LABELS as Record<string, string>)[code]) || code || "—";

// What the 14-scheme rule would take out of the Landsec view: the property
// records and the deals that reach it today without sitting on a scheme
// property. A report. The rows are not links: staff in the Landsec view open
// those records from All Teams.
function OutsideSchemesReport({ data }: { data: LandsecHomeData }) {
  const [open, setOpen] = useState(false);
  const report = data.outsideSchemes;
  // The fuller report failed to load: fall back to the plain property list.
  const properties: { id: string; name: string; units: number; deals: number; liveDeals: number | null; trackerRows: number | null }[] =
    report?.properties ?? (data.outOfScope || []).map(p => ({ ...p, liveDeals: null, trackerRows: null }));
  const deals = report?.deals || [];
  const cell = (n: number | null) => (n === null ? "—" : num(n));
  const summary = report
    ? `${num(report.counts.properties)} property record${report.counts.properties === 1 ? "" : "s"} · ${num(report.counts.deals)} deal${report.counts.deals === 1 ? "" : "s"} (${num(report.counts.liveDeals)} live)`
    : `${num(properties.length)} property record${properties.length === 1 ? "" : "s"}`;

  return (
    <section className="space-y-2" data-testid="landsec-outside-schemes">
      <button
        type="button"
        className={cn(sectionLabel, "hover:text-foreground flex items-center gap-1 text-left")}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        data-testid="landsec-out-of-scope-toggle"
      >
        <ChevronRight className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        <span>Outside the 14 schemes <span className="font-mono tabular-nums font-normal normal-case">{summary}</span></span>
      </button>
      {open && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground max-w-3xl">
            Landsec-linked records that are not one of the 14 schemes. The property records are already hidden from the Landsec view.
            The deals {report ? <>(<span className="font-mono tabular-nums">{num(report.counts.onOutsideProperties)}</span> on those records, <span className="font-mono tabular-nums">{num(report.counts.byCompanyLink)}</span> that only name Landsec on the deal)</> : null} still show on Deals in the Landsec view
            {report && report.counts.trackerRows > 0 ? <>, and <span className="font-mono tabular-nums">{num(report.counts.trackerRows)}</span> Letting Tracker row{report.counts.trackerRows === 1 ? "" : "s"} on those records still show on the tracker</> : null}.
            Nothing has been removed. To open one of these, switch the team picker back to All Teams.
          </p>
          {report === null && <p className="text-xs text-muted-foreground" data-testid="landsec-outside-schemes-failed">The list of deals could not be loaded. The property records are below.</p>}

          {properties.length > 0 && (
            <>
              <div className="hidden md:block rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-sm" data-testid="landsec-outside-properties">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className={th}>Property record</th>
                      <th className={cn(th, "text-right")}>Units</th>
                      <th className={cn(th, "text-right")}>Deals</th>
                      <th className={cn(th, "text-right")}>Live deals</th>
                      <th className={cn(th, "text-right")}>Tracker rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {properties.map(p => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="px-3 py-1.5">{p.name}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{num(p.units)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{num(p.deals)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{cell(p.liveDeals)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{cell(p.trackerRows)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden space-y-1.5">
                {properties.map(p => (
                  <div key={p.id} className="rounded-2xl border border-border bg-card px-3 py-2">
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono tabular-nums">
                      {num(p.units)} units · {num(p.deals)} deals{p.liveDeals !== null ? ` · ${num(p.liveDeals)} live` : ""}{p.trackerRows ? ` · ${num(p.trackerRows)} tracker rows` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}

          {deals.length > 0 && (
            <>
              <p className={sectionLabel}>
                Deals <span className="font-mono tabular-nums font-normal normal-case">{num(report!.counts.listed)}{report!.counts.listed < report!.counts.deals ? ` of ${num(report!.counts.deals)}, live first` : ""}</span>
              </p>
              <div className="hidden md:block rounded-lg border border-border overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm" data-testid="landsec-outside-deals">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className={th}>Ref</th>
                      <th className={th}>Deal</th>
                      <th className={th}>Type</th>
                      <th className={th}>Status</th>
                      <th className={th}>Property</th>
                      <th className={th}>In the Landsec view because</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deals.map(d => (
                      <tr key={d.id} className="border-t border-border">
                        <td className="px-3 py-1.5 font-mono tabular-nums text-muted-foreground">{d.ref ? `#${d.ref}` : "—"}</td>
                        <td className="px-3 py-1.5">{d.name || "Untitled deal"}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{d.dealType || "—"}</td>
                        <td className="px-3 py-1.5">
                          <span className={cn(rowPill, d.live ? "border-border text-foreground" : "border-transparent text-muted-foreground")}>{statusLabel(d.status)}</span>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{d.propertyName || "No property"}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{d.via === "property" ? "On a Landsec record outside the schemes" : "Landsec is named on the deal"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden space-y-1.5">
                {deals.map(d => (
                  <div key={d.id} className="rounded-2xl border border-border bg-card px-3 py-2 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium min-w-0">{d.name || "Untitled deal"}</p>
                      <span className="text-[11px] font-mono tabular-nums text-muted-foreground shrink-0">{d.ref ? `#${d.ref}` : ""}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{[d.propertyName || "No property", d.dealType].filter(Boolean).join(" · ")}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn(rowPill, d.live ? "border-border text-foreground" : "border-transparent text-muted-foreground")}>{statusLabel(d.status)}</span>
                      <span className="text-[11px] text-muted-foreground">{d.via === "property" ? "On a record outside the schemes" : "Landsec named on the deal"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {properties.length === 0 && deals.length === 0 && report !== null && (
            <p className="text-sm text-muted-foreground">Nothing sits outside the 14 schemes.</p>
          )}
        </div>
      )}
    </section>
  );
}

// BGP staff only, at the foot of Properties in the Landsec view: where the
// Letting Tracker and Deals disagree, the duplicate-record merge, what sits
// outside the 14 schemes, and the logins by role. It draws nothing for a
// client login: the server sends them none of these fields.
export function LandsecAdminBlock({ data, isAdmin }: { data: LandsecHomeData | undefined; isAdmin: boolean }) {
  const [mergeScheme, setMergeScheme] = useState<LandsecHomeScheme | null>(null);
  if (!data || !landsecHomeIsStaff(data)) return null;
  const duplicates = data.groups.flatMap(g => g.schemes).filter(s => s.recordCount > 1);
  const check = data.trackerCheck;

  return (
    <section className="mt-8 rounded-lg border border-border bg-card p-3 sm:p-4 space-y-4" data-testid="landsec-admin-block">
      <div>
        <h2 className="text-sm font-semibold">Landsec admin</h2>
        <p className="text-xs text-muted-foreground">BGP staff only. A Landsec login does not see this block.</p>
      </div>

      {check && (
        <div className="space-y-1" data-testid="landsec-tracker-check">
          <p className={sectionLabel}>Letting Tracker against Deals</p>
          {check.differ ? (
            <p className="text-sm">
              <span className={cn(rowPill, "mr-2 border-amber-500/60 text-amber-700 dark:text-amber-400")} data-testid="landsec-tracker-check-chip">They differ</span>
              The tracker shows <span className="font-mono tabular-nums">{num(check.trackerRows)}</span> live rows and Deals <span className="font-mono tabular-nums">{num(check.liveLettings)}</span> live lettings:{" "}
              <span className="font-mono tabular-nums">{num(check.rowsWithoutLetting)}</span> row{check.rowsWithoutLetting === 1 ? " has" : "s have"} no live letting behind {check.rowsWithoutLetting === 1 ? "it" : "them"} and{" "}
              <span className="font-mono tabular-nums">{num(check.lettingsWithoutRow)}</span> live letting{check.lettingsWithoutRow === 1 ? " has" : "s have"} no tracker row.
            </p>
          ) : (
            <p className="text-sm">
              <span className={cn(rowPill, "mr-2 border-border text-muted-foreground")} data-testid="landsec-tracker-check-chip">They agree</span>
              <span className="font-mono tabular-nums">{num(check.liveLettings)}</span> live lettings, each with its tracker row.
            </p>
          )}
          {check.differ && (
            <p className="text-xs text-muted-foreground">
              Nothing is repaired from here. {isAdmin
                ? <>The lists are in the Letting integrity report: switch the team picker back to All Teams, then <Link href="/settings" className="underline hover:text-foreground" data-testid="landsec-tracker-check-report">open Settings</Link>.</>
                : "An admin has the lists in the Letting integrity report in Settings."}
            </p>
          )}
        </div>
      )}

      <div className="space-y-1.5" data-testid="landsec-duplicate-records">
        <p className={sectionLabel}>Schemes with more than one property record <span className="font-mono tabular-nums font-normal">{duplicates.length}</span></p>
        {duplicates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every scheme has one property record.</p>
        ) : (
          <div className="rounded-lg border border-border divide-y divide-border text-sm">
            {duplicates.map(s => (
              <div key={s.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">{s.name} <span className="text-xs font-normal text-muted-foreground font-mono tabular-nums">{s.recordCount} records</span></p>
                  <p className="text-[11px] text-muted-foreground">{(s.records || []).map(r => `${r.name} (${num(r.units)} unit${r.units === 1 ? "" : "s"}, ${num(r.deals)} deal${r.deals === 1 ? "" : "s"})`).join(" · ")}</p>
                </div>
                {isAdmin
                  ? <Button variant="outline" size="sm" onClick={() => setMergeScheme(s)} data-testid={`landsec-merge-${s.key}`}><Merge className="w-3.5 h-3.5 mr-1.5" /> Merge records</Button>
                  : <span className="text-xs text-muted-foreground">An admin can merge these</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <OutsideSchemesReport data={data} />

      {isAdmin && <LandsecAccessPanel />}

      {mergeScheme && <MergeDialog scheme={mergeScheme} onClose={() => setMergeScheme(null)} />}
    </section>
  );
}
