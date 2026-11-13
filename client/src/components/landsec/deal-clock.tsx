// The Landsec deal clock, in one place (docs/landsec-menu-plan-2026-11-12.md,
// part 4): the stage chip, days at stage, who a deal is waiting on, what it
// depends on, its Net Effective Rent and the check against the brief's floor.
// The Deals page, its board, the deal page, the unit page and the older
// Lettings and scheme pages all draw these from here, so a deal reads the
// same wherever it is opened.
//
// The figures come from GET /api/landsec/deals (the clock feed), which is
// already limited to the schemes the viewer can see. A deal that is not on a
// scheme property is not in the feed and has no clock.
//
// "Waiting on" is linked to the deal checklist (Woody, 2026-11-13;
// shared/deal-waiting.ts): the editor picks an open item on the deal's
// checklist, or types a new one, and the party and name default from the
// item's responsible person. A deal nobody has set a waiting-on for shows the
// one read from its checklist ("from the checklist"); it counts as named in
// every filter and count here.
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowDownWideNarrow, Clock, ListChecks, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill, PillCount } from "@/components/ui/pill";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBrand } from "@/lib/brand-context";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DEAL_STATUS_LABELS, type DealStatusCode } from "@shared/deal-status";
import {
  LANDSEC_WAITING_PARTIES, LANDSEC_STUCK_DAYS, RESTRICTED_LANDSEC_ROLES, landsecIsStuck, landsecInNegotiation,
  type LandsecBriefCheck, type LandsecNer,
} from "@shared/landsec";
import { CHECKLIST_SIDES, CHECKLIST_STAGES } from "@shared/deal-checklist";
import { WAITING_NEW_ITEM, waitingLinkFields, waitingNamed, type WaitingClock, type WaitingOptions } from "@shared/deal-waiting";
import { londonDay, stageDaysLabel, stageDaysTitle } from "@shared/stage-since";
import { LETTING_STATUS_LABELS } from "@shared/letting-rules";

export interface ClockDeal {
  id: string; ref: number | null; name: string; dealType: string | null; tenant: string | null; jointAgent: string | null;
  scheme: { key: string; name: string } | null; propertyId: string; unitId: string | null; unit: string | null; trackerId?: string | null;
  code: DealStatusCode | null; since: string | null; days: number | null; waitingDays: number | null;
  // Days at stage (shared/stage-since.ts): false when the app does not know
  // when the deal reached its stage; the date a person set, while it applies.
  stageConfirmed?: boolean; stageSet?: StageSet | null;
  clock: WaitingClock | null; ner: LandsecNer | null; incentivesRecorded?: boolean;
  briefCheck: LandsecBriefCheck; brief: "agreed" | "drafted" | null;
}
export type StageSet = { date: string; byName: string | null };
// canSetStage: this viewer may set the date a deal reached its stage.
export interface ClockFeed { deals: ClockDeal[]; parties: Record<string, number>; canSetStage?: boolean }
export type ClockSchemeDeal = { id: string; ref: number | null; name: string; unit: string | null };

export const LANDSEC_CLOCK_KEY = ["/api/landsec/deals"] as const;

// The app is showing the Landsec view: a Landsec login, or BGP staff with the
// team picker on Landsec. Any other client's brand reads "client".
export function useIsLandsecView(): boolean {
  const { brand } = useBrand();
  return brand.id === "landsec";
}

// An asset manager or joint agent login (Woody, 2026-11-12) has no deal page
// (it carries BGP's fee) and no property record page. Every screen that draws
// these pieces asks this, and gives those two roles no link to either.
export const isRestrictedLandsecRole = (role: unknown): boolean => (RESTRICTED_LANDSEC_ROLES as string[]).includes(String(role || ""));
export function useLandsecRestricted(): boolean {
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  return isRestrictedLandsecRole(me?.landsecRole);
}

export function useLandsecClocks(enabled: boolean) {
  const query = useQuery<ClockFeed>({ queryKey: LANDSEC_CLOCK_KEY, enabled, staleTime: 60 * 1000, retry: false });
  const byId = useMemo(() => new Map((query.data?.deals || []).map(d => [d.id, d])), [query.data]);
  return { ...query, byId };
}

// After a waiting-on is saved, or the checklist changes: the clock feed, the
// unit pages, the checklists and every task list read it again. The checklist
// dialog passes checklists false: its own write has just given it the fresh
// checklist.
export function refreshWaitingOn({ checklists = true }: { checklists?: boolean } = {}) {
  queryClient.invalidateQueries({ queryKey: LANDSEC_CLOCK_KEY });
  queryClient.invalidateQueries({
    predicate: q => {
      const k = typeof q.queryKey[0] === "string" ? (q.queryKey[0] as string) : "";
      return k.startsWith("/api/landsec/unit/") || k === "/api/landsec/deal" || k.startsWith("/api/tasks") || (checklists && k.startsWith("/api/deal-checklists"));
    },
  });
}

// What to tell the person who saved a waiting-on that made someone
// responsible for the checklist item. Null when nobody new was.
export function waitingAssignedToast(r: any): { title: string; description: string } | null {
  const a = r?.assigned;
  if (!a?.changed) return null;
  const reason = a.emailError || "the email service is not available";
  return {
    title: `${a.personName} is responsible for the item`,
    description: a.selfAssigned ? (a.taskCreated ? "It is on your task list." : "It shows as yours on the checklist.")
      : a.taskCreated ? (a.emailed ? "It is on their task list and they have been emailed." : `It is on their task list. The email could not be sent: ${reason}.`)
      : a.emailed ? "They have been emailed."
      : `The email could not be sent: ${reason}. Tell them yourself.`,
  };
}

export function useSaveDealClock() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ dealId, patch }: { dealId: string; patch: Record<string, any> }) =>
      (await apiRequest("PUT", `/api/landsec/deal/${dealId}/clock`, patch)).json(),
    onSuccess: (r: any) => {
      refreshWaitingOn();
      const told = waitingAssignedToast(r);
      if (told) toast(told);
    },
    onError: (e: any) => toast({ title: "Not saved", description: e?.message, variant: "destructive" }),
  });
}

