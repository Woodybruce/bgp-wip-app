import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface Store {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  status: string | null;
}

// Small read-only Leaflet map showing a brand's UK store footprint. Used as
// a supporting visual on the brand profile panel. Markers are coloured by
// status (open/closed/unconfirmed). Auto-fits bounds to the store set.
export function BrandPortfolioMap({ stores }: { stores: Store[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    const geocoded = stores.filter(s => typeof s.lat === "number" && typeof s.lng === "number" && Number.isFinite(s.lat) && Number.isFinite(s.lng));
    if (geocoded.length === 0) return;

    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: false,
      });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
      }).addTo(mapInstance.current);
    } else {
      mapInstance.current.eachLayer((l) => {
        if (l instanceof L.CircleMarker) mapInstance.current!.removeLayer(l);
      });
    }

    const bounds = L.latLngBounds([]);
    for (const s of geocoded) {
      const colour = s.status === "closed" ? "#ef4444" : s.status === "open" ? "#10b981" : "#6b7280";
      const marker = L.circleMarker([s.lat!, s.lng!], {
        radius: 5,
        weight: 1,
        color: "#fff",
        fillColor: colour,
        fillOpacity: 0.9,
      }).addTo(mapInstance.current);
      marker.bindTooltip(s.name, { direction: "top", offset: [0, -4] });
      bounds.extend([s.lat!, s.lng!]);
    }
    mapInstance.current.fitBounds(bounds, { padding: [16, 16], maxZoom: 10 });

    return () => {
      // Don't destroy; next render just re-adds markers.
    };
  }, [stores]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  const geocodedCount = stores.filter(s => typeof s.lat === "number" && typeof s.lng === "number").length;
  if (geocodedCount === 0) return null;

  return (
    <div className="rounded-md overflow-hidden border" style={{ height: 180 }}>
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
