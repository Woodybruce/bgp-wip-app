import type { Express } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { xeroApi } from "./xero";

export function setupHrRoutes(app: Express) {

  // ── Staff profiles ────────────────────────────────────────────────────────

  app.get("/api/hr/staff", requireAuth, async (req: any, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          u.id, u.name, u.email, u.phone, u.role, u.department, u.team,
          u.is_admin, u.is_active, u.profile_pic_url,
          sp.id AS profile_id,
          sp.title, sp.start_date, sp.end_date, sp.status AS hr_status,
          sp.salary_current, sp.manager_id, sp.department AS hr_department,
          sp.rics_pathway, sp.apc_status, sp.apc_assessment_date,
          sp.education, sp.bio,
          sp.emergency_contact_name, sp.emergency_contact_phone, sp.emergency_contact_relation,
          sp.holiday_entitlement, sp.pension_opt_in, sp.pension_rate,
          sp.contract_sharepoint_url, sp.passport_sharepoint_url,
          sp.linkedin_url, sp.xero_tracking_name,
          m.name AS manager_name,
          (SELECT COALESCE(SUM(days_count), 0) FROM holiday_requests
           WHERE user_id = u.id AND status = 'approved'
           AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now())) AS holiday_used
        FROM users u
        LEFT JOIN staff_profiles sp ON sp.user_id = u.id
        LEFT JOIN users m ON m.id = sp.manager_id
        WHERE u.is_active = true
        ORDER BY u.name ASC
      `);
      res.json(rows);
    } catch (e: any) {
      console.error("[hr] GET /staff error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/hr/staff/:userId", requireAuth, async (req: any, res) => {
    const { userId } = req.params;
    // Non-admins can only view their own profile
    if (!req.user?.isAdmin && req.user?.id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const { rows } = await pool.query(`
        SELECT
          u.id, u.name, u.email, u.phone, u.role, u.department, u.team,
          u.is_admin, u.is_active, u.profile_pic_url,
          sp.id AS profile_id,
          sp.title, sp.start_date, sp.end_date, sp.status AS hr_status,
          sp.salary_current, sp.manager_id, sp.department AS hr_department,
          sp.rics_pathway, sp.apc_status, sp.apc_assessment_date,
          sp.education, sp.bio,
          sp.emergency_contact_name, sp.emergency_contact_phone, sp.emergency_contact_relation,
          sp.holiday_entitlement, sp.pension_opt_in, sp.pension_rate,
          sp.contract_sharepoint_url, sp.passport_sharepoint_url,
          sp.linkedin_url, sp.xero_tracking_name,
          m.name AS manager_name
        FROM users u
        LEFT JOIN staff_profiles sp ON sp.user_id = u.id
        LEFT JOIN users m ON m.id = sp.manager_id
        WHERE u.id = $1
      `, [userId]);
      if (!rows[0]) return res.status(404).json({ error: "User not found" });
      res.json(rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/staff/:userId/profile", requireAuth, async (req: any, res) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: "Admin only" });
    const { userId } = req.params;
    const {
      title, startDate, endDate, status, salaryCurrent, managerId,
      department, ricsPathway, apcStatus, apcAssessmentDate,
      education, bio, emergencyContactName, emergencyContactPhone,
      emergencyContactRelation, holidayEntitlement, pensionOptIn, pensionRate,
      contractSharepointUrl, passportSharepointUrl, linkedinUrl, xeroTrackingName,
    } = req.body;
    try {
      await pool.query(`
        INSERT INTO staff_profiles (
          user_id, title, start_date, end_date, status, salary_current, manager_id,
          department, rics_pathway, apc_status, apc_assessment_date, education, bio,
          emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
          holiday_entitlement, pension_opt_in, pension_rate,
          contract_sharepoint_url, passport_sharepoint_url, linkedin_url, xero_tracking_name
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        ON CONFLICT (user_id) DO UPDATE SET
          title = EXCLUDED.title,
          start_date = EXCLUDED.start_date,
          end_date = EXCLUDED.end_date,
          status = EXCLUDED.status,
          salary_current = EXCLUDED.salary_current,
          manager_id = EXCLUDED.manager_id,
          department = EXCLUDED.department,
          rics_pathway = EXCLUDED.rics_pathway,
          apc_status = EXCLUDED.apc_status,
          apc_assessment_date = EXCLUDED.apc_assessment_date,
          education = EXCLUDED.education,
          bio = EXCLUDED.bio,
          emergency_contact_name = EXCLUDED.emergency_contact_name,
          emergency_contact_phone = EXCLUDED.emergency_contact_phone,
          emergency_contact_relation = EXCLUDED.emergency_contact_relation,
          holiday_entitlement = EXCLUDED.holiday_entitlement,
          pension_opt_in = EXCLUDED.pension_opt_in,
          pension_rate = EXCLUDED.pension_rate,
          contract_sharepoint_url = EXCLUDED.contract_sharepoint_url,
          passport_sharepoint_url = EXCLUDED.passport_sharepoint_url,
          linkedin_url = EXCLUDED.linkedin_url,
          xero_tracking_name = EXCLUDED.xero_tracking_name,
          updated_at = now()
      `, [
        userId, title, startDate, endDate, status || "active", salaryCurrent, managerId,
        department, ricsPathway, apcStatus, apcAssessmentDate, education, bio,
        emergencyContactName, emergencyContactPhone, emergencyContactRelation,
        holidayEntitlement ?? 25, pensionOptIn ?? true, pensionRate ?? 5.0,
        contractSharepointUrl, passportSharepointUrl, linkedinUrl, xeroTrackingName,
      ]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Salary history ────────────────────────────────────────────────────────

  app.get("/api/hr/staff/:userId/salary", requireAuth, async (req: any, res) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: "Admin only" });
    const { userId } = req.params;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM salary_history WHERE user_id = $1 ORDER BY effective_date DESC`,
        [userId]
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/staff/:userId/salary", requireAuth, async (req: any, res) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: "Admin only" });
    const { userId } = req.params;
    const { salaryPence, effectiveDate, reason, notes } = req.body;
    if (!salaryPence || !effectiveDate) {
      return res.status(400).json({ error: "salaryPence and effectiveDate required" });
    }
    try {
      await pool.query(
        `INSERT INTO salary_history (user_id, salary_pence, effective_date, reason, notes, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, salaryPence, effectiveDate, reason, notes, req.user.id]
      );
      // Also update current salary on profile
      await pool.query(
        `INSERT INTO staff_profiles (user_id, salary_current, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET salary_current = $2, updated_at = now()`,
        [userId, salaryPence]
      );
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Commission tracker ────────────────────────────────────────────────────
  // Commission scheme year: 1 May → 30 April
  // Tiers: 2x salary → 30%, 3x → 40%, 4x → 50% (of fees above each threshold)

  app.get("/api/hr/staff/:userId/commission", requireAuth, async (req: any, res) => {
    if (!req.user?.isAdmin && req.user?.id !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { userId } = req.params;

    try {
      // Get salary and xero_tracking_name
      const profileRes = await pool.query(
        `SELECT sp.salary_current, sp.xero_tracking_name, sp.start_date, u.name
         FROM users u
         LEFT JOIN staff_profiles sp ON sp.user_id = u.id
         WHERE u.id = $1`,
        [userId]
      );
      const profile = profileRes.rows[0];
      if (!profile) return res.status(404).json({ error: "User not found" });

      const salary = profile.salary_current || 0;
      const trackingName = profile.xero_tracking_name || profile.name;

      // Scheme year: 1 May to 30 April
      const now = new Date();
      const schemeYearStart = now.getMonth() >= 4
        ? new Date(now.getFullYear(), 4, 1)
        : new Date(now.getFullYear() - 1, 4, 1);
      const schemeYearEnd = new Date(schemeYearStart.getFullYear() + 1, 3, 30);

      // Try to get billings from Xero using system session
      let billedPence = 0;
      let billingsByYear: Array<{ year: string; pence: number }> = [];
      let xeroError: string | null = null;

      try {
        const { getXeroSystemSession } = await import("./xero-system-session");
        const session = await getXeroSystemSession();
        if (session) {
          // Query paid invoices for this scheme year where tracking matches the agent
          const fromDate = schemeYearStart.toISOString().split("T")[0];
          const toDate = schemeYearEnd.toISOString().split("T")[0];
          const invoiceData = await xeroApi(session,
            `/Invoices?Status=PAID&DateFrom=${fromDate}&DateTo=${toDate}&summaryOnly=false`,
          );

          if (invoiceData?.Invoices) {
            for (const inv of invoiceData.Invoices) {
              // Check tracking category contains this agent's name
              const trackingMatch = inv.LineItems?.some((li: any) =>
                li.Tracking?.some((t: any) =>
                  t.Name?.toLowerCase().includes("person") &&
                  t.Option?.toLowerCase().includes(trackingName.split(" ")[0].toLowerCase())
                )
              );
              if (trackingMatch) {
                billedPence += Math.round((inv.SubTotal || 0) * 100);
              }
            }

            // Multi-year billings (last 4 scheme years)
            for (let i = 0; i < 4; i++) {
              const yStart = new Date(schemeYearStart.getFullYear() - i, 4, 1);
              const yEnd = new Date(yStart.getFullYear() + 1, 3, 30);
              let yPence = 0;
              if (i > 0) {
                const yData = await xeroApi(session,
                  `/Invoices?Status=PAID&DateFrom=${yStart.toISOString().split("T")[0]}&DateTo=${yEnd.toISOString().split("T")[0]}&summaryOnly=false`
                );
                for (const inv of (yData?.Invoices || [])) {
                  const match = inv.LineItems?.some((li: any) =>
                    li.Tracking?.some((t: any) =>
                      t.Name?.toLowerCase().includes("person") &&
                      t.Option?.toLowerCase().includes(trackingName.split(" ")[0].toLowerCase())
                    )
                  );
                  if (match) yPence += Math.round((inv.SubTotal || 0) * 100);
                }
              } else {
                yPence = billedPence;
              }
              billingsByYear.push({
                year: `${yStart.getFullYear()}/${String(yEnd.getFullYear()).slice(-2)}`,
                pence: yPence,
              });
            }
          }
        }
      } catch (xErr: any) {
        xeroError = xErr.message;
      }

      // Calculate commission tiers (pro-rate if mid-year starter)
      const startDate = profile.start_date ? new Date(profile.start_date) : null;
      let effectiveSalary = salary;
      if (startDate && startDate > schemeYearStart) {
        const daysInYear = 365;
        const daysWorked = Math.floor((schemeYearEnd.getTime() - startDate.getTime()) / 86400000);
        const fraction = Math.min(daysWorked / daysInYear, 1);
        effectiveSalary = Math.round(salary * fraction);
      }

      const t1 = effectiveSalary * 2;  // 30% above this
      const t2 = effectiveSalary * 3;  // 40% above this
      const t3 = effectiveSalary * 4;  // 50% above this

      let commissionEarned = 0;
      if (billedPence > t1) {
        const above1 = Math.min(billedPence, t2) - t1;
        commissionEarned += above1 * 0.30;
      }
      if (billedPence > t2) {
        const above2 = Math.min(billedPence, t3) - t2;
        commissionEarned += above2 * 0.40;
      }
      if (billedPence > t3) {
        commissionEarned += (billedPence - t3) * 0.50;
      }

      res.json({
        salary,
        effectiveSalary,
        schemeYear: `${schemeYearStart.getFullYear()}/${String(schemeYearEnd.getFullYear()).slice(-2)}`,
        schemeYearStart: schemeYearStart.toISOString().split("T")[0],
        schemeYearEnd: schemeYearEnd.toISOString().split("T")[0],
        billedPence,
        t1, t2, t3,
        commissionEarned: Math.round(commissionEarned),
        billingsByYear: billingsByYear.reverse(),
        xeroError,
        trackingName,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Holiday requests ──────────────────────────────────────────────────────

  app.get("/api/hr/holidays", requireAuth, async (req: any, res) => {
    const { userId } = req.query;
    try {
      let query: string;
      let params: any[];
      if (req.user?.isAdmin && !userId) {
        query = `
          SELECT hr.*, u.name AS user_name, u.profile_pic_url,
                 approver.name AS approver_name
          FROM holiday_requests hr
          JOIN users u ON u.id = hr.user_id
          LEFT JOIN users approver ON approver.id = hr.approved_by
          ORDER BY hr.created_at DESC
        `;
        params = [];
      } else {
        const targetId = (userId as string) || req.user.id;
        if (!req.user?.isAdmin && targetId !== req.user.id) {
          return res.status(403).json({ error: "Forbidden" });
        }
        query = `
          SELECT hr.*, u.name AS user_name, u.profile_pic_url,
                 approver.name AS approver_name
          FROM holiday_requests hr
          JOIN users u ON u.id = hr.user_id
          LEFT JOIN users approver ON approver.id = hr.approved_by
          WHERE hr.user_id = $1
          ORDER BY hr.created_at DESC
        `;
        params = [targetId];
      }
      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/holidays", requireAuth, async (req: any, res) => {
    const { startDate, endDate, daysCount, notes } = req.body;
    if (!startDate || !endDate || !daysCount) {
      return res.status(400).json({ error: "startDate, endDate, daysCount required" });
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO holiday_requests (user_id, start_date, end_date, days_count, notes)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.user.id, startDate, endDate, daysCount, notes]
      );
      res.json(rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/hr/holidays/:id", requireAuth, async (req: any, res) => {
    const { id } = req.params;
    const { status, notes } = req.body;
    // Admins approve/reject; users can cancel their own
    try {
      const existing = await pool.query(`SELECT * FROM holiday_requests WHERE id = $1`, [id]);
      if (!existing.rows[0]) return res.status(404).json({ error: "Not found" });
      const req_ = existing.rows[0];

      if (status === "cancelled" && req_.user_id !== req.user?.id && !req.user?.isAdmin) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if ((status === "approved" || status === "rejected") && !req.user?.isAdmin) {
        return res.status(403).json({ error: "Admin only" });
      }

      const { rows } = await pool.query(
        `UPDATE holiday_requests
         SET status = $1, notes = COALESCE($2, notes),
             approved_by = CASE WHEN $1 IN ('approved','rejected') THEN $3 ELSE approved_by END,
             approved_at = CASE WHEN $1 IN ('approved','rejected') THEN now() ELSE approved_at END
         WHERE id = $4 RETURNING *`,
        [status, notes, req.user?.id, id]
      );
      res.json(rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── HR documents ──────────────────────────────────────────────────────────

  app.get("/api/hr/documents", requireAuth, async (req: any, res) => {
    const { userId, docType } = req.query;
    try {
      let where = "WHERE 1=1";
      const params: any[] = [];
      if (userId) {
        params.push(userId);
        where += ` AND (hd.user_id = $${params.length} OR hd.user_id IS NULL)`;
      }
      if (docType) {
        params.push(docType);
        where += ` AND hd.doc_type = $${params.length}`;
      }
      const { rows } = await pool.query(
        `SELECT hd.*, u.name AS user_name FROM hr_documents hd
         LEFT JOIN users u ON u.id = hd.user_id
         ${where} ORDER BY hd.created_at DESC`,
        params
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/documents", requireAuth, async (req: any, res) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: "Admin only" });
    const { userId, docType, name, sharepointUrl, sharepointDriveId, sharepointItemId, reviewYear } = req.body;
    if (!docType || !name) return res.status(400).json({ error: "docType and name required" });
    try {
      const { rows } = await pool.query(
        `INSERT INTO hr_documents (user_id, doc_type, name, sharepoint_url, sharepoint_drive_id, sharepoint_item_id, review_year)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [userId || null, docType, name, sharepointUrl, sharepointDriveId, sharepointItemId, reviewYear]
      );
      res.json(rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/hr/documents/:id", requireAuth, async (req: any, res) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: "Admin only" });
    try {
      await pool.query(`DELETE FROM hr_documents WHERE id = $1`, [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Policy documents (SharePoint-backed) ─────────────────────────────────

  app.get("/api/hr/policies", requireAuth, async (_req, res) => {
    // Return static list of known policy docs from SharePoint HR/Policies & Procedures
    const policies = [
      { name: "AML Policy", category: "Compliance", sharepointFolder: "AML" },
      { name: "Anti-Bribery Policy", category: "Compliance", sharepointFolder: "Anti bribery" },
      { name: "Commission Scheme", category: "Compensation", sharepointFolder: "Commission scheme" },
      { name: "Complaints Handling Procedure", category: "Operations", sharepointFolder: "Complaints handling procedure" },
      { name: "Equality Policy", category: "HR", sharepointFolder: "Equality" },
      { name: "Expenses Policy", category: "Finance", sharepointFolder: "Expenses" },
      { name: "Fire Safety Policy", category: "Health & Safety", sharepointFolder: "Fire safety" },
      { name: "Living Wage Policy", category: "HR", sharepointFolder: "Living Wage" },
      { name: "Maternity Policy", category: "HR", sharepointFolder: "Maternity Policy" },
      { name: "Safety at Work", category: "Health & Safety", sharepointFolder: "Safety at work" },
    ];
    res.json(policies);
  });

  // ── Org chart data ────────────────────────────────────────────────────────

  app.get("/api/hr/org-chart", requireAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          u.id, u.name, u.profile_pic_url,
          sp.title, sp.manager_id, sp.department, sp.status AS hr_status
        FROM users u
        LEFT JOIN staff_profiles sp ON sp.user_id = u.id
        WHERE u.is_active = true
        ORDER BY u.name ASC
      `);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
