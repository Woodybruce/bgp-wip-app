// Interest, viewings and offers on the Letting Tracker's main table (Woody,
// 2026-11-12: "display interest and viewings on the main table with full
// functionality rather than the icon at the end", then "add offers to the
// main letting tracker rather than on the actions ... easy to see and read
// with pop out"). Each cell lists the unit's entries where they can be read
// without opening anything, and carries the same actions the dialogs have:
// add, edit, remove, and (for interest) put the brand onto the unit's targets.
import { Fragment, useEffect, useRef, useState } from "react";
import { CalendarPlus, Flame, HandCoins, Loader2, Mail, Pencil, Plus, Target, X } from "lucide-react";
import type { UnitOffer, UnitViewing } from "@shared/schema";
import { OFFER_STATUSES, ROUND_TERM_FIELDS, isOpenOffer, type OfferStatus } from "@shared/unit-negotiation";
import { Button } from "@/components/ui/button";
import { Pill, pillActive, pillMetrics } from "@/components/ui/pill";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NegotiationSummary } from "@/components/unit-negotiation/negotiation-panel";
import { fmtDay, fmtMoney, fmtStamp, fmtTerm, isBlank } from "@/components/unit-negotiation/format";
import { cn } from "@/lib/utils";

const SHOWN = 3;
const CELL_BUTTON = "inline-flex items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40";
const ROW_ICON = "p-0.5 rounded text-muted-foreground hover:text-foreground focus-visible:text-foreground";
const todayIso = () => new Date().toISOString().slice(0, 10);

// "2026-11-12" → "12 Nov" (the year only when it is not this one).
function shortDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.getUTCFullYear() !== new Date().getUTCFullYear() ? { year: "2-digit" as const } : {}) });
}

const VIEWING_STATUS: Record<string, { label: string; tone: string }> = {
  completed: { label: "Attended", tone: "border-emerald-600/60 text-emerald-700 dark:text-emerald-400" },
  no_show: { label: "No-show", tone: "border-amber-500/60 text-amber-700 dark:text-amber-400" },
  cancelled: { label: "Cancelled", tone: "border-border text-muted-foreground" },
  not_leasing: { label: "Not a viewing", tone: "border-border text-muted-foreground" },
};

// Coming up first (soonest at the top), then the past, most recent first.
export function orderViewings<T extends { viewingDate?: string | null; viewingTime?: string | null }>(viewings: T[]): T[] {
  const today = todayIso();
  const key = (v: T) => `${String(v.viewingDate || "").slice(0, 10)} ${v.viewingTime || ""}`;
  const upcoming = viewings.filter(v => String(v.viewingDate || "").slice(0, 10) >= today).sort((a, b) => key(a).localeCompare(key(b)));
  const past = viewings.filter(v => String(v.viewingDate || "").slice(0, 10) < today).sort((a, b) => key(b).localeCompare(key(a)));
  return [...upcoming, ...past];
}

