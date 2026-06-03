/**
 * PropertyResolverBar — single address bar that drives every property feature.
 *
 * Sits at the top of Property Intelligence (and anywhere else a feature needs
 * canonical property identity). Takes free-text address / postcode / UPRN /
 * title number / lat-lng, hits POST /api/property-resolver/resolve, and:
 *   - resolved → emits the canonical property to onResolve(propertyId, property)
 *   - candidates → shows the picker dialog so the user forces a pick
 *   - not_found → shows an inline message
 *
 * The point is that EVERY feature reads from the same resolver and shares
 * what it learns. No more postcode-wide noise, no more "wrong McDonald's".
 */

import { useEffect, useRef, useState } from "react";
import { Search, Loader2, MapPin, AlertCircle, Building2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ResolverCandidate = {
  uprn: string;
  address: string;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  classification: string | null;
  existingPropertyId: string | null;
};

type ResolvedProperty = { id: string; name: string; postcode: string | null; uprn: string | null; latitude?: string | number | null; longitude?: string | number | null };

type ResolveResult =
  | { kind: "resolved"; property: ResolvedProperty; source: string }
  | { kind: "candidates"; candidates: ResolverCandidate[]; reason: string }
  | { kind: "not_found"; reason: string };

interface Props {
  /** Called when a property is canonically resolved. */
  onResolve: (propertyId: string, property: ResolvedProperty) => void;
  /** Called when the input is too vague to resolve (e.g. just "Brentford")
   *  but Google can still geocode it. Lets the map at least pan there. */
  onPanTo?: (lat: number, lng: number, label: string) => void;
  /** Currently-selected property — shown as a badge. */
  current?: { id: string; name: string; postcode: string | null } | null;
  placeholder?: string;
}

type GoogleSuggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
  types: string[];
};

