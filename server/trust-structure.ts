// A trust's structure, kept by BGP (Jack, 23 November 2026: "Remove KYC4u on
// trusts. We need you to build the trust structuring"). The rules are
// shared/trust-structure.ts; this stores one structure per trust record and
// says what its file still needs. BGP staff signed in as themselves only.

import { Router, type Request, type Response } from "express";
import { pool } from "./db";
import {
  checkTrustStructure, trustRoleWords, trustStructureGaps,
  type TrustDocumentsHeld, type TrustGap, type TrustStructure, type TrustStructureRecord,
} from "@shared/trust-structure";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Kept as the KYC document types the client checks file them as (shared/kyc-request.ts). */
export const TRUST_DEED_DOC_TYPES = ["trust_deed"];
export const TRS_DOC_TYPES = ["trs_excerpt"];

/** The trust's stored structure, or null. A failed read is null. */
export async function trustStructureFor(companyId: string, db: Db = pool): Promise<TrustStructureRecord | null> {
  const r = (await db.query(`SELECT structure, updated_by_name, updated_at FROM kyc_trust_structures WHERE company_id = $1`, [companyId])
    .catch(() => ({ rows: [] as any[] }))).rows[0];
  if (!r) return null;
  const checked = checkTrustStructure(r.structure);
  if ("error" in checked) return null;
  return { structure: checked, updatedBy: r.updated_by_name || null, updatedAt: new Date(r.updated_at).toISOString() };
}

/** Whether the trust deed and HMRC's proof of registration are on the trust's KYC record. */
export async function trustDocumentsHeld(companyId: string, db: Db = pool): Promise<TrustDocumentsHeld> {
  const rows = (await db.query(
    `SELECT DISTINCT doc_type FROM kyc_documents WHERE company_id = $1 AND deleted_at IS NULL AND doc_type = ANY($2::text[])`,
    [companyId, [...TRUST_DEED_DOC_TYPES, ...TRS_DOC_TYPES]]).catch(() => ({ rows: [] as any[] }))).rows;
  const types = new Set(rows.map((r: any) => String(r.doc_type)));
  return { deed: TRUST_DEED_DOC_TYPES.some(t => types.has(t)), trs: TRS_DOC_TYPES.some(t => types.has(t)) };
}

export async function isTrustRecord(companyId: string, db: Db = pool): Promise<boolean> {
  const r = (await db.query(`SELECT aml_subject_type FROM crm_companies WHERE id = $1`, [companyId]).catch(() => ({ rows: [] as any[] }))).rows[0];
  return String(r?.aml_subject_type || "").trim().toLowerCase() === "trust";
}

/** What a trust's file still needs (the sign-off and the AML box read it). */
export async function trustGapsFor(companyId: string, db: Db = pool): Promise<TrustGap[]> {
  const [record, docs] = await Promise.all([trustStructureFor(companyId, db), trustDocumentsHeld(companyId, db)]);
  return trustStructureGaps(record?.structure || null, docs);
}

/** What the client checks for a trust need to know: the documents held and the trustees recorded. */
export async function trustAskFor(companyId: string, db: Db = pool): Promise<{ deed: boolean; trs: boolean; trsNotRequired: boolean; trustees: string[] }> {
  const [record, docs] = await Promise.all([trustStructureFor(companyId, db), trustDocumentsHeld(companyId, db)]);
  return {
    ...docs,
    trsNotRequired: record?.structure.trsStatus === "not_required",
    trustees: (record?.structure.people || []).filter(p => p.roles.includes("trustee") && !p.corporate).map(p => p.name),
  };
}

async function staffMe(req: Request): Promise<{ id: string; name: string | null } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const u = (await pool.query(`SELECT id, name, email FROM users WHERE id = $1`, [userId])).rows[0];
  return u ? { id: String(u.id), name: text(u.name) || text(u.email) || null } : null;
}

const STAFF_ONLY = "BGP staff only, signed in as themselves.";

/** What changed between two structures, in a few words, for the KYC history. */
export function structureChangeWords(before: TrustStructure | null, after: TrustStructure): string {
  if (!before) return `Trust structure recorded: ${after.people.length} ${after.people.length === 1 ? "person" : "people"}${after.people.length ? ` (${after.people.map(p => `${p.name}, ${trustRoleWords(p.roles)}`).join("; ")})` : ""}.`;
  const added = after.people.filter(p => !before.people.some(b => b.key === p.key));
  const removed = before.people.filter(b => !after.people.some(p => p.key === b.key));
  const bits: string[] = [];
  if (before.kind !== after.kind) bits.push(`kind ${before.kind} to ${after.kind}`);
  if (before.trsStatus !== after.trsStatus) bits.push(`registration ${before.trsStatus.replace(/_/g, " ")} to ${after.trsStatus.replace(/_/g, " ")}`);
  if (added.length) bits.push(`added ${added.map(p => `${p.name} (${trustRoleWords(p.roles)})`).join(", ")}`);
  if (removed.length) bits.push(`removed ${removed.map(p => p.name).join(", ")}`);
  if ((before.settlorWealth || "") !== (after.settlorWealth || "")) bits.push("source of the settlor's wealth");
  if ((before.beneficiaryClass || "") !== (after.beneficiaryClass || "")) bits.push("class of beneficiaries");
  return `Trust structure changed${bits.length ? `: ${bits.join("; ")}` : ""}.`;
}

const router = Router();

router.get("/api/trust-structure/:companyId", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: STAFF_ONLY });
    const companyId = String(req.params.companyId);
    const company = (await pool.query(`SELECT id, name, aml_subject_type FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
    if (!company) return res.status(404).json({ message: "Company not found." });
    const [record, docs] = await Promise.all([trustStructureFor(companyId), trustDocumentsHeld(companyId)]);
    res.json({
      companyId, name: company.name, trust: String(company.aml_subject_type || "").toLowerCase() === "trust",
      record, documents: docs, gaps: trustStructureGaps(record?.structure || null, docs),
    });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Could not read the trust's structure." });
  }
});

router.put("/api/trust-structure/:companyId", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const companyId = String(req.params.companyId);
    if (!(await isTrustRecord(companyId))) return res.status(409).json({ message: "Record it as a trust first: a structure is kept only for a trust or foundation." });
    const checked = checkTrustStructure(req.body?.structure);
    if ("error" in checked) return res.status(400).json({ message: checked.error });
    const before = await trustStructureFor(companyId);
    await pool.query(
      `INSERT INTO kyc_trust_structures (company_id, structure, updated_by, updated_by_name, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (company_id) DO UPDATE SET structure = EXCLUDED.structure, updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name, updated_at = now()`,
      [companyId, JSON.stringify(checked), me.id, me.name]);
    await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'trust_structure', $2, $3)`,
      [companyId, me.name || me.id, structureChangeWords(before?.structure || null, checked)]).catch(() => {});
    // The people recorded are screened on a fresh run of BGP's checks.
    const dealId = text(req.body?.dealId) || null;
    const { startPrecheck } = await import("./kyc-prechecks");
    void startPrecheck(companyId, { dealId, userId: me.id, force: true, entityId: null }).catch(() => {});
    const record = await trustStructureFor(companyId);
    const docs = await trustDocumentsHeld(companyId);
    res.json({ ok: true, record, documents: docs, gaps: trustStructureGaps(record?.structure || null, docs) });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Could not save the trust's structure." });
  }
});

export default router;
