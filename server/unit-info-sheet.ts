// Unit info sheet — the letting tracker's "create document" (Woody +
// Landsec's Jonny Rushton, 2026-09-01): one branded PDF of unit
// particulars an agent can issue straight to tenants/agents. Particulars
// come from the tracker row (never retyped); tick-box includes pull from
// the unit's Files sections (floor plans / brochure / photos) and the
// property's plans (scheme plan). BGP house style (docs/DESIGN.md §1:
// Bordeaux, the real wordmark, serif display) with the landlord's logo as
// a small co-brand in the header when the company has one (Woody,
// 2026-10-13: "make it better with logo"). Output lands back in the
// unit's Files so the trail of what was issued lives on the unit.
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { requireAuth } from "./auth";
import { pool, db } from "./db";
import { unitMarketingFiles } from "@shared/schema";
import { eq } from "drizzle-orm";
import { saveFile, getFile } from "./file-storage";
import fs from "fs";

const router = Router();

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 54;

// v19 palette (server/doc-engine.ts BGP_BRAND) — the only colours allowed.
const BORDEAUX = rgb(0x6e / 255, 0x0c / 255, 0x25 / 255);
const INK = rgb(0x1d / 255, 0x1d / 255, 0x1b / 255);
const CREAM = rgb(0xfc / 255, 0xf8 / 255, 0xf4 / 255);
const BLUSH = rgb(0xe4 / 255, 0xd8 / 255, 0xd3 / 255);
const STONE = rgb(0xc2 / 255, 0xba / 255, 0xa3 / 255);
const NECTAR = rgb(0xfc / 255, 0x9f / 255, 0x8d / 255);
const WHITE = rgb(1, 1, 1);