// The other live deals on a deal's scheme: what "depends on" is picked from.
export function schemeDealsFor(feed: ClockFeed | undefined, deal: ClockDeal): ClockSchemeDeal[] {
  return (feed?.deals || [])
    .filter(d => d.id !== deal.id && !!d.scheme && d.scheme.key === deal.scheme?.key)
    .map(d => ({ id: d.id, ref: d.ref, name: d.tenant || d.name, unit: d.unit }));
}

// Stuck = in negotiation (Negotiating, HOTs or Solicitors) and at the same
// stage for LANDSEC_STUCK_DAYS. Marketing is a void, not a stuck deal.
export const isStuck = (d: Pick<ClockDeal, "code" | "days"> | null | undefined) => !!d && landsecIsStuck(d.code, d.days);
// In negotiation with no one named as who it is waiting on. A waiting-on
// read from the deal's checklist counts as named.
export const noOneNamed = (d: Pick<ClockDeal, "code" | "clock"> | null | undefined) => !!d && landsecInNegotiation(d.code) && !waitingNamed(d.clock);
export const STUCK_LABEL = `Stuck ${LANDSEC_STUCK_DAYS}d+`;

// ── The clock filters on the Deals page ─────────────────────────────────
// "all", "stuck", "none" (in negotiation, no one named) or a waiting party.
export function matchesClockFilter(d: ClockDeal | undefined, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "stuck") return isStuck(d);
  if (filter === "none") return noOneNamed(d);
  return !!d && d.clock?.waitingOnParty === filter;
}

export interface ClockCounts { stuck: number; none: number; parties: [string, number][] }
export function clockCounts(deals: Array<ClockDeal | undefined>): ClockCounts {
  let stuck = 0, none = 0;
  const parties = new Map<string, number>();
  for (const d of deals) {
    if (!d) continue;
    if (isStuck(d)) stuck++;
    if (noOneNamed(d)) none++;
    const p = d.clock?.waitingOnParty;
    if (p) parties.set(p, (parties.get(p) || 0) + 1);
  }
  return { stuck, none, parties: Array.from(parties.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) };
}

// Stuck deals to the top, the longest at its stage first. The rest keep the
// order they came in. keepOrder leaves the stuck deals in their incoming
// order too (a column sort is on).
export function stuckFirst<T extends { id: string }>(rows: T[], byId: Map<string, ClockDeal>, keepOrder = false): T[] {
  const stuck: T[] = [], rest: T[] = [];
  for (const r of rows) (isStuck(byId.get(r.id)) ? stuck : rest).push(r);
  if (!keepOrder) stuck.sort((a, b) => (byId.get(b.id)?.days ?? 0) - (byId.get(a.id)?.days ?? 0));
  return [...stuck, ...rest];
}

// What a search also looks in: who the deal is waiting on, the note and the
// checklist item it is waiting for.
export const clockSearchText = (d: ClockDeal | undefined): string =>
  d?.clock ? [d.clock.waitingOnParty, d.clock.waitingOnName, d.clock.waitingNote, d.clock.checklistItemLabel].filter(Boolean).join(" ").toLowerCase() : "";

const partySlug = (p: string) => p.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// The pill row: Stuck, Waiting on each party, No one named, and the Stuck
// first sort. A second press on the active pill clears it.
export function ClockFilterPills({ filter, onFilter, counts, stuckFirstOn, onStuckFirst, failed }: {
  filter: string; onFilter: (f: string) => void; counts: ClockCounts;
  stuckFirstOn: boolean; onStuckFirst: (on: boolean) => void; failed?: boolean;
}) {
  const set = (f: string) => onFilter(filter === f ? "all" : f);
  // A party picked earlier stays on the row at 0 so it can be cleared.
  const parties = filter !== "all" && filter !== "stuck" && filter !== "none" && !counts.parties.some(([p]) => p === filter)
    ? [...counts.parties, [filter, 0] as [string, number]] : counts.parties;
  return (
    <div className="flex flex-wrap items-center gap-1.5 shrink-0" data-testid="deals-clock-filters">
      <Pill active={filter === "stuck"} onClick={() => set("stuck")} title={`In negotiation, HOTs or solicitors and at the same stage for ${LANDSEC_STUCK_DAYS} days or more`} data-testid="deals-clock-stuck">
        {STUCK_LABEL} <PillCount n={counts.stuck} active={filter === "stuck"} />
      </Pill>
      {parties.map(([p, n]) => (
        <Pill key={p} active={filter === p} onClick={() => set(p)} data-testid={`deals-clock-party-${partySlug(p)}`}>
          Waiting on {p} <PillCount n={n} active={filter === p} />
        </Pill>
      ))}
      <Pill active={filter === "none"} onClick={() => set("none")} title="In negotiation, HOTs or solicitors with no one named as the party it is waiting on" data-testid="deals-clock-none">
        No one named <PillCount n={counts.none} active={filter === "none"} />
      </Pill>
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      <Pill active={stuckFirstOn} onClick={() => onStuckFirst(!stuckFirstOn)} aria-pressed={stuckFirstOn} title="Put the stuck deals at the top, the longest at its stage first" data-testid="deals-clock-stuck-first">
        <ArrowDownWideNarrow className="w-3 h-3" /> Stuck first
      </Pill>
      {failed && <span className="text-xs text-muted-foreground" data-testid="deals-clock-failed">The deal clock could not be loaded.</span>}
    </div>
  );
}

