// The negotiation log on a Letting Tracker offer (Woody, 2026-11-12: "the
// negotiation process from receiving first offer needs to be logged so can
// see how the bid evolved all the way up to the point of HOTs").
// shared/unit-negotiation.ts is the contract; migration 0051 the tables.
//
// unit_offers holds a bid's CURRENT position; unit_offer_rounds holds every
// position it has been through. The newest round always equals the offer
// row: every write here, and the offer edit in server/leasing-viewings.ts,
// keeps the two in step under one lock per offer. Status runs Pending ->
// Negotiating -> Agreed, or Rejected / Withdrawn, and changes only through
// the status route below. Routes are registered from server/index.ts.
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { briefAccess } from "./unit-brief-workspace";
import { parseMoney, isPlainObject } from "@shared/unit-brief";
import { calendarDateValue } from "@shared/calendar-date";
import { legacyToCode } from "@shared/deal-status";
import {
  OFFER_STATUSES, ROUND_TERM_FIELDS, isOpenOffer, roundChanges,
  type OfferNegotiation, type OfferRound, type OfferStatus, type RoundParty, type RoundTerms,
} from "@shared/unit-negotiation";

type Access = NonNullable<Awaited<ReturnType<typeof briefAccess>>>;
type Db = { query: (sql: string, params?: any[]) => Promise<any> };
type TermField = (typeof ROUND_TERM_FIELDS)[number];

export class NegotiationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const NOTE_MAX = 4000;
const TEXT_MAX = 500;
const NUMBER_MAX: Record<string, number> = { termYears: 999, rentFreeMonths: 600, turnoverRentPct: 100 };
const TERM_COLUMNS = ROUND_TERM_FIELDS.map(f => f.column);

const iso = (d: unknown): string | null => (d ? new Date(d as string).toISOString() : null);
const todayLondon = (): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);

// Old rows may say "Accepted" (read as Agreed) or nothing at all (Pending).
export function readOfferStatus(raw: unknown): OfferStatus {
  if (raw === "Accepted") return "Agreed";
  return (OFFER_STATUSES as readonly unknown[]).includes(raw) ? (raw as OfferStatus) : "Pending";
}

// The position held on an offer row or a round row (snake_case columns).
export function termsOfRow(row: any): RoundTerms {
  const t: RoundTerms = {};
  for (const f of ROUND_TERM_FIELDS) t[f.key] = row[f.column] ?? null;
  return t;
}
const termValues = (t: RoundTerms): (number | string | null)[] => ROUND_TERM_FIELDS.map(f => t[f.key] ?? null);

// One term from a request. Blank clears it; anything unreadable is refused
// with a message that names the field.
function parseTerm(f: TermField, raw: unknown): number | string | null {
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) return null;
  if (f.kind === "money") {
    const n = parseMoney(raw);
    if (n === undefined || n === null || n < 0) throw new NegotiationError(400, `Check the figure for ${f.label}. Use a number, for example 95000 or 95k.`);
    return n;
  }
  if (f.kind === "number") {
    const max = NUMBER_MAX[f.key] ?? 1_000_000;
    const s = typeof raw === "string" ? raw.trim().replace(/\s*%$/, "") : null;
    const n = typeof raw === "number" ? raw : s !== null && /^\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
    if (!Number.isFinite(n) || n < 0 || n > max) throw new NegotiationError(400, `${f.label} is a number from 0 to ${max}.`);
    return n;
  }
  if (typeof raw !== "string" && typeof raw !== "number") throw new NegotiationError(400, `${f.label} must be text.`);
  const text = String(raw).trim();
  if (text.length > TEXT_MAX) throw new NegotiationError(400, `${f.label} is too long. Keep it to ${TEXT_MAX} characters.`);
  return text || null;
}

// A round is a full position: a term left out of the body carries over from
// `base`; a term sent as null or "" is cleared.
function applyTerms(base: RoundTerms, body: Record<string, unknown>): RoundTerms {
  const next: RoundTerms = { ...base };
  for (const f of ROUND_TERM_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, f.key)) next[f.key] = parseTerm(f, body[f.key]);
  }
  return next;
}

function parseParty(raw: unknown): RoundParty {
  if (raw !== "tenant" && raw !== "landlord") throw new NegotiationError(400, "Say whose position this is: the tenant's offer or the landlord's counter.");
  return raw;
}