// The real BGP wordmark PNGs (server/assets), light on bordeaux, dark on
// cream/white — never a typed "BGP".
function wordmarkBytes(kind: "light" | "dark"): Uint8Array | null {
  const file = kind === "light" ? "BGP_WhiteHolder.png" : "BGP_BlackHolder.png";
  for (const p of [`${process.cwd()}/server/assets/${file}`, `${process.cwd()}/dist/server/assets/${file}`]) {
    try { if (fs.existsSync(p)) return new Uint8Array(fs.readFileSync(p)); } catch {}
  }
  return null;
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

export type ParticularsInput = {
  unit: any; property: any; landlord: any;
  photos: any[]; floorplans: any[]; brochures: any[];
  schemePlans: Array<{ storage_key: string; floor: string | null }>;
  agents: Array<{ name: string; email: string | null; phone: string | null }>;
  include: { floorplans: boolean; schemePlan: boolean; brochure: boolean; photos: boolean };
};

export async function buildUnitParticularsPdf(input: ParticularsInput): Promise<{ bytes: Uint8Array; pages: number }> {
  const { unit, property, landlord, photos, floorplans, brochures, schemePlans, agents, include } = input;
  // ── Build the PDF ────────────────────────────────────────────────
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
  const ink = INK;
  const grey = rgb(0.42, 0.40, 0.38);
  const [pw, ph] = A4;
  const contentW = pw - MARGIN * 2;

  const markLight = wordmarkBytes("light");
  const markDark = wordmarkBytes("dark");
  const logoLight = markLight ? await doc.embedPng(markLight) : null;
  const logoDark = markDark ? await doc.embedPng(markDark) : null;
  const drawMark = (pg: PDFPage, img: typeof logoLight, x: number, y: number, h: number) => {
    if (!img) return 0;
    const w = (img.width / img.height) * h;
    pg.drawImage(img, { x, y, width: w, height: h });
    return w;
  };
  // Small-caps style label: letter-spaced caps.
  const drawLabel = (pg: PDFPage, text: string, x: number, y: number, size: number, color = grey, align: "left" | "right" = "left") => {
    const t = text.toUpperCase();
    const gap = size * 0.14;
    const width = fontBold.widthOfTextAtSize(t, size) + gap * (t.length - 1);
    let cx = align === "right" ? x - width : x;
    for (const ch of t) {
      pg.drawText(ch, { x: cx, y, size, font: fontBold, color });
      cx += fontBold.widthOfTextAtSize(ch, size) + gap;
    }
    return width;
  };
  // Running footer on every page we draw ourselves.
  const drawFooter = (pg: PDFPage) => {
    pg.drawLine({ start: { x: MARGIN, y: 44 }, end: { x: pw - MARGIN, y: 44 }, thickness: 0.6, color: BLUSH });
    drawMark(pg, logoDark, MARGIN, 22, 17);
    const t = `${unit.unitName || "Unit"}${property?.name ? ` · ${property.name}` : ""}`;
    pg.drawText(t, { x: pw - MARGIN - font.widthOfTextAtSize(t, 8), y: 27, size: 8, font, color: grey });
  };

  const page = doc.addPage(A4);

  // Bordeaux header band: BGP wordmark left, TO LET right, landlord logo
  // as a small co-brand beside it when the company has one.
  const bandH = 92;
  page.drawRectangle({ x: 0, y: ph - bandH, width: pw, height: bandH, color: BORDEAUX });
  drawMark(page, logoLight, MARGIN, ph - bandH + (bandH - 30) / 2, 30);
  const toLetW = drawLabel(page, unit.marketingStatus && /under offer/i.test(unit.marketingStatus) ? "Under offer" : "To let", pw - MARGIN, ph - bandH / 2 - 4, 10.5, WHITE, "right");
  const landlordLogo = await fetchLogoBytes(landlord?.logoUrl || null);
  if (landlordLogo) {
    try {
      const img = landlordLogo.kind === "png" ? await doc.embedPng(landlordLogo.bytes) : await doc.embedJpg(landlordLogo.bytes);
      const lh = 26;
      const lw = Math.min((img.width / img.height) * lh, 120);
      const lx = pw - MARGIN - toLetW - 22 - lw;
      page.drawRectangle({ x: lx - 8, y: ph - bandH + (bandH - lh) / 2 - 6, width: lw + 16, height: lh + 12, color: WHITE, opacity: 0.92 });
      page.drawImage(img, { x: lx, y: ph - bandH + (bandH - lh) / 2, width: lw, height: lh });
    } catch {/* no co-brand */}
  }

  // Hero photo under the band (first photo in the unit's Files), fitted
  // into a cream panel so any aspect ratio reads cleanly.
  let y = ph - bandH;
  const heroFile = include.photos ? photos[0] : null;
  if (heroFile) {
    const key = (heroFile.filePath || "").replace(/^\/uploads\//, "");
    const stored = key ? await getFile(key) : null;
    const mt = (heroFile.mimeType || stored?.contentType || "").toLowerCase();
    if (stored && (mt.includes("png") || mt.includes("jpg") || mt.includes("jpeg"))) {
      try {
        const boxH = 250;
        // Full-bleed, cropped to fill (around the photo's focal point when
        // one is set on the Files dialog); letterboxed only if sharp
        // can't crop it.
        let cropped: Buffer | null = null;
        try {
          const sharp = (await import("sharp")).default;
          const meta = await sharp(stored.data).metadata();
          if (meta.width && meta.height) {
            const scale = Math.max((pw * 2) / meta.width, (boxH * 2) / meta.height);
            const rw = Math.ceil(meta.width * scale), rh = Math.ceil(meta.height * scale);
            const cw = Math.round(pw * 2), ch = Math.round(boxH * 2);
            const fx = typeof heroFile.focalX === "number" ? heroFile.focalX : 0.5;
            const fy = typeof heroFile.focalY === "number" ? heroFile.focalY : 0.45;
            const left = Math.min(Math.max(Math.round(rw * fx - cw / 2), 0), Math.max(rw - cw, 0));
            const top = Math.min(Math.max(Math.round(rh * fy - ch / 2), 0), Math.max(rh - ch, 0));
            cropped = await sharp(stored.data).rotate().resize(rw, rh).extract({ left, top, width: Math.min(cw, rw), height: Math.min(ch, rh) }).jpeg({ quality: 82 }).toBuffer();
          }
        } catch {/* letterbox below */}
        if (cropped) {
          const img = await doc.embedJpg(cropped);
          page.drawImage(img, { x: 0, y: y - boxH, width: pw, height: boxH });
        } else {
          const img = mt.includes("png") ? await doc.embedPng(stored.data) : await doc.embedJpg(stored.data);
          page.drawRectangle({ x: 0, y: y - boxH, width: pw, height: boxH, color: CREAM });
          const scale = Math.min(contentW / img.width, boxH / img.height);
          const w = img.width * scale, h = img.height * scale;
          page.drawImage(img, { x: (pw - w) / 2, y: y - boxH + (boxH - h) / 2, width: w, height: h });
        }
        y -= boxH;
      } catch {/* skip undecodable */}
    }
  }

  // Title block: serif display in bordeaux, address underneath.
  y -= 40;
  const title = `${unit.unitName || "Unit"}${unit.floor && !String(unit.unitName || "").toLowerCase().includes(String(unit.floor).toLowerCase()) ? ` · ${unit.floor}` : ""}`;
  for (const l of wrapText(title, serif, 24, contentW).slice(0, 2)) {
    page.drawText(l, { x: MARGIN, y, size: 24, font: serif, color: BORDEAUX });
    y -= 28;
  }
  const addrObj: any = property?.address;
  const addrStr = typeof addrObj === "string" ? addrObj
    : addrObj ? [addrObj.formatted || addrObj.address || [addrObj.street, addrObj.city].filter(Boolean).join(", ")].filter(Boolean).join("") : "";
  const addressLine = [property?.name, addrStr && !String(property?.name || "").toLowerCase().includes(addrStr.toLowerCase().split(",")[0]) ? addrStr : null, property?.postcode]
    .filter(Boolean).map(String).filter((v, i, arr) => arr.indexOf(v) === i).join(", ");
  if (addressLine) {
    for (const l of wrapText(addressLine, font, 11.5, contentW).slice(0, 2)) {
      page.drawText(l, { x: MARGIN, y, size: 11.5, font, color: grey });
      y -= 15;
    }
  }

  // Big numbers: area, rent, use — the three facts a tenant scans for.
  const stats: Array<[string, string]> = [];
  const sq = fmtSqft(unit.sqft); if (sq) stats.push(["Area", sq]);
  const rent = fmtMoney(unit.askingRent);
  if (rent) stats.push(["Quoting rent", `${rent} pa`]);
  else if (unit.rentPoa) stats.push(["Quoting rent", "On application"]);
  if (unit.useClass) stats.push(["Use", `Class ${String(unit.useClass).replace(/^class\s*/i, "")}`]);
  else if (unit.availableDate) stats.push(["Available", new Date(unit.availableDate).toLocaleDateString("en-GB", { month: "long", year: "numeric" })]);
  if (stats.length) {
    y -= 18;
    const colW = contentW / stats.length;
    stats.forEach(([label, value], i) => {
      const x = MARGIN + i * colW;
      if (i > 0) page.drawLine({ start: { x: x - 14, y: y - 30 }, end: { x: x - 14, y: y + 10 }, thickness: 0.6, color: BLUSH });
      drawLabel(page, label, x, y, 7.5, STONE);
      let size = 20;
      while (size > 12 && serif.widthOfTextAtSize(value, size) > colW - 20) size -= 1;
      page.drawText(value, { x, y: y - 26, size, font: serif, color: BORDEAUX });
    });
    y -= 56;
  }

  // Particulars table with blush hairlines.
  const rows: Array<[string, string]> = [];
  if (unit.floor) rows.push(["Floor", String(unit.floor)]);
  if (rent) rows.push(["Quoting rent", `${rent} per annum exclusive`]);
  const rates = fmtMoney(unit.ratesPa); if (rates) rows.push(["Rates payable", `${rates} per annum`]);
  const sc = fmtMoney(unit.serviceChargePa); if (sc) rows.push(["Service charge", `${sc} per annum`]);
  if (unit.leaseTerms) rows.push(["Lease", String(unit.leaseTerms)]);
  if (unit.condition) rows.push(["Condition", String(unit.condition)]);
  if (unit.epcRating) rows.push(["EPC", String(unit.epcRating)]);
  if (unit.availableDate) rows.push(["Available", new Date(unit.availableDate).toLocaleDateString("en-GB", { month: "long", year: "numeric" })]);

  const stripY = 104;
  if (rows.length) {
    y -= 6;
    drawLabel(page, "Particulars", MARGIN, y, 7.5, BORDEAUX);
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: pw - MARGIN, y }, thickness: 1, color: BORDEAUX });
    y -= 20;
    for (const [label, value] of rows) {
      if (y < stripY + 40) break;
      const lines = wrapText(value, fontBold, 10.5, contentW * 0.62);
      page.drawText(label, { x: MARGIN, y, size: 10.5, font, color: grey });
      let ly = y;
      for (const l of lines.slice(0, 2)) {
        page.drawText(l, { x: pw - MARGIN - fontBold.widthOfTextAtSize(l, 10.5), y: ly, size: 10.5, font: fontBold, color: ink });
        ly -= 14;
      }
      y = ly + 14 - 8;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: pw - MARGIN, y }, thickness: 0.5, color: BLUSH });
      y -= 15;
    }
  }

  // The opportunity: location + notes.
  const noteText = [unit.location && unit.location.length > 24 ? unit.location : null, unit.notes].filter(Boolean).join("\n");
  if (noteText && y > stripY + 56) {
    y -= 2;
    drawLabel(page, "The opportunity", MARGIN, y, 7.5, BORDEAUX);
    y -= 17;
    for (const para of noteText.split(/\n+/).slice(0, 3)) {
      for (const l of wrapText(para, font, 10, contentW)) {
        if (y < stripY + 16) break;
        page.drawText(l, { x: MARGIN, y, size: 10, font, color: ink });
        y -= 14.5;
      }
      y -= 6;
    }
  }

  // Contact strip on cream: wordmark, then the agents.
  page.drawRectangle({ x: 0, y: 0, width: pw, height: stripY, color: CREAM });
  page.drawLine({ start: { x: 0, y: stripY }, end: { x: pw, y: stripY }, thickness: 1.2, color: NECTAR });
  drawMark(page, logoDark, MARGIN, stripY - 36, 22);
  drawLabel(page, "Viewings & further information", pw - MARGIN, stripY - 28, 7.5, STONE, "right");
  const agentList = agents.length ? agents : [{ name: "Bruce Gillingham Pollard", email: "hello@brucegillinghampollard.com", phone: "020 7629 8077" }];
  const shown = agentList.slice(0, 3);
  const colW = contentW / shown.length;
  shown.forEach((a, i) => {
    const cx = MARGIN + i * colW;
    page.drawText(a.name, { x: cx, y: stripY - 56, size: 10, font: fontBold, color: ink });
    if (a.email) page.drawText(a.email, { x: cx, y: stripY - 70, size: 8.5, font, color: grey });
    if (a.phone) page.drawText(a.phone, { x: cx, y: stripY - 82, size: 8.5, font, color: grey });
  });

  // Photos pages (2×2 grid)
  if (include.photos && photos.length) {
    let photoPage: PDFPage | null = null;
    let slot = 0;
    for (const f of photos.slice(heroFile ? 1 : 0)) {
      const key = (f.filePath || "").replace(/^\/uploads\//, "");
      const stored = key ? await getFile(key) : null;
      if (!stored) continue;
      const mt = (f.mimeType || stored.contentType || "").toLowerCase();
      if (!mt.includes("png") && !mt.includes("jpg") && !mt.includes("jpeg")) continue;
      try {
        const img = mt.includes("png") ? await doc.embedPng(stored.data) : await doc.embedJpg(stored.data);
        if (!photoPage || slot === 4) {
          photoPage = doc.addPage(A4);
          drawMark(photoPage, logoDark, MARGIN, ph - 50, 16);
          drawLabel(photoPage, "Photographs", pw - MARGIN, ph - 46, 7.5, STONE, "right");
          drawFooter(photoPage);
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
  drawMark(last, logoDark, MARGIN, ph - 50, 16);
  drawFooter(last);
  drawLabel(last, "Important notice", MARGIN, ph - 96, 7.5, BORDEAUX);
  last.drawLine({ start: { x: MARGIN, y: ph - 104 }, end: { x: pw - MARGIN, y: ph - 104 }, thickness: 1, color: BORDEAUX });
  let my = ph - 124;
  for (const l of wrapText(MISREP, font, 8.5, pw - MARGIN * 2)) {
    last.drawText(l, { x: MARGIN, y: my, size: 8.5, font, color: grey });
    my -= 12;
  }
  last.drawText(`Prepared ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · Bruce Gillingham Pollard`, { x: MARGIN, y: my - 12, size: 8.5, font, color: grey });


  const bytes = await doc.save();
  return { bytes, pages: doc.getPageCount() };
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

    const { bytes: pdfBytes, pages } = await buildUnitParticularsPdf({ unit, property, landlord, photos, floorplans, brochures, schemePlans, agents, include });
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

    res.json({ ok: true, file: fileRow, pages });
  } catch (err: any) {
    console.error("[info-sheet]", err?.message);
    res.status(500).json({ message: err?.message || "Info sheet generation failed" });
  }
});

export default router;
