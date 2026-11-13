// Requirements centre: the staff-only routes over server/requirement-intake.ts
// (Woody, 2026-11-12). Suggestions, evidence and owners are BGP's own:
// every handler refuses a client login and a staff member viewing as a
// client. They sit outside /api/crm/ on purpose: client logins may GET
// anything under that prefix, and nothing here is on the client allow-list.
//
//   GET  /api/requirement-suggestions                      list, filters, counts
//   GET  /api/requirement-suggestions/counts
//   POST /api/requirement-suggestions/:id/confirm          new requirement, or confirm an existing one
//   POST /api/requirement-suggestions/:id/attach           add to an existing requirement
//   POST /api/requirement-suggestions/:id/dismiss          with a reason
//   POST /api/requirement-suggestions/:id/satisfied        "yes" to a "mark as satisfied?" suggestion: closes the requirement as Past
//   POST /api/requirement-suggestions/:id/not-live         "no" to a "still live?" suggestion: archives the requirement ("yes" is confirm)
//   POST /api/requirement-suggestions/:id/brand            the reviewer picks the brand
//   GET  /api/requirement-centre/expanding                 "Expanding now, nothing on our books": brands in the news with no requirement
//   POST /api/requirement-centre/expanding/add             "Add requirement" from that list: saved as press-reported
//   POST /api/requirement-centre/expanding/dismiss         "Dismiss" on that list: the brand's news is quiet for 30 days
//   GET  /api/requirement-centre/requirements/:id/evidence the evidence and the "how sure" label
//   POST /api/requirement-centre/requirements/:id/evidence "Add evidence": a staff note, call, meeting or email, typed by the person
//   POST /api/requirement-centre/requirements/:id/still-live
//   PUT  /api/requirement-centre/requirements/:id/owner
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { resolveCompanyScope } from "./company-scope";
import { CONFIRMED_HOW } from "@shared/requirement-live";
import {
  IntakeError, pgIntakeStore, confirm, checkPeople, attach, dismiss, markSatisfied, markNotLive, setSuggestionBrand, stillLive, setOwner,
  listSuggestions, suggestionCounts, requirementEvidence, EVIDENCE_KINDS, type Actor, type IntakeStore,
} from "./requirement-intake";
import { expandingBrands, addRequirementFromNews, dismissFromNews } from "./requirement-news";

const STAFF_DOMAIN = "@brucegillinghampollard.com";

// A named, active BGP person who is not viewing as a client. Anything else is refused.
export async function staffActor(req: Request): Promise<Actor> {
  const scope = await resolveCompanyScope(req);
  if (scope || (req as any)._isClientRole) throw new IntakeError(403, "STAFF_ONLY", "BGP staff only");
  const userId = (req.session as any)?.userId || (req as any).tokenUserId;
  const user = userId ? (await pool.query(`SELECT id, name, email, role, is_active, client_view_mode FROM users WHERE id = $1`, [userId])).rows[0] : null;
  const staff = !!user && user.is_active !== false && !user.client_view_mode && String(user.role || "").toLowerCase() !== "client"
    && String(user.email || "").trim().toLowerCase().endsWith(STAFF_DOMAIN) && !!String(user.name || "").trim();
  if (!staff) throw new IntakeError(403, "STAFF_ONLY", "BGP staff only");
  return { id: user.id, name: user.name };
}

