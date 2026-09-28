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

// A property's SharePoint folders per team, plus named extra folders (Woody,
// 2026-09-28: "there is also a lease folder — can we allow for an investment
// and London leasing folder?"). crm_properties.sharepoint_team_folders holds
// {label: url}: a label naming a BGP team is that team's folder, any other
// label ("Leases") is an extra folder with its own tab. The single
// sharepoint_folder_url stays the default for team tabs without their own.
export type PropertyFolderTab = { label: string; url: string | null; kind: "team" | "extra"; own: boolean };

const bgpTeamName = (label: string) => BGP_TEAMS.find(t => t.toLowerCase() === label.trim().toLowerCase());

/** A folder label as stored: trimmed, team names in their canonical form. */
export function folderLinkLabel(label: unknown): string | null {
  const text = String(label ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 60) return null;
  return bgpTeamName(text) || text;
}

export function normaliseFolderLinks(raw: unknown): Record<string, string> {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const label = folderLinkLabel(key);
    const url = typeof v === "string" ? v.trim() : "";
    if (label && url && !Object.keys(out).some(k => k.toLowerCase() === label.toLowerCase())) out[label] = url;
  }
  return out;
}

/** The Files tabs: the property's folder teams (or the viewer's team), then
 *  other teams with their own folder, then extra folders A–Z. Each tab opens
 *  its own folder, else a team tab falls back to the property's linked
 *  folder, else (url null) the BGP share drive/<team>/<property> path. */
export function propertyFolderTabs(folderTeams: string[] | null | undefined, links: unknown, defaultUrl: string | null | undefined, fallbackTeam: string): PropertyFolderTab[] {
  const linked = normaliseFolderLinks(links);
  const fallback = String(defaultUrl || "").trim() || null;
  const own = (label: string) => Object.entries(linked).find(([k]) => k.toLowerCase() === label.toLowerCase())?.[1] || null;
  const teams = (folderTeams && folderTeams.length ? folderTeams : [fallbackTeam]).map(t => String(t || "").trim()).filter(Boolean);
  const labels: string[] = [];
  const add = (label: string) => { if (!labels.some(l => l.toLowerCase() === label.toLowerCase())) labels.push(label); };
  teams.forEach(add);
  BGP_TEAMS.filter(t => own(t)).forEach(add);
  Object.keys(linked).filter(l => !bgpTeamName(l)).sort((a, b) => a.localeCompare(b)).forEach(add);
  return labels.map(label => {
    const url = own(label);
    const kind = bgpTeamName(label) || teams.some(t => t.toLowerCase() === label.toLowerCase()) ? "team" : "extra";
    return { label, url: url || (kind === "team" ? fallback : null), kind, own: !!url };
  });
}

const folderKey = (url: string) => {
  let u = String(url || "").trim();
  try { u = decodeURIComponent(u); } catch { /* keep raw */ }
  return u.split("?")[0].replace(/\/+$/, "").toLowerCase();
};

/** True when `url` is `parent` or a folder inside it. */
export function folderWithin(url: string | null | undefined, parent: string | null | undefined): boolean {
  if (!url || !parent) return false;
  const a = folderKey(url), b = folderKey(parent);
  return !!a && !!b && (a === b || a.startsWith(`${b}/`));
}

/** Every distinct folder linked to the property, the default link first. */
export function linkedFolderUrls(defaultUrl: string | null | undefined, links: unknown): string[] {
  const out: string[] = [];
  for (const url of [String(defaultUrl || "").trim(), ...Object.values(normaliseFolderLinks(links))]) {
    if (url && !out.some(u => folderKey(u) === folderKey(url))) out.push(url);
  }
  return out;
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
