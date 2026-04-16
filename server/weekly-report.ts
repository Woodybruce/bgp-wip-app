// ─────────────────────────────────────────────────────────────────────────
// Weekly client report.
//
// For each opted-in client contact (crm_contacts.weekly_report_enabled=true),
// compile a PDF summarising the week's movement on the deals they're a
// client on, then email it via the shared mailbox.
//
// Triggered Monday 09:00 by cron; also exposed for preview + manual send.
//
//   GET  /api/weekly-report/:contactId.pdf     — preview PDF
//   POST /api/weekly-report/:contactId/send    — send right now (even if not opted in)
//   PATCH /api/weekly-report/:contactId/toggle — flip weekly_report_enabled
//   GET  /api/weekly-report/recipients         — list who's opted in + last sent
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import * as path from "path";
import * as fs from "fs";
import { sendSharedMailboxEmail } from "./shared-mailbox";

const router = Router();
const BGP_GREEN = "#2E5E3F";
const BGP_DARK_GREEN = "#1A3A28";

async function loadContact(contactId: string) {
  const q = await pool.query(
    `SELECT c.id, c.name, c.email, c.company_id, c.company_name, c.weekly_report_enabled, c.weekly_report_last_sent_at,
            co.name AS resolved_company_name
       FROM crm_contacts c
       LEFT JOIN crm_companies co ON co.id = c.company_id
      WHERE c.id = $1`,
    [contactId]
  );
  return q.rows[0] || null;
}

async function loadClientActivity(contactId: string, sinceDays = 7) {
  // All deals where this contact is the client contact
  const dealsQ = pool.query(
    `SELECT d.id, d.name, d.stage, d.status, d.deal_type, d.pricing, d.rent_pa, d.completion_date,
            d.updated_at, d.hots_completed_at,
            p.name AS property_name, p.address AS property_address,
            lc.name AS landlord_name, tc.name AS tenant_name, vc.name AS vendor_name, pc.name AS purchaser_name
       FROM crm_deals d
       LEFT JOIN crm_properties p ON p.id = d.property_id
       LEFT JOIN crm_companies lc ON lc.id = d.landlord_id
       LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
       LEFT JOIN crm_companies vc ON vc.id = d.vendor_id
       LEFT JOIN crm_companies pc ON pc.id = d.purchaser_id
      WHERE d.client_contact_id = $1
      ORDER BY d.updated_at DESC NULLS LAST`,
    [contactId]
  );
  const [deals] = await Promise.all([dealsQ]);
  if (!deals.rows.length) return { deals: [], recentEvents: [], weekWindow: { since: new Date(Date.now() - sinceDays * 86400000), until: new Date() } };

  const dealIds = deals.rows.map(r => r.id);
  const since = new Date(Date.now() - sinceDays * 86400000);
  const eventsQ = await pool.query(
    `SELECT deal_id, event_type, from_stage, to_stage, payload, actor_name, occurred_at
       FROM deal_events
      WHERE deal_id = ANY($1::varchar[]) AND occurred_at >= $2
      ORDER BY occurred_at DESC`,
    [dealIds, since]
  );
  return { deals: deals.rows, recentEvents: eventsQ.rows, weekWindow: { since, until: new Date() } };
}

// ─── PDF rendering ────────────────────────────────────────────────────────

