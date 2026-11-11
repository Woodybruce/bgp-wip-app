// AML file note: joint sole agency (Jack, 2026-11-11).
//
// When BGP is joint agent on a deal and the co-agent introduced and dealt
// with the counterparty, BGP forms no business relationship with that
// counterparty and no CDD on them is required — but the position has to be
// written down against the deal, so it can be produced if HMRC audit. The
// agent flags the deal "Joint Agency Lead Deal" on the New Deal form, the
// five facts (property, client, co-agent, transaction, tenant) come from
// the heads of terms or are typed in, and the note below is saved.
//
// The wording is Jack's file note of 11 Nov 2026, word for word; only the
// bracketed facts change. Signed: the agent who saved it. Reviewed: Jack
// Barratt, stamped at the moment of saving (Jack's instruction).
//
// Kept as deal_events rows (event_type 'joint_agency_aml_note') — the
// append-only deal history — with the facts and the full text frozen in the
// payload. A corrected note is a new row; the earlier one stays. The
// register lists every one; each downloads as a Word file.
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";

export const JOINT_AGENCY_EVENT = "joint_agency_aml_note";
export const JOINT_AGENCY_REVIEWER = "Jack Barratt";
const POLICY_NOTE_DATE = "2 November 2026";

export interface JointAgencyFacts {
  property: string;
  client: string;
  coAgent: string;
  /** Annual rent in pounds, for "letting at £x per annum". */
  rentPa: number;
  tenant: string;
}

const pounds = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const longDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

/** The note's paragraphs, in order: title, facts, statement, sign-off. */
export function jointAgencyNoteParagraphs(f: JointAgencyFacts, signedBy: string, on: Date): string[] {
  const date = longDate(on);
  return [
    "AML file note: joint sole agency",
    `Property: ${f.property}. Client: ${f.client}. Co-agent: ${f.coAgent}. Transaction: letting at ${pounds(f.rentPa)} per annum. Tenant: ${f.tenant}`,
    `BGP was instructed with ${f.coAgent} as joint sole agents on this transaction under separate terms of engagement with the client. ${f.coAgent} is registered with HMRC for anti-money laundering supervision. The ${f.tenant}, was introduced by ${f.coAgent}, and ${f.coAgent} managed all dealings and negotiations with them. BGP's role was limited to advising our client. BGP did not introduce the counterparty, did not negotiate with or act as go-between with them, and did not take over the transaction from ${f.coAgent}. In accordance with BGP's internal note on joint agency instructions dated ${POLICY_NOTE_DATE}, BGP has therefore not formed a business relationship with the counterparty, and no CDD was required in respect of them. The transaction was recorded at heads of terms stage and this position was confirmed at that point. No knowledge or suspicion of money laundering arose on this transaction.`,
    `Signed: ${signedBy}, ${date}. Reviewed: ${JOINT_AGENCY_REVIEWER}, ${date}.`,
  ];
}

function readFacts(body: any): { facts?: JointAgencyFacts; missing: string[] } {
  const text = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().replace(/\.$/, "");
  const rent = typeof body?.rentPa === "number" ? body.rentPa : parseFloat(String(body?.rentPa ?? "").replace(/[£,\s]/g, ""));
  const facts = { property: text(body?.property), client: text(body?.client), coAgent: text(body?.coAgent), rentPa: rent, tenant: text(body?.tenant) };
  const missing: string[] = [];
  if (!facts.property) missing.push("property");
  if (!facts.client) missing.push("client");
  if (!facts.coAgent) missing.push("coAgent");
  if (!(Number.isFinite(facts.rentPa) && facts.rentPa > 0)) missing.push("rentPa");
  if (!facts.tenant) missing.push("tenant");
  return missing.length ? { missing } : { facts, missing };
}

const isClient = async (req: Request) => (await import("./company-scope")).isClientRequestUser(req);

