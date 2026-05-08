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

import { useState } from "react";
import { Search, Loader2, MapPin, AlertCircle } from "lucide-react";
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

type ResolveResult =
  | { kind: "resolved"; property: { id: string; name: string; postcode: string | null; uprn: string | null }; source: string }
  | { kind: "candidates"; candidates: ResolverCandidate[]; reason: string }
  | { kind: "not_found"; reason: string };

interface Props {
  /** Called when a property is canonically resolved. */
  onResolve: (propertyId: string, property: ResolveResult extends { kind: "resolved"; property: infer P } ? P : never) => void;
  /** Currently-selected property — shown as a badge. */
  current?: { id: string; name: string; postcode: string | null } | null;
  placeholder?: string;
}

export function PropertyResolverBar({ onResolve, current, placeholder }: Props) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<ResolverCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const text = query.trim();
    if (!text) return;
    setLoading(true);
    setError(null);
    setCandidates(null);
    try {
      // The resolver auto-detects the input shape — UPRN if all digits,
      // postcode if it looks like one, otherwise address text.
      const input = inferInput(text);
      const resp = await fetch("/api/property-resolver/resolve", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(input),
      });
      const result = (await resp.json()) as ResolveResult;
      if (result.kind === "resolved") {
        onResolve(result.property.id, result.property as any);
        toast({ title: "Property resolved", description: result.property.name });
      } else if (result.kind === "candidates") {
        setCandidates(result.candidates);
      } else {
        setError(result.reason || "Property not found");
      }
    } catch (err: any) {
      setError(err?.message || "Resolver request failed");
    } finally {
      setLoading(false);
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
        onResolve(result.property.id, result.property as any);
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
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={placeholder || "Address, postcode, UPRN, or title number…"}
            className="pl-9"
            disabled={loading}
          />
        </div>
        <Button onClick={submit} disabled={loading || !query.trim()} size="sm">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Resolve"}
        </Button>
        {current && (
          <Badge variant="secondary" className="gap-1">
            <MapPin className="h-3 w-3" />
            {current.name}
            {current.postcode && <span className="opacity-60">· {current.postcode}</span>}
          </Badge>
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
