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

// The board can hang off a duplicate company row (a second "Landsec"
// record), so writes have to match rows on any same-named unmerged sibling
// — the same set the GET reads across.
async function boardCompanyIds(pool: any, clientCompanyId: string): Promise<string[]> {
  const r = await pool.query(`
    SELECT id FROM crm_companies WHERE id = $1
    UNION
    SELECT c2.id FROM crm_companies c1
      JOIN crm_companies c2
        ON lower(trim(c2.name)) = lower(trim(c1.name)) AND c2.id <> c1.id
     WHERE c1.id = $1 AND c2.merged_into_id IS NULL
  `, [clientCompanyId]);
  return r.rows.map((x: any) => x.id);
}

// A client login may only touch its OWN team board. Staff (null scope) pass.
// The board can span same-named sibling company records, so the caller's
// scope is expanded to that set before comparing. Returns true when the
// request must be REFUSED (so callers do `if (await forbidsClientScope(...)) return 403`).
async function forbidsClientScope(req: Request, targetCompanyId: string | null | undefined): Promise<boolean> {
  const { resolveCompanyScope } = await import("./company-scope");
  const scopeCompanyId = await resolveCompanyScope(req);
  if (!scopeCompanyId) return false; // BGP staff — unrestricted
  if (!targetCompanyId) return true;
  if (scopeCompanyId === targetCompanyId) return false;
  const pool = await getPool();
  const boardIds = await boardCompanyIds(pool, scopeCompanyId);
  return !boardIds.includes(targetCompanyId);
}

