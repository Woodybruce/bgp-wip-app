// A joint agent's task list (Woody, 2026-11-12: joint agents have full
// control of the letting work on their instructed schemes). The tasks are
// the ones the letting work makes for them: an item they are responsible
// for on a deal checklist, or a viewing to follow up. Each opens where the
// work is; ticking one here ticks it there. The server sends only their own
// tasks at their own schemes (GET /api/tasks), and takes a tick and nothing
// else (PATCH /api/tasks/:id).
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check, ChevronRight } from "lucide-react";
import { Pill, PillCount } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface LandsecTask {
  id: string; title: string; description: string | null; due_date: string | null; priority: string | null; status: string;
  category: string | null; created_at: string | null; completed_at: string | null; assigned_by_name: string | null;
  kind?: "deal_checklist" | "viewing_followup" | "task"; unit_id?: string | null; unit_name?: string | null;
  property_name?: string | null; link?: string | null;
}

const KIND_LABEL: Record<string, string> = { deal_checklist: "Deal checklist", viewing_followup: "Viewing" };
const LINK_LABEL: Record<string, string> = { deal_checklist: "Open the checklist", viewing_followup: "Open viewings" };

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

export default function LandsecTasks() {
  const { toast } = useToast();
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const jointAgent = me?.landsecRole === "joint_agent";
  const { data, isLoading, error } = useQuery<LandsecTask[]>({ queryKey: ["/api/tasks"], enabled: jointAgent, staleTime: 30 * 1000 });
  const [view, setView] = useState<"open" | "done">("open");

  const tick = useMutation({
    mutationFn: async (v: { id: string; status: "done" | "todo" }) => (await apiRequest("PATCH", `/api/tasks/${v.id}`, { status: v.status })).json(),
    onMutate: async v => {
      await queryClient.cancelQueries({ queryKey: ["/api/tasks"] });
      const before = queryClient.getQueryData<LandsecTask[]>(["/api/tasks"]);
      queryClient.setQueryData<LandsecTask[]>(["/api/tasks"], old => (old || []).map(t => (t.id === v.id ? { ...t, status: v.status, completed_at: v.status === "done" ? new Date().toISOString() : null } : t)));
      return { before };
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.before) queryClient.setQueryData(["/api/tasks"], ctx.before);
      toast({ title: "Not saved", description: e?.message, variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      // The checklist item follows its task.
      queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0] || "").startsWith("/api/deal-checklists") });
    },
  });

  const tasks = Array.isArray(data) ? data : [];
  const open = useMemo(() => tasks.filter(t => t.status !== "done"), [tasks]);
  const done = useMemo(() => tasks.filter(t => t.status === "done").sort((a, b) => String(b.completed_at || "").localeCompare(String(a.completed_at || ""))), [tasks]);
  const overdue = open.filter(isOverdue).length;
  const rows = view === "open" ? open : done;

  if (me && !jointAgent) {
    const restricted = !!me.landsecRole && me.landsecRole !== "leasing_manager";
    return (
      <div className="p-4 md:p-6 space-y-2" data-testid="landsec-tasks">
        <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          This is the task list for a joint agent login.{" "}
          {!restricted && <Link href="/tasks" className="underline hover:text-foreground">Your own tasks are on the Tasks page.</Link>}
        </p>
      </div>
    );
  }
  if (error) return <div className="p-4 md:p-6"><p className="text-sm text-muted-foreground">Your tasks could not be loaded. {(error as any)?.message || ""}</p></div>;

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="landsec-tasks">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {data ? `${open.length} to do${overdue ? ` · ${overdue} overdue` : ""} · ${done.length} done` : "What you are responsible for on the lettings at your schemes"}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Pill active={view === "open"} onClick={() => setView("open")} data-testid="landsec-tasks-open">To do <PillCount n={open.length} active={view === "open"} /></Pill>
        <Pill active={view === "done"} onClick={() => setView("done")} data-testid="landsec-tasks-done">Done <PillCount n={done.length} active={view === "done"} /></Pill>
      </div>

      {(isLoading || !me) && <Skeleton className="h-40 rounded-lg" />}

      {data && rows.length === 0 && (
        <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">
          {view === "open"
            ? "Nothing to do. When you are made responsible for an item on a deal checklist, or a viewing needs following up, it appears here."
            : "Nothing ticked yet."}
        </p>
      )}

      {data && rows.length > 0 && (
        <ul className="rounded-lg border divide-y">
          {rows.map(t => {
            const isDone = t.status === "done";
            const late = isOverdue(t);
            const where = [t.property_name, t.unit_name].filter(Boolean).join(" · ");
            const due = day(t.due_date);
            const kind = t.kind && KIND_LABEL[t.kind];
            return (
              <li key={t.id} className="flex items-start gap-3 p-3" data-testid={`landsec-task-${t.id}`}>
                <button
                  type="button"
                  data-no-min-touch
                  aria-label={isDone ? "Mark as not done" : "Mark as done"}
                  title={isDone ? "Mark as not done" : "Mark as done"}
                  disabled={tick.isPending}
                  onClick={() => tick.mutate({ id: t.id, status: isDone ? "todo" : "done" })}
                  className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border flex items-center justify-center transition-colors ${isDone ? "bg-foreground text-background border-transparent" : "border-border hover:border-foreground"}`}
                  data-testid={`landsec-task-tick-${t.id}`}
                >
                  {isDone && <Check className="w-3 h-3" />}
                </button>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}>{t.title}</p>
                  {where && <p className="text-xs text-muted-foreground truncate">{where}</p>}
                  {t.description && <p className="text-xs text-muted-foreground whitespace-pre-line">{t.description}</p>}
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {kind && <span className="rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide">{kind}</span>}
                    {t.kind === "deal_checklist" && t.priority === "high" ? <span className="rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide">Required</span> : null}
                    {isDone
                      ? <span>Done {day(t.completed_at) || ""}</span>
                      : due && <span className={late ? "font-semibold text-red-700 dark:text-red-400" : ""}>{late ? "Overdue, was due" : "Due"} {due}</span>}
                    {t.assigned_by_name && <span>Asked by {t.assigned_by_name}</span>}
                  </p>
                </div>
                {t.link && (
                  <Link href={t.link} className="shrink-0 inline-flex items-center gap-0.5 text-xs font-medium hover:underline whitespace-nowrap" data-testid={`landsec-task-open-${t.id}`}>
                    {(t.kind && LINK_LABEL[t.kind]) || "Open"} <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
