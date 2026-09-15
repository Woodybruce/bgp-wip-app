// Property auto-enrichment — the "why is nothing filled in?" pass.
//
// Woody, 2026-09-15 (Hudson Yard, Vauxhall): the owner was known (NPLH
// Hudson Ltd set as freeholder) yet the Compliance & KYC checks sat parked
// because the company had no Companies House number, the asset class was
// blank, and nothing ran on its own. This module fills those gaps without
// anyone clicking:
//
//   1. Owner → Companies House: the owning company (freeholder > long
//      leaseholder > landlord) gets its CH number resolved — from the Land
//      Registry proprietor number already on the property when the names
//      match, otherwise an exact-name match on the CH search API — and its
//      UK trading entity name set from the CH profile. That un-parks the
//      KYC checklist; the AML sweep is then kicked off in the background.
//   2. Asset class: inferred from the units / tenancy schedule use classes
//      and tenant names, then the property name, with a cheap Claude call
//      as the fallback when there's no structured signal.
//
// Runs fire-and-forget on property create, on owner changes, and (throttled)
// whenever a staff member opens a property. Never overwrites a value a human
// has set — every write is guarded with IS NULL.

import { pool } from "./db";
import { chFetch } from "./companies-house";
import { lookupVoaByPostcode, voaSqliteAvailable, type VoaLookupRow } from "./voa-sqlite";
import { callClaude, CHATBGP_HELPER_MODEL, safeParseJSON } from "./utils/anthropic-client";

// Keep in step with ASSET_CLASS_OPTIONS in client/src/pages/properties.tsx.
const ASSET_CLASSES = ["Retail", "Office", "Industrial", "Mixed Use", "F&B", "Leisure", "Residential"] as const;
type AssetClass = typeof ASSET_CLASSES[number];

const THROTTLE_MS = 6 * 60 * 60 * 1000;
const lastRun = new Map<string, number>();
const amlKicked = new Map<string, number>();

export function enrichPropertyInBackground(propertyId: string, opts: { force?: boolean } = {}) {
  const now = Date.now();
  if (!opts.force && (lastRun.get(propertyId) || 0) > now - THROTTLE_MS) return;
  lastRun.set(propertyId, now);
  enrichPropertyBasics(propertyId).catch((e: any) => console.warn(`[property-enrich] ${propertyId}: ${e?.message || e}`));
}

export interface PropertyEnrichResult {
  propertyId: string;
  ownerCompanyId: string | null;
  companiesHouseNumber: string | null;
  companiesHouseSet: boolean;
  ukEntitySet: boolean;
  amlStarted: boolean;
  assetClass: string | null;
  assetClassSet: boolean;
  assetClassSource: "units" | "name" | "ai" | "voa" | "existing" | null;
  useClass: string | null;
  useClassSet: boolean;
  useClassSource: "units" | "voa" | "existing" | null;
  voaMatched: number;
}

