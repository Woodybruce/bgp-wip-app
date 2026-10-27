import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, MapPin, RefreshCw, Users, Sparkles } from "lucide-react";
import { LandlordActivityCard } from "./landlord-activity-card";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AiCommentary } from "@/components/ai-commentary";
import { Button } from "@/components/ui/button";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import type { LandlordMeeting, LandlordMeetingCoverage, LandlordMeetingDigest } from "@shared/landlord-meetings";

export function upcomingLandlordMeetings(meetings: LandlordMeeting[], now = Date.now()): LandlordMeeting[] {
  return meetings.filter(meeting => {
    const start = Date.parse(meeting.start);
    const end = Date.parse(meeting.end);
    return Number.isFinite(start) && (Number.isFinite(end) ? end : start) >= now;
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export function landlordMeetingWhen(meeting: LandlordMeeting, now = new Date()): string {
  const start = new Date(meeting.start);
  if (Number.isNaN(start.getTime())) return "Time not recorded";
  const dayKey = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const tomorrow = new Date(Date.parse(`${dayKey(now)}T12:00:00Z`) + 86400000);
  const date = dayKey(start) === dayKey(now) ? "Today" : dayKey(start) === dayKey(tomorrow) ? "Tomorrow" : start.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London",
  });
  const time = start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  return `${date} · ${time}`;
}

export function landlordMeetingCoverageText(coverage?: LandlordMeetingCoverage): string {
  if (!coverage || coverage.status === "not_synced") return "Diaries have not been checked yet. Refresh to find linked invitations.";
  if (coverage.status === "partial") return `Diary coverage is partial (${coverage.mailboxesChecked} of ${coverage.mailboxesExpected} connected diaries checked). Other meetings may be missing.`;
  return `${coverage.mailboxesChecked} connected ${coverage.mailboxesChecked === 1 ? "diary" : "diaries"} checked. Times shown in London time.`;
}

export function landlordMeetingSummarySignature(data?: LandlordMeetingDigest, now = Date.now()): string {
  return JSON.stringify({ coverage: data?.coverage, date: new Date(now).toLocaleDateString("en-CA", { timeZone: "Europe/London" }),
    meetings: (data?.meetings || []).map(meeting => ({ ...meeting,
      phase: Date.parse(meeting.end) < now ? "past" : Date.parse(meeting.start) <= now ? "in-progress" : "future" })) });
}

export function LandlordMeetingsSummary({ companyId, companyName = "this landlord", canRefresh = true }: { companyId: string; companyName?: string; canRefresh?: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<"upcoming" | "recent">("upcoming");
  const [refreshRequestedAt, setRefreshRequestedAt] = useState(0);
  const queryKey = ["/api/crm/landlords", companyId, "meetings"];
  const { data, dataUpdatedAt, isLoading, isError, refetch } = useQuery<LandlordMeetingDigest>({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/crm/landlords/${encodeURIComponent(companyId)}/meetings`, {
        credentials: "include", headers: getAuthHeaders(), signal,
      });
      if (!response.ok) throw new Error("Linked diary invitations could not be loaded.");
      return response.json();
    },
    staleTime: 60_000,
    retry: false,
    refetchInterval: query => query.state.data?.coverage.refreshing || (refreshRequestedAt > 0 && Date.now() - refreshRequestedAt < 90_000) ? 5_000 : 60_000,
  });
  const refresh = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/crm/landlords/meetings/refresh", {});
      return response.json();
    },
    onSuccess: () => {
      setRefreshRequestedAt(Date.now());
      queryClient.invalidateQueries({ predicate: query =>
        (query.queryKey[0] === "/api/crm/landlords" && query.queryKey[2] === "meetings")
        || query.queryKey[0] === "/api/crm/landlords/meetings/week" });
    },
  });
  const refreshing = refresh.isPending || !!data?.coverage.refreshing;
  const upcoming = upcomingLandlordMeetings(data?.meetings || []);
  const recent = (data?.meetings || []).filter(meeting => Number.isFinite(Date.parse(meeting.end)) && Date.parse(meeting.end) < Date.now())
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  const summary = useQuery<{ summary: { text: string; at: string } | null }>({
    queryKey: ["/api/crm/landlords", companyId, "meeting-summary", landlordMeetingSummarySignature(data, dataUpdatedAt || Date.now())],
    queryFn: async () => (await apiRequest("POST", `/api/crm/landlords/${encodeURIComponent(companyId)}/meetings/summary`, {})).json(),
    enabled: !isError && !!data?.meetings.length,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const q = search.toLowerCase().trim();
  const rows = (period === "upcoming" ? upcoming : recent).filter(meeting => !q ||
    [meeting.subject, meeting.location, ...meeting.participants.map(person => `${person.name} ${person.email}`)].join(" ").toLowerCase().includes(q));
  const coverageText = landlordMeetingCoverageText(data?.coverage);
  const shortCoverage = !data || data.coverage.status === "not_synced" ? "Diaries not checked"
    : data.coverage.status === "partial" ? `${data.coverage.mailboxesChecked}/${data.coverage.mailboxesExpected} diaries · partial`
    : `${data.coverage.mailboxesChecked} diaries checked`;
  const openList = (tab: "upcoming" | "recent" = "upcoming") => { setPeriod(tab); setOpen(true); };
  return <>
    <LandlordActivityCard title="Meetings" icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
      count={data ? `${upcoming.length} upcoming` : undefined} testId="landlord-upcoming-meetings"
      actionLabel="View meetings" onOpen={() => openList()} footer={<span title={coverageText}>{shortCoverage}</span>}>
      {isLoading ? <p className="text-sm text-muted-foreground animate-pulse">Loading invitations…</p>
        : isError ? <p role="status" className="text-sm text-muted-foreground">Invitations could not be loaded. <button className="underline" onClick={() => refetch()}>Try again</button></p>
        : <>
          {summary.data?.summary?.text ? <div className="text-sm leading-relaxed line-clamp-3" data-testid="landlord-meeting-ai-summary"><AiCommentary text={summary.data.summary.text} size="sm" /></div>
            : <p className="text-sm text-muted-foreground">{summary.isFetching ? "Preparing the meeting summary…" : upcoming.length ? "Upcoming invitations and recent meetings, linked from the team’s diaries." : "No upcoming invitations linked in the checked diaries."}</p>}
          <div className="divide-y divide-border/60">
            {upcoming.slice(0, 2).map(meeting => <button key={meeting.id} onClick={() => openList()} className="block w-full text-left py-2 first:pt-0 hover:text-primary" data-testid="landlord-meeting-preview">
              <p className="text-xs font-medium text-primary"><time dateTime={meeting.start}>{landlordMeetingWhen(meeting)}</time></p>
              <p className="text-sm font-medium truncate mt-0.5">{meeting.subject || "Calendar meeting"}</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{meeting.participants.map(person => person.name || person.email).join(", ")}</p>
            </button>)}
            {!upcoming.length && !!recent.length && <button className="text-left text-sm py-1 hover:text-primary" onClick={() => openList("recent")}>Last invitation: {recent[0].subject} · {landlordMeetingWhen(recent[0])}</button>}
          </div>
        </>}
    </LandlordActivityCard>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="landlord-meetings-dialog">
        <DialogTitle className="flex items-center gap-2"><Calendar className="w-4 h-4" />Meetings with {companyName}</DialogTitle>
        <DialogDescription>Linked calendar invitations · London time. Past invitations are not confirmation that a meeting took place.</DialogDescription>
        <section className="rounded-lg border border-border bg-card p-3 space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-primary" />Meeting summary</h3>
          {!isError && !!data?.meetings.length && summary.data?.summary?.text ? <AiCommentary text={summary.data.summary.text} size="sm" />
            : <p className="text-sm text-muted-foreground">{summary.isFetching ? "Reading the invitations…" : "A summary is not available yet. The invitations are below."}</p>}
        </section>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={period === "upcoming" ? "secondary" : "ghost"} onClick={() => setPeriod("upcoming")}>Upcoming ({upcoming.length})</Button>
          <Button size="sm" variant={period === "recent" ? "secondary" : "ghost"} onClick={() => setPeriod("recent")}>Recent ({recent.length})</Button>
          {canRefresh && <Button size="sm" variant="outline" className="ml-auto" onClick={() => refresh.mutate()} disabled={refreshing} data-testid="landlord-refresh-meetings"><RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />{refreshing ? "Refreshing…" : "Refresh diaries"}</Button>}
        </div>
        <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search meeting, person or place" aria-label="Search meetings" />
        {isLoading ? <p className="text-sm text-muted-foreground">Loading invitations…</p> : isError ? <p role="status">Invitations could not be loaded.</p> : <div className="rounded-lg border divide-y divide-border">
          {rows.map(meeting => <article key={meeting.id} className="p-3 space-y-2 min-w-0" data-testid="landlord-meeting">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-xs font-medium text-primary"><time dateTime={meeting.start}>{landlordMeetingWhen(meeting)}</time></p><h4 className="text-sm font-semibold mt-1 break-words">{meeting.subject || "Calendar meeting"}</h4></div>
              {meeting.webLink && <Button asChild size="sm" variant="outline" className="shrink-0"><a href={meeting.webLink} target="_blank" rel="noopener noreferrer">Invitation</a></Button>}
            </div>
            <p className="text-sm text-muted-foreground flex items-start gap-1.5"><Users className="w-3.5 h-3.5 mt-1 shrink-0" /><span className="break-words">{meeting.participants.map(person => person.name || person.email).join(", ")}</span></p>
            {!!meeting.bgpParticipants.length && <p className="text-xs text-muted-foreground"><span className="font-medium">BGP: </span>{meeting.bgpParticipants.map(person => person.name || person.email).join(", ")}</p>}
            {meeting.location && <p className="text-xs text-muted-foreground flex items-start gap-1.5"><MapPin className="w-3.5 h-3.5 shrink-0" /><span className="break-words">{meeting.location}</span></p>}
          </article>)}
          {!rows.length && <p className="p-3 text-sm text-muted-foreground">{q ? "No invitations match that search." : `No ${period} invitations linked in the checked diaries.`}</p>}
        </div>}
        <p className="text-xs text-muted-foreground" data-testid="landlord-diary-coverage">{coverageText}{data?.coverage.checkedAt && <> Last checked {new Date(data.coverage.checkedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}.</>}</p>
        {refresh.isError && <p role="status" className="text-sm text-destructive">The diary refresh could not start. Existing invitations are still shown.</p>}
      </DialogContent>
    </Dialog>
  </>;
}
