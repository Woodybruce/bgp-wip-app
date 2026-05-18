import { Router, Request } from "express";
import { requireAuth } from "./auth";

const router = Router();

let dbPool: any = null;
async function getPool() {
  if (!dbPool) {
    const { pool } = await import("./db");
    dbPool = pool;
  }
  return dbPool;
}

async function getUserId(req: Request): Promise<string | null> {
  return (req.session as any)?.userId || (req as any).tokenUserId || null;
}

// GET /api/client-teams/:clientCompanyId — list every BGP staff member on
// this client's team, joined onto HR (staff_profiles) for CV summary and
// onto crm_property_agents (filtered to properties owned by the client) so
// the org chart can show a "# properties" badge per person.
router.get("/api/client-teams/:clientCompanyId", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { clientCompanyId } = req.params;
    const rows = await pool.query(`
      SELECT m.id,
             m.client_company_id,
             m.user_id,
             m.team_group,
             m.role,
             m.reports_to_user_id,
             m.sort_order,
             u.username,
             u.name AS full_name,
             u.email,
             u.role            AS bgp_title,
             sp.cv_summary,
             sp.cv_specialisms,
             sp.bio,
             (SELECT COUNT(*)::int FROM crm_property_agents pa
                JOIN crm_properties p ON p.id = pa.property_id
               WHERE pa.user_id = m.user_id
                 AND p.landlord_id = m.client_company_id) AS property_count
      FROM crm_client_team_members m
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN staff_profiles sp ON sp.user_id = m.user_id
      WHERE m.client_company_id = $1
      ORDER BY m.sort_order, COALESCE(m.team_group, ''), u.name
    `, [clientCompanyId]);
    res.json(rows.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/client-teams/:clientCompanyId/member — add a BGP user to the
// team. Idempotent thanks to the UNIQUE(client_company_id, user_id)
// constraint — duplicate calls return the existing row.
router.post("/api/client-teams/:clientCompanyId/member", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { clientCompanyId } = req.params;
    const { user_id, team_group, role, reports_to_user_id, sort_order } = req.body || {};
    if (!user_id) return res.status(400).json({ error: "user_id is required" });
    const ins = await pool.query(`
      INSERT INTO crm_client_team_members
        (client_company_id, user_id, team_group, role, reports_to_user_id, sort_order)
      VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0))
      ON CONFLICT (client_company_id, user_id) DO UPDATE
        SET team_group = COALESCE(EXCLUDED.team_group, crm_client_team_members.team_group),
            role = COALESCE(EXCLUDED.role, crm_client_team_members.role)
      RETURNING *
    `, [clientCompanyId, user_id, team_group || null, role || null, reports_to_user_id || null, sort_order]);
    res.json(ins.rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/client-teams/member/:id — update any subset of fields. The
// whitelist keeps stray request bodies from rewriting client_company_id /
// user_id (which would corrupt the membership identity).
router.patch("/api/client-teams/member/:id", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const allowed = ["team_group", "role", "reports_to_user_id", "sort_order"];
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    for (const f of allowed) {
      if (f in (req.body || {})) {
        sets.push(`${f} = $${i++}`);
        vals.push(req.body[f] === "" ? null : req.body[f]);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: "no fields to update" });
    vals.push(req.params.id);
    const r = await pool.query(
      `UPDATE crm_client_team_members SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
      vals
    );
    if (!r.rows[0]) return res.status(404).json({ error: "not found" });
    res.json(r.rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/api/client-teams/member/:id", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    await pool.query("DELETE FROM crm_client_team_members WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/client-teams/:clientCompanyId/candidates — list BGP staff
// who aren't already on this client's team, so the "Add to team" picker
// has a clean shortlist. Excludes leavers via staff_profiles.status.
router.get("/api/client-teams/:clientCompanyId/candidates", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const rows = await pool.query(`
      SELECT u.id, u.name AS full_name, u.username, u.email, u.role AS bgp_title
      FROM users u
      LEFT JOIN staff_profiles sp ON sp.user_id = u.id
      WHERE COALESCE(sp.status, 'active') = 'active'
        AND u.id NOT IN (
          SELECT user_id FROM crm_client_team_members WHERE client_company_id = $1
        )
      ORDER BY u.name, u.username
    `, [req.params.clientCompanyId]);
    res.json(rows.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
