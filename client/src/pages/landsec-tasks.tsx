// Tasks, for every Landsec login (Woody, 2026-11-13: "we need each person to
// have this update their own task list ... and add to the side bar"): a full
// Landsec login or leasing manager, an asset manager and a joint agent.
//
// It leads with "Waiting on you": the person's deal checklist items that a
// deal's waiting-on points at, with the unit, scheme, stage and days. Then
// everything else to do, then what is done. Each task opens where the work
// is; ticking one here ticks it there.
//
// Two row shapes come from GET /api/tasks. An asset manager or joint agent is
// sent only their own tasks at their own schemes, with the link already
// worked out (and no link where they have no page to open), and can tick a
// task and nothing else. A full Landsec login is sent the ordinary task rows
// and can also add a task of their own.
import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check, ChevronRight, Plus } from "lucide-react";
import { Pill, PillCount, pillMetrics } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DealWaitingPill, dealIsWaitingOn } from "@/components/deal-waiting-pill";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CHECKLIST_STAGES, checklistLinkPath } from "@shared/deal-checklist";
import { landsecRestrictedRole } from "@shared/landsec-menu";

interface LandsecTask {
  id: string; title: string; description: string | null; due_date: string | null; priority: string | null; status: string;
  category: string | null; created_at: string | null; completed_at: string | null; assigned_by_name: string | null;
  // What a task is about, on both shapes.
  kind?: "deal_checklist" | "viewing_followup" | "task"; unit_id?: string | null; unit_name?: string | null;
  property_name?: string | null; checklist_stage?: string | null;
  waitingOnDeal?: boolean; waitingDays?: number | null;
  // An asset manager's or joint agent's row: where the work is, or null.
  link?: string | null;
  // The ordinary row.
  source_ref?: string | null; linked_deal_id?: string | null; linked_property_id?: string | null; deal_name?: string | null;
}

const KIND_LABEL: Record<string, string> = { deal_checklist: "Deal checklist", viewing_followup: "Viewing" };
const LINK_LABEL: Record<string, string> = { deal_checklist: "Open the checklist", viewing_followup: "Open viewings", deal: "Open the deal", property: "Open the property" };
const ROW_CHIP = `${pillMetrics} border border-border px-2 py-[3px] text-[10px] text-muted-foreground`;
const SECTION_LABEL = "text-xs font-semibold uppercase tracking-wider text-muted-foreground";

