// The Investment tracker's write path — one place for the Sales / Purchases
// board, ChatBGP and anything else that adds or edits an asset (Woody,
// 2026-09-27: one source of truth). Every asset gets its backing Investment
// team deal on create; every edit writes through to that deal (parties,
// price, yield, dates, status), runs the AML gate / kick-off and, on
// exchange or completion, the comp + change of owner.
import { db, pool } from "./db";
import { storage } from "./storage";
import { eq } from "drizzle-orm";
import { investmentTracker, crmProperties, insertInvestmentTrackerSchema } from "@shared/schema";
import { legacyToCode } from "@shared/deal-status";

// available_units / investment_tracker store agent user IDs (text[] of
// user.id), but crm_deals.internal_agent stores display NAMES (the
// deal-detail chip render + the BGP-Contact dropdown both look up by
// name). Without this resolver, deals auto-created off the trackers
// surfaced raw UUIDs in the Edit Deal dialog and on the kanban chip.
export async function resolveAgentNames(userIds: string[] | null | undefined): Promise<string[]> {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  const r = await pool.query<{ name: string }>(
    `SELECT name FROM users WHERE id = ANY($1::varchar[])`,
    [userIds],
  );
  return r.rows.map(row => row.name).filter((n): n is string => !!n);
}

// The backing deal's parties, from a tracker row (Woody, 2026-09-26 —
// sales cut across landlords, buyers and agents, so the deal must carry
// them): the client sits on the side BGP acts for (vendor on a Sale,
// purchaser on a Purchase), a Sales-board buyer becomes the purchaser, and
// the vendor agent is recorded as firm + person. Every tracker deal is
// an Investment team deal (comp auto-promotion keys off that).
export async function trackerDealParties(row: any): Promise<Record<string, any>> {
  const sale = (row.boardType || "Purchases") === "Sales";
  const parties: Record<string, any> = {};
  if (sale) {
    if (row.clientId) { parties.vendorId = row.clientId; parties.landlordId = row.clientId; }
    else if (row.vendorId) parties.vendorId = row.vendorId;
    parties.purchaserId = row.buyerId || null;          // cleared buyer clears the purchaser
  } else {
    if (row.clientId) parties.purchaserId = row.clientId;
    if (row.vendorId) parties.vendorId = row.vendorId;
  }
  parties.vendorAgentContactId = row.vendorAgentId || null;
  parties.vendorAgentId = null;
  if (row.vendorAgentId) {
    const agentFirm = await pool.query(`SELECT company_id FROM crm_contacts WHERE id = $1`, [row.vendorAgentId]).catch(() => ({ rows: [] as any[] }));
    parties.vendorAgentId = agentFirm.rows[0]?.company_id || null;
  }
  return parties;
}
// A Sales-board asset marks its property as a Sales Instruction, unless
// the property already carries a status someone set.
export async function markSalesInstruction(row: any) {
  if ((row.boardType || "Purchases") !== "Sales" || !row.propertyId) return;
  await pool.query(`UPDATE crm_properties SET status = 'Sales Instruction' WHERE id = $1 AND (status IS NULL OR status = '')`, [row.propertyId])
    .catch((e: any) => console.warn("[investment-tracker] sales instruction sync failed:", e?.message));
}

