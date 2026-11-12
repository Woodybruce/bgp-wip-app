// The negotiation log on a Letting Tracker offer (Woody, 2026-11-12: "the
// negotiation process from receiving first offer needs to be logged so can
// see how the bid evolved all the way up to the point of HOTs"). Every
// position the bid has been through, the tenant's offers and the landlord's
// counters, with what moved each time; then terms agreed, which is where
// Heads of Terms start. Routes: server/unit-negotiation.ts; the contract is
// shared/unit-negotiation.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { pillMetrics } from "@/components/ui/pill";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  isOpenOffer, roundPartyLabel,
  type OfferNegotiation, type OfferRound, type OfferStatus, type RoundParty,
} from "@shared/unit-negotiation";
import { fmtDay, fmtMoney, fmtShortDay, fmtStamp, serverMessage, statusOf, statusTone, termsInUse } from "./format";
import { RoundForm, type RoundPayload } from "./round-form";
import { RoundsView } from "./rounds-view";

export interface NegotiationPanelProps {
  offerId: string;
  onGenerateHots?: (offerId: string) => void;
  onMoveToNegotiating?: () => void;
  onChanged?: () => void;
}

// One row of GET /api/unit-offers/unit/:unitId/summary.
export interface OfferNegotiationSummary {
  offerId: string;
  companyName: string | null;
  status: OfferStatus;
  rounds: number;
  firstRentPa: number | null;
  latestRentPa: number | null;
  lastRoundDate: string | null;
  lastParty: RoundParty;
  agreedAt: string | null;
}

const MICRO_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const negotiationKey = (offerId: string) => ["/api/unit-offers", offerId, "negotiation"];
const summaryKey = (unitId: string) => ["/api/unit-offers/unit", unitId, "summary"];
const localToday = (): string => new Date().toLocaleDateString("en-CA");

// The comparison table needs room: a column per term. Where the panel has
// less than this (a phone, or a narrow dialog) the rounds read as cards. It
// is the panel's own width that decides, not the window's.
const TABLE_MIN_WIDTH = 720;
function useNarrow(el: HTMLElement | null): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < TABLE_MIN_WIDTH);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setNarrow(el.clientWidth < TABLE_MIN_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return narrow;
}

type Mode =
  | null
  | { kind: "add" }
  | { kind: "edit"; round: OfferRound }
  | { kind: "confirm"; id: string; text: string; label: string; primary: boolean; roundId: string | null; run: () => void };