async function renderWeeklyReportPdf(contact: any, activity: any): Promise<Buffer> {
  // @ts-ignore — pdfkit has no d.ts
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 60, bottom: 60, left: 50, right: 50 },
    info: { Title: `Weekly Update — ${contact.resolved_company_name || contact.company_name || contact.name}`, Author: "Bruce Gillingham Pollard" },
    bufferPages: true,
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const pageW = 495;
  const leftM = 50;
  const logoPath = path.join(process.cwd(), "server", "assets", "branding", "BGP_BlackWordmark.png");
  const logoExists = fs.existsSync(logoPath);

  doc.rect(0, 0, 595, 8).fill(BGP_GREEN);
  if (logoExists) { try { doc.image(logoPath, leftM, 18, { width: 70 }); } catch {} }
  doc.fontSize(7).fillColor("#666").text("WEEKLY UPDATE", leftM, 16, { align: "right", width: pageW });
  doc.fontSize(6).fillColor("#888").text(new Date(activity.weekWindow.until).toLocaleDateString("en-GB"), leftM, 27, { align: "right", width: pageW });

  let y = 55;
  doc.rect(leftM, y, pageW, 2).fill(BGP_GREEN); y += 12;
  doc.font("Helvetica-Bold").fontSize(22).fillColor(BGP_DARK_GREEN)
    .text(`Weekly update`, leftM, y, { width: pageW });
  y = doc.y + 2;
  const window = `${new Date(activity.weekWindow.since).toLocaleDateString("en-GB")} – ${new Date(activity.weekWindow.until).toLocaleDateString("en-GB")}`;
  doc.font("Helvetica").fontSize(9).fillColor("#888").text(window, leftM, y);
  y = doc.y + 4;
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#333").text(`For ${contact.name}${contact.resolved_company_name || contact.company_name ? ` — ${contact.resolved_company_name || contact.company_name}` : ""}`, leftM, y, { width: pageW });
  y = doc.y + 10;

  // Headline summary
  const activeCount = activity.deals.filter((d: any) => d.status !== "completed" && d.status !== "lost").length;
  const eventsThisWeek = activity.recentEvents.length;
  doc.rect(leftM, y, pageW, 50).fill("#F4F7F5");
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#888").text("ACTIVE DEALS", leftM + 10, y + 10);
  doc.font("Helvetica-Bold").fontSize(18).fillColor(BGP_DARK_GREEN).text(String(activeCount), leftM + 10, y + 22);
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#888").text("EVENTS THIS WEEK", leftM + pageW / 2, y + 10);
  doc.font("Helvetica-Bold").fontSize(18).fillColor(BGP_DARK_GREEN).text(String(eventsThisWeek), leftM + pageW / 2, y + 22);
  y += 58;

  // Movement
  if (activity.recentEvents.length) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(BGP_GREEN).text("THIS WEEK'S MOVEMENT", leftM, y);
    y = doc.y + 6;
    const dealNameById = new Map(activity.deals.map((d: any) => [d.id, d.name]));
    for (const e of activity.recentEvents) {
      if (y > 770) { doc.addPage(); y = 60; }
      const dealName = dealNameById.get(e.deal_id) || "Unknown deal";
      const label = e.event_type === "stage_change"
        ? `${dealName}: ${e.from_stage || "?"} → ${e.to_stage || "?"}`
        : `${dealName}: ${e.event_type.replace(/_/g, " ")}`;
      const dateStr = new Date(e.occurred_at).toLocaleDateString("en-GB");
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#333").text(label, leftM, y, { width: pageW });
      y = doc.y + 1;
      doc.font("Helvetica").fontSize(8).fillColor("#888").text(`${dateStr}${e.actor_name ? ` · ${e.actor_name}` : ""}`, leftM, y);
      y = doc.y + 4;
    }
    y += 6;
  } else {
    doc.font("Helvetica-Oblique").fontSize(10).fillColor("#777").text("No logged movement this week.", leftM, y, { width: pageW });
    y = doc.y + 10;
  }

  // Active deals list
  if (activity.deals.length) {
    if (y > 700) { doc.addPage(); y = 60; }
    doc.font("Helvetica-Bold").fontSize(10).fillColor(BGP_GREEN).text("ACTIVE DEALS", leftM, y);
    y = doc.y + 6;
    for (const d of activity.deals) {
      if (y > 770) { doc.addPage(); y = 60; }
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#222").text(d.name, leftM, y, { width: pageW });
      y = doc.y + 1;
      const meta: string[] = [];
      if (d.property_name) meta.push(d.property_name);
      if (d.stage) meta.push(`Stage: ${d.stage.replace(/_/g, " ")}`);
      if (d.rent_pa) meta.push(`£${Number(d.rent_pa).toLocaleString()} pa`);
      else if (d.pricing) meta.push(`£${Number(d.pricing).toLocaleString()}`);
      if (d.tenant_name) meta.push(`Tenant: ${d.tenant_name}`);
      if (d.vendor_name || d.purchaser_name) meta.push(`Purchaser: ${d.purchaser_name || "—"}`);
      doc.font("Helvetica").fontSize(8.5).fillColor("#666").text(meta.join("  ·  "), leftM, y, { width: pageW });
      y = doc.y + 6;
    }
  }

  // Footer
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font("Helvetica").fontSize(6.5).fillColor("#999")
      .text(`Weekly Update — Bruce Gillingham Pollard — Confidential`, leftM, 810, { width: pageW, align: "center" });
  }

  doc.end();
  await new Promise<void>((resolve) => doc.on("end", () => resolve()));
  return Buffer.concat(chunks);
}

// ─── Endpoints ───────────────────────────────────────────────────────────

