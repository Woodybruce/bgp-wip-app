// BGP's AML policy in the app (Woody, 19 November 2026: "can you consider
// these and add into the AML as required", then "can we have that as a
// download"). The rules are shared/aml-policy.ts.
//
//   GET  /api/aml-policy                         the officers, the documents and the rules (BGP staff)
//   GET  /api/aml-policy/documents/:key          a document as a download (BGP staff)
//   PUT  /api/aml-policy/officers                { nominatedId, deputyIds } (admins; deputyId from a cached screen)
//   POST /api/aml-policy/officers/from-policy    sets the officers the policy names (admins)
//   PUT  /api/aml-policy/in-house-edd            { on }: BGP does enhanced due diligence itself, not KYC4U (the officers)
//
// Outside /api/aml/, which the retired in-app AML answers 410, and on no
// client gateway list: BGP staff signed in as themselves only.

import { Router, type Request, type Response } from "express";
import { existsSync } from "fs";
import path from "path";
import { pool } from "./db";
import {
  AML_POLICY_DOCUMENTS, FATF_LISTS_AS_OF, JOINT_ASKED_HOW, JOINT_OUTCOMES, LETTING_AML_MONTHLY_RENT, MAX_AML_DEPUTIES, NOT_REQUIRED_REASONS, POLICY_OFFICER_NAMES, RECHECK_YEARS,
  amlPolicyDocument, jointAgentRule, jointAskWords, notRequiredLapse, type JointAskRecord, type NotRequiredReason, type PartyNotRequired,
} from "@shared/aml-policy";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

async function staffMe(req: Request): Promise<{ id: string; name: string; isAdmin: boolean } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const u = (await pool.query(`SELECT id, name, email, is_admin FROM users WHERE id = $1`, [userId])).rows[0];
  if (!u) return null;
  const { ADMIN_EMAILS } = await import("./auth");
  return { id: String(u.id), name: text(u.name) || text(u.email), isAdmin: u.is_admin === true || ADMIN_EMAILS.has(String(u.email || "").toLowerCase().trim()) };
}

// ── Not required: the deal parties the officers marked ──────────────────────

type NotRequiredMark = PartyNotRequired & { companyId: string };

/**
 * Every "Not required" marker on some deals, by deal id and role, for the
 * party each was set for, with why it no longer counts under HMRC's rules
 * (notRequiredLapse: the joint agent reason on a letting at £10,000 a month
 * or more, or on a sale with no record of asking the joint agent).
 */
export async function loadNotRequiredMarks(db: Db, dealIds: string[]): Promise<Map<string, NotRequiredMark & { lapsed: string | null }>> {
  const out = new Map<string, NotRequiredMark & { lapsed: string | null }>();
  if (!dealIds.length) return out;
  const { rows } = await db.query(
    `SELECT x.id, x.deal_id, x.role, x.company_id, x.reason, x.comment, x.set_by_name, x.set_at,
            x.asked_on, x.asked_how, x.asked_whom, x.asked_outcome, x.joint_ref,
            d.deal_type, d.team, d.rent_pa
       FROM kyc_party_exemptions x LEFT JOIN crm_deals d ON d.id = x.deal_id
      WHERE x.deal_id = ANY($1::varchar[]) AND x.undone_at IS NULL
      ORDER BY x.set_at DESC`, [dealIds]);
  for (const r of rows) {
    const key = `${r.deal_id}:${r.role}`;
    if (out.has(key)) continue;
    const reason = (Object.prototype.hasOwnProperty.call(NOT_REQUIRED_REASONS, r.reason) ? r.reason : "joint_agent") as NotRequiredReason;
    const askedOn = r.asked_on ? (r.asked_on instanceof Date ? r.asked_on.toISOString().slice(0, 10) : String(r.asked_on).slice(0, 10)) : null;
    const asked: JointAskRecord | null = askedOn && r.asked_how && r.asked_outcome && Object.prototype.hasOwnProperty.call(JOINT_ASKED_HOW, r.asked_how) && Object.prototype.hasOwnProperty.call(JOINT_OUTCOMES, r.asked_outcome)
      ? { askedOn, how: r.asked_how, whom: text(r.asked_whom) || "the joint agent", outcome: r.asked_outcome, ref: r.joint_ref || null }
      : null;
    const mark: NotRequiredMark = {
      id: Number(r.id), reason,
      reasonWords: asked ? `${NOT_REQUIRED_REASONS[reason]}. ${jointAskWords(asked)}` : NOT_REQUIRED_REASONS[reason],
      comment: String(r.comment || ""), asked,
      by: r.set_by_name || null, at: r.set_at ? new Date(r.set_at).toISOString() : null, companyId: String(r.company_id),
    };
    out.set(key, { ...mark, lapsed: notRequiredLapse(mark, jointAgentRule({ dealType: r.deal_type, team: r.team, rentPa: r.rent_pa })) });
  }
  return out;
}

