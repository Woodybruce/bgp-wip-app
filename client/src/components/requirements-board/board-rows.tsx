// The requirements board's rows (docs/requirements-board-review-2026-11-19.md,
// section 1; Woody, 19 November 2026: "carry on"). One row per brand, from the
// board's feed (GET /api/crm/requirements-board, server/requirements-board.ts),
// in about eight columns that fit a computer screen with no sideways scroll,
// and as cards on a phone. Editing is not on the row: pressing it opens the
// requirement panel. Every row link opens what it names (the brand, the unit
// that fits, the agent).
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Link } from "wouter";
import { Check, Loader2, Mail, Phone, ClipboardList, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CompanyChip } from "@/components/company-chip";
import { propertyUnitHref, trackerUnitHref, type UnitLinkViewer } from "@/lib/unit-links";
import { lastContactShort } from "@shared/last-contact";
import { requirementGoingStale, type RequirementLive } from "@shared/requirement-live";
import type { BoardFit, BoardRow } from "@shared/requirements-board";

// Row pill for a requirement's state, in the hues of the page's status map.
export function RequirementStatePill({ live, testId }: { live: RequirementLive; testId?: string }) {
  const stale = requirementGoingStale(live);
  // Press-reported and live is outlined, not filled: nobody has recorded speaking to the brand.
  const press = live.state === "live" && live.pressReported;
  const cls = live.state === "live" ? (stale ? "bg-amber-500 text-white border-transparent" : press ? "border-emerald-500 text-emerald-700 dark:text-emerald-400" : "bg-emerald-500 text-white border-transparent")
    : live.state === "to_confirm" ? "border-foreground/40 text-foreground"
    : live.state === "closed" ? "bg-zinc-400 text-white border-transparent"
    : "border-border text-muted-foreground";
  const base = stale ? "Going stale" : live.state === "background" ? (live.importOnly ? "Market listing" : "Older") : live.stateLabel;
  const label = press ? `${base} · press` : base;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide leading-none whitespace-nowrap ${cls}`}
      title={live.why}
      data-testid={testId}
      data-press={press ? "true" : undefined}
    >
      {label}
    </span>
  );
}

const capital = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const stop = (e: MouseEvent) => e.stopPropagation();

export function fitHref(fit: BoardFit, viewer: UnitLinkViewer): string {
  return propertyUnitHref(fit.propertyId, fit.scheduleRowId) || trackerUnitHref(fit.unitId, fit.propertyId, viewer) || (fit.propertyId ? `/properties/${fit.propertyId}` : "/available");
}

export interface BoardRowsProps {
  rows: BoardRow[];
  /** BGP staff signed in as themselves: the state, owner and last contact columns. */
  staff: boolean;
  /** The centre's tools (Still live / Confirm, the evidence drawer): BGP staff only. */
  canUseCentre: boolean;
  liveMap: Map<string, RequirementLive>;
  selectedId: string | null;
  onOpen: (row: BoardRow) => void;
  onConfirm?: (requirementId: string) => void;
  onEvidence?: (requirementId: string) => void;
  stillLiveId?: string | null;
  unitViewer: UnitLinkViewer;
  isMobile: boolean;
  empty: ReactNode;
}

const STAFF_COLUMNS = "grid-cols-[minmax(140px,1.2fr)_minmax(160px,1.5fr)_minmax(140px,1.15fr)_minmax(150px,1.3fr)_minmax(110px,1fr)_minmax(80px,0.7fr)_88px_72px]";
const CLIENT_COLUMNS = "grid-cols-[minmax(160px,1.2fr)_minmax(190px,1.6fr)_minmax(140px,1fr)_minmax(170px,1.4fr)_minmax(130px,1fr)_88px]";

export function BoardRows(props: BoardRowsProps) {
  const { rows, staff, isMobile, empty } = props;
  if (!rows.length) return <div className="py-10 text-center text-sm text-muted-foreground" data-testid="requirements-board-empty">{empty}</div>;
  if (isMobile) return <div className="space-y-2" data-testid="requirements-board-cards">{rows.map(row => <BoardCard key={row.key} row={row} {...props} />)}</div>;
  const cols = staff ? STAFF_COLUMNS : CLIENT_COLUMNS;
  const head = staff ? ["Brand", "Wants", "State", "Fits", "Agent", "BGP", "Expansion", "Contact"] : ["Brand", "Wants", "Listed", "Fits", "Agent", "Expansion"];
  return (
    <div className="rounded-md border border-border" role="table" aria-label="Requirements" data-testid="requirements-board-rows">
      <div className={`grid ${cols} gap-3 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground`} role="row">
        {head.map(h => <div key={h} role="columnheader">{h}</div>)}
      </div>
      {rows.map(row => <BoardLine key={row.key} row={row} cols={cols} {...props} />)}
    </div>
  );
}

function openOnKey(e: KeyboardEvent, open: () => void) {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
}

function BrandCell({ row }: { row: BoardRow }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        {row.brandId
          ? <CompanyChip id={row.brandId} name={row.brandName} domain={row.domain} className="text-sm font-medium" testId={`board-brand-${row.key}`} />
          : <span className="truncate text-sm font-medium">{row.brandName}</span>}
        {row.superBrand && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label="Super Brand" />}
      </div>
      {row.others.length > 0 && <p className="mt-0.5 text-[11px] text-muted-foreground">+{row.others.length} more {row.others.length === 1 ? "requirement" : "requirements"}</p>}
    </div>
  );
}

function WantsCell({ row }: { row: BoardRow }) {
  return (
    <div className="min-w-0">
      <p className="line-clamp-2 text-sm" title={row.requirement.wants || undefined}>{row.requirement.wants || <span className="text-muted-foreground">No size, use or places given</span>}</p>
      {row.requirement.type && <p className="truncate text-[11px] text-muted-foreground">{row.requirement.type}</p>}
    </div>
  );
}

function StateCell({ row, liveMap, canUseCentre, onConfirm, onEvidence, stillLiveId }: BoardRowsProps & { row: BoardRow }) {
  const id = row.requirement.id;
  const live = liveMap.get(id);
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {live ? <RequirementStatePill live={live} testId={`board-state-${id}`} /> : row.requirement.stateLabel && <span className="text-[11px] uppercase text-muted-foreground">{row.requirement.stateLabel}</span>}
        {canUseCentre && onEvidence && (
          <button type="button" onClick={e => { stop(e); onEvidence(id); }} className="text-muted-foreground hover:text-foreground" aria-label="Evidence" title="Evidence" data-testid={`button-evidence-${id}`}>
            <ClipboardList className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{capital(row.requirement.dateLine)}</p>
      {canUseCentre && onConfirm && live && live.state !== "closed" && (
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" disabled={stillLiveId === id}
          onClick={e => { stop(e); onConfirm(id); }} data-testid={`button-still-live-${id}`}>
          {stillLiveId === id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {live.confirmed ? "Still live" : "Confirm"}
        </Button>
      )}
    </div>
  );
}

function FitsCell({ row, unitViewer }: { row: BoardRow; unitViewer: UnitLinkViewer }) {
  const best = row.fits.best;
  if (!best) return <span className="text-sm text-muted-foreground">None</span>;
  return (
    <div className="min-w-0">
      <Link href={fitHref(best, unitViewer)} onClick={stop} className="block truncate text-sm text-primary hover:underline"
        title={`${best.unitName}${best.propertyName ? ` · ${best.propertyName}` : ""}`} data-testid={`board-fit-${row.key}`}>
        {best.unitName}{best.propertyName ? ` · ${best.propertyName}` : ""}
      </Link>
      <p className="truncate text-[11px] text-muted-foreground" title={best.why}>{best.why}</p>
      {row.fits.count > 1 && <p className="text-[11px] text-muted-foreground"><span className="font-mono tabular-nums">{row.fits.count}</span> units fit</p>}
    </div>
  );
}

function AgentCell({ row }: { row: BoardRow }) {
  const a = row.agent;
  if (!a) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <Link href={`/contacts/${a.contactId}`} onClick={stop} className="truncate text-sm hover:underline">{a.name}</Link>
        {a.phone && <a href={`tel:${a.phone.replace(/\s+/g, "")}`} onClick={stop} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={`Call ${a.name}`}><Phone className="h-3.5 w-3.5" /></a>}
        {a.email && <a href={`mailto:${a.email}`} onClick={stop} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={`Email ${a.name}`}><Mail className="h-3.5 w-3.5" /></a>}
      </div>
      {a.firmName && (a.firmId
        ? <Link href={`/companies/${a.firmId}`} onClick={stop} className="block truncate text-[11px] text-muted-foreground hover:underline">{a.firmName}</Link>
        : <p className="truncate text-[11px] text-muted-foreground">{a.firmName}</p>)}
    </div>
  );
}

function OwnerCell({ row }: { row: BoardRow }) {
  const owners = row.owners || [];
  if (!owners.length) return <span className="text-[11px] text-muted-foreground">No owner</span>;
  return <p className="line-clamp-2 text-sm">{owners.map(o => o.name).join(", ")}</p>;
}

function ExpansionCell({ row }: { row: BoardRow }) {
  if (!row.expansion) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <div title={`Expansion score ${row.expansion.score}: ${row.expansion.band}`}>
      <p className="font-mono text-sm tabular-nums">{row.expansion.score}</p>
      <p className="text-[11px] text-muted-foreground">{row.expansion.band}</p>
    </div>
  );
}

function ContactCell({ row }: { row: BoardRow }) {
  const label = lastContactShort(row.lastContactAt ?? null);
  return <span className={`text-sm ${label ? "" : "text-muted-foreground"}`} title={row.lastContactAt ? `Last contact ${new Date(row.lastContactAt).toLocaleDateString("en-GB")}` : "No contact read yet"}>{label || "—"}</span>;
}

function BoardLine(props: BoardRowsProps & { row: BoardRow; cols: string }) {
  const { row, cols, staff, selectedId, onOpen, unitViewer } = props;
  const selected = selectedId === row.requirement.id;
  const open = () => onOpen(row);
  return (
    <div role="row" tabIndex={0} onClick={open} onKeyDown={e => openOnKey(e, open)}
      className={`grid ${cols} cursor-pointer items-start gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${selected ? "bg-muted/60" : ""}`}
      aria-selected={selected} data-testid={`requirements-board-row-${row.requirement.id}`}>
      <BrandCell row={row} />
      <WantsCell row={row} />
      {staff ? <StateCell {...props} row={row} /> : <p className="text-sm text-muted-foreground">{capital(row.requirement.dateLine)}</p>}
      <FitsCell row={row} unitViewer={unitViewer} />
      <AgentCell row={row} />
      {staff && <OwnerCell row={row} />}
      <ExpansionCell row={row} />
      {staff && <ContactCell row={row} />}
    </div>
  );
}

function BoardCard(props: BoardRowsProps & { row: BoardRow }) {
  const { row, staff, onOpen, unitViewer, selectedId } = props;
  const open = () => onOpen(row);
  return (
    <div role="button" tabIndex={0} onClick={open} onKeyDown={e => openOnKey(e, open)}
      className={`rounded-md border border-border p-3 ${selectedId === row.requirement.id ? "bg-muted/60" : "bg-card"}`} data-testid={`requirements-board-card-${row.requirement.id}`}>
      <div className="flex items-start justify-between gap-2">
        <BrandCell row={row} />
        {row.expansion && <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground" title={row.expansion.band}>{row.expansion.score}</span>}
      </div>
      <div className="mt-1.5"><WantsCell row={row} /></div>
      <div className="mt-1.5">{staff ? <StateCell {...props} row={row} /> : <p className="text-[11px] text-muted-foreground">{capital(row.requirement.dateLine)}</p>}</div>
      {row.fits.best && <div className="mt-1.5"><FitsCell row={row} unitViewer={unitViewer} /></div>}
      {row.agent && <div className="mt-1.5"><AgentCell row={row} /></div>}
    </div>
  );
}
