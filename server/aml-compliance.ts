import { Router, Request, Response } from "express";
import { requireAuth, getUserIdFromToken } from "./auth";
import { pool } from "./db";

const router = Router();

// --- AML Settings (Nominated Officer, Firm Risk Assessment, Policy) ---

router.get("/api/aml/settings", requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT * FROM aml_settings ORDER BY id LIMIT 1");
    res.json(result.rows[0] || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/aml/settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const {
      nominatedOfficerId, nominatedOfficerName, nominatedOfficerEmail,
      nominatedOfficerAppointedAt, firmRiskAssessment, firmRiskAssessmentUpdatedBy,
      amlPolicyNotes, recheckIntervalDays,
    } = req.body;

    const existing = await pool.query("SELECT id FROM aml_settings LIMIT 1");

    if (existing.rows.length > 0) {
      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;

      const addField = (col: string, val: any) => {
        if (val !== undefined) {
          sets.push(`${col} = $${idx++}`);
          vals.push(val);
        }
      };

      addField("nominated_officer_id", nominatedOfficerId);
      addField("nominated_officer_name", nominatedOfficerName);
      addField("nominated_officer_email", nominatedOfficerEmail);
      addField("nominated_officer_appointed_at", nominatedOfficerAppointedAt);
      if (firmRiskAssessment !== undefined) {
        addField("firm_risk_assessment", JSON.stringify(firmRiskAssessment));
        sets.push(`firm_risk_assessment_updated_at = NOW()`);
        addField("firm_risk_assessment_updated_by", firmRiskAssessmentUpdatedBy);
      }
      addField("aml_policy_notes", amlPolicyNotes);
      addField("recheck_interval_days", recheckIntervalDays);
      sets.push("updated_at = NOW()");

      if (sets.length > 1) {
        const result = await pool.query(
          `UPDATE aml_settings SET ${sets.join(", ")} WHERE id = ${existing.rows[0].id} RETURNING *`,
          vals
        );
        return res.json(result.rows[0]);
      }
      return res.json(existing.rows[0]);
    } else {
      const result = await pool.query(
        `INSERT INTO aml_settings (nominated_officer_id, nominated_officer_name, nominated_officer_email, nominated_officer_appointed_at, firm_risk_assessment, firm_risk_assessment_updated_at, firm_risk_assessment_updated_by, aml_policy_notes, recheck_interval_days, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, NOW()) RETURNING *`,
        [
          nominatedOfficerId || null,
          nominatedOfficerName || null,
          nominatedOfficerEmail || null,
          nominatedOfficerAppointedAt || null,
          firmRiskAssessment ? JSON.stringify(firmRiskAssessment) : null,
          firmRiskAssessmentUpdatedBy || null,
          amlPolicyNotes || null,
          recheckIntervalDays || 365,
        ]
      );
      return res.json(result.rows[0]);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Training Records ---

router.get("/api/aml/training", requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM aml_training_records ORDER BY training_date DESC"
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/aml/training", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId, userName, trainingType, trainingDate, completedAt, score, topics, notes, certifiedBy, nextDueDate } = req.body;
    if (!userId || !userName || !trainingType || !trainingDate) {
      return res.status(400).json({ error: "userId, userName, trainingType, and trainingDate are required" });
    }
    const result = await pool.query(
      `INSERT INTO aml_training_records (user_id, user_name, training_type, training_date, completed_at, score, topics, notes, certified_by, next_due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        userId, userName, trainingType, trainingDate,
        completedAt || null, score || null,
        topics ? `{${topics.map((t: string) => `"${t}"`).join(",")}}` : null,
        notes || null, certifiedBy || null, nextDueDate || null,
      ]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/aml/training/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const { completedAt, score, notes, certifiedBy, nextDueDate } = req.body;
    const sets: string[] = [];
    const vals: any[] = [req.params.id];
    let idx = 2;
    if (completedAt !== undefined) { sets.push(`completed_at = $${idx++}`); vals.push(completedAt); }
    if (score !== undefined) { sets.push(`score = $${idx++}`); vals.push(score); }
    if (notes !== undefined) { sets.push(`notes = $${idx++}`); vals.push(notes); }
    if (certifiedBy !== undefined) { sets.push(`certified_by = $${idx++}`); vals.push(certifiedBy); }
    if (nextDueDate !== undefined) { sets.push(`next_due_date = $${idx++}`); vals.push(nextDueDate); }
    if (sets.length === 0) return res.status(400).json({ error: "No fields to update" });
    const result = await pool.query(`UPDATE aml_training_records SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, vals);
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/aml/training/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query("DELETE FROM aml_training_records WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Re-check Reminders ---

router.get("/api/aml/reminders", requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM aml_recheck_reminders ORDER BY due_date ASC"
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/aml/reminders", requireAuth, async (req: Request, res: Response) => {
  try {
    const { dealId, companyId, entityName, recheckType, dueDate, notes } = req.body;
    if (!entityName || !recheckType || !dueDate) {
      return res.status(400).json({ error: "entityName, recheckType, and dueDate are required" });
    }
    const result = await pool.query(
      `INSERT INTO aml_recheck_reminders (deal_id, company_id, entity_name, recheck_type, due_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [dealId || null, companyId || null, entityName, recheckType, dueDate, notes || null]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/aml/reminders/:id/complete", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromToken(req);
    let userName = "Unknown";
    if (userId) {
      const u = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
      if (u.rows[0]) userName = u.rows[0].name;
    }
    const result = await pool.query(
      `UPDATE aml_recheck_reminders SET completed_at = NOW(), completed_by = $2 WHERE id = $1 RETURNING *`,
      [req.params.id, userName]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/aml/reminders/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query("DELETE FROM aml_recheck_reminders WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Overdue reminders count (for dashboard) ---
router.get("/api/aml/reminders/overdue-count", requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT COUNT(*) as count FROM aml_recheck_reminders WHERE due_date < NOW() AND completed_at IS NULL"
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
