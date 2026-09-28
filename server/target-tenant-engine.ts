// Target tenants — one engine for every "who should we pitch this unit to"
// surface (Woody, 2026-09-27: "combine the whole process — a really decent
// target tenants function with genuine deep thought and AI expertise … should
// also consider all the new tenants BGP are talking to").
//
// 1. Centre evidence (cached per property): the current tenant mix, the Brand
//    Gap (competing centres, top-UK-centre benchmark, missing sectors, live
//    web expansion intel), opening news at the top centres, live leasing
//    requirements, the brands BGP is in conversation with (email / meeting
//    activity, new relationships, new contacts), BGP's tenant-rep clients and
//    live deals, the landlord's tracker targets and past target outcomes.
// 2. Unit candidates: brands not trading here, scored per unit (a requirement
//    whose size fits THIS unit counts most).
// 3. The plan: Fable with extended thinking works through the centre's
//    vacant units together — mix, sizing, evidence strength, no brand pushed
//    at every unit — and returns five rated targets per unit with reasons
//    that cite the evidence.
// Landlord clients see the brand movement (BGP conversations, new
// relationships, BGP clients, BGP deals on their own schemes); counts and
// other landlords' deals stay BGP-only. Their Brand Gap is sliced by the gap
// route.
import type { Request } from "express";
import { requirementFitsUnit, parseReqSize } from "@shared/requirement-fit";
import { isClientCrmCategory } from "@shared/tenant-categories";
import { brandTier, isHotelGroup, POSITIONING_PROFILES, type BrandTier, type SchemePositioning } from "@shared/scheme-positioning";

export const brandKey = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9&]+/g, " ").trim();

type Brand = {
  key: string; companyId: string | null; name: string; category: string | null;
  stores: number | null; rollout: string | null;
  signals: Array<{ text: string; weight: number; internal?: boolean }>;
  requirements: Array<{ size: any; use: string[] | null; requirement_locations: string[] | null; created_at: string | null }>;
  bgpClient: boolean;
  tier?: BrandTier; hotel?: boolean;
};
export type CentreEvidence = {
  propertyId: string; property: any; client: boolean;
  positioning?: SchemePositioning;
  mix: Array<{ unit: string; tenant: string; use: string | null; sqft: number | null; expiry: string | null }>;
  hereKeys: Set<string>; hereIds: Set<string>;
  brands: Map<string, Brand>;
  context: string;
};
export type TargetUnit = { id: string; unit_name: string; sqft?: number | null; zone?: string | null; positioning?: string | null; status?: string | null;
  tenant_name?: string | null; rent_pa?: number | null; use_class?: string | null; target_brands?: string | null; optimum_target?: string | null };
// evidence = shareable with the landlord; internal = BGP-only (conversations,
// deals, tenant-rep clients, new contacts).
export type UnitCandidate = { name: string; companyId: string | null; evidence: string[]; internal: string[]; score: number; facts: string };

// Space nobody trades from — storage, ATMs, car parks, plant, site cabins —
// never gets target tenants (Woody, 2026-09-27: "storage etc are irrelevant").
export const isAncillaryUnit = (unit: { unit_name?: string | null; use_class?: string | null; positioning?: string | null }) =>
  /\b(storage|stor\d*|remote store|store\s*cage|container|car\s*park|parking|atm|substation|advert\w*|barrow|locker|sprinkler|plant|collection facility|portakabin|cabin|bin store|loading bay|office only)\b/i
    .test(`${unit.unit_name || ""} ${unit.use_class || ""} ${unit.positioning || ""}`);

const cache = new Map<string, { at: number; value: CentreEvidence }>();

