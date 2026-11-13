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
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowDownWideNarrow, Clock, Pencil } from "lucide-react";
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
  type LandsecBriefCheck, type LandsecDealClock, type LandsecNer,
} from "@shared/landsec";

export interface ClockDeal {
  id: string; ref: number | null; name: string; dealType: string | null; tenant: string | null; jointAgent: string | null;
  scheme: { key: string; name: string } | null; propertyId: string; unitId: string | null; unit: string | null; trackerId?: string | null;
  code: DealStatusCode | null; since: string | null; days: number | null; waitingDays: number | null;
  clock: LandsecDealClock | null; ner: LandsecNer | null; incentivesRecorded?: boolean;
  briefCheck: LandsecBriefCheck; brief: "agreed" | "drafted" | null;
}
export interface ClockFeed { deals: ClockDeal[]; parties: Record<string, number> }
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

export function useSaveDealClock() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ dealId, patch }: { dealId: string; patch: Record<string, any> }) =>
      (await apiRequest("PUT", `/api/landsec/deal/${dealId}/clock`, patch)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LANDSEC_CLOCK_KEY });
      queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/landsec/unit/") });
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
// In negotiation with no one named as the party it is waiting on.
export const noOneNamed = (d: Pick<ClockDeal, "code" | "clock"> | null | undefined) => !!d && landsecInNegotiation(d.code) && !d.clock?.waitingOnParty;
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

// What a search also looks in: who the deal is waiting on and the note.
export const clockSearchText = (d: ClockDeal | undefined): string =>
  d?.clock ? [d.clock.waitingOnParty, d.clock.waitingOnName, d.clock.waitingNote].filter(Boolean).join(" ").toLowerCase() : "";

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

// Days at the current stage, amber once the deal is stuck.
export function DaysAtStage({ code, days, long }: { code: DealStatusCode | null; days: number | null | undefined; long?: boolean }) {
  if (days == null) return null;
  const stuck = landsecIsStuck(code, days);
  return (
    <span
      className={cn("inline-flex items-center gap-1 font-mono tabular-nums whitespace-nowrap", stuck ? "font-semibold text-amber-700 dark:text-amber-400" : "text-muted-foreground")}
      title={stuck ? `At this stage for ${days} days: stuck (${LANDSEC_STUCK_DAYS} days or more)` : `At this stage for ${days} days`}
    >
      <Clock className="w-3 h-3" />{long ? `${days} days at this stage` : `${days}d`}
    </span>
  );
}

// The same number as a chip, for board and phone cards.
export function DaysChip({ code, days, testId }: { code: DealStatusCode | null; days: number | null | undefined; testId?: string }) {
  if (days == null) return null;
  const stuck = landsecIsStuck(code, days);
  return (
    <span
      className={cn(rowPill, "gap-1 font-mono tabular-nums normal-case", stuck ? "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-border text-muted-foreground")}
      title={stuck ? `At this stage for ${days} days: stuck (${LANDSEC_STUCK_DAYS} days or more)` : `At this stage for ${days} days`}
      data-testid={testId}
    >
      <Clock className="w-3 h-3" />{days}d
    </span>
  );
}

