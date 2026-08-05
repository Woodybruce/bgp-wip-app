// ─────────────────────────────────────────────────────────────────────────
// Fortnightly deals report.
//
// BGP-branded PDF of deals added in the last two weeks, organised by team,
// one photo per deal — tenant/brand logo for occupier deals, building photo
// (Image Studio or Street View) for investment deals. The client dialog can
// swap any photo (candidate, pasted URL, or upload) before generating.
//
//   GET  /api/deal-report/recent-deals       — deals + auto photo candidates
//   GET  /api/deal-report/streetview         — auth-only Street View proxy
//   GET  /api/deal-report/studio-image/:id   — auth-only Image Studio image
//   POST /api/deal-report/pdf                — render the PDF
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import * as path from "path";
import * as fs from "fs";

const router = Router();
const BGP_GREEN = "#2E5E3F";
const BGP_DARK_GREEN = "#1A3A28";

// Publishable key — same one the client embeds (client/src/lib/logokit.ts).
const LOGOKIT_TOKEN = "pk_fr1c952fceb18ba8753374";

const REPORT_DAYS = 14;

// Deal-type sets follow client/src/pages/deals.tsx (INVESTMENT_TYPES) plus
// the "Investment" dealType/team value from crm-options.ts.
const INVESTMENT_DEAL_TYPES = new Set(["Purchase", "Sale", "Investment"]);

function isInvestmentDeal(d: { deal_type?: string | null; team?: string[] | null }): boolean {
  if (d.deal_type && INVESTMENT_DEAL_TYPES.has(d.deal_type)) return true;
  return Array.isArray(d.team) && d.team.includes("Investment");
}

function extractDomain(raw?: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "")
    .split("/")[0].split("?")[0];
  return s.includes(".") ? s : null;
}

function flattenAddress(address: unknown, postcode?: string | null): string {
  const parts: string[] = [];
  if (address && typeof address === "object") {
    const a = address as Record<string, any>;
    for (const v of [a.street || a.line1 || a.address, a.city || a.town, a.postcode || a.postalCode || a.zip]) {
      if (v && typeof v === "string") parts.push(v);
    }
  } else if (typeof address === "string" && address.trim()) {
    parts.push(address.trim());
  }
  if (postcode && !parts.some(p => p.toLowerCase().includes(postcode.toLowerCase()))) parts.push(postcode);
  return parts.join(", ");
}

type ReportPhoto = {
  kind: "logo" | "studio" | "streetview" | "url" | "custom";
  url?: string;
  imageId?: string;
  location?: string;
  dataUri?: string;
  label?: string;
};

async function loadRecentDeals() {
  const { rows } = await pool.query(
    `SELECT d.id, d.name, d.team, d.deal_type, d.status, d.stage, d.asset_class,
            d.pricing, d.rent_pa, d.fee, d.yield_percent, d.total_area_sqft, d.created_at,
            p.id AS property_id, p.name AS property_name, p.address AS property_address, p.postcode AS property_postcode,
            tc.name AS tenant_name, tc.domain AS tenant_domain, tc.domain_url AS tenant_domain_url, tc.website AS tenant_website,
            lc.name AS landlord_name, vc.name AS vendor_name, pc.name AS purchaser_name
       FROM crm_deals d
       LEFT JOIN crm_properties p ON p.id = d.property_id
       LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
       LEFT JOIN crm_companies lc ON lc.id = d.landlord_id
       LEFT JOIN crm_companies vc ON vc.id = d.vendor_id
       LEFT JOIN crm_companies pc ON pc.id = d.purchaser_id
      WHERE d.created_at >= now() - interval '${REPORT_DAYS} days'
      ORDER BY d.created_at DESC`
  );
  return rows;
}

async function loadStudioImagesByProperty(propertyIds: string[]): Promise<Map<string, { id: string; fileName: string }[]>> {
  const map = new Map<string, { id: string; fileName: string }[]>();
  if (!propertyIds.length) return map;
  const { rows } = await pool.query(
    `SELECT id, property_id, file_name FROM image_studio_images
      WHERE property_id = ANY($1::varchar[])
      ORDER BY created_at DESC`,
    [propertyIds]
  );
  for (const r of rows) {
    const list = map.get(r.property_id) || [];
    if (list.length < 4) list.push({ id: r.id, fileName: r.file_name });
    map.set(r.property_id, list);
  }
  return map;
}

