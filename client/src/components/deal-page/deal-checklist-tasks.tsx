// The deal page's Checklist & tasks section (Woody, 2026-11-18: "the tasks
// list for the deal? Responsibility etc?"): who the deal is waiting on, who is
// responsible for the letting, the deal checklist by stage with who has each
// item, and every other task linked to the deal (user_tasks.linked_deal_id),
// which nothing listed before. The checklist is read as it stands; making
// someone responsible, ticking and adding items stay in the checklist dialog.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Circle, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CHECKLIST_SIDES, CHECKLIST_STAGES } from "@shared/deal-checklist";
import type { DealPageData } from "@shared/deal-page";
import { WaitingLine, WaitingOn, DependsOn, useSaveDealClock } from "@/components/landsec/deal-clock";
import { sectionCard } from "./deal-negotiation";
import { dealPageKey, type LettingDialog } from "./use-deal-page";

const sideLabel = (side: string | null) => CHECKLIST_SIDES.find(s => s.key === side)?.label || null;
const dueText = (d: string | null) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) : null);

export function DealWaitingOn({ dealId, page }: { dealId: string; page: DealPageData }) {
  const save = useSaveDealClock();
  if (!page.viewer.canSetWaiting) {
    return (
      <div className="text-sm">
        <span className="text-muted-foreground">Waiting on </span><WaitingLine clock={page.clock} waitingDays={page.waitingDays} />
        {(page.clock?.dependsOn || page.clock?.dependsOnHidden) && <span className="text-muted-foreground"> · Depends on <span className="text-foreground"><DependsOn clock={page.clock} /></span></span>}
      </div>
    );
  }
  return (
    <WaitingOn clock={page.clock} dealId={dealId} waitingDays={page.waitingDays} schemeDeals={page.otherDeals}
      onSave={patch => save.mutate({ dealId, patch })} saving={save.isPending} testId="deal-waiting" />
  );
}

