// CRM Meetings — Phase 1 "Heads of Team" interviews from the BGP CRM
// Strategy doc (Sept 2026). A card grid of interviews (one per team, plus
// any extras); opening a card shows the strategy doc's question set grouped
// by its five sections, a response box under every question, autosaving as
// you type. Rendered as a tab inside the CRM hub (pages/people.tsx).
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
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

const TEAMS = ["Leasing", "Investment", "Tenant Rep", "Lease Advisory"];

// Identity dot per team (docs/DESIGN.md — identity palettes as dots, never
// full fills). Everything else stays on theme tokens.
const TEAM_DOT: Record<string, string> = {
  "Leasing": "bg-sky-500",
  "Investment": "bg-violet-500",
  "Tenant Rep": "bg-emerald-500",
  "Lease Advisory": "bg-amber-500",
};

// The Phase 1 question set, verbatim from the strategy doc.
const SECTIONS: { title: string; note?: string; questions: { id: string; text: string }[] }[] = [
  {
    title: "Current practice",
    questions: [
      { id: "cp1", text: "How do you currently track clients, prospects, and deals? (Outlook, Excel, memory, existing CRM?)" },
      { id: "cp2", text: "What does 'the pipeline' look like for your team today — is it written down anywhere?" },
      { id: "cp3", text: "Which 3 clients have paid the most fees to your team in the last 2 years?" },
      { id: "cp4", text: "How do you currently decide who to call/visit and when?" },
    ],
  },
  {
    title: "Relationship landscape",
    questions: [
      { id: "rl1", text: "Who are your top 15–20 relationships (landlords/investors/occupiers/agents) that generate the most repeat work?" },
      { id: "rl2", text: "Which relationships are at risk, dormant, or under-serviced?" },
      { id: "rl3", text: "Which relationships overlap with other teams that you know of?" },
    ],
  },
  {
    title: "New business",
    questions: [
      { id: "nb1", text: "How do new instructions currently arrive — referral, cold approach, tender, repeat client?" },
      { id: "nb2", text: "What targeting do you currently do (by sector, geography, asset type)?" },
    ],
  },
  {
    title: "Pain points & wishlist",
    questions: [
      { id: "pp1", text: "What's the single biggest reason a relationship or opportunity has been dropped in the past 12 months?" },
      { id: "pp2", text: "If you had one tool/process that would make your team's BD easier, what would it be?" },
    ],
  },
  {
    title: "Team members",
    note: "CRM is for every employee and crucial for organic company growth and personal career development — juniors must be included in all meetings where appropriate.",
    questions: [
      { id: "tm1", text: "What are junior members of the team doing for CRM?" },
      { id: "tm2", text: "How can senior members help them build their network?" },
    ],
  },
];

const ALL_QUESTIONS = SECTIONS.flatMap((s) => s.questions);

function answeredCount(iv: CrmInterview): number {
  const r = iv.responses || {};
  return ALL_QUESTIONS.filter((q) => (r[q.id] || "").trim().length > 0).length;
}

function initialsFor(iv: CrmInterview): string {
  const name = (iv.interviewee || "").trim();
  if (name) return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return iv.team.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function formatMeetingDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

export function CrmMeetingsTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  // Local drafts per question + name/date, so typing never waits on the
  // network; PATCHes are debounced per question and merged server-side.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [nameDraft, setNameDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
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
  }, [selectedId]);

  useEffect(() => () => {
    Object.values(timersRef.current).forEach(clearTimeout);
  }, []);

  const patchInterview = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: any }) => {
      const res = await apiRequest("PATCH", `/api/crm/interviews/${id}`, body);
      return res.json() as Promise<CrmInterview>;
    },
    onMutate: () => {
      pendingSavesRef.current += 1;
      setSaveState("saving");
    },
    onSuccess: (row) => {
      queryClient.setQueryData<CrmInterview[]>(["/api/crm/interviews"], (prev) =>
        prev ? prev.map((iv) => (iv.id === row.id ? row : iv)) : prev,
      );
    },
    onSettled: () => {
      pendingSavesRef.current -= 1;
      if (pendingSavesRef.current <= 0) setSaveState("saved");
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
                {saveState === "saving" ? "Saving…" : "Saved"}
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
              <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteInterview.mutate(selected.id)}>
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
                  <span className="font-mono tabular-nums">
                    {answered === 0 ? "Not started" : answered === total ? "Complete" : `${answered} of ${total} answered`}
                  </span>
                  <span className="font-mono tabular-nums">{dateLabel || "No date set"}</span>
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
