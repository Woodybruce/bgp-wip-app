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
  // Server-attached BGP-property proximity (within 150m of a crm_property
  // with at least one active deal). When present, the dot turns gold and
  // is drawn slightly larger so the user can see at a glance which of a
  // brand's UK stores BGP is currently active at.
  bgpProperty?: {
    id: string;
    name: string;
    distance_m: number;
    active_deals: number;
  };
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
  // Pixel height, or "100%" to fill a flex/grid parent (dashboard widget).
  // NB callers used to pass a huge number (9999) to mean "fill" — that made
  // Leaflet initialise ~9999px tall, so fitBounds centred the map thousands
  // of pixels below the visible slice and the widget looked blank.
  height?: number | string;
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
      // OSM — CARTO basemaps started requiring an API key (2026-09-01).
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
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
      // Marker colour priority:
      //   1. bgpProperty — BGP is instructed at this address (gold, bigger)
      //   2. tone=linked   — already in CRM (landlord profile)
      //   3. tone=unlinked — scraped / Land Registry only
      //   4. status=closed — store permanently closed (red)
      //   5. status=open   — store operational (green)
      //   6. default       — status unknown (grey)
      let colour: string;
      let radius = 5;
      let outline = "#fff";
      let outlineWeight = 1;
      if (s.bgpProperty) {
        colour = "#f59e0b";          // amber-500 — BGP gold
        radius = 8;
        outline = "#1f2937";          // gray-800 ring so gold pops
        outlineWeight = 2;
      } else if (s.tone === "linked") { colour = "#0f766e"; radius = 6; }
      else if (s.tone === "unlinked") colour = "#94a3b8";
      else if (s.status === "closed") colour = "#ef4444";
      else if (s.status === "open")   colour = "#10b981";
      else                            colour = "#6b7280";

      const marker = L.circleMarker([s.lat!, s.lng!], {
        radius,
        weight: outlineWeight,
        color: outline,
        fillColor: colour,
        fillOpacity: 0.9,
      }).addTo(mapInstance.current);

      // Tooltip — surface the BGP property link when applicable so the
      // user understands WHY this dot is gold (e.g. "BGP active here:
      // Bluewater · 3 deals in flight").
      let tip = s.address ? `${s.name}<br/><span style="font-size:10px;opacity:0.7">${s.address}</span>` : s.name;
      if (s.bgpProperty) {
        tip += `<br/><span style="color:#f59e0b;font-size:10px;font-weight:600">★ BGP active: ${s.bgpProperty.name}${s.bgpProperty.active_deals > 0 ? ` · ${s.bgpProperty.active_deals} deal${s.bgpProperty.active_deals === 1 ? "" : "s"}` : ""}</span>`;
      }
      marker.bindTooltip(tip, { direction: "top", offset: [0, -4] });

      if (onSelect || s.href || s.bgpProperty) {
        marker.on("click", () => {
          if (onSelect) onSelect(s);
          else if (s.bgpProperty) window.location.href = `/properties/${s.bgpProperty.id}`;
          else if (s.href) window.location.href = s.href;
        });
        const el = (marker as any)._path;
        if (el) el.style.cursor = "pointer";
      }
      bounds.extend([s.lat!, s.lng!]);
    }
    // animate:false — a fitBounds zoom animation left running while the
    // dashboard grid re-renders/unmounts the widget crashes Leaflet's
    // _onZoomTransitionEnd ("_leaflet_pos of undefined") on every zoom end.
    mapInstance.current.fitBounds(bounds, { padding: [16, 16], maxZoom: 10, animate: false });
  }, [stores, onSelect]);

  // The dashboard renders this inside a resizable grid widget, so the
  // container is often 0-height (or the wrong height) at init and changes
  // afterwards. Leaflet caches its size, so without invalidateSize the tiles
  // and centring stay wrong and the panel reads as blank.
  useEffect(() => {
    const el = mapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const map = mapInstance.current;
        if (!map) return;
        map.invalidateSize();
        // Re-fit so the pins stay framed at the new size.
        const pts = stores
          .filter(s => typeof s.lat === "number" && typeof s.lng === "number" && Number.isFinite(s.lat) && Number.isFinite(s.lng))
          .map(s => [s.lat!, s.lng!] as [number, number]);
        if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [16, 16], maxZoom: 10, animate: false });
      });
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); };
  }, [stores]);

  useEffect(() => {
    return () => {
      if (mapInstance.current) {
        // Cancel any in-flight pan/zoom before teardown — removing a map
        // mid-animation leaves its transition handler firing on dead panes.
        try { mapInstance.current.stop(); } catch {}
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
