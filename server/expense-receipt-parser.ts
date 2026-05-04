/**
 * Receipt parsing via Claude vision.
 * Takes a receipt image, returns structured expense data.
 */
import Anthropic from "@anthropic-ai/sdk";

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

const PROMPT = `You are an expense receipt parser for Bruce Gillingham Pollard, a London commercial property agency.

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
${CATEGORIES.map(c => `  - ${c}`).join("\n")}

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

export async function parseReceiptImage(args: {
  imageBytes: Buffer;
  mimeType?: string;
}): Promise<ParsedReceipt> {
  const mediaType = (args.mimeType || "image/jpeg") as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  const base64 = args.imageBytes.toString("base64");

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: PROMPT },
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

  return {
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
    category: CATEGORIES.includes(parsed.category) ? parsed.category : "Other Expenses",
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium",
    rawText: text,
  };
}
