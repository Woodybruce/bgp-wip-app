import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { db, pool } from "./db";
import { landlordDebtEvents, investmentComps, insertLandlordDebtEventSchema } from "@shared/schema";
import { eq, or, desc } from "drizzle-orm";

export function registerLandlordHunterRoutes(app: Express) {
  // List debt/capital events for a landlord
  app.get("/api/landlord-debt-events", requireAuth, async (req: Request, res: Response) => {
    try {
      const landlordId = req.query.landlordId as string | undefined;
      if (!landlordId) return res.json([]);
      const rows = await db
        .select()
        .from(landlordDebtEvents)
        .where(eq(landlordDebtEvents.landlordId, landlordId))
        .orderBy(desc(landlordDebtEvents.eventDate));
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/landlord-debt-events", requireAuth, async (req: Request, res: Response) => {
    try {
      const payload = {
        ...req.body,
        eventDate: req.body.eventDate ? new Date(req.body.eventDate) : null,
      };
      const parsed = insertLandlordDebtEventSchema.parse(payload);
      const [row] = await db.insert(landlordDebtEvents).values(parsed).returning();
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/landlord-debt-events/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const updates: Record<string, any> = { ...req.body, updatedAt: new Date() };
      if (updates.eventDate) updates.eventDate = new Date(updates.eventDate);
      const [row] = await db
        .update(landlordDebtEvents)
        .set(updates)
        .where(eq(landlordDebtEvents.id, String(req.params.id)))
        .returning();
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/landlord-debt-events/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await db.delete(landlordDebtEvents).where(eq(landlordDebtEvents.id, String(req.params.id)));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Investment comps where this company is buyer or seller — feeds the
  // Investment Hunter activity tab.
  app.get("/api/investment-comps/by-company", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      if (!companyId) return res.json([]);
      const rows = await db
        .select()
        .from(investmentComps)
        .where(or(eq(investmentComps.buyerCompanyId, companyId), eq(investmentComps.sellerCompanyId, companyId)))
        .orderBy(desc(investmentComps.transactionDate));
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Letting Hunter list ────────────────────────────────────────────
  // Aggregates per-landlord letting signals into a single sortable list.
  // Returns one row per landlord-type company with portfolio + lease event
  // counts and a composite Hunter Score so the leasing team can see the
  // top targets at the top.
  app.get("/api/hunters/letting", requireAuth, async (req: Request, res: Response) => {
    try {
      const sql = `
        WITH landlord_props AS (
          SELECT p.landlord_id,
                 COUNT(*)::int AS owned_count,
                 SUM(p.sqft)::real AS total_sqft,
                 SUM(CASE WHEN p.competitor_agent IS NOT NULL AND COALESCE(p.competitor_agent_status,'active')='active' THEN 1 ELSE 0 END)::int AS competitor_count,
                 SUM(CASE WHEN p.competitor_agent IS NOT NULL AND COALESCE(p.competitor_agent_status,'active')='active'
                          AND p.competitor_agent_instructed_at < NOW() - INTERVAL '12 months' THEN 1 ELSE 0 END)::int AS stale_agent_count
          FROM crm_properties p
          WHERE p.landlord_id IS NOT NULL
          GROUP BY p.landlord_id
        ),
        landlord_events AS (
          SELECT p.landlord_id,
                 COUNT(le.id)::int AS upcoming_events,
                 SUM(CASE WHEN le.sqft ~ '^[0-9]+$' THEN le.sqft::int ELSE 0 END)::int AS upcoming_sqft
          FROM lease_events le
          JOIN crm_properties p ON p.id = le.property_id
          WHERE le.event_date IS NOT NULL
            AND le.event_date >= NOW()
            AND le.event_date <= NOW() + INTERVAL '12 months'
            AND p.landlord_id IS NOT NULL
          GROUP BY p.landlord_id
        ),
        landlord_acq AS (
          SELECT buyer_company_id AS landlord_id, COUNT(*)::int AS recent_acq
          FROM investment_comps
          WHERE buyer_company_id IS NOT NULL
            AND transaction_date IS NOT NULL
            AND TO_DATE(transaction_date, 'YYYY-MM-DD') >= NOW() - INTERVAL '12 months'
          GROUP BY buyer_company_id
        )
        SELECT c.id, c.name, c.company_type AS "companyType",
               c.letting_hunter_flag AS "lettingHunterFlag",
               c.letting_hunter_notes AS "lettingHunterNotes",
               COALESCE(lp.owned_count, 0) AS "ownedCount",
               COALESCE(lp.total_sqft, 0) AS "totalSqft",
               COALESCE(lp.competitor_count, 0) AS "competitorCount",
               COALESCE(lp.stale_agent_count, 0) AS "staleAgentCount",
               COALESCE(le.upcoming_events, 0) AS "upcomingEvents",
               COALESCE(le.upcoming_sqft, 0) AS "upcomingSqft",
               COALESCE(la.recent_acq, 0) AS "recentAcq"
        FROM crm_companies c
        LEFT JOIN landlord_props lp ON lp.landlord_id = c.id
        LEFT JOIN landlord_events le ON le.landlord_id = c.id
        LEFT JOIN landlord_acq la ON la.landlord_id = c.id
        WHERE c.merged_into_id IS NULL
          AND (
            c.company_type ILIKE '%landlord%' OR
            c.company_type ILIKE '%investor%' OR
            c.company_type ILIKE '%developer%' OR
            c.company_type ILIKE '%fund%' OR
            lp.owned_count > 0
          )
          AND COALESCE(c.company_type,'') NOT IN ('Billing','Billing Entity')
      `;
      const result = await pool.query(sql);
      const rows = result.rows.map((r: any) => {
        const score =
          (r.upcomingSqft || 0) * 0.001 +
          (r.upcomingEvents || 0) * 5 +
          (r.staleAgentCount || 0) * 30 +
          (r.recentAcq || 0) * 15 +
          (r.lettingHunterFlag ? 50 : 0);
        return { ...r, score: Math.round(score) };
      });
      rows.sort((a: any, b: any) => b.score - a.score);
      res.json(rows);
    } catch (e: any) {
      console.error("[hunters/letting]", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Investment Hunter list ────────────────────────────────────────
  // Two halves: Buyers (acquiring, dry powder) and Distressed (selling,
  // debt pressure). Returned together with both scores; the client
  // splits into tabs.
  app.get("/api/hunters/investment", requireAuth, async (req: Request, res: Response) => {
    try {
      const sql = `
        WITH acq AS (
          SELECT buyer_company_id AS landlord_id, COUNT(*)::int AS acq_12mo, SUM(price)::real AS acq_value_12mo
          FROM investment_comps
          WHERE buyer_company_id IS NOT NULL
            AND transaction_date IS NOT NULL
            AND TO_DATE(transaction_date, 'YYYY-MM-DD') >= NOW() - INTERVAL '12 months'
          GROUP BY buyer_company_id
        ),
        disp AS (
          SELECT seller_company_id AS landlord_id, COUNT(*)::int AS disp_12mo, SUM(price)::real AS disp_value_12mo
          FROM investment_comps
          WHERE seller_company_id IS NOT NULL
            AND transaction_date IS NOT NULL
            AND TO_DATE(transaction_date, 'YYYY-MM-DD') >= NOW() - INTERVAL '12 months'
          GROUP BY seller_company_id
        ),
        debt AS (
          SELECT landlord_id,
                 COUNT(*)::int AS debt_events_12mo,
                 SUM(CASE WHEN event_type IN ('maturity','breach','writedown') THEN 1 ELSE 0 END)::int AS distress_signals_12mo,
                 SUM(CASE WHEN event_type='fundraise' THEN 1 ELSE 0 END)::int AS fundraises_12mo,
                 SUM(CASE WHEN event_type='maturity' AND event_date IS NOT NULL AND event_date <= NOW() + INTERVAL '12 months' THEN 1 ELSE 0 END)::int AS upcoming_maturities
          FROM landlord_debt_events
          WHERE event_date IS NULL OR event_date >= NOW() - INTERVAL '12 months'
          GROUP BY landlord_id
        )
        SELECT c.id, c.name, c.company_type AS "companyType",
               c.aum, c.capital_source AS "capitalSource",
               c.fund_vintage_year AS "fundVintageYear", c.fund_end_year AS "fundEndYear",
               c.mandate_asset_class AS "mandateAssetClass",
               c.mandate_geographies AS "mandateGeographies",
               c.mandate_lot_size_min AS "mandateLotSizeMin",
               c.mandate_lot_size_max AS "mandateLotSizeMax",
               c.acquiring_now AS "acquiringNow",
               c.acquiring_now_notes AS "acquiringNowNotes",
               c.disposing_now AS "disposingNow",
               c.disposing_now_notes AS "disposingNowNotes",
               c.distress_flag AS "distressFlag",
               c.distress_notes AS "distressNotes",
               COALESCE(acq.acq_12mo, 0) AS "acq12mo",
               COALESCE(acq.acq_value_12mo, 0) AS "acqValue12mo",
               COALESCE(disp.disp_12mo, 0) AS "disp12mo",
               COALESCE(disp.disp_value_12mo, 0) AS "dispValue12mo",
               COALESCE(debt.debt_events_12mo, 0) AS "debtEvents12mo",
               COALESCE(debt.distress_signals_12mo, 0) AS "distressSignals12mo",
               COALESCE(debt.fundraises_12mo, 0) AS "fundraises12mo",
               COALESCE(debt.upcoming_maturities, 0) AS "upcomingMaturities"
        FROM crm_companies c
        LEFT JOIN acq ON acq.landlord_id = c.id
        LEFT JOIN disp ON disp.landlord_id = c.id
        LEFT JOIN debt ON debt.landlord_id = c.id
        WHERE c.merged_into_id IS NULL
          AND (
            c.company_type ILIKE '%landlord%' OR
            c.company_type ILIKE '%investor%' OR
            c.company_type ILIKE '%developer%' OR
            c.company_type ILIKE '%fund%' OR
            acq.acq_12mo > 0 OR disp.disp_12mo > 0 OR debt.debt_events_12mo > 0
          )
          AND COALESCE(c.company_type,'') NOT IN ('Billing','Billing Entity')
      `;
      const result = await pool.query(sql);
      const yearNow = new Date().getFullYear();
      const rows = result.rows.map((r: any) => {
        const yrsToFundEnd = r.fundEndYear ? r.fundEndYear - yearNow : null;
        const fundAge = r.fundVintageYear ? yearNow - r.fundVintageYear : null;
        const buyerScore =
          (r.acquiringNow ? 60 : 0) +
          (r.acq12mo || 0) * 8 +
          (r.fundraises12mo || 0) * 25 +
          (fundAge != null && fundAge >= 0 && fundAge <= 3 ? 20 : 0);
        const distressScore =
          (r.distressFlag ? 80 : 0) +
          (r.upcomingMaturities || 0) * 30 +
          (r.distressSignals12mo || 0) * 20 +
          (r.disposingNow ? 30 : 0) +
          (r.disp12mo || 0) * 5 +
          (yrsToFundEnd != null && yrsToFundEnd >= 0 && yrsToFundEnd <= 2 ? 25 : 0);
        return { ...r, buyerScore: Math.round(buyerScore), distressScore: Math.round(distressScore), yrsToFundEnd, fundAge };
      });
      res.json(rows);
    } catch (e: any) {
      console.error("[hunters/investment]", e);
      res.status(500).json({ error: e.message });
    }
  });
}
