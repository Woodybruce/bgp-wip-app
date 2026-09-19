// Ingest an AVAILABLE-PROPERTY flyer/email into the standalone
// external_properties store. Shared engine for every inbound source:
//   - ChatBGP ("here's a unit that's come up")
//   - a forwarded email with to-let particulars
//   - a WhatsApp flyer
// Claude reads the PDF (native document block) or the email text, we geocode
// the address, dedup on normalised address+postcode, file the brochure under
// landlord pack (named after the address), and upsert. Kept OUT of the CRM.
import Anthropic from "@anthropic-ai/sdk";
import { randomBytes } from "crypto";
import { geocodeOne } from "./geocode";
import { saveFile } from "./file-storage";
import { upsertExternalProperty, externalPropertyExists, addressDedupeId } from "./external-properties";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPT = `You are reading UK commercial property "to let / for sale" particulars — an agent or landlord marketing a unit that is AVAILABLE. Extract the following as STRICT JSON (no markdown, no commentary). Use null when a field isn't stated — never guess.

{
  "isAvailableProperty": true|false,   // false if this is NOT an available-space marketing document (e.g. it's a requirement, an invoice, a lease report)
  "address": "full street address as written",
  "postcode": "UK postcode or null",
  "sizeSqft": number|null,             // primary floor area in sq ft (NIA/GIA as stated)
  "rent": number|null,                 // asking rent £ per annum, number only; null if 'rent on application'
  "serviceCharge": number|null,        // service charge £ pa, number only
  "rateableValue": number|null,        // rateable value / rates £
  "tenure": "Leasehold"|"Freehold"|"Either"|null,
  "useClass": "e.g. E(a) / A1 / Sui Generis or null",
  "availability": "e.g. Immediately / Q3 2026 or null",
  "agent": "marketing agent / agency name or null",
  "contactName": "named contact or null",
  "contactEmail": "or null",
  "contactPhone": "or null",
  "summary": "one short line an agent would scan, max 160 chars, or null",
  "confidence": "high"|"medium"|"low"
}`;

export interface PropertyIngestArgs {
  source: string;               // 'Email' | 'WhatsApp' | 'ChatBGP' | ...
  pdfBuffer?: Buffer;
  text?: string;
  originalName?: string;
}
export interface PropertyIngestResult {
  ok: boolean;
  id?: string;
  address?: string;
  duplicate?: boolean;
  reason?: string;
  confidence?: string;
}

async function extract(args: PropertyIngestArgs): Promise<any | null> {
  if (!process.env.ANTHROPIC_API_KEY) { console.warn("[property-ingest] ANTHROPIC_API_KEY not set"); return null; }
  const content: any[] = [];
  if (args.pdfBuffer) {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: args.pdfBuffer.toString("base64") } });
  }
  if (args.text) content.push({ type: "text", text: `Document / email text:\n${args.text.slice(0, 12000)}` });
  content.push({ type: "text", text: PROMPT });
  try {
    const msg = await anthropic.messages.create({ model: "claude-sonnet-4-5", max_tokens: 1200, messages: [{ role: "user", content }] });
    const t = (msg.content as any[]).filter(b => b.type === "text").map(b => b.text).join("");
    const j = t.match(/\{[\s\S]*\}/);
    return j ? JSON.parse(j[0]) : null;
  } catch (e: any) {
    console.warn("[property-ingest] Claude extract failed:", e?.message);
    return null;
  }
}

const num = (v: any): string | null => {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^\d.]/g, ""));
  return isNaN(n) ? null : String(n);
};

export async function ingestAvailableProperty(args: PropertyIngestArgs): Promise<PropertyIngestResult> {
  const parsed = await extract(args);
  if (!parsed) return { ok: false, reason: "extraction failed (no AI response)" };
  if (parsed.isAvailableProperty === false) return { ok: false, reason: "not an available-property document" };
  if (!parsed.address) return { ok: false, reason: "no address found in document" };

  const postcode = parsed.postcode || String(parsed.address).match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)?.[0] || null;
  const geo = await geocodeOne(parsed.address);
  const address = geo.formattedAddress || parsed.address;

  // Dedup: deterministic id from normalised address+postcode. Re-ingesting the
  // same property (forwarded twice, re-scraped) updates one row.
  const id = addressDedupeId(address, postcode);
  const duplicate = await externalPropertyExists(id);

  // File the brochure under landlord pack, named after the address.
  let landlordPack: string | null = null;
  if (args.pdfBuffer && args.pdfBuffer.length > 0) {
    const slug = String(address).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "property";
    const key = `landlord-packs/${slug}-${randomBytes(4).toString("hex")}.pdf`;
    await saveFile(key, args.pdfBuffer, "application/pdf", `${address}.pdf`);
    landlordPack = JSON.stringify({ url: `/api/crm/landlord-packs/${key.split("/").pop()}`, name: `${address} — Landlord Pack`, pages: 1 });
  }

  await upsertExternalProperty({
    id,
    source: args.source,
    address,
    postcode,
    latitude: geo.lat ?? null,
    longitude: geo.lng ?? null,
    rent: num(parsed.rent),
    serviceCharge: num(parsed.serviceCharge),
    rateableValue: num(parsed.rateableValue),
    areaSqft: num(parsed.sizeSqft),
    tenure: parsed.tenure || null,
    useCategory: parsed.useClass || null,
    availability: parsed.availability || null,
    agent: parsed.agent || null,
    contactName: parsed.contactName || null,
    contactPhone: parsed.contactPhone || null,
    contactEmail: parsed.contactEmail || null,
    landlordPack,
    rawData: { source: args.source, parsed, originalName: args.originalName ?? null },
  });

  return { ok: true, id, address, duplicate, confidence: parsed.confidence };
}