router.get("/api/weekly-report/:contactId.pdf", requireAuth, async (req, res) => {
  try {
    const contact = await loadContact(String(req.params.contactId));
    if (!contact) return res.status(404).json({ error: "Contact not found" });
    const activity = await loadClientActivity(contact.id);
    const pdf = await renderWeeklyReportPdf(contact, activity);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="weekly-report-${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    console.error("[weekly-report] error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/weekly-report/:contactId/send", requireAuth, async (req, res) => {
  try {
    const contact = await loadContact(String(req.params.contactId));
    if (!contact) return res.status(404).json({ error: "Contact not found" });
    if (!contact.email) return res.status(400).json({ error: "Contact has no email" });

    const activity = await loadClientActivity(contact.id);
    const pdf = await renderWeeklyReportPdf(contact, activity);
    const firstName = (contact.name || "").split(/\s+/)[0];
    const body = `
      <p>Hi ${firstName || "there"},</p>
      <p>Your weekly update for the week ending ${new Date().toLocaleDateString("en-GB")} is attached as a PDF.</p>
      <p>As ever, please let us know if there is anything you'd like us to prioritise.</p>
      <p>Kind regards,<br/>Bruce Gillingham Pollard</p>
    `;

    await sendSharedMailboxEmail({
      to: contact.email,
      subject: `Weekly update — ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
      body,
      attachments: [{
        name: `weekly-update-${new Date().toISOString().slice(0, 10)}.pdf`,
        contentType: "application/pdf",
        contentBytes: pdf.toString("base64"),
      }],
    });

    await pool.query(`UPDATE crm_contacts SET weekly_report_last_sent_at = now() WHERE id = $1`, [contact.id]);
    res.json({ ok: true, sent_to: contact.email });
  } catch (err: any) {
    console.error("[weekly-report] send error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/weekly-report/:contactId/toggle", requireAuth, async (req: Request, res: Response) => {
  try {
    const enabled = !!(req.body?.enabled);
    await pool.query(`UPDATE crm_contacts SET weekly_report_enabled = $1 WHERE id = $2`, [enabled, req.params.contactId]);
    res.json({ ok: true, enabled });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/weekly-report/recipients", requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.email, c.weekly_report_last_sent_at, co.name AS company_name
         FROM crm_contacts c
         LEFT JOIN crm_companies co ON co.id = c.company_id
        WHERE c.weekly_report_enabled = true
        ORDER BY c.weekly_report_last_sent_at ASC NULLS FIRST`
    );
    res.json({ recipients: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Cron ───────────────────────────────────────────────────────────────

export async function runWeeklyClientReports() {
  const { rows: recipients } = await pool.query(
    `SELECT id, name, email FROM crm_contacts
      WHERE weekly_report_enabled = true AND email IS NOT NULL AND email != ''`
  );
  if (!recipients.length) {
    console.log("[weekly-report] no opted-in recipients");
    return;
  }
  console.log(`[weekly-report] sending to ${recipients.length} clients`);
  let ok = 0, failed = 0;
  for (const r of recipients) {
    try {
      const contact = await loadContact(r.id);
      if (!contact) { failed++; continue; }
      const activity = await loadClientActivity(contact.id);
      // Skip if there's literally zero to report, unless it's been >14 days since we sent
      const lastSent = contact.weekly_report_last_sent_at ? new Date(contact.weekly_report_last_sent_at).getTime() : 0;
      const fortnightAgo = Date.now() - 14 * 86400000;
      if (activity.deals.length === 0 && activity.recentEvents.length === 0 && lastSent > fortnightAgo) {
        continue;
      }
      const pdf = await renderWeeklyReportPdf(contact, activity);
      const firstName = (contact.name || "").split(/\s+/)[0];
      await sendSharedMailboxEmail({
        to: contact.email,
        subject: `Weekly update — ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
        body: `<p>Hi ${firstName || "there"},</p><p>Your weekly update is attached.</p><p>Kind regards,<br/>Bruce Gillingham Pollard</p>`,
        attachments: [{
          name: `weekly-update-${new Date().toISOString().slice(0, 10)}.pdf`,
          contentType: "application/pdf",
          contentBytes: pdf.toString("base64"),
        }],
      });
      await pool.query(`UPDATE crm_contacts SET weekly_report_last_sent_at = now() WHERE id = $1`, [contact.id]);
      ok++;
    } catch (e: any) {
      console.error(`[weekly-report] failed for ${r.email}:`, e?.message);
      failed++;
    }
  }
  console.log(`[weekly-report] done — ${ok} sent, ${failed} failed`);
}

export default router;
