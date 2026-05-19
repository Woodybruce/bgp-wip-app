import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type EntityComboboxItem = {
  id: string;
  label: string;
  subLabel?: string;
  keywords?: string[];
};

interface EntityComboboxProps {
  items: EntityComboboxItem[];
  value: string | null | undefined;
  onChange: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  allowClear?: boolean;
  loading?: boolean;
  className?: string;
  testId?: string;
}

// Inline combobox — renders the cmdk Command list directly under the trigger
// rather than via a Popover/Portal. This is the right shape inside Dialogs:
// Radix Dialog applies aria-hidden + focus traps to sibling portals, which
// silently breaks Popover-wrapped inputs (the user couldn't focus or scroll
// the dropdown). Inline rendering keeps the dropdown inside the Dialog's
// own DOM subtree, sidestepping the issue entirely.
export function EntityCombobox({
  items,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Type to search…",
  emptyText = "No matches.",
  disabled = false,
  allowClear = true,
  loading = false,
  className,
  testId,
}: EntityComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const selected = React.useMemo(
    () => items.find((it) => it.id === value) ?? null,
    [items, value]
  );

  // Close when clicking outside the trigger + dropdown
  React.useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open]);

  // Close on Escape
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const triggerLabel = selected?.label ?? (value && !loading ? value : placeholder);

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
        className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground")}
      >
        <span className="truncate text-left">
          {triggerLabel}
          {selected?.subLabel && (
            <span className="ml-2 text-xs text-muted-foreground">{selected.subLabel}</span>
          )}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {allowClear && selected && !disabled && (
            <X
              className="h-4 w-4 opacity-50 hover:opacity-100"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange("");
              }}
            />
          )}
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </div>
      </Button>

      {open && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover text-popover-foreground shadow-md min-w-[280px] overflow-hidden"
          // Stop pointerdown from bubbling so the doc-level handler doesn't
          // close the panel mid-interaction with the input or scrollbar.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Command
            // Custom filter — cmdk's default fuzzy match was scoring
            // unrelated items (typing "brent" into a property picker
            // returned "Glasgow", "Brushfield Street" etc. because of
            // letter-distance scoring across the keywords + label
            // string). Substring match on label + keywords is what
            // the team actually expect, with prefix matches ranked
            // first so "brent" → "Brent Cross" lands at the top.
            filter={(value, search) => {
              if (!search) return 1;
              const v = value.toLowerCase();
              const s = search.toLowerCase().trim();
              if (!s) return 1;
              if (v.startsWith(s)) return 2;
              if (v.includes(` ${s}`)) return 1.5;  // word-start match
              if (v.includes(s)) return 1;
              return 0;
            }}
          >
            <CommandInput placeholder={searchPlaceholder} autoFocus />
            <CommandList>
              <CommandEmpty>{loading ? "Loading…" : emptyText}</CommandEmpty>
              <CommandGroup>
                {items.map((it) => {
                  const cleanKeywords = (it.keywords ?? []).filter(
                    (k) => typeof k === "string" && k.length > 0
                  );
                  return (
                    <CommandItem
                      key={it.id}
                      value={`${it.label} ${cleanKeywords.join(" ")}`.trim()}
                      onSelect={() => {
                        onChange(it.id);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "h-4 w-4",
                          value === it.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{it.label}</span>
                        {it.subLabel && (
                          <span className="text-xs text-muted-foreground truncate">
                            {it.subLabel}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  );
}
