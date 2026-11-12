import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Ban, Building2, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, ExternalLink, Mail, MapPin, Phone, UserX } from "lucide-react";
import { calendarDateValue } from "@shared/calendar-date";
import { viewingMissingDetails, viewingNeedsOutcome, type ViewingOptions, type ViewingRecord, type ViewingStatus } from "@shared/viewing-workflow";
import { apiRequest } from "@/lib/queryClient";
import { localBrandLogoUrl } from "@/lib/company-logos";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Pill, pillActive, pillInactive, pillMetrics } from "@/components/ui/pill";

// The viewings calendar follows the team calendar (pages/calendar.tsx): a time
// grid with overlap layout, a now line, a mini month and an upcoming list.
// Viewing dates and times are UK wall-clock strings ("2026-11-12", "10:30"),
// so everything here works on those strings and never converts time zones.
// leasing-viewings.tsx holds the data, filters and the edit form and imports
// only components from this file: its regression harness stubs every import,
// so the few date helpers both files need are written out in each.

export type CalendarView = "day" | "workWeek" | "week" | "month";

// An hour is 48px beside the detail panel so 08:00 to 19:00 fits a laptop
// screen; a phone scrolls the page anyway, so its hours are taller and each
// block has room for the people line.
const HOUR_HEIGHT = 48;
const PHONE_HOUR_HEIGHT = 60;
const DAY_START = 8;
const DAY_END = 19;
const DEFAULT_MINUTES = 60;
const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const statusLabels: Record<string, string> = { scheduled: "Scheduled", completed: "Attended", cancelled: "Cancelled", no_show: "No-show", not_leasing: "Not a leasing viewing" };