async function noteDocx(paragraphs: string[]): Promise<Buffer> {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const doc = new Document({
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{
      children: paragraphs.map((p, i) => new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: p, bold: i === 0, size: i === 0 ? 28 : 22 })],
      })),
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export function registerJointAgencyAmlRoutes(app: Express): void {
  /** Save the note against a deal. All five facts are required. */
  app.post("/api/crm/deals/:id/joint-agency-note", requireAuth, async (req: Request, res: Response) => {
    try {
      if (await isClient(req)) return res.status(403).json({ message: "Not available for client accounts" });
      const dealId = String(req.params.id);
      const { rows: [deal] } = await pool.query(`SELECT id, name FROM crm_deals WHERE id = $1`, [dealId]);
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      const { facts, missing } = readFacts(req.body);
      if (!facts) return res.status(400).json({ message: "The joint agency note needs every detail filled in", missing });
      const userId = (req as any).session?.userId || (req as any).tokenUserId || null;
      const { rows: [user] } = userId ? await pool.query(`SELECT name FROM users WHERE id = $1`, [userId]) : { rows: [] as any[] };
      const signedBy = String(user?.name || "").trim();
      if (!signedBy) return res.status(400).json({ message: "Couldn't tell who is signing the note — sign in again and retry" });
      const now = new Date();
      const paragraphs = jointAgencyNoteParagraphs(facts, signedBy, now);
      const payload = {
        ...facts,
        signedBy,
        signedAt: now.toISOString(),
        reviewedBy: JOINT_AGENCY_REVIEWER,
        reviewedAt: now.toISOString(),
        source: req.body?.hotsFileName ? "heads of terms" : "entered by the agent",
        hotsFileName: req.body?.hotsFileName ? String(req.body.hotsFileName).slice(0, 200) : null,
        paragraphs,
      };
      const { rows: [row] } = await pool.query(
        `INSERT INTO deal_events (deal_id, event_type, payload, actor_id, actor_name) VALUES ($1, $2, $3, $4, $5) RETURNING id, occurred_at`,
        [dealId, JOINT_AGENCY_EVENT, JSON.stringify(payload), userId, signedBy],
      );
      return res.json({ id: row.id, dealId, savedAt: row.occurred_at, ...payload });
    } catch (e: any) {
      console.error("[joint-agency-aml] save failed:", e?.message);
      return res.status(500).json({ message: e?.message || "Couldn't save the note" });
    }
  });

  /** The notes on one deal, newest first (the first is the current one). */
  app.get("/api/crm/deals/:id/joint-agency-note", requireAuth, async (req: Request, res: Response) => {
    try {
      if (await isClient(req)) return res.status(403).json({ message: "Not available for client accounts" });
      const { rows } = await pool.query(
        `SELECT id, occurred_at AS "savedAt", payload FROM deal_events WHERE deal_id = $1 AND event_type = $2 ORDER BY occurred_at DESC`,
        [String(req.params.id), JOINT_AGENCY_EVENT],
      );
      return res.json(rows.map((r: any) => ({ id: r.id, savedAt: r.savedAt, ...(r.payload || {}) })));
    } catch (e: any) {
      return res.status(500).json({ message: e?.message || "Couldn't load the note" });
    }
  });

  /** The register: every joint agency note, for an HMRC audit. */
  app.get("/api/joint-agency-notes", requireAuth, async (req: Request, res: Response) => {
    try {
      if (await isClient(req)) return res.status(403).json({ message: "Not available for client accounts" });
      const { rows } = await pool.query(
        `SELECT e.id, e.deal_id AS "dealId", e.occurred_at AS "savedAt", e.payload, d.name AS "dealName", d.deal_ref AS "dealRef"
           FROM deal_events e LEFT JOIN crm_deals d ON d.id = e.deal_id
          WHERE e.event_type = $1 ORDER BY e.occurred_at DESC`,
        [JOINT_AGENCY_EVENT],
      );
      return res.json(rows.map((r: any) => ({ id: r.id, dealId: r.dealId, dealName: r.dealName, dealRef: r.dealRef, savedAt: r.savedAt, ...(r.payload || {}) })));
    } catch (e: any) {
      return res.status(500).json({ message: e?.message || "Couldn't load the register" });
    }
  });

  /** One note as a Word file, exactly as saved. */
  app.get("/api/joint-agency-notes/:id/docx", requireAuth, async (req: Request, res: Response) => {
    try {
      if (await isClient(req)) return res.status(403).json({ message: "Not available for client accounts" });
      const { rows: [r] } = await pool.query(
        `SELECT e.payload, e.occurred_at, d.deal_ref FROM deal_events e LEFT JOIN crm_deals d ON d.id = e.deal_id WHERE e.id = $1 AND e.event_type = $2`,
        [String(req.params.id), JOINT_AGENCY_EVENT],
      );
      if (!r) return res.status(404).json({ message: "Note not found" });
      const paragraphs: string[] = Array.isArray(r.payload?.paragraphs) ? r.payload.paragraphs : [];
      const buffer = await noteDocx(paragraphs);
      const name = `AML file note - joint agency - ${String(r.payload?.property || "deal").replace(/[^\w ,.-]+/g, " ").slice(0, 60).trim()}${r.deal_ref ? ` - Ref ${r.deal_ref}` : ""}.docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
      return res.end(buffer);
    } catch (e: any) {
      return res.status(500).json({ message: e?.message || "Couldn't build the Word file" });
    }
  });
}
