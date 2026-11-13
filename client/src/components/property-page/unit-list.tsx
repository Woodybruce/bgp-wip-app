// The one list of a property's units on the plan-led property page: the short
// view of the tenancy schedule, for every property and every login. It takes
// the place of the Landsec "Units and lettings" list
// (components/landsec/scheme-units.tsx) and sits beside the plan (dense), or
// full width when the property has no plan.
//
// It reads the units feed (GET /api/properties/:id/units) that the host hands
// in and fetches nothing itself. The filter, the search and the selected unit
// belong to the host, because the plan follows the same three.
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "wouter";
import { MapPinOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Pill, PillCount } from "@/components/ui/pill";
import { rowPill } from "@/components/landsec/deal-clock";
import { cn } from "@/lib/utils";
import { calendarDateValue } from "@shared/calendar-date";
import {
  namedTenant, nextLeaseEvent, unitMatchesFilter,
  type PropertyUnit, type PropertyUnitDeal, type PropertyUnitsFeed, type UnitFilter,
} from "@shared/property-units";
import { UnitBriefTag, UnitDealTag, UnitStatePill } from "./unit-state";
import { area, money, shortDate, unitDisplayLabel } from "./use-property-page";

const NOT_ON_PLAN = "No outline on any plan of this property";
const NOT_ON_SCHEDULE = "On the Letting Tracker, with no row on the tenancy schedule";
const NO_LEASE_COMPANY = "Occupied, with a brand and a name on the lease, but no company on the lease recorded. Set it on the tenancy schedule.";

const FILTERS: Array<{ key: UnitFilter; label: string; title?: string }> = [
  { key: "all", label: "All units" },
  { key: "vacant", label: "Vacant" },
  { key: "live", label: "Live lettings", title: "A letting in progress, from Opportunity to Solicitors" },
  { key: "deals", label: "Deals", title: "Any open deal on the unit: a letting, a regear, a renewal or a rent review" },
  { key: "expiring", label: "Expiry or break <12m", title: "Lease expiry or a break inside 12 months, on a unit that is not vacant. An expiry that has passed counts." },
  { key: "nobrief", label: "No agreed brief", title: "Vacant or in a live letting, with no agreed Targeting Brief" },
  { key: "notonplan", label: "Not on plan", title: NOT_ON_PLAN },
  { key: "notonschedule", label: "Not on schedule", title: NOT_ON_SCHEDULE },
  { key: "nolease", label: "No company on lease", title: NO_LEASE_COMPANY },
];

// The four everyday filters show at once; the work lists sit behind "More
// filters" (a work list in use stays shown).
const WORK_LISTS = new Set<UnitFilter>(["nobrief", "notonplan", "notonschedule", "nolease"]);

// The pills a feed gets, each with its count. "Not on plan", "Not on
// schedule" and "No company on lease" are only offered while there is a unit
// behind them. The server sends a client a count of 0 for the last, so a
// client is never offered it.
function shownPills(feed: PropertyUnitsFeed) {
  const c = feed.counts;
  const count: Record<UnitFilter, number> = {
    all: c.units, vacant: c.vacant, live: c.liveLettings, deals: c.openDeals ?? 0, expiring: c.expiryOrBreakSoon,
    nobrief: c.noAgreedBrief, notonplan: c.notOnPlan, notonschedule: c.notOnSchedule, nolease: c.noLeaseCompany,
  };
  return FILTERS
    .filter(f => (f.key === "deals" ? count.deals > 0 : f.key === "notonplan" ? feed.plans.length > 0 && count.notonplan > 0 : f.key === "notonschedule" ? count.notonschedule > 0 : f.key === "nolease" ? count.nolease > 0 : true))
    .map(f => ({ ...f, count: count[f.key] }));
}

const searchFields = (unit: PropertyUnit) => [
  unit.label, unit.tenant.name, unit.tenant.tradingName, unit.tenant.legalName, unit.tenant.companyName,
  unit.use, unit.floor, unit.grouping, unit.deal?.tenant, unit.deal?.name,
];