export function StageChip({ code, days }: { code: DealStatusCode | null; days?: number | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="rounded-full bg-foreground text-background px-2 py-px font-semibold uppercase tracking-wide text-[10px] whitespace-nowrap">{code ? DEAL_STATUS_LABELS[code] : "Live"}</span>
      <DaysAtStage code={code} days={days} />
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

// Who a deal is waiting on, read only: party, name and days, with the note
// on a second line.
export function WaitingLine({ clock, waitingDays }: { clock: LandsecDealClock | null; waitingDays?: number | null }) {
  if (!clock?.waitingOnParty) return <span className="text-xs text-muted-foreground italic">No one named</span>;
  const days = waitingDays ?? (clock.waitingSince ? Math.max(0, Math.floor((Date.now() - new Date(clock.waitingSince).getTime()) / 86400000)) : null);
  return (
    <span className="text-xs">
      <span className="font-medium">{clock.waitingOnParty}</span>{clock.waitingOnName ? ` · ${clock.waitingOnName}` : ""}
      {days != null && <span className="text-muted-foreground font-mono tabular-nums"> · {days}d</span>}
      {clock.waitingNote && <span className="block text-muted-foreground truncate max-w-[16rem]" title={clock.waitingNote}>{clock.waitingNote}</span>}
    </span>
  );
}

// The same on one line, for board and phone cards. A deal still at Marketing
// with no one named shows nothing: it is not waiting on anyone.
export function WaitingSummary({ deal }: { deal: Pick<ClockDeal, "code" | "clock" | "waitingDays"> }) {
  const c = deal.clock;
  if (!c?.waitingOnParty) return noOneNamed(deal) ? <span className="text-[11px] text-muted-foreground italic truncate">No one named</span> : null;
  return (
    <span className="text-[11px] truncate min-w-0" title={[c.waitingOnParty, c.waitingOnName, c.waitingNote].filter(Boolean).join(" · ")}>
      <span className="text-muted-foreground">Waiting on </span><span className="font-medium">{c.waitingOnParty}</span>
      {c.waitingOnName ? ` · ${c.waitingOnName}` : ""}
      {deal.waitingDays != null && <span className="text-muted-foreground font-mono tabular-nums"> · {deal.waitingDays}d</span>}
    </span>
  );
}

// The deal this one depends on. One the viewer cannot see reads "another deal".
// linkDeals is false for an asset manager or joint agent: they have no deal
// page (it carries BGP's fee), so the deal is named in plain text.
export function DependsOn({ clock, linkDeals = true }: { clock: LandsecDealClock | null; linkDeals?: boolean }) {
  if (clock?.dependsOn) {
    const text = `${clock.dependsOn.unit || clock.dependsOn.name}${clock.dependsOn.ref ? ` #${clock.dependsOn.ref}` : ""}`;
    if (!linkDeals) return <span data-testid="landsec-depends-on-text">{text}</span>;
    return <Link href={`/deals/${clock.dependsOn.id}`} className="hover:underline">{text}</Link>;
  }
  if (clock?.dependsOnHidden) return <span data-testid="landsec-depends-on-hidden">another deal</span>;
  return null;
}

const HIDDEN_DEAL = "__another_deal__";

function WaitingForm({ clock, schemeDeals, onSave, onCancel, saving, testId }: {
  clock: LandsecDealClock | null; schemeDeals: ClockSchemeDeal[];
  onSave: (patch: Record<string, any>) => void; onCancel: () => void; saving: boolean; testId: string;
}) {
  const fromClock = () => ({
    party: clock?.waitingOnParty || "", name: clock?.waitingOnName || "", since: toInputDate(clock?.waitingSince), note: clock?.waitingNote || "",
    dependsOn: clock?.dependsOnHidden ? HIDDEN_DEAL : clock?.dependsOnDealId || "",
  });
  // The form is mounted when it opens, so it starts from the saved clock.
  const [form, setForm] = useState(fromClock);
  // A deal already picked that is not on this scheme's list still has to show.
  const current = clock?.dependsOn && !schemeDeals.some(d => d.id === clock.dependsOn!.id) ? clock.dependsOn : null;
  const label = (d: ClockSchemeDeal) => `${d.unit ? `${d.unit} · ` : ""}${d.name}${d.ref ? ` #${d.ref}` : ""}`;
  return (
    <div className="grid sm:grid-cols-2 gap-1.5 text-sm" data-testid={`${testId}-form`}>
      <label className="text-xs text-muted-foreground">Waiting on
        <select className="h-8 w-full rounded-md border bg-background px-2 text-sm text-foreground" value={form.party} onChange={e => setForm(p => ({ ...p, party: e.target.value }))}>
          <option value="">— no one / not waiting —</option>
          {LANDSEC_WAITING_PARTIES.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
      </label>
      <label className="text-xs text-muted-foreground">Who (name)<Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. the asset manager's name" className="h-8 text-sm" /></label>
      <label className="text-xs text-muted-foreground">Since<Input type="date" value={form.since} onChange={e => setForm(p => ({ ...p, since: e.target.value }))} className="h-8 text-sm" /></label>
      <label className="text-xs text-muted-foreground">Depends on deal
        <select className="h-8 w-full rounded-md border bg-background px-2 text-sm text-foreground" value={form.dependsOn} onChange={e => setForm(p => ({ ...p, dependsOn: e.target.value }))}>
          <option value="">— none —</option>
          {clock?.dependsOnHidden && <option value={HIDDEN_DEAL}>Another deal (not one you can open)</option>}
          {current && <option value={current.id}>{label(current)}</option>}
          {schemeDeals.map(d => <option key={d.id} value={d.id}>{label(d)}</option>)}
        </select>
      </label>
      <label className="text-xs text-muted-foreground sm:col-span-2">What for<Input value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} placeholder="e.g. heads of terms sign-off; CAPR approval; draft lease comments" className="h-8 text-sm" /></label>
      <div className="sm:col-span-2 flex justify-end gap-1">
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button
          size="sm" disabled={saving} data-testid={`${testId}-save`}
          onClick={() => onSave({
            waitingOnParty: form.party || null, waitingOnName: form.name || null, waitingSince: form.since || undefined, waitingNote: form.note || null,
            // A dependency the viewer cannot see is left as it is unless they change it.
            ...(form.dependsOn === HIDDEN_DEAL ? {} : { dependsOnDealId: form.dependsOn || null }),
          })}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

// Who the deal is waiting on, since when, and the deal it depends on, with
// the form to change them. "inline" opens the form in place (the unit page and
// the deal page); "cell" keeps a table row its height and opens the form in a
// popover (the Deals table).
export function WaitingOn({ clock, schemeDeals, onSave, saving, variant = "inline", waitingDays, testId = "landsec-unit-waiting", empty, linkDeals = true }: {
  // A function is only called when the form opens (a table has one per row).
  clock: LandsecDealClock | null; schemeDeals: ClockSchemeDeal[] | (() => ClockSchemeDeal[]);
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

  if (variant === "cell") {
    return (
      <div className="flex items-start gap-1 min-w-0">
        <span className="min-w-0 flex-1">{!clock?.waitingOnParty && empty !== undefined ? empty : <WaitingLine clock={clock} waitingDays={waitingDays} />}</span>
        <Popover open={editing} onOpenChange={setEditing}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
              title={clock?.waitingOnParty ? "Change who this deal is waiting on" : "Set who this deal is waiting on"}
              aria-label={clock?.waitingOnParty ? "Change who this deal is waiting on" : "Set who this deal is waiting on"}
              data-testid={`${testId}-edit`}
            >
              <Pencil className="w-3 h-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[26rem] max-w-[calc(100vw-2rem)] p-3">
            {editing && <WaitingForm clock={clock} schemeDeals={options()} onSave={save} onCancel={() => setEditing(false)} saving={saving} testId={testId} />}
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  if (editing) return <WaitingForm clock={clock} schemeDeals={options()} onSave={save} onCancel={() => setEditing(false)} saving={saving} testId={testId} />;
  const days = waitingDays ?? (clock?.waitingSince ? Math.max(0, Math.floor((Date.now() - new Date(clock.waitingSince).getTime()) / 86400000)) : null);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {clock?.waitingOnParty ? (
        <span>Waiting on <span className="font-medium">{clock.waitingOnParty}</span>{clock.waitingOnName ? ` (${clock.waitingOnName})` : ""}{days != null ? <span className="text-muted-foreground font-mono tabular-nums"> · {days} days</span> : null}{clock.waitingNote ? <span className="text-muted-foreground"> · {clock.waitingNote}</span> : null}</span>
      ) : <span className="text-muted-foreground italic">No one named as waiting on</span>}
      {(clock?.dependsOn || clock?.dependsOnHidden) && <span className="text-muted-foreground">Depends on <span className="text-foreground"><DependsOn clock={clock} linkDeals={linkDeals} /></span></span>}
      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setEditing(true)} data-testid={`${testId}-edit`}><Pencil className="w-3 h-3 mr-1" /> {clock?.waitingOnParty ? "Change" : "Set waiting on"}</Button>
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
      <DaysAtStage code={deal.code} days={deal.days} />
      {who && <span className="truncate text-muted-foreground" title={`Waiting on ${[deal.clock?.waitingOnParty, deal.clock?.waitingOnName].filter(Boolean).join(" · ")}`}>{who}</span>}
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
      variant="cell" clock={deal.clock} waitingDays={deal.waitingDays}
      schemeDeals={() => schemeDealsFor(feed, deal)}
      onSave={patch => onSave(deal.id, patch)} saving={saving}
      testId={`deal-waiting-${deal.id}`}
      empty={landsecInNegotiation(deal.code) ? undefined : <span className="text-muted-foreground">—</span>}
    />
  );
}

// The clock line as the unit page and the deal page show it: stage, who, days
// at this stage, Net Effective Rent, the brief check, then who it is waiting
// on. One component, so the two pages cannot drift.
export function DealClockLine({ stage, code, name, days, ner, incentivesRecorded, brief, briefCheck, jointAgent, unit, clock, waitingDays, schemeDeals, onSave, saving, testId, waitingTestId, label, linkDeals = true }: {
  stage: string | null; code: DealStatusCode | null; name?: string | null; days: number | null;
  ner: LandsecNer | null; incentivesRecorded?: boolean; brief: "agreed" | "drafted" | null; briefCheck: LandsecBriefCheck;
  jointAgent?: string | null; unit?: { href: string | null; label: string } | null;
  clock: LandsecDealClock | null; waitingDays?: number | null; schemeDeals: ClockSchemeDeal[];
  onSave: (patch: Record<string, any>) => void; saving: boolean; testId: string; waitingTestId?: string; label?: string; linkDeals?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2 space-y-1.5" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {label && <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>}
        <span className="rounded-full bg-foreground text-background px-2 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap">{stage || "Live"}</span>
        {name && <span className="font-medium">{name}</span>}
        <DaysAtStage code={code} days={days} long />
        <NerFigure ner={ner} incentivesRecorded={incentivesRecorded} prefix="NER " suffix=" pa" dash={false} />
        {(briefCheck || brief) && <BriefCheck brief={brief} check={briefCheck} />}
        {jointAgent && <span className="text-muted-foreground">Joint agent: {jointAgent}</span>}
        {unit && (unit.href
          ? <Link href={unit.href} className="text-primary hover:underline" data-testid={`${testId}-unit-link`}>{unit.label}</Link>
          : <span className="text-muted-foreground">{unit.label}</span>)}
      </div>
      <WaitingOn clock={clock} waitingDays={waitingDays} schemeDeals={schemeDeals} onSave={onSave} saving={saving} testId={waitingTestId} linkDeals={linkDeals} />
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
      ner={d.ner} incentivesRecorded={d.incentivesRecorded} brief={d.brief} briefCheck={d.briefCheck} jointAgent={d.jointAgent}
      unit={unitLabel ? { href: d.unitId ? `/landsec/unit/${d.unitId}` : null, label: d.unitId ? `Unit page: ${unitLabel}` : unitLabel } : null}
      clock={d.clock} waitingDays={d.waitingDays} schemeDeals={schemeDealsFor(data, d)}
      onSave={patch => save.mutate({ dealId, patch })} saving={save.isPending}
      linkDeals={!restricted}
    />
  );
}
