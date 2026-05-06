import type { Express } from "express";
import { pool } from "./db";
import { requireAuth, requireAdmin } from "./auth";
import { xeroApi } from "./xero";

// requireAuth doesn't populate req.user, so look up admin status from the DB
// using the session/token user id. Used by hybrid (admin-or-self) endpoints
// where the simple `requireAdmin` middleware isn't enough.
async function getActor(req: any): Promise<{ userId: string | null; isAdmin: boolean }> {
  const userId = req.session?.userId || req.tokenUserId || null;
  if (!userId) return { userId: null, isAdmin: false };
  const r = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
  return { userId, isAdmin: r.rows[0]?.is_admin === true };
}

export function setupHrRoutes(app: Express) {

  // ── Staff profiles ────────────────────────────────────────────────────────

  app.get("/api/hr/staff", requireAuth, async (req: any, res) => {
    try {
      const { userId: myId, isAdmin } = await getActor(req);
      // Personal-tier fields (DOB, address) are masked for everyone except
      // the user themselves and admins. Layla's HR brief specifies these as
      // "Visible to individual & Equity / HR".
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
          sp.wfh_days, sp.employment_type, sp.cv_sharepoint_url,
          sp.board_member, sp.management_team,
          CASE WHEN $2::boolean OR u.id = $1 THEN sp.dob ELSE NULL END AS dob,
          CASE WHEN $2::boolean OR u.id = $1 THEN sp.address ELSE NULL END AS address,
          m.name AS manager_name,
          (SELECT COALESCE(SUM(days_count), 0) FROM holiday_requests
           WHERE user_id = u.id AND status = 'approved'
           AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now())) AS holiday_used
        FROM users u
        LEFT JOIN staff_profiles sp ON sp.user_id = u.id
        LEFT JOIN users m ON m.id = sp.manager_id
        WHERE u.is_active = true
        ORDER BY u.name ASC
      `, [myId, isAdmin]);
      res.json(rows);
    } catch (e: any) {
      console.error("[hr] GET /staff error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/hr/staff/:userId", requireAuth, async (req: any, res) => {
    const { userId } = req.params;
    const actor = await getActor(req);
    // Non-admins can only view their own profile
    if (!actor.isAdmin && actor.userId !== userId) {
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
          sp.dob, sp.address, sp.wfh_days, sp.employment_type, sp.cv_sharepoint_url,
          sp.board_member, sp.management_team,
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
    const { userId } = req.params;
    const actor = await getActor(req);
    const isAdmin = actor.isAdmin;
    const isSelf = actor.userId === userId;
    if (!isAdmin && !isSelf) return res.status(403).json({ error: "Admin or self only" });

    const {
      title, startDate, endDate, status, salaryCurrent, managerId,
      department, ricsPathway, apcStatus, apcAssessmentDate,
      education, bio, emergencyContactName, emergencyContactPhone,
      emergencyContactRelation, holidayEntitlement, pensionOptIn, pensionRate,
      contractSharepointUrl, passportSharepointUrl, linkedinUrl, xeroTrackingName,
      dob, address, wfhDays, employmentType, cvSharepointUrl, boardMember, managementTeam,
    } = req.body;

    // Self-edit is restricted to personal-tier fields. Admins can edit anything.
    if (!isAdmin) {
      const adminOnly = [salaryCurrent, managerId, status, endDate, boardMember, managementTeam, employmentType];
      if (adminOnly.some(v => v !== undefined)) {
        return res.status(403).json({ error: "Those fields are admin-only" });
      }
    }

    try {
      await pool.query(`
        INSERT INTO staff_profiles (
          user_id, title, start_date, end_date, status, salary_current, manager_id,
          department, rics_pathway, apc_status, apc_assessment_date, education, bio,
          emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
          holiday_entitlement, pension_opt_in, pension_rate,
          contract_sharepoint_url, passport_sharepoint_url, linkedin_url, xero_tracking_name,
          dob, address, wfh_days, employment_type, cv_sharepoint_url, board_member, management_team
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
                  $24,$25,$26,$27,$28,$29,$30)
        ON CONFLICT (user_id) DO UPDATE SET
          title = COALESCE(EXCLUDED.title, staff_profiles.title),
          start_date = COALESCE(EXCLUDED.start_date, staff_profiles.start_date),
          end_date = COALESCE(EXCLUDED.end_date, staff_profiles.end_date),
          status = COALESCE(EXCLUDED.status, staff_profiles.status),
          salary_current = COALESCE(EXCLUDED.salary_current, staff_profiles.salary_current),
          manager_id = COALESCE(EXCLUDED.manager_id, staff_profiles.manager_id),
          department = COALESCE(EXCLUDED.department, staff_profiles.department),
          rics_pathway = COALESCE(EXCLUDED.rics_pathway, staff_profiles.rics_pathway),
          apc_status = COALESCE(EXCLUDED.apc_status, staff_profiles.apc_status),
          apc_assessment_date = COALESCE(EXCLUDED.apc_assessment_date, staff_profiles.apc_assessment_date),
          education = COALESCE(EXCLUDED.education, staff_profiles.education),
          bio = COALESCE(EXCLUDED.bio, staff_profiles.bio),
          emergency_contact_name = COALESCE(EXCLUDED.emergency_contact_name, staff_profiles.emergency_contact_name),
          emergency_contact_phone = COALESCE(EXCLUDED.emergency_contact_phone, staff_profiles.emergency_contact_phone),
          emergency_contact_relation = COALESCE(EXCLUDED.emergency_contact_relation, staff_profiles.emergency_contact_relation),
          holiday_entitlement = COALESCE(EXCLUDED.holiday_entitlement, staff_profiles.holiday_entitlement),
          pension_opt_in = COALESCE(EXCLUDED.pension_opt_in, staff_profiles.pension_opt_in),
          pension_rate = COALESCE(EXCLUDED.pension_rate, staff_profiles.pension_rate),
          contract_sharepoint_url = COALESCE(EXCLUDED.contract_sharepoint_url, staff_profiles.contract_sharepoint_url),
          passport_sharepoint_url = COALESCE(EXCLUDED.passport_sharepoint_url, staff_profiles.passport_sharepoint_url),
          linkedin_url = COALESCE(EXCLUDED.linkedin_url, staff_profiles.linkedin_url),
          xero_tracking_name = COALESCE(EXCLUDED.xero_tracking_name, staff_profiles.xero_tracking_name),
          dob = COALESCE(EXCLUDED.dob, staff_profiles.dob),
          address = COALESCE(EXCLUDED.address, staff_profiles.address),
          wfh_days = COALESCE(EXCLUDED.wfh_days, staff_profiles.wfh_days),
          employment_type = COALESCE(EXCLUDED.employment_type, staff_profiles.employment_type),
          cv_sharepoint_url = COALESCE(EXCLUDED.cv_sharepoint_url, staff_profiles.cv_sharepoint_url),
          board_member = COALESCE(EXCLUDED.board_member, staff_profiles.board_member),
          management_team = COALESCE(EXCLUDED.management_team, staff_profiles.management_team),
          updated_at = now()
      `, [
        userId, title, startDate, endDate, status, salaryCurrent, managerId,
        department, ricsPathway, apcStatus, apcAssessmentDate, education, bio,
        emergencyContactName, emergencyContactPhone, emergencyContactRelation,
        holidayEntitlement, pensionOptIn, pensionRate,
        contractSharepointUrl, passportSharepointUrl, linkedinUrl, xeroTrackingName,
        dob, address, wfhDays, employmentType, cvSharepointUrl, boardMember, managementTeam,
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
    const base = "https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/Shared%20Documents/HR/Policies%20%26%20Procedures";
    const policies = [
      { name: "AML Policy",                     category: "Compliance",      url: `${base}/AML` },
      { name: "Anti-Bribery Policy",             category: "Compliance",      url: `${base}/Anti%20bribery` },
      { name: "Commission Scheme",               category: "Compensation",    url: `${base}/Commission%20scheme` },
      { name: "Complaints Handling Procedure",   category: "Operations",      url: `${base}/Complaints%20handling%20procedure` },
      { name: "Equality Policy",                 category: "HR",              url: `${base}/Equality` },
      { name: "Expenses Policy",                 category: "Finance",         url: `${base}/Expenses` },
      { name: "Fire Safety Policy",              category: "Health & Safety", url: `${base}/Fire%20safety` },
      { name: "Living Wage Policy",              category: "HR",              url: `${base}/Living%20Wage` },
      { name: "Maternity Policy",                category: "HR",              url: `${base}/Maternity%20Policy` },
      { name: "Safety at Work",                  category: "Health & Safety", url: `${base}/Safety%20at%20work` },
    ];
    res.json(policies);
  });

  // ── Org chart data ────────────────────────────────────────────────────────

  app.get("/api/hr/org-chart", requireAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          u.id, u.name, u.profile_pic_url, u.team,
          sp.title, sp.manager_id, sp.department, sp.status AS hr_status,
          sp.board_member, sp.management_team, sp.employment_type
        FROM users u
        LEFT JOIN staff_profiles sp ON sp.user_id = u.id
        WHERE u.is_active = true AND COALESCE(sp.status, 'active') = 'active'
        ORDER BY u.name ASC
      `);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Upcoming birthdays (next N days) ──────────────────────────────────────
  app.get("/api/hr/birthdays", requireAuth, async (req: any, res) => {
    try {
      const days = Math.max(1, Math.min(60, parseInt(String(req.query.days || "14"), 10) || 14));
      const { rows } = await pool.query(`
        SELECT u.id, u.name, u.profile_pic_url, u.team, sp.title, sp.dob
        FROM users u
        JOIN staff_profiles sp ON sp.user_id = u.id
        WHERE u.is_active = true AND COALESCE(sp.status, 'active') = 'active' AND sp.dob IS NOT NULL
      `);
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const upcoming = rows
        .map((r: any) => {
          const m = String(r.dob).match(/-(\d{2})-(\d{2})$/);
          if (!m) return null;
          const month = parseInt(m[1], 10) - 1;
          const day = parseInt(m[2], 10);
          let next = new Date(today.getFullYear(), month, day);
          if (next < start) next = new Date(today.getFullYear() + 1, month, day);
          const diffDays = Math.round((next.getTime() - start.getTime()) / 86400000);
          return diffDays >= 0 && diffDays <= days
            ? { id: r.id, name: r.name, title: r.title, team: r.team, profilePicUrl: r.profile_pic_url, date: next.toISOString().slice(0, 10), daysUntil: diffDays }
            : null;
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.daysUntil - b.daysUntil);
      res.json(upcoming);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Admin: add a new staff member ─────────────────────────────────────────
  // Creates a `users` row with a placeholder password (admin issues a real one
  // via Settings later) and an empty `staff_profiles` row that the EditProfileDialog
  // populates. Idempotent on username — re-runs return the existing user.
  app.post("/api/hr/staff", requireAdmin, async (req: any, res) => {
    const { name, email, role, team, title, managerId, employmentType } = req.body || {};
    if (!name || typeof name !== "string") return res.status(400).json({ error: "Name is required" });
    try {
      const username = name.toLowerCase().replace(/['']/g, "").replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
      const bcrypt = await import("bcrypt");
      const placeholder = await bcrypt.default.hash(`bgp-placeholder-${Date.now()}`, 10);

      const existing = await pool.query("SELECT id FROM users WHERE LOWER(name) = LOWER($1) OR username = $2 LIMIT 1", [name.trim(), username]);
      let userId: string;
      if (existing.rows.length > 0) {
        userId = existing.rows[0].id;
        await pool.query(
          "UPDATE users SET role = COALESCE($2, role), team = COALESCE($3, team), email = COALESCE($4, email), is_active = true WHERE id = $1",
          [userId, role || null, team || null, email || null]
        );
      } else {
        const r = await pool.query(
          "INSERT INTO users (username, password, name, email, role, team, is_admin, is_active) VALUES ($1,$2,$3,$4,$5,$6,false,true) RETURNING id",
          [username, placeholder, name.trim(), email || null, role || null, team || null]
        );
        userId = r.rows[0].id;
      }
      await pool.query(
        `INSERT INTO staff_profiles (user_id, title, manager_id, employment_type, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (user_id) DO UPDATE SET
           title = COALESCE(EXCLUDED.title, staff_profiles.title),
           manager_id = COALESCE(EXCLUDED.manager_id, staff_profiles.manager_id),
           employment_type = COALESCE(EXCLUDED.employment_type, staff_profiles.employment_type),
           updated_at = now()`,
        [userId, title || null, managerId || null, employmentType || null]
      );
      res.json({ id: userId, name });
    } catch (e: any) {
      if (e?.code === "23505") return res.status(409).json({ error: "That username already exists" });
      res.status(500).json({ error: e.message });
    }
  });

  // ── Admin: remove (deactivate) a staff member ─────────────────────────────
  // Soft-delete: keeps the user row + history, hides them from the org chart.
  app.delete("/api/hr/staff/:userId", requireAdmin, async (req: any, res) => {
    const actorId = req.session?.userId || req.tokenUserId;
    if (actorId === req.params.userId) return res.status(400).json({ error: "Cannot remove yourself" });
    try {
      await pool.query("UPDATE users SET is_active = false WHERE id = $1", [req.params.userId]);
      await pool.query("UPDATE staff_profiles SET status = 'leaver', end_date = COALESCE(end_date, to_char(now(), 'YYYY-MM-DD')), updated_at = now() WHERE user_id = $1", [req.params.userId]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Admin: seed the May 2026 BGP org chart (reporting lines + flags) ──────
  // Idempotent: matches existing users by case-insensitive name and only sets
  // org-chart fields. Skips people who aren't in the users table (admin uses
  // POST /api/hr/staff above to add missing names first).
  app.post("/api/hr/seed-org-chart", requireAdmin, async (req: any, res) => {
    // [name, role, team, reportsTo, board, mgt]
    const ROSTER: Array<[string, string, string, string | null, boolean, boolean]> = [
      ["Woody Bruce", "Managing Director", "Office / Corporate", null, true, true],
      ["Cara Milligan", "PA – National", "Office / Corporate", "Woody Bruce", false, false],
      ["Harriette Walker-Clark", "PA & Office Manager – Central London Leasing", "Office / Corporate", "Woody Bruce", false, false],
      ["Layla O'Driscoll", "PA & Office Manager – Central London & Board support", "Office / Corporate", "Woody Bruce", false, false],
      ["Nick Goodman", "Consultant", "Office / Corporate", "Woody Bruce", false, false],
      ["Wendy McKenzie", "Bookkeeper", "Office / Corporate", "Woody Bruce", false, false],
      ["Jack Barratt", "ED, Head of Investment – Finance", "Investment", "Woody Bruce", true, true],
      ["Nick Halley", "Director – Investment", "Investment", "Jack Barratt", false, false],
      ["Ollie Wilkinson", "Associate Director – Investment", "Investment", "Nick Halley", false, false],
      ["Jonny Palmer", "Graduate", "Investment", "Ollie Wilkinson", false, false],
      ["Pete Wood", "Head – Lease Consultancy / Management", "Lease Advisory", "Woody Bruce", false, true],
      ["Tom Cater", "Associate Director", "Lease Advisory", "Pete Wood", false, false],
      ["Victoria Broadhead", "Head – National / Management", "National Leasing", "Woody Bruce", false, true],
      ["Lucy Gardiner", "Director – National Team", "National Leasing", "Victoria Broadhead", false, false],
      ["Rob Barnes", "Surveyor – National Team", "National Leasing", "Lucy Gardiner", false, false],
      ["Luke Donohoe", "Graduate Surveyor – National Team", "National Leasing", "Rob Barnes", false, false],
      ["Tracey Pollard", "Head – Development / Re-purposing", "Development", "Woody Bruce", false, true],
      ["Emily Dumbell", "Director – Leasing", "Development", "Tracey Pollard", false, false],
      ["Alex Todd", "Senior Surveyor – Development", "Development", "Emily Dumbell", false, false],
      ["Libby Evans", "Graduate Surveyor – Development", "Development", "Alex Todd", false, false],
      ["Harry Elliot", "Director – Tenant Rep", "Tenant Rep", "Woody Bruce", false, true],
      ["Charlotte Roberts", "ED & Co-Head – London Estates / Marketing", "London Leasing", "Woody Bruce", true, true],
      ["Rupert Bentley-Smith", "ED & Co-Head – London Estates & USA / Ops & HR", "London Leasing", "Woody Bruce", true, true],
      ["Evie North", "Associate Director – Leasing & Tenant Rep", "London Leasing", "Charlotte Roberts", false, false],
      ["Lizzie Knights", "Director – London Leasing", "London Leasing", "Charlotte Roberts", false, false],
      ["Lucy Cope", "Associate Director – London Leasing", "London Leasing", "Lizzie Knights", false, false],
      ["Will Penfold", "Graduate Surveyor – London Leasing", "London Leasing", "Rupert Bentley-Smith", false, false],
      ["Emily Cann", "Graduate Surveyor – London Leasing", "London Leasing", "Lucy Cope", false, false],
    ];

    const nameToId = new Map<string, string>();
    let updated = 0, skipped = 0;
    const skippedNames: string[] = [];

    // Pass 1: resolve every name to a user id (skip the ones we can't find).
    for (const [name] of ROSTER) {
      const r = await pool.query("SELECT id FROM users WHERE LOWER(name) = LOWER($1) LIMIT 1", [name]);
      if (r.rows.length === 0) { skipped++; skippedNames.push(name); continue; }
      nameToId.set(name, r.rows[0].id);
    }

    // Pass 2: write title/team/manager/board/mgt to staff_profiles + users.team.
    for (const [name, role, team, reportsTo, board, mgt] of ROSTER) {
      const userId = nameToId.get(name);
      if (!userId) continue;
      const managerId = reportsTo ? nameToId.get(reportsTo) ?? null : null;
      await pool.query("UPDATE users SET role = $2, team = $3 WHERE id = $1", [userId, role, team]);
      await pool.query(
        `INSERT INTO staff_profiles (user_id, title, manager_id, board_member, management_team, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         ON CONFLICT (user_id) DO UPDATE SET
           title = EXCLUDED.title,
           manager_id = EXCLUDED.manager_id,
           board_member = EXCLUDED.board_member,
           management_team = EXCLUDED.management_team,
           updated_at = now()`,
        [userId, role, managerId, board, mgt]
      );
      updated++;
    }

    res.json({ updated, skipped, skippedNames });
  });
}
