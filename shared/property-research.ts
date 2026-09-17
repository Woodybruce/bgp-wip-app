export interface PropertyResearchContext {
  mode: "centre" | "local" | "not_applicable";
  assetClass: string;
  uses: string[];
  reason: string;
  cacheKey: string;
}

const retailUse = /\b(retail|shop(?:ping)?|restaurant|caf[eé]|coffee|food|f&b|leisure|fitness|gym|wellness|bar|pub|kiosk|takeaway|takeout|a1|a3|a4|a5)\b/i;
const matchesRetailUse = (value: string) => retailUse.test(value.normalize("NFKD").replace(/\p{M}/gu, ""));

export function propertyResearchContext(property: { assetClass?: string | null; propertyView?: string | null }, units: Array<{ permitted_use?: string | null; status?: string | null }> = []): PropertyResearchContext {
  const assetClass = property.assetClass?.trim() || "";
  const uses = [...new Set(units.filter(unit => unit.status?.trim().toLowerCase() !== "archived")
    .map(unit => unit.permitted_use?.trim()).filter((use): use is string => Boolean(use)))].sort();
  const explicitCentre = /\bshopping cent(?:re|er)\b|\bretail park\b|\boutlet (?:centre|village)\b/i.test(assetClass);
  const hasRetail = explicitCentre || matchesRetailUse(assetClass) || uses.some(matchesRetailUse);
  const mode = !hasRetail ? "not_applicable" : explicitCentre || property.propertyView === "centre" ? "centre" : "local";
  const reason = mode === "not_applicable"
    ? "Brand gap research needs recorded retail, hospitality or leisure space. Use Property intelligence for this building, or record the relevant unit use in its tenancy schedule."
    : mode === "local"
      ? "Local occupier opportunities for the recorded retail or leisure space. Nearby shops are market context, not evidence of tenants in this building."
      : "Shopping-centre occupier mix and nearby competing destinations.";
  return { mode, assetClass, uses, reason, cacheKey: JSON.stringify(["property-research-v2", mode, assetClass, uses]) };
}
