// ─────────────────────────────────────────────────────────────────────────
// Brand pack PDF — a designed, fixed TWO-PAGE summary of a brand's profile
// for sharing with landlords (Woody, 2026-08-19: "comprehensive well
// designed 2 page download... BGP or Landsec logo on them and the brand
// logo too").
//
// Page 1 — the brand: identity (brand logo + name), concept, key facts,
//          covenant snapshot, backers, representation.
// Page 2 — the market: live requirements, recent signals, key contacts.
//
// Header carries the VIEWER's logo: BGP wordmark for staff, the client
// company's own logo (Landsec etc.) when downloaded from a client login.
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
const INK = "#1F2937";
const MUTED = "#6B7280";
const FAINT = "#9CA3AF";
const PANEL_BG = "#F4F7F5";
const RULE = "#E5E7EB";

const GRADE_COLORS: Record<string, string> = {
  A: "#1E7A3C", B: "#3D8F52", C: "#B7791F", D: "#C2410C", E: "#B91C1C",
};

// Page geometry (A4 = 595 × 842pt)
const LEFT = 46;
const PAGE_W = 595 - LEFT * 2;
const BOTTOM = 780; // hard content floor — footer lives below

async function loadBrandPackData(companyId: string) {
  const companyQ = pool.query(
    `SELECT id, name, domain, domain_url, website, description, concept_pitch, store_count,
            rollout_status, backers, instagram_handle, industry, founded_year,
            employee_count, annual_revenue, logo_url, uk_entity_name, companies_house_number
       FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  const signalsQ = pool.query(
    `SELECT signal_type, headline, detail, signal_date, source
       FROM brand_signals WHERE brand_company_id = $1
       ORDER BY COALESCE(signal_date, created_at) DESC LIMIT 5`,
    [companyId]
  );
  const repsQ = pool.query(
    `SELECT r.agent_type, r.region, a.name AS agent_name, ct.name AS contact_name, ct.email AS contact_email
       FROM brand_agent_representations r
       LEFT JOIN crm_companies a ON a.id = r.agent_company_id
       LEFT JOIN crm_contacts ct ON ct.id = r.primary_contact_id
      WHERE r.brand_company_id = $1 AND r.end_date IS NULL LIMIT 4`,
    [companyId]
  );
  const contactsQ = pool.query(
    `SELECT name, role, email, phone FROM crm_contacts
      WHERE company_id = $1 ORDER BY CASE WHEN role ILIKE '%ceo%' OR role ILIKE '%founder%' THEN 0 ELSE 1 END LIMIT 5`,
    [companyId]
  );
  const requirementsQ = pool.query(
    `SELECT name, use, size, requirement_locations, requirement_date, status
       FROM crm_requirements_leasing
      WHERE company_id = $1
        AND COALESCE(status, '') NOT ILIKE '%dead%'
        AND COALESCE(status, '') NOT ILIKE '%closed%'
      ORDER BY updated_at DESC NULLS LAST LIMIT 3`,
    [companyId]
  );
  const [company, signals, reps, contacts, requirements] = await Promise.all([
    companyQ, signalsQ, repsQ, contactsQ, requirementsQ,
  ]);
  if (!company.rows[0]) return null;

  // Covenant snapshot rides the CH number when we have one.
  let covenant: { grade: string; score: number | null; verdict: string | null } | null = null;
  const chNum = company.rows[0].companies_house_number;
  if (chNum) {
    try {
      const cov = await pool.query(
        `SELECT grade, score, report->>'verdict' AS verdict FROM covenant_reports WHERE company_number = $1`,
        [String(chNum).trim()]
      );
      if (cov.rows[0]?.grade) covenant = cov.rows[0];
    } catch {}
  }

  return { company: company.rows[0], signals: signals.rows, reps: reps.rows, contacts: contacts.rows, requirements: requirements.rows, covenant };
}

// Fetch any web image and normalise to PNG (pdfkit only takes PNG/JPEG;
// logo.dev / Clearbit may serve webp). Null on any failure — the layout
// degrades gracefully without a logo.
async function fetchLogoPng(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return null;
    const sharp = (await import("sharp")).default;
    return await sharp(buf)
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

function brandLogoUrl(company: any): string | null {
  if (company.logo_url) return company.logo_url;
  const domain = (company.domain || "").trim()
    || String(company.domain_url || company.website || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  return domain ? `https://logo.clearbit.com/${domain}` : null;
}

// Who is downloading? Client logins get their own company's logo on the
// header; staff get the BGP wordmark.
async function resolveViewerLogo(req: Request): Promise<{ png: Buffer | null; label: string }> {
  try {
    const { isClientRequestUser, resolveCompanyScope } = await import("./company-scope");
    if (await isClientRequestUser(req)) {
      const companyId = await resolveCompanyScope(req);
      if (companyId) {
        const r = await pool.query(`SELECT name, logo_url, domain FROM crm_companies WHERE id = $1`, [companyId]);
        const row = r.rows[0];
        if (row) {
          const png = await fetchLogoPng(brandLogoUrl(row));
          if (png) return { png, label: row.name || "" };
        }
      }
    }
  } catch {}
  const wordmark = path.join(process.cwd(), "server", "assets", "branding", "BGP_BlackWordmark_trimmed.png");
  return { png: fs.existsSync(wordmark) ? fs.readFileSync(wordmark) : null, label: "Bruce Gillingham Pollard" };
}

const trim = (s: string | null | undefined, max: number) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
};