export async function createTrackerAsset(input: Record<string, any>) {
  const body = { ...input };
  if (typeof body.status === "string") body.status = legacyToCode(body.status) || body.status;
  // Validate before touching the DB so a bad payload can't strand an
  // orphan crm_properties row; propertyId is derived below, checked last.
  const base = insertInvestmentTrackerSchema.omit({ propertyId: true }).parse(body);
  if (!body.propertyId && base.assetName) {
    const [existing] = await db.select().from(crmProperties).where(eq(crmProperties.name, base.assetName)).limit(1);
    if (existing) {
      body.propertyId = existing.id;
    } else {
      const [newProp] = await db.insert(crmProperties).values({
        name: base.assetName,
        address: base.address ? { street: base.address } : null,
        assetClass: base.assetType || null,
        tenure: base.tenure || null,
      }).returning();
      body.propertyId = newProp.id;
    }
  }
  const propertyId = insertInvestmentTrackerSchema.shape.propertyId.parse(body.propertyId);
  const [row] = await db.insert(investmentTracker).values({ ...base, propertyId }).returning();

  // Auto-create a backing CRM deal
  if (!row.dealId) {
    try {
      const dealType = row.boardType === "Sales" ? "Sale" : "Purchase";
      const deal = await storage.createCrmDeal({
        name: row.assetName,
        propertyId: row.propertyId,
        status: "REP",
        dealType,
        team: ["Investment"],
        internalAgent: await resolveAgentNames(row.agentUserIds),
        fee: row.fee ?? undefined,
        ...(await trackerDealParties(row)),
      } as any);
      await db.update(investmentTracker).set({ dealId: deal.id }).where(eq(investmentTracker.id, row.id));
      (row as any).dealId = deal.id;
      (row as any).dealRef = deal.dealRef;
    } catch (e: any) {
      console.warn("[investment-tracker POST] auto-create deal failed:", e.message);
    }
  }
  await markSalesInstruction(row);

  return row;
}