function parseRoundDate(raw: unknown): string {
  const day = typeof raw === "string" && raw.length === 10 ? calendarDateValue(raw) : null;
  if (!day) throw new NegotiationError(400, "Set the date of this position, for example 2026-11-12.");
  if (day < "2000-01-01") throw new NegotiationError(400, "That date is too far back. Check the year.");
  if (day > addDays(todayLondon(), 1)) throw new NegotiationError(400, "The date of a position cannot be in the future.");
  return day;
}

function parseNote(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new NegotiationError(400, "The note must be text.");
  const note = raw.trim();
  if (note.length > NOTE_MAX) throw new NegotiationError(400, `The note is too long. Keep it to ${NOTE_MAX} characters.`);
  return note || null;
}

const bodyOf = (req: Request): Record<string, unknown> => {
  if (!isPlainObject(req.body)) throw new NegotiationError(400, "Send the position as named fields.");
  return req.body;
};

// ---------------------------------------------------------------------------
// Round writes shared with the offer form (server/leasing-viewings.ts).

const offerLockKey = (offerId: string) => `unit_offer:${offerId}`;
const unitAgreeLockKey = (unitId: string) => `unit_offer_agreed:${unitId}`;

// One lock per offer for everything that writes its rounds or its position.
// Take it before reading the offer row FOR UPDATE.
export async function lockOffer(db: Db, offerId: string): Promise<void> {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [offerLockKey(offerId)]);
}
// One lock per unit for "only one offer on a unit can be Agreed".
export async function lockUnitAgreement(db: Db, unitId: string): Promise<void> {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [unitAgreeLockKey(unitId)]);
}

// Another offer on the unit whose terms are already agreed, if any.
// `brandOnly` names it by its brand and never by the contact on it (a joint
// agent is not given BGP's contact at a brand).
export async function otherAgreedOffer(db: Db, unitId: string, exceptOfferId: string | null, opts: { brandOnly?: boolean } = {}): Promise<{ id: string; name: string } | null> {
  const r = (await db.query(
    `SELECT id, COALESCE(NULLIF(btrim(company_name), ''), CASE WHEN $3::boolean THEN NULL ELSE NULLIF(btrim(contact_name), '') END, 'another party') AS name
       FROM unit_offers WHERE unit_id = $1 AND status IN ('Agreed', 'Accepted') AND ($2::text IS NULL OR id <> $2) LIMIT 1`,
    [unitId, exceptOfferId, !!opts.brandOnly])).rows[0];
  return r ? { id: r.id, name: r.name } : null;
}

// ---------------------------------------------------------------------------
// A joint agent on an offer (Woody, 2026-11-12: "joint agents should have
// full control like us", "only on their instructed properties", "they can't
// have access to the brand pages"). They add, edit and delete offers and run
// the negotiation like BGP, but never receive BGP's CRM ids, BGP's contact at
// a brand or BGP's comments on an offer. The contact name and the comments on
// an offer are theirs to read only on an offer their own login logged: the
// author of round 1 is the record of who logged an offer.

export const isJointAgent = (access: { landsecRole: string | null }): boolean => access.landsecRole === "joint_agent";

// The name a write is stamped with. A joint agent's carries their firm, so
// the log, the Heads of Terms history and the deal's audit rows say who they
// act for.
export async function actorNameOf(access: { userId: string | null; name: string | null; landsecRole: string | null }, db: Db = pool): Promise<string | null> {
  if (!isJointAgent(access) || !access.userId) return access.name;
  const firm = String((await db.query(`SELECT firm FROM landsec_access WHERE user_id = $1`, [access.userId])).rows[0]?.firm || "").trim();
  return firm ? `${access.name || "Joint agent"} (${firm})` : access.name;
}

// The offers, out of `offerIds`, that this login logged itself.
export async function offersLoggedBy(offerIds: string[], userId: string | null, db: Db = pool): Promise<Set<string>> {
  if (!userId || !offerIds.length) return new Set();
  const rows = (await db.query(
    `SELECT r.offer_id FROM unit_offer_rounds r
      WHERE r.offer_id = ANY($1::varchar[]) AND r.created_by_user_id = $2
        AND r.round_no = (SELECT MIN(round_no) FROM unit_offer_rounds x WHERE x.offer_id = r.offer_id)`,
    [offerIds, userId])).rows;
  return new Set(rows.map((r: any) => r.offer_id as string));
}

