// Vision pass over a property brochure PDF — extracts the structured
// fields that an investment / leasing brochure tends to carry on its
// first few pages (address, tenure, total area, asking price, yield,
// passing rent, ERV, EPC, listed status, narrative bullets) plus a
// tenancy schedule when present, plus the agent contact block.
//
// Pairs with `brochure-ingest.ts` which orchestrates the writes into
// crm_properties / tenancy_schedule_units / image_studio_images.
//
// Two entry points:
//   - `extractBrochureFields(pdfBuffer)` — single multi-page Claude
//     vision call. Cheaper than one call per page; Claude can
//     cross-reference fields across pages.
//   - `classifyBrochureImage(buffer)` — per-image classifier that
//     decides whether an extracted image is a hero photo, floor plan,
//     location plan, cover, or logo. Used to set the `kind` on
//     property_imagery_assets without the keyword-heuristic fallback.

import Anthropic from "@anthropic-ai/sdk";
import { rasterisePdfPage } from "./pdf-image-extract";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Types ───────────────────────────────────────────────────────────────

export type BrochureType = "investment" | "leasing" | "tenancy_schedule" | "unknown";

export interface BrochureTenancyRow {
  unitNumber: string | null;
  premises: string | null;        // e.g. "Ground Floor", "Unit 4"
  tenantName: string | null;
  tradingName: string | null;
  permittedUse: string | null;
  niaSqft: number | null;
  giaSqft: number | null;
  leaseStart: string | null;      // ISO YYYY-MM-DD
  leaseExpiry: string | null;
  breakDate: string | null;
  nextReviewDate: string | null;
  passingRentPa: number | null;
  ervPa: number | null;
  rateableValue: number | null;
  comments: string | null;
}