// The small pill inside a row or card (docs/DESIGN.md, part 6).
export const rowPill = "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide";
const toInputDate = (d: string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const nerWorking = (ner: LandsecNer) =>
  `${formatCurrency(ner.headlinePa)} headline · ${ner.termCertainYears} yr term certain${ner.assumedTerm ? " (assumed)" : ""} · ${ner.rentFreeMonths} mo rent free · ${formatCurrency(ner.capital)} capital`;

// A tenancy unit's status (Vacant, Let, Under offer).
export function StatusPill({ status, vacant }: { status: string | null; vacant: boolean }) {
  return (
    <span className={cn(rowPill, vacant ? "border-amber-500/50 text-amber-700 dark:text-amber-400" : "border-border text-muted-foreground")}>
      {status || "—"}
    </span>
  );
}

const ukDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
// The stage's name in the words about its date: the clock is the letting
// instruction, where the first stage is Marketing (as the tracker has it).
const stageName = (code: DealStatusCode | null | undefined): string | null => (code ? LETTING_STATUS_LABELS[code] : null);

// Days at the current stage, amber once the deal is stuck. A date the app
// cannot stand behind (stageConfirmed false: a bulk update, or no record of
// the move) is drawn greyed with a question mark; it still counts as stuck.
// Pass the clock feed's deal, or its code and days. With canSet and a deal id
// the figure is a button that opens the date ("At <stage> since").
export function DaysAtStage({ deal, code: codeProp, days: daysProp, long, confirmed: confirmedProp, stageSet: setProp, since: sinceProp, dealId: dealIdProp, canSet, testId }: {
  deal?: Pick<ClockDeal, "id" | "code" | "days" | "since" | "stageConfirmed" | "stageSet">;
  code?: DealStatusCode | null; days?: number | null; long?: boolean;
  confirmed?: boolean; stageSet?: StageSet | null; since?: string | null;
  dealId?: string; canSet?: boolean; testId?: string;
}) {
  const code = deal ? deal.code : codeProp ?? null;
  const days = deal ? deal.days : daysProp;
  const confirmed = deal ? deal.stageConfirmed : confirmedProp;
  const stageSet = (deal ? deal.stageSet : setProp) || null;
  const since = (deal ? deal.since : sinceProp) || null;
  const dealId = deal ? deal.id : dealIdProp;
  if (days == null) return null;
  const stuck = landsecIsStuck(code, days);
  const unsure = confirmed === false;
  const settable = !!canSet && !!dealId;
  const stage = stageName(code);
  const title = stageDaysTitle({ stage, days, confirmed, stuck, stuckDays: LANDSEC_STUCK_DAYS, isSet: !!stageSet, setByName: stageSet?.byName, canSet: settable });
  // The long form (the unit page and the deal page) may wrap on a phone.
  const tone = cn(long ? "text-left" : "whitespace-nowrap", unsure ? "text-muted-foreground/70" : stuck ? "font-semibold text-amber-700 dark:text-amber-400" : "text-muted-foreground");
  const figure = (
    <>
      <Clock className={cn("w-3 h-3 shrink-0", unsure && stuck && "text-amber-600 dark:text-amber-400")} />
      {long ? `${days} day${days === 1 ? "" : "s"} at this stage${unsure ? " (date not confirmed)" : ""}` : stageDaysLabel(days, confirmed)}
    </>
  );
  const shared = { title, "data-testid": testId, "data-stage-confirmed": unsure ? "false" : "true" };
  if (!settable) return <span className={cn("inline-flex items-center gap-1 font-mono tabular-nums", tone)} {...shared}>{figure}</span>;
  return (
    <StageDatePopover dealId={dealId!} stage={stage} confirmed={confirmed} stageSet={stageSet} since={since}>
      <button
        type="button" data-no-min-touch
        className={cn("inline-flex items-center gap-1 rounded font-mono tabular-nums underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring", tone)}
        aria-label={`${stageDaysLabel(days, confirmed)}: ${title}`}
        {...shared}
      >
        {figure}
      </button>
    </StageDatePopover>
  );
}

// The date a deal reached its stage, set by hand: "At <stage> since", a date,
// Save and Clear, and who set it. It is saved through the clock's own route
// (stageSince) and applies only while the deal stays at this stage.
function StageDatePopover({ dealId, stage, confirmed, stageSet, since, children }: {
  dealId: string; stage: string | null; confirmed?: boolean; stageSet: StageSet | null; since: string | null; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={e => e.stopPropagation()}>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)] p-3 text-left" onClick={e => e.stopPropagation()}>
        {open && <StageDateForm dealId={dealId} stage={stage} confirmed={confirmed} stageSet={stageSet} since={since} onDone={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}

function StageDateForm({ dealId, stage, confirmed, stageSet, since, onDone }: {
  dealId: string; stage: string | null; confirmed?: boolean; stageSet: StageSet | null; since: string | null; onDone: () => void;
}) {
  const save = useSaveDealClock();
  // Starts from the date a person set; else from the deal's own history when
  // the app can stand behind it; else empty (an unconfirmed date is not offered).
  const [date, setDate] = useState(stageSet?.date || (confirmed !== false ? toInputDate(since) : ""));
  const today = londonDay();
  const send = (stageSince: string | null) => save.mutate({ dealId, patch: { stageSince } }, { onSuccess: onDone });
  return (
    <div className="space-y-2 text-sm font-sans" data-testid="stage-date-form">
      <label className="block text-xs text-muted-foreground">At {stage || "this stage"} since
        <Input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} className="mt-0.5 h-8 text-sm" data-testid="stage-date-input" />
      </label>
      <p className="text-xs text-muted-foreground" data-testid="stage-date-source">
        {stageSet ? `Set by ${stageSet.byName || "a person"}.`
          : confirmed === false ? `The app does not know when this deal reached ${stage || "this stage"}${since ? `. Its own date is ${ukDate(since)}, from a bulk update or from when the deal was added` : ""}.`
          : since ? `From the deal's history: ${ukDate(since)}.` : "No date is recorded."}
      </p>
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="outline" disabled={!stageSet || save.isPending} onClick={() => send(null)} title={stageSet ? "Remove the date set by hand and go back to the deal's own history" : "No date has been set by hand"} data-testid="stage-date-clear">Clear</Button>
        <Button size="sm" disabled={!date || date > today || date === stageSet?.date || save.isPending} onClick={() => send(date)} data-testid="stage-date-save">
          {save.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Save
        </Button>
      </div>
    </div>
  );
}

// The same number as a chip, for board and phone cards (no date to press
// there: the card itself is the link).
export function DaysChip({ code, days, confirmed, testId }: { code: DealStatusCode | null; days: number | null | undefined; confirmed?: boolean; testId?: string }) {
  if (days == null) return null;
  const stuck = landsecIsStuck(code, days);
  const unsure = confirmed === false;
  return (
    <span
      className={cn(rowPill, "gap-1 font-mono tabular-nums normal-case",
        unsure ? cn("border-dashed text-muted-foreground/70", stuck ? "border-amber-500/60" : "border-border")
          : stuck ? "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-border text-muted-foreground")}
      title={stageDaysTitle({ stage: stageName(code), days, confirmed, stuck, stuckDays: LANDSEC_STUCK_DAYS })}
      data-testid={testId} data-stage-confirmed={unsure ? "false" : "true"}
    >
      <Clock className={cn("w-3 h-3", unsure && stuck && "text-amber-600 dark:text-amber-400")} />{stageDaysLabel(days, confirmed)}
    </span>
  );
}

export function StageChip({ code, days, confirmed }: { code: DealStatusCode | null; days?: number | null; confirmed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="rounded-full bg-foreground text-background px-2 py-px font-semibold uppercase tracking-wide text-[10px] whitespace-nowrap">{code ? DEAL_STATUS_LABELS[code] : "Live"}</span>
      <DaysAtStage code={code} days={days} confirmed={confirmed} />
    </span>
  );
}

// Net Effective Rent. With no rent free and no capital recorded on the deal
// the sum would only repeat the headline rent, so it says so instead.
export function NerFigure({ ner, incentivesRecorded, prefix, suffix, dash = true }: {
  ner: LandsecNer | null; incentivesRecorded?: boolean; prefix?: string; suffix?: string; dash?: boolean;
}) {
  if (!ner) return dash ? <span className="text-muted-foreground">—</span> : null;
  if (incentivesRecorded === false) {
    return (
      <span
        className="text-[11px] text-muted-foreground whitespace-nowrap"
        title={`${formatCurrency(ner.headlinePa)} headline rent. No rent free or capital contribution is recorded on the deal, so a Net Effective Rent is not shown.`}
        data-testid="landsec-ner-not-recorded"
      >
        Incentives not recorded
      </span>
    );
  }
  return <span className="font-mono tabular-nums whitespace-nowrap" title={nerWorking(ner)}>{prefix}{formatCurrency(ner.nerPa)}{suffix}</span>;
}

// The deal's Net Effective Rent against the brief's floor. No pass or fail is
// given while the incentives are not recorded.
export function BriefCheck({ brief, check }: { brief: "agreed" | "drafted" | null; check: LandsecBriefCheck }) {
  if (check === "fail") return <span className={cn(rowPill, "border-red-600/60 px-1.5 text-red-700 dark:text-red-400")}>Below NER floor</span>;
  if (check === "pass") return <span className={cn(rowPill, "border-emerald-600/60 px-1.5 text-emerald-700 dark:text-emerald-400")}>Meets floor</span>;
  if (check === "unchecked") {
    return (
      <span
        className={cn(rowPill, "border-border px-1.5 text-muted-foreground")}
        title="The brief has a Net Effective Rent floor, but no rent free or capital contribution is recorded on the deal, so it cannot be checked yet."
        data-testid="landsec-brief-not-checked"
      >
        Not checked
      </span>
    );
  }
  if (brief === "agreed") return <span className={cn(rowPill, "border-border px-1.5 text-muted-foreground")}>Agreed · no floor</span>;
  return <span className="text-[10px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">{brief === "drafted" ? "Brief unsigned" : "No brief"}</span>;
}

const daysSinceIso = (d: string | null | undefined): number | null => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000)) : null);
// The party, then the person; a person alone when their party is not known.
const waitingWho = (c: WaitingClock): { lead: string; rest: string } => ({
  lead: c.waitingOnParty || c.waitingOnName || "",
  rest: c.waitingOnParty && c.waitingOnName ? c.waitingOnName : "",
});
// What the deal is waiting for: the note, said to be from the checklist when
// nobody set it, and marked as a checklist item when it is linked to one.
const waitingFor = (c: WaitingClock): { text: string; title: string } | null => {
  const text = c.waitingNote || c.checklistItemLabel || "";
  if (!text) return null;
  if (c.derived) return { text: `From the checklist: ${text}`, title: `Read from the deal checklist, because nobody has set who this deal is waiting on: ${text}` };
  return { text, title: c.checklistItemId ? `On the deal checklist: ${c.checklistItemLabel || text}` : text };
};

