/**
 * AIActivityCard
 * ==============
 *
 * Drop-in card that asks the server to curate AI-filtered emails +
 * calendar meetings about a given subject (deal / brand / landlord /
 * contact / property), and renders the resulting markdown with inline
 * [E#] / [M#] citations as clickable deep-links.
 *
 * Backed by /api/activity/:subjectType/:subjectId — see
 * server/ai-activity-curator.ts and server/activity-routes.ts.
 *
 * On first render: fetches the cached row (fast). User can click
 * "Re-analyse" to force a fresh ChatBGP curation (~30s, 50k+ tokens).
 *
 * Used on:
 *   - Deal detail page
 *   - Brand profile panel
 *   - Contact pages
 *   - Hunter row drill-downs
 */
import { useEffect, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sparkles, RefreshCw, Mail, CalendarDays, AlertCircle, Loader2, ExternalLink, Copy, Download, Paperclip } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/queryClient";

export type ActivitySubjectType = "deal" | "brand" | "landlord" | "contact" | "property";

interface EmailRef {
  msgId: string;
  mailboxEmail?: string;
  subject?: string;
  from?: string;
  date?: string;
}

interface MeetingRef {
  eventId: string;
  mailboxEmail?: string;
  subject?: string;
  organiser?: string;
  start?: string;
}

interface CuratedActivity {
  fromCache: boolean;
  markdown: string;
  emailHits: EmailRef[];
  meetingHits: MeetingRef[];
  generatedAt: string | null;
  latestActivityDate: string | null;
}

interface Props {
  subjectType: ActivitySubjectType;
  subjectId: string;
  title?: string;
  /** Compact density for inline use in lists. Default false (full card). */
  compact?: boolean;
  /** Auto-curate on first mount if no cache exists. Default false — user must click "Analyse". */
  autoCurate?: boolean;
}