function buildCandidates(deal: any, studioImages: { id: string; fileName: string }[]): ReportPhoto[] {
  const candidates: ReportPhoto[] = [];
  const tenantDomain = extractDomain(deal.tenant_domain) || extractDomain(deal.tenant_domain_url) || extractDomain(deal.tenant_website);
  if (tenantDomain) {
    candidates.push({
      kind: "logo",
      url: `https://img.logokit.com/${tenantDomain}?token=${LOGOKIT_TOKEN}&size=256`,
      label: `${deal.tenant_name || "Tenant"} logo`,
    });
  }
  for (const img of studioImages) {
    candidates.push({
      kind: "studio",
      imageId: img.id,
      url: `/api/deal-report/studio-image/${img.id}`,
      label: img.fileName || "Image Studio",
    });
  }
  const location = flattenAddress(deal.property_address, deal.property_postcode) || deal.property_name;
  if (location && process.env.GOOGLE_API_KEY) {
    candidates.push({
      kind: "streetview",
      location,
      url: `/api/deal-report/streetview?location=${encodeURIComponent(location)}`,
      label: "Street View",
    });
  }
  return candidates;
}

function pickDefaultPhoto(deal: any, candidates: ReportPhoto[]): ReportPhoto | null {
  const investment = isInvestmentDeal(deal);
  const logo = candidates.find(c => c.kind === "logo");
  const building = candidates.find(c => c.kind === "studio") || candidates.find(c => c.kind === "streetview");
  if (investment) return building || logo || null;
  return logo || building || null;
}

// ─── Image fetching ───────────────────────────────────────────────────────

function sniffImage(buf: Buffer): Buffer | null {
  if (buf.length < 8) return null;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  return isPng || isJpg ? buf : null;
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return sniffImage(Buffer.from(await r.arrayBuffer()));
  } catch {
    return null;
  }
}

function decodeDataUri(dataUri: string): Buffer | null {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUri || "");
  if (!m) return null;
  try {
    return sniffImage(Buffer.from(m[2], "base64"));
  } catch {
    return null;
  }
}

function streetViewApiUrl(location: string, opts: { heading?: string; pitch?: string; fov?: string; size?: string } = {}): string {
  const params = new URLSearchParams({
    location,
    size: opts.size || "800x600",
    pitch: opts.pitch || "5",
    fov: opts.fov || "90",
    key: process.env.GOOGLE_API_KEY || "",
  });
  if (opts.heading) params.set("heading", opts.heading);
  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
}

async function loadStudioImageBuffer(imageId: string): Promise<Buffer | null> {
  const { rows } = await pool.query(
    `SELECT local_path, thumbnail_data FROM image_studio_images WHERE id = $1`,
    [imageId]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.local_path && fs.existsSync(row.local_path)) {
    try {
      const buf = sniffImage(fs.readFileSync(row.local_path));
      if (buf) return buf;
    } catch {}
  }
  if (row.thumbnail_data) return decodeDataUri(row.thumbnail_data);
  return null;
}

async function resolvePhotoBuffer(photo: ReportPhoto | null | undefined): Promise<Buffer | null> {
  if (!photo) return null;
  switch (photo.kind) {
    case "custom":
      return photo.dataUri ? decodeDataUri(photo.dataUri) : null;
    case "studio":
      return photo.imageId ? loadStudioImageBuffer(photo.imageId) : null;
    case "streetview":
      if (!photo.location || !process.env.GOOGLE_API_KEY) return null;
      return fetchImageBuffer(streetViewApiUrl(photo.location));
    case "logo":
    case "url":
      return photo.url && /^https:\/\//i.test(photo.url) ? fetchImageBuffer(photo.url) : null;
    default:
      return null;
  }
}

// ─── PDF rendering ────────────────────────────────────────────────────────

// Helvetica is WinAnsi-only — strip anything it can't encode (emoji etc.).
function pdfSafe(v: unknown): string {
  return String(v ?? "").replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•]/g, "").trim();
}

function money(v: unknown): string | null {
  const n = Number(v);
  return v != null && isFinite(n) && n > 0 ? `£${n.toLocaleString("en-GB")}` : null;
}