export async function updateTrackerAsset(id: string, body: Record<string, any>, actor: { id?: string | null } = {}): Promise<{ status: number; body: any }> {
  const allowedFields = new Set([
    "propertyId", "assetName", "assetType", "tenure", "guidePrice", "niy", "eqy", "sqft",
    "waultBreak", "waultExpiry", "currentRent", "ervPa", "occupancy", "capexRequired",
    "boardType", "status", "client", "clientContact", "vendor", "vendorAgent", "buyer",
    "address", "notes", "dealId", "agentUserIds", "fee", "feeType", "marketingDate", "bidDeadline", "completionDate",
    // Link FKs — without these the inline Client/Vendor/Agent pickers
    // silently dropped every selection (PATCH ignored unknown keys).
    "clientId", "clientContactId", "vendorId", "vendorAgentId", "buyerId",
  ]);
  const updates: Record<string, any> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(body)) {
    if (allowedFields.has(key)) updates[key] = value;
  }
  if (typeof updates.status === "string") updates.status = legacyToCode(updates.status) || updates.status;

  const [before] = await db.select({ status: investmentTracker.status, dealId: investmentTracker.dealId }).from(investmentTracker).where(eq(investmentTracker.id, id));
  const statusMoved = "status" in updates && !!before && legacyToCode(before.status) !== legacyToCode(updates.status as string);
  // Tracker status moves aren't gated (Woody, 2026-09-27) — incomplete
  // CDD is recorded on the deal and queued for the MLRO, the same as the
  // deals board. Only a counterparty the MLRO rejected stops a move to
  // Solicitors or beyond.
  let amlWarning: string | null = null;
  const actorId = actor.id || null;
  if (statusMoved && before?.dealId && ["SOL", "EXC", "COM", "INV"].includes(legacyToCode(updates.status as string) || "")) {
    const dealRow = await pool.query(`SELECT landlord_id, tenant_id, vendor_id, purchaser_id, aml_check_completed FROM crm_deals WHERE id = $1`, [before.dealId]);
    const dr = dealRow.rows[0];
    if (dr && dr.aml_check_completed !== "YES") {
      const { checkCounterpartyAml, amlGateOutcome, recordAmlGateWarning } = await import("./deal-gates");
      const parties = { landlordId: dr.landlord_id, tenantId: dr.tenant_id, vendorId: dr.vendor_id, purchaserId: dr.purchaser_id };
      const amlResult = await checkCounterpartyAml(parties);
      const outcome = amlGateOutcome(amlResult);
      if (outcome.block) return { status: 409, body: { message: outcome.block, code: "AML_GATE_FAILED", notReady: amlResult.notReady } };
      if (outcome.warning) {
        amlWarning = outcome.warning;
        await recordAmlGateWarning(String(before.dealId), parties, amlResult, { targetStatus: String(updates.status), actorId });
      }
    }
  }

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(investmentTracker).set(updates).where(eq(investmentTracker.id, id)).returning();
    if (!updated) return null;

    if (updated.propertyId) {
      const syncFields: Record<string, any> = {};
      if (updates.assetName !== undefined) syncFields.name = updates.assetName;
      if (updates.address !== undefined) syncFields.address = typeof updates.address === 'string' ? { street: updates.address } : updates.address;
      if (updates.assetType !== undefined) syncFields.assetClass = updates.assetType;
      if (updates.tenure !== undefined) syncFields.tenure = updates.tenure;
      if (Object.keys(syncFields).length > 0) {
        await tx.update(crmProperties).set(syncFields).where(eq(crmProperties.id, updated.propertyId));
      }
    }

    return updated;
  });

  if (!row) return { status: 404, body: { message: "Not found" } };
  if ("boardType" in updates || "propertyId" in updates) await markSalesInstruction(row);

  // Mirror status/fee/agent/parties onto the backing crm_deal so the
  // Deals board + WIP stay in step with inline investment-tracker edits.
  if (row.dealId) {
    const dealPatch: Record<string, any> = {};
    if ("status" in updates) dealPatch.status = updates.status;
    if ("fee" in updates) dealPatch.fee = updates.fee;
    if ("agentUserIds" in updates) dealPatch.internalAgent = await resolveAgentNames(updates.agentUserIds);
    // The client is the landlord only when BGP is selling for them.
    if ("clientId" in updates && ((("boardType" in updates ? updates.boardType : row.boardType) || "Purchases") === "Sales")) dealPatch.landlordId = updates.clientId || null;
    // Pricing, yield, size, property and dates follow the tracker so the
    // deal (and the comp it becomes) carries them.
    if ("guidePrice" in updates) dealPatch.pricing = updates.guidePrice ?? null;
    if ("niy" in updates) dealPatch.yieldPercent = updates.niy ?? null;
    if ("sqft" in updates) dealPatch.totalAreaSqft = updates.sqft ?? null;
    if ("propertyId" in updates && updates.propertyId) dealPatch.propertyId = updates.propertyId;
    if ("completionDate" in updates && updates.completionDate) dealPatch.completedAt = new Date(updates.completionDate);
    if ("status" in updates) {
      const code = legacyToCode(updates.status as string);
      if (code === "EXC") dealPatch.exchangedAt = new Date();
      if (code === "COM" && !row.completionDate) {
        const today = new Date().toISOString().slice(0, 10);
        await db.update(investmentTracker).set({ completionDate: today }).where(eq(investmentTracker.id, row.id));
        (row as any).completionDate = today;
        dealPatch.completedAt = new Date();
      }
    }
    if ("vendorId" in updates) dealPatch.vendorId = updates.vendorId || null;
    // Board switch (Sales ⇄ Purchases) retypes the backing deal so the
    // Deals board, WIP report and the deal form's party rules follow.
    // The client sits on the deal as the side we act for: purchaser on
    // an acquisition, vendor on a disposal.
    if ("boardType" in updates) {
      dealPatch.dealType = updates.boardType === "Sales" ? "Sale" : "Purchase";
    }
    const effectiveBoard = ("boardType" in updates ? updates.boardType : row.boardType) || "Purchases";
    if ("boardType" in updates || "clientId" in updates) {
      const clientId = ("clientId" in updates ? updates.clientId : row.clientId) || null;
      if (clientId) {
        if (effectiveBoard === "Sales") dealPatch.vendorId = clientId;
        else dealPatch.purchaserId = clientId;
      }
    }
    // Buyer, vendor or vendor agent changed → re-derive the parties and
    // make sure it's an Investment team deal.
    if (["boardType", "clientId", "vendorId", "vendorAgentId", "buyerId"].some(k => k in updates)) {
      // Only the parties this edit touched — re-deriving the rest would
      // wipe a vendor agent or buyer set on the deal page.
      const parties = await trackerDealParties(row);
      const touches: Record<string, string[]> = {
        vendorAgentId: ["vendorAgentId"], vendorAgentContactId: ["vendorAgentId"],
        purchaserId: ["buyerId", "clientId"], vendorId: ["clientId", "vendorId"], landlordId: ["clientId"],
      };
      for (const [key, value] of Object.entries(parties)) {
        if ("boardType" in updates || (touches[key] || []).some(t => t in updates)) dealPatch[key] = value;
      }
      const current = await pool.query(`SELECT team FROM crm_deals WHERE id = $1`, [row.dealId]).catch(() => ({ rows: [] as any[] }));
      const team: string[] = current.rows[0]?.team || [];
      if (!team.includes("Investment")) dealPatch.team = [...team, "Investment"];
    }
    if (Object.keys(dealPatch).length > 0) {
      try {
        await storage.updateCrmDeal(row.dealId, dealPatch as any);
      } catch (e: any) {
        console.warn(`[investment-tracker PATCH] deal sync failed for ${row.dealId}:`, e?.message);
      }
    }
    // Exchanged / completed → the one linked comp (the deal route's
    // promotion never fires here since we call storage directly).
    if ("status" in updates && ["EXC", "COM", "INV"].includes(legacyToCode(updates.status as string) || "")) {
      try {
        const { completeInvestmentDeal } = await import("./investment-deal-sync");
        const done = await completeInvestmentDeal(row.dealId, { actorId });
        (row as any).ownerChanged = done.transferred;
      } catch (e: any) {
        console.warn(`[investment-tracker PATCH] comp promotion failed for ${row.dealId}:`, e?.message);
      }
    }
    // HOTs / Solicitors starts the AML sweep on the counterparties.
    if (statusMoved) {
      try {
        const { startAmlOnStatus } = await import("./investment-deal-sync");
        const aml = await startAmlOnStatus(row.dealId, before?.status, updates.status as string, { id: actorId });
        (row as any).amlStarted = aml.started;
        (row as any).amlNote = aml.started ? null : aml.reason;
      } catch (e: any) {
        console.warn(`[investment-tracker PATCH] AML start failed for ${row.dealId}:`, e?.message);
      }
    }
    // We bypass /api/crm/deals/:id (calling storage directly), so the
    // route's mirrorFromDeal fan-out never fires. Trigger it manually
    // when status changed so available_units + leasing_schedule +
    // tenancy stay in lockstep with investment-tracker edits.
    if ("status" in updates) {
      try {
        const { mirrorFromDeal } = await import("./lease-status-mirror");
        await mirrorFromDeal(row.dealId, updates.status as string, { pool, reason: "investment-tracker.PATCH" });
      } catch (e: any) {
        console.warn(`[investment-tracker PATCH] mirror fan-out failed for ${row.dealId}:`, e?.message);
      }
    }
  }

  return { status: 200, body: { ...row, amlWarning } };
}

