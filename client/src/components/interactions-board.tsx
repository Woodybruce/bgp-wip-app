// Shared interactions board — used on brand/company profile AND contact
// page. Same UI everywhere; the only difference is the filter scope.
//
//   <InteractionsBoard scope="company" contextId={companyId} />
//   <InteractionsBoard scope="contact" contextId={contactId} />
//
// Pulls from /api/interactions/{scope}/{id} which now also returns:
//   - topBgpContacts: who at BGP is most active with this entity (last 90d
//     count, all-time on hover)
//   - nextInteraction: soonest upcoming meeting, or null
//
// Auto-fires the meeting sync when no meetings exist for this scope (one-off
// per page open) — covers the "Meetings (0)" case where the email sync ran
// but the calendar sync never did.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mail, Users, Calendar, Clock, ExternalLink, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { EmailViewerDialog, MeetingViewerDialog } from "@/components/ai-activity-card";
import { gbDate } from "@/lib/format";

interface InteractionRow {
  id: string;
  type: string;            // email | call | note | meeting
  direction: string | null;
  subject: string | null;
  preview: string | null;
  interactionDate: string;
  bgpUser: string | null;  // sometimes the column key, sometimes "bgp_user"
  bgp_user?: string | null;
  interaction_date?: string;
  microsoftId: string | null;
  microsoft_id?: string | null;
  contactId?: string | null;
  contact_id?: string | null;
}

interface TopBgpContact {
  email: string;
  name: string;
  count90d: number;
  countAll: number;
}

interface NextInteraction {
  id: string;
  subject: string | null;
  interactionDate: string;
  bgpUser: string | null;
  microsoftId: string | null;
}

interface BoardResponse {
  interactions: InteractionRow[];
  topBgpContacts?: TopBgpContact[];
  nextInteraction?: NextInteraction | null;
  total?: number;
}

interface Props {
  scope: "contact" | "company";
  contextId: string;
}

// Normalises both snake_case and camelCase keys — the brand-profile endpoint
// returns snake_case, the standalone interactions endpoint returns camelCase.
const norm = (r: any): InteractionRow => ({
  id: r.id,
  type: r.type,
  direction: r.direction,
  subject: r.subject,
  preview: r.preview,
  interactionDate: r.interactionDate || r.interaction_date,
  bgpUser: r.bgpUser || r.bgp_user,
  microsoftId: r.microsoftId || r.microsoft_id,
  contactId: r.contactId || r.contact_id,
});

// Calendar days in Europe/London — the same maths as the Activity card's
// "Next in …" badge, which read 9d against this list's 10d (Woody, 2026-09-27).
const londonDay = (t: number) => {
  const [y, m, dd] = new Date(t).toLocaleDateString("en-CA", { timeZone: "Europe/London" }).split("-").map(Number);
  return Date.UTC(y, m - 1, dd) / 864e5;
};

function relDate(d: string | null | undefined): string {
  if (!d) return "";
  const days = Math.ceil(londonDay(Date.now()) - londonDay(new Date(d).getTime()));
  // Upcoming meetings used to render as "-52d ago" (Woody, 2026-09-27).
  if (days < 0) {
    const ahead = -days;
    if (ahead <= 1) return "tomorrow";
    if (ahead < 30) return `in ${ahead}d`;
    return gbDate(d, { day: "numeric", month: "short", year: "numeric" });
  }
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return gbDate(d, { day: "numeric", month: "short", year: "numeric" });
}

function bgpUserDisplay(raw: string | null | undefined, userMap: Map<string, string>): string {
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (userMap.has(lower)) return userMap.get(lower)!;
  const local = lower.includes("@") ? lower.split("@")[0] : lower;
  return local.replace(/\b\w/g, c => c.toUpperCase());
}