// Who a deal is waiting on, read only: party, name and days, with what it is
// waiting for on a second line.
export function WaitingLine({ clock, waitingDays }: { clock: WaitingClock | null; waitingDays?: number | null }) {
  const what = clock ? waitingFor(clock) : null;
  const linked = !!clock?.checklistItemId;
  const second = what && (
    <span className="block text-muted-foreground truncate max-w-[16rem] not-italic" title={what.title} data-testid={clock?.derived ? "waiting-from-checklist" : undefined}>
      {linked && <ListChecks className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden />}{what.text}
    </span>
  );
  if (!clock || !waitingNamed(clock)) return <span className="text-xs text-muted-foreground italic">No one named{linked ? second : null}</span>;
  const days = waitingDays ?? daysSinceIso(clock.waitingSince);
  const who = waitingWho(clock);
  return (
    <span className="text-xs">
      <span className="font-medium">{who.lead}</span>{who.rest ? ` · ${who.rest}` : ""}
      {days != null && <span className="text-muted-foreground font-mono tabular-nums"> · {days}d</span>}
      {second}
    </span>
  );
}

// The same on one line, for board and phone cards. A deal still at Marketing
// with no one named shows nothing: it is not waiting on anyone.
export function WaitingSummary({ deal }: { deal: Pick<ClockDeal, "code" | "clock" | "waitingDays"> }) {
  const c = deal.clock;
  if (!c || !waitingNamed(c)) return noOneNamed(deal) ? <span className="text-[11px] text-muted-foreground italic truncate">No one named</span> : null;
  const who = waitingWho(c);
  return (
    <span className="text-[11px] truncate min-w-0" title={[c.waitingOnParty, c.waitingOnName, waitingFor(c)?.text].filter(Boolean).join(" · ")}>
      <span className="text-muted-foreground">Waiting on </span><span className="font-medium">{who.lead}</span>
      {who.rest ? ` · ${who.rest}` : ""}
      {deal.waitingDays != null && <span className="text-muted-foreground font-mono tabular-nums"> · {deal.waitingDays}d</span>}
    </span>
  );
}

