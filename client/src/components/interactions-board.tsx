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

function relDate(d: string | null | undefined): string {
  if (!d) return "";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function bgpUserDisplay(raw: string | null | undefined, userMap: Map<string, string>): string {
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (userMap.has(lower)) return userMap.get(lower)!;
  const local = lower.includes("@") ? lower.split("@")[0] : lower;
  return local.replace(/\b\w/g, c => c.toUpperCase());
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
      const r = await fetch(`/api/interactions/${scope}/${encodeURIComponent(contextId)}`, { credentials: "include" });
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
    return (data?.interactions || []).map(norm).filter((i: any) => !noise.test(`${i.subject || ""}`));
  }, [data]);
  const emailCount = interactions.filter(i => i.type === "email" || i.type === "call" || i.type === "note").length;
  const meetingCount = interactions.filter(i => i.type === "meeting").length;
  const totalCount = interactions.length;

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
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">Most active BGP</span>
                  {topBgp.slice(0, 4).map(b => (
                    <Badge
                      key={b.email}
                      variant="outline"
                      className="text-[10px] font-normal"
                      title={`${b.countAll} interactions all-time`}
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
                      <span className="text-sm font-semibold text-primary">{bgpUserDisplay(row.bgpUser, emailToName)}</span>
                      <span>· {relDate(row.interactionDate)}</span>
                      {row.direction && <span className="opacity-70">· {row.direction}</span>}
                      {canOpen && <ExternalLink className="w-2.5 h-2.5 ml-auto opacity-0 group-hover:opacity-60" />}
                    </div>
                    {/* Line 2: subject */}
                    {row.subject && (
                      <div className="text-sm font-medium leading-snug truncate">{row.subject}</div>
                    )}
                    {/* Line 3: preview (single line, ellipsised) */}
                    {row.preview && (
                      <div className="text-xs text-muted-foreground leading-snug truncate">{row.preview}</div>
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