// ChatBGP passes names, not ids: link client / vendor / buyer to the CRM
// company when the name matches exactly one (after dropping Ltd / PLC …).
export async function linkTrackerNames(fields: Record<string, any>): Promise<Record<string, any>> {
  const out = { ...fields };
  const pairs: Array<[string, string]> = [["client", "clientId"], ["vendor", "vendorId"], ["buyer", "buyerId"]];
  if (!pairs.some(([n, i]) => out[n] && !out[i])) return out;
  const { buyerNameKey } = await import("./investment-buyers");
  const { rows } = await pool.query(`SELECT id, name FROM crm_companies WHERE name IS NOT NULL AND merged_into_id IS NULL`);
  const byKey = new Map<string, string[]>();
  for (const c of rows) { const k = buyerNameKey(c.name); if (k.length >= 3) byKey.set(k, [...(byKey.get(k) || []), c.id]); }
  for (const [n, i] of pairs) {
    if (!out[n] || out[i]) continue;
    const ids = byKey.get(buyerNameKey(out[n]));
    if (ids?.length === 1) out[i] = ids[0];
  }
  return out;
}

// Extra clients on an asset (BGP acting for several buyers). Each is linked
// to the backing deal too, so the deal and the company's page show it.
export async function addTrackerClient(trackerId: string, companyId: string, actorId: string | null) {
  const tracker = (await pool.query(`SELECT id, client_id, deal_id FROM investment_tracker WHERE id = $1`, [trackerId])).rows[0];
  if (!tracker) return { status: 404, body: { message: "Asset not found" } };
  const company = (await pool.query(`SELECT id, name FROM crm_companies WHERE id = $1 AND merged_into_id IS NULL`, [companyId])).rows[0];
  if (!company) return { status: 404, body: { message: "Company not found" } };
  if (!tracker.client_id) {
    await pool.query(`UPDATE investment_tracker SET client_id = $2, client = $3, updated_at = NOW() WHERE id = $1`, [trackerId, company.id, company.name]);
    if (tracker.deal_id) await syncPrimaryClientToDeal(trackerId);
  } else if (tracker.client_id !== company.id) {
    await pool.query(
      `INSERT INTO investment_tracker_clients (tracker_id, company_id, added_by)
       SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM investment_tracker_clients WHERE tracker_id = $1 AND company_id = $2)`,
      [trackerId, company.id, actorId]);
  }
  if (tracker.deal_id) {
    await pool.query(`INSERT INTO crm_company_deals (company_id, deal_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [company.id, tracker.deal_id])
      .catch((e: any) => console.warn("[investment-tracker] client deal link failed:", e?.message));
  }
  return { status: 200, body: { ok: true, clients: await trackerClients(trackerId) } };
}

export async function removeTrackerClient(trackerId: string, companyId: string) {
  const tracker = (await pool.query(`SELECT id, client_id, deal_id FROM investment_tracker WHERE id = $1`, [trackerId])).rows[0];
  if (!tracker) return { status: 404, body: { message: "Asset not found" } };
  await pool.query(`DELETE FROM investment_tracker_clients WHERE tracker_id = $1 AND company_id = $2`, [trackerId, companyId]);
  if (tracker.client_id === companyId) {
    // The next client steps up as the primary one.
    const next = (await pool.query(
      `SELECT tc.company_id, c.name FROM investment_tracker_clients tc JOIN crm_companies c ON c.id = tc.company_id
        WHERE tc.tracker_id = $1 ORDER BY tc.added_at LIMIT 1`, [trackerId])).rows[0];
    await pool.query(`UPDATE investment_tracker SET client_id = $2, client = $3, updated_at = NOW() WHERE id = $1`, [trackerId, next?.company_id || null, next?.name || null]);
    if (next) await pool.query(`DELETE FROM investment_tracker_clients WHERE tracker_id = $1 AND company_id = $2`, [trackerId, next.company_id]);
    if (tracker.deal_id) await syncPrimaryClientToDeal(trackerId);
  }
  if (tracker.deal_id) {
    // Leave the deal link when the company is still a party on the deal.
    await pool.query(
      `DELETE FROM crm_company_deals cd WHERE cd.company_id = $1 AND cd.deal_id = $2
          AND NOT EXISTS (SELECT 1 FROM crm_deals d WHERE d.id = $2 AND $1 IN (d.landlord_id, d.tenant_id, d.vendor_id, d.purchaser_id))`,
      [companyId, tracker.deal_id]).catch(() => undefined);
  }
  return { status: 200, body: { ok: true, clients: await trackerClients(trackerId) } };
}

export async function trackerClients(trackerId: string) {
  return (await pool.query(
    `SELECT c.id AS "companyId", c.name, MIN(tc.added_at) AS "addedAt"
       FROM investment_tracker_clients tc JOIN crm_companies c ON c.id = tc.company_id
      WHERE tc.tracker_id = $1 GROUP BY c.id, c.name ORDER BY 3`, [trackerId])).rows;
}

async function syncPrimaryClientToDeal(trackerId: string) {
  const row = (await db.select().from(investmentTracker).where(eq(investmentTracker.id, trackerId)))[0];
  if (!row?.dealId) return;
  const parties = await trackerDealParties(row);
  const patch: Record<string, any> = {};
  if ((row.boardType || "Purchases") === "Sales") { patch.vendorId = parties.vendorId ?? null; patch.landlordId = parties.landlordId ?? null; }
  else patch.purchaserId = parties.purchaserId ?? null;
  await storage.updateCrmDeal(row.dealId, patch as any).catch((e: any) => console.warn("[investment-tracker] client deal sync failed:", e?.message));
}
