// ─────────────────────────────────────────────────────────────────────────
// Deal-centric document endpoints.
//
// Every deal produces a standard set of documents as it moves through
// stages. This router owns the data-shaping + PDF rendering for them:
//
//   GET  /api/deal/:dealId/doc-data           — JSON snapshot (header, property,
//                                                parties, latest HoTs)
//   POST /api/deal/:dealId/hots               — create/update HoTs record,
//                                                emits dealEvents "hots_version"
//   GET  /api/deal/:dealId/hots.pdf           — latest HoTs rendered as PDF
//   GET  /api/deal/:dealId/offer-summary.pdf  — offer summary PDF
//   GET  /api/deal/:dealId/completion.pdf     — completion report PDF
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import * as path from "path";
import * as fs from "fs";

const router = Router();
const BGP_GREEN = "#2E5E3F";
const BGP_DARK_GREEN = "#1A3A28";

async function loadDealSnapshot(dealId: string) {
  const dealQ = pool.query(
    `SELECT d.*,
            p.name AS property_name, p.address AS property_address, p.postcode AS property_postcode,
            lc.name AS landlord_name, lc.companies_house_number AS landlord_ch,
            tc.name AS tenant_name, tc.companies_house_number AS tenant_ch,
            vc.name AS vendor_name, pc.name AS purchaser_name
       FROM crm_deals d
       LEFT JOIN crm_properties p ON p.id = d.property_id
       LEFT JOIN crm_companies lc ON lc.id = d.landlord_id
       LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
       LEFT JOIN crm_companies vc ON vc.id = d.vendor_id
       LEFT JOIN crm_companies pc ON pc.id = d.purchaser_id
      WHERE d.id = $1`,
    [dealId]
  );
  const hotsQ = pool.query(
    `SELECT * FROM deal_hots WHERE deal_id = $1 ORDER BY version DESC LIMIT 1`,
    [dealId]
  );
  const eventsQ = pool.query(
    `SELECT event_type, from_stage, to_stage, actor_name, occurred_at
       FROM deal_events WHERE deal_id = $1 ORDER BY occurred_at DESC LIMIT 20`,
    [dealId]
  );
  const [deal, hots, events] = await Promise.all([dealQ, hotsQ, eventsQ]);
  return { deal: deal.rows[0] || null, hots: hots.rows[0] || null, events: events.rows };
}

