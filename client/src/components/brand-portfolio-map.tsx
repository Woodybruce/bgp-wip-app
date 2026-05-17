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
  // Optional landlord-profile fields. tone='linked' = saturated marker
  // (already a CRM property), tone='unlinked' = grey marker (scraped /
  // Land Registry only, click to promote into CRM). When omitted we
  // fall back to the legacy `status`-based colouring used on brand maps.
  tone?: "linked" | "unlinked";
  href?: string;            // optional deep-link on marker click
}

// Small read-only Leaflet map showing a portfolio footprint. Used both
// on the brand profile (stores) and the landlord profile (CRM +
// scraped). Always renders a basemap — empty state shows the UK
// centred so the panel doesn't visibly disappear while geocoding runs.
export function BrandPortfolioMap({
  stores,
  height = 180,
  onSelect,
  alwaysRender = false,
}: {
  stores: Store[];
  height?: number;
  onSelect?: (s: Store) => void;
  alwaysRender?: boolean;     // landlord-profile flag — keep map up even with 0 markers
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    const geocoded = stores.filter(s => typeof s.lat === "number" && typeof s.lng === "number" && Number.isFinite(s.lat) && Number.isFinite(s.lng));

    if (!mapInstance.current) {
      // Default view: UK roughly centred at Coventry, zoom 6 — gets
      // amended by fitBounds below as soon as we have markers.
      mapInstance.current = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: false,
        doubleClickZoom: true,
      }).setView([54.0, -2.0], 5);
      L.control.zoom({ position: "topright" }).addTo(mapInstance.current);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
      }).addTo(mapInstance.current);
    } else {
      mapInstance.current.eachLayer((l) => {
        if (l instanceof L.CircleMarker) mapInstance.current!.removeLayer(l);
      });
    }

    if (geocoded.length === 0) return;

    const bounds = L.latLngBounds([]);
    for (const s of geocoded) {
      // Two-tone landlord colouring, with status-based fallback for brand stores.
      let colour: string;
      if (s.tone === "linked") colour = "#0f766e";        // teal-700 — already in CRM
      else if (s.tone === "unlinked") colour = "#94a3b8"; // slate-400 — scraped / Land Registry
      else if (s.status === "closed") colour = "#ef4444";
      else if (s.status === "open") colour = "#10b981";
      else colour = "#6b7280";

      const marker = L.circleMarker([s.lat!, s.lng!], {
        radius: s.tone === "linked" ? 6 : 5,
        weight: 1,
        color: "#fff",
        fillColor: colour,
        fillOpacity: 0.9,
      }).addTo(mapInstance.current);
      const tip = s.address ? `${s.name}<br/><span style="font-size:10px;opacity:0.7">${s.address}</span>` : s.name;
      marker.bindTooltip(tip, { direction: "top", offset: [0, -4] });
      if (onSelect || s.href) {
        marker.on("click", () => {
          if (onSelect) onSelect(s);
          else if (s.href) window.location.href = s.href;
        });
        const el = (marker as any)._path;
        if (el) el.style.cursor = "pointer";
      }
      bounds.extend([s.lat!, s.lng!]);
    }
    mapInstance.current.fitBounds(bounds, { padding: [16, 16], maxZoom: 10 });
  }, [stores, onSelect]);

  useEffect(() => {
    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  const geocodedCount = stores.filter(s => typeof s.lat === "number" && typeof s.lng === "number").length;
  if (geocodedCount === 0 && !alwaysRender) return null;

  return (
    <div className="rounded-md overflow-hidden border" style={{ height }}>
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
