/**
 * PLA Matters — Lease Advisory platform server module.
 *
 * Routes:
 *   GET    /api/pla/matters                    — list (filterable by status, lead, property)
 *   GET    /api/pla/matters/:id                — single matter + linked comps + events + workbooks
 *   POST   /api/pla/matters                    — create (auto-applies SharePoint folder template)
 *   PATCH  /api/pla/matters/:id                — update fields
 *   DELETE /api/pla/matters/:id                — soft close (sets status='closed', closedAt=now)
 *   POST   /api/pla/matters/:id/comps          — link a comp to the matter
 *   DELETE /api/pla/matters/:id/comps/:compId  — unlink
 *   POST   /api/pla/matters/:id/events         — add a key date / event
 *   PATCH  /api/pla/matters/:id/events/:eventId — mark done / edit
 *
 * Property identity goes through resolveProperty() — callers may pass an
 * existing property_id OR an address/postcode/uprn and the matter is anchored
 * to whatever the resolver returns.
 *
 * SharePoint folder template (Tom + Pete's canonical Lease Advisory layout)
 * is wired in a follow-up — for now we leave folderTemplateApplied=false and
 * a worker process picks them up.
 */

import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import { storage } from "./storage";
import {
  plaMatters,
  plaMatterComps,
  plaMatterEvents,
  plaMatterWorkbooks,
  crmProperties,
  leaseEvents,
  type InsertPlaMatter,
  type PlaMatter,
} from "@shared/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { resolveProperty, type PropertyInput } from "./property-resolver";
import { getValidMsToken } from "./microsoft";
import { applyLeaseAdvisoryFolderTemplate } from "./pla-folder-template";

const VALID_TYPES = new Set([
  "rent_review",
  "lease_renewal",
  "dilapidations",
  "service_charge",
  "general",
]);

/**
 * Sync lease_events rows for a PLA matter — wipes any existing events
 * we generated for this matter, then writes fresh ones for each dated
 * field (review, break, expiry, notice deadlines). Property dashboards
 * and the lease-events board pick these up automatically.
 *
 * Idempotent — re-runnable on every matter update without leaving
 * orphan rows.
 */
async function syncLeaseEventsForMatter(matter: PlaMatter): Promise<void> {
  try {
    // Wipe-and-rewrite — simplest correct approach for date sync.
    await db.delete(leaseEvents).where(eq(leaseEvents.matterId, matter.id));

    const writes: Array<{
      eventType: string;
      eventDate: Date | null;
      noticeDate?: Date | null;
      notes: string;
    }> = [];
    if (matter.currentRentReviewDate) {
      writes.push({
        eventType: "rent_review",
        eventDate: new Date(matter.currentRentReviewDate as any),
        notes: `From PLA matter (${matter.matterType.replace(/_/g, " ")}, ${matter.status})`,
      });
    }
    if (matter.breakDate) {
      writes.push({
        eventType: "break",
        eventDate: new Date(matter.breakDate as any),
        notes: `From PLA matter (${matter.matterType.replace(/_/g, " ")}, ${matter.status})`,
      });
    }
    if (matter.expiryDate) {
      writes.push({
        eventType: "expiry",
        eventDate: new Date(matter.expiryDate as any),
        notes: `From PLA matter (${matter.matterType.replace(/_/g, " ")}, ${matter.status})`,
      });
    }
    if (matter.counterNoticeDeadline) {
      writes.push({
        eventType: "counter_notice_deadline",
        eventDate: new Date(matter.counterNoticeDeadline as any),
        notes: `Counter-notice deadline · ${matter.matterType.replace(/_/g, " ")}, acting for ${matter.actingFor || "—"}`,
      });
    }

    if (writes.length === 0) return;

    // Look up the property for address/tenant context
    const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, matter.propertyId));
    const addressStr = property?.name || (typeof property?.address === "string" ? property.address : (property?.address as any)?.formatted) || null;

    for (const w of writes) {
      await db.insert(leaseEvents).values({
        propertyId: matter.propertyId,
        address: addressStr,
        eventType: w.eventType,
        eventDate: w.eventDate,
        noticeDate: w.noticeDate || null,
        currentRent: matter.currentRent != null ? String(matter.currentRent) : null,
        estimatedErv: matter.quotingRent != null ? String(matter.quotingRent) : null,
        sourceEvidence: "PLA Matter",
        status: matter.status === "closed" || matter.status === "settled" ? "Resolved" : "Monitoring",
        notes: w.notes,
        matterId: matter.id,
        assignedTo: matter.leadUserId,
      });
    }
  } catch (err: any) {
    // Best-effort — never break the matter create/update on a sync failure
    console.warn(`[pla-matters] lease_events sync failed for matter ${matter.id}:`, err?.message);
  }
}

