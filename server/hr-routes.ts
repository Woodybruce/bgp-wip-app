import type { Express } from "express";
import { pool } from "./db";
import { requireAuth, requireAdmin } from "./auth";
import { xeroApi, xeroPayrollApi } from "./xero";
import { getValidMsToken } from "./microsoft";
import { resolveSharePointShareLink } from "./sharepoint-resolver";
import * as XLSX from "xlsx";
import multer from "multer";
import mammoth from "mammoth";
import { renderCvPdf, renderCvDocx, type CvData } from "./cv-renderer";
import { contentDispositionFor } from "./utils/http-headers";

// requireAuth doesn't populate req.user, so look up admin status from the DB
// using the session/token user id. Used by hybrid (admin-or-self) endpoints
// where the simple `requireAdmin` middleware isn't enough.
async function getActor(req: any): Promise<{ userId: string | null; isAdmin: boolean }> {
  const userId = req.session?.userId || req.tokenUserId || null;
  if (!userId) return { userId: null, isAdmin: false };
  const r = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
  return { userId, isAdmin: r.rows[0]?.is_admin === true };
}

// Hydrate req.user for handlers that still read req.user.id / req.user.isAdmin.
// Cheap (one indexed lookup) and fixes a swathe of bugs where requireAuth
// was followed by checks against an unpopulated req.user.
async function hydrateReqUser(req: any): Promise<{ id: string | null; isAdmin: boolean }> {
  const actor = await getActor(req);
  req.user = { id: actor.userId, isAdmin: actor.isAdmin };
  return req.user;
}

// Normalise a person's name for fuzzy matching — strip everything but
// lowercase alphanumerics so "Tom O'Brien" and "tom obrien" collide.
function normaliseNameKey(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

type XeroEmployee = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  status: string | null;
};

// Pull every employee from Xero Payroll UK, paging 100 at a time, flattened
// to a stable shape. Used by the link-status + link-employees endpoints.
async function fetchXeroPayrollEmployees(session: any): Promise<XeroEmployee[]> {
  const out: XeroEmployee[] = [];
  for (let page = 1; page <= 20; page++) {
    const data = await xeroPayrollApi(session, `/Employees?page=${page}`);
    const emps: any[] = data.Employees || [];
    for (const e of emps) {
      const firstName = e.FirstName || "";
      const lastName = e.LastName || "";
      const id = e.EmployeeID || e.EmployeeId;
      if (!id) continue;
      out.push({
        id,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        email: e.Email || null,
        status: e.Status || null,
      });
    }
    if (emps.length < 100) break;
  }
  return out;
}

// Benefit renewal sweep — for each benefit with a renewal_date in the next
// 60 days that hasn't already had a task generated this calendar year, create
// a high-priority task for the broker_contact (or first admin) so HR has 8
// weeks' notice to re-quote. Idempotent via renewal_task_created_for_year.
export async function runBenefitRenewalSweep(): Promise<Array<{ slug: string; userId: string; renewalDate: string }>> {
  const created: Array<{ slug: string; userId: string; renewalDate: string }> = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + 60 * 86400000);

  const { rows: benefits } = await pool.query(
    `SELECT slug, name, renewal_date, broker_contact, contact, renewal_task_created_for_year
     FROM benefits
     WHERE is_active = true
       AND renewal_date IS NOT NULL
       AND renewal_date::date BETWEEN $1::date AND $2::date`,
    [today.toISOString().slice(0, 10), horizon.toISOString().slice(0, 10)]
  );

  for (const b of benefits) {
    const renewalYear = new Date(b.renewal_date).getFullYear();
    if (b.renewal_task_created_for_year === renewalYear) continue;

    // Resolve broker_contact / contact (free text "Wendy McKenzie") to a user.
    const target = b.broker_contact || b.contact || "";
    if (!target) continue;
    const userRes = await pool.query(
      `SELECT id FROM users WHERE LOWER(name) = LOWER($1) AND is_active = true LIMIT 1`,
      [target.trim()]
    );
    let userId = userRes.rows[0]?.id;
    if (!userId) {
      // Fall back to the first active admin so the task lands somewhere
      const adminRes = await pool.query(`SELECT id FROM users WHERE is_admin = true AND is_active = true ORDER BY created_at LIMIT 1`);
      userId = adminRes.rows[0]?.id;
    }
    if (!userId) continue;

    const due = new Date(b.renewal_date);
    due.setDate(due.getDate() - 30); // task due 30 days before renewal
    await pool.query(
      `INSERT INTO user_tasks (user_id, title, description, due_date, priority, status, category)
       VALUES ($1, $2, $3, $4, 'high', 'todo', 'benefit-renewal')`,
      [
        userId,
        `Renew ${b.name}`,
        `Policy renews ${new Date(b.renewal_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. Re-quote with at least 2 alternatives, get sign-off before locking.`,
        due.toISOString(),
      ]
    );
    await pool.query(`UPDATE benefits SET renewal_task_created_for_year = $2 WHERE slug = $1`, [b.slug, renewalYear]);
    created.push({ slug: b.slug, userId, renewalDate: b.renewal_date });
  }

  return created;
}