async function renderDealReportPdf(
  groups: { team: string; deals: { deal: any; photoBuf: Buffer | null }[] }[],
  window: { since: Date; until: Date }
): Promise<Buffer> {
  // @ts-ignore — pdfkit has no d.ts
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 60, bottom: 60, left: 50, right: 50 },
    info: { Title: "Deal Report — Bruce Gillingham Pollard", Author: "Bruce Gillingham Pollard" },
    bufferPages: true,
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const pageW = 495;
  const leftM = 50;
  const logoPath = path.join(process.cwd(), "server", "assets", "branding", "BGP_BlackWordmark_trimmed.png");
  const logoExists = fs.existsSync(logoPath);

  const masthead = () => {
    doc.rect(0, 0, 595, 8).fill(BGP_GREEN);
    if (logoExists) { try { doc.image(logoPath, leftM, 18, { width: 70 }); } catch {} }
    doc.font("Helvetica").fontSize(7).fillColor("#666").text("DEAL REPORT", leftM, 16, { align: "right", width: pageW });
    doc.fontSize(6).fillColor("#888").text(window.until.toLocaleDateString("en-GB"), leftM, 27, { align: "right", width: pageW });
  };
  masthead();
  doc.on("pageAdded", masthead);

  let y = 55;
  doc.rect(leftM, y, pageW, 2).fill(BGP_GREEN); y += 12;
  doc.font("Helvetica-Bold").fontSize(22).fillColor(BGP_DARK_GREEN).text("New deals", leftM, y, { width: pageW });
  y = doc.y + 2;
  doc.font("Helvetica").fontSize(9).fillColor("#888")
    .text(`${window.since.toLocaleDateString("en-GB")} – ${window.until.toLocaleDateString("en-GB")}`, leftM, y);
  y = doc.y + 8;

  const totalDeals = groups.reduce((n, g) => n + g.deals.length, 0);
  doc.rect(leftM, y, pageW, 50).fill("#F4F7F5");
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#888").text("DEALS ADDED", leftM + 10, y + 10);
  doc.font("Helvetica-Bold").fontSize(18).fillColor(BGP_DARK_GREEN).text(String(totalDeals), leftM + 10, y + 22);
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#888").text("TEAMS", leftM + pageW / 2, y + 10);
  doc.font("Helvetica-Bold").fontSize(18).fillColor(BGP_DARK_GREEN).text(String(groups.length), leftM + pageW / 2, y + 22);
  y += 62;

  const PHOTO = 56;
  for (const group of groups) {
    if (y > 720) { doc.addPage(); y = 60; }
    doc.font("Helvetica-Bold").fontSize(10).fillColor(BGP_GREEN).text(pdfSafe(group.team).toUpperCase(), leftM, y);
    y = doc.y + 3;
    doc.rect(leftM, y, pageW, 1).fill(BGP_GREEN);
    y += 8;

    for (const { deal, photoBuf } of group.deals) {
      if (y + PHOTO + 10 > 780) { doc.addPage(); y = 60; }

      doc.rect(leftM, y, PHOTO, PHOTO).lineWidth(0.5).stroke("#DDDDDD");
      if (photoBuf) {
        try {
          doc.image(photoBuf, leftM + 2, y + 2, { fit: [PHOTO - 4, PHOTO - 4], align: "center", valign: "center" });
        } catch {}
      } else {
        doc.rect(leftM + 1, y + 1, PHOTO - 2, PHOTO - 2).fill("#F4F7F5");
        const initials = pdfSafe(deal.tenant_name || deal.name).split(/\s+/).map((w: string) => w[0]).join("").toUpperCase().slice(0, 2) || "?";
        doc.font("Helvetica-Bold").fontSize(16).fillColor("#BBBBBB").text(initials, leftM, y + PHOTO / 2 - 8, { width: PHOTO, align: "center" });
      }

      const tx = leftM + PHOTO + 12;
      const tw = pageW - PHOTO - 12;
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#222").text(pdfSafe(deal.name), tx, y, { width: tw });
      let ty = doc.y + 1;

      const meta: string[] = [];
      if (deal.property_name && deal.property_name !== deal.name) meta.push(pdfSafe(deal.property_name));
      if (deal.deal_type) meta.push(pdfSafe(deal.deal_type));
      if (deal.status) meta.push(pdfSafe(deal.status));
      if (meta.length) {
        doc.font("Helvetica").fontSize(8.5).fillColor("#666").text(meta.join("  ·  "), tx, ty, { width: tw });
        ty = doc.y + 1;
      }

      const parties: string[] = [];
      if (deal.tenant_name) parties.push(`Tenant: ${pdfSafe(deal.tenant_name)}`);
      if (deal.landlord_name) parties.push(`Landlord: ${pdfSafe(deal.landlord_name)}`);
      if (deal.vendor_name) parties.push(`Vendor: ${pdfSafe(deal.vendor_name)}`);
      if (deal.purchaser_name) parties.push(`Purchaser: ${pdfSafe(deal.purchaser_name)}`);
      if (parties.length) {
        doc.font("Helvetica").fontSize(8.5).fillColor("#666").text(parties.join("  ·  "), tx, ty, { width: tw });
        ty = doc.y + 1;
      }

      const fin: string[] = [];
      const rent = money(deal.rent_pa);
      const price = money(deal.pricing);
      const fee = money(deal.fee);
      if (rent) fin.push(`${rent} pa`);
      else if (price) fin.push(price);
      if (deal.yield_percent) fin.push(`${deal.yield_percent}% yield`);
      if (deal.total_area_sqft) fin.push(`${Number(deal.total_area_sqft).toLocaleString("en-GB")} sq ft`);
      if (fee) fin.push(`Fee ${fee}`);
      fin.push(`Added ${new Date(deal.created_at).toLocaleDateString("en-GB")}`);
      doc.font("Helvetica").fontSize(8).fillColor("#888").text(fin.join("  ·  "), tx, ty, { width: tw });

      y = Math.max(doc.y, y + PHOTO) + 10;
    }
    y += 6;
  }

  if (!totalDeals) {
    doc.font("Helvetica-Oblique").fontSize(10).fillColor("#777").text("No deals were added in the last two weeks.", leftM, y, { width: pageW });
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font("Helvetica").fontSize(6.5).fillColor("#999")
      .text(`Deal Report — Bruce Gillingham Pollard — Confidential — Page ${i + 1} of ${range.count}`, leftM, 810, { width: pageW, align: "center" });
  }

  doc.end();
  await new Promise<void>((resolve) => doc.on("end", () => resolve()));
  return Buffer.concat(chunks);
}