router.get("/api/brand/:companyId/pack.pdf", requireAuth, async (req: Request, res: Response) => {
  try {
    const data = await loadBrandPackData(String(req.params.companyId));
    if (!data) return res.status(404).json({ error: "Company not found" });
    const { company, signals, reps, contacts, requirements, covenant } = data;

    const [viewerLogo, brandLogo] = await Promise.all([
      resolveViewerLogo(req),
      fetchLogoPng(brandLogoUrl(company)),
    ]);

    // @ts-ignore — pdfkit ships without d.ts
    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      autoFirstPage: true,
      info: { Title: `${company.name} — Brand Pack`, Author: "Bruce Gillingham Pollard", Creator: "BGP Dashboard" },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));

    const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

    const pageHeader = () => {
      doc.rect(0, 0, 595, 6).fill(BGP_GREEN);
      if (viewerLogo.png) {
        try { doc.image(viewerLogo.png, LEFT, 22, { fit: [120, 26] }); } catch {}
      } else {
        doc.font("Helvetica-Bold").fontSize(11).fillColor(BGP_DARK_GREEN).text(viewerLogo.label, LEFT, 28);
      }
      doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED)
        .text("BRAND PACK", LEFT, 24, { width: PAGE_W, align: "right", characterSpacing: 1.5 });
      doc.font("Helvetica").fontSize(7.5).fillColor(FAINT)
        .text(dateStr, LEFT, 36, { width: PAGE_W, align: "right" });
      doc.moveTo(LEFT, 58).lineTo(LEFT + PAGE_W, 58).lineWidth(0.7).strokeColor(RULE).stroke();
      return 72;
    };

    const sectionTitle = (label: string, y: number) => {
      doc.font("Helvetica-Bold").fontSize(8).fillColor(BGP_GREEN)
        .text(label.toUpperCase(), LEFT, y, { characterSpacing: 1.2 });
      return doc.y + 5;
    };

    // ── PAGE 1 — the brand ──────────────────────────────────────────────
    let y = pageHeader();

    // Identity row: brand logo box + name + meta
    const logoBox = 58;
    let nameX = LEFT;
    if (brandLogo) {
      doc.roundedRect(LEFT, y, logoBox, logoBox, 8).lineWidth(0.8).strokeColor(RULE).stroke();
      try { doc.image(brandLogo, LEFT + 7, y + 7, { fit: [logoBox - 14, logoBox - 14], align: "center", valign: "center" }); } catch {}
      nameX = LEFT + logoBox + 16;
    }
    doc.font("Helvetica-Bold").fontSize(24).fillColor(BGP_DARK_GREEN)
      .text(company.name || "Unnamed brand", nameX, y + (brandLogo ? 4 : 0), { width: LEFT + PAGE_W - nameX });
    let metaY = doc.y + 3;
    const meta: string[] = [];
    if (company.industry) meta.push(company.industry);
    if (company.founded_year) meta.push(`Founded ${company.founded_year}`);
    const site = company.domain || String(company.domain_url || company.website || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (site) meta.push(site);
    if (company.instagram_handle) meta.push(`@${String(company.instagram_handle).replace(/^@/, "")}`);
    if (meta.length) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(meta.join("   ·   "), nameX, metaY, { width: LEFT + PAGE_W - nameX });
      metaY = doc.y;
    }
    y = Math.max(y + (brandLogo ? logoBox : 0), metaY) + 14;

    // Concept pitch
    const pitch = trim(company.concept_pitch || company.description, 420);
    if (pitch) {
      doc.font("Helvetica-Oblique").fontSize(10.5).fillColor(INK).text(pitch, LEFT, y, { width: PAGE_W, lineGap: 2.5 });
      y = doc.y + 14;
    }

    // Key-facts strip
    const facts: Array<{ label: string; value: string }> = [];
    if (company.store_count != null) facts.push({ label: "UK STORES", value: String(company.store_count) });
    if (company.rollout_status) facts.push({ label: "ROLLOUT", value: trim(String(company.rollout_status).replace(/_/g, " "), 16).toUpperCase() });
    if (company.employee_count) facts.push({ label: "HEADCOUNT", value: Number(company.employee_count) ? Number(company.employee_count).toLocaleString() : String(company.employee_count) });
    if (company.annual_revenue) facts.push({ label: "REVENUE", value: Number(company.annual_revenue) ? `£${Number(company.annual_revenue).toLocaleString()}` : trim(String(company.annual_revenue), 14) });
    if (covenant?.grade) facts.push({ label: "COVENANT", value: `Grade ${covenant.grade}` });
    if (facts.length) {
      const stripH = 46;
      const col = PAGE_W / facts.length;
      doc.roundedRect(LEFT, y, PAGE_W, stripH, 6).fill(PANEL_BG);
      facts.forEach((f, i) => {
        const x = LEFT + i * col;
        if (i > 0) doc.moveTo(x, y + 9).lineTo(x, y + stripH - 9).lineWidth(0.6).strokeColor("#DDE5DF").stroke();
        doc.font("Helvetica-Bold").fontSize(6.5).fillColor(MUTED).text(f.label, x + 10, y + 10, { width: col - 20, characterSpacing: 0.8 });
        const valColor = f.label === "COVENANT" ? (GRADE_COLORS[covenant!.grade] || BGP_DARK_GREEN) : BGP_DARK_GREEN;
        doc.font("Helvetica-Bold").fontSize(13).fillColor(valColor).text(f.value, x + 10, y + 22, { width: col - 20 });
      });
      y += stripH + 16;
    }

    // Covenant snapshot panel
    if (covenant?.grade) {
      const gradeColor = GRADE_COLORS[covenant.grade] || BGP_GREEN;
      const verdict = trim(covenant.verdict, 520);
      const entityBits: string[] = [];
      if (company.uk_entity_name) entityBits.push(company.uk_entity_name);
      if (company.companies_house_number) entityBits.push(`CH ${company.companies_house_number}`);
      // Measure, then draw the panel behind
      const textX = LEFT + 16;
      const textW = PAGE_W - 32;
      doc.font("Helvetica").fontSize(9);
      const verdictH = verdict ? doc.heightOfString(verdict, { width: textW, lineGap: 2 }) : 0;
      const panelH = 26 + verdictH + (entityBits.length ? 16 : 0) + 12;
      doc.roundedRect(LEFT, y, PAGE_W, panelH, 6).lineWidth(0.8).strokeColor(RULE).stroke();
      doc.rect(LEFT, y, 4, panelH).fill(gradeColor);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(gradeColor)
        .text(`COVENANT — GRADE ${covenant.grade}${covenant.score != null ? `  ·  SCORE ${covenant.score}/100` : ""}`, textX, y + 10, { characterSpacing: 0.8 });
      let cy = y + 26;
      if (verdict) {
        doc.font("Helvetica").fontSize(9).fillColor(INK).text(verdict, textX, cy, { width: textW, lineGap: 2 });
        cy = doc.y + 4;
      }
      if (entityBits.length) {
        doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(`UK trading entity: ${entityBits.join("  ·  ")}`, textX, cy);
      }
      y += panelH + 16;
    }

    // Backers
    if (company.backers && y < BOTTOM - 50) {
      y = sectionTitle("Backers / investors", y);
      doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(trim(company.backers, 260), LEFT, y, { width: PAGE_W });
      y = doc.y + 14;
    }

    // Representation
    if (reps.length && y < BOTTOM - 60) {
      y = sectionTitle("Representation", y);
      for (const r of reps) {
        if (y > BOTTOM - 24) break;
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK)
          .text(r.agent_name || "Unknown", LEFT, y, { continued: true })
          .font("Helvetica").fillColor(MUTED)
          .text(`  —  ${String(r.agent_type || "").replace(/_/g, " ")}${r.region ? `  (${r.region})` : ""}${r.contact_name ? `  ·  ${r.contact_name}` : ""}`);
        y = doc.y + 4;
      }
    }

    // ── PAGE 2 — the market ─────────────────────────────────────────────
    doc.addPage();
    y = pageHeader();
    doc.font("Helvetica-Bold").fontSize(11).fillColor(BGP_DARK_GREEN).text(company.name || "", LEFT, y);
    doc.font("Helvetica").fontSize(8).fillColor(FAINT).text("Market activity", LEFT, doc.y + 1);
    y = doc.y + 14;

    // Live requirements — the thing a landlord actually wants to know
    if (requirements.length) {
      y = sectionTitle("Live requirements", y);
      for (const r of requirements) {
        if (y > BOTTOM - 40) break;
        const uses = Array.isArray(r.use) ? r.use.filter(Boolean).join(" / ") : "";
        const sizes = Array.isArray(r.size) ? r.size.filter(Boolean).join(", ") : "";
        const locs = Array.isArray(r.requirement_locations) ? r.requirement_locations.filter(Boolean).slice(0, 6).join(", ") : "";
        doc.roundedRect(LEFT, y, PAGE_W, 40, 5).fill(PANEL_BG);
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor(BGP_DARK_GREEN).text(trim(r.name, 80), LEFT + 12, y + 8, { width: PAGE_W - 24 });
        const reqMeta = [uses, sizes && `${sizes} sqft`, r.status].filter(Boolean).join("   ·   ");
        doc.font("Helvetica").fontSize(8.5).fillColor(INK).text(trim(reqMeta, 120) || "—", LEFT + 12, y + 21, { width: PAGE_W - 24 });
        if (locs) doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(trim(locs, 130), LEFT + 12, y + 31, { width: PAGE_W - 24 });
        y += 48;
      }
      y += 8;
    }

    // Recent signals
    if (signals.length && y < BOTTOM - 60) {
      y = sectionTitle("Recent signals", y);
      for (const s of signals) {
        if (y > BOTTOM - 36) break;
        const dateSig = s.signal_date ? new Date(s.signal_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
        doc.rect(LEFT, y + 2, 2.5, 12).fill(BGP_GREEN);
        doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(trim(s.headline, 110), LEFT + 10, y, { width: PAGE_W - 10 });
        y = doc.y + 1;
        const metaLine = [String(s.signal_type || "").replace(/_/g, " "), dateSig, s.source].filter(Boolean).join("  ·  ");
        if (metaLine) {
          doc.font("Helvetica").fontSize(7).fillColor(FAINT).text(trim(metaLine, 110), LEFT + 10, y);
          y = doc.y + 1;
        }
        if (s.detail) {
          doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(trim(s.detail, 200), LEFT + 10, y, { width: PAGE_W - 10, lineGap: 1.5 });
          y = doc.y;
        }
        y += 8;
      }
      y += 6;
    }

    // Key contacts
    if (contacts.length && y < BOTTOM - 50) {
      y = sectionTitle("Key contacts", y);
      for (const c of contacts) {
        if (y > BOTTOM - 16) break;
        doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(trim(c.name, 32) || "Unknown", LEFT, y, { width: 150 });
        if (c.role) doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(trim(c.role, 34), LEFT + 155, y, { width: 140 });
        const cm = [c.email, c.phone].filter(Boolean).join("  ·  ");
        if (cm) doc.font("Helvetica").fontSize(8).fillColor(FAINT).text(trim(cm, 48), LEFT + 300, y, { width: PAGE_W - 300 });
        y += 15;
      }
    }

    // Footer on both pages
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.moveTo(LEFT, 800).lineTo(LEFT + PAGE_W, 800).lineWidth(0.5).strokeColor(RULE).stroke();
      doc.font("Helvetica").fontSize(6.5).fillColor(FAINT)
        .text(`Prepared by Bruce Gillingham Pollard  ·  Private & confidential  ·  ${dateStr}`, LEFT, 808, { width: PAGE_W, align: "left" });
      doc.font("Helvetica").fontSize(6.5).fillColor(FAINT)
        .text(`${i + 1} / ${range.count}`, LEFT, 808, { width: PAGE_W, align: "right" });
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
