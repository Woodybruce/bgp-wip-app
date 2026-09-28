// Small label rules for the property page (Woody, 2026-09-28: "the royal
// exchange board — what a mess"), shared by the page and the server routes
// that feed it.

// BGP's own teams — the values crm_properties.bgp_engagement and
// crm_deals.team should hold. Imports and deal edits let other words in
// ("Landlord" from acting-for columns, "BGP", the retired "London Leasing").
export const BGP_TEAMS = ["Development", "London F&B", "London Retail", "National Leasing", "Investment", "Tenant Rep", "Lease Advisory", "Office / Corporate", "Landsec"] as const;

export function bgpTeamsOnly(values: string[] | string | null | undefined): string[] {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  return [...new Set(list.map(v => BGP_TEAMS.find(t => t.toLowerCase() === String(v || "").trim().toLowerCase())).filter((t): t is typeof BGP_TEAMS[number] => !!t))];
}

// "The Royal Exchange" and "Royal Exchange" are the same name: case,
// punctuation and a leading "The" don't make an alias.
const nameKey = (value: string | null | undefined) =>
  String(value || "").toLowerCase().replace(/&/g, " and ").replace(/^\s*the\s+/, "").replace(/[^a-z0-9]+/g, "");

export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = nameKey(a);
  return !!ka && ka === nameKey(b);
}

// Other names worth showing under the title: not the name itself, not a
// full postal address, each only once.
export function displayAliases(name: string | null | undefined, aliases: unknown): string[] {
  const seen = new Set([nameKey(name)]);
  const out: string[] = [];
  for (const raw of Array.isArray(aliases) ? aliases : []) {
    const alias = String(raw || "").trim();
    const key = nameKey(alias);
    if (!key || seen.has(key) || /,\s*UK$|^\d+.*,.*,/i.test(alias)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

// On a property's own page its name inside a deal or unit label is noise:
// "Royal Exchange - Inception T2" → "Inception T2", "Nando's – Bluewater
// Shopping Centre" → "Nando's". Leaves the label alone when nothing is left.
export function withoutPropertyName(label: string | null | undefined, propertyName: string | null | undefined): string {
  const text = String(label || "").trim();
  const core = String(propertyName || "").split(/[,(]/)[0].replace(/^\s*the\s+/i, "").trim();
  if (!text || core.length < 4) return text;
  const esc = core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lead = text.replace(new RegExp(`^(?:the\\s+)?${esc}\\b\\s*[-–—:·,|]*\\s*`, "i"), "");
  if (lead !== text) return lead.trim() || text;
  const at = text.toLowerCase().indexOf(core.toLowerCase());
  if (at > 2) {
    const cut = text.slice(0, at).replace(/\bthe\s*$/i, "").replace(/[\s,–—·|-]+$/, "").trim();
    return cut || text;
  }
  return text;
}