// ── Use class ─────────────────────────────────────────────────────────────
// Planning use class from whatever text we hold about a unit: a planning
// code already typed in ("E(a)", "A3", "Sui Generis"), the tenancy
// schedule's plain words ("Shop", "F&B"), or a VOA rating description
// ("Shop and Premises", "Offices and Premises"). Returns the post-2020
// England class; legacy A/B1/D codes are translated.
export function toUseClass(raw: string | null | undefined): string | null {
  const t = String(raw || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return null;
  // Explicit planning codes first.
  if (/\bsui generis\b/.test(t)) return "Sui Generis";
  const code = t.match(/\be\s*\(?\s*([a-g])\s*\)?(?:\s*\(?\s*(i{1,3})\s*\)?)?/);
  if (code) return `E(${code[1]})`;
  if (/^e\b|\bclass e\b|\buse class e\b/.test(t)) return "E";
  if (/\ba1\b/.test(t)) return "E(a)";
  if (/\ba2\b/.test(t)) return "E(c)";
  if (/\b(a3|a4)\b/.test(t)) return /\ba4\b/.test(t) ? "Sui Generis" : "E(b)";
  if (/\ba5\b/.test(t)) return "Sui Generis";
  if (/\bb1\b/.test(t)) return "E(g)";
  if (/\bb2\b/.test(t)) return "B2";
  if (/\bb8\b/.test(t)) return "B8";
  if (/\bc1\b/.test(t)) return "C1";
  if (/\bc3\b/.test(t)) return "C3";
  if (/\bd1\b/.test(t)) return "F1";
  if (/\bd2\b/.test(t)) return "E(d)";
  if (/\bf1\b/.test(t)) return "F1";
  if (/\bf2\b/.test(t)) return "F2";
  // Words — VOA descriptions and schedule shorthand. Sui Generis first so
  // "public house" doesn't fall into food & drink.
  if (/\b(public house|pub\b|drinking|night ?club|betting|bookmaker|amusement|casino|hot food take ?away|takeaway|car showroom|petrol|filling station|launderette|taxi|scrap|tattoo|hostel|theatre|cinema|bingo|dance hall|fuel)\b/.test(t)) return "Sui Generis";
  if (/\b(restaurant|caf[eé]|coffee|food and drink|food & drink|f&b|f & b|eatery|bistro|dining)\b/.test(t)) return "E(b)";
  if (/\b(bank|building society|estate agent|financial|professional services|solicitor|betting office)\b/.test(t)) return "E(c)";
  if (/\b(gym|fitness|health club|leisure centre|leisure|sports? (hall|centre|club)|swimming|indoor sport|padel|bowling)\b/.test(t)) return "E(d)";
  if (/\b(surgery|clinic|medical|dental|dentist|health centre|pharmacy|chemist)\b/.test(t)) return "E(e)";
  if (/\b(nursery|cr[eè]che|day care|childcare)\b/.test(t)) return "E(f)";
  if (/\b(office|offices|studio|light industrial|research|laboratory|workspace|coworking)\b/.test(t)) return "E(g)";
  if (/\b(warehouse|storage|distribution|depot|self storage|logistics)\b/.test(t)) return "B8";
  if (/\b(factory|works|workshop|industrial|manufactur)\b/.test(t)) return "B2";
  if (/\b(hotel|guest ?house|aparthotel|serviced apartments?)\b/.test(t)) return "C1";
  if (/\b(flat|flats|apartment|dwelling|residential|house|maisonette|btr)\b/.test(t)) return "C3";
  if (/\b(school|college|library|museum|gallery|place of worship|church|law court|education|training)\b/.test(t)) return "F1";
  if (/\b(community|village hall|swimming pool|skating)\b/.test(t)) return "F2";
  if (/\b(shop|shops|store|retail|showroom|kiosk|supermarket|superstore|hairdress|salon|barber|premises)\b/.test(t)) return "E(a)";
  return null;
}

// Collapse the per-unit classes into one property-level class.
function combineUseClasses(classes: string[]): string | null {
  const set = Array.from(new Set(classes.filter(Boolean)));
  if (set.length === 0) return null;
  if (set.length === 1) return set[0];
  const allE = set.every(c => c === "E" || /^E\(/.test(c));
  if (allE) return "E";
  return "Mixed";
}

// The asset class a use class implies — used when VOA is the only signal.
function assetFromUseClass(uc: string | null): AssetClass | null {
  switch (uc) {
    case "E(a)": case "E(c)": return "Retail";
    case "E(b)": return "F&B";
    case "E(d)": case "C1": return "Leisure";
    case "E(g)": return "Office";
    case "B2": case "B8": return "Industrial";
    case "C3": return "Residential";
    case "Mixed": return "Mixed Use";
    default: return null;
  }
}

// VOA rating-list rows for this building: same postcode, and the address
// carries the building's number/name. Never the whole postcode blindly —
// a parade shares one postcode with its neighbours.
function voaRowsForProperty(p: any): VoaLookupRow[] {
  if (!voaSqliteAvailable()) return [];
  const addr = (p.address && typeof p.address === "object") ? p.address : {};
  const postcode: string = String(p.postcode || addr.postcode || "").trim();
  if (!postcode) return [];
  const line: string = String(addr.address || addr.street || addr.line1 || "");
  const street = line.replace(/^[\d\-\/a-z]*\s+/i, "").split(",")[0]?.trim();
  const rows = lookupVoaByPostcode(postcode, undefined, 60);
  if (rows.length === 0) return [];
  const nameLower = String(p.name || "").toLowerCase();
  const number = (line.match(/^\s*(\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?)\b/i) || [])[1]?.toLowerCase();
  const tokens = nameLower.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 3);
  const matched = rows.filter(r => {
    const a = (r.address || "").toLowerCase();
    if (number && new RegExp(`(^|[^0-9])${number.replace(/\s*-\s*/, "\\s*-\\s*")}([^0-9]|$)`).test(a)) return true;
    if (nameLower && a.includes(nameLower)) return true;
    // Building name in the VOA address (e.g. "Hudson Yard" in "Unit 3 Hudson Yard").
    return tokens.length >= 2 && tokens.every(w => a.includes(w));
  });
  if (matched.length > 0) return matched;
  // Single-hereditament postcode — nothing to confuse it with.
  if (rows.length === 1 && street && rows[0].address.toLowerCase().includes(street.toLowerCase())) return rows;
  return [];
}

async function inferUseClass(p: any, out: PropertyEnrichResult, unitRows: any[]) {
  if (p.use_class) { out.useClass = p.use_class; out.useClassSource = "existing"; return; }
  let picked: string | null = null;
  let source: PropertyEnrichResult["useClassSource"] = null;

  const fromUnits = unitRows.map((u: any) => toUseClass(u.use_class || u.permitted_use)).filter((c): c is string => !!c);
  if (fromUnits.length > 0) {
    picked = combineUseClasses(fromUnits);
    source = "units";
  }
  if (!picked) {
    const voa = voaRowsForProperty(p);
    out.voaMatched = voa.length;
    if (voa.length > 0) {
      picked = combineUseClasses(voa.map(r => toUseClass(r.description)).filter((c): c is string => !!c));
      if (picked) source = "voa";
      // Stamp the BA reference while we're here so the rates page links up.
      if (voa.length === 1 && voa[0].baRef) {
        await pool.query(`UPDATE crm_properties SET voa_ba_reference = $1 WHERE id = $2 AND voa_ba_reference IS NULL`, [voa[0].baRef, p.id]);
      }
      // VOA is also a legitimate asset-class signal when nothing else is.
      if (!p.asset_class && !out.assetClassSet) {
        const ac = assetFromUseClass(picked);
        if (ac) {
          const r = await pool.query(`UPDATE crm_properties SET asset_class = $1, updated_at = now() WHERE id = $2 AND asset_class IS NULL`, [ac, p.id]);
          if (r.rowCount) { out.assetClass = ac; out.assetClassSet = true; out.assetClassSource = "voa"; console.log(`[property-enrich] ${p.name}: asset class → ${ac} (voa)`); }
        }
      }
    }
  }
  if (picked) {
    const r = await pool.query(`UPDATE crm_properties SET use_class = $1, updated_at = now() WHERE id = $2 AND use_class IS NULL`, [picked, p.id]);
    if (r.rowCount) {
      out.useClass = picked; out.useClassSet = true; out.useClassSource = source;
      console.log(`[property-enrich] ${p.name}: use class → ${picked} (${source})`);
    }
  }
}

function normCompanyName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\bpublic limited company\b/g, "plc")
    .replace(/\blimited liability partnership\b/g, "llp")
    .replace(/\blimited\b/g, "ltd")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveOwnerCompaniesHouse(p: any, out: PropertyEnrichResult) {
  const ownerId: string | null = p.freeholder_id || p.long_leaseholder_id || p.landlord_id || null;
  out.ownerCompanyId = ownerId;
  if (!ownerId) return;

  const { rows } = await pool.query(
    `SELECT id, name, companies_house_number, uk_entity_name, companies_house_data
       FROM crm_companies WHERE id = $1`,
    [ownerId],
  );
  const co = rows[0];
  if (!co) return;

  let chNumber: string | null = co.companies_house_number || null;

  if (!chNumber) {
    // The Land Registry proprietor number is authoritative when the
    // proprietor IS this company.
    if (p.proprietor_company_number && p.proprietor_name && normCompanyName(p.proprietor_name) === normCompanyName(co.name)) {
      chNumber = String(p.proprietor_company_number).trim();
    }
  }
  if (!chNumber) {
    try {
      const search = await chFetch(`/search/companies?q=${encodeURIComponent(co.name)}&items_per_page=10`);
      const want = normCompanyName(co.name);
      const exact = (search.items || []).filter((i: any) => normCompanyName(i.title) === want);
      // Only an unambiguous exact match — a guessed number would poison the
      // whole KYC file. Prefer an active company if several share a name.
      const pick = exact.find((i: any) => i.company_status === "active") || (exact.length === 1 ? exact[0] : null);
      if (pick?.company_number) chNumber = pick.company_number;
    } catch (e: any) {
      console.warn(`[property-enrich] CH search failed for "${co.name}": ${e?.message}`);
    }
  }

  if (chNumber && !co.companies_house_number) {
    await pool.query(
      `UPDATE crm_companies SET companies_house_number = $1, updated_at = now()
        WHERE id = $2 AND (companies_house_number IS NULL OR companies_house_number = '')`,
      [chNumber, co.id],
    );
    out.companiesHouseSet = true;
    console.log(`[property-enrich] ${p.name}: owner "${co.name}" → Companies House ${chNumber}`);
  }
  out.companiesHouseNumber = chNumber;

  if (chNumber && !co.uk_entity_name) {
    try {
      const profile = await chFetch(`/company/${encodeURIComponent(chNumber)}`);
      if (profile?.company_name) {
        await pool.query(
          `UPDATE crm_companies SET uk_entity_name = $1, updated_at = now()
            WHERE id = $2 AND (uk_entity_name IS NULL OR uk_entity_name = '')`,
          [profile.company_name, co.id],
        );
        out.ukEntitySet = true;
      }
    } catch (e: any) {
      console.warn(`[property-enrich] CH profile failed for ${chNumber}: ${e?.message}`);
    }
  }

  // Un-parked → run the AML sweep (officers, PSCs, accounts, sanctions) so
  // the checklist fills itself in. Once a day per company at most.
  const needsSweep = chNumber && (out.companiesHouseSet || !co.companies_house_data);
  if (needsSweep && (amlKicked.get(co.id) || 0) < Date.now() - 24 * 60 * 60 * 1000) {
    amlKicked.set(co.id, Date.now());
    out.amlStarted = true;
    import("./kyc-orchestrator")
      .then(m => m.runAllAmlChecks(co.id, null, null))
      .then(() => console.log(`[property-enrich] AML sweep done for "${co.name}"`))
      .catch((e: any) => console.warn(`[property-enrich] AML sweep failed for "${co.name}": ${e?.message}`));
  }
}

