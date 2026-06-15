/**
 * Receipt parsing via Claude vision.
 * Takes a receipt image, returns structured expense data.
 *
 * Receipts arrive in three shapes:
 *   - regular image (jpg/png/webp/gif) — straight to Claude
 *   - PDF — rasterise first page via poppler, send as JPEG
 *   - HEIC / other — convert to JPEG via sharp
 * Claude vision only accepts jpeg/png/webp/gif, so anything else gets
 * normalised here rather than 400'ing the upstream call.
 */
import Anthropic from "@anthropic-ai/sdk";
import { rasterisePdfPage } from "./pdf-image-extract";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ParsedReceipt {
  merchant: string;
  totalPence: number;
  netPence?: number;
  vatPence?: number;
  vatRate?: number;
  date?: string;
  time?: string;
  currency: string;
  items?: { description: string; pricePence: number }[];
  paymentMethod?: string;
  cardLast4?: string;
  category: string;
  confidence: "high" | "medium" | "low";
  rawText?: string;
}

const CATEGORIES = [
  "Client Entertainment",
  "Agent Entertainment (External)",
  "Staff Entertainment",
  "Directors Meetings",
  "Subsistence",
  "Meals & Drinks",
  "Travel - Train",
  "Travel - Tube",
  "Travel - Taxi",
  "Travel - Flights",
  "Travel - Hotels",
  "Travel - Car Hire",
  "Travel - Parking & Tolls",
  "Travel - TFL Bike",
  "Marketing & Advertising",
  "Office Supplies / Stationery",
  "Office Expenses (general)",
  "Printing - Pitch Documents",
  "Software (subscriptions)",
  "IT Charges",
  "Mobile Phone",
  "Phone & Internet",
  "Premises Expenses",
  "RICS Fees",
  "Training",
  "Subscriptions - Magazines/Memberships",
  "Staff Gifts",
  "Client Gifts",
  "Sainsburys / Tesco / Ocado",
  "Other Expenses",
];

function buildPrompt(categories: string[]): string {
  return `You are an expense receipt parser for Bruce Gillingham Pollard, a London commercial property agency.

Extract the following from the receipt image:
- merchant: business name (e.g. "Quo Vadis", "Pret A Manger", "Uber", "Trainline", "Apple")
- totalPence: total amount paid, in pence (£68.50 = 6850)
- netPence: net amount before VAT, if shown
- vatPence: VAT amount, if shown
- vatRate: VAT percentage (20, 5, 0)
- date: ISO date YYYY-MM-DD
- time: HH:MM
- currency: 3-letter code (gbp, usd, eur)
- items: array of line items if visible
- paymentMethod: "card" / "cash" / "contactless" if shown
- cardLast4: last 4 digits if shown
- category: best-fit BGP category from this list:
${categories.map(c => `  - ${c}`).join("\n")}

Categorisation hints:
- Restaurants/pubs/bars → "Meals & Drinks" by default (the calendar context will refine to Client/Agent/Staff Entertainment later)
- Coffee shops, sandwiches, lunches when alone → "Subsistence"
- Sainsburys/Tesco/Ocado/Waitrose → "Sainsburys / Tesco / Ocado"
- TfL, Oyster, contactless on train → "Travel - Tube"
- Trainline, GWR, LNER, SWR, Avanti → "Travel - Train"
- Uber, Bolt, Addison Lee, black cab → "Travel - Taxi"
- Hotels.com, Booking.com, Premier Inn, Marriott, Hilton → "Travel - Hotels"
- BA, EasyJet, Ryanair, KLM → "Travel - Flights"
- NCP, Q-Park, Parkmobile, RingGo → "Travel - Parking & Tolls"
- Apple subscriptions, Adobe, GitHub, Notion, Slack → "Software (subscriptions)"
- Mobile phone bill (Vodafone, EE, O2, Three) → "Mobile Phone"
- WiFi, BT business, internet bills → "Phone & Internet"
- WHSmith, Ryman, Staples → "Office Supplies / Stationery"
- Print shops, document printing → "Printing - Pitch Documents"

Set confidence to "high" if the receipt is clear and all key fields visible, "medium" if some fields unclear, "low" if image is blurry/partial.

Respond with ONLY valid JSON, no markdown fence, no commentary. If a field is not visible, omit it (don't guess).`;
}

