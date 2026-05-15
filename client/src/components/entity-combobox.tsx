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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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

  const selected = React.useMemo(
    () => items.find((it) => it.id === value) ?? null,
    [items, value]
  );

  const triggerLabel = selected?.label
    ?? (value && !loading ? value : placeholder);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid={testId}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate text-left">
            {triggerLabel}
            {selected?.subLabel && (
              <span className="ml-2 text-xs text-muted-foreground">
                {selected.subLabel}
              </span>
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
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[--radix-popover-trigger-width] min-w-[280px]"
        align="start"
      >
        <Command shouldFilter={true}>
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
      </PopoverContent>
    </Popover>
  );
}
