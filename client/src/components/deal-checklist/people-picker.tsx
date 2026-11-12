// Pick who is responsible: a searchable list of the people who can be,
// grouped BGP / Client / Joint agent. Rendered inline under the row (a
// portal Popover inside the Dialog does not take clicks reliably).
import { useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CHECKLIST_SIDES, type ChecklistPerson } from "@shared/deal-checklist";
import { MICRO_LABEL } from "./checklist-bits";

const LIST_LIMIT = 60;

export function PeoplePicker({ people, currentKey, currentName, busy, onPick, onClear, onCancel, idPrefix }: {
  people: ChecklistPerson[];
  currentKey: string | null;      // who is on it now
  currentName: string | null;
  busy: boolean;
  onPick: (person: ChecklistPerson) => void;
  onClear: () => void;
  onCancel: () => void;
  idPrefix: string;               // for test ids: "checklist-deal" or "checklist-item-<id>"
}) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const matches = q ? people.filter(p => `${p.name} ${p.role || ""} ${p.email || ""}`.toLowerCase().includes(q)) : people;
  const shown = matches.slice(0, LIST_LIMIT);
  return (
    <div className="mt-2 rounded-lg border bg-muted/30 p-2.5 space-y-2 min-w-0" data-testid={`${idPrefix}-picker`}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name"
          aria-label="Search the people who can be made responsible"
          className="h-9 pl-8"
          data-testid={`${idPrefix}-picker-search`}
        />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border bg-background" role="listbox" aria-label="People who can be made responsible">
        {people.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground" data-testid={`${idPrefix}-picker-empty`}>There is no one to choose yet. Add the people involved on the unit's Targeting Brief.</p>
        )}
        {people.length > 0 && shown.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground" data-testid={`${idPrefix}-picker-none`}>No one matches. Someone who is not listed can be added on the unit's Targeting Brief.</p>
        )}
        {CHECKLIST_SIDES.map(side => {
          const rows = shown.filter(p => p.side === side.key);
          if (rows.length === 0) return null;
          return (
            <div key={side.key} data-testid={`${idPrefix}-picker-group-${side.key}`}>
              <p className={`${MICRO_LABEL} sticky top-0 border-b bg-background px-2.5 py-1.5`}>{side.label}</p>
              {rows.map(p => {
                const current = p.key === currentKey;
                const detail = [p.role, p.hasLogin ? null : "No login: emailed only"].filter(Boolean).join(" · ");
                return (
                  <button
                    key={p.key}
                    type="button"
                    role="option"
                    aria-selected={current}
                    disabled={busy}
                    onClick={() => onPick(p)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted disabled:opacity-60"
                    data-testid={`${idPrefix}-pick-${p.key}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{p.name}</span>
                      {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
                    </span>
                    {current && <Check className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Responsible now" />}
                  </button>
                );
              })}
            </div>
          );
        })}
        {matches.length > shown.length && (
          <p className="border-t p-2.5 text-xs text-muted-foreground">Showing the first {shown.length} of {matches.length}. Search to narrow the list.</p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Saving" />}
        {currentKey && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClear} data-testid={`${idPrefix}-picker-clear`}>
            Take {currentName || "them"} off
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel} data-testid={`${idPrefix}-picker-cancel`}>Cancel</Button>
      </div>
    </div>
  );
}
