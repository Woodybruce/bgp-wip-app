// The positions of a negotiation, oldest first. With room: a comparison
// table, one row per round and one column per term that has a value in any
// round, with what moved since the round before picked out. Without (a
// phone, a narrow dialog): one card per round listing only what moved
// (round 1 lists everything it has).
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pillMetrics } from "@/components/ui/pill";
import { cn } from "@/lib/utils";
import { roundChanges, roundNetEffectiveRent, roundPartyLabel, type OfferRound } from "@shared/unit-negotiation";
import { direction, fmtDay, fmtMoney, fmtStamp, fmtTerm, isBlank, partyTone, termsInUse, type TermField } from "./format";

interface RoundsViewProps {
  rounds: OfferRound[];
  narrow: boolean;               // cards (a phone, a narrow dialog) in place of the table
  busy: boolean;
  activeId: string | null;       // the round being edited or about to be deleted
  onEdit: (round: OfferRound) => void;
  onDelete: (round: OfferRound) => void;
}

const HEAD = "px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const MOVED = "bg-foreground/10 text-foreground font-semibold";

function Arrow({ dir }: { dir: 1 | -1 | 0 }) {
  if (dir === 0) return null;
  return dir === 1
    ? <ArrowUp className="h-3 w-3 shrink-0" aria-label="up" />
    : <ArrowDown className="h-3 w-3 shrink-0" aria-label="down" />;
}

function PartyChip({ party }: { party: string }) {
  return <span className={cn(pillMetrics, partyTone(party))}>{roundPartyLabel(party)}</span>;
}

function loggedLine(r: OfferRound): string {
  if (!r.createdByName) return "";
  const when = fmtStamp(r.createdAt);
  return `Logged by ${r.createdByName}${when ? ` on ${when}` : ""}`;
}