export function AIActivityCard({ subjectType, subjectId, title, compact, autoCurate }: Props) {
  const [data, setData] = useState<CuratedActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [curating, setCurating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openEmail, setOpenEmail] = useState<{ msgId: string; mailboxEmail: string } | null>(null);
  const { toast } = useToast();

  // Initial cached read
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/activity/${subjectType}/${encodeURIComponent(subjectId)}`, {
          headers: getAuthHeaders(),
          credentials: "include",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (!cancelled) setData(d);
        // Auto-curate if asked and there's nothing cached.
        if (!cancelled && autoCurate && !d?.markdown) {
          curate();
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load activity");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectType, subjectId]);

  const curate = async () => {
    setCurating(true);
    setError(null);
    try {
      const r = await fetch(`/api/activity/${subjectType}/${encodeURIComponent(subjectId)}/curate`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text() || `HTTP ${r.status}`);
      const d = await r.json();
      setData(d);
      toast({ title: "Activity refreshed", description: `${d.emailHits?.length || 0} emails, ${d.meetingHits?.length || 0} meetings cited.` });
    } catch (err: any) {
      setError(err?.message || "Curation failed");
      toast({ title: "Re-analyse failed", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setCurating(false);
    }
  };

  const lastTouchPill = data?.latestActivityDate ? <LastTouchBadge iso={data.latestActivityDate} /> : null;
  const hasContent = !!data?.markdown?.trim();

  return (
    <>
      <Card data-testid={`ai-activity-${subjectType}-${subjectId}`}>
        <CardHeader className={compact ? "pb-1.5 pt-2 px-3" : "pb-2"}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className={`flex items-center gap-2 ${compact ? "text-sm" : "text-base"}`}>
              <Sparkles className="w-4 h-4 text-purple-500" />
              {title || "Activity"}
              {lastTouchPill}
              {data?.generatedAt && (
                <span className="text-[10px] text-muted-foreground font-normal">
                  — analysed {new Date(data.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </span>
              )}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] gap-1"
              disabled={curating}
              onClick={curate}
            >
              {curating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {curating ? "Analysing…" : (hasContent ? "Re-analyse" : "Analyse")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className={compact ? "pb-2 px-3" : "pb-2"}>
          {loading && <p className="text-[11px] text-muted-foreground italic"><Loader2 className="w-3 h-3 inline animate-spin mr-1" />Loading…</p>}

          {!loading && error && (
            <p className="text-[11px] text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>
          )}

          {!loading && !error && !hasContent && !curating && (
            <p className="text-[11px] text-muted-foreground italic">
              No AI commentary yet — click <strong>Analyse</strong> to ask ChatBGP what's in the inboxes for this {subjectType}.
            </p>
          )}

          {!loading && !error && curating && !hasContent && (
            <p className="text-[11px] text-muted-foreground italic"><Loader2 className="w-3 h-3 inline animate-spin mr-1" />Searching mailboxes and calendars… this can take 30-60 seconds.</p>
          )}

          {hasContent && data && (
            <div className="max-h-[480px] overflow-y-auto pr-1">
              <ActivityMarkdown
                markdown={data.markdown}
                emailHits={data.emailHits}
                meetingHits={data.meetingHits}
                onOpenEmail={(h) => setOpenEmail({ msgId: h.msgId, mailboxEmail: h.mailboxEmail || "" })}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {openEmail && (
        <EmailViewerDialog
          msgId={openEmail.msgId}
          mailboxEmail={openEmail.mailboxEmail}
          onClose={() => setOpenEmail(null)}
        />
      )}
    </>
  );
}

function LastTouchBadge({ iso }: { iso: string }) {
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  const days = Math.round((Date.now() - t) / (1000 * 60 * 60 * 24));
  const cls = days <= 7 ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : days <= 30 ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-red-50 text-red-700 border-red-200";
  const label = days === 0 ? "today" : days === 1 ? "yesterday" : days < 30 ? `${days}d ago` : days < 365 ? `${Math.round(days / 7)}w ago` : `${Math.round(days / 365)}y ago`;
  return <Badge className={`${cls} text-[10px] font-medium`}>Last touch {label}</Badge>;
}

/**
 * Renders the AI-curated markdown with inline [E#] and [M#] tokens turned
 * into clickable buttons. Inline parser (no react-markdown dep) — handles
 * h1/h2/h3, bold, code, lists, blockquotes.
 */
function ActivityMarkdown({
  markdown,
  emailHits,
  meetingHits,
  onOpenEmail,
}: {
  markdown: string;
  emailHits: EmailRef[];
  meetingHits: MeetingRef[];
  onOpenEmail: (h: { msgId: string; mailboxEmail: string | undefined }) => void;
}) {
  let keyCounter = 0;
  const parseInline = (text: string): ReactNode[] => {
    const out: ReactNode[] = [];
    const re = /(\[E(\d+)\])|(\[M(\d+)\])|(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > cursor) out.push(<span key={`s-${keyCounter++}`}>{text.slice(cursor, m.index)}</span>);
      if (m[1]) {
        const idx = parseInt(m[2], 10);
        const h = emailHits[idx - 1];
        const title = h ? `${h.subject || ""} — ${h.from || ""}` : `Email #${idx}`;
        const disabled = !h?.mailboxEmail || !h?.msgId;
        out.push(
          <button
            key={`e-${keyCounter++}`}
            type="button"
            disabled={disabled}
            onClick={() => h && onOpenEmail({ msgId: h.msgId, mailboxEmail: h.mailboxEmail })}
            title={title}
            className={`inline-flex items-center text-[10px] font-mono px-1 py-0 mx-0.5 rounded border ${disabled
              ? "bg-muted/40 text-muted-foreground border-muted cursor-not-allowed"
              : "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20 cursor-pointer"
            }`}
          >
            <Mail className="w-2.5 h-2.5 mr-0.5" />E{idx}
          </button>
        );
      } else if (m[3]) {
        const idx = parseInt(m[4], 10);
        const h = meetingHits[idx - 1];
        const title = h ? `${h.subject || ""} — ${h.organiser || ""}` : `Meeting #${idx}`;
        out.push(
          <span
            key={`m-${keyCounter++}`}
            title={title}
            className="inline-flex items-center text-[10px] font-mono px-1 py-0 mx-0.5 rounded border bg-violet-100/60 text-violet-700 border-violet-300 dark:bg-violet-900/30 dark:text-violet-300"
          >
            <CalendarDays className="w-2.5 h-2.5 mr-0.5" />M{idx}
          </span>
        );
      } else if (m[5]) {
        out.push(<strong key={`b-${keyCounter++}`}>{m[6]}</strong>);
      } else if (m[7]) {
        out.push(<code key={`c-${keyCounter++}`} className="text-[10px] bg-muted px-1 py-px rounded">{m[8]}</code>);
      }
      cursor = m.index + m[0].length;
    }
    if (cursor < text.length) out.push(<span key={`s-${keyCounter++}`}>{text.slice(cursor)}</span>);
    return out;
  };

  const lines = markdown.split("\n");
  const blocks: ReactNode[] = [];
  let listBuffer: ReactNode[] = [];
  const flushList = () => {
    if (listBuffer.length) {
      blocks.push(<ul key={`ul-${blocks.length}`} className="list-disc ml-5 my-1 space-y-0.5">{listBuffer}</ul>);
      listBuffer = [];
    }
  };
  lines.forEach((line, i) => {
    if (/^### /.test(line)) { flushList(); blocks.push(<h3 key={i} className="text-[12px] font-semibold mt-2 mb-0.5">{parseInline(line.slice(4))}</h3>); }
    else if (/^## /.test(line)) { flushList(); blocks.push(<h2 key={i} className="text-[13px] font-semibold mt-3 mb-1">{parseInline(line.slice(3))}</h2>); }
    else if (/^# /.test(line)) { flushList(); blocks.push(<h1 key={i} className="text-sm font-semibold mt-3 mb-1">{parseInline(line.slice(2))}</h1>); }
    else if (/^> /.test(line)) { flushList(); blocks.push(<blockquote key={i} className="border-l-2 border-primary/40 pl-2 py-0.5 my-1 text-muted-foreground italic">{parseInline(line.slice(2))}</blockquote>); }
    else if (/^[-*] /.test(line)) { listBuffer.push(<li key={i}>{parseInline(line.slice(2))}</li>); }
    else if (line.trim() === "") { flushList(); }
    else { flushList(); blocks.push(<p key={i} className="my-1 leading-relaxed">{parseInline(line)}</p>); }
  });
  flushList();
  return <div className="text-[11px]">{blocks}</div>;
}

interface EmailDetail {
  id: string;
  subject: string;
  from: { name?: string; email?: string };
  to: Array<{ name?: string; email?: string }>;
  cc: Array<{ name?: string; email?: string }>;
  date: string;
  bodyContentType: "text" | "html";
  bodyHtml: string;
  bodyText: string;
  hasAttachments: boolean;
  webLink: string | null;
  attachments: Array<{ id: string; name: string; size: number; contentType: string }>;
}

function EmailViewerDialog({ msgId, mailboxEmail, onClose }: { msgId: string; mailboxEmail: string; onClose: () => void }) {
  const [email, setEmail] = useState<EmailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/pathway/email/${encodeURIComponent(mailboxEmail)}/${encodeURIComponent(msgId)}`,
          { headers: getAuthHeaders(), credentials: "include" }
        );
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (!cancelled) setEmail(data);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load email");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [msgId, mailboxEmail]);

  const stripHtml = (html: string) => { if (!html) return ""; const tmp = document.createElement("div"); tmp.innerHTML = html; return tmp.textContent || tmp.innerText || ""; };
  const formatBytes = (bytes: number) => { if (!bytes) return "—"; if (bytes < 1024) return `${bytes}B`; if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`; return `${(bytes / 1024 / 1024).toFixed(1)}MB`; };

  const copyBody = () => { if (!email) return; navigator.clipboard.writeText(email.bodyText || stripHtml(email.bodyHtml)); toast({ title: "Email body copied" }); };
  const downloadAttachment = async (a: { id: string; name: string }) => {
    try {
      const res = await fetch(`/api/pathway/email/${encodeURIComponent(mailboxEmail)}/${encodeURIComponent(msgId)}/attachment/${encodeURIComponent(a.id)}`, { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = a.name; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Download failed", description: err?.message || "Unknown error", variant: "destructive" });
    }
  };

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base pr-8">{loading ? "Loading email…" : email?.subject || "Email"}</DialogTitle>
        </DialogHeader>
        {loading && <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
        {error && <div className="py-8 text-center"><AlertCircle className="w-8 h-8 mx-auto text-destructive mb-2" /><p className="text-sm text-muted-foreground">{error}</p></div>}
        {email && !loading && (
          <>
            <div className="border-b pb-2 mb-2 text-xs space-y-0.5">
              <div><span className="text-muted-foreground">From:</span> <span className="font-medium">{email.from.name || email.from.email}</span> {email.from.email && email.from.name && <span className="text-muted-foreground">&lt;{email.from.email}&gt;</span>}</div>
              <div><span className="text-muted-foreground">To:</span> {email.to.map((r) => r.name || r.email).join(", ")}</div>
              {email.cc.length > 0 && <div><span className="text-muted-foreground">Cc:</span> {email.cc.map((r) => r.name || r.email).join(", ")}</div>}
              <div><span className="text-muted-foreground">Date:</span> {new Date(email.date).toLocaleString("en-GB")}</div>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <Button variant="outline" size="sm" onClick={copyBody} className="h-7 text-xs gap-1"><Copy className="w-3 h-3" />Copy body</Button>
              {email.webLink && (<a href={email.webLink} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm" className="h-7 text-xs gap-1">Open in Outlook <ExternalLink className="w-3 h-3" /></Button></a>)}
            </div>
            {email.attachments.length > 0 && (
              <div className="border rounded p-2 mb-2 bg-muted/20">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1"><Paperclip className="w-3 h-3" />{email.attachments.length} attachment{email.attachments.length !== 1 ? "s" : ""}</p>
                <div className="space-y-1">{email.attachments.map((a) => (<button key={a.id} onClick={() => downloadAttachment(a)} className="flex items-center gap-2 w-full text-left text-xs hover:bg-muted/50 p-1 rounded group"><Download className="w-3 h-3 text-muted-foreground group-hover:text-primary shrink-0" /><span className="truncate flex-1">{a.name}</span><span className="text-muted-foreground text-[10px] shrink-0">{formatBytes(a.size)}</span></button>))}</div>
              </div>
            )}
            <div className="flex-1 overflow-y-auto border rounded p-3 bg-background text-xs">
              {email.bodyContentType === "html" && email.bodyHtml
                ? <div className="prose prose-xs max-w-none" dangerouslySetInnerHTML={{ __html: email.bodyHtml }} />
                : <pre className="whitespace-pre-wrap font-sans">{email.bodyText || stripHtml(email.bodyHtml)}</pre>}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