/** The "Not required" markers that count, by deal id and role, for the party each was set for. */
export async function loadNotRequired(db: Db, dealIds: string[]): Promise<Map<string, NotRequiredMark>> {
  const out = new Map<string, NotRequiredMark>();
  for (const [key, { lapsed, ...mark }] of await loadNotRequiredMarks(db, dealIds)) if (!lapsed) out.set(key, mark);
  return out;
}

/** The roles of one deal marked Not required, for the party now on each role. */
export async function notRequiredRoles(db: Db, dealId: string, partyByRole: Record<string, string | null | undefined>): Promise<Set<string>> {
  const marks = await loadNotRequired(db, [dealId]).catch(() => new Map());
  const roles = new Set<string>();
  for (const [key, mark] of marks) {
    const role = key.slice(dealId.length + 1);
    if (partyByRole[role] && String(partyByRole[role]) === mark.companyId) roles.add(role);
  }
  return roles;
}

// ── The documents ───────────────────────────────────────────────────────────

function documentPath(file: string): string | null {
  for (const p of [path.join(process.cwd(), "server/assets/aml-policy", file), path.join(process.cwd(), "dist/server/assets/aml-policy", file)]) {
    if (existsSync(p)) return p;
  }
  return null;
}

const router = Router();

router.get("/api/aml-policy", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const { amlOfficers, amlActor, readInHouseEdd } = await import("./aml-authority");
    const officers = await amlOfficers();
    const actor = await amlActor(req);
    const inHouseEdd = await readInHouseEdd();
    res.json({
      documents: AML_POLICY_DOCUMENTS.map(d => ({ key: d.key, title: d.title, issue: d.issue, date: d.date, url: `/api/aml-policy/documents/${d.key}`, onFile: !!documentPath(d.file) })),
      officers: {
        nominated: officers.nominated ? { id: officers.nominated.id, name: officers.nominated.name } : null,
        deputies: officers.deputies.map(d => ({ id: d.id, name: d.name })),
        // The first Deputy, for a screen loaded before there could be several.
        deputy: officers.deputies[0] ? { id: officers.deputies[0].id, name: officers.deputies[0].name } : null,
      },
      maxDeputies: MAX_AML_DEPUTIES,
      policyNames: POLICY_OFFICER_NAMES,
      canEdit: me.isAdmin,
      // The Nominated Officer or the Deputy (admins while none is set): the
      // AML register and the five-year deletion are theirs; training is
      // theirs and admins'.
      isOfficer: actor.isMlro,
      managesTraining: actor.isMlro || me.isAdmin,
      recheckYears: RECHECK_YEARS,
      lettingMonthlyRent: LETTING_AML_MONTHLY_RENT,
      fatfAsOf: FATF_LISTS_AS_OF,
      // In-house enhanced due diligence (21 November 2026): the officers switch it.
      inHouseEdd,
    });
  } catch (err: any) {
    console.error("[aml-policy] read failed:", err?.message);
    res.status(500).json({ message: "The AML policy could not be read." });
  }
});

router.get("/api/aml-policy/documents/:key", async (req: Request, res: Response) => {
  const me = await staffMe(req).catch(() => null);
  if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
  const doc = amlPolicyDocument(req.params.key);
  const file = doc ? documentPath(doc.file) : null;
  if (!doc || !file) return res.status(404).json({ message: "That document is not on file." });
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.download(file, `BGP ${doc.title} - Issue ${doc.issue}.docx`);
});

// ── The officers (admins) ───────────────────────────────────────────────────

async function setOfficers(nominatedId: string | null, deputyIds: string[], me: { id: string; name: string }): Promise<{ nominated: string | null; deputies: string[]; deputy: string | null }> {
  const wanted = [...new Set(deputyIds.filter(Boolean))];
  if (wanted.length > MAX_AML_DEPUTIES) throw Object.assign(new Error(`At most ${MAX_AML_DEPUTIES} Deputies.`), { status: 400 });
  const ids = [nominatedId, ...wanted].filter((x): x is string => !!x);
  const users = ids.length
    ? (await pool.query(`SELECT id, name, email FROM users WHERE id = ANY($1::varchar[]) AND COALESCE(is_active, true) = true`, [ids])).rows
    : [];
  const user = (id: string | null) => id ? users.find((u: any) => String(u.id) === id) || null : null;
  const n = user(nominatedId);
  if (nominatedId && !n) throw Object.assign(new Error("The Nominated Officer must be an active BGP login."), { status: 400 });
  const ds = wanted.map(id => {
    const d = user(id);
    if (!d) throw Object.assign(new Error("Each Deputy must be an active BGP login."), { status: 400 });
    if (n && String(n.id) === String(d.id)) throw Object.assign(new Error("The Nominated Officer cannot also be a Deputy."), { status: 400 });
    return d;
  });
  for (const u of [n, ...ds]) {
    if (u && !/@brucegillinghampollard\.com$/i.test(String(u.email || ""))) throw Object.assign(new Error("An officer must be a BGP member of staff."), { status: 400 });
  }
  const existing = (await pool.query(`SELECT id FROM aml_settings ORDER BY id LIMIT 1`)).rows[0];
  const vals = [n ? String(n.id) : null, n ? text(n.name) : null, n ? String(n.email).toLowerCase() : null];
  if (existing) {
    await pool.query(
      `UPDATE aml_settings SET nominated_officer_id = $1::varchar, nominated_officer_name = $2::text, nominated_officer_email = $3::text,
              nominated_officer_appointed_at = CASE WHEN nominated_officer_id IS DISTINCT FROM $1::varchar THEN NOW() ELSE nominated_officer_appointed_at END,
              updated_at = NOW() WHERE id = $4`, [...vals, existing.id]);
  } else {
    await pool.query(
      `INSERT INTO aml_settings (nominated_officer_id, nominated_officer_name, nominated_officer_email, nominated_officer_appointed_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`, vals);
  }
  const { DEPUTY_SETTING_KEY } = await import("./aml-authority");
  // The list form (20 November 2026); readDeputies also reads the single officer stored before.
  const deputies = { deputies: ds.map(d => ({ id: String(d.id), name: text(d.name), email: String(d.email).toLowerCase() })), setBy: me.name, setAt: new Date().toISOString() };
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [DEPUTY_SETTING_KEY, JSON.stringify(deputies)]);
  const names = ds.map(d => text(d.name));
  console.log(`[aml-policy] officers set by ${me.name}: Nominated Officer ${n ? text(n.name) : "none"}, Deputies ${names.length ? names.join(", ") : "none"}`);
  return { nominated: n ? text(n.name) : null, deputies: names, deputy: names[0] || null };
}

