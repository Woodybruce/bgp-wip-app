// Heads of terms before HOTs or Solicitors, on every transaction (Jack,
// 26 November 2026: "Lets add this block to these as well, as AML checks
// should start earlier in the deal but absolutely minimum once the deal is at
// HOTs stage"). The Letting Tracker's own block is in the unit PATCH
// (server/routes.ts); this is the same rule for the transaction save, which
// the Transactions table, the Edit form and ChatBGP all go through, and for
// the bulk status change.
//
// Heads of terms are "on" a transaction when its Letting Tracker unit holds
// them (the final agreed file, or the ones drawn up and issued in the app), or
// when a file was added to the transaction itself (deal_hots_files, for a
// transaction with no tracker unit: a sale, a purchase, a tenant-side letting).
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { hotsGateApplies } from "../shared/deal-hots-gate";

export { hotsGateApplies };

type Db = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> };

export interface DealHotsOnFile { onFile: boolean; where: "unit" | "transaction" | null; fileName: string | null; unitId: string | null }

/** Where the transaction's heads of terms are, and the tracker unit a new file would be filed on. */
export async function dealHotsOnFile(db: Db, dealId: string): Promise<DealHotsOnFile> {
  const unit = (await db.query(
    `SELECT au.id, au.hots_final_file_id, au.hots_issued_at, f.file_name
       FROM available_units au LEFT JOIN unit_marketing_files f ON f.id = au.hots_final_file_id AND f.unit_id = au.id
      WHERE au.deal_id = $1
      ORDER BY (au.hots_final_file_id IS NOT NULL OR au.hots_issued_at IS NOT NULL) DESC, au.updated_at DESC NULLS LAST LIMIT 1`, [dealId])).rows[0];
  if (unit && (unit.hots_final_file_id || unit.hots_issued_at)) {
    return { onFile: true, where: "unit", fileName: unit.file_name ? String(unit.file_name) : null, unitId: String(unit.id) };
  }
  const own = (await db.query(`SELECT file_name FROM deal_hots_files WHERE deal_id = $1 ORDER BY added_at DESC LIMIT 1`, [dealId])).rows[0];
  if (own) return { onFile: true, where: "transaction", fileName: String(own.file_name || ""), unitId: unit ? String(unit.id) : null };
  return { onFile: false, where: null, fileName: null, unitId: unit ? String(unit.id) : null };
}

export const HOTS_REQUIRED_CODE = "HOTS_REQUIRED";
export const hotsRequiredWords = (to: "HOT" | "SOL") =>
  `Add the heads of terms first: the transaction moves to ${to === "HOT" ? "HOTs" : "Solicitors"} once they are on it.`;

/** The refusal for a move to HOTs or Solicitors with no heads of terms on the transaction, or null. */
export async function hotsRequiredDenial(db: Db, deal: { id: string; status?: string | null; dealType?: string | null }, toRaw: string | null | undefined): Promise<{ status: number; error: string; code: string } | null> {
  const to = hotsGateApplies(deal.status, toRaw, deal.dealType);
  if (!to) return null;
  if ((await dealHotsOnFile(db, deal.id)).onFile) return null;
  return { status: 409, error: hotsRequiredWords(to), code: HOTS_REQUIRED_CODE };
}

// ── Routes ──────────────────────────────────────────────────────────────────

const STAFF_ONLY = "BGP staff only, signed in as themselves.";
const MAX_MB = 25;
const EXT = /\.(pdf|docx)$/i;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } });

async function staffMe(req: Request): Promise<{ id: string; name: string | null } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const { pool } = await import("./db");
  const u = (await pool.query(`SELECT id, name, email FROM users WHERE id = $1`, [userId])).rows[0];
  return u ? { id: String(u.id), name: String(u.name || u.email || "") || null } : null;
}

export const dealHotsGateRouter = Router();

dealHotsGateRouter.get("/api/deals/:id/heads-of-terms/on-file", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: STAFF_ONLY });
    const { pool } = await import("./db");
    res.json(await dealHotsOnFile(pool, String(req.params.id)));
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not check the heads of terms" });
  }
});

// The heads of terms of a transaction with no Letting Tracker unit. One on a
// tracker unit is filed there (POST /api/unit-hots/:unitId/final).
dealHotsGateRouter.post("/api/deals/:id/heads-of-terms/file", (req: Request, res: Response, next) => {
  // Who may add is decided before the file is taken.
  staffMe(req).then(me => {
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    (req as any).hotsMe = me;
    upload.single("file")(req, res, (err: any) => {
      if (err) return res.status(400).json({ message: err?.code === "LIMIT_FILE_SIZE" ? `The file is over ${MAX_MB}MB.` : "The file could not be taken." });
      next();
    });
  }).catch(e => res.status(500).json({ message: e?.message || "Could not add the heads of terms" }));
}, async (req: Request, res: Response) => {
  try {
    const me = (req as any).hotsMe as { id: string; name: string | null };
    const file = (req as any).file as { buffer: Buffer; mimetype: string; originalname: string; size: number } | undefined;
    if (!file?.size) return res.status(400).json({ message: "Choose the heads of terms (PDF or Word)." });
    if (!EXT.test(file.originalname || "")) return res.status(400).json({ message: "Add the heads of terms as a PDF or a Word document (.docx)." });
    const { pool } = await import("./db");
    const dealId = String(req.params.id);
    const deal = (await pool.query(`SELECT id FROM crm_deals WHERE id = $1`, [dealId])).rows[0];
    if (!deal) return res.status(404).json({ message: "Transaction not found" });
    const { saveFile } = await import("./file-storage");
    const key = `deal-hots/${dealId}/${randomUUID()}${(file.originalname.match(EXT) || [""])[0].toLowerCase()}`;
    await saveFile(key, file.buffer, file.mimetype || "application/octet-stream", file.originalname);
    await pool.query(
      `INSERT INTO deal_hots_files (deal_id, file_name, storage_key, mime, size, added_by, added_by_name) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [dealId, file.originalname.slice(0, 300), key, file.mimetype || null, file.size, me.id, me.name]);
    await pool.query(
      `INSERT INTO deal_audit_log (deal_id, field, old_value, new_value, reason, changed_by, changed_by_name) VALUES ($1, 'heads_of_terms', NULL, $2, 'Heads of terms added', $3, $4)`,
      [dealId, file.originalname.slice(0, 300), me.id, me.name]).catch(() => {});
    res.json(await dealHotsOnFile(pool, dealId));
  } catch (err: any) {
    console.warn(`[deal-hots-gate] file failed: ${err?.message}`);
    res.status(500).json({ message: "The heads of terms could not be saved. Try again." });
  }
});

dealHotsGateRouter.get("/api/deals/:id/heads-of-terms/file", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: STAFF_ONLY });
    const { pool } = await import("./db");
    const row = (await pool.query(`SELECT file_name, storage_key FROM deal_hots_files WHERE deal_id = $1 ORDER BY added_at DESC LIMIT 1`, [String(req.params.id)])).rows[0];
    if (!row) return res.status(404).json({ message: "No heads of terms on this transaction" });
    const { getFile } = await import("./file-storage");
    const got = await getFile(String(row.storage_key));
    if (!got) return res.status(404).json({ message: "The file is no longer in the store" });
    res.setHeader("Content-Type", got.contentType || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${String(row.file_name || "heads-of-terms").replace(/[^\w.\- ]+/g, "_")}"`);
    res.send(got.data);
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not open the heads of terms" });
  }
});