// Exported because the plan dims the units the list's filter hides. The order
// is the feed's.
export function filterUnits(units: PropertyUnit[], filter: UnitFilter, search: string): PropertyUnit[] {
  const query = search.trim().toLowerCase();
  if (filter === "all" && !query) return units;
  return units.filter(unit => unitMatchesFilter(unit, filter)
    && (!query || searchFields(unit).some(value => !!value && value.toLowerCase().includes(query))));
}

const LONDON_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
const EVENT_WORDS = { expiry: "Expiry", break: "Break", landlord_break: "Landlord break", review: "Review" } as const;

// shortDate() builds a date formatter on every call, which adds up over 400
// rows, so each month is worded once. day is a calendar day, YYYY-MM-DD.
const MONTHS = new Map<string, string>();
function monthYear(day: string): string {
  const key = day.slice(0, 7);
  let words = MONTHS.get(key);
  if (words === undefined) MONTHS.set(key, words = shortDate(day));
  return words;
}

// "Break Mar 2027": the next dated lease event, or the expiry that has passed.
function leaseEvent(unit: PropertyUnit, today: string): { word: string; date: string } | null {
  const next = nextLeaseEvent(unit, today);
  if (next) return { word: EVENT_WORDS[next.kind], date: monthYear(next.date) };
  const expiry = calendarDateValue(unit.leaseExpiry);
  return expiry && expiry < today ? { word: "Expired", date: monthYear(expiry) } : null;
}

// The dates behind an amber event: the event shown can be a review while it
// is the expiry or a break that falls inside 12 months.
function leaseDates(unit: PropertyUnit): string {
  const dates = [["Expiry", unit.leaseExpiry], ["Break", unit.breakDate], ["Landlord break", unit.landlordBreakDate]] as const;
  return dates.flatMap(([word, date]) => { const day = calendarDateValue(date); return day ? [`${word} ${monthYear(day)}`] : []; }).join(" · ");
}

// Tailwind's md. Only the list the screen shows is built: the table from md
// up, the cards below it. Where the browser cannot say, both are built and
// the classes on their boxes decide.
const DESKTOP = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 768px)") : null;
const watchDesktop = (changed: () => void) => { DESKTOP?.addEventListener("change", changed); return () => DESKTOP?.removeEventListener("change", changed); };
const isDesktop = () => (DESKTOP ? DESKTOP.matches : null);

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// The company on the lease, where the unit trades under another name. A
// placeholder such as "VACANT" is not a company.
function leaseName(tenant: PropertyUnit["tenant"]): string | null {
  const legal = namedTenant(tenant.legalName);
  return legal && tenant.tradingName && !sameName(legal, tenant.tradingName) && !sameName(legal, tenant.name ?? "") ? legal : null;
}

// A rent or an area of nought on the schedule means it is not recorded.
const recorded = (value: number | null) => (value != null && value > 0 ? value : null);
// The column is headed "Sq ft", so its cells are area()'s figure without the words.
const squareFeet = (value: number | null) => area(recorded(value)).replace(/ sq ft$/, "");

const th = "px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const td = "px-3 py-2";
const figure = "px-3 py-2 text-right font-mono tabular-nums";
const under = "block text-[11px] text-muted-foreground";
const amber = "text-amber-700 dark:text-amber-400";
const dash = <span className="text-muted-foreground">—</span>;

function Tag({ tone, title, children }: { tone: "amber" | "muted"; title: string; children: string }) {
  return <span className={cn(rowPill, "px-1.5", tone === "amber" ? `border-amber-500/60 ${amber}` : "border-border text-muted-foreground")} title={title}>{children}</span>;
}