// The brands already named on a unit with a CRM record: on its offers,
// viewings, interest and target list. A joint agent may link an offer to one
// of these (id and name only), and to no other CRM record.
export async function brandsOnUnit(unitId: string, db: Db = pool): Promise<{ id: string; name: string }[]> {
  const rows = (await db.query(
    `SELECT c.id, c.name FROM crm_companies c
      WHERE c.id IN (
              SELECT company_id FROM unit_offers WHERE unit_id = $1 AND company_id IS NOT NULL
              UNION SELECT company_id FROM unit_viewings WHERE unit_id = $1 AND deleted_at IS NULL AND company_id IS NOT NULL
              UNION SELECT company_id FROM unit_interest WHERE unit_id = $1 AND company_id IS NOT NULL
              UNION SELECT t.company_id FROM unit_target_operators t JOIN unit_briefs b ON b.id = t.brief_id WHERE b.unit_id = $1 AND t.company_id IS NOT NULL)
      ORDER BY c.name`, [unitId])).rows;
  return rows.map((r: any) => ({ id: r.id as string, name: r.name as string }));
}

// What a joint agent receives of an offer row from the offer routes (the
// drizzle shape, camelCase). An allow-list: the terms, the brand's name and
// the dates. Never a CRM id or the email thread an offer was detected from;
// the contact name and the comments only when `own`.
export function offerForJointAgent(row: any, own: boolean): Record<string, unknown> {
  const pick = (k: string) => row[k] ?? null;
  const out: Record<string, unknown> = {
    id: row.id, unitId: pick("unitId"), companyName: pick("companyName"), companyId: null,
    contactName: own ? pick("contactName") : null, contactId: null,
    offerDate: pick("offerDate"), status: pick("status"),
    comments: own ? pick("comments") : null, source: pick("source"),
    viewingId: pick("viewingId"), confirmedAt: pick("confirmedAt"),
    createdAt: pick("createdAt"), updatedAt: pick("updatedAt"),
    // The joint agent's own login logged this offer.
    own,
  };
  for (const f of ROUND_TERM_FIELDS) out[f.key] = pick(f.key);
  return out;
}

// The offers list as the person asking may receive it. Everyone but a joint
// agent gets the rows as they are; a joint agent gets the allow-list above.
// `rows` are camelCase offer rows of units on `propertyId`.
export async function offersForViewer(req: Request, propertyId: string | null | undefined, rows: any[]): Promise<any[]> {
  const access = await briefAccess(req, propertyId);
  if (!access) return [];
  if (!isJointAgent(access)) return rows;
  const own = await offersLoggedBy(rows.map(r => r.id), access.userId);
  return rows.map(r => offerForJointAgent(r, own.has(r.id)));
}

// Round 1: the tenant's first offer, taken from the offer row as it stands.
// `offer` is the unit_offers row (snake_case). Call under lockOffer when the
// offer could already have rounds.
export async function insertFirstRound(db: Db, offer: any, by: { userId: string | null; name: string | null } | null): Promise<void> {
  const date = calendarDateValue(offer.offer_date)
    || (offer.created_at ? new Date(offer.created_at).toISOString().slice(0, 10) : todayLondon());
  const cols = TERM_COLUMNS.join(", ");
  const marks = TERM_COLUMNS.map((_, i) => `$${i + 7}`).join(", ");
  await db.query(
    `INSERT INTO unit_offer_rounds (offer_id, unit_id, round_no, party, round_date, created_by_user_id, created_by_name, created_at, ${cols})
     VALUES ($1, $2, 1, 'tenant', $3, $4, $5, COALESCE($6::timestamp, now()), ${marks})`,
    [offer.id, offer.unit_id, date, by?.userId || null, by?.name || null, by ? null : offer.created_at || null, ...termValues(termsOfRow(offer))]);
}

// Make sure an offer has its round 1. Every offer made before the log
// existed (and every offer detected from email) gets it on first touch.
async function ensureRounds(db: Db, offer: any): Promise<void> {
  const has = (await db.query(`SELECT 1 FROM unit_offer_rounds WHERE offer_id = $1 LIMIT 1`, [offer.id])).rows.length;
  if (!has) await insertFirstRound(db, offer, null);
}

// The offer form changed the offer's terms: the newest round follows, so
// the offer row and the newest round never disagree. An offer with no round
// yet gets round 1 with the new position. Call under lockOffer with the
// offer row as saved.
export async function syncNewestRoundToOffer(db: Db, offer: any, by: { userId: string | null; name: string | null } | null): Promise<void> {
  const newest = (await db.query(`SELECT id FROM unit_offer_rounds WHERE offer_id = $1 ORDER BY round_no DESC, created_at DESC LIMIT 1`, [offer.id])).rows[0];
  if (!newest) { await insertFirstRound(db, offer, by); return; }
  const sets = TERM_COLUMNS.map((c, i) => `${c} = $${i + 2}`).join(", ");
  await db.query(`UPDATE unit_offer_rounds SET ${sets}, updated_at = now() WHERE id = $1`, [newest.id, ...termValues(termsOfRow(offer))]);
}

