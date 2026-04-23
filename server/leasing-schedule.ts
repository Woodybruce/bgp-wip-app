import { Router, Request, Response } from "express";
import multer from "multer";
import { requireAuth } from "./auth";
import { callClaude, CHATBGP_HELPER_MODEL, safeParseJSON } from "./utils/anthropic-client";

const router = Router();

const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

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

async function checkPropertyAccess(pool: any, req: Request, propertyId: string): Promise<{ allowed: boolean; user: any }> {
  const user = await getUserInfo(pool, req);
  if (!user) return { allowed: false, user: null };
  if (user.is_admin) return { allowed: true, user };

  const privacyCheck = await pool.query(
    "SELECT leasing_privacy_enabled FROM crm_properties WHERE id = $1",
    [propertyId]
  );
  if (!privacyCheck.rows[0]?.leasing_privacy_enabled) return { allowed: true, user };

  const agentCheck = await pool.query(
    "SELECT id FROM crm_property_agents WHERE property_id = $1 AND user_id = $2",
    [propertyId, user.id]
  );
  return { allowed: agentCheck.rows.length > 0, user };
}

async function logAudit(pool: any, params: {
  unitId?: string; propertyId: string; userId: string; userName: string;
  action: string; fieldName?: string; oldValue?: string; newValue?: string;
}) {
  await pool.query(
    `INSERT INTO leasing_schedule_audit (unit_id, property_id, user_id, user_name, action, field_name, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [params.unitId || null, params.propertyId, params.userId, params.userName,
     params.action, params.fieldName || null, params.oldValue || null, params.newValue || null]
  );
}

router.get("/api/leasing-schedule/properties", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const user = await getUserInfo(pool, req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    let query = `
      SELECT p.id, p.name, p.address, p.asset_class, p.bgp_engagement,
        p.leasing_privacy_enabled,
        c.name as landlord_name, c.id as landlord_id,
        COUNT(CASE WHEN u.status != 'Archived' THEN 1 END)::int as unit_count,
        COUNT(CASE WHEN u.status = 'Occupied' THEN 1 END)::int as occupied_count,
        COUNT(CASE WHEN u.status = 'Vacant' THEN 1 END)::int as vacant_count,
        COUNT(CASE WHEN u.lease_expiry IS NOT NULL AND u.lease_expiry < NOW() + INTERVAL '12 months' AND u.status != 'Archived' THEN 1 END)::int as expiring_soon
      FROM crm_properties p
      JOIN leasing_schedule_units u ON u.property_id = p.id
      LEFT JOIN crm_companies c ON p.landlord_id = c.id
    `;

    if (!user.is_admin) {
      query += `
        WHERE (p.leasing_privacy_enabled = FALSE OR p.leasing_privacy_enabled IS NULL
          OR EXISTS (SELECT 1 FROM crm_property_agents pa WHERE pa.property_id = p.id AND pa.user_id = $1))
      `;
    }

    query += `
      GROUP BY p.id, p.name, p.address, p.asset_class, p.bgp_engagement, p.leasing_privacy_enabled, c.name, c.id
      ORDER BY p.name
    `;

    const result = await pool.query(query, user.is_admin ? [] : [user.id]);
    res.json(result.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/leasing-schedule/property/:propertyId", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { allowed } = await checkPropertyAccess(pool, req, req.params.propertyId);
    if (!allowed) return res.status(403).json({ error: "You do not have access to this property's leasing schedule" });

    const result = await pool.query(`
      SELECT u.*, p.name as property_name, p.leasing_privacy_enabled, c.name as landlord_name
      FROM leasing_schedule_units u
      JOIN crm_properties p ON u.property_id = p.id
      LEFT JOIN crm_companies c ON p.landlord_id = c.id
      WHERE u.property_id = $1
      ORDER BY u.sort_order, u.zone, u.unit_name
    `, [req.params.propertyId]);
    res.json(result.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/leasing-schedule/company/:companyId", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const user = await getUserInfo(pool, req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    let query = `
      SELECT u.*, p.name as property_name
      FROM leasing_schedule_units u
      JOIN crm_properties p ON u.property_id = p.id
      WHERE p.landlord_id = $1
    `;

    if (!user.is_admin) {
      query += `
        AND (p.leasing_privacy_enabled = FALSE OR p.leasing_privacy_enabled IS NULL
          OR EXISTS (SELECT 1 FROM crm_property_agents pa WHERE pa.property_id = p.id AND pa.user_id = $2))
      `;
    }

    query += ` ORDER BY p.name, u.sort_order, u.zone, u.unit_name`;

    const result = await pool.query(query, user.is_admin ? [req.params.companyId] : [req.params.companyId, user.id]);
    res.json(result.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/api/leasing-schedule/unit/:id", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();

    const unitCheck = await pool.query("SELECT * FROM leasing_schedule_units WHERE id = $1", [req.params.id]);
    if (unitCheck.rows.length === 0) return res.status(404).json({ error: "Unit not found" });
    const existingUnit = unitCheck.rows[0];

    const { allowed, user } = await checkPropertyAccess(pool, req, existingUnit.property_id);
    if (!allowed) return res.status(403).json({ error: "Access denied" });

    const allowedFields = [
      "zone", "positioning", "unit_name", "tenant_name", "agent_initials",
      "lease_expiry", "lease_break", "rent_review", "landlord_break",
      "rent_pa", "sqft", "mat_psqft", "lfl_percent", "occ_cost_percent",
      "financial_notes", "target_brands", "optimum_target", "priority", "status", "updates",
      "target_company_ids"
    ];

    const setClauses: string[] = [];
    const values: any[] = [req.params.id];
    let paramIdx = 2;

    for (const field of allowedFields) {
      if (field in req.body) {
        const val = req.body[field];
        const newVal = val === "" ? null : val;
        setClauses.push(`${field} = $${paramIdx}`);
        values.push(newVal);
        paramIdx++;

        const oldVal = existingUnit[field];
        if (String(oldVal ?? "") !== String(newVal ?? "")) {
          await logAudit(pool, {
            unitId: req.params.id,
            propertyId: existingUnit.property_id,
            userId: user.id,
            userName: user.username,
            action: "update",
            fieldName: field,
            oldValue: oldVal != null ? String(oldVal) : null,
            newValue: newVal != null ? String(newVal) : null,
          });
        }
      }
    }

    if (setClauses.length === 0) return res.status(400).json({ error: "No fields to update" });

    setClauses.push("updated_at = NOW()");

    const result = await pool.query(
      `UPDATE leasing_schedule_units SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/leasing-schedule/unit", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { property_id, zone, positioning, unit_name, tenant_name, agent_initials, lease_expiry,
      lease_break, rent_review, landlord_break, rent_pa, sqft, mat_psqft, lfl_percent,
      occ_cost_percent, target_brands, optimum_target, priority, status, updates } = req.body;

    if (!property_id || !unit_name) return res.status(400).json({ error: "property_id and unit_name required" });

    const { allowed, user } = await checkPropertyAccess(pool, req, property_id);
    if (!allowed) return res.status(403).json({ error: "Access denied" });

    const maxSort = await pool.query(
      "SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM leasing_schedule_units WHERE property_id = $1", [property_id]);

    const result = await pool.query(`
      INSERT INTO leasing_schedule_units
        (property_id, zone, positioning, unit_name, tenant_name, agent_initials, lease_expiry,
         lease_break, rent_review, landlord_break, rent_pa, sqft, mat_psqft, lfl_percent,
         occ_cost_percent, target_brands, optimum_target, priority, status, updates, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      RETURNING *
    `, [property_id, zone || null, positioning || null, unit_name, tenant_name || unit_name,
      agent_initials || null, lease_expiry || null, lease_break || null, rent_review || null,
      landlord_break || null, rent_pa || null, sqft || null, mat_psqft || null,
      lfl_percent || null, occ_cost_percent || null, target_brands || null,
      optimum_target || null, priority || null, status || 'Occupied', updates || null,
      maxSort.rows[0].next]);

    await logAudit(pool, {
      unitId: result.rows[0].id?.toString(),
      propertyId: property_id,
      userId: user.id,
      userName: user.username,
      action: "create",
      fieldName: "unit_name",
      newValue: unit_name,
    });

    res.json(result.rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/api/leasing-schedule/units/:id/archive", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();

    const unitCheck = await pool.query("SELECT * FROM leasing_schedule_units WHERE id = $1", [req.params.id]);
    if (unitCheck.rows.length === 0) return res.status(404).json({ error: "Unit not found" });
    const unit = unitCheck.rows[0];

    const { allowed, user } = await checkPropertyAccess(pool, req, unit.property_id);
    if (!allowed) return res.status(403).json({ error: "Access denied" });

    const newStatus = unit.status === "Archived" ? "Vacant" : "Archived";
    await pool.query("UPDATE leasing_schedule_units SET status = $2 WHERE id = $1", [req.params.id, newStatus]);

    await logAudit(pool, {
      unitId: req.params.id,
      propertyId: unit.property_id,
      userId: user.id,
      userName: user.username,
      action: newStatus === "Archived" ? "archive" : "unarchive",
      fieldName: "status",
      oldValue: unit.status,
      newValue: newStatus,
    });

    res.json({ success: true, status: newStatus });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/api/leasing-schedule/unit/:id", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();

    const unitCheck = await pool.query("SELECT * FROM leasing_schedule_units WHERE id = $1", [req.params.id]);
    if (unitCheck.rows.length === 0) return res.status(404).json({ error: "Unit not found" });
    const unit = unitCheck.rows[0];

    const { allowed, user } = await checkPropertyAccess(pool, req, unit.property_id);
    if (!allowed) return res.status(403).json({ error: "Access denied" });

    await pool.query("DELETE FROM leasing_schedule_units WHERE id = $1", [req.params.id]);

    await logAudit(pool, {
      unitId: req.params.id,
      propertyId: unit.property_id,
      userId: user.id,
      userName: user.username,
      action: "delete",
      fieldName: "unit_name",
      oldValue: unit.unit_name,
    });

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/leasing-schedule/import", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { property_id, units } = req.body;
    if (!property_id || !Array.isArray(units)) return res.status(400).json({ error: "property_id and units[] required" });

    const { allowed, user } = await checkPropertyAccess(pool, req, property_id);
    if (!allowed) return res.status(403).json({ error: "Access denied" });

    let count = 0;
    for (const u of units) {
      await pool.query(`
        INSERT INTO leasing_schedule_units
          (property_id, zone, positioning, unit_name, tenant_name, agent_initials, lease_expiry,
           lease_break, rent_review, landlord_break, rent_pa, sqft, mat_psqft, lfl_percent,
           occ_cost_percent, financial_notes, target_brands, optimum_target, priority, status,
           updates, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      `, [property_id, u.zone, u.positioning, u.unit_name, u.tenant_name || u.unit_name,
        u.agent_initials, u.lease_expiry || null, u.lease_break || null, u.rent_review || null,
        u.landlord_break || null, u.rent_pa ?? null, u.sqft ?? null, u.mat_psqft, u.lfl_percent,
        u.occ_cost_percent, u.financial_notes || null, u.target_brands, u.optimum_target,
        u.priority, u.status || 'Occupied', u.updates, u.sort_order || count]);
      count++;
    }

    await logAudit(pool, {
      propertyId: property_id,
      userId: user.id,
      userName: user.username,
      action: "import",
      newValue: `${count} units imported`,
    });

    res.json({ success: true, imported: count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Upload a landlord leasing schedule .xlsx and let Haiku map its columns
// to our unit schema. Returns a preview; the caller then POSTs to /import
// with the confirmed units.
router.post(
  "/api/leasing-schedule/property/:propertyId/parse-excel",
  requireAuth,
  xlsxUpload.single("file"),
  async (req, res) => {
    try {
      const pool = await getPool();
      const propertyId = req.params.propertyId;
      const { allowed, user } = await checkPropertyAccess(pool, req, propertyId);
      if (!allowed) return res.status(403).json({ error: "Access denied" });
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      if (!req.file) return res.status(400).json({ error: "file required" });

      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(req.file.buffer as any);

      // Flatten: take every sheet, every row, into a matrix of strings.
      const sheets: { name: string; rows: string[][] }[] = [];
      wb.eachSheet((ws) => {
        const rows: string[][] = [];
        ws.eachRow({ includeEmpty: false }, (row) => {
          const vals: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            const v = cell.value;
            if (v == null) vals.push("");
            else if (typeof v === "object" && "text" in (v as any)) vals.push(String((v as any).text || ""));
            else if (v instanceof Date) vals.push((v as Date).toISOString().slice(0, 10));
            else vals.push(String(v));
          });
          rows.push(vals);
        });
        if (rows.length > 0) sheets.push({ name: ws.name, rows });
      });

      if (sheets.length === 0) return res.status(400).json({ error: "No sheets with data" });

      // Pick the sheet with the most rows as the primary schedule.
      const primary = sheets.reduce((a, b) => (a.rows.length >= b.rows.length ? a : b));

      // Cap rows sent to the model — schedules rarely exceed 200 units.
      const capped = primary.rows.slice(0, 250);
      const csvPreview = capped.map((r) => r.join(" | ")).join("\n").slice(0, 18000);

      const prompt = `You will receive a landlord leasing schedule exported from Excel. Map each data row to our unit schema.

Columns in our schema (all optional except unit_name):
- unit_name: short label like "Unit 1", "G-01", "Suite 4B"
- tenant_name: current occupier (or "Vacant" / blank if void)
- sqft: numeric, convert sq m to sq ft if needed (1 sqm = 10.7639 sqft)
- rent_pa: annual rent in £ (numeric, no £ sign)
- lease_expiry: ISO date YYYY-MM-DD
- lease_break: ISO date YYYY-MM-DD (tenant break)
- rent_review: ISO date YYYY-MM-DD
- landlord_break: ISO date YYYY-MM-DD
- status: "Occupied" | "Vacant" | "Under Offer" | "In Solicitors"
- zone: floor/level/zone (e.g. "Ground", "L1", "Mall")
- positioning: category (e.g. "F&B", "Fashion", "Beauty")
- updates: short note on any special terms

Rules:
- Skip header rows, subtotals, blank rows, "Total" rows.
- If a column doesn't exist in the source, leave it null.
- Dates may be UK format (DD/MM/YYYY) — convert to ISO.
- Currency strings like "£125,000" → 125000.
- "Sq ft", "sqm", "NIA", "GIA" all map to sqft (convert sqm).
- If a row has a tenant name but no unit label, synthesise one (e.g. "Unit 1", "Unit 2" in order).

Return JSON only:
{"units":[{"unit_name":"...","tenant_name":"...","sqft":123,"rent_pa":125000,"lease_expiry":"2028-06-24",...}]}

Spreadsheet (tab: "${primary.name}"), pipe-separated:
${csvPreview}`;

      const ai = await callClaude({
        model: CHATBGP_HELPER_MODEL,
        max_completion_tokens: 6000,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = ai.choices?.[0]?.message?.content || "";
      const parsed = safeParseJSON(raw);
      const units = Array.isArray(parsed?.units) ? parsed.units : [];

      res.json({
        sheetName: primary.name,
        sheetCount: sheets.length,
        rowsScanned: capped.length,
        units,
      });
    } catch (e: any) {
      console.error("[leasing-schedule] parse-excel error:", e.message);
      res.status(500).json({ error: e.message });
    }
  },
);

// Parse a workbook that contains multiple schemes (one per sheet) — no property ID
// required at this stage. Returns a preview list; client maps each sheet to a
// property then POSTs /import-multi to commit.
router.post(
  "/api/leasing-schedule/parse-excel-multi",
  requireAuth,
  xlsxUpload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "file required" });

      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(req.file.buffer as any);

      const sheets: { name: string; rows: string[][]; state: string }[] = [];
      wb.eachSheet((ws) => {
        const rows: string[][] = [];
        ws.eachRow({ includeEmpty: false }, (row) => {
          const vals: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            const v = cell.value;
            if (v == null) vals.push("");
            else if (typeof v === "object" && "text" in (v as any)) vals.push(String((v as any).text || ""));
            else if (v instanceof Date) vals.push((v as Date).toISOString().slice(0, 10));
            else if (typeof v === "object" && "result" in (v as any)) vals.push(String((v as any).result ?? ""));
            else if (typeof v === "object" && "richText" in (v as any)) {
              vals.push(((v as any).richText || []).map((r: any) => r.text).join(""));
            } else vals.push(String(v));
          });
          rows.push(vals);
        });
        // Keep every non-empty sheet — even 1-2 row sheets. Filtering here was
        // silently hiding tabs the user expects to see.
        if (rows.length >= 1) sheets.push({ name: ws.name, rows, state: (ws as any).state || "visible" });
      });

      console.log(`[leasing-schedule] parse-excel-multi: workbook has ${sheets.length} non-empty sheet(s): ${sheets.map(s => `${s.name}(${s.rows.length}r,${s.state})`).join(", ")}`);

      if (sheets.length === 0) return res.status(400).json({ error: "No sheets with data" });

      // Process sheets with bounded concurrency — firing 20 parallel Claude calls
      // hits rate limits and some come back empty/429. A cap of 3 is plenty
      // fast (most workbooks finish in 5-15s) without tripping limits.
      const CONCURRENCY = 3;
      type SchemeResult = {
        sheetName: string;
        schemeHint: string;
        rowsScanned: number;
        units: any[];
        skipped?: boolean;
        skipReason?: string;
        error?: string;
      };
      const schemes: SchemeResult[] = new Array(sheets.length);

      async function processOne(index: number): Promise<void> {
        const sheet = sheets[index];
        const capped = sheet.rows.slice(0, 250);
        const csvPreview = capped.map((r) => r.join(" | ")).join("\n").slice(0, 18000);

        // Very small sheets rarely hold a schedule — keep them in the list but
        // mark as skipped so the user can still see them.
        if (sheet.rows.length < 2) {
          schemes[index] = {
            sheetName: sheet.name,
            schemeHint: sheet.name,
            rowsScanned: capped.length,
            units: [],
            skipped: true,
            skipReason: "Sheet has fewer than 2 rows — likely a cover page",
          };
          return;
        }

        const prompt = `You will receive a landlord leasing schedule exported from Excel. Map each data row to our unit schema.

Columns in our schema (all optional except unit_name):
- unit_name: short label like "Unit 1", "G-01", "Suite 4B"
- tenant_name: current occupier (or "Vacant" / blank if void)
- sqft: numeric, convert sq m to sq ft if needed (1 sqm = 10.7639 sqft)
- rent_pa: annual rent in £ (numeric, no £ sign)
- lease_expiry: ISO date YYYY-MM-DD
- lease_break: ISO date YYYY-MM-DD (tenant break)
- rent_review: ISO date YYYY-MM-DD
- landlord_break: ISO date YYYY-MM-DD
- status: "Occupied" | "Vacant" | "Under Offer" | "In Solicitors"
- zone: floor/level/zone (e.g. "Ground", "L1", "Mall")
- positioning: category (e.g. "F&B", "Fashion", "Beauty")
- updates: short note on any special terms

Rules:
- Skip header rows, subtotals, blank rows, "Total" rows.
- If a column doesn't exist in the source, leave it null.
- Dates may be UK format (DD/MM/YYYY) — convert to ISO.
- Currency strings like "£125,000" → 125000.
- "Sq ft", "sqm", "NIA", "GIA" all map to sqft (convert sqm).
- If a row has a tenant name but no unit label, synthesise one (e.g. "Unit 1", "Unit 2" in order).
- Also try to infer a scheme/property name from the header rows or sheet title — return as scheme_hint.
- Be generous: if the sheet contains ANY list of tenants/units/rents, extract them. Err on the side of returning rows rather than an empty list.

Return JSON only:
{"scheme_hint":"optional scheme name from the sheet","units":[{"unit_name":"...","tenant_name":"...","sqft":123,"rent_pa":125000,"lease_expiry":"2028-06-24",...}]}

If the sheet is a cover page / contents / summary with no unit list, return {"scheme_hint":"${sheet.name}","units":[]}.

Spreadsheet (tab: "${sheet.name}"), pipe-separated:
${csvPreview}`;

        try {
          const ai = await callClaude({
            model: CHATBGP_HELPER_MODEL,
            max_completion_tokens: 6000,
            temperature: 0,
            messages: [{ role: "user", content: prompt }],
          });
          const raw = ai.choices?.[0]?.message?.content || "";
          let parsed: any = null;
          try {
            parsed = safeParseJSON(raw);
          } catch (pe: any) {
            console.warn(`[leasing-schedule] parse-excel-multi: sheet "${sheet.name}" returned unparseable JSON: ${pe.message}. Raw head: ${raw.slice(0, 200)}`);
          }
          const units = Array.isArray(parsed?.units) ? parsed.units : [];
          const schemeHint = typeof parsed?.scheme_hint === "string" && parsed.scheme_hint.trim()
            ? parsed.scheme_hint.trim()
            : sheet.name;
          schemes[index] = {
            sheetName: sheet.name,
            schemeHint,
            rowsScanned: capped.length,
            units,
            ...(units.length === 0 ? { skipped: true, skipReason: "AI found no unit rows on this sheet" } : {}),
          };
          console.log(`[leasing-schedule] parse-excel-multi: sheet "${sheet.name}" → ${units.length} unit(s)`);
        } catch (e: any) {
          console.error(`[leasing-schedule] parse-excel-multi: sheet "${sheet.name}" errored:`, e?.message);
          schemes[index] = {
            sheetName: sheet.name,
            schemeHint: sheet.name,
            rowsScanned: capped.length,
            units: [],
            error: e?.message || "Unknown error",
          };
        }
      }

      // Worker pool
      let nextIndex = 0;
      const workers: Promise<void>[] = [];
      for (let w = 0; w < Math.min(CONCURRENCY, sheets.length); w++) {
        workers.push((async () => {
          while (true) {
            const i = nextIndex++;
            if (i >= sheets.length) return;
            await processOne(i);
          }
        })());
      }
      await Promise.all(workers);

      // Return EVERY sheet — including skipped/errored ones — so the user can
      // see what happened. The client decides what to show as mappable.
      res.json({
        sheetCount: sheets.length,
        schemes,
      });
    } catch (e: any) {
      console.error("[leasing-schedule] parse-excel-multi error:", e.message);
      res.status(500).json({ error: e.message });
    }
  },
);