// Every answer is several writes: all of them, or none.
async function inTransaction<T>(run: (store: IntakeStore) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await run(pgIntakeStore(client));
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

const handle = (run: (req: Request, actor: Actor) => Promise<any>) => async (req: Request, res: Response) => {
  try {
    res.json(await run(req, await staffActor(req)));
  } catch (e: any) {
    if (e instanceof IntakeError) return res.status(e.status).json({ error: e.message, code: e.code, ...e.extra });
    if (e instanceof z.ZodError) return res.status(400).json({ error: e.errors[0]?.message || "Invalid request", code: "BAD_REQUEST" });
    console.error("[requirement-intake]", e?.message || e);
    res.status(500).json({ error: "Something went wrong with the requirements centre" });
  }
};

const id = z.string().trim().min(1).max(100);
const list = z.array(z.string().trim().min(1).max(200)).max(40);
const how = z.enum(CONFIRMED_HOW).nullish();
const fields = z.object({
  name: z.string().trim().max(200).optional(),
  use: list.optional(),
  requirementType: list.optional(),
  size: list.optional(),
  requirementLocations: list.optional(),
  comments: z.string().max(4000).optional(),
  principalContactId: id.nullish(),
  agentContactId: id.nullish(),
  bgpContactUserIds: z.array(id).max(10).optional(),
}).strict();
const confirmBody = z.object({ companyId: id.nullish(), requirementId: id.nullish(), createNew: z.boolean().optional(), how, fields: fields.optional() }).strict();
const attachBody = z.object({ requirementId: id, companyId: id.nullish() }).strict();
const dismissBody = z.object({ reason: z.string().trim().min(1).max(200) }).strict();
const satisfiedBody = z.object({ requirementId: id.nullish() }).strict();
const brandBody = z.object({ companyId: id }).strict();
const stillLiveBody = z.object({ how }).strict();
const ownerBody = z.object({ userIds: z.array(id).max(10) }).strict();
// "Add requirement" on the Expanding list: the brand, and the story as the list showed it. The way it was confirmed is always press.
const addFromNewsBody = z.object({
  companyId: id, headline: z.string().trim().min(1).max(500), url: z.string().trim().max(1000).nullish(), source: z.string().trim().max(80).nullish(),
  date: z.string().trim().max(40).nullish(), requirementId: id.nullish(), createNew: z.boolean().optional(), fields: fields.optional(),
}).strict();
const dismissFromNewsBody = addFromNewsBody.pick({ companyId: true, headline: true, url: true, source: true, date: true }).strict();
// "Add evidence" on a requirement: what the person typed about how they know. Never fetched from a mailbox.
const NOTE_KINDS = ["note", "call", "meeting", "email"] as const;
const NOTE_LABELS: Record<typeof NOTE_KINDS[number], string> = { note: "Note", call: "Call", meeting: "Meeting", email: "Email" };
const noteBody = z.object({
  kind: z.enum(NOTE_KINDS).optional(), text: z.string().trim().min(1).max(300), date: z.string().trim().max(40).nullish(),
  url: z.string().trim().max(1000).nullish(), confirms: z.boolean().optional(),
}).strict();

const requirementOut = (r: Record<string, any> | null) => r && ({
  id: r.id, name: r.name, companyId: r.company_id, status: r.status,
  lastConfirmedAt: r.last_confirmed_at, lastConfirmedBy: r.last_confirmed_by, lastConfirmedByName: r.last_confirmed_by_name, confirmedHow: r.confirmed_how,
  origin: r.origin, bgpContactUserId: r.bgp_contact_user_id, bgpContactUserIds: r.bgp_contact_user_ids, requirementDate: r.requirement_date, updatedAt: r.updated_at,
});

export function registerRequirementIntakeRoutes(app: Express) {
  app.get("/api/requirement-suggestions", requireAuth, handle(async req => {
    const q = req.query;
    const kind = typeof q.kind === "string" && (EVIDENCE_KINDS as readonly string[]).includes(q.kind) ? q.kind : null;
    return listSuggestions(pgIntakeStore(pool), {
      status: typeof q.status === "string" ? q.status : "open",
      kind,
      companyId: typeof q.companyId === "string" && q.companyId ? q.companyId : null,
      unmatched: q.unmatched === "1" || q.unmatched === "true",
      q: typeof q.q === "string" ? q.q.slice(0, 100) : null,
      limit: Number(q.limit) || undefined,
      offset: Number(q.offset) || undefined,
    });
  }));

  app.get("/api/requirement-suggestions/counts", requireAuth, handle(async () => suggestionCounts(pgIntakeStore(pool))));

  app.post("/api/requirement-suggestions/:id/confirm", requireAuth, handle(async (req, actor) => {
    const body = confirmBody.parse(req.body || {});
    const out = await inTransaction(async store => { await checkPeople(store, body.fields); return confirm(store, { suggestionId: String(req.params.id), ...body }, actor); });
    return { outcome: out.outcome, requirement: requirementOut(out.requirement), evidenceIds: out.evidenceIds };
  }));

  app.post("/api/requirement-suggestions/:id/attach", requireAuth, handle(async (req, actor) => {
    const body = attachBody.parse(req.body || {});
    const out = await inTransaction(store => attach(store, { suggestionId: String(req.params.id), ...body }, actor));
    return { outcome: out.outcome, requirement: requirementOut(out.requirement), evidenceIds: out.evidenceIds };
  }));

  app.post("/api/requirement-suggestions/:id/dismiss", requireAuth, handle(async (req, actor) => {
    const body = dismissBody.parse(req.body || {});
    return inTransaction(store => dismiss(store, { suggestionId: String(req.params.id), reason: body.reason }, actor));
  }));

  app.post("/api/requirement-suggestions/:id/satisfied", requireAuth, handle(async (req, actor) => {
    const body = satisfiedBody.parse(req.body || {});
    const out = await inTransaction(store => markSatisfied(store, { suggestionId: String(req.params.id), requirementId: body.requirementId }, actor));
    return { outcome: "satisfied", requirement: requirementOut(out.requirement), evidenceIds: out.evidenceIds };
  }));

  app.post("/api/requirement-suggestions/:id/not-live", requireAuth, handle(async (req, actor) => {
    const body = satisfiedBody.parse(req.body || {});
    const out = await inTransaction(store => markNotLive(store, { suggestionId: String(req.params.id), requirementId: body.requirementId }, actor));
    return { outcome: "not_live", requirement: requirementOut(out.requirement), evidenceIds: out.evidenceIds };
  }));

  app.post("/api/requirement-suggestions/:id/brand", requireAuth, handle(async (req, actor) => {
    const body = brandBody.parse(req.body || {});
    return inTransaction(store => setSuggestionBrand(store, { suggestionId: String(req.params.id), companyId: body.companyId }, actor));
  }));

  app.get("/api/requirement-centre/expanding", requireAuth, handle(async req => {
    const q = req.query;
    return expandingBrands(pool, { limit: Number(q.limit) || undefined, offset: Number(q.offset) || undefined, q: typeof q.q === "string" ? q.q.slice(0, 100) : null });
  }));

  app.post("/api/requirement-centre/expanding/add", requireAuth, handle(async (req, actor) => {
    const body = addFromNewsBody.parse(req.body || {});
    const out = await inTransaction(async store => { await checkPeople(store, body.fields); return addRequirementFromNews(store, body, actor); });
    return { outcome: out.outcome, requirement: requirementOut(out.requirement), evidenceIds: out.evidenceIds, suggestionId: out.suggestionId ?? null };
  }));

  app.post("/api/requirement-centre/expanding/dismiss", requireAuth, handle(async (req, actor) => {
    const body = dismissFromNewsBody.parse(req.body || {});
    return inTransaction(store => dismissFromNews(store, body, actor));
  }));

  app.get("/api/requirement-centre/requirements/:id/evidence", requireAuth, handle(async req =>
    requirementEvidence(pgIntakeStore(pool), String(req.params.id))));

  // A dated line with the person's name. Adding a line is not a confirmation
  // unless the person says the brand confirmed it (`confirms`): then it is
  // "Still live", recorded as a call, meeting or email.
  app.post("/api/requirement-centre/requirements/:id/evidence", requireAuth, handle(async (req, actor) => {
    const body = noteBody.parse(req.body || {});
    const kind = body.kind || "note";
    const when = body.date ? new Date(body.date) : null;
    const url = body.url && /^https?:\/\//i.test(body.url) ? body.url : null;
    return inTransaction(async store => {
      const out = await attach(store, {
        requirementId: String(req.params.id),
        evidence: { kind, brand: {}, sourceLabel: NOTE_LABELS[kind], headline: body.text, url, evidenceDate: when && !isNaN(when.getTime()) && when.getTime() <= Date.now() ? when : new Date() },
      }, actor);
      const requirement = body.confirms ? await stillLive(store, out.requirement.id, actor, kind === "note" ? null : kind) : out.requirement;
      return { outcome: body.confirms ? "confirmed" : "attached", requirement: requirementOut(requirement), evidenceIds: out.evidenceIds };
    });
  }));

  app.post("/api/requirement-centre/requirements/:id/still-live", requireAuth, handle(async (req, actor) => {
    const body = stillLiveBody.parse(req.body || {});
    return { requirement: requirementOut(await inTransaction(store => stillLive(store, String(req.params.id), actor, body.how))) };
  }));

  app.put("/api/requirement-centre/requirements/:id/owner", requireAuth, handle(async (req, actor) => {
    const body = ownerBody.parse(req.body || {});
    return { requirement: requirementOut(await inTransaction(store => setOwner(store, String(req.params.id), body.userIds, actor))) };
  }));
}
