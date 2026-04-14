import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { requireAuth, getUserIdFromToken } from "./auth";
import { pool } from "./db";
import { saveFile } from "./file-storage";

const router = Router();

const KYC_UPLOAD_DIR = path.join(process.cwd(), "ChatBGP", "kyc-uploads");
if (!fs.existsSync(KYC_UPLOAD_DIR)) fs.mkdirSync(KYC_UPLOAD_DIR, { recursive: true });
const kycUpload = multer({ dest: KYC_UPLOAD_DIR, limits: { fileSize: 25 * 1024 * 1024 } });

const ALLOWED_DOC_TYPES = new Set([
  "passport", "certified_passport", "drivers_licence", "proof_of_address",
  "source_of_funds", "source_of_wealth", "ubo_declaration", "company_cert",
  "bank_statement", "onfido_report", "other",
]);

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
    const token = (req.headers.authorization?.replace("Bearer ", "") || req.query.token || "") as string;
    const userId = await getUserIdFromToken(token);
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

// ─── KYC documents (proof of funds, certified passport, etc.) ─────────────

router.get("/api/kyc/documents", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyId, contactId, dealId } = req.query;
    if (!companyId && !contactId && !dealId) {
      return res.status(400).json({ error: "Provide companyId, contactId, or dealId" });
    }
    const conditions: string[] = ["deleted_at IS NULL"];
    const params: any[] = [];
    if (companyId) { params.push(companyId); conditions.push(`company_id = $${params.length}`); }
    if (contactId) { params.push(contactId); conditions.push(`contact_id = $${params.length}`); }
    if (dealId) { params.push(dealId); conditions.push(`deal_id = $${params.length}`); }
    const result = await pool.query(
      `SELECT * FROM kyc_documents WHERE ${conditions.join(" AND ")} ORDER BY uploaded_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/kyc/documents/upload", requireAuth, kycUpload.single("file"), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });
    const { companyId, contactId, dealId, docType, certifiedBy, certifiedAt, expiresAt, notes } = req.body;
    if (!docType || !ALLOWED_DOC_TYPES.has(docType)) {
      return res.status(400).json({ error: "docType required, one of: " + Array.from(ALLOWED_DOC_TYPES).join(", ") });
    }
    if (!companyId && !contactId) {
      return res.status(400).json({ error: "Provide companyId or contactId" });
    }
    const ext = path.extname(file.originalname).toLowerCase() || "";
    const safeName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${file.originalname.replace(/[^a-zA-Z0-9_.\-]/g, "_")}`;
    const storageKey = `chat-media/${safeName}`;
    const buffer = fs.readFileSync(file.path);
    await saveFile(storageKey, buffer, file.mimetype || "application/octet-stream", file.originalname);
    try { fs.unlinkSync(file.path); } catch {}
    const fileUrl = `/api/chat-media/${safeName}`;
    const userId = (req as any).user?.id || (req.session as any)?.userId || null;
    const inserted = await pool.query(
      `INSERT INTO kyc_documents
       (company_id, contact_id, deal_id, doc_type, file_url, file_name, file_size, mime_type,
        certified_by, certified_at, expires_at, notes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        companyId || null, contactId || null, dealId || null, docType,
        fileUrl, file.originalname, buffer.length, file.mimetype || null,
        certifiedBy || null, certifiedAt || null, expiresAt || null, notes || null,
        userId,
      ]
    );
    res.json(inserted.rows[0]);
  } catch (err: any) {
    console.error("[kyc-docs] upload error:", err?.message);
    res.status(500).json({ error: err?.message || "Upload failed" });
  }
});

router.patch("/api/kyc/documents/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const { certifiedBy, certifiedAt, expiresAt, notes, docType } = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    if (certifiedBy !== undefined) { params.push(certifiedBy); updates.push(`certified_by = $${params.length}`); }
    if (certifiedAt !== undefined) { params.push(certifiedAt); updates.push(`certified_at = $${params.length}`); }
    if (expiresAt !== undefined) { params.push(expiresAt); updates.push(`expires_at = $${params.length}`); }
    if (notes !== undefined) { params.push(notes); updates.push(`notes = $${params.length}`); }
    if (docType !== undefined && ALLOWED_DOC_TYPES.has(docType)) { params.push(docType); updates.push(`doc_type = $${params.length}`); }
    if (updates.length === 0) return res.status(400).json({ error: "No fields to update" });
    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE kyc_documents SET ${updates.join(", ")} WHERE id = $${params.length} AND deleted_at IS NULL RETURNING *`,
      params
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/kyc/documents/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `UPDATE kyc_documents SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Per-company AML state (checklist + approval) ─────────────────────────

router.get("/api/kyc/company/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const company = await pool.query(
      `SELECT id, name, kyc_status, kyc_checked_at, kyc_approved_by, kyc_expires_at,
              aml_checklist, aml_risk_level, aml_pep_status, aml_source_of_wealth,
              aml_source_of_wealth_notes, aml_edd_required, aml_edd_reason, aml_notes,
              companies_house_number
       FROM crm_companies WHERE id = $1`,
      [req.params.id]
    );
    if (!company.rows[0]) return res.status(404).json({ error: "Company not found" });
    const docs = await pool.query(
      `SELECT * FROM kyc_documents WHERE company_id = $1 AND deleted_at IS NULL ORDER BY uploaded_at DESC`,
      [req.params.id]
    );
    res.json({ company: company.rows[0], documents: docs.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/kyc/company/:id/checklist", requireAuth, async (req: Request, res: Response) => {
  try {
    const { checklist, riskLevel, pepStatus, sourceOfWealth, sourceOfWealthNotes, eddRequired, eddReason, notes } = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    if (checklist !== undefined) { params.push(JSON.stringify(checklist)); updates.push(`aml_checklist = $${params.length}::jsonb`); }
    if (riskLevel !== undefined) { params.push(riskLevel); updates.push(`aml_risk_level = $${params.length}`); }
    if (pepStatus !== undefined) { params.push(pepStatus); updates.push(`aml_pep_status = $${params.length}`); }
    if (sourceOfWealth !== undefined) { params.push(sourceOfWealth); updates.push(`aml_source_of_wealth = $${params.length}`); }
    if (sourceOfWealthNotes !== undefined) { params.push(sourceOfWealthNotes); updates.push(`aml_source_of_wealth_notes = $${params.length}`); }
    if (eddRequired !== undefined) { params.push(!!eddRequired); updates.push(`aml_edd_required = $${params.length}`); }
    if (eddReason !== undefined) { params.push(eddReason); updates.push(`aml_edd_reason = $${params.length}`); }
    if (notes !== undefined) { params.push(notes); updates.push(`aml_notes = $${params.length}`); }
    // Bump kyc_status to in_review on first checklist edit if currently null/pending
    updates.push(`kyc_status = COALESCE(NULLIF(kyc_status, 'approved'), 'in_review')`);
    if (updates.length === 1) return res.status(400).json({ error: "No fields to update" });
    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE crm_companies SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${params.length} RETURNING id, kyc_status, aml_checklist`,
      params
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Company not found" });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/kyc/company/:id/approve", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req.session as any)?.userId || null;
    let approverName: string | null = req.body?.approverName || null;
    if (!approverName && userId) {
      const u = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
      approverName = u.rows[0]?.name || null;
    }
    // MLR 2017 Reg 28: ongoing monitoring must be "proportionate" — for a
    // commercial property agency with recurring counterparties, BGP policy
    // is a 6-month re-check cadence on every approved counterparty.
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 6);
    const result = await pool.query(
      `UPDATE crm_companies
       SET kyc_status = 'approved', kyc_checked_at = NOW(), kyc_approved_by = $1, kyc_expires_at = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, name, kyc_status, kyc_checked_at, kyc_approved_by, kyc_expires_at`,
      [approverName, expiresAt, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Company not found" });
    // Auto-schedule the 12-month re-check reminder
    try {
      await pool.query(
        `INSERT INTO aml_recheck_reminders (company_id, entity_name, recheck_type, due_date, notes)
         VALUES ($1, $2, 'periodic_cdd', $3, 'Auto-generated on KYC approval — 6-month re-check')`,
        [req.params.id, result.rows[0].name, expiresAt]
      );
    } catch (rmErr: any) {
      console.warn("[kyc-approve] reminder insert failed:", rmErr?.message);
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/kyc/company/:id/reject", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req.session as any)?.userId || null;
    const reason = req.body?.reason || null;
    const result = await pool.query(
      `UPDATE crm_companies
       SET kyc_status = 'rejected', kyc_checked_at = NOW(), kyc_approved_by = $1,
           aml_notes = COALESCE(aml_notes || E'\\n', '') || ('Rejected: ' || COALESCE($2, 'no reason given')),
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, kyc_status`,
      [userId, reason, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Company not found" });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Compliance board — all counterparties grouped by KYC status ──────────

router.get("/api/kyc/board", requireAuth, async (_req: Request, res: Response) => {
  try {
    // Pull every company that's referenced by at least one live deal
    // (landlord/tenant/vendor/purchaser) so the board shows the people
    // we actually need to AML, not the entire CRM.
    const result = await pool.query(
      `WITH live_counterparties AS (
        SELECT DISTINCT id, role FROM (
          SELECT landlord_id AS id, 'landlord' AS role FROM crm_deals WHERE landlord_id IS NOT NULL AND status NOT IN ('Dead','Withdrawn','Lost')
          UNION ALL
          SELECT tenant_id, 'tenant' FROM crm_deals WHERE tenant_id IS NOT NULL AND status NOT IN ('Dead','Withdrawn','Lost')
          UNION ALL
          SELECT vendor_id, 'vendor' FROM crm_deals WHERE vendor_id IS NOT NULL AND status NOT IN ('Dead','Withdrawn','Lost')
          UNION ALL
          SELECT purchaser_id, 'purchaser' FROM crm_deals WHERE purchaser_id IS NOT NULL AND status NOT IN ('Dead','Withdrawn','Lost')
        ) AS r WHERE id != ''
      )
      SELECT
        c.id, c.name, c.kyc_status, c.kyc_checked_at, c.kyc_approved_by,
        c.kyc_expires_at, c.aml_risk_level, c.aml_pep_status,
        c.aml_checklist, c.companies_house_number,
        (
          SELECT COUNT(*) FROM kyc_documents kd WHERE kd.company_id = c.id AND kd.deleted_at IS NULL
        )::int AS doc_count,
        (
          SELECT json_agg(json_build_object('id', d.id, 'name', d.name, 'role', lc.role))
          FROM crm_deals d
          JOIN live_counterparties lc ON (
            (lc.role = 'landlord' AND d.landlord_id = c.id) OR
            (lc.role = 'tenant' AND d.tenant_id = c.id) OR
            (lc.role = 'vendor' AND d.vendor_id = c.id) OR
            (lc.role = 'purchaser' AND d.purchaser_id = c.id)
          )
          WHERE d.status NOT IN ('Dead','Withdrawn','Lost')
        ) AS deals
      FROM crm_companies c
      WHERE c.id IN (SELECT id FROM live_counterparties)
      ORDER BY c.name ASC`
    );

    const now = new Date();
    const rows = result.rows.map((r: any) => {
      const isExpired = r.kyc_expires_at ? new Date(r.kyc_expires_at) < now : false;
      let column: "missing" | "in_review" | "approved" | "rejected" | "expired";
      if (r.kyc_status === "approved" && isExpired) column = "expired";
      else if (r.kyc_status === "approved") column = "approved";
      else if (r.kyc_status === "rejected") column = "rejected";
      else if (r.kyc_status === "in_review" || r.doc_count > 0) column = "in_review";
      else column = "missing";
      return { ...r, column, isExpired };
    });

    res.json({
      counts: {
        missing: rows.filter((r: any) => r.column === "missing").length,
        in_review: rows.filter((r: any) => r.column === "in_review").length,
        approved: rows.filter((r: any) => r.column === "approved").length,
        expired: rows.filter((r: any) => r.column === "expired").length,
        rejected: rows.filter((r: any) => r.column === "rejected").length,
        total: rows.length,
      },
      rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Deals-needing-KYC board: every live un-invoiced deal ─────────────────

router.get("/api/kyc/board/deals", requireAuth, async (_req: Request, res: Response) => {
  try {
    // Every live deal that hasn't been invoiced yet — these are the deals
    // that MUST have AML cleared on both sides before they can be invoiced.
    const result = await pool.query(
      `SELECT
         d.id, d.name, d.status, d.deal_type, d.fee, d.updated_at, d.property_id,
         d.landlord_id, d.tenant_id, d.vendor_id, d.purchaser_id,
         d.kyc_approved, d.hots_completed_at,
         p.name AS property_name,
         (SELECT c.name FROM crm_companies c WHERE c.id = d.landlord_id) AS landlord_name,
         (SELECT c.kyc_status FROM crm_companies c WHERE c.id = d.landlord_id) AS landlord_kyc,
         (SELECT c.kyc_expires_at FROM crm_companies c WHERE c.id = d.landlord_id) AS landlord_kyc_expires,
         (SELECT c.name FROM crm_companies c WHERE c.id = d.tenant_id) AS tenant_name,
         (SELECT c.kyc_status FROM crm_companies c WHERE c.id = d.tenant_id) AS tenant_kyc,
         (SELECT c.kyc_expires_at FROM crm_companies c WHERE c.id = d.tenant_id) AS tenant_kyc_expires,
         (SELECT c.name FROM crm_companies c WHERE c.id = d.vendor_id) AS vendor_name,
         (SELECT c.kyc_status FROM crm_companies c WHERE c.id = d.vendor_id) AS vendor_kyc,
         (SELECT c.kyc_expires_at FROM crm_companies c WHERE c.id = d.vendor_id) AS vendor_kyc_expires,
         (SELECT c.name FROM crm_companies c WHERE c.id = d.purchaser_id) AS purchaser_name,
         (SELECT c.kyc_status FROM crm_companies c WHERE c.id = d.purchaser_id) AS purchaser_kyc,
         (SELECT c.kyc_expires_at FROM crm_companies c WHERE c.id = d.purchaser_id) AS purchaser_kyc_expires
       FROM crm_deals d
       LEFT JOIN crm_properties p ON d.property_id = p.id
       WHERE d.status NOT IN ('Invoiced', 'Completed', 'Dead', 'Withdrawn', 'Lost')
       ORDER BY d.updated_at DESC NULLS LAST`
    );

    const now = new Date();
    const rows = result.rows.map((d: any) => {
      const cps: Array<{ id: string; name: string; role: string; status: string | null; expiresAt: string | null; isApproved: boolean; isExpired: boolean }> = [];
      const push = (id: string | null, name: string | null, role: string, status: string | null, expiresAt: string | null) => {
        if (!id || !name) return;
        const isExpired = expiresAt ? new Date(expiresAt) < now : false;
        cps.push({ id, name, role, status, expiresAt, isApproved: status === "approved" && !isExpired, isExpired });
      };
      push(d.landlord_id, d.landlord_name, "landlord", d.landlord_kyc, d.landlord_kyc_expires);
      push(d.tenant_id, d.tenant_name, "tenant", d.tenant_kyc, d.tenant_kyc_expires);
      push(d.vendor_id, d.vendor_name, "vendor", d.vendor_kyc, d.vendor_kyc_expires);
      push(d.purchaser_id, d.purchaser_name, "purchaser", d.purchaser_kyc, d.purchaser_kyc_expires);

      const anyStarted = cps.some(c => c.status && c.status !== "pending");
      const allApproved = cps.length >= 2 && cps.every(c => c.isApproved);
      let column: "not_started" | "in_progress" | "ready_to_invoice";
      if (allApproved) column = "ready_to_invoice";
      else if (anyStarted) column = "in_progress";
      else column = "not_started";

      return {
        id: d.id,
        name: d.name,
        status: d.status,
        dealType: d.deal_type,
        fee: d.fee,
        updatedAt: d.updated_at,
        propertyName: d.property_name,
        counterparties: cps,
        column,
        canInvoice: allApproved,
      };
    });

    res.json({
      counts: {
        not_started: rows.filter((r: any) => r.column === "not_started").length,
        in_progress: rows.filter((r: any) => r.column === "in_progress").length,
        ready_to_invoice: rows.filter((r: any) => r.column === "ready_to_invoice").length,
        total: rows.length,
      },
      rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Deal-level rollup: AML status of both counterparties ─────────────────

router.get("/api/kyc/deal/:id/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const dealRow = await pool.query(
      `SELECT id, name, deal_type, landlord_id, tenant_id, vendor_id, purchaser_id,
              client_contact_id, kyc_approved
       FROM crm_deals WHERE id = $1`,
      [req.params.id]
    );
    if (!dealRow.rows[0]) return res.status(404).json({ error: "Deal not found" });
    const d = dealRow.rows[0];

    // Pick the counterparties relevant to this deal type
    const counterpartyIds: Array<{ id: string; role: string }> = [];
    if (d.landlord_id) counterpartyIds.push({ id: d.landlord_id, role: "landlord" });
    if (d.tenant_id) counterpartyIds.push({ id: d.tenant_id, role: "tenant" });
    if (d.vendor_id) counterpartyIds.push({ id: d.vendor_id, role: "vendor" });
    if (d.purchaser_id) counterpartyIds.push({ id: d.purchaser_id, role: "purchaser" });

    const counterparties: any[] = [];
    for (const cp of counterpartyIds) {
      const r = await pool.query(
        "SELECT id, name, kyc_status, kyc_expires_at, kyc_approved_by FROM crm_companies WHERE id = $1",
        [cp.id]
      );
      if (r.rows[0]) {
        counterparties.push({
          ...r.rows[0],
          role: cp.role,
          isApproved: r.rows[0].kyc_status === "approved",
          isExpired: r.rows[0].kyc_expires_at ? new Date(r.rows[0].kyc_expires_at) < new Date() : false,
        });
      }
    }

    const allApproved = counterparties.length >= 2 && counterparties.every(c => c.isApproved && !c.isExpired);
    const missing = counterparties.filter(c => !c.isApproved || c.isExpired).map(c => c.name);

    res.json({
      dealId: d.id,
      dealName: d.name,
      counterparties,
      allApproved,
      canInvoice: allApproved,
      missing,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
