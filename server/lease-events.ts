import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { db, pool } from "./db";
import { leaseEvents, insertLeaseEventSchema, type InsertLeaseEvent } from "@shared/schema";
import { eq, and, gte, lte, or, isNull, asc } from "drizzle-orm";

const LEASE_ADVISORY_TEAM = [
  "peter@brucegillinghampollard.com",
  "pete@brucegillinghampollard.com",
];

const WATCH_WINDOW_MONTHS = 18;

export function registerLeaseEventRoutes(app: Express) {
  // List — supports filtering by status, event type, property, and within-next-N-months window
  app.get("/api/lease-events", requireAuth, async (req: Request, res: Response) => {
    try {
      const { status, eventType, propertyId, withinMonths } = req.query as Record<string, string>;
      const conditions: string[] = [];
      const params: any[] = [];
      if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
      if (eventType) { params.push(eventType); conditions.push(`event_type = $${params.length}`); }
      if (propertyId) { params.push(propertyId); conditions.push(`property_id = $${params.length}`); }
      if (withinMonths) {
        const months = Number(withinMonths);
        if (months > 0) {
          conditions.push(`event_date IS NOT NULL AND event_date <= NOW() + INTERVAL '${months} months' AND event_date >= NOW() - INTERVAL '1 month'`);
        }
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = await pool.query(
        `SELECT id, property_id AS "propertyId", address, tenant, tenant_company_id AS "tenantCompanyId",
                unit_ref AS "unitRef", event_type AS "eventType", event_date AS "eventDate",
                notice_date AS "noticeDate", current_rent AS "currentRent", estimated_erv AS "estimatedErv",
                sqft, source_evidence AS "sourceEvidence", source_url AS "sourceUrl",
                source_title AS "sourceTitle", source_contact_id AS "sourceContactId",
                contact_id AS "contactId", assigned_to AS "assignedTo", status, notes,
                deal_id AS "dealId", comp_id AS "compId", created_by AS "createdBy",
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM lease_events ${where}
         ORDER BY event_date ASC NULLS LAST, created_at DESC`,
        params
      );
      res.json(rows.rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/lease-events", requireAuth, async (req: Request, res: Response) => {
    try {
      const payload: InsertLeaseEvent = {
        ...req.body,
        eventDate: req.body.eventDate ? new Date(req.body.eventDate) : null,
        noticeDate: req.body.noticeDate ? new Date(req.body.noticeDate) : null,
        createdBy: req.body.createdBy || req.session?.userId || null,
      };
      const parsed = insertLeaseEventSchema.parse(payload);
      const [row] = await db.insert(leaseEvents).values(parsed).returning();
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/lease-events/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const updates: Record<string, any> = { ...req.body, updatedAt: new Date() };
      if (updates.eventDate) updates.eventDate = new Date(updates.eventDate);
      if (updates.noticeDate) updates.noticeDate = new Date(updates.noticeDate);
      const [row] = await db.update(leaseEvents).set(updates).where(eq(leaseEvents.id, req.params.id)).returning();
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/lease-events/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await db.delete(leaseEvents).where(eq(leaseEvents.id, req.params.id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Digest — events due within WATCH_WINDOW_MONTHS, grouped by urgency. Used by dashboard widget
  // and the nightly monitoring job.
  app.get("/api/lease-events/digest", requireAuth, async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT id, property_id AS "propertyId", address, tenant, unit_ref AS "unitRef",
               event_type AS "eventType", event_date AS "eventDate", status, assigned_to AS "assignedTo",
               current_rent AS "currentRent", estimated_erv AS "estimatedErv",
               CASE
                 WHEN event_date IS NULL THEN 'undated'
                 WHEN event_date < NOW() THEN 'overdue'
                 WHEN event_date < NOW() + INTERVAL '3 months' THEN 'imminent'
                 WHEN event_date < NOW() + INTERVAL '6 months' THEN 'near'
                 WHEN event_date < NOW() + INTERVAL '18 months' THEN 'watching'
                 ELSE 'future'
               END AS urgency
        FROM lease_events
        WHERE status IN ('Monitoring', 'Contacted')
          AND (event_date IS NULL OR event_date < NOW() + INTERVAL '${WATCH_WINDOW_MONTHS} months')
        ORDER BY event_date ASC NULLS LAST
      `);
      res.json(result.rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}

// Runs daily — reassigns unassigned Monitoring events within the watch window to the lease
// advisory team. Keeps business development humming without manual triage.
export async function runLeaseEventMonitoring(): Promise<void> {
  try {
    const assignee = LEASE_ADVISORY_TEAM[0];
    const result = await pool.query(
      `UPDATE lease_events
       SET assigned_to = $1, updated_at = NOW()
       WHERE status = 'Monitoring'
         AND (assigned_to IS NULL OR assigned_to = '')
         AND event_date IS NOT NULL
         AND event_date >= NOW()
         AND event_date <= NOW() + INTERVAL '${WATCH_WINDOW_MONTHS} months'
       RETURNING id`,
      [assignee]
    );
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[lease-events] monitoring: auto-assigned ${result.rowCount} upcoming events to ${assignee}`);
    }
  } catch (err: any) {
    console.error("[lease-events] monitoring error:", err?.message);
  }
}

export function startLeaseEventMonitoring() {
  setTimeout(() => runLeaseEventMonitoring().catch(e => console.error("[lease-events] initial run:", e.message)), 5 * 60 * 1000);
  setInterval(() => runLeaseEventMonitoring().catch(e => console.error("[lease-events] scheduled run:", e.message)), 24 * 60 * 60 * 1000);
  console.log("[lease-events] monitoring enabled — runs 5min post-boot + every 24h");
}
