// Open the email or diary event a tracker row came from.
//
// Offers and interest rows are auto-detected out of staff inboxes and say
// "figures need confirming from the email" — so the email itself has to be
// one click away, with the figures readable next to the fields they go into.
// Viewings come from Outlook diaries, so they link back to the event and the
// team calendar (Woody, 2026-09-02).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getAuthHeaders, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ExternalLink, Sparkles, CalendarDays, Mail, AlertCircle } from "lucide-react";
import { NOTE_FIELD_LABELS, type LettingNoteField } from "@shared/letting-note";
import { noteValueText } from "@/components/letting-note/note-fill";

export type OfferFigures = {
  rentPa: number | null;
  termYears: number | null;
  rentFreeMonths: number | null;
  breakOption: string | null;
  premium: number | null;
  fittingOutContribution: number | null;
  incentives: string | null;
  notes: string | null;
  turnoverRentPct?: number | null;
  rentReview?: string | null;
  rentDeposit?: string | null;
};
// What the note reader found in the email: each value with the words it came
// from. A box the email gives two values for (two rents) has two lines.
type EmailValue = { field: LettingNoteField; value: string | number; quote: string };
type EmailRead = { values: EmailValue[]; left: { field: string; reason: string }[]; from: string | null; received: string | null; usedAi: boolean; cut: boolean };