export interface BrochureAgentContact {
  agencyName: string | null;     // e.g. "Savills", "JLL", "CBRE", "Cushman & Wakefield"
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface BrochureOwnershipStack {
  // Whoever's selling. For a freehold sale this is usually the same as
  // freeholderName; for a leasehold sale it's the longLeaseholderName.
  vendorName: string | null;
  freeholderName: string | null;       // explicit "Freeholder:" line on the brochure
  longLeaseholderName: string | null;  // explicit "Long Leaseholder:" line
  lenderName: string | null;           // any debt party named in the brochure
}

export interface BrochureExtraction {
  type: BrochureType;
  // Identity
  propertyName: string | null;
  addressLine: string | null;           // single-line address as printed on the brochure
  postcode: string | null;
  // Building
  tenure: string | null;                 // "Freehold" / "Long Leasehold" / "Leasehold"
  groundRent: string | null;             // e.g. "£10 pa" / "Peppercorn"
  unexpiredLeaseTerm: string | null;     // "125 years from 1985" if a long lease
  useClass: string | null;               // "E", "Sui Generis", "B8" etc
  totalAreaSqFt: number | null;
  yearBuilt: string | null;
  listedStatus: string | null;           // "Grade II Listed" / "Unlisted"
  epcRating: string | null;              // "A" – "G"
  // Investment summary
  askingPrice: number | null;            // GBP
  pricePerSqFt: number | null;
  netInitialYield: number | null;        // 0.0525 == 5.25%
  reversionaryYield: number | null;
  passingRentPa: number | null;
  ervPa: number | null;
  waultToBreak: number | null;           // years
  waultToExpiry: number | null;
  // Narrative
  investmentHighlights: string[];        // bullets
  assetManagementOpportunities: string[];
  microLocation: string | null;          // 1-2 sentence area commentary
  // Side data
  tenancySchedule: BrochureTenancyRow[];
  agent: BrochureAgentContact;
  ownership: BrochureOwnershipStack;
  // Meta
  brochureDate: string | null;           // ISO if the brochure shows a prep date
  confidence: "high" | "medium" | "low";
}

export type BrochureImageKind =
  | "hero"
  | "internal"
  | "secondary_external"
  | "floor_plan"
  | "location_plan"
  | "cover"
  | "logo"
  | "other";

export interface BrochureImageClassification {
  kind: BrochureImageKind;
  caption: string | null;
  isUseful: boolean;            // false for tiny decorative graphics
  confidence: "high" | "medium" | "low";
}

// ─── Field extraction ────────────────────────────────────────────────────

const FIELD_PROMPT = `You are reading a UK commercial property brochure (investment, leasing, or tenancy schedule). Extract every field below from the visible pages. If a field is not visible or unclear, return null — DO NOT guess.

Return ONLY valid JSON matching this exact shape, no markdown fences:

{
  "type": "investment" | "leasing" | "tenancy_schedule" | "unknown",
  "propertyName": string|null,
  "addressLine": string|null,
  "postcode": string|null,
  "tenure": string|null,
  "groundRent": string|null,
  "unexpiredLeaseTerm": string|null,
  "useClass": string|null,
  "totalAreaSqFt": number|null,
  "yearBuilt": string|null,
  "listedStatus": string|null,
  "epcRating": string|null,
  "askingPrice": number|null,
  "pricePerSqFt": number|null,
  "netInitialYield": number|null,
  "reversionaryYield": number|null,
  "passingRentPa": number|null,
  "ervPa": number|null,
  "waultToBreak": number|null,
  "waultToExpiry": number|null,
  "investmentHighlights": string[],
  "assetManagementOpportunities": string[],
  "microLocation": string|null,
  "tenancySchedule": [
    {
      "unitNumber": string|null,
      "premises": string|null,
      "tenantName": string|null,
      "tradingName": string|null,
      "permittedUse": string|null,
      "niaSqft": number|null,
      "giaSqft": number|null,
      "leaseStart": "YYYY-MM-DD"|null,
      "leaseExpiry": "YYYY-MM-DD"|null,
      "breakDate": "YYYY-MM-DD"|null,
      "nextReviewDate": "YYYY-MM-DD"|null,
      "passingRentPa": number|null,
      "ervPa": number|null,
      "rateableValue": number|null,
      "comments": string|null
    }
  ],
  "agent": {
    "agencyName": string|null,
    "contactName": string|null,
    "contactEmail": string|null,
    "contactPhone": string|null
  },
  "ownership": {
    "vendorName": string|null,
    "freeholderName": string|null,
    "longLeaseholderName": string|null,
    "lenderName": string|null
  },
  "brochureDate": "YYYY-MM-DD"|null,
  "confidence": "high"|"medium"|"low"
}

Rules:
- Numbers (askingPrice, rents, areas): strip £, commas, "pa", "sq ft". "£2,500,000" -> 2500000. "£45,000 pa" -> 45000.
- Yields: convert percentage strings to fractions. "5.25%" -> 0.0525.
- Areas: prefer NIA when both shown; record GIA only when explicit.
- Dates: ISO YYYY-MM-DD. "Sept 2027" -> "2027-09-01" (1st of month if day absent).
- Tenancy schedule: include every row visible. If only one tenant (single-let), still produce one row.
- investmentHighlights: the bulleted callouts from the front page (e.g. "Prime corner unit", "100% let to undoubted covenant"). Max 8 bullets, max 140 chars each.
- assetManagementOpportunities: the explicit "Asset Management" / "Reversion" bullets. Empty array if absent.
- microLocation: 1-2 sentences describing the area / catchment / footfall — copied as-is when concise, summarised when long. Max 280 chars.
- type: investment = sale brochure with price + yield; leasing = letting brochure with ERV/asking rent only; tenancy_schedule = just the rent roll with no marketing wrapper.
- ownership.vendorName: the party SELLING the asset (line items like "Vendor:", "On behalf of:", "Our client:", "For sale by:"). Often a company name; sometimes a trust or individual. Null if not stated.
- ownership.freeholderName: the registered freeholder ONLY when explicitly named (often "Freeholder:" or "Held freehold by:"). On a freehold sale this is usually identical to vendorName — still extract it when separately listed.
- ownership.longLeaseholderName: the long leaseholder ONLY when explicitly named ("Long Leaseholder:", "Lessee under head lease:"). On a long-leasehold sale this is usually the vendor.
- ownership.lenderName: any lender / mortgagee named in the brochure (rare; sometimes appears on receivership / LPA sales as "Sale by:" + the lender). Null if not stated.
- confidence: "high" if the brochure is clear and most fields visible, "medium" if pages are sparse or you inferred from context, "low" if blurry / wrong document.

Respond with ONLY the JSON object, nothing else.`;

export async function extractBrochureFields(args: {
  pdfBuffer: Buffer;
  maxPages?: number;
}): Promise<BrochureExtraction | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[brochure-vision] ANTHROPIC_API_KEY not set");
    return null;
  }
  const maxPages = args.maxPages ?? 8;

  const pages: { buffer: Buffer; mimeType: string }[] = [];
  for (let p = 1; p <= maxPages; p++) {
    const buf = await rasterisePdfPage({ pdfBuffer: args.pdfBuffer, page: p, dpi: 140 });
    if (!buf) break;
    pages.push({ buffer: buf, mimeType: "image/jpeg" });
  }
  if (pages.length === 0) {
    console.warn("[brochure-vision] no pages rasterised — pdftoppm probably missing");
    return null;
  }

  const content: any[] = pages.map(p => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: p.buffer.toString("base64") },
  }));
  content.push({ type: "text", text: FIELD_PROMPT });

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4000,
      messages: [{ role: "user", content }],
    });
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[brochure-vision] no JSON in response:", text.slice(0, 200));
      return null;
    }
    const raw = JSON.parse(jsonMatch[0]);
    return normaliseExtraction(raw);
  } catch (err: any) {
    console.warn("[brochure-vision] Claude call failed:", err?.message);
    return null;
  }
}