// "#1234 Zara": the ref, then the deal's tenant or else its name. The stage is
// in the State pill, so it is not repeated here.
function DealLine({ deal, href }: { deal: PropertyUnitDeal; href: string | null }) {
  const who = deal.tenant || deal.name || (deal.ref ? null : href ? "Open deal" : "Unnamed deal");
  const title = [deal.type, deal.name].filter(Boolean).join(" · ") || undefined;
  const words = (
    <>
      {deal.ref ? <span className="shrink-0 font-mono tabular-nums text-muted-foreground">#{deal.ref}</span> : null}
      {who && <span className="max-w-[10rem] truncate">{who}</span>}
    </>
  );
  const line = "inline-flex max-w-full items-center gap-1.5 text-xs";
  return href
    ? <Link href={href} className={cn(line, "hover:underline")} title={title} data-testid={`property-unit-deal-link-${deal.id}`}>{words}</Link>
    : <span className={line} title={title}>{words}</span>;
}

interface LineProps {
  unit: PropertyUnit;
  label: string;        // the unit's name without the property's own name
  selected: boolean;
  today: string;
  onSelect: (unitId: string) => void;
}

// A table row. No hooks in here: with some 400 rows, a row is drawn again
// only when its own props change.
const UnitRow = memo(function UnitRow({ unit, label, selected, today, onSelect, hasPlans, dealLink, onHover }: LineProps & {
  hasPlans: boolean;
  dealLink: string | null;
  onHover: ((unitId: string | null) => void) | null;
}) {
  const { tenant, flags } = unit;
  const place = [unit.floor, unit.grouping].filter(Boolean).join(" · ");
  const briefTag = unit.occupancy === "vacant" || !!unit.stage;
  const notOnPlan = hasPlans && flags.notOnPlan;
  const lease = leaseName(tenant);
  const erv = recorded(unit.erv), quoting = recorded(unit.quotingRent);
  const event = leaseEvent(unit, today);
  const soon = !!event && flags.expiryOrBreakSoon;
  return (
    <tr
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      data-unit-id={unit.id}
      data-testid={`property-unit-row-${unit.id}`}
      className={cn("cursor-pointer border-t border-border focus-visible:-outline-offset-2", selected ? "bg-muted" : "hover:bg-muted/30")}
      // wouter's Link does not run its own onClick on a ctrl or cmd click, so
      // the row is what ignores a click that landed on the deal's link.
      onClick={e => { if (!(e.target as Element).closest("a")) onSelect(unit.id); }}
      onKeyDown={e => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        onSelect(unit.id);
      }}
      onPointerEnter={onHover ? () => onHover(unit.id) : undefined}
      onPointerLeave={onHover ? () => onHover(null) : undefined}
    >
      <td className={cn(td, "min-w-[10rem]")}>
        <span className="font-medium [overflow-wrap:anywhere]" title={unit.label}>{label}</span>
        {place && <span className={under}>{place}</span>}
        {(briefTag || flags.notOnSchedule || notOnPlan || flags.duplicateOutline) && (
          <span className="mt-1 flex flex-wrap gap-1">
            {briefTag && <UnitBriefTag brief={unit.brief} />}
            <UnitDealTag deal={unit.deal} />
            {flags.notOnSchedule && <Tag tone="amber" title={NOT_ON_SCHEDULE}>Not on schedule</Tag>}
            {notOnPlan && <Tag tone="muted" title={NOT_ON_PLAN}>Not on plan</Tag>}
            {flags.duplicateOutline && <Tag tone="amber" title="More than one outline on the same plan points at this unit">Drawn twice</Tag>}
          </span>
        )}
      </td>
      <td className={td}><UnitStatePill unit={unit} /></td>
      <td className={cn(td, "min-w-[9rem]")}>
        {tenant.name || dash}
        {lease && <span className={under}>Lease: {lease}</span>}
        {unit.use && <span className={under}>{unit.use}</span>}
      </td>
      <td className={td}>{unit.deal ? <DealLine deal={unit.deal} href={dealLink} /> : dash}</td>
      <td className={figure}>{squareFeet(unit.sqft)}</td>
      <td className={figure}>{money(recorded(unit.passingRent))}</td>
      <td className={figure}>{erv != null ? money(erv) : quoting != null ? <span title="Quoting rent">{money(quoting)}*</span> : "—"}</td>
      <td className={cn("px-3 py-2 text-xs whitespace-nowrap", soon && amber)} title={soon ? leaseDates(unit) : undefined}>
        {event ? <>{event.word} <span className="font-mono tabular-nums">{event.date}</span></> : dash}
      </td>
    </tr>
  );
});

