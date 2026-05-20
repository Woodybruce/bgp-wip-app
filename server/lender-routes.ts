// Lender-specific API routes:
//   GET /api/lenders/secured-properties?companyId=  — properties where co is senior/junior lender
//   GET /api/lenders/lr-charges?companyId=          — LR charges matched to this lender
import { type Express } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

export function registerLenderRoutes(app: Express) {
  // Properties where this company is recorded as senior or junior lender
  app.get("/api/lenders/secured-properties", requireAuth, async (req: any, res) => {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    try {
      const result = await pool.query(
        `SELECT
           p.id AS "propertyId",
           p.name AS "propertyName",
           p.address AS "propertyAddress",
           CASE
             WHEN p.senior_lender_id = $1 THEN 'senior'
             ELSE 'junior'
           END AS "interestType"
         FROM crm_properties p
         WHERE p.senior_lender_id = $1 OR p.junior_lender_id = $1
         ORDER BY p.name`,
        [companyId]
      );
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // LR charges matched to this lender by name
  // Scans land_registry_title_purchases.proprietor_data for charge entries
  // whose chargee name loosely matches the company name
  app.get("/api/lenders/lr-charges", requireAuth, async (req: any, res) => {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    try {
      // Get company name for matching
      const co = await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [companyId]);
      if (!co.rows.length) return res.json([]);
      const name = co.rows[0].name as string;
      // Words from the lender name for fuzzy matching (>3 chars to avoid common words)
      const words = name.split(/\s+/).filter(w => w.length > 3).map(w => w.toLowerCase());
      if (!words.length) return res.json([]);

      // Find charges in existing LR title purchases where raw_response contains charge data
      // The HMLR response stores charges in raw_response.charges[] or proprietor_data.charges[]
      const result = await pool.query(
        `SELECT
           ltp.title_number AS "titleNumber",
           ltp.created_at AS "purchasedAt",
           p.id AS "propertyId",
           p.name AS "propertyName",
           ltp.raw_response
         FROM land_registry_title_purchases ltp
         LEFT JOIN crm_properties p ON p.title_number = ltp.title_number
         WHERE ltp.raw_response IS NOT NULL
         ORDER BY ltp.created_at DESC
         LIMIT 500`
      );

      const charges: any[] = [];
      for (const row of result.rows) {
        const raw = row.raw_response as any;
        const chargeList: any[] = raw?.charges || raw?.charge_data || raw?.leaseholds?.flatMap((l: any) => l.charges || []) || [];
        for (const c of chargeList) {
          const chargee = (c.chargee_name || c.lender_name || c.proprietor_name_1 || "").toLowerCase();
          if (words.some(w => chargee.includes(w))) {
            charges.push({
              titleNumber: row.titleNumber,
              propertyId: row.propertyId || null,
              propertyName: row.propertyName || null,
              chargeDate: c.date_registered || c.charge_date || null,
              amount: c.amount || null,
              notes: c.chargee_name || c.lender_name || c.proprietor_name_1 || null,
            });
          }
        }
      }

      res.json(charges);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