// Teams/Outlook invite boilerplate (the underscore rule and everything after
// it, join links, meeting IDs, passcodes) isn't the message — show only what
// the sender wrote (Woody, 2026-09-27).
function cleanPreview(p: string | null | undefined): string {
  if (!p) return "";
  return p.split(/_{3,}/)[0]
    .replace(/Microsoft Teams( meeting| Need help\?)?/gi, " ")
    .replace(/Join (the|this) meeting( now)?|Join on your computer[^.]*|Click here to join the meeting/gi, " ")
    .replace(/Meeting ID:\s*[\d ]+/gi, " ")
    .replace(/Passcode:\s*\S+/gi, " ")
    // Room-booking asides ("@Catering – refs x 16 please") are for
    // facilities, not the reader.
    .replace(/@\s*(?:catering|reception|facilities|front desk)\b[^.\n]*?(?:\b(?:please|pls|thanks|thank you)\b[.!]?|$)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function InteractionsBoard({ scope, contextId }: Props) {
  const [typeFilter, setTypeFilter] = useState<"all" | "email" | "meeting">("all");
  const [openEmail, setOpenEmail] = useState<{ msgId: string; mailboxEmail: string } | null>(null);
  const [openMeeting, setOpenMeeting] = useState<{ eventId: string; mailboxEmail: string } | null>(null);
  const autoSyncedRef = useRef(false);

  const { data: allUsers } = useQuery<Array<{ id: string; name: string; username: string; email: string | null }>>({
    queryKey: ["/api/users"],
    staleTime: 10 * 60 * 1000,
  });
  // Meeting sync is a staff-only M365 op — client viewers read the board but
  // must not fire the sync (403 noise on every brand profile otherwise).
  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isClientViewer = !currentUser || currentUser.role === "Client" || !!currentUser.companyScopeId;
  const emailToName = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of allUsers || []) {
      const display = u.name || u.username || u.email || "";
      if (u.email) m.set(u.email.toLowerCase(), display);
      if (u.username) m.set(u.username.toLowerCase(), display);
    }
    return m;
  }, [allUsers]);

  const { data, isLoading, refetch } = useQuery<BoardResponse>({
    queryKey: ["/api/interactions", scope, contextId],
    queryFn: async () => {
      // The endpoint defaults to the newest 50 rows, and upcoming meeting
      // occurrences (one row per attendee calendar) sort first — on Aaron
      // Addo they filled all 50, so the board said "Emails (0)" beside
      // "Lucy Cope · 83" (Woody, 2026-09-27). Ask for enough to reach them.
      const r = await fetch(`/api/interactions/${scope}/${encodeURIComponent(contextId)}?limit=500`, { credentials: "include" });
      if (!r.ok) return { interactions: [] };
      return r.json();
    },
    staleTime: 60_000,
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      // The sync now runs in the background (POST returns 202 immediately —
      // it used to 504 after 3 minutes). Kick it, then poll /sync-status
      // until it finishes so the board refreshes when the data lands.
      await apiRequest("POST", "/api/interactions/sync?daysBack=90&daysForward=60");
      const deadline = Date.now() + 5 * 60_000; // give it up to 5 min
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const sr = await fetch("/api/interactions/sync-status", { credentials: "include" });
        if (!sr.ok) break;
        const status = await sr.json();
        if (!status.running) return status.lastResult || {};
      }
      return {};
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/interactions", scope, contextId] });
      refetch();
    },
  });

  const interactions = useMemo(() => {
    // KYC/Veriff verification-status emails get mis-matched onto company
    // records — they're system noise, not real correspondence. Drop them so
    // the board mirrors what the AI Activity card shows.
    const noise = /verification (was )?(expired|approved|declined|submitted|pending|completed|created|reminder)|verification for |\bveriff\b/i;
    // One row per meeting/email, not one per attendee mailbox: the same
    // invite lands in every BGP calendar it was sent to — keep the first
    // row and list every BGP attendee on it (Woody, 2026-09-27).
    const byKey = new Map<string, InteractionRow & { bgpUsers: string[]; laterDates?: string[] }>();
    for (const i of (data?.interactions || []).map(norm)) {
      if (noise.test(`${i.subject || ""}`)) continue;
      const t = new Date(i.interactionDate);
      const when = isNaN(t.getTime()) ? String(i.interactionDate || "") : t.toISOString().slice(0, 16);
      const key = `${i.type}|${(i.subject || "").trim().toLowerCase()}|${when}`;
      const existing = byKey.get(key);
      if (existing) {
        if (i.bgpUser && !existing.bgpUsers.includes(i.bgpUser)) existing.bgpUsers.push(i.bgpUser);
        continue;
      }
      byKey.set(key, { ...i, bgpUsers: i.bgpUser ? [i.bgpUser] : [] });
    }
    // Upcoming occurrences of one recurring series ("9am: Fortnightly Retail
    // Leasing Agents Meeting" on 21 Oct, 4 Nov, 18 Nov) read as the same row
    // three times — show the soonest and note the rest.
    const now = Date.now();
    const seriesHead = new Map<string, InteractionRow & { bgpUsers: string[]; laterDates?: string[] }>();
    // Cancelled occurrences still listed as upcoming ("then 21 Oct, 4 Nov"
    // while the summary says 4 Nov was cancelled). Stored rows carry no
    // cancel flag, so drop explicit "Canceled:/Declined:" rows and any
    // occurrence left in under half the BGP calendars the series normally
    // reaches — the organiser's cancellation removed it from the rest
    // (Woody, 2026-09-28).
    const CANCELLED = /^\s*(cancel{1,2}ed|declined)\b|\b(this|the) (meeting|event|occurrence) (has been|was|is) cancel{1,2}ed\b/i;
    const reach = new Map<string, number>();
    for (const r of Array.from(byKey.values())) {
      if (r.type !== "meeting") continue;
      const sk = (r.subject || "").trim().toLowerCase();
      reach.set(sk, Math.max(reach.get(sk) || 0, r.bgpUsers.length));
    }
    const all = Array.from(byKey.values()).filter((r) => {
      if (r.type !== "meeting" || new Date(r.interactionDate).getTime() <= now) return true;
      if (CANCELLED.test(r.subject || "") || CANCELLED.test(r.preview || "")) return false;
      const max = reach.get((r.subject || "").trim().toLowerCase()) || 0;
      return !(max >= 3 && r.bgpUsers.length * 2 < max);
    });
    const upcomingSoonestFirst = all
      .filter((r) => r.type === "meeting" && new Date(r.interactionDate).getTime() > now && (r.subject || "").trim())
      .sort((a, b) => new Date(a.interactionDate).getTime() - new Date(b.interactionDate).getTime());
    const absorbed = new Set<any>();
    for (const r of upcomingSoonestFirst) {
      const sk = (r.subject || "").trim().toLowerCase();
      const head = seriesHead.get(sk);
      if (head) {
        (head.laterDates ||= []).push(r.interactionDate);
        for (const u of r.bgpUsers) if (!head.bgpUsers.includes(u)) head.bgpUsers.push(u);
        absorbed.add(r);
      } else {
        seriesHead.set(sk, r);
      }
    }
    // Past occurrences of the same series collapse too — Aaron Addo's board
    // listed the fortnightly agents meeting four times (4d, 2w, 1mo, 1mo
    // ago). Keep the most recent and note the earlier dates
    // (Woody, 2026-09-27).
    const pastHead = new Map<string, InteractionRow & { bgpUsers: string[]; earlierDates?: string[] }>();
    const pastNewestFirst = all
      .filter((r) => r.type === "meeting" && new Date(r.interactionDate).getTime() <= now && (r.subject || "").trim())
      .sort((a, b) => new Date(b.interactionDate).getTime() - new Date(a.interactionDate).getTime());
    for (const r of pastNewestFirst) {
      const sk = (r.subject || "").trim().toLowerCase();
      const head = pastHead.get(sk);
      if (head) {
        (head.earlierDates ||= []).push(r.interactionDate);
        for (const u of r.bgpUsers) if (!head.bgpUsers.includes(u)) head.bgpUsers.push(u);
        absorbed.add(r);
      } else {
        pastHead.set(sk, r);
      }
    }
    return all.filter((r) => !absorbed.has(r)) as Array<InteractionRow & { bgpUsers: string[]; laterDates?: string[]; earlierDates?: string[] }>;
  }, [data]);
  const emailCount = interactions.filter(i => i.type === "email" || i.type === "call" || i.type === "note").length;
  const meetingCount = interactions.filter(i => i.type === "meeting").length;
  const totalCount = interactions.length;
  const sinceLabel = useMemo(() => {
    const times = interactions.map((i) => new Date(i.interactionDate).getTime()).filter((t) => !isNaN(t));
    return times.length ? gbDate(Math.min(...times), { day: "numeric", month: "short", year: "numeric" }) : null;
  }, [interactions]);

  // Auto-fire meeting sync once when this page opens with 0 meetings.
  // One-off per scope+id per session — won't loop.
  useEffect(() => {
    if (autoSyncedRef.current) return;
    if (isClientViewer) return;
    if (isLoading || !data) return;
    if (meetingCount === 0 && totalCount > 0) {
      autoSyncedRef.current = true;
      syncMutation.mutate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, data, meetingCount, totalCount]);

  const filtered = useMemo(() => {
    if (typeFilter === "all") return interactions;
    if (typeFilter === "meeting") return interactions.filter(i => i.type === "meeting");
    return interactions.filter(i => i.type === "email" || i.type === "call" || i.type === "note");
  }, [interactions, typeFilter]);

  const topBgp = data?.topBgpContacts || [];
  const nextInt = data?.nextInteraction;

  function openRow(row: InteractionRow) {
    if (!row.microsoftId || !row.bgpUser) return;
    // crm_interactions.microsoft_id is stored prefixed with email_ / cal_ —
    // strip before passing to the Graph fetcher.
    const rawId = row.microsoftId.replace(/^(email_|cal_)/, "");
    if (row.type === "meeting") setOpenMeeting({ eventId: rawId, mailboxEmail: row.bgpUser });
    else setOpenEmail({ msgId: rawId, mailboxEmail: row.bgpUser });
  }

  return (
    <>
      <Card>
        <CardContent className="p-3 space-y-3">
          {/* Banner: next interaction + top BGP contacts */}
          {(nextInt || topBgp.length > 0) && (
            <div className="rounded-md border bg-muted/30 p-2 space-y-1.5">
              {nextInt && (
                <div className="flex items-start gap-1.5 text-xs">
                  <Calendar className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">Next interaction · </span>
                    <span className="text-muted-foreground">
                      {new Date(nextInt.interactionDate).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {nextInt.subject ? ` — ${nextInt.subject}` : ""}
                    </span>
                  </div>
                </div>
              )}
              {topBgp.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  <Users className="w-3 h-3 text-muted-foreground shrink-0" />
                  {/* These count every logged email and meeting invite in the
                      last 90 days — say so, or they read as contradicting the
                      deduped tab counts and the contact's notes (Woody, 2026-09-28). */}
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">Most active BGP · last 90 days</span>
                  {/* Busiest first (Woody, 2026-09-27) */}
                  {[...topBgp].sort((a, b) => (b.count90d - a.count90d) || (b.countAll - a.countAll)).slice(0, 4).map(b => (
                    <Badge
                      key={b.email}
                      variant="outline"
                      className="text-[10px] font-normal"
                      title={`${b.count90d} logged emails and invites in the last 90 days · ${b.countAll} all-time`}
                    >
                      {b.name} · {b.count90d}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Type-filter chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(["all", "email", "meeting"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1 ${
                  typeFilter === t
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {t === "all" && <>All ({totalCount})</>}
                {t === "email" && <><Mail className="w-3 h-3" /> Emails ({emailCount})</>}
                {t === "meeting" && <><Calendar className="w-3 h-3" /> Meetings ({meetingCount})</>}
              </button>
            ))}
            {/* Tab counts are distinct emails / meetings (series collapsed)
                in the loaded window — date it so it doesn't read as all-time
                (Woody, 2026-09-28). */}
            {sinceLabel && <span className="text-[10px] text-muted-foreground">since {sinceLabel}</span>}
            {syncMutation.isPending && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-1 ml-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Syncing meetings…
              </span>
            )}
            {!isClientViewer && (
              <button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="ml-auto text-[10px] text-muted-foreground hover:text-foreground underline disabled:opacity-50"
              >
                Sync now
              </button>
            )}
          </div>

          {/* List — 3-line rows */}
          {isLoading ? (
            <p className="text-xs text-muted-foreground italic flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              {typeFilter === "meeting" ? "No meetings logged. Sync may still be running." : "No interactions in the last 2 years."}
            </p>
          ) : (
            <div className="space-y-1 max-h-[480px] overflow-y-auto pr-1">
              {filtered.slice(0, 30).map(row => {
                const canOpen = !!(row.microsoftId && row.bgpUser);
                const isMeeting = row.type === "meeting";
                return (
                  <div
                    key={row.id}
                    onClick={() => openRow(row)}
                    className={`rounded-md border border-transparent ${canOpen ? "hover:bg-muted/50 hover:border-border cursor-pointer" : ""} px-2 py-1.5 transition-colors`}
                    title={canOpen ? "Click to view" : ""}
                  >
                    {/* Line 1: type + BGP contact + relative date.
                        BGP user name is bumped to match the subject heading
                        size and coloured so it pops out of the row. */}
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      {isMeeting ? <Calendar className="w-3 h-3 text-purple-600 shrink-0" /> : <Mail className="w-3 h-3 text-blue-600 shrink-0" />}
                      {/* Phone truncated the full names to "Charlo…" — show
                          first name + initial there (Woody, 2026-09-28). */}
                      {(() => {
                        const names = (row.bgpUsers.length ? row.bgpUsers : [row.bgpUser]).map((u) => bgpUserDisplay(u, emailToName)).filter(Boolean);
                        // Two names still cut to "Will P.,…" — one name plus
                        // a count ("Will P. +3") (Woody, 2026-09-28).
                        const short = names.slice(0, 1).map((n) => { const [f, ...rest] = n.split(/\s+/); return rest.length ? `${f} ${rest[rest.length - 1][0]}.` : f; }).join("") + (names.length > 1 ? ` +${names.length - 1}` : "");
                        return (
                          <span className="text-sm font-semibold text-primary truncate min-w-0" title={names.join(", ")}>
                            <span className="hidden md:inline">{names.join(", ")}</span>
                            <span className="md:hidden">{short}</span>
                          </span>
                        );
                      })()}
                      <span className="shrink-0">· {relDate(row.interactionDate)}</span>
                      {row.laterDates && row.laterDates.length > 0 && (
                        <span className="shrink-0 opacity-70" title={row.laterDates.map((d) => gbDate(d, { day: "numeric", month: "short", year: "numeric" })).join(", ")}>
                          · then {row.laterDates.slice(0, 2).map((d) => gbDate(d, { day: "numeric", month: "short" })).join(", ")}{row.laterDates.length > 2 ? ` +${row.laterDates.length - 2}` : ""}
                        </span>
                      )}
                      {row.earlierDates && row.earlierDates.length > 0 && (
                        <span className="shrink-0 opacity-70" title={row.earlierDates.map((d) => gbDate(d, { day: "numeric", month: "short", year: "numeric" })).join(", ")}>
                          · also {row.earlierDates.slice(0, 2).map((d) => gbDate(d, { day: "numeric", month: "short" })).join(", ")}{row.earlierDates.length > 2 ? ` +${row.earlierDates.length - 2}` : ""}
                        </span>
                      )}
                      {/* Meeting direction is stamped at sync time, so last
                          week's session still said "upcoming" — derive it
                          from the date instead (Woody, 2026-09-27). */}
                      {(() => {
                        const future = new Date(row.interactionDate).getTime() > Date.now();
                        const dir = isMeeting || /^(upcoming|past)$/i.test(row.direction || "")
                          ? (future ? "upcoming" : null)
                          : row.direction;
                        return dir ? <span className="shrink-0 whitespace-nowrap opacity-70">· {dir}</span> : null;
                      })()}
                      {canOpen && <ExternalLink className="w-2.5 h-2.5 ml-auto opacity-0 group-hover:opacity-60" />}
                    </div>
                    {/* Line 2: subject */}
                    {row.subject && (
                      <div className="text-sm font-medium leading-snug truncate">{row.subject}</div>
                    )}
                    {/* Line 3: preview (single line, ellipsised) */}
                    {cleanPreview(row.preview) && (
                      <div className="text-xs text-muted-foreground leading-snug truncate">{cleanPreview(row.preview)}</div>
                    )}
                  </div>
                );
              })}
              {filtered.length > 30 && (
                <p className="text-[10px] text-muted-foreground italic px-2 sticky bottom-0 bg-card">+ {filtered.length - 30} more</p>
              )}
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
      {openMeeting && (
        <MeetingViewerDialog
          eventId={openMeeting.eventId}
          mailboxEmail={openMeeting.mailboxEmail}
          onClose={() => setOpenMeeting(null)}
        />
      )}
    </>
  );
}
