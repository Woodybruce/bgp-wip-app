// Search-and-pick a brand from the CRM company list. Used everywhere a
// target operator is typed in (Operator Targeting Brief, strategy-board
// targets, Letting Tracker inline add) so targets carry a company_id link
// back to the brand list instead of a free-text name. Picking a CRM brand
// links it and reports its brand category; `allowCreate` offers "add to
// brand list" for names we don't have (staff only — the companies POST is
// staff-gated); "use as typed" falls back to an unlinked name (the server
// still auto-links an exact name match at insert time).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Link2Off, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface BrandPick {
  name: string;
  companyId: string | null;
  companyType?: string | null;
}

export function BrandSearchInput({ value, companyId, onPick, placeholder = "Search brands…", className = "", testId, allowCreate = false, iconOnly = false, inline = false }: {
  value: string;
  companyId?: string | null;
  onPick: (pick: BrandPick) => void;
  placeholder?: string;
  className?: string;
  testId?: string;
  allowCreate?: boolean;
  /** Render just a small + button as the trigger — for tight table cells. */
  iconOnly?: boolean;
  /** Render the dropdown inline (no Popover portal) — required inside Radix Dialogs. */
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Inline mode manages its own dismissal (no Popover doing it for us).
  useEffect(() => {
    if (!inline || !open) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [inline, open]);

  // Same key + shape as the leasing-schedule page's basic company cache,
  // so the two share one fetch.
  const { data: companies = [] } = useQuery<Array<{ id: string; name: string; companyType: string | null }>>({
    queryKey: ["/api/crm/companies-basic"],
    queryFn: async () => {
      const r = await fetch("/api/crm/companies?limit=5000", { headers: getAuthHeaders() });
      if (!r.ok) return [];
      const d = await r.json();
      const arr = Array.isArray(d) ? d : (d.companies || []);
      return arr.map((c: any) => ({ id: String(c.id), name: c.name, companyType: c.companyType ?? c.company_type ?? null }));
    },
    staleTime: 120000,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies.slice(0, 50);
    return companies.filter(c => (c.name || "").toLowerCase().includes(q)).slice(0, 50);
  }, [companies, query]);

  const exactMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? companies.some(c => (c.name || "").toLowerCase() === q) : false;
  }, [companies, query]);

  const pick = (p: BrandPick) => {
    onPick(p);
    setOpen(false);
    setQuery("");
  };

  const createBrand = async (name: string) => {
    setCreating(true);
    try {
      const r = await apiRequest("POST", "/api/crm/companies", { name });
      const created = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies-basic"] });
      toast({ title: "Brand created", description: `${created.name} added to the brand list.` });
      pick({ name: created.name, companyId: String(created.id), companyType: created.companyType ?? null });
    } catch (e: any) {
      toast({ title: "Couldn't create brand", description: e?.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const trigger = iconOnly ? (
    <button
      type="button"
      className={`inline-flex items-center justify-center h-5 w-5 rounded border border-dashed border-muted-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground/60 shrink-0 ${className}`}
      title={placeholder}
      data-testid={testId || "brand-search-input"}
      {...(inline ? { onClick: () => setOpen(o => !o) } : {})}
    >
      <Plus className="h-3 w-3" />
    </button>
  ) : (
    <button
      type="button"
      className={`flex h-8 items-center justify-between gap-1 rounded-md border border-input bg-background px-2 text-xs ring-offset-background hover:bg-muted/40 ${className}`}
      data-testid={testId || "brand-search-input"}
      {...(inline ? { onClick: () => setOpen(o => !o) } : {})}
    >
      <span className={`truncate ${value ? "" : "text-muted-foreground"}`}>
        {value || placeholder}
      </span>
      <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
    </button>
  );

  const commandPanel = (
    <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            autoFocus
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[240px]">
            <CommandEmpty>No brands match.</CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup heading="Brand list">
                {filtered.map(c => (
                  <CommandItem
                    key={c.id}
                    onSelect={() => pick({ name: c.name, companyId: c.id, companyType: c.companyType })}
                  >
                    <Check className={`mr-2 h-3.5 w-3.5 ${companyId === c.id ? "opacity-100" : "opacity-0"}`} />
                    <span className="truncate">{c.name}</span>
                    {c.companyType && <span className="ml-auto pl-2 text-[10px] text-muted-foreground truncate max-w-[110px]">{c.companyType.replace(/^Tenant - /, "")}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {query.trim() && !exactMatch && (
              <CommandGroup heading="Not in the brand list">
                {allowCreate && (
                  <CommandItem disabled={creating} onSelect={() => createBrand(query.trim())}>
                    <Plus className="mr-2 h-3.5 w-3.5" />
                    {creating ? "Creating…" : `Add "${query.trim()}" to the brand list`}
                  </CommandItem>
                )}
                <CommandItem
                  onSelect={() => pick({ name: query.trim(), companyId: null })}
                >
                  <Link2Off className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                  Use "{query.trim()}" as typed
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
    </Command>
  );

  // Inside a Radix Dialog the portal'd Popover never receives pointer events
  // or focus (the dialog's focus trap + pointer-events guard swallow them),
  // so `inline` renders the same panel in the trigger's own DOM subtree —
  // the documented dialog-safe shape (see entity-combobox.tsx / QA r205).
  if (inline) {
    return (
      <div ref={containerRef} className={`relative ${className}`}>
        {trigger}
        {open && (
          <div
            className="absolute left-0 bottom-full z-50 mb-1 w-[320px] rounded-md border bg-popover text-popover-foreground shadow-md overflow-hidden"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {commandPanel}
          </div>
        )}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* Kept short (list capped at 240px) so the panel fits below the
          trigger on laptop heights — a taller list made Radix flip it above
          the row, where it sprawled over the toolbar and read as a broken
          "bleed" (Woody, 2026-07-31). */}
      <PopoverContent className="p-0 w-[320px]" align="start" side="bottom" collisionPadding={8}>
        {commandPanel}
      </PopoverContent>
    </Popover>
  );
}
