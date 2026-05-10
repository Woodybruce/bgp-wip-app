/**
 * MAP BGP — the consolidated map page.
 *
 * Mounts the existing EdozoMap engine in global mode (no property scope)
 * — preserves every layer Edozo already supports (OS NGD buildings, OS
 * UPRNs, OS sites, title boundaries, planning, listed, conservation,
 * flood, comps, deals, lease events, CRM properties) and adds a top-
 * level entry point so the same map is reachable from anywhere in the
 * app, not just Property Intelligence → Map tab.
 *
 * Property Intelligence → Map keeps working as before (renders
 * EdozoMap with a property-scoped `initialSearch`) — this page is just
 * the unscoped, full-screen version with everything off by default.
 *
 * Deep links:
 *   /map-bgp                         — global, no scope
 *   /map-bgp?address=…&postcode=…    — pre-zoomed to a property
 */

import { useSearch } from "wouter";
import EdozoMap from "@/pages/edozo-map";

export default function MapBgp() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const address = params.get("address") || "";
  const postcode = params.get("postcode") || "";
  const initialSearch = (address || postcode) ? { address, postcode: postcode || null } : null;

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col">
      <EdozoMap initialSearch={initialSearch} />
    </div>
  );
}
