// Lender-specific API routes:
//   GET /api/lenders/secured-properties?companyId=  — properties where co is senior/junior lender
//   GET /api/lenders/lr-charges?companyId=          — LR charges matched to this lender
import { type Express } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

const GENERIC_LENDER_WORDS = new Set(["bank", "plc", "limited", "ltd", "llp", "group", "the", "and", "capital", "finance", "holdings", "uk", "international", "company", "co"]);

// The distinctive words of a lender's name ("Barclays Bank PLC" → barclays;
// "Vahid Mirhadiyev" → vahid, mirhadiyev) — every one must appear in the
// event's free-text lender, so "Bank" alone never matches another bank.
export function lenderNameWords(name: string | null | undefined): string[] {
  return String(name || "").toLowerCase().split(/[^a-z0-9&]+/).filter(w => w.length > 2 && !GENERIC_LENDER_WORDS.has(w));
}

export function lenderAddressText(address: any, postcode?: string | null): string {
  let a = address;
  if (typeof a === "string") { try { a = JSON.parse(a); } catch { return a; } }
  if (!a || typeof a !== "object") return postcode || "";
  const parts = [a.formatted || a.street || a.line1, a.city, a.postcode || postcode].filter(Boolean).map(String);
  return [...new Set(parts)].join(", ");
}

export function registerLenderRoutes(app: Express) {
  // Properties where this company is recorded as senior or junior lender
  app.get("/api/lenders/secured-properties", requireAuth, async (req: any, res) => {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    try {
      // Borrower = the ownership stack's freeholder / long leaseholder, else
      // the landlord; the address arrives as a string (the jsonb object
      // crashed the board's row as a React child).
      const result = await pool.query(
        `SELECT
           p.id AS "propertyId",
           p.name AS "propertyName",
           p.address AS "address",
           p.postcode AS "postcode",
           CASE
             WHEN p.senior_lender_id = $1 THEN 'senior'
             ELSE 'junior'
           END AS "interestType",
           b.id AS "borrowerId",
           b.name AS "borrowerName"
         FROM crm_properties p
         LEFT JOIN crm_companies b ON b.id = COALESCE(p.long_leaseholder_id, p.freeholder_id, p.landlord_id)
         WHERE p.senior_lender_id = $1 OR p.junior_lender_id = $1
         ORDER BY p.name`,
        [companyId]
      );
      res.json(result.rows.map(({ address, postcode, ...row }: any) => ({ ...row, propertyAddress: lenderAddressText(address, postcode) })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Facility / debt events that name this lender — landlord_debt_events
  // carries the lender as free text ("Barclays Bank PLC (senior)"), keyed
  // by the borrowing landlord or SPV.
  app.get("/api/lenders/debt-events", requireAuth, async (req: any, res) => {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    try {
      const co = await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [companyId]);
      const words = lenderNameWords(co.rows[0]?.name);
      if (!words.length) return res.json([]);
      const result = await pool.query(
        `SELECT e.id, e.event_type AS "eventType", e.event_date AS "eventDate", e.lender, e.amount, e.notes,
                e.property_id AS "propertyId", p.name AS "propertyName",
                e.landlord_id AS "borrowerId", b.name AS "borrowerName"
           FROM landlord_debt_events e
           LEFT JOIN crm_properties p ON p.id = e.property_id
           LEFT JOIN crm_companies b ON b.id = e.landlord_id
          WHERE ${words.map((_, i) => `e.lender ILIKE $${i + 1}`).join(" AND ")}
          ORDER BY e.event_date DESC NULLS LAST
          LIMIT 50`,
        words.map(w => `%${w}%`),
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
      const words = lenderNameWords(name);
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
          if (words.every(w => chargee.includes(w))) {
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
