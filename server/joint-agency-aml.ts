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
// A letting at this rent or more is letting agency work under the money
// laundering regulations (HMRC, AMLG2300): £10,000 a month.
const LETTING_SCOPE_PA = 120_000;

/**
 * The note's paragraphs, in order: title, facts, statement, sign-off.
 * The statement follows HMRC (Woody, 22 November 2026: "We have to do what
 * HMRC say"). HMRC's letting guidance has no joint agent exception ("LABs
 * must verify that all parties to the rental agreement are who they say they
 * are", AMLG2300): at £10,000 a month or more the tenant is verified, by BGP
 * or through the co-agent's checks under a reliance agreement (MLR 2017 reg
 * 39). Under that, the letting is outside the customer due diligence the
 * regulations require of letting agents, and sanctions checks still apply.
 * Until 22 November 2026 every note said BGP had formed no business
 * relationship with the tenant and no CDD was required (Jack's note of
 * 11 November, from BGP's internal note on joint agency of 2 November 2026).
 */
export function jointAgencyNoteParagraphs(f: JointAgencyFacts, signedBy: string, on: Date): string[] {
  const date = longDate(on);
  const role = `BGP was instructed with ${f.coAgent} as joint sole agents on this transaction under separate terms of engagement with the client. ${f.coAgent} is registered with HMRC for anti-money laundering supervision. The ${f.tenant}, was introduced by ${f.coAgent}, and ${f.coAgent} managed all dealings and negotiations with them. BGP's role was limited to advising our client. BGP did not introduce the counterparty, did not negotiate with or act as go-between with them, and did not take over the transaction from ${f.coAgent}.`;
  const checks = f.rentPa >= LETTING_SCOPE_PA
    ? `HMRC's guidance for letting agents (AMLG2300) requires every party to a letting at £10,000 a month or more to be verified, with no exception where a joint agent found the tenant. BGP therefore relies on ${f.coAgent}'s customer due diligence on the ${f.tenant} under a reliance agreement (Money Laundering Regulations 2017, regulation 39), or checks the ${f.tenant} itself, and records which on the transaction. BGP remains responsible for those checks.`
    : `The rent is under £10,000 a month, so the letting is outside the customer due diligence the Money Laundering Regulations 2017 require of letting agents (HMRC, AMLG2300). Every party is still screened against the UK sanctions list.`;
  return [
    "AML file note: joint sole agency",
    `Property: ${f.property}. Client: ${f.client}. Co-agent: ${f.coAgent}. Transaction: letting at ${pounds(f.rentPa)} per annum. Tenant: ${f.tenant}`,
    `${role} ${checks} The transaction was recorded at heads of terms stage and this position was confirmed at that point. No knowledge or suspicion of money laundering arose on this transaction.`,
    `Signed: ${signedBy}, ${date}. Reviewed: ${JOINT_AGENCY_REVIEWER}, ${date}.`,
  ];
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
  // Saving a note is retired by Issue 4 of BGP's AML policy (23 November 2026;
  // Woody: "this joint agent thing isnt allowed anymore we are sending them an
  // email instead?"): the other side of a joint instruction is always checked,
  // so no new note may say it needs none. Notes saved before stay readable.
  app.post("/api/crm/deals/:id/joint-agency-note", requireAuth, (_req: Request, res: Response) => {
    res.status(410).json({ message: "No longer used: under Issue 4 of BGP's AML policy the other side of a joint instruction is checked. Ask the joint agent for their documents from Parties & AML." });
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
