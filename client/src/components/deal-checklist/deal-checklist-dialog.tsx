// The deal checklist on a letting (Woody, 2026-11-12): what has to happen at
// each stage, who is responsible for each item and for the deal as a whole,
// and who did what and when. Making someone responsible puts the item on
// their task list and emails them. Routes: server/deal-checklist.ts.
// The item the deal is waiting on is marked, and each open item has "Deal is
// waiting on this" for the people who may set that (Woody, 2026-11-13).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CHECKLIST_STAGES, type ChecklistItem, type ChecklistPerson, type ChecklistStageKey, type DealChecklist,
} from "@shared/deal-checklist";
import { AMBER_TEXT, Chip, MICRO_LABEL, serverMessage, sideLabel, statusOf, type ChecklistWriteResult } from "./checklist-bits";
import { ChecklistItemRow, type ItemPatch } from "./checklist-item-row";
import { PeoplePicker } from "./people-picker";
import { refreshWaitingOn } from "@/components/landsec/deal-clock";

interface ChecklistAnswer { started: boolean; checklist: DealChecklist | null }

// What to tell the person who has just made someone responsible.
function assignedMessage(person: ChecklistPerson, res: ChecklistWriteResult, alreadyDone: boolean): string {
  const reason = res.emailError || "the email service is not available";
  if (res.selfAssigned) return res.taskCreated ? "It is on your task list." : "It shows as yours on the checklist.";
  if (alreadyDone) return `${person.name} is recorded against the item, which is already done.`;
  if (res.taskCreated) return res.emailed
    ? `${person.name} has it on their task list and has been emailed.`
    : `${person.name} has it on their task list. The email could not be sent: ${reason}.`;
  if (res.emailed) return `${person.name} has been emailed.`;
  return person.hasLogin
    ? `The email to ${person.name} could not be sent: ${reason}. Tell them yourself. The item shows as theirs when they open the checklist.`
    : `${person.name} has no login and the email could not be sent: tell them yourself.`;
}

