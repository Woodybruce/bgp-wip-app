// ─────────────────────────────────────────────────────────────────────────
// BGP "Why Buy" PowerPoint generator.
//
// Produces an EDITABLE, branded .pptx deck (green house palette) from real
// property data — the format the team actually edits. The HTML→PDF engine
// (claude-designed-pdf / why-buy-design) stays for locked finals; this is the
// editable master. Structure is a fixed, designed Why Buy template (cover →
// summary → rationale → covenant/location → evidence → accommodation →
// returns → close); Claude authors only the narrative prose, everything else
// is data. Renderer is pure + dependency-light so it can be unit-checked.
// ─────────────────────────────────────────────────────────────────────────
import type { Request } from "express";
import * as fs from "fs";
import * as path from "path";

// Green house palette (matches the document-templates.ts pptx engine).
const GREEN = "2E5E3F", DK = "1A3A28", GOLD = "C4A35A", DARK = "232323";
const PANEL = "EFEDE6", MUTE = "5A6468", HAIR = "D7DAD3", WHITE = "FFFFFF", INK = "232323", LIGHT = "E7E5DF";
const SERIF = "Georgia", SANS = "Calibri";
const M = 0.5, CW = 13.33 - M * 2;

export interface WhyBuyFact { label: string; value: string; }
export interface WhyBuyKpi { value: string; label: string; }
export interface WhyBuyCompRow { property: string; tenant: string; use: string; rentPsfZa: string; date: string; }
export interface WhyBuyFloorRow { floor: string; use: string; sqft: string; total?: boolean; }

export interface WhyBuyDeckData {
  propertyName: string;
  addressLine: string;
  thesis?: string;
  preparedFor?: string;
  coverFacts: WhyBuyFact[];        // up to 5
  heading?: string;                // summary slide heading
  kpis: WhyBuyKpi[];               // up to 5
  summaryParagraph?: string;
  summaryFacts: WhyBuyFact[];      // up to 8
  strengths: string[];
  upside: string[];
  risksLine?: string;
  tenantFacts: WhyBuyFact[];
  locationBullets: string[];
  zoneNote?: string;
  comps: WhyBuyCompRow[];
  evidenceConclusion?: string;
  accommodation: WhyBuyFloorRow[];
  specBullets: string[];
  dayOne: WhyBuyFact[];
  reversion: WhyBuyFact[];
  businessPlan: string[];
  contact?: string;
}

function logoPath(): string | null {
  const p = path.join(process.cwd(), "server", "assets", "branding", "BGP_WhiteWordmark_trimmed.png");
  return fs.existsSync(p) ? p : null;
}