// Round 1 carries the date of the first offer: when the offer form moves
// the offer date, a round 1 still on the old date moves with it.
export async function syncFirstRoundDate(db: Db, offerId: string, oldDate: string | null, newDate: string | null): Promise<void> {
  const day = calendarDateValue(newDate);
  if (!day || day === oldDate) return;
  await db.query(
    `UPDATE unit_offer_rounds SET round_date = $2, updated_at = now()
      WHERE offer_id = $1 AND round_date = $3
        AND round_no = (SELECT MIN(round_no) FROM unit_offer_rounds WHERE offer_id = $1)`,
    [offerId, day, oldDate]);
}

// For the existing offer delete and unit delete.
export async function deleteOfferRounds(offerId: string, db: Db = pool): Promise<void> {
  await db.query(`DELETE FROM unit_offer_rounds WHERE offer_id = $1`, [offerId]);
}
export async function deleteUnitOfferRounds(unitId: string, db: Db = pool): Promise<void> {
  await db.query(`DELETE FROM unit_offer_rounds WHERE unit_id = $1`, [unitId]);
}

// ---------------------------------------------------------------------------

async function transaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const value = await fn(db);
    await db.query("COMMIT");
    return value;
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}

// Under the offer's lock, with the offer row read fresh and held.
async function withOffer<T>(offerId: string, fn: (db: Db, offer: any) => Promise<T>, opts: { unitId?: string } = {}): Promise<T> {
  return transaction(async db => {
    if (opts.unitId) await lockUnitAgreement(db, opts.unitId);
    await lockOffer(db, offerId);
    const offer = (await db.query(`SELECT * FROM unit_offers WHERE id = $1 FOR UPDATE`, [offerId])).rows[0];
    if (!offer) throw new NegotiationError(404, "This offer has been deleted.");
    return fn(db, offer);
  });
}

const idOf = (raw: unknown): string => {
  const id = typeof raw === "string" ? raw : "";
  if (!id || id.length > 200) throw new NegotiationError(404, "Not found");
  return id;
};

// The unit, then its property, then who is asking. Refuses when they may not
// open things on this property.
async function unitContext(req: Request, unitId: string): Promise<{ unit: any; access: Access }> {
  const unit = (await pool.query(
    `SELECT id, property_id, marketing_status, hots_offer_id, hots_issued_at FROM available_units WHERE id = $1`, [unitId])).rows[0];
  if (!unit) throw new NegotiationError(404, "Tracker unit not found");
  const access = await briefAccess(req, unit.property_id);
  if (!access) throw new NegotiationError(403, "This unit is outside what you can see.");
  return { unit, access };
}

async function offerContext(req: Request, offerId: string): Promise<{ offer: any; unit: any; access: Access }> {
  const offer = (await pool.query(`SELECT * FROM unit_offers WHERE id = $1`, [offerId])).rows[0];
  if (!offer) throw new NegotiationError(404, "Offer not found");
  return { offer, ...(await unitContext(req, offer.unit_id)) };
}

const needEdit = (access: Access) => {
  if (!access.canEditTerms) throw new NegotiationError(403, "You can read this negotiation but not change it.");
};

// The person who logged a round, or the agents running the letting (BGP
// staff, or a joint agent on their scheme).
const mayEditRound = (round: any, access: Access): boolean =>
  access.canEditTerms && (access.agentControl || (!!round.created_by_user_id && round.created_by_user_id === access.userId));

const closedMessage = (status: OfferStatus, what: string): string =>
  `This offer is ${status.toLowerCase()}. Reopen it before ${what}.`;

function roundOf(row: any, access: Access, open: boolean): OfferRound {
  return {
    id: row.id, offerId: row.offer_id, unitId: row.unit_id, roundNo: row.round_no,
    party: row.party === "landlord" ? "landlord" : "tenant",
    roundDate: row.round_date, note: row.note || null, createdByName: row.created_by_name || null,
    createdAt: iso(row.created_at), canEdit: open && mayEditRound(row, access),
    ...termsOfRow(row),
  };
}