export function DealChecklistDialog({ unit, open, onClose, onChanged }: {
  unit: { id: string; unitName: string; propertyId: string | null } | null;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const unitId = unit?.id || "";
  const queryKey = ["/api/deal-checklists/unit", unitId];
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery<ChecklistAnswer>({ queryKey, enabled: open && !!unitId });
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState<string | null>(null);       // "deal", or the id of the item being given to someone
  const [editing, setEditing] = useState<string | null>(null);     // the id of the item being edited
  const [adding, setAdding] = useState<ChecklistStageKey | null>(null);
  const [stageOpen, setStageOpen] = useState<Partial<Record<ChecklistStageKey, boolean>>>({});

  const seeded = useRef<string | null>(null);

  useEffect(() => {
    setPicker(null); setEditing(null); setAdding(null); setStageOpen({}); setBusy(null);
    seeded.current = null;
  }, [unitId, open]);

  const cl = data?.checklist || null;

  // Which stages start open is decided once, when the checklist is opened
  // and its latest state has been read: an earlier stage with everything
  // done starts closed. After that only a click opens or closes one, so a
  // stage does not fold away under the person ticking its last item.
  useEffect(() => {
    if (!open || !cl || isFetching || seeded.current === cl.id) return;
    seeded.current = cl.id;
    const at = CHECKLIST_STAGES.findIndex(s => s.key === cl.stage);
    const next: Partial<Record<ChecklistStageKey, boolean>> = {};
    CHECKLIST_STAGES.forEach((s, si) => { next[s.key] = si >= at || cl.items.some(i => i.stage === s.key && !i.doneAt); });
    setStageOpen(next);
  }, [open, cl, isFetching]);

  // Every write answers with the fresh checklist, which replaces what is shown.
  const write = async (busyKey: string, failTitle: string, method: string, url: string, body?: unknown): Promise<ChecklistWriteResult | null> => {
    if (busy) return null;
    setBusy(busyKey);
    try {
      const res = await apiRequest(method, url, body);
      const fresh = (await res.json()) as ChecklistWriteResult;
      // A read still in flight was made before this write: drop it, so its
      // older answer cannot land on top of the fresh one.
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<ChecklistAnswer>(queryKey, { started: true, checklist: fresh });
      queryClient.invalidateQueries({ queryKey: ["/api/deal-checklists/summary"] });
      // A tick, a new responsible person or a delete can move who the deal is
      // waiting on: the deal clock and the task lists read it again.
      refreshWaitingOn({ checklists: false });
      onChanged?.();
      return fresh;
    } catch (e) {
      toast({ title: failTitle, description: serverMessage(e, "Try again."), variant: "destructive" });
      if (statusOf(e) === 404 || statusOf(e) === 409) refetch();
      return null;
    } finally {
      setBusy(null);
    }
  };

  const setResponsible = async (person: ChecklistPerson | null) => {
    if (!cl) return;
    const now = cl.responsible;
    if (person && now && (person.userId ? now.userId === person.userId : !now.userId && now.briefPersonId === person.briefPersonId)) { setPicker(null); return; }
    const res = await write("assign:deal", "Not saved", "PUT", `/api/deal-checklists/${cl.id}/responsible`, { personKey: person ? person.key : null });
    if (!res) return;
    setPicker(null);
    if (person) toast({ title: `${person.name} is responsible for the deal`, description: assignedMessage(person, res, false) });
    else toast({ title: "Nobody is responsible for the deal now" });
  };

  const assign = async (item: ChecklistItem, person: ChecklistPerson | null) => {
    const a = item.assignee;
    if (person && a && (person.userId ? a.userId === person.userId : !a.userId && a.briefPersonId === person.briefPersonId)) { setPicker(null); return; }
    const res = await write(`assign:${item.id}`, "Not saved", "PUT", `/api/deal-checklists/items/${item.id}/assignee`, { personKey: person ? person.key : null });
    if (!res) return;
    setPicker(null);
    if (person) toast({ title: `${person.name} is responsible`, description: assignedMessage(person, res, !!item.doneAt) });
    else toast({ title: "Nobody is on this item now", description: a ? `${a.name} has been taken off it.` : undefined });
  };

  const tick = (item: ChecklistItem, done: boolean) => {
    void write(`done:${item.id}`, done ? "Not ticked" : "Not unticked", "POST", `/api/deal-checklists/items/${item.id}/done`, { done });
  };

  const setWaiting = async (item: ChecklistItem) => {
    const res = await write(`waiting:${item.id}`, "Not set", "POST", `/api/deal-checklists/items/${item.id}/waiting`);
    if (!res) return;
    const who = res.waiting?.itemId === item.id ? [res.waiting.party, res.waiting.name].filter(Boolean).join(" · ") : "";
    toast({ title: "The deal is waiting on this item", description: who ? `Waiting on ${who}. It shows on the deal's clock.` : "Nobody is responsible for it yet, so no one is named on the deal's clock." });
  };

  const remind = async (item: ChecklistItem) => {
    const res = await write(`remind:${item.id}`, "Reminder not sent", "POST", `/api/deal-checklists/items/${item.id}/remind`);
    if (!res || !item.assignee) return;
    if (res.emailed) toast({ title: "Reminder sent", description: `${item.assignee.name} has been emailed again.` });
    else toast({ title: "Reminder not sent", description: `The email could not be sent: ${res.emailError || "the email service is not available"}. Tell ${item.assignee.name} yourself.`, variant: "destructive" });
  };

  const save = async (item: ChecklistItem, patch: ItemPatch) => {
    if (Object.keys(patch).length === 0) { setEditing(null); return; }
    const res = await write(`save:${item.id}`, "Not saved", "PATCH", `/api/deal-checklists/items/${item.id}`, patch);
    if (res) setEditing(null);
  };

  const move = (item: ChecklistItem, by: -1 | 1) => {
    if (!cl) return;
    const at = cl.items.filter(i => i.stage === item.stage).findIndex(i => i.id === item.id);
    if (at < 0 || at + by < 0) return;
    void write(`save:${item.id}`, "Not moved", "PATCH", `/api/deal-checklists/items/${item.id}`, { sortOrder: at + by });
  };

  const remove = async (item: ChecklistItem) => {
    const off = item.assignee && item.hasTask && !item.doneAt ? ` It comes off ${item.assignee.name}'s task list.` : "";
    if (!window.confirm(`Delete "${item.label}" from the checklist?${off}`)) return;
    const res = await write(`save:${item.id}`, "Not deleted", "DELETE", `/api/deal-checklists/items/${item.id}`);
    if (res) setEditing(null);
  };

  const addItem = async (stage: ChecklistStageKey, label: string, required: boolean): Promise<boolean> => {
    if (!cl) return false;
    const res = await write(`add:${stage}`, "Not added", "POST", `/api/deal-checklists/${cl.id}/items`, { stage, label, required });
    return !!res;
  };

  const stageIndex = cl ? CHECKLIST_STAGES.findIndex(s => s.key === cl.stage) : 0;
  const stageLabel = cl ? CHECKLIST_STAGES[stageIndex]?.label || "" : "";
  const described = cl
    ? [cl.unit.propertyName, cl.unit.dealRef ? `Ref #${cl.unit.dealRef}` : "No deal ref", stageLabel].filter(Boolean).join(" · ")
    : "What has to happen at each stage of the letting, and who is responsible.";
  const r = cl?.responsible || null;
  const responsibleKey = r ? (r.userId ? `user:${r.userId}` : `brief:${r.briefPersonId}`) : null;

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent
        className="max-w-3xl w-screen h-[100dvh] max-h-[100dvh] content-start overflow-y-auto overflow-x-hidden p-4 sm:p-6 sm:w-full sm:h-auto sm:max-h-[90vh]"
        data-testid="checklist-dialog"
      >
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="break-words" data-testid="checklist-title">Deal checklist: {cl?.unit.unitName || unit?.unitName || "Unit"}</DialogTitle>
          <DialogDescription data-testid="checklist-description">{described}</DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3" data-testid="checklist-loading">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {isError && !data && (
          <div className="space-y-2" data-testid="checklist-error">
            <p className="text-sm">{serverMessage(error, "The checklist could not be loaded.")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()} data-testid="checklist-retry">Try again</Button>
          </div>
        )}

        {data && !cl && (
          <p className="text-sm text-muted-foreground" data-testid="checklist-not-started">
            The checklist for this letting has not been started yet. It starts the first time one of the agents or the client opens it.
          </p>
        )}

        {cl && (
          <div className="space-y-4 min-w-0">
            <section className="rounded-lg border p-3" data-testid="checklist-responsible">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1 basis-56 space-y-1">
                  <p className={MICRO_LABEL}>Responsible for the deal</p>
                  {r ? (
                    <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium" data-testid="checklist-responsible-name">
                      <span className="min-w-0 break-words">{r.name}</span>
                      {r.side && <Chip tone="ink" data-testid="checklist-responsible-side">{sideLabel(r.side)}</Chip>}
                    </p>
                  ) : (
                    <p className={cn("text-sm", AMBER_TEXT)} data-testid="checklist-responsible-none">
                      Nobody is responsible for this deal yet.{cl.viewer.canAssign ? " Choose someone so open items have an owner." : ""}
                    </p>
                  )}
                </div>
                {cl.viewer.canAssign && (
                  <Button type="button" variant="outline" size="sm" disabled={!!busy} aria-expanded={picker === "deal"} onClick={() => setPicker(picker === "deal" ? null : "deal")}
                    aria-label={r ? "Change who is responsible for the deal" : "Choose who is responsible for the deal"} data-testid="checklist-responsible-change">
                    {r ? "Change" : "Choose someone"}
                  </Button>
                )}
              </div>
              {picker === "deal" && cl.viewer.canAssign && (
                <PeoplePicker
                  people={cl.people}
                  currentKey={responsibleKey}
                  currentName={r?.name || null}
                  busy={busy === "assign:deal"}
                  onPick={setResponsible}
                  onClear={() => setResponsible(null)}
                  onCancel={() => setPicker(null)}
                  idPrefix="checklist-deal"
                />
              )}
            </section>

            <div className="space-y-0.5">
              <p className="text-sm tabular-nums" data-testid="checklist-summary">
                {cl.summary.done} of {cl.summary.total} done
                {cl.summary.requiredOpen > 0 && <span className={AMBER_TEXT}> · {cl.summary.requiredOpen} required still open at this stage</span>}
                {cl.summary.overdue > 0 && <span className={AMBER_TEXT}> · {cl.summary.overdue} overdue</span>}
              </p>
              {!cl.viewer.canEdit && (
                <p className="text-xs text-muted-foreground" data-testid="checklist-read-only">You can read this checklist and tick the items you are responsible for.</p>
              )}
            </div>

            {CHECKLIST_STAGES.map((s, si) => {
              const items = cl.items.filter(i => i.stage === s.key);
              const doneCount = items.filter(i => i.doneAt).length;
              const current = si === stageIndex;
              const later = si > stageIndex;
              const isOpen = stageOpen[s.key] ?? true;
              return (
                <section key={s.key} className="rounded-lg border" data-testid={`checklist-stage-${s.key}`}>
                  <h3>
                    <button type="button" className="flex w-full items-center gap-2 px-3 py-2.5 text-left" aria-expanded={isOpen}
                      onClick={() => setStageOpen(o => ({ ...o, [s.key]: !isOpen }))} data-testid={`checklist-stage-toggle-${s.key}`}>
                      <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !isOpen && "-rotate-90")} />
                      <span className={cn("text-sm font-semibold", later && "text-muted-foreground")}>{s.label}</span>
                      {current && <Chip tone="ink" data-testid="checklist-current-stage">Current stage</Chip>}
                      <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground" data-testid={`checklist-stage-count-${s.key}`}>
                        {items.length === 0 ? "No items" : `${doneCount} of ${items.length} done`}
                      </span>
                    </button>
                  </h3>
                  {isOpen && (
                    <div className="border-t px-3">
                      {items.length > 0 && (
                        <ul className="divide-y">
                          {items.map((item, n) => (
                            <ChecklistItemRow
                              key={item.id}
                              item={item}
                              checklist={cl}
                              quiet={later}
                              first={n === 0}
                              last={n === items.length - 1}
                              busy={busy}
                              pickerOpen={picker === item.id}
                              editorOpen={editing === item.id}
                              onTick={tick}
                              onTogglePicker={i => { setEditing(null); setPicker(picker === i.id ? null : i.id); }}
                              onToggleEditor={i => { setPicker(null); setEditing(editing === i.id ? null : i.id); }}
                              onAssign={assign}
                              onRemind={remind}
                              onSetWaiting={setWaiting}
                              onSave={save}
                              onMove={move}
                              onDelete={remove}
                            />
                          ))}
                        </ul>
                      )}
                      {items.length === 0 && !cl.viewer.canEdit && <p className="py-2.5 text-sm text-muted-foreground">Nothing at this stage.</p>}
                      {cl.viewer.canEdit && (
                        <div className={cn("py-2", items.length > 0 && "border-t")}>
                          {adding === s.key ? (
                            <AddItemForm stage={s.key} busy={busy === `add:${s.key}`} onAdd={(label, required) => addItem(s.key, label, required)} onClose={() => setAdding(null)} />
                          ) : (
                            <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground" disabled={!!busy} onClick={() => setAdding(s.key)} data-testid={`checklist-add-${s.key}`}>
                              <Plus className="mr-1 h-3.5 w-3.5" />Add an item
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}

            {cl.templateName && <p className="text-xs text-muted-foreground" data-testid="checklist-template">Started from the {cl.templateName.toLowerCase().startsWith("standard") ? "standard letting checklist" : cl.templateName}.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddItemForm({ stage, busy, onAdd, onClose }: {
  stage: ChecklistStageKey;
  busy: boolean;
  onAdd: (label: string, required: boolean) => Promise<boolean>;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [required, setRequired] = useState(false);
  const id = `checklist-add-${stage}`;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim() || busy) return;
    // Stays open for the next one.
    if (await onAdd(label.trim(), required)) { setLabel(""); setRequired(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-2" data-testid={`${id}-form`}>
      <Label htmlFor={`${id}-label`} className="text-xs">New item</Label>
      <Input id={`${id}-label`} autoFocus value={label} maxLength={300} onChange={e => setLabel(e.target.value)} placeholder="What has to be done" className="h-9" data-testid={`${id}-label`} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 items-center gap-2">
          <Checkbox id={`${id}-required`} className="h-5 w-5" checked={required} onCheckedChange={v => setRequired(v === true)} data-testid={`${id}-required`} />
          <Label htmlFor={`${id}-required`} className="text-sm font-normal">Required</Label>
        </div>
        <span className="flex-1" />
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose} data-testid={`${id}-cancel`}>Close</Button>
        <Button type="submit" size="sm" disabled={busy || !label.trim()} data-testid={`${id}-save`}>
          {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Add item
        </Button>
      </div>
    </form>
  );
}