/** Render the green Why Buy deck to a .pptx Buffer. Pure — no DB/AI. */
export async function renderWhyBuyDeck(data: WhyBuyDeckData): Promise<Buffer> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.author = "Bruce Gillingham Pollard";
  pptx.company = "Bruce Gillingham Pollard";
  pptx.title = `Why Buy — ${data.propertyName}`;
  pptx.layout = "LAYOUT_WIDE";
  const R = pptx.ShapeType.rect;
  const logo = logoPath();

  const header = (s: any, label: string, heading: string, right?: string) => {
    s.background = { color: WHITE };
    s.addShape(R, { x: 0, y: 0, w: 13.33, h: 1.05, fill: { color: GREEN } });
    s.addShape(R, { x: 0, y: 1.05, w: 13.33, h: 0.05, fill: { color: GOLD } });
    if (logo) s.addImage({ path: logo, x: 11.85, y: 0.32, w: 1.0, h: 0.35 });
    s.addText(label.toUpperCase(), { x: M, y: 0.18, w: 9, h: 0.28, fontFace: SANS, fontSize: 10, color: GOLD, charSpacing: 3 });
    s.addText(heading, { x: M, y: 0.46, w: 10.4, h: 0.5, fontFace: SERIF, fontSize: 23, color: WHITE });
    if (right) s.addText(right, { x: 8.4, y: 0.2, w: CW - 7.9, h: 0.7, fontFace: SANS, fontSize: 10, color: LIGHT, align: "right", valign: "middle" });
  };
  const bullets = (s: any, items: string[], x: number, y: number, w: number, h: number, fs = 13) =>
    items.length && s.addText(items.map((t) => ({ text: t, options: { bullet: { characterCode: "2014" }, fontFace: SANS, fontSize: fs, color: INK, paraSpaceAfter: 6 } })),
      { x, y, w, h, valign: "top", lineSpacingMultiple: 1.1 });
  const facts = (s: any, rows: WhyBuyFact[], x: number, y: number, w: number, step = 0.46, fs = 13) =>
    rows.forEach((f, i) => {
      const yy = y + i * step;
      s.addText(f.label.toUpperCase(), { x, y: yy, w: w * 0.42, h: step, fontFace: SANS, fontSize: 9.5, color: MUTE, charSpacing: 0.6, valign: "middle" });
      s.addText(f.value, { x: x + w * 0.42, y: yy, w: w * 0.58, h: step, fontFace: SANS, fontSize: fs, color: INK, bold: true, valign: "middle" });
    });
  const sub = (s: any, t: string, x: number, y: number, color = GOLD) =>
    s.addText(t.toUpperCase(), { x, y, w: 6, h: 0.3, fontFace: SANS, fontSize: 11, color, bold: true, charSpacing: 1.5 });

  // 1. COVER
  let s = pptx.addSlide();
  s.background = { color: DARK };
  s.addShape(R, { x: 0, y: 4.5, w: 13.33, h: 3.0, fill: { color: GREEN } });
  s.addShape(R, { x: 0, y: 4.5, w: 13.33, h: 0.06, fill: { color: GOLD } });
  if (logo) s.addImage({ path: logo, x: 10.35, y: 0.5, w: 2.45, h: 0.86 });
  s.addShape(R, { x: M, y: 1.85, w: 1.7, h: 0.06, fill: { color: GOLD } });
  s.addText("WHY BUY", { x: M, y: 2.0, w: 9, h: 0.4, fontFace: SANS, fontSize: 14, color: GOLD, charSpacing: 5 });
  s.addText(data.propertyName, { x: M - 0.03, y: 2.4, w: 12.2, h: 0.95, fontFace: SERIF, fontSize: 44, color: WHITE });
  s.addText(data.addressLine, { x: M, y: 3.32, w: 12, h: 0.4, fontFace: SANS, fontSize: 18, color: LIGHT });
  if (data.thesis) s.addText(data.thesis, { x: M, y: 3.78, w: 12.2, h: 0.5, fontFace: SERIF, fontSize: 15, italic: true, color: GOLD });
  data.coverFacts.slice(0, 5).forEach((f, i) => {
    const n = Math.min(data.coverFacts.length, 5), x = M + i * (CW / n);
    s.addText(f.label.toUpperCase(), { x, y: 4.9, w: CW / n - 0.15, h: 0.28, fontFace: SANS, fontSize: 9.5, color: GOLD, charSpacing: 2 });
    s.addText(f.value, { x, y: 5.18, w: CW / n - 0.15, h: 0.5, fontFace: SERIF, fontSize: 22, color: WHITE });
  });
  if (data.preparedFor) s.addText(data.preparedFor.toUpperCase(), { x: M, y: 6.7, w: 11, h: 0.3, fontFace: SANS, fontSize: 10, color: LIGHT, charSpacing: 3 });

  // 2. SUMMARY
  s = pptx.addSlide();
  header(s, "Investment Summary", data.heading || "Investment summary");
  data.kpis.slice(0, 5).forEach((k, i) => {
    const n = Math.min(data.kpis.length, 5) || 1, w = (CW - 0.6) / n, x = M + i * (w + 0.15);
    s.addShape(R, { x, y: 1.3, w, h: 1.3, fill: { color: PANEL }, line: { color: HAIR, width: 1 } });
    s.addText(k.value, { x, y: 1.42, w, h: 0.7, fontFace: SERIF, fontSize: 27, color: GREEN, align: "center" });
    s.addText(k.label.toUpperCase(), { x, y: 2.18, w, h: 0.32, fontFace: SANS, fontSize: 9, color: MUTE, align: "center", charSpacing: 1 });
  });
  if (data.summaryParagraph) s.addText(data.summaryParagraph, { x: M, y: 2.85, w: CW, h: 0.95, fontFace: SANS, fontSize: 13.5, color: INK, lineSpacingMultiple: 1.18 });
  s.addShape(R, { x: M, y: 3.95, w: CW, h: 0.03, fill: { color: HAIR } });
  const half = Math.ceil(data.summaryFacts.length / 2);
  facts(s, data.summaryFacts.slice(0, half), M, 4.2, CW / 2);
  facts(s, data.summaryFacts.slice(half, 8), M + CW / 2 + 0.2, 4.2, CW / 2 - 0.2);

  // 3. RATIONALE
  s = pptx.addSlide();
  header(s, "The Case", "Investment rationale");
  sub(s, "Strengths", M, 1.3);
  bullets(s, data.strengths, M, 1.62, CW / 2 - 0.2, 3.4);
  sub(s, "Asset-management upside", M + CW / 2, 1.3);
  bullets(s, data.upside, M + CW / 2, 1.62, CW / 2 - 0.2, 3.4);
  if (data.risksLine) {
    s.addShape(R, { x: M, y: 5.15, w: CW, h: 1.55, fill: { color: PANEL }, line: { color: HAIR, width: 1 } });
    sub(s, "Risks & mitigants", M + 0.2, 5.28, GREEN);
    s.addText(data.risksLine, { x: M + 0.2, y: 5.62, w: CW - 0.4, h: 1.0, fontFace: SANS, fontSize: 12.5, color: MUTE, valign: "top", lineSpacingMultiple: 1.25 });
  }

  // 4. COVENANT & LOCATION
  s = pptx.addSlide();
  header(s, "Covenant & Location", "The tenant and the pitch");
  s.addShape(R, { x: M, y: 1.3, w: CW / 2 - 0.2, h: 5.4, fill: { color: PANEL }, line: { color: HAIR, width: 1 } });
  sub(s, "Tenant & covenant", M + 0.25, 1.5, GREEN);
  facts(s, data.tenantFacts, M + 0.25, 1.95, CW / 2 - 0.7, 0.5);
  sub(s, "Location & connectivity", M + CW / 2, 1.3);
  bullets(s, data.locationBullets, M + CW / 2, 1.62, CW / 2 - 0.2, 3.6);
  if (data.zoneNote) {
    s.addShape(R, { x: M + CW / 2, y: 5.2, w: CW / 2 - 0.2, h: 1.5, fill: { color: GREEN } });
    s.addText("POSITION", { x: M + CW / 2 + 0.2, y: 5.35, w: 4, h: 0.3, fontFace: SANS, fontSize: 10, color: GOLD, charSpacing: 2 });
    s.addText(data.zoneNote, { x: M + CW / 2 + 0.2, y: 5.65, w: CW / 2 - 0.6, h: 0.95, fontFace: SANS, fontSize: 13, italic: true, color: WHITE, valign: "top" });
  }

  // 5. EVIDENCE
  s = pptx.addSlide();
  header(s, "Evidence", "Comparable rental evidence");
  if (data.comps.length) {
    const head = ["Property", "Tenant", "Use", "Rent £psf ZA", "Date"].map((t) => ({ text: t, options: { fill: { color: GREEN }, color: WHITE, bold: true, fontFace: SANS, fontSize: 12, valign: "middle" } }));
    const rows = data.comps.slice(0, 8).map((c, ri) => [c.property, c.tenant, c.use, c.rentPsfZa, c.date].map((v) => ({ text: v, options: { fill: { color: ri % 2 ? "F2F0E8" : WHITE }, color: INK, fontFace: SANS, fontSize: 12, valign: "middle" } })));
    s.addTable([head, ...rows] as any, { x: M, y: 1.3, w: CW, colW: [3.4, 3.0, 2.0, 2.0, 1.93], rowH: 0.5, border: { type: "solid", color: HAIR, pt: 1 }, valign: "middle" });
  }
  if (data.evidenceConclusion) {
    s.addShape(R, { x: M, y: 5.45, w: CW, h: 1.2, fill: { color: PANEL }, line: { color: HAIR, width: 1 } });
    sub(s, "Conclusion", M + 0.2, 5.58, GREEN);
    s.addText(data.evidenceConclusion, { x: M + 0.2, y: 5.9, w: CW - 0.4, h: 0.7, fontFace: SANS, fontSize: 13, italic: true, color: INK, valign: "top" });
  }

  // 6. ACCOMMODATION
  s = pptx.addSlide();
  header(s, "The Asset", "Accommodation & specification");
  if (data.accommodation.length) {
    const head = ["Floor", "Use", "Sq ft (NIA)"].map((t) => ({ text: t, options: { fill: { color: GREEN }, color: WHITE, bold: true, fontFace: SANS, fontSize: 12, valign: "middle" } }));
    const rows = data.accommodation.map((r, ri) => [r.floor, r.use, r.sqft].map((v, ci) => ({ text: v, options: { fill: { color: r.total ? DK : (ri % 2 ? "F2F0E8" : WHITE) }, color: r.total ? WHITE : INK, bold: r.total || ci === 2, fontFace: SANS, fontSize: 12, valign: "middle" } })));
    s.addTable([head, ...rows] as any, { x: M, y: 1.3, w: 6.5, colW: [1.9, 2.9, 1.7], rowH: 0.5, border: { type: "solid", color: HAIR, pt: 1 }, valign: "middle" });
  }
  s.addShape(R, { x: 7.45, y: 1.3, w: CW - 6.95, h: 3.4, fill: { color: PANEL }, line: { color: HAIR, width: 1 } });
  s.addText("Hero image / Street View drops in here", { x: 7.45, y: 2.85, w: CW - 6.95, h: 0.5, fontFace: SANS, fontSize: 12.5, color: MUTE, align: "center" });
  sub(s, "Specification", M, 5.0);
  bullets(s, data.specBullets, M, 5.32, CW, 1.3, 12.5);

  // 7. RETURNS
  s = pptx.addSlide();
  header(s, "Returns", "Day one vs reversion");
  const retCol = (x: number, title: string, dark: boolean, rows: WhyBuyFact[]) => {
    s.addShape(R, { x, y: 1.3, w: CW / 2 - 0.2, h: 3.0, fill: { color: dark ? GREEN : PANEL }, line: { color: HAIR, width: 1 } });
    s.addText(title.toUpperCase(), { x: x + 0.25, y: 1.45, w: 5, h: 0.3, fontFace: SANS, fontSize: 11, color: dark ? GOLD : GREEN, bold: true, charSpacing: 1.5 });
    rows.slice(0, 4).forEach((f, i) => {
      const yy = 1.85 + i * 0.55;
      s.addText(f.label.toUpperCase(), { x: x + 0.25, y: yy, w: 3.0, h: 0.5, fontFace: SANS, fontSize: 10, color: dark ? LIGHT : MUTE, valign: "middle", charSpacing: 0.5 });
      s.addText(f.value, { x: x + 3.1, y: yy, w: CW / 2 - 3.4, h: 0.5, fontFace: SERIF, fontSize: 17, color: dark ? WHITE : INK, bold: true, valign: "middle" });
    });
  };
  retCol(M, "Day one", false, data.dayOne);
  retCol(M + CW / 2, "On reversion", true, data.reversion);
  sub(s, "Business plan", M, 4.55);
  bullets(s, data.businessPlan, M, 4.87, CW, 1.8, 12.5);

  // 8. CLOSING
  s = pptx.addSlide();
  s.background = { color: DARK };
  s.addShape(R, { x: 0, y: 4.5, w: 13.33, h: 3.0, fill: { color: GREEN } });
  s.addShape(R, { x: 0, y: 4.5, w: 13.33, h: 0.06, fill: { color: GOLD } });
  if (logo) s.addImage({ path: logo, x: 5.42, y: 2.1, w: 2.5, h: 0.88 });
  s.addText("Bruce Gillingham Pollard  ·  Belgravia", { x: 1, y: 3.2, w: 11.33, h: 0.5, fontFace: SERIF, fontSize: 21, color: WHITE, align: "center" });
  if (data.contact) s.addText(data.contact, { x: 1, y: 5.2, w: 11.33, h: 0.4, fontFace: SANS, fontSize: 14, color: WHITE, align: "center" });
  s.addText("Editable in PowerPoint   ·   export to PDF for the final", { x: 1, y: 5.85, w: 11.33, h: 0.35, fontFace: SANS, fontSize: 11, color: LIGHT, align: "center", charSpacing: 2 });

  const { fixPptxSchemaViolations } = await import("./pptx-rectify");
  return fixPptxSchemaViolations((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
}

// ── Data assembly ───────────────────────────────────────────────────────────
// Best-effort: pull the property + its units from the DB (schema-verified
// columns), then let Claude author the narrative from those facts. Every step
// is guarded — a thin or missing data point degrades the relevant section
// rather than failing the whole deck.

function addrToLine(address: any, postcode: string | null): string {
  let base = "";
  if (address && typeof address === "object") base = address.formatted || address.address || "";
  else if (typeof address === "string") base = address;
  return [base, postcode].filter(Boolean).join(", ");
}

export async function assembleWhyBuyData(opts: { propertyId?: string; propertyName?: string; preparedFor?: string; extraContext?: string }): Promise<WhyBuyDeckData> {
  const { pool } = await import("./db");
  let prop: any = null;
  try {
    if (opts.propertyId) prop = (await pool.query("SELECT * FROM crm_properties WHERE id = $1 LIMIT 1", [opts.propertyId])).rows[0];
    if (!prop && opts.propertyName) prop = (await pool.query("SELECT * FROM crm_properties WHERE name ILIKE $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1", [`%${opts.propertyName}%`])).rows[0];
  } catch (e: any) { console.warn("[why-buy-pptx] property lookup failed:", e?.message); }

  const propertyName = prop?.name || opts.propertyName || "Untitled property";
  const addressLine = prop ? addrToLine(prop.address, prop.postcode) : "";

  // Accommodation from property_units (verified columns).
  const accommodation: WhyBuyFloorRow[] = [];
  try {
    if (prop?.id) {
      const units = (await pool.query("SELECT unit_name, floor, sqft, use_class FROM property_units WHERE property_id = $1 ORDER BY sqft DESC NULLS LAST", [prop.id])).rows;
      let total = 0;
      for (const u of units) {
        const sq = Number(u.sqft) || 0; total += sq;
        accommodation.push({ floor: u.floor || u.unit_name || "—", use: u.use_class || "—", sqft: sq ? sq.toLocaleString() : "—" });
      }
      if (accommodation.length) accommodation.push({ floor: "Total", use: "", sqft: total.toLocaleString(), total: true });
    }
  } catch (e: any) { console.warn("[why-buy-pptx] units lookup failed:", e?.message); }

  // Facts straight off the property row.
  const coverFacts: WhyBuyFact[] = [];
  if (prop?.tenure) coverFacts.push({ label: "Tenure", value: String(prop.tenure) });
  if (prop?.sqft) coverFacts.push({ label: "Size", value: `${Number(prop.sqft).toLocaleString()} sq ft` });
  if (prop?.asset_class) coverFacts.push({ label: "Asset class", value: String(prop.asset_class) });

  // Claude authors the narrative from the facts we have.
  const narrative = await authorNarrative(prop, addressLine, accommodation, opts.extraContext).catch((e) => {
    console.warn("[why-buy-pptx] narrative authoring failed:", e?.message);
    return null;
  });

  return {
    propertyName,
    addressLine: addressLine || "—",
    preparedFor: opts.preparedFor ? `Prepared for ${opts.preparedFor} · ${new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })}` : `Prepared ${new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`,
    thesis: narrative?.thesis,
    heading: narrative?.heading || propertyName,
    coverFacts: (narrative?.coverFacts?.length ? narrative.coverFacts : coverFacts).slice(0, 5),
    kpis: (narrative?.kpis || []).slice(0, 5),
    summaryParagraph: narrative?.summaryParagraph,
    summaryFacts: (narrative?.summaryFacts || coverFacts).slice(0, 8),
    strengths: narrative?.strengths || [],
    upside: narrative?.upside || [],
    risksLine: narrative?.risksLine,
    tenantFacts: await (async () => {
      // Prepend the real house covenant grade when a tenant on this property
      // resolves to a company with a CH number — authored facts follow it.
      const facts = [...(narrative?.tenantFacts || [])];
      try {
        if (prop?.id) {
          const { rows } = await pool.query(
            `SELECT DISTINCT c.companies_house_number, c.name
               FROM tenancy_schedule_units u
               JOIN crm_companies c ON c.id = u.tenant_company_id
              WHERE u.property_id = $1 AND c.companies_house_number IS NOT NULL LIMIT 1`,
            [prop.id]);
          const num = rows[0]?.companies_house_number;
          if (num) {
            const { getCovenantReport } = await import("./covenant-engine");
            const rep = await getCovenantReport(num);
            facts.unshift({ label: "Covenant (house grade)", value: `${rep.grade} — ${rep.score}/100${rep.flags.some(fl => fl.level === "red") ? " ⚑" : ""}` });
          }
        }
      } catch { /* engine/join unavailable — authored facts only */ }
      return facts;
    })(),
    locationBullets: narrative?.locationBullets || [],
    zoneNote: narrative?.zoneNote,
    comps: narrative?.comps || [],
    evidenceConclusion: narrative?.evidenceConclusion,
    accommodation,
    specBullets: narrative?.specBullets || [],
    dayOne: narrative?.dayOne || [],
    reversion: narrative?.reversion || [],
    businessPlan: narrative?.businessPlan || [],
    contact: narrative?.contact || "belgravia@brucegillinghampollard.com",
  };
}

async function authorNarrative(prop: any, addressLine: string, accommodation: WhyBuyFloorRow[], extra?: string): Promise<Partial<WhyBuyDeckData> | null> {
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ? process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL : undefined;
  const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const facts = {
    name: prop?.name, address: addressLine, assetClass: prop?.asset_class, tenure: prop?.tenure,
    sqft: prop?.sqft, notes: prop?.notes, accommodation,
  };
  const prompt = `You are a senior BGP investment surveyor writing a "Why Buy" deck for the property below. Author the NARRATIVE only, grounded strictly in the facts given — never invent specific figures (rents, yields, prices) you weren't given; where a number is unknown use a clearly-labelled placeholder like "TBC" or omit the field. Confident, evidence-led, UK property language, never hyperbolic.

FACTS:
${JSON.stringify(facts, null, 2)}
${extra ? `\nADDITIONAL CONTEXT FROM THE USER:\n${extra}\n` : ""}
Return ONLY a JSON object (no prose, no code fence) with these optional keys:
{
  "heading": string, "thesis": string (one line),
  "coverFacts": [{"label","value"}] (up to 5 headline facts),
  "kpis": [{"value","label"}] (up to 5 — only metrics supported by the facts; else omit),
  "summaryParagraph": string,
  "summaryFacts": [{"label","value"}] (up to 8),
  "strengths": [string] (4-5), "upside": [string] (4-5), "risksLine": string,
  "tenantFacts": [{"label","value"}], "locationBullets": [string] (4-6), "zoneNote": string,
  "comps": [{"property","tenant","use","rentPsfZa","date"}] (only if you were given evidence; else []),
  "evidenceConclusion": string,
  "specBullets": [string] (2-4),
  "dayOne": [{"label","value"}], "reversion": [{"label","value"}], "businessPlan": [string] (3-4)
}`;
  const msg = await client.messages.create({ model: "claude-opus-4-8", max_tokens: 4000, messages: [{ role: "user", content: prompt }] });
  const raw = msg.content?.[0]?.type === "text" ? (msg.content[0] as any).text : "";
  const jsonStart = raw.indexOf("{"), jsonEnd = raw.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < 0) return null;
  try { return JSON.parse(raw.slice(jsonStart, jsonEnd + 1)); } catch { return null; }
}