router.put("/api/aml-policy/officers", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    if (!me.isAdmin) return res.status(403).json({ message: "Only an admin sets the AML officers." });
    const nominatedId = text(req.body?.nominatedId) || null;
    // deputyIds (a list, since 20 November 2026), or deputyId from a screen loaded before.
    const deputyIds = Array.isArray(req.body?.deputyIds)
      ? req.body.deputyIds.map((x: unknown) => text(x)).filter(Boolean)
      : [text(req.body?.deputyId)].filter(Boolean);
    if (!nominatedId) return res.status(400).json({ message: "Choose the Nominated Officer." });
    res.json({ ok: true, ...(await setOfficers(nominatedId, deputyIds, me)) });
  } catch (err: any) {
    if (!err?.status) console.error("[aml-policy] officers not saved:", err?.message);
    res.status(err?.status || 500).json({ message: err?.status ? err.message : "The officers could not be saved." });
  }
});

router.post("/api/aml-policy/officers/from-policy", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    if (!me.isAdmin) return res.status(403).json({ message: "Only an admin sets the AML officers." });
    const find = async (name: string) => {
      const rows = (await pool.query(
        `SELECT id FROM users WHERE lower(btrim(name)) = lower($1) AND COALESCE(is_active, true) = true AND email ILIKE '%@brucegillinghampollard.com'`, [name])).rows;
      return rows.length === 1 ? String(rows[0].id) : null;
    };
    // First set-up only: it would put back the one Deputy the policy names
    // over the ones an admin has chosen since (20 November 2026).
    const { amlOfficers } = await import("./aml-authority");
    if ((await amlOfficers()).nominated) return res.status(409).json({ message: "The officers are already set: use Change." });
    const nominatedId = await find(POLICY_OFFICER_NAMES.nominated);
    const deputyId = await find(POLICY_OFFICER_NAMES.deputy);
    if (!nominatedId) return res.status(409).json({ message: `No single active login is named ${POLICY_OFFICER_NAMES.nominated}: choose the officers by hand.` });
    res.json({ ok: true, ...(await setOfficers(nominatedId, deputyId ? [deputyId] : [], me)), deputyMissing: !deputyId });
  } catch (err: any) {
    if (!err?.status) console.error("[aml-policy] officers not saved:", err?.message);
    res.status(err?.status || 500).json({ message: err?.status ? err.message : "The officers could not be saved." });
  }
});

// ── In-house enhanced due diligence (the officers) ─────────────────────────
// Woody, 21 November 2026: "I'm trying to set this up without using kyc4u".
// Off by default: until an officer switches it on, an enhanced, trust or
// owned-abroad party goes to KYC4U as before.
router.put("/api/aml-policy/in-house-edd", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const { amlActor, officerRefusal, writeInHouseEdd } = await import("./aml-authority");
    const actor = await amlActor(req);
    if (!actor.isMlro) return res.status(403).json({ message: officerRefusal(actor, "change how enhanced due diligence is done") });
    if (typeof req.body?.on !== "boolean") return res.status(400).json({ message: "Say whether BGP does enhanced due diligence itself (on: true or false)." });
    res.json({ ok: true, inHouseEdd: await writeInHouseEdd(req.body.on, { id: me.id, name: me.name }) });
  } catch (err: any) {
    console.error("[aml-policy] in-house setting not saved:", err?.message);
    res.status(500).json({ message: "The setting could not be saved." });
  }
});

export default router;