async function buildNegotiation(offerId: string, access: Access): Promise<OfferNegotiation> {
  const offer = (await pool.query(`SELECT * FROM unit_offers WHERE id = $1`, [offerId])).rows[0];
  if (!offer) throw new NegotiationError(404, "Offer not found");
  const unit = (await pool.query(`SELECT hots_offer_id, hots_issued_at, hots_final_file_id, marketing_status FROM available_units WHERE id = $1`, [offer.unit_id])).rows[0];
  const rounds = (await pool.query(`SELECT * FROM unit_offer_rounds WHERE offer_id = $1 ORDER BY round_no, created_at`, [offerId])).rows;
  const status = readOfferStatus(offer.status);
  const open = isOpenOffer(status);
  const jointAgent = isJointAgent(access);
  // A joint agent reads the contact and the comments only on an offer their
  // own login logged (the author of round 1).
  const first = rounds[0];
  const own = !jointAgent || (!!first?.created_by_user_id && first.created_by_user_id === access.userId);
  return {
    offer: {
      id: offer.id, unitId: offer.unit_id,
      // A joint agent gets the brand's name, never BGP's CRM ids.
      companyId: jointAgent ? null : offer.company_id || null,
      // Nor the name of BGP's contact at the brand.
      companyName: offer.company_name || null, contactName: own ? offer.contact_name || null : null,
      offerDate: offer.offer_date, status,
      agreedAt: status === "Agreed" ? iso(offer.agreed_at) : null,
      agreedByName: status === "Agreed" ? offer.agreed_by_name || null : null,
      // The offer's own comments can name a BGP inbox and an email subject
      // (offers detected from email): not for a joint agent.
      source: offer.source || null, comments: own ? offer.comments || null : null,
      ...termsOfRow(offer),
    },
    rounds: rounds.map((r: any) => roundOf(r, access, open)),
    canEdit: access.canEditTerms,
    // The same rule as the status route: once Heads of Terms are out from
    // this offer only the agents running the letting (BGP, or a joint agent
    // on the scheme) reopen, reject or withdraw it.
    canReopen: access.canEditTerms && (access.agentControl || !((unit?.hots_offer_id ? unit.hots_offer_id === offer.id : status === "Agreed")
      && (!!unit?.hots_issued_at || !!unit?.hots_final_file_id || ["SOL", "EXC", "COM", "INV"].includes(String(legacyToCode(unit?.marketing_status) || ""))))),
    hotsOfferId: unit?.hots_offer_id || null,
  };
}

// Copy a position onto the offer row (the bid's current position).
async function writeOfferPosition(db: Db, offerId: string, terms: RoundTerms, extraSql = ""): Promise<void> {
  const sets = TERM_COLUMNS.map((c, i) => `${c} = $${i + 2}`).join(", ");
  await db.query(`UPDATE unit_offers SET ${sets}, updated_at = now()${extraSql} WHERE id = $1`, [offerId, ...termValues(terms)]);
}