export function DealChecklistTasks({ dealId, page, onOpen, assignees, canAddTask }: {
  dealId: string; page: DealPageData; onOpen: (d: LettingDialog) => void;
  // BGP colleagues a task may be given to (BGP staff only); empty: the task is the person's own.
  assignees: { id: string; name: string }[];
  canAddTask: boolean;
}) {
  const { toast } = useToast();
  const checklist = page.checklist;
  const letting = page.letting;
  const live = !!letting?.current;
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: dealPageKey(dealId) });
  const addTask = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/tasks", {
      title: title.trim(), linkedDealId: dealId, priority: "medium",
      ...(due ? { dueDate: due } : {}), ...(assignee ? { assigneeUserId: assignee } : {}),
    })).json(),
    onSuccess: () => { setTitle(""); setDue(""); setAssignee(""); setAdding(false); refresh(); queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }); toast({ title: "Task added" }); },
    onError: (e: any) => toast({ title: "The task was not added", description: e?.message, variant: "destructive" }),
  });
  const tick = useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => (await apiRequest("PATCH", `/api/tasks/${id}`, { status: done ? "done" : "todo" })).json(),
    onSettled: () => { refresh(); queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }); },
    onError: (e: any) => toast({ title: "The task was not changed", description: e?.message, variant: "destructive" }),
  });
  const openTasks = page.tasks.filter(t => !t.done);
  const doneTasks = page.tasks.filter(t => t.done);
  return (
    <div className="grid grid-cols-1 gap-3 min-w-0" data-testid="deal-checklist-tasks">
      {page.clock !== null || page.viewer.canSetWaiting ? (
        <div className={sectionCard} data-testid="deal-waiting-card">
          <h3 className="text-sm font-semibold mb-1">What the transaction is waiting on</h3>
          <DealWaitingOn dealId={dealId} page={page} />
        </div>
      ) : null}
      {letting && (
        <div className={sectionCard} data-testid="deal-checklist">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Transaction checklist</h3>
            {checklist && <span className="text-xs text-muted-foreground font-mono tabular-nums">{checklist.summary.done}/{checklist.summary.total} done</span>}
            {checklist && checklist.summary.overdue > 0 && <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{checklist.summary.overdue} overdue</span>}
            {live && <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => onOpen({ to: "checklist" })} data-testid="deal-open-checklist">{checklist ? "Open the checklist" : "Start the checklist"}</Button>}
          </div>
          <p className="mt-1 text-sm" data-testid="deal-checklist-responsible">
            <span className="text-muted-foreground">Responsible for the letting: </span>
            {checklist?.responsibleName ? <>{checklist.responsibleName}{sideLabel(checklist.responsibleSide) ? <span className="text-muted-foreground"> ({sideLabel(checklist.responsibleSide)})</span> : null}</> : <span className="text-muted-foreground italic">nobody yet</span>}
          </p>
          {!checklist ? (
            <p className="mt-2 text-sm text-muted-foreground">{live ? "No checklist yet. Starting it gives the transaction the standard list by stage, each item with someone responsible." : "This letting had no checklist."}</p>
          ) : (
            <div className="mt-2 space-y-2.5">
              {CHECKLIST_STAGES.map(stage => {
                const items = checklist.items.filter(i => i.stage === stage.key);
                if (!items.length) return null;
                return (
                  <div key={stage.key}>
                    <p className={cn("text-[11px] uppercase tracking-wider font-semibold mb-0.5", stage.key === checklist.stage ? "text-foreground" : "text-muted-foreground")}>
                      {stage.label}{stage.key === checklist.stage ? " · now" : ""}
                    </p>
                    <ul className="space-y-0.5">
                      {items.map(i => (
                        <li key={i.id} className="flex items-start gap-2 text-sm" data-testid={`deal-checklist-item-${i.id}`}>
                          {i.done ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                          <span className={cn("min-w-0 flex-1", i.done && "text-muted-foreground line-through")}>
                            {i.label}{i.required && !i.done ? <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">required</span> : null}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground text-right">
                            {i.done ? (i.doneByName ? `done by ${i.doneByName}` : "done") : [i.assigneeName || null, i.dueDate ? <span key="d" className={cn(i.overdue && "font-medium text-amber-700 dark:text-amber-400")}>due {dueText(i.dueDate)}</span> : null].filter(Boolean).reduce<React.ReactNode[]>((acc, x, n) => (n ? [...acc, " · ", x] : [x]), [])}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div className={sectionCard} data-testid="deal-tasks">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Tasks on this transaction</h3>
          <span className="text-xs text-muted-foreground font-mono tabular-nums">{openTasks.length} open</span>
          {canAddTask && !adding && <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => setAdding(true)} data-testid="deal-add-task"><Plus className="w-3 h-3 mr-1" />Add a task</Button>}
        </div>
        {adding && (
          <form className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_12rem_auto] items-end" onSubmit={e => { e.preventDefault(); if (title.trim()) addTask.mutate(); }} data-testid="deal-task-form">
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing" autoFocus className="h-8 text-sm" data-testid="deal-task-title" />
            <Input type="date" value={due} onChange={e => setDue(e.target.value)} className="h-8 text-sm" aria-label="Due date" />
            {assignees.length > 0 ? (
              <select value={assignee} onChange={e => setAssignee(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm" aria-label="Whose task" data-testid="deal-task-assignee">
                <option value="">Me</option>
                {assignees.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            ) : <span className="text-xs text-muted-foreground self-center">On your task list</span>}
            <div className="flex gap-1.5">
              <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setAdding(false)}>Cancel</Button>
              <Button type="submit" size="sm" className="h-8" disabled={!title.trim() || addTask.isPending}>{addTask.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Add</Button>
            </div>
          </form>
        )}
        {page.tasks.length === 0 && !adding && <p className="mt-1 text-sm text-muted-foreground">No other tasks are linked to this transaction.</p>}
        {page.tasks.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {[...openTasks, ...doneTasks].map(t => (
              <li key={t.id} className="flex items-start gap-2 text-sm" data-testid={`deal-task-${t.id}`}>
                {t.mine ? (
                  <button type="button" data-no-min-touch className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border hover:bg-muted" onClick={() => tick.mutate({ id: t.id, done: !t.done })} aria-label={t.done ? "Reopen the task" : "Tick the task"}>
                    {t.done && <Check className="h-3 w-3" />}
                  </button>
                ) : t.done ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className={cn("min-w-0 flex-1", t.done && "text-muted-foreground line-through")}>{t.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground text-right">
                  {[t.mine ? "you" : t.assignee, t.dueDate ? `due ${dueText(t.dueDate)}` : null].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