function normaliseExtraction(raw: any): BrochureExtraction {
  const allowedType = new Set(["investment", "leasing", "tenancy_schedule", "unknown"]);
  const type = allowedType.has(raw?.type) ? raw.type : "unknown";
  const num = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number" && isFinite(v)) return v;
    const cleaned = String(v).replace(/[£,\s]|pa|p\.a\.|per annum|sq ft|sqft/gi, "");
    const n = Number(cleaned);
    return isFinite(n) ? n : null;
  };
  const str = (v: any): string | null => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  };
  const isoDate = (v: any): string | null => {
    const s = str(v);
    if (!s) return null;
    // Already ISO?
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  };
  const arr = (v: any, max = 8, maxChars = 280): string[] => {
    if (!Array.isArray(v)) return [];
    return v.filter((x: any) => typeof x === "string" && x.trim())
      .slice(0, max)
      .map((s: string) => s.trim().slice(0, maxChars));
  };

  const tenancy = Array.isArray(raw?.tenancySchedule) ? raw.tenancySchedule.map((r: any): BrochureTenancyRow => ({
    unitNumber: str(r?.unitNumber),
    premises: str(r?.premises),
    tenantName: str(r?.tenantName),
    tradingName: str(r?.tradingName),
    permittedUse: str(r?.permittedUse),
    niaSqft: num(r?.niaSqft),
    giaSqft: num(r?.giaSqft),
    leaseStart: isoDate(r?.leaseStart),
    leaseExpiry: isoDate(r?.leaseExpiry),
    breakDate: isoDate(r?.breakDate),
    nextReviewDate: isoDate(r?.nextReviewDate),
    passingRentPa: num(r?.passingRentPa),
    ervPa: num(r?.ervPa),
    rateableValue: num(r?.rateableValue),
    comments: str(r?.comments),
  })) : [];

  const agent: BrochureAgentContact = {
    agencyName: str(raw?.agent?.agencyName),
    contactName: str(raw?.agent?.contactName),
    contactEmail: str(raw?.agent?.contactEmail),
    contactPhone: str(raw?.agent?.contactPhone),
  };

  const ownership: BrochureOwnershipStack = {
    vendorName: str(raw?.ownership?.vendorName),
    freeholderName: str(raw?.ownership?.freeholderName),
    longLeaseholderName: str(raw?.ownership?.longLeaseholderName),
    lenderName: str(raw?.ownership?.lenderName),
  };

  return {
    type,
    propertyName: str(raw?.propertyName),
    addressLine: str(raw?.addressLine),
    postcode: str(raw?.postcode),
    tenure: str(raw?.tenure),
    groundRent: str(raw?.groundRent),
    unexpiredLeaseTerm: str(raw?.unexpiredLeaseTerm),
    useClass: str(raw?.useClass),
    totalAreaSqFt: num(raw?.totalAreaSqFt),
    yearBuilt: str(raw?.yearBuilt),
    listedStatus: str(raw?.listedStatus),
    epcRating: str(raw?.epcRating),
    askingPrice: num(raw?.askingPrice),
    pricePerSqFt: num(raw?.pricePerSqFt),
    netInitialYield: num(raw?.netInitialYield),
    reversionaryYield: num(raw?.reversionaryYield),
    passingRentPa: num(raw?.passingRentPa),
    ervPa: num(raw?.ervPa),
    waultToBreak: num(raw?.waultToBreak),
    waultToExpiry: num(raw?.waultToExpiry),
    investmentHighlights: arr(raw?.investmentHighlights),
    assetManagementOpportunities: arr(raw?.assetManagementOpportunities),
    microLocation: str(raw?.microLocation),
    tenancySchedule: tenancy,
    agent,
    ownership,
    brochureDate: isoDate(raw?.brochureDate),
    confidence: ["high", "medium", "low"].includes(raw?.confidence) ? raw.confidence : "medium",
  };
}