export function setupUnitNegotiationRoutes(app: Express) {
  const handle = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      res.json(await fn(req));
    } catch (e: any) {
      if (e instanceof NegotiationError) return res.status(e.status).json({ message: e.message });
      console.error("[unit-negotiation]", req.method, req.path, e?.message || e);
      res.status(500).json({ message: "That did not work. Try again." });
    }
  };

  // 1. The offer and every position it has been through, oldest first.
  app.get("/api/unit-offers/:offerId/negotiation", requireAuth, handle(async req => {
    const offerId = idOf(req.params.offerId);
    const { access } = await offerContext(req, offerId);
    const seeded = (await pool.query(`SELECT 1 FROM unit_offer_rounds WHERE offer_id = $1 LIMIT 1`, [offerId])).rows.length > 0;
    // Under the offer's lock, so two readers cannot both write round 1.
    if (!seeded) await withOffer(offerId, (db, offer) => ensureRounds(db, offer));
    return buildNegotiation(offerId, access);
  }));

  // 2. One line per offer on a unit, for the offers list. Reads only: an
  // offer with no rounds yet counts as one round from its own row.
  app.get("/api/unit-offers/unit/:unitId/summary", requireAuth, handle(async req => {
    const unitId = idOf(req.params.unitId);
    const { access } = await unitContext(req, unitId);
    const jointAgent = isJointAgent(access);
    const rows = (await pool.query(
      `SELECT o.id, o.company_name, o.contact_name, o.status, o.rent_pa, o.offer_date, o.agreed_at,
              (SELECT count(*)::int FROM unit_offer_rounds r WHERE r.offer_id = o.id) AS rounds,
              f.rent_pa AS first_rent, f.created_by_user_id AS first_by, l.rent_pa AS last_rent, l.round_date AS last_date, l.party AS last_party
         FROM unit_offers o
         LEFT JOIN LATERAL (SELECT rent_pa, created_by_user_id FROM unit_offer_rounds r WHERE r.offer_id = o.id ORDER BY r.round_no ASC, r.created_at ASC LIMIT 1) f ON true
         LEFT JOIN LATERAL (SELECT rent_pa, round_date, party FROM unit_offer_rounds r WHERE r.offer_id = o.id ORDER BY r.round_no DESC, r.created_at DESC LIMIT 1) l ON true
        WHERE o.unit_id = $1
        ORDER BY o.offer_date, o.created_at`, [unitId])).rows;
    return rows.map((r: any) => {
      const status = readOfferStatus(r.status);
      const logged = r.rounds > 0;
      // With no brand named the line falls back to the contact: for a joint
      // agent only on an offer their own login logged.
      const own = !jointAgent || (!!r.first_by && r.first_by === access.userId);
      return {
        offerId: r.id, companyName: r.company_name || (own ? r.contact_name : null) || null, status,
        rounds: logged ? r.rounds : 1,
        firstRentPa: logged ? r.first_rent ?? null : r.rent_pa ?? null,
        latestRentPa: logged ? r.last_rent ?? null : r.rent_pa ?? null,
        lastRoundDate: logged ? r.last_date : calendarDateValue(r.offer_date),
        lastParty: logged && r.last_party === "landlord" ? "landlord" : "tenant",
        agreedAt: status === "Agreed" ? iso(r.agreed_at) : null,
      };
    });
  }));

  // 2b. The brands already named on the unit (id and name), for the brand
  // picker on the offer form of the agents running the letting. A joint
  // agent may link an offer to one of these and to no other CRM record.
  app.get("/api/unit-offers/unit/:unitId/brands", requireAuth, handle(async req => {
    const unitId = idOf(req.params.unitId);
    const { access } = await unitContext(req, unitId);
    if (!access.agentControl) throw new NegotiationError(403, "This list is for the agents on the letting.");
    return brandsOnUnit(unitId);
  }));

  // 3. Log the next position.
  app.post("/api/unit-offers/:offerId/rounds", requireAuth, handle(async req => {
    const offerId = idOf(req.params.offerId);
    const { unit, access } = await offerContext(req, offerId);
    needEdit(access);
    const body = bodyOf(req);
    const party = parseParty(body.party);
    const roundDate = parseRoundDate(body.roundDate);
    const note = parseNote(body.note);
    await withOffer(offerId, async (db, offer) => {
      const status = readOfferStatus(offer.status);
      if (!isOpenOffer(status)) throw new NegotiationError(409, closedMessage(status, "adding another position"));
      await ensureRounds(db, offer);
      const last = (await db.query(`SELECT * FROM unit_offer_rounds WHERE offer_id = $1 ORDER BY round_no DESC, created_at DESC LIMIT 1`, [offerId])).rows[0];
      const before = termsOfRow(last);
      const next = applyTerms(before, body);
      if (!note && roundChanges(before, next).length === 0) throw new NegotiationError(400, "Nothing has changed from the last position. Change a term or add a note.");
      const marks = TERM_COLUMNS.map((_, i) => `$${i + 9}`).join(", ");
      await db.query(
        `INSERT INTO unit_offer_rounds (offer_id, unit_id, round_no, party, round_date, note, created_by_user_id, created_by_name, ${TERM_COLUMNS.join(", ")})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${marks})`,
        [offerId, offer.unit_id, last.round_no + 1, party, roundDate, note, access.userId, await actorNameOf(access, db), ...termValues(next)]);
      await writeOfferPosition(db, offerId, next, `, status = 'Negotiating'`);
    });
    const negotiation = await buildNegotiation(offerId, access);
    // The unit is still at Marketing: the screen offers to move it. The
    // unit's status is the deal's; this route never moves it.
    const stage = legacyToCode(unit.marketing_status);
    return { ...negotiation, suggestStatus: stage === "AVA" ? "NEG" : null };
  }));

  // 4. Correct a position, or take it out.
  app.patch("/api/unit-offers/rounds/:roundId", requireAuth, handle(async req => {
    const roundId = idOf(req.params.roundId);
    const found = (await pool.query(`SELECT * FROM unit_offer_rounds WHERE id = $1`, [roundId])).rows[0];
    if (!found) throw new NegotiationError(404, "This position has been deleted.");
    const { access } = await offerContext(req, found.offer_id);
    if (!mayEditRound(found, access)) throw new NegotiationError(403, "Only the person who logged this position, BGP or the joint agent can change it.");
    const body = bodyOf(req);
    const party = "party" in body ? parseParty(body.party) : null;
    const roundDate = "roundDate" in body ? parseRoundDate(body.roundDate) : null;
    const note = "note" in body ? parseNote(body.note) : undefined;
    await withOffer(found.offer_id, async (db, offer) => {
      const status = readOfferStatus(offer.status);
      if (!isOpenOffer(status)) throw new NegotiationError(409, closedMessage(status, "changing a position"));
      const round = (await db.query(`SELECT * FROM unit_offer_rounds WHERE id = $1 FOR UPDATE`, [roundId])).rows[0];
      if (!round) throw new NegotiationError(404, "This position has been deleted.");
      const next = applyTerms(termsOfRow(round), body);
      const sets = TERM_COLUMNS.map((c, i) => `${c} = $${i + 5}`).join(", ");
      await db.query(
        `UPDATE unit_offer_rounds SET party = $2, round_date = $3, note = $4, ${sets}, updated_at = now() WHERE id = $1`,
        [roundId, party || round.party, roundDate || round.round_date, note === undefined ? round.note : note, ...termValues(next)]);
      const edge = (await db.query(`SELECT MIN(round_no) AS first, MAX(round_no) AS last FROM unit_offer_rounds WHERE offer_id = $1`, [offer.id])).rows[0];
      if (round.round_no === edge.last) await writeOfferPosition(db, offer.id, next);
      // Round 1 is the first offer: its date is the offer's date.
      if (round.round_no === edge.first && roundDate && roundDate !== offer.offer_date) {
        await db.query(`UPDATE unit_offers SET offer_date = $2, updated_at = now() WHERE id = $1`, [offer.id, roundDate]);
      }
    });
    return buildNegotiation(found.offer_id, access);
  }));

  app.delete("/api/unit-offers/rounds/:roundId", requireAuth, handle(async req => {
    const roundId = idOf(req.params.roundId);
    const found = (await pool.query(`SELECT * FROM unit_offer_rounds WHERE id = $1`, [roundId])).rows[0];
    if (!found) throw new NegotiationError(404, "This position has already been deleted.");
    const { access } = await offerContext(req, found.offer_id);
    if (!mayEditRound(found, access)) throw new NegotiationError(403, "Only the person who logged this position, BGP or the joint agent can delete it.");
    await withOffer(found.offer_id, async (db, offer) => {
      const status = readOfferStatus(offer.status);
      if (!isOpenOffer(status)) throw new NegotiationError(409, closedMessage(status, "deleting a position"));
      const round = (await db.query(`SELECT * FROM unit_offer_rounds WHERE id = $1 FOR UPDATE`, [roundId])).rows[0];
      if (!round) throw new NegotiationError(404, "This position has already been deleted.");
      const edge = (await db.query(`SELECT MIN(round_no) AS first, MAX(round_no) AS last FROM unit_offer_rounds WHERE offer_id = $1`, [offer.id])).rows[0];
      if (round.round_no === edge.first) throw new NegotiationError(400, "The first offer cannot be deleted from the log. Delete the offer itself instead.");
      await db.query(`DELETE FROM unit_offer_rounds WHERE id = $1`, [roundId]);
      // Later rounds close up, so the log still counts 1, 2, 3.
      await db.query(`UPDATE unit_offer_rounds SET round_no = round_no - 1 WHERE offer_id = $1 AND round_no > $2`, [offer.id, round.round_no]);
      const left = (await db.query(`SELECT * FROM unit_offer_rounds WHERE offer_id = $1 ORDER BY round_no DESC, created_at DESC`, [offer.id])).rows;
      // With only the first offer left there has been no counter: Pending again.
      const back = left.length === 1 ? `, status = 'Pending'` : "";
      if (round.round_no === edge.last) await writeOfferPosition(db, offer.id, termsOfRow(left[0]), back);
      else if (back) await db.query(`UPDATE unit_offers SET status = 'Pending', updated_at = now() WHERE id = $1`, [offer.id]);
    });
    return buildNegotiation(found.offer_id, access);
  }));

  // 5. Terms agreed, rejected, withdrawn, or reopened. The only way an
  // offer's status changes.
  app.post("/api/unit-offers/:offerId/status", requireAuth, handle(async req => {
    const offerId = idOf(req.params.offerId);
    const { unit, access } = await offerContext(req, offerId);
    needEdit(access);
    const want = bodyOf(req).status;
    if (want !== "Agreed" && want !== "Negotiating" && want !== "Rejected" && want !== "Withdrawn") {
      throw new NegotiationError(400, "Choose Agreed, Negotiating, Rejected or Withdrawn.");
    }
    await withOffer(offerId, async (db, offer) => {
      const current = readOfferStatus(offer.status);
      const open = isOpenOffer(current);
      const u = (await db.query(`SELECT hots_offer_id, hots_issued_at, hots_final_file_id, marketing_status FROM available_units WHERE id = $1`, [offer.unit_id])).rows[0];
      // Heads of Terms are "out" from this offer once they were issued, the
      // final agreed version is on file, or the letting has gone to
      // solicitors. With no draft generated (HOTs agreed wholly outside the
      // app) the unit's agreed offer is the one they came from.
      const pastHots = ["SOL", "EXC", "COM", "INV"].includes(String(legacyToCode(u?.marketing_status) || ""));
      const theirs = u?.hots_offer_id ? u.hots_offer_id === offer.id : current === "Agreed";
      const hotsOut = theirs && (!!u?.hots_issued_at || !!u?.hots_final_file_id || pastHots);
      const staffOnly = (doing: string) => {
        if (hotsOut && !access.agentControl) throw new NegotiationError(403, `Heads of Terms have gone out from this offer. Only BGP or the joint agent can ${doing}.`);
      };
      const by = await actorNameOf(access, db);
      if (want === "Agreed") {
        if (current === "Agreed") throw new NegotiationError(409, "These terms are already agreed.");
        if (!open) throw new NegotiationError(409, closedMessage(current, "agreeing its terms"));
        const other = await otherAgreedOffer(db, offer.unit_id, offer.id, { brandOnly: isJointAgent(access) });
        if (other) throw new NegotiationError(409, `Terms are already agreed with ${other.name} on this unit. Reopen that offer before agreeing this one.`);
        await ensureRounds(db, offer);
        await db.query(
          `UPDATE unit_offers SET status = 'Agreed', agreed_at = now(), agreed_by_user_id = $2, agreed_by_name = $3, updated_at = now() WHERE id = $1`,
          [offer.id, access.userId, by]);
        return;
      }
      if (want === "Negotiating") {
        if (open) throw new NegotiationError(409, "This offer is already open.");
        staffOnly("reopen it");
      } else {
        if (current === want) throw new NegotiationError(409, `This offer is already ${want.toLowerCase()}.`);
        if (!open && current !== "Agreed") throw new NegotiationError(409, closedMessage(current, `marking it ${want.toLowerCase()}`));
        if (current === "Agreed") staffOnly(`mark it ${want.toLowerCase()}`);
      }
      await db.query(
        `UPDATE unit_offers SET status = $2, agreed_at = NULL, agreed_by_user_id = NULL, agreed_by_name = NULL, updated_at = now() WHERE id = $1`,
        [offer.id, want]);
      // Draft Heads of Terms generated from this offer no longer rest on
      // agreed terms. Raising their version makes every signature given so
      // far stop counting, so they cannot be issued until the draft has been
      // refreshed or amended and everyone has agreed again; the history says
      // why. (Final agreed HOTs on file are left as the record they are.)
      if (current === "Agreed") {
        const moved = await db.query(
          `UPDATE available_units SET hots_version = COALESCE(hots_version, 0) + 1, hots_agreed_at = NULL
            WHERE id = $1 AND hots_offer_id = $2 AND COALESCE(hots_content, '') <> '' AND hots_final_file_id IS NULL
            RETURNING hots_version`, [offer.unit_id, offer.id]);
        if (moved.rows[0]) {
          await db.query(
            `INSERT INTO unit_hots_events (unit_id, kind, body, version, author_user_id, author_name) VALUES ($1, 'offer_changed', $2, $3, $4, $5)`,
            [offer.unit_id, `${want === "Negotiating" ? "reopened" : `marked ${want.toLowerCase()}`} the offer these Heads of Terms were generated from. The draft may no longer match the agreed terms: refresh it from the offer or amend it. Everyone is asked to agree again`,
              moved.rows[0].hots_version, access.userId, by]);
        }
      }
    }, { unitId: unit.id });
    return buildNegotiation(offerId, access);
  }));
}