export function NegotiationPanel({ offerId, onGenerateHots, onMoveToNegotiating, onChanged }: NegotiationPanelProps) {
  const { toast } = useToast();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const narrow = useNarrow(root);
  const key = useMemo(() => negotiationKey(offerId), [offerId]);
  const { data, isLoading, isError, error, refetch } = useQuery<OfferNegotiation>({ queryKey: key });
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [suggestMove, setSuggestMove] = useState(false);

  useEffect(() => { setMode(null); setSuggestMove(false); }, [offerId]);
  // The form and the confirm open under the rounds: bring them into view
  // when a long log has pushed them off the screen.
  const below = useRef<HTMLDivElement>(null);
  const modeKey = mode ? `${mode.kind}:${mode.kind === "edit" ? mode.round.id : mode.kind === "confirm" ? mode.id : ""}` : "";
  useEffect(() => { if (modeKey) below.current?.scrollIntoView({ block: "nearest" }); }, [modeKey]);

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="negotiation-panel-loading">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="space-y-2 text-sm" data-testid="negotiation-panel-error">
        <p>The negotiation could not be loaded. {serverMessage(error, "")}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => refetch()} data-testid="negotiation-retry">Try again</Button>
      </div>
    );
  }

  const { offer, rounds, canEdit, hotsOfferId } = data;
  const status = offer.status;
  const open = isOpenOffer(status);
  const brand = offer.companyName || offer.contactName || "This offer";
  const who = offer.companyName || offer.contactName || "the tenant";   // inside a sentence
  const last = rounds[rounds.length - 1] as OfferRound | undefined;
  const hotsFromThis = hotsOfferId === offer.id;
  const noFigures = rounds.length === 1 && termsInUse(rounds).length === 0;

  // Every write answers with the fresh negotiation: show it at once, then
  // let the tracker's own lists catch up.
  const write = async (failTitle: string, send: () => Promise<Response>, after?: (suggest: string | null) => void) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await send();
      const { suggestStatus, ...next } = (await res.json()) as OfferNegotiation & { suggestStatus?: string | null };
      queryClient.setQueryData(key, next);
      queryClient.invalidateQueries({ queryKey: summaryKey(offer.unitId) });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units", offer.unitId, "offers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-offers"] });
      setMode(null);
      after?.(suggestStatus || null);
      onChanged?.();
    } catch (e) {
      toast({ title: failTitle, description: serverMessage(e, "Try again."), variant: "destructive" });
      // Someone else got there first: show what is true now.
      if ([403, 404, 409].includes(statusOf(e))) { refetch(); setMode(null); }
    } finally {
      setBusy(false);
    }
  };

  const addRound = (payload: RoundPayload) =>
    write("Position not saved", () => apiRequest("POST", `/api/unit-offers/${offer.id}/rounds`, payload),
      suggest => setSuggestMove(suggest === "NEG"));
  const editRound = (round: OfferRound, payload: RoundPayload) =>
    write("Changes not saved", () => apiRequest("PATCH", `/api/unit-offers/rounds/${round.id}`, payload));
  const setStatus = (next: OfferStatus, failTitle: string) =>
    write(failTitle, () => apiRequest("POST", `/api/unit-offers/${offer.id}/status`, { status: next }),
      () => { if (next !== "Negotiating") setSuggestMove(false); });

  const askAgreed = () => setMode({
    kind: "confirm", id: "agreed", primary: true, roundId: null, label: "Yes, terms agreed",
    text: `Mark these terms as agreed with ${who}? Heads of Terms can then be generated from them. No more positions can be added unless the offer is reopened.`,
    run: () => setStatus("Agreed", "Terms not marked as agreed"),
  });
  const askClosed = (next: "Rejected" | "Withdrawn") => setMode({
    kind: "confirm", id: next.toLowerCase(), primary: false, roundId: null, label: `Mark as ${next.toLowerCase()}`,
    text: next === "Rejected"
      ? `Mark the offer from ${who} as rejected? The log is kept and the offer can be reopened.`
      : `Mark the offer from ${who} as withdrawn? The log is kept and the offer can be reopened.`,
    run: () => setStatus(next, "Offer not updated"),
  });
  const askDelete = (round: OfferRound) => setMode({
    kind: "confirm", id: "delete", primary: false, roundId: round.id, label: `Delete round ${round.roundNo}`,
    text: `Delete round ${round.roundNo} (${roundPartyLabel(round.party).toLowerCase()}, ${fmtDay(round.roundDate)}) from the log?${last && round.id === last.id ? " The offer goes back to the position before it." : ""}`,
    run: () => write("Round not deleted", () => apiRequest("DELETE", `/api/unit-offers/rounds/${round.id}`)),
  });

  const activeId = mode?.kind === "edit" ? mode.round.id : mode?.kind === "confirm" ? mode.roundId : null;

  return (
    <div ref={setRoot} className="space-y-3 min-w-0" data-testid="negotiation-panel">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="negotiation-header">
        <p className="text-sm font-semibold min-w-0 break-words">{brand}</p>
        <span className={cn(pillMetrics, statusTone(status))} data-testid="negotiation-status">{status}</span>
        {status === "Agreed" && (
          <p className="text-xs text-muted-foreground basis-full sm:basis-auto" data-testid="negotiation-agreed-line">
            Terms agreed{offer.agreedAt ? ` ${fmtStamp(offer.agreedAt)}` : ""}{offer.agreedByName ? ` by ${offer.agreedByName}` : ""}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <p className={MICRO_LABEL}>How the bid has moved · <span className="font-mono">{rounds.length}</span> {rounds.length === 1 ? "round" : "rounds"}</p>
        <RoundsView rounds={rounds} narrow={narrow} busy={busy} activeId={activeId}
          onEdit={round => setMode({ kind: "edit", round })} onDelete={askDelete} />
        {noFigures && (
          <p className="text-xs text-muted-foreground" data-testid="negotiation-no-figures">
            The first offer has no figures yet.{rounds[0]?.canEdit ? " Edit round 1 to add them." : canEdit && open ? " Add the next position with the figures." : ""}
          </p>
        )}
        {rounds.length === 1 && !noFigures && canEdit && open && mode === null && (
          <p className="text-xs text-muted-foreground" data-testid="negotiation-first-hint">
            This is the first offer. When the landlord counters or the tenant comes back, add the next position so the log shows how the bid moved.
          </p>
        )}
      </div>

      <div ref={below} className="empty:hidden">
      {mode?.kind === "add" && last && (
        <RoundForm key="add" idPrefix="add" title="Add the next position" base={last}
          party={last.party === "tenant" ? "landlord" : "tenant"} roundDate={localToday()} note=""
          requireChange roomy={!narrow} saveLabel="Save position" busy={busy} onCancel={() => setMode(null)} onSave={addRound} />
      )}
      {mode?.kind === "edit" && (
        <RoundForm key={`edit-${mode.round.id}`} idPrefix="edit" title={`Edit round ${mode.round.roundNo}`} base={mode.round}
          party={mode.round.party} roundDate={mode.round.roundDate} note={mode.round.note || ""}
          requireChange={false} roomy={!narrow} saveLabel="Save changes" busy={busy} onCancel={() => setMode(null)}
          onSave={payload => editRound(mode.round, payload)} />
      )}
      {mode?.kind === "confirm" && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-2" role="alertdialog" aria-label={mode.label} data-testid={`negotiation-confirm-${mode.id}`}>
          <p className="text-sm">{mode.text}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setMode(null)} data-testid="negotiation-confirm-cancel">Cancel</Button>
            <Button type="button" variant={mode.primary ? "default" : "outline"} size="sm" disabled={busy} onClick={mode.run}
              className={mode.primary ? undefined : "border-destructive/50 text-destructive hover:text-destructive"} data-testid="negotiation-confirm-yes">
              {busy && <Loader2 className="animate-spin" />}{mode.label}
            </Button>
          </div>
        </div>
      )}
      </div>

      {suggestMove && onMoveToNegotiating && mode === null && open && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="negotiation-suggest-move">
          <span>This unit is still at Marketing.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => { setSuggestMove(false); onMoveToNegotiating(); }} data-testid="negotiation-move-unit">
            Move it to Negotiating
          </Button>
        </div>
      )}

      {canEdit && open && mode === null && (
        <div className="flex flex-wrap items-center gap-2" data-testid="negotiation-actions">
          <Button type="button" variant="outline" size="sm" disabled={busy || !last} onClick={() => setMode({ kind: "add" })} data-testid="negotiation-add-round">
            <Plus /> Add the next position
          </Button>
          <Button type="button" size="sm" disabled={busy || noFigures} title={noFigures ? "Add the figures first" : undefined} onClick={askAgreed} data-testid="negotiation-agree">Terms agreed</Button>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" disabled={busy} onClick={() => askClosed("Rejected")} data-testid="negotiation-reject">Rejected</Button>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" disabled={busy} onClick={() => askClosed("Withdrawn")} data-testid="negotiation-withdraw">Withdrawn</Button>
        </div>
      )}

      {status === "Agreed" && onGenerateHots && (canEdit || hotsFromThis) && (
        <div className="rounded-lg border border-border bg-card p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2" data-testid="negotiation-hots-step">
          <div className="min-w-0">
            <p className="text-sm font-medium">{hotsFromThis ? "Heads of Terms were generated from this offer" : "Next: Heads of Terms"}</p>
            <p className="text-xs text-muted-foreground">
              {hotsFromThis ? "Open them to amend, agree or issue." : `The agreed terms${last && last.rentPa != null ? `, ${fmtMoney(Number(last.rentPa))} a year,` : ""} go straight into the Heads of Terms.`}
            </p>
          </div>
          <Button type="button" size="sm" className="h-auto min-h-8 whitespace-normal text-left sm:shrink-0" onClick={() => onGenerateHots(offer.id)} data-testid="negotiation-generate-hots">
            <FileText /> {hotsFromThis ? "Open Heads of Terms" : "Generate Heads of Terms from these terms"}
          </Button>
        </div>
      )}

      {canEdit && !open && mode === null && data.canReopen === false && (
        <p className="text-xs text-muted-foreground" data-testid="negotiation-reopen-bgp-only">Heads of Terms have gone out from this offer, so only BGP can reopen it.</p>
      )}
      {canEdit && !open && mode === null && data.canReopen !== false && (
        <div className="flex flex-wrap items-center gap-2" data-testid="negotiation-actions">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setStatus("Negotiating", "Offer not reopened")} data-testid="negotiation-reopen">
            {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reopen
          </Button>
          <span className="text-xs text-muted-foreground">
            {status === "Agreed" ? "Reopen to carry on negotiating. The agreed date is cleared." : "Reopen to carry on negotiating."}
          </span>
        </div>
      )}
    </div>
  );
}