type SourceMessage = {
  id: string;
  subject: string;
  from: { name?: string; address?: string } | null;
  to: string[];
  cc: string[];
  receivedDateTime: string | null;
  bodyHtml: string;
  bodyText: string;
  webLink: string | null;
  hasAttachments: boolean;
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const gbp = (n: number | null | undefined) => (n == null ? "—" : `£${Number(n).toLocaleString("en-GB")}`);

export function SourceEmailDialog({
  kind,
  rowId,
  title,
  onApplyFigures,
  onClose,
}: {
  kind: "offer" | "interest";
  rowId: string | null;
  title?: string;
  onApplyFigures?: (f: OfferFigures) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [suggested, setSuggested] = useState<EmailRead | null>(null);
  // The lines ticked to go into the offer: one at most for each box.
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [extracting, setExtracting] = useState(false);

  const { data, isLoading } = useQuery<{ mailbox?: string; messages?: SourceMessage[]; error?: string }>({
    queryKey: ["/api/tracker", kind, rowId, "email"],
    queryFn: () => fetch(`/api/tracker/${kind}/${rowId}/email`, { credentials: "include", headers: getAuthHeaders() }).then(r => r.json()),
    enabled: !!rowId,
    staleTime: 60_000,
  });

  const extract = async () => {
    if (!rowId) return;
    setExtracting(true);
    try {
      const r = await apiRequest("POST", `/api/tracker/offer/${rowId}/extract`);
      const out = await r.json();
      if (out.error) { toast({ title: "Couldn't read the figures", description: out.error, variant: "destructive" }); return; }
      const values: EmailValue[] = Array.isArray(out.values) ? out.values : [];
      setSuggested({ values, left: Array.isArray(out.left) ? out.left : [], from: out.from || null, received: out.received || null, usedAi: !!out.usedAi, cut: !!out.cut });
      // A box with one value is ticked; a box with two (two rents) is left for the person to choose.
      setPicked(new Set(values.map((v, i) => (values.filter(x => x.field === v.field).length === 1 ? i : -1)).filter(i => i >= 0)));
    } catch (e: any) {
      toast({ title: "Couldn't read the figures", description: e?.message, variant: "destructive" });
    } finally {
      setExtracting(false);
    }
  };

  const messages = data?.messages || [];

  return (
    <Dialog open={!!rowId} onOpenChange={v => { if (!v) { setSuggested(null); setPicked(new Set()); onClose(); } }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="tracker-source-email">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-4 h-4 shrink-0" />
            {title || (kind === "offer" ? "Offer email" : "Interest email")}
          </DialogTitle>
          <DialogDescription className="truncate">
            {data?.mailbox ? `From ${data.mailbox}'s mailbox` : "The email this row was detected from"}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" /> Fetching the email…
          </div>
        )}

        {!isLoading && data?.error && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm" data-testid="tracker-source-error">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>{data.error}</span>
          </div>
        )}

        {kind === "offer" && messages.length > 0 && (
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Figures in this email</p>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={extract} disabled={extracting} data-testid="tracker-source-extract">
                {extracting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
                {suggested ? "Read again" : "Read the terms"}
              </Button>
            </div>
            {!suggested && !extracting && (
              <p className="text-xs text-muted-foreground">
                Reads the terms out of the newest offer in the thread, each with the words it came from. Nothing is saved until you apply it.
              </p>
            )}
            {suggested && (
              <>
                {suggested.from && <p className="text-[11px] text-muted-foreground">Read from {suggested.from}'s message{suggested.received ? ` of ${fmtWhen(suggested.received)}` : ""}{suggested.cut ? ". The email is long: only its first part was read." : "."}</p>}
                {suggested.values.length === 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid="tracker-source-none">No terms were found in that message. Read the email below and type them in.</p>
                ) : (
                  <ul className="divide-y divide-border/60" data-testid="tracker-source-values">
                    {suggested.values.map((v, i) => {
                      const rivals = suggested.values.filter(x => x.field === v.field).length > 1;
                      return (
                        <li key={`${v.field}-${i}`} className="py-1.5 first:pt-0 last:pb-0">
                          <label className="grid cursor-pointer grid-cols-[1rem_9rem_minmax(0,1fr)] items-start gap-x-2 text-xs">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={picked.has(i)}
                              onChange={e => setPicked(prev => {
                                const next = new Set(prev);
                                // One value for a box: ticking one unticks the other.
                                suggested.values.forEach((x, k) => { if (x.field === v.field) next.delete(k); });
                                if (e.target.checked) next.add(i);
                                return next;
                              })}
                              data-testid={`tracker-source-pick-${i}`}
                            />
                            <span className="text-muted-foreground">{NOTE_FIELD_LABELS[v.field] || v.field}{rivals ? " (choose one)" : ""}</span>
                            <span className="min-w-0">
                              <span className="font-medium font-mono tabular-nums">{noteValueText(v.field, v.value)}</span>
                              {v.quote && <span className="block break-words text-[11px] text-muted-foreground">from “{v.quote}”</span>}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {suggested.left.length > 0 && (
                  <p className="text-[11px] text-muted-foreground" data-testid="tracker-source-left">
                    Left out: {suggested.left.map(d => `${(NOTE_FIELD_LABELS as Record<string, string>)[d.field] || d.field} (${d.reason})`).join("; ")}
                  </p>
                )}
                {suggested.values.length > 0 && (
                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" className="h-7 text-xs" disabled={picked.size === 0} onClick={() => {
                      const f: OfferFigures = { rentPa: null, termYears: null, rentFreeMonths: null, breakOption: null, premium: null, fittingOutContribution: null, incentives: null, notes: null };
                      suggested.values.forEach((v, i) => { if (picked.has(i)) (f as Record<string, unknown>)[v.field] = v.value; });
                      onApplyFigures?.(f);
                      toast({ title: "Terms copied into the offer", description: "Check them against the email, then Save." });
                    }} data-testid="tracker-source-apply">
                      Apply to offer
                    </Button>
                    <span className="text-[11px] text-muted-foreground">Fills the edit form with the ticked lines. You still check and save.</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {messages.map((m, idx) => (
          <div key={m.id} className="rounded-lg border overflow-hidden" data-testid={`tracker-source-message-${idx}`}>
            <div className="bg-muted/50 border-b px-3 py-2 space-y-0.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium min-w-0 break-words">{m.subject}</p>
                <div className="flex items-center gap-1 shrink-0">
                  {m.hasAttachments && <Badge variant="outline" className="text-[9px]">attachment</Badge>}
                  {m.webLink && (
                    <a href={m.webLink} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5" data-testid={`tracker-source-outlook-${idx}`}>
                      Outlook <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground break-words">
                {m.from?.name || m.from?.address || "Unknown sender"}
                {m.from?.address && m.from?.name ? ` <${m.from.address}>` : ""}
                {m.receivedDateTime ? ` · ${fmtWhen(m.receivedDateTime)}` : ""}
              </p>
              {m.to.length > 0 && <p className="text-[11px] text-muted-foreground break-words">To: {m.to.join(", ")}</p>}
            </div>
            {/* Sandboxed — the body is third-party HTML from an external
                sender, so it renders with no scripts and no same-origin. */}
            {m.bodyHtml ? (
              <iframe
                title={`email-${idx}`}
                sandbox=""
                className="w-full h-[320px] bg-white"
                srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:10px;color:#111}img{max-width:100%}table{max-width:100%}</style>${m.bodyHtml}`}
              />
            ) : (
              <pre className="p-3 text-xs whitespace-pre-wrap font-sans">{m.bodyText || "(empty message)"}</pre>
            )}
          </div>
        ))}
      </DialogContent>
    </Dialog>
  );
}

export function SourceEventDialog({ kind = "viewing", rowId, onClose }: { kind?: "viewing" | "interest"; rowId: string | null; onClose: () => void }) {
  const { data, isLoading } = useQuery<{
    mailbox?: string;
    event?: { subject: string; start: string | null; end: string | null; location: string | null; organizer: string | null; attendees: Array<{ name?: string; address?: string }>; webLink: string | null; preview: string | null };
    appCalendarUrl?: string;
    error?: string;
  }>({
    queryKey: ["/api/tracker", kind, rowId, "event"],
    queryFn: () => fetch(`/api/tracker/${kind}/${rowId}/event`, { credentials: "include", headers: getAuthHeaders() }).then(r => r.json()),
    enabled: !!rowId,
    staleTime: 60_000,
  });

  const ev = data?.event;

  return (
    <Dialog open={!!rowId} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="tracker-source-event">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 shrink-0" />
            Diary event
          </DialogTitle>
          <DialogDescription className="truncate">
            {data?.mailbox ? `From ${data.mailbox}'s Outlook diary` : "The calendar entry behind this viewing"}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" /> Fetching the event…
          </div>
        )}

        {!isLoading && data?.error && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>{data.error}</span>
          </div>
        )}

        {ev && (
          <div className="space-y-2 text-sm">
            <p className="font-medium break-words">{ev.subject}</p>
            <p className="text-xs text-muted-foreground">
              {fmtWhen(ev.start)}{ev.end ? ` — ${fmtWhen(ev.end).split(", ").pop()}` : ""}
            </p>
            {ev.location && <p className="text-xs"><span className="text-muted-foreground">Where: </span>{ev.location}</p>}
            {ev.organizer && <p className="text-xs"><span className="text-muted-foreground">Organiser: </span>{ev.organizer}</p>}
            {ev.attendees.length > 0 && (
              <p className="text-xs break-words">
                <span className="text-muted-foreground">Attendees: </span>
                {ev.attendees.map(a => a.name || a.address).join(", ")}
              </p>
            )}
            {ev.preview && <p className="text-xs text-muted-foreground whitespace-pre-wrap border-t pt-2">{ev.preview}</p>}
          </div>
        )}

        <div className="flex items-center gap-2 border-t pt-3">
          {ev?.webLink && (
            <Button asChild size="sm" variant="outline" className="h-7 text-xs">
              <a href={ev.webLink} target="_blank" rel="noreferrer" data-testid="tracker-event-outlook">
                Open in Outlook <ExternalLink className="w-3 h-3 ml-1" />
              </a>
            </Button>
          )}
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <a href={data?.appCalendarUrl || "/calendar"} data-testid="tracker-event-calendar">
              <CalendarDays className="w-3 h-3 mr-1" /> Team calendar
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