// Lease advisory now uses the standard deal lifecycle codes — same as
// leasing tracker — so PLA work shows on the deal CRM kanban alongside
// leasing deals. Old bespoke values (open/in_negotiation/...) are accepted
// only for backwards compat reads; new writes must use the standard codes.
const VALID_STATUSES = new Set([
  "REP", "SPEC", "LIVE", "AVA", "NEG", "SOL", "EXC", "COM", "WIT", "INV",
  // Legacy values still accepted on read for old data; UI remaps via migration 0019.
  "open", "in_negotiation", "agreed", "settled", "closed", "on_hold",
]);

// pla_matters.matter_type → crm_deals.deal_type. Dilaps / SC / General all
// roll up under "Consultancy" on the deal board — the matter_type stays
// granular on pla_matters for filtering inside the Lease Advisory views.
const MATTER_TYPE_TO_DEAL_TYPE: Record<string, string> = {
  rent_review: "Rent Review",
  lease_renewal: "Lease Renewal",
  dilapidations: "Consultancy",
  service_charge: "Consultancy",
  general: "Consultancy",
};

export function registerPlaMattersRoutes(app: Express): void {
  // ── List ───────────────────────────────────────────────────────────────────
  app.get("/api/pla/matters", requireAuth, async (req: Request, res: Response) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const leadUserId = typeof req.query.lead === "string" ? req.query.lead : undefined;
      const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
      const includeClosed = req.query.includeClosed === "true";

      const conds: any[] = [];
      if (status) conds.push(eq(plaMatters.status, status));
      if (leadUserId) conds.push(eq(plaMatters.leadUserId, leadUserId));
      if (propertyId) conds.push(eq(plaMatters.propertyId, propertyId));
      if (!includeClosed && !status) {
        conds.push(sql`${plaMatters.status} NOT IN ('closed','settled')`);
      }
      const where = conds.length ? and(...conds) : undefined;

      // Join the property name so the UI never has to show a raw id.
      const rows = await db
        .select({ matter: plaMatters, propertyName: crmProperties.name })
        .from(plaMatters)
        .leftJoin(crmProperties, eq(plaMatters.propertyId, crmProperties.id))
        .where(where as any)
        .orderBy(desc(plaMatters.updatedAt))
        .limit(500);
      return res.json(rows.map(r => ({ ...r.matter, propertyName: r.propertyName })));
    } catch (err: any) {
      console.error("[pla-matters] list error:", err);
      return res.status(500).json({ error: err?.message || "list failed" });
    }
  });

  // ── Get one (with linked comps, events, workbooks) ────────────────────────
  app.get("/api/pla/matters/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const [matter] = await db.select().from(plaMatters).where(eq(plaMatters.id, id));
      if (!matter) return res.status(404).json({ error: "matter not found" });
      const [prop] = await db.select({ name: crmProperties.name }).from(crmProperties).where(eq(crmProperties.id, matter.propertyId));
      const [comps, events, workbooks] = await Promise.all([
        db.select().from(plaMatterComps).where(eq(plaMatterComps.matterId, id)),
        db.select().from(plaMatterEvents).where(eq(plaMatterEvents.matterId, id)).orderBy(plaMatterEvents.eventDate),
        db.select().from(plaMatterWorkbooks).where(eq(plaMatterWorkbooks.matterId, id)).orderBy(desc(plaMatterWorkbooks.generatedAt)),
      ]);
      return res.json({ matter: { ...matter, propertyName: prop?.name ?? null }, comps, events, workbooks });
    } catch (err: any) {
      console.error("[pla-matters] get error:", err);
      return res.status(500).json({ error: err?.message || "get failed" });
    }
  });

  // ── Create — accepts either an existing propertyId or a PropertyInput ─────
  app.post("/api/pla/matters", requireAuth, async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      // Resolve property identity. Caller can pass propertyId directly OR a
      // PropertyInput (address/uprn/etc) — every PLA matter is anchored to a
      // canonical property.
      let propertyId: string | undefined = typeof body.propertyId === "string" ? body.propertyId : undefined;
      if (!propertyId && body.propertyInput) {
        const r = await resolveProperty(body.propertyInput as PropertyInput);
        if (r.kind === "resolved") propertyId = r.property.id;
        else if (r.kind === "candidates")
          return res.status(409).json({ error: "ambiguous property — pick one", candidates: r.candidates });
        else return res.status(404).json({ error: r.reason });
      }
      if (!propertyId) return res.status(400).json({ error: "propertyId or propertyInput required" });

      const matterType = String(body.matterType || "general");
      if (!VALID_TYPES.has(matterType)) {
        return res.status(400).json({ error: `invalid matterType — must be one of ${[...VALID_TYPES].join(", ")}` });
      }

      const userId = (req as any).user?.id;
      const insert: InsertPlaMatter = {
        propertyId,
        unitId: body.unitId || null,
        matterType,
        clientContactId: body.clientContactId || null,
        clientCompanyId: body.clientCompanyId || null,
        actingFor: body.actingFor || null,
        leadUserId: body.leadUserId || userId,
        teamUserIds: Array.isArray(body.teamUserIds) ? body.teamUserIds : null,
        currentRent: typeof body.currentRent === "number" ? body.currentRent : null,
        currentRentReviewDate: body.currentRentReviewDate ? new Date(body.currentRentReviewDate) : null,
        breakDate: body.breakDate ? new Date(body.breakDate) : null,
        expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
        quotingRent: typeof body.quotingRent === "number" ? body.quotingRent : null,
        counterQuotingRent: typeof body.counterQuotingRent === "number" ? body.counterQuotingRent : null,
        noticeServedAt: body.noticeServedAt ? new Date(body.noticeServedAt) : null,
        noticeServedBy: body.noticeServedBy || null,
        counterNoticeDeadline: body.counterNoticeDeadline ? new Date(body.counterNoticeDeadline) : null,
        notes: body.notes || null,
        tags: Array.isArray(body.tags) ? body.tags : null,
        status: VALID_STATUSES.has(body.status) ? body.status : "REP",
      };

      const [created] = await db.insert(plaMatters).values(insert).returning();

      // Auto-create the backing crm_deals row so the instruction appears on
      // the deal CRM kanban with the rest. Mirrors what Add Unit does for
      // leasing. Deal type derived from matter_type; team = "Lease Advisory".
      try {
        const [property] = await db
          .select({ name: crmProperties.name })
          .from(crmProperties)
          .where(eq(crmProperties.id, propertyId));
        const dealType = MATTER_TYPE_TO_DEAL_TYPE[matterType] || "General Advisory";
        const deal = await storage.createCrmDeal({
          name: property?.name ? `${property.name} — ${dealType}` : dealType,
          propertyId,
          unitId: created.unitId || undefined,
          status: created.status,
          dealType,
          team: ["Lease Advisory"],
          internalAgent: created.leadUserId ? [created.leadUserId] : [],
          fee: typeof body.fee === "number" ? body.fee : undefined,
        } as any);
        await db.update(plaMatters).set({ dealId: deal.id }).where(eq(plaMatters.id, created.id));
        (created as any).dealId = deal.id;
      } catch (e: any) {
        console.warn(`[pla-matters POST] auto-create deal failed for matter ${created.id}:`, e?.message);
      }

      // Sync lease_events so this matter's key dates surface on dashboards
      syncLeaseEventsForMatter(created).catch(() => {});

      // Fire-and-forget: apply Tom + Pete's canonical Lease Advisory folder
      // template in SharePoint. We don't block the create response on this —
      // the UI refetches and picks up sharepointFolderUrl when it lands.
      const token = await getValidMsToken(req).catch(() => null);
      if (token) {
        const [property] = await db
          .select({ name: crmProperties.name })
          .from(crmProperties)
          .where(eq(crmProperties.id, propertyId));
        if (property?.name) {
          // intentionally not awaited — best-effort background work
          applyLeaseAdvisoryFolderTemplate(created.id, property.name, token).catch((err) =>
            console.warn("[pla-matters] folder template fire-and-forget failed:", err?.message),
          );
        }
      } else {
        console.log(`[pla-matters] no MS token for matter ${created.id} — folder template skipped`);
      }

      return res.json(created);
    } catch (err: any) {
      console.error("[pla-matters] create error:", err);
      return res.status(500).json({ error: err?.message || "create failed" });
    }
  });

  // Re-apply the folder template — useful if the original creation failed
  // (no MS token, network blip) or if Tom wants to re-create the structure
  // after manually deleting it.
  app.post("/api/pla/matters/:id/apply-folder-template", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const [matter] = await db.select().from(plaMatters).where(eq(plaMatters.id, id));
      if (!matter) return res.status(404).json({ error: "matter not found" });
      const [property] = await db
        .select({ name: crmProperties.name })
        .from(crmProperties)
        .where(eq(crmProperties.id, matter.propertyId));
      if (!property?.name) return res.status(400).json({ error: "matter property has no name" });
      const token = await getValidMsToken(req);
      if (!token) return res.status(401).json({ error: "Microsoft 365 not connected for this user" });
      const result = await applyLeaseAdvisoryFolderTemplate(id, property.name, token);
      return res.json(result);
    } catch (err: any) {
      console.error("[pla-matters] apply-folder-template error:", err);
      return res.status(500).json({ error: err?.message || "apply failed" });
    }
  });

  // ── Update ─────────────────────────────────────────────────────────────────
  app.patch("/api/pla/matters/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const body = req.body || {};
      const updates: any = {};
      const setIfPresent = (key: string, transform?: (v: any) => any) => {
        if (key in body) updates[key] = transform ? transform(body[key]) : body[key];
      };
      const dt = (v: any) => (v ? new Date(v) : null);

      setIfPresent("matterType");
      setIfPresent("clientContactId");
      setIfPresent("clientCompanyId");
      setIfPresent("actingFor");
      setIfPresent("leadUserId");
      setIfPresent("teamUserIds");
      setIfPresent("currentRent");
      setIfPresent("currentRentReviewDate", dt);
      setIfPresent("breakDate", dt);
      setIfPresent("expiryDate", dt);
      setIfPresent("quotingRent");
      setIfPresent("counterQuotingRent");
      setIfPresent("agreedRent");
      setIfPresent("noticeServedAt", dt);
      setIfPresent("noticeServedBy");
      setIfPresent("counterNoticeDeadline", dt);
      setIfPresent("counterNoticeServedAt", dt);
      setIfPresent("notes");
      setIfPresent("tags");
      if (body.status && VALID_STATUSES.has(body.status)) {
        updates.status = body.status;
        if (body.status === "settled") updates.settledAt = new Date();
        if (body.status === "closed") updates.closedAt = new Date();
      }
      updates.updatedAt = new Date();

      const [updated] = await db
        .update(plaMatters)
        .set(updates)
        .where(eq(plaMatters.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: "matter not found" });
      // Re-sync lease_events with the new dates / status
      syncLeaseEventsForMatter(updated).catch(() => {});
      return res.json(updated);
    } catch (err: any) {
      console.error("[pla-matters] update error:", err);
      return res.status(500).json({ error: err?.message || "update failed" });
    }
  });

  // ── Soft close ─────────────────────────────────────────────────────────────
  app.delete("/api/pla/matters/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const [closed] = await db
        .update(plaMatters)
        .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
        .where(eq(plaMatters.id, id))
        .returning();
      if (!closed) return res.status(404).json({ error: "matter not found" });
      // Re-sync lease_events to mark them Resolved
      syncLeaseEventsForMatter(closed).catch(() => {});
      return res.json(closed);
    } catch (err: any) {
      console.error("[pla-matters] close error:", err);
      return res.status(500).json({ error: err?.message || "close failed" });
    }
  });

  // ── Linked comps ───────────────────────────────────────────────────────────
  app.post("/api/pla/matters/:id/comps", requireAuth, async (req: Request, res: Response) => {
    try {
      const matterId = String(req.params.id);
      const compId = String(req.body?.compId || "");
      if (!compId) return res.status(400).json({ error: "compId required" });
      const weight = typeof req.body?.weight === "number" ? req.body.weight : 1.0;
      const userId = (req as any).user?.id;
      await db
        .insert(plaMatterComps)
        .values({ matterId, compId, weight, notes: req.body?.notes || null, addedBy: userId })
        .onConflictDoNothing();
      return res.json({ ok: true });
    } catch (err: any) {
      console.error("[pla-matters] link comp error:", err);
      return res.status(500).json({ error: err?.message || "link comp failed" });
    }
  });

  app.delete("/api/pla/matters/:id/comps/:compId", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const compId = String(req.params.compId);
      await db
        .delete(plaMatterComps)
        .where(and(eq(plaMatterComps.matterId, id), eq(plaMatterComps.compId, compId)));
      return res.json({ ok: true });
    } catch (err: any) {
      console.error("[pla-matters] unlink comp error:", err);
      return res.status(500).json({ error: err?.message || "unlink comp failed" });
    }
  });

  // ── Events / key dates ─────────────────────────────────────────────────────
  app.post("/api/pla/matters/:id/events", requireAuth, async (req: Request, res: Response) => {
    try {
      const matterId = String(req.params.id);
      const body = req.body || {};
      const eventKind = String(body.eventKind || "note");
      const eventDate = body.eventDate ? new Date(body.eventDate) : new Date();
      const userId = (req as any).user?.id;
      const [created] = await db
        .insert(plaMatterEvents)
        .values({
          matterId,
          eventKind,
          eventDate,
          description: body.description || null,
          createdBy: userId,
        })
        .returning();
      return res.json(created);
    } catch (err: any) {
      console.error("[pla-matters] event create error:", err);
      return res.status(500).json({ error: err?.message || "event create failed" });
    }
  });

  app.patch("/api/pla/matters/:id/events/:eventId", requireAuth, async (req: Request, res: Response) => {
    try {
      const eventId = String(req.params.eventId);
      const body = req.body || {};
      const updates: any = {};
      if ("done" in body) {
        updates.done = !!body.done;
        if (body.done) updates.doneAt = new Date();
      }
      if ("description" in body) updates.description = body.description;
      if ("eventDate" in body) updates.eventDate = new Date(body.eventDate);
      if ("eventKind" in body) updates.eventKind = body.eventKind;
      const [updated] = await db
        .update(plaMatterEvents)
        .set(updates)
        .where(eq(plaMatterEvents.id, eventId))
        .returning();
      if (!updated) return res.status(404).json({ error: "event not found" });
      return res.json(updated);
    } catch (err: any) {
      console.error("[pla-matters] event update error:", err);
      return res.status(500).json({ error: err?.message || "event update failed" });
    }
  });
}
