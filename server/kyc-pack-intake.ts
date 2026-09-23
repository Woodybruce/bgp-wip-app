// KYC pack upload — a whole CDD pack (e.g. a KYC4U customer folder) in one
// go: many files or a .zip, each sorted into its document type and filed on
// the counterparty's KYC record (Woody, 2026-09-23, Aromaria's pack).
//
// Evidence on file ticks the matching checklist items with source
// "kyc_pack" so the file shows what's covered — it never approves: the
// MLRO still reviews the pack and signs off.
import { Router, type Request, type Response } from "express";
import multer from "multer";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { saveFile } from "./file-storage";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024, files: 60 } });

export type PackDocType = "passport" | "proof_of_address" | "company_cert" | "ubo_declaration" | "source_of_funds"
  | "source_of_wealth" | "bank_statement" | "credit_report" | "engagement_letter" | "kyc_form" | "solicitor_confirmation" | "other";

// Ordered: the first match wins ("Passport and Address Proof" is ID first).
const RULES: Array<[RegExp, PackDocType]> = [
  [/source[\s_-]*of[\s_-]*fund/i, "source_of_funds"],
  [/source[\s_-]*of[\s_-]*wealth/i, "source_of_wealth"],
  [/passport|driv(ing|er'?s)[\s_-]*licen[cs]e|national[\s_-]*id|identity[\s_-]*card/i, "passport"],
  [/proof[\s_-]*of[\s_-]*(address|domicile|residence)|utility|council[\s_-]*tax|landline[\s_-]*bill|electricity|gas[\s_-]*bill/i, "proof_of_address"],
  [/bank[\s_-]*statement/i, "bank_statement"],
  [/ownership|deed|shareholder|register[\s_-]*of[\s_-]*members|ubo|beneficial/i, "ubo_declaration"],
  [/regist(ry|er|ration)[\s_-]*extract|business[\s_-]*registry|certificate[\s_-]*of[\s_-]*(incorporation|formation|good[\s_-]*standing)|companies[\s_-]*house|incorporation/i, "company_cert"],
  [/credit[\s_-]*safe|creditsafe|credit[\s_-]*report|experian|dun[\s_-]*(and|&)[\s_-]*bradstreet/i, "credit_report"],
  [/terms[\s_-]*of[\s_-]*(engagement|business)|engagement[\s_-]*letter|letter[\s_-]*of[\s_-]*engagement/i, "engagement_letter"],
  [/kyc[\s_-]*(verification[\s_-]*)?form|cdd[\s_-]*form|verification[\s_-]*form/i, "kyc_form"],
  [/solicitor/i, "solicitor_confirmation"],
];

/** Document type from the file name (packs are named by what they are). */
export function classifyPackFile(fileName: string): PackDocType {
  const name = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/^\d+[-_]/, "");
  for (const [re, type] of RULES) if (re.test(name)) return type;
  return "other";
}

/** Checklist items a set of documents evidences (for the MLRO to confirm). */
export function packEvidence(types: PackDocType[]): Record<string, PackDocType[]> {
  const has = (t: PackDocType) => types.includes(t);
  const out: Record<string, PackDocType[]> = {};
  if (has("passport")) out.id_verified = ["passport"];
  if (has("proof_of_address")) out.address_verified = ["proof_of_address"];
  if (has("company_cert")) out.company_cert = ["company_cert"];
  if (has("ubo_declaration")) { out.ubo_identified = ["ubo_declaration"]; out.ubo_verified = ["ubo_declaration", ...(has("passport") ? ["passport" as const] : [])]; }
  if (has("source_of_funds") || has("bank_statement")) out.sof_evidenced = [has("source_of_funds") ? "source_of_funds" : "bank_statement"];
  if (has("source_of_wealth")) out.sow_evidenced = ["source_of_wealth"];
  return out;
}

const MIME: Record<string, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

async function expand(files: Express.Multer.File[]): Promise<Array<{ name: string; buffer: Buffer; mime: string }>> {
  const out: Array<{ name: string; buffer: Buffer; mime: string }> = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.originalname)) {
      const AdmZip = (await import("adm-zip")).default;
      for (const e of new AdmZip(f.buffer).getEntries()) {
        if (e.isDirectory || /(^|\/)(__MACOSX|\.DS_Store)/.test(e.entryName)) continue;
        const name = e.entryName.split("/").pop() || e.entryName;
        const ext = (name.split(".").pop() || "").toLowerCase();
        out.push({ name, buffer: e.getData(), mime: MIME[ext] || "application/octet-stream" });
      }
    } else {
      out.push({ name: f.originalname, buffer: f.buffer, mime: f.mimetype || "application/octet-stream" });
    }
  }
  return out;
}