// ── ChatBGP entry point ─────────────────────────────────────────────────────
// Assemble → render → save to chat-media → return a download link, mirroring
// the generate_pptx tool's response shape exactly.
export async function generateWhyBuyForChat(fnArgs: any, _req: Request): Promise<{ data: any; action?: any }> {
  try {
    const data = await assembleWhyBuyData({
      propertyId: fnArgs.propertyId ? String(fnArgs.propertyId) : undefined,
      propertyName: fnArgs.propertyName ? String(fnArgs.propertyName) : undefined,
      preparedFor: fnArgs.preparedFor ? String(fnArgs.preparedFor) : undefined,
      extraContext: fnArgs.context ? String(fnArgs.context) : undefined,
    });
    const buffer = await renderWhyBuyDeck(data);
    const crypto = (await import("crypto")).default;
    const { saveFile } = await import("./file-storage");
    const safeName = `Why_Buy_${data.propertyName.replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_")}`;
    const storageFilename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeName}.pptx`;
    await saveFile(`chat-media/${storageFilename}`, buffer, "application/vnd.openxmlformats-officedocument.presentationml.presentation", `${safeName}.pptx`);
    const downloadUrl = `/api/chat-media/${storageFilename}`;
    return {
      data: {
        success: true, downloadUrl, filename: `${safeName}.pptx`, property: data.propertyName,
        downloadMarkdown: `[📊 Download ${safeName}.pptx](${downloadUrl})`,
        instruction: "Include the downloadMarkdown text EXACTLY as-is in your reply so the user can download the editable deck. It opens in PowerPoint; export to PDF for the final.",
      },
      action: { type: "download", url: downloadUrl, filename: `${safeName}.pptx` },
    };
  } catch (err: any) {
    console.error("[why-buy-pptx] generate failed:", err?.message);
    return { data: { error: `Failed to generate the Why Buy deck: ${err?.message || "unknown error"}` } };
  }
}
