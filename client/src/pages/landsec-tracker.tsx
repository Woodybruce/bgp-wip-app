// The joint agent's Letting Tracker (Woody, 2026-11-12: "joint agents should
// have full control like us", "only on their instructed properties", "they
// can't have access to the brand pages"). Every unit on the schemes on the
// login, from one request (GET /api/landsec/tracker): its status, size and
// quoting rent, its deal reference, how it stands against the brief, and its
// interest, viewings and offers. Each row opens the same working dialogs
// BGP's tracker mounts (the Targeting Brief, the offers and negotiation log,
// Heads of Terms, the deal checklist, the transaction recommendation, Share
// with a brand), plus this page's own short forms for adding and editing a
// unit and logging interest, a viewing or an offer.
//
// This page never asks for BGP's CRM, the staff directory, the firm-wide
// unit list or the deals, and shows no link to a brand page or a deal page.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarDays, FileSignature, Layers, ListChecks, Pencil, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, PillCount } from "@/components/ui/pill";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { UnitBriefDialog } from "@/components/unit-brief-dialog";
import { BriefChip } from "@/components/unit-brief/brief-chip";
import { BriefProgressChip } from "@/components/tracker-success-cell";
import { TrackerChecklistCell } from "@/components/deal-checklist/checklist-cell";
import { HotsWorkspaceDialog } from "@/components/unit-hots/hots-workspace";
import { UnitShareDialog } from "@/components/unit-share-dialog";
import { DealChecklistDialog } from "@/components/deal-checklist/deal-checklist-dialog";
import { RecommendationDialog } from "@/components/unit-recommendation/recommendation-workspace";
import { RecommendationChip } from "@/components/unit-recommendation/recommendation-chip";
import { AddUnitDialog } from "@/components/landsec-tracker/add-unit-dialog";
import { EditUnitDialog } from "@/components/landsec-tracker/edit-unit-dialog";
import { InterestDialog } from "@/components/landsec-tracker/interest-dialog";
import { ViewingsDialog } from "@/components/landsec-tracker/viewings-dialog";
import { OffersDialog } from "@/components/landsec-tracker/offers-dialog";
import { HotsChip, InterestCell, OffersCell, StatusPill, ViewingsCell } from "@/components/landsec-tracker/unit-cells";
import { LIVE_CODES, TRACKER_KEY, money, serverMessage, sqftText, statusLabel, todayIso, type TrackerUnitRef } from "@/components/landsec-tracker/format";
import type { BriefProgressInput } from "@shared/brief-progress";
import type { LandsecTrackerData, LandsecTrackerUnit } from "@shared/landsec-tracker";

type StatusFilter = "live" | "AVA" | "NEG" | "HOT" | "SOL" | "historic" | "all";
type Activity = { unit: LandsecTrackerUnit; adding: boolean };
const STATUS_PILLS: { key: StatusFilter; label: string }[] = [
  { key: "live", label: "Live" }, { key: "AVA", label: statusLabel("AVA") }, { key: "NEG", label: statusLabel("NEG") },
  { key: "HOT", label: statusLabel("HOT") }, { key: "SOL", label: statusLabel("SOL") }, { key: "historic", label: "Historic" }, { key: "all", label: "All" },
];
const isLive = (u: LandsecTrackerUnit) => LIVE_CODES.includes(u.statusCode);
const matchesStatus = (u: LandsecTrackerUnit, f: StatusFilter): boolean =>
  f === "all" ? true : f === "live" ? isLive(u) : f === "historic" ? !isLive(u) : u.statusCode === f;
