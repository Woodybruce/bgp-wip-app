// The deal page's Negotiation section (Woody, 2026-11-18: "how the
// negotiations have evolved"): the letting's offers and every position, the
// Heads of Terms, the recommendation, the Targeting Brief and the viewings,
// read from GET /api/crm/deals/:id/page. Nothing here writes: each piece
// opens the dialog the Letting Tracker uses, on the deal's tracker unit.
// A deal whose unit has been marketed again since shows its own offers and
// recommendation; the unit's dialogs now open the new letting, so they are
// not offered for it.
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BriefChip } from "@/components/unit-brief/brief-chip";
import { cn } from "@/lib/utils";
import { HOTS_STAGE_LABELS, type DealLettingSummary, type DealOfferLine } from "@shared/deal-page";
import type { LettingDialog } from "./use-deal-page";

const money = (n: number | null) => (n != null ? `£${Math.round(n).toLocaleString("en-GB")}` : "—");
const dayText = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : null);
const STATUS_TONE: Record<string, string> = {
  Agreed: "border-emerald-600/60 text-emerald-700 dark:text-emerald-400",
  Negotiating: "border-amber-500/60 text-amber-700 dark:text-amber-400",
  Pending: "border-border text-foreground",
  Rejected: "border-border text-muted-foreground line-through",
  Withdrawn: "border-border text-muted-foreground",
  Closed: "border-border text-muted-foreground",
};

export const sectionCard = "rounded-xl border border-card-border bg-card shadow-sm p-3 min-w-0";
const heading = "text-sm font-semibold";

function OfferRow({ offer, onOpen }: { offer: DealOfferLine; onOpen: () => void }) {
  const moved = offer.firstRentPa != null && offer.latestRentPa != null && offer.firstRentPa !== offer.latestRentPa;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0" data-testid={`deal-offer-${offer.offerId}`}>
      <span className="font-medium text-sm min-w-0 truncate max-w-[16rem]">{offer.companyName || "Unnamed applicant"}</span>
      <span className={cn("rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide", STATUS_TONE[offer.status] || STATUS_TONE.Pending)}>{offer.status}</span>
      <span className="text-sm font-mono tabular-nums">
        {moved ? <>{money(offer.firstRentPa)} <ArrowRight className="inline w-3 h-3 align-[-1px]" /> {money(offer.latestRentPa)}</> : money(offer.latestRentPa)}
        <span className="text-muted-foreground"> pa</span>
      </span>
      <span className="text-xs text-muted-foreground">
        {offer.rounds} position{offer.rounds === 1 ? "" : "s"}
        {offer.lastRoundDate ? ` · latest ${dayText(offer.lastRoundDate)} (${offer.lastParty === "landlord" ? "our counter" : "their offer"})` : ""}
        {offer.agreedAt ? ` · agreed ${dayText(offer.agreedAt)}` : ""}
      </span>
      <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={onOpen} data-testid={`deal-offer-open-${offer.offerId}`}>Negotiation</Button>
    </li>
  );
}