router.post("/api/kyc/company/:id/pack", requireAuth, upload.array("files", 60), async (req: Request, res: Response) => {
  try {
    const { isClientRequestUser } = await import("./company-scope");
    if (await isClientRequestUser(req)) return res.status(403).json({ error: "Staff only" });
    const companyId = String(req.params.id);
    const company = (await pool.query(`SELECT id, name FROM crm_companies WHERE id=$1`, [companyId])).rows[0];
    if (!company) return res.status(404).json({ error: "Company not found" });
    const files = await expand((req.files as Express.Multer.File[]) || []);
    if (!files.length) return res.status(400).json({ error: "No files" });
    const source = String(req.body?.source || "KYC pack").slice(0, 80);
    const userId = (req.session as any)?.userId || (req as any).tokenUserId || null;
    const existing = new Set((await pool.query(`SELECT file_name FROM kyc_documents WHERE company_id=$1 AND deleted_at IS NULL`, [companyId])).rows.map((r: any) => String(r.file_name).toLowerCase()));

    const filed: Array<{ fileName: string; docType: PackDocType; skipped?: string }> = [];
    for (const f of files) {
      const cleanName = f.name.replace(/^[0-9a-f]{8}-/i, "");
      const docType = classifyPackFile(cleanName);
      if (existing.has(cleanName.toLowerCase())) { filed.push({ fileName: cleanName, docType, skipped: "already on file" }); continue; }
      const key = `chat-media/${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${cleanName.replace(/[^a-zA-Z0-9_.\-]/g, "_")}`;
      await saveFile(key, f.buffer, f.mime, cleanName);
      await pool.query(
        `INSERT INTO kyc_documents (company_id, deal_id, doc_type, file_url, file_name, file_size, mime_type, notes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [companyId, req.body?.dealId || null, docType, `/api/chat-media/${key.slice("chat-media/".length)}`, cleanName, f.buffer.length, f.mime, `From ${source}`, userId]);
      existing.add(cleanName.toLowerCase());
      filed.push({ fileName: cleanName, docType });
    }

    // A KYC4U workbook is the filled-in form itself — import it into the
    // app's KYC form (manual edits are never overwritten).
    let formImported: string | null = null;
    for (const f of files) {
      if (!/\.xlsx$/i.test(f.name) || classifyPackFile(f.name) !== "kyc_form") continue;
      try {
        const { importKyc4uForm } = await import("./aml-cdd-form");
        if (await importKyc4uForm(companyId, f.buffer, f.name.replace(/^[0-9a-f]{8}-/i, ""))) { formImported = f.name.replace(/^[0-9a-f]{8}-/i, ""); break; }
      } catch (e: any) { console.warn(`[kyc-pack] form import ${f.name}: ${e?.message}`); }
    }

    const allTypes = (await pool.query(`SELECT doc_type FROM kyc_documents WHERE company_id=$1 AND deleted_at IS NULL`, [companyId])).rows.map((r: any) => r.doc_type as PackDocType);
    const evidence = packEvidence(allTypes);
    const { tickChecklistItems } = await import("./kyc-orchestrator");
    const ticked = await tickChecklistItems(companyId, Object.fromEntries(Object.entries(evidence).map(([key, types]) => [key, {
      source: "kyc_pack" as any, tickedBy: userId,
      evidence: { documents: types, source },
      notes: `Evidence on file from ${source} (${types.join(", ").replace(/_/g, " ")}) — MLRO to confirm`,
    }])));
    await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'kyc_pack_filed', $2, $3)`,
      [companyId, userId, `${filed.filter(f => !f.skipped).length} documents filed from ${source}; evidence for: ${Object.keys(evidence).join(", ") || "none"}`]).catch(() => {});
    res.json({ company: company.name, filed, ticked, evidence: Object.keys(evidence), formImported });
  } catch (err: any) {
    console.error("[kyc-pack] error:", err?.message);
    res.status(500).json({ error: err?.message || "Pack upload failed" });
  }
});

export default router;
