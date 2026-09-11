/**
 * Google3DView — full-screen overlay rendering Google Photorealistic 3D
 * Tiles centred on a given lat/lng. Uses the `<gmp-map-3d>` web component
 * from google.maps.maps3d (loaded via importLibrary).
 *
 * Mounted from MAP BGP via the "🌐 3D" button. Closes back to the 2D
 * Leaflet map. Different runtime — Leaflet layers don't carry over;
 * this is purely the Google 3D experience.
 *
 * Requires the Maps JS API key to have "Map Tiles API" / "Photorealistic
 * 3D Tiles" enabled on the Google Cloud project. If the key doesn't
 * have it, the component shows an error message.
 */

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { Loader2 } from "lucide-react";

interface Props {
  lat: number;
  lng: number;
  altitude?: number;   // metres above ground for the camera target (default 200)
  range?: number;      // camera range in metres — distance from target (default 600)
  tilt?: number;       // 0-90 degrees, 0 = top-down (default 65)
  heading?: number;    // 0-360 degrees, 0 = north (default 0)
  label?: string;      // optional label shown in the toolbar (e.g. property address)
  onClose: () => void;
}

export function Google3DView({
  lat,
  lng,
  altitude = 200,
  range = 600,
  tilt = 65,
  heading = 0,
  label,
  onClose,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapElRef = useRef<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await loadGoogleMaps();
      if (cancelled) return;
      if (!ok) {
        setError("Could not load Google Maps. Check your API key.");
        setLoading(false);
        return;
      }
      try {
        // @ts-ignore — maps3d isn't in @types/google.maps yet
        await google.maps.importLibrary("maps3d");
        if (cancelled) return;
        const el = containerRef.current;
        if (!el) return;
        // Render the <gmp-map-3d> web component imperatively so we don't
        // need React JSX intrinsics for a custom element.
        const map3d = document.createElement("gmp-map-3d");
        map3d.setAttribute("center", `${lat}, ${lng}, ${altitude}`);
        map3d.setAttribute("range", String(range));
        map3d.setAttribute("tilt", String(tilt));
        map3d.setAttribute("heading", String(heading));
        map3d.style.cssText = "width:100%;height:100%;display:block;";
        el.replaceChildren(map3d);
        mapElRef.current = map3d;
        setLoading(false);
      } catch (err: any) {
        setError(
          err?.message ||
            "Failed to load 3D view. Make sure the Maps API key has the Map Tiles API / Photorealistic 3D Tiles enabled.",
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      mapElRef.current = null;
    };
  }, [lat, lng, altitude, range, tilt, heading]);

  // Close on Escape — standard modal UX.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/85 flex flex-col">
      <div className="bg-background border-b px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">🌐 3D View</span>
          <span className="text-xs text-muted-foreground">Google Photorealistic Tiles</span>
          {label && <span className="text-xs text-muted-foreground">· {label}</span>}
        </div>
        <button
          onClick={onClose}
          className="text-xs border rounded px-3 py-1 hover:bg-muted"
        >
          ← Back to 2D
        </button>
      </div>
      <div className="flex-1 relative" ref={containerRef}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-white">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading 3D…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="bg-background rounded-lg border p-5 max-w-md text-sm">
              <p className="font-semibold mb-1">3D not available</p>
              <p className="text-muted-foreground">{error}</p>
              <p className="text-xs text-muted-foreground mt-3">
                In Google Cloud Console → APIs & Services → enable "Map Tiles API" and add it to the API key restrictions.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
