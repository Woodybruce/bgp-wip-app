import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarDays, Mail, RefreshCw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Pill } from "@/components/ui/pill";
import type { LandlordMeeting, LandlordMeetingDigest } from "@shared/landlord-meetings";

export function splitLandlordWeekMeetings(meetings: LandlordMeeting[], now = Date.now()) {
  const upcoming: LandlordMeeting[] = [];
  const earlier: LandlordMeeting[] = [];
  for (const meeting of meetings) {
    const start = Date.parse(meeting.start);
    if (!Number.isFinite(start)) continue;
    const end = Date.parse(meeting.end);
    ((Number.isFinite(end) ? end : start) >= now ? upcoming : earlier).push(meeting);
  }
  upcoming.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  earlier.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  return { upcoming, earlier };
}

interface WeekAheadEdition { edition: string; label: string; recipients: string[]; subject: string; html: string; meetings: number; events: number; last: { at: string; sent: number; failed: number } | null }
interface WeekAheadPreview { schedule: string; editions: WeekAheadEdition[] }

// Monday's two emails (Woody, 2026-11-16): landlord meetings to the
// directors, brand and agent meetings to the leasing team. Everyone on CRM
// Meetings is told they go; an admin can read this week's and send
// themselves a copy. Nobody chooses who they go to from here.
function WeekAheadEmail() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState("directors");
  const { data: me } = useQuery<{ isAdmin?: boolean }>({ queryKey: ["/api/auth/me"] });
  const preview = useQuery<WeekAheadPreview>({
    queryKey: ["/api/admin/crm-week-ahead"], queryFn: async () => (await apiRequest("GET", "/api/admin/crm-week-ahead")).json(),
    enabled: open && !!me?.isAdmin, staleTime: 60_000, refetchOnWindowFocus: false, retry: false,
  });
  const sendMe = useMutation({
    mutationFn: async (edition: string) => (await apiRequest("POST", `/api/admin/crm-week-ahead/${encodeURIComponent(edition)}/send-me`)).json(),
    onSuccess: (sent: { sentTo: string }) => toast({ title: "Copy sent", description: `Sent to ${sent.sentTo}.` }),
    onError: () => toast({ title: "The copy could not be sent", variant: "destructive" }),
  });
  const email = preview.data?.editions.find(edition => edition.edition === chosen) || preview.data?.editions[0];
  return <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="crm-week-ahead-line">
    <Mail className="h-3.5 w-3.5" /> On Monday mornings the directors are emailed the week's landlord meetings and CRM events, and the leasing team the week's meetings with brands and agents.
    {me?.isAdmin && <button type="button" className="underline underline-offset-2" onClick={() => setOpen(true)} data-testid="button-week-ahead-preview">See this week's emails</button>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="crm-week-ahead-dialog">
        <DialogHeader><DialogTitle>The week ahead</DialogTitle>
          <DialogDescription>{email ? `Sent on ${preview.data!.schedule} to ${email.recipients.length ? email.recipients.join(", ") : "nobody: it is switched off"}.${email.last ? ` Last sent ${new Date(email.last.at).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" })}.` : " It has not been sent yet."}` : "This week's emails as they stand now."}</DialogDescription>
        </DialogHeader>
        {preview.isLoading ? <Skeleton className="h-64 w-full" /> : preview.isError || !email ? <p className="text-sm">The emails could not be put together. Nothing was sent.</p> : <>
          <div className="flex flex-wrap gap-1.5">{preview.data!.editions.map(edition => <Pill key={edition.edition} active={edition.edition === email.edition} onClick={() => setChosen(edition.edition)} data-testid={`week-ahead-edition-${edition.edition}`}>{edition.label}</Pill>)}</div>
          <p className="text-sm font-medium break-words" data-testid="crm-week-ahead-subject">{email.subject}</p>
          <iframe title="This week's email" sandbox="" srcDoc={email.html} className="w-full h-[420px] rounded-md border bg-white" data-testid="crm-week-ahead-frame" />
          <div className="flex justify-end"><Button size="sm" variant="outline" disabled={sendMe.isPending} onClick={() => sendMe.mutate(email.edition)} data-testid="button-week-ahead-send-me"><Mail className="h-4 w-4 mr-1.5" />{sendMe.isPending ? "Sending…" : "Send me a copy"}</Button></div>
        </>}
      </DialogContent>
    </Dialog>
  </p>;
}

export function LandlordWeeklyMeetings() {
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery<LandlordMeetingDigest>({
    queryKey: ["/api/crm/landlords/meetings/week"],
    queryFn: async () => (await apiRequest("GET", "/api/crm/landlords/meetings/week")).json(),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: query => query.state.data?.coverage.refreshing ? 5_000 : false,
  });
  const refresh = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/landlords/meetings/refresh")).json(),
    onSuccess: () => queryClient.invalidateQueries({ predicate: query =>
      (query.queryKey[0] === "/api/crm/landlords" && query.queryKey[2] === "meetings")
      || query.queryKey[0] === "/api/crm/landlords/meetings/week" || query.queryKey[0] === "/api/crm/landlords/meetings/calendar" || query.queryKey[0] === "/api/crm/leasing-meetings/calendar" }),
  });
  const date = (value: string) => new Date(value).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
  const time = (value: string) => new Date(value).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  const { upcoming, earlier } = splitLandlordWeekMeetings(data?.meetings || []);
  const shown = showAll ? upcoming : upcoming.slice(0, 6);
  const meetingCard = (meeting: LandlordMeeting) => <article key={`${meeting.companyId}-${meeting.id}`} className="rounded-lg border border-border p-3 space-y-2 min-w-0" data-testid="landlord-weekly-meeting">
    <div className="text-xs text-muted-foreground">
      <time dateTime={meeting.start}>{date(meeting.start)} · <span className="font-mono tabular-nums">{time(meeting.start)}</span></time>
    </div>
    <Link href={`/companies/${meeting.companyId}`} className="text-sm font-semibold underline underline-offset-2">{meeting.companyName}</Link>
    <p className="text-sm break-words">{meeting.subject}</p>
    <p className="text-xs text-muted-foreground break-words" data-testid="landlord-weekly-attendee-preview">On the invitation: {meeting.participants.slice(0, 6).map(person => person.name || person.email).join(" · ")}</p>
    {meeting.participants.length > 6 && <details className="text-xs text-muted-foreground" data-testid="landlord-weekly-attendees">
      <summary className="cursor-pointer underline underline-offset-2">Show all {meeting.participants.length} attendees</summary>
      <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto list-disc pl-5">{meeting.participants.map(person => <li key={person.email} className="break-words">{person.name || person.email}</li>)}</ul>
    </details>}
    {meeting.location && <p className="text-xs text-muted-foreground break-words">{meeting.location}</p>}
    {meeting.webLink && <a href={meeting.webLink} target="_blank" rel="noopener noreferrer" className="inline-block text-xs underline underline-offset-2">Open invitation</a>}
  </article>;
  return <section className="rounded-lg border border-border bg-card p-4 space-y-3" data-testid="landlord-weekly-meetings">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold"><CalendarDays className="h-4 w-4" /> Landlord meetings this week</h2>
        {data && <p className="text-xs text-muted-foreground mt-1">{date(data.week.start)} – {date(new Date(new Date(data.week.end).getTime() - 1).toISOString())} · London time</p>}
      </div>
      <Button variant="outline" size="sm" disabled={refresh.isPending || data?.coverage.refreshing} onClick={() => refresh.mutate()}>
        <RefreshCw className={`h-4 w-4 mr-1.5 ${refresh.isPending || data?.coverage.refreshing ? "animate-spin" : ""}`} />
        {refresh.isPending || data?.coverage.refreshing ? "Checking diaries…" : "Check diaries"}
      </Button>
    </div>
    <WeekAheadEmail />
    {isLoading ? <Skeleton className="h-24 w-full" /> : isError ? <p className="text-sm text-destructive">The meeting list could not be loaded. <button className="underline" onClick={() => refetch()}>Try again</button></p> : <>
      {data?.coverage && <p className="text-xs text-muted-foreground" role="status">
        {data.coverage.status === "not_synced" ? "Diaries have not been checked yet." : `${data.coverage.mailboxesChecked} of ${data.coverage.mailboxesExpected} diaries checked${data.coverage.checkedAt ? ` · ${date(data.coverage.checkedAt)} ${time(data.coverage.checkedAt)}` : ""}.`}
        {data.coverage.status === "partial" && " Some diaries are missing or out of date; this list may be incomplete."}
      </p>}
      {!!data?.coverage.issues.length && <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer underline underline-offset-2">Diary coverage details ({data.coverage.issues.length})</summary>
        <ul className="mt-2 max-h-40 overflow-y-auto list-disc pl-5 space-y-1">{data.coverage.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
      </details>}
      {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">{data?.coverage.status === "current" ? "No further landlord meetings were found in the checked diaries for this week." : "No upcoming linked meetings to show yet. Check diaries to update the list."}</p>
        : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="landlord-weekly-upcoming">{shown.map(meetingCard)}</div>}
      {upcoming.length > 6 && <Button variant="ghost" size="sm" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? "Show fewer meetings" : `Show all ${upcoming.length} upcoming meetings`}</Button>}
      {earlier.length > 0 && <details className="border-t border-border pt-3" data-testid="landlord-weekly-earlier">
        <summary className="cursor-pointer text-sm text-muted-foreground underline underline-offset-2">Earlier this week ({earlier.length})</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3 max-h-96 overflow-y-auto">{earlier.map(meetingCard)}</div>
      </details>}
    </>}
    {refresh.isError && <p className="text-sm text-destructive" role="alert">The diary check could not start. The previous list remains visible.</p>}
  </section>;
}
import { useState } from "react";