// Commit multiple scheme → property mappings in one transaction-ish pass.
// Each mapping: { property_id, units }. Skips mappings where property_id is blank.
router.post("/api/leasing-schedule/import-multi", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const imports: Array<{ property_id: string; units: any[] }> = Array.isArray(req.body?.imports) ? req.body.imports : [];
    if (imports.length === 0) return res.status(400).json({ error: "imports[] required" });

    const results: Array<{ property_id: string; imported: number; error?: string }> = [];
    let grandTotal = 0;

    for (const imp of imports) {
      if (!imp.property_id || !Array.isArray(imp.units) || imp.units.length === 0) continue;

      const { allowed, user } = await checkPropertyAccess(pool, req, imp.property_id);
      if (!allowed) {
        results.push({ property_id: imp.property_id, imported: 0, error: "Access denied" });
        continue;
      }

      try {
        let count = 0;
        for (const u of imp.units) {
          await pool.query(`
            INSERT INTO leasing_schedule_units
              (property_id, zone, positioning, unit_name, tenant_name, agent_initials, lease_expiry,
               lease_break, rent_review, landlord_break, rent_pa, sqft, mat_psqft, lfl_percent,
               occ_cost_percent, financial_notes, target_brands, optimum_target, priority, status,
               updates, sort_order)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
          `, [imp.property_id, u.zone, u.positioning, u.unit_name, u.tenant_name || u.unit_name,
            u.agent_initials, u.lease_expiry || null, u.lease_break || null, u.rent_review || null,
            u.landlord_break || null, u.rent_pa ?? null, u.sqft ?? null, u.mat_psqft, u.lfl_percent,
            u.occ_cost_percent, u.financial_notes || null, u.target_brands, u.optimum_target,
            u.priority, u.status || 'Occupied', u.updates, u.sort_order || count]);
          count++;
        }
        await logAudit(pool, {
          propertyId: imp.property_id,
          userId: user!.id,
          userName: user!.username,
          action: "import",
          newValue: `${count} units imported (multi-scheme)`,
        });
        grandTotal += count;
        results.push({ property_id: imp.property_id, imported: count });
      } catch (e: any) {
        results.push({ property_id: imp.property_id, imported: 0, error: e.message });
      }
    }

    res.json({ success: true, totalImported: grandTotal, results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/api/leasing-schedule/property/:propertyId/privacy", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { allowed, user } = await checkPropertyAccess(pool, req, req.params.propertyId);
    if (!allowed) return res.status(403).json({ error: "Access denied" });

    const { enabled } = req.body;
    await pool.query(
      "UPDATE crm_properties SET leasing_privacy_enabled = $1 WHERE id = $2",
      [!!enabled, req.params.propertyId]
    );

    await logAudit(pool, {
      propertyId: req.params.propertyId,
      userId: user.id,
      userName: user.username,
      action: "privacy_toggle",
      fieldName: "leasing_privacy_enabled",
      newValue: enabled ? "ON" : "OFF",
    });

    res.json({ success: true, privacy_enabled: !!enabled });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/leasing-schedule/property/:propertyId/privacy", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.query(
      "SELECT leasing_privacy_enabled FROM crm_properties WHERE id = $1",
      [req.params.propertyId]
    );
    const agents = await pool.query(
      `SELECT pa.user_id, u.username FROM crm_property_agents pa
       JOIN users u ON pa.user_id = u.id
       WHERE pa.property_id = $1`,
      [req.params.propertyId]
    );
    res.json({
      privacy_enabled: result.rows[0]?.leasing_privacy_enabled || false,
      assigned_agents: agents.rows,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/leasing-schedule/property/:propertyId/audit", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { allowed } = await checkPropertyAccess(pool, req, req.params.propertyId);
    if (!allowed) return res.status(403).json({ error: "Access denied" });

    const result = await pool.query(
      `SELECT * FROM leasing_schedule_audit
       WHERE property_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [req.params.propertyId]
    );
    res.json(result.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/leasing-schedule/property/:propertyId/export", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { allowed } = await checkPropertyAccess(pool, req, req.params.propertyId);
    if (!allowed) return res.status(403).json({ error: "Export denied — you do not have access to this property" });

    const result = await pool.query(`
      SELECT u.unit_name, u.zone, u.positioning, u.tenant_name, u.agent_initials, u.status,
        u.lease_expiry, u.lease_break, u.rent_review, u.landlord_break,
        u.rent_pa, u.sqft, u.mat_psqft, u.lfl_percent, u.occ_cost_percent,
        u.target_brands, u.optimum_target, u.priority, u.updates
      FROM leasing_schedule_units u
      WHERE u.property_id = $1
      ORDER BY u.sort_order, u.zone, u.unit_name
    `, [req.params.propertyId]);

    const user = await getUserInfo(pool, req);
    if (user) {
      await logAudit(pool, {
        propertyId: req.params.propertyId,
        userId: user.id,
        userName: user.username,
        action: "export",
        newValue: `${result.rows.length} units exported`,
      });
    }

    res.json(result.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/leasing-schedule/property/:propertyId/targets", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { allowed } = await checkPropertyAccess(pool, req, req.params.propertyId);
    if (!allowed) return res.status(403).json({ error: "Access denied" });

    const result = await pool.query(
      `SELECT t.*, c.name as company_name, c.domain as company_domain
       FROM target_tenants t
       LEFT JOIN crm_companies c ON t.company_id = c.id
       WHERE t.property_id = $1
       ORDER BY t.unit_id, 
         CASE t.quality_rating WHEN 'green' THEN 1 WHEN 'amber' THEN 2 WHEN 'red' THEN 3 END,
         t.created_at`,
      [req.params.propertyId]
    );
    res.json(result.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/leasing-schedule/unit/:unitId/targets", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const unitCheck = await pool.query("SELECT property_id FROM leasing_schedule_units WHERE id = $1", [req.params.unitId]);
    if (unitCheck.rows.length === 0) return res.status(404).json({ error: "Unit not found" });

    const { allowed } = await checkPropertyAccess(pool, req, unitCheck.rows[0].property_id);
    if (!allowed) return res.status(403).json({ error: "Access denied" });

    const result = await pool.query(
      `SELECT t.*, c.name as company_name, c.domain as company_domain
       FROM target_tenants t
       LEFT JOIN crm_companies c ON t.company_id = c.id
       WHERE t.unit_id = $1
       ORDER BY CASE t.quality_rating WHEN 'green' THEN 1 WHEN 'amber' THEN 2 WHEN 'red' THEN 3 END, t.created_at`,
      [req.params.unitId]
    );
    res.json(result.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/leasing-schedule/unit/:unitId/targets", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const unitCheck = await pool.query("SELECT property_id FROM leasing_schedule_units WHERE id = $1", [req.params.unitId]);
    if (unitCheck.rows.length === 0) return res.status(404).json({ error: "Unit not found" });

    const { allowed, user } = await checkPropertyAccess(pool, req, unitCheck.rows[0].property_id);
    if (!allowed) return res.status(403).json({ error: "Access denied" });

    const { brand_name, company_id, quality_rating, rationale } = req.body;
    if (!brand_name) return res.status(400).json({ error: "brand_name required" });

    const validRatings = ["green", "amber", "red"];
    const rating = validRatings.includes(quality_rating) ? quality_rating : "amber";

    const result = await pool.query(
      `INSERT INTO target_tenants (unit_id, property_id, company_id, brand_name, rationale, quality_rating, suggested_by, approved_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7, 'approved')
       RETURNING *`,
      [req.params.unitId, unitCheck.rows[0].property_id, company_id || null,
       brand_name, rationale || null, rating, user?.id]
    );

    await logAudit(pool, {
      unitId: req.params.unitId, propertyId: unitCheck.rows[0].property_id,
      userId: user.id, userName: user.username, action: "add_target",
      fieldName: "target_tenant", newValue: brand_name,
    });

    res.json(result.rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/api/leasing-schedule/target/:id", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const targetCheck = await pool.query("SELECT * FROM target_tenants WHERE id = $1", [req.params.id]);
    if (targetCheck.rows.length === 0) return res.status(404).json({ error: "Target not found" });
    const target = targetCheck.rows[0];

    const { allowed, user } = await checkPropertyAccess(pool, req, target.property_id);
    if (!allowed) return res.status(403).json({ error: "Access denied" });

    const validRatings = ["green", "amber", "red"];
    const validStatuses = ["suggested", "approved", "rejected", "converted"];
    const validOutcomes = [null, "signed", "passed", "withdrawn"];

    if (req.body.quality_rating && !validRatings.includes(req.body.quality_rating)) {
      return res.status(400).json({ error: "Invalid quality_rating" });
    }
    if (req.body.status && !validStatuses.includes(req.body.status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const allowedFields = ["quality_rating", "status", "outcome", "company_id", "brand_name", "rationale"];
    const setClauses: string[] = ["updated_at = NOW()"];
    const values: any[] = [req.params.id];
    let paramIdx = 2;

    for (const field of allowedFields) {
      if (field in req.body) {
        setClauses.push(`${field} = $${paramIdx}`);
        values.push(req.body[field]);
        paramIdx++;
      }
    }

    if (req.body.status === "approved" && user) {
      setClauses.push(`approved_by = $${paramIdx}`);
      values.push(user.id);
      paramIdx++;
    }

    const result = await pool.query(
      `UPDATE target_tenants SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
      values
    );

    await logAudit(pool, {
      unitId: target.unit_id, propertyId: target.property_id,
      userId: user.id, userName: user.username, action: "update_target",
      fieldName: Object.keys(req.body).join(","),
      oldValue: target.status, newValue: req.body.status || req.body.quality_rating || "",
    });

    res.json(result.rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/api/leasing-schedule/target/:id", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const targetCheck = await pool.query("SELECT * FROM target_tenants WHERE id = $1", [req.params.id]);
    if (targetCheck.rows.length === 0) return res.status(404).json({ error: "Target not found" });
    const target = targetCheck.rows[0];

    const { allowed, user } = await checkPropertyAccess(pool, req, target.property_id);
    if (!allowed) return res.status(403).json({ error: "Access denied" });

    await pool.query("DELETE FROM target_tenants WHERE id = $1", [req.params.id]);

    await logAudit(pool, {
      unitId: target.unit_id, propertyId: target.property_id,
      userId: user.id, userName: user.username, action: "delete_target",
      fieldName: "target_tenant", oldValue: target.brand_name,
    });

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/leasing-schedule/unit/:unitId/generate-targets", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const unitCheck = await pool.query(
      `SELECT u.*, p.name as property_name, p.address as property_address, p.asset_class,
        c.name as landlord_name
       FROM leasing_schedule_units u
       JOIN crm_properties p ON u.property_id = p.id
       LEFT JOIN crm_companies c ON p.landlord_id = c.id
       WHERE u.id = $1`,
      [req.params.unitId]
    );
    if (unitCheck.rows.length === 0) return res.status(404).json({ error: "Unit not found" });
    const unit = unitCheck.rows[0];

    const { allowed, user } = await checkPropertyAccess(pool, req, unit.property_id);
    if (!allowed) return res.status(403).json({ error: "Access denied" });

    const siblingUnits = await pool.query(
      `SELECT unit_name, tenant_name, zone, positioning, status, sqft FROM leasing_schedule_units
       WHERE property_id = $1 AND id != $2 ORDER BY sort_order`,
      [unit.property_id, req.params.unitId]
    );

    const existingTargets = await pool.query(
      "SELECT brand_name, quality_rating, status, outcome FROM target_tenants WHERE property_id = $1",
      [unit.property_id]
    );

    const outcomes = await pool.query(
      `SELECT t.brand_name, t.quality_rating, t.outcome, t.status, u.unit_name, p.name as property_name
       FROM target_tenants t
       JOIN leasing_schedule_units u ON t.unit_id = u.id
       JOIN crm_properties p ON t.property_id = p.id
       WHERE t.outcome IS NOT NULL
       ORDER BY t.updated_at DESC LIMIT 50`
    );

    const tenantMix = siblingUnits.rows
      .filter((u: any) => u.status === "Occupied" && u.tenant_name)
      .map((u: any) => `${u.tenant_name} (${u.zone || ""}/${u.positioning || ""}, ${u.sqft || "?"} sqft)`)
      .join(", ");

    const existingTargetsList = existingTargets.rows
      .map((t: any) => `${t.brand_name} [${t.quality_rating}/${t.status}${t.outcome ? `→${t.outcome}` : ""}]`)
      .join(", ");

    const outcomeContext = outcomes.rows.length > 0
      ? `\n\nHISTORICAL OUTCOMES (learn from these):\n${outcomes.rows.map((o: any) =>
          `- ${o.brand_name} at ${o.property_name}/${o.unit_name}: rated ${o.quality_rating}, outcome: ${o.outcome}`
        ).join("\n")}`
      : "";

    const propertyAddr = typeof unit.property_address === "object"
      ? [unit.property_address?.street, unit.property_address?.city, unit.property_address?.postcode].filter(Boolean).join(", ")
      : unit.property_address || "";

    const prompt = `You are a UK commercial property leasing advisor for Bruce Gillingham Pollard (BGP), specialising in retail, leisure and F&B tenant mix strategy.

PROPERTY: ${unit.property_name}
LOCATION: ${propertyAddr}
ASSET CLASS: ${unit.asset_class || "Mixed Use / Retail"}
LANDLORD/CLIENT: ${unit.landlord_name || "Not specified"}

UNIT DETAILS:
- Unit: ${unit.unit_name}
- Zone: ${unit.zone || "Not specified"}
- Positioning: ${unit.positioning || "Not specified"}
- Current status: ${unit.status}
- Current tenant: ${unit.tenant_name || "Vacant"}
- Size: ${unit.sqft ? `${unit.sqft} sqft` : "Not specified"}
- Rent: ${unit.rent_pa ? `£${Number(unit.rent_pa).toLocaleString()} p.a.` : "Not specified"}

EXISTING TENANT MIX AT THIS PROPERTY:
${tenantMix || "No other tenants listed"}

ALREADY TARGETED (avoid duplicating):
${existingTargetsList || "None yet"}
${outcomeContext}

POSITIONING CATEGORIES USED:
- Everyday Connections = Social Dining
- Quick Refuel = Café / Grab & Go / QSR
- Joyful Gatherings = Leisure / Bars / Premium Dining
- Leisurely Refuel = Casual / Premium Casual Dining

Generate exactly 5 target tenant suggestions for this unit. Consider:
1. The property's location, footfall profile, and catchment area
2. The positioning category and zone strategy
3. Complementary fit with the existing tenant mix (avoid competitors)
4. The unit size and rental affordability
5. The landlord/client's likely brand strategy and quality expectations
6. Current UK market trends for this property type
7. Learn from the historical outcomes above — which types of brands actually signed?

For each suggestion, provide:
- brand_name: The specific brand name (real UK brands, not generic categories)
- quality_rating: "green" (A-tier: strong strategic fit, proven performer, actively expanding), "amber" (B-tier: good fit, may need convincing, less proven at this scale), or "red" (C-tier: speculative/stretch target, worth approaching but lower probability)
- rationale: 2-3 sentences explaining why this brand suits this specific unit and property

Return JSON array only, no markdown:
[{"brand_name":"...","quality_rating":"...","rationale":"..."}]`;

    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
      ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
        ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
        : {}),
    });

    const aiRes = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = aiRes.content[0]?.type === "text" ? aiRes.content[0].text : "";
    let suggestions: any[] = [];
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) suggestions = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: "Failed to parse AI response" });
    }

    const existingBrands = await pool.query(
      "SELECT LOWER(brand_name) as bn FROM target_tenants WHERE unit_id = $1",
      [req.params.unitId]
    );
    const existingSet = new Set(existingBrands.rows.map((r: any) => r.bn));

    const inserted: any[] = [];
    const seenBrands = new Set<string>();
    for (const s of suggestions.slice(0, 5)) {
      if (!s.brand_name) continue;
      const brandLower = s.brand_name.toLowerCase();
      if (existingSet.has(brandLower) || seenBrands.has(brandLower)) continue;
      seenBrands.add(brandLower);

      const rating = ["green", "amber", "red"].includes(s.quality_rating) ? s.quality_rating : "amber";

      const companyMatch = await pool.query(
        "SELECT id, name FROM crm_companies WHERE LOWER(name) = LOWER($1) LIMIT 1",
        [s.brand_name]
      );
      const companyId = companyMatch.rows[0]?.id || null;

      const result = await pool.query(
        `INSERT INTO target_tenants (unit_id, property_id, company_id, brand_name, rationale, quality_rating, suggested_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ai', 'suggested')
         RETURNING *`,
        [req.params.unitId, unit.property_id, companyId, s.brand_name, s.rationale || null, rating]
      );
      inserted.push({ ...result.rows[0], company_name: companyMatch.rows[0]?.name || null });
    }

    await logAudit(pool, {
      unitId: req.params.unitId, propertyId: unit.property_id,
      userId: user.id, userName: user.username, action: "generate_targets",
      newValue: `AI generated ${inserted.length} target tenants`,
    });

    res.json(inserted);
  } catch (e: any) {
    console.error("[target-tenants] AI generation error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/leasing-schedule/property/:propertyId/generate-targets", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { allowed, user } = await checkPropertyAccess(pool, req, req.params.propertyId);
    if (!allowed) return res.status(403).json({ error: "Access denied" });

    const units = await pool.query(
      `SELECT id, unit_name, status FROM leasing_schedule_units
       WHERE property_id = $1 AND (status IN ('Vacant', 'Under Offer', 'In Negotiation') OR status IS NULL)
       ORDER BY sort_order`,
      [req.params.propertyId]
    );

    if (units.rows.length === 0) {
      return res.json({ message: "No vacant or negotiating units to generate targets for", generated: 0 });
    }

    const results: any[] = [];
    for (const unit of units.rows) {
      try {
        const existingCount = await pool.query(
          "SELECT COUNT(*) as cnt FROM target_tenants WHERE unit_id = $1 AND status = 'suggested'",
          [unit.id]
        );
        if (parseInt(existingCount.rows[0].cnt) >= 5) {
          results.push({ unit_id: unit.id, unit_name: unit.unit_name, skipped: true, reason: "Already has 5+ suggestions" });
          continue;
        }

        const genRes = await fetch(`http://localhost:${process.env.PORT || 5000}/api/leasing-schedule/unit/${unit.id}/generate-targets`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: (req.headers.cookie || ""),
            authorization: (req.headers.authorization || ""),
          },
        });
        const genData = await genRes.json();
        results.push({ unit_id: unit.id, unit_name: unit.unit_name, generated: Array.isArray(genData) ? genData.length : 0 });
      } catch (err: any) {
        results.push({ unit_id: unit.id, unit_name: unit.unit_name, error: err.message });
      }
    }

    res.json({ results, total_units: units.rows.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

async function buildStyledSheet(wb: any, ExcelJS: any, propertyName: string, units: any[], targetTenants?: any[]) {
  const safeSheetName = propertyName.replace(/[\\/*?\[\]:]/g, "").slice(0, 31) || "Sheet1";
  const ws = wb.addWorksheet(safeSheetName);

  const DARK_BLUE = "082861";
  const WHITE_FONT: any = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  const DARK_BLUE_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${DARK_BLUE}` } };
  const LIGHT_BLUE_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCEAF7" } };
  const GREEN_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } };
  const AMBER_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEB9C" } };
  const DARK_RED_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC00000" } };
  const BRIGHT_RED_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
  const GREY_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
  const THIN_BORDER: any = {
    top: { style: "thin", color: { argb: "FFB4B4B4" } },
    left: { style: "thin", color: { argb: "FFB4B4B4" } },
    bottom: { style: "thin", color: { argb: "FFB4B4B4" } },
    right: { style: "thin", color: { argb: "FFB4B4B4" } },
  };
  const WRAP_ALIGN: any = { vertical: "top", wrapText: true };

  ws.columns = [
    { key: "zone", width: 18 },
    { key: "positioning", width: 45 },
    { key: "existing", width: 40 },
    { key: "targets", width: 35 },
    { key: "optimum", width: 20 },
    { key: "financial", width: 28 },
    { key: "priority", width: 28 },
    { key: "updates", width: 45 },
  ];

  const titleRow = ws.addRow([`${propertyName}\nLeasing Schedule`]);
  ws.mergeCells(titleRow.number, 1, titleRow.number, 8);
  const titleCell = ws.getCell(titleRow.number, 1);
  titleCell.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = DARK_BLUE_FILL;
  titleCell.alignment = { vertical: "middle", wrapText: true };
  ws.getRow(titleRow.number).height = 40;

  const headerRow = ws.addRow(["Zone", "Positioning", "Existing", "Targets", "Optimum Targets", "Financial Performance", "Priority", "Updates"]);
  headerRow.eachCell((cell: any) => {
    cell.font = WHITE_FONT;
    cell.fill = DARK_BLUE_FILL;
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = THIN_BORDER;
  });
  headerRow.height = 25;

  const zoneGroups = new Map<string, any[]>();
  for (const unit of units) {
    const zone = unit.zone || "Unzoned";
    if (!zoneGroups.has(zone)) zoneGroups.set(zone, []);
    zoneGroups.get(zone)!.push(unit);
  }

  function getStatusFill(status: string) {
    const s = (status || "").toLowerCase();
    if (s === "occupied" || s === "let" || s === "on strategy") return GREEN_FILL;
    if (s === "maintain" || s === "maintain mix") return AMBER_FILL;
    if (s === "divest" || s === "divest over time") return DARK_RED_FILL;
    if (s === "at risk" || s === "customer at risk") return BRIGHT_RED_FILL;
    if (s === "void" || s === "vacant") return GREY_FILL;
    if (s === "under offer" || s === "in legals") return AMBER_FILL;
    return null;
  }

  function getStatusFont(status: string) {
    const s = (status || "").toLowerCase();
    if (s === "divest" || s === "divest over time" || s === "at risk" || s === "customer at risk") {
      return { name: "Calibri", size: 10, color: { argb: "FFFFFFFF" } };
    }
    return { name: "Calibri", size: 10 };
  }

  function formatDateShort(d: any) {
    if (!d) return "";
    const dt = new Date(d);
    return dt.toLocaleDateString("en-GB", { day: "numeric", month: "numeric", year: "2-digit" });
  }

  function buildExistingCell(unit: any) {
    const parts: string[] = [];
    const agent = unit.agent_initials ? ` (${unit.agent_initials})` : "";
    parts.push(`${unit.tenant_name || unit.unit_name}${agent}`);
    if (unit.lease_expiry) parts.push(`(Exp. ${formatDateShort(unit.lease_expiry)})`);
    if (unit.lease_break) parts.push(`(MB ${formatDateShort(unit.lease_break)})`);
    if (unit.rent_review) parts.push(`(RR ${formatDateShort(unit.rent_review)})`);
    if (unit.landlord_break) parts.push(`(LB ${formatDateShort(unit.landlord_break)})`);
    return parts.join("\n");
  }

  function buildFinancialCell(unit: any) {
    const parts: string[] = [];
    if (unit.mat_psqft) parts.push(`£${unit.mat_psqft} MAT/psqft`);
    if (unit.lfl_percent) parts.push(`${unit.lfl_percent}% LFL`);
    if (unit.rent_pa) parts.push(`£${Number(unit.rent_pa).toLocaleString()} p.a.`);
    if (unit.sqft) parts.push(`${Number(unit.sqft).toLocaleString()} sqft`);
    if (unit.occ_cost_percent) parts.push(`${unit.occ_cost_percent}% occ cost`);
    return parts.join("\n");
  }

  let zoneIdx = 0;
  for (const [zoneName, zoneUnits] of zoneGroups) {
    zoneIdx++;

    const posGroups = new Map<string, any[]>();
    for (const u of zoneUnits) {
      const pos = u.positioning || "General";
      if (!posGroups.has(pos)) posGroups.set(pos, []);
      posGroups.get(pos)!.push(u);
    }

    const zoneStartRow = ws.rowCount + 1;
    let firstUnitInZone = true;

    for (const [posName, posUnits] of posGroups) {
      const posHeaderRow = ws.addRow([
        firstUnitInZone ? `${zoneIdx}. ${zoneName}` : "",
        posName, "", "", "", "", "", ""
      ]);
      ws.mergeCells(posHeaderRow.number, 2, posHeaderRow.number, 8);
      posHeaderRow.getCell(1).font = WHITE_FONT;
      posHeaderRow.getCell(1).fill = DARK_BLUE_FILL;
      posHeaderRow.getCell(1).alignment = { vertical: "middle", wrapText: true };
      posHeaderRow.getCell(1).border = THIN_BORDER;
      posHeaderRow.getCell(2).font = WHITE_FONT;
      posHeaderRow.getCell(2).fill = DARK_BLUE_FILL;
      posHeaderRow.getCell(2).alignment = { vertical: "middle" };
      for (let c = 2; c <= 8; c++) {
        posHeaderRow.getCell(c).border = THIN_BORDER;
      }
      posHeaderRow.height = 20;
      firstUnitInZone = false;

      for (const unit of posUnits) {
        const existingText = buildExistingCell(unit);
        const financialText = buildFinancialCell(unit);

        const unitTargets = (targetTenants || []).filter((t: any) => t.unit_id === unit.id && t.status !== "rejected");
        let targetText: string;
        if (unitTargets.length > 0) {
          const ratingSymbol: Record<string, string> = { green: "●", amber: "◐", red: "○" };
          targetText = unitTargets
            .map((t: any) => `${ratingSymbol[t.quality_rating] || "◐"} ${t.brand_name}`)
            .join("\n");
        } else {
          targetText = unit.target_brands || "-";
        }

        const optimumText = unit.optimum_target || "-";
        const priorityText = unit.priority || "-";
        const updatesText = unit.updates || "-";

        const dataRow = ws.addRow([
          "",
          "",
          existingText,
          targetText,
          optimumText,
          financialText,
          priorityText,
          updatesText
        ]);

        const statusFill = getStatusFill(unit.status);
        const statusFont = getStatusFont(unit.status);

        const ratingSymbol: Record<string, string> = { green: "●", amber: "◐", red: "○" };
        const ratingColor: Record<string, string> = { green: "FF00A651", amber: "FFFF8C00", red: "FFCC0000" };

        dataRow.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
          cell.alignment = WRAP_ALIGN;
          cell.border = THIN_BORDER;
          cell.font = statusFont;
          if (statusFill && colNumber === 3) {
            cell.fill = statusFill;
            cell.font = getStatusFont(unit.status);
          }
          if (colNumber === 4 && unitTargets.length > 0) {
            const richText: any[] = [];
            for (let i = 0; i < unitTargets.length; i++) {
              const t = unitTargets[i];
              richText.push({
                text: `${ratingSymbol[t.quality_rating] || "◐"} `,
                font: { name: "Calibri", size: 10, color: { argb: ratingColor[t.quality_rating] || "FFFF8C00" } },
              });
              richText.push({
                text: t.brand_name + (i < unitTargets.length - 1 ? "\n" : ""),
                font: { name: "Calibri", size: 10, ...(t.quality_rating === "green" ? { bold: true } : {}) },
              });
            }
            try { cell.value = { richText }; } catch { /* fallback to plain text */ }
          }
        });

        const lineCount = Math.max(
          existingText.split("\n").length,
          targetText.split("\n").length,
          updatesText.split("\n").length,
          financialText.split("\n").length
        );
        dataRow.height = Math.max(30, lineCount * 15);
      }
    }

    if (zoneStartRow <= ws.rowCount) {
      const zoneEndRow = ws.rowCount;
      const unitRowsInZone = zoneEndRow - zoneStartRow;
      if (unitRowsInZone > 0) {
        try {
          ws.mergeCells(zoneStartRow, 1, zoneEndRow, 1);
        } catch {}
      }
    }
  }

  const blankRow = ws.addRow([]);
  blankRow.height = 10;

  const keyHeaderRow = ws.addRow(["", "Key"]);
  ws.mergeCells(keyHeaderRow.number, 2, keyHeaderRow.number, 8);
  keyHeaderRow.getCell(2).font = { name: "Calibri", size: 11, bold: true };
  keyHeaderRow.getCell(2).fill = LIGHT_BLUE_FILL;
  keyHeaderRow.getCell(2).border = THIN_BORDER;

  const keyItems = [
    { label: "GREEN", desc: "A-B : Halo / On Strategy", fill: GREEN_FILL, fontColor: "FF000000" },
    { label: "AMBER", desc: "C : Maintain Mix", fill: AMBER_FILL, fontColor: "FF000000" },
    { label: "DARK RED", desc: "D : Divest Over Time", fill: DARK_RED_FILL, fontColor: "FFFFFFFF" },
    { label: "BRIGHT RED", desc: "D : Customer at Risk or Live Opportunity", fill: BRIGHT_RED_FILL, fontColor: "FFFFFFFF" },
    { label: "GREY", desc: "Void and Live Opportunity", fill: GREY_FILL, fontColor: "FF000000" },
  ];

  for (const item of keyItems) {
    const kr = ws.addRow(["", item.label, item.desc]);
    kr.getCell(2).fill = item.fill;
    kr.getCell(2).font = { name: "Calibri", size: 10, bold: true, color: { argb: item.fontColor } };
    kr.getCell(2).border = THIN_BORDER;
    kr.getCell(3).font = { name: "Calibri", size: 10 };
    kr.getCell(3).border = THIN_BORDER;
  }

  const blank2 = ws.addRow([]);
  blank2.height = 10;

  const posKeyHeader = ws.addRow(["", "Positioning Key"]);
  ws.mergeCells(posKeyHeader.number, 2, posKeyHeader.number, 8);
  posKeyHeader.getCell(2).font = { name: "Calibri", size: 11, bold: true };
  posKeyHeader.getCell(2).fill = LIGHT_BLUE_FILL;
  posKeyHeader.getCell(2).border = THIN_BORDER;

  const posItems = [
    { name: "Everyday Connections", desc: "Social Dining" },
    { name: "Quick Refuel", desc: "Café / Grab & Go / QSR" },
    { name: "Joyful Gatherings", desc: "Leisure / Bars / Premium Dining" },
    { name: "Leisurely Refuel", desc: "Casual / Premium Casual Dining" },
  ];

  for (const p of posItems) {
    const pr = ws.addRow(["", p.name, p.desc]);
    pr.getCell(2).font = { name: "Calibri", size: 10, bold: true };
    pr.getCell(2).border = THIN_BORDER;
    pr.getCell(3).font = { name: "Calibri", size: 10 };
    pr.getCell(3).border = THIN_BORDER;
  }

  if (targetTenants && targetTenants.length > 0) {
    const blank3 = ws.addRow([]);
    blank3.height = 10;

    const targetKeyHeader = ws.addRow(["", "Target Tenant Rating Key"]);
    ws.mergeCells(targetKeyHeader.number, 2, targetKeyHeader.number, 8);
    targetKeyHeader.getCell(2).font = { name: "Calibri", size: 11, bold: true };
    targetKeyHeader.getCell(2).fill = LIGHT_BLUE_FILL;
    targetKeyHeader.getCell(2).border = THIN_BORDER;

    const targetKeyItems = [
      { symbol: "●", label: "Green / A-Tier", desc: "Strong strategic fit, proven performer, actively expanding", color: "FF00A651" },
      { symbol: "◐", label: "Amber / B-Tier", desc: "Good fit, may need convincing, less proven at this scale", color: "FFFF8C00" },
      { symbol: "○", label: "Red / C-Tier", desc: "Speculative / stretch target, worth approaching but lower probability", color: "FFCC0000" },
    ];

    for (const item of targetKeyItems) {
      const tkr = ws.addRow(["", `${item.symbol} ${item.label}`, item.desc]);
      tkr.getCell(2).font = { name: "Calibri", size: 10, bold: true, color: { argb: item.color } };
      tkr.getCell(2).border = THIN_BORDER;
      tkr.getCell(3).font = { name: "Calibri", size: 10 };
      tkr.getCell(3).border = THIN_BORDER;
    }
  }

  return ws;
}

