// Everything the app knows about one unit, in one panel: "click on a unit and
// have it all there" on the plan-led property page
// (docs/property-page-rebuild-2026-11-13.md). It opens beside the plan and the
// list (variant "side"), and for a building with one unit it is the body of
// the page (variant "page").
//
// The header and the key figures are drawn at once from the feed's line
// (GET /api/properties/:id/units). The lease, the letting, the other deals,
// the plan lines and the notes come from GET /api/properties/:id/units/:unitId
// through usePropertyUnitDetail. The server decides what a login may read; the
// viewer flags here only decide which links and buttons are offered.
import { Fragment, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { Link } from "wouter";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { rowPill } from "@/components/landsec/deal-clock";
import { cn, countLabel } from "@/lib/utils";
import { calendarDateValue } from "@shared/calendar-date";
import { statusLabelsFor } from "@shared/letting-rules";
import { namedTenant, type PropertyUnit, type PropertyUnitDeal, type PropertyUnitDetail, type PropertyUnitPlan } from "@shared/property-units";
import { area, money, plainError, shortDate, unitDisplayLabel, usePropertyUnitDetail } from "./use-property-page";
import { UnitBriefTag, UnitStatePill } from "./unit-state";

type Viewer = { staff: boolean; landsecView: boolean; restricted: boolean };
type Fact = [label: string, value: ReactNode];
type Schedule = NonNullable<PropertyUnitDetail["schedule"]>;

const TARGET_CHIPS = 12;
const heading = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const subLabel = "text-[11px] font-medium text-muted-foreground";
const figure = "font-mono tabular-nums";
// A link drawn as a button is not a <button>, so it gets the phone tap height itself.
const linkButton = "max-md:min-h-11";

// The lists this page replaces read a zero as "not recorded", so a zero is not a value here either.
const positive = (value: number | null | undefined): value is number => value != null && value > 0;
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
// The same rule as the unit list's deal links (plan-workspace.tsx): the deal page is for BGP staff and the Landsec view.
const linksDeals = (viewer: Viewer) => !viewer.restricted && (viewer.staff || viewer.landsecView);

// The schedule keeps the break party as T, L or M; anything else is shown as typed.
const BREAK_PARTIES: Record<string, string> = { T: "Tenant break", L: "Landlord break", M: "Mutual break" };
const breakParty = (value: string | null) => (value ? BREAK_PARTIES[value.trim().toUpperCase()] || value : null);

// The viewings calendar's own words for a viewing's status.
const VIEWING_STATUS_WORDS: Record<string, string> = {
  scheduled: "Scheduled", completed: "Attended", cancelled: "Cancelled", no_show: "No-show", not_leasing: "Not a leasing viewing",
};
const viewingStatus = (status: string | null) => (status ? VIEWING_STATUS_WORDS[status] || status : null);
// An older offer may say "Accepted" or nothing at all: the negotiation log reads those as Agreed and Pending.
const offerStatus = (status: string | null) => (status === "Accepted" ? "Agreed" : status || "Pending");

// The tracker, viewings, offers and the schedule's break notice keep their
// dates as text. A value that is a calendar date is formatted; anything else
// ("Immediately", "6 months") is shown as typed, never guessed at.
const WRITTEN_DATE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/;
function TextDate({ value, withDay }: { value: string; withDay?: boolean }) {
  const day = WRITTEN_DATE.test(value.trim()) ? calendarDateValue(value.trim()) : null;
  return day ? <span className={figure}>{shortDate(day, withDay)}</span> : <>{value}</>;
}

// A formatted measure ("4,803 sq ft", "9 months") as its figure and its unit:
// the figure is set in mono, the unit in the body face (docs/DESIGN.md, part 16).
const measureParts = (text: string): [amount: string, unit: string] => {
  const gap = text.indexOf(" ");
  return gap < 0 ? [text, ""] : [text.slice(0, gap), text.slice(gap + 1)];
};
function Measure({ text }: { text: string }) {
  const [amount, unit] = measureParts(text);
  return <><span className={figure}>{amount}</span>{unit && ` ${unit}`}</>;
}

// "12 Oct 2026 · Nando's · Interested": the parts that have a value, with a dot between them.
function Dotted({ parts }: { parts: ReactNode[] }) {
  const shown = parts.filter(part => part != null && part !== false && part !== "");
  return (
    <>
      {shown.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="text-muted-foreground"> · </span>}
          {part}
        </Fragment>
      ))}
    </>
  );
}