export async function parseReceiptImage(args: {
  imageBytes: Buffer;
  mimeType?: string;
  // Free-text correction from the user ("the total is £68.50, not £6.85").
  // Set when re-reading a receipt the AI got wrong — treated as ground truth.
  userHint?: string;
}): Promise<ParsedReceipt> {
  const { buffer, mediaType } = await normaliseForClaude(args.imageBytes, args.mimeType);
  const base64 = buffer.toString("base64");

  // Pull the live Xero category list at parse time so the LLM picks
  // from Wendy's current chart of accounts, not the historic static
  // list. Falls back to the static map if Xero is unreachable.
  let categoryList: string[];
  try {
    const { getExpenseCategories } = await import("./expense-categories");
    const live = await getExpenseCategories();
    categoryList = live.length > 0 ? live.map(c => c.name) : CATEGORIES;
  } catch {
    categoryList = CATEGORIES;
  }
  const liveSet = new Set(categoryList);

  // Fold in what the firm has taught the parser from past corrections, and
  // any specific correction the user just typed in the "fix receipt" dialog.
  const { learnedReceiptHints, learnedCategoryForMerchant } = await import("./expense-ai-memory");
  const learned = await learnedReceiptHints().catch(() => "");
  const hintBlock = args.userHint?.trim()
    ? `\n\nThe user says your previous reading of THIS receipt was wrong:\n"${args.userHint.trim()}"\nTreat that as ground truth and correct your output accordingly.`
    : "";

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: buildPrompt(categoryList) + learned + hintBlock },
      ],
    }],
  });

  const text = msg.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Receipt parser returned no JSON: ${text.substring(0, 200)}`);

  const parsed = JSON.parse(jsonMatch[0]);

  const result: ParsedReceipt = {
    merchant: parsed.merchant || "Unknown",
    totalPence: parsed.totalPence ?? 0,
    netPence: parsed.netPence,
    vatPence: parsed.vatPence,
    vatRate: parsed.vatRate,
    date: parsed.date,
    time: parsed.time,
    currency: (parsed.currency || "gbp").toLowerCase(),
    items: parsed.items,
    paymentMethod: parsed.paymentMethod,
    cardLast4: parsed.cardLast4,
    category: liveSet.has(parsed.category) ? parsed.category : "Other Expenses",
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium",
    rawText: text,
  };

  // Deterministic override: if a human has previously corrected the
  // category for this merchant, that wins over the model's guess — as long
  // as it's still a live Xero category. This is the half of "learning" that
  // never drifts; the prompt hints above handle the fuzzier lessons.
  try {
    const learnedCat = await learnedCategoryForMerchant(result.merchant);
    if (learnedCat && liveSet.has(learnedCat) && learnedCat !== result.category) {
      result.category = learnedCat;
    }
  } catch { /* learning is best-effort — never block a parse */ }

  return result;
}

// Claude vision only accepts these four. Anything else has to be
// converted before the API call or we get a 400.
type ClaudeImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
const CLAUDE_MIMES = new Set<string>(["image/jpeg", "image/png", "image/webp", "image/gif"]);

async function normaliseForClaude(
  bytes: Buffer,
  mimeType: string | undefined,
): Promise<{ buffer: Buffer; mediaType: ClaudeImageMime }> {
  const mt = (mimeType || "").toLowerCase();

  // PDF receipt — rasterise the first page as a JPEG.
  if (mt.includes("pdf") || isPdfByMagic(bytes)) {
    const rendered = await rasterisePdfPage({ pdfBuffer: bytes, page: 1, dpi: 180 });
    if (!rendered) throw new Error("Couldn't render PDF receipt — pdftoppm not available or file unreadable.");
    return { buffer: rendered, mediaType: "image/jpeg" };
  }

  // Already a Claude-supported image and not too big — pass through.
  if (CLAUDE_MIMES.has(mt) && bytes.length < 5 * 1024 * 1024) {
    return { buffer: bytes, mediaType: mt as ClaudeImageMime };
  }

  // Everything else (HEIC from iPhone, oversized photos, weird MIMEs) →
  // convert via sharp. Resize to 1600px max so we don't blow Claude's
  // 5MB image cap. failOn:"none" lets sharp swallow weird metadata.
  const sharpMod = (await import("sharp")).default;
  const jpeg = await sharpMod(bytes, { failOn: "none" })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return { buffer: jpeg, mediaType: "image/jpeg" };
}

function isPdfByMagic(b: Buffer): boolean {
  return b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
}
