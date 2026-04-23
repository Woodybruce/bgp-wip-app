import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { MapPin, X, Loader2, ExternalLink } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

interface AddressResult {
  formatted: string;
  placeId: string;
  lat?: number;
  lng?: number;
  street?: string;
  city?: string;
  region?: string;
  postcode?: string;
  country?: string;
}

interface AddressAutocompleteProps {
  value: AddressResult | null;
  onChange: (address: AddressResult | null) => void;
  placeholder?: string;
  className?: string;
}

function useServerAddressSearch() {
  const [results, setResults] = useState<{ label: string; postcode: string; lat?: number; lng?: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const search = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 3) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/address-search?q=${encodeURIComponent(query)}`, { credentials: "include", headers: getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          setResults(data.results || []);
        }
      } catch { setResults([]); }
      setLoading(false);
    }, 300);
  }, []);

  return { results, loading, search, setResults };
}

export function AddressAutocomplete({
  value,
  onChange,
  placeholder = "Search address...",
  className = "",
}: AddressAutocompleteProps) {
  const [query, setQuery] = useState(value?.formatted || "");
  const [showDropdown, setShowDropdown] = useState(false);
  const [useGoogle, setUseGoogle] = useState(false);
  const [scriptChecked, setScriptChecked] = useState(false);

  const [googlePredictions, setGooglePredictions] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  const autocompleteService = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesService = useRef<google.maps.places.PlacesService | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const googleDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  const serverSearch = useServerAddressSearch();

  useEffect(() => {
    loadGoogleMaps().then((loaded) => {
      setUseGoogle(loaded);
      setScriptChecked(true);
      if (loaded) {
        autocompleteService.current = new google.maps.places.AutocompleteService();
        const div = document.createElement("div");
        placesService.current = new google.maps.places.PlacesService(div);
      }
    });
  }, []);

  useEffect(() => {
    setQuery(value?.formatted || "");
  }, [value?.formatted]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const searchGoogle = useCallback((input: string) => {
    if (!autocompleteService.current || input.length < 3) {
      setGooglePredictions([]);
      return;
    }
    if (googleDebounceRef.current) clearTimeout(googleDebounceRef.current);
    googleDebounceRef.current = setTimeout(() => {
      setGoogleLoading(true);
      autocompleteService.current!.getPlacePredictions(
        {
          input,
          componentRestrictions: { country: "gb" },
          // Bias towards London commercial property area
          locationBias: { center: { lat: 51.5074, lng: -0.1278 }, radius: 50000 },
        } as any,
        (results, status) => {
          setGoogleLoading(false);
          if (status === google.maps.places.PlacesServiceStatus.OK && results) {
            // Filter out broad regions (cities, postcodes, countries) — keep addresses + buildings
            const filtered = results.filter(r => {
              const types = r.types || [];
              const isBroad = types.includes("postal_code") || types.includes("country") ||
                types.includes("administrative_area_level_1") || types.includes("administrative_area_level_2") ||
                types.includes("locality") && !types.includes("street_address") && !types.includes("premise");
              return !isBroad;
            });
            setGooglePredictions(filtered.length > 0 ? filtered : results);
            setShowDropdown(true);
          } else {
            setGooglePredictions([]);
          }
        }
      );
    }, 300);
  }, []);

  const handleInputChange = (val: string) => {
    setQuery(val);
    if (useGoogle) {
      searchGoogle(val);
    } else {
      serverSearch.search(val);
      if (val.length >= 3) setShowDropdown(true);
    }
  };

  const selectGooglePlace = (prediction: google.maps.places.AutocompletePrediction) => {
    if (!placesService.current) return;
    placesService.current.getDetails(
      { placeId: prediction.place_id, fields: ["formatted_address", "geometry", "place_id", "address_components"] },
      (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && place) {
          const comp = (type: string) => place.address_components?.find((c: any) => c.types.includes(type))?.long_name;
          const streetNumber = comp("street_number") || "";
          const route = comp("route") || "";
          const street = [streetNumber, route].filter(Boolean).join(" ");
          const result: AddressResult = {
            formatted: place.formatted_address || prediction.description,
            placeId: place.place_id || prediction.place_id,
            lat: place.geometry?.location?.lat(),
            lng: place.geometry?.location?.lng(),
            street: street || undefined,
            city: comp("postal_town") || comp("locality") || undefined,
            region: comp("administrative_area_level_2") || comp("administrative_area_level_1") || undefined,
            postcode: comp("postal_code") || undefined,
            country: comp("country") || undefined,
          };
          setQuery(result.formatted);
          setGooglePredictions([]);
          setShowDropdown(false);
          onChange(result);
        }
      }
    );
  };

  const selectServerResult = (r: { label: string; postcode: string; lat?: number; lng?: number }) => {
    const result: AddressResult = {
      formatted: r.label,
      placeId: r.postcode,
      lat: r.lat,
      lng: r.lng,
    };
    setQuery(result.formatted);
    serverSearch.setResults([]);
    setShowDropdown(false);
    onChange(result);
  };

  const submitManualAddress = () => {
    if (!query.trim()) return;
    const postcodeMatch = query.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);
    const result: AddressResult = {
      formatted: query.trim(),
      placeId: "",
      postcode: postcodeMatch ? postcodeMatch[0].toUpperCase().replace(/\s+/g, " ") : undefined,
    };
    setShowDropdown(false);
    setGooglePredictions([]);
    serverSearch.setResults([]);
    onChange(result);
  };

  const clear = () => {
    setQuery("");
    setGooglePredictions([]);
    serverSearch.setResults([]);
    setShowDropdown(false);
    onChange(null);
  };

  if (!scriptChecked) {
    return (
      <div className={`flex items-center gap-2 text-xs text-muted-foreground ${className}`}>
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading...
      </div>
    );
  }

  const isLoading = useGoogle ? googleLoading : serverSearch.loading;
  const hasResults = useGoogle ? googlePredictions.length > 0 : serverSearch.results.length > 0;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <MapPin className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => hasResults && setShowDropdown(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitManualAddress();
            }
          }}
          placeholder={placeholder}
          className="pl-7 pr-7 h-8 text-xs"
          data-testid="input-address-search"
        />
        {query && (
          <button
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            data-testid="button-clear-address"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {showDropdown && hasResults && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-[200px] overflow-y-auto">
          {useGoogle
            ? googlePredictions.map((p) => (
                <button
                  key={p.place_id}
                  onClick={() => selectGooglePlace(p)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-start gap-2"
                  data-testid={`option-address-${p.place_id}`}
                >
                  <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <span>{p.description}</span>
                </button>
              ))
            : serverSearch.results.map((r, i) => (
                <button
                  key={`${r.postcode}-${i}`}
                  onClick={() => selectServerResult(r)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-start gap-2"
                  data-testid={`option-address-${i}`}
                >
                  <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <span>{r.label}</span>
                </button>
              ))}
        </div>
      )}
      {isLoading && showDropdown && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg p-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          Searching...
        </div>
      )}
    </div>
  );
}

interface InlineAddressProps {
  value: AddressResult | null | undefined;
  onSave: (address: AddressResult | null) => void;
  placeholder?: string;
}

export function InlineAddress({ value, onSave, placeholder = "Set address" }: InlineAddressProps) {
  const [editing, setEditing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setEditing(false);
      }
    }
    if (editing) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [editing]);

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-left w-full group"
        data-testid="button-edit-address"
      >
        {value?.formatted ? (
          <span className="text-xs flex items-center gap-1">
            <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="truncate max-w-[180px]">{value.formatted}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground group-hover:text-foreground">
            {placeholder}
          </span>
        )}
      </button>
    );
  }

  return (
    <div ref={containerRef} className="min-w-[250px]">
      <AddressAutocomplete
        value={value || null}
        onChange={(addr) => {
          onSave(addr);
          setEditing(false);
        }}
        placeholder={placeholder}
      />
    </div>
  );
}

export function buildGoogleMapsUrl(address: string | any): string | null {
  let query = "";
  if (typeof address === "string") {
    query = address;
  } else if (address) {
    if (address.formatted) query = address.formatted;
    else if (address.address) query = address.address;
    else {
      const parts = [address.line1, address.line2, address.street, address.city, address.postcode, address.country].filter(Boolean);
      query = parts.join(", ");
    }
  }
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