// The same unit as two tight lines, for the narrow column beside the plan: a
// six-column table does not fit there, and a dozen units should show at once.
const UnitLine = memo(function UnitLine({ unit, label, selected, today, onSelect, hasPlans, dealLink, onHover }: LineProps & {
  hasPlans: boolean;
  dealLink: string | null;
  onHover: ((unitId: string | null) => void) | null;
}) {
  const { tenant, flags } = unit;
  const briefTag = unit.occupancy === "vacant" || !!unit.stage;
  const notOnPlan = hasPlans && flags.notOnPlan;
  const lease = leaseName(tenant);
  const erv = recorded(unit.erv), quoting = recorded(unit.quotingRent);
  const event = leaseEvent(unit, today);
  const soon = !!event && flags.expiryOrBreakSoon;
  const who = tenant.name || unit.use;
  const tags = flags.notOnSchedule || flags.duplicateOutline || !!unit.deal;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      data-unit-id={unit.id}
      data-testid={`property-unit-row-${unit.id}`}
      className={cn("cursor-pointer border-t border-border px-3 py-2 first:border-t-0 focus-visible:-outline-offset-2", selected ? "bg-muted" : "hover:bg-muted/30")}
      onClick={e => { if (!(e.target as Element).closest("a")) onSelect(unit.id); }}
      onKeyDown={e => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        onSelect(unit.id);
      }}
      onPointerEnter={onHover ? () => onHover(unit.id) : undefined}
      onPointerLeave={onHover ? () => onHover(null) : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-medium" title={unit.label}>{label}</span>
          {notOnPlan && <MapPinOff className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Not on the plan yet"><title>{NOT_ON_PLAN}</title></MapPinOff>}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {briefTag && <UnitBriefTag brief={unit.brief} />}
          <UnitDealTag deal={unit.deal} />
          <UnitStatePill unit={unit} />
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate" title={lease ? `Lease: ${lease}` : undefined}>{who || "—"}{lease ? ` · Lease: ${lease}` : ""}</span>
        <span className="shrink-0 whitespace-nowrap">
          {erv != null ? <span className="font-mono tabular-nums">{money(erv)}</span> : quoting != null ? <span className="font-mono tabular-nums" title="Quoting rent">{money(quoting)}*</span> : null}
          {event && <span className={cn(soon && amber)} title={soon ? leaseDates(unit) : undefined}>{erv != null || quoting != null ? " · " : ""}{event.word} <span className="font-mono tabular-nums">{event.date}</span></span>}
        </span>
      </div>
      {tags && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {unit.deal && <DealLine deal={unit.deal} href={dealLink} />}
          {flags.notOnSchedule && <Tag tone="amber" title={NOT_ON_SCHEDULE}>Not on schedule</Tag>}
          {flags.duplicateOutline && <Tag tone="amber" title="More than one outline on the same plan points at this unit">Drawn twice</Tag>}
        </div>
      )}
    </div>
  );
});

