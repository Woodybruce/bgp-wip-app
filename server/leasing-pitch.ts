// ─────────────────────────────────────────────────────────────────────────
// Leasing pitch + tenant-mix recommender.
//
// A leasing pitch is the per-property capture of ERV, incentives, positioning
// and target brands. It's created at instruction time and drives the initial
// leasing schedule.
//
// The tenant-mix recommender asks Claude to propose a plausible mix of brands
// for a property given its context, and — where possible — matches each
// recommendation against tracked brands in crm_companies so we can pitch
// directly.
//
// Endpoints:
//   GET  /api/leasing-pitch/:propertyId            — load (or empty shell)
//   PUT  /api/leasing-pitch/:propertyId            — upsert
//   POST /api/leasing-pitch/:propertyId/recommend-mix
//                                                  — AI mix, matched to CRM
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import Anthropic from "@anthropic-ai/sdk";

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-4-5-20251001";

const PITCH_FIELDS = [
  "erv", "erv_per_sqft", "incentive_plan", "rent_free_months",
  "capex_contribution", "fit_out_contribution", "target_brand_ids",
  "marketing_strategy", "positioning",
] as const;

// ─── Load + upsert ───────────────────────────────────────────────────────
router.get("/api/leasing-pitch/:propertyId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM leasing_pitch WHERE property_id = $1`,
      [req.params.propertyId]
    );
    res.json({ pitch: rows[0] || null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/leasing-pitch/:propertyId", requireAuth, async (req, res) => {
  try {
    const propertyId = String(req.params.propertyId);
    const body = req.body || {};

    const existing = await pool.query(
      `SELECT id FROM leasing_pitch WHERE property_id = $1`,
      [propertyId]
    );

    if (existing.rows[0]) {
      const sets: string[] = [];
      const vals: any[] = [];
      let i = 1;
      for (const f of PITCH_FIELDS) {
        const camel = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        const v = f in body ? body[f] : (camel in body ? body[camel] : undefined);
        if (v !== undefined) {
          sets.push(`${f} = $${i++}`);
          vals.push(v);
        }
      }
      if (!sets.length) return res.json({ ok: true, unchanged: true });
      sets.push("updated_at = now()");
      vals.push(propertyId);
      const r = await pool.query(
        `UPDATE leasing_pitch SET ${sets.join(", ")} WHERE property_id = $${i} RETURNING *`,
        vals
      );
      return res.json({ pitch: r.rows[0] });
    }

    const cols: string[] = ["property_id"];
    const placeholders: string[] = ["$1"];
    const vals: any[] = [propertyId];
    let i = 2;
    for (const f of PITCH_FIELDS) {
      const camel = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const v = f in body ? body[f] : (camel in body ? body[camel] : undefined);
      if (v !== undefined) {
        cols.push(f);
        placeholders.push(`$${i++}`);
        vals.push(v);
      }
    }
    const r = await pool.query(
      `INSERT INTO leasing_pitch (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
      vals
    );
    res.json({ pitch: r.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Tenant-mix recommender ──────────────────────────────────────────────
//
// Loads the property context + any existing leasing_pitch, asks Claude for a
// plausible tenant mix (categories + specific brands), then tries to match
// each brand name against crm_companies (preferring is_tracked_brand=true).
// Returns a structured recommendation the UI can turn into actions (pitch to
// brand, add to target_brand_ids, etc.).

type Recommendation = {
  category: string;
  rationale: string;
  brands: Array<{
    name: string;
    why: string;
    match?: { id: string; name: string; is_tracked_brand: boolean; rollout_status: string | null } | null;
  }>;
};

async function loadPropertyContext(propertyId: string) {
  const propQ = pool.query(
    `SELECT id, name, address, asset_class, sqft, notes, website
       FROM crm_properties WHERE id = $1`,
    [propertyId]
  );
  const pitchQ = pool.query(
    `SELECT * FROM leasing_pitch WHERE property_id = $1`,
    [propertyId]
  );
  // Nearby / recent comps, as soft market colour
  const compsQ = pool.query(
    `SELECT name, tenant, landlord, passing_rent_pa, area_sqft
       FROM crm_comps
      WHERE property_id = $1
      ORDER BY completion_date DESC NULLS LAST
      LIMIT 10`,
    [propertyId]
  );
  const [prop, pitch, comps] = await Promise.all([propQ, pitchQ, compsQ]);
  return {
    property: prop.rows[0] || null,
    pitch: pitch.rows[0] || null,
    comps: comps.rows,
  };
}

function buildPrompt(ctx: any): string {
  const p = ctx.property;
  const pitch = ctx.pitch;
  const addr = p?.address ? (typeof p.address === "string" ? p.address : JSON.stringify(p.address)) : "unknown";
  const comps = ctx.comps.length
    ? ctx.comps.map((c: any) => `- ${c.tenant || "?"} @ ${c.name || "?"}${c.passing_rent_pa ? ` £${c.passing_rent_pa}pa` : ""}${c.area_sqft ? ` ${c.area_sqft} sqft` : ""}`).join("\n")
    : "(none)";
  return `You are a retail leasing strategist for Bruce Gillingham Pollard, a UK commercial property agency. Recommend a tenant mix for the property below.

PROPERTY
- Name: ${p?.name || "(unnamed)"}
- Address: ${addr}
- Asset class: ${p?.asset_class || "unknown"}
- Total sqft: ${p?.sqft ?? "unknown"}
- Notes: ${p?.notes || "(none)"}

EXISTING PITCH
- ERV: ${pitch?.erv ? `£${pitch.erv}/yr` : "unset"} (${pitch?.erv_per_sqft ? `£${pitch.erv_per_sqft}/sqft` : ""})
- Incentives: ${pitch?.incentive_plan || "(none)"}
- Positioning: ${pitch?.positioning || "(none)"}
- Marketing strategy: ${pitch?.marketing_strategy || "(none)"}

NEARBY / RECENT COMPS
${comps}

Return JSON (no prose, no fences) in this exact shape:
{
  "headline": "1-sentence framing for the recommended mix",
  "categories": [
    {
      "category": "e.g. 'Elevated casual dining', 'Wellness anchor', 'Premium fashion'",
      "rationale": "why this category fits the property / catchment / existing pitch (1-2 sentences)",
      "brands": [
        { "name": "specific UK-active brand name", "why": "why this brand specifically (1 sentence)" }
      ]
    }
  ]
}

Constraints:
- 3–5 categories max.
- 2–4 brands per category.
- Brands must be UK-active and realistically plausible for the asset class.
- Do not include brands already in the property's existing tenancy (if notes mention them).
- Prefer brands BGP would plausibly have a route into: fast-scaling DTC, food hall operators, wellness, elevated F&B, experiential retail.`;
}

async function matchBrandsToCrm(
  names: string[]
): Promise<Map<string, { id: string; name: string; is_tracked_brand: boolean; rollout_status: string | null }>> {
  if (!names.length) return new Map();
  const { rows } = await pool.query(
    `SELECT id, name, is_tracked_brand, rollout_status
       FROM crm_companies
      WHERE lower(name) = ANY($1::text[])`,
    [names.map(n => n.toLowerCase())]
  );
  const byKey = new Map<string, any>();
  for (const r of rows) byKey.set(String(r.name).toLowerCase(), r);
  // Prefer tracked brand if there are duplicates — resolve by re-scanning
  const resolved = new Map<string, any>();
  for (const r of rows) {
    const k = String(r.name).toLowerCase();
    const prior = resolved.get(k);
    if (!prior || (r.is_tracked_brand && !prior.is_tracked_brand)) resolved.set(k, r);
  }
  const out = new Map<string, any>();
  for (const n of names) out.set(n, resolved.get(n.toLowerCase()) || null);
  return out;
}

router.post("/api/leasing-pitch/:propertyId/recommend-mix", requireAuth, async (req, res) => {
  try {
    const propertyId = String(req.params.propertyId);
    const ctx = await loadPropertyContext(propertyId);
    if (!ctx.property) return res.status(404).json({ error: "Property not found" });

    const prompt = buildPrompt(ctx);
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });
    const txt = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
    const match = txt.match(/\{[\s\S]*\}/);
    if (!match) return res.status(502).json({ error: "AI returned unparseable response" });

    let parsed: any;
    try { parsed = JSON.parse(match[0]); }
    catch { return res.status(502).json({ error: "AI JSON parse failed" }); }

    const rawCats: any[] = Array.isArray(parsed?.categories) ? parsed.categories : [];
    const allNames: string[] = [];
    for (const c of rawCats) {
      for (const b of (Array.isArray(c.brands) ? c.brands : [])) {
        if (typeof b?.name === "string") allNames.push(b.name);
      }
    }
    const matches = await matchBrandsToCrm(allNames);

    const recommendations: Recommendation[] = rawCats.map((c: any) => ({
      category: String(c.category || "Uncategorised"),
      rationale: String(c.rationale || ""),
      brands: (Array.isArray(c.brands) ? c.brands : []).map((b: any) => ({
        name: String(b.name || ""),
        why: String(b.why || ""),
        match: matches.get(String(b.name || "")) || null,
      })).filter((b: any) => b.name),
    }));

    // Persist last recommendation on the pitch so the UI can re-open it
    await pool.query(
      `INSERT INTO leasing_pitch (property_id, ai_generated_fields, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (property_id) DO UPDATE
         SET ai_generated_fields =
               COALESCE(leasing_pitch.ai_generated_fields, '{}'::jsonb)
               || jsonb_build_object('tenant_mix', $2::jsonb, 'tenant_mix_at', to_jsonb(now())),
             updated_at = now()`,
      [propertyId, JSON.stringify({ headline: parsed.headline || "", recommendations, generated_at: new Date().toISOString() })]
    );

    res.json({
      headline: parsed.headline || "",
      recommendations,
      trackedBrandCount: Array.from(matches.values()).filter((m: any) => m?.is_tracked_brand).length,
    });
  } catch (err: any) {
    console.error("[tenant-mix] error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