export function TrackerViewingsCell({ unitId, viewings, onOpen, onAdd, onEdit }: {
  unitId: string;
  viewings: UnitViewing[];
  onOpen: () => void;                 // the unit's full viewings list
  onAdd: () => void;                  // the add-viewing form
  onEdit: (v: UnitViewing) => void;   // that viewing, in the edit form
}) {
  const ordered = orderViewings(viewings);
  const today = todayIso();
  return (
    <div className="space-y-1 min-w-0" data-testid={`cell-viewings-${unitId}`}>
      {ordered.slice(0, SHOWN).map(v => {
        const who = v.companyName || v.contactName || v.attendees || "No brand recorded";
        const status = VIEWING_STATUS[String(v.status || "")];
        const upcoming = String(v.viewingDate || "").slice(0, 10) >= today && !status;
        return (
          <div key={v.id} className="group/entry flex items-start gap-1 text-[11px] leading-tight" data-testid={`cell-viewing-${v.id}`}>
            <button type="button" className="min-w-0 flex-1 text-left hover:underline" onClick={() => onEdit(v)} title={[who, v.contactName && v.companyName ? `with ${v.contactName}` : null, v.outcome || v.notes].filter(Boolean).join(" · ")}>
              <span className={`tabular-nums ${upcoming ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{shortDate(v.viewingDate)}{v.viewingTime ? ` ${v.viewingTime}` : ""}</span>{" "}
              <span className="font-medium">{who}</span>
              {v.contactName && v.companyName && <span className="text-muted-foreground"> · {v.contactName}</span>}
              {status && <span className={`ml-1 rounded-full border px-1 py-px text-[9px] font-semibold uppercase tracking-wide whitespace-nowrap ${status.tone}`}>{status.label}</span>}
              {v.outcome && <span className="block truncate text-muted-foreground">{v.outcome}</span>}
            </button>
            <button type="button" className={`${ROW_ICON} opacity-0 group-hover/entry:opacity-100 focus-visible:opacity-100`} onClick={() => onEdit(v)} aria-label={`Edit the viewing with ${who}`} title="Edit this viewing" data-testid={`cell-viewing-edit-${v.id}`}>
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={CELL_BUTTON} onClick={onAdd} data-testid={`cell-viewing-add-${unitId}`}>
          <CalendarPlus className="h-3 w-3" /> Viewing
        </button>
        {ordered.length > 0 && (
          <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground hover:underline tabular-nums" onClick={onOpen} data-testid={`cell-viewings-all-${unitId}`}>
            {ordered.length > SHOWN ? `All ${ordered.length}` : "Open"}
          </button>
        )}
      </div>
    </div>
  );
}

export interface TrackerInterest { id: string; unitId: string; companyName: string | null; contactName: string | null; agentCompanyName?: string | null; interestDate: string; notes: string | null; source: string | null }

// Who an interest entry is from: the brand, with the agent it came through;
// or the agent alone when no brand has been named yet.
export function interestWho(i: { companyName?: string | null; contactName?: string | null; agentCompanyName?: string | null }): { who: string; via: string | null } {
  if (i.companyName) return { who: i.companyName, via: i.agentCompanyName || null };
  if (i.agentCompanyName) return { who: `${i.agentCompanyName} (agent)`, via: null };
  return { who: i.contactName || "Unknown", via: null };
}

export function TrackerInterestCell({ unitId, interest, canTarget, addingTargetId, deletingId, onOpen, onAdd, onAddTarget, onDelete }: {
  unitId: string;
  interest: TrackerInterest[];
  canTarget: boolean;                 // BGP staff: a client login cannot put a brand on the targets from here
  addingTargetId: string | null;
  deletingId: string | null;
  onOpen: () => void;                 // the unit's interest list, with the log-interest form
  onAdd: () => void;
  onAddTarget: (i: TrackerInterest) => void;
  onDelete: (i: TrackerInterest) => void;
}) {
  const ordered = [...interest].sort((a, b) => String(b.interestDate || "").localeCompare(String(a.interestDate || "")));
  return (
    <div className="space-y-1 min-w-0" data-testid={`cell-interest-${unitId}`}>
      {ordered.slice(0, SHOWN).map(i => {
        const { who, via } = interestWho(i);
        return (
          <div key={i.id} className="group/entry flex items-start gap-0.5 text-[11px] leading-tight" data-testid={`cell-interest-row-${i.id}`}>
            <button type="button" className="min-w-0 flex-1 text-left hover:underline" onClick={onOpen} title={[who, via ? `via ${via}` : null, i.contactName && i.companyName ? i.contactName : null, i.notes].filter(Boolean).join(" · ")}>
              <span className="font-medium">{who}</span>{via && <span className="text-muted-foreground"> via {via}</span>}{" "}
              <span className="tabular-nums text-muted-foreground">{shortDate(i.interestDate)}</span>
              {i.source === "email" && <span className="ml-1 text-[9px] uppercase tracking-wide text-muted-foreground">inbox</span>}
              {i.notes && <span className="block truncate text-muted-foreground">{i.notes}</span>}
            </button>
            {canTarget && (i.companyName || i.contactName) && (
              <button type="button" className={`${ROW_ICON} opacity-0 group-hover/entry:opacity-100 focus-visible:opacity-100`} disabled={addingTargetId === i.id} onClick={() => onAddTarget(i)} aria-label={`Add ${who} to this unit's target operators`} title={`Add ${who} to this unit's target operators, with these notes`} data-testid={`cell-interest-target-${i.id}`}>
                {addingTargetId === i.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Target className="h-3 w-3" />}
              </button>
            )}
            <button type="button" className={`${ROW_ICON} hover:text-destructive opacity-0 group-hover/entry:opacity-100 focus-visible:opacity-100`} disabled={deletingId === i.id} onClick={() => onDelete(i)} aria-label={`Remove the interest from ${who}`} title="Remove this interest" data-testid={`cell-interest-delete-${i.id}`}>
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={CELL_BUTTON} onClick={onAdd} data-testid={`cell-interest-add-${unitId}`}>
          <Plus className="h-3 w-3" /><Flame className="h-3 w-3" /> Interest
        </button>
        {ordered.length > SHOWN && (
          <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground hover:underline tabular-nums" onClick={onOpen} data-testid={`cell-interest-all-${unitId}`}>
            All {ordered.length}
          </button>
        )}
      </div>
    </div>
  );
}

// An offer as GET /api/available-units/all-offers sends it: the offer row
// plus who logged it, how many positions it has been through and when its
// terms were agreed.
export type TrackerOffer = UnitOffer & { loggedByName?: string | null; rounds?: number | null; agreedAt?: string | null; agreedByName?: string | null };

// Old rows may say "Accepted" (read as Agreed) or nothing at all (Pending).
export const offerStatus = (raw: string | null | undefined): OfferStatus =>
  raw === "Accepted" ? "Agreed" : (OFFER_STATUSES as readonly string[]).includes(raw || "") ? (raw as OfferStatus) : "Pending";

// The status chip: Agreed is the filled pill, Negotiating a dark outline,
// Rejected the destructive outline, Withdrawn (and an offer from an earlier
// letting) a dashed one, Pending the quiet outline.
const OFFER_TONE: Record<OfferStatus, string> = {
  Agreed: "",
  Negotiating: "border-foreground/40 text-foreground",
  Pending: "",
  Rejected: "border-destructive/50 text-destructive hover:text-destructive",
  Withdrawn: "border-dashed",
  Closed: "border-dashed",
};
// The same chip where it is not a button (the pop-out, the Offers dialog).
export const offerStatusChip = (status: OfferStatus): string =>
  cn(pillMetrics, status === "Agreed" ? pillActive : "bg-transparent text-muted-foreground border border-border", OFFER_TONE[status]);

// Agreed first, then the offers still in play, then the ones that fell away;
// the newest first within each.
const OFFER_RANK: Record<OfferStatus, number> = { Agreed: 0, Negotiating: 1, Pending: 2, Rejected: 3, Withdrawn: 4, Closed: 5 };
export function orderOffers<T extends { status?: string | null; offerDate?: string | null; createdAt?: unknown }>(offers: T[]): T[] {
  const when = (o: T) => `${String(o.offerDate || "").slice(0, 10)} ${String(o.createdAt || "")}`;
  return [...offers].sort((a, b) => OFFER_RANK[offerStatus(a.status)] - OFFER_RANK[offerStatus(b.status)] || when(b).localeCompare(when(a)));
}

const offerBrand = (o: TrackerOffer): string => o.companyName || o.contactName || "No brand recorded";

interface OfferActions {
  canEmail: boolean;                        // BGP staff: the email an offer was detected from
  onOpen: (o?: TrackerOffer) => void;       // the Offers dialog, on that offer's negotiation log when one is given
  onAdd: () => void;                        // the add-offer form
  onEdit: (o: TrackerOffer) => void;        // that offer, in the edit form
  onEmail: (o: TrackerOffer) => void;
}

// Everything recorded on one offer, to read without opening the dialog.
function OfferDetail({ unitId, offer, actions, onDone }: { unitId: string; offer: TrackerOffer; actions: OfferActions; onDone: () => void }) {
  const status = offerStatus(offer.status);
  const terms = ROUND_TERM_FIELDS.filter(f => !isBlank(offer[f.key]));
  const rounds = Number(offer.rounds) || 1;
  const logged = fmtStamp(offer.createdAt as unknown as string);
  // Where the negotiation stands. A bid with more than one position reads
  // from its log ("3 rounds · £95,000 to £110,000 · terms agreed 10 Nov").
  const stands = status === "Agreed" ? `Terms agreed${offer.agreedAt ? ` ${fmtStamp(offer.agreedAt)}` : ""}`
    : status === "Closed" ? "From an earlier letting of this unit"
    : status === "Rejected" || status === "Withdrawn" ? status
    : status === "Negotiating" ? "Under negotiation, one position logged" : "First offer, no counter yet";
  const run = (fn: () => void) => () => { onDone(); fn(); };
  return (
    <div className="space-y-3 min-w-0 text-sm" data-testid={`offer-detail-${offer.id}`}>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        {terms.map(f => (
          <Fragment key={f.key}>
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd className="font-medium tabular-nums break-words">{fmtTerm(f, offer[f.key])}</dd>
          </Fragment>
        ))}
        <dt className="text-muted-foreground">Received</dt>
        <dd className="font-medium tabular-nums">{fmtDay(offer.offerDate)}</dd>
      </dl>
      {terms.length === 0 && <p className="text-xs text-muted-foreground">No figures recorded yet.</p>}
      {offer.comments && (
        <div className="space-y-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</p>
          <p className="text-xs whitespace-pre-wrap break-words max-h-40 overflow-y-auto" data-testid={`offer-detail-notes-${offer.id}`}>{offer.comments}</p>
        </div>
      )}
      <div className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
        <p className={cn("break-words", rounds <= 1 && "text-foreground")} data-testid={`offer-detail-stands-${offer.id}`}>
          {rounds > 1 ? <NegotiationSummary unitId={unitId} offerId={offer.id} /> : stands}
          {status === "Agreed" && offer.agreedByName ? ` by ${offer.agreedByName}` : ""}
          {status === "Closed" && rounds > 1 ? " · from an earlier letting of this unit" : ""}
        </p>
        {(offer.loggedByName || logged) && <p className="break-words">Logged{offer.loggedByName ? ` by ${offer.loggedByName}` : ""}{logged ? ` on ${logged}` : ""}</p>}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{offer.source === "email" ? "From an email: confirm the figures against it" : offer.viewingId ? "Recorded after a viewing" : "Entered on the tracker"}</span>
          {actions.canEmail && offer.emailConversationId && (
            <button type="button" className="inline-flex items-center gap-1 text-foreground hover:underline" onClick={run(() => actions.onEmail(offer))} data-testid={`offer-detail-email-${offer.id}`}>
              <Mail className="h-3 w-3" /> Open the email
            </button>
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" size="sm" className="h-8 px-2.5 text-xs" onClick={run(() => actions.onOpen(offer))} data-testid={`offer-detail-open-${offer.id}`}>Open offer</Button>
        {isOpenOffer(status) && <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={run(() => actions.onEdit(offer))} data-testid={`offer-detail-edit-${offer.id}`}>Edit</Button>}
        <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={run(actions.onAdd)} data-testid={`offer-detail-add-${offer.id}`}>Add offer</Button>
      </div>
    </div>
  );
}

// One offer on one line: the brand, the headline rent, the status. Click it
// (or rest the pointer on it) for the pop-out; on a phone it is a bottom sheet.
function OfferLine({ unitId, offer, sheet, actions }: { unitId: string; offer: TrackerOffer; sheet: boolean; actions: OfferActions }) {
  const [open, setOpen] = useState(false);
  // A click keeps the pop-out open until it is dismissed; a hover closes when the pointer leaves.
  const pinned = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const status = offerStatus(offer.status);
  const brand = offerBrand(offer);
  const agreed = status === "Agreed";
  const gone = status === "Rejected" || status === "Withdrawn" || status === "Closed";
  const pin = () => { window.clearTimeout(timer.current); pinned.current = true; setOpen(true); };
  const close = () => { window.clearTimeout(timer.current); pinned.current = false; setOpen(false); };
  const hover = (over: boolean) => {
    if (sheet) return;
    window.clearTimeout(timer.current);
    if (over) timer.current = window.setTimeout(() => setOpen(true), 350);
    else if (!pinned.current) timer.current = window.setTimeout(() => setOpen(false), 250);
  };
  const heading = (
    <div className="flex items-start justify-between gap-2 min-w-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-tight break-words">{brand}</p>
        {offer.companyName && offer.contactName && <p className="text-xs text-muted-foreground break-words">Offer from {offer.contactName}</p>}
      </div>
      <span className={cn(offerStatusChip(status), "shrink-0")} data-testid={`offer-detail-status-${offer.id}`}>{status}</span>
    </div>
  );
  const line = (
    <div
      className={cn("flex items-center gap-1.5 min-w-0 text-xs leading-tight", agreed && "border-l-2 border-foreground pl-1.5")}
      onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)} data-testid={`cell-offer-${offer.id}`}
    >
      <button type="button" className="group/offer flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={pin} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Offer from ${brand}${offer.rentPa != null ? `, ${fmtMoney(offer.rentPa)} a year` : ""}, ${status.toLowerCase()}: show the detail`}>
        <span className={cn("min-w-0 truncate group-hover/offer:underline", agreed ? "font-semibold" : "font-medium", gone && "text-muted-foreground")}>{brand}</span>
        <span className={cn("shrink-0 whitespace-nowrap tabular-nums", agreed ? "font-semibold" : "text-muted-foreground")}>
          {offer.rentPa != null ? <>{fmtMoney(offer.rentPa)} <span className="font-normal text-muted-foreground">pa</span></> : "no rent yet"}
        </span>
      </button>
      <Pill active={agreed} className={cn("shrink-0", OFFER_TONE[status])} onClick={pin} tabIndex={-1} aria-hidden data-testid={`cell-offer-status-${offer.id}`}>{status}</Pill>
    </div>
  );
  if (sheet) {
    return (
      <>
        {line}
        <Sheet open={open} onOpenChange={v => (v ? pin() : close())}>
          <SheetContent side="bottom" className="flex flex-col gap-3 max-h-[90dvh] overflow-y-auto rounded-t-2xl p-4 pr-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" data-testid={`offer-popout-${offer.id}`}>
            <SheetHeader className="sr-only">
              <SheetTitle>Offer from {brand}</SheetTitle>
              <SheetDescription>The terms and history of this offer</SheetDescription>
            </SheetHeader>
            <div className="pr-8">{heading}</div>
            <OfferDetail unitId={unitId} offer={offer} actions={actions} onDone={close} />
          </SheetContent>
        </Sheet>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={v => (v ? setOpen(true) : close())}>
      <PopoverAnchor asChild>{line}</PopoverAnchor>
      <PopoverContent
        align="start" side="left" sideOffset={10} collisionPadding={8}
        className="w-[340px] max-w-[calc(100vw-1rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto space-y-3 p-3"
        onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}
        onOpenAutoFocus={e => { if (!pinned.current) e.preventDefault(); }}
        data-testid={`offer-popout-${offer.id}`}
      >
        {heading}
        <OfferDetail unitId={unitId} offer={offer} actions={actions} onDone={close} />
      </PopoverContent>
    </Popover>
  );
}

export function TrackerOffersCell({ unitId, offers, shown = SHOWN, sheet = false, addTestId, canEmail, onOpen, onAdd, onEdit, onEmail }: OfferActions & {
  unitId: string;
  offers: TrackerOffer[];
  shown?: number;       // how many offers to list before "+N more"
  sheet?: boolean;      // phone: the detail opens as a bottom sheet, and nothing opens on hover
  addTestId?: string;
}) {
  const ordered = orderOffers(offers);
  const actions: OfferActions = { canEmail, onOpen, onAdd, onEdit, onEmail };
  return (
    <div className="space-y-1 min-w-0" data-testid={`cell-offers-${unitId}`}>
      {ordered.slice(0, shown).map(o => <OfferLine key={o.id} unitId={unitId} offer={o} sheet={sheet} actions={actions} />)}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={CELL_BUTTON} onClick={onAdd} data-testid={addTestId || `cell-offer-add-${unitId}`}>
          <Plus className="h-3 w-3" /><HandCoins className="h-3 w-3" /> {ordered.length > 0 ? "Offer" : "Add offer"}
        </button>
        {ordered.length > 0 && (
          <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground hover:underline tabular-nums" onClick={() => onOpen()} data-testid={`cell-offers-all-${unitId}`}>
            {ordered.length > shown ? `+${ordered.length - shown} more` : "Open"}
          </button>
        )}
      </div>
    </div>
  );
}