function RoundActions({ r, index, busy, onEdit, onDelete }: { r: OfferRound; index: number; busy: boolean; onEdit: (r: OfferRound) => void; onDelete: (r: OfferRound) => void }) {
  if (!r.canEdit) return null;
  return (
    <div className="flex items-center justify-end gap-0.5">
      <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" disabled={busy}
        aria-label={`Edit round ${r.roundNo}`} title={`Edit round ${r.roundNo}`} onClick={() => onEdit(r)} data-testid={`negotiation-round-edit-${r.id}`}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      {index > 0 && (
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" disabled={busy}
          aria-label={`Delete round ${r.roundNo}`} title={`Delete round ${r.roundNo}`} onClick={() => onDelete(r)} data-testid={`negotiation-round-delete-${r.id}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

export function RoundsView({ rounds, narrow, busy, activeId, onEdit, onDelete }: RoundsViewProps) {
  const fields = termsInUse(rounds);
  const ners = rounds.map(r => roundNetEffectiveRent(r));
  const showNer = ners.some(n => n !== null);
  const anyActions = rounds.some(r => r.canEdit);

  if (narrow) {
    return (
      <div className="space-y-2" data-testid="negotiation-round-cards">
        {rounds.map((r, i) => {
          const prev = i > 0 ? rounds[i - 1] : null;
          const moved = prev ? roundChanges(prev, r) : [];
          const listed: TermField[] = prev ? fields.filter(f => moved.includes(f.key)) : fields.filter(f => !isBlank(r[f.key]));
          const nerMoved = prev !== null && ners[i] !== ners[i - 1];
          const logged = loggedLine(r);
          return (
            <div key={r.id} className={cn("rounded-2xl border border-border bg-card p-3 space-y-2 min-w-0", activeId === r.id && "ring-1 ring-ring")} data-testid={`negotiation-round-${r.roundNo}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">Round {r.roundNo} <span className="font-normal text-muted-foreground">· {fmtDay(r.roundDate)}</span></p>
                  <PartyChip party={r.party} />
                </div>
                <RoundActions r={r} index={i} busy={busy} onEdit={onEdit} onDelete={onDelete} />
              </div>
              {listed.length > 0 ? (
                <dl className="space-y-1.5">
                  {listed.map(f => {
                    const text = fmtTerm(f, r[f.key]);
                    const before = prev ? fmtTerm(f, prev[f.key]) : "";
                    return (
                      <div key={f.key} className="flex items-start justify-between gap-3 text-sm">
                        <dt className="text-muted-foreground shrink-0">{f.label}</dt>
                        <dd className={cn("min-w-0 text-right break-words", f.kind !== "text" && "font-mono tabular-nums")}>
                          <span className="inline-flex items-center gap-0.5">
                            <Arrow dir={direction(f, prev, r)} />{text || "Removed"}
                          </span>
                          {prev && before && <span className="block text-[11px] text-muted-foreground">was {before}</span>}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">{prev ? "No change to the terms." : "No figures logged yet."}</p>
              )}
              {showNer && ners[i] !== null && (prev === null || nerMoved) && (
                <div className="flex items-start justify-between gap-3 text-sm border-t border-border pt-1.5">
                  <span className="text-muted-foreground">Net effective</span>
                  <span className="font-mono tabular-nums text-right">
                    <span className="inline-flex items-center gap-0.5">
                      {prev && ners[i - 1] !== null && <Arrow dir={(ners[i] as number) > (ners[i - 1] as number) ? 1 : -1} />}{fmtMoney(ners[i] as number)}
                    </span>
                    {prev && ners[i - 1] !== null && <span className="block text-[11px] text-muted-foreground">was {fmtMoney(ners[i - 1] as number)}</span>}
                  </span>
                </div>
              )}
              {(r.note || logged) && (
                <div className="space-y-0.5">
                  {r.note && <p className="text-sm whitespace-pre-wrap break-words" data-testid={`negotiation-round-note-${r.id}`}>{r.note}</p>}
                  {logged && <p className="text-[11px] text-muted-foreground">{logged}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const columns = 3 + fields.length + (showNer ? 1 : 0) + (anyActions ? 1 : 0);
  return (
    <div className="overflow-x-auto rounded-lg border border-border" data-testid="negotiation-round-table">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-muted/50 text-left">
            <th className={HEAD} scope="col">Round</th>
            <th className={HEAD} scope="col">Date</th>
            <th className={HEAD} scope="col">Position</th>
            {fields.map(f => <th key={f.key} scope="col" className={cn(HEAD, f.kind !== "text" && "text-right")}>{f.label}</th>)}
            {showNer && <th scope="col" className={cn(HEAD, "text-right")}>Net effective</th>}
            {anyActions && <th scope="col" className={HEAD}><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {rounds.map((r, i) => {
            const prev = i > 0 ? rounds[i - 1] : null;
            const moved = prev ? roundChanges(prev, r) : [];
            const nerMoved = prev !== null && ners[i] !== ners[i - 1];
            const nerDir: 1 | -1 | 0 = nerMoved && ners[i] !== null && ners[i - 1] !== null ? ((ners[i] as number) > (ners[i - 1] as number) ? 1 : -1) : 0;
            const logged = loggedLine(r);
            return [
              <tr key={r.id} className={cn("border-t border-border [&>td]:align-baseline", activeId === r.id && "bg-accent")} data-testid={`negotiation-round-${r.roundNo}`}>
                <td className="px-2 py-2 font-mono tabular-nums text-muted-foreground">{r.roundNo}</td>
                <td className="px-2 py-2 whitespace-nowrap">{fmtDay(r.roundDate)}</td>
                <td className="px-2 py-2"><PartyChip party={r.party} /></td>
                {fields.map(f => {
                  const text = fmtTerm(f, r[f.key]);
                  const changed = moved.includes(f.key);
                  return (
                    <td key={f.key} className={cn("px-2 py-1.5", f.kind === "text" ? "min-w-[8rem] max-w-[16rem] break-words" : "text-right font-mono tabular-nums whitespace-nowrap")} data-testid={`negotiation-cell-${r.roundNo}-${f.key}`} data-moved={changed ? "yes" : "no"}>
                      {(text || changed) && (
                        <span className={cn("inline-flex items-center gap-0.5 rounded px-1 py-0.5", changed ? MOVED : prev ? "text-muted-foreground" : "text-foreground")}>
                          <Arrow dir={direction(f, prev, r)} />{text || "Removed"}
                        </span>
                      )}
                    </td>
                  );
                })}
                {showNer && (
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap" data-testid={`negotiation-cell-${r.roundNo}-ner`}>
                    {ners[i] !== null && (
                      <span className={cn("inline-flex items-center gap-0.5 rounded px-1 py-0.5", nerMoved ? MOVED : prev ? "text-muted-foreground" : "text-foreground")}>
                        <Arrow dir={nerDir} />{fmtMoney(ners[i] as number)}
                      </span>
                    )}
                  </td>
                )}
                {anyActions && <td className="px-1 py-1"><RoundActions r={r} index={i} busy={busy} onEdit={onEdit} onDelete={onDelete} /></td>}
              </tr>,
              (r.note || logged) ? (
                <tr key={`${r.id}-note`} className={cn(activeId === r.id && "bg-accent")}>
                  <td />
                  <td colSpan={columns - 1} className="px-2 pb-2 text-xs">
                    {r.note && <span className="whitespace-pre-wrap break-words text-foreground" data-testid={`negotiation-round-note-${r.id}`}>{r.note}</span>}
                    {r.note && logged && " "}
                    {logged && <span className="text-[11px] text-muted-foreground">{logged}</span>}
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
