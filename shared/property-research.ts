import { isArchivedTenancy } from "./tenancy-schedule-display";

export interface PropertyResearchContext {
  mode: "centre" | "local" | "not_applicable";
  assetClass: string;
  uses: string[];
  reason: string;
  cacheKey: string;
}

// Keep these expressions compatible with both JavaScript and PostgreSQL so
// the nightly candidate selection recognises the same recorded uses as the UI.
// Generic E also covers offices/medical uses, so only a/b/d imply this research.
export const PROPERTY_RESEARCH_USE_PATTERN = String.raw`(^|[^a-z0-9_])(retail|shop(?:s|ping)?|restaurants?|caf[eé]s?|coffee|food|f\s*&\s*b|leisure|fitness|gyms?|wellness|bars?|pubs?|kiosks?|takeaways?|takeouts?|a[1345]|e\s*\(\s*[abd]\s*\))([^a-z0-9_]|$)`;
export const PROPERTY_RESEARCH_CENTRE_PATTERN = String.raw`(^|[^a-z0-9_])(shopping cent(?:re|er)|retail park|outlet (?:centre|village))([^a-z0-9_]|$)`;
const retailUse = new RegExp(PROPERTY_RESEARCH_USE_PATTERN, "i");
const centreUse = new RegExp(PROPERTY_RESEARCH_CENTRE_PATTERN, "i");
const matchesRetailUse = (value: string) => retailUse.test(value.normalize("NFKD").replace(/\p{M}/gu, ""));

export function propertyResearchContext(property: { assetClass?: string | null; propertyView?: string | null }, units: Array<{ permitted_use?: string | null; status?: string | null; occupancy_status?: string | null }> = []): PropertyResearchContext {
  const assetClass = property.assetClass?.trim() || "";
  const uses = [...new Set(units.filter(unit => !isArchivedTenancy(unit))
    .map(unit => unit.permitted_use?.trim()).filter((use): use is string => Boolean(use)))].sort();
  const explicitCentre = centreUse.test(assetClass);
  const hasRetail = explicitCentre || matchesRetailUse(assetClass) || uses.some(matchesRetailUse);
  const mode = !hasRetail ? "not_applicable" : explicitCentre || property.propertyView === "centre" ? "centre" : "local";
  const reason = mode === "not_applicable"
    ? "Brand gap research needs recorded retail, hospitality or leisure space. Use Property intelligence for this building, or record the relevant unit use in its tenancy schedule."
    : mode === "local"
      ? "Local occupier opportunities for the recorded retail or leisure space. Nearby shops are market context, not evidence of tenants in this building."
      : "Shopping-centre occupier mix and nearby competing destinations.";
  return { mode, assetClass, uses, reason, cacheKey: JSON.stringify(["property-research-v2", mode, assetClass, uses]) };
}