// The deal this one depends on. One the viewer cannot see reads "another deal".
// linkDeals is false for an asset manager or joint agent: they have no deal
// page (it carries BGP's fee), so the deal is named in plain text.
export function DependsOn({ clock, linkDeals = true }: { clock: WaitingClock | null; linkDeals?: boolean }) {
  if (clock?.dependsOn) {
    const text = `${clock.dependsOn.unit || clock.dependsOn.name}${clock.dependsOn.ref ? ` #${clock.dependsOn.ref}` : ""}`;
    if (!linkDeals) return <span data-testid="landsec-depends-on-text">{text}</span>;
    return <Link href={`/deals/${clock.dependsOn.id}`} className="hover:underline">{text}</Link>;
  }
  if (clock?.dependsOnHidden) return <span data-testid="landsec-depends-on-hidden">another deal</span>;
  return null;
}

const HIDDEN_DEAL = "__another_deal__";
const NEW_ITEM = WAITING_NEW_ITEM;
const selectClass = "h-8 w-full rounded-md border bg-background px-2 text-sm text-foreground";
const waitingOptionsKey = (dealId: string) => ["/api/landsec/deal", dealId, "waiting-options"] as const;

function WaitingForm({ clock, dealId, schemeDeals, onSave, onCancel, saving, testId }: {
  clock: WaitingClock | null; dealId?: string; schemeDeals: ClockSchemeDeal[];
  onSave: (patch: Record<string, any>) => void; onCancel: () => void; saving: boolean; testId: string;
}) {
  const { toast } = useToast();
  // The open items on the deal's checklist and the people who can be made
  // responsible. Reading them never starts a checklist.
  const options = useQuery<WaitingOptions>({ queryKey: waitingOptionsKey(dealId || ""), enabled: !!dealId, staleTime: 0, retry: false });
  const opts = options.data;
  const items = opts?.items || [];
  const people = opts?.people || [];
  const initialItem = clock?.checklistItemId || "";
  const fromClock = () => ({
    party: clock?.waitingOnParty || "", name: clock?.waitingOnName || "", since: toInputDate(clock?.waitingSince), note: clock?.waitingNote || "",
    dependsOn: clock?.dependsOnHidden ? HIDDEN_DEAL : clock?.dependsOnDealId || "",
    item: initialItem, newLabel: "", personKey: "",
  });
  // The form is mounted when it opens, so it starts from the saved clock (or
  // from the one read from the checklist, which saving then keeps).
  const [form, setForm] = useState(fromClock);
  const [starting, setStarting] = useState(false);
  // A deal already picked that is not on this scheme's list still has to show.
  const current = clock?.dependsOn && !schemeDeals.some(d => d.id === clock.dependsOn!.id) ? clock.dependsOn : null;
  const label = (d: ClockSchemeDeal) => `${d.unit ? `${d.unit} · ` : ""}${d.name}${d.ref ? ` #${d.ref}` : ""}`;
  const picked = items.find(i => i.id === form.item) || null;
  const itemChosen = form.item === NEW_ITEM || !!form.item;
  const itemPersonKey = picked && !picked.viaDeal ? picked.person?.key || "" : "";

  const pickItem = (id: string) => setForm(p => {
    const it = items.find(i => i.id === id) || null;
    const before = items.find(i => i.id === p.item)?.label || (p.item === initialItem ? clock?.checklistItemLabel || "" : "");
    return {
      ...p, item: id, personKey: "", newLabel: id === NEW_ITEM ? p.newLabel : "",
      // Who it is with and the party they stand for come from the item; the
      // note follows the item unless the person has typed their own.
      // A person whose party is not known leaves it for whoever is saving.
      party: it?.person ? it.party || "" : p.party,
      name: it ? it.person?.name || "" : p.name,
      note: it && (!p.note || p.note === before) ? it.label : p.note,
      // A different item restarts the clock unless a date is typed.
      since: id === initialItem ? toInputDate(clock?.waitingSince) : "",
    };
  });
  const pickPerson = (key: string) => setForm(p => {
    const person = people.find(x => x.key === key) || null;
    if (!person) return { ...p, personKey: "" };
    // A person whose party is not known leaves the party for whoever is saving:
    // the last person's party must not stay beside the new name.
    return { ...p, personKey: key === itemPersonKey ? "" : key, name: person.name, party: person.party || "" };
  });
  // A name typed over the picked person's is a different person: nobody is
  // made responsible for the item by it.
  const typeName = (name: string) => setForm(p => ({ ...p, name, personKey: p.personKey && people.find(x => x.key === p.personKey)?.name !== name ? "" : p.personKey }));

  const startChecklist = async () => {
    if (!opts?.trackerUnitId || starting) return;
    setStarting(true);
    try {
      // The checklist's own door: it starts from the standard list the first
      // time someone who may change it opens it. Nobody is emailed by that.
      await apiRequest("GET", `/api/deal-checklists/unit/${opts.trackerUnitId}`);
      queryClient.invalidateQueries({ queryKey: ["/api/deal-checklists/summary"] });
      await options.refetch();
    } catch (e: any) {
      toast({ title: "The checklist could not be started", description: e?.message, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  const save = () => {
    const patch: Record<string, any> = {
      waitingOnParty: form.party || null, waitingOnName: form.name || null, waitingSince: form.since || undefined, waitingNote: form.note || null,
      // A dependency the viewer cannot see is left as it is unless they change it.
      ...(form.dependsOn === HIDDEN_DEAL ? {} : { dependsOnDealId: form.dependsOn || null }),
    };
    // The checklist half (waitingLinkFields in shared/deal-waiting.ts, with
    // its tests): "no one" clears the link only when the form opened on
    // someone named, so a link that already named no one is never dropped by
    // saving another box.
    Object.assign(patch, waitingLinkFields(form, { item: initialItem, named: waitingNamed(clock), derived: !!clock?.derived }));
    onSave(patch);
  };

  return (
    <div className="grid sm:grid-cols-2 gap-1.5 text-sm" data-testid={`${testId}-form`}>
      {clock?.derived && (
        <p className="sm:col-span-2 text-xs text-muted-foreground" data-testid={`${testId}-derived`}>
          This is read from the deal checklist because nobody has set it. Save to keep it, or change it first.
        </p>
      )}
      {dealId && opts?.started && (
        <label className="text-xs text-muted-foreground sm:col-span-2">Waiting for (deal checklist)
          <select className={selectClass} value={form.item} onChange={e => pickItem(e.target.value)} data-testid={`${testId}-item`}>
            <option value="">— not a checklist item —</option>
            {form.item && form.item !== NEW_ITEM && !picked && <option value={form.item}>{clock?.checklistItemLabel || "The item it is linked to now"}</option>}
            {CHECKLIST_STAGES.map(st => {
              const rows = items.filter(i => i.stage === st.key);
              if (rows.length === 0) return null;
              return (
                <optgroup key={st.key} label={st.key === opts.stage ? `${st.label} (current stage)` : st.label}>
                  {rows.map(i => <option key={i.id} value={i.id}>{i.label}{i.required ? " (required)" : ""}{i.person ? ` · ${i.person.name}` : ""}</option>)}
                </optgroup>
              );
            })}
            {opts.canLink && <option value={NEW_ITEM}>+ Something not on the checklist yet…</option>}
          </select>
        </label>
      )}
      {form.item === NEW_ITEM && (
        <label className="text-xs text-muted-foreground sm:col-span-2">New checklist item
          <Input value={form.newLabel} maxLength={300} onChange={e => setForm(p => ({ ...p, newLabel: e.target.value }))} placeholder="What the deal is waiting for" className="h-8 text-sm" data-testid={`${testId}-new-item`} />
          <span className="mt-0.5 block text-[11px]">It is added to the checklist at the deal's current stage, not required.</span>
        </label>
      )}
      {dealId && opts && !opts.started && opts.trackerUnitId && (
        <p className="sm:col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-testid={`${testId}-no-checklist`}>
          <span>This deal has no checklist yet{opts.canStart ? ". Start it to pick what the deal is waiting for from it." : "."}</span>
          {opts.canStart && (
            <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={starting} onClick={startChecklist} data-testid={`${testId}-start-checklist`}>
              {starting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Start the checklist
            </Button>
          )}
        </p>
      )}
      {itemChosen && opts?.canLink && people.length > 0 && (
        <label className="text-xs text-muted-foreground sm:col-span-2">Person responsible for it
          <select className={selectClass} value={form.personKey || itemPersonKey} onChange={e => pickPerson(e.target.value)} data-testid={`${testId}-person`}>
            <option value="">{picked?.person ? (picked.viaDeal ? `— falls to ${picked.person.name} —` : "— leave as it is —") : "— choose from the people on the checklist —"}</option>
            {CHECKLIST_SIDES.map(side => {
              const rows = people.filter(x => x.side === side.key);
              if (rows.length === 0) return null;
              return (
                <optgroup key={side.key} label={side.label}>
                  {rows.map(x => <option key={x.key} value={x.key}>{x.name}{x.role ? ` · ${x.role}` : ""}{x.hasLogin ? "" : " · no login"}</option>)}
                </optgroup>
              );
            })}
          </select>
          {form.personKey && <span className="mt-0.5 block text-[11px]">Saving makes them responsible for the item: it goes on their task list and they are emailed.</span>}
        </label>
      )}
      <label className="text-xs text-muted-foreground">Waiting on
        <select className={selectClass} value={form.party} onChange={e => setForm(p => ({ ...p, party: e.target.value }))}>
          <option value="">— no one / not waiting —</option>
          {LANDSEC_WAITING_PARTIES.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
      </label>
      <label className="text-xs text-muted-foreground">Who (name)<Input value={form.name} onChange={e => typeName(e.target.value)} placeholder="e.g. the asset manager's name" className="h-8 text-sm" /></label>
      <label className="text-xs text-muted-foreground">Since<Input type="date" value={form.since} onChange={e => setForm(p => ({ ...p, since: e.target.value }))} className="h-8 text-sm" /></label>
      <label className="text-xs text-muted-foreground">Depends on deal
        <select className={selectClass} value={form.dependsOn} onChange={e => setForm(p => ({ ...p, dependsOn: e.target.value }))}>
          <option value="">— none —</option>
          {clock?.dependsOnHidden && <option value={HIDDEN_DEAL}>Another deal (not one you can open)</option>}
          {current && <option value={current.id}>{label(current)}</option>}
          {schemeDeals.map(d => <option key={d.id} value={d.id}>{label(d)}</option>)}
        </select>
      </label>
      <label className="text-xs text-muted-foreground sm:col-span-2">What for<Input value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} placeholder="e.g. heads of terms sign-off; CAPR approval; draft lease comments" className="h-8 text-sm" /></label>
      <div className="sm:col-span-2 flex justify-end gap-1">
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={saving || (form.item === NEW_ITEM && !form.newLabel.trim())} data-testid={`${testId}-save`} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

// Who the deal is waiting on, since when, and the deal it depends on, with
// the form to change them. "inline" opens the form in place (the unit page and
// the deal page); "cell" keeps a table row its height and opens the form in a
// popover (the Deals table). With dealId the form offers the deal's checklist
// items; without it the form is the free party, name and note.
export function WaitingOn({ clock, dealId, schemeDeals, onSave, saving, variant = "inline", waitingDays, testId = "landsec-unit-waiting", empty, linkDeals = true }: {
  // A function is only called when the form opens (a table has one per row).
  clock: WaitingClock | null; dealId?: string; schemeDeals: ClockSchemeDeal[] | (() => ClockSchemeDeal[]);
  onSave: (patch: Record<string, any>) => void; saving: boolean;
  variant?: "inline" | "cell"; waitingDays?: number | null; testId?: string;
  // What the cell shows when no one is named, in place of "No one named".
  empty?: ReactNode;
  // False for an asset manager or joint agent: the deal it depends on is
  // plain text, never a link to the deal page.
  linkDeals?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const save = (patch: Record<string, any>) => { onSave(patch); setEditing(false); };
  const options = () => (typeof schemeDeals === "function" ? schemeDeals() : schemeDeals);
  const named = waitingNamed(clock);
  // Nobody has set it: the pencil sets it, even when the checklist gives one.
  const isSet = named && !clock?.derived;

  if (variant === "cell") {
    // The whole cell opens the form, filled or empty (Woody, 2026-11-13:
    // "can click empty spaces and add / edit").
    const action = isSet ? "Change who this deal is waiting on" : "Set who this deal is waiting on";
    return (
      <Popover open={editing} onOpenChange={setEditing}>
        <PopoverTrigger asChild>
          <button
            type="button" data-no-min-touch
            className="flex w-full min-w-0 items-start gap-1 rounded px-1 py-0.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title={action} aria-label={action}
            data-testid={`${testId}-edit`}
          >
            <span className="min-w-0 flex-1">{!named && !clock?.checklistItemId && empty !== undefined ? empty : <WaitingLine clock={clock} waitingDays={waitingDays} />}</span>
            <Pencil className="mt-0.5 w-3 h-3 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[26rem] max-w-[calc(100vw-2rem)] max-h-[80vh] overflow-y-auto p-3">
          {editing && <WaitingForm clock={clock} dealId={dealId} schemeDeals={options()} onSave={save} onCancel={() => setEditing(false)} saving={saving} testId={testId} />}
        </PopoverContent>
      </Popover>
    );
  }

  if (editing) return <WaitingForm clock={clock} dealId={dealId} schemeDeals={options()} onSave={save} onCancel={() => setEditing(false)} saving={saving} testId={testId} />;
  const days = waitingDays ?? daysSinceIso(clock?.waitingSince);
  const who = clock && named ? waitingWho(clock) : null;
  const what = clock ? waitingFor(clock) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {who ? (
        <span>Waiting on <span className="font-medium">{who.lead}</span>{who.rest ? ` (${who.rest})` : ""}{days != null ? <span className="text-muted-foreground font-mono tabular-nums"> · {days} days</span> : null}{what ? <span className="text-muted-foreground" title={what.title} data-testid={clock?.derived ? "waiting-from-checklist" : undefined}> · {clock?.checklistItemId && <ListChecks className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />}{what.text}</span> : null}</span>
      ) : <span className="text-muted-foreground italic">No one named as waiting on{what && clock?.checklistItemId ? <span className="not-italic" title={what.title}> · <ListChecks className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />{what.text}</span> : null}</span>}
      {(clock?.dependsOn || clock?.dependsOnHidden) && <span className="text-muted-foreground">Depends on <span className="text-foreground"><DependsOn clock={clock} linkDeals={linkDeals} /></span></span>}
      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setEditing(true)} data-testid={`${testId}-edit`}><Pencil className="w-3 h-3 mr-1" /> {isSet ? "Change" : "Set waiting on"}</Button>
    </div>
  );
}

// The Letting Tracker's status cell and phone card: days at stage and the
// name of who the deal is waiting on (the party when no name is given).
export function TrackerClock({ deal, testId }: { deal: ClockDeal | undefined; testId?: string }) {
  if (!deal || deal.days == null) return null;
  const who = deal.clock?.waitingOnName || deal.clock?.waitingOnParty;
  return (
    <span className="mt-0.5 flex min-w-0 flex-col gap-0.5 text-[11px] leading-tight" data-testid={testId}>
      <DaysAtStage code={deal.code} days={deal.days} confirmed={deal.stageConfirmed} stageSet={deal.stageSet} />
      {who &&<span className="truncate text-muted-foreground" title={`Waiting on ${[deal.clock?.waitingOnParty, deal.clock?.waitingOnName].filter(Boolean).join(" · ")}${deal.clock?.derived ? " (from the checklist)" : ""}`}>{who}</span>}
    </span>
  );
}

// The Deals table's Waiting on cell: the line, with the pencil that opens the
// form. A deal still at Marketing with no one named shows a dash: it is not
// waiting on anyone yet.
export function WaitingCell({ deal, feed, onSave, saving }: {
  deal: ClockDeal; feed: ClockFeed | undefined; onSave: (dealId: string, patch: Record<string, any>) => void; saving: boolean;
}) {
  return (
    <WaitingOn
      variant="cell" clock={deal.clock} dealId={deal.id} waitingDays={deal.waitingDays}
      schemeDeals={() => schemeDealsFor(feed, deal)}
      onSave={patch => onSave(deal.id, patch)} saving={saving}
      testId={`deal-waiting-${deal.id}`}
      empty={landsecInNegotiation(deal.code) ? undefined : <span className="text-muted-foreground">—</span>}
    />
  );
}

// The Deals table's Depends on cell: the deal it depends on, or "+ Set". Both
// open the Waiting on form, where the deal is picked (the same save).
export function DependsOnCell({ deal, feed, onSave, saving, linkDeals = true }: {
  deal: ClockDeal; feed: ClockFeed | undefined; onSave: (dealId: string, patch: Record<string, any>) => void; saving: boolean; linkDeals?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const clock = deal.clock;
  const set = !!(clock?.dependsOn || clock?.dependsOnHidden);
  const testId = `deal-depends-${deal.id}`;
  return (
    <span className="flex min-w-0 items-center gap-1">
      {set && <span className="min-w-0 truncate"><DependsOn clock={clock} linkDeals={linkDeals} /></span>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button" data-no-min-touch
            className={cn("shrink-0 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring", set ? "p-0.5" : "inline-flex items-center gap-0.5 px-1 py-0.5 text-[11px] hover:bg-accent")}
            title={set ? "Change the deal this one depends on" : "Set a deal this one depends on"}
            aria-label={set ? "Change the deal this one depends on" : "Set a deal this one depends on"}
            data-testid={`${testId}-edit`}
          >
            {set ? <Pencil className="w-3 h-3" /> : <><Plus className="w-3 h-3" /> Set</>}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[26rem] max-w-[calc(100vw-2rem)] max-h-[80vh] overflow-y-auto p-3">
          {open && (
            <WaitingForm
              clock={clock} dealId={deal.id} schemeDeals={schemeDealsFor(feed, deal)}
              onSave={patch => { onSave(deal.id, patch); setOpen(false); }} onCancel={() => setOpen(false)} saving={saving} testId={testId}
            />
          )}
        </PopoverContent>
      </Popover>
    </span>
  );
}

// A clock cell that has nothing to say for this deal: a faint dash, with the
// reason in its title (a closed deal waits on no one; a deal off the schemes
// has no clock).
export function ClockDash({ title, testId }: { title: string; testId?: string }) {
  return <span className="text-muted-foreground/60" title={title} data-testid={testId}>—</span>;
}

// The clock line as the unit page and the deal page show it: stage, who, days
// at this stage, Net Effective Rent, the brief check, then who it is waiting
// on. One component, so the two pages cannot drift.
export function DealClockLine({ stage, code, name, days, stageConfirmed, stageSet, since, canSetStage, ner, incentivesRecorded, brief, briefCheck, jointAgent, unit, clock, dealId, waitingDays, schemeDeals, onSave, saving, testId, waitingTestId, label, linkDeals = true }: {
  stage: string | null; code: DealStatusCode | null; name?: string | null; days: number | null;
  // Days at stage: whether the date is confirmed, the date set by hand, the
  // date itself, and whether this viewer may set it (with dealId).
  stageConfirmed?: boolean; stageSet?: StageSet | null; since?: string | null; canSetStage?: boolean;
  ner: LandsecNer | null; incentivesRecorded?: boolean; brief: "agreed" | "drafted" | null; briefCheck: LandsecBriefCheck;
  jointAgent?: string | null; unit?: { href: string | null; label: string } | null;
  // dealId lets the Waiting on form offer the deal's checklist items.
  clock: WaitingClock | null; dealId?: string; waitingDays?: number | null; schemeDeals: ClockSchemeDeal[];
  onSave: (patch: Record<string, any>) => void; saving: boolean; testId: string; waitingTestId?: string; label?: string; linkDeals?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2 space-y-1.5" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {label && <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>}
        <span className="rounded-full bg-foreground text-background px-2 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap">{stage || "Live"}</span>
        {name && <span className="font-medium">{name}</span>}
        <DaysAtStage code={code} days={days} long confirmed={stageConfirmed} stageSet={stageSet} since={since} dealId={dealId} canSet={canSetStage} testId={`${testId}-days`} />
        <NerFigure ner={ner} incentivesRecorded={incentivesRecorded} prefix="NER " suffix=" pa" dash={false} />
        {(briefCheck || brief) && <BriefCheck brief={brief} check={briefCheck} />}
        {jointAgent && <span className="text-muted-foreground">Joint agent: {jointAgent}</span>}
        {unit && (unit.href
          ? <Link href={unit.href} className="text-primary hover:underline" data-testid={`${testId}-unit-link`}>{unit.label}</Link>
          : <span className="text-muted-foreground">{unit.label}</span>)}
      </div>
      <WaitingOn clock={clock} dealId={dealId} waitingDays={waitingDays} schemeDeals={schemeDeals} onSave={onSave} saving={saving} testId={waitingTestId} linkDeals={linkDeals} />
    </div>
  );
}

// The deal page's clock, for a Landsec viewer. Renders nothing for anyone
// else, and nothing for a deal that is not live on a scheme property.
export function DealClockCard({ dealId }: { dealId: string }) {
  const landsec = useIsLandsecView();
  const { byId, data } = useLandsecClocks(landsec);
  const save = useSaveDealClock();
  const restricted = useLandsecRestricted();
  const d = byId.get(dealId);
  if (!landsec || !d) return null;
  const unitLabel = [d.scheme?.name, d.unit].filter(Boolean).join(" · ");
  return (
    <DealClockLine
      testId="deal-clock-card" waitingTestId="deal-clock-waiting" label="Deal clock"
      stage={d.code ? DEAL_STATUS_LABELS[d.code] : null} code={d.code} days={d.days}
      stageConfirmed={d.stageConfirmed} stageSet={d.stageSet} since={d.since} canSetStage={data?.canSetStage}
      ner={d.ner} incentivesRecorded={d.incentivesRecorded} brief={d.brief} briefCheck={d.briefCheck} jointAgent={d.jointAgent}
      unit={unitLabel ? { href: d.unitId ? `/landsec/unit/${d.unitId}` : null, label: d.unitId ? `Unit page: ${unitLabel}` : unitLabel } : null}
      clock={d.clock} dealId={dealId} waitingDays={d.waitingDays} schemeDeals={schemeDealsFor(data, d)}
      onSave={patch => save.mutate({ dealId, patch })} saving={save.isPending}
      linkDeals={!restricted}
    />
  );
}
