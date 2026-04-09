import { Router, Request, Response } from "express";
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

async function getUserInfo(pool: any, req: Request) {
  const userId = (req.session as any)?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const result = await pool.query("SELECT id, username, is_admin FROM users WHERE id = $1", [userId]);
  return result.rows[0] || null;
}

router.get("/api/turnover", requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const { company_id, property_id, category, search } = req.query;
    let sql = `SELECT * FROM turnover_data WHERE 1=1`;
    const params: any[] = [];
    let idx = 1;

    if (company_id) { sql += ` AND company_id = $${idx}`; params.push(company_id); idx++; }
    if (property_id) { sql += ` AND property_id = $${idx}`; params.push(property_id); idx++; }
    if (category) { sql += ` AND category = $${idx}`; params.push(category); idx++; }
    if (search) {
      sql += ` AND (company_name ILIKE $${idx} OR property_name ILIKE $${idx} OR location ILIKE $${idx} OR notes ILIKE $${idx})`;
      params.push(`%${search}%`); idx++;
    }

    sql += ` ORDER BY created_at DESC`;
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/turnover/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const result = await pool.query("SELECT * FROM turnover_data WHERE id = $1", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/turnover", requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const user = await getUserInfo(pool, req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { company_id, company_name, property_id, property_name, location, period,
            turnover, sqft, source, confidence, category, notes, linked_requirement_id } = req.body;

    if (!company_name || !period) return res.status(400).json({ error: "Company name and period are required" });

    const turnoverVal = turnover ? parseFloat(turnover) : null;
    const sqftVal = sqft ? parseFloat(sqft) : null;
    const perSqft = (turnoverVal && sqftVal && sqftVal > 0) ? Math.round((turnoverVal / sqftVal) * 100) / 100 : null;

    const result = await pool.query(
      `INSERT INTO turnover_data (company_id, company_name, property_id, property_name, location, period,
        turnover, sqft, turnover_per_sqft, source, confidence, category, notes, linked_requirement_id,
        added_by, added_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [company_id || null, company_name, property_id || null, property_name || null, location || null,
       period, turnoverVal, sqftVal, perSqft, source || "Conversation", confidence || "Medium",
       category || null, notes || null, linked_requirement_id || null,
       user.username, user.id]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/turnover/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const user = await getUserInfo(pool, req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const existing = await pool.query("SELECT * FROM turnover_data WHERE id = $1", [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: "Not found" });

    const allowedFields: Record<string, string> = {
      company_id: "company_id", company_name: "company_name", property_id: "property_id",
      property_name: "property_name", location: "location", period: "period",
      turnover: "turnover", sqft: "sqft", source: "source", confidence: "confidence",
      category: "category", notes: "notes", linked_requirement_id: "linked_requirement_id"
    };

    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;

    for (const [key, col] of Object.entries(allowedFields)) {
      if (req.body[key] !== undefined) {
        sets.push(`${col} = $${idx}`);
        params.push(req.body[key] === "" ? null : req.body[key]);
        idx++;
      }
    }

    if (sets.length === 0) return res.status(400).json({ error: "No fields to update" });

    const turnoverVal = req.body.turnover !== undefined ? parseFloat(req.body.turnover) || null : existing.rows[0].turnover;
    const sqftVal = req.body.sqft !== undefined ? parseFloat(req.body.sqft) || null : existing.rows[0].sqft;
    if (turnoverVal && sqftVal && sqftVal > 0) {
      sets.push(`turnover_per_sqft = $${idx}`);
      params.push(Math.round((turnoverVal / sqftVal) * 100) / 100);
      idx++;
    }

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE turnover_data SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      params
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/turnover/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const result = await pool.query("DELETE FROM turnover_data WHERE id = $1 RETURNING id", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/turnover/stats/summary", requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_entries,
        COUNT(DISTINCT company_name) as unique_brands,
        COUNT(DISTINCT category) as categories,
        AVG(turnover) as avg_turnover,
        AVG(turnover_per_sqft) as avg_per_sqft
      FROM turnover_data
    `);
    const byCategory = await pool.query(`
      SELECT category, COUNT(*) as count, AVG(turnover) as avg_turnover
      FROM turnover_data WHERE category IS NOT NULL
      GROUP BY category ORDER BY count DESC
    `);
    const bySource = await pool.query(`
      SELECT source, COUNT(*) as count
      FROM turnover_data GROUP BY source ORDER BY count DESC
    `);
    res.json({ summary: result.rows[0], byCategory: byCategory.rows, bySource: bySource.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
