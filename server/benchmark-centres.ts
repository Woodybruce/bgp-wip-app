// Benchmark centres: the top UK schemes every Brand gap is read against
// (shared/uk-centres.ts, `top25`). Woody, 2026-11-15: "we could almost just
// set up property pages for them all at BGP", "a bit more info about other
// competing centres, news about what they are doing", and yes to Landsec
// logins opening them (public data only).
//
// - A centre's property record is found by `crm_properties.benchmark_centre`
//   (stamped here) or, failing that, by name and place. Missing records are
//   created only by an admin: Preview, then Apply. Never at boot.
// - `GET /api/benchmark-centres/:name` is the centre's box for every login:
//   who trades there (from store data), its opening news and the weekly
//   research. No BGP note, deal, contact or fee is in it. BGP staff are also
//   sent the property id, to open the BGP page.
// - `runCentreResearch` is the background job: a few centres a night, each
//   about once a week, read from the open web and saved on its record.
import { Router, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "./auth";
import { pool } from "./db";
import { UK_CENTRES, haversineKm, siteRadiusKm, type UkCentre } from "../shared/uk-centres";
import { isClientCrmCategory } from "../shared/tenant-categories";
import { isJunkBrand } from "../shared/junk-brand";

const router = Router();
const PRESENCE_KM = 0.7;
export const CENTRE_RESEARCH_DAYS = 7;
const CENTRES_PER_NIGHT = Math.max(0, Number(process.env.CENTRE_RESEARCH_NIGHTLY_CAP ?? 6) || 0);

export const benchmarkCentres = (): UkCentre[] => UK_CENTRES.filter(c => c.top25);
const norm = (v: string) => ` ${String(v || "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
const findCentre = (name: string): UkCentre | undefined => UK_CENTRES.find(c => norm(c.name) === norm(name));

let columnsEnsured = false;
async function ensureColumns() {
  if (columnsEnsured) return;
  await pool.query(`ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS benchmark_centre TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS benchmark_shared BOOLEAN`).catch(() => {});
  await pool.query(`ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS centre_research JSONB`).catch(() => {});
  await pool.query(`ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS centre_research_at TIMESTAMPTZ`).catch(() => {});
  columnsEnsured = true;
}

type CentreRecord = { id: string; name: string; landlordName: string | null; stamped: boolean; shared: boolean; hasSchedule: boolean; research: any; researchAt: string | null };

/** Each centre's property record, where there is one: the stamped record first, then a match by name and place. */
export async function centreRecords(centres: UkCentre[]): Promise<Map<string, CentreRecord>> {
  await ensureColumns();
  const rows: any[] = await pool.query(
    `SELECT p.id, p.name, p.latitude, p.longitude, p.benchmark_centre, p.benchmark_shared, p.centre_research, p.centre_research_at, l.name AS landlord_name,
            EXISTS (SELECT 1 FROM tenancy_schedule_units t WHERE t.property_id = p.id) AS has_schedule
       FROM crm_properties p LEFT JOIN crm_companies l ON l.id = p.landlord_id
      WHERE p.benchmark_centre IS NOT NULL OR (COALESCE(p.latitude, '') <> '' AND COALESCE(p.longitude, '') <> '')`
  ).then(r => r.rows);
  const out = new Map<string, CentreRecord>();
  const record = (p: any, stamped: boolean): CentreRecord => ({
    id: String(p.id), name: p.name, landlordName: p.landlord_name || null, stamped, shared: p.benchmark_shared === true, hasSchedule: !!p.has_schedule,
    research: p.centre_research || null, researchAt: p.centre_research_at ? new Date(p.centre_research_at).toISOString() : null,
  });
  for (const c of centres) {
    const stamped = rows.find(p => p.benchmark_centre && norm(p.benchmark_centre) === norm(c.name));
    if (stamped) { out.set(c.name, record(stamped, true)); continue; }
    const names = [c.name, ...c.aliases].map(norm);
    const hits = rows.filter(p => {
      const lat = parseFloat(p.latitude), lng = parseFloat(p.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng) && haversineKm(lat, lng, c.lat, c.lng) <= Math.max(siteRadiusKm(c), 1)
        && names.some(n => norm(p.name).includes(n) || n.includes(norm(p.name)));
    });
    const hit = hits.find(p => p.has_schedule) || hits[0];
    if (hit) out.set(c.name, record(hit, false));
  }
  return out;
}

// ── Admin: set the pages up. Preview lists what Apply would do. ──
async function plan() {
  const centres = benchmarkCentres();
  const records = await centreRecords(centres);
  return centres.map(c => {
    const r = records.get(c.name);
    return { centre: c.name, propertyId: r?.id || null, propertyName: r?.name || null, action: !r ? "create" as const : r.stamped ? "none" as const : "mark" as const };
  });
}

router.get("/api/admin/benchmark-centres", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try { res.json({ centres: await plan() }); }
  catch (e: any) { console.error("[benchmark-centres]", e?.message); res.status(500).json({ error: "The centre list could not be read" }); }
});

router.post("/api/admin/benchmark-centres/apply", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const rows = await plan();
    await client.query("BEGIN");
    let created = 0, marked = 0;
    for (const row of rows) {
      const c = findCentre(row.centre)!;
      if (row.action === "mark") {
        await client.query(`UPDATE crm_properties SET benchmark_centre = $2 WHERE id = $1 AND benchmark_centre IS NULL`, [row.propertyId, c.name]);
        marked++;
      } else if (row.action === "create") {
        await client.query(
          // A page made here holds nothing of BGP's, so it is shared: every
          // login may open and amend it. A page BGP already held is only
          // stamped above and stays as private as it was.
          `INSERT INTO crm_properties (name, latitude, longitude, asset_class, tags, benchmark_centre, benchmark_shared)
           VALUES ($1, $2, $3, 'Shopping Centre', 'Benchmark centre', $1, TRUE)`, [c.name, String(c.lat), String(c.lng)]);
        created++;
      }
    }
    await client.query("COMMIT");
    const { forgetSharedBenchmarkProperties } = await import("./company-scope");
    forgetSharedBenchmarkProperties();
    res.json({ created, marked, centres: await plan() });
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[benchmark-centres apply]", e?.message);
    res.status(500).json({ error: "The centre pages could not be set up" });
  } finally { client.release(); }
});

// ── The centre's box, for every login. Public data only. ──
router.get("/api/benchmark-centres/:name", requireAuth, async (req: Request, res: Response) => {
  try {
    const centre = findCentre(String(req.params.name));
    if (!centre) return res.status(404).json({ error: "Centre not found" });
    const { isClientRequestUser } = await import("./company-scope");
    const client = await isClientRequestUser(req as any);
    let jointAgent = false;
    if (client) { const { isJointAgentLogin } = await import("./landsec-access"); jointAgent = await isJointAgentLogin(req); }
    const record = (await centreRecords([centre])).get(centre.name) || null;

    // Who trades there: the centre's own schedule where BGP holds one, else
    // brands with a store inside the centre's ring.
    const radius = centre.radiusKm ?? PRESENCE_KM;
    const stores: any[] = await pool.query(
      `SELECT DISTINCT ON (s.brand_company_id) s.brand_company_id AS id, c.name, c.domain, c.company_type, c.fnb_sector
         FROM brand_stores s JOIN crm_companies c ON c.id = s.brand_company_id
        WHERE s.lat IS NOT NULL AND s.lng IS NOT NULL AND c.merged_into_id IS NULL AND c.archived_at IS NULL
          AND (s.status IS NULL OR s.status = 'open')
          AND s.lat BETWEEN $1 - 0.02 AND $1 + 0.02 AND s.lng BETWEEN $2 - 0.04 AND $2 + 0.04
          AND (6371 * acos(LEAST(1, cos(radians($1)) * cos(radians(s.lat)) * cos(radians(s.lng) - radians($2)) + sin(radians($1)) * sin(radians(s.lat))))) <= $3
        ORDER BY s.brand_company_id`, [centre.lat, centre.lng, radius]
    ).then(r => r.rows).catch(() => [] as any[]);
    const trading = stores
      .filter(b => !isJunkBrand({ name: b.name, companyType: b.company_type }))
      .map(b => ({ id: jointAgent ? null : String(b.id), name: b.name as string, domain: b.domain || null, leisure: isClientCrmCategory(b.company_type), type: String(b.company_type || "").replace(/^tenant\s*-\s*/i, "") || null }))
      .sort((a, b) => Number(b.leisure) - Number(a.leisure) || a.name.localeCompare(b.name));

    const research = record?.research && typeof record.research === "object" ? record.research : null;
    res.json({
      name: centre.name,
      owner: record?.landlordName || null,
      // BGP staff open any centre's page; a client login only a shared one.
      propertyId: record && (!client || record.shared) ? record.id : null,
      website: centre.feedPage || null,
      trading, tradingSource: "Store locations BGP holds, within the centre's footprint. Not a tenancy schedule.",
      research: research ? { summary: research.summary || null, items: Array.isArray(research.items) ? research.items.slice(0, 20) : [], citations: Array.isArray(research.citations) ? research.citations.slice(0, 10) : [] } : null,
      researchAt: record?.researchAt || null,
    });
  } catch (e: any) {
    console.error("[benchmark-centre]", e?.message);
    res.status(500).json({ error: "The centre could not be loaded" });
  }
});

// The research on the centre's own property page, for whoever may open it.
router.get("/api/properties/:id/centre-research", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureColumns();
    const id = String(req.params.id);
    const { resolveCompanyScope, isPropertyInScope } = await import("./company-scope");
    const scope = await resolveCompanyScope(req as any);
    if (scope && !(await isPropertyInScope(scope, id))) return res.status(403).json({ error: "Not available for this account" });
    const row = (await pool.query(`SELECT benchmark_centre, benchmark_shared, centre_research, centre_research_at FROM crm_properties WHERE id = $1`, [id])).rows[0];
    if (!row?.benchmark_centre) return res.json({ centre: null });
    const research = row.centre_research && typeof row.centre_research === "object" ? row.centre_research : null;
    res.json({
      centre: row.benchmark_centre, shared: row.benchmark_shared === true,
      research: research ? { summary: research.summary || null, items: Array.isArray(research.items) ? research.items.slice(0, 30) : [], citations: [] } : null,
      researchAt: row.centre_research_at ? new Date(row.centre_research_at).toISOString() : null,
    });
  } catch (e: any) {
    console.error("[centre-research read]", e?.message);
    res.status(500).json({ error: "The centre research could not be loaded" });
  }
});

// ── Weekly research, a few centres a night. ──
const RESEARCH_SCHEMA = {
  name: "centre_research",
  schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string" },
            kind: { type: "string", enum: ["opening", "closure", "redevelopment", "ownership", "leasing", "other"] },
            headline: { type: "string" },
            detail: { type: "string" },
            brand: { type: "string" },
            source_url: { type: "string" },
          },
          required: ["kind", "headline"],
        },
      },
    },
    required: ["items"],
  },
};

export function centreResearchPrompt(centre: UkCentre, owner: string | null): string {
  return `Research ${centre.name}${centre.aliases.length ? ` (also written ${centre.aliases.filter(a => a !== centre.name).slice(0, 2).join(", ")})` : ""}, the UK shopping destination${owner ? `, owned by ${owner}` : ""}. `
    + `Report only what published sources from the last 12 months state: brands that have opened or signed, brands that have closed or are leaving, redevelopment, extension or repositioning plans, changes of owner or asset manager, and changes of leasing agent. `
    + `Give each as one item with its date (yyyy-mm-dd, or yyyy-mm if the day is not stated), a kind, a one-line headline, one sentence of detail, the brand named where there is one, and the source link. `
    + `Leave out anything you cannot source, and anything about a different centre. Then one or two plain sentences summarising what the centre is doing.`;
}

/** Keep only well-formed items, newest first. */
export function cleanResearchItems(raw: unknown): Array<{ date: string | null; kind: string; headline: string; detail: string | null; brand: string | null; source_url: string | null }> {
  const kinds = new Set(["opening", "closure", "redevelopment", "ownership", "leasing", "other"]);
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((i: any) => i && typeof i.headline === "string" && i.headline.trim())
    .map((i: any) => ({
      date: typeof i.date === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(i.date.trim()) ? i.date.trim() : null,
      kind: kinds.has(i.kind) ? i.kind : "other",
      headline: String(i.headline).trim().slice(0, 220),
      detail: typeof i.detail === "string" && i.detail.trim() ? i.detail.trim().slice(0, 500) : null,
      brand: typeof i.brand === "string" && i.brand.trim() ? i.brand.trim().slice(0, 80) : null,
      source_url: typeof i.source_url === "string" && /^https?:\/\//i.test(i.source_url.trim()) ? i.source_url.trim() : null,
    }))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 30);
}

export async function runCentreResearch(): Promise<{ due: number; read: number; errors: number }> {
  const out = { due: 0, read: 0, errors: 0 };
  if (!CENTRES_PER_NIGHT) return out;
  const { isPerplexityConfigured, askPerplexity } = await import("./perplexity");
  if (!isPerplexityConfigured()) return out;
  const centres = benchmarkCentres();
  const records = await centreRecords(centres);
  const staleBefore = Date.now() - CENTRE_RESEARCH_DAYS * 86400000;
  const due = centres
    .map(c => ({ c, r: records.get(c.name) }))
    .filter((x): x is { c: UkCentre; r: CentreRecord } => !!x.r && (!x.r.researchAt || new Date(x.r.researchAt).getTime() < staleBefore))
    .sort((a, b) => String(a.r.researchAt || "").localeCompare(String(b.r.researchAt || "")));
  out.due = due.length;
  for (const { c, r } of due.slice(0, CENTRES_PER_NIGHT)) {
    try {
      const px = await askPerplexity(centreResearchPrompt(c, r.landlordName), { searchRecency: "year", maxTokens: 2200, jsonSchema: RESEARCH_SCHEMA } as any);
      let parsed: any = null;
      try { parsed = JSON.parse(px.answer.replace(/^```(json)?/m, "").replace(/```$/m, "").trim()); } catch {}
      const items = cleanResearchItems(parsed?.items);
      // An empty or unreadable answer is not saved over what is held, but the
      // date moves on so one centre does not take every night's allowance.
      if (items.length || !r.research) {
        await pool.query(`UPDATE crm_properties SET centre_research = $2, centre_research_at = now() WHERE id = $1`,
          [r.id, JSON.stringify({ summary: typeof parsed?.summary === "string" ? parsed.summary.trim().slice(0, 600) : null, items, citations: px.citations || [], model: px.model })]);
      } else {
        await pool.query(`UPDATE crm_properties SET centre_research_at = now() WHERE id = $1`, [r.id]);
      }
      out.read++;
    } catch (e: any) {
      out.errors++;
      console.warn(`[centre-research] ${c.name}: ${e?.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  return out;
}

export default router;