// GET /api/client-teams/:clientCompanyId — list every BGP staff member on
// this client's team, joined onto HR (staff_profiles) for CV summary and
// onto crm_property_agents (filtered to properties owned by the client) so
// the org chart can show a "# properties" badge per person.
router.get("/api/client-teams/:clientCompanyId", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { clientCompanyId } = req.params;
    // A client may only see their OWN account team — never another company's
    // BGP staff (names, emails, CVs). Staff (null scope) see any. (Landsec audit.)
    const { resolveCompanyScope } = await import("./company-scope");
    const scopeCompanyId = await resolveCompanyScope(req);
    if (scopeCompanyId && scopeCompanyId !== clientCompanyId) {
      return res.status(403).json({ error: "Access denied" });
    }
    // Two sources, unioned: the curated org chart (crm_client_team_members)
    // PLUS everyone assigned to one of the client's properties via
    // crm_property_agents — otherwise the board reads "no team" while the
    // property pages show a full BGP Contacts strip. Each row also carries
    // the list of the client's properties that person covers, so the board
    // can show who is on what.
    const rows = await pool.query(`
      WITH board_companies AS (
        -- The BGP-maintained board is the source of truth, but it can hang
        -- off a duplicate company row (a second "Landsec" record). Read the
        -- board across every same-named, unmerged sibling so the client card
        -- always reflects what BGP configured.
        SELECT id FROM crm_companies WHERE id = $1
        UNION
        SELECT c2.id FROM crm_companies c1
          JOIN crm_companies c2
            ON lower(trim(c2.name)) = lower(trim(c1.name)) AND c2.id <> c1.id
         WHERE c1.id = $1 AND c2.merged_into_id IS NULL
      ),
      scoped_props AS (
        SELECT id, name FROM crm_properties
         WHERE landlord_id IN (SELECT id FROM board_companies)
        UNION
        SELECT p.id, p.name FROM crm_company_properties cp
          JOIN crm_properties p ON p.id = cp.property_id
         WHERE cp.company_id IN (SELECT id FROM board_companies)
      ),
      agent_props AS (
        SELECT pa.user_id, pa.role, s.id AS property_id, s.name AS property_name
          FROM crm_property_agents pa
          JOIN scoped_props s ON s.id = pa.property_id
      ),
      members AS (
        SELECT m.id, m.user_id, m.team_group, m.role, m.reports_to_user_id,
               m.sort_order, COALESCE(m.is_lead, false) AS is_lead
          FROM crm_client_team_members m
         WHERE m.client_company_id IN (SELECT id FROM board_companies)
        UNION ALL
        SELECT 'pa-' || ap.user_id, ap.user_id, 'Property Team',
               MIN(ap.role), NULL, 999, bool_or(ap.role = 'Lead')
          FROM agent_props ap
         -- NOT EXISTS, not NOT IN: one NULL user_id on the curated board
         -- made NOT IN drop EVERY property agent from the card.
         WHERE NOT EXISTS (
                 SELECT 1 FROM crm_client_team_members m2
                  WHERE m2.client_company_id IN (SELECT id FROM board_companies)
                    AND m2.user_id = ap.user_id
               )
         GROUP BY ap.user_id
      )
      SELECT mem.id,
             $1 AS client_company_id,
             mem.user_id,
             mem.team_group,
             mem.role,
             mem.reports_to_user_id,
             mem.sort_order,
             mem.is_lead,
             u.username,
             u.name AS full_name,
             u.email,
             u.role            AS bgp_title,
             u.profile_pic_url,
             sp.cv_summary,
             sp.cv_specialisms,
             sp.bio,
             (SELECT COUNT(DISTINCT ap.property_id)::int FROM agent_props ap
               WHERE ap.user_id = mem.user_id) AS property_count,
             (SELECT array_agg(DISTINCT ap.property_name) FROM agent_props ap
               WHERE ap.user_id = mem.user_id) AS properties
      FROM members mem
      LEFT JOIN users u ON u.id = mem.user_id
      LEFT JOIN staff_profiles sp ON sp.user_id = mem.user_id
      ORDER BY mem.sort_order, COALESCE(mem.team_group, ''), u.name
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
    if (await forbidsClientScope(req, String(clientCompanyId))) return res.status(403).json({ error: "Not available for client accounts" });
    const { user_id, team_group, role, reports_to_user_id, sort_order, is_lead } = req.body || {};
    if (!user_id) return res.status(400).json({ error: "user_id is required" });
    // No ON CONFLICT — the UNIQUE constraint was dropped on boot so the
    // same person can sit in multiple columns on a client (e.g. Investment
    // + Lease Advisory). Each row is its own slot.
    if (is_lead === true) {
      const boardIds = await boardCompanyIds(pool, String(clientCompanyId));
      await pool.query(
        "UPDATE crm_client_team_members SET is_lead = false WHERE client_company_id = ANY($1)",
        [boardIds]
      );
    }
    const ins = await pool.query(`
      INSERT INTO crm_client_team_members
        (client_company_id, user_id, team_group, role, reports_to_user_id, sort_order, is_lead)
      VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), COALESCE($7, false))
      RETURNING *
    `, [clientCompanyId, user_id, (team_group === "Unassigned" ? null : team_group) || null, role || null, reports_to_user_id || null, sort_order, is_lead === true]);
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
    const ownerRow = await pool.query("SELECT client_company_id FROM crm_client_team_members WHERE id = $1", [req.params.id]);
    if (await forbidsClientScope(req, ownerRow.rows[0]?.client_company_id)) return res.status(403).json({ error: "Not available for client accounts" });
    const allowed = ["team_group", "role", "reports_to_user_id", "sort_order", "is_lead"];
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
    // If is_lead is being set true, clear it on every other member of the
    // same client so there's only ever one pinned lead at a time. Done in
    // a single statement to avoid races between concurrent toggles.
    if (req.body && req.body.is_lead === true) {
      const owner = await pool.query(
        "SELECT client_company_id FROM crm_client_team_members WHERE id = $1",
        [req.params.id]
      );
      if (owner.rows[0]) {
        // Clear the pin across same-named sibling company records too — the
        // board reads across them, so two pins would both render starred.
        const boardIds = await boardCompanyIds(pool, owner.rows[0].client_company_id);
        await pool.query(
          "UPDATE crm_client_team_members SET is_lead = false WHERE id <> $1 AND client_company_id = ANY($2)",
          [req.params.id, boardIds]
        );
      }
    }
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

// Bulk reorder — accepts an array of {id, team_group, sort_order}. The
// kanban board ships one of these after a drag-and-drop so the in-column
// stack order persists in a single round trip.
router.post("/api/client-teams/:clientCompanyId/reorder", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    if (await forbidsClientScope(req, String(req.params.clientCompanyId))) return res.status(403).json({ error: "Not available for client accounts" });
    const items: Array<{ id: string; team_group?: string | null; sort_order: number }> =
      req.body?.items || [];
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items array required" });
    }
    // Curated rows can live on a same-named duplicate company record, and
    // "pa-<user_id>" rows are synthesized from property assignments (no row
    // in crm_client_team_members at all) — both silently no-op'd on the old
    // exact-match UPDATE, which is why drags snapped back.
    const boardIds = await boardCompanyIds(pool, String(req.params.clientCompanyId));
    for (const it of items) {
      const tg = it.team_group === "Unassigned" ? null : (it.team_group ?? undefined);
      if (typeof it.id === "string" && it.id.startsWith("pa-")) {
        const userId = it.id.slice(3);
        const existing = await pool.query(
          "SELECT id FROM crm_client_team_members WHERE client_company_id = ANY($1) AND user_id = $2 ORDER BY created_at LIMIT 1",
          [boardIds, userId]
        );
        if (existing.rows[0]) {
          await pool.query(
            "UPDATE crm_client_team_members SET sort_order = $1, team_group = $2 WHERE id = $3",
            [it.sort_order, tg ?? null, existing.rows[0].id]
          );
        } else {
          await pool.query(
            "INSERT INTO crm_client_team_members (client_company_id, user_id, team_group, sort_order) VALUES ($1, $2, $3, $4)",
            [req.params.clientCompanyId, userId, tg ?? "Property Team", it.sort_order]
          );
        }
      } else if (tg === undefined) {
        await pool.query(
          "UPDATE crm_client_team_members SET sort_order = $1 WHERE id = $2 AND client_company_id = ANY($3)",
          [it.sort_order, it.id, boardIds]
        );
      } else {
        await pool.query(
          "UPDATE crm_client_team_members SET sort_order = $1, team_group = $2 WHERE id = $3 AND client_company_id = ANY($4)",
          [it.sort_order, tg, it.id, boardIds]
        );
      }
    }
    res.json({ ok: true, updated: items.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/api/client-teams/member/:id", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const id = String(req.params.id);

    // Auto-included members carry a synthesized "pa-<userId>" id — they're on
    // the board because they're assigned to the client's properties, so there
    // is no crm_client_team_members row to delete. Telling the user to go and
    // unassign the properties themselves made Remove look broken; do it for
    // them: drop their property-agent links on THIS client's properties (the
    // client company comes from the query, so we never touch another client's).
    if (id.startsWith("pa-")) {
      const userId = id.slice(3);
      const clientCompanyId = String(req.query.clientCompanyId || "");
      if (!clientCompanyId) {
        return res.status(400).json({ error: "clientCompanyId is required to remove an auto-included member" });
      }
      if (await forbidsClientScope(req, clientCompanyId)) return res.status(403).json({ error: "Not available for client accounts" });
      const del = await pool.query(`
        WITH board_companies AS (
          SELECT id FROM crm_companies WHERE id = $2
          UNION
          SELECT c2.id FROM crm_companies c1
            JOIN crm_companies c2
              ON lower(trim(c2.name)) = lower(trim(c1.name)) AND c2.id <> c1.id
           WHERE c1.id = $2 AND c2.merged_into_id IS NULL
        ),
        scoped_props AS (
          SELECT id FROM crm_properties WHERE landlord_id IN (SELECT id FROM board_companies)
          UNION
          SELECT property_id FROM crm_company_properties WHERE company_id IN (SELECT id FROM board_companies)
        )
        DELETE FROM crm_property_agents
         WHERE user_id = $1 AND property_id IN (SELECT id FROM scoped_props)
      `, [userId, clientCompanyId]);
      if (!del.rowCount) {
        return res.status(404).json({ error: "Nothing to remove — this person has no property assignments on this client." });
      }
      return res.json({ ok: true, removedPropertyAssignments: del.rowCount });
    }

    const ownerRow = await pool.query("SELECT client_company_id FROM crm_client_team_members WHERE id = $1", [id]);
    if (ownerRow.rows[0] && await forbidsClientScope(req, ownerRow.rows[0].client_company_id)) {
      return res.status(403).json({ error: "Not available for client accounts" });
    }
    const r = await pool.query("DELETE FROM crm_client_team_members WHERE id = $1", [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: "Team member not found" });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/client-teams/:clientCompanyId/member/:userId/properties — list
// every property on this landlord with an `assigned` flag for whether the
// given staff member is on the crm_property_agents link. Drives the
// multi-select in the org chart's side sheet.
router.get("/api/client-teams/:clientCompanyId/member/:userId/properties", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { clientCompanyId, userId } = req.params;
    // A client login may only read its OWN board's property assignments —
    // the rows carry the landlord's property names + postcodes, so an
    // unscoped read handed a rival client this company's whole portfolio.
    // (The POST sibling below was already scoped.)
    if (await forbidsClientScope(req, String(clientCompanyId))) return res.status(403).json({ error: "Not available for client accounts" });
    const rows = await pool.query(`
      SELECT p.id, p.name,
             -- crm_properties.address is JSONB. Pick a readable line so
             -- the client can render it without exploding on a raw object.
             COALESCE(
               NULLIF(TRIM(p.address->>'address'), ''),
               NULLIF(TRIM(p.address->>'street'), ''),
               NULLIF(TRIM(p.address->>'city'), ''),
               p.postcode
             ) AS address,
             EXISTS (
               SELECT 1 FROM crm_property_agents pa
                WHERE pa.property_id = p.id AND pa.user_id = $2
             ) AS assigned
      FROM crm_properties p
      WHERE p.landlord_id = $1
         OR p.id IN (SELECT property_id FROM crm_company_properties WHERE company_id = $1)
      ORDER BY p.name
    `, [clientCompanyId, userId]);
    res.json(rows.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST/DELETE bulk-toggle assignments. Body: { add: string[], remove: string[] }
// — both arrays of property_ids. Single request keeps the side-sheet
// commit atomic from the UI's point of view.
router.post("/api/client-teams/:clientCompanyId/member/:userId/properties", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { clientCompanyId, userId } = req.params;
    if (await forbidsClientScope(req, String(clientCompanyId))) return res.status(403).json({ error: "Not available for client accounts" });
    const { add = [], remove = [] } = (req.body || {}) as { add?: string[]; remove?: string[] };
    for (const pid of add) {
      // Guard against duplicate links — crm_property_agents doesn't carry
      // a UNIQUE(property_id, user_id) constraint in prod yet, so we
      // check-then-insert rather than ON CONFLICT.
      const exists = await pool.query(
        "SELECT 1 FROM crm_property_agents WHERE property_id = $1 AND user_id = $2 LIMIT 1",
        [pid, userId]
      );
      if (exists.rows.length > 0) continue;
      await pool.query(`
        INSERT INTO crm_property_agents (property_id, user_id)
        SELECT $1, $2 WHERE EXISTS (
          SELECT 1 FROM crm_properties p WHERE p.id = $1
             AND (p.landlord_id = $3
                  OR p.id IN (SELECT property_id FROM crm_company_properties WHERE company_id = $3))
        )
      `, [pid, userId, clientCompanyId]);
    }
    for (const pid of remove) {
      await pool.query(`
        DELETE FROM crm_property_agents pa
         USING crm_properties p
         WHERE pa.property_id = $1 AND pa.user_id = $2
           AND p.id = pa.property_id
           AND (p.landlord_id = $3
                OR p.id IN (SELECT property_id FROM crm_company_properties WHERE company_id = $3))
      `, [pid, userId, clientCompanyId]);
    }
    res.json({ ok: true, added: add.length, removed: remove.length });
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
    if (await forbidsClientScope(req, String(req.params.clientCompanyId))) return res.status(403).json({ error: "Not available for client accounts" });
    // No longer filter out staff who are already on the team — duplicates
    // are now allowed so the same person can sit in multiple columns
    // (Investment + Lease Advisory, etc). Mark the existing-on-team count
    // so the picker can hint "already on team in 2 columns" inline.
    const rows = await pool.query(`
      SELECT u.id, u.name AS full_name, u.username, u.email, u.role AS bgp_title,
             (SELECT COUNT(*)::int
                FROM crm_client_team_members tm
               WHERE tm.client_company_id = $1 AND tm.user_id = u.id) AS existing_count
      FROM users u
      LEFT JOIN staff_profiles sp ON sp.user_id = u.id
      WHERE COALESCE(sp.status, 'active') = 'active'
      ORDER BY u.name, u.username
    `, [req.params.clientCompanyId]);
    res.json(rows.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Default kanban column list, applied for any client that hasn't yet
// customised theirs. Mirrors the /team org chart columns.
const DEFAULT_COLUMNS = [
  "Office / Corporate",
  "Investment",
  "Lease Advisory",
  "National Leasing",
  "Development",
  "Tenant Rep",
  "London Leasing",
];

// GET /api/client-teams/:clientCompanyId/columns — returns the column
// list this client renders. Falls back to DEFAULT_COLUMNS when the row
// set is empty so brand-new clients get a usable board without seeding.
router.get("/api/client-teams/:clientCompanyId/columns", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    if (await forbidsClientScope(req, String(req.params.clientCompanyId))) return res.status(403).json({ error: "Not available for client accounts" });
    const r = await pool.query(
      "SELECT name, sort_order, color_key FROM crm_client_team_columns WHERE client_company_id = $1 ORDER BY sort_order, name",
      [req.params.clientCompanyId]
    );
    if (r.rows.length === 0) {
      return res.json(DEFAULT_COLUMNS.map((name, i) => ({ name, sort_order: i, color_key: null })));
    }
    res.json(r.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/client-teams/:clientCompanyId/columns — add a new column or
// upsert sort_order/color on an existing one. Body: { name, sort_order?, color_key? }.
router.post("/api/client-teams/:clientCompanyId/columns", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    if (await forbidsClientScope(req, req.params.clientCompanyId as string)) return res.status(403).json({ error: "Not available for client accounts" });
    const { name, sort_order, color_key } = req.body || {};
    if (!name || typeof name !== "string") return res.status(400).json({ error: "name required" });
    // First time a client edits columns, materialise the defaults so the
    // new column slots in alongside the standard ones rather than
    // replacing them entirely.
    await materialiseDefaultColumnsIfEmpty(pool, req.params.clientCompanyId as string);
    const r = await pool.query(`
      INSERT INTO crm_client_team_columns (client_company_id, name, sort_order, color_key)
      VALUES ($1::varchar, $2::text, COALESCE($3::int, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM crm_client_team_columns WHERE client_company_id = $1::varchar)), $4::text)
      ON CONFLICT (client_company_id, name) DO UPDATE
        SET sort_order = COALESCE(EXCLUDED.sort_order, crm_client_team_columns.sort_order),
            color_key  = COALESCE(EXCLUDED.color_key, crm_client_team_columns.color_key)
      RETURNING *
    `, [req.params.clientCompanyId, name.trim(), sort_order ?? null, color_key || null]);
    res.json(r.rows[0]);
  } catch (e: any) {
    console.error(`[client-teams] add column failed for ${req.params.clientCompanyId}:`, e?.code, e?.message);
    // 42703 = column doesn't exist (color_key missing on pre-migration tables).
    // Fall back to the column-less insert so the user can still add
    // columns until the next deploy migrates the schema.
    if (e?.code === "42703") {
      try {
        const pool = await getPool();
        const { name, sort_order } = req.body || {};
        const r = await pool.query(`
          INSERT INTO crm_client_team_columns (client_company_id, name, sort_order)
          VALUES ($1::varchar, $2::text, COALESCE($3::int, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM crm_client_team_columns WHERE client_company_id = $1::varchar)))
          ON CONFLICT (client_company_id, name) DO UPDATE
            SET sort_order = COALESCE(EXCLUDED.sort_order, crm_client_team_columns.sort_order)
          RETURNING client_company_id, name, sort_order
        `, [req.params.clientCompanyId, String(name).trim(), sort_order ?? null]);
        return res.json(r.rows[0]);
      } catch (e2: any) {
        console.error(`[client-teams] fallback add column also failed:`, e2?.message);
        return res.status(500).json({ error: e2.message });
      }
    }
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/client-teams/:clientCompanyId/columns/:oldName — rename a
// column AND rewrite team_group on every member currently in that column,
// so cards don't disappear into Unassigned when the label changes.
router.patch("/api/client-teams/:clientCompanyId/columns/:oldName", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    if (await forbidsClientScope(req, req.params.clientCompanyId as string)) return res.status(403).json({ error: "Not available for client accounts" });
    const { name } = req.body || {};
    if (!name || typeof name !== "string") return res.status(400).json({ error: "name required" });
    const oldName = decodeURIComponent(req.params.oldName as string);
    const newName = name.trim();
    if (newName === oldName) return res.json({ ok: true });
    await materialiseDefaultColumnsIfEmpty(pool, req.params.clientCompanyId as string);
    await pool.query(`
      UPDATE crm_client_team_columns SET name = $1
       WHERE client_company_id = $2 AND name = $3
    `, [newName, req.params.clientCompanyId, oldName]);
    await pool.query(`
      UPDATE crm_client_team_members SET team_group = $1
       WHERE client_company_id = $2 AND team_group = $3
    `, [newName, req.params.clientCompanyId, oldName]);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE — drops the column and demotes its members to Unassigned
// (NULL team_group). Doesn't remove any members.
router.delete("/api/client-teams/:clientCompanyId/columns/:name", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    if (await forbidsClientScope(req, req.params.clientCompanyId as string)) return res.status(403).json({ error: "Not available for client accounts" });
    const name = decodeURIComponent(req.params.name as string);
    await materialiseDefaultColumnsIfEmpty(pool, req.params.clientCompanyId as string);
    await pool.query(
      "DELETE FROM crm_client_team_columns WHERE client_company_id = $1 AND name = $2",
      [req.params.clientCompanyId, name]
    );
    await pool.query(
      "UPDATE crm_client_team_members SET team_group = NULL WHERE client_company_id = $1 AND team_group = $2",
      [req.params.clientCompanyId, name]
    );
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/client-teams/:clientCompanyId/columns/reorder — body: { names: string[] }
// Sets sort_order to the array index for each provided column name.
router.post("/api/client-teams/:clientCompanyId/columns/reorder", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    if (await forbidsClientScope(req, req.params.clientCompanyId as string)) return res.status(403).json({ error: "Not available for client accounts" });
    const names: string[] = req.body?.names || [];
    if (!Array.isArray(names)) return res.status(400).json({ error: "names array required" });
    await materialiseDefaultColumnsIfEmpty(pool, req.params.clientCompanyId as string);
    for (let i = 0; i < names.length; i++) {
      await pool.query(
        "UPDATE crm_client_team_columns SET sort_order = $1 WHERE client_company_id = $2 AND name = $3",
        [i, req.params.clientCompanyId, names[i]]
      );
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

async function materialiseDefaultColumnsIfEmpty(pool: any, clientCompanyId: string) {
  const check = await pool.query(
    "SELECT COUNT(*)::int AS n FROM crm_client_team_columns WHERE client_company_id = $1",
    [clientCompanyId]
  );
  if (Number(check.rows[0]?.n ?? 0) > 0) return;
  for (let i = 0; i < DEFAULT_COLUMNS.length; i++) {
    await pool.query(
      "INSERT INTO crm_client_team_columns (client_company_id, name, sort_order) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [clientCompanyId, DEFAULT_COLUMNS[i], i]
    );
  }
}

export default router;
