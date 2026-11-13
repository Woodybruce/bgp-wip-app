// One item on the deal checklist: the tick, what it is, who is responsible,
// the due date, and (for those who may change the checklist) its actions.
import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Bell, Hourglass, Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ChecklistItem, ChecklistPerson, DealChecklist } from "@shared/deal-checklist";
import { AMBER_TEXT, Chip, EMERALD_TEXT, fmtDate, sideLabel, todayIso } from "./checklist-bits";
import { PeoplePicker } from "./people-picker";

export interface ItemPatch { label?: string; required?: boolean; dueDate?: string | null; note?: string | null }

export function ChecklistItemRow({ item, checklist, quiet, first, last, busy, pickerOpen, editorOpen, onTick, onTogglePicker, onToggleEditor, onAssign, onRemind, onSetWaiting, onSave, onMove, onDelete }: {
  item: ChecklistItem;
  checklist: DealChecklist;
  quiet: boolean;                 // an item in a later stage than the deal's
  first: boolean;
  last: boolean;
  busy: string | null;
  pickerOpen: boolean;
  editorOpen: boolean;
  onTick: (item: ChecklistItem, done: boolean) => void;
  onTogglePicker: (item: ChecklistItem) => void;
  onToggleEditor: (item: ChecklistItem) => void;
  onAssign: (item: ChecklistItem, person: ChecklistPerson | null) => void;
  onRemind: (item: ChecklistItem) => void;
  onSetWaiting: (item: ChecklistItem) => void;
  onSave: (item: ChecklistItem, patch: ItemPatch) => void;
  onMove: (item: ChecklistItem, by: -1 | 1) => void;
  onDelete: (item: ChecklistItem) => void;
}) {
  const { viewer, responsible, people } = checklist;
  const done = !!item.doneAt;
  const canTick = viewer.canEdit || item.mine;
  const overdue = !done && !!item.dueDate && item.dueDate < todayIso();
  const a = item.assignee;
  const assigneeKey = a ? (a.userId ? `user:${a.userId}` : `brief:${a.briefPersonId}`) : null;
  const ticking = busy === `done:${item.id}`;
  // The item the deal is waiting on: set on the deal's clock, or read from
  // this checklist when nobody has set one (derived).
  const w = checklist.waiting && checklist.waiting.itemId === item.id && !done ? checklist.waiting : null;
  const waitingWho = w ? [w.party, w.name].filter(Boolean).join(" · ") : "";
  return (
    <li className="py-2.5" data-testid={`checklist-item-${item.id}`}>
      <div className="flex items-start gap-1">
        {/* The box is 20px; the label around it is the 40px tap target. */}
        <label className={cn("-ml-2.5 -mt-2 flex h-10 w-10 shrink-0 items-center justify-center", canTick ? "cursor-pointer" : "cursor-not-allowed")} title={canTick ? undefined : "Only the person responsible for this item can tick it"}>
          {ticking ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Saving" /> : (
            <Checkbox
              className="h-5 w-5"
              checked={done}
              disabled={!canTick || !!busy}
              onCheckedChange={v => onTick(item, v === true)}
              aria-label={done ? `Mark as not done: ${item.label}` : `Mark as done: ${item.label}`}
              data-testid={`checklist-tick-${item.id}`}
            />
          )}
        </label>
        <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className={cn("min-w-0 break-words", (done || quiet) && "text-muted-foreground")} data-testid={`checklist-label-${item.id}`}>{item.label}</span>
              {item.required && <Chip tone={done ? "neutral" : "ink"} className="px-2 py-[3px] text-[10px]" data-testid={`checklist-required-${item.id}`}>Required</Chip>}
              {w && (
                <Chip
                  tone="amber" className="px-2 py-[3px] text-[10px]" data-testid={`checklist-waiting-${item.id}`}
                  title={w.derived
                    ? `Nobody has set who the deal is waiting on, so it is read from this checklist: the first required item still open${waitingWho ? ` (${waitingWho})` : ""}`
                    : waitingWho ? `The deal's clock says it is waiting on ${waitingWho}` : "The deal's clock points at this item"}
                >
                  The deal is waiting on this{w.days != null ? ` · ${w.days}d` : ""}
                </Chip>
              )}
            </p>
            {item.dueDate && (
              <p className={cn("text-xs tabular-nums", overdue ? `font-medium ${AMBER_TEXT}` : "text-muted-foreground")} data-testid={`checklist-due-${item.id}`}>
                {overdue ? "Overdue" : "Due"} {fmtDate(item.dueDate)}
              </p>
            )}
            {item.note && <p className="text-xs text-muted-foreground break-words whitespace-pre-line" data-testid={`checklist-note-${item.id}`}>{item.note}</p>}
            {done && (
              <p className={cn("text-xs font-medium", EMERALD_TEXT)} data-testid={`checklist-done-by-${item.id}`}>
                Done by {item.doneByName || "someone"} | {fmtDate(item.doneAt)}
              </p>
            )}
            {/* Set on the deal's clock by the people who may write it. Offered
                on the derived one too: pressing it keeps it. */}
            {!done && viewer.canSetWaiting && !(w && !w.derived) && (
              <Button type="button" variant="ghost" size="sm" className="-ml-2 h-7 px-2 text-xs text-muted-foreground" disabled={!!busy} onClick={() => onSetWaiting(item)}
                title="Set this item as what the deal is waiting on. It shows on the deal's clock, with who is responsible for it." data-testid={`checklist-set-waiting-${item.id}`}>
                {busy === `waiting:${item.id}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Hourglass className="mr-1 h-3 w-3" />}Deal is waiting on this
              </Button>
            )}
          </div>
          {/* Who it is with, then what can be done: side by side on a desktop, one under the other on a phone. */}
          <div className="mt-1.5 flex min-w-0 flex-col items-start gap-1.5 sm:mt-0 sm:max-w-[60%] sm:shrink-0 sm:flex-row sm:items-center sm:justify-end">
            {a ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Chip tone="ink" title={item.hasTask ? "It is on their task list" : item.notifiedAt ? `Emailed ${fmtDate(item.notifiedAt)}` : undefined} data-testid={`checklist-assignee-${item.id}`}>
                  {a.name}{a.side ? ` · ${sideLabel(a.side)}` : ""}
                </Chip>
                {item.mine && <span className="text-[11px] text-muted-foreground">You</span>}
              </span>
            ) : !done && (
              <span className="min-w-0 text-xs text-muted-foreground sm:text-right" data-testid={`checklist-unassigned-${item.id}`}>
                {responsible ? `Unassigned: falls to ${responsible.name}` : "Unassigned"}
              </span>
            )}
            {(viewer.canAssign || viewer.canEdit) && (
              <div className="flex shrink-0 items-center gap-1.5">
                {viewer.canAssign && !done && (
                  <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={!!busy} aria-expanded={pickerOpen} onClick={() => onTogglePicker(item)}
                    aria-label={a ? `Change who is responsible for: ${item.label}` : `Make someone responsible for: ${item.label}`} data-testid={`checklist-assign-${item.id}`}>
                    {a ? "Change" : "Make responsible"}
                  </Button>
                )}
                {viewer.canAssign && !done && a && !item.mine && (
                  <Button type="button" variant="ghost" size="sm" className="w-9 shrink-0 px-0 text-muted-foreground" disabled={!!busy} onClick={() => onRemind(item)}
                    title={`Remind ${a.name} by email`} aria-label={`Remind ${a.name} by email about: ${item.label}`} data-testid={`checklist-remind-${item.id}`}>
                    {busy === `remind:${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                  </Button>
                )}
                {viewer.canEdit && (
                  <Button type="button" variant="ghost" size="sm" className="w-9 shrink-0 px-0 text-muted-foreground" disabled={!!busy} aria-expanded={editorOpen} onClick={() => onToggleEditor(item)}
                    title="Edit, move or delete this item" aria-label={`Edit: ${item.label}`} data-testid={`checklist-edit-${item.id}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {pickerOpen && viewer.canAssign && (
        <PeoplePicker
          people={people}
          currentKey={assigneeKey}
          currentName={a?.name || null}
          busy={busy === `assign:${item.id}`}
          onPick={p => onAssign(item, p)}
          onClear={() => onAssign(item, null)}
          onCancel={() => onTogglePicker(item)}
          idPrefix={`checklist-item-${item.id}`}
        />
      )}
      {editorOpen && viewer.canEdit && (
        <ItemEditor
          key={`${item.id}:${item.label}:${item.required}:${item.dueDate}:${item.note}`}
          item={item}
          busy={busy}
          canDelete={!done || (viewer.canDeleteDone ?? viewer.isStaff)}
          first={first}
          last={last}
          onSave={patch => onSave(item, patch)}
          onCancel={() => onToggleEditor(item)}
          onMove={by => onMove(item, by)}
          onDelete={() => onDelete(item)}
        />
      )}
    </li>
  );
}

function ItemEditor({ item, busy, canDelete, first, last, onSave, onCancel, onMove, onDelete }: {
  item: ChecklistItem;
  busy: string | null;
  canDelete: boolean;
  first: boolean;
  last: boolean;
  onSave: (patch: ItemPatch) => void;
  onCancel: () => void;
  onMove: (by: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [required, setRequired] = useState(item.required);
  const [dueDate, setDueDate] = useState(item.dueDate || "");
  const [note, setNote] = useState(item.note || "");
  const id = `checklist-edit-${item.id}`;
  const saving = busy === `save:${item.id}`;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const patch: ItemPatch = {};
    if (label.trim() !== item.label) patch.label = label.trim();
    if (required !== item.required) patch.required = required;
    if ((dueDate || null) !== (item.dueDate || null)) patch.dueDate = dueDate || null;
    if ((note.trim() || null) !== (item.note || null)) patch.note = note.trim() || null;
    onSave(patch);
  };
  return (
    <form onSubmit={submit} className="mt-2 rounded-lg border bg-muted/30 p-2.5 space-y-2.5 min-w-0" data-testid={`${id}-form`}>
      <div className="space-y-1">
        <Label htmlFor={`${id}-label`} className="text-xs">Item</Label>
        <Input id={`${id}-label`} value={label} maxLength={300} onChange={e => setLabel(e.target.value)} className="h-9" data-testid={`${id}-label`} />
      </div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2.5">
        <div className="space-y-1 min-w-0">
          <Label htmlFor={`${id}-due`} className="text-xs">Due date</Label>
          <Input id={`${id}-due`} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-9 w-44 min-w-0 max-w-full" data-testid={`${id}-due`} />
        </div>
        <div className="flex h-9 items-center gap-2">
          <Checkbox id={`${id}-required`} className="h-5 w-5" checked={required} onCheckedChange={v => setRequired(v === true)} data-testid={`${id}-required`} />
          <Label htmlFor={`${id}-required`} className="text-sm font-normal">Required</Label>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-note`} className="text-xs">Note</Label>
        <Textarea id={`${id}-note`} value={note} maxLength={2000} rows={2} onChange={e => setNote(e.target.value)} placeholder="Anything the person responsible should know" data-testid={`${id}-note`} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" className="w-9 px-0" disabled={!!busy || first} onClick={() => onMove(-1)} aria-label="Move up within the stage" data-testid={`${id}-up`}>
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="sm" className="w-9 px-0" disabled={!!busy || last} onClick={() => onMove(1)} aria-label="Move down within the stage" data-testid={`${id}-down`}>
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          {canDelete && (
            <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" disabled={!!busy} onClick={onDelete} data-testid={`${id}-delete`}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />Delete
            </Button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={onCancel} data-testid={`${id}-cancel`}>Cancel</Button>
          <Button type="submit" size="sm" disabled={!!busy || !label.trim()} data-testid={`${id}-save`}>
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Save
          </Button>
        </div>
      </div>
    </form>
  );
}
