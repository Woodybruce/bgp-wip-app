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
import { callClaude, safeParseJSON } from "./utils/anthropic-client";

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
  thumbnail?: string;
  imageId?: string;
  location?: string;
  dataUri?: string;
  label?: string;
};

async function loadRecentDeals() {
  const { rows } = await pool.query(
    `SELECT d.id, d.name, d.team, d.deal_type, d.status, d.stage, d.asset_class,
            d.pricing, d.rent_pa, d.fee, d.yield_percent, d.total_area_sqft, d.created_at,
            d.tenant_id, d.internal_agent,
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
        -- Same rule as the Deals list (storage.getCrmDeals excludeTrackerDeals):
        -- the Deals board is SOL+ only; pre-Solicitors pipeline lives on the
        -- Letting Tracker and the WIP report.
        AND (d.status IS NULL OR lower(d.status) NOT IN (
          'opp', 'opportunity', 'rep', 'reporting', 'spec', 'speculative', 'live',
          'ava', 'available', 'neg', 'negotiating', 'negotiation',
          'under negotiation', 'in negotiation', 'hot', 'hots', 'heads of terms'))
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
    case "url": {
      const primary = photo.url && /^https:\/\//i.test(photo.url) ? await fetchImageBuffer(photo.url) : null;
      if (primary) return primary;
      // Search-result hosts often block hotlink fetches — fall back to the
      // Google-served thumbnail, which is always fetchable.
      return photo.thumbnail && /^https:\/\//i.test(photo.thumbnail) ? fetchImageBuffer(photo.thumbnail) : null;
    }
    default:
      return null;
  }
}

// ─── AI commentary ────────────────────────────────────────────────────────
// One upbeat line per deal, grounded ONLY in facts we compute here: repeat
// business with the tenant, the agent's nth deal this year, activity in the
// same town. Failure or timeout just means the PDF ships without commentary.

function cityOf(deal: any): string | null {
  const a = deal.property_address;
  if (a && typeof a === "object") {
    const city = (a as Record<string, any>).city || (a as Record<string, any>).town;
    if (city && typeof city === "string") return city;
  }
  return null;
}

async function buildCommentaryFacts(deals: any[]) {
  const tenantCounts = new Map<string, number>();
  const agentCounts = new Map<string, number>();
  const cityCounts = new Map<string, number>();
  try {
    const tenantIds = Array.from(new Set(deals.map(d => d.tenant_id).filter(Boolean)));
    if (tenantIds.length) {
      const { rows } = await pool.query(
        `SELECT tenant_id, COUNT(*)::int AS n FROM crm_deals WHERE tenant_id = ANY($1::varchar[]) GROUP BY tenant_id`,
        [tenantIds]
      );
      for (const r of rows) tenantCounts.set(r.tenant_id, r.n);
    }
    const { rows: agentRows } = await pool.query(
      `SELECT unnest(internal_agent) AS agent, COUNT(*)::int AS n
         FROM crm_deals
        WHERE created_at >= date_trunc('year', now())
        GROUP BY 1`
    );
    for (const r of agentRows) if (r.agent) agentCounts.set(r.agent, r.n);
    const { rows: cityRows } = await pool.query(
      `SELECT COALESCE(p.address->>'city', p.address->>'town') AS city, COUNT(*)::int AS n
         FROM crm_deals d
         JOIN crm_properties p ON p.id = d.property_id
        WHERE d.created_at >= now() - interval '90 days'
        GROUP BY 1`
    );
    for (const r of cityRows) if (r.city) cityCounts.set(r.city, r.n);
  } catch (err: any) {
    console.error("[deal-report] commentary facts error:", err?.message);
  }
  return { tenantCounts, agentCounts, cityCounts };
}

async function generateCommentary(deals: any[]): Promise<Map<string, string>> {
  const comments = new Map<string, string>();
  if (!deals.length) return comments;
  try {
    const facts = await buildCommentaryFacts(deals);
    const payload = deals.map(d => ({
      id: d.id,
      deal: d.name,
      team: Array.isArray(d.team) ? d.team[0] : null,
      type: d.deal_type,
      tenant: d.tenant_name,
      totalDealsWithThisTenant: d.tenant_id ? facts.tenantCounts.get(d.tenant_id) ?? null : null,
      agents: (Array.isArray(d.internal_agent) ? d.internal_agent : []).map((a: string) => ({
        name: a,
        dealsThisYear: facts.agentCounts.get(a) ?? null,
      })),
      town: cityOf(d),
      dealsInTownLast90Days: cityOf(d) ? facts.cityCounts.get(cityOf(d)!) ?? null : null,
      rentPa: d.rent_pa,
      price: d.pricing,
    }));
    const call = callClaude({
      messages: [
        {
          role: "system",
          content:
            "You write one-line commentary for Bruce Gillingham Pollard's internal fortnightly new-deals report. " +
            "For each deal, write ONE short upbeat sentence (max 18 words) — celebratory but professional, like a team round-up. " +
            "Ground every claim ONLY in the facts provided: totalDealsWithThisTenant (e.g. 'third deal with this tenant'), " +
            "an agent's dealsThisYear (e.g. 'Lucy's second deal of the year'), or dealsInTownLast90Days (e.g. 'Bristol is looking busy'). " +
            "Never invent numbers, names or relationships. If no fact stands out, write a simple positive note on the deal itself. " +
            "No emoji. Return STRICT JSON only: an object mapping each deal id to its sentence.",
        },
        { role: "user", content: JSON.stringify(payload) },
      ],
      max_completion_tokens: 2048,
      temperature: 0.6,
    });
    const res: any = await Promise.race([
      call,
      new Promise((_, reject) => setTimeout(() => reject(new Error("commentary timeout")), 25000)),
    ]);
    const text = res?.choices?.[0]?.message?.content || "";
    const parsed = safeParseJSON(text);
    if (parsed && typeof parsed === "object") {
      for (const d of deals) {
        const c = parsed[d.id];
        if (typeof c === "string" && c.trim()) comments.set(d.id, pdfSafe(c).slice(0, 160));
      }
    }
  } catch (err: any) {
    console.error("[deal-report] commentary skipped:", err?.message);
  }
  return comments;
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
  window: { since: Date; until: Date },
  comments: Map<string, string>
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

  // ~5 deals per page: 96px photos with generous row spacing.
  const PHOTO = 96;
  const ROW_GAP = 16;
  for (const group of groups) {
    if (y + PHOTO + 40 > 790) { doc.addPage(); y = 60; }
    doc.font("Helvetica-Bold").fontSize(11).fillColor(BGP_GREEN).text(pdfSafe(group.team).toUpperCase(), leftM, y, { characterSpacing: 1 });
    y = doc.y + 4;
    doc.rect(leftM, y, pageW, 1.5).fill(BGP_GREEN);
    y += 12;

    for (const { deal, photoBuf } of group.deals) {
      if (y + PHOTO + ROW_GAP > 790) { doc.addPage(); y = 60; }

      doc.rect(leftM, y, PHOTO, PHOTO).lineWidth(0.75).stroke("#D8D8D8");
      if (photoBuf) {
        try {
          doc.image(photoBuf, leftM + 3, y + 3, { fit: [PHOTO - 6, PHOTO - 6], align: "center", valign: "center" });
        } catch {}
      } else {
        doc.rect(leftM + 1, y + 1, PHOTO - 2, PHOTO - 2).fill("#F4F7F5");
        const initials = pdfSafe(deal.tenant_name || deal.name).split(/\s+/).map((w: string) => w[0]).join("").toUpperCase().slice(0, 2) || "?";
        doc.font("Helvetica-Bold").fontSize(26).fillColor("#C5CFC8").text(initials, leftM, y + PHOTO / 2 - 13, { width: PHOTO, align: "center" });
      }

      const tx = leftM + PHOTO + 16;
      const tw = pageW - PHOTO - 16;
      doc.font("Helvetica-Bold").fontSize(12).fillColor(BGP_DARK_GREEN).text(pdfSafe(deal.name), tx, y, { width: tw });
      let ty = doc.y + 3;

      const meta: string[] = [];
      if (deal.property_name && deal.property_name !== deal.name) meta.push(pdfSafe(deal.property_name));
      if (deal.deal_type) meta.push(pdfSafe(deal.deal_type));
      if (deal.status) meta.push(pdfSafe(deal.status));
      if (meta.length) {
        doc.font("Helvetica").fontSize(9).fillColor("#555").text(meta.join("  ·  "), tx, ty, { width: tw });
        ty = doc.y + 2;
      }

      const parties: string[] = [];
      if (deal.tenant_name) parties.push(`Tenant: ${pdfSafe(deal.tenant_name)}`);
      if (deal.landlord_name) parties.push(`Landlord: ${pdfSafe(deal.landlord_name)}`);
      if (deal.vendor_name) parties.push(`Vendor: ${pdfSafe(deal.vendor_name)}`);
      if (deal.purchaser_name) parties.push(`Purchaser: ${pdfSafe(deal.purchaser_name)}`);
      const agents = (Array.isArray(deal.internal_agent) ? deal.internal_agent : []).filter(Boolean);
      if (agents.length) parties.push(`Agent${agents.length > 1 ? "s" : ""}: ${agents.map((a: string) => pdfSafe(a)).join(", ")}`);
      if (parties.length) {
        doc.font("Helvetica").fontSize(9).fillColor("#555").text(parties.join("  ·  "), tx, ty, { width: tw });
        ty = doc.y + 2;
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
      doc.font("Helvetica").fontSize(9).fillColor("#777").text(fin.join("  ·  "), tx, ty, { width: tw });
      ty = doc.y + 3;

      const comment = comments.get(deal.id);
      if (comment) {
        doc.font("Helvetica-Oblique").fontSize(9.5).fillColor(BGP_GREEN).text(comment, tx, ty, { width: tw });
      }

      y = Math.max(doc.y, y + PHOTO) + ROW_GAP;
      doc.rect(leftM, y - ROW_GAP / 2, pageW, 0.5).fill("#EAEAEA");
    }
    y += 8;
  }

  if (!totalDeals) {
    doc.font("Helvetica-Oblique").fontSize(10).fillColor("#777").text("No deals were added in the last two weeks.", leftM, y, { width: pageW });
  }

  // Footer sits below the bottom margin — writing there makes pdfkit add a
  // page unless the margin is zeroed for the stamp (standard pdfkit recipe).
  // The masthead listener must not fire either, so drop it first.
  doc.removeAllListeners("pageAdded");
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(6.5).fillColor("#999")
      .text(`Deal Report — Bruce Gillingham Pollard — Confidential — Page ${i + 1} of ${range.count}`, leftM, 810, { width: pageW, align: "center", lineBreak: false });
    doc.page.margins.bottom = oldBottom;
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

// Image search for the photo picker — Google CSE (same setup as
// brand-images.ts), falling back to Unsplash if CSE isn't configured.
router.get("/api/deal-report/image-search", requireAuth, async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "q required" });
    const key = process.env.GOOGLE_CSE_KEY || process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CSE_ID;
    if (key && cx) {
      const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}&searchType=image&imgSize=large&num=9&safe=active`;
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`Image search failed (${r.status})`);
      const d = await r.json();
      const results = ((d?.items as any[]) || [])
        .filter(it => it.link)
        .map(it => ({
          url: it.link,
          thumbnail: it.image?.thumbnailLink || it.link,
          title: it.title || "",
        }));
      return res.json({ results, source: "google" });
    }
    if (process.env.UNSPLASH_ACCESS_KEY) {
      const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=9`;
      const r = await fetch(url, { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`Image search failed (${r.status})`);
      const d = await r.json();
      const results = ((d?.results as any[]) || []).map(p => ({
        url: p.urls?.regular,
        thumbnail: p.urls?.thumb,
        title: p.alt_description || "",
      })).filter(p => p.url);
      return res.json({ results, source: "unsplash" });
    }
    return res.status(503).json({ error: "Image search not configured — set GOOGLE_CSE_ID (+ GOOGLE_CSE_KEY) or UNSPLASH_ACCESS_KEY" });
  } catch (err: any) {
    console.error("[deal-report] image-search error:", err?.message);
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

    const [withPhotos, comments] = await Promise.all([
      Promise.all(selected.map(async (deal) => {
        const photo = photoById.has(deal.id)
          ? photoById.get(deal.id)
          : pickDefaultPhoto(deal, buildCandidates(deal, studioByProperty.get(deal.property_id) || []));
        return { deal, photoBuf: await resolvePhotoBuffer(photo) };
      })),
      generateCommentary(selected),
    ]);

    const pdf = await renderDealReportPdf(groupByTeam(withPhotos), {
      since: new Date(Date.now() - REPORT_DAYS * 86400000),
      until: new Date(),
    }, comments);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="bgp-deal-report-${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    console.error("[deal-report] pdf error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