router.get("/api/leasing-schedule/property/:propertyId/export-excel", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { allowed, user } = await checkPropertyAccess(pool, req, req.params.propertyId);
    if (!allowed) return res.status(403).json({ error: "Export denied" });

    const propRes = await pool.query("SELECT name FROM crm_properties WHERE id = $1", [req.params.propertyId]);
    const propertyName = propRes.rows[0]?.name || "Property";

    const result = await pool.query(`
      SELECT u.id, u.unit_name, u.zone, u.positioning, u.tenant_name, u.agent_initials, u.status,
        u.lease_expiry, u.lease_break, u.rent_review, u.landlord_break,
        u.rent_pa, u.sqft, u.mat_psqft, u.lfl_percent, u.occ_cost_percent,
        u.target_brands, u.optimum_target, u.priority, u.updates, u.financial_notes
      FROM leasing_schedule_units u
      WHERE u.property_id = $1
      ORDER BY u.sort_order, u.zone, u.unit_name
    `, [req.params.propertyId]);

    const targetsRes = await pool.query(
      `SELECT * FROM target_tenants WHERE property_id = $1 AND status != 'rejected'
       ORDER BY CASE quality_rating WHEN 'green' THEN 1 WHEN 'amber' THEN 2 WHEN 'red' THEN 3 END`,
      [req.params.propertyId]
    );

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "BGP Dashboard";

    await buildStyledSheet(wb, ExcelJS, propertyName, result.rows, targetsRes.rows);

    const buf = await wb.xlsx.writeBuffer();

    if (user) {
      await logAudit(pool, {
        propertyId: req.params.propertyId, userId: user.id, userName: user.username,
        action: "export_excel", newValue: `${result.rows.length} units exported to Excel`,
      });
    }

    const safeName = propertyName.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_Leasing_Schedule.xlsx"`);
    res.send(Buffer.from(buf as ArrayBuffer));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/leasing-schedule/export-multi-excel", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const user = await getUserInfo(pool, req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { propertyIds } = req.body;
    if (!Array.isArray(propertyIds) || propertyIds.length === 0) {
      return res.status(400).json({ error: "propertyIds array required" });
    }

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "BGP Dashboard";
    let totalUnits = 0;
    const usedNames = new Set<string>();

    for (const propId of propertyIds) {
      const { allowed } = await checkPropertyAccess(pool, req, propId);
      if (!allowed) continue;

      const propRes = await pool.query("SELECT name FROM crm_properties WHERE id = $1", [propId]);
      let sheetName = (propRes.rows[0]?.name || propId).slice(0, 31).replace(/[\\/*?\[\]:]/g, "");
      while (usedNames.has(sheetName)) sheetName = sheetName.slice(0, 28) + "_" + usedNames.size;
      usedNames.add(sheetName);

      const result = await pool.query(`
        SELECT u.id, u.unit_name, u.zone, u.positioning, u.tenant_name, u.agent_initials, u.status,
          u.lease_expiry, u.lease_break, u.rent_review, u.landlord_break,
          u.rent_pa, u.sqft, u.mat_psqft, u.lfl_percent, u.occ_cost_percent,
          u.target_brands, u.optimum_target, u.priority, u.updates, u.financial_notes
        FROM leasing_schedule_units u
        WHERE u.property_id = $1
        ORDER BY u.sort_order, u.zone, u.unit_name
      `, [propId]);

      const targetsRes = await pool.query(
        `SELECT * FROM target_tenants WHERE property_id = $1 AND status != 'rejected'
         ORDER BY CASE quality_rating WHEN 'green' THEN 1 WHEN 'amber' THEN 2 WHEN 'red' THEN 3 END`,
        [propId]
      );

      totalUnits += result.rows.length;
      await buildStyledSheet(wb, ExcelJS, sheetName, result.rows, targetsRes.rows);
    }

    if (usedNames.size === 0) {
      return res.status(403).json({ error: "No accessible properties to export" });
    }

    const buf = await wb.xlsx.writeBuffer();

    await logAudit(pool, {
      propertyId: propertyIds[0], userId: user.id, userName: user.username,
      action: "export_multi_excel",
      newValue: `${totalUnits} units across ${usedNames.size} properties exported (${propertyIds.length - usedNames.size} skipped)`,
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="BGP_Leasing_Schedules.xlsx"`);
    res.send(Buffer.from(buf as ArrayBuffer));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/leasing-schedule/export-excel", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const user = await getUserInfo(pool, req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    // Build query respecting privacy/access rules
    let query = `
      SELECT u.unit_name, u.zone AS floor, u.tenant_name, u.lease_expiry, u.lease_break,
        u.rent_pa, u.sqft, u.status, p.name AS property_name
      FROM leasing_schedule_units u
      JOIN crm_properties p ON u.property_id = p.id
    `;
    if (!user.is_admin) {
      query += `
        WHERE (p.leasing_privacy_enabled = FALSE OR p.leasing_privacy_enabled IS NULL
          OR EXISTS (SELECT 1 FROM crm_property_agents pa WHERE pa.property_id = p.id AND pa.user_id = $1))
      `;
    }
    query += ` ORDER BY p.name, u.sort_order, u.zone, u.unit_name`;

    const result = await pool.query(query, user.is_admin ? [] : [user.id]);
    const rows = result.rows;

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "BGP Dashboard";
    const ws = wb.addWorksheet("Leasing Schedule");

    const BGP_GREEN = "FF2E5E3F";
    const WHITE_FONT = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    const HEADER_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: BGP_GREEN } };
    const THIN_BORDER: any = {
      top: { style: "thin", color: { argb: "FFB4B4B4" } },
      left: { style: "thin", color: { argb: "FFB4B4B4" } },
      bottom: { style: "thin", color: { argb: "FFB4B4B4" } },
      right: { style: "thin", color: { argb: "FFB4B4B4" } },
    };

    ws.columns = [
      { header: "Property", key: "property", width: 28 },
      { header: "Unit", key: "unit", width: 22 },
      { header: "Floor", key: "floor", width: 14 },
      { header: "Tenant", key: "tenant", width: 26 },
      { header: "Lease Start", key: "lease_start", width: 14 },
      { header: "Lease End", key: "lease_end", width: 14 },
      { header: "Break Date", key: "break_date", width: 14 },
      { header: "Rent PA", key: "rent_pa", width: 16 },
      { header: "Rent PSF", key: "rent_psf", width: 14 },
      { header: "Area SqFt", key: "area_sqft", width: 14 },
      { header: "Status", key: "status", width: 16 },
    ];

    // Style header row
    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell: any) => {
      cell.font = WHITE_FONT;
      cell.fill = HEADER_FILL;
      cell.alignment = { vertical: "middle" };
      cell.border = THIN_BORDER;
    });
    headerRow.height = 24;

    // Freeze top row & auto-filter
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: "A1", to: "K1" };

    // Date & currency formats
    const DATE_FMT = "DD/MM/YYYY";
    const CURRENCY_FMT = "£#,##0";
    const NUMBER_FMT = "#,##0";

    // Populate data rows
    for (const r of rows) {
      const rentPsf = r.rent_pa && r.sqft ? Number(r.rent_pa) / Number(r.sqft) : null;
      const dataRow = ws.addRow({
        property: r.property_name || "",
        unit: r.unit_name || "",
        floor: r.floor || "",
        tenant: r.tenant_name || "",
        lease_start: null, // not tracked in DB
        lease_end: r.lease_expiry ? new Date(r.lease_expiry) : null,
        break_date: r.lease_break ? new Date(r.lease_break) : null,
        rent_pa: r.rent_pa ? Number(r.rent_pa) : null,
        rent_psf: rentPsf ? Math.round(rentPsf * 100) / 100 : null,
        area_sqft: r.sqft ? Number(r.sqft) : null,
        status: r.status || "",
      });
      dataRow.eachCell({ includeEmpty: true }, (cell: any) => { cell.border = THIN_BORDER; });

      // Apply formats
      dataRow.getCell("lease_start").numFmt = DATE_FMT;
      dataRow.getCell("lease_end").numFmt = DATE_FMT;
      dataRow.getCell("break_date").numFmt = DATE_FMT;
      dataRow.getCell("rent_pa").numFmt = CURRENCY_FMT;
      dataRow.getCell("rent_psf").numFmt = CURRENCY_FMT;
      dataRow.getCell("area_sqft").numFmt = NUMBER_FMT;
    }

    // Totals row
    const totalRowNum = rows.length + 2; // header=1, data=rows.length, total=+1
    const totalsRow = ws.addRow({
      property: "TOTALS",
      unit: "",
      floor: "",
      tenant: `${rows.length} units`,
      lease_start: null,
      lease_end: null,
      break_date: null,
      rent_pa: rows.reduce((s, r) => s + (r.rent_pa ? Number(r.rent_pa) : 0), 0),
      rent_psf: null,
      area_sqft: rows.reduce((s, r) => s + (r.sqft ? Number(r.sqft) : 0), 0),
      status: "",
    });
    totalsRow.eachCell({ includeEmpty: true }, (cell: any) => {
      cell.font = { name: "Calibri", size: 11, bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      cell.border = THIN_BORDER;
    });
    totalsRow.getCell("rent_pa").numFmt = CURRENCY_FMT;
    totalsRow.getCell("area_sqft").numFmt = NUMBER_FMT;

    const buf = await wb.xlsx.writeBuffer();

    await logAudit(pool, {
      propertyId: "all", userId: user.id, userName: user.username,
      action: "export_excel",
      newValue: `${rows.length} units exported to tabular Excel`,
    });

    const today = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="BGP_Leasing_Schedule_${today}.xlsx"`);
    res.send(Buffer.from(buf as ArrayBuffer));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
