import * as React from "react";
import { Check, ChevronsUpDown, X, MapPin, Loader2, Plus } from "lucide-react";

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
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { getAuthHeaders, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type PropertyItem = {
  id: string;
  label: string;
  subLabel?: string;
  keywords?: string[];
};

interface PropertyComboboxProps {
  items: PropertyItem[];
  value: string | null | undefined;
  onChange: (id: string) => void;
  /**
   * Fires when a brand new property is created via Google lookup —
   * gives the parent the resolved id + name + postcode so it can
   * cache the row in its local properties list without a refetch.
   */
  onCreated?: (prop: { id: string; name: string; postcode: string | null }) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
}

// Property picker — same shape as EntityCombobox, plus a second
// CommandGroup that shows live Google Places suggestions below the
// existing-BGP-properties list. Picking a Google suggestion calls
// /api/property-resolver/resolve which find-or-creates the property
// (canonical UPRN, smart name) and hands back the id.
//
// Why a dedicated component rather than extending EntityCombobox: the
// Google lookup needs its own debounced effect + loading state + a
// distinct "creating…" affordance, and crucially the picker has to
// hold the property id (selected.label / subLabel) for the trigger
// label without having that row in `items`. Cleaner as a small bespoke
// component than as more props on the generic picker.
export function PropertyCombobox({
  items,
  value,
  onChange,
  onCreated,
  placeholder = "Select property…",
  disabled = false,
  className,
  testId,
}: PropertyComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [googleReady, setGoogleReady] = React.useState(false);
  const [predictions, setPredictions] = React.useState<google.maps.places.AutocompletePrediction[]>([]);
  const [googleLoading, setGoogleLoading] = React.useState(false);

  // Tracks the most recently created property so the trigger label
  // is correct even before the parent refetches its `items` prop.
  const [recentlyCreated, setRecentlyCreated] = React.useState<PropertyItem | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const autocompleteRef = React.useRef<google.maps.places.AutocompleteService | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>();
  const { toast } = useToast();

  React.useEffect(() => {
    loadGoogleMaps().then((loaded) => {
      if (loaded) {
        autocompleteRef.current = new google.maps.places.AutocompleteService();
        setGoogleReady(true);
      }
    });
  }, []);

  // Debounced Google Places lookup — fires only when the dropdown is
  // open and the search is 3+ chars. Matches address-autocomplete.tsx
  // (UK-only, biased to London commercial property area, drops broad
  // region results that aren't useful as a property).
  React.useEffect(() => {
    if (!open || !googleReady || search.trim().length < 3 || !autocompleteRef.current) {
      setPredictions([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setGoogleLoading(true);
      autocompleteRef.current!.getPlacePredictions(
        {
          input: search.trim(),
          componentRestrictions: { country: "gb" },
          locationBias: { center: { lat: 51.5074, lng: -0.1278 }, radius: 50000 },
        } as any,
        (results, status) => {
          setGoogleLoading(false);
          if (status === google.maps.places.PlacesServiceStatus.OK && results) {
            const filtered = results.filter((r) => {
              const types = r.types || [];
              const isBroad =
                types.includes("postal_code") ||
                types.includes("country") ||
                types.includes("administrative_area_level_1") ||
                types.includes("administrative_area_level_2") ||
                (types.includes("locality") && !types.includes("street_address") && !types.includes("premise"));
              return !isBroad;
            });
            setPredictions(filtered.length > 0 ? filtered : results);
          } else {
            setPredictions([]);
          }
        }
      );
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, open, googleReady]);

  // Helper: stamp a freshly resolved/created property into the picker.
  const adoptProperty = (id: string, name: string, postcode: string | null) => {
    const created: PropertyItem = { id, label: name, subLabel: postcode || undefined };
    setRecentlyCreated(created);
    onCreated?.({ id, name, postcode });
    onChange(id);
    setSearch("");
    setPredictions([]);
    setOpen(false);
  };

  const handleCreateFromGoogle = async (prediction: google.maps.places.AutocompletePrediction) => {
    setCreating(true);
    try {
      const resp = await fetch("/api/property-resolver/resolve", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ kind: "googlePlace", placeId: prediction.place_id }),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error(`Resolver ${resp.status}: ${txt.slice(0, 200) || resp.statusText}`);
      }
      const result = await resp.json();

      // Resolver can return three shapes. Handle each so the click never
      // dead-ends silently — the original failure mode was 'click does
      // nothing' because we threw on non-resolved and swallowed the error.
      if (result?.kind === "resolved" && result.property?.id) {
        adoptProperty(result.property.id, result.property.name, result.property.postcode ?? null);
        return;
      }
      if (result?.kind === "candidates") {
        // OS Places returned >1 match for this address — UPRN
        // disambiguation needed. Take the first candidate as a
        // pragmatic fallback so the user isn't stuck (the UPRN
        // can be reconciled later from the property page).
        const first = result.candidates?.[0];
        if (first?.id) {
          adoptProperty(first.id, first.name || prediction.description, first.postcode ?? null);
          toast({
            title: "Multiple address matches",
            description: `Picked the closest match. Open the property page to fine-tune the UPRN if needed.`,
          });
          return;
        }
      }
      // not_found / unknown shape — fall back to name-only creation so
      // Layla isn't blocked. She can fix the address on the property page later.
      const r = await apiRequest("POST", "/api/crm/properties", { name: prediction.description });
      const prop = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      adoptProperty(prop.id, prop.name, prop.postcode ?? null);
      toast({
        title: "Created without address lookup",
        description: "Couldn't auto-resolve the address — added as a plain property. You can edit it from the property page.",
      });
    } catch (err: any) {
      toast({
        title: "Couldn't add that property",
        description: err?.message || "Try a different address, or use 'Create by name' below.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  // Last-resort fallback: just POST the typed name to /api/crm/properties.
  // No Google, no resolver, no UPRN. For when Google's failing or the
  // address genuinely isn't on Google (new build, internal name, etc).
  const handleCreateByName = async () => {
    const name = search.trim();
    if (!name) return;
    setCreating(true);
    try {
      const r = await apiRequest("POST", "/api/crm/properties", { name });
      const prop = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      adoptProperty(prop.id, prop.name, prop.postcode ?? null);
      toast({ title: "Property created", description: `Added "${prop.name}" — fill in the address on the property page when you have a minute.` });
    } catch (err: any) {
      toast({ title: "Couldn't create property", description: err?.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  // Resolve the trigger label: prefer the selected item from `items`,
  // fall back to the most recently created one (covers the brief
  // moment between create and parent refetch).
  const selected = React.useMemo(() => {
    if (!value) return null;
    const fromItems = items.find((it) => it.id === value);
    if (fromItems) return fromItems;
    if (recentlyCreated && recentlyCreated.id === value) return recentlyCreated;
    return null;
  }, [items, value, recentlyCreated]);

  React.useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const triggerLabel = selected?.label ?? placeholder;

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
          {selected && !disabled && (
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
          className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover text-popover-foreground shadow-md min-w-[320px] overflow-hidden"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Command
            // Substring + prefix scoring, same as EntityCombobox.
            filter={(value, searchStr) => {
              if (!searchStr) return 1;
              const v = value.toLowerCase();
              const s = searchStr.toLowerCase().trim();
              if (!s) return 1;
              if (v.startsWith(s)) return 2;
              if (v.includes(` ${s}`)) return 1.5;
              if (v.includes(s)) return 1;
              return 0;
            }}
          >
            <CommandInput
              placeholder="Type to search properties or addresses…"
              autoFocus
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>
                {(() => {
                  const q = search.trim();
                  if (q.length < 3) return "Type 3+ characters to search…";
                  if (googleLoading) return "Searching addresses…";
                  if (!googleReady) return "Address search unavailable — try typing your existing property name.";
                  // Google ran and returned nothing — usually a typo or
                  // a place Google doesn't index. Tell the user how to
                  // recover rather than leave them staring at "no matches".
                  return `No address matches for "${q}". Check spelling, try a postcode, or include the town (e.g. "Brixton, London").`;
                })()}
              </CommandEmpty>

              {items.length > 0 && (
                <CommandGroup heading="Your properties">
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
                        <Check className={cn("h-4 w-4", value === it.id ? "opacity-100" : "opacity-0")} />
                        <div className="flex flex-col min-w-0">
                          <span className="truncate">{it.label}</span>
                          {it.subLabel && (
                            <span className="text-xs text-muted-foreground truncate">{it.subLabel}</span>
                          )}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {predictions.length > 0 && (
                <CommandGroup heading="Add new address (Google)">
                  {predictions.map((p) => (
                    <CommandItem
                      key={`__google__${p.place_id}`}
                      value={`__google__ ${p.description}`}
                      onSelect={() => handleCreateFromGoogle(p)}
                      disabled={creating}
                      className="bg-emerald-50/40 dark:bg-emerald-950/20 data-[selected=true]:bg-emerald-100 dark:data-[selected=true]:bg-emerald-950/60"
                    >
                      {creating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-700" />
                      ) : (
                        <MapPin className="h-3.5 w-3.5 text-emerald-700" />
                      )}
                      <span className="text-sm text-emerald-900 dark:text-emerald-200 truncate">{p.description}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* Fallback: create a bare-name property when Google has
                  nothing useful or is unavailable. Always shown once the
                  user has typed something so they're never blocked. */}
              {search.trim().length >= 2 && (
                <CommandGroup heading="Or add manually">
                  <CommandItem
                    value={`__create_by_name__ ${search}`}
                    onSelect={handleCreateByName}
                    disabled={creating}
                    className="bg-amber-50/60 dark:bg-amber-950/30 data-[selected=true]:bg-amber-100 dark:data-[selected=true]:bg-amber-950/60 text-amber-900 dark:text-amber-200 font-medium"
                  >
                    {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    <span className="truncate">Create property "{search.trim()}" without address lookup</span>
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  );
}
