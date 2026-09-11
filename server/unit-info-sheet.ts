// Unit info sheet — the letting tracker's "create document" (Woody +
// Landsec's Jonny Rushton, 2026-09-01): one branded PDF of unit
// particulars an agent can issue straight to tenants/agents. Particulars
// come from the tracker row (never retyped); tick-box includes pull from
// the unit's Files sections (floor plans / brochure / photos) and the
// property's plans (scheme plan). Branded with the LANDLORD's logo +
// colour from crm_companies, so Landsec instructions come out Landsec
// and Hammerson come out Hammerson. Output lands back in the unit's
// Files so the trail of what was issued lives on the unit.
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { requireAuth } from "./auth";
import { pool, db } from "./db";
import { unitMarketingFiles } from "@shared/schema";
import { eq } from "drizzle-orm";
import { saveFile, getFile } from "./file-storage";

const router = Router();

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 54;

function hexToRgb(hex: string | null | undefined): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return { r: 0.1, g: 0.12, b: 0.16 };
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function fmtMoney(v: any): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function fmtSqft(v: any): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n.toLocaleString("en-GB")} sq ft`;
}

const MISREP = "Misrepresentation Act 1967. Bruce Gillingham Pollard for themselves and for the vendors or lessors of this property whose agents they are, give notice that: (i) these particulars are set out as a general outline only for the guidance of intending purchasers or lessees, and do not constitute part of an offer or contract; (ii) all descriptions, dimensions, references to condition and necessary permissions for use and occupation, and other details are given in good faith and are believed to be correct, but any intending purchasers or tenants should not rely on them as statements or representations of fact but must satisfy themselves by inspection or otherwise as to the correctness of each of them; (iii) no person in the employment of Bruce Gillingham Pollard has any authority to make or give any representation or warranty whatever in relation to this property. All rents and prices are quoted exclusive of VAT unless otherwise stated.";

async function fetchLogoBytes(logoUrl: string | null): Promise<{ bytes: Uint8Array; kind: "png" | "jpg" } | null> {
  if (!logoUrl || !/^https?:\/\//i.test(logoUrl)) return null;
  try {
    const r = await fetch(logoUrl, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const mime = r.headers.get("content-type") || "";
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length < 100) return null;
    if (mime.includes("png")) return { bytes, kind: "png" };
    if (mime.includes("jpeg") || mime.includes("jpg")) return { bytes, kind: "jpg" };
    // Sniff when the CDN lies about content-type.
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return { bytes, kind: "png" };
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, kind: "jpg" };
    return null;
  } catch {
    return null;
  }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function appendFileToPdf(doc: PDFDocument, buf: Buffer, mimeType: string | null, label: string, fontBold: PDFFont): Promise<boolean> {
  const mt = (mimeType || "").toLowerCase();
  try {
    if (mt.includes("pdf")) {
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pages = await doc.copyPages(src, src.getPageIndices());
      for (const p of pages) doc.addPage(p);
      return true;
    }
    if (mt.includes("png") || mt.includes("jpeg") || mt.includes("jpg")) {
      const img = mt.includes("png") ? await doc.embedPng(buf) : await doc.embedJpg(buf);
      const page = doc.addPage(A4);
      const [pw, ph] = A4;
      const maxW = pw - MARGIN * 2;
      const maxH = ph - MARGIN * 2 - 24;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawText(label, { x: MARGIN, y: ph - MARGIN + 6, size: 9, font: fontBold, color: rgb(0.4, 0.4, 0.4) });
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - 24 - h) / 2, width: w, height: h });
      return true;
    }
  } catch (e: any) {
    console.warn(`[info-sheet] could not append ${label}:`, e?.message);
  }
  return false;
}

router.post("/api/available-units/:id/info-sheet", requireAuth, async (req: Request, res: Response) => {
  try {
    const { storage } = await import("./storage");
    const unit: any = await storage.getAvailableUnit(req.params.id as string);
    if (!unit) return res.status(404).json({ message: "Unit not found" });
    const { clientBlockedForProperty } = await import("./company-scope");
    if (unit.propertyId && (await clientBlockedForProperty(req, String(unit.propertyId)))) {
      return res.status(403).json({ message: "Unit is outside your portfolio" });
    }

    const include = {
      floorplans: req.body?.floorplans !== false,
      schemePlan: req.body?.schemePlan !== false,
      brochure: req.body?.brochure === true,
      photos: req.body?.photos !== false,
    };

    const property: any = unit.propertyId ? await storage.getCrmProperty(unit.propertyId) : null;
    const landlord: any = property?.landlordId ? await storage.getCrmCompany(property.landlordId) : null;

    const files = await db.select().from(unitMarketingFiles).where(eq(unitMarketingFiles.unitId, unit.id));
    const catOf = (f: any) => ((f.category === "brochure" && (f.mimeType || "").startsWith("image/")) ? "photo" : (f.category || "brochure"));
    const floorplans = files.filter(f => catOf(f) === "floorplan");
    const brochures = files.filter(f => catOf(f) === "brochure" && (f.fileType || "") !== "infosheet");
    const photos = files.filter(f => catOf(f) === "photo").slice(0, 6);

    let schemePlans: Array<{ storage_key: string; floor: string | null }> = [];
    if (include.schemePlan && unit.propertyId) {
      const r = await pool.query(
        `SELECT storage_key, floor FROM property_plans WHERE property_id = $1 ORDER BY display_order, floor LIMIT 4`,
        [unit.propertyId],
      );
      schemePlans = r.rows;
    }

    let agents: Array<{ name: string; email: string | null; phone: string | null }> = [];
    const agentIds: string[] = Array.isArray(unit.agentUserIds) ? unit.agentUserIds : [];
    if (agentIds.length) {
      const r = await pool.query(
        `SELECT name, email, phone FROM users WHERE id = ANY($1) ORDER BY name`,
        [agentIds],
      );
      agents = r.rows;
    }

    // ── Build the PDF ────────────────────────────────────────────────
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const brand = hexToRgb(landlord?.brandPrimaryColor);
    const brandCol = rgb(brand.r, brand.g, brand.b);
    const ink = rgb(0.13, 0.13, 0.13);
    const grey = rgb(0.45, 0.45, 0.45);

    const page = doc.addPage(A4);
    const [pw, ph] = A4;

    // Landlord-brand header band
    const bandH = 96;
    page.drawRectangle({ x: 0, y: ph - bandH, width: pw, height: bandH, color: brandCol });
    const logo = await fetchLogoBytes(landlord?.logoUrl || null);
    let headerTextX = MARGIN;
    if (logo) {
      try {
        const img = logo.kind === "png" ? await doc.embedPng(logo.bytes) : await doc.embedJpg(logo.bytes);
        const lh = 44;
        const lw = (img.width / img.height) * lh;
        page.drawImage(img, { x: MARGIN, y: ph - bandH + (bandH - lh) / 2, width: Math.min(lw, 160), height: lh });
        headerTextX = MARGIN + Math.min(lw, 160) + 18;
      } catch {/* fall back to text */}
    }
    if (!logo && landlord?.name) {
      page.drawText(String(landlord.name), { x: MARGIN, y: ph - bandH / 2 - 7, size: 20, font: fontBold, color: rgb(1, 1, 1) });
      headerTextX = MARGIN;
    }
    page.drawText("TO LET", {
      x: pw - MARGIN - fontBold.widthOfTextAtSize("TO LET", 13),
      y: ph - bandH / 2 - 5,
      size: 13, font: fontBold, color: rgb(1, 1, 1),
    });

    // Title block
    let y = ph - bandH - 44;
    const title = `${unit.unitName || "Unit"}${unit.floor ? ` · ${unit.floor}` : ""}`;
    page.drawText(title, { x: MARGIN, y, size: 22, font: fontBold, color: ink });
    y -= 20;
    const schemeLine = [property?.name, property?.postcode].filter(Boolean).join(", ");
    if (schemeLine) {
      for (const l of wrapText(schemeLine, font, 12, pw - MARGIN * 2)) {
        page.drawText(l, { x: MARGIN, y, size: 12, font, color: grey });
        y -= 16;
      }
    }
    y -= 14;

    // Particulars table
    const rows: Array<[string, string]> = [];
    const sq = fmtSqft(unit.sqft); if (sq) rows.push(["Area", sq]);
    const rent = fmtMoney(unit.askingRent); if (rent) rows.push(["Quoting rent", `${rent} per annum exclusive`]);
    const rates = fmtMoney(unit.ratesPa); if (rates) rows.push(["Rates payable", `${rates} per annum`]);
    const sc = fmtMoney(unit.serviceChargePa); if (sc) rows.push(["Service charge", `${sc} per annum`]);
    if (unit.useClass) rows.push(["Use", String(unit.useClass)]);
    if (unit.epcRating) rows.push(["EPC", String(unit.epcRating)]);
    if (unit.condition) rows.push(["Condition", String(unit.condition)]);
    if (unit.availableDate) rows.push(["Available", new Date(unit.availableDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })]);

    page.drawText("PARTICULARS", { x: MARGIN, y, size: 9, font: fontBold, color: grey });
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: pw - MARGIN, y }, thickness: 0.8, color: brandCol });
    y -= 22;
    for (const [label, value] of rows) {
      page.drawText(label, { x: MARGIN, y, size: 11, font, color: grey });
      page.drawText(value, { x: pw - MARGIN - font.widthOfTextAtSize(value, 11), y, size: 11, font: fontBold, color: ink });
      y -= 8;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: pw - MARGIN, y }, thickness: 0.4, color: rgb(0.88, 0.88, 0.88) });
      y -= 16;
    }

    // Location / notes
    const noteText = [unit.location, unit.notes].filter(Boolean).join("\n");
    if (noteText && y > 220) {
      y -= 6;
      page.drawText("THE OPPORTUNITY", { x: MARGIN, y, size: 9, font: fontBold, color: grey });
      y -= 18;
      for (const para of noteText.split(/\n+/).slice(0, 3)) {
        for (const l of wrapText(para, font, 10.5, pw - MARGIN * 2)) {
          if (y < 160) break;
          page.drawText(l, { x: MARGIN, y, size: 10.5, font, color: ink });
          y -= 15;
        }
        y -= 6;
      }
    }

    // Contact strip
    const stripY = 96;
    page.drawRectangle({ x: 0, y: 0, width: pw, height: stripY, color: rgb(0.96, 0.955, 0.94) });
    page.drawText("VIEWINGS & FURTHER INFORMATION — BRUCE GILLINGHAM POLLARD", { x: MARGIN, y: stripY - 26, size: 9, font: fontBold, color: ink });
    let cx = MARGIN;
    const agentList = agents.length ? agents : [{ name: "Bruce Gillingham Pollard", email: "hello@brucegillinghampollard.com", phone: null }];
    for (const a of agentList.slice(0, 3)) {
      page.drawText(a.name, { x: cx, y: stripY - 46, size: 10, font: fontBold, color: ink });
      if (a.email) page.drawText(a.email, { x: cx, y: stripY - 60, size: 8.5, font, color: grey });
      if (a.phone) page.drawText(a.phone, { x: cx, y: stripY - 72, size: 8.5, font, color: grey });
      cx += (pw - MARGIN * 2) / Math.min(agentList.length, 3);
    }

    // Photos pages (2×2 grid)
    if (include.photos && photos.length) {
      let photoPage: PDFPage | null = null;
      let slot = 0;
      for (const f of photos) {
        const key = (f.filePath || "").replace(/^\/uploads\//, "");
        const stored = key ? await getFile(key) : null;
        if (!stored) continue;
        const mt = (f.mimeType || stored.contentType || "").toLowerCase();
        if (!mt.includes("png") && !mt.includes("jpg") && !mt.includes("jpeg")) continue;
        try {
          const img = mt.includes("png") ? await doc.embedPng(stored.data) : await doc.embedJpg(stored.data);
          if (!photoPage || slot === 4) {
            photoPage = doc.addPage(A4);
            photoPage.drawText(`${title} — photos`, { x: MARGIN, y: ph - 40, size: 10, font: fontBold, color: grey });
            slot = 0;
          }
          const cellW = (pw - MARGIN * 2 - 16) / 2;
          const cellH = (ph - 140) / 2 - 16;
          const col = slot % 2, row = Math.floor(slot / 2);
          const scale = Math.min(cellW / img.width, cellH / img.height, 1);
          const w = img.width * scale, h = img.height * scale;
          const x0 = MARGIN + col * (cellW + 16) + (cellW - w) / 2;
          const y0 = ph - 70 - (row + 1) * (cellH + 16) + (cellH - h) / 2;
          photoPage.drawImage(img, { x: x0, y: y0, width: w, height: h });
          slot++;
        } catch {/* skip undecodable */}
      }
    }

    // Floor plans, scheme plans, brochure — appended in that order.
    if (include.floorplans) {
      for (const f of floorplans) {
        const key = (f.filePath || "").replace(/^\/uploads\//, "");
        const stored = key ? await getFile(key) : null;
        if (stored) await appendFileToPdf(doc, stored.data, f.mimeType || stored.contentType, `Floor plan — ${f.fileName}`, fontBold);
      }
    }
    for (const p of schemePlans) {
      const stored = await getFile(p.storage_key);
      if (stored) await appendFileToPdf(doc, stored.data, stored.contentType, `Scheme plan${p.floor ? ` — ${p.floor}` : ""}`, fontBold);
    }
    if (include.brochure) {
      for (const f of brochures.slice(0, 2)) {
        const key = (f.filePath || "").replace(/^\/uploads\//, "");
        const stored = key ? await getFile(key) : null;
        if (stored) await appendFileToPdf(doc, stored.data, f.mimeType || stored.contentType, `Brochure — ${f.fileName}`, fontBold);
      }
    }

    // Misrepresentation Act page footer (on a final page)
    const last = doc.addPage(A4);
    last.drawText("IMPORTANT NOTICE", { x: MARGIN, y: ph - 90, size: 10, font: fontBold, color: ink });
    let my = ph - 112;
    for (const l of wrapText(MISREP, font, 8.5, pw - MARGIN * 2)) {
      last.drawText(l, { x: MARGIN, y: my, size: 8.5, font, color: grey });
      my -= 12;
    }
    last.drawText(`Prepared ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · Bruce Gillingham Pollard`, { x: MARGIN, y: my - 12, size: 8.5, font, color: grey });

    const pdfBytes = await doc.save();
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.pdf`;
    const niceName = `Unit particulars — ${unit.unitName || "unit"} — ${new Date().toISOString().slice(0, 10)}.pdf`;
    await saveFile(`marketing-files/${uniqueName}`, Buffer.from(pdfBytes), "application/pdf", niceName);
    const [fileRow] = await db.insert(unitMarketingFiles).values({
      unitId: unit.id,
      fileName: niceName,
      filePath: `/uploads/marketing-files/${uniqueName}`,
      fileType: "infosheet",
      fileSize: pdfBytes.length,
      mimeType: "application/pdf",
      category: "brochure",
    }).returning();

    res.json({ ok: true, file: fileRow, pages: doc.getPageCount() });
  } catch (err: any) {
    console.error("[info-sheet]", err?.message);
    res.status(500).json({ message: err?.message || "Info sheet generation failed" });
  }
});

export default router;
