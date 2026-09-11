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

import { useState, useEffect } from "react";
import { useSearch } from "wouter";
import EdozoMap from "@/pages/edozo-map";
import { Google3DView } from "@/components/google-3d-view";
import { useToast } from "@/hooks/use-toast";
import { toPng } from "html-to-image";

export default function MapBgp() {
  const { toast } = useToast();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const address = params.get("address") || "";
  const postcode = params.get("postcode") || "";
  const propertyId = params.get("propertyId") || "";
  // ?layer=retail (or comma-separated list) auto-toggles layers on arrival.
  // Used by the Sharp retail editor's "Open in MAP BGP" link so the user
  // lands with Retail Context already on, no extra clicks.
  const initialLayers = (params.get("layer") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const initialSearch = (address || postcode) ? { address, postcode: postcode || null } : null;

  const [show3D, setShow3D] = useState(false);
  const [centre, setCentre] = useState<{ lat: number; lng: number }>({ lat: 51.5074, lng: -0.1278 });
  const [exporting, setExporting] = useState(false);

  // Auto-toggle requested layers once EdozoMap has mounted. Hacky DOM
  // click via the layer toggle's data-testid — much smaller than threading
  // an initialLayers prop through Edozo's 4500-line layer state machine.
  useEffect(() => {
    if (initialLayers.length === 0) return;
    const t = setTimeout(() => {
      for (const layer of initialLayers) {
        const btn = document.querySelector<HTMLButtonElement>(
          `[data-testid="layer-toggle-${layer}"]`,
        );
        if (btn && btn.textContent?.includes("OFF")) btn.click();
      }
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const exportPlan = async () => {
    // Capture the Leaflet map container as a PNG, post to the server
    // which frames it with a BGP title block + legend and saves into
    // image_studio_images / property_imagery_assets.
    const mapEl = document.querySelector(".leaflet-container") as HTMLElement | null;
    if (!mapEl) {
      toast({ title: "Map not found", description: "Couldn't locate the map element to capture.", variant: "destructive" });
      return;
    }
    setExporting(true);
    try {
      // Tile layers can be cross-origin and break html-to-image's default
      // CORS handling. skipFonts + filter out controls keeps it clean.
      const dataUrl = await toPng(mapEl, {
        pixelRatio: 2,
        skipFonts: true,
        filter: (node: HTMLElement) =>
          !node.classList?.contains("leaflet-control-container") &&
          !node.classList?.contains("leaflet-control") &&
          !node.classList?.contains("leaflet-popup-pane"),
        cacheBust: true,
      });
      const r = await fetch("/api/retail-context-plan/export-from-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: propertyId || null,
          address: address || null,
          postcode: postcode || null,
          imageDataUrl: dataUrl,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      toast({
        title: "Plan exported",
        description: propertyId
          ? "Saved to Image Studio + linked to the property."
          : "Saved to Image Studio (no property linked).",
      });
      // Open in a new tab so user can see what got saved.
      if (data.imageId) {
        window.open(`/api/image-studio/${data.imageId}/full`, "_blank");
      }
    } catch (err: any) {
      toast({ title: "Export failed", description: err?.message || "", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col relative">
      {/* Floating action buttons, top-right of the map. Sit above
          Leaflet's panes (z 400 is above tile/marker/popup). */}
      <div className="absolute top-3 right-3 z-[400] flex gap-2">
        <button
          onClick={exportPlan}
          disabled={exporting}
          className="bg-white border border-gray-200 shadow-md rounded px-3 py-1.5 text-xs font-medium hover:bg-gray-50 flex items-center gap-1.5 disabled:opacity-60"
          title="Capture the current map view, frame it as a BGP Retail Context Plan, save to Image Studio"
        >
          {exporting ? "⏳ Exporting…" : "📋 Export as Retail Plan"}
        </button>
        <button
          onClick={open3D}
          className="bg-white border border-gray-200 shadow-md rounded px-3 py-1.5 text-xs font-medium hover:bg-gray-50 flex items-center gap-1.5"
          title="Open Google Photorealistic 3D view at the current map centre"
        >
          🌐 3D View
        </button>
      </div>
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
