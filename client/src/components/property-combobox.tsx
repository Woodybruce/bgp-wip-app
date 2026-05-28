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
  items: rawItems,
  value,
  onChange,
  onCreated,
  placeholder = "Select property…",
  disabled = false,
  className,
  testId,
}: PropertyComboboxProps) {
  // Defensive alphabetical sort — same pattern as EntityCombobox. Caller
  // historically had to remember to pre-sort; most forgot.
  const items = React.useMemo(
    () => [...rawItems].sort((a, b) => a.label.localeCompare(b.label, "en-GB", { sensitivity: "base" })),
    [rawItems],
  );
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
  const placesServiceRef = React.useRef<google.maps.places.PlacesService | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>();
  const { toast } = useToast();

  React.useEffect(() => {
    loadGoogleMaps().then((loaded) => {
      if (loaded) {
        autocompleteRef.current = new google.maps.places.AutocompleteService();
        // PlacesService needs a DOM element; an offscreen div is the
        // standard pattern (we never render it ourselves).
        const div = document.createElement("div");
        placesServiceRef.current = new google.maps.places.PlacesService(div);
        setGoogleReady(true);
      }
    });
  }, []);

  // Wrap PlacesService.getDetails in a promise — used in the resolver
  // fallback to pull the canonical address / postcode / lat-lng / name
  // before POSTing a property. Means even when the OS Places resolver
  // misses (e.g. market / multi-unit building), the property still
  // lands with all the Google data attached.
  const fetchGooglePlaceDetails = (placeId: string): Promise<any | null> => {
    return new Promise((resolve) => {
      if (!placesServiceRef.current) return resolve(null);
      placesServiceRef.current.getDetails(
        { placeId, fields: ["name", "formatted_address", "geometry", "address_components", "types"] },
        (place, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && place) resolve(place);
          else resolve(null);
        }
      );
    });
  };

  // Extract a clean property name from a Google place. Building / market
  // / landmark names win over the street ("The Shard", "Westfield London",
  // "Bluewater"). Business names DON'T — "The Pantry Cafe" is a tenant
  // occupying 108 Chiswick High Road, not a property name. The same
  // building-vs-business filter runs server-side in property-resolver.ts;
  // mirror it here for the client fallback path that POSTs directly when
  // the resolver returns not_found (e.g. 108 isn't in OS Places).
  const BUILDING_LANDMARK_TYPES = new Set([
    "premise", "subpremise", "shopping_mall", "tourist_attraction",
    "stadium", "convention_center", "airport", "train_station",
    "transit_station", "university", "school", "hospital",
  ]);
  const BUSINESS_TENANT_TYPES = new Set([
    "food", "restaurant", "cafe", "bar", "meal_takeaway", "meal_delivery", "bakery",
    "store", "shoe_store", "clothing_store", "book_store", "electronics_store",
    "furniture_store", "hardware_store", "home_goods_store", "jewelry_store",
    "liquor_store", "pet_store", "supermarket", "convenience_store",
    "bank", "finance", "atm", "insurance_agency", "real_estate_agency",
    "pharmacy", "doctor", "dentist", "veterinary_care", "physiotherapist",
    "gym", "beauty_salon", "hair_care", "spa", "nail_salon",
    "car_dealer", "car_rental", "car_repair", "car_wash", "gas_station",
    "lodging", "night_club", "movie_theater", "bowling_alley", "casino",
  ]);
  const namePropertyFromPlace = (place: any, fallback: string): string => {
    const placeName = (place as any).name as string | undefined;
    const types = ((place as any).types || []) as string[];
    const isBuildingLandmark = types.some((t) => BUILDING_LANDMARK_TYPES.has(t));
    const isBusinessTenant = types.some((t) => BUSINESS_TENANT_TYPES.has(t));
    // Use the place name only when it's clearly a building/landmark, NOT
    // when it's a business tenant. Reject numeric-only names too (Google
    // sometimes returns the street number as `name` for plain addresses).
    if (placeName && isBuildingLandmark && !isBusinessTenant && !/^\d+[a-z]?$/i.test(placeName.trim())) {
      return placeName;
    }
    // Fall back to "<street_number> <route>" if address_components carries
    // them — gives "108 Chiswick High Road" rather than the comma-tail of
    // the formatted_address (which might be "108 Chiswick High Rd.,
    // Chiswick, London W4 1PU" or even lead with a place name).
    const comp = (t: string) => place.address_components?.find((c: any) => c.types?.includes(t))?.long_name;
    const number = comp("street_number");
    const route = comp("route");
    if (number && route) return `${number} ${route}`;
    if (route) return route;
    // Last resort: first chunk of formatted address.
    const formatted = place.formatted_address || fallback;
    const line1 = formatted.split(",")[0]?.trim();
    return line1 || formatted || fallback;
  };

  const placeToPropertyPayload = (place: any, fallbackName: string) => {
    const comp = (t: string) => place.address_components?.find((c: any) => c.types.includes(t))?.long_name;
    const street = [comp("street_number"), comp("route")].filter(Boolean).join(" ");
    const formatted = place.formatted_address || fallbackName;
    return {
      name: namePropertyFromPlace(place, fallbackName),
      address: {
        formatted,
        line1: street || formatted.split(",")[0],
        city: comp("postal_town") || comp("locality"),
        region: comp("administrative_area_level_2") || comp("administrative_area_level_1"),
        country: comp("country"),
        placeId: place.place_id,
      },
      postcode: comp("postal_code") || null,
      latitude: place.geometry?.location ? String(place.geometry.location.lat()) : null,
      longitude: place.geometry?.location ? String(place.geometry.location.lng()) : null,
    };
  };

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
            // Two filters here:
            //   (a) drop BROAD results (postcode-only, country, region)
            //       that aren't useful as a property — same as before.
            //   (b) drop BUSINESS ESTABLISHMENTS (Swiss Life Asset Managers,
            //       The Pantry Cafe, Boots) where the prediction is a
            //       *tenant occupying* the address rather than the property
            //       itself. We can't write "Swiss Life Asset Managers Uk Ltd"
            //       as the property name for 55 Wells Street — that's the
            //       tenant. Building/landmark premises (Hartsfield Manor,
            //       The Shard, Bluewater) DO carry premise/landmark types
            //       even when also tagged establishment, so we let those
            //       through.
            const BUILDING_KEEP_TYPES = new Set([
              "premise", "subpremise", "shopping_mall", "tourist_attraction",
              "stadium", "convention_center", "airport", "train_station",
              "transit_station", "university", "school", "hospital",
            ]);
            const filtered = results.filter((r) => {
              const types = r.types || [];
              const isBroad =
                types.includes("postal_code") ||
                types.includes("country") ||
                types.includes("administrative_area_level_1") ||
                types.includes("administrative_area_level_2") ||
                (types.includes("locality") && !types.includes("street_address") && !types.includes("premise"));
              if (isBroad) return false;
              const isEstablishment = types.includes("establishment");
              const isLandmarkBuilding = types.some((t) => BUILDING_KEEP_TYPES.has(t));
              // Establishment without a building/landmark type = tenant.
              // Drop it so users see the postal address option instead.
              if (isEstablishment && !isLandmarkBuilding) return false;
              return true;
            });
            setPredictions(filtered);
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
      if (result?.kind === "candidates" && Array.isArray(result.candidates) && result.candidates.length > 0) {
        // OS Places returned multiple UPRN matches — common for markets,
        // multi-unit buildings, shopping arcades. Candidates carry UPRNs,
        // not crm_properties ids. If one of them already maps to a CRM
        // property we own, use it directly; otherwise call the resolver
        // again with kind=uprn to find-or-create from the first UPRN.
        const first = result.candidates[0];
        if (first?.existingPropertyId) {
          adoptProperty(
            first.existingPropertyId,
            first.address || prediction.structured_formatting?.main_text || prediction.description,
            first.postcode ?? null,
          );
          return;
        }
        if (first?.uprn) {
          const uprnResp = await fetch("/api/property-resolver/resolve", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json", ...getAuthHeaders() },
            body: JSON.stringify({ kind: "uprn", uprn: first.uprn }),
          });
          if (uprnResp.ok) {
            const uprnResult = await uprnResp.json();
            if (uprnResult?.kind === "resolved" && uprnResult.property?.id) {
              adoptProperty(uprnResult.property.id, uprnResult.property.name, uprnResult.property.postcode ?? null);
              if (result.candidates.length > 1) {
                toast({
                  title: `Picked closest UPRN (${result.candidates.length} matches)`,
                  description: `Multiple OS Places entries for this address — used the first. Confirm on the property page if needed.`,
                });
              }
              return;
            }
          }
        }
      }
      // not_found / unknown shape — OS Places couldn't pin a UPRN
      // (common on markets, multi-unit buildings, brand-new addresses).
      // Fall back to creating the property with the Google data we DO
      // have: clean name from placeName/line1, full formatted address,
      // postcode, lat/lng. Means the property lands properly even
      // without a canonical UPRN.
      const placeDetails = await fetchGooglePlaceDetails(prediction.place_id);
      const fallbackName = prediction.structured_formatting?.main_text || prediction.description;
      const payload = placeDetails
        ? placeToPropertyPayload(placeDetails, fallbackName)
        : { name: fallbackName };
      const r = await apiRequest("POST", "/api/crm/properties", payload);
      const prop = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      adoptProperty(prop.id, prop.name, prop.postcode ?? null);
      toast({
        title: `Added "${prop.name}"`,
        description: "Address attached from Google. We couldn't pin an OS Places UPRN — you can confirm the canonical address on the property page.",
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
