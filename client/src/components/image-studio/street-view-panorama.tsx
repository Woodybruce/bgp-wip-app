import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

type POV = { heading: number; pitch: number; fov: number };

interface Props {
  address: string;
  lat?: number;
  lng?: number;
  onPovChange: (pov: POV) => void;
  onPositionChange?: (pos: { lat: number; lng: number }) => void;
}

// Panorama zoom → Street View Static API fov. The API accepts 10-120°.
// Google's own mapping is roughly fov ≈ 180 / 2^zoom for zoom 0..3.
function zoomToFov(zoom: number): number {
  const fov = 180 / Math.pow(2, Math.max(0, zoom));
  return Math.min(120, Math.max(10, Math.round(fov)));
}

export function StreetViewPanoramaCapture({
  address,
  lat,
  lng,
  onPovChange,
  onPositionChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      const ok = await loadGoogleMaps();
      if (cancelled) return;
      if (!ok) {
        setError("Could not load Google Maps.");
        setLoading(false);
        return;
      }

      const el = containerRef.current;
      if (!el) return;

      const attach = (position: google.maps.LatLng | google.maps.LatLngLiteral) => {
        if (cancelled) return;
        if (!panoRef.current) {
          panoRef.current = new google.maps.StreetViewPanorama(el, {
            position,
            pov: { heading: 0, pitch: 0 },
            zoom: 1,
            addressControl: false,
            fullscreenControl: false,
            motionTracking: false,
            motionTrackingControl: false,
            enableCloseButton: false,
            linksControl: true,
            panControl: true,
            zoomControl: true,
          });
          panoRef.current.addListener("pov_changed", () => {
            const pov = panoRef.current?.getPov();
            if (!pov) return;
            const zoom = panoRef.current?.getZoom() ?? 1;
            onPovChange({
              heading: Math.round(pov.heading ?? 0),
              pitch: Math.round(pov.pitch ?? 0),
              fov: zoomToFov(zoom),
            });
          });
          panoRef.current.addListener("position_changed", () => {
            const p = panoRef.current?.getPosition();
            if (p) onPositionChange?.({ lat: p.lat(), lng: p.lng() });
          });
          // Fire once so initial values propagate.
          const p = panoRef.current.getPosition();
          if (p) onPositionChange?.({ lat: p.lat(), lng: p.lng() });
          onPovChange({ heading: 0, pitch: 0, fov: zoomToFov(1) });
        } else {
          panoRef.current.setPosition(position);
          panoRef.current.setPov({ heading: 0, pitch: 0 });
          panoRef.current.setZoom(1);
        }
        setLoading(false);
      };

      if (typeof lat === "number" && typeof lng === "number") {
        attach({ lat, lng });
      } else if (address) {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address }, (results, status) => {
          if (cancelled) return;
          if (status === "OK" && results?.[0]?.geometry?.location) {
            attach(results[0].geometry.location);
          } else {
            setError("Could not find this address.");
            setLoading(false);
          }
        });
      } else {
        setError("Enter an address first.");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, lat, lng]);

  useEffect(() => {
    return () => {
      panoRef.current = null;
    };
  }, []);

  return (
    <div className="relative w-full h-[420px] rounded-lg overflow-hidden border bg-muted">
      <div ref={containerRef} className="absolute inset-0" />
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 pointer-events-none">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground p-4 text-center">
          <div>
            <MapPin className="h-5 w-5 mx-auto mb-1 opacity-50" /> {error}
          </div>
        </div>
      )}
    </div>
  );
}
