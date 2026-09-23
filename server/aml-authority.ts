// Who may make AML decisions.
//
// MLR 2017 Reg 21 puts CDD sign-off, overrides and suspicion reporting with
// the nominated officer (MLRO), not with whoever is logged in. The MLRO is
// the user whose email (or id) is on aml_settings. Until one is appointed,
// admins act — and every response says no MLRO is appointed, so the gap is
// visible rather than silently papered over (Woody, 2026-09-23 AML review).
import type { Request, Response, NextFunction } from "express";
import { pool } from "./db";
import { ADMIN_EMAILS } from "./auth";

export type AmlActor = { id: string | null; name: string | null; email: string | null; isMlro: boolean; mlroAppointed: boolean };

export function requestUserId(req: Request): string | null {
  return (req.session as any)?.userId || (req as any).tokenUserId || (req as any).user?.id || null;
}

/** Pure rule, for tests: is this user the nominated officer? */
export function isNominatedOfficer(user: { id?: string | null; email?: string | null; is_admin?: boolean | null } | null,
  settings: { nominated_officer_id?: string | null; nominated_officer_email?: string | null } | null): { isMlro: boolean; mlroAppointed: boolean } {
  const email = String(user?.email || "").toLowerCase().trim();
  const officerEmail = String(settings?.nominated_officer_email || "").toLowerCase().trim();
  const officerId = settings?.nominated_officer_id || null;
  const mlroAppointed = !!(officerEmail || officerId);
  if (!user) return { isMlro: false, mlroAppointed };
  if (mlroAppointed) return { isMlro: (!!officerId && user.id === officerId) || (!!officerEmail && email === officerEmail), mlroAppointed };
  return { isMlro: user.is_admin === true || ADMIN_EMAILS.has(email), mlroAppointed };
}

export async function amlActor(req: Request): Promise<AmlActor> {
  const id = requestUserId(req);
  const [user, settings] = await Promise.all([
    id ? pool.query("SELECT id, name, email, is_admin, is_active FROM users WHERE id=$1", [id]).then(r => r.rows[0] || null).catch(() => null) : null,
    pool.query("SELECT nominated_officer_id, nominated_officer_email FROM aml_settings ORDER BY id LIMIT 1").then(r => r.rows[0] || null).catch(() => null),
  ]);
  const active = user && user.is_active !== false ? user : null;
  const { isMlro, mlroAppointed } = isNominatedOfficer(active, settings);
  return { id, name: active?.name || null, email: active?.email || null, isMlro, mlroAppointed };
}

/** Route guard: only the MLRO (or admins while none is appointed). */
export async function requireMlro(req: Request, res: Response, next: NextFunction) {
  const actor = await amlActor(req);
  if (!actor.id) return res.status(401).json({ message: "Not authenticated" });
  if (!actor.isMlro) {
    return res.status(403).json({ message: actor.mlroAppointed ? "Only the MLRO (nominated officer) can do this" : "Only an admin can do this until an MLRO is appointed in AML settings", code: "MLRO_ONLY" });
  }
  (req as any).amlActor = actor;
  next();
}
