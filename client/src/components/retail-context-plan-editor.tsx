/**
 * RetailContextPlanEditor — full editor for the BGP Goad-style retail
 * context plan. Wraps `/api/retail-context-plan/render` with a UI to:
 *
 *   - Drag the centre point on a Google map (or revert to the geocoded
 *     property address)
 *   - Adjust the radius (50-300m, with a live circle on the map)
 *   - Toggle which retail categories are shown (fashion / fnb /
 *     services / beauty / convenience / vacant / other)
 *   - Regenerate — POSTs the params, server returns a new image_studio
 *     row + property_imagery_asset row. Preview updates inline
 *   - "Use this version" — pins the asset (PATCH with pinned=true,
 *     exclusive per kind) so it becomes the canonical retail context
 *     plan for the property
 *
 * Each regenerate is preserved as a new asset row — history is
 * recoverable via the picker. Closing the dialog without pinning leaves
 * the most recent render unpinned (still visible in the picker, just
 * not the canonical one).
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

const CATEGORIES: Array<{ key: string; label: string; color: string }> = [
  { key: "fashion",     label: "Fashion & Comparison",       color: "#C9A961" },
  { key: "convenience", label: "Convenience & Food Retail",  color: "#7FA99B" },
  { key: "fnb",         label: "Food & Beverage",            color: "#D08F6E" },
  { key: "services",    label: "Services",                   color: "#8B9DC3" },
  { key: "beauty",      label: "Beauty & Personal Care",     color: "#B8A4B6" },
  { key: "vacant",      label: "Vacant",                     color: "#FF7D00" },
  { key: "other",       label: "Other / Unknown",            color: "#A8A8A8" },
];

interface Props {
  propertyId: string;
  address: string;
  postcode: string;
  initialLat?: number;
  initialLng?: number;
  initialRadius?: number;          // metres (default 180)
  initialExcluded?: string[];
  initialPreviewImageId?: string | null;
  onClose: () => void;
  onChange?: () => void;            // fires after each successful regenerate or pin
}

export function RetailContextPlanEditor({
  propertyId,
  address,
  postcode,
  initialLat,
  initialLng,
  initialRadius = 120,
  initialExcluded = [],
  initialPreviewImageId = null,
  onClose,
  onChange,
}: Props) {
  const { toast } = useToast();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<google.maps.Map | null>(null);
  const markerObj = useRef<google.maps.Marker | null>(null);
  const circleObj = useRef<google.maps.Circle | null>(null);
  const [centre, setCentre] = useState<{ lat: number; lng: number } | null>(
    typeof initialLat === "number" && typeof initialLng === "number"
      ? { lat: initialLat, lng: initialLng }
      : null,
  );
  const [radius, setRadius] = useState<number>(initialRadius);
  const [excluded, setExcluded] = useState<Set<string>>(new Set(initialExcluded));
  const [previewImageId, setPreviewImageId] = useState<string | null>(initialPreviewImageId);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [lastStats, setLastStats] = useState<{ buildingsCount: number; matchedUnits: number; voaRows: number } | null>(null);
  const [busy, setBusy] = useState<"render" | "pin" | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  // Initialise the Google map once, with marker + radius circle.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await loadGoogleMaps();
      if (cancelled) return;
      if (!ok) { setMapError("Could not load Google Maps."); return; }
      const el = mapRef.current;
      if (!el) return;

      const init = (lat: number, lng: number) => {
        if (cancelled) return;
        const map = new google.maps.Map(el, {
          center: { lat, lng },
          zoom: 17,
          mapTypeId: "roadmap",
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });
        mapObj.current = map;
        const marker = new google.maps.Marker({
          position: { lat, lng },
          map,
          draggable: true,
          title: "Drag to recentre the plan",
        });
        markerObj.current = marker;
        const circle = new google.maps.Circle({
          map,
          center: { lat, lng },
          radius,
          strokeColor: "#15616D",
          strokeOpacity: 0.9,
          strokeWeight: 1.5,
          fillColor: "#15616D",
          fillOpacity: 0.08,
        });
        circleObj.current = circle;
        marker.addListener("dragend", () => {
          const p = marker.getPosition();
          if (!p) return;
          const next = { lat: p.lat(), lng: p.lng() };
          setCentre(next);
          circle.setCenter(next);
        });
      };

      if (centre) {
        init(centre.lat, centre.lng);
      } else {
        // Geocode the property address client-side so we can drop the
        // marker before the user does anything. Use the callback form so
        // we don't depend on the newer Promise typing of @types/google.maps.
        const results = await new Promise<any[] | null>((resolve) => {
          const geo = new google.maps.Geocoder();
          geo.geocode({ address: [address, postcode].filter(Boolean).join(", ") }, (res: any, status: any) => {
            if (status === "OK" && res && res.length) resolve(res);
            else resolve(null);
          });
        });
        const loc = results?.[0]?.geometry?.location;
        if (loc) {
          const next = { lat: loc.lat(), lng: loc.lng() };
          setCentre(next);
          init(next.lat, next.lng);
        } else {
          setMapError("Could not find the address on the map.");
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the radius circle in sync.
  useEffect(() => {
    if (circleObj.current) circleObj.current.setRadius(radius);
  }, [radius]);

  const toggleCategory = (key: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const regenerate = async () => {
    setBusy("render");
    try {
      const r = await fetch("/api/retail-context-plan/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          postcode,
          propertyId,
          radius,
          customCenter: centre,
          excludeCategories: [...excluded],
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setPreviewImageId(data.imageId);
      setPreviewAssetId(data.assetId);
      setLastStats({
        buildingsCount: data.buildingsCount ?? 0,
        matchedUnits: data.matchedUnits ?? 0,
        voaRows: data.voaRows ?? 0,
      });
      onChange?.();
      const buildings = data.buildingsCount ?? 0;
      if (buildings === 0) {
        toast({
          title: "Render came back blank",
          description: "OSM Overpass returned no buildings — usually a temporary rate-limit. Try Regenerate again.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Plan regenerated", description: `${buildings} buildings, ${data.matchedUnits ?? 0} units matched` });
      }
    } catch (e: any) {
      toast({ title: "Regenerate failed", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const useThisVersion = async () => {
    if (!previewAssetId) return;
    setBusy("pin");
    try {
      const r = await fetch(`/api/property-imagery/asset/${previewAssetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: true }),
      });
      if (!r.ok) throw new Error(await r.text());
      onChange?.();
      toast({ title: "Saved as canonical", description: "This version will be used by Why Buy + briefs." });
      onClose();
    } catch (e: any) {
      toast({ title: "Couldn't save", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const previewSrc = previewImageId
    ? `/api/image-studio/${previewImageId}/full`
    : null;

  return (
    <div className="fixed inset-0 bg-black/60 z-[55] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm flex items-center gap-2"><MapPin className="w-4 h-4" /> Retail Context Plan editor</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Drag the marker to recentre, adjust the radius, toggle which retail bands are shown, then regenerate.
              Each render is saved — pin one as the canonical version.
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 p-3 overflow-hidden">
          {/* Left: controls + map */}
          <div className="flex flex-col gap-3 overflow-y-auto">
            <div className="rounded-md overflow-hidden border" style={{ height: 320 }} ref={mapRef} />
            {mapError && <div className="text-xs text-destructive">{mapError}</div>}

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                <span>Radius</span>
                <span className="text-foreground">{radius} m</span>
              </label>
              <input
                type="range"
                min={40}
                max={200}
                step={10}
                value={radius}
                onChange={(e) => setRadius(parseInt(e.target.value, 10))}
                className="w-full"
              />
              <div className="flex justify-between text-[9px] text-muted-foreground">
                <span>40m · close</span>
                <span>120m · default</span>
                <span>200m · block</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground">Show categories</label>
              <div className="grid grid-cols-2 gap-1">
                {CATEGORIES.map((c) => {
                  const showing = !excluded.has(c.key);
                  return (
                    <label
                      key={c.key}
                      className={`flex items-center gap-1.5 text-[11px] rounded border px-2 py-1 cursor-pointer ${
                        showing ? "bg-background" : "bg-muted/40 opacity-60"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={showing}
                        onChange={() => toggleCategory(c.key)}
                        className="h-3 w-3"
                      />
                      <span className="inline-block w-3 h-3 rounded-sm" style={{ background: c.color }} />
                      <span className="truncate">{c.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Right: preview */}
          <div className="flex flex-col gap-2 overflow-hidden">
            <div className="flex-1 rounded-md border bg-muted/20 flex items-center justify-center overflow-hidden relative">
              {previewSrc ? (
                <img
                  src={previewSrc}
                  alt="Retail context plan preview"
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <div className="text-xs text-muted-foreground italic text-center p-12">
                  {busy === "render"
                    ? "Rendering…"
                    : "Click Regenerate to render the first version with the current settings."}
                </div>
              )}
              {busy === "render" && previewSrc && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-white" />
                </div>
              )}
            </div>
            {lastStats && (
              <div className={`text-[10px] px-2 py-1.5 rounded border ${
                lastStats.buildingsCount === 0
                  ? "border-destructive/40 bg-destructive/5 text-destructive"
                  : "border-border bg-background text-muted-foreground"
              }`}>
                {lastStats.buildingsCount === 0 ? (
                  <>
                    <strong>Render came back blank.</strong> OSM Overpass returned 0 buildings —
                    likely a temporary rate-limit on the public API. Hit Regenerate again to retry.
                  </>
                ) : (
                  <>
                    <strong>{lastStats.buildingsCount}</strong> buildings ·
                    {" "}<strong>{lastStats.matchedUnits}</strong> units matched ·
                    {" "}<strong>{lastStats.voaRows}</strong> VOA rows in range
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sticky action footer — always visible regardless of how
            far the controls column is scrolled. */}
        <div className="border-t bg-background px-4 py-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={useThisVersion}
            disabled={busy !== null || !previewAssetId}
            className="h-9"
            title={previewAssetId ? "Pin this version as the canonical retail context plan" : "Regenerate first"}
          >
            {busy === "pin" && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
            Use this version
          </Button>
          <Button
            size="sm"
            onClick={regenerate}
            disabled={busy !== null || !centre}
            className="h-9 min-w-[140px]"
          >
            {busy === "render" && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
            Regenerate
          </Button>
        </div>
      </div>
    </div>
  );
}