// Map a use class / description / tenant hint to an asset class.
function classify(text: string): AssetClass | null {
  const t = text.toLowerCase();
  if (!t.trim()) return null;
  if (/\b(a3|a4|a5|e\(b\)|f&b|f\s*&\s*b|restaurant|cafe|café|coffee|bar|pub|takeaway|food)\b/.test(t)) return "F&B";
  if (/\b(d2|f2|e\(d\)|leisure|gym|fitness|cinema|bowling|hotel|spa|health club|padel)\b/.test(t)) return "Leisure";
  if (/\b(b2|b8|industrial|warehouse|logistics|distribution|trade counter|workshop)\b/.test(t)) return "Industrial";
  if (/\b(c3|c2|residential|flats?|apartments?|dwelling|btr|student)\b/.test(t)) return "Residential";
  if (/\b(b1|e\(g\)|office|offices|hq|headquarters|workspace|coworking)\b/.test(t)) return "Office";
  if (/\b(a1|a2|e\(a\)|e\(c\)|retail|shop|store|unit|kiosk|supermarket|showroom|pharmacy|bank)\b/.test(t)) return "Retail";
  return null;
}

function classFromName(name: string): AssetClass | null {
  const n = name.toLowerCase();
  if (/shopping centre|shopping center|retail park|outlet|mall|arcade|high street/.test(n)) return "Retail";
  if (/business park|office park|house\b.*\boffice|offices?\b/.test(n)) return "Office";
  if (/industrial estate|trading estate|logistics|distribution park|business centre/.test(n)) return "Industrial";
  if (/leisure park|cinema|stadium|arena/.test(n)) return "Leisure";
  return null;
}

