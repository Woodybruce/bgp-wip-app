import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Esri Light Grey Canvas — muted basemap that sits quietly under the brand
// palette (Woody picked it over the default OSM tiles, Sep 2026). Free tier,
// no key; attribution required. Wine marker matches the listing chrome.
const TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const ATTRIBUTION = "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors";

const MARKER = L.divIcon({
  className: "",
  html: '<span style="display:block;width:18px;height:18px;border-radius:9999px;background:#6e0c25;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.35)"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

export default function ListingMap({ lat, lon, zoom = 15, marker = true, pins = [], className = "" }: { lat: number; lon: number; zoom?: number; marker?: boolean; pins?: Array<{ lat: number; lon: number; label?: string }>; className?: string }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, {
      center: [lat, lon],
      zoom,
      scrollWheelZoom: false,
      attributionControl: true,
    });
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 16 }).addTo(map);
    if (marker) L.marker([lat, lon], { icon: MARKER, keyboard: false }).addTo(map);
    for (const p of pins) { const m = L.marker([p.lat, p.lon], { icon: MARKER, keyboard: false }).addTo(map); if (p.label) m.bindTooltip(p.label, { direction: "top", offset: [0, -10] }); }
    return () => { map.remove(); };
  }, [lat, lon, zoom, marker, pins.length]);

  return <div ref={el} className={`border border-bgp-line ${className}`} aria-label="Location map" />;
}
