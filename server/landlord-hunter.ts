import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
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
}