const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const londonNowMinutes = () => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const part = (type: string) => Number(parts.find(p => p.type === type)?.value || 0);
  return part("hour") * 60 + part("minute");
};
const shiftDate = (value: string, days: number) => { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const weekOf = (value: string) => shiftDate(value, -((new Date(`${value}T12:00:00Z`).getUTCDay() + 6) % 7));
const formatDay = (value: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const dateLabel = (value: string, weekday = false) => calendarDateValue(value) === value ? formatDay(value, { day: "numeric", month: "short", ...(value.slice(0, 4) !== londonToday().slice(0, 4) ? { year: "numeric" as const } : {}), ...(weekday ? { weekday: "short" as const } : {}) }) : "Date needed";
const fullDateLabel = (value: string) => calendarDateValue(value) === value ? formatDay(value, { weekday: "short", day: "numeric", month: "short", year: "numeric" }).replace(",", "") : "Date needed";
const isWeekend = (value: string) => [0, 6].includes(new Date(`${value}T12:00:00Z`).getUTCDay());
const monthStart = (value: string) => `${value.slice(0, 7)}-01`;
const shiftMonth = (value: string, months: number) => { const d = new Date(`${monthStart(value)}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10); };

function viewDates(anchor: string, view: CalendarView): string[] {
  if (view === "day") return [anchor];
  if (view === "month") {
    const first = monthStart(anchor);
    const days: string[] = [];
    for (let day = first; day.slice(0, 7) === first.slice(0, 7); day = shiftDate(day, 1)) days.push(day);
    return days;
  }
  const monday = weekOf(anchor);
  return Array.from({ length: view === "workWeek" ? 5 : 7 }, (_, i) => shiftDate(monday, i));
}

function stepAnchor(anchor: string, view: CalendarView, direction: number): string {
  if (view === "day") return shiftDate(anchor, direction);
  if (view === "month") return shiftMonth(anchor, direction);
  return shiftDate(anchor, direction * 7);
}

function rangeLabel(anchor: string, view: CalendarView, today: string): string {
  if (view === "day") return `${anchor === today ? "Today, " : ""}${fullDateLabel(anchor)}`;
  if (view === "month") return formatDay(anchor, { month: "long", year: "numeric" });
  const dates = viewDates(anchor, view);
  const first = dates[0], last = dates[dates.length - 1];
  const end = formatDay(last, { day: "numeric", month: "short", year: "numeric" });
  if (first.slice(0, 7) === last.slice(0, 7)) return `${Number(first.slice(8))} – ${end}`;
  return `${formatDay(first, { day: "numeric", month: "short", ...(first.slice(0, 4) !== last.slice(0, 4) ? { year: "numeric" as const } : {}) })} – ${end}`;
}

const viewingNeedsDetails = (v: ViewingRecord) => !["not_leasing", "cancelled", "no_show"].includes(v.status) && (viewingMissingDetails(v).length > 0 || v.issues.length > 0);

function viewingMinutes(v: Pick<ViewingRecord, "viewingTime">): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)/.exec(v.viewingTime || "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
const timeText = (v: Pick<ViewingRecord, "viewingTime">) => { const minutes = viewingMinutes(v); return minutes == null ? null : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; };
const sortViewings = (a: ViewingRecord, b: ViewingRecord) => a.viewingDate.localeCompare(b.viewingDate) || (viewingMinutes(a) ?? -1) - (viewingMinutes(b) ?? -1) || a.id.localeCompare(b.id);
const firstName = (name: string | null | undefined) => (name || "").trim().split(/\s+/)[0] || "";
const initialsOf = (name: string | null | undefined) => { const parts = (name || "").trim().split(/\s+/).filter(Boolean); return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase(); };
const brandText = (v: ViewingRecord) => v.companyName || "Brand to confirm";
const placeText = (v: ViewingRecord) => [v.unitName, v.propertyName].filter(Boolean).join(" · ") || v.sourceDetails?.subject || "Unit to confirm";
const peopleShort = (v: ViewingRecord) => [v.contactName ? firstName(v.contactName) : null, v.agentContactName ? `${firstName(v.agentContactName)} (agent)` : null, v.ownerName ? initialsOf(v.ownerName) : null].filter(Boolean).join(" · ");
const peopleLong = (v: ViewingRecord) => [v.contactName, v.agentContactName ? `${v.agentContactName} (agent)` : null, v.ownerName ? `${v.ownerName} (BGP)` : null].filter(Boolean).join(" · ");

// Status colours come from the theme tokens only: the primary accent for a
// booked viewing, ink for one that happened, destructive for a no-show, and
// muted for the two that no longer count.
const statusTint: Record<ViewingStatus, string> = { scheduled: "bg-primary/10", completed: "bg-foreground/10", no_show: "bg-destructive/10", cancelled: "bg-muted", not_leasing: "bg-transparent" };
const statusBar: Record<ViewingStatus, string> = { scheduled: "border-l-primary", completed: "border-l-foreground", no_show: "border-l-destructive", cancelled: "border-l-muted-foreground/40", not_leasing: "border border-dashed border-border" };
const statusText: Record<ViewingStatus, string> = { scheduled: "text-foreground", completed: "text-foreground", no_show: "text-foreground", cancelled: "text-muted-foreground line-through", not_leasing: "text-muted-foreground" };

// The status icon repeats what the block's colour says; where space is short
// (month chips) only the two "needs attention" marks are drawn.
function StatusMarks({ v, today, attentionOnly = false }: { v: ViewingRecord; today: string; attentionOnly?: boolean }) {
  return <span className="ml-auto flex shrink-0 items-center gap-0.5">
    {!attentionOnly && v.status === "completed" && <Check className="h-3 w-3" aria-label="Attended" />}
    {!attentionOnly && v.status === "no_show" && <UserX className="h-3 w-3 text-destructive" aria-label="No-show" />}
    {!attentionOnly && v.status === "cancelled" && <Ban className="h-3 w-3 text-muted-foreground" aria-label="Cancelled" />}
    {viewingNeedsDetails(v) && <AlertCircle className="h-3 w-3 text-primary" aria-label="Details missing" />}
    {viewingNeedsOutcome(v, today) && <Clock3 className="h-3 w-3 text-primary" aria-label="Outcome due" />}
  </span>;
}

const blockTitle = (v: ViewingRecord, today: string) => [timeText(v) || "No time set", brandText(v), placeText(v), peopleLong(v), statusLabels[v.status], viewingNeedsDetails(v) ? "Details missing" : null, viewingNeedsOutcome(v, today) ? "Outcome due" : null].filter(Boolean).join(" · ");

interface PlacedViewing { viewing: ViewingRecord; startMin: number; endMin: number; col: number; totalCols: number }

// Copied from the team calendar's computeEventLayout: viewings share width
// only with the viewings they actually overlap, cluster by cluster.
function computeViewingLayout(dayViewings: ViewingRecord[]): PlacedViewing[] {
  const timed = dayViewings.flatMap(viewing => {
    const startMin = viewingMinutes(viewing);
    return startMin == null ? [] : [{ viewing, startMin, endMin: Math.min(startMin + DEFAULT_MINUTES, 24 * 60) }];
  }).sort((a, b) => a.startMin - b.startMin || a.viewing.id.localeCompare(b.viewing.id));
  const layout: PlacedViewing[] = [];
  let cluster: typeof timed = [];
  let clusterEnd = -1;
  const flushCluster = () => {
    if (!cluster.length) return;
    const colEnds: number[] = [];
    const start = layout.length;
    for (const item of cluster) {
      let col = colEnds.findIndex(end => item.startMin >= end);
      if (col === -1) { colEnds.push(item.endMin); col = colEnds.length - 1; }
      else colEnds[col] = item.endMin;
      layout.push({ ...item, col, totalCols: 0 });
    }
    for (let i = start; i < layout.length; i++) layout[i].totalCols = colEnds.length;
    cluster = [];
  };
  for (const item of timed) {
    if (cluster.length && item.startMin >= clusterEnd) flushCluster();
    clusterEnd = cluster.length ? Math.max(clusterEnd, item.endMin) : item.endMin;
    cluster.push(item);
  }
  flushCluster();
  return layout;
}

function ViewingBlock({ item, startHour, hourHeight, today, selected, tight, onSelect }: { item: PlacedViewing; startHour: number; hourHeight: number; today: string; selected: boolean; tight: number; onSelect: (v: ViewingRecord) => void }) {
  const { viewing: v, startMin, endMin, col, totalCols } = item;
  const top = ((startMin - startHour * 60) / 60) * hourHeight;
  const height = Math.max(22, ((endMin - startMin) / 60) * hourHeight - 2);
  const width = 100 / totalCols;
  // In a slim block the time takes its own line so the brand keeps the full width.
  const stacked = totalCols > tight;
  const lines = Math.max(1, Math.floor((height - 6) / 13));
  const people = peopleShort(v);
  return <button type="button" onClick={() => onSelect(v)} title={blockTitle(v, today)} aria-label={blockTitle(v, today)} aria-pressed={selected} data-testid={`viewings-block-${v.id}`}
    className={cn("absolute overflow-hidden rounded-[4px] border-l-[3px] bg-card px-1.5 py-[3px] text-left text-[11px] leading-[13px] transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", statusBar[v.status], selected && "z-10 shadow-md ring-2 ring-foreground")}
    style={{ top: `${top}px`, height: `${height}px`, left: `${col * width}%`, width: `calc(${width}% - 4px)`, marginLeft: "2px" }}>
    <span className={cn("pointer-events-none absolute inset-0", statusTint[v.status])} aria-hidden />
    <span className="relative block">
      <span className="flex items-center gap-1">
        <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{timeText(v)}</span>
        {!stacked && <span className={cn("min-w-0 truncate font-bold", statusText[v.status])}>{brandText(v)}</span>}
        <StatusMarks v={v} today={today} />
      </span>
      {stacked && lines >= 2 && <span className={cn("block truncate font-bold", statusText[v.status])}>{brandText(v)}</span>}
      {lines >= (stacked ? 3 : 2) && <span className="block truncate text-muted-foreground">{placeText(v)}</span>}
      {lines >= (stacked ? 4 : 3) && people && <span className="block truncate text-foreground/80">{people}</span>}
    </span>
  </button>;
}

function ViewingChip({ v, today, selected, onSelect, testId, showTime, marks }: { v: ViewingRecord; today: string; selected: boolean; onSelect: (v: ViewingRecord) => void; testId: string; showTime: boolean; marks: boolean }) {
  return <button type="button" onClick={() => onSelect(v)} title={blockTitle(v, today)} aria-label={blockTitle(v, today)} aria-pressed={selected} data-testid={testId}
    className={cn("relative flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-[4px] border-l-[3px] bg-card px-1.5 py-[3px] text-left text-[11px] leading-[14px] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", statusBar[v.status], selected && "ring-2 ring-foreground")}>
    <span className={cn("pointer-events-none absolute inset-0", statusTint[v.status])} aria-hidden />
    <span className={cn("relative min-w-0 flex-1 truncate font-bold", statusText[v.status])}>{brandText(v)}</span>
    {showTime && timeText(v) && <span className="relative shrink-0 text-[10px] tabular-nums text-muted-foreground">{timeText(v)}</span>}
    {marks && <span className="relative flex shrink-0"><StatusMarks v={v} today={today} attentionOnly={showTime} /></span>}
  </button>;
}

function useLondonNow() {
  const [minutes, setMinutes] = useState(londonNowMinutes);
  useEffect(() => {
    const timer = window.setInterval(() => setMinutes(londonNowMinutes()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return minutes;
}

interface CalendarProps {
  anchor: string; view: CalendarView; today: string; viewings: ViewingRecord[]; selectedId: string | null;
  onSelect: (v: ViewingRecord) => void; onOpenDay: (date: string) => void; onAnchor: (date: string) => void;
  narrow: boolean; filtered: boolean; onClearFilters: () => void;
}

function EmptyState({ anchor, view, viewings, filtered, onAnchor, onClearFilters }: Pick<CalendarProps, "anchor" | "view" | "viewings" | "filtered" | "onAnchor" | "onClearFilters">) {
  const dates = viewDates(anchor, view);
  const start = dates[0], end = dates[dates.length - 1];
  const dated = viewings.filter(v => calendarDateValue(v.viewingDate) === v.viewingDate).sort(sortViewings);
  const later = dated.find(v => v.viewingDate > end);
  const earlier = [...dated].reverse().find(v => v.viewingDate < start);
  const period = view === "day" ? "on this day" : view === "month" ? "this month" : "this week";
  return <div className="space-y-3" data-testid="viewings-empty">
    <CalendarDays className="mx-auto h-6 w-6 text-muted-foreground" />
    <p className="text-sm">{filtered ? `No matching viewings ${period}.` : `No viewings ${period}. Log one from a unit's Viewings, or they arrive from Outlook.`}</p>
    {(later || earlier || filtered) && <div className="flex flex-wrap justify-center gap-2">
      {later && <Button variant="outline" size="sm" onClick={() => onAnchor(later.viewingDate)} data-testid="viewings-empty-next">Next viewing: {dateLabel(later.viewingDate)}</Button>}
      {!later && earlier && <Button variant="outline" size="sm" onClick={() => onAnchor(earlier.viewingDate)} data-testid="viewings-empty-last">Last viewing: {dateLabel(earlier.viewingDate)}</Button>}
      {filtered && <Button variant="ghost" size="sm" onClick={onClearFilters} data-testid="viewings-empty-clear">Clear filters</Button>}
    </div>}
  </div>;
}

const viewNames: Record<CalendarView, string> = { day: "Day", workWeek: "Work week", week: "Week", month: "Month" };

// Previous / next / Today, the date range as the heading and the view pills.
// While a queue ("Needs details", "Outcomes due") is open its name is the
// heading; stepping or picking a view goes back to the calendar. A phone
// leaves out Work week: five columns read no better there than seven.
export function ViewingsToolbar({ anchor, view, today, viewings, list, compact, onAnchor, onView, children }: {
  anchor: string; view: CalendarView; today: string; viewings: ViewingRecord[]; list: { title: string; count: number } | null; compact: boolean;
  onAnchor: (date: string) => void; onView: (view: CalendarView) => void; children?: ReactNode;
}) {
  const dates = viewDates(anchor, view);
  const count = list ? list.count : viewings.filter(v => v.viewingDate >= dates[0] && v.viewingDate <= dates[dates.length - 1]).length;
  const unit = view === "day" ? "day" : view === "month" ? "month" : "week";
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="viewings-toolbar">
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onAnchor(stepAnchor(anchor, view, -1))} aria-label={`Previous ${unit}`} data-testid="viewings-prev"><ChevronLeft className="h-4 w-4" /></Button>
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onAnchor(stepAnchor(anchor, view, 1))} aria-label={`Next ${unit}`} data-testid="viewings-next"><ChevronRight className="h-4 w-4" /></Button>
      <Button variant="outline" size="sm" className="h-8" onClick={() => onAnchor(today)} data-testid="viewings-today">Today</Button>
    </div>
    <div className="min-w-0 flex-1 basis-44">
      <h2 className="truncate text-sm font-semibold" data-testid="viewings-range">{list ? list.title : rangeLabel(anchor, view, today)}</h2>
      <p className="text-[11px] text-muted-foreground"><span className="font-mono tabular-nums">{count}</span> {count === 1 ? "viewing" : "viewings"} · times are UK time</p>
    </div>
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Calendar view">
      {(["day", "workWeek", "week", "month"] as const).filter(mode => !compact || mode !== "workWeek" || view === "workWeek").map(mode => <Pill key={mode} active={!list && view === mode} aria-pressed={!list && view === mode} onClick={() => onView(mode)} data-testid={`viewings-view-${mode}`}>{viewNames[mode]}</Pill>)}
    </div>
    {children}
  </div>;
}

function DayHeading({ date, today, narrow, onOpenDay }: { date: string; today: string; narrow: boolean; onOpenDay: (date: string) => void }) {
  const isToday = date === today;
  // As on the team calendar, a weekend "today" stays bold but does not take the accent.
  const accent = isToday && !isWeekend(date);
  return <button type="button" onClick={() => onOpenDay(date)} aria-label={`Open ${fullDateLabel(date)}`} data-testid={`viewings-day-heading-${date}`}
    className={cn("min-w-0 flex-1 border-l border-border py-1 text-center hover:bg-muted/50", isToday && "bg-primary/5")}>
    <span className={cn("block text-[10px] uppercase tracking-wider", accent ? "font-bold text-primary" : isToday ? "font-bold text-muted-foreground" : "font-medium text-muted-foreground")}>{formatDay(date, { weekday: narrow ? "narrow" : "short" })}</span>
    <span className={cn("block text-lg leading-tight", accent ? "font-bold text-primary" : isToday ? "font-bold" : "font-semibold")}>{Number(date.slice(8))}</span>
  </button>;
}

export function ViewingsTimeGrid({ anchor, view, today, viewings, selectedId, onSelect, onOpenDay, onAnchor, narrow, filtered, onClearFilters, contained }: CalendarProps & { contained: boolean }) {
  const nowMinutes = useLondonNow();
  const dates = useMemo(() => viewDates(anchor, view), [anchor, view]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => dates.map(date => {
    const dayViewings = viewings.filter(v => v.viewingDate === date);
    return { date, count: dayViewings.length, placed: computeViewingLayout(dayViewings), untimed: dayViewings.filter(v => viewingMinutes(v) == null).sort(sortViewings) };
  }), [dates, viewings]);
  const placedAll = days.flatMap(day => day.placed);
  // 08:00 to 19:00 always shows. The grid starts earlier when a viewing is
  // booked earlier and runs on (scrolling) for one booked later, so nothing
  // is ever off the board.
  const startHour = Math.min(DAY_START, ...placedAll.map(p => Math.floor(p.startMin / 60)));
  const endHour = Math.max(DAY_END, ...placedAll.map(p => Math.ceil(p.endMin / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const hasUntimed = days.some(day => day.untimed.length > 0);
  const isEmpty = days.every(day => day.count === 0);
  const hourHeight = narrow ? PHONE_HOUR_HEIGHT : HOUR_HEIGHT;
  const nowTop = ((nowMinutes - startHour * 60) / 60) * hourHeight;
  const firstDate = dates[0];
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [firstDate, dates.length]);
  const gutter = narrow ? "w-11" : "w-12";

  return <div className="flex min-w-0 flex-1 flex-col" data-testid="viewings-time-grid">
    {dates.length > 1 && <div className="flex shrink-0 border-b border-border">
      <div className={cn("shrink-0", gutter)} />
      {dates.map(date => <DayHeading key={date} date={date} today={today} narrow={narrow} onOpenDay={onOpenDay} />)}
    </div>}
    {hasUntimed && <div className="flex shrink-0 border-b border-border" data-testid="viewings-untimed-strip">
      <div className={cn("flex shrink-0 items-center justify-end pr-1.5 text-right text-[10px] leading-tight text-muted-foreground", gutter)}>{narrow ? "No time" : "No time set"}</div>
      {days.map(day => <div key={day.date} className={cn("min-w-0 flex-1 space-y-0.5 border-l border-border px-0.5 py-1", day.date === today && "bg-primary/5")}>
        {day.untimed.map(v => <ViewingChip key={v.id} v={v} today={today} selected={selectedId === v.id} onSelect={onSelect} testId={`viewings-untimed-${v.id}`} showTime={false} marks={!narrow || dates.length === 1} />)}
      </div>)}
    </div>}
    <div ref={scrollRef} className={cn("relative", contained && "overflow-y-auto overflow-x-hidden")} style={contained ? { maxHeight: `${(DAY_END - DAY_START) * hourHeight + 16}px` } : undefined} data-testid="viewings-grid-scroll">
      <div className="relative box-content flex pt-3 pb-1" style={{ height: `${hours.length * hourHeight}px` }}>
        <div className={cn("relative shrink-0", gutter)}>
          {hours.map(hour => <div key={hour} className="absolute w-full pr-1.5 text-right" style={{ top: `${(hour - startHour) * hourHeight}px` }}>
            <span className="-mt-[7px] block font-mono text-[10px] tabular-nums text-muted-foreground">{String(hour).padStart(2, "0")}:00</span>
          </div>)}
        </div>
        {days.map(day => <div key={day.date} className={cn("relative min-w-0 flex-1 border-l border-border", day.date === today ? "bg-primary/[0.04]" : isWeekend(day.date) && "bg-muted/30")} data-testid={`viewings-day-column-${day.date}`}>
          {hours.map(hour => <div key={hour} className="absolute w-full border-t border-border/60" style={{ top: `${(hour - startHour) * hourHeight}px`, height: `${hourHeight}px` }}>
            <div className="absolute w-full border-t border-dashed border-border/40" style={{ top: `${hourHeight / 2}px` }} />
          </div>)}
          {day.date === today && nowTop >= 0 && nowTop <= hours.length * hourHeight && <div className="pointer-events-none absolute left-0 right-0 z-20 flex items-center" style={{ top: `${nowTop}px` }} data-testid="viewings-now-line">
            <div className="-ml-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
            <div className="h-[2px] flex-1 bg-primary" />
          </div>}
          {day.placed.map(item => <ViewingBlock key={item.viewing.id} item={item} startHour={startHour} hourHeight={hourHeight} today={today} selected={selectedId === item.viewing.id} tight={Math.floor((narrow ? 2 : 5) / dates.length)} onSelect={onSelect} />)}
        </div>)}
        {isEmpty && <div className="pointer-events-none absolute inset-0 flex items-start justify-center px-4 pt-24">
          <div className="pointer-events-auto max-w-sm rounded-lg border border-border bg-card p-5 text-center shadow-sm"><EmptyState anchor={anchor} view={view} viewings={viewings} filtered={filtered} onAnchor={onAnchor} onClearFilters={onClearFilters} /></div>
        </div>}
      </div>
    </div>
  </div>;
}

export function ViewingsMonthGrid({ anchor, view, today, viewings, selectedId, onSelect, onOpenDay, onAnchor, narrow, filtered, onClearFilters }: CalendarProps) {
  const month = anchor.slice(0, 7);
  const weeks = useMemo(() => {
    const out: string[][] = [];
    for (let monday = weekOf(monthStart(anchor)); monday.slice(0, 7) <= month; monday = shiftDate(monday, 7)) out.push(Array.from({ length: 7 }, (_, i) => shiftDate(monday, i)));
    return out;
  }, [anchor, month]);
  const byDay = useMemo(() => {
    const map = new Map<string, ViewingRecord[]>();
    for (const v of [...viewings].sort(sortViewings)) map.set(v.viewingDate, [...(map.get(v.viewingDate) || []), v]);
    return map;
  }, [viewings]);
  const isEmpty = !viewings.some(v => v.viewingDate.slice(0, 7) === month);
  const most = narrow ? 0 : 3;
  return <div className="flex min-w-0 flex-1 flex-col" data-testid="viewings-month-grid">
    <div className="grid grid-cols-7 border-b border-border">
      {weeks[0].map(date => <div key={date} className="border-l border-border py-1.5 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground first:border-l-0">{formatDay(date, { weekday: narrow ? "narrow" : "short" })}</div>)}
    </div>
    {weeks.map(week => <div key={week[0]} className="grid grid-cols-7 border-b border-border last:border-b-0">
      {week.map(date => {
        const dayViewings = byDay.get(date) || [];
        const outside = date.slice(0, 7) !== month;
        return <div key={date} className={cn("min-w-0 border-l border-border p-1 first:border-l-0", narrow ? "min-h-[56px]" : "min-h-[104px]", date === today ? "bg-primary/[0.04]" : outside && "bg-muted/30")} data-testid={`viewings-month-day-${date}`}>
          <button type="button" onClick={() => onOpenDay(date)} aria-label={`Open ${fullDateLabel(date)}, ${dayViewings.length} viewings`} data-testid={`viewings-month-open-${date}`}
            className={cn("flex h-6 min-w-6 items-center justify-center rounded-full px-1 font-mono text-[11px] tabular-nums hover:bg-muted", date === today ? "bg-primary font-bold text-primary-foreground hover:bg-primary" : outside ? "text-muted-foreground/60" : "text-foreground")}>{Number(date.slice(8))}</button>
          {narrow ? dayViewings.length > 0 && <button type="button" onClick={() => onOpenDay(date)} aria-label={`${dayViewings.length} viewings on ${fullDateLabel(date)}`} className="mt-1 flex w-full items-center justify-center gap-1 font-mono text-[11px] tabular-nums text-foreground" data-testid={`viewings-month-count-${date}`}><span className="h-1.5 w-1.5 rounded-full bg-primary" />{dayViewings.length}</button>
            : <div className="mt-1 space-y-0.5">
              {dayViewings.slice(0, most).map(v => <ViewingChip key={v.id} v={v} today={today} selected={selectedId === v.id} onSelect={onSelect} testId={`viewings-month-chip-${v.id}`} showTime marks />)}
              {dayViewings.length > most && <button type="button" onClick={() => onOpenDay(date)} className="w-full rounded px-1.5 py-0.5 text-left text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground" data-testid={`viewings-month-more-${date}`}>Show all <span className="font-mono tabular-nums">{dayViewings.length}</span></button>}
            </div>}
        </div>;
      })}
    </div>)}
    {isEmpty && <div className="border-t border-border p-6 text-center"><EmptyState anchor={anchor} view={view} viewings={viewings} filtered={filtered} onAnchor={onAnchor} onClearFilters={onClearFilters} /></div>}
  </div>;
}

export function ViewingsDayStrip({ anchor, today, viewings, onSelectDate }: { anchor: string; today: string; viewings: ViewingRecord[]; onSelectDate: (date: string) => void }) {
  const monday = weekOf(anchor);
  return <div className="grid grid-cols-7 gap-1" data-testid="viewings-day-strip">
    {Array.from({ length: 7 }, (_, i) => shiftDate(monday, i)).map(day => {
      const count = viewings.filter(v => v.viewingDate === day).length;
      return <button key={day} type="button" onClick={() => onSelectDate(day)} aria-pressed={anchor === day} aria-label={`${fullDateLabel(day)}, ${count} viewings`} data-testid={`viewings-strip-${day}`}
        className={cn("min-w-0 rounded-lg border py-1.5 text-center", anchor === day ? "border-primary bg-primary text-primary-foreground" : day === today ? "border-primary bg-primary/5" : "border-border bg-card")}>
        <span className="block text-[11px]">{formatDay(day, { weekday: "short" })}</span>
        <span className="block font-mono text-sm tabular-nums">{Number(day.slice(8))}</span>
        <span className="flex h-3 items-center justify-center">{count > 0 && <span className={cn("font-mono text-[10px] tabular-nums", anchor === day ? "text-primary-foreground" : "text-muted-foreground")}>{count}</span>}</span>
      </button>;
    })}
  </div>;
}

export function ViewingsMiniMonth({ anchor, today, viewings, onSelectDate }: { anchor: string; today: string; viewings: ViewingRecord[]; onSelectDate: (date: string) => void }) {
  const [month, setMonth] = useState(() => monthStart(anchor));
  useEffect(() => { setMonth(monthStart(anchor)); }, [anchor]);
  const withViewings = useMemo(() => new Set(viewings.map(v => v.viewingDate)), [viewings]);
  const days = viewDates(month, "month");
  const lead = (new Date(`${month}T12:00:00Z`).getUTCDay() + 6) % 7;
  return <div className="px-3 py-3" data-testid="viewings-mini-month">
    <div className="mb-2 flex items-center justify-between">
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" data-testid="viewings-mini-prev"><ChevronLeft className="h-3.5 w-3.5" /></Button>
      <span className="text-xs font-semibold">{formatDay(month, { month: "long", year: "numeric" })}</span>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month" data-testid="viewings-mini-next"><ChevronRight className="h-3.5 w-3.5" /></Button>
    </div>
    <div className="mx-auto grid max-w-[280px] grid-cols-7">
      {["M", "T", "W", "T", "F", "S", "S"].map((letter, i) => <div key={i} className="py-1 text-center text-[10px] font-medium text-muted-foreground">{letter}</div>)}
      {Array.from({ length: lead }, (_, i) => <div key={`lead-${i}`} />)}
      {days.map(day => <button key={day} type="button" data-no-min-touch onClick={() => onSelectDate(day)} aria-label={`${fullDateLabel(day)}${withViewings.has(day) ? ", has viewings" : ""}`} aria-pressed={day === anchor} data-testid={`viewings-mini-day-${day}`}
        className={cn("relative mx-auto flex h-8 w-8 items-center justify-center rounded-full font-mono text-[11px] tabular-nums transition-colors", day === anchor ? "bg-primary font-bold text-primary-foreground" : day === today ? "font-bold text-primary hover:bg-muted" : "hover:bg-muted")}>
        {Number(day.slice(8))}
        {withViewings.has(day) && day !== anchor && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-primary" />}
      </button>)}
    </div>
  </div>;
}

export function ViewingsComingUp({ viewings, today, selectedId, onSelect }: { viewings: ViewingRecord[]; today: string; selectedId: string | null; onSelect: (v: ViewingRecord) => void }) {
  const nowMinutes = useLondonNow();
  const upcoming = useMemo(() => viewings.filter(v => {
    if (v.status !== "scheduled" || calendarDateValue(v.viewingDate) !== v.viewingDate) return false;
    const minutes = viewingMinutes(v);
    return v.viewingDate > today || (v.viewingDate === today && (minutes == null || minutes + DEFAULT_MINUTES >= nowMinutes));
  }).sort(sortViewings).slice(0, 10), [viewings, today, nowMinutes]);
  return <div className="border-t border-border" data-testid="viewings-coming-up">
    <div className="flex items-center justify-between px-3 py-2">
      <p className={labelClass}>Coming up</p>
      {upcoming.length > 0 && <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{upcoming.length}</span>}
    </div>
    {upcoming.length === 0 ? <p className="px-3 pb-4 text-[11px] text-muted-foreground">No viewings booked from today onwards.</p> : <div className="space-y-0.5 px-1.5 pb-2">
      {upcoming.map(v => <button key={v.id} type="button" onClick={() => onSelect(v)} aria-pressed={selectedId === v.id} data-testid={`viewings-upcoming-${v.id}`}
        className={cn("flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-muted/60", selectedId === v.id && "bg-muted")}>
        <span className="w-[52px] shrink-0 pt-px">
          <span className="block text-[11px] font-semibold">{v.viewingDate === today ? "Today" : dateLabel(v.viewingDate)}</span>
          <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">{timeText(v) || "No time"}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1"><span className="truncate text-sm font-semibold leading-tight">{brandText(v)}</span><StatusMarks v={v} today={today} /></span>
          <span className="block truncate text-[11px] text-muted-foreground">{placeText(v)}</span>
          {peopleLong(v) && <span className="block truncate text-[11px] text-foreground/80">{peopleLong(v)}</span>}
        </span>
      </button>)}
    </div>}
  </div>;
}

export function ViewingsLegend() {
  const swatch = (status: ViewingStatus) => <span className={cn("relative inline-block h-3 w-4 overflow-hidden rounded-[3px] border-l-[3px] bg-card align-middle", statusBar[status])}><span className={cn("absolute inset-0", statusTint[status])} /></span>;
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" data-testid="viewings-legend">
    {(["scheduled", "completed", "no_show", "cancelled", "not_leasing"] as const).map(status => <span key={status} className="inline-flex items-center gap-1.5">{swatch(status)}<span className={status === "cancelled" ? "line-through" : undefined}>{statusLabels[status]}</span></span>)}
    <span className="inline-flex items-center gap-1"><AlertCircle className="h-3 w-3 text-primary" />Details missing</span>
    <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3 text-primary" />Outcome due</span>
  </div>;
}

// Single-choice filter as a pill trigger (docs/DESIGN.md §5): filled while a
// choice narrows the calendar, quiet outline otherwise.
export function ViewingsFilterPill({ label, allLabel, value, options, onChange, testId }: { label: string; allLabel: string; value: string; options: { id: string; label: string }[]; onChange: (id: string) => void; testId: string }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const current = options.find(option => option.id === value);
  const shown = term.trim() ? options.filter(option => option.label.toLowerCase().includes(term.trim().toLowerCase())) : options;
  const pick = (id: string) => { onChange(id); setOpen(false); setTerm(""); };
  const row = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted";
  return <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setTerm(""); }}>
    <PopoverTrigger asChild>
      <button type="button" data-no-min-touch aria-label={current ? `${label}: ${current.label}` : `Filter viewings by ${label.toLowerCase()}`} className={cn(pillMetrics, "max-w-[220px]", value ? pillActive : pillInactive)} data-testid={testId}>
        <span className="truncate">{current ? current.label : label}</span><ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-64 p-0">
      {options.length > 8 && <div className="border-b border-border p-2"><Input value={term} onChange={e => setTerm(e.target.value)} placeholder={`Find ${label.toLowerCase()}`} aria-label={`Find ${label.toLowerCase()}`} className="h-8 text-sm" data-testid={`${testId}-search`} /></div>}
      <div className="max-h-72 overflow-y-auto p-1">
        <button type="button" className={cn(row, !value && "font-semibold")} onClick={() => pick("")} data-testid={`${testId}-all`}><Check className={cn("h-3.5 w-3.5 shrink-0", value && "invisible")} />{allLabel}</button>
        {shown.map(option => <button key={option.id} type="button" className={cn(row, option.id === value && "font-semibold")} onClick={() => pick(option.id)} data-testid={`${testId}-option-${option.id}`}><Check className={cn("h-3.5 w-3.5 shrink-0", option.id !== value && "invisible")} /><span className="truncate">{option.label}</span></button>)}
        {shown.length === 0 && <p className="px-2 py-2 text-[11px] text-muted-foreground">No matches.</p>}
      </div>
    </PopoverContent>
  </Popover>;
}

interface ContactDetail { id: string; name: string; role: string | null; email: string | null; phone: string | null; phoneMobile: string | null; companyName: string | null }
interface BrandDetail { id: string; name: string; companyType: string | null; domain: string | null; domainUrl: string | null }

// A lookup that is refused (a client login outside its slice) simply leaves
// the name on its own; the viewing record already carries every name. The
// key is this panel's own, so a refusal cached here as null is never read by
// a screen that fetches the same record and expects it whole.
function useLookup<T>(path: string, id: string | null) {
  return useQuery<T | null>({
    queryKey: ["viewing-panel-lookup", path, id], enabled: !!id, staleTime: 5 * 60_000, refetchInterval: false, retry: false,
    queryFn: async () => { try { return await (await apiRequest("GET", `${path}/${encodeURIComponent(id || "")}`)).json() as T; } catch { return null; } },
  }).data ?? null;
}

function BrandMark({ name, domain }: { name: string; domain: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const library = useQuery<{ hasLogos: boolean }>({ queryKey: ["/api/brand-logo-stats"], staleTime: Infinity, refetchInterval: false, retry: false }).data;
  // The logo endpoint serves approved logos from the brand library only, so
  // ask it only once the library has some; the initial shows until then.
  const src = library?.hasLogos ? localBrandLogoUrl(name, domain) : null;
  return <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-base font-bold text-muted-foreground" aria-hidden>
    {name.charAt(0).toUpperCase()}
    {src && failed !== src && <img key={src} src={src} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full bg-white object-contain" onLoad={e => { if (e.currentTarget.naturalWidth <= 1) setFailed(src); }} onError={() => setFailed(src)} />}
  </span>;
}

function PersonRow({ label, name, detail, email, phones, missing, testId }: { label: string; name: string | null; detail?: string | null; email?: string | null; phones?: (string | null | undefined)[]; missing: string; testId: string }) {
  const numbers = Array.from(new Set((phones || []).filter((phone): phone is string => !!phone?.trim())));
  return <div className="flex gap-3" data-testid={testId}>
    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold", name ? "bg-foreground/10 text-foreground" : "border border-dashed border-border text-muted-foreground")} aria-hidden>{name ? initialsOf(name) : "?"}</span>
    <div className="min-w-0 flex-1">
      <p className={labelClass}>{label}</p>
      {name ? <p className="break-words text-base font-semibold leading-snug">{name}</p> : <p className="text-sm text-muted-foreground">{missing}</p>}
      {name && detail && <p className="break-words text-xs text-muted-foreground">{detail}</p>}
      {name && (email || numbers.length > 0) && <div className="mt-1 flex flex-col items-start gap-0.5">
        {email && <a href={`mailto:${email}`} className="inline-flex max-w-full items-center gap-1.5 py-0.5 text-sm text-primary hover:underline" data-testid={`${testId}-email`}><Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{email}</span></a>}
        {numbers.map(number => <a key={number} href={`tel:${number.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5 py-0.5 font-mono text-sm tabular-nums text-primary hover:underline" data-testid={`${testId}-phone`}><Phone className="h-3.5 w-3.5 shrink-0" />{number}</a>)}
      </div>}
    </div>
  </div>;
}

// The read view of one viewing: who is coming, for which brand, to see what.
export function ViewingSummary({ viewing: v, today, options, siblings, onSelect }: { viewing: ViewingRecord; today: string; options: ViewingOptions; siblings: ViewingRecord[]; onSelect: (v: ViewingRecord) => void }) {
  const brand = useLookup<BrandDetail>("/api/crm/companies", v.companyId);
  const contact = useLookup<ContactDetail>("/api/crm/contacts", v.contactId);
  const agent = useLookup<ContactDetail>("/api/crm/contacts", v.agentContactId);
  const listed = (id: string | null) => options.contacts.find(c => c.id === id);
  const owner = options.owners.find(o => o.id === v.ownerUserId);
  const category = (brand?.companyType || "").replace(/^tenant\s*-\s*/i, "");
  const fromOutlook = v.source === "diary" || !!v.sourceDetails?.subject;
  const chip = "rounded-full border border-border px-2 py-1 text-[11px] leading-none";
  return <div className="space-y-4" data-testid="viewings-summary">
    <div className="flex items-start gap-3">
      <BrandMark name={brandText(v)} domain={brand?.domainUrl || brand?.domain || null} />
      <div className="min-w-0 flex-1">
        <p className={labelClass}>Brand</p>
        <h3 className={cn("break-words text-lg font-semibold leading-tight", !v.companyName && "text-muted-foreground")} data-testid="viewings-summary-brand">{brandText(v)}</h3>
        {(category || v.companyId) && <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">{category && <span>{category}</span>}{v.companyId && <a href={`/companies/${encodeURIComponent(v.companyId)}`} className="inline-flex items-center gap-1 text-primary hover:underline" data-testid="viewings-summary-brand-link">Brand page<ExternalLink className="h-3 w-3" /></a>}</p>}
      </div>
    </div>
    <div className="flex flex-wrap gap-1.5">
      <span className={cn(chip, v.status === "cancelled" && "line-through", v.status === "no_show" && "border-destructive text-destructive")} data-testid="viewings-summary-status">{statusLabels[v.status]}</span>
      {v.outcome && <span className={chip} data-testid="viewings-summary-outcome">{v.outcome}</span>}
      {viewingNeedsDetails(v) && <span className={cn(chip, "border-primary/50 text-primary")}>Details missing</span>}
      {viewingNeedsOutcome(v, today) && <span className={cn(chip, "border-primary/50 text-primary")}>Outcome due</span>}
    </div>
    <div className="space-y-2 text-sm">
      <p className="flex items-start gap-2"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span><span className="font-medium">{fullDateLabel(v.viewingDate)}</span>{v.viewingDate === today && <span className="text-muted-foreground"> · today</span>}<br /><span className="font-mono tabular-nums">{timeText(v) || "No time set"}</span>{timeText(v) && <span className="text-muted-foreground"> UK time</span>}</span></p>
      <p className="flex items-start gap-2"><Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0"><span className="break-words font-medium">{v.unitName || "Unit to confirm"}</span><br /><span className="break-words text-muted-foreground">{v.propertyName || "Property to confirm"}</span>{v.sqft != null && <span className="whitespace-nowrap text-muted-foreground"> · <span className="font-mono tabular-nums">{v.sqft.toLocaleString("en-GB")}</span> sq ft</span>}{v.unitId && <><br /><a href={`/available?unitId=${encodeURIComponent(v.unitId)}&propertyId=${encodeURIComponent(v.propertyId || "")}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline" data-testid="viewings-summary-unit-link">Tracker unit<ExternalLink className="h-3 w-3" /></a></>}</span></p>
    </div>
    <div className="space-y-3 border-t border-border pt-4" data-testid="viewings-summary-people">
      <PersonRow label="Brand contact" name={v.contactName} detail={contact?.role} email={contact?.email || listed(v.contactId)?.email} phones={[contact?.phoneMobile, contact?.phone]} missing="No brand contact recorded" testId="viewings-person-contact" />
      <PersonRow label="Agent for the brand" name={v.agentContactName} detail={[agent?.role, agent?.companyName].filter(Boolean).join(" · ")} email={agent?.email || listed(v.agentContactId)?.email} phones={[agent?.phoneMobile, agent?.phone]} missing="No agent recorded" testId="viewings-person-agent" />
      <PersonRow label="BGP" name={v.ownerName} detail={owner?.team || v.team} missing="No BGP owner assigned" testId="viewings-person-owner" />
    </div>
    {(v.notes || v.nextAction || v.followUpDate) && <div className="space-y-3 border-t border-border pt-4">
      {v.notes && <div><p className={labelClass}>Notes</p><p className="mt-1 whitespace-pre-wrap break-words text-sm" data-testid="viewings-summary-notes">{v.notes}</p></div>}
      {(v.nextAction || v.followUpDate) && <div><p className={labelClass}>Next action</p><p className="mt-1 break-words text-sm" data-testid="viewings-summary-next">{v.nextAction || "Follow up"}{v.followUpDate && <span className="text-muted-foreground"> · by {dateLabel(v.followUpDate)}</span>}</p></div>}
    </div>}
    {siblings.length > 0 && <div className="border-t border-border pt-4"><p className={labelClass}>Also on this visit</p><div className="mt-1 flex flex-wrap gap-1.5">{siblings.map(other => <Button key={other.id} variant="outline" size="sm" onClick={() => onSelect(other)} data-testid={`viewings-summary-sibling-${other.id}`}>{other.unitName || "Unit to confirm"}</Button>)}</div></div>}
    <div className="border-t border-border pt-4 text-sm" data-testid="viewings-summary-source">
      <p className={labelClass}>Source</p>
      <p className="mt-1">{fromOutlook ? "From the Outlook calendar" : "Logged by hand"}</p>
      {/* The invitation's wording, place and guest list are BGP's own diary: the server leaves sourceDetails out for client logins, and the guest list follows it. */}
      {v.sourceDetails?.subject && <>
        <p className="mt-1 break-words text-muted-foreground">{v.sourceDetails.subject}</p>
        {v.sourceDetails.location && <p className="mt-1 flex items-start gap-1.5 text-[11px] text-muted-foreground"><MapPin className="mt-px h-3 w-3 shrink-0" /><span className="break-words">{v.sourceDetails.location}</span></p>}
        {v.attendees && <p className="mt-1 break-words text-[11px] text-muted-foreground">Invited: {v.attendees}</p>}
      </>}
    </div>
  </div>;
}