function groupByTeam(deals: { deal: any; photoBuf: Buffer | null }[]): { team: string; deals: typeof deals }[] {
  const map = new Map<string, typeof deals>();
  for (const item of deals) {
    const team = (Array.isArray(item.deal.team) && item.deal.team[0]) || "Unassigned";
    const list = map.get(team) || [];
    list.push(item);
    map.set(team, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([team, deals]) => ({ team, deals }));
}

// ─── Endpoints ───────────────────────────────────────────────────────────

router.get("/api/deal-report/recent-deals", requireAuth, async (_req, res) => {
  try {
    const rows = await loadRecentDeals();
    const propertyIds = Array.from(new Set(rows.map(r => r.property_id).filter(Boolean)));
    const studioByProperty = await loadStudioImagesByProperty(propertyIds as string[]);
    const deals = rows.map(d => {
      const candidates = buildCandidates(d, studioByProperty.get(d.property_id) || []);
      return {
        id: d.id,
        name: d.name,
        team: Array.isArray(d.team) ? d.team : [],
        dealType: d.deal_type,
        status: d.status,
        propertyName: d.property_name,
        tenantName: d.tenant_name,
        landlordName: d.landlord_name,
        vendorName: d.vendor_name,
        purchaserName: d.purchaser_name,
        pricing: d.pricing,
        rentPa: d.rent_pa,
        fee: d.fee,
        createdAt: d.created_at,
        isInvestment: isInvestmentDeal(d),
        photo: pickDefaultPhoto(d, candidates),
        candidates,
      };
    });
    res.json({
      since: new Date(Date.now() - REPORT_DAYS * 86400000).toISOString(),
      until: new Date().toISOString(),
      deals,
    });
  } catch (err: any) {
    console.error("[deal-report] recent-deals error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Image Studio's own endpoints are admin-only; the report needs auth-only
// read access to serve photo previews to any signed-in user.
router.get("/api/deal-report/studio-image/:id", requireAuth, async (req, res) => {
  try {
    const buf = await loadStudioImageBuffer(String(req.params.id));
    if (!buf) return res.status(404).json({ error: "Image not found" });
    res.setHeader("Content-Type", buf[0] === 0x89 ? "image/png" : "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/deal-report/streetview", requireAuth, async (req: Request, res: Response) => {
  try {
    const location = String(req.query.location || "");
    if (!location) return res.status(400).json({ error: "location required" });
    if (!process.env.GOOGLE_API_KEY) return res.status(503).json({ error: "Street View not configured" });
    const buf = await fetchImageBuffer(streetViewApiUrl(location, {
      heading: req.query.heading ? String(req.query.heading) : undefined,
      size: req.query.size ? String(req.query.size) : "600x400",
    }));
    if (!buf) return res.status(404).json({ error: "No Street View image" });
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/deal-report/pdf", requireAuth, async (req: Request, res: Response) => {
  try {
    const requested: { id: string; photo?: ReportPhoto | null }[] = Array.isArray(req.body?.deals) ? req.body.deals : [];
    const rows = await loadRecentDeals();
    const photoById = new Map(requested.map(r => [r.id, r.photo]));
    const includeIds = requested.length ? new Set(requested.map(r => r.id)) : null;

    const selected = includeIds ? rows.filter(r => includeIds.has(r.id)) : rows;
    const propertyIds = Array.from(new Set(selected.map(r => r.property_id).filter(Boolean)));
    const studioByProperty = await loadStudioImagesByProperty(propertyIds as string[]);

    const withPhotos = await Promise.all(selected.map(async (deal) => {
      const photo = photoById.has(deal.id)
        ? photoById.get(deal.id)
        : pickDefaultPhoto(deal, buildCandidates(deal, studioByProperty.get(deal.property_id) || []));
      return { deal, photoBuf: await resolvePhotoBuffer(photo) };
    }));

    const pdf = await renderDealReportPdf(groupByTeam(withPhotos), {
      since: new Date(Date.now() - REPORT_DAYS * 86400000),
      until: new Date(),
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="bgp-deal-report-${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    console.error("[deal-report] pdf error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
