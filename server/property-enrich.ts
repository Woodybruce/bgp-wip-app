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
  assetClassSource: "units" | "name" | "ai" | "existing" | null;
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

async function inferAssetClass(p: any, out: PropertyEnrichResult) {
  if (p.asset_class) {
    out.assetClass = p.asset_class;
    out.assetClassSource = "existing";
    return;
  }

  const units = await pool.query(
    `SELECT unit_name, use_class, NULL::text AS permitted_use, NULL::text AS tenant_name FROM property_units WHERE property_id = $1
     UNION ALL
     SELECT unit_number, NULL::text, permitted_use, tenant_name FROM tenancy_schedule_units WHERE property_id = $1
     LIMIT 300`,
    [p.id],
  );
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
  };
  const { rows } = await pool.query(
    `SELECT id, name, address, asset_class, freeholder_id, long_leaseholder_id, landlord_id,
            proprietor_name, proprietor_type, proprietor_company_number
       FROM crm_properties WHERE id = $1`,
    [propertyId],
  );
  const p = rows[0];
  if (!p) return out;
  await resolveOwnerCompaniesHouse(p, out);
  await inferAssetClass(p, out);
  return out;
}