async function loadUnitRows(propertyId: string) {
  return pool.query(
    `SELECT unit_name, use_class, NULL::text AS permitted_use, NULL::text AS tenant_name FROM property_units WHERE property_id = $1
     UNION ALL
     SELECT unit_number, NULL::text, permitted_use, tenant_name FROM tenancy_schedule_units WHERE property_id = $1
     LIMIT 300`,
    [propertyId],
  );
}

async function inferAssetClass(p: any, out: PropertyEnrichResult, units: { rows: any[] }) {
  if (p.asset_class) {
    out.assetClass = p.asset_class;
    out.assetClassSource = "existing";
    return;
  }
  const tally = new Map<AssetClass, number>();
  let signals = 0;
  for (const u of units.rows) {
    const c = classify(`${u.use_class || ""} ${u.permitted_use || ""} ${u.tenant_name || ""}`);
    if (c) { tally.set(c, (tally.get(c) || 0) + 1); signals++; }
  }
  let picked: AssetClass | null = null;
  let source: PropertyEnrichResult["assetClassSource"] = null;
  if (signals >= 2) {
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const [top] = ranked[0];
    // A parade of shops with a café is still Retail — F&B and Leisure sit
    // in the retail family. "Mixed Use" is reserved for a genuinely
    // different family (office / industrial / residential) carrying a
    // quarter or more of the units.
    const family = (c: AssetClass) => (c === "Retail" || c === "F&B" || c === "Leisure" ? "retail" : c);
    const otherFamilyStrong = ranked.slice(1).some(([c, n]) => family(c) !== family(top) && n / signals >= 0.25);
    picked = otherFamilyStrong ? "Mixed Use" : top;
    source = "units";
  }
  if (!picked) {
    picked = classFromName(p.name || "");
    if (picked) source = "name";
  }
  if (!picked) {
    // Last resort: a cheap model call. Only accepted when it's confident
    // and names one of our classes — "unknown" leaves the field blank.
    try {
      const addr = (p.address && typeof p.address === "object") ? p.address : {};
      const addressStr = [addr.address || addr.street || addr.line1, addr.city || addr.town, addr.postcode].filter(Boolean).join(", ");
      const sample = units.rows.slice(0, 15).map((u: any) => [u.unit_name, u.tenant_name, u.use_class || u.permitted_use].filter(Boolean).join(" · ")).filter(Boolean);
      const ownerRow = out.ownerCompanyId ? await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [out.ownerCompanyId]) : null;
      const res = await callClaude({
        model: CHATBGP_HELPER_MODEL,
        max_completion_tokens: 120,
        temperature: 0,
        messages: [{
          role: "user",
          content: `Classify this UK commercial property's primary asset class. Answer with JSON only: {"assetClass": one of ${JSON.stringify(ASSET_CLASSES)} or null, "confidence": 0-1}. Use null unless you are genuinely confident from the evidence (a well-known building, a clear name, or the units listed) — do not guess from the location alone.\nProperty: ${p.name}\nAddress: ${addressStr || "unknown"}\nOwner: ${ownerRow?.rows[0]?.name || "unknown"}\nUnits/tenants: ${sample.length ? sample.join("; ") : "none recorded"}`,
        }],
      });
      const parsed = safeParseJSON(res?.choices?.[0]?.message?.content || "");
      const ac = parsed?.assetClass;
      if (ac && (ASSET_CLASSES as readonly string[]).includes(ac) && Number(parsed?.confidence) >= 0.6) {
        picked = ac as AssetClass;
        source = "ai";
      }
    } catch (e: any) {
      console.warn(`[property-enrich] asset class AI fallback failed for ${p.name}: ${e?.message}`);
    }
  }

  if (picked) {
    const r = await pool.query(
      `UPDATE crm_properties SET asset_class = $1, updated_at = now() WHERE id = $2 AND asset_class IS NULL`,
      [picked, p.id],
    );
    if (r.rowCount) {
      out.assetClass = picked;
      out.assetClassSet = true;
      out.assetClassSource = source;
      console.log(`[property-enrich] ${p.name}: asset class → ${picked} (${source})`);
    }
  }
}

export async function enrichPropertyBasics(propertyId: string): Promise<PropertyEnrichResult> {
  const out: PropertyEnrichResult = {
    propertyId, ownerCompanyId: null, companiesHouseNumber: null, companiesHouseSet: false,
    ukEntitySet: false, amlStarted: false, assetClass: null, assetClassSet: false, assetClassSource: null,
    useClass: null, useClassSet: false, useClassSource: null, voaMatched: 0,
  };
  const { rows } = await pool.query(
    `SELECT id, name, address, postcode, asset_class, use_class, freeholder_id, long_leaseholder_id, landlord_id,
            proprietor_name, proprietor_type, proprietor_company_number
       FROM crm_properties WHERE id = $1`,
    [propertyId],
  );
  const p = rows[0];
  if (!p) return out;
  await resolveOwnerCompaniesHouse(p, out);
  const units = await loadUnitRows(p.id);
  await inferAssetClass(p, out, units);
  await inferUseClass(p, out, units.rows);
  return out;
}