export function DealNegotiation({ letting, trackerHref, onOpen }: {
  letting: DealLettingSummary; trackerHref: string | null; onOpen: (d: LettingDialog) => void;
}) {
  const live = letting.current;
  const rec = letting.recommendation;
  const recLine = !rec ? "Not written yet"
    : rec.decidedAt ? `Approved by the client ${dayText(rec.decidedAt)}`
    : rec.issuedAt ? `Issued ${dayText(rec.issuedAt)}${rec.total ? ` · ${rec.approved} of ${rec.total} approved${rec.declined ? `, ${rec.declined} declined` : ""}` : ""}`
    : "Draft, not issued";
  const v = letting.viewings;
  return (
    <div className="grid grid-cols-1 gap-3 min-w-0" data-testid="deal-negotiation">
      {!live && (
        <div className={cn(sectionCard, "text-sm")} data-testid="deal-letting-earlier">
          This unit has been marketed again since this deal. Below are this letting's own offers and recommendation; the unit's Heads of Terms, brief and checklist now belong to the new letting.
          {letting.currentDealId && <> <Link href={`/deals/${letting.currentDealId}`} className="text-primary hover:underline">Open the current letting</Link>.</>}
        </div>
      )}
      <div className={sectionCard} data-testid="deal-offers">
        <div className="flex items-center gap-2 mb-2">
          <h3 className={heading}>Offers</h3>
          <span className="text-xs text-muted-foreground font-mono tabular-nums">{letting.offers.length}</span>
        </div>
        {letting.offers.length === 0
          ? <p className="text-sm text-muted-foreground">No offers logged on this letting.{trackerHref ? <> Offers are logged on the <Link href={trackerHref} className="text-primary hover:underline">Letting Tracker</Link>.</> : null}</p>
          : <ul className="divide-y divide-border">{letting.offers.map(o => <OfferRow key={o.offerId} offer={o} onOpen={() => onOpen({ to: "offer", offerId: o.offerId })} />)}</ul>}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className={sectionCard} data-testid="deal-hots">
          <h3 className={heading}>Heads of Terms</h3>
          {letting.hots ? (
            <div className="mt-1 space-y-1 text-sm">
              <p>{HOTS_STAGE_LABELS[letting.hots.stage]}{letting.hots.version > 1 ? <span className="text-muted-foreground"> · version {letting.hots.version}</span> : null}</p>
              {letting.hots.issuedAt && <p className="text-xs text-muted-foreground">Issued {dayText(letting.hots.issuedAt)}{letting.hots.issuedByName ? ` by ${letting.hots.issuedByName}` : ""}</p>}
              {letting.hots.finalAt && <p className="text-xs text-muted-foreground">Final copy filed {dayText(letting.hots.finalAt)}{letting.hots.finalByName ? ` by ${letting.hots.finalByName}` : ""}</p>}
            </div>
          ) : <p className="mt-1 text-sm text-muted-foreground">{live ? "Not started" : "Belongs to the unit's new letting now"}</p>}
          {live && <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={() => onOpen({ to: "hots" })} data-testid="deal-open-hots">Open Heads of Terms</Button>}
        </div>
        <div className={sectionCard} data-testid="deal-recommendation">
          <h3 className={heading}>Transaction recommendation</h3>
          <p className="mt-1 text-sm">{recLine}</p>
          {live && <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={() => onOpen({ to: "recommendation" })} data-testid="deal-open-recommendation">Open the recommendation</Button>}
        </div>
        <div className={sectionCard} data-testid="deal-brief">
          <h3 className={heading}>Targeting Brief</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {live
              ? <BriefChip brief={letting.brief ? { id: letting.brief.id, signoff: letting.brief.signoff, agreedAt: letting.brief.agreedAt } : null} onClick={() => onOpen({ to: "brief" })} testId="deal-brief-chip" />
              : <span className="text-sm text-muted-foreground">{letting.brief?.agreedAt ? `Agreed ${dayText(letting.brief.agreedAt)}` : "On the unit's new letting"}</span>}
          </div>
        </div>
        <div className={sectionCard} data-testid="deal-viewings">
          <h3 className={heading}>Viewings</h3>
          <p className="mt-1 text-sm">
            {v.total === 0 ? <span className="text-muted-foreground">None on this letting.</span>
              : <>{v.total} viewing{v.total === 1 ? "" : "s"}<span className="text-muted-foreground">{` · ${v.completed} done${v.upcoming ? `, ${v.upcoming} booked` : ""}`}</span></>}
          </p>
          {(v.last || v.next) && <p className="text-xs text-muted-foreground">{[v.last ? `Last ${dayText(v.last)}` : null, v.next ? `next ${dayText(v.next)}` : null].filter(Boolean).join(" · ")}</p>}
          {trackerHref && <Link href={trackerHref} className="mt-2 inline-block text-xs text-primary hover:underline" data-testid="deal-open-tracker">Open on the Letting Tracker</Link>}
        </div>
      </div>
    </div>
  );
}
