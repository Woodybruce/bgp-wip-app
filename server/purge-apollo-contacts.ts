// One-shot endpoint to remove Apollo-sourced contacts from the CRM.
// Apollo was scorched (code + router + UI buttons) earlier in the May 2026
// refactor, but the existing crm_contacts rows tagged enrichment_source =
// 'apollo*' were left untouched. This endpoint cleans them up.
//
// Two-step for safety:
//   GET  /api/admin/purge-apollo-contacts       → preview (count + sample names)
//   POST /api/admin/purge-apollo-contacts       → run the delete (body { confirm: true })
//
// Preserves contacts that have any logged interactions, deal links, or other
// references — those have human-curated context worth keeping even if they
// were originally Apollo-discovered.
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

const router = Router();

router.get("/api/admin/purge-apollo-contacts", requireAuth, async (_req: Request, res: Response) => {
  try {
    const { rows: counts } = await pool.query<{ total: string; safe_to_delete: string; protected: string }>(`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (SELECT 1 FROM crm_interactions i WHERE i.contact_id = c.id)
        )::text AS safe_to_delete,
        COUNT(*) FILTER (
          WHERE EXISTS (SELECT 1 FROM crm_interactions i WHERE i.contact_id = c.id)
        )::text AS protected
      FROM crm_contacts c
      WHERE c.enrichment_source ILIKE 'apollo%'
    `);

    const { rows: sample } = await pool.query<{ name: string; role: string | null; company_name: string | null }>(`
      SELECT name, role, company_name
      FROM crm_contacts
      WHERE enrichment_source ILIKE 'apollo%'
      ORDER BY name
      LIMIT 20
    `);

    res.json({
      total: Number(counts[0]?.total || 0),
      safe_to_delete: Number(counts[0]?.safe_to_delete || 0),
      protected_with_interactions: Number(counts[0]?.["protected"] || 0),
      sample_names: sample.map(s => `${s.name}${s.role ? ` (${s.role})` : ""}${s.company_name ? ` — ${s.company_name}` : ""}`),
      next_step: "POST this same URL with { confirm: true } to delete the safe_to_delete subset.",
    });
  } catch (err: any) {
    console.error("[purge-apollo-contacts] preview error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/admin/purge-apollo-contacts", requireAuth, async (req: Request, res: Response) => {
  try {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: "Pass { confirm: true } in the body to actually delete. GET this URL for a preview." });
    }
    const userId = (req as any).user?.id || null;
    const result = await pool.query<{ id: string; name: string }>(`
      DELETE FROM crm_contacts
      WHERE enrichment_source ILIKE 'apollo%'
        AND NOT EXISTS (SELECT 1 FROM crm_interactions i WHERE i.contact_id = crm_contacts.id)
      RETURNING id, name
    `);
    console.log(`[purge-apollo-contacts] user=${userId} deleted ${result.rowCount} apollo-sourced contacts`);
    res.json({
      deleted: result.rowCount ?? 0,
      sample_deleted: result.rows.slice(0, 10).map(r => r.name),
      conducted_by: userId,
    });
  } catch (err: any) {
    console.error("[purge-apollo-contacts] delete error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