function Block({ title, card, children }: { title: string; card: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn("min-w-0 space-y-2", card ? "rounded-lg border border-border bg-card p-3" : "border-t border-border pt-3 first:border-t-0 first:pt-0")}
    >
      <h3 id={id} className={heading}>{title}</h3>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: Fact[] }) {
  return (
    <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

// Stat tiles (docs/DESIGN.md, part 8): information, not buttons. Each tile
// carries its own label, so the block's heading is for screen readers.
function KeyFigures({ unit, wide }: { unit: PropertyUnit; wide: boolean }) {
  const id = useId();
  const tiles: Array<{ label: string; amount: string; unit: string }> = [];
  if (positive(unit.sqft)) {
    const [amount, sizeUnit] = measureParts(area(unit.sqft));
    tiles.push({ label: "Size", amount, unit: sizeUnit });
  }
  if (positive(unit.passingRent)) tiles.push({ label: "Passing rent", amount: money(unit.passingRent), unit: "a year" });
  if (positive(unit.erv)) tiles.push({ label: "ERV", amount: money(unit.erv), unit: "a year" });
  if (positive(unit.quotingRent)) tiles.push({ label: "Quoting rent", amount: money(unit.quotingRent), unit: "a year" });
  if (!tiles.length) return null;
  return (
    <section aria-labelledby={id} data-testid="property-unit-key-figures">
      <h3 id={id} className="sr-only">Key figures</h3>
      <dl className={cn("grid grid-cols-2 gap-2", wide && "sm:grid-cols-4")}>
        {tiles.map(tile => (
          <div key={tile.label} className="min-w-0 rounded-lg border border-border bg-card px-2.5 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{tile.label}</dt>
            <dd className="mt-0.5 break-words text-base font-semibold leading-tight">
              <span className={figure}>{tile.amount}</span>
              {tile.unit && <span className="text-[11px] font-normal text-muted-foreground"> {tile.unit}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// A deal as a line: its reference and name (a link where the viewer has the
// deal page), then its tenant. A deal other than the unit's own also says its
// stage, since the unit's state pill does not speak for it.
function DealLine({ deal, link, withStage }: { deal: PropertyUnitDeal; link: boolean; withStage?: boolean }) {
  const name = (
    <>
      {deal.ref != null && <><span className={figure}>#{deal.ref}</span>{" "}</>}
      {deal.name || "Deal"}
    </>
  );
  const stage = withStage && deal.code ? statusLabelsFor(deal.type)[deal.code] : null;
  const days = withStage && deal.days != null ? <><Measure text={countLabel(deal.days, "day")} /> at this stage</> : null;
  return (
    <div className="min-w-0 text-sm" data-testid={`property-unit-deal-${deal.id}`}>
      <p className="break-words">
        {link
          ? <Link href={`/deals/${deal.id}`} className="font-medium text-primary hover:underline" data-testid={`property-unit-deal-link-${deal.id}`}>{name}</Link>
          : <span className="font-medium">{name}</span>}
        {deal.tenant && <><span className="text-muted-foreground"> · </span>{deal.tenant}</>}
      </p>
      {(deal.type || stage || days) && <p className="text-[11px] text-muted-foreground"><Dotted parts={[deal.type, stage, days]} /></p>}
    </div>
  );
}

function LeaseBlock({ unit, schedule, card, onOpenSchedule }: {
  unit: PropertyUnit; schedule: Schedule; card: boolean; onOpenSchedule?: (scheduleRowId: string) => void;
}) {
  const day = (value: string) => <span className={figure}>{shortDate(value, true)}</span>;
  const sum = (value: number) => <span className={figure}>{money(value)}</span>;
  const size = (value: number) => <Measure text={area(value)} />;
  const party = breakParty(schedule.breakType);
  // "Landlord break" with nothing else beside it only repeats the Landlord break row below.
  const partyRepeatsLandlordRow = party === BREAK_PARTIES.L && !!unit.landlordBreakDate;
  const rows: Fact[] = [];
  if (unit.leaseStart) rows.push(["Start", day(unit.leaseStart)]);
  if (unit.leaseExpiry) rows.push(["Expiry", day(unit.leaseExpiry)]);
  if (unit.breakDate || schedule.breakNotice || schedule.breakDetails || (party && !partyRepeatsLandlordRow)) {
    rows.push(["Break", (
      <>
        <Dotted parts={[unit.breakDate && day(unit.breakDate), party]} />
        {schedule.breakNotice && <span className="block text-xs text-muted-foreground">Notice: <TextDate value={schedule.breakNotice} withDay /></span>}
        {schedule.breakDetails && <span className="block whitespace-pre-wrap text-xs text-muted-foreground">{schedule.breakDetails}</span>}
      </>
    )]);
  }
  if (unit.landlordBreakDate) rows.push(["Landlord break", day(unit.landlordBreakDate)]);
  if (unit.nextReview || schedule.reviewBasis) rows.push(["Next review", <Dotted parts={[unit.nextReview && day(unit.nextReview), schedule.reviewBasis]} />]);
  if (positive(schedule.termYears)) rows.push(["Term", <Measure text={countLabel(schedule.termYears, "year")} />]);
  if (schedule.outsideLtAct) rows.push(["Lease Act", schedule.outsideLtAct]);
  if (positive(schedule.serviceCharge)) rows.push(["Service charge", sum(schedule.serviceCharge)]);
  if (positive(schedule.insurance)) rows.push(["Insurance", sum(schedule.insurance)]);
  if (positive(schedule.ratesPayable)) rows.push(["Rates payable", sum(schedule.ratesPayable)]);
  if (positive(schedule.rateableValue)) rows.push(["Rateable value", sum(schedule.rateableValue)]);
  if (positive(schedule.rentPsf)) rows.push(["Rent per sq ft", sum(schedule.rentPsf)]);
  // The schedule's own column: the figure as stored, with the % in the label.
  if (positive(schedule.turnoverPercent)) rows.push(["Turnover rent %", <span className={figure}>{schedule.turnoverPercent.toLocaleString("en-GB", { maximumFractionDigits: 2 })}</span>]);
  if (positive(schedule.niaSqft)) rows.push(["NIA", size(schedule.niaSqft)]);
  if (positive(schedule.giaSqft)) rows.push(["GIA", size(schedule.giaSqft)]);
  if (positive(schedule.itzaSqft)) rows.push(["ITZA", size(schedule.itzaSqft)]);
  const rowId = unit.scheduleRowId;
  return (
    <Block title="Lease" card={card}>
      {rows.length > 0 ? <Facts rows={rows} /> : <p className="text-sm text-muted-foreground">No lease details recorded.</p>}
      {rowId && onOpenSchedule && (
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenSchedule(rowId)} data-testid="property-unit-open-schedule">
          Edit on the tenancy schedule
        </Button>
      )}
    </Block>
  );
}

function LettingBlock({ propertyId, unit, detail, viewer, card }: {
  propertyId: string; unit: PropertyUnit; detail: PropertyUnitDetail; viewer: Viewer; card: boolean;
}) {
  const { tracker, brief } = detail;
  if (!unit.stage && !unit.deal && !tracker && !unit.flags.vacantNoLetting) return null;

  const facts: Fact[] = [];
  if (tracker) {
    if (positive(tracker.quotingRent)) {
      facts.push(["Quoting rent", (
        <>
          <span className={figure}>{money(tracker.quotingRent)}</span> a year
          {tracker.rentOnApplication && <span className="block text-xs text-muted-foreground">Shown as rent on application</span>}
        </>
      )]);
    } else if (tracker.rentOnApplication) {
      facts.push(["Quoting rent", "Rent on application"]);
    }
    if (tracker.leaseTerms) facts.push(["Lease terms", <span className="whitespace-pre-wrap">{tracker.leaseTerms}</span>]);
    // The tracker records a month for this, not a day.
    if (tracker.availableDate) facts.push(["Available from", <TextDate value={tracker.availableDate} />]);
    if (tracker.marketingStartDate) facts.push(["Marketing since", <TextDate value={tracker.marketingStartDate} withDay />]);
    facts.push(["On the website", tracker.onWebsite ? "Yes" : "No"]);
  }

  const targets = brief?.targets || [];
  const briefExpected = !!brief || !!unit.brief || unit.occupancy === "vacant" || !!unit.stage;
  const viewings = tracker?.viewings || [];
  const offers = tracker?.offers || [];

  const landsecViewer = viewer.landsecView || viewer.restricted;
  const unitPageHref = landsecViewer && unit.scheduleRowId ? `/landsec/unit/${unit.scheduleRowId}` : null;
  // The link other screens use to open one tracker unit (the viewings calendar, the brands that fit a vacant unit).
  const trackerHref = !landsecViewer && viewer.staff && unit.trackerId
    ? `/available?unitId=${encodeURIComponent(unit.trackerId)}&propertyId=${encodeURIComponent(propertyId)}`
    : null;

  return (
    <Block title="Letting" card={card}>
      {unit.flags.vacantNoLetting && <p className="text-sm" data-testid="property-unit-no-letting">Vacant, and no letting has been started.</p>}
      {unit.deal && <DealLine deal={unit.deal} link={linksDeals(viewer)} />}
      {facts.length > 0 && <Facts rows={facts} />}

      {briefExpected && (
        <div className="space-y-1.5" data-testid="property-unit-brief">
          <h4 className={subLabel}>Brief</h4>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <UnitBriefTag brief={unit.brief} />
            {brief?.title && <span className="min-w-0 break-words text-sm">{brief.title}</span>}
          </div>
          {targets.length > 0 && (
            <ul className="flex flex-wrap items-center gap-1" aria-label="Target brands">
              {targets.slice(0, TARGET_CHIPS).map(target => (
                <li key={target.id} className={cn(rowPill, "max-w-full border-border")} title={target.name}>
                  <span className="truncate">{target.name}</span>
                </li>
              ))}
              {targets.length > TARGET_CHIPS && (
                <li className="text-[11px] text-muted-foreground">+<span className={figure}>{targets.length - TARGET_CHIPS}</span> more</li>
              )}
            </ul>
          )}
        </div>
      )}

      {viewings.length > 0 && (
        <div className="space-y-1" data-testid="property-unit-viewings">
          <h4 className={subLabel}>Viewings</h4>
          <ul className="space-y-1">
            {viewings.map(viewing => {
              const result = viewing.outcome || viewingStatus(viewing.status);
              return (
                <li key={viewing.id} className="break-words text-sm">
                  <Dotted parts={[
                    viewing.date && <TextDate value={viewing.date} withDay />,
                    viewing.company && <span className="font-medium">{viewing.company}</span>,
                    viewing.contact,
                    result && <span className="text-muted-foreground">{result}</span>,
                  ]} />
                </li>
              );
            })}
          </ul>
          {unit.counts.viewings > viewings.length && (
            <p className="text-[11px] text-muted-foreground">
              The latest <span className={figure}>{viewings.length}</span> of <span className={figure}>{unit.counts.viewings}</span> viewings.
            </p>
          )}
        </div>
      )}

      {offers.length > 0 && (
        <div className="space-y-1" data-testid="property-unit-offers">
          <h4 className={subLabel}>Offers</h4>
          <ul className="space-y-1">
            {offers.map(offer => (
              <li key={offer.id} className="break-words text-sm">
                <Dotted parts={[
                  offer.date && <TextDate value={offer.date} withDay />,
                  offer.company && <span className="font-medium">{offer.company}</span>,
                  positive(offer.rentPa) && <><span className={figure}>{money(offer.rentPa)}</span> a year</>,
                  offer.rentFreeMonths != null && (offer.rentFreeMonths > 0
                    ? <><Measure text={countLabel(offer.rentFreeMonths, "month")} /> rent free</>
                    : "no rent free"),
                  positive(offer.termYears) && <><span className={figure}>{offer.termYears.toLocaleString("en-GB")}</span> year term</>,
                  <span className="text-muted-foreground">{offerStatus(offer.status)}</span>,
                ]} />
              </li>
            ))}
          </ul>
          {unit.counts.offers > offers.length && (
            <p className="text-[11px] text-muted-foreground">
              The latest <span className={figure}>{offers.length}</span> of <span className={figure}>{unit.counts.offers}</span> offers.
            </p>
          )}
        </div>
      )}

      {(unitPageHref || trackerHref) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {unitPageHref && (
            <Button asChild variant="outline" size="sm" className={linkButton}>
              <Link href={unitPageHref} data-testid="property-unit-open-unit-page">Open the unit page</Link>
            </Button>
          )}
          {trackerHref && (
            <Button asChild variant="outline" size="sm" className={linkButton}>
              <Link href={trackerHref} data-testid="property-unit-open-tracker">Open on the Letting Tracker</Link>
            </Button>
          )}
        </div>
      )}
    </Block>
  );
}

function PlanBlock({ unit, outlines, plans, viewer, card, onShowOnPlan, onFindOnPlan }: {
  unit: PropertyUnit; outlines: PropertyUnitDetail["outlines"]; plans: PropertyUnitPlan[]; viewer: Viewer; card: boolean;
  onShowOnPlan?: (planId: string, outlineId: string) => void; onFindOnPlan?: (scheduleRowId: string) => void;
}) {
  if (!outlines.length && !plans.length) return null;
  const rowId = unit.scheduleRowId;
  return (
    <Block title="Plan" card={card}>
      {outlines.length > 0 ? (
        <ul className="space-y-1.5">
          {outlines.map(outline => (
            <li key={outline.outlineId} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 break-words">Drawn on {outline.floor}</span>
              {/* Only one of the property's plans can be shown: an outline on any other plan keeps its line, without the button. */}
              {onShowOnPlan && plans.some(plan => plan.id === outline.planId) && (
                <Button
                  type="button" variant="outline" size="sm" className="shrink-0"
                  onClick={() => onShowOnPlan(outline.planId, outline.outlineId)}
                  data-testid="property-unit-show-on-plan"
                >
                  Show on plan
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Not on the plan yet.</p>
          {viewer.staff && rowId && onFindOnPlan && (
            <Button type="button" variant="outline" size="sm" onClick={() => onFindOnPlan(rowId)} data-testid="property-unit-find-on-plan">
              Find it on the plan
            </Button>
          )}
        </div>
      )}
    </Block>
  );
}

function NotesBlock({ schedule, card }: { schedule: Schedule; card: boolean }) {
  if (!schedule.comments && !schedule.leasingComments) return null;
  return (
    <Block title="Notes" card={card}>
      {schedule.comments && (
        <div>
          <h4 className={subLabel}>Comments</h4>
          <p className="whitespace-pre-wrap break-words text-sm">{schedule.comments}</p>
        </div>
      )}
      {schedule.leasingComments && (
        <div>
          <h4 className={subLabel}>Leasing comments</h4>
          <p className="whitespace-pre-wrap break-words text-sm">{schedule.leasingComments}</p>
        </div>
      )}
    </Block>
  );
}

export function PropertyUnitPanel({ propertyId, propertyName, unit, plans, viewer, variant, onClose, onShowOnPlan, onFindOnPlan, onOpenSchedule }: {
  propertyId: string;
  propertyName?: string | null;       // dropped from the unit's name in the heading
  unit: PropertyUnit;
  plans: PropertyUnitPlan[];
  viewer: { staff: boolean; landsecView: boolean; restricted: boolean };
  variant: "side" | "page";
  onClose?: () => void;
  onShowOnPlan?: (planId: string, outlineId: string) => void;
  onFindOnPlan?: (scheduleRowId: string) => void;
  onOpenSchedule?: (scheduleRowId: string) => void;
}): JSX.Element {
  const side = variant === "side";
  const card = !side;
  const detail = usePropertyUnitDetail(propertyId, unit.id);
  const data = detail.data;
  const otherDeals = data ? data.deals.filter(deal => deal.id !== unit.deal?.id) : [];
  const titleId = useId();
  const root = useRef<HTMLElement>(null);
  // The side panel stays mounted while another unit is picked, so each unit starts at the top.
  useLayoutEffect(() => { if (root.current) root.current.scrollTop = 0; }, [unit.id]);

  const place = [unit.floor, unit.grouping].filter(Boolean).join(" · ");
  const tenant = unit.tenant;
  const legalName = namedTenant(tenant.legalName);
  const leaseName = legalName && tenant.tradingName && !sameName(legalName, tenant.tradingName) && !sameName(legalName, tenant.name || "") ? legalName : null;

  // While the detail loads, the blocks the feed's line already promises are drawn with skeleton lines.
  const loadingTitles: string[] = [];
  if (unit.scheduleRowId) loadingTitles.push("Lease");
  if (unit.stage || unit.deal || unit.trackerId || unit.flags.vacantNoLetting) loadingTitles.push("Letting");
  if (unit.outlines.length > 0 || plans.length > 0) loadingTitles.push("Plan");
  const blocks = side ? "space-y-3" : "grid gap-4 lg:grid-cols-2";

  return (
    <section
      ref={root}
      aria-labelledby={titleId}
      className={cn("min-w-0", side && "h-full overflow-y-auto bg-background")}
      data-testid="property-unit-panel"
    >
      <header className={cn("space-y-1", side ? "sticky top-0 z-10 border-b border-border bg-background px-3 py-2.5" : "pb-3")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 id={titleId} className="min-w-0 break-words text-lg font-semibold leading-tight" title={unit.label}>{unitDisplayLabel(unit.label, propertyName, unit.floor)}</h2>
              <UnitStatePill unit={unit} />
            </div>
            {place && <p className="text-[11px] text-muted-foreground">{place}</p>}
          </div>
          {side && onClose && (
            <Button
              type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 max-md:h-11 max-md:w-11"
              aria-label="Close unit" title="Close unit" onClick={() => onClose()} data-testid="property-unit-panel-close"
            >
              <X aria-hidden />
            </Button>
          )}
        </div>
        {tenant.name && (
          <p className="break-words text-sm font-medium" data-testid="property-unit-tenant">
            {tenant.companyId && viewer.staff
              ? <Link href={`/companies/${tenant.companyId}`} className="text-primary hover:underline" data-testid="property-unit-tenant-link">{tenant.name}</Link>
              : tenant.name}
          </p>
        )}
        {leaseName && <p className="break-words text-xs text-muted-foreground">Lease in the name of {leaseName}</p>}
        {unit.flags.notOnSchedule && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs" data-testid="property-unit-not-on-schedule">
            On the Letting Tracker but not on the tenancy schedule. Add it to the schedule to record its lease.
          </p>
        )}
      </header>

      <div className={cn("space-y-4", side && "px-3 py-3")}>
        <KeyFigures unit={unit} wide={!side} />
        {data ? (
          <div className={blocks}>
            {data.schedule && <LeaseBlock unit={unit} schedule={data.schedule} card={card} onOpenSchedule={onOpenSchedule} />}
            <LettingBlock propertyId={propertyId} unit={unit} detail={data} viewer={viewer} card={card} />
            {otherDeals.length > 0 && (
              <Block title="Other deals on this unit" card={card}>
                <ul className="space-y-2">
                  {otherDeals.map(deal => (
                    <li key={deal.id}><DealLine deal={deal} link={linksDeals(viewer)} withStage /></li>
                  ))}
                </ul>
              </Block>
            )}
            <PlanBlock unit={unit} outlines={data.outlines} plans={plans} viewer={viewer} card={card} onShowOnPlan={onShowOnPlan} onFindOnPlan={onFindOnPlan} />
            {data.schedule && <NotesBlock schedule={data.schedule} card={card} />}
          </div>
        ) : detail.isError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2" title={plainError(detail.error)} data-testid="property-unit-error">
            <p className="text-sm text-muted-foreground">The rest of this unit's details could not be loaded.</p>
            <Button type="button" variant="outline" size="sm" disabled={detail.isFetching} onClick={() => { void detail.refetch(); }} data-testid="property-unit-retry">
              Retry
            </Button>
          </div>
        ) : (
          <div className={blocks} aria-busy="true" data-testid="property-unit-loading">
            {loadingTitles.map(title => (
              <Block key={title} title={title} card={card}>
                <div className="space-y-2" aria-hidden>
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </Block>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
