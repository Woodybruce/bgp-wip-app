import { CRM_INTERVIEW_SECTIONS as SECTIONS } from "@shared/crm-interview-questions";
import { BGP_TEAM_NAMES, TEAM_DOT_CLASSES } from "@shared/teams";
// CRM Meetings — Phase 1 "Heads of Team" interviews from the BGP CRM
// Strategy doc (Sept 2026). A card grid of interviews (one per team, plus
// any extras); opening a card shows the strategy doc's question set grouped
// by its five sections, a response box under every question, autosaving as
// you type. Rendered as a tab inside the CRM hub (pages/people.tsx).
import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { LandlordWeeklyMeetings } from "@/components/landlord-weekly-meetings";
import type { LandlordInterviewMention } from "../../../server/landlord-interview-links";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { gbDate, toDateInputValue } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronLeft, ClipboardList, Plus, Trash2 } from "lucide-react";

interface CrmInterview {
  id: string;
  team: string;
  interviewee: string | null;
  meeting_date: string | null;
  responses: Record<string, string> | null;
  created_at: string;
  updated_at: string;
}

// The 2026-10 team structure (shared/teams.ts).
const TEAMS: string[] = [...BGP_TEAM_NAMES];

// Identity dot per team (docs/DESIGN.md — identity palettes as dots, never
// full fills). Everything else stays on theme tokens.
const TEAM_DOT: Record<string, string> = TEAM_DOT_CLASSES;

const ALL_QUESTIONS = SECTIONS.flatMap((s) => s.questions);

function answeredCount(iv: CrmInterview): number {
  const r = iv.responses || {};
  return ALL_QUESTIONS.filter((q) => (r[q.id] || "").trim().length > 0).length;
}

function initialsFor(iv: CrmInterview): string {
  const name = (iv.interviewee || "").trim();
  if (name) return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  // No interviewee yet: team initials ("L", "LA") read as a person.
  return "?";
}

function formatMeetingDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return gbDate(date, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

// Resolve saved links again before refreshing briefs: an edit can move a
// mention between landlords, and the previous landlord must lose it too.
async function refreshInterviewLandlordBriefs(interviewId: string) {
  const linksKey = ["/api/crm/landlords/interview-links"];
  const affectedIds = new Set<string>();
  const remember = (links: LandlordInterviewMention[] | undefined) => {
    for (const link of links || []) if (link.interviewId === interviewId) affectedIds.add(link.companyId);
  };
  for (const [, links] of queryClient.getQueriesData<LandlordInterviewMention[]>({ queryKey: linksKey })) remember(links);
  try {
    await queryClient.invalidateQueries({ queryKey: linksKey });
    remember(await queryClient.fetchQuery<LandlordInterviewMention[]>({
      queryKey: linksKey,
      queryFn: async () => (await apiRequest("GET", "/api/crm/landlords/interview-links")).json(),
      staleTime: 1_000,
    }));
  } catch {
    // The interview was saved successfully. A delayed link refresh must
    // not turn that successful write into a failed-save message.
  }
  await queryClient.invalidateQueries({ predicate: query =>
    query.queryKey[0] === "/api/brand" && query.queryKey[2] === "ai-take"
    && affectedIds.has(String(query.queryKey[1])) });
}

export function CrmMeetingsTab() {
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("interview"));
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newTeam, setNewTeam] = useState(TEAMS[0]);
  const [newInterviewee, setNewInterviewee] = useState("");

  const { data: interviews, isLoading } = useQuery<CrmInterview[]>({
    queryKey: ["/api/crm/interviews"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/crm/interviews");
      return res.json();
    },
  });

  const selected = interviews?.find((iv) => iv.id === selectedId) || null;
  const { data: landlordLinks = [] } = useQuery<LandlordInterviewMention[]>({
    queryKey: ["/api/crm/landlords/interview-links"],
    queryFn: async () => (await apiRequest("GET", "/api/crm/landlords/interview-links")).json(),
    staleTime: 30_000,
  });

  // Local drafts per question + name/date, so typing never waits on the
  // network; PATCHes are debounced per question and merged server-side.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [nameDraft, setNameDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveFailedRef = useRef(false);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingSavesRef = useRef(0);

  useEffect(() => {
    // Seed the editor state whenever a different interview opens.
    if (selected) {
      setDrafts({ ...(selected.responses || {}) });
      setNameDraft(selected.interviewee || "");
      setSaveState("idle");
    }
    // Intentionally keyed on the id only — cache refreshes while typing
    // must not clobber the local drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => () => {
    Object.values(timersRef.current).forEach(clearTimeout);
  }, []);

  const patchInterview = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: any }) => {
      const res = await apiRequest("PATCH", `/api/crm/interviews/${id}`, body);
      return res.json() as Promise<CrmInterview>;
    },
    onMutate: () => {
      if (pendingSavesRef.current === 0) saveFailedRef.current = false;
      pendingSavesRef.current += 1;
      setSaveState("saving");
    },
    onSuccess: (row) => {
      queryClient.setQueryData<CrmInterview[]>(["/api/crm/interviews"], (prev) =>
        prev ? prev.map((iv) => (iv.id === row.id ? row : iv)) : prev,
      );
      void refreshInterviewLandlordBriefs(row.id);
    },
    onError: () => { saveFailedRef.current = true; },
    onSettled: () => {
      pendingSavesRef.current -= 1;
      if (pendingSavesRef.current <= 0) setSaveState(saveFailedRef.current ? "error" : "saved");
    },
  });

  const queueResponseSave = useCallback((id: string, qid: string, value: string) => {
    if (timersRef.current[qid]) clearTimeout(timersRef.current[qid]);
    timersRef.current[qid] = setTimeout(() => {
      patchInterview.mutate({ id, body: { responses: { [qid]: value } } });
    }, 800);
  }, [patchInterview]);

  const createInterview = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/crm/interviews", { team: newTeam, interviewee: newInterviewee });
      return res.json() as Promise<CrmInterview>;
    },
    onSuccess: (row) => {
      queryClient.setQueryData<CrmInterview[]>(["/api/crm/interviews"], (prev) => (prev ? [...prev, row] : [row]));
      setAddOpen(false);
      setNewInterviewee("");
      setSelectedId(row.id);
    },
  });

  const deleteInterview = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/interviews/${id}`),
    onSuccess: (_res, id) => {
      queryClient.setQueryData<CrmInterview[]>(["/api/crm/interviews"], (prev) =>
        prev ? prev.filter((iv) => iv.id !== id) : prev,
      );
      setConfirmDelete(false);
      setSelectedId(null);
      void refreshInterviewLandlordBriefs(id);
    },
  });

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[120px] rounded-lg" />)}
      </div>
    );
  }

  // ── Interview detail ─────────────────────────────────────────────────────
  if (selected) {
    const answered = ALL_QUESTIONS.filter((q) => (drafts[q.id] || "").trim().length > 0).length;
    return (
      <div className="space-y-6 max-w-[860px]" data-testid="crm-meeting-detail">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)} data-testid="button-back-to-interviews">
            <ChevronLeft className="w-4 h-4 mr-1" /> All interviews
          </Button>
          <div className="flex items-center gap-2">
            {saveState !== "idle" && (
              <span className="text-[11px] text-muted-foreground" data-testid="text-save-state">
                {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved — please try again" : "Saved"}
              </span>
            )}
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(true)} data-testid="button-delete-interview">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-sm font-semibold shrink-0">
            {initialsFor({ ...selected, interviewee: nameDraft })}
          </div>
          <div className="flex-1 min-w-[220px] space-y-1.5">
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                if (nameDraft.trim() !== (selected.interviewee || "")) {
                  patchInterview.mutate({ id: selected.id, body: { interviewee: nameDraft } });
                }
              }}
              placeholder="Interviewee name…"
              className="h-9 max-w-[320px] text-sm font-medium"
              data-testid="input-interviewee-name"
            />
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${TEAM_DOT[selected.team] || "bg-muted-foreground"}`} />
              {selected.team} · Head of Team interview ·{" "}
              <span className="font-mono tabular-nums">{answered} of {ALL_QUESTIONS.length}</span> answered
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Meeting date</Label>
            <Input
              type="date"
              value={selected.meeting_date || ""}
              onChange={(e) => patchInterview.mutate({ id: selected.id, body: { meetingDate: e.target.value || null } })}
              className="h-9 w-[160px] font-mono text-sm"
              data-testid="input-meeting-date"
            />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-3 space-y-2" data-testid="interview-linked-landlords">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Linked landlords</h3>
          <p className="text-xs text-muted-foreground">Saved answers mentioning a landlord link to its profile automatically. They are shown as interview notes, with their source.</p>
          <div className="flex flex-wrap gap-3">
            {[...new Map(landlordLinks.filter(link => link.interviewId === selected.id).map(link => [link.companyId, link])).values()].map(link => <Link key={link.companyId} href={`/companies/${link.companyId}`} className="text-sm font-medium underline underline-offset-2">{link.companyName}</Link>)}
            {!landlordLinks.some(link => link.interviewId === selected.id) && <span className="text-xs text-muted-foreground">No unambiguous landlord names matched in saved answers yet.</span>}
          </div>
        </div>

        {SECTIONS.map((section) => (
          <div key={section.title} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</p>
            {section.note && <p className="text-[11px] text-muted-foreground">{section.note}</p>}
            <div className="rounded-lg border border-border bg-card divide-y divide-border">
              {section.questions.map((q) => (
                <div key={q.id} className="p-4 space-y-2">
                  <p className="text-sm font-medium">{q.text}</p>
                  <Textarea
                    value={drafts[q.id] || ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDrafts((prev) => ({ ...prev, [q.id]: value }));
                      queueResponseSave(selected.id, q.id, value);
                    }}
                    placeholder="Response…"
                    className="min-h-[72px] text-sm resize-y"
                    data-testid={`input-response-${q.id}`}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete interview</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the {selected.team} interview{selected.interviewee ? ` with ${selected.interviewee}` : ""} and every response in it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteInterview.mutate(selected.id)}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ── Card grid ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4" data-testid="crm-meetings-tab">
      <LandlordWeeklyMeetings />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Phase 1 of the CRM strategy — one discovery interview per Head of Team, responses captured live in the meeting.
        </p>
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} data-testid="button-new-interview">
          <Plus className="w-4 h-4 mr-1" /> New interview
        </Button>
      </div>

      {(!interviews || interviews.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ClipboardList className="w-8 h-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-4">No interviews yet — add the first Head of Team interview.</p>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> New interview
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {interviews.map((iv) => {
            const answered = answeredCount(iv);
            const total = ALL_QUESTIONS.length;
            const dateLabel = formatMeetingDate(iv.meeting_date);
            return (
              <button
                key={iv.id}
                onClick={() => setSelectedId(iv.id)}
                className="text-left rounded-lg border border-border bg-card p-4 hover:border-foreground/30 transition-colors"
                data-testid={`card-interview-${iv.team.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold shrink-0">
                    {initialsFor(iv)}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-sm font-medium truncate ${iv.interviewee ? "" : "text-muted-foreground italic"}`}>
                      {iv.interviewee || "Interviewee TBC"}
                    </p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${TEAM_DOT[iv.team] || "bg-muted-foreground"}`} />
                      <span className="truncate">{iv.team} · Head of Team</span>
                    </p>
                  </div>
                </div>
                <div className="mt-3 h-1 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${(answered / total) * 100}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  {/* A past meeting with nothing captured isn't "Not started" —
                      it's an outcome missing (Woody, 2026-09-28). */}
                  {answered === 0 && iv.meeting_date && iv.meeting_date.slice(0, 10) < toDateInputValue(new Date()) ? (
                    <span className="text-amber-700/80 dark:text-amber-400/80">No outcome logged</span>
                  ) : answered === 0 ? (
                    <span>Not started</span>
                  ) : (
                    <span className="tabular-nums">{answered === total ? "Complete" : `${answered} of ${total} answered`}</span>
                  )}
                  {/* Dates are words in running UI, not mono (Woody, 2026-09-28). */}
                  <span>{dateLabel || "No date set"}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>New interview</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Team</Label>
              <Select value={newTeam} onValueChange={setNewTeam}>
                <SelectTrigger data-testid="select-interview-team">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEAMS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Interviewee</Label>
              <Input
                value={newInterviewee}
                onChange={(e) => setNewInterviewee(e.target.value)}
                placeholder="Name (can be added later)"
                data-testid="input-new-interviewee"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => createInterview.mutate()} disabled={createInterview.isPending} data-testid="button-create-interview">
              Add interview
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
