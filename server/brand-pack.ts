// ─────────────────────────────────────────────────────────────────────────
// Brand pack PDF — a one-page summary of a brand's profile for sharing
// with landlords. Uses the existing BGP brand-pack styling.
//
// GET /api/brand/:companyId/pack.pdf
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import * as path from "path";
import * as fs from "fs";

const router = Router();

const BGP_GREEN = "#2E5E3F";
const BGP_DARK_GREEN = "#1A3A28";

async function loadBrandPackData(companyId: string) {
  const companyQ = pool.query(
    `SELECT id, name, domain, domain_url, description, concept_pitch, store_count,
            rollout_status, backers, instagram_handle, industry, founded_year,
            employee_count, annual_revenue, tracking_reason, last_enriched_at
       FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  const signalsQ = pool.query(
    `SELECT signal_type, headline, detail, signal_date, source
       FROM brand_signals WHERE brand_company_id = $1
       ORDER BY COALESCE(signal_date, created_at) DESC LIMIT 6`,
    [companyId]
  );
  const repsQ = pool.query(
    `SELECT r.agent_type, r.region, a.name AS agent_name, ct.name AS contact_name, ct.email AS contact_email
       FROM brand_agent_representations r
       LEFT JOIN crm_companies a ON a.id = r.agent_company_id
       LEFT JOIN crm_contacts ct ON ct.id = r.primary_contact_id
      WHERE r.brand_company_id = $1 AND r.end_date IS NULL`,
    [companyId]
  );
  const contactsQ = pool.query(
    `SELECT name, role, email, phone FROM crm_contacts
      WHERE company_id = $1 ORDER BY CASE WHEN role ILIKE '%ceo%' OR role ILIKE '%founder%' THEN 0 ELSE 1 END LIMIT 6`,
    [companyId]
  );
  const [company, signals, reps, contacts] = await Promise.all([companyQ, signalsQ, repsQ, contactsQ]);
  if (!company.rows[0]) return null;
  return {
    company: company.rows[0],
    signals: signals.rows,
    reps: reps.rows,
    contacts: contacts.rows,
  };
}

router.get("/api/brand/:companyId/pack.pdf", requireAuth, async (req: Request, res: Response) => {
  try {
    const data = await loadBrandPackData(String(req.params.companyId));
    if (!data) return res.status(404).json({ error: "Company not found" });
    const { company, signals, reps, contacts } = data;

    // @ts-ignore — pdfkit ships without d.ts
    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 60, bottom: 60, left: 50, right: 50 },
      info: {
        Title: `${company.name} — Brand Pack`,
        Author: "Bruce Gillingham Pollard",
        Creator: "BGP Dashboard",
      },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));

    const pageW = 495;
    const leftM = 50;
    const rightEdge = leftM + pageW;

    const logoPath = path.join(process.cwd(), "server", "assets", "branding", "BGP_BlackWordmark.png");
    const logoExists = fs.existsSync(logoPath);

    // Header
    doc.rect(0, 0, 595, 8).fill(BGP_GREEN);
    if (logoExists) { try { doc.image(logoPath, leftM, 18, { width: 70 }); } catch {} }
    doc.fontSize(7).fillColor("#FFFFFF").font("Helvetica-Bold");
    doc.fontSize(7).fillColor("#666").text("BRAND PACK", leftM, 16, { align: "right", width: pageW });
    doc.fontSize(6).fillColor("#888").text(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), leftM, 27, { align: "right", width: pageW });

    // Title
    let y = 55;
    doc.rect(leftM, y, pageW, 2).fill(BGP_GREEN);
    y += 12;
    doc.font("Helvetica-Bold").fontSize(22).fillColor(BGP_DARK_GREEN)
      .text(company.name || "Unnamed brand", leftM, y, { width: pageW });
    y = doc.y + 4;

    const statusLine: string[] = [];
    if (company.industry) statusLine.push(company.industry);
    if (company.founded_year) statusLine.push(`Founded ${company.founded_year}`);
    if (company.domain || company.domain_url) statusLine.push(company.domain || company.domain_url.replace(/^https?:\/\//, ""));
    if (statusLine.length) {
      doc.font("Helvetica").fontSize(9).fillColor("#555").text(statusLine.join("  ·  "), leftM, y, { width: pageW });
      y = doc.y + 8;
    }

    // Concept
    if (company.concept_pitch || company.description) {
      doc.font("Helvetica-Oblique").fontSize(11).fillColor("#222")
        .text(company.concept_pitch || company.description, leftM, y, { width: pageW, lineGap: 2 });
      y = doc.y + 10;
    }

    // Key facts strip
    const facts: Array<{ label: string; value: string }> = [];
    if (company.store_count != null) facts.push({ label: "UK STORES", value: String(company.store_count) });
    if (company.rollout_status) facts.push({ label: "ROLLOUT", value: String(company.rollout_status).replace(/_/g, " ").toUpperCase() });
    if (company.employee_count) facts.push({ label: "HEADCOUNT", value: Number(company.employee_count).toLocaleString() });
    if (company.annual_revenue) facts.push({ label: "REVENUE", value: `£${Number(company.annual_revenue).toLocaleString()}` });
    if (company.instagram_handle) facts.push({ label: "INSTAGRAM", value: `@${String(company.instagram_handle).replace(/^@/, "")}` });

    if (facts.length) {
      const col = pageW / facts.length;
      doc.rect(leftM, y, pageW, 44).fill("#F4F7F5");
      for (let i = 0; i < facts.length; i++) {
        const x = leftM + i * col;
        doc.fillColor("#888").font("Helvetica-Bold").fontSize(7).text(facts[i].label, x + 6, y + 8, { width: col - 12 });
        doc.fillColor(BGP_DARK_GREEN).font("Helvetica-Bold").fontSize(13).text(facts[i].value, x + 6, y + 20, { width: col - 12 });
      }
      y += 52;
    }

    // Backers
    if (company.backers) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(BGP_GREEN).text("BACKERS / INVESTORS", leftM, y);
      y = doc.y + 2;
      doc.font("Helvetica").fontSize(10).fillColor("#333").text(company.backers, leftM, y, { width: pageW });
      y = doc.y + 8;
    }

    // Representation
    if (reps.length) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(BGP_GREEN).text("REPRESENTATION", leftM, y);
      y = doc.y + 2;
      for (const r of reps) {
        const line = `${r.agent_name || "Unknown"}  —  ${String(r.agent_type).replace(/_/g, " ")}${r.region ? `  (${r.region})` : ""}`;
        doc.font("Helvetica").fontSize(10).fillColor("#333").text(line, leftM, y, { width: pageW });
        y = doc.y + 1;
        if (r.contact_name) {
          doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#777").text(`${r.contact_name}${r.contact_email ? ` · ${r.contact_email}` : ""}`, leftM + 14, y);
          y = doc.y + 3;
        }
      }
      y += 4;
    }

    // Signals
    if (signals.length) {
      if (y > 620) { doc.addPage(); y = 60; }
      doc.font("Helvetica-Bold").fontSize(9).fillColor(BGP_GREEN).text("RECENT SIGNALS", leftM, y);
      y = doc.y + 4;
      for (const s of signals) {
        if (y > 760) { doc.addPage(); y = 60; }
        const dateStr = s.signal_date ? new Date(s.signal_date).toLocaleDateString("en-GB") : "";
        doc.moveTo(leftM, y + 4).lineTo(leftM, y + 18).strokeColor(BGP_GREEN).lineWidth(2).stroke();
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#333").text(s.headline, leftM + 8, y, { width: pageW - 8 });
        y = doc.y + 1;
        const meta = [s.signal_type?.replace(/_/g, " "), dateStr, s.source].filter(Boolean).join(" · ");
        if (meta) {
          doc.font("Helvetica").fontSize(7.5).fillColor("#888").text(meta, leftM + 8, y, { width: pageW - 8 });
          y = doc.y + 1;
        }
        if (s.detail) {
          doc.font("Helvetica").fontSize(9).fillColor("#555").text(s.detail, leftM + 8, y, { width: pageW - 8 });
          y = doc.y + 4;
        } else {
          y += 4;
        }
      }
      y += 4;
    }

    // Contacts
    if (contacts.length) {
      if (y > 620) { doc.addPage(); y = 60; }
      doc.font("Helvetica-Bold").fontSize(9).fillColor(BGP_GREEN).text("KEY CONTACTS", leftM, y);
      y = doc.y + 4;
      for (const c of contacts) {
        if (y > 770) { doc.addPage(); y = 60; }
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#333").text(c.name || "Unknown", leftM, y);
        if (c.role) { doc.font("Helvetica").fontSize(9).fillColor("#666").text(c.role, leftM + 150, y); }
        const contactMeta = [c.email, c.phone].filter(Boolean).join("  ·  ");
        if (contactMeta) { doc.font("Helvetica").fontSize(8).fillColor("#888").text(contactMeta, leftM + 260, y); }
        y = Math.max(y + 13, doc.y + 4);
      }
    }

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font("Helvetica").fontSize(6.5).fillColor("#999")
        .text(`Generated by BGP Dashboard · Brand data from CRM · ${new Date().toLocaleDateString("en-GB")}`, leftM, 810, { width: pageW, align: "center" });
    }

    doc.end();
    await new Promise<void>((resolve) => doc.on("end", () => resolve()));
    const pdfBuffer = Buffer.concat(chunks);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="brand-pack-${String(company.name || "brand").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf"`);
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error("[brand-pack] error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
