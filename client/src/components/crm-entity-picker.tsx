// Unified CRM entity picker used everywhere across the app where the
// user needs to link a row to a CRM company, contact, property, or
// other entity. Replaces the patchwork of Inline*Picker / EntityCombobox
// / *Combobox variants — same affordance, same shortcuts, same look:
//
//   ┌──────────────────────────────────┐
//   │ Search brands…                   │
//   ├──────────────────────────────────┤
//   │ 🏢 Bluewater (Landlord)          │
//   │ 🏢 Brookfield Properties         │
//   │ 🏢 British Land (REIT)           │
//   ├──────────────────────────────────┤
//   │ + Create brand "Buchanan Galleries" │  ← shows when no exact match
//   ├──────────────────────────────────┤
//   │ ✕ Clear                          │  ← only when value is set
//   └──────────────────────────────────┘
//
// Single-select OR multi-select via the `multi` prop. When `onCreate` is
// supplied, the picker shows the green "Create" row if the typed text
// doesn't match anything; without it, the picker is pure search.
//
// z-[60] keeps the dropdown above sticky table headers + ChatBGP dock.

import { useState, useRef, useEffect, useMemo } from "react";
import { Building2, X, Plus, Loader2, User, MapPin } from "lucide-react";
import { useMutation } from "@tanstack/react-query";

export type CrmEntityKind = "company" | "contact" | "property";

export interface CrmEntityOption {
  id: string;
  name: string;
  /** Optional short label shown to the right (e.g. company type, role). */
  meta?: string | null;
}

interface CrmEntityPickerProps {
  /** Current value — id for single-select, ids array for multi-select. */
  value: string | string[] | null | undefined;
  /** Display name for the current value (single-select only). */
  valueName?: string | null;
  /** All available options to search through. */
  options: CrmEntityOption[];
  /** Called when the user picks an existing option. */
  onSelect: (option: CrmEntityOption) => void;
  /** Called when the user clears the value (single-select only). */
  onClear?: () => void;
  /**
   * If supplied, shows a green "Create '<typed name>'" row at the bottom
   * of the dropdown when the search has no exact match. Must POST the
   * new row to the CRM, then return the new option so the picker can
   * select it. Throw on failure — the picker catches and toasts.
   */
  onCreate?: (name: string) => Promise<CrmEntityOption>;
  /** Visual flavour — picks icon + create-button copy. */
  kind?: CrmEntityKind;
  /** Multi-select mode — value is an array, onSelect adds, removes via X. */
  multi?: boolean;
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
  /** Placeholder shown on the closed-state button when value is empty. */
  emptyLabel?: string;
  /** Optional className for the closed-state button. */
  className?: string;
  /** Data-testid prefix so each instance gets its own selectors. */
  testIdPrefix?: string;
  /** Width of the dropdown panel. */
  panelWidth?: number;
  /** Limit how many options are shown in the dropdown. Default 12. */
  matchLimit?: number;
  /** Disable opening the picker — read-only state. */
  disabled?: boolean;
  /**
   * Skip the closed-state trigger button and render the input +
   * dropdown directly. Use when the parent provides its own
   * trigger (e.g. an inline cell that opens on click).
   */
  alwaysOpen?: boolean;
}

function iconFor(kind: CrmEntityKind) {
  switch (kind) {
    case "contact": return User;
    case "property": return MapPin;
    default: return Building2;
  }
}

function createLabelFor(kind: CrmEntityKind) {
  switch (kind) {
    case "contact": return "Create contact";
    case "property": return "Create property";
    default: return "Create brand";
  }
}

