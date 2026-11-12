// Interest and viewings on the Letting Tracker's main table (Woody,
// 2026-11-12: "display interest and viewings on the main table with full
// functionality rather than the icon at the end"). Each cell lists the
// unit's entries where they can be read without opening anything, and
// carries the same actions the dialogs have: add, edit, remove, and (for
// interest) put the brand onto the unit's targets.
import { CalendarPlus, Flame, Loader2, Pencil, Plus, Target, X } from "lucide-react";
import type { UnitViewing } from "@shared/schema";

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