const day = (d: string | null | undefined) => {
  if (!d) return null;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const isOverdue = (t: LandsecTask) => {
  if (t.status === "done" || !t.due_date) return false;
  const due = new Date(t.due_date);
  if (isNaN(due.getTime())) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
};

const kindOf = (t: LandsecTask): "deal_checklist" | "viewing_followup" | "task" => {
  if (t.kind) return t.kind;
  const ref = String(t.source_ref || "");
  return ref.startsWith("deal_checklist:") ? "deal_checklist" : ref.startsWith("viewing_followup:") ? "viewing_followup" : "task";
};

// Where the work is. A restricted login only ever uses the link it was sent:
// its pages are its own, and with none sent there is none to open.
function whereFor(t: LandsecTask, restricted: boolean): { href: string; label: string } | null {
  const kind = kindOf(t);
  if (restricted || Object.prototype.hasOwnProperty.call(t, "link")) {
    return t.link ? { href: t.link, label: LINK_LABEL[kind] || "Open" } : null;
  }
  if (kind === "deal_checklist") return t.unit_id ? { href: checklistLinkPath("tracker", t.unit_id), label: LINK_LABEL.deal_checklist } : null;
  if (kind === "viewing_followup") {
    const viewingId = String(t.source_ref || "").slice("viewing_followup:".length);
    return viewingId ? { href: `/available?tab=viewings&viewingId=${encodeURIComponent(viewingId)}`, label: LINK_LABEL.viewing_followup } : null;
  }
  if (t.linked_deal_id && t.deal_name) return { href: `/deals/${encodeURIComponent(t.linked_deal_id)}`, label: LINK_LABEL.deal };
  if (t.linked_property_id && t.property_name) return { href: `/properties/${encodeURIComponent(t.linked_property_id)}`, label: LINK_LABEL.property };
  return null;
}

// The line that says where the task is: scheme, then unit (or the deal).
const placeOf = (t: LandsecTask) => [t.property_name, t.unit_name || (kindOf(t) === "task" ? t.deal_name : null)].filter(Boolean).join(" · ");
// The link a viewing follow-up carries in its text is the button on the row,
// and a checklist task's own line ("Deal checklist, Negotiating stage.
// Required. Asked by ...") is what the chips under it already say.
const descriptionOf = (t: LandsecTask) =>
  t.description
    ? String(t.description).split("\n").filter(line => !/^Open the viewing:/i.test(line.trim()) && !(kindOf(t) === "deal_checklist" && /^Deal checklist, /i.test(line.trim()))).join("\n").trim() || null
    : null;
const stageOf = (t: LandsecTask) => CHECKLIST_STAGES.find(s => s.key === t.checklist_stage)?.label || null;

export default function LandsecTasks() {
  const { toast } = useToast();
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const restricted = landsecRestrictedRole(me?.landsecRole);
  const { data, isLoading, error } = useQuery<LandsecTask[]>({ queryKey: ["/api/tasks"], enabled: !!me, staleTime: 30 * 1000 });
  const [view, setView] = useState<"open" | "done">("open");
  const [newTitle, setNewTitle] = useState("");

  const afterWrite = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    // The checklist item follows its task, and a deal waiting on the item
    // moves on: the checklist and the deal clock read it again.
    queryClient.invalidateQueries({ predicate: q => {
      const k = String(q.queryKey[0] || "");
      return k.startsWith("/api/deal-checklists") || k.startsWith("/api/landsec/deal") || k.startsWith("/api/landsec/unit/");
    } });
  };

  const tick = useMutation({
    mutationFn: async (v: { id: string; status: "done" | "todo" }) => (await apiRequest("PATCH", `/api/tasks/${v.id}`, { status: v.status })).json(),
    onMutate: async v => {
      await queryClient.cancelQueries({ queryKey: ["/api/tasks"] });
      const before = queryClient.getQueryData<LandsecTask[]>(["/api/tasks"]);
      queryClient.setQueryData<LandsecTask[]>(["/api/tasks"], old => (Array.isArray(old) ? old : []).map(t => (t.id === v.id ? { ...t, status: v.status, completed_at: v.status === "done" ? new Date().toISOString() : null } : t)));
      return { before };
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.before) queryClient.setQueryData(["/api/tasks"], ctx.before);
      toast({ title: "Not saved", description: e?.message, variant: "destructive" });
    },
    onSettled: afterWrite,
  });

  const add = useMutation({
    mutationFn: async (title: string) => (await apiRequest("POST", "/api/tasks", { title, priority: "medium" })).json(),
    onSuccess: () => { setNewTitle(""); afterWrite(); },
    onError: (e: any) => toast({ title: "Task not added", description: e?.message, variant: "destructive" }),
  });
  const submitNew = (e: FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (title && !add.isPending) add.mutate(title);
  };

  const tasks = Array.isArray(data) ? data : [];
  const open = useMemo(() => tasks.filter(t => t.status !== "done"), [tasks]);
  const waiting = useMemo(() => open.filter(dealIsWaitingOn).sort((a, b) => (b.waitingDays ?? -1) - (a.waitingDays ?? -1)), [open]);
  const todo = useMemo(() => open.filter(t => !dealIsWaitingOn(t)), [open]);
  const done = useMemo(() => tasks.filter(t => t.status === "done").sort((a, b) => String(b.completed_at || "").localeCompare(String(a.completed_at || ""))), [tasks]);
  const overdue = open.filter(isOverdue).length;

  if (error) return <div className="p-4 md:p-6" data-testid="landsec-tasks"><h1 className="text-2xl font-bold tracking-tight">Tasks</h1><p className="mt-1 text-sm text-muted-foreground">Your tasks could not be loaded. {(error as any)?.message || ""}</p></div>;

  const row = (t: LandsecTask) => {
    const isDone = t.status === "done";
    const late = isOverdue(t);
    const kind = kindOf(t);
    const where = whereFor(t, restricted);
    const place = placeOf(t);
    const description = descriptionOf(t);
    const due = day(t.due_date);
    const stage = stageOf(t);
    const waitingNow = dealIsWaitingOn(t);
    return (
      <li key={t.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 p-3 sm:flex-nowrap" data-testid={`landsec-task-${t.id}`}>
        <button
          type="button"
          data-no-min-touch
          aria-label={isDone ? `Mark as not done: ${t.title}` : `Mark as done: ${t.title}`}
          title={isDone ? "Mark as not done" : "Mark as done"}
          disabled={tick.isPending}
          onClick={() => tick.mutate({ id: t.id, status: isDone ? "todo" : "done" })}
          className="group -m-2.5 mt-[-0.5rem] flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          data-testid={`landsec-task-tick-${t.id}`}
        >
          {/* The circle stays 20px; the button around it is the 40px tap area. */}
          <span className={`flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${isDone ? "bg-foreground text-background border-transparent" : "border-border group-hover:border-foreground"}`}>
            {isDone && <Check className="w-3 h-3" />}
          </span>
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <p className={`text-sm font-medium break-words ${isDone ? "line-through text-muted-foreground" : ""}`}>{t.title}</p>
          {place && <p className="text-xs text-muted-foreground truncate" data-testid={`landsec-task-place-${t.id}`}>{place}</p>}
          {description && <p className="text-xs text-muted-foreground whitespace-pre-line break-words">{description}</p>}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {waitingNow && <DealWaitingPill days={t.waitingDays} className="px-2 py-[3px] text-[10px]" testId={`landsec-task-waiting-${t.id}`} />}
            {KIND_LABEL[kind] && <span className={ROW_CHIP}>{KIND_LABEL[kind]}</span>}
            {stage && <span className={ROW_CHIP} data-testid={`landsec-task-stage-${t.id}`}>{stage} stage</span>}
            {kind === "deal_checklist" && t.priority === "high" ? <span className={`${ROW_CHIP} text-foreground`}>Required</span> : null}
            {isDone
              ? <span>Done {day(t.completed_at) || ""}</span>
              : due && <span className={late ? "font-semibold text-red-700 dark:text-red-400" : ""}>{late ? "Overdue, was due" : "Due"} {due}</span>}
            {t.assigned_by_name && <span>Asked by {t.assigned_by_name}</span>}
          </p>
        </div>
        {where && (
          <div className="shrink-0 basis-full pl-8 sm:basis-auto sm:pl-0">
            <Link href={where.href} className="inline-flex h-8 items-center gap-0.5 rounded-md border border-border px-2 text-xs font-medium hover:bg-muted whitespace-nowrap" data-testid={`landsec-task-open-${t.id}`}>
              {where.label} <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        )}
      </li>
    );
  };

  const emptyTodo = restricted
    ? "Nothing to do. When you are made responsible for an item on a deal checklist, it appears here."
    : "Nothing to do. When you are made responsible for an item on a deal checklist it appears here, and you can add a task of your own above.";

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="landsec-tasks">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground mt-0.5" data-testid="landsec-tasks-summary">
          {data
            ? `${open.length} to do${waiting.length ? ` · ${waiting.length} with a deal waiting on you` : ""}${overdue ? ` · ${overdue} overdue` : ""} · ${done.length} done`
            : restricted ? "What you are responsible for on the lettings at your schemes" : "What you are responsible for on the lettings, and your own tasks"}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Pill active={view === "open"} onClick={() => setView("open")} data-testid="landsec-tasks-open">To do <PillCount n={open.length} active={view === "open"} /></Pill>
        <Pill active={view === "done"} onClick={() => setView("done")} data-testid="landsec-tasks-done">Done <PillCount n={done.length} active={view === "done"} /></Pill>
      </div>

      {(isLoading || !me) && <Skeleton className="h-40 rounded-lg" />}

      {data && view === "open" && (
        <>
          <section className="space-y-1.5" data-testid="landsec-tasks-waiting">
            <h2 className={SECTION_LABEL}>Waiting on you{waiting.length ? <span className="ml-1.5 font-mono tabular-nums">{waiting.length}</span> : null}</h2>
            {waiting.length > 0
              ? <ul className="rounded-lg border border-amber-500/50 divide-y">{waiting.map(row)}</ul>
              : <p className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">No deal is waiting on you.</p>}
          </section>

          <section className="space-y-1.5" data-testid="landsec-tasks-todo">
            <h2 className={SECTION_LABEL}>To do{todo.length ? <span className="ml-1.5 font-mono tabular-nums">{todo.length}</span> : null}</h2>
            {!restricted && (
              <form onSubmit={submitNew} className="flex items-center gap-2" data-testid="landsec-task-add">
                <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Add a task of your own" maxLength={500} aria-label="Add a task of your own" className="h-9 text-sm" data-testid="landsec-task-add-input" />
                <Button type="submit" size="sm" variant="outline" className="h-9 shrink-0 gap-1" disabled={!newTitle.trim() || add.isPending} data-testid="landsec-task-add-submit">
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </form>
            )}
            {todo.length > 0
              ? <ul className="rounded-lg border divide-y">{todo.map(row)}</ul>
              : <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">{waiting.length ? "Nothing else to do." : emptyTodo}</p>}
          </section>
        </>
      )}

      {data && view === "done" && (
        <section className="space-y-1.5" data-testid="landsec-tasks-done-list">
          <h2 className={SECTION_LABEL}>Done{done.length ? <span className="ml-1.5 font-mono tabular-nums">{done.length}</span> : null}</h2>
          {done.length > 0
            ? <ul className="rounded-lg border divide-y">{done.map(row)}</ul>
            : <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">Nothing ticked yet.</p>}
        </section>
      )}
    </div>
  );
}
