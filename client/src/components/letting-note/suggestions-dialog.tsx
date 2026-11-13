// "Not yet logged" (Woody, 2026-11-13: "yes to table"): the comments that
// read as an offer or a viewing and have none logged for them. His example is
// a comment on a target, "Offered: 15 year lease. Rent £120kpax and 9% t/o.
// 6 MRF", that never became an offer.
//
// A pill with the number waiting, and a list grouped by unit. Each row shows
// the words, who said them and when, where they came from, and what they look
// like in plain words. "Log as offer" or "Log as viewing" hands the row to the
// page, which opens that unit's normal Add form filled in; the person checks
// it and saves, and only then is the suggestion marked as logged. "Dismiss"
// takes it off the list. Nothing here writes an offer or a viewing.
//
// The server decides what a login is shown (server/letting-suggestions.ts):
// this file asks only for the list and the count, and reads nothing from the
// CRM, so it is safe on a joint agent's tracker.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, PillCount } from "@/components/ui/pill";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { LettingNoteReading, NoteSource } from "@shared/letting-note";
import type { LettingSuggestion, LettingSuggestionList, SuggestionKind } from "@shared/letting-suggestions";

export const SUGGESTIONS_KEY = ["/api/letting-suggestions"];
export const SUGGESTIONS_COUNT_KEY = ["/api/letting-suggestions/count"];
const REASON_MAX = 500;

export function refreshSuggestions() {
  queryClient.invalidateQueries({ queryKey: SUGGESTIONS_KEY });
  queryClient.invalidateQueries({ queryKey: SUGGESTIONS_COUNT_KEY });
}

