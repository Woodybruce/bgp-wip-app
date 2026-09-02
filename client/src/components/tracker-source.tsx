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

export type OfferFigures = {
  rentPa: number | null;
  termYears: number | null;
  rentFreeMonths: number | null;
  breakOption: string | null;
  premium: number | null;
  fittingOutContribution: number | null;
  incentives: string | null;
  notes: string | null;
};

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
  const [suggested, setSuggested] = useState<OfferFigures | null>(null);
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
      setSuggested(out.suggested || null);
    } catch (e: any) {
      toast({ title: "Couldn't read the figures", description: e?.message, variant: "destructive" });
    } finally {
      setExtracting(false);
    }
  };

  const messages = data?.messages || [];

  return (
    <Dialog open={!!rowId} onOpenChange={v => { if (!v) { setSuggested(null); onClose(); } }}>
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
                {suggested ? "Read again" : "Read figures with AI"}
              </Button>
            </div>
            {!suggested && !extracting && (
              <p className="text-xs text-muted-foreground">
                AI reads the thread and suggests the terms — nothing is saved until you apply it.
              </p>
            )}
            {suggested && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                  <div><span className="text-muted-foreground">Rent: </span>{gbp(suggested.rentPa)}{suggested.rentPa != null ? " p.a." : ""}</div>
                  <div><span className="text-muted-foreground">Term: </span>{suggested.termYears != null ? `${suggested.termYears} years` : "—"}</div>
                  <div><span className="text-muted-foreground">Rent free: </span>{suggested.rentFreeMonths != null ? `${suggested.rentFreeMonths} months` : "—"}</div>
                  <div><span className="text-muted-foreground">Break: </span>{suggested.breakOption || "—"}</div>
                  <div><span className="text-muted-foreground">Premium: </span>{gbp(suggested.premium)}</div>
                  <div><span className="text-muted-foreground">Fit-out: </span>{gbp(suggested.fittingOutContribution)}</div>
                </div>
                {suggested.incentives && <p className="text-xs"><span className="text-muted-foreground">Incentives: </span>{suggested.incentives}</p>}
                {suggested.notes && <p className="text-xs text-muted-foreground">{suggested.notes}</p>}
                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" className="h-7 text-xs" onClick={() => { onApplyFigures?.(suggested); toast({ title: "Figures copied into the offer", description: "Check them against the email, then Save." }); }} data-testid="tracker-source-apply">
                    Apply to offer
                  </Button>
                  <span className="text-[11px] text-muted-foreground">Fills the edit form — you still confirm and save.</span>
                </div>
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

export function SourceEventDialog({ viewingId, onClose }: { viewingId: string | null; onClose: () => void }) {
  const { data, isLoading } = useQuery<{
    mailbox?: string;
    event?: { subject: string; start: string | null; end: string | null; location: string | null; organizer: string | null; attendees: Array<{ name?: string; address?: string }>; webLink: string | null; preview: string | null };
    appCalendarUrl?: string;
    error?: string;
  }>({
    queryKey: ["/api/tracker/viewing", viewingId, "event"],
    queryFn: () => fetch(`/api/tracker/viewing/${viewingId}/event`, { credentials: "include", headers: getAuthHeaders() }).then(r => r.json()),
    enabled: !!viewingId,
    staleTime: 60_000,
  });

  const ev = data?.event;

  return (
    <Dialog open={!!viewingId} onOpenChange={v => { if (!v) onClose(); }}>
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
