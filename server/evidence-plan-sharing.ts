import { randomBytes } from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import type { SharedEvidencePlan } from "../shared/evidence-plan-sharing";
import { EVIDENCE_SHARE_TOKEN, EVIDENCE_SHARE_UUID, EvidencePlanShareError, presentEvidencePlanShare,
  presentSharedEvidenceEntry, presentSharedEvidenceUnit, sharedFileType, shareNumber, shareTimestamp,
  validateEvidencePlanShareSettings, validateExpectedEvidencePlanShare, assertExpectedEvidencePlanShare } from "./evidence-plan-share-policy";

export interface EvidenceShareQuery {
  query(sql: string, values?: any[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export interface EvidenceShareClient extends EvidenceShareQuery { release(): void }
export interface EvidenceShareDatabase extends EvidenceShareQuery { connect(): Promise<EvidenceShareClient> }
export interface EvidencePlanSharingDependencies {
  db: EvidenceShareDatabase;
  requireAuth: RequestHandler;
  isClientRequestUser(req: Request): Promise<boolean>;
  resolveCompanyScope(req: Request): Promise<string | null>;
  getFile(key: string): Promise<{ data: Buffer; contentType: string; originalName?: string | null; size?: number } | null>;
  ensureSchema?(): Promise<void>;
  tokenFactory?(): string;
}

/** Independent of the legacy plan module's unawaited startup DDL. All access
 * also checks the live parent plan, including after that plan is deleted. */
export async function ensureEvidencePlanShareSchema(db: EvidenceShareQuery): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS evidence_plan_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    token TEXT NOT NULL UNIQUE,
    entry_ids UUID[] NOT NULL DEFAULT '{}',
    document_entry_ids UUID[] NOT NULL DEFAULT '{}',
    include_unit_facts BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    CHECK (document_entry_ids <@ entry_ids)
  )`);
  // Existing read-only links retain their original capability.
  await db.query(`ALTER TABLE evidence_plan_shares ADD COLUMN IF NOT EXISTS
    access_mode TEXT NOT NULL DEFAULT 'view' CHECK (access_mode IN ('view', 'edit'))`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS evidence_plan_shares_one_active
    ON evidence_plan_shares (plan_id) WHERE revoked_at IS NULL`);
}

function privateHeaders(_req: Request, res: Response, next: () => void) {
  res.set({ "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache", "Expires": "0",
    "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" });
  next();
}

function respondError(res: Response, error: unknown) {
  // Database/storage errors may contain bearer tokens or storage keys. Never
  // return/log their messages or pass them into the global request error logger.
  if (error instanceof EvidencePlanShareError) return res.status(error.status).json({ error: error.message });
  return res.status(500).json({ error: "Unable to load or save the shared plan" });
}
const notFound = () => new EvidencePlanShareError(404, "Shared plan not found");