// One line for the offers list: "3 rounds · £95,000 to £110,000 · landlord
// countered 10 Nov". Nothing while an offer is still on its first position.
export function NegotiationSummary({ unitId, offerId }: { unitId: string; offerId: string }) {
  const { data } = useQuery<OfferNegotiationSummary[]>({ queryKey: summaryKey(unitId), enabled: !!unitId });
  const row = Array.isArray(data) ? data.find(r => r.offerId === offerId) : undefined;
  if (!row || row.rounds <= 1) return null;
  const money = (n: number) => <span className="font-mono tabular-nums">{fmtMoney(n)}</span>;
  let rent: ReactNode = null;
  if (row.firstRentPa != null && row.latestRentPa != null && row.firstRentPa !== row.latestRentPa) rent = <>{money(row.firstRentPa)} to {money(row.latestRentPa)}</>;
  else if (row.latestRentPa != null) rent = money(row.latestRentPa);
  let lastMove = "";
  if (row.status === "Agreed") {
    const day = row.agreedAt ? new Date(row.agreedAt).toLocaleDateString("en-CA") : null;
    lastMove = day ? `terms agreed ${fmtShortDay(day)}` : "terms agreed";
  } else if (row.status === "Rejected" || row.status === "Withdrawn") {
    lastMove = row.status.toLowerCase();
  } else if (row.lastRoundDate) {
    lastMove = `${row.lastParty === "landlord" ? "landlord countered" : "tenant offered"} ${fmtShortDay(row.lastRoundDate)}`;
  }
  return (
    <span className="text-[11px] text-muted-foreground" data-testid={`negotiation-summary-${offerId}`}>
      <span className="font-mono tabular-nums">{row.rounds}</span> rounds
      {rent && <> · {rent}</>}
      {lastMove && <> · {lastMove}</>}
    </span>
  );
}
