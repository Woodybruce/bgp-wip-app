/**
 * MAP BGP — the consolidated map page.
 *
 * Mounts the existing EdozoMap engine in global mode (no property scope)
 * — preserves every layer Edozo already supports (OS NGD buildings, OS
 * UPRNs, OS sites, title boundaries, planning, listed, conservation,
 * flood, comps, deals, lease events, CRM properties, Pathway runs,
 * Retail Context, Street View on-click) and adds a top-level entry
 * point + a "🌐 3D View" toggle that swaps to Google Photorealistic
 * 3D Tiles centred wherever the 2D map was last looking.
 *
 * Property Intelligence → Map keeps working as before (renders
 * EdozoMap with a property-scoped `initialSearch`) — this page is just
 * the unscoped, full-screen version with everything off by default.
 *
 * Deep links:
 *   /map-bgp                         — global, no scope
 *   /map-bgp?address=…&postcode=…    — pre-zoomed to a property
 */

import { useState } from "react";
import { useSearch } from "wouter";
import EdozoMap from "@/pages/edozo-map";
import { Google3DView } from "@/components/google-3d-view";

export default function MapBgp() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const address = params.get("address") || "";
  const postcode = params.get("postcode") || "";
  const initialSearch = (address || postcode) ? { address, postcode: postcode || null } : null;

  const [show3D, setShow3D] = useState(false);
  const [centre, setCentre] = useState<{ lat: number; lng: number }>({ lat: 51.5074, lng: -0.1278 });

  const open3D = () => {
    // Pick up the last centre EdozoMap wrote to localStorage on moveend.
    // Falls back to London if nothing's stored yet.
    try {
      const saved = localStorage.getItem("bgp_map_last_centre");
      if (saved) {
        const c = JSON.parse(saved);
        if (Number.isFinite(c?.lat) && Number.isFinite(c?.lng)) {
          setCentre({ lat: c.lat, lng: c.lng });
        }
      }
    } catch { /* ignore */ }
    setShow3D(true);
  };

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col relative">
      {/* Floating 3D View button, top-right of the map.
          Sits above Leaflet's panes (z 10 is above tile/marker/popup). */}
      <button
        onClick={open3D}
        className="absolute top-3 right-3 z-[400] bg-white border border-gray-200 shadow-md rounded px-3 py-1.5 text-xs font-medium hover:bg-gray-50 flex items-center gap-1.5"
        title="Open Google Photorealistic 3D view at the current map centre"
      >
        🌐 3D View
      </button>
      <EdozoMap initialSearch={initialSearch} />
      {show3D && (
        <Google3DView
          lat={centre.lat}
          lng={centre.lng}
          label={address || undefined}
          onClose={() => setShow3D(false)}
        />
      )}
    </div>
  );
}