export function PropertyResolverBar({ onResolve, onPanTo, current, placeholder }: Props) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<ResolverCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Google Places autocomplete state
  const [suggestions, setSuggestions] = useState<GoogleSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-typing-session token so Google bills these as one autocomplete
  // session — picking a suggestion charges only the place-details call,
  // not each keystroke.
  const sessionTokenRef = useRef<string>(crypto.randomUUID());
  const inputWrapperRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (inputWrapperRef.current && !inputWrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Debounced autocomplete fetch
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const text = query.trim();
    if (text.length < 3) {
      setSuggestions([]);
      return;
    }
    // Skip if input looks like UPRN / postcode / title — those bypass
    // Google and go to the resolver directly via Enter / Resolve button.
    const explicitInput = inferInput(text);
    if (explicitInput.kind !== "address") {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(
          `/api/property-resolver/autocomplete?q=${encodeURIComponent(text)}&sessionToken=${sessionTokenRef.current}`,
          { credentials: "include", headers: getAuthHeaders() },
        );
        if (!resp.ok) return;
        const data = await resp.json();
        setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
        setShowSuggestions(true);
        setHighlightIdx(-1);
      } catch {
        // network blip; ignore — Resolve button still works
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function pickGoogleSuggestion(s: GoogleSuggestion) {
    setShowSuggestions(false);
    setQuery(s.description);
    setLoading(true);
    setError(null);
    setCandidates(null);
    try {
      // Google place_id → server-side place details → OS Places nearest →
      // canonical UPRN. End-to-end pin-pointing.
      const resp = await fetch("/api/property-resolver/resolve", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ kind: "googlePlace", placeId: s.placeId }),
      });
      if (!resp.ok) {
        const errBody: any = await resp.json().catch(() => ({}));
        setError(errBody?.error || `Resolver returned HTTP ${resp.status}`);
        return;
      }
      const result = (await resp.json()) as ResolveResult;
      if (result.kind === "resolved") {
        onResolve(result.property.id, result.property);
        toast({ title: "Property resolved", description: result.property.name });
      } else if (result.kind === "candidates") {
        setCandidates(result.candidates);
      } else {
        setError(result.reason || "Couldn't resolve to a UK address");
      }
      // New session for the next typing burst
      sessionTokenRef.current = crypto.randomUUID();
    } catch (err: any) {
      setError(err?.message || "Resolver request failed");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    const text = query.trim();
    if (!text) return;
    // If suggestions are showing and one is highlighted, treat Enter as a pick
    if (showSuggestions && highlightIdx >= 0 && suggestions[highlightIdx]) {
      return pickGoogleSuggestion(suggestions[highlightIdx]);
    }
    // If suggestions are showing and we have any, pick the first by default
    if (showSuggestions && suggestions.length > 0) {
      return pickGoogleSuggestion(suggestions[0]);
    }
    setLoading(true);
    setError(null);
    setCandidates(null);
    try {
      // Bypass Google for UPRN / postcode / title — those go straight to the
      // resolver. For free-text address with no Google suggestions, fall back
      // to OS Places find via the address kind.
      const input = inferInput(text);
      const resp = await fetch("/api/property-resolver/resolve", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(input),
      });
      if (!resp.ok) {
        // Surface the real reason rather than the generic "Couldn't resolve"
        // fallback — server errors usually carry a useful message.
        const errBody: any = await resp.json().catch(() => ({}));
        setError(errBody?.error || `Resolver returned HTTP ${resp.status}`);
        return;
      }
      const result = (await resp.json()) as ResolveResult;
      if (result.kind === "resolved") {
        onResolve(result.property.id, result.property);
        toast({ title: "Property resolved", description: result.property.name });
      } else if (result.kind === "candidates") {
        setCandidates(result.candidates);
      } else {
        // Resolver couldn't pin a UPRN (e.g. "Brentford" is a town, not an
        // address). Fall back to a Google geocode pan so the map at least
        // navigates to the area the user typed — better than the screen
        // staying frozen in central London with no feedback.
        if (onPanTo) {
          try {
            const geo = await fetch(
              `/api/property-resolver/geocode?q=${encodeURIComponent(text)}`,
              { credentials: "include", headers: getAuthHeaders() },
            );
            if (geo.ok) {
              const data = await geo.json();
              if (data?.lat && data?.lng) {
                onPanTo(data.lat, data.lng, data.label || text);
                toast({ title: "Moved map to area", description: data.label || text });
                return;
              }
            }
          } catch {
            // Fall through to the explicit error
          }
        }
        setError(result.reason || "Couldn't find that property — try a full address or postcode");
      }
    } catch (err: any) {
      setError(err?.message || "Resolver request failed");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Escape") {
        setShowSuggestions(false);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  async function pickCandidate(c: ResolverCandidate) {
    if (!c.uprn) return;
    setLoading(true);
    try {
      const resp = await fetch("/api/property-resolver/confirm", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ uprn: c.uprn }),
      });
      const result = (await resp.json()) as ResolveResult;
      if (result.kind === "resolved") {
        onResolve(result.property.id, result.property);
        setCandidates(null);
        toast({ title: "Property confirmed", description: result.property.name });
      } else {
        setError(result.kind === "not_found" ? result.reason : "Pick failed");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 w-full">
        <div className="relative flex-1" ref={inputWrapperRef}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder={placeholder || "Address, postcode, UPRN, or title number…"}
            className="pl-9"
            disabled={loading}
            autoComplete="off"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-popover border border-border rounded shadow-lg z-50 max-h-80 overflow-y-auto">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground border-b">
                Google Places — pick to resolve to canonical UK address
              </div>
              {suggestions.map((s, i) => (
                <button
                  key={s.placeId}
                  onClick={() => pickGoogleSuggestion(s)}
                  onMouseEnter={() => setHighlightIdx(i)}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2 transition ${
                    i === highlightIdx ? "bg-accent" : "hover:bg-accent/60"
                  }`}
                >
                  <Building2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{s.mainText}</div>
                    {s.secondaryText && (
                      <div className="text-xs text-muted-foreground truncate">{s.secondaryText}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <Button onClick={submit} disabled={loading || !query.trim()} size="sm">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Resolve"}
        </Button>
        {current && (
          <>
            <Badge variant="secondary" className="gap-1">
              <MapPin className="h-3 w-3" />
              {current.name}
              {current.postcode && <span className="opacity-60">· {current.postcode}</span>}
            </Badge>
            <EnrichButton propertyId={current.id} />
          </>
        )}
      </div>
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive mt-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}
      <Dialog open={!!candidates} onOpenChange={(open) => !open && setCandidates(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Which property did you mean?</DialogTitle>
            <DialogDescription>
              Multiple addresses match. Pick the exact one — every feature in the
              app will use this canonical record going forward.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto space-y-1">
            {candidates?.map((c) => (
              <button
                key={c.uprn}
                onClick={() => pickCandidate(c)}
                disabled={loading || !c.uprn}
                className="w-full text-left p-3 rounded border border-border hover:bg-accent transition flex items-start gap-3"
              >
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{c.address}</div>
                  <div className="text-xs text-muted-foreground flex gap-3 mt-0.5">
                    {c.postcode && <span>{c.postcode}</span>}
                    <span className="opacity-60">UPRN {c.uprn}</span>
                    {c.classification && <span className="truncate">{c.classification}</span>}
                  </div>
                </div>
                {c.existingPropertyId && (
                  <Badge variant="outline" className="text-xs">in CRM</Badge>
                )}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Explicit "Enrich now" button — fires HMLR title + proprietor + Companies
 * House + AML cascade only after the user has CONFIRMED the resolved
 * property is the right one. Avoids burning PropertyData credits on a
 * mid-typing wrong-property pick.
 */
function EnrichButton({ propertyId }: { propertyId: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const enrich = async () => {
    if (!propertyId) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/property-resolver/enrich/${propertyId}`, {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => null);
        toast({ title: "Enrich failed", description: e?.error || `${r.status}`, variant: "destructive" });
        return;
      }
      setDone(true);
      toast({
        title: "Enriching property",
        description: "HMLR + Companies House + AML — running in background, refresh in ~30s.",
      });
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-300 text-emerald-700 dark:text-emerald-400">
        <Sparkles className="h-3 w-3" /> Enriched
      </Badge>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={enrich}
      disabled={busy}
      className="gap-1 h-8"
      title="Run HMLR title + Companies House + AML lookup for this property"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      Enrich
    </Button>
  );
}

/** Detect input shape so the resolver picks the right code path. */
function inferInput(text: string): { kind: string; [k: string]: any } {
  const trimmed = text.trim();
  if (/^\d{6,12}$/.test(trimmed)) return { kind: "uprn", uprn: trimmed };
  if (/^[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i.test(trimmed)) {
    return { kind: "postcode", postcode: trimmed };
  }
  if (/^[A-Z]{1,4}\d{2,8}$/.test(trimmed)) {
    return { kind: "titleNumber", titleNumber: trimmed };
  }
  return { kind: "address", text: trimmed };
}