// "2026-11-09" as "9 Nov" (the year only when it is not this one).
function shortDay(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.getUTCFullYear() !== new Date().getUTCFullYear() ? { year: "numeric" as const } : {}) }).replace(/\bSept\b/, "Sep");
}
const serverMessage = (e: unknown, fallback: string): string => {
  const said = e instanceof Error ? e.message.replace(/^\d{3}:\s*/, "").trim() : "";
  return said && said.length <= 240 && !/[<{]/.test(said) ? said : fallback;
};

// ── Opening a form from a suggestion ───────────────────────────────────────

// What a page needs to open its own Add offer or Add viewing form from a
// suggestion. A target's comment is read by the server (`source`); the other
// three hand the form their own words (`text`).
export interface SuggestionSeed {
  key: string;                 // new each time, so the form's note box starts afresh
  suggestionId: string;
  kind: SuggestionKind;
  unitId: string;
  text: string;
  source?: NoteSource;
  brandName: string | null;
  companyId: string | null;
  day: string | null;          // the day the words were said or point at; null leaves the form's own date
}
export function suggestionSeed(s: LettingSuggestion): SuggestionSeed {
  const fromViewing = s.source.type === "viewing";
  return {
    key: `${s.id}:${Date.now()}`, suggestionId: s.id, kind: s.kind, unitId: s.unitId,
    text: s.source.type === "target_comment" ? "" : s.excerpt,
    source: s.source.type === "target_comment" ? { type: "target_comment", targetId: s.source.targetId, at: s.source.at } : undefined,
    brandName: s.brandName, companyId: s.companyId,
    // A viewing that says an offer is expected does not date the offer.
    day: fromViewing ? s.details?.date || null : s.evidenceDate,
  };
}

/**
 * The day to keep on the form after the note box has read a suggestion's own
 * words. The list read them from the day they were written; the note box
 * reads them from today, so "yesterday" in a week-old note would move.
 * Null when the reading is of some other note the person pasted.
 */
export function seededDay(seed: { text?: string; day?: string | null } | null | undefined, reading: LettingNoteReading | null | undefined): string | null {
  if (!seed?.day || !seed.text || !reading?.text) return null;
  return reading.text.trim() === seed.text.trim() ? seed.day : null;
}

/**
 * Marks a suggestion as logged. Called only after the form's own save has
 * succeeded, with the record that save made. `saved` is that save's reply (a
 * Response or the row). A failure here never undoes the save.
 */
export async function suggestionLogged(suggestionId: string | null | undefined, kind: SuggestionKind, saved: unknown): Promise<boolean> {
  if (!suggestionId) return false;
  try {
    let row: any = saved;
    if (saved && typeof (saved as Response).clone === "function" && typeof (saved as Response).json === "function") {
      row = await (saved as Response).clone().json().catch(() => null);
    }
    const recordId = typeof row === "string" ? row : row?.id;
    if (!recordId) return false;
    await apiRequest("POST", `/api/letting-suggestions/${encodeURIComponent(suggestionId)}/confirm`, { recordKind: kind, recordId: String(recordId) });
    return true;
  } catch {
    return false;
  } finally {
    refreshSuggestions();
  }
}

// ── The pill ───────────────────────────────────────────────────────────────

/** "Not yet logged N" for the top of a tracker. Nothing at nought, and nothing for a login the list is not for. */
export function SuggestionsPill({ onOpen, enabled = true, className }: { onOpen: () => void; enabled?: boolean; className?: string }) {
  const { data } = useQuery<{ count: number }>({ queryKey: SUGGESTIONS_COUNT_KEY, enabled, staleTime: 15_000, refetchInterval: 60_000, refetchOnMount: "always", retry: false });
  const count = Number(data?.count) || 0;
  if (!enabled || count <= 0) return null;
  return (
    <Pill onClick={onOpen} className={className} title="Comments that read as an offer or a viewing and have none logged" data-testid="pill-not-yet-logged">
      Not yet logged <PillCount n={count} />
    </Pill>
  );
}

// ── The list ───────────────────────────────────────────────────────────────

const logLabel = (kind: SuggestionKind) => (kind === "offer" ? "Log as offer" : "Log as viewing");
const SOURCE_CHIP = "inline-flex items-center rounded-full border border-border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide leading-none whitespace-nowrap text-muted-foreground";

function Words({ s }: { s: LettingSuggestion }) {
  const words = s.excerpt.trim();
  return (
    <div className="min-w-0 space-y-1">
      {words
        ? <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm" title={words} data-testid={`suggestion-excerpt-${s.id}`}>“{words}”</p>
        : <p className="text-sm text-muted-foreground" data-testid={`suggestion-excerpt-${s.id}`}>No note was written.</p>}
      <p className="break-words text-xs text-muted-foreground" data-testid={`suggestion-summary-${s.id}`}>{s.summary}</p>
    </div>
  );
}

function Said({ s }: { s: LettingSuggestion }) {
  const when = shortDay(s.evidenceDate);
  return <>{[s.saidBy, when].filter(Boolean).join(" · ") || "Not recorded"}</>;
}

export function SuggestionsDialog({ open, onClose, onLog }: {
  open: boolean;
  onClose: () => void;
  /** Open the unit's own Add offer or Add viewing form from this row. The page closes this list when it does. */
  onLog: (s: LettingSuggestion) => void;
}) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { data, isLoading, error, refetch } = useQuery<LettingSuggestionList>({ queryKey: SUGGESTIONS_KEY, enabled: open, staleTime: 5_000, refetchOnMount: "always", retry: false });
  const rows = Array.isArray(data?.suggestions) ? data!.suggestions : [];
  const groups = useMemo(() => {
    const byUnit = new Map<string, { unitId: string; unitName: string; propertyName: string | null; rows: LettingSuggestion[] }>();
    for (const s of rows) {
      if (!byUnit.has(s.unitId)) byUnit.set(s.unitId, { unitId: s.unitId, unitName: s.unitName, propertyName: s.propertyName, rows: [] });
      byUnit.get(s.unitId)!.rows.push(s);
    }
    return [...byUnit.values()];
  }, [rows]);

  const [dismissing, setDismissing] = useState<string | null>(null);   // the row whose reason box is open
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const startDismiss = (id: string) => { setDismissing(id); setReason(""); };
  const dismiss = async (s: LettingSuggestion) => {
    if (busy) return;
    setBusy(s.id);
    try {
      await apiRequest("POST", `/api/letting-suggestions/${encodeURIComponent(s.id)}/dismiss`, { reason: reason.trim().slice(0, REASON_MAX) || undefined });
      setDismissing(null); setReason("");
      toast({ title: "Dismissed", description: "It will not be suggested again." });
    } catch (e) {
      toast({ title: "It could not be dismissed", description: serverMessage(e, "Try again in a moment."), variant: "destructive" });
    } finally {
      setBusy(null);
      refreshSuggestions();
    }
  };

  const actions = (s: LettingSuggestion, stacked: boolean) => (
    dismissing === s.id ? (
      <div className={cn("flex min-w-0 gap-1.5", stacked ? "flex-col" : "flex-col items-stretch")} data-testid={`suggestion-dismiss-box-${s.id}`}>
        <Input value={reason} onChange={e => setReason(e.target.value)} maxLength={REASON_MAX} placeholder="Why (optional)" aria-label="Why it is dismissed (optional)"
          className="h-9 text-sm" disabled={busy === s.id} autoFocus onKeyDown={e => { if (e.key === "Enter") void dismiss(s); }} data-testid={`suggestion-dismiss-reason-${s.id}`} />
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={busy === s.id} onClick={() => setDismissing(null)}>Cancel</Button>
          <Button variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={busy === s.id} onClick={() => dismiss(s)} data-testid={`suggestion-dismiss-confirm-${s.id}`}>
            {busy === s.id && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Dismiss
          </Button>
        </div>
      </div>
    ) : (
      <div className={cn("flex gap-1.5", stacked ? "flex-wrap" : "flex-col items-stretch")}>
        <Button variant="outline" size="sm" className={cn("h-8 px-2.5 text-xs whitespace-nowrap", stacked && "flex-1")} disabled={!!busy} onClick={() => onLog(s)} data-testid={`suggestion-log-${s.id}`}>{logLabel(s.kind)}</Button>
        <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs text-muted-foreground" disabled={!!busy} onClick={() => startDismiss(s.id)} data-testid={`suggestion-dismiss-${s.id}`}>Dismiss</Button>
      </div>
    )
  );

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !busy) onClose(); }}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-4xl flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[90vh] sm:w-full sm:rounded-lg" data-testid="suggestions-dialog">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-4 py-3 pr-12 text-left sm:px-6 sm:py-4">
          <DialogTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5 shrink-0" /> Not yet logged</DialogTitle>
          <DialogDescription>
            Comments that read as an offer or a viewing, with none logged for that unit and brand. Logging one opens the unit's form filled in for you to check and save.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6" data-testid="suggestions-list">
          {isLoading && <div className="space-y-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-20 rounded-lg" /><Skeleton className="h-20 rounded-lg" /></div>}
          {!isLoading && error && (
            <div className="py-8 text-center" data-testid="suggestions-error">
              <p className="text-sm text-muted-foreground">The list could not be loaded.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Try again</Button>
            </div>
          )}
          {!isLoading && !error && rows.length === 0 && (
            <div className="py-10 text-center" data-testid="suggestions-empty">
              <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">Nothing waiting. Every comment that reads as an offer or a viewing is logged or dismissed.</p>
            </div>
          )}

          {groups.map(g => (
            <section key={g.unitId} className="min-w-0" data-testid={`suggestions-unit-${g.unitId}`}>
              <h3 className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
                <span className="break-words">{g.unitName}</span>
                {g.propertyName && <span className="text-xs font-normal text-muted-foreground">{g.propertyName}</span>}
                <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">{g.rows.length}</span>
              </h3>

              {isMobile ? (
                <ul className="space-y-2">
                  {g.rows.map(s => (
                    <li key={s.id} className="space-y-2 rounded-2xl border border-border bg-card p-3 shadow-sm" data-testid={`suggestion-card-${s.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 break-words text-sm font-medium">{s.brandName || "No brand named"}</p>
                        <span className={SOURCE_CHIP}>{s.sourceLabel}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground"><Said s={s} /></p>
                      <Words s={s} />
                      {actions(s, true)}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-lg border border-border">
                  <table className="w-full table-fixed text-sm">
                    <colgroup><col className="w-[22%]" /><col /><col className="w-[9.5rem]" /></colgroup>
                    <thead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="bg-muted px-3 py-2 text-left first:rounded-tl-lg">Brand</th>
                        <th className="bg-muted px-3 py-2 text-left">What was said</th>
                        <th className="bg-muted px-3 py-2 text-left last:rounded-tr-lg"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map(s => (
                        <tr key={s.id} className="border-t border-border align-top" data-testid={`suggestion-row-${s.id}`}>
                          <td className="space-y-1 px-3 py-2.5">
                            <p className="break-words font-medium">{s.brandName || "No brand named"}</p>
                            <span className={SOURCE_CHIP}>{s.sourceLabel}</span>
                            <p className="break-words text-[11px] text-muted-foreground"><Said s={s} /></p>
                          </td>
                          <td className="px-3 py-2.5"><Words s={s} /></td>
                          <td className="px-3 py-2.5">{actions(s, false)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