router.get("/api/deal/:dealId/doc-data", requireAuth, async (req, res) => {
  try {
    const data = await loadDealSnapshot(String(req.params.dealId));
    if (!data.deal) return res.status(404).json({ error: "Deal not found" });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/deal/:dealId/hots", requireAuth, async (req: Request & { user?: any }, res) => {
  try {
    const dealId = String(req.params.dealId);
    const body = req.body || {};
    const fields = [
      "rent_pa", "term_years", "break_option", "rent_free_months", "fit_out_contribution",
      "deposit", "rent_review_mechanism", "use_class", "alienation", "repair_obligations",
      "aga_required", "schedule_of_condition", "notes", "status",
    ];
    // Get next version number
    const v = await pool.query(`SELECT COALESCE(MAX(version), 0) AS v FROM deal_hots WHERE deal_id = $1`, [dealId]);
    const nextVersion = (v.rows[0]?.v || 0) + 1;

    const cols = ["deal_id", "version"];
    const vals: any[] = [dealId, nextVersion];
    for (const f of fields) {
      const camel = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const val = f in body ? body[f] : (camel in body ? body[camel] : undefined);
      if (val !== undefined) {
        cols.push(f);
        vals.push(val);
      }
    }
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
    const r = await pool.query(
      `INSERT INTO deal_hots (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    // Audit
    await pool.query(
      `INSERT INTO deal_events (deal_id, event_type, payload, actor_id, actor_name)
       VALUES ($1, 'hots_version', $2, $3, $4)`,
      [dealId, JSON.stringify({ version: nextVersion, status: r.rows[0].status || "draft" }), req.user?.id || null, req.user?.name || null]
    );
    res.json(r.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PDF helpers ────────────────────────────────────────────────────────

function drawBgpHeader(doc: any, pageW: number, leftM: number, subtitle: string) {
  const logoPath = path.join(process.cwd(), "server", "assets", "branding", "BGP_BlackWordmark.png");
  const logoExists = fs.existsSync(logoPath);
  doc.rect(0, 0, 595, 8).fill(BGP_GREEN);
  if (logoExists) { try { doc.image(logoPath, leftM, 18, { width: 70 }); } catch {} }
  doc.fontSize(7).fillColor("#666").text(subtitle, leftM, 16, { align: "right", width: pageW });
  doc.fontSize(6).fillColor("#888").text(new Date().toLocaleDateString("en-GB"), leftM, 27, { align: "right", width: pageW });
}

function keyValue(doc: any, label: string, value: string | null | undefined, x: number, y: number, w: number) {
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#888").text(label.toUpperCase(), x, y, { width: w });
  doc.font("Helvetica").fontSize(10).fillColor("#222").text(value || "—", x, y + 11, { width: w });
  return y + 28;
}

function money(n: number | null | undefined, prefix = "£") {
  if (n == null) return null;
  return `${prefix}${Number(n).toLocaleString()}`;
}

// ─── HoTs PDF ───────────────────────────────────────────────────────────

router.get("/api/deal/:dealId/hots.pdf", requireAuth, async (req, res) => {
  try {
    const { deal, hots } = await loadDealSnapshot(String(req.params.dealId));
    if (!deal) return res.status(404).json({ error: "Deal not found" });

    // @ts-ignore — pdfkit ships without d.ts
    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 60, bottom: 60, left: 50, right: 50 },
      info: { Title: `Heads of Terms — ${deal.name}`, Author: "Bruce Gillingham Pollard", Creator: "BGP Dashboard" },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));

    const pageW = 495;
    const leftM = 50;

    drawBgpHeader(doc, pageW, leftM, "HEADS OF TERMS");

    let y = 55;
    doc.rect(leftM, y, pageW, 2).fill(BGP_GREEN);
    y += 12;
    doc.font("Helvetica-Bold").fontSize(20).fillColor(BGP_DARK_GREEN).text("Heads of Terms", leftM, y, { width: pageW });
    y = doc.y + 2;
    doc.font("Helvetica-Oblique").fontSize(9).fillColor("#888").text("Subject to contract and without prejudice", leftM, y, { width: pageW });
    y = doc.y + 4;
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#333").text(deal.property_name || deal.name, leftM, y, { width: pageW });
    y = doc.y + 2;
    if (deal.property_address) {
      doc.font("Helvetica").fontSize(10).fillColor("#555").text([deal.property_address, deal.property_postcode].filter(Boolean).join(", "), leftM, y, { width: pageW });
      y = doc.y + 6;
    }

    // Parties
    doc.rect(leftM, y + 4, pageW, 1).fill("#DDD");
    y += 14;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(BGP_GREEN).text("PARTIES", leftM, y);
    y = doc.y + 6;
    const halfW = (pageW - 12) / 2;
    const yLandlord = keyValue(doc, "Landlord", `${deal.landlord_name || "—"}${deal.landlord_ch ? ` (CH ${deal.landlord_ch})` : ""}`, leftM, y, halfW);
    keyValue(doc, "Tenant", `${deal.tenant_name || "—"}${deal.tenant_ch ? ` (CH ${deal.tenant_ch})` : ""}`, leftM + halfW + 12, y, halfW);
    y = yLandlord;

    // Commercial terms
    doc.rect(leftM, y + 4, pageW, 1).fill("#DDD");
    y += 14;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(BGP_GREEN).text("COMMERCIAL TERMS", leftM, y);
    y = doc.y + 6;
    const rentPa = hots?.rent_pa ?? deal.rent_pa;
    const termYears = hots?.term_years ?? deal.lease_length;
    const breakOpt = hots?.break_option || deal.break_option;
    const rentFree = hots?.rent_free_months ?? (deal.rent_free ? Number(deal.rent_free) : null);
    const fitOut = hots?.fit_out_contribution ?? deal.capital_contribution;
    const deposit = hots?.deposit;

    const grid = [
      { label: "Rent (pa)", v: money(rentPa) },
      { label: "Term", v: termYears ? `${termYears} years` : null },
      { label: "Break option", v: breakOpt },
      { label: "Rent free", v: rentFree != null ? `${rentFree} months` : null },
      { label: "Fit-out contribution", v: money(fitOut) },
      { label: "Deposit", v: money(deposit) },
      { label: "Rent review", v: hots?.rent_review_mechanism },
      { label: "Use class", v: hots?.use_class },
    ];
    const colW = (pageW - 24) / 3;
    for (let i = 0; i < grid.length; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = leftM + col * (colW + 12);
      const rowY = y + row * 30;
      keyValue(doc, grid[i].label, grid[i].v as any, x, rowY, colW);
    }
    y = y + Math.ceil(grid.length / 3) * 30 + 4;

    // Lease terms
    doc.rect(leftM, y + 4, pageW, 1).fill("#DDD");
    y += 14;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(BGP_GREEN).text("LEASE TERMS", leftM, y);
    y = doc.y + 6;
    const leaseTerms = [
      { label: "Alienation", v: hots?.alienation },
      { label: "Repair", v: hots?.repair_obligations },
      { label: "AGA required", v: hots?.aga_required ? "Yes" : (hots?.aga_required === false ? "No" : null) },
      { label: "Schedule of condition", v: hots?.schedule_of_condition ? "Yes" : (hots?.schedule_of_condition === false ? "No" : null) },
    ];
    for (const lt of leaseTerms) {
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#888").text(lt.label.toUpperCase(), leftM, y, { width: 160 });
      doc.font("Helvetica").fontSize(10).fillColor("#222").text(lt.v || "—", leftM + 160, y, { width: pageW - 160 });
      y = doc.y + 6;
    }

    if (hots?.notes) {
      y += 6;
      doc.rect(leftM, y, pageW, 1).fill("#DDD");
      y += 14;
      doc.font("Helvetica-Bold").fontSize(10).fillColor(BGP_GREEN).text("ADDITIONAL TERMS", leftM, y);
      y = doc.y + 6;
      doc.font("Helvetica").fontSize(10).fillColor("#333").text(hots.notes, leftM, y, { width: pageW, lineGap: 2 });
      y = doc.y + 8;
    }

    // Footer
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font("Helvetica").fontSize(6.5).fillColor("#999")
        .text(`Heads of Terms v${hots?.version || 1} — Subject to contract — Bruce Gillingham Pollard`, leftM, 810, { width: pageW, align: "center" });
    }

    doc.end();
    await new Promise<void>((resolve) => doc.on("end", () => resolve()));
    const pdfBuffer = Buffer.concat(chunks);

    // Audit: mark a doc-generated event on the deal
    try {
      await pool.query(
        `INSERT INTO deal_events (deal_id, event_type, payload) VALUES ($1, 'doc_generated', $2)`,
        [deal.id, JSON.stringify({ kind: "hots", version: hots?.version || null })]
      );
    } catch {}

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="hots-${String(deal.name || "deal").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf"`);
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error("[hots-pdf] error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Offer Summary PDF ─────────────────────────────────────────────────

router.get("/api/deal/:dealId/offer-summary.pdf", requireAuth, async (req, res) => {
  try {
    const { deal } = await loadDealSnapshot(String(req.params.dealId));
    if (!deal) return res.status(404).json({ error: "Deal not found" });

    // @ts-ignore — pdfkit ships without d.ts
    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({
      size: "A4", margins: { top: 60, bottom: 60, left: 50, right: 50 },
      info: { Title: `Offer Summary — ${deal.name}`, Author: "Bruce Gillingham Pollard" },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const pageW = 495, leftM = 50;
    drawBgpHeader(doc, pageW, leftM, "OFFER SUMMARY");
    let y = 55;
    doc.rect(leftM, y, pageW, 2).fill(BGP_GREEN); y += 12;
    doc.font("Helvetica-Bold").fontSize(20).fillColor(BGP_DARK_GREEN).text("Offer Summary", leftM, y, { width: pageW });
    y = doc.y + 6;
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#333").text(deal.property_name || deal.name, leftM, y, { width: pageW });
    y = doc.y + 6;

    // Purchaser / tenant
    const halfW = (pageW - 12) / 2;
    y = keyValue(doc, deal.deal_type === "investment" ? "Purchaser" : "Tenant", deal.purchaser_name || deal.tenant_name || "—", leftM, y, halfW);
    keyValue(doc, deal.deal_type === "investment" ? "Vendor" : "Landlord", deal.vendor_name || deal.landlord_name || "—", leftM + halfW + 12, y - 28, halfW);

    // Commercial
    doc.font("Helvetica-Bold").fontSize(10).fillColor(BGP_GREEN).text("OFFER", leftM, y + 4);
    y = doc.y + 8;
    const offer = [
      { label: "Price", v: money(deal.pricing) },
      { label: "Yield", v: deal.yield_percent ? `${deal.yield_percent}%` : null },
      { label: "Rent (pa)", v: money(deal.rent_pa) },
      { label: "Term", v: deal.lease_length ? `${deal.lease_length} years` : null },
      { label: "Rent free", v: deal.rent_free ? `${deal.rent_free} months` : null },
      { label: "Capital contribution", v: money(deal.capital_contribution) },
      { label: "Total area", v: deal.total_area_sqft ? `${Number(deal.total_area_sqft).toLocaleString()} sqft` : null },
      { label: "Completion", v: deal.completion_date || deal.completion_target_date || null },
    ];
    const colW = (pageW - 24) / 3;
    for (let i = 0; i < offer.length; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = leftM + col * (colW + 12);
      keyValue(doc, offer[i].label, offer[i].v as any, x, y + row * 30, colW);
    }
    y += Math.ceil(offer.length / 3) * 30 + 8;

    if (deal.comments) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(BGP_GREEN).text("NOTES", leftM, y);
      y = doc.y + 4;
      doc.font("Helvetica").fontSize(10).fillColor("#333").text(deal.comments, leftM, y, { width: pageW, lineGap: 2 });
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font("Helvetica").fontSize(6.5).fillColor("#999")
        .text(`Offer Summary — Subject to contract — Bruce Gillingham Pollard`, leftM, 810, { width: pageW, align: "center" });
    }
    doc.end();
    await new Promise<void>((resolve) => doc.on("end", () => resolve()));
    const pdfBuffer = Buffer.concat(chunks);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="offer-${String(deal.name).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf"`);
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error("[offer-pdf] error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Completion Report PDF ─────────────────────────────────────────────

router.get("/api/deal/:dealId/completion.pdf", requireAuth, async (req, res) => {
  try {
    const { deal, events } = await loadDealSnapshot(String(req.params.dealId));
    if (!deal) return res.status(404).json({ error: "Deal not found" });

    // @ts-ignore — pdfkit ships without d.ts
    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({ size: "A4", margins: { top: 60, bottom: 60, left: 50, right: 50 }, info: { Title: `Completion Report — ${deal.name}` }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const pageW = 495, leftM = 50;
    drawBgpHeader(doc, pageW, leftM, "COMPLETION REPORT");
    let y = 55;
    doc.rect(leftM, y, pageW, 2).fill(BGP_GREEN); y += 12;
    doc.font("Helvetica-Bold").fontSize(20).fillColor(BGP_DARK_GREEN).text("Completion Report", leftM, y, { width: pageW });
    y = doc.y + 6;
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#333").text(deal.property_name || deal.name, leftM, y, { width: pageW });
    y = doc.y + 10;

    // Summary grid
    const halfW = (pageW - 12) / 2;
    y = keyValue(doc, "Landlord", deal.landlord_name || "—", leftM, y, halfW);
    keyValue(doc, "Tenant", deal.tenant_name || "—", leftM + halfW + 12, y - 28, halfW);

    const summary = [
      { label: "Price / Rent", v: money(deal.pricing || deal.rent_pa) },
      { label: "Term", v: deal.lease_length ? `${deal.lease_length} years` : null },
      { label: "Completed", v: deal.completion_date || (deal.hots_completed_at ? new Date(deal.hots_completed_at).toLocaleDateString("en-GB") : null) },
      { label: "Fee", v: money(deal.fee) },
    ];
    const colW = (pageW - 24) / 2;
    for (let i = 0; i < summary.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      keyValue(doc, summary[i].label, summary[i].v as any, leftM + col * (colW + 12), y + row * 30, colW);
    }
    y += Math.ceil(summary.length / 2) * 30 + 10;

    // Timeline
    if (events.length) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(BGP_GREEN).text("DEAL TIMELINE", leftM, y);
      y = doc.y + 6;
      for (const e of events.slice().reverse()) {
        if (y > 760) { doc.addPage(); y = 60; }
        const d = new Date(e.occurred_at).toLocaleDateString("en-GB");
        const label = e.event_type === "stage_change" ? `${e.from_stage || "?"} → ${e.to_stage || "?"}` : e.event_type.replace(/_/g, " ");
        doc.font("Helvetica").fontSize(9).fillColor("#555").text(`${d}  ·  ${label}${e.actor_name ? ` — ${e.actor_name}` : ""}`, leftM, y, { width: pageW });
        y = doc.y + 2;
      }
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font("Helvetica").fontSize(6.5).fillColor("#999")
        .text(`Completion Report — Bruce Gillingham Pollard`, leftM, 810, { width: pageW, align: "center" });
    }
    doc.end();
    await new Promise<void>((resolve) => doc.on("end", () => resolve()));
    const pdfBuffer = Buffer.concat(chunks);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="completion-${String(deal.name).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf"`);
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error("[completion-pdf] error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