export function CrmEntityPicker({
  value,
  valueName,
  options,
  onSelect,
  onClear,
  onCreate,
  kind = "company",
  multi = false,
  searchPlaceholder = "Search…",
  emptyLabel = "Set value",
  className = "",
  testIdPrefix = "crm-entity-picker",
  panelWidth = 280,
  matchLimit = 12,
  disabled = false,
  alwaysOpen = false,
}: CrmEntityPickerProps) {
  const [open, setOpen] = useState(alwaysOpen);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const Icon = iconFor(kind);

  const selectedIds = useMemo<string[]>(() => {
    if (multi) return Array.isArray(value) ? value : [];
    return value ? [String(value)] : [];
  }, [value, multi]);

  const selectedOptions = useMemo(
    () => selectedIds.map(id => options.find(o => o.id === id)).filter(Boolean) as CrmEntityOption[],
    [selectedIds, options],
  );

  const matches = useMemo(() => {
    const s = search.trim().toLowerCase();
    const remaining = options.filter(o => !selectedIds.includes(o.id));
    if (!s) return remaining.slice(0, matchLimit);
    return remaining
      .filter(o => o.name.toLowerCase().includes(s))
      .slice(0, matchLimit);
  }, [options, search, selectedIds, matchLimit]);

  const exactMatch = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return undefined;
    return options.find(o => o.name.toLowerCase() === s);
  }, [options, search]);

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!onCreate) throw new Error("create not configured");
      return onCreate(name);
    },
    onSuccess: (opt) => {
      onSelect(opt);
      setSearch("");
      if (!multi) setOpen(false);
    },
  });

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
      searchRef.current.select();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const pick = (opt: CrmEntityOption) => {
    onSelect(opt);
    setSearch("");
    if (!multi) setOpen(false);
  };

  if (!open && !alwaysOpen) {
    // Closed state. Multi-select shows selected chips inline; single-select
    // shows the name or a placeholder.
    return (
      <button
        type="button"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        className={`w-full text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1 py-0.5 -mx-1 flex items-center gap-1 flex-wrap min-h-[20px] ${className}`}
        data-testid={`${testIdPrefix}-trigger`}
      >
        {multi && selectedOptions.length > 0 ? (
          selectedOptions.map(o => (
            <span key={o.id} className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0 text-[10px] border border-teal-300 text-teal-700 bg-teal-50 dark:bg-teal-950/30 dark:text-teal-300">
              {o.name}
            </span>
          ))
        ) : !multi && (valueName || selectedOptions[0]?.name) ? (
          <span className="truncate">{valueName || selectedOptions[0]?.name}</span>
        ) : (
          <span className="text-gray-400 italic">{emptyLabel}</span>
        )}
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={searchRef}
        value={search}
        onChange={e => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); setSearch(""); }
          if (e.key === "Enter") {
            if (exactMatch) pick(exactMatch);
            else if (onCreate && search.trim()) createMutation.mutate(search.trim());
          }
        }}
        placeholder={searchPlaceholder}
        className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-indigo-400"
        data-testid={`${testIdPrefix}-search`}
      />
      <div
        className="absolute z-[60] mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl ring-1 ring-black/5 left-0 max-h-[280px] overflow-y-auto"
        style={{ width: panelWidth }}
      >
        {/* Selected chips (multi-select) at top with remove buttons */}
        {multi && selectedOptions.length > 0 && (
          <div className="flex flex-wrap gap-1 p-1.5 border-b">
            {selectedOptions.map(o => (
              <span
                key={o.id}
                className="inline-flex items-center gap-0.5 rounded-full pl-1.5 pr-0.5 py-0 text-[10px] border border-teal-300 text-teal-700 bg-teal-50"
              >
                {o.name}
                <button
                  type="button"
                  onClick={() => onSelect(o) /* parent should detect already-selected and toggle off */}
                  className="hover:text-red-500 ml-0.5 p-0.5"
                  data-testid={`${testIdPrefix}-remove-${o.id}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        {matches.length === 0 && !search.trim() && !multi && (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">Type to search the CRM…</div>
        )}
        {matches.map(o => (
          <button
            key={o.id}
            type="button"
            onClick={() => pick(o)}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 dark:hover:bg-indigo-950/40 flex items-center gap-2"
            data-testid={`${testIdPrefix}-option-${o.id}`}
          >
            <Icon className="w-3 h-3 text-gray-400 shrink-0" />
            <span className="truncate flex-1 min-w-0">{o.name}</span>
            {o.meta && <span className="text-[9px] text-gray-400 shrink-0">{o.meta}</span>}
          </button>
        ))}
        {onCreate && search.trim() && !exactMatch && (
          <button
            type="button"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate(search.trim())}
            className="w-full text-left px-3 py-2 text-xs border-t bg-emerald-50/60 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-medium"
            data-testid={`${testIdPrefix}-create`}
          >
            {createMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            {createLabelFor(kind)} "{search.trim()}"
          </button>
        )}
        {!multi && onClear && (selectedOptions.length > 0 || valueName) && (
          <button
            type="button"
            onClick={() => { onClear(); setOpen(false); setSearch(""); }}
            className="w-full text-left px-3 py-1.5 text-xs border-t hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-2 text-red-600"
            data-testid={`${testIdPrefix}-clear`}
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