// Brucey Bonuses scan — extracted so both the admin endpoint and the daily
// cron in server/index.ts can call it. Idempotent via the (event_kind,
// event_ref) partial unique index — re-running on an overlapping window
// silently skips events already awarded.
export async function runBruceyPointsScan(): Promise<{ scannedEvents: number; newAwards: number; weekAgo: string }> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);

  const usersRes = await pool.query(
    `SELECT u.id, u.name, sp.xero_tracking_name FROM users u
     JOIN staff_profiles sp ON sp.user_id = u.id
     WHERE u.is_active = true`
  );
  const nameToId = new Map<string, string>();
  for (const u of usersRes.rows) {
    nameToId.set(u.name.toLowerCase(), u.id);
    if (u.xero_tracking_name) nameToId.set(u.xero_tracking_name.toLowerCase(), u.id);
  }

  const POINTS = {
    dealCompleted: 100,
    dealExchanged: 60,
    dealAdvanced: 25,
    reviewSubmitted: 50,
    reviewCompleted: 75,
    kudosGiven: 5,
    kudosReceived: 10,
    taskCompleted: 5,
    cpdHourLogged: 10,
    amlChecked: 15,
  };

  const awarded: Array<{ userId: string; points: number; reason: string; eventKind: string; eventRef: string }> = [];

  const { rows: deals } = await pool.query(
    `SELECT id, name, status, internal_agent, internal_agent_ids,
            COALESCE(completed_at, exchanged_at, target_date, instructed_at) AS dt
     FROM crm_deals
     WHERE COALESCE(completed_at, exchanged_at, target_date, instructed_at) BETWEEN $1 AND $2
       AND COALESCE(status, '') NOT IN ('ARCH','WIT')
       AND fee IS NOT NULL AND fee > 0`,
    [weekAgo, now]
  );
  for (const d of deals) {
    // Prefer internal_agent_ids (rename-safe). Fall back to internal_agent
    // names for historic rows whose IDs column hasn't been backfilled.
    // De-dup the resolved set so a deal with both populated columns
    // doesn't double-award the same agent.
    const resolvedIds = new Set<string>();
    const ids: string[] = Array.isArray(d.internal_agent_ids) ? d.internal_agent_ids : [];
    for (const id of ids) if (id) resolvedIds.add(id);
    if (resolvedIds.size === 0) {
      const agents: string[] = Array.isArray(d.internal_agent) ? d.internal_agent : [];
      for (const ag of agents) {
        const uid = nameToId.get(ag.toLowerCase());
        if (uid) resolvedIds.add(uid);
      }
    }
    if (resolvedIds.size === 0) continue;
    let pts = POINTS.dealAdvanced;
    let label = "advanced";
    if (d.status === "COM" || d.status === "INV") { pts = POINTS.dealCompleted; label = "closed"; }
    else if (d.status === "EXC") { pts = POINTS.dealExchanged; label = "exchanged"; }
    for (const uid of resolvedIds) {
      awarded.push({
        userId: uid, points: pts, reason: `Deal ${label}: ${d.name}`,
        eventKind: `deal-${label}`, eventRef: `${d.id}|${uid}`,
      });
    }
  }

  const { rows: reviews } = await pool.query(
    `SELECT id, user_id, status, submitted_at, reviewed_at
     FROM staff_reviews
     WHERE submitted_at BETWEEN $1 AND $2 OR reviewed_at BETWEEN $1 AND $2`,
    [weekAgo, now]
  );
  for (const r of reviews) {
    if (r.submitted_at && new Date(r.submitted_at) >= weekAgo) {
      awarded.push({ userId: r.user_id, points: POINTS.reviewSubmitted, reason: "Submitted review", eventKind: "review-submitted", eventRef: r.id });
    }
    if (r.status === "completed" && r.reviewed_at && new Date(r.reviewed_at) >= weekAgo) {
      awarded.push({ userId: r.user_id, points: POINTS.reviewCompleted, reason: "Review completed", eventKind: "review-completed", eventRef: r.id });
    }
  }

  const { rows: kudos } = await pool.query(
    `SELECT id, user_id, issued_by_user_id, kind FROM staff_awards
     WHERE created_at BETWEEN $1 AND $2 AND kind = 'kudos'`,
    [weekAgo, now]
  );
  for (const k of kudos) {
    awarded.push({ userId: k.user_id, points: POINTS.kudosReceived, reason: "Kudos received from a colleague", eventKind: "kudos-received", eventRef: k.id });
    if (k.issued_by_user_id) {
      awarded.push({ userId: k.issued_by_user_id, points: POINTS.kudosGiven, reason: "Recognised a colleague", eventKind: "kudos-given", eventRef: k.id });
    }
  }

  const { rows: tasks } = await pool.query(
    `SELECT id, user_id FROM user_tasks
     WHERE completed_at BETWEEN $1 AND $2 AND status = 'done'`,
    [weekAgo, now]
  );
  for (const t of tasks) {
    awarded.push({ userId: t.user_id, points: POINTS.taskCompleted, reason: "Task done", eventKind: "task-done", eventRef: t.id });
  }

  let inserted = 0;
  for (const a of awarded) {
    const r = await pool.query(
      `INSERT INTO brucey_points (user_id, points, reason, event_kind, event_ref, awarded_by)
       VALUES ($1, $2, $3, $4, $5, 'ai')
       ON CONFLICT (event_kind, event_ref) WHERE event_ref IS NOT NULL DO NOTHING
       RETURNING id`,
      [a.userId, a.points, a.reason, a.eventKind, a.eventRef]
    );
    if (r.rowCount && r.rowCount > 0) inserted++;
  }

  return { scannedEvents: awarded.length, newAwards: inserted, weekAgo: weekAgo.toISOString() };
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
          sp.rics_pathway, sp.rics_number, sp.apc_status, sp.apc_assessment_date,
          sp.apc_planned_sitting, sp.apc_submission_deadline,
          sp.apc_intent_to_submit_date, sp.apc_submission_date,
          sp.apc_counsellor_name, sp.apc_counsellor_email,
          sp.cv_summary, sp.cv_specialisms, sp.cv_notable_clients, sp.cv_career_history,
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
          -- Used = approved days that *fall within* the current calendar
          -- year (filter on start_date, not created_at). A January holiday
          -- submitted in December must count against the new year. Pending
          -- requests surfaced separately so the UI can show used / pending
          -- / remaining without double-subtracting.
          (SELECT COALESCE(SUM(days_count), 0) FROM holiday_requests
           WHERE user_id = u.id AND status = 'approved'
             AND EXTRACT(YEAR FROM start_date) = EXTRACT(YEAR FROM now())) AS holiday_used,
          (SELECT COALESCE(SUM(days_count), 0) FROM holiday_requests
           WHERE user_id = u.id AND status = 'pending'
             AND EXTRACT(YEAR FROM start_date) = EXTRACT(YEAR FROM now())) AS holiday_pending
        FROM users u
        LEFT JOIN staff_profiles sp ON sp.user_id = u.id
        LEFT JOIN users m ON m.id = sp.manager_id
        WHERE u.is_active = true
        ORDER BY u.name ASC
      `, [myId, isAdmin]);
      res.json(rows);
    } catch (e: any) {
      console.error("[hr] GET /staff error:", e.message);
      // Fallback: if the heavy query fails (missing column, broken
      // subquery, etc.) return a minimal staff list so the UI doesn't
      // dead-end on a 500. The team cards, drill-in fallback fetch,
      // and most directory views only need id + name + role + team.
      try {
        const { rows: basic } = await pool.query(`
          SELECT u.id, u.name, u.email, u.phone, u.role, u.department, u.team,
                 u.is_admin, u.is_active, u.profile_pic_url,
                 sp.id AS profile_id, sp.title, sp.manager_id, sp.start_date,
                 sp.status AS hr_status,
                 m.name AS manager_name
            FROM users u
            LEFT JOIN staff_profiles sp ON sp.user_id = u.id
            LEFT JOIN users m ON m.id = sp.manager_id
           WHERE u.is_active = true
           ORDER BY u.name ASC
        `);
        res.json(basic);
      } catch (fallbackErr: any) {
        console.error("[hr] GET /staff fallback also failed:", fallbackErr.message);
        res.status(500).json({ error: e.message, fallbackError: fallbackErr.message });
      }
    }
  });

  app.get("/api/hr/staff/:userId", requireAuth, async (req: any, res) => {
    const { userId } = req.params;
    const actor = await getActor(req);
    // Anyone signed in can pull the basic record (name, role, team, bio,
    // public CV, photo). Sensitive fields below are masked at the SQL
    // layer for everyone except admins and the person themselves —
    // mirrors the pattern the bulk /api/hr/staff endpoint already uses
    // for dob + address. Old behaviour (blanket 403 for non-admin viewing
    // anyone else) blocked a click-through that should always work; the
    // confidentiality is in the FIELDS not the existence of the row.
    const canSeeSensitive = actor.isAdmin || actor.userId === userId;
    try {
      const { rows } = await pool.query(`
        SELECT
          u.id, u.name, u.email, u.phone, u.role, u.department, u.team,
          u.is_admin, u.is_active, u.profile_pic_url,
          sp.id AS profile_id,
          sp.title, sp.start_date, sp.end_date, sp.status AS hr_status,
          CASE WHEN $2::boolean THEN sp.salary_current ELSE NULL END AS salary_current,
          sp.manager_id, sp.department AS hr_department,
          sp.rics_pathway, sp.rics_number, sp.apc_status, sp.apc_assessment_date,
          sp.apc_planned_sitting, sp.apc_submission_deadline,
          sp.apc_intent_to_submit_date, sp.apc_submission_date,
          sp.apc_counsellor_name, sp.apc_counsellor_email,
          sp.cv_summary, sp.cv_specialisms, sp.cv_notable_clients, sp.cv_career_history,
          sp.education, sp.bio,
          CASE WHEN $2::boolean THEN sp.emergency_contact_name ELSE NULL END AS emergency_contact_name,
          CASE WHEN $2::boolean THEN sp.emergency_contact_phone ELSE NULL END AS emergency_contact_phone,
          CASE WHEN $2::boolean THEN sp.emergency_contact_relation ELSE NULL END AS emergency_contact_relation,
          CASE WHEN $2::boolean THEN sp.holiday_entitlement ELSE NULL END AS holiday_entitlement,
          CASE WHEN $2::boolean THEN sp.pension_opt_in ELSE NULL END AS pension_opt_in,
          CASE WHEN $2::boolean THEN sp.pension_rate ELSE NULL END AS pension_rate,
          CASE WHEN $2::boolean THEN sp.contract_sharepoint_url ELSE NULL END AS contract_sharepoint_url,
          CASE WHEN $2::boolean THEN sp.passport_sharepoint_url ELSE NULL END AS passport_sharepoint_url,
          sp.linkedin_url, sp.xero_tracking_name,
          CASE WHEN $2::boolean THEN sp.dob ELSE NULL END AS dob,
          CASE WHEN $2::boolean THEN sp.address ELSE NULL END AS address,
          sp.wfh_days, sp.employment_type, sp.cv_sharepoint_url,
          sp.board_member, sp.management_team,
          m.name AS manager_name,
          CASE WHEN $2::boolean THEN
            (SELECT COALESCE(SUM(days_count), 0) FROM holiday_requests
              WHERE user_id = u.id AND status = 'approved'
                AND EXTRACT(YEAR FROM start_date) = EXTRACT(YEAR FROM now()))
          ELSE NULL END AS holiday_used,
          CASE WHEN $2::boolean THEN
            (SELECT COALESCE(SUM(days_count), 0) FROM holiday_requests
              WHERE user_id = u.id AND status = 'pending'
                AND EXTRACT(YEAR FROM start_date) = EXTRACT(YEAR FROM now()))
          ELSE NULL END AS holiday_pending
        FROM users u
        LEFT JOIN staff_profiles sp ON sp.user_id = u.id
        LEFT JOIN users m ON m.id = sp.manager_id
        WHERE u.id = $1
      `, [userId, canSeeSensitive]);
      if (!rows[0]) return res.status(404).json({ error: "User not found" });
      res.json(rows[0]);
    } catch (e: any) {
      console.error("[hr] GET /staff/:userId error:", e.message);
      // Fallback: minimal SELECT so the drill-in opens with at least
      // basic name + role + photo + bio + manager. Heavy fields stay
      // null; client masks them gracefully via the existing isAdmin
      // / isOwn gates on each panel.
      try {
        const { rows: basic } = await pool.query(`
          SELECT u.id, u.name, u.email, u.phone, u.role, u.department, u.team,
                 u.is_admin, u.is_active, u.profile_pic_url,
                 sp.id AS profile_id, sp.title, sp.manager_id, sp.start_date,
                 sp.status AS hr_status, sp.bio, sp.cv_summary, sp.linkedin_url,
                 m.name AS manager_name
            FROM users u
            LEFT JOIN staff_profiles sp ON sp.user_id = u.id
            LEFT JOIN users m ON m.id = sp.manager_id
           WHERE u.id = $1
        `, [userId]);
        if (!basic[0]) return res.status(404).json({ error: "User not found" });
        res.json(basic[0]);
      } catch (fallbackErr: any) {
        console.error("[hr] GET /staff/:userId fallback also failed:", fallbackErr.message);
        res.status(500).json({ error: e.message, fallbackError: fallbackErr.message });
      }
    }
  });

  app.post("/api/hr/staff/:userId/profile", requireAuth, async (req: any, res) => {
    const { userId } = req.params;
    const actor = await getActor(req);
    const isAdmin = actor.isAdmin;
    const isSelf = actor.userId === userId;
    if (!isAdmin && !isSelf) return res.status(403).json({ error: "Admin or self only" });

    // Validate managerId before we let it land. Reject self-references
    // and chains (A → B → A). Inactive users can't be appointed as
    // managers — they wouldn't see the inbox. NULL clears the link.
    if (req.body?.managerId) {
      const proposed = String(req.body.managerId);
      if (proposed === userId) return res.status(400).json({ error: "A user can't be their own manager." });
      const { rows: mgr } = await pool.query<{ is_active: boolean }>(
        "SELECT is_active FROM users WHERE id = $1",
        [proposed]
      );
      if (!mgr[0]) return res.status(400).json({ error: "Manager user not found." });
      if (!mgr[0].is_active) return res.status(400).json({ error: "Manager is inactive — pick someone else." });
      // Walk up to detect cycles. Cap at a depth that comfortably exceeds
      // any sane org chart (BGP has ~4 levels).
      let cursor: string | null = proposed;
      for (let depth = 0; depth < 20 && cursor; depth++) {
        if (cursor === userId) {
          return res.status(400).json({ error: "That would create a reporting cycle." });
        }
        const { rows }: { rows: Array<{ manager_id: string | null }> } = await pool.query(
          "SELECT manager_id FROM staff_profiles WHERE user_id = $1",
          [cursor]
        );
        cursor = rows[0]?.manager_id || null;
      }
    }

    const {
      title, startDate, endDate, status, salaryCurrent, managerId,
      department, ricsPathway, ricsNumber, apcStatus, apcAssessmentDate,
      apcPlannedSitting, apcSubmissionDeadline,
      apcIntentToSubmitDate, apcSubmissionDate,
      apcCounsellorName, apcCounsellorEmail,
      cvSummary, cvSpecialisms, cvNotableClients, cvCareerHistory,
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
          dob, address, wfh_days, employment_type, cv_sharepoint_url, board_member, management_team,
          rics_number,
          apc_planned_sitting, apc_submission_deadline, apc_counsellor_name, apc_counsellor_email,
          apc_intent_to_submit_date, apc_submission_date,
          cv_summary, cv_specialisms, cv_notable_clients, cv_career_history
        ) VALUES ($1,$2,$3,$4,COALESCE($5, 'active'),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
                  $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41)
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
          rics_number = COALESCE(EXCLUDED.rics_number, staff_profiles.rics_number),
          apc_planned_sitting = COALESCE(EXCLUDED.apc_planned_sitting, staff_profiles.apc_planned_sitting),
          apc_submission_deadline = COALESCE(EXCLUDED.apc_submission_deadline, staff_profiles.apc_submission_deadline),
          apc_counsellor_name = COALESCE(EXCLUDED.apc_counsellor_name, staff_profiles.apc_counsellor_name),
          apc_counsellor_email = COALESCE(EXCLUDED.apc_counsellor_email, staff_profiles.apc_counsellor_email),
          apc_intent_to_submit_date = COALESCE(EXCLUDED.apc_intent_to_submit_date, staff_profiles.apc_intent_to_submit_date),
          apc_submission_date = COALESCE(EXCLUDED.apc_submission_date, staff_profiles.apc_submission_date),
          cv_summary = COALESCE(EXCLUDED.cv_summary, staff_profiles.cv_summary),
          cv_specialisms = COALESCE(EXCLUDED.cv_specialisms, staff_profiles.cv_specialisms),
          cv_notable_clients = COALESCE(EXCLUDED.cv_notable_clients, staff_profiles.cv_notable_clients),
          cv_career_history = COALESCE(EXCLUDED.cv_career_history, staff_profiles.cv_career_history),
          updated_at = now()
      `, [
        userId, title, startDate, endDate, status, salaryCurrent, managerId,
        department, ricsPathway, apcStatus, apcAssessmentDate, education, bio,
        emergencyContactName, emergencyContactPhone, emergencyContactRelation,
        holidayEntitlement, pensionOptIn, pensionRate,
        contractSharepointUrl, passportSharepointUrl, linkedinUrl, xeroTrackingName,
        dob, address, wfhDays, employmentType, cvSharepointUrl, boardMember, managementTeam,
        ricsNumber,
        apcPlannedSitting, apcSubmissionDeadline, apcCounsellorName, apcCounsellorEmail,
        apcIntentToSubmitDate, apcSubmissionDate,
        cvSummary, cvSpecialisms, cvNotableClients,
        cvCareerHistory != null ? JSON.stringify(cvCareerHistory) : null,
      ]);

      // Team is on the users table itself (not staff_profiles). Admins can
      // reassign someone via the Team dropdown in Edit Profile — the canonical
      // list lives in CRM_OPTIONS.dealTeam on the client.
      if (isAdmin && req.body.team !== undefined) {
        await pool.query(
          "UPDATE users SET team = $1 WHERE id = $2",
          [req.body.team || null, userId]
        );
      }
      // Mirror manager_id to users.manager_id so downstream routing (expense
      // approval, holiday approval) can resolve the reporting line without
      // joining staff_profiles every time. Always runs — manager_id was just
      // upserted into staff_profiles above so we know the canonical value.
      if (managerId !== undefined) {
        await pool.query(
          "UPDATE users SET manager_id = $1 WHERE id = $2",
          [managerId || null, userId]
        );
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Salary history ────────────────────────────────────────────────────────

  app.get("/api/hr/staff/:userId/salary", requireAuth, async (req: any, res) => {
    await hydrateReqUser(req);
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
    await hydrateReqUser(req);
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

  // ── Bonus history ─────────────────────────────────────────────────────────
  // Drives the orange bars on the salary timeline chart. Self can read their
  // own bonuses; admin can read everyone's and write/delete.
  app.get("/api/hr/staff/:userId/bonuses", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const { rows } = await pool.query(
        `SELECT * FROM bonus_history WHERE user_id = $1 ORDER BY effective_date DESC, created_at DESC`,
        [req.params.userId]
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/staff/:userId/bonuses", requireAdmin, async (req: any, res) => {
    const { userId } = req.params;
    const { amountPence, effectiveDate, kind, reason, notes } = req.body || {};
    if (!amountPence || !effectiveDate) {
      return res.status(400).json({ error: "amountPence and effectiveDate required" });
    }
    try {
      const recordedBy = req.session?.userId || req.tokenUserId || null;
      const { rows } = await pool.query(
        `INSERT INTO bonus_history (user_id, amount_pence, effective_date, kind, reason, notes, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, effective_date, amount_pence, kind) DO UPDATE SET
           reason = COALESCE(EXCLUDED.reason, bonus_history.reason),
           notes = COALESCE(EXCLUDED.notes, bonus_history.notes)
         RETURNING *`,
        [userId, amountPence, effectiveDate, kind || "bonus", reason || null, notes || null, recordedBy]
      );
      res.json(rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/hr/staff/:userId/bonuses/:bonusId", requireAdmin, async (req: any, res) => {
    try {
      await pool.query("DELETE FROM bonus_history WHERE id = $1 AND user_id = $2", [req.params.bonusId, req.params.userId]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Commission tracker ────────────────────────────────────────────────────
  // Commission scheme year: 1 May → 30 April
  // Tiers: 2x salary → 30%, 3x → 40%, 4x → 50% (of fees above each threshold)

  app.get("/api/hr/staff/:userId/commission", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
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
        const { getSystemXeroSession } = await import("./xero-system-session");
        const session = await getSystemXeroSession();
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

      // ── Unified commission engine ───────────────────────────────────────
      // All commission numbers come from server/commission-engine.ts so the
      // HR tab and the Finance dashboard can never disagree. Confirmed rules
      // (Woody, 10 Jun 2026): billings on a FEE-DUE basis (earlier of
      // exchange/completion, FY from 1 May), strict Xero fully-PAID payable
      // gate (AUTHORISED is not paid), salary_history pro-rata for mid-year
      // rises. This endpoint keeps its legacy response shape.
      const { buildCommissionStatementForUser, tierCommission: engineTier } = await import("./commission-engine");
      const { statement } = await buildCommissionStatementForUser(userId);

      // Effective salary: engine's salary_history-weighted figure when HR
      // has one; otherwise the legacy mid-year-starter pro-rata on
      // salary_current.
      let effectiveSalary: number;
      if (statement?.salary != null && statement.salary > 0) {
        effectiveSalary = Math.round(statement.salary * 100);
      } else {
        const startDate = profile.start_date ? new Date(profile.start_date) : null;
        effectiveSalary = salary;
        if (startDate && startDate > schemeYearStart) {
          const daysWorked = Math.floor((schemeYearEnd.getTime() - startDate.getTime()) / 86400000);
          effectiveSalary = Math.round(salary * Math.min(daysWorked / 365, 1));
        }
      }

      const t1 = effectiveSalary * 2;  // 30% above this
      const t2 = effectiveSalary * 3;  // 40% above this
      const t3 = effectiveSalary * 4;  // 50% above this

      const tierCommission = (pence: number) => Math.round(engineTier(pence, effectiveSalary));

      // ── WIP / pipeline from crm_deals ───────────────────────────────────────
      // Per-deal share: prefer explicit deal_fee_allocations row for this agent,
      // else split fee equally across internal_agent[]. Status buckets:
      //   NEG/SOL = under-offer / in-solicitors      (early WIP)
      //   EXC     = exchanged                         (committed, fee close)
      //   COM     = completed but not yet invoiced    (almost-billed)
      // Date filter on the scheme year uses completed_at → exchanged_at →
      // target_date → instructed_at, whichever is set.
      let wipByStage: { neg: number; sol: number; exc: number; com: number } = { neg: 0, sol: 0, exc: 0, com: 0 };
      let topDeals: Array<{ id: string; name: string; fee: number; status: string; date: string | null }> = [];
      let awaitingPayment: Array<{ id: string; name: string; fee: number; status: string; date: string | null; invoicedAt: string | null }> = [];
      try {
        const { rows: dealRows } = await pool.query(
          // Commission attribution is now driven entirely by
          // deal_fee_allocations rows. The legacy equal-split fallback
          // (deal.fee / internal_agent[].length when no allocation row
          // existed) is gone — backfill ran first, so every historic
          // deal has explicit rows. Any future deal without allocations
          // will simply not appear in this agent's pipeline, which is
          // the correct signal that the split is missing.
          // Prefer the agent_user_id link (rename-safe); fall back to the
          // legacy agent_name match for historic rows that haven't been
          // backfilled with a user id.
          `WITH my_deals AS (
             SELECT d.id, d.name, d.status, d.fee, d.invoiced_at,
                    COALESCE(d.completed_at, d.exchanged_at, d.target_date, d.instructed_at) AS dt,
                    CASE
                      WHEN dfa.percentage    IS NOT NULL THEN d.fee * dfa.percentage / 100.0
                      WHEN dfa.fixed_amount  IS NOT NULL THEN dfa.fixed_amount
                      ELSE 0
                    END AS my_portion
             FROM crm_deals d
             INNER JOIN deal_fee_allocations dfa
               ON dfa.deal_id = d.id
              AND (
                dfa.agent_user_id = $4
                OR (dfa.agent_user_id IS NULL AND LOWER(dfa.agent_name) = LOWER($1))
              )
           )
           SELECT id, name, status, fee, dt, invoiced_at, my_portion
           FROM my_deals
           WHERE dt BETWEEN $2 AND $3 AND status IS NOT NULL`,
          [trackingName, schemeYearStart.toISOString(), schemeYearEnd.toISOString(), userId]
        );
        for (const r of dealRows) {
          const pence = Math.round((parseFloat(r.my_portion) || 0) * 100);
          if (r.status === "NEG") wipByStage.neg += pence;
          else if (r.status === "SOL") wipByStage.sol += pence;
          else if (r.status === "EXC") wipByStage.exc += pence;
          else if (r.status === "COM") wipByStage.com += pence;
        }
        topDeals = dealRows
          .map((r: any) => ({
            id: r.id,
            name: r.name,
            fee: Math.round((parseFloat(r.my_portion) || 0) * 100),
            status: r.status,
            date: r.dt ? new Date(r.dt).toISOString().slice(0, 10) : null,
          }))
          .sort((a: any, b: any) => b.fee - a.fee)
          .slice(0, 10);

        // awaitingPayment now comes from the commission engine below —
        // fee-due deals whose Xero invoices aren't fully paid yet.
      } catch (wErr: any) {
        // Non-fatal — show billings even if deals query fails (e.g. schema drift).
        console.error("[hr] commission WIP query failed:", wErr.message);
      }

      // ── Billed totals from the unified engine ───────────────────────────
      // Fee-due basis (earlier of exchange/completion this scheme year) is
      // the EARNED figure; the PAID slice requires every Xero invoice on
      // the deal to be fully PAID — AUTHORISED doesn't count. The legacy
      // `invoiced` response key now carries the fee-due figure so older
      // clients keep working.
      const paidOnly = req.query?.paidOnly === "true" || req.query?.paidOnly === "1";
      const feeDuePence = Math.round((statement?.billings ?? 0) * 100);
      const paidPence = Math.round((statement?.billingsPaid ?? 0) * 100);

      // WIP-basis invoiced figure — the SAME aggregation the WIP page's
      // agent summary uses (status INV, credited via fee allocations, or an
      // equal split across internal agents when the deal has no allocations,
      // no date gating). The homepage Billed number must match what people
      // see on the WIP report, so this is the headline figure.
      let wipInvoicedPence = 0;
      try {
        const { isInvoicedStatus } = await import("@shared/deal-status");
        const nameLower = String(profile.name || "").trim().toLowerCase();
        const trackLower = String(trackingName || "").trim().toLowerCase();
        const firstName = nameLower.split(" ")[0] || nameLower;
        const matchesMe = (agentName: string | null | undefined, agentUserId: string | null | undefined) => {
          if (agentUserId && String(agentUserId) === String(userId)) return true;
          const a = String(agentName || "").trim().toLowerCase();
          if (!a) return false;
          return a === nameLower || a === trackLower || a === firstName;
        };
        const { rows: wipDealRows } = await pool.query(`
          SELECT d.id, d.fee::float AS fee, d.status, d.internal_agent AS "internalAgent",
                 dfa.agent_user_id AS "agentUserId", dfa.agent_name AS "agentName",
                 dfa.fixed_amount::float AS "fixedAmount", dfa.percentage::float AS percentage,
                 COALESCE(dfa.is_bgp_house, false) AS "isBgpHouse"
            FROM crm_deals d
            LEFT JOIN deal_fee_allocations dfa ON dfa.deal_id = d.id
           WHERE d.fee IS NOT NULL AND d.status IS NOT NULL
        `);
        const byDeal = new Map<string, { fee: number; status: string; internalAgent: any; allocs: any[] }>();
        for (const r of wipDealRows) {
          if (!byDeal.has(r.id)) byDeal.set(r.id, { fee: r.fee, status: r.status, internalAgent: r.internalAgent, allocs: [] });
          if (r.agentName != null || r.agentUserId != null) {
            byDeal.get(r.id)!.allocs.push(r);
          }
        }
        let invoicedPounds = 0;
        for (const deal of byDeal.values()) {
          if (!isInvoicedStatus(deal.status)) continue;
          const realAllocs = deal.allocs.filter(a => !a.isBgpHouse);
          if (realAllocs.length > 0) {
            for (const a of realAllocs) {
              if (!matchesMe(a.agentName, a.agentUserId)) continue;
              invoicedPounds += (a.fixedAmount && a.fixedAmount !== 0)
                ? a.fixedAmount
                : Math.round(deal.fee * ((a.percentage || 0) / 100) * 100) / 100;
            }
          } else {
            const names: string[] = Array.isArray(deal.internalAgent)
              ? deal.internalAgent
              : deal.internalAgent ? [deal.internalAgent] : [];
            if (names.length === 0) continue;
            if (names.some(n => matchesMe(n, null))) invoicedPounds += deal.fee / names.length;
          }
        }
        wipInvoicedPence = Math.round(invoicedPounds * 100);
      } catch (wipErr: any) {
        console.error("[hr] commission WIP-invoiced calc failed, falling back to engine:", wipErr.message);
        wipInvoicedPence = feeDuePence;
      }
      const invoicedPence = wipInvoicedPence;

      awaitingPayment = (statement?.allDeals || [])
        .filter(d => !d.clientPaid)
        .map(d => ({
          id: d.id,
          name: d.name,
          fee: Math.round(d.billing * 100),
          status: d.status || "",
          date: d.feeDue,
          invoicedAt: null,
        }))
        .sort((a: any, b: any) => b.fee - a.fee);

      // Primary billed for the tier waterfall — toggle between fee-due (the
      // default, "earned") and Paid-only ("payable"). EXC/COM deals already
      // sit inside billings on the fee-due basis, so the incremental
      // pipeline is NEG/SOL only — counting exc/com again would double it.
      const primaryBilledPence = paidOnly ? paidPence : wipInvoicedPence;
      const wipTotal = wipByStage.neg + wipByStage.sol;
      const forecastPence = wipInvoicedPence + wipTotal;
      const commissionEarned = tierCommission(primaryBilledPence);
      const commissionForecast = tierCommission(forecastPence);

      // Tier-by-tier breakdown so the UI can show the math. Each band:
      // - threshold start / end (in pence)
      // - your billed amount that falls within the band
      // - the band's rate
      // - the commission earned from this band
      const tierBreakdown = (() => {
        const bands = [
          { name: "Below Tier 1", low: 0,   high: t1, rate: 0 },
          { name: "Tier 1",       low: t1,  high: t2, rate: 0.30 },
          { name: "Tier 2",       low: t2,  high: t3, rate: 0.40 },
          { name: "Tier 3",       low: t3,  high: Infinity, rate: 0.50 },
        ];
        return bands.map(b => {
          const inBand = Math.max(0, Math.min(primaryBilledPence, b.high === Infinity ? primaryBilledPence : b.high) - b.low);
          return {
            name: b.name,
            thresholdLow: b.low,
            thresholdHigh: b.high === Infinity ? null : b.high,
            rate: b.rate,
            billedInBand: inBand,
            commission: Math.round(inBand * b.rate),
          };
        });
      })();

      // "If you collect…" scenarios. Commission only paid when BGP gets paid,
      // so we layer the WIP stages cumulatively and recompute the tier waterfall
      // at each step. Delta = the *extra* commission unlocked by closing that
      // tier of the pipeline. Helps surveyors see exactly what's at stake.
      const scenarios = [
        {
          key: "paid",
          label: "Payable now (client has paid)",
          totalPence: paidPence,
          commission: tierCommission(paidPence),
          deltaCommission: tierCommission(paidPence),
        },
        {
          key: "feeDue",
          label: "+ awaiting client payment collects",
          totalPence: feeDuePence,
          commission: tierCommission(feeDuePence),
          deltaCommission: tierCommission(feeDuePence) - tierCommission(paidPence),
        },
        {
          key: "pipeline",
          label: "+ NEG / SOL converts",
          totalPence: forecastPence,
          commission: commissionForecast,
          deltaCommission: commissionForecast - tierCommission(feeDuePence),
        },
      ];

      res.json({
        salary,
        effectiveSalary,
        proRated: effectiveSalary !== salary,
        schemeYear: `${schemeYearStart.getFullYear()}/${String(schemeYearEnd.getFullYear()).slice(-2)}`,
        schemeYearStart: schemeYearStart.toISOString().split("T")[0],
        schemeYearEnd: schemeYearEnd.toISOString().split("T")[0],
        // Headline billed/WIP for the tier waterfall — sourced from
        // crm_deals + allocations (Deals Board / Letting Tracker). UI
        // toggles primary between Invoiced and Paid via ?paidOnly=true.
        billedPence: primaryBilledPence,
        wipTotal,
        forecastPence,
        wipByStage,
        paidOnly,
        sources: {
          // `invoiced` is the legacy key name — it now carries the fee-due
          // basis figure (earlier of exchange/completion this scheme year).
          invoiced: { billedPence: invoicedPence },
          feeDue:   { billedPence: feeDuePence },
          paid:     { billedPence: paidPence },
          wip:      { neg: wipByStage.neg, sol: wipByStage.sol, exc: wipByStage.exc, com: wipByStage.com, total: wipTotal },
        },
        t1, t2, t3,
        tierBreakdown,
        commissionEarned,
        commissionForecast,
        scenarios,
        awaitingPayment,
        billingsByYear: billingsByYear.reverse(),
        topDeals,
        xeroError,
        trackingName,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Holiday requests ──────────────────────────────────────────────────────

  app.get("/api/hr/holidays", requireAuth, async (req: any, res) => {
    await hydrateReqUser(req);
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
    await hydrateReqUser(req);
    const { startDate, endDate, notes } = req.body;
    let { daysCount } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: "startDate and endDate required" });
    }
    // Compute weekday count if the client didn't send one. Lets the form
    // submit with just two dates and have the server backfill.
    if (daysCount == null || daysCount === "" || isNaN(Number(daysCount)) || Number(daysCount) <= 0) {
      const s = new Date(startDate);
      const e = new Date(endDate);
      if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) {
        return res.status(400).json({ error: "Invalid date range" });
      }
      let n = 0;
      const cur = new Date(s);
      while (cur <= e) {
        const day = cur.getDay();
        if (day !== 0 && day !== 6) n++;
        cur.setDate(cur.getDate() + 1);
      }
      daysCount = n;
    }
    if (!req.user?.id) return res.status(401).json({ error: "Not authenticated" });
    try {
      const { rows } = await pool.query(
        `INSERT INTO holiday_requests (user_id, start_date, end_date, days_count, notes)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.user.id, startDate, endDate, Number(daysCount), notes]
      );
      res.json(rows[0]);
    } catch (e: any) {
      console.error("[hr] holiday submit failed:", e?.message);
      res.status(500).json({ error: e?.message || "Failed to save holiday request" });
    }
  });

  app.patch("/api/hr/holidays/:id", requireAuth, async (req: any, res) => {
    await hydrateReqUser(req);
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
      // Approve / reject is allowed for: admins, OR the manager of the
      // person requesting. Falls back to users.manager_id then
      // staff_profiles.manager_id — same shape as the expense approval
      // resolver so both flows stay in sync as the columns converge.
      if (status === "approved" || status === "rejected") {
        const actorId = req.user?.id;
        let canApprove = !!req.user?.isAdmin;
        if (!canApprove && actorId) {
          const { rows: mgr } = await pool.query(
            `SELECT COALESCE(u.manager_id, sp.manager_id) AS manager_id
               FROM users u
          LEFT JOIN staff_profiles sp ON sp.user_id = u.id
              WHERE u.id = $1`,
            [req_.user_id]
          );
          if (mgr[0]?.manager_id && mgr[0].manager_id === actorId) canApprove = true;
        }
        if (!canApprove) return res.status(403).json({ error: "Only admins or the requester's manager can approve / reject" });
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
    await hydrateReqUser(req);
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
    await hydrateReqUser(req);
    if (!req.user?.isAdmin) return res.status(403).json({ error: "Admin only" });
    try {
      await pool.query(`DELETE FROM hr_documents WHERE id = $1`, [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Firm-wide summary for the dashboard hero (ski target etc.) ──────────
  // Sources from crm_deals + deal_fee_allocations — the Deals Board + Letting
  // Tracker are the source of truth (mirrors Xero). Billed = sum of fees on
  // deals at status INV in the current calendar year. WIP = sum of fees on
  // deals at any pre-INV letting status (REP/AVA/NEG/SOL/EXC/COM). Sage
  // imports are no longer the source — wip_entries is preserved for history
  // only.
  app.get("/api/dashboard/firm-summary", requireAuth, async (_req, res) => {
    try {
      const targetPence = parseInt(process.env.FIRM_SKI_TARGET_PENCE || "400000000", 10); // £4m default
      const now = new Date();
      const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
      const yearStart = new Date(now.getFullYear(), 0, 1);
      const daysRemaining = Math.max(0, Math.ceil((yearEnd.getTime() - now.getTime()) / 86400000));

      const { rows } = await pool.query(`
        WITH invoiced AS (
          SELECT COALESCE(SUM(fee), 0)::numeric AS pounds,
                 COUNT(*) AS n
            FROM crm_deals
           WHERE status = 'INV'
             AND COALESCE(invoiced_at, completed_at, exchanged_at) BETWEEN $1 AND $2
        ),
        wip AS (
          SELECT COALESCE(SUM(fee), 0)::numeric AS pounds,
                 COUNT(*) AS n
            FROM crm_deals
           WHERE status IN ('REP','AVA','NEG','SOL','EXC','COM')
             AND fee IS NOT NULL AND fee > 0
        )
        SELECT
          invoiced.pounds AS billed_pounds,
          wip.pounds AS wip_pounds,
          (invoiced.n + wip.n) AS deal_count
        FROM invoiced, wip
      `, [yearStart, yearEnd]);

      const billedPence = Math.round(parseFloat(rows[0].billed_pounds) * 100);
      const wipPence = Math.round(parseFloat(rows[0].wip_pounds) * 100);
      const forecastPence = billedPence + wipPence;

      const { rows: headcountRows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM users u JOIN staff_profiles sp ON sp.user_id = u.id
         WHERE u.is_active = true AND COALESCE(sp.status, 'active') = 'active'`
      );

      res.json({
        target: { pence: targetPence, label: "Ski target", reward: "Everyone goes skiing" },
        billedPence,
        wipPence,
        forecastPence,
        pctBilled: Math.min((billedPence / targetPence) * 100, 100),
        pctForecast: Math.min((forecastPence / targetPence) * 100, 100),
        toGoPence: Math.max(targetPence - forecastPence, 0),
        daysRemaining,
        dealCount: rows[0].deal_count,
        headcount: headcountRows[0].n,
        year: now.getFullYear(),
      });
    } catch (e: any) {
      console.error("[hr] firm-summary error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Individual leaderboards for the Hunger Games strip ───────────────────
  // Computes per-person rolled-up metrics from crm_deals (split by fee
  // allocation / internal_agent count) plus expense throughput. Used by the
  // Hunger Games panel — top biller, top pipeline, most active deals,
  // top kudos receiver. All YTD scheme year (1 May → 30 Apr).
  app.get("/api/dashboard/individual-leaderboard", requireAuth, async (_req, res) => {
    try {
      const now = new Date();
      const schemeStart = now.getMonth() >= 4
        ? new Date(now.getFullYear(), 4, 1)
        : new Date(now.getFullYear() - 1, 4, 1);
      const schemeEnd = new Date(schemeStart.getFullYear() + 1, 3, 30);
      const weekAgo = new Date(now.getTime() - 7 * 86400000);

      // Per-agent share of each deal: explicit allocation OR even split.
      // Prefer internal_agent_ids (resolved through users) so a rename or
      // departure doesn't leave commission credited to a stale name.
      // Falls back to internal_agent names for any row whose IDs column
      // is still NULL.
      const dealsRes = await pool.query(
        `WITH deal_agents AS (
           SELECT d.id, d.status, d.fee,
                  COALESCE(d.completed_at, d.exchanged_at, d.target_date, d.instructed_at) AS dt,
                  COALESCE(
                    (SELECT array_agg(DISTINCT u.name)
                       FROM unnest(d.internal_agent_ids) AS aid
                       JOIN users u ON u.id = aid),
                    d.internal_agent,
                    ARRAY[]::text[]
                  ) AS agent_names
             FROM crm_deals d
            WHERE d.fee IS NOT NULL AND d.fee > 0
         ),
         deal_share AS (
           SELECT a.agent_lower AS agent,
                  d.id, d.status, d.fee, d.dt,
                  CASE
                    WHEN dfa.percentage IS NOT NULL THEN d.fee * dfa.percentage / 100.0
                    WHEN dfa.fixed_amount IS NOT NULL THEN dfa.fixed_amount
                    ELSE d.fee::numeric / GREATEST(COALESCE(array_length(d.agent_names, 1), 1), 1)
                  END AS portion
             FROM deal_agents d
            CROSS JOIN LATERAL (
              SELECT DISTINCT LOWER(ag) AS agent_lower FROM unnest(d.agent_names) ag
            ) a
            LEFT JOIN deal_fee_allocations dfa
                   ON dfa.deal_id = d.id
                  AND (
                    LOWER(dfa.agent_name) = a.agent_lower
                    OR EXISTS (
                      SELECT 1 FROM users u
                       WHERE u.id = dfa.agent_user_id
                         AND LOWER(u.name) = a.agent_lower
                    )
                  )
         )
         SELECT agent, status, dt, portion FROM deal_share
          WHERE dt BETWEEN $1 AND $2`,
        [schemeStart.toISOString(), schemeEnd.toISOString()]
      );

      // Build per-agent rollups. We can only attribute to people we recognise
      // by name in the users table; resolve once up-front.
      const usersRes = await pool.query(
        `SELECT u.id, u.name, u.email, u.profile_pic_url, u.team, sp.title, sp.xero_tracking_name
         FROM users u LEFT JOIN staff_profiles sp ON sp.user_id = u.id
         WHERE u.is_active = true AND sp.id IS NOT NULL`
      );
      const nameToUser = new Map<string, any>();
      for (const u of usersRes.rows) {
        nameToUser.set(u.name.toLowerCase(), u);
        if (u.xero_tracking_name) nameToUser.set(u.xero_tracking_name.toLowerCase(), u);
      }

      const agentStats = new Map<string, { user: any; billed: number; pipeline: number; activeCount: number; recentClose: number }>();
      for (const row of dealsRes.rows) {
        const u = nameToUser.get(row.agent);
        if (!u) continue;
        const cur = agentStats.get(u.id) || { user: u, billed: 0, pipeline: 0, activeCount: 0, recentClose: 0 };
        const pence = Math.round((parseFloat(row.portion) || 0) * 100);
        if (row.status === "INV" || row.status === "COM") cur.billed += pence;
        if (["NEG", "SOL", "EXC", "COM"].includes(row.status)) {
          cur.pipeline += pence;
          cur.activeCount += 1;
        }
        if ((row.status === "COM" || row.status === "INV") && row.dt && new Date(row.dt) >= weekAgo) {
          cur.recentClose += pence;
        }
        agentStats.set(u.id, cur);
      }

      // Kudos / awards this week as a "morale" leaderboard.
      const awardsRes = await pool.query(
        `SELECT user_id, COUNT(*)::int AS n
         FROM staff_awards WHERE created_at >= $1 GROUP BY user_id`,
        [weekAgo]
      );
      const kudosByUser = new Map<string, number>(awardsRes.rows.map((r: any) => [r.user_id, r.n]));

      const list = Array.from(agentStats.values()).map(s => ({
        userId: s.user.id,
        name: s.user.name,
        team: s.user.team,
        title: s.user.title,
        profilePicUrl: s.user.profile_pic_url,
        billedPence: s.billed,
        pipelinePence: s.pipeline,
        activeDeals: s.activeCount,
        closedThisWeekPence: s.recentClose,
        kudosThisWeek: kudosByUser.get(s.user.id) || 0,
      }));

      // Always include people without deals so kudos board still works for them.
      for (const u of usersRes.rows) {
        if (!agentStats.has(u.id)) {
          list.push({
            userId: u.id,
            name: u.name,
            team: u.team,
            title: u.title,
            profilePicUrl: u.profile_pic_url,
            billedPence: 0,
            pipelinePence: 0,
            activeDeals: 0,
            closedThisWeekPence: 0,
            kudosThisWeek: kudosByUser.get(u.id) || 0,
          });
        }
      }

      const top = (key: keyof typeof list[0]) => [...list]
        .sort((a, b) => Number(b[key]) - Number(a[key]))
        .filter(x => Number(x[key]) > 0)
        .slice(0, 5);

      res.json({
        topBiller: top("billedPence"),
        topPipeline: top("pipelinePence"),
        topActive: top("activeDeals"),
        topClosedThisWeek: top("closedThisWeekPence"),
        topKudos: top("kudosThisWeek"),
      });
    } catch (e: any) {
      console.error("[hr] individual-leaderboard error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Team summary roll-up for the dashboard organigram ───────────────────
  // For each team: head (highest-ranked board/mgt member by name), headcount,
  // billed YTD (Xero), pipeline £ (crm_deals share), and the team's top 2
  // active deals. Used as the rich card content on the new dashboard landing.
  app.get("/api/hr/team-summary", requireAuth, async (_req, res) => {
    try {
      const TEAM_ORDER = ["Office / Corporate", "Investment", "Lease Advisory", "National Leasing", "Development", "Tenant Rep", "London Retail", "London F&B"];

      const { rows: staff } = await pool.query(`
        SELECT u.id, u.name, u.email, u.team, u.profile_pic_url,
               sp.title, sp.board_member, sp.management_team, sp.manager_id,
               sp.wfh_days
        FROM users u
        LEFT JOIN staff_profiles sp ON sp.user_id = u.id
        WHERE u.is_active = true AND sp.id IS NOT NULL
      `);

      // Aggregate WIP / pipeline from crm_deals per team. Open = not invoiced/
      // archived/withdrawn. Status COM (completed) is also WIP — not yet billed.
      const { rows: dealRows } = await pool.query(`
        SELECT d.id, d.name, d.status, d.fee, d.internal_agent,
               COALESCE(d.completed_at, d.exchanged_at, d.target_date, d.instructed_at) AS dt
        FROM crm_deals d
        WHERE COALESCE(d.status, '') NOT IN ('INV','ARCH','WIT')
          AND d.fee IS NOT NULL AND d.fee > 0
      `);

      // Build a name → team map so we can attribute deals via internal_agent
      // even when crm_deals.team[] is null/stale.
      const personTeam = new Map<string, string>();
      for (const s of staff) {
        if (s.name && s.team) personTeam.set(s.name.toLowerCase(), s.team);
      }

      // Group deals by inferred team. A deal counts toward a team if any of
      // its internal_agents are on that team. To avoid double-counting, divide
      // the fee by (#agents) and attribute that share to each agent's team.
      const teamWip: Record<string, number> = {};
      const teamDeals: Record<string, Array<{ id: string; name: string; fee: number; status: string; date: string | null }>> = {};
      for (const d of dealRows) {
        const agents: string[] = Array.isArray(d.internal_agent) ? d.internal_agent : [];
        if (agents.length === 0) continue;
        const sharePence = Math.round((parseFloat(d.fee) || 0) * 100 / agents.length);
        const teamsTouched = new Set<string>();
        for (const ag of agents) {
          const t = personTeam.get(String(ag).toLowerCase());
          if (!t) continue;
          teamWip[t] = (teamWip[t] || 0) + sharePence;
          teamsTouched.add(t);
        }
        // Track the deal under each team it touches (for top-deal display)
        for (const t of teamsTouched) {
          (teamDeals[t] ??= []).push({
            id: d.id,
            name: d.name,
            fee: Math.round((parseFloat(d.fee) || 0) * 100),
            status: d.status,
            date: d.dt ? new Date(d.dt).toISOString().slice(0, 10) : null,
          });
        }
      }

      // Build per-team summaries. We want every team that has members to
      // show up — TEAM_ORDER drives display order for known teams; any
      // extra team values seen in staff records get appended alphabetically
      // so London Retail / London F&B / new teams don't silently fall off.
      const presentTeams = new Set<string>();
      let unassignedCount = 0;
      for (const s of staff) {
        if (s.team && String(s.team).trim()) presentTeams.add(String(s.team).trim());
        else unassignedCount++;
      }
      const extraTeams = [...presentTeams].filter(t => !TEAM_ORDER.includes(t)).sort();
      const allTeams = [...TEAM_ORDER.filter(t => presentTeams.has(t)), ...extraTeams];
      if (unassignedCount > 0) allTeams.push("Unassigned");

      const summaries = allTeams.map(team => {
        const members = team === "Unassigned"
          ? staff.filter((s: any) => !s.team || !String(s.team).trim())
          : staff.filter((s: any) => s.team === team);
        if (members.length === 0) return null;
        // Head selection (in priority order): explicit "Head ..." title,
        // management_team flag, board_member flag, "Director" in title,
        // then first member alphabetically. The title check makes the
        // pick stable even when flags drift (e.g. Pete heads Lease
        // Advisory by virtue of his "Head – Lease Consultancy" title).
        const head = members.find((m: any) => /^head\b|\bhead\s/i.test(m.title || ""))
                  || members.find((m: any) => m.management_team)
                  || members.find((m: any) => m.board_member)
                  || members.find((m: any) => /director/i.test(m.title || ""))
                  || members[0];
        const topDeals = (teamDeals[team] || [])
          .sort((a, b) => b.fee - a.fee)
          .slice(0, 2);
        return {
          team,
          headcount: members.length,
          head: head ? { id: head.id, name: head.name, title: head.title, profilePicUrl: head.profile_pic_url } : null,
          memberIds: members.map((m: any) => m.id),
          // Full member rows so the TeamCard can render reports directly,
          // without needing /api/hr/staff (which sometimes returns empty for
          // non-admins and left every card showing only the head).
          members: members.map((m: any) => ({
            id: m.id,
            name: m.name,
            title: m.title,
            profilePicUrl: m.profile_pic_url,
            wfh_days: m.wfh_days,
          })),
          pipelinePence: teamWip[team] || 0,
          topDeals,
        };
      }).filter(Boolean);

      res.json({ teams: summaries });
    } catch (e: any) {
      console.error("[hr] team-summary error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Policy documents (proxied from SharePoint, viewable in-app) ───────────
  // Each policy maps to a folder under HR/Policies & Procedures. On first
  // request we enumerate the folder via Graph and pick the newest PDF/DOCX,
  // caching driveId/itemId in policy_files. The /file endpoint streams the
  // actual bytes so PDFs render inline in the app and DOCX downloads, never
  // bouncing the user out to SharePoint.

  const POLICY_DEFS: Array<{ id: string; name: string; category: string; folder: string }> = [
    { id: "aml",           name: "AML Policy",                    category: "Compliance",      folder: "AML" },
    { id: "anti-bribery",  name: "Anti-Bribery Policy",            category: "Compliance",      folder: "Anti bribery" },
    { id: "commission",    name: "Commission Scheme",              category: "Compensation",    folder: "Commission scheme" },
    { id: "complaints",    name: "Complaints Handling Procedure",  category: "Operations",      folder: "Complaints handling procedure" },
    { id: "equality",      name: "Equality Policy",                category: "HR",              folder: "Equality" },
    { id: "expenses",      name: "Expenses Policy",                category: "Finance",         folder: "Expenses" },
    { id: "fire-safety",   name: "Fire Safety Policy",             category: "Health & Safety", folder: "Fire safety" },
    { id: "living-wage",   name: "Living Wage Policy",             category: "HR",              folder: "Living Wage" },
    { id: "maternity",     name: "Maternity Policy",               category: "HR",              folder: "Maternity Policy" },
    { id: "safety",        name: "Safety at Work",                 category: "Health & Safety", folder: "Safety at work" },
  ];

  // Resolve a policy folder to its newest doc. Uses the same MS token machinery
  // as the photo sync. Cached in `policy_files` so we don't enumerate on every
  // request — admins can hit ?refresh=1 to re-resolve.
  async function resolvePolicyFile(
    token: string,
    folder: string
  ): Promise<{ driveId: string; itemId: string; name: string; mimeType: string } | null> {
    // Search the SharePoint drive for files inside the policy folder.
    const SITE = "brucegillinghampollardlimited.sharepoint.com:/sites/BGP:";
    const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${SITE}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!siteRes.ok) return null;
    const site = await siteRes.json();
    const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!drivesRes.ok) return null;
    const drives = (await drivesRes.json()).value || [];
    const docDrive = drives.find((d: any) => d.name === "Documents") || drives[0];
    if (!docDrive) return null;

    const path = `HR/Policies %26 Procedures/${encodeURIComponent(folder)}`;
    const listRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${docDrive.id}/root:/${path}:/children?$select=id,name,file,lastModifiedDateTime`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!listRes.ok) return null;
    const items = (await listRes.json()).value || [];
    const docs = items.filter((i: any) => i.file && /\.(pdf|docx?|xlsx?)$/i.test(i.name));
    if (docs.length === 0) return null;
    docs.sort((a: any, b: any) => (b.lastModifiedDateTime || "").localeCompare(a.lastModifiedDateTime || ""));
    return {
      driveId: docDrive.id,
      itemId: docs[0].id,
      name: docs[0].name,
      mimeType: docs[0].file?.mimeType || "application/octet-stream",
    };
  }

  app.get("/api/hr/policies", requireAuth, async (req: any, res) => {
    try {
      // Ensure cache table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS policy_files (
          id TEXT PRIMARY KEY,
          drive_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          file_name TEXT,
          mime_type TEXT,
          updated_at TIMESTAMP DEFAULT now()
        )
      `);

      const refresh = req.query.refresh === "1";
      const cacheRows = await pool.query("SELECT id, drive_id, item_id, file_name, mime_type FROM policy_files");
      const cache = new Map<string, any>(cacheRows.rows.map((r: any) => [r.id, r]));

      // Resolve missing entries (or refresh all). Token is optional — without
      // it we still return the policy list with no inline preview.
      const token = await getValidMsToken(req);
      if (token && (refresh || cacheRows.rows.length < POLICY_DEFS.length)) {
        for (const p of POLICY_DEFS) {
          if (!refresh && cache.has(p.id)) continue;
          const resolved = await resolvePolicyFile(token, p.folder);
          if (!resolved) continue;
          await pool.query(
            `INSERT INTO policy_files (id, drive_id, item_id, file_name, mime_type, updated_at)
             VALUES ($1, $2, $3, $4, $5, now())
             ON CONFLICT (id) DO UPDATE SET drive_id = EXCLUDED.drive_id, item_id = EXCLUDED.item_id,
               file_name = EXCLUDED.file_name, mime_type = EXCLUDED.mime_type, updated_at = now()`,
            [p.id, resolved.driveId, resolved.itemId, resolved.name, resolved.mimeType]
          );
          cache.set(p.id, { id: p.id, drive_id: resolved.driveId, item_id: resolved.itemId, file_name: resolved.name, mime_type: resolved.mimeType });
        }
      }

      res.json(POLICY_DEFS.map(p => {
        const c = cache.get(p.id);
        return {
          id: p.id,
          name: p.name,
          category: p.category,
          fileName: c?.file_name || null,
          mimeType: c?.mime_type || null,
          inlineUrl: c ? `/api/hr/policies/${p.id}/file` : null,
        };
      }));
    } catch (e: any) {
      console.error("[hr] policies error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Stream the policy file from SharePoint with the requesting user's MS token
  // (or org fallback). Sets Content-Disposition: inline so PDFs render in an
  // <iframe> straight from the app rather than redirecting out.
  app.get("/api/hr/policies/:id/file", requireAuth, async (req: any, res) => {
    try {
      const r = await pool.query("SELECT drive_id, item_id, file_name, mime_type FROM policy_files WHERE id = $1", [req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ error: "Policy not found — admin needs to refresh" });
      const { drive_id, item_id, file_name, mime_type } = r.rows[0];

      const token = await getValidMsToken(req);
      if (!token) return res.status(401).json({ error: "Connect Microsoft 365 first" });

      const fileRes = await fetch(`https://graph.microsoft.com/v1.0/drives/${drive_id}/items/${item_id}/content`, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "follow",
      });
      if (!fileRes.ok) return res.status(502).json({ error: `Graph returned ${fileRes.status}` });

      res.setHeader("Content-Type", mime_type || fileRes.headers.get("content-type") || "application/octet-stream");
      res.setHeader("Content-Disposition", contentDispositionFor(file_name || "policy", "inline"));
      const buf = Buffer.from(await fileRes.arrayBuffer());
      res.send(buf);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Render a policy as styled HTML for inline reading. PDF policies route the
  // user to /file (browsers render natively). DOCX/DOC/RTF run through mammoth
  // and the resulting HTML is wrapped in BGP styling and cached on policy_files
  // so the second hit is instant. Cache busts on ?refresh=1 or after the
  // SharePoint copy is re-resolved (lastmod check).
  app.get("/api/hr/policies/:id/inline", requireAuth, async (req: any, res) => {
    try {
      const refresh = req.query.refresh === "1";
      const r = await pool.query(
        "SELECT id, drive_id, item_id, file_name, mime_type, rendered_html, rendered_at FROM policy_files WHERE id = $1",
        [req.params.id]
      );
      if (!r.rows[0]) return res.status(404).json({ error: "Policy not found" });
      const { drive_id, item_id, file_name, mime_type, rendered_html } = r.rows[0];

      // PDFs already render in the iframe directly — no need to convert.
      if (/pdf/i.test(mime_type || "") || /\.pdf$/i.test(file_name || "")) {
        return res.status(415).json({ error: "PDF — use /file with iframe" });
      }

      // Use cached HTML if present
      if (!refresh && rendered_html) {
        return res.json({ html: rendered_html, fileName: file_name, cached: true });
      }

      const token = await getValidMsToken(req);
      if (!token) return res.status(401).json({ error: "Connect Microsoft 365 first" });
      const fileRes = await fetch(`https://graph.microsoft.com/v1.0/drives/${drive_id}/items/${item_id}/content`, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "follow",
      });
      if (!fileRes.ok) return res.status(502).json({ error: `Graph returned ${fileRes.status}` });
      const buf = Buffer.from(await fileRes.arrayBuffer());

      // Convert via mammoth — Word's XML structure → semantic HTML
      const result = await mammoth.convertToHtml({ buffer: buf }, {
        styleMap: [
          "p[style-name='Title'] => h1.policy-title",
          "p[style-name='Subtitle'] => p.policy-subtitle",
          "p[style-name='Heading 1'] => h2",
          "p[style-name='Heading 2'] => h3",
          "p[style-name='Heading 3'] => h4",
          "p[style-name='Quote'] => blockquote",
          "p[style-name='Intense Quote'] => blockquote.intense",
        ],
      });
      const html = result.value || "";

      await pool.query(
        "UPDATE policy_files SET rendered_html = $2, rendered_at = now() WHERE id = $1",
        [req.params.id, html]
      );

      res.json({ html, fileName: file_name, cached: false, warnings: result.messages });
    } catch (e: any) {
      console.error("[hr] policy inline error:", e.message);
      res.status(500).json({ error: e.message });
    }
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
      // Mirror manager_id to users.manager_id for downstream routing.
      if (managerId !== undefined) {
        await pool.query("UPDATE users SET manager_id = $1 WHERE id = $2", [managerId || null, userId]);
      }
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
      // Reassign direct reports back to NULL so downstream routing
      // (expense approval, holiday approval) falls through to the
      // shared fallback inbox rather than pointing at the leaver.
      // Mirrored across both manager_id stores.
      const { rowCount: orphanCount } = await pool.query(
        "UPDATE staff_profiles SET manager_id = NULL, updated_at = now() WHERE manager_id = $1",
        [req.params.userId]
      );
      await pool.query("UPDATE users SET manager_id = NULL WHERE manager_id = $1", [req.params.userId]);
      res.json({ ok: true, orphanedReports: orphanCount || 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Admin: seed the May 2026 BGP org chart (reporting lines + flags) ──────
  // Idempotent. Matches existing users by normalised name (lowercase, apostrophes
  // and whitespace stripped) plus a small alias table for known short forms.
  // Auto-creates users we don't recognise so the chart is whole on first run.
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
      ["Jonny Palmer", "Graduate", "Investment", "Nick Halley", false, false],
      ["Pete Wood", "Head – Lease Consultancy / Management", "Lease Advisory", "Woody Bruce", false, true],
      ["Tom Cater", "Associate Director", "Lease Advisory", "Pete Wood", false, false],
      ["Victoria Broadhead", "Head – National / Management", "National Leasing", "Woody Bruce", false, true],
      ["Lucy Gardiner", "Director – National Team", "National Leasing", "Victoria Broadhead", false, false],
      ["Luke Donohoe", "Graduate Surveyor – National Team", "National Leasing", "Lucy Gardiner", false, false],
      ["Tracey Pollard", "Head – Development / Re-purposing", "Development", "Woody Bruce", false, true],
      ["Emily Dumbell", "Director – Leasing", "Development", "Tracey Pollard", false, false],
      ["Alex Todd", "Senior Surveyor – Development", "Development", "Emily Dumbell", false, false],
      ["Libby Evans", "Graduate Surveyor – Development", "Development", "Alex Todd", false, false],
      ["Harry Elliot", "Director – Tenant Rep", "Tenant Rep", "Woody Bruce", false, true],
      ["Charlotte Roberts", "Head – London Retail", "London Retail", "Woody Bruce", true, true],
      ["Lizzie Knights", "Director – London Retail", "London Retail", "Charlotte Roberts", false, false],
      ["Lucy Cope", "Associate Director – London Retail", "London Retail", "Lizzie Knights", false, false],
      ["Emily Cann", "Graduate Surveyor – London Retail", "London Retail", "Lucy Cope", false, false],
      ["Daisy Driscoll", "Surveyor – London Retail", "London Retail", "Charlotte Roberts", false, false],
      ["Rupert Bentley-Smith", "Head – London F&B", "London F&B", "Woody Bruce", true, true],
      ["Evie North", "Associate Director – London F&B / Tenant Rep", "London F&B", "Rupert Bentley-Smith", false, false],
      ["Will Penfold", "Surveyor – London F&B", "London F&B", "Rupert Bentley-Smith", false, false],
      ["Carly Cunliffe", "Graduate Surveyor – London F&B / Tenant Rep", "London F&B", "Rupert Bentley-Smith", false, false],
      ["Emily Mitchell", "Marketing Lead", "Office / Corporate", "Charlotte Roberts", false, false],
    ];

    // Known short ↔ long pairs so DB rows like "Peter Wood" or "Harry Elliott"
    // line up with roster entries "Pete Wood" / "Harry Elliot".
    const ALIASES: Array<[string, string]> = [
      ["pete wood", "peter wood"],
      ["harry elliot", "harry elliott"],
      ["jonny palmer", "johnny palmer"],
      ["emily dumbell", "emily dumbbell"],
      ["will penfold", "william penfold"],
    ];

    const norm = (s: string) =>
      s.toLowerCase().replace(/['']/g, "").replace(/\s+/g, " ").trim();

    // Build an index of every existing user under each of its possible keys
    // (canonical name + any alias forms) so a single lookup catches both.
    const existing = await pool.query("SELECT id, name FROM users WHERE is_active = true");
    const userIndex = new Map<string, string>();
    for (const row of existing.rows) {
      const key = norm(row.name);
      userIndex.set(key, row.id);
      for (const [a, b] of ALIASES) {
        if (key === a) userIndex.set(b, row.id);
        if (key === b) userIndex.set(a, row.id);
      }
    }

    const bcrypt = await import("bcrypt");
    const placeholder = await bcrypt.default.hash(`bgp-placeholder-${Date.now()}`, 10);

    const nameToId = new Map<string, string>();
    let matched = 0, created = 0;
    const createdNames: string[] = [];

    // Pass 1: resolve every roster name. Auto-create when missing so the chart
    // is complete on first run; admin can edit emails / titles later.
    for (const [name, role, team] of ROSTER) {
      const key = norm(name);
      let userId = userIndex.get(key);
      if (!userId) {
        for (const [a, b] of ALIASES) {
          if (key === a && userIndex.has(b)) { userId = userIndex.get(b); break; }
          if (key === b && userIndex.has(a)) { userId = userIndex.get(a); break; }
        }
      }
      if (userId) {
        nameToId.set(name, userId);
        matched++;
      } else {
        const username = norm(name).replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
        const r = await pool.query(
          `INSERT INTO users (username, password, name, role, team, is_admin, is_active)
           VALUES ($1, $2, $3, $4, $5, false, true)
           ON CONFLICT (username) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, team = EXCLUDED.team, is_active = true
           RETURNING id`,
          [username, placeholder, name, role, team]
        );
        const newId = r.rows[0].id;
        nameToId.set(name, newId);
        userIndex.set(key, newId);
        created++;
        createdNames.push(name);
      }
    }

    // Pass 2: write title/team/manager/board/mgt to staff_profiles + users.
    let updated = 0;
    for (const [name, role, team, reportsTo, board, mgt] of ROSTER) {
      const userId = nameToId.get(name);
      if (!userId) continue;
      const managerId = reportsTo ? nameToId.get(reportsTo) ?? null : null;
      await pool.query("UPDATE users SET role = $2, team = $3, manager_id = $4 WHERE id = $1", [userId, role, team, managerId]);
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

    res.json({ updated, matched, created, createdNames });
  });

  // ── Active deals for a person — "what I'm working on" feed ───────────────
  // Self-or-admin view of a staffer's open CRM deals: anything not invoiced,
  // archived, or withdrawn. Returns the same per-agent fee share calculation
  // as /commission so figures reconcile. Capped at 20.
  app.get("/api/hr/staff/:userId/active-deals", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const profileRes = await pool.query(
        `SELECT u.name, sp.xero_tracking_name FROM users u
         LEFT JOIN staff_profiles sp ON sp.user_id = u.id
         WHERE u.id = $1`,
        [req.params.userId]
      );
      if (!profileRes.rows[0]) return res.status(404).json({ error: "User not found" });
      const trackingName = profileRes.rows[0].xero_tracking_name || profileRes.rows[0].name;

      const { rows } = await pool.query(
        `SELECT d.id, d.name, d.status, d.fee, d.deal_type,
                COALESCE(d.completed_at, d.exchanged_at, d.target_date, d.instructed_at) AS dt,
                CASE
                  WHEN dfa.percentage   IS NOT NULL THEN d.fee * dfa.percentage / 100.0
                  WHEN dfa.fixed_amount IS NOT NULL THEN dfa.fixed_amount
                  ELSE d.fee::numeric / GREATEST(COALESCE(array_length(d.internal_agent, 1), 1), 1)
                END AS my_portion
         FROM crm_deals d
         LEFT JOIN deal_fee_allocations dfa
           ON dfa.deal_id = d.id
          AND (
            dfa.agent_user_id = $2
            OR (dfa.agent_user_id IS NULL AND LOWER(dfa.agent_name) = LOWER($1))
          )
         WHERE (
                 -- prefer the new ID array; fall back to name array
                 $2 = ANY(COALESCE(d.internal_agent_ids, ARRAY[]::varchar[]))
              OR EXISTS (SELECT 1 FROM unnest(COALESCE(d.internal_agent, ARRAY[]::text[])) a
                         WHERE LOWER(a) = LOWER($1))
              OR EXISTS (SELECT 1 FROM deal_fee_allocations a2
                         WHERE a2.deal_id = d.id
                           AND (a2.agent_user_id = $2 OR LOWER(a2.agent_name) = LOWER($1)))
             )
           AND COALESCE(d.status, '') NOT IN ('INV','ARCH','WIT')
         ORDER BY
           CASE d.status WHEN 'COM' THEN 0 WHEN 'EXC' THEN 1 WHEN 'NEG' THEN 2 WHEN 'SOL' THEN 2 ELSE 3 END,
           d.fee DESC NULLS LAST
         LIMIT 20`,
        [trackingName, req.params.userId]
      );

      res.json(rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        dealType: r.deal_type,
        fee: Math.round((parseFloat(r.my_portion) || 0) * 100),
        date: r.dt ? new Date(r.dt).toISOString().slice(0, 10) : null,
      })));
    } catch (e: any) {
      console.error("[hr] active-deals error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Admin: Xero Payroll employee link ──────────────────────────────────────
  // Reconciliation view — every active BGP person with their stored Xero
  // employee link (if any), plus the Xero employees that aren't linked to
  // anyone yet. Drives the "Xero Payroll" panel on the HR page so HR can see
  // at a glance who's linked and resolve the stragglers.
  app.get("/api/hr/xero/link-status", requireAdmin, async (_req, res) => {
    try {
      const usersRes = await pool.query(
        `SELECT u.id, u.name, u.email,
                sp.xero_employee_id, sp.xero_employee_name, sp.xero_linked_at
           FROM users u
           LEFT JOIN staff_profiles sp ON sp.user_id = u.id
          WHERE u.is_active = true
          ORDER BY u.name`
      );
      const people = usersRes.rows.map((u: any) => ({
        userId: u.id,
        name: u.name,
        email: u.email,
        xeroEmployeeId: u.xero_employee_id || null,
        xeroEmployeeName: u.xero_employee_name || null,
        xeroLinkedAt: u.xero_linked_at || null,
        linked: !!u.xero_employee_id,
      }));

      const { getSystemXeroSession } = await import("./xero-system-session");
      const session = await getSystemXeroSession();

      let xeroEmployees: XeroEmployee[] | null = null;
      let xeroError: string | null = null;
      if (!session) {
        xeroError = "Xero isn't connected — connect it in admin before linking.";
      } else {
        try {
          xeroEmployees = await fetchXeroPayrollEmployees(session);
        } catch (e: any) {
          xeroError = e.message;
        }
      }

      // Xero employees with no BGP person pointing at them.
      const linkedIds = new Set(people.filter(p => p.xeroEmployeeId).map(p => p.xeroEmployeeId));
      const xeroUnmatched = (xeroEmployees || []).filter(e => !linkedIds.has(e.id));

      res.json({
        connected: !!session,
        xeroError,
        people,
        xeroUnmatched,
        counts: {
          people: people.length,
          linked: people.filter(p => p.linked).length,
          bgpUnlinked: people.filter(p => !p.linked).length,
          xeroTotal: xeroEmployees?.length ?? null,
          xeroUnmatched: xeroEmployees ? xeroUnmatched.length : null,
        },
      });
    } catch (e: any) {
      console.error("[hr] xero link-status error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Auto-link: pull all Xero employees, match each to a BGP person by email
  // first (most reliable) then normalised full name, and store the employee
  // ID on their staff_profile. Only fills blanks — never overwrites an
  // existing manual link. Returns a report of what it did.
  app.post("/api/hr/xero/link-employees", requireAdmin, async (_req, res) => {
    try {
      const { getSystemXeroSession } = await import("./xero-system-session");
      const session = await getSystemXeroSession();
      if (!session) return res.status(401).json({ error: "Connect Xero first" });

      const employees = await fetchXeroPayrollEmployees(session);

      const usersRes = await pool.query(
        `SELECT u.id, u.name, u.email, sp.xero_employee_id
           FROM users u
           LEFT JOIN staff_profiles sp ON sp.user_id = u.id
          WHERE u.is_active = true`
      );
      const emailToUser = new Map<string, any>();
      const nameToUser = new Map<string, any>();
      for (const u of usersRes.rows) {
        if (u.email) emailToUser.set(u.email.toLowerCase(), u);
        if (u.name) nameToUser.set(normaliseNameKey(u.name), u);
      }

      // Don't relink a Xero employee that's already claimed by someone.
      const alreadyLinked = new Set(
        usersRes.rows.filter((u: any) => u.xero_employee_id).map((u: any) => u.xero_employee_id)
      );

      let linked = 0, alreadyOk = 0;
      const unmatchedEmployees: string[] = [];
      const newlyLinked: Array<{ name: string; employee: string; via: string }> = [];

      for (const emp of employees) {
        if (alreadyLinked.has(emp.id)) { alreadyOk++; continue; }

        let user: any = null;
        let via = "";
        if (emp.email && emailToUser.has(emp.email.toLowerCase())) {
          user = emailToUser.get(emp.email.toLowerCase());
          via = "email";
        } else if (nameToUser.has(normaliseNameKey(emp.fullName))) {
          user = nameToUser.get(normaliseNameKey(emp.fullName));
          via = "name";
        }

        if (!user) { unmatchedEmployees.push(emp.fullName || emp.id); continue; }
        if (user.xero_employee_id) { alreadyOk++; continue; }

        // Upsert — a profile row may not exist yet for this user.
        await pool.query(
          `INSERT INTO staff_profiles (user_id, xero_employee_id, xero_employee_name, xero_linked_at)
             VALUES ($1, $2, $3, now())
           ON CONFLICT (user_id) DO UPDATE
             SET xero_employee_id = EXCLUDED.xero_employee_id,
                 xero_employee_name = EXCLUDED.xero_employee_name,
                 xero_linked_at = now()`,
          [user.id, emp.id, emp.fullName || null]
        );
        alreadyLinked.add(emp.id);
        linked++;
        newlyLinked.push({ name: user.name, employee: emp.fullName, via });
      }

      res.json({
        linked,
        alreadyLinked: alreadyOk,
        unmatched: unmatchedEmployees.length,
        unmatchedEmployees,
        newlyLinked,
        xeroTotal: employees.length,
      });
    } catch (e: any) {
      console.error("[hr] xero link-employees error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Manual link / unlink — HR resolves a straggler by hand. Pass
  // xeroEmployeeId + xeroEmployeeName to set, or null to clear the link.
  app.post("/api/hr/xero/link-employee", requireAdmin, async (req, res) => {
    try {
      const { userId, xeroEmployeeId, xeroEmployeeName } = req.body || {};
      if (!userId) return res.status(400).json({ error: "userId required" });

      if (xeroEmployeeId) {
        // Guard against double-claiming one Xero employee.
        const clash = await pool.query(
          `SELECT user_id FROM staff_profiles WHERE xero_employee_id = $1 AND user_id <> $2 LIMIT 1`,
          [xeroEmployeeId, userId]
        );
        if (clash.rows.length > 0) {
          return res.status(409).json({ error: "That Xero employee is already linked to someone else" });
        }
        await pool.query(
          `INSERT INTO staff_profiles (user_id, xero_employee_id, xero_employee_name, xero_linked_at)
             VALUES ($1, $2, $3, now())
           ON CONFLICT (user_id) DO UPDATE
             SET xero_employee_id = EXCLUDED.xero_employee_id,
                 xero_employee_name = EXCLUDED.xero_employee_name,
                 xero_linked_at = now()`,
          [userId, xeroEmployeeId, xeroEmployeeName || null]
        );
      } else {
        await pool.query(
          `UPDATE staff_profiles
              SET xero_employee_id = NULL, xero_employee_name = NULL, xero_linked_at = NULL
            WHERE user_id = $1`,
          [userId]
        );
      }
      res.json({ success: true });
    } catch (e: any) {
      console.error("[hr] xero link-employee error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Admin: sync payslips from Xero Payroll ─────────────────────────────────
  // Pulls every PayslipID from the most recent N pay runs, downloads the PDF
  // for each, matches the employee email to a BGP user, and stores the PDF as
  // an uploaded_files row with kind='payslip'. The Commission tab's Payslips
  // card already reads from there so they appear automatically.
  // Requires payroll.payslip + payroll.employees scopes — admin needs to
  // disconnect/reconnect Xero once after this lands.
  app.post("/api/hr/payslips/sync-from-xero", requireAdmin, async (_req, res) => {
    try {
      const { getSystemXeroSession } = await import("./xero-system-session");
      const session = await getSystemXeroSession();
      if (!session) return res.status(401).json({ error: "Connect Xero first" });

      // Build lookup maps. Stored Xero employee ID is the most reliable
      // (set via the link-employees step); email + normalised name are
      // fallbacks for anyone not linked yet.
      const usersRes = await pool.query(
        `SELECT u.id, u.name, u.email, sp.xero_employee_id
           FROM users u
           LEFT JOIN staff_profiles sp ON sp.user_id = u.id
          WHERE u.is_active = true`
      );
      const emailToId = new Map<string, string>();
      const nameToId = new Map<string, string>();
      const xeroEmpToId = new Map<string, string>();
      for (const u of usersRes.rows) {
        if (u.email) emailToId.set(u.email.toLowerCase(), u.id);
        if (u.name) nameToId.set(normaliseNameKey(u.name), u.id);
        if (u.xero_employee_id) xeroEmpToId.set(u.xero_employee_id, u.id);
      }

      // Fetch the 6 most-recent pay runs and their payslips.
      const runs = await xeroPayrollApi(session, "/PayRuns?order=PayRunPeriodEndDate%20DESC");
      const recentRuns = (runs.PayRuns || []).slice(0, 6);

      let imported = 0, unmatched = 0, skipped = 0;
      const unmatchedNames: string[] = [];

      for (const run of recentRuns) {
        const detail = await xeroPayrollApi(session, `/PayRuns/${run.PayRunID}`);
        const slips = detail.PayRuns?.[0]?.Payslips || [];
        for (const slip of slips) {
          const emp = `${slip.FirstName || ""} ${slip.LastName || ""}`.trim();
          const empKey = normaliseNameKey(emp);
          // Stored link wins; fall back to normalised name, then email.
          let userId = (slip.EmployeeID && xeroEmpToId.get(slip.EmployeeID)) || nameToId.get(empKey) || null;

          // Try email if name didn't match — needs employee detail
          if (!userId && slip.EmployeeID) {
            try {
              const empDetail = await xeroPayrollApi(session, `/Employees/${slip.EmployeeID}`);
              const email = empDetail.Employees?.[0]?.Email;
              if (email) userId = emailToId.get(email.toLowerCase()) || null;
            } catch { /* ignore single employee failure */ }
          }

          if (!userId) { unmatched++; if (!unmatchedNames.includes(emp)) unmatchedNames.push(emp); continue; }

          const periodEnd = run.PayRunPeriodEndDate ? new Date(run.PayRunPeriodEndDate).toISOString().slice(0, 10) : "unknown";
          const filename = `Payslip ${periodEnd} ${emp}.pdf`;

          // Skip if we already have this exact payslip for this user
          const existing = await pool.query(
            `SELECT id FROM uploaded_files WHERE owner_user_id = $1 AND kind = 'payslip' AND name = $2`,
            [userId, filename]
          );
          if (existing.rows.length > 0) { skipped++; continue; }

          // Pull the PDF
          const pdf = await xeroPayrollApi(session, `/Payslips/${slip.PayslipID}`, { binary: true });
          const meta = await pool.query(
            `INSERT INTO uploaded_files (owner_user_id, kind, name, mime_type, size_bytes, notes, visibility)
             VALUES ($1, 'payslip', $2, 'application/pdf', $3, $4, 'admin-self') RETURNING id`,
            [userId, filename, pdf.length, `Imported from Xero pay run ${run.PayRunID}`]
          );
          await pool.query("INSERT INTO file_blobs (file_id, data) VALUES ($1, $2)", [meta.rows[0].id, pdf]);
          imported++;
        }
      }

      res.json({ imported, skipped, unmatched, unmatchedNames, runsScanned: recentRuns.length });
    } catch (e: any) {
      console.error("[hr] xero payslip sync error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── 👶 Parental leave (maternity / paternity / shared / adoption) ────────
  // Self can read own; admin can read all. Admin creates / updates the
  // record (HR responsibility); user can log KIT days against their own.

  app.get("/api/hr/parental-leave/:userId", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) return res.status(403).json({ error: "Forbidden" });
    try {
      const { rows } = await pool.query(
        `SELECT * FROM staff_parental_leave WHERE user_id = $1 ORDER BY start_date DESC`,
        [req.params.userId]
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Firm-wide upcoming/active for the dashboard "What's on" + admin scheduling
  app.get("/api/hr/parental-leave", requireAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT pl.*, u.name AS user_name, u.profile_pic_url, u.team
         FROM staff_parental_leave pl
         JOIN users u ON u.id = pl.user_id
         WHERE pl.status IN ('planned', 'on_leave', 'extended')
            OR pl.actual_return_date IS NULL
            OR pl.actual_return_date >= CURRENT_DATE - INTERVAL '90 days'
         ORDER BY pl.start_date ASC`
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/parental-leave", requireAdmin, async (req: any, res) => {
    const { userId, kind, startDate, plannedEndDate, kitDaysAllowance, notes } = req.body || {};
    if (!userId || !kind || !startDate) return res.status(400).json({ error: "userId, kind, startDate required" });
    try {
      const r = await pool.query(
        `INSERT INTO staff_parental_leave (user_id, kind, start_date, planned_end_date, kit_days_allowance, status, notes)
         VALUES ($1, $2, $3, $4, $5, 'planned', $6) RETURNING *`,
        [userId, kind, startDate, plannedEndDate || null, kitDaysAllowance ?? 10, notes || null]
      );
      res.json(r.rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/hr/parental-leave/:id", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    try {
      const owner = await pool.query("SELECT user_id FROM staff_parental_leave WHERE id = $1", [req.params.id]);
      if (!owner.rows[0]) return res.status(404).json({ error: "Not found" });
      const isOwn = actor.userId === owner.rows[0].user_id;
      // Self can update KIT days + notes; admin can update everything.
      const adminFields = ["kind", "start_date", "planned_end_date", "actual_return_date", "kit_days_allowance", "status"];
      const selfFields = ["kit_days_used", "notes"];
      const fields = actor.isAdmin ? [...adminFields, ...selfFields] : (isOwn ? selfFields : []);
      if (fields.length === 0) return res.status(403).json({ error: "Forbidden" });

      const sets: string[] = [];
      const params: any[] = [req.params.id];
      for (const f of fields) {
        const camel = f.replace(/_(.)/g, (_, c) => c.toUpperCase());
        if (req.body[camel] !== undefined || req.body[f] !== undefined) {
          params.push(req.body[camel] ?? req.body[f]);
          sets.push(`${f} = $${params.length}`);
        }
      }
      if (sets.length === 0) return res.json({ ok: true });
      await pool.query(`UPDATE staff_parental_leave SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/hr/parental-leave/:id", requireAdmin, async (req: any, res) => {
    try {
      await pool.query("DELETE FROM staff_parental_leave WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Admin: pull profile photos from Microsoft 365 ──────────────────────────
  // Iterates active staff, fetches each one's photo from Graph using the
  // caller's MS session (or org fallback in getValidMsToken), and stores
  // the JPEG as a data URL on users.profile_pic_url. Cheap, ~5-10KB per face.
  // Skips users with no email or with photo already set unless ?force=1.
  app.post("/api/hr/sync-photos", requireAdmin, async (req: any, res) => {
    const force = req.query.force === "1";
    const token = await getValidMsToken(req as any);
    if (!token) return res.status(401).json({ error: "Connect Microsoft 365 first" });

    try {
      const { rows } = await pool.query(
        `SELECT id, name, email, profile_pic_url FROM users
         WHERE is_active = true AND email IS NOT NULL AND email <> ''`
      );

      let updated = 0, skipped = 0, missing = 0;
      const failed: string[] = [];

      for (const u of rows) {
        if (!force && u.profile_pic_url) { skipped++; continue; }
        try {
          const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(u.email)}/photo/$value`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (r.status === 404) { missing++; continue; }
          if (!r.ok) { failed.push(`${u.name} (${r.status})`); continue; }
          const buf = Buffer.from(await r.arrayBuffer());
          const dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
          await pool.query("UPDATE users SET profile_pic_url = $2 WHERE id = $1", [u.id, dataUrl]);
          updated++;
        } catch (e: any) {
          failed.push(`${u.name} (${e.message})`);
        }
      }

      res.json({ updated, skipped, missing, failed, total: rows.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 💳 Expenses analysis (per-person breakdown) ──────────────────────────
  // Pulls Stripe-issued card spend for one staffer + breaks it down by
  // category (Xero account), top merchants, and top deals/clients (via
  // expenses.related_deal_id → crm_deals → landlord/tenant). Used by the
  // ExpensesAnalysisCard on each profile.
  app.get("/api/hr/staff/:userId/expenses-summary", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      // Find the user's cardholder row.
      const ch = await pool.query("SELECT id FROM stripe_cardholders WHERE user_id = $1 LIMIT 1", [req.params.userId]);
      if (!ch.rows[0]) {
        return res.json({ hasCard: false, totalPence: 0, mtdPence: 0, ytdPence: 0, byCategory: [], topMerchants: [], topClients: [], recent: [] });
      }
      const cardholderId = ch.rows[0].id;
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const yearStart = new Date(now.getFullYear(), 0, 1);

      // Aggregations in parallel.
      const [byCat, topMerch, topClients, recent, totals] = await Promise.all([
        pool.query(
          `SELECT COALESCE(category, 'Uncategorised') AS category,
                  COUNT(*)::int AS count,
                  SUM(amount_pence)::bigint AS pence
           FROM expenses
           WHERE cardholder_id = $1 AND transaction_date >= $2
             AND COALESCE(is_personal, false) = false
           GROUP BY 1
           ORDER BY pence DESC NULLS LAST
           LIMIT 12`,
          [cardholderId, yearStart]
        ),
        pool.query(
          `SELECT COALESCE(NULLIF(merchant, ''), 'Unknown merchant') AS merchant,
                  COUNT(*)::int AS count,
                  SUM(amount_pence)::bigint AS pence
           FROM expenses
           WHERE cardholder_id = $1 AND transaction_date >= $2
             AND COALESCE(is_personal, false) = false
           GROUP BY 1
           ORDER BY pence DESC NULLS LAST
           LIMIT 8`,
          [cardholderId, yearStart]
        ),
        // Client = the landlord on the related deal (or the deal name if no
        // landlord). Reveals "I spent £x entertaining Landsec deals".
        pool.query(
          `SELECT
             COALESCE(landlord.name, deal.name, 'Unattributed') AS client,
             d.deal_id,
             COUNT(*)::int AS count,
             SUM(e.amount_pence)::bigint AS pence,
             BOOL_OR(COALESCE(e.is_client_rechargeable, false)) AS rechargeable
           FROM expenses e
           LEFT JOIN crm_deals d ON d.id = e.related_deal_id
           LEFT JOIN crm_companies landlord ON landlord.id = d.landlord_id
           LEFT JOIN crm_deals deal ON deal.id = e.related_deal_id
           WHERE e.cardholder_id = $1 AND e.transaction_date >= $2
             AND COALESCE(e.is_personal, false) = false
           GROUP BY client, d.deal_id
           ORDER BY pence DESC NULLS LAST
           LIMIT 8`,
          [cardholderId, yearStart]
        ),
        pool.query(
          `SELECT id, merchant, amount_pence, transaction_date, category, business_purpose, status, related_deal_id
           FROM expenses
           WHERE cardholder_id = $1 AND COALESCE(is_personal, false) = false
           ORDER BY transaction_date DESC NULLS LAST LIMIT 10`,
          [cardholderId]
        ),
        pool.query(
          `SELECT
             COALESCE(SUM(amount_pence) FILTER (WHERE transaction_date >= $2), 0)::bigint AS mtd,
             COALESCE(SUM(amount_pence) FILTER (WHERE transaction_date >= $3), 0)::bigint AS ytd,
             COALESCE(SUM(amount_pence), 0)::bigint AS total,
             COUNT(*) FILTER (WHERE transaction_date >= $3)::int AS ytd_count,
             COUNT(*) FILTER (WHERE COALESCE(is_client_rechargeable, false) = true AND transaction_date >= $3)::int AS rechargeable_count,
             COALESCE(SUM(amount_pence) FILTER (WHERE COALESCE(is_client_rechargeable, false) = true AND transaction_date >= $3), 0)::bigint AS rechargeable_pence
           FROM expenses
           WHERE cardholder_id = $1 AND COALESCE(is_personal, false) = false`,
          [cardholderId, monthStart, yearStart]
        ),
      ]);

      res.json({
        hasCard: true,
        mtdPence: parseInt(totals.rows[0].mtd, 10),
        ytdPence: parseInt(totals.rows[0].ytd, 10),
        totalPence: parseInt(totals.rows[0].total, 10),
        ytdCount: totals.rows[0].ytd_count,
        rechargeableCount: totals.rows[0].rechargeable_count,
        rechargeablePence: parseInt(totals.rows[0].rechargeable_pence, 10),
        byCategory: byCat.rows.map((r: any) => ({ category: r.category, count: r.count, pence: parseInt(r.pence, 10) })),
        topMerchants: topMerch.rows.map((r: any) => ({ merchant: r.merchant, count: r.count, pence: parseInt(r.pence, 10) })),
        topClients: topClients.rows.map((r: any) => ({ client: r.client, dealId: r.deal_id, count: r.count, pence: parseInt(r.pence, 10), rechargeable: r.rechargeable })),
        recent: recent.rows.map((r: any) => ({
          id: r.id,
          merchant: r.merchant,
          amountPence: r.amount_pence,
          transactionDate: r.transaction_date,
          category: r.category,
          businessPurpose: r.business_purpose,
          status: r.status,
          relatedDealId: r.related_deal_id,
        })),
      });
    } catch (e: any) {
      console.error("[hr] expenses-summary error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── 🎁 Watch House awards — recognition feed ──────────────────────────────
  // GET returns the recent timeline (everyone sees), POST is admin-only,
  // DELETE lets admin retract a mistake. Non-admins can self-issue 'kudos'
  // (kind = 'kudos') for peer shout-outs — those don't bestow perks but they
  // do show up on the board and on the recipient's profile.

  app.get("/api/hr/awards", requireAuth, async (req: any, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit || "20"), 10) || 20, 100);
      const userId = req.query.userId as string | undefined;
      const params: any[] = [];
      let where = "1=1";
      if (userId) { params.push(userId); where = `a.user_id = $${params.length}`; }
      params.push(limit);
      const { rows } = await pool.query(
        `SELECT a.id, a.user_id, a.issued_by_user_id, a.kind, a.emoji, a.reason, a.created_at,
                u.name AS user_name, u.profile_pic_url AS user_pic,
                ib.name AS issued_by_name
         FROM staff_awards a
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN users ib ON ib.id = a.issued_by_user_id
         WHERE ${where}
         ORDER BY a.created_at DESC
         LIMIT $${params.length}`,
        params
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/awards", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.userId) return res.status(401).json({ error: "Not authenticated" });
    const { userId, kind, emoji, reason } = req.body || {};
    if (!userId || !kind) return res.status(400).json({ error: "userId and kind required" });
    // Non-admins can only issue peer 'kudos' (no real perks).
    if (!actor.isAdmin && kind !== "kudos") {
      return res.status(403).json({ error: "Only admins can issue perk awards. Use kind='kudos' for peer shout-outs." });
    }
    if (userId === actor.userId && kind === "kudos") {
      return res.status(400).json({ error: "Can't kudos yourself — get someone else to recognise you" });
    }
    try {
      const r = await pool.query(
        `INSERT INTO staff_awards (user_id, issued_by_user_id, kind, emoji, reason)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
        [userId, actor.userId, kind, emoji || null, reason || null]
      );
      res.json({ id: r.rows[0].id, createdAt: r.rows[0].created_at });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/hr/awards/:id", requireAdmin, async (req: any, res) => {
    try {
      await pool.query("DELETE FROM staff_awards WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Auto-detect milestones and create awards. Idempotent — uses a per-event
  // 'detection_key' style by checking for an existing matching award before
  // inserting. Run on demand by admin or via a daily cron.
  // Detects: birthday today · work-iversary today · first deal closed ·
  // £100k YTD · £250k YTD · first instruction won this month.
  app.post("/api/hr/awards/auto-detect", requireAdmin, async (_req, res) => {
    const created: Array<{ user: string; kind: string; reason: string }> = [];
    try {
      const today = new Date();
      const todayStr = today.toISOString().slice(5, 10); // MM-DD

      // 1. Birthdays today
      const { rows: bdays } = await pool.query(`
        SELECT u.id, u.name FROM users u
        JOIN staff_profiles sp ON sp.user_id = u.id
        WHERE u.is_active = true AND sp.dob IS NOT NULL
          AND TO_CHAR(sp.dob::date, 'MM-DD') = $1
      `, [todayStr]);
      for (const u of bdays) {
        const exists = await pool.query(
          `SELECT 1 FROM staff_awards WHERE user_id = $1 AND kind = 'auto-birthday' AND created_at::date = CURRENT_DATE`,
          [u.id]
        );
        if (exists.rows.length === 0) {
          await pool.query(
            `INSERT INTO staff_awards (user_id, kind, emoji, reason) VALUES ($1, 'auto-birthday', '🎂', $2)`,
            [u.id, `Happy birthday ${u.name.split(" ")[0]}!`]
          );
          created.push({ user: u.name, kind: "auto-birthday", reason: "Happy birthday" });
        }
      }

      // 2. Work-iversaries today
      const { rows: anniv } = await pool.query(`
        SELECT u.id, u.name, sp.start_date,
               EXTRACT(YEAR FROM AGE(sp.start_date::date))::int AS years
        FROM users u JOIN staff_profiles sp ON sp.user_id = u.id
        WHERE u.is_active = true AND sp.start_date IS NOT NULL
          AND TO_CHAR(sp.start_date::date, 'MM-DD') = $1
          AND sp.start_date::date < CURRENT_DATE
      `, [todayStr]);
      for (const u of anniv) {
        const exists = await pool.query(
          `SELECT 1 FROM staff_awards WHERE user_id = $1 AND kind = 'auto-anniversary' AND created_at::date = CURRENT_DATE`,
          [u.id]
        );
        if (exists.rows.length === 0 && u.years > 0) {
          await pool.query(
            `INSERT INTO staff_awards (user_id, kind, emoji, reason) VALUES ($1, 'auto-anniversary', '🎉', $2)`,
            [u.id, `${u.years} year${u.years === 1 ? "" : "s"} at BGP`]
          );
          created.push({ user: u.name, kind: "auto-anniversary", reason: `${u.years} years` });
        }
      }

      // 3. £100k / £250k / £500k YTD billing milestones
      const yearStart = new Date(today.getFullYear(), 0, 1);
      const { rows: agentBills } = await pool.query(
        `WITH agent_bills AS (
           SELECT a.agent_lower AS agent,
                  SUM(CASE
                    WHEN dfa.percentage IS NOT NULL THEN d.fee * dfa.percentage / 100.0
                    WHEN dfa.fixed_amount IS NOT NULL THEN dfa.fixed_amount
                    ELSE d.fee::numeric / GREATEST(COALESCE(array_length(d.internal_agent, 1), 1), 1)
                  END) AS total
           FROM crm_deals d
           CROSS JOIN LATERAL (
             SELECT DISTINCT LOWER(ag) AS agent_lower FROM unnest(COALESCE(d.internal_agent, ARRAY[]::text[])) ag
           ) a
           LEFT JOIN deal_fee_allocations dfa
                  ON dfa.deal_id = d.id
                 AND (
                   LOWER(dfa.agent_name) = a.agent_lower
                   OR EXISTS (
                     SELECT 1 FROM users u
                      WHERE u.id = dfa.agent_user_id
                        AND LOWER(u.name) = a.agent_lower
                   )
                 )
           WHERE d.status IN ('INV','COM') AND COALESCE(d.completed_at, d.invoiced_at) >= $1
           GROUP BY a.agent_lower
         )
         SELECT u.id, u.name, ab.total::numeric AS total
         FROM agent_bills ab
         JOIN users u ON LOWER(u.name) = ab.agent
         WHERE u.is_active = true`,
        [yearStart]
      );
      for (const a of agentBills) {
        const totalPence = Math.round(parseFloat(a.total) * 100);
        const milestones: Array<[number, string, string]> = [
          [10000000, "milestone-100k", "💯"],
          [25000000, "milestone-250k", "🚀"],
          [50000000, "milestone-500k", "🏆"],
        ];
        for (const [thresh, kind, emoji] of milestones) {
          if (totalPence >= thresh) {
            const exists = await pool.query(
              `SELECT 1 FROM staff_awards WHERE user_id = $1 AND kind = $2 AND EXTRACT(YEAR FROM created_at) = $3`,
              [a.id, kind, today.getFullYear()]
            );
            if (exists.rows.length === 0) {
              const label = thresh === 10000000 ? "£100k" : thresh === 25000000 ? "£250k" : "£500k";
              await pool.query(
                `INSERT INTO staff_awards (user_id, kind, emoji, reason) VALUES ($1, $2, $3, $4)`,
                [a.id, kind, emoji, `${label} billed YTD ${today.getFullYear()}`]
              );
              created.push({ user: a.name, kind, reason: `${label} milestone` });
            }
          }
        }
      }

      res.json({ created });
    } catch (e: any) {
      console.error("[hr] auto-detect awards error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── 📊 Marketing AI trend extractor (Emmy's quarterly trends ask) ────────
  app.get("/api/marketing/trends", requireAuth, async (req: any, res) => {
    const team = req.query.team as string | undefined;
    const quarterAgo = new Date(Date.now() - 90 * 86400000);
    try {
      const params: any[] = [quarterAgo];
      let where = "WHERE COALESCE(d.completed_at, d.exchanged_at, d.target_date, d.instructed_at) >= $1";
      if (team) {
        params.push(team);
        where += ` AND $${params.length} = ANY(d.team)`;
      }
      const { rows: deals } = await pool.query(
        `SELECT d.name, d.status, d.fee, d.deal_type, d.team,
                COALESCE(landlord.name, '') AS landlord,
                COALESCE(tenant.name, '') AS tenant,
                d.area_basis, d.total_area_sqft
         FROM crm_deals d
         LEFT JOIN crm_companies landlord ON landlord.id = d.landlord_id
         LEFT JOIN crm_companies tenant ON tenant.id = d.tenant_id
         ${where}
         ORDER BY COALESCE(d.completed_at, d.exchanged_at) DESC NULLS LAST
         LIMIT 80`,
        params
      );

      let trends: any = null;
      try {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const dealsList = deals.map((d: any) => `- ${d.name} | ${d.status} | £${(parseFloat(d.fee) || 0).toLocaleString()} | tenant: ${d.tenant || "?"} | landlord: ${d.landlord || "?"} | type: ${d.deal_type || "?"} | team: ${(d.team || []).join(",")}`).join("\n");
        const msg = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1500,
          messages: [{
            role: "user",
            content: `You're advising BGP's marketing lead Emmy. Look at the past quarter of deal activity${team ? ` for ${team}` : ""} and identify themes she can use for opinion leader content. Return ONLY JSON:

${dealsList || "(no deals)"}

{
  "themes": [
    { "title": "short headline", "summary": "1-2 sentence rationale", "evidence": ["deal name 1", "deal name 2"], "spokesperson": "best BGP person to comment", "outlets": ["Property Week", "EG"] }
  ],
  "opinion_pieces": [
    { "title": "punchy article title", "angle": "what's the contrarian / fresh take", "drafted_by": "BGP person" }
  ],
  "event_topics": [
    { "title": "panel topic for BGP roundtable", "audience": "who'd attend", "questions": ["what to ask"] }
  ]
}

Return ONLY valid JSON.`,
          }],
        });
        const txt = msg.content?.[0]?.type === "text" ? msg.content[0].text : "";
        trends = JSON.parse(txt.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
      } catch (e: any) {
        trends = { themes: [], opinion_pieces: [], event_topics: [], note: `AI unavailable: ${e.message}` };
      }
      res.json({ trends, dealCount: deals.length, periodDays: 90 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Draft a LinkedIn post for a given deal — for Emmy's "promote when deals
  // are announced" workflow. Pulls the deal context, generates 2 variants.
  app.post("/api/marketing/draft-post", requireAuth, async (req: any, res) => {
    const { dealId, kind = "linkedin" } = req.body || {};
    if (!dealId) return res.status(400).json({ error: "dealId required" });
    try {
      const { rows } = await pool.query(
        `SELECT d.name, d.deal_type, d.fee, d.status, d.total_area_sqft, d.area_basis,
                landlord.name AS landlord_name,
                tenant.name AS tenant_name,
                d.internal_agent
         FROM crm_deals d
         LEFT JOIN crm_companies landlord ON landlord.id = d.landlord_id
         LEFT JOIN crm_companies tenant ON tenant.id = d.tenant_id
         WHERE d.id = $1`,
        [dealId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Deal not found" });
      const d = rows[0];

      let drafts: any = null;
      try {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const msg = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 800,
          messages: [{
            role: "user",
            content: `Draft 3 ${kind === "linkedin" ? "LinkedIn" : "social"} post variants announcing this BGP deal completion. Use UK property language. Tag opportunities for client/landlord/tenant. Always close with the BGP team members.

Deal: ${d.name}
Type: ${d.deal_type || "unknown"}
Status: ${d.status}
Tenant: ${d.tenant_name || "?"}
Landlord: ${d.landlord_name || "?"}
Size: ${d.total_area_sqft ? `${Math.round(d.total_area_sqft)} sq.ft (${d.area_basis || "NIA"})` : "?"}
Internal team: ${(d.internal_agent || []).join(", ") || "?"}

Return JSON:
{
  "variants": [
    { "tone": "concise wins post", "text": "..." },
    { "tone": "story / narrative", "text": "..." },
    { "tone": "thought leader take", "text": "..." }
  ],
  "hashtags": ["#CommercialProperty", "..."],
  "tag_suggestions": ["@brand handles to consider"]
}

Return ONLY JSON.`,
          }],
        });
        const txt = msg.content?.[0]?.type === "text" ? msg.content[0].text : "";
        drafts = JSON.parse(txt.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
      } catch (e: any) {
        drafts = { variants: [], hashtags: [], tag_suggestions: [], note: `AI unavailable: ${e.message}` };
      }
      res.json({ deal: { id: dealId, name: d.name }, drafts });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 📱 Kit / contract tracker — phones, laptops, "when's my upgrade" ─────

  app.get("/api/hr/kit/:userId", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const { rows } = await pool.query(
        `SELECT id, kind, device, contract_start, contract_end, provider, monthly_cost_pence, notes
         FROM staff_kit WHERE user_id = $1 ORDER BY contract_end ASC NULLS LAST`,
        [req.params.userId]
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/kit/:userId", requireAdmin, async (req: any, res) => {
    const { kind, device, contractStart, contractEnd, provider, monthlyCostPence, notes } = req.body || {};
    if (!kind) return res.status(400).json({ error: "kind required" });
    try {
      const r = await pool.query(
        `INSERT INTO staff_kit (user_id, kind, device, contract_start, contract_end, provider, monthly_cost_pence, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [req.params.userId, kind, device || null, contractStart || null, contractEnd || null, provider || null, monthlyCostPence || null, notes || null]
      );
      res.json({ id: r.rows[0].id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/hr/kit/:id", requireAdmin, async (req: any, res) => {
    const { kind, device, contractStart, contractEnd, provider, monthlyCostPence, notes } = req.body || {};
    try {
      await pool.query(
        `UPDATE staff_kit SET
           kind = COALESCE($2, kind),
           device = COALESCE($3, device),
           contract_start = COALESCE($4, contract_start),
           contract_end = COALESCE($5, contract_end),
           provider = COALESCE($6, provider),
           monthly_cost_pence = COALESCE($7, monthly_cost_pence),
           notes = COALESCE($8, notes),
           updated_at = now()
         WHERE id = $1`,
        [req.params.id, kind || null, device || null, contractStart || null, contractEnd || null, provider || null, monthlyCostPence || null, notes || null]
      );
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/hr/kit/:id", requireAdmin, async (req: any, res) => {
    try {
      await pool.query("DELETE FROM staff_kit WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 🎁 Benefits catalogue ────────────────────────────────────────────────

  // Seed default benefit cards on first read so the page is never empty.
  const DEFAULT_BENEFITS = [
    { slug: "cycle-to-work", name: "Cycle to Work", category: "Wellbeing", icon: "bike", description: "Salary-sacrifice up to £3,000 for a bike + safety kit. Save 32–47% on tax/NI.", eligibility: "All permanent employees after 3 months", enrolment_url: "https://www.cyclescheme.co.uk", contact: "Wendy McKenzie" },
    { slug: "workplace-nursery", name: "Workplace Nursery Scheme", category: "Family", icon: "baby", description: "Salary-sacrifice for nursery fees — saves up to 47% on childcare costs.", eligibility: "Parents of children under 5 in OFSTED-registered nursery", enrolment_url: "", contact: "Wendy McKenzie" },
    { slug: "private-healthcare", name: "Private Healthcare", category: "Health", icon: "heart", description: "Private medical insurance (Bupa) — free for employee, family upgrade available.", eligibility: "All permanent employees on completion of probation", enrolment_url: "", contact: "Wendy McKenzie" },
    { slug: "life-insurance", name: "Life Insurance", category: "Health", icon: "shield", description: "4× salary death-in-service cover, paid by BGP.", eligibility: "All permanent employees", enrolment_url: "", contact: "Wendy McKenzie" },
    { slug: "pension", name: "Pension (Royal London)", category: "Finance", icon: "piggy-bank", description: "5% employee, 3% employer (auto-enrolment minimum), salary-sacrifice option.", eligibility: "All employees age 22+ earning over £10k", enrolment_url: "https://online.royallondon.com", contact: "Wendy McKenzie" },
    { slug: "phone-contract", name: "Mobile Phone Contract", category: "Kit", icon: "smartphone", description: "BGP-funded mobile contract for client-facing roles. Upgrade every 24 months.", eligibility: "Surveyor and above", enrolment_url: "", contact: "Office Manager" },
    { slug: "season-ticket-loan", name: "Season Ticket Loan", category: "Travel", icon: "train", description: "Interest-free loan up to £5,000 for an annual rail/tube season ticket.", eligibility: "All permanent employees after probation", enrolment_url: "", contact: "Wendy McKenzie" },
    { slug: "eap", name: "Employee Assistance Programme", category: "Wellbeing", icon: "heart-handshake", description: "24/7 confidential counselling, legal & financial advice. Free for employees + family.", eligibility: "All employees", enrolment_url: "", contact: "Charlotte Roberts" },
    { slug: "professional-fees", name: "Professional Fees", category: "Career", icon: "graduation-cap", description: "RICS, ICAEW and other professional body subscriptions paid by BGP.", eligibility: "All members on a recognised pathway", enrolment_url: "", contact: "Line manager" },
    { slug: "ski-trip", name: "Annual Ski Trip", category: "Social", icon: "mountain", description: "Bill £4m firm-wide and we all go skiing. Tracked live on the dashboard.", eligibility: "Whole firm — collective target", enrolment_url: "", contact: "Woody" },
  ];

  app.get("/api/hr/benefits", requireAuth, async (req: any, res) => {
    try {
      const exists = await pool.query("SELECT COUNT(*)::int AS n FROM benefits");
      if (exists.rows[0].n === 0) {
        for (let i = 0; i < DEFAULT_BENEFITS.length; i++) {
          const b = DEFAULT_BENEFITS[i];
          await pool.query(
            `INSERT INTO benefits (slug, name, category, description, eligibility, enrolment_url, contact, icon, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (slug) DO NOTHING`,
            [b.slug, b.name, b.category, b.description, b.eligibility, b.enrolment_url, b.contact, b.icon, i]
          );
        }
      }
      const me = req.session?.userId || (req as any).tokenUserId;
      const { rows } = await pool.query(`
        SELECT b.*,
               EXISTS (SELECT 1 FROM staff_benefit_enrolments e WHERE e.user_id = $1 AND e.benefit_slug = b.slug) AS enrolled
        FROM benefits b
        WHERE b.is_active = true
        ORDER BY b.sort_order, b.name
      `, [me || null]);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/benefits/:slug/enrol", requireAuth, async (req: any, res) => {
    const userId = req.session?.userId || (req as any).tokenUserId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      await pool.query(
        `INSERT INTO staff_benefit_enrolments (user_id, benefit_slug, status)
         VALUES ($1, $2, 'enrolled') ON CONFLICT (user_id, benefit_slug) DO NOTHING`,
        [userId, req.params.slug]
      );
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/hr/benefits/:slug/enrol", requireAuth, async (req: any, res) => {
    const userId = req.session?.userId || (req as any).tokenUserId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      await pool.query(
        `DELETE FROM staff_benefit_enrolments WHERE user_id = $1 AND benefit_slug = $2`,
        [userId, req.params.slug]
      );
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/hr/benefits/:slug", requireAdmin, async (req: any, res) => {
    // Whitelist of editable benefit fields including the policy/renewal block
    // — admin uses these to track Aviva Health, life insurance, dental etc.
    const fields = [
      "name", "category", "description", "eligibility", "enrolment_url", "contact", "is_active",
      "policy_number", "policy_holder", "renewal_date", "annual_premium_pence", "group_size",
      "provider_portal_url", "member_login_instructions", "broker_contact",
    ];
    const sets: string[] = [];
    const params: any[] = [req.params.slug];
    for (const f of fields) {
      const camel = f.replace(/_(.)/g, (_, c) => c.toUpperCase());
      if (req.body[camel] !== undefined || req.body[f] !== undefined) {
        params.push(req.body[camel] ?? req.body[f]);
        sets.push(`${f} = $${params.length}`);
      }
    }
    if (sets.length === 0) return res.json({ ok: true });
    try {
      await pool.query(`UPDATE benefits SET ${sets.join(", ")}, updated_at = now() WHERE slug = $1`, params);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 🔑 Member credentials — what each staffer needs to log into a benefit
  // provider's portal (Royal London pension number, Aviva DigiCare member ID,
  // EAP code, etc). Stored per (user, benefit_slug); admin or self can edit.
  app.get("/api/hr/benefit-credentials/:userId", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) return res.status(403).json({ error: "Forbidden" });
    try {
      const { rows } = await pool.query(
        `SELECT benefit_slug, member_number, member_email, notes, updated_at
         FROM staff_benefit_credentials WHERE user_id = $1`,
        [req.params.userId]
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/hr/benefit-credentials/:userId/:slug", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) return res.status(403).json({ error: "Forbidden" });
    const { memberNumber, memberEmail, notes } = req.body || {};
    try {
      await pool.query(
        `INSERT INTO staff_benefit_credentials (user_id, benefit_slug, member_number, member_email, notes)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, benefit_slug) DO UPDATE SET
           member_number = EXCLUDED.member_number,
           member_email = EXCLUDED.member_email,
           notes = EXCLUDED.notes,
           updated_at = now()`,
        [req.params.userId, req.params.slug, memberNumber || null, memberEmail || null, notes || null]
      );
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Generate a one-off renewal task for whoever's the broker contact, 60 days
  // before each benefit's renewal_date. Idempotent via the
  // renewal_task_created_for_year column so a refresh doesn't spam tasks.
  // Called from the daily cron alongside Brucey Bonuses.
  app.post("/api/hr/benefits/sync-renewal-tasks", requireAdmin, async (_req, res) => {
    try {
      const created = await runBenefitRenewalSweep();
      res.json({ created });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 🎓 Career roadmap — RICS competencies + BGP levels ───────────────────

  // Static RICS Commercial Property Practice competencies (Mandatory + Tech).
  // Per-user level (0-3) lives in staff_competencies; this endpoint joins the
  // catalogue with the user's progress. Level 0 = not started.
  const RICS_COMPETENCIES = {
    mandatory: [
      "Ethics, Rules of Conduct & Professionalism",
      "Client Care",
      "Communication & Negotiation",
      "Health & Safety",
      "Accounting Principles & Procedures",
      "Business Planning",
      "Conflict Avoidance, Management & Dispute Resolution",
      "Data Management",
      "Sustainability",
      "Teamworking",
    ],
    technical: [
      "Inspection",
      "Measurement of Land & Property",
      "Valuation",
      "Leasing & Letting",
      "Landlord & Tenant",
      "Purchase & Sale",
      "Property Records / Information Systems",
      "Capital Taxation",
      "Investment",
      "Development Appraisals",
      "Smart Cities & Intelligent Buildings",
    ],
  };

  // BGP-specific career levels — derived from review patterns we've seen.
  const BGP_LEVELS = [
    { level: "Graduate", criteria: ["RICS pathway started", "Mentor assigned", "Shadow viewings", "Assist on instructions"] },
    { level: "Surveyor",          criteria: ["APC complete or imminent", "Lead small instructions", "1× salary billings", "Independent client meetings"] },
    { level: "Senior Surveyor",   criteria: ["3× salary billings", "Lead major instructions", "Mentor a graduate", "Cross-team referrals"] },
    { level: "Associate Director", criteria: ["3-4× salary billings sustained", "Win new client mandates", "Lead a sub-team", "Industry profile (PR, panels)"] },
    { level: "Director",           criteria: ["4× salary billings sustained", "Own a key account", "Set team strategy", "Recruit & develop juniors"] },
    { level: "Executive Director", criteria: ["Co-head a team or specialism", "Drive firm-wide strategy", "Major BD wins", "Board contribution"] },
  ];

  app.get("/api/hr/career-roadmap/:userId", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const { rows } = await pool.query(
        `SELECT competency, level, evidence, reviewed_at FROM staff_competencies WHERE user_id = $1`,
        [req.params.userId]
      );
      const progress = new Map(rows.map((r: any) => [r.competency, r]));
      const decorate = (list: string[]) => list.map(c => ({
        competency: c,
        level: progress.get(c)?.level || 0,
        evidence: progress.get(c)?.evidence || null,
        reviewedAt: progress.get(c)?.reviewed_at || null,
      }));
      res.json({
        rics: { mandatory: decorate(RICS_COMPETENCIES.mandatory), technical: decorate(RICS_COMPETENCIES.technical) },
        bgpLevels: BGP_LEVELS,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/hr/career-roadmap/:userId/:competency", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    const isSelf = actor.userId === req.params.userId;
    // Admin or self can update — manager-only sign-off is added later.
    if (!actor.isAdmin && !isSelf) return res.status(403).json({ error: "Forbidden" });
    const { level, evidence } = req.body || {};
    const lvl = Math.max(0, Math.min(3, parseInt(String(level), 10) || 0));
    try {
      await pool.query(
        `INSERT INTO staff_competencies (user_id, competency, level, evidence, reviewed_at, reviewed_by_user_id, updated_at)
         VALUES ($1, $2, $3, $4, now(), $5, now())
         ON CONFLICT (user_id, competency) DO UPDATE SET
           level = EXCLUDED.level,
           evidence = COALESCE(EXCLUDED.evidence, staff_competencies.evidence),
           reviewed_at = now(),
           reviewed_by_user_id = EXCLUDED.reviewed_by_user_id,
           updated_at = now()`,
        [req.params.userId, decodeURIComponent(req.params.competency), lvl, evidence || null, actor.userId]
      );
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 📚 CPD log ─────────────────────────────────────────────────────────────
  // RICS APC candidates need 96 hrs over 24 months; qualified MRICS need 20 hrs
  // every calendar year (10 formal + 10 informal). The aggregates endpoint
  // computes both views and lets the UI pick the right target for the user.

  app.get("/api/hr/cpd/:userId", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const { rows } = await pool.query(
        `SELECT id, user_id, entry_date, hours, kind, activity, competency, created_at
         FROM cpd_entries WHERE user_id = $1 ORDER BY entry_date DESC, created_at DESC`,
        [req.params.userId]
      );
      const nowYear = new Date().getFullYear();
      const twelveMonthsAgo = new Date(); twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      let total = 0, formal = 0, informal = 0, calendarYear = 0, rolling12 = 0;
      for (const r of rows) {
        const h = Number(r.hours) || 0;
        total += h;
        if (r.kind === "formal") formal += h; else informal += h;
        const d = new Date(r.entry_date);
        if (d.getFullYear() === nowYear) calendarYear += h;
        if (d >= twelveMonthsAgo) rolling12 += h;
      }
      res.json({ entries: rows, totals: { total, formal, informal, calendarYear, rolling12 } });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/cpd/:userId", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { entryDate, hours, kind, activity, competency } = req.body || {};
    if (!entryDate || !activity || !(Number(hours) > 0)) {
      return res.status(400).json({ error: "entryDate, hours and activity required" });
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO cpd_entries (user_id, entry_date, hours, kind, activity, competency)
         VALUES ($1, $2, $3, COALESCE($4, 'informal'), $5, $6) RETURNING *`,
        [req.params.userId, entryDate, Number(hours), kind, activity, competency || null]
      );
      res.json(rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/hr/cpd/:userId/:entryId", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      await pool.query(`DELETE FROM cpd_entries WHERE id = $1 AND user_id = $2`,
        [req.params.entryId, req.params.userId]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 📷 Profile photo upload + serve ────────────────────────────────────────
  // Stored in uploaded_files / file_blobs (kind='profile_photo') so we reuse
  // the bytes-in-Postgres pattern. After a successful upload we point
  // users.profile_pic_url at /api/hr/photo/{userId} which streams the latest.
  const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (/^image\/(png|jpeg|jpg|webp)$/i.test(file.mimetype)) cb(null, true);
      else cb(new Error("PNG, JPEG or WebP only"));
    },
  });

  app.post("/api/hr/staff/:userId/photo", requireAuth, photoUpload.single("photo"), async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!req.file) return res.status(400).json({ error: "photo required (multipart 'photo')" });
    try {
      const ins = await pool.query(
        `INSERT INTO uploaded_files (owner_user_id, uploaded_by_user_id, kind, name, mime_type, size_bytes, visibility)
         VALUES ($1, $2, 'profile_photo', $3, $4, $5, 'public') RETURNING id`,
        [req.params.userId, actor.userId, req.file.originalname, req.file.mimetype, req.file.size]
      );
      await pool.query("INSERT INTO file_blobs (file_id, data) VALUES ($1, $2)", [ins.rows[0].id, req.file.buffer]);
      const photoUrl = `/api/hr/photo/${req.params.userId}?v=${ins.rows[0].id.slice(0, 8)}`;
      await pool.query("UPDATE users SET profile_pic_url = $1 WHERE id = $2", [photoUrl, req.params.userId]);
      res.json({ ok: true, url: photoUrl });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Public-ish: anyone signed in can fetch any staff photo (they're shown
  // across the directory anyway). No admin/self gate here.
  app.get("/api/hr/photo/:userId", requireAuth, async (req: any, res) => {
    try {
      const meta = await pool.query(
        `SELECT id, mime_type FROM uploaded_files
         WHERE owner_user_id = $1 AND kind = 'profile_photo'
         ORDER BY created_at DESC LIMIT 1`,
        [req.params.userId]
      );
      if (!meta.rows[0]) return res.status(404).end();
      const blob = await pool.query("SELECT data FROM file_blobs WHERE file_id = $1", [meta.rows[0].id]);
      if (!blob.rows[0]) return res.status(404).end();
      res.setHeader("Content-Type", meta.rows[0].mime_type || "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(blob.rows[0].data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 📄 Staff CV — data, PDF, Word ─────────────────────────────────────────

  async function loadCvData(userId: string): Promise<CvData | null> {
    const profileQ = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone,
              sp.title, sp.start_date, sp.education, sp.rics_pathway, sp.rics_number,
              sp.apc_status, sp.linkedin_url,
              sp.cv_summary, sp.cv_specialisms, sp.cv_notable_clients, sp.cv_career_history
       FROM users u LEFT JOIN staff_profiles sp ON sp.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );
    const p = profileQ.rows[0];
    if (!p) return null;

    // Pull a handful of top-billing completed deals for this person from
    // crm_deals.internal_agent. Limited to 8 so CVs don't sprawl.
    const dealsQ = await pool.query(
      `SELECT name, fee, EXTRACT(YEAR FROM COALESCE(completed_at, exchanged_at, target_date))::int AS year
       FROM crm_deals
       WHERE $1 = ANY(COALESCE(internal_agent, ARRAY[]::text[]))
         AND COALESCE(status, '') IN ('COM', 'INV', 'EXC')
         AND fee IS NOT NULL AND fee > 0
       ORDER BY fee DESC NULLS LAST
       LIMIT 8`,
      [(await pool.query("SELECT name FROM users WHERE id = $1", [userId])).rows[0]?.name || userId]
    );

    // Resolve the profile photo bytes (if any) inline so renderers don't
    // need to know about Postgres.
    let photoBuffer: Buffer | null = null;
    const photoMeta = await pool.query(
      `SELECT id FROM uploaded_files
       WHERE owner_user_id = $1 AND kind = 'profile_photo'
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (photoMeta.rows[0]) {
      const blob = await pool.query("SELECT data FROM file_blobs WHERE file_id = $1", [photoMeta.rows[0].id]);
      if (blob.rows[0]) photoBuffer = blob.rows[0].data;
    }

    const bgpStartYear = p.start_date ? new Date(p.start_date).getFullYear() : null;
    let tenureLabel: string | null = null;
    if (p.start_date) {
      const s = new Date(p.start_date);
      const months = Math.max(0, (new Date().getFullYear() - s.getFullYear()) * 12 + (new Date().getMonth() - s.getMonth()));
      const yrs = Math.floor(months / 12);
      const mos = months % 12;
      tenureLabel = `${s.toLocaleDateString("en-GB", { month: "short", year: "numeric" })} – present (${yrs ? `${yrs}y ` : ""}${mos}m)`;
    }

    return {
      name: p.name,
      title: p.title,
      email: p.email,
      phone: p.phone,
      bgpStartYear,
      tenureLabel,
      education: p.education,
      ricsPathway: p.rics_pathway,
      ricsNumber: p.rics_number,
      apcStatus: p.apc_status,
      linkedinUrl: p.linkedin_url,
      summary: p.cv_summary,
      specialisms: Array.isArray(p.cv_specialisms) ? p.cv_specialisms : [],
      notableClients: Array.isArray(p.cv_notable_clients) ? p.cv_notable_clients : [],
      careerHistory: Array.isArray(p.cv_career_history) ? p.cv_career_history : [],
      notableDeals: dealsQ.rows.map((r: any) => ({ name: r.name, year: r.year || undefined })),
      photoBuffer,
    };
  }

  app.get("/api/hr/cv/:userId", requireAuth, async (req: any, res) => {
    try {
      const cv = await loadCvData(req.params.userId);
      if (!cv) return res.status(404).json({ error: "Not found" });
      // Don't ship binary photo bytes in JSON — the UI loads the photo via
      // /api/hr/photo/:userId separately.
      const { photoBuffer, ...rest } = cv;
      res.json({ ...rest, hasPhoto: !!photoBuffer });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/hr/cv/:userId/pdf", requireAuth, async (req: any, res) => {
    try {
      const cv = await loadCvData(req.params.userId);
      if (!cv) return res.status(404).json({ error: "Not found" });
      const buf = await renderCvPdf(cv);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${cv.name.replace(/[^a-z0-9]+/gi, "_")}_CV.pdf"`);
      res.send(buf);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/hr/cv/:userId/docx", requireAuth, async (req: any, res) => {
    try {
      const cv = await loadCvData(req.params.userId);
      if (!cv) return res.status(404).json({ error: "Not found" });
      const buf = await renderCvDocx(cv);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${cv.name.replace(/[^a-z0-9]+/gi, "_")}_CV.docx"`);
      res.send(buf);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 📋 Performance reviews ─────────────────────────────────────────────────

  app.get("/api/hr/reviews/:userId", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const { rows } = await pool.query(
        `SELECT * FROM staff_reviews WHERE user_id = $1 ORDER BY review_date DESC NULLS LAST, created_at DESC`,
        [req.params.userId]
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/reviews/:userId", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { period, kind = "annual", reviewDate } = req.body || {};
    if (!period) return res.status(400).json({ error: "period required (e.g. annual_2026)" });

    try {
      // Auto-prefill from commission endpoint logic — keep figures consistent.
      const profile = await pool.query(
        `SELECT sp.salary_current FROM staff_profiles sp WHERE sp.user_id = $1`,
        [req.params.userId]
      );
      const salary = profile.rows[0]?.salary_current || null;

      const r = await pool.query(
        `INSERT INTO staff_reviews (user_id, period, kind, review_date, current_salary_pence, fees_target_pence, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft')
         ON CONFLICT (user_id, period) DO UPDATE SET kind = EXCLUDED.kind, updated_at = now()
         RETURNING *`,
        [req.params.userId, period, kind, reviewDate || null, salary, salary ? salary * 3 : null]
      );
      res.json(r.rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/hr/reviews/:id", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    try {
      const owner = await pool.query("SELECT user_id, status FROM staff_reviews WHERE id = $1", [req.params.id]);
      if (!owner.rows[0]) return res.status(404).json({ error: "Not found" });
      if (!actor.isAdmin && actor.userId !== owner.rows[0].user_id) {
        return res.status(403).json({ error: "Forbidden" });
      }

      // Field whitelist split by who's allowed to edit. Self+admin can edit
      // the form fields; only admin can write manager_comments; only the
      // employee themselves can write employee_acknowledgement.
      const sharedFields = [
        "review_date", "current_salary_pence", "last_increase_date", "last_bonus_note",
        "fees_target_pence", "fees_achieved_pence",
        "pipeline_under_offer_pence", "pipeline_negotiating_pence", "expected_invoice_next_year_pence",
        "achievements", "development_areas", "goals", "referrals", "marketing_pr",
        "salary_expectation_pence", "feedback", "bgp_can_help",
      ];
      const sets: string[] = [];
      const params: any[] = [req.params.id];
      for (const f of sharedFields) {
        const camel = f.replace(/_(.)/g, (_, c) => c.toUpperCase());
        if (req.body[camel] !== undefined || req.body[f] !== undefined) {
          params.push(req.body[camel] ?? req.body[f]);
          sets.push(`${f} = $${params.length}`);
        }
      }
      // Admin-only fields
      if (actor.isAdmin && (req.body.managerComments !== undefined || req.body.manager_comments !== undefined)) {
        params.push(req.body.managerComments ?? req.body.manager_comments);
        sets.push(`manager_comments = $${params.length}`);
      }
      // Self-only fields (employee acknowledgement of manager comments)
      if (actor.userId === owner.rows[0].user_id && (req.body.employeeAcknowledgement !== undefined || req.body.employee_acknowledgement !== undefined)) {
        params.push(req.body.employeeAcknowledgement ?? req.body.employee_acknowledgement);
        sets.push(`employee_acknowledgement = $${params.length}`);
      }
      if (sets.length > 0) {
        await pool.query(`UPDATE staff_reviews SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
      }

      // Status transitions:
      //   draft → submitted   (self, when ready for manager review)
      //   submitted → draft   (self OR admin, to reopen for edits)
      //   submitted → completed (admin, after review)
      //   completed → submitted (admin, to allow re-review if needed)
      if (req.body.status === "submitted" && owner.rows[0].status === "draft") {
        await pool.query(
          `UPDATE staff_reviews SET status = 'submitted', submitted_at = now(), updated_at = now() WHERE id = $1`,
          [req.params.id]
        );
      } else if (req.body.status === "draft" && owner.rows[0].status === "submitted") {
        // Reopen — self OR admin can reverse a premature submit.
        await pool.query(
          `UPDATE staff_reviews SET status = 'draft', submitted_at = NULL, updated_at = now() WHERE id = $1`,
          [req.params.id]
        );
      } else if (req.body.status === "completed" && actor.isAdmin && (owner.rows[0].status === "submitted" || owner.rows[0].status === "draft")) {
        // Admin can mark complete from either submitted (normal flow) or
        // draft (after an in-person meeting where the manager finalises
        // the review on behalf of the employee — saves the employee
        // having to log in just to click Submit). Stamps submitted_at
        // too when going draft → completed so the audit trail makes
        // sense.
        if (owner.rows[0].status === "draft") {
          await pool.query(
            `UPDATE staff_reviews SET status = 'completed', submitted_at = COALESCE(submitted_at, now()), reviewed_at = now(), reviewed_by_user_id = $2, updated_at = now() WHERE id = $1`,
            [req.params.id, actor.userId]
          );
        } else {
          await pool.query(
            `UPDATE staff_reviews SET status = 'completed', reviewed_at = now(), reviewed_by_user_id = $2, updated_at = now() WHERE id = $1`,
            [req.params.id, actor.userId]
          );
        }
      } else if (req.body.status === "submitted" && actor.isAdmin && owner.rows[0].status === "completed") {
        // Admin can reopen a completed review back to submitted (e.g. needs
        // more discussion). Doesn't lose the prior reviewer info.
        await pool.query(
          `UPDATE staff_reviews SET status = 'submitted', reviewed_at = NULL, updated_at = now() WHERE id = $1`,
          [req.params.id]
        );
      }

      const updated = await pool.query("SELECT * FROM staff_reviews WHERE id = $1", [req.params.id]);
      res.json(updated.rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Hard-delete a review form. Self or admin only — admins should be able
  // to clear genuinely wrong entries (test rows, miskeyed periods etc.),
  // employees should be able to bin a draft they don't want anymore.
  // No soft-delete — these are user-authored forms, not regulatory records.
  app.delete("/api/hr/reviews/:id", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    try {
      const owner = await pool.query("SELECT user_id FROM staff_reviews WHERE id = $1", [req.params.id]);
      if (!owner.rows[0]) return res.status(404).json({ error: "Not found" });
      if (!actor.isAdmin && actor.userId !== owner.rows[0].user_id) {
        return res.status(403).json({ error: "Forbidden — you can only delete your own reviews" });
      }
      await pool.query("DELETE FROM staff_reviews WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Record a manager's recommendation for a bonus + / or salary uplift
  // coming out of a review. Writes to bonus_history + salary_history, and
  // raises a task for Wendy (or fallback first admin) so she can action
  // it in Xero — Xero stays the system of record for payroll, we just
  // log + notify here so nothing gets lost between the review and the
  // pay run.
  app.post("/api/hr/reviews/:id/record-compensation", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin) return res.status(403).json({ error: "Admin only" });
    const client = await pool.connect();
    try {
      const review = await client.query(
        "SELECT id, user_id, period, current_salary_pence FROM staff_reviews WHERE id = $1",
        [req.params.id],
      );
      if (!review.rows[0]) return res.status(404).json({ error: "Review not found" });
      const r = review.rows[0];

      const { bonusPence, salaryNewPence, effectiveDate, reason } = req.body || {};
      const bonus = Number.isFinite(Number(bonusPence)) ? Math.round(Number(bonusPence)) : 0;
      const salaryNew = Number.isFinite(Number(salaryNewPence)) ? Math.round(Number(salaryNewPence)) : 0;
      if (bonus <= 0 && salaryNew <= 0) {
        return res.status(400).json({ error: "Provide bonusPence and/or salaryNewPence (>0)" });
      }
      const effDate = effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)
        ? effectiveDate
        : new Date().toISOString().slice(0, 10);

      const employee = await client.query("SELECT name, email FROM users WHERE id = $1", [r.user_id]);
      const employeeName = employee.rows[0]?.name || "Employee";

      // All-or-nothing — if the Wendy task fails, we don't want a half-
      // written bonus / salary row sitting around with no notification.
      await client.query("BEGIN");

      const inserted: Record<string, any> = {};
      if (bonus > 0) {
        const ins = await client.query(
          `INSERT INTO bonus_history (user_id, amount_pence, effective_date, kind, reason, notes, recorded_by)
           VALUES ($1, $2, $3, 'bonus', $4, $5, $6)
           ON CONFLICT (user_id, effective_date, amount_pence, kind) DO NOTHING
           RETURNING id, amount_pence, effective_date`,
          [r.user_id, bonus, effDate, reason || `Review ${r.period}`, `From review ${r.id}`, actor.userId],
        );
        inserted.bonus = ins.rows[0] || null;
      }
      if (salaryNew > 0) {
        const ins = await client.query(
          `INSERT INTO salary_history (user_id, salary_pence, effective_date, reason, notes, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, salary_pence, effective_date`,
          [r.user_id, salaryNew, effDate, reason || `Review ${r.period}`, `From review ${r.id}`, actor.userId],
        );
        inserted.salaryIncrease = ins.rows[0] || null;

        // Mirror the new salary onto the staff_reviews row so the form
        // and dashboards show the freshly-agreed number.
        await client.query(
          `UPDATE staff_reviews
              SET current_salary_pence = $1,
                  last_increase_date = $2::date,
                  updated_at = now()
            WHERE id = $3`,
          [salaryNew, effDate, r.id],
        );
      }

      // Notify Wendy (or fallback to first admin). The `users` table has
      // no created_at column — order by name for stability instead.
      const wendyRes = await client.query(
        `SELECT id FROM users
          WHERE is_active = true
            AND (LOWER(name) LIKE 'wendy%' OR LOWER(name) LIKE '%mckenzie%')
          ORDER BY name LIMIT 1`,
      );
      let taskUserId: string | null = wendyRes.rows[0]?.id || null;
      if (!taskUserId) {
        const adminRes = await client.query(
          `SELECT id FROM users WHERE is_admin = true AND is_active = true ORDER BY name LIMIT 1`,
        );
        taskUserId = adminRes.rows[0]?.id || null;
      }

      const bits: string[] = [];
      if (bonus > 0) bits.push(`Bonus £${(bonus / 100).toLocaleString("en-GB")}`);
      if (salaryNew > 0) {
        const fromTxt = r.current_salary_pence ? ` (from £${(r.current_salary_pence / 100).toLocaleString("en-GB")})` : "";
        bits.push(`New salary £${(salaryNew / 100).toLocaleString("en-GB")}${fromTxt}`);
      }
      const summary = bits.join(", ");

      let taskId: string | null = null;
      if (taskUserId) {
        const due = new Date(effDate);
        due.setDate(due.getDate() - 3);
        const ins = await client.query(
          `INSERT INTO user_tasks (user_id, title, description, due_date, priority, status, category)
           VALUES ($1, $2, $3, $4, 'high', 'todo', 'payroll')
           RETURNING id`,
          [
            taskUserId,
            `Push to Xero: ${employeeName} — ${summary}`,
            [
              `Action from ${employeeName}'s review (${r.period}).`,
              summary,
              `Effective ${effDate}.`,
              reason ? `Reason: ${reason}` : "",
              `Review id: ${r.id}`,
            ].filter(Boolean).join("\n"),
            due.toISOString(),
          ],
        );
        taskId = ins.rows[0]?.id || null;
      }

      await client.query("COMMIT");
      res.json({ ok: true, inserted, taskUserId, taskId });
    } catch (e: any) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      console.error("[hr] record-compensation error:", e?.message, e?.stack);
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  // ── Draft a BGP-branded review-outcome letter ──────────────────────
  //
  // Pulls every meaningful field from the review + staff profile, asks
  // Claude to write a formal-but-warm letter, renders it as a BGP-
  // branded DOCX, saves it under hr-review-letters/{userId}/{id}.docx
  // and records it on hr_documents so it shows up on the staff
  // member's documents tab. Admin only.
  //
  // Body (all optional — caller can pass to override what's already on
  // the review):
  //   newSalaryPence    — confirmed new salary (pence)
  //   bonusPence        — bonus being awarded (pence)
  //   effectiveDate     — when increases take effect (YYYY-MM-DD)
  //   managerNotes      — freeform paragraphs to weave into the letter
  //   issued            — true → also stamp the letter as 'issued' so
  //                       it's read-only after this call.
  app.post("/api/hr/reviews/:id/generate-letter", requireAdmin, async (req: any, res) => {
    try {
      const reviewQ = await pool.query(
        `SELECT r.*, u.name AS user_name, u.email AS user_email,
                sp.title AS user_title, sp.salary_current
           FROM staff_reviews r
           JOIN users u ON u.id = r.user_id
           LEFT JOIN staff_profiles sp ON sp.user_id = r.user_id
          WHERE r.id = $1`,
        [req.params.id]
      );
      const review = reviewQ.rows[0];
      if (!review) return res.status(404).json({ error: "Review not found" });

      const actorQ = await pool.query(`SELECT name, email FROM users WHERE id = $1`, [req.session?.userId || (req as any).tokenUserId]);
      const managerName = actorQ.rows[0]?.name || "BGP Equity";

      const { newSalaryPence, bonusPence, effectiveDate, managerNotes, issued } = req.body || {};
      let newSalary = Number.isFinite(Number(newSalaryPence)) && Number(newSalaryPence) > 0 ? Math.round(Number(newSalaryPence)) : null;
      let bonus = Number.isFinite(Number(bonusPence)) && Number(bonusPence) > 0 ? Math.round(Number(bonusPence)) : null;
      let effDateFromHistory: string | null = null;

      // If the caller didn't pass salary/bonus, look them up from
      // the compensation already recorded against this review (via
      // the "Record & notify Wendy" button — writes notes='From
      // review {id}'). Prevents the letter from saying "no change"
      // just because the user filled the form, recorded comp, and
      // generated the letter without re-typing the numbers.
      if (newSalary === null) {
        const hist = await pool.query(
          `SELECT salary_pence, effective_date FROM salary_history
            WHERE user_id = $1 AND notes ILIKE $2
            ORDER BY effective_date DESC LIMIT 1`,
          [review.user_id, `%review ${review.id}%`],
        );
        if (hist.rows[0]?.salary_pence) {
          newSalary = Math.round(Number(hist.rows[0].salary_pence));
          if (hist.rows[0].effective_date) effDateFromHistory = String(hist.rows[0].effective_date).slice(0, 10);
        }
      }
      if (bonus === null) {
        const hist = await pool.query(
          `SELECT amount_pence FROM bonus_history
            WHERE user_id = $1 AND notes ILIKE $2
            ORDER BY effective_date DESC, created_at DESC LIMIT 1`,
          [review.user_id, `%review ${review.id}%`],
        );
        if (hist.rows[0]?.amount_pence) bonus = Math.round(Number(hist.rows[0].amount_pence));
      }

      const effDate = effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)
        ? effectiveDate
        : effDateFromHistory || new Date().toISOString().slice(0, 10);

      // Ask Claude to draft the letter body. We give it the review
      // bullets + the financial outcome + manager notes and ask for
      // section-structured output we then drop into the DOCX template.
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const formatPence = (p: number | null | undefined) => p == null ? "—" : `£${Math.round(p / 100).toLocaleString()}`;

      const prompt = `You are drafting a formal-but-warm annual review outcome letter from Bruce Gillingham Pollard (BGP), a London commercial property firm, to ${review.user_name}${review.user_title ? `, ${review.user_title}` : ""}.

Review period: ${review.period}
Review type: ${review.kind}

Review content (the employee's own words / their manager's notes):
- Achievements: ${review.achievements || "—"}
- Development areas: ${review.development_areas || "—"}
- Goals for next year: ${review.goals || "—"}
- Referrals + cross-team work: ${review.referrals || "—"}
- Marketing / PR contribution: ${review.marketing_pr || "—"}
- Employee feedback to BGP: ${review.feedback || "—"}
- What BGP can do to help: ${review.bgp_can_help || "—"}
- Manager comments on file: ${review.manager_comments || "—"}

Financial picture:
- Current salary: ${formatPence(review.current_salary_pence || review.salary_current)}
- Fees target / achieved: ${formatPence(review.fees_target_pence)} / ${formatPence(review.fees_achieved_pence)}
- Pipeline (under offer / negotiating): ${formatPence(review.pipeline_under_offer_pence)} / ${formatPence(review.pipeline_negotiating_pence)}

This letter's outcome:
- New salary from ${effDate}: ${newSalary ? formatPence(newSalary) : "no change"}
- Bonus awarded: ${bonus ? formatPence(bonus) : "—"}

Additional notes from ${managerName}:
${managerNotes || "(none)"}

Write the letter body as a JSON object with this exact shape:
{
  "opening": "1-2 sentence opener thanking them for their year",
  "performance": "2-3 sentence paragraph summarising what they did well, drawing on the achievements + fee numbers",
  "development": "1-2 sentence paragraph on the development areas + goals, framed constructively",
  "outcome": "Paragraph stating the salary outcome AND bonus outcome explicitly with the numbers, plus the effective date",
  "closing": "1-2 sentence warm close pointing to the year ahead"
}

Rules: British English, no exclamation marks, no "I'm pleased to" / "delighted" clichés. Direct, professional, partner-tone. Reference specifics from the bullets above. JSON only, no prose, no markdown.`;

      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });
      const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(502).json({ error: "AI returned no JSON", raw: text.slice(0, 400) });
      const letter = JSON.parse(jsonMatch[0]) as { opening: string; performance: string; development: string; outcome: string; closing: string };

      // Render the DOCX with BGP branding — same letterhead style as
      // generate_word in chatbgp.ts (bold name, ruled bottom line,
      // Calibri body) so it matches the firm's other generated docs.
      const docx = await import("docx");
      const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      const children: any[] = [
        new docx.Paragraph({
          children: [new docx.TextRun({ text: "BRUCE GILLINGHAM POLLARD", bold: true, size: 22, font: "Calibri", color: "232323" })],
          spacing: { after: 80 },
        }),
        new docx.Paragraph({
          border: { bottom: { style: docx.BorderStyle.SINGLE, size: 8, color: "232323" } },
          spacing: { after: 320 },
        }),
        new docx.Paragraph({
          children: [new docx.TextRun({ text: today, size: 22, font: "Calibri" })],
          spacing: { after: 280 },
        }),
        new docx.Paragraph({
          children: [new docx.TextRun({ text: review.user_name, size: 22, font: "Calibri" })],
          spacing: { after: 40 },
        }),
        new docx.Paragraph({
          children: [new docx.TextRun({ text: review.user_title || "", size: 22, font: "Calibri" })],
          spacing: { after: 280 },
        }),
        new docx.Paragraph({
          children: [new docx.TextRun({ text: `Dear ${review.user_name.split(" ")[0]},`, size: 22, font: "Calibri" })],
          spacing: { after: 220 },
        }),
        new docx.Paragraph({
          children: [new docx.TextRun({ text: `Performance review — ${review.period}`, bold: true, size: 24, font: "Calibri" })],
          spacing: { after: 200 },
        }),
      ];
      const para = (text: string) => new docx.Paragraph({
        children: [new docx.TextRun({ text, size: 22, font: "Calibri" })],
        spacing: { after: 200 },
      });
      children.push(para(letter.opening));
      children.push(para(letter.performance));
      children.push(para(letter.development));
      children.push(para(letter.outcome));
      children.push(para(letter.closing));
      children.push(new docx.Paragraph({ spacing: { after: 240 } }));
      children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: "Yours sincerely,", size: 22, font: "Calibri" })], spacing: { after: 600 } }));
      children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: managerName, bold: true, size: 22, font: "Calibri" })], spacing: { after: 40 } }));
      children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: "Bruce Gillingham Pollard", size: 20, font: "Calibri", color: "555555" })] }));

      const doc = new docx.Document({
        sections: [{ properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }],
        styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
      });
      const buffer = await docx.Packer.toBuffer(doc);

      const { saveFile } = await import("./file-storage");
      const filenameSafe = review.user_name.replace(/[^A-Za-z0-9_-]/g, "_");
      // Stable storage key — one DOCX per review, re-drafts overwrite
      // in place. saveFile() uses ON CONFLICT DO UPDATE so we don't
      // accumulate per-draft copies in file_storage. If you ever want
      // versioning, snapshot to a dated key before this overwrite.
      const storageKey = `hr-review-letters/${review.user_id}/${review.id}.docx`;
      await saveFile(storageKey, Buffer.from(buffer), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", `${filenameSafe}-review-${review.period}.docx`);

      const downloadUrl = `/api/hr/reviews/${review.id}/letter.docx`;

      // Single hr_documents row per review — delete any prior entry
      // for this user + period before re-inserting so the staff
      // documents tab doesn't grow a row per re-draft.
      await pool.query(
        `DELETE FROM hr_documents WHERE user_id = $1 AND doc_type = 'review_letter' AND name = $2`,
        [review.user_id, `Review letter — ${review.period}`]
      );
      await pool.query(
        `INSERT INTO hr_documents (user_id, doc_type, name, sharepoint_url, review_year)
         VALUES ($1, 'review_letter', $2, $3, $4)`,
        [review.user_id, `Review letter — ${review.period}`, downloadUrl, new Date().getFullYear()]
      );

      // Stash the latest letter's storage_key on the review row so the
      // panel can show 'Letter drafted ✓ (re-draft / download)'.
      await pool.query(
        `UPDATE staff_reviews SET letter_storage_key = $1, letter_generated_at = NOW(), letter_issued = $2 WHERE id = $3`,
        [storageKey, !!issued, review.id]
      );

      res.json({
        ok: true,
        storageKey,
        downloadUrl,
        filename: `${filenameSafe}-review-${review.period}.docx`,
      });
    } catch (e: any) {
      console.error("[hr] generate-letter error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message || "letter generation failed" });
    }
  });

  // Stream the latest cached review letter. Same access rules as the
  // review itself (admin or self).
  app.get("/api/hr/reviews/:id/letter.docx", requireAuth, async (req: any, res) => {
    try {
      const actor = await getActor(req);
      const { rows } = await pool.query(
        `SELECT user_id, letter_storage_key FROM staff_reviews WHERE id = $1`,
        [req.params.id]
      );
      const row = rows[0];
      if (!row) return res.status(404).json({ error: "Review not found" });
      if (!actor.isAdmin && actor.userId !== row.user_id) return res.status(403).json({ error: "Forbidden" });
      if (!row.letter_storage_key) return res.status(404).json({ error: "No letter generated yet" });
      const { getFile } = await import("./file-storage");
      const file = await getFile(row.letter_storage_key);
      if (!file) return res.status(404).json({ error: "Stored file missing" });
      res.setHeader("Content-Type", file.contentType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", contentDispositionFor(file.originalName || "review-letter.docx", "inline"));
      res.end(file.data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "stream failed" });
    }
  });

  // Auto-link review-form numbers from the WIP report.
  //   target            = current_salary_pence * 3
  //   achieved          = sum of fee allocations on INV-status deals
  //   under offer       = sum on SOL-status deals
  //   negotiating       = sum on NEG-status deals
  // Single-review variant — used by the "Sync from WIP" button on the
  // review form. Self or admin only.
  app.post("/api/hr/reviews/:id/sync-from-wip", requireAuth, async (req: any, res) => {
    try {
      const actor = await getActor(req);
      const owner = await pool.query("SELECT user_id FROM staff_reviews WHERE id = $1", [req.params.id]);
      if (!owner.rows[0]) return res.status(404).json({ error: "Review not found" });
      if (!actor.isAdmin && actor.userId !== owner.rows[0].user_id) {
        return res.status(403).json({ error: "Forbidden — can only sync your own reviews" });
      }
      const { syncReviewFromWip } = await import("./review-wip-sync");
      const result = await syncReviewFromWip(req.params.id);
      if (!result) return res.status(404).json({ error: "Review not found or has no linked user" });
      res.json({ ok: true, ...result });
    } catch (e: any) {
      console.error("[hr/reviews/sync-from-wip]", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Bulk: sync every review whose period matches a substring. Use for
  // the "all 2027 tax year review forms" sweep. Admin only.
  app.post("/api/hr/reviews/sync-from-wip-bulk", requireAdmin, async (req: any, res) => {
    try {
      const periodMatch = String(req.body?.periodMatch || req.body?.period || "2027").trim();
      if (!periodMatch) return res.status(400).json({ error: "periodMatch required (substring, e.g. '2027')" });
      const { syncReviewsFromWipByPeriod } = await import("./review-wip-sync");
      const result = await syncReviewsFromWipByPeriod(periodMatch);
      res.json({ ok: true, periodMatch, ...result });
    } catch (e: any) {
      console.error("[hr/reviews/sync-from-wip-bulk]", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Import a pasted review (e.g. from a SharePoint Word doc) and let Claude
  // extract the structured fields into a staff_reviews row. Lets BGP retire
  // the SharePoint copies and keep everything searchable in-app.
  app.post("/api/hr/reviews/import-from-text", requireAdmin, async (req: any, res) => {
    const { userId, period, kind = "annual", text } = req.body || {};
    if (!userId || !period || !text) return res.status(400).json({ error: "userId, period, text required" });

    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: `Parse this BGP performance review and return ONLY a JSON object with these fields. Use null for any not present. Money fields should be in pence (multiply £ by 100). Long-form sections should preserve the original bullet structure as plain text.

Review text:
"""
${text.slice(0, 12000)}
"""

Return JSON with these keys:
{
  "review_date": "YYYY-MM-DD or null",
  "current_salary_pence": number or null,
  "last_increase_date": "YYYY-MM-DD or null",
  "last_bonus_note": "string or null",
  "fees_target_pence": number or null,
  "fees_achieved_pence": number or null,
  "pipeline_under_offer_pence": number or null,
  "pipeline_negotiating_pence": number or null,
  "expected_invoice_next_year_pence": number or null,
  "achievements": "preserved bullet list or null",
  "development_areas": "preserved bullet list or null",
  "goals": "preserved bullet list or null",
  "referrals": "string or null",
  "marketing_pr": "string or null",
  "salary_expectation_pence": number or null,
  "feedback": "string or null",
  "bgp_can_help": "string or null"
}

Return ONLY valid JSON, nothing else.`,
        }],
      });

      const txt = msg.content?.[0]?.type === "text" ? msg.content[0].text : "";
      // Strip code fences if present.
      const jsonStr = txt.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (parseErr: any) {
        return res.status(422).json({ error: "AI response wasn't valid JSON", raw: txt });
      }

      const fields = [
        "review_date", "current_salary_pence", "last_increase_date", "last_bonus_note",
        "fees_target_pence", "fees_achieved_pence",
        "pipeline_under_offer_pence", "pipeline_negotiating_pence", "expected_invoice_next_year_pence",
        "achievements", "development_areas", "goals", "referrals", "marketing_pr",
        "salary_expectation_pence", "feedback", "bgp_can_help",
      ];
      const cols = ["user_id", "period", "kind", "status"].concat(fields);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const values = [userId, period, kind, "completed"].concat(fields.map(f => parsed[f] ?? null));
      const updateSets = fields.map(f => `${f} = EXCLUDED.${f}`).join(", ");

      const r = await pool.query(
        `INSERT INTO staff_reviews (${cols.join(", ")}) VALUES (${placeholders})
         ON CONFLICT (user_id, period) DO UPDATE SET ${updateSets}, updated_at = now()
         RETURNING *`,
        values
      );
      res.json({ imported: true, review: r.rows[0], extracted: parsed });
    } catch (e: any) {
      console.error("[hr] review import error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // List all DOCX review forms in the SharePoint Reviews folder. Returns
  // metadata so admin can one-click import each one.
  app.get("/api/hr/reviews/sharepoint-list", requireAdmin, async (req: any, res) => {
    const token = await getValidMsToken(req as any);
    if (!token) return res.status(401).json({ error: "Connect Microsoft 365 first" });
    try {
      const SITE = "brucegillinghampollardlimited.sharepoint.com:/sites/BGP:";
      const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${SITE}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!siteRes.ok) return res.status(502).json({ error: "Couldn't reach SharePoint site" });
      const site = await siteRes.json();
      const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, { headers: { Authorization: `Bearer ${token}` } });
      const drives = (await drivesRes.json()).value || [];
      const docDrive = drives.find((d: any) => d.name === "Documents") || drives[0];
      if (!docDrive) return res.status(404).json({ error: "Documents drive not found" });

      // Enumerate review years/folders.
      const path = encodeURIComponent("HR/Reviews/2026 Reviews/Review Forms");
      const listRes = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${docDrive.id}/root:/${path}:/children?$select=id,name,file,lastModifiedDateTime,size`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!listRes.ok) return res.json({ files: [], note: "Folder not found at HR/Reviews/2026 Reviews/Review Forms" });
      const items = (await listRes.json()).value || [];
      const files = items
        .filter((i: any) => i.file && /\.docx$/i.test(i.name))
        .map((i: any) => ({
          driveId: docDrive.id,
          itemId: i.id,
          name: i.name,
          size: i.size,
          lastModified: i.lastModifiedDateTime,
        }));
      res.json({ files });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Import one SharePoint review .docx straight into the app. Uses Graph's
  // /preview endpoint to pull the file, hands the binary to Claude (which
  // reads .docx natively as a document input), then stores the parsed fields.
  app.post("/api/hr/reviews/import-from-sharepoint", requireAdmin, async (req: any, res) => {
    const { driveId, itemId, userId, period, kind = "annual" } = req.body || {};
    if (!driveId || !itemId || !userId || !period) return res.status(400).json({ error: "driveId, itemId, userId, period required" });

    const token = await getValidMsToken(req as any);
    if (!token) return res.status(401).json({ error: "Connect Microsoft 365 first" });

    try {
      // Fetch the file as base64.
      const fileRes = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "follow",
      });
      if (!fileRes.ok) return res.status(502).json({ error: `Graph returned ${fileRes.status}` });
      const buf = Buffer.from(await fileRes.arrayBuffer());

      // Extract the .docx text (the Claude API's base64 document block only
      // accepts application/pdf, so a docx source 400s) and pass it as text —
      // mammoth is how the rest of the app reads Word buffers.
      const mammoth = (await import("mammoth")).default;
      const { value: docText } = await mammoth.extractRawText({ buffer: buf });

      const Anthropic = (await import("@anthropic-ai/sdk")).default;

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: `Parse this BGP performance review and return ONLY a JSON object. Money fields in pence. Long-form sections preserve bullet structure.

--- REVIEW DOCUMENT ---
${docText}
--- END DOCUMENT ---

{
  "review_date": "YYYY-MM-DD or null",
  "current_salary_pence": number or null,
  "last_increase_date": "YYYY-MM-DD or null",
  "last_bonus_note": "string or null",
  "fees_target_pence": number or null,
  "fees_achieved_pence": number or null,
  "pipeline_under_offer_pence": number or null,
  "pipeline_negotiating_pence": number or null,
  "expected_invoice_next_year_pence": number or null,
  "achievements": "string or null",
  "development_areas": "string or null",
  "goals": "string or null",
  "referrals": "string or null",
  "marketing_pr": "string or null",
  "salary_expectation_pence": number or null,
  "feedback": "string or null",
  "bgp_can_help": "string or null"
}

Return ONLY JSON.`,
            },
          ],
        }],
      });

      const txt = msg.content?.[0]?.type === "text" ? msg.content[0].text : "";
      const jsonStr = txt.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(jsonStr);

      const fields = [
        "review_date", "current_salary_pence", "last_increase_date", "last_bonus_note",
        "fees_target_pence", "fees_achieved_pence",
        "pipeline_under_offer_pence", "pipeline_negotiating_pence", "expected_invoice_next_year_pence",
        "achievements", "development_areas", "goals", "referrals", "marketing_pr",
        "salary_expectation_pence", "feedback", "bgp_can_help",
      ];
      const cols = ["user_id", "period", "kind", "status"].concat(fields);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const values = [userId, period, kind, "completed"].concat(fields.map(f => parsed[f] ?? null));
      const updateSets = fields.map(f => `${f} = EXCLUDED.${f}`).join(", ");

      const r = await pool.query(
        `INSERT INTO staff_reviews (${cols.join(", ")}) VALUES (${placeholders})
         ON CONFLICT (user_id, period) DO UPDATE SET ${updateSets}, updated_at = now()
         RETURNING id`,
        values
      );
      res.json({ imported: true, reviewId: r.rows[0].id, extracted: parsed });
    } catch (e: any) {
      console.error("[hr] sharepoint review import error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // AI coach — uses the user's commission/deals data to draft a review starter.
  // Marked as hint, not authoritative — user edits before submitting.
  app.post("/api/hr/reviews/:id/ai-draft", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    try {
      const r = await pool.query("SELECT user_id, period FROM staff_reviews WHERE id = $1", [req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
      if (!actor.isAdmin && actor.userId !== r.rows[0].user_id) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const userId = r.rows[0].user_id;
      // Pull deals for commentary
      const userRow = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
      const userName = userRow.rows[0]?.name || "this user";

      const dealsRes = await pool.query(
        `SELECT name, status, fee FROM crm_deals
         WHERE EXISTS (SELECT 1 FROM unnest(COALESCE(internal_agent, ARRAY[]::text[])) a WHERE LOWER(a) = LOWER($1))
           AND COALESCE(status, '') NOT IN ('ARCH','WIT')
         ORDER BY fee DESC NULLS LAST LIMIT 25`,
        [userName]
      );

      // Try the existing ChatBGP / Claude pipeline — if not wired up here we
      // return a deterministic skeleton so the UI still demos.
      let aiSummary = "";
      try {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const dealsList = dealsRes.rows.slice(0, 20).map((d: any) => `- ${d.name} (${d.status}, £${(parseFloat(d.fee) || 0).toLocaleString()})`).join("\n");
        const msg = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 800,
          messages: [{
            role: "user",
            content: `You are a coach helping ${userName}, a UK commercial property surveyor at BGP, prepare their annual performance review. Their deals over the past year were:\n\n${dealsList || "(no deals on file yet)"}\n\nWrite three short bullet-point sections:\n1. Achievements — concrete wins from the deals data\n2. Development areas — what to work on, evidence-based\n3. Goals for next year — SMART, tied to BGP's commission tiers (3× salary target)\n\nKeep it tight, honest, and specific. Use surveyor language ('instructions', 'pitches', 'completions').`,
          }],
        });
        aiSummary = msg.content?.[0]?.type === "text" ? msg.content[0].text : "";
      } catch (e: any) {
        aiSummary = `(AI coach unavailable — wire ANTHROPIC_API_KEY)\n\nReview draft scaffold:\n\n**Achievements:**\n${dealsRes.rows.slice(0, 5).map((d: any) => `- ${d.name}`).join("\n") || "- (no deals to summarise)"}\n\n**Development areas:**\n- (Add areas to focus on next year)\n\n**Goals for next year:**\n- Hit 3× salary target\n- Win N new instructions\n- Develop one new client relationship`;
      }

      await pool.query("UPDATE staff_reviews SET ai_summary = $2, updated_at = now() WHERE id = $1", [req.params.id, aiSummary]);
      res.json({ aiSummary });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Reactions (emoji acknowledgements on a review). Anyone with view rights
  // can react; one reaction per emoji per user (toggle).
  app.post("/api/hr/reviews/:id/react", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.userId) return res.status(401).json({ error: "Not authenticated" });
    const { emoji } = req.body || {};
    if (!emoji) return res.status(400).json({ error: "emoji required" });
    try {
      const r = await pool.query("SELECT user_id, reactions FROM staff_reviews WHERE id = $1", [req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
      // Visibility: admin or the reviewee can react.
      if (!actor.isAdmin && actor.userId !== r.rows[0].user_id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const current: any[] = Array.isArray(r.rows[0].reactions) ? r.rows[0].reactions : [];
      const existing = current.findIndex((x: any) => x.byUserId === actor.userId && x.emoji === emoji);
      let next: any[];
      if (existing >= 0) {
        next = current.filter((_, i) => i !== existing);
      } else {
        const me = await pool.query("SELECT name FROM users WHERE id = $1", [actor.userId]);
        next = [...current, { emoji, byUserId: actor.userId, byName: me.rows[0]?.name || "Someone", at: new Date().toISOString() }];
      }
      await pool.query("UPDATE staff_reviews SET reactions = $2::jsonb, updated_at = now() WHERE id = $1", [req.params.id, JSON.stringify(next)]);
      res.json({ reactions: next });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Goals (linked to reviews and to user_tasks for follow-through)
  app.get("/api/hr/goals/:userId", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const { rows } = await pool.query(
        `SELECT g.*, t.title AS task_title FROM staff_review_goals g
         LEFT JOIN user_tasks t ON t.id = g.linked_task_id
         WHERE g.user_id = $1 ORDER BY g.created_at DESC`,
        [req.params.userId]
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/goals", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.userId) return res.status(401).json({ error: "Not authenticated" });
    const { userId, title, description, metricType, targetValue, dueDate, reviewId, createTask } = req.body || {};
    if (!actor.isAdmin && actor.userId !== userId) return res.status(403).json({ error: "Forbidden" });
    if (!userId || !title) return res.status(400).json({ error: "userId and title required" });

    try {
      let linkedTaskId: string | null = null;
      if (createTask) {
        const t = await pool.query(
          `INSERT INTO user_tasks (user_id, title, description, due_date, priority, status, category)
           VALUES ($1, $2, $3, $4, 'medium', 'todo', 'review-goal') RETURNING id`,
          [userId, title, description || null, dueDate || null]
        );
        linkedTaskId = t.rows[0].id;
      }
      const r = await pool.query(
        `INSERT INTO staff_review_goals (review_id, user_id, title, description, metric_type, target_value, due_date, linked_task_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [reviewId || null, userId, title, description || null, metricType || null, targetValue || null, dueDate || null, linkedTaskId]
      );
      res.json(r.rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/hr/goals/:id", requireAuth, async (req: any, res) => {
    try {
      const allowed = ["title", "description", "current_value", "target_value", "status", "due_date"];
      const sets: string[] = [];
      const params: any[] = [req.params.id];
      for (const f of allowed) {
        const camel = f.replace(/_(.)/g, (_, c) => c.toUpperCase());
        if (req.body[camel] !== undefined || req.body[f] !== undefined) {
          params.push(req.body[camel] ?? req.body[f]);
          sets.push(`${f} = $${params.length}`);
        }
      }
      if (sets.length === 0) return res.json({ ok: true });
      await pool.query(`UPDATE staff_review_goals SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/hr/goals/:id", requireAuth, async (req: any, res) => {
    try {
      await pool.query("DELETE FROM staff_review_goals WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 💰 Pension dashboard (Royal London CSV import) ────────────────────────

  app.get("/api/hr/pension/:userId", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const { rows } = await pool.query(
        `SELECT pay_period, pay_date, employee_pence, employer_pence, pensionable_pay_pence, source_file
         FROM pension_contributions
         WHERE user_id = $1 OR LOWER(employee_match_name) = LOWER((SELECT name FROM users WHERE id = $1))
         ORDER BY pay_date DESC NULLS LAST LIMIT 60`,
        [req.params.userId]
      );
      const totals = {
        employeeYtdPence: 0,
        employerYtdPence: 0,
        currentYear: new Date().getFullYear(),
        contributionCount: rows.length,
      };
      for (const r of rows) {
        const dt = r.pay_date ? new Date(r.pay_date) : null;
        if (dt && dt.getFullYear() === totals.currentYear) {
          totals.employeeYtdPence += parseInt(r.employee_pence, 10) || 0;
          totals.employerYtdPence += parseInt(r.employer_pence, 10) || 0;
        }
      }
      res.json({ contributions: rows, totals });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Royal London CSV import — admin uploads the export from Online Service for
  // Employers. Expected columns (case-insensitive): Member Name, Pay Period,
  // Pay Date, Employee Contribution, Employer Contribution, Pensionable Pay.
  app.post("/api/hr/pension/import", requireAdmin, async (req: any, res) => {
    const { csv, sourceFile = "royal-london.csv" } = req.body || {};
    if (!csv || typeof csv !== "string") return res.status(400).json({ error: "csv string required" });

    const lines = csv.split(/\r?\n/).filter((l: string) => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: "CSV has no rows" });
    const header = lines[0].split(",").map((h: string) => h.trim().toLowerCase());

    const idxName = header.findIndex((h: string) => h.includes("member") || h.includes("name") || h.includes("employee"));
    const idxPeriod = header.findIndex((h: string) => h.includes("pay period") || h === "period");
    const idxPayDate = header.findIndex((h: string) => h.includes("pay date") || h === "date");
    const idxEmp = header.findIndex((h: string) => h.includes("employee") && h.includes("contrib"));
    const idxEmployer = header.findIndex((h: string) => h.includes("employer") && h.includes("contrib"));
    const idxPensionable = header.findIndex((h: string) => h.includes("pensionable"));

    if (idxName < 0 || idxEmp < 0 || idxEmployer < 0) {
      return res.status(400).json({ error: "CSV missing required columns (member name, employee contribution, employer contribution)" });
    }

    const usersRes = await pool.query("SELECT id, name FROM users WHERE is_active = true");
    const nameToId = new Map<string, string>();
    for (const u of usersRes.rows) nameToId.set(u.name.toLowerCase().trim(), u.id);

    const pence = (s: string) => Math.round((parseFloat(String(s).replace(/[£,]/g, "")) || 0) * 100);

    let imported = 0, unmatched = 0;
    const unmatchedNames: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c: string) => c.trim().replace(/^"|"$/g, ""));
      const name = cols[idxName] || "";
      const userId = nameToId.get(name.toLowerCase()) || null;
      if (!userId) { unmatched++; if (!unmatchedNames.includes(name)) unmatchedNames.push(name); }
      const payDateRaw = idxPayDate >= 0 ? cols[idxPayDate] : "";
      const payDate = payDateRaw && /^\d{4}-\d{2}-\d{2}/.test(payDateRaw) ? payDateRaw
        : payDateRaw && /^\d{2}\/\d{2}\/\d{4}/.test(payDateRaw)
          ? payDateRaw.split("/").reverse().join("-")
          : null;

      await pool.query(
        `INSERT INTO pension_contributions (user_id, employee_match_name, pay_period, pay_date, employee_pence, employer_pence, pensionable_pay_pence, source_file)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, name, idxPeriod >= 0 ? cols[idxPeriod] : null, payDate, pence(cols[idxEmp]), pence(cols[idxEmployer]), idxPensionable >= 0 ? pence(cols[idxPensionable]) : null, sourceFile]
      );
      imported++;
    }
    res.json({ imported, unmatched, unmatchedNames });
  });

  // ── 📣 Marketing — events / campaigns / press contacts ───────────────────

  app.get("/api/marketing/events", requireAuth, async (req: any, res) => {
    try {
      const upcomingOnly = req.query.upcoming === "1";
      const where = upcomingOnly ? "WHERE starts_at >= now() OR starts_at IS NULL" : "";
      const { rows } = await pool.query(
        `SELECT e.*, u.name AS lead_name, u.profile_pic_url AS lead_pic
         FROM marketing_events e
         LEFT JOIN users u ON u.id = e.lead_user_id
         ${where}
         ORDER BY e.starts_at ASC NULLS LAST LIMIT 100`
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/marketing/events", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.userId) return res.status(401).json({ error: "Not authenticated" });
    const { title, kind, category, startsAt, endsAt, location, description, leadUserId, externalUrl, attendeeUserIds, attendeeContactIds } = req.body || {};
    if (!title) return res.status(400).json({ error: "title required" });
    try {
      const r = await pool.query(
        `INSERT INTO marketing_events (title, kind, category, starts_at, ends_at, location, description, lead_user_id, external_url, attendee_user_ids, attendee_contact_ids, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [title, kind || null, category || null, startsAt || null, endsAt || null, location || null, description || null, leadUserId || null, externalUrl || null, attendeeUserIds || null, attendeeContactIds || null, actor.userId]
      );
      res.json(r.rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/marketing/events/:id", requireAuth, async (req: any, res) => {
    const allowed = ["title", "kind", "category", "starts_at", "ends_at", "location", "description", "lead_user_id", "external_url", "attendee_user_ids", "attendee_contact_ids", "status"];
    const sets: string[] = [];
    const params: any[] = [req.params.id];
    for (const f of allowed) {
      const camel = f.replace(/_(.)/g, (_, c) => c.toUpperCase());
      if (req.body[camel] !== undefined || req.body[f] !== undefined) {
        params.push(req.body[camel] ?? req.body[f]);
        sets.push(`${f} = $${params.length}`);
      }
    }
    if (sets.length === 0) return res.json({ ok: true });
    try {
      await pool.query(`UPDATE marketing_events SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/marketing/events/:id", requireAuth, async (req: any, res) => {
    try {
      await pool.query("DELETE FROM marketing_events WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Seed Emmy's strategy doc events on first read so the calendar isn't empty.
  const SEED_MARKETING_EVENTS = [
    { title: "International Women's Day", kind: "industry", category: "Awareness", month: 2, day: 8 },
    { title: "GRO speaker opportunities (Spring)", kind: "industry", category: "Speaking", month: 3, day: 25 },
    { title: "Property Week Awards judging pitch", kind: "pitch", category: "Awards", month: 3, day: 1 },
    { title: "MIPIM 2027", kind: "industry", category: "Conference", month: 2, day: 10, year: 2027 },
    { title: "GRO speaker opportunities (Autumn)", kind: "industry", category: "Speaking", month: 8, day: 25 },
    { title: "MAPIC 2026 — panel discussion", kind: "speaking", category: "Conference", month: 10, day: 18 },
    { title: "EG Awards judging opportunity", kind: "industry", category: "Awards", month: 10, day: 5 },
    { title: "Revo Awards judging opportunity", kind: "industry", category: "Awards", month: 11, day: 1 },
    { title: "Property Week Leisure Parks Focus — VB pitch", kind: "pitch", category: "Press", month: 9, day: 1 },
    { title: "Property Week Shopping Centre Focus — ME pitch", kind: "pitch", category: "Press", month: 1, day: 1 },
  ];

  app.post("/api/marketing/seed", requireAdmin, async (_req, res) => {
    try {
      for (const e of SEED_MARKETING_EVENTS) {
        const year = (e as any).year || new Date().getFullYear();
        const startsAt = new Date(year, e.month - 1, e.day);
        await pool.query(
          `INSERT INTO marketing_events (title, kind, category, starts_at, status)
           VALUES ($1, $2, $3, $4, 'planned')
           ON CONFLICT DO NOTHING`,
          [e.title, e.kind, e.category, startsAt.toISOString()]
        );
      }
      const { rows: pressDefaults } = await pool.query("SELECT COUNT(*)::int AS n FROM marketing_press_contacts");
      if (pressDefaults[0].n === 0) {
        const PRESS = [
          { name: "Andy Hillier", title: "Features Editor", publication: "Property Week" },
          { name: "Chris Borland", title: "Reporter", publication: "Green Street News" },
          { name: "Tim Burke", title: "Reporter", publication: "Estates Gazette" },
          { name: "Shifali Gorka", title: "Reporter", publication: "Estates Gazette" },
          { name: "Liz Samson", title: "Editor", publication: "BE News" },
        ];
        for (const p of PRESS) {
          await pool.query(
            `INSERT INTO marketing_press_contacts (name, title, publication) VALUES ($1, $2, $3)`,
            [p.name, p.title, p.publication]
          );
        }
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/marketing/press", requireAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM marketing_press_contacts ORDER BY publication, name");
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 🎓 Promotion pitches ─────────────────────────────────────────────────

  app.get("/api/hr/promotion-pitches/:userId", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const { rows } = await pool.query(
        `SELECT * FROM staff_promotion_pitches WHERE user_id = $1 ORDER BY pitch_date DESC NULLS LAST, created_at DESC`,
        [req.params.userId]
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/promotion-pitches", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.userId) return res.status(401).json({ error: "Not authenticated" });
    const { userId, fromLevel, toLevel, pitchDate } = req.body || {};
    if (!userId || !toLevel) return res.status(400).json({ error: "userId, toLevel required" });
    if (!actor.isAdmin && actor.userId !== userId) return res.status(403).json({ error: "Forbidden" });
    try {
      const r = await pool.query(
        `INSERT INTO staff_promotion_pitches (user_id, from_level, to_level, pitch_date, status)
         VALUES ($1, $2, $3, $4, 'draft') RETURNING *`,
        [userId, fromLevel || null, toLevel, pitchDate || null]
      );
      res.json(r.rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/hr/promotion-pitches/:id", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    try {
      const owner = await pool.query("SELECT user_id FROM staff_promotion_pitches WHERE id = $1", [req.params.id]);
      if (!owner.rows[0]) return res.status(404).json({ error: "Not found" });
      if (!actor.isAdmin && actor.userId !== owner.rows[0].user_id) return res.status(403).json({ error: "Forbidden" });

      const sharedFields = ["from_level", "to_level", "pitch_date", "status", "narrative", "key_wins", "financials", "development", "ask"];
      const adminFields = ["decision", "decision_notes"];
      const sets: string[] = [];
      const params: any[] = [req.params.id];
      for (const f of sharedFields) {
        const camel = f.replace(/_(.)/g, (_, c) => c.toUpperCase());
        if (req.body[camel] !== undefined || req.body[f] !== undefined) {
          params.push(req.body[camel] ?? req.body[f]);
          sets.push(`${f} = $${params.length}`);
        }
      }
      if (actor.isAdmin) {
        for (const f of adminFields) {
          const camel = f.replace(/_(.)/g, (_, c) => c.toUpperCase());
          if (req.body[camel] !== undefined || req.body[f] !== undefined) {
            params.push(req.body[camel] ?? req.body[f]);
            sets.push(`${f} = $${params.length}`);
          }
        }
        if (req.body.decision) {
          params.push(actor.userId);
          sets.push(`decided_by_user_id = $${params.length}`);
          sets.push(`decided_at = now()`);
        }
      }
      if (sets.length > 0) {
        await pool.query(`UPDATE staff_promotion_pitches SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
      }
      const updated = await pool.query("SELECT * FROM staff_promotion_pitches WHERE id = $1", [req.params.id]);
      res.json(updated.rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // AI draft for the promotion pitch — pulls deals + reviews + competencies
  // and generates a punchy first-person narrative the user can edit.
  app.post("/api/hr/promotion-pitches/:id/ai-draft", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    try {
      const r = await pool.query("SELECT * FROM staff_promotion_pitches WHERE id = $1", [req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
      if (!actor.isAdmin && actor.userId !== r.rows[0].user_id) return res.status(403).json({ error: "Forbidden" });
      const userId = r.rows[0].user_id;

      const userRow = await pool.query("SELECT name FROM users u LEFT JOIN staff_profiles sp ON sp.user_id = u.id WHERE u.id = $1", [userId]);
      const userName = userRow.rows[0]?.name || "this user";

      const [dealsRes, reviewsRes, compsRes] = await Promise.all([
        pool.query(
          `SELECT name, status, fee FROM crm_deals
           WHERE EXISTS (SELECT 1 FROM unnest(COALESCE(internal_agent, ARRAY[]::text[])) a WHERE LOWER(a) = LOWER($1))
             AND COALESCE(status, '') NOT IN ('ARCH','WIT')
           ORDER BY fee DESC NULLS LAST LIMIT 30`,
          [userName]
        ),
        pool.query(
          `SELECT period, fees_target_pence, fees_achieved_pence, achievements, goals
           FROM staff_reviews WHERE user_id = $1 ORDER BY review_date DESC LIMIT 3`,
          [userId]
        ),
        pool.query(
          `SELECT competency, level FROM staff_competencies WHERE user_id = $1 AND level > 0`,
          [userId]
        ),
      ]);

      let aiDraft = "";
      try {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const dealsList = dealsRes.rows.map((d: any) => `- ${d.name} (${d.status}, £${(parseFloat(d.fee) || 0).toLocaleString()})`).join("\n");
        const reviewsList = reviewsRes.rows.map((rev: any) => `${rev.period}: target £${((rev.fees_target_pence || 0) / 100).toLocaleString()}, achieved £${((rev.fees_achieved_pence || 0) / 100).toLocaleString()}`).join("\n");
        const compsList = compsRes.rows.map((c: any) => `${c.competency} (L${c.level})`).join(", ");
        const msg = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1500,
          messages: [{
            role: "user",
            content: `Draft a promotion pitch from ${userName} (currently ${r.rows[0].from_level || "[level]"}, asking for ${r.rows[0].to_level}). They're a UK commercial property surveyor at BGP.

Deals (last year):
${dealsList || "(none)"}

Recent reviews:
${reviewsList || "(none)"}

RICS competencies achieved: ${compsList || "(none)"}

Write four short sections:
1. Narrative (2-3 paragraphs, first-person, confident-not-arrogant case for promotion — what they've done that proves they're already operating at the next level)
2. Key wins (bulleted, evidence-rich)
3. Financials (concrete £ figures, target vs achieved, multiple of salary)
4. Development plan (what they'll focus on at the new level)

Use the language and tone of BGP's review docs.`,
          }],
        });
        aiDraft = msg.content?.[0]?.type === "text" ? msg.content[0].text : "";
      } catch (e: any) {
        aiDraft = `(AI coach unavailable — wire ANTHROPIC_API_KEY)\n\nPitch scaffold for ${userName}, ${r.rows[0].from_level} → ${r.rows[0].to_level}:\n\n**Narrative:** [Write 2-3 paragraphs making the case]\n\n**Key wins:**\n${dealsRes.rows.slice(0, 5).map((d: any) => `- ${d.name}`).join("\n") || "- (no deals on file)"}\n\n**Financials:** [target vs achieved, multiple of salary]\n\n**Development plan:** [focus areas at new level]`;
      }

      await pool.query("UPDATE staff_promotion_pitches SET ai_draft = $2, updated_at = now() WHERE id = $1", [req.params.id, aiDraft]);
      res.json({ aiDraft });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 📁 In-app file storage (replaces SharePoint URL lists) ──────────────
  // Upload as a single multipart/form-data POST. Binary stored in file_blobs;
  // metadata in uploaded_files. Stream back via GET /:id/file with inline
  // disposition so PDFs/images render in-app.
  const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

  app.get("/api/hr/files/:userId", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const kind = req.query.kind as string | undefined;
      const params: any[] = [req.params.userId];
      let where = "owner_user_id = $1";
      if (kind) { params.push(kind); where += ` AND kind = $${params.length}`; }
      const { rows } = await pool.query(
        `SELECT id, kind, name, mime_type, size_bytes, review_year, notes, created_at,
                uploaded_by_user_id, (SELECT name FROM users WHERE id = uploaded_by_user_id) AS uploaded_by_name
         FROM uploaded_files WHERE ${where} ORDER BY created_at DESC`,
        params
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/files/:userId", requireAuth, memUpload.single("file"), async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!req.file) return res.status(400).json({ error: "file required (multipart 'file')" });
    const { kind = "other", linkedReviewId, linkedDealId, reviewYear, notes, visibility = "admin-self", name } = req.body || {};
    try {
      const meta = await pool.query(
        `INSERT INTO uploaded_files (owner_user_id, uploaded_by_user_id, kind, name, mime_type, size_bytes, linked_review_id, linked_deal_id, visibility, review_year, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [req.params.userId, actor.userId, kind, name || req.file.originalname, req.file.mimetype, req.file.size, linkedReviewId || null, linkedDealId || null, visibility, reviewYear ? parseInt(reviewYear, 10) : null, notes || null]
      );
      await pool.query("INSERT INTO file_blobs (file_id, data) VALUES ($1, $2)", [meta.rows[0].id, req.file.buffer]);
      res.json({ id: meta.rows[0].id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/hr/files/:id/file", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    try {
      const meta = await pool.query("SELECT * FROM uploaded_files WHERE id = $1", [req.params.id]);
      if (!meta.rows[0]) return res.status(404).json({ error: "Not found" });
      if (!actor.isAdmin && actor.userId !== meta.rows[0].owner_user_id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const blob = await pool.query("SELECT data FROM file_blobs WHERE file_id = $1", [req.params.id]);
      if (!blob.rows[0]) return res.status(404).json({ error: "File missing" });
      res.setHeader("Content-Type", meta.rows[0].mime_type || "application/octet-stream");
      res.setHeader("Content-Disposition", contentDispositionFor(meta.rows[0].name || "file", "inline"));
      res.send(blob.rows[0].data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/hr/files/:id", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    try {
      const meta = await pool.query("SELECT owner_user_id FROM uploaded_files WHERE id = $1", [req.params.id]);
      if (!meta.rows[0]) return res.status(404).json({ error: "Not found" });
      if (!actor.isAdmin && actor.userId !== meta.rows[0].owner_user_id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      await pool.query("DELETE FROM file_blobs WHERE file_id = $1", [req.params.id]);
      await pool.query("DELETE FROM uploaded_files WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 🤖 AI team summaries — daily-refreshed one-liners for org cards ──────

  app.get("/api/hr/team-ai-summaries", requireAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT team, summary, generated_at FROM team_ai_summaries");
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/team-ai-summaries/refresh", requireAdmin, async (_req, res) => {
    try {
      const TEAMS = ["Office / Corporate", "Investment", "Lease Advisory", "National Leasing", "Development", "Tenant Rep", "London Retail", "London F&B"];

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

      const results: Array<{ team: string; summary: string }> = [];
      for (const team of TEAMS) {
        // Recent activity for this team (deals advanced last week + key open deals).
        const { rows: deals } = await pool.query(
          `SELECT d.name, d.status, d.fee
           FROM crm_deals d
           JOIN users u ON LOWER(u.name) = ANY (SELECT LOWER(unnest(COALESCE(d.internal_agent, ARRAY[]::text[]))))
           LEFT JOIN staff_profiles sp ON sp.user_id = u.id
           WHERE u.team = $1
             AND COALESCE(d.status, '') NOT IN ('ARCH','WIT')
             AND COALESCE(d.completed_at, d.exchanged_at, d.target_date, d.instructed_at) >= $2
           ORDER BY d.fee DESC NULLS LAST LIMIT 15`,
          [team, weekAgo]
        );

        let summary = "";
        try {
          const dealsList = deals.map((d: any) => `${d.name} (${d.status}, £${(parseFloat(d.fee) || 0).toLocaleString()})`).join("; ");
          const msg = await client.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 200,
            messages: [{
              role: "user",
              content: `Summarise what BGP's ${team} team has been up to in the past week, in ONE sentence (max 25 words). Use surveyor language. If there's nothing notable, say "Quiet week".\n\nRecent deal activity: ${dealsList || "(no deals advanced)"}\n\nReply with just the sentence, nothing else.`,
            }],
          });
          summary = msg.content?.[0]?.type === "text" ? msg.content[0].text.trim().replace(/^["']|["']$/g, "") : "";
        } catch (e: any) {
          summary = deals.length > 0 ? `${deals.length} deal${deals.length === 1 ? "" : "s"} active this week.` : "Quiet week.";
        }

        await pool.query(
          `INSERT INTO team_ai_summaries (team, summary, generated_at) VALUES ($1, $2, now())
           ON CONFLICT (team) DO UPDATE SET summary = EXCLUDED.summary, generated_at = now()`,
          [team, summary]
        );
        results.push({ team, summary });
      }
      res.json({ refreshed: results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 🛠 Admin diagnostics — find duplicate users (defensive, post-seed) ───
  // Lists every active user grouped by normalised name so admin can spot
  // duplicates the seed might have created (e.g. two "Layla O'Driscoll"
  // rows with different usernames). Read-only — doesn't merge automatically.
  app.get("/api/hr/diagnostics/duplicate-users", requireAdmin, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, name, username, email, is_admin, is_active,
                (SELECT id FROM staff_profiles sp WHERE sp.user_id = u.id LIMIT 1) AS profile_id,
                (SELECT id FROM msal_token_cache m WHERE m.user_id = u.id::text LIMIT 1) IS NOT NULL AS has_ms_token,
                u.created_at, u.updated_at
         FROM users u
         WHERE is_active = true
         ORDER BY LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '', 'g')), created_at`
      );
      const groups = new Map<string, any[]>();
      for (const r of rows) {
        const key = String(r.name).toLowerCase().replace(/[''\s]/g, "");
        const list = groups.get(key) || [];
        list.push(r);
        groups.set(key, list);
      }
      const duplicates: any[] = [];
      for (const [key, members] of groups) {
        if (members.length > 1) duplicates.push({ key, members });
      }
      res.json({ totalUsers: rows.length, duplicateGroups: duplicates });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Deactivate a specific user — admin uses this after reviewing the
  // duplicate diagnostic. Soft-delete: sets is_active = false.
  app.post("/api/hr/diagnostics/deactivate-user/:id", requireAdmin, async (req: any, res) => {
    const actorId = req.session?.userId || req.tokenUserId;
    if (actorId === req.params.id) return res.status(400).json({ error: "Cannot deactivate yourself" });
    try {
      await pool.query("UPDATE users SET is_active = false, updated_at = now() WHERE id = $1", [req.params.id]);
      await pool.query("UPDATE staff_profiles SET status = 'leaver', end_date = COALESCE(end_date, to_char(now(), 'YYYY-MM-DD')), updated_at = now() WHERE user_id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 🏅 Brucey Bonuses — AI-awarded points + weekly leaderboard ───────────
  // Points are issued by Claude scanning recent activity and weighted to
  // reward useful behaviours: deals advanced, completions, reviews submitted,
  // mentor activity, AML hygiene, kudos given. Admin can also award manually.

  // Weekly leaderboard (Mon→Sun by default) plus running total this scheme year.
  app.get("/api/hr/brucey-points/leaderboard", requireAuth, async (req: any, res) => {
    try {
      const period = (req.query.period as string) || "month";
      const now = new Date();
      let periodStart: Date, periodEnd: Date;
      if (period === "week") {
        const day = now.getDay();
        const diffToMon = (day === 0 ? -6 : 1 - day);
        periodStart = new Date(now); periodStart.setHours(0, 0, 0, 0); periodStart.setDate(periodStart.getDate() + diffToMon);
        periodEnd = new Date(periodStart); periodEnd.setDate(periodEnd.getDate() + 7);
      } else if (period === "quarter") {
        const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
        periodStart = new Date(now.getFullYear(), qStartMonth, 1);
        periodEnd = new Date(now.getFullYear(), qStartMonth + 3, 1);
      } else if (period === "ytd") {
        periodStart = new Date(now.getFullYear(), 0, 1);
        periodEnd = new Date(now.getFullYear() + 1, 0, 1);
      } else {
        // default: month
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      }

      const { rows: leaderboard } = await pool.query(
        `SELECT u.id AS user_id, u.name, u.profile_pic_url, sp.title,
                SUM(bp.points)::int AS period_points,
                COUNT(*)::int AS period_events
         FROM users u
         JOIN staff_profiles sp ON sp.user_id = u.id
         LEFT JOIN brucey_points bp ON bp.user_id = u.id AND bp.created_at >= $1 AND bp.created_at < $2
         WHERE u.is_active = true
         GROUP BY u.id, u.name, u.profile_pic_url, sp.title
         HAVING SUM(bp.points) > 0
         ORDER BY period_points DESC NULLS LAST
         LIMIT 20`,
        [periodStart, periodEnd]
      );

      // Has this period already been spun? If yes, freeze the winner record.
      const periodType = period === "quarter" ? "quarter" : "month";
      const { rows: spunRows } = await pool.query(
        `SELECT user_id, points, prize_label, spun_at FROM brucey_winners
         WHERE period_type = $1 AND period_start = $2 LIMIT 1`,
        [periodType, periodStart.toISOString().slice(0, 10)]
      );

      res.json({
        period,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        leaderboard: leaderboard.map((r: any) => ({
          userId: r.user_id,
          name: r.name,
          title: r.title,
          profilePicUrl: r.profile_pic_url,
          weekPoints: r.period_points, // kept for backwards-compat with existing UI
          periodPoints: r.period_points,
          periodEvents: r.period_events,
        })),
        winnerUserId: leaderboard[0]?.user_id || null,
        alreadySpun: spunRows[0] || null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 🎡 Brucey prize pool — admin-managed list of monthly/quarterly prizes ──
  app.get("/api/hr/brucey-prizes", requireAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, label, description, emoji, tier, sort_order, is_active
         FROM brucey_prizes WHERE is_active = true ORDER BY tier, sort_order, label`
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/brucey-prizes", requireAuth, requireAdmin, async (req: any, res) => {
    const { label, description, emoji, tier, sortOrder } = req.body || {};
    if (!label) return res.status(400).json({ error: "label required" });
    try {
      const { rows } = await pool.query(
        `INSERT INTO brucey_prizes (label, description, emoji, tier, sort_order)
         VALUES ($1, $2, $3, COALESCE($4, 'monthly'), COALESCE($5, 0)) RETURNING *`,
        [label, description || null, emoji || null, tier || null, sortOrder ?? null]
      );
      res.json(rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/hr/brucey-prizes/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      await pool.query("UPDATE brucey_prizes SET is_active = false WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 🎡 Spin the wheel — finalise a winner for a period ──────────────────────
  // Admin-only. Picks a random active prize for the given tier, records the
  // winner, and (optionally) issues a Watch House award so it shows on the
  // recognition feed. Idempotent on (period_type, period_start) — re-spinning
  // requires deleting the existing winner row first.
  app.post("/api/hr/brucey-winners/spin", requireAuth, requireAdmin, async (req: any, res) => {
    const { period, userId } = req.body || {};
    if (!period || !userId) return res.status(400).json({ error: "period and userId required" });
    const now = new Date();
    let periodStart: Date, periodEnd: Date, tier: string, periodType: string;
    if (period === "quarter") {
      const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
      periodStart = new Date(now.getFullYear(), qStartMonth, 1);
      periodEnd = new Date(now.getFullYear(), qStartMonth + 3, 1);
      tier = "quarterly";
      periodType = "quarter";
    } else {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      tier = "monthly";
      periodType = "month";
    }
    try {
      const existing = await pool.query(
        "SELECT id FROM brucey_winners WHERE period_type = $1 AND period_start = $2",
        [periodType, periodStart.toISOString().slice(0, 10)]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: "Already spun for this period" });
      }
      // Confirm the user is actually the leader (defensive).
      const leader = await pool.query(
        `SELECT SUM(bp.points)::int AS points FROM brucey_points bp
         WHERE bp.user_id = $1 AND bp.created_at >= $2 AND bp.created_at < $3`,
        [userId, periodStart, periodEnd]
      );
      const points = leader.rows[0]?.points || 0;
      if (points <= 0) return res.status(400).json({ error: "User has 0 points this period" });

      // ORDER BY must match the GET /brucey-prizes ordering exactly —
      // otherwise the client renders one slice arrangement while the
      // server picks an index against a different one and the wheel
      // lands on the wrong-looking prize. The list endpoint uses
      // (tier, sort_order, label); mirror it here.
      const prizes = await pool.query(
        `SELECT id, label, emoji FROM brucey_prizes
          WHERE tier = $1 AND is_active = true
          ORDER BY sort_order, label`,
        [tier]
      );
      if (prizes.rows.length === 0) return res.status(400).json({ error: "No prizes seeded for this tier" });
      const pick = prizes.rows[Math.floor(Math.random() * prizes.rows.length)];

      const actor = await getActor(req);
      const ins = await pool.query(
        `INSERT INTO brucey_winners (user_id, period_type, period_start, period_end, points, prize_id, prize_label, spun_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [userId, periodType, periodStart.toISOString().slice(0, 10), periodEnd.toISOString().slice(0, 10), points, pick.id, pick.label, actor.userId]
      );

      // Also drop it on the Watch House board so it shows in the recognition feed.
      try {
        await pool.query(
          `INSERT INTO staff_awards (user_id, issued_by_user_id, kind, emoji, reason)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, actor.userId, `brucey_${periodType}`, pick.emoji || "🏆",
           `Brucey Bonus ${periodType === "quarter" ? "Quarterly" : "Monthly"} winner — ${pick.label} (${points} pts)`]
        );
      } catch { /* don't fail the spin if the award log breaks */ }

      // Return prize + index in the original ordered list so the wheel can land
      // visually on the right slice.
      const allPrizes = prizes.rows;
      const prizeIndex = allPrizes.findIndex((p: any) => p.id === pick.id);
      res.json({ ...ins.rows[0], prizes: allPrizes, prizeIndex });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Reset the current period's spin so it can be run again. Removes the
  // brucey_winners row + the auto-created Watch House award. Admin-only.
  app.delete("/api/hr/brucey-winners/current", requireAuth, requireAdmin, async (req: any, res) => {
    const period = (req.query.period as string) === "quarter" ? "quarter" : "month";
    const now = new Date();
    let periodStart: Date;
    if (period === "quarter") {
      const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
      periodStart = new Date(now.getFullYear(), qStartMonth, 1);
    } else {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    try {
      const isoDate = periodStart.toISOString().slice(0, 10);
      // Find the winner row so we can clean up the linked Watch House award too.
      const { rows: existing } = await pool.query(
        `SELECT id, user_id, spun_at FROM brucey_winners
         WHERE period_type = $1 AND period_start = $2`,
        [period, isoDate]
      );
      if (existing.length === 0) return res.json({ ok: true, removed: 0 });
      const winner = existing[0];
      await pool.query("DELETE FROM brucey_winners WHERE id = $1", [winner.id]);
      // Best-effort: delete the matching staff_awards row created by the spin
      // (kind = brucey_month / brucey_quarter, same user, created near spin time).
      await pool.query(
        `DELETE FROM staff_awards
         WHERE user_id = $1
           AND kind = $2
           AND created_at >= $3 - INTERVAL '5 minutes'
           AND created_at <= $3 + INTERVAL '5 minutes'`,
        [winner.user_id, `brucey_${period}`, winner.spun_at]
      ).catch(() => {});
      res.json({ ok: true, removed: 1 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/hr/brucey-winners", requireAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT w.id, w.user_id, u.name AS user_name, u.profile_pic_url AS user_pic,
                w.period_type, w.period_start, w.period_end, w.points,
                w.prize_label, w.spun_at
         FROM brucey_winners w
         LEFT JOIN users u ON u.id = w.user_id
         ORDER BY w.period_start DESC LIMIT 40`
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/hr/brucey-points/:userId", requireAuth, async (req: any, res) => {
    const actor = await getActor(req);
    if (!actor.isAdmin && actor.userId !== req.params.userId) return res.status(403).json({ error: "Forbidden" });
    try {
      const { rows } = await pool.query(
        `SELECT id, points, reason, event_kind, awarded_by, awarded_by_user_id, created_at
         FROM brucey_points WHERE user_id = $1 ORDER BY created_at DESC LIMIT 60`,
        [req.params.userId]
      );
      const total = rows.reduce((s: number, r: any) => s + (r.points || 0), 0);
      res.json({ total, history: rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/hr/brucey-points/award", requireAdmin, async (req: any, res) => {
    const actor = await getActor(req);
    const { userId, points, reason, eventKind } = req.body || {};
    if (!userId || !points) return res.status(400).json({ error: "userId, points required" });
    try {
      const r = await pool.query(
        `INSERT INTO brucey_points (user_id, points, reason, event_kind, awarded_by, awarded_by_user_id)
         VALUES ($1, $2, $3, $4, 'admin', $5) RETURNING id`,
        [userId, parseInt(String(points), 10), reason || null, eventKind || "manual", actor.userId]
      );
      res.json({ id: r.rows[0].id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // AI scan — looks at the past week's activity and awards points. Idempotent
  // via brucey_points_dedup_idx (event_kind + event_ref unique) so re-running
  // on the same window just no-ops on previously-awarded events.
  app.post("/api/hr/brucey-points/scan", requireAdmin, async (_req, res) => {
    try {
      const result = await runBruceyPointsScan();
      res.json(result);
    } catch (e: any) {
      console.error("[hr] brucey-points scan error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── 📅 Outlook calendar — OOO + upcoming events for staff ────────────────
  // Pulls free/busy + next events for each active staff member from MS Graph.
  // Used by the dashboard 'What's on' widget and the WFH/OOO indicator on
  // staff cards. Range defaults to 'today + next 7 days'.
  app.get("/api/hr/calendar/now", requireAuth, async (req: any, res) => {
    const token = await getValidMsToken(req as any);
    if (!token) return res.json({ events: [], note: "Microsoft 365 not connected — connect to see live OOO and events." });

    try {
      const { rows: staff } = await pool.query(
        `SELECT u.id, u.name, u.email FROM users u
         JOIN staff_profiles sp ON sp.user_id = u.id
         WHERE u.is_active = true AND u.email IS NOT NULL AND u.email <> ''`
      );
      const now = new Date();
      const horizon = new Date(now.getTime() + 7 * 86400000);
      const startStr = now.toISOString();
      const endStr = horizon.toISOString();

      const events: Array<{ userId: string; userName: string; subject: string; start: string; end: string; isAllDay: boolean; showAs: string; categories: string[] }> = [];

      // Limit concurrency to avoid hammering Graph.
      const slice = staff.slice(0, 30);
      for (const u of slice) {
        try {
          const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(u.email)}/calendarView?startDateTime=${encodeURIComponent(startStr)}&endDateTime=${encodeURIComponent(endStr)}&$select=subject,start,end,isAllDay,showAs,categories&$top=20&$orderby=start/dateTime`;
          const r = await fetch(url, {
            headers: {
              Authorization: `Bearer ${token}`,
              Prefer: 'outlook.timezone="Europe/London"',
            },
          });
          if (!r.ok) continue;
          const data = await r.json();
          for (const e of (data.value || [])) {
            // Only surface OOO / Working-elsewhere. Tentative was here for a
            // while but it's the default state for declined invites and
            // birthday reminders — too noisy. All-day events alone aren't
            // enough either ("Daisy's birthday" is all-day); require the
            // subject regex OR an explicit oof / workingElsewhere showAs.
            const ooKinds = ["oof", "workingElsewhere"];
            const subjectMatch = /\b(holiday|annual leave|on leave|out of office|ooo|wfh|working from home)\b/i.test(e.subject || "");
            const looksOoo = ooKinds.includes(e.showAs) || subjectMatch;
            if (!looksOoo) continue;
            events.push({
              userId: u.id,
              userName: u.name,
              subject: e.subject || "",
              start: e.start?.dateTime || e.start || "",
              end: e.end?.dateTime || e.end || "",
              isAllDay: !!e.isAllDay,
              showAs: e.showAs || "",
              categories: e.categories || [],
            });
          }
        } catch { /* ignore one user's failure */ }
      }
      res.json({ events, scope: { start: startStr, end: endStr, count: slice.length } });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 🎉 Company-wide team events ──────────────────────────────────────────
  // Layla's HR diary widget should surface large company events (Daisy's
  // birthday party, away days, leaving drinks) — not "Pete out of office".
  // Heuristic: an event appearing in ≥ 3 BGP staff calendars at the same
  // time-slot is treated as a team event. Plus anything in our curated
  // team_events table. Pulls subject, start, end, location, attendee count
  // and body preview so the widget can show useful detail.
  app.get("/api/hr/calendar/team-events", requireAuth, async (req: any, res) => {
    const token = await getValidMsToken(req as any);
    const horizonDays = Math.max(1, Math.min(60, parseInt(String(req.query.days || "14"), 10) || 14));
    const now = new Date();
    const horizon = new Date(now.getTime() + horizonDays * 86400000);
    const startStr = now.toISOString();
    const endStr = horizon.toISOString();

    type TeamEvent = {
      key: string;
      subject: string;
      start: string;
      end: string;
      isAllDay: boolean;
      location: string;
      bodyPreview: string;
      internalAttendees: string[];
      attendeeEmails: string[];
      attendeeCount: number;
      source: "outlook" | "team_events_table";
      teamEventId?: string;
    };
    const byKey = new Map<string, TeamEvent>();
    // The whole-company invite list. Events have to include this address as
    // an attendee for us to surface them as team events.
    const COMPANY_INVITE = "team@brucegillinghampollard.com";

    if (token) {
      try {
        const { rows: staff } = await pool.query(
          `SELECT u.id, u.name, u.email FROM users u
           JOIN staff_profiles sp ON sp.user_id = u.id
           WHERE u.is_active = true AND u.email IS NOT NULL AND u.email <> ''`,
        );
        const slice = staff.slice(0, 30);
        // Normalise an event to a stable key — subject (lowercased, trimmed) +
        // start hour. This collapses the same event across everyone's calendars.
        const keyOf = (subject: string, start: string) =>
          `${(subject || "").toLowerCase().replace(/\s+/g, " ").trim()}@${start.slice(0, 13)}`;
        for (const u of slice) {
          try {
            const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(u.email)}/calendarView?startDateTime=${encodeURIComponent(startStr)}&endDateTime=${encodeURIComponent(endStr)}&$select=subject,start,end,isAllDay,showAs,location,bodyPreview,attendees&$top=40&$orderby=start/dateTime`;
            const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="Europe/London"' } });
            if (!r.ok) continue;
            const data = await r.json();
            for (const e of (data.value || [])) {
              const subject = e.subject || "";
              // Skip OOO / leave / WFH — Layla doesn't want those here.
              const showAs = String(e.showAs || "").toLowerCase();
              if (["oof", "workingelsewhere"].includes(showAs)) continue;
              if (/\b(holiday|annual leave|on leave|out of office|\booo\b|wfh|working from home|sick)\b/i.test(subject)) continue;
              const start = e.start?.dateTime || e.start || "";
              if (!start) continue;
              const k = keyOf(subject, start);
              const attendeeEmails: string[] = Array.isArray(e.attendees)
                ? e.attendees
                    .map((a: any) => String(a?.emailAddress?.address || "").toLowerCase())
                    .filter(Boolean)
                : [];
              const existing = byKey.get(k);
              if (existing) {
                if (!existing.internalAttendees.includes(u.name)) existing.internalAttendees.push(u.name);
                for (const ae of attendeeEmails) {
                  if (!existing.attendeeEmails.includes(ae)) existing.attendeeEmails.push(ae);
                }
              } else {
                const loc = (typeof e.location === "object" ? e.location?.displayName : e.location) || "";
                byKey.set(k, {
                  key: k,
                  subject,
                  start,
                  end: e.end?.dateTime || e.end || "",
                  isAllDay: !!e.isAllDay,
                  location: loc,
                  bodyPreview: (e.bodyPreview || "").slice(0, 280),
                  internalAttendees: [u.name],
                  attendeeEmails,
                  attendeeCount: Array.isArray(e.attendees) ? e.attendees.length : 0,
                  source: "outlook",
                });
              }
            }
          } catch { /* ignore one user's failure */ }
        }
      } catch (e: any) {
        console.warn("[hr/calendar/team-events] graph sweep failed:", e?.message);
      }
    }

    // Pull from the curated team_events table — these are explicitly tagged
    // as company events and always belong on the diary.
    try {
      const { rows: tableEvents } = await pool.query(
        `SELECT id, title, event_type, start_time, end_time, location, notes, attendees, property_name, company_name
         FROM team_events WHERE start_time >= $1 AND start_time <= $2 ORDER BY start_time ASC`,
        [now.toISOString(), horizon.toISOString()],
      );
      for (const t of tableEvents) {
        const k = `tabletbl:${t.id}`;
        byKey.set(k, {
          key: k,
          subject: t.title,
          start: t.start_time,
          end: t.end_time,
          isAllDay: false,
          location: t.location || "",
          bodyPreview: t.notes || "",
          internalAttendees: Array.isArray(t.attendees) ? t.attendees : [],
          attendeeEmails: [],
          attendeeCount: Array.isArray(t.attendees) ? t.attendees.length : 0,
          source: "team_events_table",
          teamEventId: t.id,
        });
      }
    } catch (e: any) {
      console.warn("[hr/calendar/team-events] team_events query failed:", e?.message);
    }

    // A "team event" is one of:
    //   - From the curated team_events table (always)
    //   - Has team@brucegillinghampollard.com in its attendee list
    //     (the whole-company invite — the only way the diary stops surfacing
    //     things like "1:1 with Pete" or "Investment team standup" as team events)
    const events = Array.from(byKey.values())
      .filter(e => {
        if (e.source === "team_events_table") return true;
        return e.attendeeEmails.some(a => a === COMPANY_INVITE);
      })
      .sort((a, b) => a.start.localeCompare(b.start));

    res.json({ events, scope: { start: startStr, end: endStr, days: horizonDays }, msConnected: !!token });
  });

  // Admin: nuke all salary data — salary_history rows, bonus_history rows,
  // and staff_profiles.salary_current. Used to recover from a bad spreadsheet
  // import (mis-scaled values etc.) before re-running the importer cleanly.
  app.post("/api/hr/admin/reset-salaries", requireAdmin, async (_req: any, res) => {
    try {
      const sh = await pool.query(`DELETE FROM salary_history`);
      const bh = await pool.query(`DELETE FROM bonus_history`);
      const sp = await pool.query(`UPDATE staff_profiles SET salary_current = NULL WHERE salary_current IS NOT NULL`);
      res.json({ ok: true, salaryHistoryDeleted: sh.rowCount, bonusHistoryDeleted: bh.rowCount, salariesCleared: sp.rowCount });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // ── Salary spreadsheet importer ──────────────────────────────────────────
  // Lets admins paste a SharePoint / OneDrive share link to a salary sheet
  // and pull every row into staff_profiles.salary_current + salary_history.
  // Pass dryRun=true to preview without writing.
  //
  // Header detection is fuzzy — we look for common variations (Name / Employee,
  // Salary / Current Salary, Effective Date / Date of Uplift, etc.). Whatever
  // we don't recognise comes back in the report's `unmappedColumns` so the
  // admin can see what was skipped and we iterate.
  app.post("/api/hr/import-salaries", requireAdmin, async (req: any, res) => {
    const userId = req.session?.userId || req.tokenUserId;
    const { shareUrl, dryRun } = req.body || {};
    if (!shareUrl || typeof shareUrl !== "string") {
      return res.status(400).json({ error: "shareUrl required" });
    }

    try {
      // 1. Pull the file out of SharePoint via the existing Graph helper.
      const file = await resolveSharePointShareLink(shareUrl);
      if (file.isFolder) {
        return res.status(400).json({ error: "Share link points at a folder — link the spreadsheet directly." });
      }
      const wb = XLSX.read(file.bytes, { type: "buffer", cellDates: true });

      // 2. Match all active staff once for name lookups.
      const staffRows = await pool.query(
        `SELECT u.id, u.name, sp.id AS profile_id, sp.salary_current
         FROM users u LEFT JOIN staff_profiles sp ON sp.user_id = u.id
         WHERE u.is_active = true`
      );
      const norm = (s: string) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
      const staffByName = new Map<string, any>();
      for (const s of staffRows.rows) staffByName.set(norm(s.name), s);

      // 3. Header pattern matching. First match wins per role.
      const HEADERS = {
        name:    [/^name$/i, /^employee$/i, /^staff/i, /full\s*name/i],
        salary:  [/^salary$/i, /current\s*salary/i, /annual\s*salary/i, /base\s*salary/i, /basic\s*salary/i, /salary\s*£/i, /salary\s*\(£\)/i],
        date:    [/^date$/i, /effective\s*date/i, /^from$/i, /start\s*date/i, /uplift\s*date/i, /date\s*of\s*uplift/i, /^month$/i],
        bonus:   [/^bonus$/i, /annual\s*bonus/i, /bonus\s*£/i],
        commRate:[/commission\s*rate/i, /commission\s*%/i, /comm\s*%/i, /comm\s*rate/i],
        commTier:[/commission\s*tier/i, /tier$/i],
        reason:  [/^reason$/i, /^notes?$/i, /^comments?$/i, /^reason\s*for/i],
      } as const;

      type ColMap = Partial<Record<keyof typeof HEADERS, number>>;
      const detectColumns = (headerRow: any[]): ColMap => {
        const map: ColMap = {};
        headerRow.forEach((cell, idx) => {
          const text = String(cell || "").trim();
          if (!text) return;
          for (const [role, patterns] of Object.entries(HEADERS) as Array<[keyof typeof HEADERS, readonly RegExp[]]>) {
            if (map[role] !== undefined) continue;
            if (patterns.some((p) => p.test(text))) { map[role] = idx; break; }
          }
        });
        return map;
      };

      // Money parser — strips £, commas, handles "65k" and decimals. Returns
      // pence (integer) so it slots straight into the existing schema.
      const parsePence = (raw: any): number | null => {
        if (raw == null) return null;
        if (typeof raw === "number") return Math.round(raw * 100);
        const s = String(raw).replace(/[,£\s]/g, "").trim();
        if (!s) return null;
        const kMatch = s.match(/^([\d.]+)k$/i);
        if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000 * 100);
        const n = parseFloat(s);
        return isNaN(n) ? null : Math.round(n * 100);
      };

      // Date parser — accepts ISO, UK dd/mm/yyyy, Excel serial (cellDates:true
      // gives us Date objects already, but bare strings still need parsing).
      const parseDate = (raw: any): string | null => {
        if (raw == null) return null;
        if (raw instanceof Date && !isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
        const s = String(raw).trim();
        if (!s) return null;
        const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
        const uk = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (uk) {
          let yr = parseInt(uk[3], 10);
          if (yr < 100) yr += yr >= 70 ? 1900 : 2000;
          return `${yr}-${String(uk[2]).padStart(2, "0")}-${String(uk[1]).padStart(2, "0")}`;
        }
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      };

      // 4. Walk every sheet, find a header row, parse the rows below it.
      type ParsedRow = { sheet: string; staffName: string; matchedUserId: string | null; salaryPence: number | null; effectiveDate: string | null; bonusPence: number | null; commRate: string | null; commTier: string | null; reason: string | null; rowIndex: number };
      const parsed: ParsedRow[] = [];
      const sheetReports: { sheet: string; headers: string[]; columnMap: ColMap; sampleRows: any[][]; rowsParsed: number }[] = [];

      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, blankrows: false, defval: null });
        if (rows.length < 2) continue;

        // Pick the row with the most "name-like" header signals. Some salary
        // sheets have a title row at the top before the real header.
        let headerIdx = 0;
        let headerScore = 0;
        for (let i = 0; i < Math.min(5, rows.length); i++) {
          const map = detectColumns(rows[i] as any[]);
          const score = Object.keys(map).length;
          if (score > headerScore) { headerScore = score; headerIdx = i; }
        }
        const header = (rows[headerIdx] as any[]) || [];
        const colMap = detectColumns(header);

        sheetReports.push({
          sheet: sheetName,
          headers: header.map((h) => String(h || "")),
          columnMap: colMap,
          sampleRows: rows.slice(headerIdx + 1, headerIdx + 4) as any[][],
          rowsParsed: 0,
        });

        if (colMap.name === undefined) continue; // can't import without a name column

        for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i] as any[];
          const nameRaw = row[colMap.name!];
          if (!nameRaw) continue;
          const staffName = String(nameRaw).trim();
          if (!staffName) continue;
          const matched = staffByName.get(norm(staffName));

          parsed.push({
            sheet: sheetName,
            staffName,
            matchedUserId: matched?.id || null,
            salaryPence: colMap.salary !== undefined ? parsePence(row[colMap.salary]) : null,
            effectiveDate: colMap.date !== undefined ? parseDate(row[colMap.date]) : null,
            bonusPence: colMap.bonus !== undefined ? parsePence(row[colMap.bonus]) : null,
            commRate: colMap.commRate !== undefined && row[colMap.commRate] != null ? String(row[colMap.commRate]).trim() : null,
            commTier: colMap.commTier !== undefined && row[colMap.commTier] != null ? String(row[colMap.commTier]).trim() : null,
            reason: colMap.reason !== undefined && row[colMap.reason] != null ? String(row[colMap.reason]).trim() : null,
            rowIndex: i + 1, // 1-based for human readability in the report
          });
          sheetReports[sheetReports.length - 1].rowsParsed++;
        }
      }

      // 5. Build the report and (if not dryRun) apply the writes.
      const matched = parsed.filter((r) => r.matchedUserId);
      const unmatchedNames = Array.from(new Set(parsed.filter((r) => !r.matchedUserId).map((r) => r.staffName)));
      const withSalary = matched.filter((r) => r.salaryPence != null);

      let salaryHistoryInserted = 0;
      let salaryCurrentUpdated = 0;
      let bonusHistoryInserted = 0;
      const skippedDuplicates: string[] = [];

      if (!dryRun && withSalary.length > 0) {
        // Existing history rows so we don't double-insert. Match on
        // (user_id, effective_date, salary_pence) — same triple = same record.
        const existingHistory = await pool.query(
          `SELECT user_id, effective_date, salary_pence FROM salary_history`
        );
        const existingKey = new Set<string>(
          existingHistory.rows.map((r: any) => `${r.user_id}::${r.effective_date}::${r.salary_pence}`)
        );

        // Latest-per-user so we can also update staff_profiles.salary_current.
        const latestByUser = new Map<string, ParsedRow>();
        for (const r of withSalary) {
          const cur = latestByUser.get(r.matchedUserId!);
          if (!cur) { latestByUser.set(r.matchedUserId!, r); continue; }
          const a = r.effectiveDate || "0000-00-00";
          const b = cur.effectiveDate || "0000-00-00";
          if (a > b) latestByUser.set(r.matchedUserId!, r);
        }

        for (const r of withSalary) {
          const eff = r.effectiveDate || new Date().toISOString().slice(0, 10);
          const key = `${r.matchedUserId}::${eff}::${r.salaryPence}`;
          if (existingKey.has(key)) {
            skippedDuplicates.push(`${r.staffName} @ ${eff}`);
          } else {
            const reason = r.reason || "imported from spreadsheet";
            const notes = [
              r.commRate ? `commission rate: ${r.commRate}` : null,
              r.commTier ? `tier: ${r.commTier}` : null,
            ].filter(Boolean).join(" · ") || null;
            await pool.query(
              `INSERT INTO salary_history (user_id, salary_pence, effective_date, reason, notes, recorded_by)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [r.matchedUserId, r.salaryPence, eff, reason, notes, userId]
            );
            existingKey.add(key);
            salaryHistoryInserted++;
          }

          // Bonuses get their own row in bonus_history. Dedup is on
          // (user_id, effective_date, amount_pence, kind) so re-running the
          // import never double-inserts. Done in the same loop so the bonus
          // shares the row's effective date with the salary uplift.
          if (r.bonusPence && r.bonusPence > 0) {
            await pool.query(
              `INSERT INTO bonus_history (user_id, amount_pence, effective_date, kind, reason, recorded_by)
               VALUES ($1, $2, $3, 'bonus', $4, $5)
               ON CONFLICT (user_id, effective_date, amount_pence, kind) DO NOTHING`,
              [r.matchedUserId, r.bonusPence, eff, "imported from spreadsheet", userId]
            );
            bonusHistoryInserted++;
          }
        }

        for (const [uid, latest] of latestByUser.entries()) {
          await pool.query(
            `INSERT INTO staff_profiles (user_id, salary_current, status)
             VALUES ($1, $2, 'active')
             ON CONFLICT (user_id) DO UPDATE SET
               salary_current = EXCLUDED.salary_current,
               updated_at = now()`,
            [uid, latest.salaryPence]
          );
          salaryCurrentUpdated++;
        }
      }

      res.json({
        ok: true,
        dryRun: !!dryRun,
        filename: file.filename,
        sheetsScanned: sheetReports.length,
        sheets: sheetReports,
        rowsParsed: parsed.length,
        rowsMatched: matched.length,
        rowsWithSalary: withSalary.length,
        unmatchedNames,
        salaryHistoryInserted,
        bonusHistoryInserted,
        salaryCurrentUpdated,
        skippedDuplicates,
        // Sample of what we'd write — first 5 mapped rows so admins can sanity-check.
        sample: matched.slice(0, 5).map((r) => ({
          staffName: r.staffName,
          salary: r.salaryPence != null ? `£${(r.salaryPence/100).toLocaleString()}` : null,
          effectiveDate: r.effectiveDate,
          bonus: r.bonusPence != null ? `£${(r.bonusPence/100).toLocaleString()}` : null,
          commission: r.commRate || r.commTier || null,
          reason: r.reason,
        })),
      });
    } catch (e: any) {
      console.error("[hr] import-salaries error:", e);
      res.status(500).json({ error: e?.message || "Import failed" });
    }
  });
}
