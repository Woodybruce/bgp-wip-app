// Who may make AML decisions.
//
// MLR 2017 Reg 21 puts CDD sign-off, overrides and suspicion reporting with
// the nominated officer (MLRO), not with whoever is logged in. BGP's AML
// policy (Issue 2, November 2026, section C.b) names a Nominated Officer and
// a Deputy who acts in their place: both decide (Woody, 19 November 2026).
// The Nominated Officer is the user whose email (or id) is on aml_settings;
// the Deputies (more than one since 20 November 2026) are
// system_settings.aml_deputy_officer. Until a Nominated Officer
// is set, admins act, and every response says none is set, so the gap is
// visible rather than silently papered over (Woody, 2026-09-23 AML review).
import type { Request, Response, NextFunction } from "express";
import { pool } from "./db";
import { ADMIN_EMAILS } from "./auth";
import { amlOfficerRole, officerWords, readDeputies, type AmlOfficer, type AmlOfficerRole, type AmlOfficers } from "@shared/aml-policy";

export type AmlActor = {
  id: string | null; name: string | null; email: string | null;
  isMlro: boolean; mlroAppointed: boolean;
  // nominated, deputy, or admin while no Nominated Officer is set.
  officerRole: AmlOfficerRole | null;
  officers: AmlOfficers;
};

export const DEPUTY_SETTING_KEY = "aml_deputy_officer";

// Enhanced due diligence is BGP's own: KYC4U is no longer used (Woody,
// 23 November 2026: "We are no longer using KYC 4U update the app accross
// everyhting"). The officers sign off an enhanced, trust or owned-abroad
// party themselves, with a note of what was checked. Until then it was a
// switch the officers turned on (21 November 2026); the setting it was kept
// in (system_settings.aml_in_house_edd) is no longer read. KYC4U's past
// results, documents and copied files stay on record and still count.
import { KYC4U_RETIRED_ON } from "@shared/kyc4u-portal";
export { KYC4U_RETIRED_ON };
export interface InHouseEdd { on: boolean; by: string | null; at: string | null }
export async function readInHouseEdd(): Promise<InHouseEdd> {
  return { on: true, by: null, at: `${KYC4U_RETIRED_ON}T00:00:00.000Z` };
}

export function requestUserId(req: Request): string | null {
  return (req.session as any)?.userId || (req as any).tokenUserId || (req as any).user?.id || null;
}

/** Pure rule, for tests: is this user the Nominated Officer (or a Deputy, when given)? */
export function isNominatedOfficer(user: { id?: string | null; email?: string | null; is_admin?: boolean | null } | null,
  settings: { nominated_officer_id?: string | null; nominated_officer_email?: string | null } | null,
  deputies: AmlOfficer[] = []): { isMlro: boolean; mlroAppointed: boolean } {
  const officers: AmlOfficers = {
    nominated: settings?.nominated_officer_id || settings?.nominated_officer_email
      ? { id: settings?.nominated_officer_id || null, email: settings?.nominated_officer_email || null, name: null } : null,
    deputies,
  };
  const isAdmin = !!user && (user.is_admin === true || ADMIN_EMAILS.has(String(user.email || "").toLowerCase().trim()));
  const { role, appointed } = amlOfficerRole(user, officers, isAdmin);
  return { isMlro: role !== null, mlroAppointed: appointed };
}

/** The officers as set: the Nominated Officer on aml_settings, the Deputies in system_settings. */
export async function amlOfficers(): Promise<AmlOfficers> {
  const [settings, deputy] = await Promise.all([
    pool.query("SELECT nominated_officer_id, nominated_officer_name, nominated_officer_email FROM aml_settings ORDER BY id LIMIT 1").then(r => r.rows[0] || null).catch(() => null),
    pool.query("SELECT value FROM system_settings WHERE key = $1", [DEPUTY_SETTING_KEY]).then(r => r.rows[0]?.value || null).catch(() => null),
  ]);
  const nominated = settings && (settings.nominated_officer_id || settings.nominated_officer_email)
    ? { id: settings.nominated_officer_id || null, name: settings.nominated_officer_name || null, email: settings.nominated_officer_email || null } : null;
  return { nominated, deputies: readDeputies(deputy) };
}

/** The officers' email addresses that belong to active logins (for the policy's escalations). */
export async function amlOfficerEmails(officers?: AmlOfficers): Promise<string[]> {
  const o = officers || await amlOfficers();
  const list = [o.nominated, ...o.deputies].filter((x): x is AmlOfficer => !!x);
  const ids = list.map(x => x.id).filter((x): x is string => !!x);
  const active = ids.length
    ? (await pool.query(`SELECT id, email FROM users WHERE id = ANY($1::varchar[]) AND COALESCE(is_active, true) = true`, [ids]).catch(() => ({ rows: [] as any[] }))).rows
    : [];
  const out = new Set<string>();
  for (const officer of list) {
    // A login set as an officer: its current address while it is active. An
    // officer set by address only: that address.
    const email = officer.id ? active.find((r: any) => String(r.id) === officer.id)?.email : officer.email;
    if (email) out.add(String(email).toLowerCase());
  }
  return [...out];
}

export async function amlActor(req: Request): Promise<AmlActor> {
  const id = requestUserId(req);
  const [user, officers] = await Promise.all([
    id ? pool.query("SELECT id, name, email, is_admin, is_active FROM users WHERE id=$1", [id]).then(r => r.rows[0] || null).catch(() => null) : null,
    amlOfficers(),
  ]);
  const active = user && user.is_active !== false ? user : null;
  const isAdmin = !!active && (active.is_admin === true || ADMIN_EMAILS.has(String(active.email || "").toLowerCase().trim()));
  const { role, appointed } = amlOfficerRole(active, officers, isAdmin);
  return { id, name: active?.name || null, email: active?.email || null, isMlro: role !== null, mlroAppointed: appointed, officerRole: role, officers };
}

/** What a refusal says: who may decide. */
export const officerRefusal = (actor: Pick<AmlActor, "officers" | "mlroAppointed">, what = "do this"): string =>
  actor.mlroAppointed
    ? `Only ${officerWords(actor.officers)} can ${what}.`
    : `Only an admin can ${what} until a Nominated Officer is set in the AML policy panel (Transactions, AML).`;

/** Route guard: only the Nominated Officer or the Deputy (or admins while none is set). */
export async function requireMlro(req: Request, res: Response, next: NextFunction) {
  const actor = await amlActor(req);
  if (!actor.id) return res.status(401).json({ message: "Not authenticated" });
  if (!actor.isMlro) {
    return res.status(403).json({ message: officerRefusal(actor), code: "MLRO_ONLY" });
  }
  (req as any).amlActor = actor;
  next();
}