const refOf = (u: LandsecTrackerUnit): TrackerUnitRef => ({ id: u.id, unitName: u.unitName, propertyId: u.propertyId });
const rentText = (u: LandsecTrackerUnit): string => (u.askingRent != null ? money(u.askingRent) : u.rentPoa ? "On application" : "");
const quotingText = (u: LandsecTrackerUnit): string => (u.askingRent != null ? `Quoting ${money(u.askingRent)}` : u.rentPoa ? "Rent on application" : "");
// The desktop table's heading cells. Every table heading in the app is
// sticky (index.css); it only holds when the table's box does not scroll. So
// from 1280 wide the table is laid out to fit its box (fixed columns, long
// lines cut short) and the headings stay at the top of the page; a narrower
// window scrolls the table sideways inside its box and the headings scroll
// away with it.
const TH = "bg-muted px-2 py-2 text-left first:rounded-tl-lg last:rounded-tr-lg";
const CARD_BUTTON = "h-8 px-2 text-xs";
const CARD_LINK = "inline-flex h-8 items-center rounded-md px-2 text-xs text-muted-foreground underline hover:text-foreground";

export default function LandsecTracker() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { data, isLoading, error, refetch } = useQuery<LandsecTrackerData>({ queryKey: TRACKER_KEY, staleTime: 5_000, refetchInterval: 60_000 });
  const units = data?.units || [];
  const schemes = data?.schemes || [];
  const jointAgent = data?.viewer.role === "joint_agent";

  const [scheme, setScheme] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("live");
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [editUnit, setEditUnit] = useState<LandsecTrackerUnit | null>(null);
  const [briefUnit, setBriefUnit] = useState<TrackerUnitRef | null>(null);
  const [checklistUnit, setChecklistUnit] = useState<TrackerUnitRef | null>(null);
  const [recommendationUnit, setRecommendationUnit] = useState<TrackerUnitRef | null>(null);
  const [hotsUnit, setHotsUnit] = useState<TrackerUnitRef | null>(null);
  const [shareUnit, setShareUnit] = useState<TrackerUnitRef | null>(null);
  const [interestUnit, setInterestUnit] = useState<LandsecTrackerUnit | null>(null);
  const [viewings, setViewings] = useState<Activity | null>(null);
  const [offers, setOffers] = useState<Activity | null>(null);

  // Everything a dialog changes shows on the row: re-read the tracker.
  const reload = () => { queryClient.invalidateQueries({ queryKey: TRACKER_KEY }); };

  // A link to one unit (/landsec/tracker?unit=<id>, as the deal checklist and
  // recommendation emails send): show it, scroll to it, and open the dialog
  // the link names. Once, when the units have loaded.
  const linkDone = useRef(false);
  useEffect(() => {
    if (linkDone.current || !data) return;
    linkDone.current = true;
    let q: URLSearchParams;
    try { q = new URLSearchParams(window.location.search); } catch { return; }
    const unitId = q.get("unit");
    if (!unitId) return;
    const u = data.units.find(x => x.id === unitId);
    if (!u) { toast({ title: "That unit is not on your tracker", description: "It may have been removed, or it is on a scheme that is not on your login." }); return; }
    setScheme("all"); setSearch("");
    setStatus(isLive(u) ? "live" : "all");
    setHighlight(u.id);
    if (q.get("checklist") === "1") setChecklistUnit(refOf(u));
    else if (q.get("recommendation") === "1") setRecommendationUnit(refOf(u));
    else if (q.get("hots") === "1") setHotsUnit(refOf(u));
    else if (q.get("brief") === "1") setBriefUnit(refOf(u));
  }, [data]);
  useEffect(() => {
    if (!highlight) return;
    const scroll = setTimeout(() => {
      document.querySelector(`[data-unit-row="${CSS.escape(highlight)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 150);
    const clear = setTimeout(() => setHighlight(null), 6000);
    return () => { clearTimeout(scroll); clearTimeout(clear); };
  }, [highlight, isMobile]);

  const inScheme = useMemo(() => (scheme === "all" ? units : units.filter(u => u.schemeKey === scheme)), [units, scheme]);
  const counts = useMemo(() => {
    const c = {} as Record<StatusFilter, number>;
    for (const p of STATUS_PILLS) c[p.key] = inScheme.filter(u => matchesStatus(u, p.key)).length;
    return c;
  }, [inScheme]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inScheme
      .filter(u => matchesStatus(u, status))
      .filter(u => !q || [u.unitName, u.propertyName, u.schemeName, u.existingTenant, u.dealRef ? `#${u.dealRef}` : "", statusLabel(u.statusCode),
        ...u.interest.lines.map(i => i.companyName), ...u.viewings.lines.map(v => v.companyName), ...u.offers.lines.map(o => o.companyName)]
        .some(v => String(v || "").toLowerCase().includes(q)))
      .sort((a, b) => a.schemeName.localeCompare(b.schemeName) || a.unitName.localeCompare(b.unitName, "en-GB", { numeric: true }));
  }, [inScheme, status, search]);

  const today = todayIso();
  const monitorFor = (u: LandsecTrackerUnit): BriefProgressInput => ({ today, ...u.monitor });
  const moveToNegotiating = async (u: LandsecTrackerUnit) => {
    try {
      await apiRequest("PATCH", `/api/available-units/${u.id}`, { marketingStatus: "NEG" });
      toast({ title: "Unit moved to Negotiating" });
      reload();
    } catch (e) {
      toast({ title: "The unit could not be moved", description: serverMessage(e, ""), variant: "destructive" });
    }
  };

  if (error) {
    return (
      <div className="p-4 md:p-6" data-testid="landsec-tracker-error">
        <h1 className="text-2xl font-bold tracking-tight">Tracker</h1>
        <p className="mt-2 text-sm text-muted-foreground">The tracker could not be loaded. {serverMessage(error, "")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Try again</Button>
      </div>
    );
  }

  const live = units.filter(isLive).length;
  const subtitle = !data ? "The units on your schemes, from marketing to solicitors"
    : `${units.length} ${units.length === 1 ? "unit" : "units"}${schemes.length === 1 ? ` at ${schemes[0].name}` : ` across ${schemes.length} schemes`} · ${live} live`;
  const chips = (u: LandsecTrackerUnit, prefix: string) => (
    <div className="flex flex-wrap items-center gap-1">
      <BriefChip brief={u.brief} onClick={() => setBriefUnit(refOf(u))} testId={`${prefix}-brief-chip-${u.id}`} />
      <BriefProgressChip unitId={u.id} input={monitorFor(u)} onOpenBrief={() => setBriefUnit(refOf(u))} testId={`${prefix}-brief-progress-chip-${u.id}`} />
      <RecommendationChip summary={u.recommendation} onClick={() => setRecommendationUnit(refOf(u))} testId={`${prefix}-recommendation-chip-${u.id}`} />
      <HotsChip stage={u.hots.stage} onClick={() => setHotsUnit(refOf(u))} testId={`${prefix}-hots-chip-${u.id}`} />
    </div>
  );
  const context = (u: LandsecTrackerUnit) => [schemes.length > 1 ? u.schemeName : null, u.floor, u.dealRef ? `Ref #${u.dealRef}` : null, u.existingTenant ? `Let to ${u.existingTenant}` : null].filter(Boolean).join(" · ");
  const ring = (u: LandsecTrackerUnit) => (highlight === u.id ? "bg-primary/10 outline outline-2 -outline-offset-2 outline-primary" : "");

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="landsec-tracker">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tracker</h1>
          <p className="text-sm text-muted-foreground mt-0.5" data-testid="landsec-tracker-subtitle">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* A joint agent's calendar is /landsec/viewings; BGP's own is on the Letting Tracker. */}
          <Link href={data?.viewer.role === "bgp" ? "/available?tab=viewings" : "/landsec/viewings"}><Button variant="outline" size="sm" data-testid="landsec-tracker-viewings"><CalendarDays className="w-3.5 h-3.5 mr-1" /> Viewings</Button></Link>
          <Button size="sm" onClick={() => setAddOpen(true)} disabled={!data} data-testid="landsec-tracker-add-unit"><Plus className="w-3.5 h-3.5 mr-1" /> Add unit</Button>
        </div>
      </div>

      {schemes.length > 1 && (
        <div className="flex flex-wrap gap-1.5" data-testid="landsec-tracker-schemes">
          <Pill active={scheme === "all"} onClick={() => setScheme("all")}>All schemes <PillCount n={units.length} active={scheme === "all"} /></Pill>
          {schemes.map(s => {
            const n = units.filter(u => u.schemeKey === s.key).length;
            return <Pill key={s.key} active={scheme === s.key} onClick={() => setScheme(s.key)} data-testid={`landsec-tracker-scheme-${s.key}`}>{s.name} <PillCount n={n} active={scheme === s.key} /></Pill>;
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5" data-testid="landsec-tracker-statuses">
        {STATUS_PILLS.map(p => (
          <Pill key={p.key} active={status === p.key} onClick={() => setStatus(p.key)} data-testid={`landsec-tracker-status-${p.key}`}>{p.label} <PillCount n={counts[p.key] || 0} active={status === p.key} /></Pill>
        ))}
      </div>
      <Input placeholder="Search unit, brand, tenant or Ref #…" value={search} onChange={e => setSearch(e.target.value)} className="w-full md:max-w-md" data-testid="landsec-tracker-search" />

      {isLoading && <Skeleton className="h-64 rounded-lg" />}

      {data && units.length === 0 && (
        <div className="rounded-lg border border-border py-12 text-center" data-testid="landsec-tracker-empty">
          <Layers className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">No units on the tracker yet.</p>
          <Button size="sm" className="mt-3" onClick={() => setAddOpen(true)}><Plus className="w-3.5 h-3.5 mr-1" /> Add unit</Button>
        </div>
      )}

      {data && units.length > 0 && !isMobile && (
        <div className="rounded-lg border border-border overflow-x-auto xl:overflow-visible" data-testid="landsec-tracker-table-box">
          <table className="w-full min-w-[60rem] table-fixed text-sm xl:min-w-0" data-testid="landsec-tracker-table">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[6.75rem]" />
              <col className="w-[10rem]" />
              <col />
              <col />
              <col />
              <col className="w-[7rem]" />
            </colgroup>
            <thead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className={TH}>Unit</th>
                <th className={TH}>Status</th>
                <th className={TH}>Deal checklist</th>
                <th className={TH}>Interest</th>
                <th className={TH}>Viewings</th>
                <th className={TH}>Offers</th>
                <th className={TH}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(u => {
                const about = [context(u), sqftText(u.sqft), quotingText(u)].filter(Boolean).join(" · ");
                return (
                  <tr key={u.id} data-unit-row={u.id} className={`border-t border-border align-top hover:bg-muted/30 ${ring(u)}`} data-testid={`landsec-tracker-row-${u.id}`}>
                    <td className="px-2 py-2 break-words">
                      <button type="button" className="max-w-full text-left font-medium hover:underline" onClick={() => setBriefUnit(refOf(u))} title="Open the targeting brief" data-testid={`landsec-tracker-unit-${u.id}`}>{u.unitName}</button>
                      {about && <p className="text-[11px] leading-snug tabular-nums text-muted-foreground" data-testid={`landsec-tracker-about-${u.id}`}>{about}</p>}
                      <div className="mt-1">{chips(u, "ja")}</div>
                    </td>
                    <td className="px-2 py-2"><StatusPill code={u.statusCode} /></td>
                    <td className="px-2 py-2"><TrackerChecklistCell unitId={u.id} summary={u.checklist} onOpen={() => setChecklistUnit(refOf(u))} /></td>
                    <td className="px-2 py-2 overflow-hidden"><InterestCell unitId={u.id} count={u.interest.count} lines={u.interest.lines} onOpen={() => setInterestUnit(u)} /></td>
                    <td className="px-2 py-2 overflow-hidden"><ViewingsCell unitId={u.id} count={u.viewings.count} lines={u.viewings.lines} onOpen={() => setViewings({ unit: u, adding: false })} onAdd={() => setViewings({ unit: u, adding: true })} /></td>
                    <td className="px-2 py-2 overflow-hidden"><OffersCell unitId={u.id} count={u.offers.count} lines={u.offers.lines} onOpen={() => setOffers({ unit: u, adding: false })} onAdd={() => setOffers({ unit: u, adding: true })} /></td>
                    <td className="px-2 py-2" data-testid={`landsec-tracker-actions-${u.id}`}>
                      <div className="flex items-center justify-end">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" onClick={() => setEditUnit(u)} aria-label={`Edit ${u.unitName}`} title="Edit unit" data-testid={`landsec-tracker-edit-${u.id}`}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" onClick={() => setHotsUnit(refOf(u))} aria-label={`Heads of Terms for ${u.unitName}`} title="Heads of Terms" data-testid={`landsec-tracker-hots-${u.id}`}><FileSignature className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" onClick={() => setShareUnit(refOf(u))} aria-label={`Share ${u.unitName} with a brand`} title="Share with a brand" data-testid={`landsec-tracker-share-${u.id}`}><Send className="h-3.5 w-3.5" /></Button>
                      </div>
                      {u.hasUnitPage && <Link href={`/landsec/unit/${u.id}`} className="mt-0.5 block text-right text-[11px] text-muted-foreground hover:text-foreground hover:underline whitespace-nowrap" data-testid={`landsec-tracker-unit-page-${u.id}`}>Unit page</Link>}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No units match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {data && units.length > 0 && isMobile && (
        <div className="space-y-2" data-testid="landsec-tracker-cards">
          {rows.map(u => (
            <div key={u.id} data-unit-row={u.id} className={`rounded-2xl border border-border bg-card p-3 shadow-sm ${ring(u)}`} data-testid={`landsec-tracker-card-${u.id}`}>
              <div className="flex items-start justify-between gap-2">
                <button type="button" className="min-w-0 text-left font-medium" onClick={() => setBriefUnit(refOf(u))}>{u.unitName}</button>
                <span className="shrink-0 font-mono tabular-nums text-sm">{rentText(u)}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">{[context(u), sqftText(u.sqft)].filter(Boolean).join(" · ")}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1"><StatusPill code={u.statusCode} />{chips(u, "ja-mobile")}</div>
              <TrackerChecklistCell unitId={u.id} summary={u.checklist} onOpen={() => setChecklistUnit(refOf(u))} compact />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" className={CARD_BUTTON} onClick={() => setInterestUnit(u)} data-testid={`landsec-tracker-card-interest-${u.id}`}>Interest <span className="ml-1 font-mono tabular-nums">{u.interest.count}</span></Button>
                <Button variant="outline" size="sm" className={CARD_BUTTON} onClick={() => setViewings({ unit: u, adding: false })} data-testid={`landsec-tracker-card-viewings-${u.id}`}>Viewings <span className="ml-1 font-mono tabular-nums">{u.viewings.count}</span></Button>
                <Button variant="outline" size="sm" className={CARD_BUTTON} onClick={() => setOffers({ unit: u, adding: false })} data-testid={`landsec-tracker-card-offers-${u.id}`}>Offers <span className="ml-1 font-mono tabular-nums">{u.offers.count}</span></Button>
                <Button variant="outline" size="sm" className={CARD_BUTTON} onClick={() => setHotsUnit(refOf(u))} data-testid={`landsec-tracker-card-hots-${u.id}`}><FileSignature className="mr-1 h-3.5 w-3.5" /> Heads of Terms</Button>
                <Button variant="outline" size="sm" className={CARD_BUTTON} onClick={() => setChecklistUnit(refOf(u))} data-testid={`landsec-tracker-card-checklist-${u.id}`}><ListChecks className="mr-1 h-3.5 w-3.5" /> Checklist</Button>
              </div>
              <div className="mt-1 -ml-2 flex flex-wrap items-center">
                <button type="button" data-no-min-touch className={CARD_LINK} onClick={() => setEditUnit(u)} data-testid={`landsec-tracker-card-edit-${u.id}`}>Edit unit</button>
                <button type="button" data-no-min-touch className={CARD_LINK} onClick={() => setShareUnit(refOf(u))} data-testid={`landsec-tracker-card-share-${u.id}`}>Share with a brand</button>
                {u.hasUnitPage && <Link href={`/landsec/unit/${u.id}`} className={CARD_LINK} data-testid={`landsec-tracker-card-unit-page-${u.id}`}>Unit page</Link>}
              </div>
            </div>
          ))}
          {rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No units match.</p>}
        </div>
      )}

      <AddUnitDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultPropertyId={scheme !== "all" ? schemes.find(s => s.key === scheme)?.properties[0]?.id || null : null}
        onStarted={unit => { reload(); setStatus("live"); setHighlight(unit.id); setBriefUnit(unit); }}
      />
      <EditUnitDialog unit={editUnit} onClose={() => setEditUnit(null)} onSaved={reload} />

      <UnitBriefDialog unit={briefUnit} open={!!briefUnit} onClose={() => { setBriefUnit(null); reload(); }} />
      <InterestDialog
        unit={interestUnit ? { id: interestUnit.id, unitName: interestUnit.unitName, propertyName: interestUnit.propertyName } : null}
        onClose={() => setInterestUnit(null)}
        onChanged={reload}
      />
      <ViewingsDialog
        unit={viewings ? { id: viewings.unit.id, unitName: viewings.unit.unitName, propertyName: viewings.unit.propertyName } : null}
        startAdding={!!viewings?.adding}
        ownerUserId={jointAgent ? data?.viewer.userId : null}
        onClose={() => setViewings(null)}
        onChanged={reload}
      />
      <OffersDialog
        unit={offers ? { id: offers.unit.id, unitName: offers.unit.unitName, propertyName: offers.unit.propertyName } : null}
        startAdding={!!offers?.adding}
        onClose={() => setOffers(null)}
        onChanged={reload}
        onMoveToNegotiating={() => { if (offers) moveToNegotiating(offers.unit); }}
        onOpenHots={() => { const u = offers?.unit; setOffers(null); if (u) setHotsUnit(refOf(u)); }}
        onOpenRecommendation={() => { const u = offers?.unit; setOffers(null); if (u) setRecommendationUnit(refOf(u)); }}
      />
      <RecommendationDialog
        unit={recommendationUnit}
        open={!!recommendationUnit}
        onClose={() => { setRecommendationUnit(null); reload(); }}
        onOpenHots={() => { const u = recommendationUnit; setRecommendationUnit(null); setHotsUnit(u); }}
        onOpenOffers={() => { const u = units.find(x => x.id === recommendationUnit?.id); setRecommendationUnit(null); if (u) setOffers({ unit: u, adding: false }); }}
        onChanged={reload}
      />
      <DealChecklistDialog unit={checklistUnit} open={!!checklistUnit} onClose={() => { setChecklistUnit(null); reload(); }} onChanged={reload} />
      <UnitShareDialog unit={shareUnit} open={!!shareUnit} onClose={() => setShareUnit(null)} />
      <HotsWorkspaceDialog
        unit={hotsUnit}
        open={!!hotsUnit}
        onClose={() => { setHotsUnit(null); reload(); }}
        onOpenOffers={() => { const u = units.find(x => x.id === hotsUnit?.id); setHotsUnit(null); if (u) setOffers({ unit: u, adding: false }); }}
        onChanged={reload}
      />
    </div>
  );
}
