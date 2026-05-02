/**
 * Activity Curation Routes
 * ========================
 *
 * Single endpoint that drives the <AIActivityCard> on every surface that
 * shows curated email + meeting activity (deal pages, brand profiles,
 * contact pages, hunter rows, etc.).
 *
 * GET  /api/activity/:subjectType/:subjectId  → cached curation (or null)
 * POST /api/activity/:subjectType/:subjectId/curate  → fresh curation
 *
 * Subjects supported: deal | brand | landlord | contact | property
 *
 * Caching: each curate call costs ~30s and 50k+ tokens, so results are
 * stored in crm_activity_cache keyed by (subject_type, subject_id). The
 * GET handler returns the cached row; POST forces a refresh.
 *
 * Side effect: a successful curation writes the latestActivityDate back
 * to the underlying record's `last_interaction` column so the Deals
 * board / Companies board can show colour-coded "Last Touch" badges
 * without re-running the curator on every render.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import {
  curateActivity,
  type ActivitySubject,
  type CuratedActivity,
} from "./ai-activity-curator";

type SubjectType = ActivitySubject["type"];
const VALID_TYPES: SubjectType[] = ["deal", "brand", "landlord", "contact", "property"];

// Resolve seed terms for a given subject by reading the underlying CRM
// records. Keeps the prompt-builder pure — all DB lookups happen here.
async function buildSubject(type: SubjectType, id: string): Promise<ActivitySubject | null> {
  switch (type) {
    case "deal": {
      const r = await pool.query(
        `SELECT d.id, d.name, d.tenant_id, d.landlord_id, d.vendor_id, d.purchaser_id,
                d.property_id, d.client_contact_id,
                p.name AS property_name, p.postcode AS property_postcode,
                t.name AS tenant_name, l.name AS landlord_name,
                v.name AS vendor_name, pu.name AS purchaser_name,
                c.name AS contact_name
         FROM crm_deals d
         LEFT JOIN crm_properties p ON p.id = d.property_id
         LEFT JOIN crm_companies t ON t.id = d.tenant_id
         LEFT JOIN crm_companies l ON l.id = d.landlord_id
         LEFT JOIN crm_companies v ON v.id = d.vendor_id
         LEFT JOIN crm_companies pu ON pu.id = d.purchaser_id
         LEFT JOIN crm_contacts c ON c.id = d.client_contact_id
         WHERE d.id = $1`,
        [id]
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        type: "deal",
        id,
        name: row.name,
        address: row.property_name,
        postcode: row.property_postcode,
        tenantName: row.tenant_name,
        landlordName: row.landlord_name,
        vendorName: row.vendor_name,
        purchaserName: row.purchaser_name,
        contactNames: row.contact_name ? [row.contact_name] : [],
      };
    }
    case "brand":
    case "landlord": {
      const r = await pool.query(
        `SELECT id, name, parent_company_id FROM crm_companies WHERE id = $1`,
        [id]
      );
      const row = r.rows[0];
      if (!row) return null;
      const aliases: string[] = [];
      if (row.parent_company_id) {
        const p = await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [row.parent_company_id]);
        if (p.rows[0]?.name) aliases.push(p.rows[0].name);
      }
      // For landlords, pull a few of their owned property names as extra seed terms.
      let addresses: string[] | undefined;
      if (type === "landlord") {
        const props = await pool.query(
          `SELECT name FROM crm_properties WHERE landlord_id = $1 LIMIT 8`,
          [id]
        );
        addresses = props.rows.map((p) => p.name).filter(Boolean);
      }
      const contactsRes = await pool.query(
        `SELECT name FROM crm_contacts WHERE company_id = $1 LIMIT 6`,
        [id]
      );
      const contactNames = contactsRes.rows.map((c) => c.name).filter(Boolean);
      return type === "brand"
        ? { type: "brand", id, name: row.name, aliases, contactNames }
        : { type: "landlord", id, name: row.name, aliases, addresses, contactNames };
    }
    case "contact": {
      const r = await pool.query(
        `SELECT c.id, c.name, c.email, co.name AS company_name
         FROM crm_contacts c
         LEFT JOIN crm_companies co ON co.id = c.company_id
         WHERE c.id = $1`,
        [id]
      );
      const row = r.rows[0];
      if (!row) return null;
      return { type: "contact", id, name: row.name, email: row.email, companyName: row.company_name };
    }
    case "property": {
      const r = await pool.query(
        `SELECT id, name, postcode FROM crm_properties WHERE id = $1`,
        [id]
      );
      const row = r.rows[0];
      if (!row) return null;
      return { type: "property", id, address: row.name, postcode: row.postcode };
    }
  }
  return null;
}

// Read cached curation. Returns null if no cache row exists.
async function readCache(type: SubjectType, id: string): Promise<(CuratedActivity & { fromCache: true }) | null> {
  const r = await pool.query(
    `SELECT markdown, email_refs, meeting_refs, latest_at, generated_at
     FROM crm_activity_cache WHERE subject_type = $1 AND subject_id = $2`,
    [type, id]
  );
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  return {
    fromCache: true,
    markdown: row.markdown || "",
    emailHits: Array.isArray(row.email_refs) ? row.email_refs : [],
    meetingHits: Array.isArray(row.meeting_refs) ? row.meeting_refs : [],
    generatedAt: row.generated_at instanceof Date ? row.generated_at.toISOString() : String(row.generated_at),
    latestActivityDate: row.latest_at instanceof Date ? row.latest_at.toISOString() : (row.latest_at || null),
  };
}

async function writeCache(type: SubjectType, id: string, curated: CuratedActivity): Promise<void> {
  await pool.query(
    `INSERT INTO crm_activity_cache (subject_type, subject_id, markdown, email_refs, meeting_refs, latest_at, generated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
     ON CONFLICT (subject_type, subject_id) DO UPDATE SET
       markdown = EXCLUDED.markdown,
       email_refs = EXCLUDED.email_refs,
       meeting_refs = EXCLUDED.meeting_refs,
       latest_at = EXCLUDED.latest_at,
       generated_at = EXCLUDED.generated_at`,
    [
      type,
      id,
      curated.markdown,
      JSON.stringify(curated.emailHits),
      JSON.stringify(curated.meetingHits),
      curated.latestActivityDate,
      curated.generatedAt,
    ]
  );
}

// Denormalise the latest activity date back onto the underlying CRM
// record so list views ("Last Touch" column on the Deals board) don't
// have to re-curate per row.
async function writeLastInteraction(type: SubjectType, id: string, latest: string | null): Promise<void> {
  if (!latest) return;
  try {
    if (type === "deal") {
      await pool.query(`UPDATE crm_deals SET last_interaction = $1 WHERE id = $2`, [latest, id]);
    } else if (type === "brand" || type === "landlord") {
      await pool.query(`UPDATE crm_companies SET last_interaction = $1 WHERE id = $2`, [latest, id]);
    } else if (type === "contact") {
      await pool.query(`UPDATE crm_contacts SET last_interaction = $1 WHERE id = $2`, [latest, id]);
    }
  } catch (err: any) {
    console.warn(`[activity-routes] writeLastInteraction(${type}/${id}) failed: ${err?.message}`);
  }
}

export function registerActivityRoutes(app: Express) {
  // Cached read — fast, used by <AIActivityCard> on first render.
  app.get("/api/activity/:subjectType/:subjectId", requireAuth, async (req: Request, res: Response) => {
    const { subjectType, subjectId } = req.params as { subjectType: SubjectType; subjectId: string };
    if (!VALID_TYPES.includes(subjectType)) return res.status(400).json({ error: "invalid subject type" });
    try {
      const cache = await readCache(subjectType, subjectId);
      res.json(cache || { fromCache: false, markdown: "", emailHits: [], meetingHits: [], generatedAt: null, latestActivityDate: null });
    } catch (err: any) {
      console.error(`[activity GET ${subjectType}/${subjectId}]`, err?.message);
      res.status(500).json({ error: err?.message || "failed" });
    }
  });

  // Fresh curation — expensive (~30s, full ChatBGP turn). Writes through
  // to the cache and denormalises lastInteraction onto the record.
  app.post("/api/activity/:subjectType/:subjectId/curate", requireAuth, async (req: Request, res: Response) => {
    const { subjectType, subjectId } = req.params as { subjectType: SubjectType; subjectId: string };
    if (!VALID_TYPES.includes(subjectType)) return res.status(400).json({ error: "invalid subject type" });

    try {
      const subject = await buildSubject(subjectType, subjectId);
      if (!subject) return res.status(404).json({ error: "subject not found" });

      const curated = await curateActivity(subject, req);
      if (!curated) return res.status(502).json({ error: "ChatBGP returned no usable response" });

      // Persist + denormalise — best effort, don't block the response.
      Promise.all([
        writeCache(subjectType, subjectId, curated),
        writeLastInteraction(subjectType, subjectId, curated.latestActivityDate),
      ]).catch((err) => console.warn(`[activity persist ${subjectType}/${subjectId}]`, err?.message));

      res.json({ ...curated, fromCache: false });
    } catch (err: any) {
      console.error(`[activity curate ${subjectType}/${subjectId}]`, err?.message);
      res.status(500).json({ error: err?.message || "curation failed" });
    }
  });
}