export function createEvidencePlanSharingRouters(deps: EvidencePlanSharingDependencies) {
  const staffRouter = Router(), publicRouter = Router();
  let schemaReady: Promise<void> | undefined;
  const ready = () => schemaReady ??= (deps.ensureSchema ? deps.ensureSchema() : ensureEvidencePlanShareSchema(deps.db))
    .catch(error => { schemaReady = undefined; throw error; });
  const tokenFactory = deps.tokenFactory ?? (() => randomBytes(32).toString("base64url"));

  const staffOnly: RequestHandler = async (req, res, next) => {
    try {
      const userId = (req as any).session?.userId || (req as any).tokenUserId;
      if (!userId) return void res.status(401).json({ error: "Not authenticated" });
      // requireAuth historically permits a deleted row and tolerates lookup
      // failures. Sharing private evidence additionally requires a live staff row.
      const user = (await deps.db.query("SELECT email, role, is_active FROM users WHERE id=$1", [userId])).rows[0];
      if (!user) return void res.status(401).json({ error: "Not authenticated" });
      if (user.is_active === false || String(user.role).toLowerCase() === "client"
        || !String(user.email ?? "").trim().toLowerCase().endsWith("@brucegillinghampollard.com")) {
        return void res.status(403).json({ error: "Sharing is available to BGP staff only" });
      }
      if (await deps.isClientRequestUser(req) || await deps.resolveCompanyScope(req)) {
        return void res.status(403).json({ error: "Sharing is available to BGP staff only" });
      }
      next();
    } catch (error) { respondError(res, error); }
  };
  const staffBase = "/api/evidence-plans/:planId/share";
  // Restrict middleware to this feature: mounting this router must not protect
  // unrelated/public endpoints or alter other Evidence Plans routes.
  staffRouter.use(staffBase, privateHeaders, deps.requireAuth, staffOnly);

  const mutationOnly: RequestHandler = (req, res, next) => {
    // Session cookies are SameSite=None. JSON-only mutations cannot be submitted
    // by a cross-site form; additionally reject browser cross-origin requests.
    if (!req.is("application/json")) return void res.status(415).json({ error: "Send share changes as JSON" });
    const bearer = !!(req as any).tokenUserId && /^Bearer\s+\S+/i.test(req.get("authorization") ?? "");
    if (!bearer) {
      const site = req.get("sec-fetch-site"), origin = req.get("origin");
      if (site === "cross-site" || site === "same-site" || origin && origin !== `${req.protocol}://${req.get("host")}`) {
        return void res.status(403).json({ error: "Share changes must come from this application" });
      }
    }
    next();
  };

  const planId = (req: Request): string => {
    const id = String(req.params.planId);
    if (!EVIDENCE_SHARE_UUID.test(id)) throw new EvidencePlanShareError(404, "Plan not found");
    return id;
  };

  staffRouter.get(staffBase, async (req, res) => {
    try {
      const id = planId(req);
      await ready();
      const plan = (await deps.db.query("SELECT id FROM evidence_plans WHERE id = $1", [id])).rows[0];
      if (!plan) throw new EvidencePlanShareError(404, "Plan not found");
      const share = (await deps.db.query(`SELECT * FROM evidence_plan_shares WHERE plan_id = $1
        ORDER BY (revoked_at IS NULL) DESC, created_at DESC, id DESC LIMIT 1`, [id])).rows[0];
      res.json({ share: share ? presentEvidencePlanShare(share) : null });
    } catch (error) { respondError(res, error); }
  });

  staffRouter.put(staffBase, mutationOnly, async (req, res) => {
    let db: EvidenceShareClient | undefined;
    try {
      const id = planId(req), settings = validateEvidencePlanShareSettings(req.body), expected = validateExpectedEvidencePlanShare(req.body);
      await ready();
      db = await deps.db.connect();
      await db.query("BEGIN");
      if (expected) await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`evidence-plan-share:${expected.id}`]);
      const plan = (await db.query("SELECT id FROM evidence_plans WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!plan) throw new EvidencePlanShareError(404, "Plan not found");
      const existing = (await db.query("SELECT id, updated_at, access_mode FROM evidence_plan_shares WHERE plan_id = $1 AND revoked_at IS NULL FOR UPDATE", [id])).rows[0];
      assertExpectedEvidencePlanShare(existing, expected);
      const entries = (await db.query(`SELECT id, source_key FROM evidence_plan_entries
        WHERE plan_id = $1 AND id = ANY($2::uuid[]) FOR SHARE`, [id, settings.entryIds])).rows;
      if (entries.length !== settings.entryIds.length) throw new EvidencePlanShareError(400, "Choose evidence from this plan");
      const documents = new Set(entries.filter(entry => typeof entry.source_key === "string" && entry.source_key.trim()).map(entry => entry.id));
      if (settings.documentEntryIds.some(entryId => !documents.has(entryId))) throw new EvidencePlanShareError(400, "Selected documents must have a source file");
      const values = [settings.label, settings.entryIds, settings.documentEntryIds, settings.includeUnitFacts];
      let share;
      const accessChanged = existing && existing.access_mode !== settings.accessMode;
      if (accessChanged) {
        await db.query(`UPDATE evidence_plan_shares SET revoked_at=now(),
          updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 millisecond') WHERE id=$1`, [existing.id]);
      }
      if (existing && !accessChanged) {
        share = (await db.query(`UPDATE evidence_plan_shares SET label=$1, entry_ids=$2::uuid[],
          document_entry_ids=$3::uuid[], include_unit_facts=$4,
          updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 millisecond') WHERE id=$5 RETURNING *`, [...values, existing.id])).rows[0];
      } else {
        const token = tokenFactory();
        if (!EVIDENCE_SHARE_TOKEN.test(token)) throw new Error("Invalid token generator");
        share = (await db.query(`INSERT INTO evidence_plan_shares (label, entry_ids, document_entry_ids, include_unit_facts, plan_id, token, access_mode)
          VALUES ($1,$2::uuid[],$3::uuid[],$4,$5,$6,$7) RETURNING *`, [...values, id, token, settings.accessMode])).rows[0];
      }
      await db.query("COMMIT");
      res.json({ share: presentEvidencePlanShare(share) });
    } catch (error) {
      if (db) await db.query("ROLLBACK").catch(() => {});
      respondError(res, error);
    } finally { db?.release(); }
  });

  staffRouter.post(`${staffBase}/revoke`, mutationOnly, async (req, res) => {
    let db: EvidenceShareClient | undefined;
    try {
      const id = planId(req), expected = validateExpectedEvidencePlanShare(req.body);
      await ready();
      db = await deps.db.connect();
      await db.query("BEGIN");
      if (expected) await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`evidence-plan-share:${expected.id}`]);
      const plan = (await db.query("SELECT id FROM evidence_plans WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!plan) throw new EvidencePlanShareError(404, "Plan not found");
      const existing = (await db.query("SELECT id, updated_at FROM evidence_plan_shares WHERE plan_id=$1 AND revoked_at IS NULL FOR UPDATE", [id])).rows[0];
      assertExpectedEvidencePlanShare(existing, expected);
      const share = (await db.query(`UPDATE evidence_plan_shares SET revoked_at=now(),
        updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
        WHERE plan_id=$1 AND revoked_at IS NULL RETURNING *`, [id])).rows[0];
      await db.query("COMMIT");
      res.json({ share: share ? presentEvidencePlanShare(share) : null });
    } catch (error) {
      if (db) await db.query("ROLLBACK").catch(() => {});
      respondError(res, error);
    } finally { db?.release(); }
  });

  const publicBase = "/api/public/evidence-plans/:token";
  publicRouter.use(publicBase, privateHeaders);
  // Public reads hold shared row locks until the allowlisted response/file is
  // loaded. Revoke/update serializes with these reads; no stale URL bypasses it.
  const withShare = async (req: Request, callback: (db: EvidenceShareClient, share: any) => Promise<void>) => {
    const token = String(req.params.token);
    if (!EVIDENCE_SHARE_TOKEN.test(token)) throw notFound();
    await ready();
    const db = await deps.db.connect();
    try {
      await db.query("BEGIN");
      const share = (await db.query(`SELECT s.*, p.name AS plan_name, p.updated_at AS plan_updated_at, p.property_id,
        p.background_key AS plan_background_key, p.background_width AS plan_background_width, p.background_height AS plan_background_height
        FROM evidence_plan_shares s JOIN evidence_plans p ON p.id=s.plan_id
        WHERE s.token=$1 AND s.revoked_at IS NULL FOR SHARE OF p, s`, [token])).rows[0];
      if (!share) throw notFound();
      await callback(db, share);
      await db.query("COMMIT");
    } catch (error) { await db.query("ROLLBACK").catch(() => {}); throw error; }
    finally { db.release(); }
  };

  publicRouter.get(publicBase, async (req, res) => {
    try {
      let payload: SharedEvidencePlan | undefined;
      await withShare(req, async (db, share) => {
        const levels = (await db.query("SELECT * FROM evidence_plan_levels WHERE plan_id=$1 ORDER BY sort_order, id", [share.plan_id])).rows;
        if (!levels.length && share.plan_background_key) levels.push({ id: "legacy", name: "Plan", background_key: share.plan_background_key,
          background_width: share.plan_background_width, background_height: share.plan_background_height });
        const units = (await db.query("SELECT * FROM evidence_plan_units WHERE plan_id=$1 ORDER BY unit_ref, id", [share.plan_id])).rows;
        const entries = (await db.query(`SELECT * FROM evidence_plan_entries WHERE plan_id=$1 AND id=ANY($2::uuid[])
          ORDER BY transaction_date DESC NULLS LAST, created_at DESC, id`, [share.plan_id, share.entry_ids])).rows;
        const schedule = share.property_id
          ? (await db.query("SELECT * FROM tenancy_schedule_units WHERE property_id=$1 ORDER BY unit_number, id", [share.property_id])).rows : [];
        const base = `/api/public/evidence-plans/${encodeURIComponent(String(req.params.token))}`;
        const levelIds = new Set(levels.map(level => level.id)), unitIds = new Set(units.map(unit => unit.id));
        payload = { plan: { name: share.plan_name, updatedAt: shareTimestamp(share.plan_updated_at) },
          levels: levels.map(level => ({ id: level.id, name: level.name, width: shareNumber(level.background_width), height: shareNumber(level.background_height),
            imageUrl: level.background_key ? `${base}/levels/${level.id}/background` : null })),
          units: units.map(unit => presentSharedEvidenceUnit({ ...unit, level_id: levelIds.has(unit.level_id) ? unit.level_id : levels[0]?.id ?? null },
            share.include_unit_facts, schedule, share.property_id)),
          entries: entries.map(entry => presentSharedEvidenceEntry({ ...entry, unit_id: unitIds.has(entry.unit_id) ? entry.unit_id : null },
            share.document_entry_ids.includes(entry.id) && entry.source_key ? `${base}/entries/${entry.id}/document` : undefined)) };
      });
      res.json(payload);
    } catch (error) { respondError(res, error); }
  });

  publicRouter.get(`${publicBase}/access`, async (req, res) => {
    try {
      let access;
      await withShare(req, async (_db, share) => {
        access = { accessMode: share.access_mode, planName: share.plan_name,
          ...(share.access_mode === "edit" ? { planId: share.plan_id } : {}) };
      });
      res.json(access);
    } catch (error) { respondError(res, error); }
  });

  const serveFile = (kind: "background" | "document"): RequestHandler => async (req, res) => {
    try {
      const id = String(kind === "background" ? req.params.levelId : req.params.entryId);
      if (!EVIDENCE_SHARE_UUID.test(id) && !(kind === "background" && id === "legacy")) throw notFound();
      let result: { data: Buffer; mime: string; extension: string } | undefined;
      await withShare(req, async (db, share) => {
        let key: string | null = null;
        if (kind === "background") {
          if (id === "legacy") {
            const levels = (await db.query("SELECT id FROM evidence_plan_levels WHERE plan_id=$1 LIMIT 1", [share.plan_id])).rows;
            if (!levels.length) key = share.plan_background_key;
          } else {
            key = (await db.query("SELECT background_key FROM evidence_plan_levels WHERE id=$1 AND plan_id=$2 FOR SHARE", [id, share.plan_id])).rows[0]?.background_key;
          }
        } else {
          if (!share.entry_ids.includes(id.toLowerCase()) || !share.document_entry_ids.includes(id.toLowerCase())) throw notFound();
          key = (await db.query("SELECT source_key FROM evidence_plan_entries WHERE id=$1 AND plan_id=$2 FOR SHARE", [id, share.plan_id])).rows[0]?.source_key;
        }
        if (!key) throw notFound();
        const file = await deps.getFile(key);
        if (!file) throw notFound();
        const type = sharedFileType(file, kind === "background");
        if (!type) throw notFound();
        result = { data: file.data, ...type };
      });
      if (!result) throw notFound();
      res.set({ "Content-Type": result.mime,
        "Content-Disposition": `${kind === "background" ? "inline" : "attachment"}; filename="${kind === "background" ? "plan" : "evidence"}.${result.extension}"`,
        "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'" });
      res.send(result.data);
    } catch (error) { respondError(res, error); }
  };
  publicRouter.get(`${publicBase}/levels/:levelId/background`, serveFile("background"));
  publicRouter.get(`${publicBase}/entries/:entryId/document`, serveFile("document"));
  // Never fall through to authenticated generic API handlers or SPA fallback.
  publicRouter.use(publicBase, (_req, res) => { res.status(404).json({ error: "Shared plan not found" }); });
  return { staffRouter, publicRouter };
}

// Laziness keeps importing this module safe for isolated tests and avoids
// starting the existing evidence-plan module (which does DDL/AI setup on import).
const production = createEvidencePlanSharingRouters({
  db: {
    query: async (sql, values) => (await import("./db")).pool.query(sql, values),
    connect: async () => (await import("./db")).pool.connect(),
  },
  requireAuth: (req, res, next) => { void import("./auth").then(({ requireAuth }) => requireAuth(req, res, next)).catch(() => {
    res.status(503).json({ error: "Authentication unavailable" });
  }); },
  isClientRequestUser: async req => (await import("./company-scope")).isClientRequestUser(req),
  resolveCompanyScope: async req => (await import("./company-scope")).resolveCompanyScope(req),
  getFile: async key => (await import("./file-storage")).getFile(key),
});
export const evidencePlanSharePublicRouter = production.publicRouter;
export const evidencePlanShareStaffRouter = production.staffRouter;
