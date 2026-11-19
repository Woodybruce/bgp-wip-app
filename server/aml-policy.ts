// BGP's AML policy in the app (Woody, 19 November 2026: "can you consider
// these and add into the AML as required", then "can we have that as a
// download"). The rules are shared/aml-policy.ts.
//
//   GET  /api/aml-policy                         the officers, the documents and the rules (BGP staff)
//   GET  /api/aml-policy/documents/:key          a document as a download (BGP staff)
//   PUT  /api/aml-policy/officers                { nominatedId, deputyId } (admins)
//   POST /api/aml-policy/officers/from-policy    sets the officers the policy names (admins)
//
// Outside /api/aml/, which the retired in-app AML answers 410, and on no
// client gateway list: BGP staff signed in as themselves only.

import { Router, type Request, type Response } from "express";
import { existsSync } from "fs";
import path from "path";
import { pool } from "./db";
import {
  AML_POLICY_DOCUMENTS, FATF_LISTS_AS_OF, LETTING_AML_MONTHLY_RENT, NOT_REQUIRED_REASONS, POLICY_OFFICER_NAMES, RECHECK_YEARS,
  amlPolicyDocument, type NotRequiredReason, type PartyNotRequired,
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

/** The live "Not required" markers on some deals, by deal id and role, for the party each was set for. */
export async function loadNotRequired(db: Db, dealIds: string[]): Promise<Map<string, PartyNotRequired & { companyId: string }>> {
  const out = new Map<string, PartyNotRequired & { companyId: string }>();
  if (!dealIds.length) return out;
  const { rows } = await db.query(
    `SELECT id, deal_id, role, company_id, reason, comment, set_by_name, set_at
       FROM kyc_party_exemptions WHERE deal_id = ANY($1::varchar[]) AND undone_at IS NULL
      ORDER BY set_at DESC`, [dealIds]);
  for (const r of rows) {
    const key = `${r.deal_id}:${r.role}`;
    if (out.has(key)) continue;
    const reason = (Object.prototype.hasOwnProperty.call(NOT_REQUIRED_REASONS, r.reason) ? r.reason : "joint_agent") as NotRequiredReason;
    out.set(key, {
      id: Number(r.id), reason, reasonWords: NOT_REQUIRED_REASONS[reason], comment: String(r.comment || ""),
      by: r.set_by_name || null, at: r.set_at ? new Date(r.set_at).toISOString() : null, companyId: String(r.company_id),
    });
  }
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
    const { amlOfficers } = await import("./aml-authority");
    const officers = await amlOfficers();
    res.json({
      documents: AML_POLICY_DOCUMENTS.map(d => ({ key: d.key, title: d.title, issue: d.issue, date: d.date, url: `/api/aml-policy/documents/${d.key}`, onFile: !!documentPath(d.file) })),
      officers: {
        nominated: officers.nominated ? { id: officers.nominated.id, name: officers.nominated.name } : null,
        deputy: officers.deputy ? { id: officers.deputy.id, name: officers.deputy.name } : null,
      },
      policyNames: POLICY_OFFICER_NAMES,
      canEdit: me.isAdmin,
      recheckYears: RECHECK_YEARS,
      lettingMonthlyRent: LETTING_AML_MONTHLY_RENT,
      fatfAsOf: FATF_LISTS_AS_OF,
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

async function setOfficers(nominatedId: string | null, deputyId: string | null, me: { id: string; name: string }): Promise<{ nominated: string | null; deputy: string | null }> {
  const ids = [nominatedId, deputyId].filter((x): x is string => !!x);
  const users = ids.length
    ? (await pool.query(`SELECT id, name, email FROM users WHERE id = ANY($1::varchar[]) AND COALESCE(is_active, true) = true`, [ids])).rows
    : [];
  const user = (id: string | null) => id ? users.find((u: any) => String(u.id) === id) || null : null;
  const n = user(nominatedId), d = user(deputyId);
  if (nominatedId && !n) throw Object.assign(new Error("The Nominated Officer must be an active BGP login."), { status: 400 });
  if (deputyId && !d) throw Object.assign(new Error("The Deputy must be an active BGP login."), { status: 400 });
  if (n && d && String(n.id) === String(d.id)) throw Object.assign(new Error("The Nominated Officer and the Deputy must be different people."), { status: 400 });
  for (const u of [n, d]) {
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
  const deputy = d ? { id: String(d.id), name: text(d.name), email: String(d.email).toLowerCase(), setBy: me.name, setAt: new Date().toISOString() } : { id: null, name: null, email: null, setBy: me.name, setAt: new Date().toISOString() };
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [DEPUTY_SETTING_KEY, JSON.stringify(deputy)]);
  console.log(`[aml-policy] officers set by ${me.name}: Nominated Officer ${n ? text(n.name) : "none"}, Deputy ${d ? text(d.name) : "none"}`);
  return { nominated: n ? text(n.name) : null, deputy: d ? text(d.name) : null };
}

router.put("/api/aml-policy/officers", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    if (!me.isAdmin) return res.status(403).json({ message: "Only an admin sets the AML officers." });
    const nominatedId = text(req.body?.nominatedId) || null;
    const deputyId = text(req.body?.deputyId) || null;
    if (!nominatedId) return res.status(400).json({ message: "Choose the Nominated Officer." });
    res.json({ ok: true, ...(await setOfficers(nominatedId, deputyId, me)) });
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
    const nominatedId = await find(POLICY_OFFICER_NAMES.nominated);
    const deputyId = await find(POLICY_OFFICER_NAMES.deputy);
    if (!nominatedId) return res.status(409).json({ message: `No single active login is named ${POLICY_OFFICER_NAMES.nominated}: choose the officers by hand.` });
    res.json({ ok: true, ...(await setOfficers(nominatedId, deputyId, me)), deputyMissing: !deputyId });
  } catch (err: any) {
    if (!err?.status) console.error("[aml-policy] officers not saved:", err?.message);
    res.status(err?.status || 500).json({ message: err?.status ? err.message : "The officers could not be saved." });
  }
});

export default router;
