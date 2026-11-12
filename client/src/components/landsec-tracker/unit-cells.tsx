// The small pieces of a unit's row on the joint agent's tracker: the status
// row-pill, the Heads of Terms chip and the interest, viewings and offers
// cells. Everything shown comes from GET /api/landsec/tracker, which sends
// names, dates and figures only.
import type { ReactNode } from "react";
import { FileSignature, Plus } from "lucide-react";
import { DEAL_STATUS_BADGE_COLORS } from "@/lib/deal-status-colors";
import { interestWho } from "@/components/tracker-activity-cells";
import type { HotsStage } from "@shared/unit-hots";
import type { LandsecTrackerInterestLine, LandsecTrackerOfferLine, LandsecTrackerViewingLine } from "@shared/landsec-tracker";
import { money, shortDay, statusLabel, todayIso } from "./format";

const CHIP = "inline-flex items-center gap-1 rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap leading-none";
const CELL_BUTTON = "inline-flex items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40";

export function StatusPill({ code }: { code: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${DEAL_STATUS_BADGE_COLORS[code] || "bg-muted text-muted-foreground"}`} data-testid={`ja-status-${code}`}>
      {statusLabel(code)}
    </span>
  );
}

const HOTS_LABEL: Record<HotsStage, { label: string; tone: "done" | "waiting" | "quiet" }> = {
  no_template: { label: "Heads of Terms", tone: "quiet" },
  no_draft: { label: "Heads of Terms", tone: "quiet" },
  draft: { label: "HOTs draft", tone: "waiting" },
  agreed: { label: "HOTs agreed", tone: "waiting" },
  issued: { label: "HOTs issued", tone: "done" },
  final: { label: "HOTs final", tone: "done" },
};

export function HotsChip({ stage, onClick, testId }: { stage: HotsStage; onClick: () => void; testId?: string }) {
  const { label, tone } = HOTS_LABEL[stage] || HOTS_LABEL.no_draft;
  const cls = tone === "done" ? "border-emerald-600/60 text-emerald-700 dark:text-emerald-400"
    : tone === "waiting" ? "border-amber-500/60 text-amber-700 dark:text-amber-400"
    : "border-border text-muted-foreground hover:text-foreground";
  return (
    <button type="button" data-no-min-touch onClick={onClick} title="Open the Heads of Terms" className={`${CHIP} ${cls}`} data-testid={testId}>
      <FileSignature className="h-2.5 w-2.5" /> {label}
    </button>
  );
}

// One activity cell: the newest lines, a count that opens the full list, and
// a button that opens the list with its form showing. Each line is cut short
// to the width of its column (the table gives the column a fixed width, so a
// long "brand via agent" line cannot widen it); its title carries the whole
// line.
function ActivityCell({ count, lines, addLabel, onOpen, onAdd, testId }: {
  count: number; lines: ReactNode[]; addLabel: string; onOpen: () => void; onAdd: () => void; testId: string;
}) {
  return (
    <div className="min-w-0 space-y-1" data-testid={testId}>
      {lines.length > 0 && (
        <button type="button" className="block w-full min-w-0 space-y-0.5 text-left text-[11px] leading-tight hover:underline" onClick={onOpen} data-testid={`${testId}-open`}>
          {lines}
        </button>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={CELL_BUTTON} onClick={onAdd} data-testid={`${testId}-add`}><Plus className="h-3 w-3" /> {addLabel}</button>
        {count > 0 && (
          <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground hover:underline" onClick={onOpen} data-testid={`${testId}-count`}>
            {count > lines.length ? "All " : "Open "}<span className="font-mono tabular-nums">{count}</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function InterestCell({ unitId, count, lines, onOpen }: { unitId: string; count: number; lines: LandsecTrackerInterestLine[]; onOpen: () => void }) {
  return (
    <ActivityCell
      testId={`ja-cell-interest-${unitId}`} count={count} addLabel="Interest" onOpen={onOpen} onAdd={onOpen}
      lines={lines.map(i => {
        const { who, via } = interestWho(i);
        return (
          <span key={i.id} className="block truncate" title={[who, via ? `via ${via}` : null, shortDay(i.interestDate)].filter(Boolean).join(" ")}>
            <span className="font-medium">{who}</span>{via && <span className="text-muted-foreground"> via {via}</span>}{" "}
            <span className="tabular-nums text-muted-foreground">{shortDay(i.interestDate)}</span>
          </span>
        );
      })}
    />
  );
}

export function ViewingsCell({ unitId, count, lines, onOpen, onAdd }: { unitId: string; count: number; lines: LandsecTrackerViewingLine[]; onOpen: () => void; onAdd: () => void }) {
  const today = todayIso();
  return (
    <ActivityCell
      testId={`ja-cell-viewings-${unitId}`} count={count} addLabel="Viewing" onOpen={onOpen} onAdd={onAdd}
      lines={lines.map(v => {
        const upcoming = v.status === "scheduled" && String(v.viewingDate || "").slice(0, 10) >= today;
        return (
          <span key={v.id} className="block truncate" title={[`${shortDay(v.viewingDate)}${v.viewingTime ? ` ${v.viewingTime}` : ""}`, v.companyName || v.contactName || "No brand recorded", v.outcome].filter(Boolean).join(" · ")}>
            <span className={`tabular-nums ${upcoming ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{shortDay(v.viewingDate)}{v.viewingTime ? ` ${v.viewingTime}` : ""}</span>{" "}
            <span className="font-medium">{v.companyName || v.contactName || "No brand recorded"}</span>
            {v.outcome && <span className="text-muted-foreground"> · {v.outcome}</span>}
          </span>
        );
      })}
    />
  );
}

export function OffersCell({ unitId, count, lines, onOpen, onAdd }: { unitId: string; count: number; lines: LandsecTrackerOfferLine[]; onOpen: () => void; onAdd: () => void }) {
  return (
    <ActivityCell
      testId={`ja-cell-offers-${unitId}`} count={count} addLabel="Offer" onOpen={onOpen} onAdd={onAdd}
      lines={lines.map(o => (
        <span key={o.id} className="block truncate" title={[o.companyName || "No brand named", o.rentPa != null ? money(o.rentPa) : null, o.status === "Accepted" ? "Agreed" : o.status].filter(Boolean).join(" · ")}>
          <span className="font-medium">{o.companyName || "No brand named"}</span>
          {o.rentPa != null && <span className="font-mono tabular-nums"> {money(o.rentPa)}</span>}
          <span className="text-muted-foreground"> · {o.status === "Accepted" ? "Agreed" : o.status}</span>
        </span>
      ))}
    />
  );
}