// ─── Per-image classification ────────────────────────────────────────────

const IMAGE_PROMPT = `Classify this image from a UK commercial property brochure. Respond with ONLY this JSON shape (no markdown):

{
  "kind": "hero" | "internal" | "secondary_external" | "floor_plan" | "location_plan" | "cover" | "logo" | "other",
  "caption": string|null,
  "isUseful": boolean,
  "confidence": "high"|"medium"|"low"
}

Definitions:
- hero: the main external photo of the building, front-facing, well-composed
- internal: interior photo (reception, office floor, retail unit, restaurant interior)
- secondary_external: exterior photo that isn't the hero — side view, rear, detail
- floor_plan: architectural plan of a floor / unit layout / measured survey
- location_plan: map showing the site location, area context, transport links
- cover: brochure cover artwork / front page treatment (often a stylised photo with text overlay)
- logo: a brand logo, agent logo, or icon
- other: anything else (decorative graphics, charts, headshots)

caption: 1 short sentence describing what's in the image, max 120 chars. Null if uninformative.
isUseful: false for tiny decorative graphics, page borders, separator lines. true for everything that adds information.
confidence: how sure you are of the kind.

Respond with ONLY the JSON object.`;

export async function classifyBrochureImage(args: {
  buffer: Buffer;
  mimeType: string;
}): Promise<BrochureImageClassification | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  // Skip absurdly small images — almost certainly decorative.
  if (args.buffer.length < 4000) {
    return { kind: "other", caption: null, isUseful: false, confidence: "high" };
  }
  const mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" =
    args.mimeType.includes("png") ? "image/png" :
    args.mimeType.includes("webp") ? "image/webp" :
    args.mimeType.includes("gif") ? "image/gif" :
    "image/jpeg";
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: args.buffer.toString("base64") } },
          { type: "text", text: IMAGE_PROMPT },
        ],
      }],
    });
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const raw = JSON.parse(jsonMatch[0]);
    const allowed = new Set(["hero", "internal", "secondary_external", "floor_plan", "location_plan", "cover", "logo", "other"]);
    return {
      kind: allowed.has(raw?.kind) ? raw.kind : "other",
      caption: typeof raw?.caption === "string" && raw.caption.trim() ? raw.caption.trim().slice(0, 140) : null,
      isUseful: raw?.isUseful !== false,
      confidence: ["high", "medium", "low"].includes(raw?.confidence) ? raw.confidence : "medium",
    };
  } catch (err: any) {
    console.warn("[brochure-vision] image classify failed:", err?.message);
    return null;
  }
}