async function selfGet(req: Request, path: string) {
  const headers: Record<string, string> = {};
  if (req.headers.cookie) headers.Cookie = String(req.headers.cookie);
  if (req.headers.authorization) headers.Authorization = String(req.headers.authorization);
  return fetch(`http://127.0.0.1:${process.env.PORT || "5000"}${path}`, { headers, signal: AbortSignal.timeout(90_000) })
    .then(r => r.ok ? r.json() : null).catch(() => null);
}
const rows = (pool: any, sql: string, params: any[] = []) => pool.query(sql, params).then((r: any) => r.rows).catch(() => [] as any[]);
const month = (d: any) => d ? new Date(d).toLocaleDateString("en-GB", { month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep") : "";

export async function centreEvidence(pool: any, req: Request, propertyId: string): Promise<CentreEvidence> {
  const { isClientRequestUser } = await import("./company-scope");
  const client = await isClientRequestUser(req as any);
  const cacheKey = `${propertyId}:${client ? "client" : "staff"}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value;

  const property = (await rows(pool, `SELECT p.id, p.name, p.asset_class, p.postcode, p.address::text AS address, p.strategic_principles, p.landlord_id,
      c.name AS landlord_name FROM crm_properties p LEFT JOIN crm_companies c ON c.id = p.landlord_id WHERE p.id = $1`, [propertyId]))[0] || { id: propertyId, name: "" };
  const [gaps, openings] = await Promise.all([selfGet(req, `/api/property/${propertyId}/brand-gaps`), selfGet(req, `/api/property/${propertyId}/centre-openings`)]);
  const gap = gaps?.applicable === false ? null : gaps;
  const positioning: SchemePositioning = gap?.researchContext?.positioning || "mainstream";
  const profile = POSITIONING_PROFILES[positioning];

  // Current mix — the tenancy schedule is the truth; leasing rows fill gaps.
  const tenancy = await rows(pool, `SELECT unit_number, tenant_name, trading_name, permitted_use, nia_sqft, lease_expiry, tenant_company_id
      FROM tenancy_schedule_units WHERE property_id = $1 AND lower(trim(coalesce(status, ''))) <> 'archived'
        AND lower(trim(coalesce(occupancy_status, ''))) <> 'archived' ORDER BY unit_number`, [propertyId]);
  const leasing = await rows(pool, `SELECT unit_name, tenant_name, tenant_company_id, zone, positioning, sqft FROM leasing_schedule_units
      WHERE property_id = $1 AND tenant_name IS NOT NULL AND tenant_name <> ''`, [propertyId]);
  const mix: CentreEvidence["mix"] = tenancy.filter((t: any) => t.trading_name || t.tenant_name).map((t: any) => ({
    unit: String(t.unit_number || "").split(/\s+/)[0], tenant: t.trading_name || t.tenant_name, use: t.permitted_use || null,
    sqft: t.nia_sqft ? Number(t.nia_sqft) : null, expiry: t.lease_expiry ? String(t.lease_expiry).slice(0, 10) : null,
  }));
  if (!mix.length) for (const l of leasing) mix.push({ unit: l.unit_name, tenant: l.tenant_name, use: l.positioning || null, sqft: l.sqft ? Number(l.sqft) : null, expiry: null });
  const hereIds = new Set<string>([...tenancy, ...leasing].map((t: any) => t.tenant_company_id).filter(Boolean));
  const hereKeys = new Set<string>([...tenancy.flatMap((t: any) => [t.trading_name, t.tenant_name]), ...leasing.map((l: any) => l.tenant_name)].filter(Boolean).map((n: string) => brandKey(n)));
  for (const b of gap?.onScheme || []) { hereIds.add(b.brand_company_id); hereKeys.add(brandKey(b.brand_name)); }

  const brands = new Map<string, Brand>();
  const brandFor = (companyId: string | null, name: string): Brand | null => {
    if (!name?.trim()) return null;
    const k = brandKey(name);
    const key = companyId || `name:${k}`;
    let b = brands.get(key) || (companyId ? brands.get(`name:${k}`) : [...brands.values()].find(x => brandKey(x.name) === k));
    if (!b) { b = { key, companyId, name: name.trim(), category: null, stores: null, rollout: null, signals: [], requirements: [], bgpClient: false }; brands.set(key, b); }
    if (companyId && !b.companyId) { brands.delete(b.key); b.companyId = companyId; b.key = companyId; brands.set(companyId, b); }
    return b;
  };
  const signal = (b: Brand | null, text: string, weight: number, internal = false) => { if (b && !b.signals.some(s => s.text === text)) b.signals.push({ text, weight, internal }); };

  // Live leasing requirements — sizes are matched per unit later.
  const reqs = await rows(pool, `SELECT r.company_id, COALESCE(c.name, r.name) AS brand_name, r.size, r.use, r.requirement_locations, r.created_at
      FROM crm_requirements_leasing r LEFT JOIN crm_companies c ON c.id = r.company_id AND c.merged_into_id IS NULL
     WHERE r.status IS NULL OR r.status = 'Active'`);
  for (const r of reqs) { const b = brandFor(r.company_id, r.brand_name); b?.requirements.push(r); }

  if (gap) {
    for (const b of gap.competitorGaps || []) signal(brandFor(b.brand_company_id, b.brand_name), `trades at ${(b.competing_at || []).join(", ")} (competing centre), not here`, 20);
    for (const b of gap.peerGaps || []) signal(brandFor(b.brand_company_id, b.brand_name), `at ${(b.peer_schemes || []).length} of ${profile.peers}, not here`, Math.min(20, 4 + (b.peer_schemes || []).length * 2));
    for (const b of (gap.localMarket || []).slice(0, 15)) signal(brandFor(b.brand_company_id, b.brand_name), `trading ${Number(b.nearest_distance_km).toFixed(1)}km away`, 5);
    for (const s of gap.missingSectors || []) for (const e of s.examples || []) signal(brandFor(e.id, e.name), `${s.label} — a sector this centre lacks`, 10);
    for (const b of Object.values(gap.liveIntel?.byBrand || {}) as any[]) if (b?.expanding) signal(brandFor(null, b.name), `actively expanding: ${String(b.note || "").slice(0, 120)}`, 15);
  }
  for (const o of openings?.peers || []) if (o.brand) signal(brandFor(o.brand.id, o.brand.name), `opening news at ${o.centre}${o.date ? ` (${month(o.date)})` : ""}`, 8);

  // BGP's own brand movement (Woody, 2026-09-27: "we need Landsec to see
  // brand movement and internal discussions on their projects"). Shared with
  // the landlord: that BGP is in conversation with a brand (and whether it's a
  // new relationship), that BGP acts for it, and live BGP deals on this
  // landlord's own schemes. BGP-only: email / meeting / contact counts and
  // deals on other landlords' schemes (the landlord just sees "acquiring
  // elsewhere now").
  const note = (b: Brand | null, text: string, weight: number, internal = false) => { if (!(internal && client)) signal(b, text, weight, internal); };
  const talking = await rows(pool, `SELECT c.id, c.name,
      COUNT(*) FILTER (WHERE i.interaction_date > NOW() - INTERVAL '90 days')::int AS recent,
      MIN(i.interaction_date) AS first_at, MAX(i.interaction_date) AS last_at,
      COUNT(*) FILTER (WHERE i.interaction_date > NOW() - INTERVAL '90 days' AND COALESCE(i.type, '') !~* 'email')::int AS meetings
    FROM crm_interactions i JOIN crm_companies c ON c.id = i.company_id
   WHERE c.merged_into_id IS NULL AND c.company_type ILIKE 'tenant%'
     AND i.interaction_date > NOW() - INTERVAL '2 years' AND i.interaction_date <= NOW()
   GROUP BY c.id, c.name HAVING MAX(i.interaction_date) > NOW() - INTERVAL '90 days'
   ORDER BY recent DESC LIMIT 250`);
  for (const t of talking) {
    const isNew = t.first_at && Date.now() - new Date(t.first_at).getTime() < 180 * 864e5;
    const b = brandFor(t.id, t.name);
    note(b, `BGP in active conversation with the brand${isNew ? " — a new relationship" : ""}`, isNew ? 16 : Math.min(12, 4 + t.recent));
    note(b, `${t.recent} email${t.recent === 1 ? "" : "s"}${t.meetings ? ` / ${t.meetings} meeting${t.meetings === 1 ? "" : "s"}` : ""} in 90 days, last ${month(t.last_at)}`, 0, true);
  }
  const contacts = client ? [] : await rows(pool, `SELECT c.id, c.name, COUNT(*)::int AS n FROM crm_contacts k JOIN crm_companies c ON c.id = k.company_id
    WHERE k.created_at > NOW() - INTERVAL '60 days' AND c.merged_into_id IS NULL AND c.company_type ILIKE 'tenant%'
    GROUP BY c.id, c.name ORDER BY n DESC LIMIT 100`);
  for (const k of contacts) note(brandFor(k.id, k.name), `${k.n} new contact${k.n === 1 ? "" : "s"} added in 60 days`, 4, true);
  const clients = await rows(pool, `SELECT DISTINCT c.id, c.name FROM crm_companies c WHERE c.merged_into_id IS NULL AND c.id IN (
      SELECT d.tenant_id FROM crm_deals d WHERE d.bgp_acting_for = 'tenant' AND d.tenant_id IS NOT NULL
        AND COALESCE(d.status, '') NOT IN ('COM','INV','WIT','Completed','Invoiced','Withdrawn','Lost','Dead')
      UNION SELECT company_id FROM tenant_rep_searches WHERE company_id IS NOT NULL
        AND COALESCE(status, '') NOT IN ('Complete','Completed','Archived','Lost','On Hold'))`);
  for (const c of clients) { const b = brandFor(c.id, c.name); if (b) { b.bgpClient = true; note(b, "BGP acts for the brand (tenant rep)", 25); } }
  const deals = await rows(pool, `SELECT d.tenant_id, c.name, p.name AS property, (p.landlord_id IS NOT DISTINCT FROM $2 AND $2 IS NOT NULL) AS same_landlord
      FROM crm_deals d
      JOIN crm_companies c ON c.id = d.tenant_id AND c.merged_into_id IS NULL LEFT JOIN crm_properties p ON p.id = d.property_id
     WHERE d.tenant_id IS NOT NULL AND d.property_id IS DISTINCT FROM $1 AND d.updated_at > NOW() - INTERVAL '12 months'
       AND COALESCE(d.status, '') NOT IN ('COM','INV','WIT','Completed','Invoiced','Withdrawn','Lost','Dead')`, [propertyId, property.landlord_id || null]);
  for (const d of deals) {
    const b = brandFor(d.tenant_id, d.name);
    if (d.same_landlord && d.property) note(b, `in a live BGP deal at ${d.property}${property.landlord_name ? ` (${property.landlord_name})` : ""} — taking space now`, 14);
    else {
      note(b, "acquiring elsewhere now (a live BGP deal)", 12);
      if (d.property) note(b, `live BGP deal at ${d.property}`, 0, true);
    }
  }

  // Brand facts for everything gathered.
  const ids = [...brands.values()].map(b => b.companyId).filter(Boolean);
  if (ids.length) {
    for (const f of await rows(pool, `SELECT id, name, company_type, store_count, rollout_status, industry, description FROM crm_companies WHERE id = ANY($1::text[])`, [ids])) {
      const b = brands.get(f.id); if (!b) continue;
      b.category = f.company_type; b.stores = f.store_count; b.rollout = f.rollout_status;
      const facts = { name: f.name, companyType: f.company_type, industry: f.industry, description: f.description, storeCount: f.store_count };
      b.tier = brandTier(facts); b.hotel = isHotelGroup(facts);
    }
  }
  // Brands known only by name (web intel) are tiered on the name alone.
  for (const b of brands.values()) if (b.tier === undefined) { b.tier = brandTier({ name: b.name }); b.hotel = isHotelGroup({ name: b.name }); }

  const outcomes = client ? [] : await rows(pool, `SELECT t.brand_name, t.quality_rating, t.outcome, p.name AS property_name
      FROM target_tenants t JOIN crm_properties p ON t.property_id = p.id WHERE t.outcome IS NOT NULL ORDER BY t.updated_at DESC LIMIT 40`);
  const bench = gap?.benchmark;
  const rank = bench ? bench.centres.filter((c: any) => c.brands > bench.here.brands).length + 1 : null;
  const principles = property.strategic_principles ? JSON.stringify(property.strategic_principles).slice(0, 1500) : "";
  const context = [
    `CENTRE: ${property.name}${property.landlord_name ? ` (landlord ${property.landlord_name})` : ""} · ${property.asset_class || "retail / leisure"} · ${[property.postcode].filter(Boolean).join(", ")}`,
    positioning === "luxury" ? `POSITIONING: ${profile.label} — a luxury destination. Pitch luxury and premium brands (jewellery & watches, fashion & accessories, beauty & fragrance, gifting, premium restaurants, cafés and patisserie) only; never quick-service, value or mass-market chains or hotel groups.` : "",
    positioning === "value" ? `POSITIONING: ${profile.label} — pitch value and mainstream operators; not luxury brands.` : "",
    gap?.competingCentres?.length ? `Competing centres: ${gap.competingCentres.map((c: any) => `${c.name} ${c.distance_km}km`).join(", ")}` : "",
    bench ? `Against ${profile.peers}: ${bench.here.brands} ${positioning === "luxury" ? profile.brandsNoun : "F&B / leisure brands"} across ${bench.here.sectors} sectors — ranks ${rank} of ${bench.centres.length + 1}. Leaders: ${bench.centres.slice(0, 4).map((c: any) => `${c.name} ${c.brands}`).join(", ")}.` : "",
    gap?.sectors?.length ? `Sector coverage here: ${gap.sectors.map((s: any) => `${s.label} ${s.on_scheme}${s.missing ? " (MISSING)" : ""}`).join("; ")}` : "",
    principles ? `LANDLORD'S STRATEGIC PRINCIPLES: ${principles}` : "",
    outcomes.length ? `PAST TARGET OUTCOMES (learn which brands actually signed): ${outcomes.map((o: any) => `${o.brand_name} at ${o.property_name} — ${o.outcome} (was ${o.quality_rating})`).join("; ")}` : "",
    `CURRENT TENANT MIX (${mix.length}): ${mix.slice(0, 260).map(m => `${m.tenant}${m.use ? ` [${m.use}]` : ""}${m.sqft ? ` ${Math.round(m.sqft)}sf` : ""}${m.expiry && m.expiry < new Date(Date.now() + 548 * 864e5).toISOString().slice(0, 10) ? ` exp ${m.expiry.slice(0, 7)}` : ""}`).join("; ")}`,
  ].filter(Boolean).join("\n");

  const value: CentreEvidence = { propertyId, property, client, positioning, mix, hereKeys, hereIds, brands, context };
  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

const isHere = (ev: CentreEvidence, b: { companyId: string | null; name: string }) => {
  if (b.companyId && ev.hereIds.has(b.companyId)) return true;
  const k = brandKey(b.name);
  return [...ev.hereKeys].some(n => n === k || n.startsWith(`${k} `));
};

// Candidates for one unit: every evidenced brand not trading here, with a
// requirement whose size fits THIS unit weighted highest.
export function unitCandidates(ev: CentreEvidence, unit: TargetUnit, exclude: Set<string> = new Set(), limit = 40): UnitCandidate[] {
  const unitText = [unit.unit_name, unit.positioning, unit.zone, unit.use_class].filter(Boolean).join(" ");
  const retail = /retail|shop|fashion|store|e\s*\(a\)|a1\b/i.test(unitText) && !/f&b|food|dining|caf|restaurant|kiosk|bar\b|leisure/i.test(unitText);
  const propertyText = [ev.property.name, ev.property.postcode, ev.property.address].filter(Boolean).join(" ");
  const sqft = Number(unit.sqft) || null;
  const out: UnitCandidate[] = [];
  for (const b of ev.brands.values()) {
    if (isHere(ev, b) || exclude.has(brandKey(b.name)) || (b.companyId && exclude.has(b.companyId))) continue;
    const evidence = b.signals.filter(s => !s.internal).map(s => s.text);
    const internal = b.signals.filter(s => s.internal).map(s => s.text);
    let score = b.signals.reduce((sum, s) => sum + s.weight, 0);
    for (const r of b.requirements) {
      if (requirementFitsUnit(r, { sqft, unit_text: unitText || "f&b", property_text: propertyText })) {
        const size = Array.isArray(r.size) ? r.size.join(", ") : r.size;
        evidence.unshift(`live requirement that fits this unit${size ? ` (${size})` : ""}${r.created_at && Date.now() - new Date(r.created_at).getTime() < 120 * 864e5 ? ", new this quarter" : ""}`);
        score += 35;
        break;
      }
    }
    if (!evidence.length && !internal.length && b.requirements.length) {
      const range = parseReqSize(b.requirements[0].size ?? null);
      if (range && sqft && (sqft < range.min || sqft > range.max)) continue;
      evidence.push("has a live UK leasing requirement");
      score += 6;
    }
    if (!evidence.length && !internal.length) continue;
    // The unit's use decides the slice: F&B / leisure units get the
    // hospitality categories; unknown categories stay in.
    if (b.category && !retail && !isClientCrmCategory(b.category) && !evidence.some(e => e.startsWith("live requirement"))) continue;
    // Positioning: a luxury scheme never gets quick-service / mass-market
    // chains or hotel groups, and its retail only luxury & premium brands;
    // a value scheme no luxury brands.
    if (ev.positioning === "luxury" && (b.hotel || b.tier === "mass" || (b.category && !isClientCrmCategory(b.category) && b.tier !== "luxury" && b.tier !== "premium"))) continue;
    if (ev.positioning === "value" && b.tier === "luxury") continue;
    const facts = [b.category?.replace(/^Tenant\s*-\s*/i, ""), b.stores ? `${b.stores} stores` : null, b.rollout].filter(Boolean).join(", ");
    out.push({ name: b.name, companyId: b.companyId, evidence, internal, score, facts });
  }
  // The landlord's own tracker targets for the unit.
  for (const line of `${unit.target_brands || ""}\n${unit.optimum_target || ""}`.split(/\n|,|;/).map(l => l.replace(/^\s*\d+[.)]\s*/, "").replace(/\(.*?\)|optimum:?/gi, "").trim()).filter(l => l && l.length <= 40)) {
    const k = brandKey(line);
    const existing = out.find(c => brandKey(c.name) === k);
    if (existing) { existing.evidence.unshift("named in the landlord's leasing tracker for this unit"); existing.score += 25; continue; }
    if (isHere(ev, { companyId: null, name: line }) || exclude.has(k)) continue;
    out.push({ name: line, companyId: null, evidence: ["named in the landlord's leasing tracker for this unit"], internal: [], score: 25, facts: "" });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export type PlannedTarget = { brand_name: string; evidenced: boolean; quality_rating: "green" | "amber" | "red"; rationale: string; companyId: string | null; evidence: string[]; internal: string[] };

// The deep pass: one Fable call (extended thinking) plans a few units
// together so the targets form a mix, not five brands copied everywhere.
export async function planTargets(ev: CentreEvidence, units: Array<TargetUnit & { candidates: UnitCandidate[]; existing: string[] }>, placed: Map<string, string[]> = new Map()): Promise<{ strategy: string; byUnit: Map<string, PlannedTarget[]> }> {
  const unitBlock = units.map(u => [
    `UNIT ${u.id}: ${u.unit_name}${u.sqft ? ` · ${Math.round(Number(u.sqft))} sq ft` : " · size not recorded"}${u.zone ? ` · zone ${u.zone}` : ""}${u.positioning ? ` · positioning ${u.positioning}` : ""}${u.status ? ` · ${u.status}` : ""}${u.rent_pa ? ` · £${Number(u.rent_pa).toLocaleString()} pa` : ""}${u.tenant_name ? ` · current occupier ${u.tenant_name}` : ""}`,
    u.existing.length ? `  already targeted (don't repeat): ${u.existing.join(", ")}` : "",
    `  evidenced candidates:`,
    ...(u.candidates.length ? u.candidates.map((c, i) => `   ${i + 1}. ${c.name}${c.facts ? ` (${c.facts})` : ""} — ${[...c.evidence, ...c.internal.map(x => `[BGP-internal] ${x}`)].join("; ")}`) : ["   (none — rely on expertise, and say the evidence is thin)"]),
  ].filter(Boolean).join("\n")).join("\n\n");

  const system = `You are the head of retail & leisure leasing strategy at Bruce Gillingham Pollard, a London leasing agency that sets the occupier mix for the UK's leading shopping centres and West End estates. You think like a landlord's leasing director: trading performance, dwell time, adjacency and the centre's position against its competitors decide the mix, and only brands with real intent sign. Be rigorous and evidence-led; British English; no hype.`;
  const prompt = `${ev.context}

${placed.size ? `ALREADY PLACED on other units at this centre (counts toward the two-unit limit): ${[...placed.entries()].map(([b, us]) => `${b} → ${us.join(", ")}`).join("; ")}\n\n` : ""}VACANT / LETTING UNITS TO PLAN:
${unitBlock}

Plan the targets for these units TOGETHER. Think it through before answering:
- What is this centre missing against its competing centres and ${ev.positioning === "luxury" ? POSITIONING_PROFILES.luxury.peers : "the top UK centres"}, sector by sector, and which of these units is the right home for each missing piece (size, zone, positioning, adjacency to the current mix)?
- Weigh the evidence honestly. Strongest: a live requirement whose size fits the unit, BGP acting for the brand, a live BGP deal elsewhere (taking space now), a new relationship BGP has just opened, the landlord naming the brand. Then presence at competing / top centres with opening news or cited expansion. Presence alone is weaker. A brand whose requirement size doesn't fit the unit is a poor target for it.
- Avoid a brand that duplicates or directly competes with a current tenant, and never suggest a brand already trading here.
- A brand can be pitched for at most three units across the centre (including the units already placed above) — give it to the units that fit its requirement best. Spread the plan: the leasing team needs a different conversation for each unit.
- The landlord client reads every rationale, and should see the brand movement: BGP's conversations with the brand, a new relationship, BGP acting for the brand, live BGP deals on the landlord's own schemes. Items marked [BGP-internal] (email / contact counts, deals on OTHER landlords' schemes) are confidential: use them to judge, but never repeat them — say "acquiring elsewhere now" instead of naming another scheme.
- Prefer the evidenced candidates. You may add at most ONE brand per unit from your own market knowledge when it is clearly stronger than the list; mark it "evidenced": false and say why.

Ratings: "green" = strong fit AND strong intent evidence (fitting requirement, BGP client, live deal, new conversation, or actively opening in centres like this); "amber" = good fit, evidence is presence elsewhere rather than intent; "red" = speculative stretch worth a call.

Record the plan with the save_target_plan tool: a 2-4 sentence strategy for these units, and exactly five targets per unit (brand_name exactly as in its candidate list; rationale 2-3 sentences for the leasing team — why this brand, why this unit, citing the evidence).`;

  const { callClaude } = await import("./chatbgp");
  // The plan comes back as a tool call, so the API guarantees valid JSON —
  // free-text JSON broke on stray quotes in rationales.
  const tool = { type: "function", function: { name: "save_target_plan", description: "Save the target tenant plan for these units.", parameters: {
    type: "object", required: ["strategy", "units"], properties: {
      strategy: { type: "string" },
      units: { type: "array", items: { type: "object", required: ["unit_id", "targets"], properties: {
        unit_id: { type: "string" },
        targets: { type: "array", items: { type: "object", required: ["brand_name", "evidenced", "quality_rating", "rationale"], properties: {
          brand_name: { type: "string" }, evidenced: { type: "boolean" },
          quality_rating: { type: "string", enum: ["green", "amber", "red"] }, rationale: { type: "string" },
        } } },
      } } },
    } } } };
  const completion = await callClaude({
    model: "claude-fable-5", thinking: true, effort: "high", max_completion_tokens: 16000, feature: "target-tenants",
    messages: [{ role: "system", content: system }, { role: "user", content: prompt }], tools: [tool],
  });
  const call = (completion.choices?.[0]?.message?.tool_calls || []).find((c: any) => c.function?.name === "save_target_plan");
  let parsed: any;
  if (call) parsed = JSON.parse(call.function.arguments);
  else {
    const text: string = completion.choices?.[0]?.message?.content || "";
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("The target plan came back empty");
    parsed = JSON.parse(text.slice(start, end + 1));
  }
  const byUnit = new Map<string, PlannedTarget[]>();
  for (const u of parsed.units || []) {
    const unit = units.find(x => x.id === String(u.unit_id));
    if (!unit) continue;
    const seen = new Set<string>();
    const picks: PlannedTarget[] = [];
    for (const t of u.targets || []) {
      if (!t?.brand_name) continue;
      const k = brandKey(t.brand_name);
      if (seen.has(k) || unit.existing.some(e => brandKey(e) === k) || isHere(ev, { companyId: null, name: t.brand_name })) continue;
      seen.add(k);
      const candidate = unit.candidates.find(c => brandKey(c.name) === k);
      picks.push({
        brand_name: candidate?.name || String(t.brand_name).trim(),
        evidenced: !!candidate,
        quality_rating: ["green", "amber", "red"].includes(t.quality_rating) ? t.quality_rating : "amber",
        rationale: String(t.rationale || "").trim(),
        companyId: candidate?.companyId || null,
        evidence: candidate?.evidence || [],
        internal: candidate?.internal || [],
      });
    }
    byUnit.set(unit.id, picks.slice(0, 5));
  }
  return { strategy: String(parsed.strategy || "").trim(), byUnit };
}

// A CRM brand for a name the model gave: exact, then accent / punctuation-
// insensitive, never a merged-away row.
export async function matchBrandCompany(pool: any, name: string): Promise<{ id: string; name: string } | null> {
  const exact = (await rows(pool, `SELECT id, name FROM crm_companies WHERE LOWER(name) = LOWER($1) AND merged_into_id IS NULL LIMIT 1`, [name]))[0];
  if (exact) return exact;
  const key = brandKey(name).replace(/[^a-z0-9]/g, "");
  if (key.length < 3) return null;
  const hits = await rows(pool, `SELECT id, name FROM crm_companies WHERE merged_into_id IS NULL AND company_type ILIKE 'tenant%'
      AND regexp_replace(translate(lower(name), 'àáâäãèéêëìíîïòóôöõùúûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]', '', 'g') = $1 LIMIT 3`, [key]);
  return hits.length === 1 ? hits[0] : null;
}

// Live progress of a whole-centre run, for the Generate all poll.
export const runProgress = new Map<string, { done: number; total: number; failed: number; lastError?: string; finished?: boolean }>();

// A brand is pitched for at most this many units per centre — a first run
// put Heavenly Desserts on 22 Bluewater units, which tells the team nothing.
export const MAX_UNITS_PER_BRAND = 3;

// One physical unit can sit on the schedule more than once ("U062 Bluewater -
// Upper Level" ×4): it is planned once and its twins get the same list.
export function physicalUnitKey(unit: TargetUnit, centreName = "") {
  const name = String(unit.unit_name || "").trim();
  const first = name.split(/[\s,]+/)[0] || "";
  const base = /\d/.test(first) ? first : brandKey(name.replace(new RegExp(centreName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "")
    .replace(/\b(lower|upper) level\b|\bwhole demise\b|\bwhiole demise\b/gi, ""));
  return `${base.toLowerCase()}|${Math.round(Number(unit.sqft) || 0)}`;
}

// Plan and save targets for a set of leasing-schedule units (the Generate
// buttons). Units go to the model three at a time, two batches in flight.
// save:false plans without writing (?preview=1 on the unit route).
export async function generateTargetsForUnits(pool: any, req: Request, propertyId: string, units: TargetUnit[], opts: { save?: boolean } = {}) {
  const ev = await centreEvidence(pool, req, propertyId);
  const existingRows = await rows(pool, `SELECT t.unit_id, t.brand_name, u.unit_name, u.sqft FROM target_tenants t
      LEFT JOIN leasing_schedule_units u ON u.id = t.unit_id WHERE t.property_id = $1 AND t.status <> 'rejected'`, [propertyId]);
  const centreName = String(ev.property.name || "").replace(/\s*shopping cent(re|er)\s*$/i, "");
  const groups = new Map<string, TargetUnit[]>();
  for (const u of units) { const k = physicalUnitKey(u, centreName); groups.set(k, [...(groups.get(k) || []), u]); }
  const primaries = [...groups.values()].map(g => g[0]);

  // Where each brand is already pitched (distinct physical units) and, for
  // the prompt, the unit codes.
  const placedUnits = new Map<string, Set<string>>();
  const placed = new Map<string, string[]>();
  const place = (brand: string, unit: TargetUnit) => {
    const k = brandKey(brand), u = physicalUnitKey(unit, centreName);
    const set = placedUnits.get(k) || new Set<string>();
    if (set.has(u)) return;
    set.add(u); placedUnits.set(k, set);
    placed.set(brand, [...(placed.get(brand) || []), String(unit.unit_name || "").split(/\s+/)[0]]);
  };
  for (const r of existingRows) place(r.brand_name, { id: r.unit_id, unit_name: r.unit_name, sqft: r.sqft });
  const full = () => new Set([...placedUnits.entries()].filter(([, set]) => set.size >= MAX_UNITS_PER_BRAND).map(([k]) => k));

  const batches: TargetUnit[][] = [];
  for (let i = 0; i < primaries.length; i += 3) batches.push(primaries.slice(i, i + 3));
  const strategies: string[] = [];
  const inserted = new Map<string, any[]>();
  const failed: Array<{ unit_id: string; error: string }> = [];
  // Two lanes of three-unit batches share the placed-brands list; candidates
  // are drawn when a batch starts, so a brand already at the cap is gone.
  // Each AI call is capped at five minutes with one retry — a stalled call
  // once held a whole-centre run for 20 minutes — and a failed batch doesn't
  // stop the rest.
  const progress: { done: number; total: number; failed: number; lastError?: string; finished?: boolean } = { done: 0, total: units.length, failed: 0 };
  runProgress.set(propertyId, progress);
  const timed = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("The AI plan took too long for this batch")), 5 * 60_000))]);
  let next = 0;
  await Promise.all([0, 1].map(async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const twinsOf = (u: TargetUnit) => groups.get(physicalUnitKey(u, centreName)) || [u];
      try {
        const prepared = batch.map(u => {
          const existing = [...new Set(twinsOf(u).flatMap(t => existingRows.filter((r: any) => r.unit_id === t.id).map((r: any) => r.brand_name)))];
          const exclude = new Set([...existing.map((e: string) => brandKey(e)), ...full()]);
          return { ...u, existing, candidates: unitCandidates(ev, u, exclude) };
        });
        const plan = await timed(planTargets(ev, prepared, placed)).catch(() => timed(planTargets(ev, prepared, placed)));
        if (plan.strategy) strategies.push(plan.strategy);
        for (const unit of prepared) {
          const picks = (plan.byUnit.get(unit.id) || []).filter(t => (placedUnits.get(brandKey(t.brand_name))?.size || 0) < MAX_UNITS_PER_BRAND);
          for (const twin of twinsOf(unit)) {
            const saved: any[] = [];
            for (const t of picks) {
              const company = t.companyId ? { id: t.companyId, name: t.brand_name } : await matchBrandCompany(pool, t.brand_name);
              const rationale = [t.rationale, t.evidenced ? (t.evidence.length ? `Evidence: ${t.evidence.join("; ")}` : "") : "Not in the evidence list — a market-knowledge suggestion."].filter(Boolean).join("\n");
              const internalEvidence = t.internal.length ? t.internal.join("; ") : null;
              const row = opts.save === false
                ? { unit_id: twin.id, property_id: propertyId, company_id: company?.id || null, brand_name: t.brand_name, rationale, internal_evidence: internalEvidence, quality_rating: t.quality_rating, preview: true }
                : (await pool.query(
                  `INSERT INTO target_tenants (unit_id, property_id, company_id, brand_name, rationale, internal_evidence, quality_rating, suggested_by, status)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, 'ai', 'suggested') RETURNING *`,
                  [twin.id, propertyId, company?.id || null, t.brand_name, rationale, internalEvidence, t.quality_rating])).rows[0];
              saved.push({ ...row, company_name: company?.name || null });
            }
            inserted.set(twin.id, saved);
          }
          for (const t of picks) place(t.brand_name, unit);
        }
      } catch (error: any) {
        for (const unit of batch) for (const twin of twinsOf(unit)) failed.push({ unit_id: twin.id, error: String(error?.message || error).slice(0, 200) });
        progress.failed += batch.reduce((n, u) => n + twinsOf(u).length, 0);
        progress.lastError = String(error?.message || error).slice(0, 300);
        console.warn("[target-tenants] batch failed:", progress.lastError);
      }
      progress.done += batch.reduce((n, u) => n + twinsOf(u).length, 0);
    }
  }));
  progress.finished = true;
  return { inserted, strategy: strategies.join(" "), failed };
}