// The same unit as a card, for phones.
const UnitCard = memo(function UnitCard({ unit, label, selected, today, onSelect }: LineProps) {
  const who = unit.tenant.name || unit.use;
  const passing = recorded(unit.passingRent), erv = recorded(unit.erv);
  const rent = passing != null ? money(passing) : erv != null ? `ERV ${money(erv)}` : "";
  const event = leaseEvent(unit, today);
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      className={cn("block w-full space-y-1 rounded-2xl border border-border p-3 text-left text-sm", selected ? "bg-muted" : "bg-card")}
      onClick={() => onSelect(unit.id)}
      data-testid={`property-unit-card-${unit.id}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium" title={unit.label}>{label}</span>
        <span className="flex shrink-0 items-center gap-1"><UnitDealTag deal={unit.deal} /><UnitStatePill unit={unit} /></span>
      </span>
      {who && <span className="block truncate text-[11px] text-muted-foreground">{who}</span>}
      {(rent || event) && (
        <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">{rent}</span>
          {event && <span className={cn("whitespace-nowrap", unit.flags.expiryOrBreakSoon && amber)}>{event.word} <span className="font-mono tabular-nums">{event.date}</span></span>}
        </span>
      )}
    </button>
  );
});

export function PropertyUnitList({ feed, selectedUnitId, onSelectUnit, onHoverUnit, filter, onFilterChange, search, onSearchChange, dense = false, dealHref, className }: {
  feed: PropertyUnitsFeed;
  selectedUnitId: string | null;
  onSelectUnit: (unitId: string) => void;
  onHoverUnit?: (unitId: string | null) => void;
  filter: UnitFilter;
  onFilterChange: (filter: UnitFilter) => void;
  search: string;
  onSearchChange: (search: string) => void;
  dense?: boolean;
  dealHref?: (dealId: string) => string;
  className?: string;
}): JSX.Element {
  const pills = shownPills(feed);
  const [showWorkLists, setShowWorkLists] = useState(false);
  // A filter whose pill is no longer offered (its count fell to zero) shows
  // every unit.
  const active: UnitFilter = pills.some(pill => pill.key === filter) ? filter : "all";
  // Typing in the search box must not wait on hundreds of rows being drawn
  // again: the box follows each key at once, the rows catch up after.
  const deferredSearch = useDeferredValue(search);
  const rows = useMemo(() => filterUnits(feed.units, active, deferredSearch), [feed.units, active, deferredSearch]);
  const total = feed.units.length;
  // "Not on plan" is worth a tag once some units are on it; before that it would sit on every line.
  const hasPlans = feed.plans.length > 0 && feed.counts.onPlan > 0;
  const propertyName = feed.property.name;
  const labelOf = useCallback((unit: PropertyUnit) => unitDisplayLabel(unit.label, propertyName, unit.floor), [propertyName]);
  const today = LONDON_DAY.format(new Date());
  const desktop = useSyncExternalStore(watchDesktop, isDesktop);
  const empty = total === 0 ? "No units on the tenancy schedule yet." : "No units match.";

  // The rows are memoised, so they are given callbacks that never change;
  // these call whatever the host passed last.
  const host = useRef({ onSelectUnit, onHoverUnit, onFilterChange });
  useEffect(() => { host.current = { onSelectUnit, onHoverUnit, onFilterChange }; });
  const select = useCallback((unitId: string) => host.current.onSelectUnit(unitId), []);
  const hover = useCallback((unitId: string | null) => host.current.onHoverUnit?.(unitId), []);

  // The host is told once the list has fallen back to all units (after the
  // render, never during it), so the plan stops dimming for a filter that
  // nobody can see or switch off.
  useEffect(() => { if (active !== filter) host.current.onFilterChange(active); }, [active, filter]);

  // Bring the selected unit's row into view when the selection moves to one
  // that is outside the scroll box or under its sticky header.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const view = box.current;
    if (!view || !selectedUnitId) return;
    const row = Array.from(view.querySelectorAll<HTMLElement>("[data-unit-id]")).find(el => el.dataset.unitId === selectedUnitId);
    const at = row?.getBoundingClientRect();
    if (!row || !at || !at.height) return;
    const top = view.getBoundingClientRect().top + view.clientTop;
    const header = view.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    if (at.top < top + header - 1 || at.bottom > top + view.clientHeight + 1) row.scrollIntoView({ block: "nearest" });
  }, [selectedUnitId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="property-unit-list">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter units">
        {pills.filter(pill => showWorkLists || !WORK_LISTS.has(pill.key) || active === pill.key).map(pill => (
          <Pill key={pill.key} active={active === pill.key} aria-pressed={active === pill.key} title={pill.title} onClick={() => onFilterChange(pill.key)} data-testid={`property-unit-filter-${pill.key}`}>
            {pill.label} <PillCount n={pill.count} active={active === pill.key} />
          </Pill>
        ))}
        {pills.some(pill => WORK_LISTS.has(pill.key) && pill.key !== active) && (
          <button type="button" className="px-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline underline-offset-2" onClick={() => setShowWorkLists(value => !value)} aria-expanded={showWorkLists} data-testid="property-unit-more-filters">
            {showWorkLists ? "Fewer filters" : "More filters"}
          </button>
        )}
      </div>
      <Input placeholder="Search unit, tenant or use…" aria-label="Search units" value={search} onChange={e => onSearchChange(e.target.value)} className="max-w-md" data-testid="property-unit-search" />

      {/* Beside the plan: two lines a unit. */}
      {desktop !== false && dense && (
      <div ref={box} className={cn("hidden md:block rounded-lg border border-border overflow-y-auto", className ?? "max-h-[640px]")}>
        {rows.map(unit => (
          <UnitLine
            key={unit.id} unit={unit} label={labelOf(unit)} selected={unit.id === selectedUnitId} today={today} onSelect={select}
            hasPlans={hasPlans} dealLink={unit.deal && dealHref ? dealHref(unit.deal.id) : null} onHover={onHoverUnit ? hover : null}
          />
        ))}
        {rows.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{empty}</p>}
      </div>
      )}
      {/* Desktop table. scroll-pt keeps a row scrolled into view clear of the sticky header. */}
      {desktop !== false && !dense && (
      <div ref={box} className={cn("hidden md:block rounded-lg border border-border overflow-x-auto overflow-y-auto scroll-pt-10", className ?? "max-h-[640px]")}>
        <table className="w-full text-sm">
          <thead className="bg-muted sticky top-0 z-10">
            <tr>
              <th scope="col" className={cn(th, "text-left")}>Unit</th>
              <th scope="col" className={cn(th, "text-left")}>State</th>
              <th scope="col" className={cn(th, "text-left")}>Tenant</th>
              <th scope="col" className={cn(th, "text-left")}>Deal</th>
              <th scope="col" className={cn(th, "text-right")}>Sq ft</th>
              <th scope="col" className={cn(th, "text-right")}>Passing rent</th>
              <th scope="col" className={cn(th, "text-right")}>ERV</th>
              <th scope="col" className={cn(th, "text-left")}>Next event</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(unit => (
              <UnitRow
                key={unit.id} unit={unit} label={labelOf(unit)} selected={unit.id === selectedUnitId} today={today} onSelect={select}
                hasPlans={hasPlans} dealLink={unit.deal && dealHref ? dealHref(unit.deal.id) : null} onHover={onHoverUnit ? hover : null}
              />
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">{empty}</td></tr>}
          </tbody>
        </table>
      </div>
      )}
      {/* Phone cards */}
      {desktop !== true && (
      <div className="md:hidden space-y-2">
        {rows.map(unit => <UnitCard key={unit.id} unit={unit} label={labelOf(unit)} selected={unit.id === selectedUnitId} today={today} onSelect={select} />)}
        {rows.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>}
      </div>
      )}

      {total > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Showing <span className="font-mono tabular-nums">{rows.length}</span> of <span className="font-mono tabular-nums">{total}</span> {total === 1 ? "unit" : "units"}
        </p>
      )}
    </div>
  );
}
