/**
 * Retail leasing comps extractor.
 *
 * Mines Stage 1 `emailHits` (subject + preview) with Claude Haiku and pulls
 * out any retail-lease deal facts we can find — tenant, rent, area, dates,
 * incentive. Writes to the `retail_leasing_comps` table (curated, NOT the
 * CRM) so Woody can review before promoting. Deduped by `dedupe_key`.
 *
 * Call `extractCompsFromEmails(emailHits, { address, postcode })` after the
 * stage 1 email sweep completes. Silent no-op when ANTHROPIC_API_KEY is
 * missing or the batch is empty.
 */
import Anthropic from "@anthropic-ai/sdk";
import { pool } from "./db";

const HELPER_MODEL = "claude-haiku-4-5-20251001";

export interface EmailHitInput {
  subject: string;
  from: string;
  date: string;
  msgId: string;
  preview: string;
}

export interface ExtractedComp {
  address: string;
  postcode?: string;
  tenant?: string;
  landlord?: string;
  useClass?: string;
  sector?: string;
  rentPa?: number;
  rentPsf?: number;
  areaSqft?: number;
  premium?: number;
  rentFreeMonths?: number;
  leaseDate?: string;
  termYears?: number;
  breakYears?: number;
  agent?: string;
  notes?: string;
  confidence: number;
  sourceMsgId: string;
  sourceSubject: string;
  sourceDate: string;
}

function outwardCode(postcode?: string): string | undefined {
  if (!postcode) return undefined;
  const m = postcode.toUpperCase().replace(/\s+/g, "").match(/^([A-Z]{1,2}\d[A-Z\d]?)/);
  return m ? m[1] : undefined;
}

function normAddr(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function makeDedupeKey(c: ExtractedComp): string {
  const addr = normAddr(c.address);
  const tenant = (c.tenant || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const date = (c.leaseDate || "").slice(0, 7); // YYYY-MM
  return `${addr}|${tenant}|${date}`;
}

/**
 * Asks Claude Haiku to pull retail-lease facts from a batch of emails.
 * Returns only entries the model flagged as retail leasing events with
 * confidence >= 0.4.
 */
export async function extractCompsFromEmails(
  emails: EmailHitInput[],
  ctx: { address: string; postcode?: string },
): Promise<ExtractedComp[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  if (!emails || emails.length === 0) return [];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Cap to keep the prompt bounded; emails are pre-sorted newest-first upstream.
  const batch = emails.slice(0, 40);

  const lines = batch.map((e, i) =>
    `E${i}. MSGID=${e.msgId} | DATE=${(e.date || "").slice(0, 10)} | FROM=${(e.from || "").slice(0, 60)}
   SUBJ: ${(e.subject || "").slice(0, 200)}
   PREV: ${(e.preview || "").slice(0, 400)}`
  ).join("\n\n");

  const systemPrompt = `You extract structured retail-leasing comps from property agent emails.

A retail leasing comp is a record of a SHOP / F&B / retail-unit lease transaction — either agreed, completed, or openly quoted — with enough numeric detail to be useful (rent or area or both).

ONLY extract items that are clearly retail or F&B lettings. Skip: office lettings unless they're retail-with-upper-offices, investment sales, residential, pure availability/marketing with no deal, internal chatter.

Return a JSON array. Each item:
{
  "address": string,            // best address we can find — building name + street, or street + unit
  "postcode": string | null,
  "tenant": string | null,      // the incoming occupier
  "landlord": string | null,
  "useClass": string | null,    // "E", "Sui Generis", "A3", etc
  "sector": string | null,      // "Restaurant", "Fashion", "Coffee", "Health & Beauty", etc
  "rentPa": number | null,      // £/year total
  "rentPsf": number | null,     // £/sqft/year
  "areaSqft": number | null,
  "premium": number | null,
  "rentFreeMonths": number | null,
  "leaseDate": "YYYY-MM-DD" | null,   // completion / exchange / agreed date
  "termYears": number | null,
  "breakYears": number | null,
  "agent": string | null,
  "notes": string | null,       // 1 short sentence
  "confidence": number,         // 0.0–1.0 — how sure are you this is a real retail comp
  "sourceMsgId": string          // MUST match the MSGID we gave you
}

If an email does NOT contain a retail lease comp, omit it. Return ONLY the JSON array, no prose, no markdown fences.`;

  const userPrompt = `Subject property: ${ctx.address}${ctx.postcode ? `, ${ctx.postcode}` : ""}

Emails:
${lines}`;

  try {
    const response = await client.messages.create({
      model: HELPER_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    // Be forgiving about accidental code-fence wrapping.
    const cleaned = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
    const firstBracket = cleaned.indexOf("[");
    const lastBracket = cleaned.lastIndexOf("]");
    if (firstBracket === -1 || lastBracket === -1) return [];
    const jsonStr = cleaned.slice(firstBracket, lastBracket + 1);
    const raw = JSON.parse(jsonStr) as any[];

    const byMsg = new Map(batch.map((e) => [e.msgId, e]));
    const out: ExtractedComp[] = [];
    for (const r of raw) {
      if (!r || typeof r !== "object") continue;
      if (!r.address) continue;
      const conf = Number(r.confidence);
      if (!Number.isFinite(conf) || conf < 0.4) continue;
      const source = byMsg.get(r.sourceMsgId);
      if (!source) continue;
      out.push({
        address: String(r.address),
        postcode: r.postcode || undefined,
        tenant: r.tenant || undefined,
        landlord: r.landlord || undefined,
        useClass: r.useClass || undefined,
        sector: r.sector || undefined,
        rentPa: numOrUndef(r.rentPa),
        rentPsf: numOrUndef(r.rentPsf),
        areaSqft: numOrUndef(r.areaSqft),
        premium: numOrUndef(r.premium),
        rentFreeMonths: numOrUndef(r.rentFreeMonths),
        leaseDate: r.leaseDate || undefined,
        termYears: numOrUndef(r.termYears),
        breakYears: numOrUndef(r.breakYears),
        agent: r.agent || undefined,
        notes: r.notes || undefined,
        confidence: conf,
        sourceMsgId: r.sourceMsgId,
        sourceSubject: source.subject,
        sourceDate: source.date,
      });
    }
    return out;
  } catch (err: any) {
    console.warn("[retail-comps-extractor] claude call failed:", err?.message);
    return [];
  }
}

function numOrUndef(v: any): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Ensures the retail_leasing_comps table exists. Cheap IF NOT EXISTS on
 * boot — mirrors how other modules in this repo bootstrap DDL.
 */
export async function ensureRetailLeasingCompsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS retail_leasing_comps (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      address TEXT NOT NULL,
      postcode TEXT,
      outward_code TEXT,
      submarket TEXT,
      tenant TEXT,
      landlord TEXT,
      use_class TEXT,
      sector TEXT,
      rent_pa REAL,
      rent_psf REAL,
      area_sqft REAL,
      premium REAL,
      rent_free_months REAL,
      lease_date TEXT,
      term_years REAL,
      break_years REAL,
      source_type TEXT,
      source_id TEXT,
      source_ref TEXT,
      source_date TEXT,
      agent TEXT,
      notes TEXT,
      confidence REAL,
      dedupe_key TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT NOW(),
      created_by TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rlc_postcode ON retail_leasing_comps (postcode)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rlc_outward ON retail_leasing_comps (outward_code)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rlc_lease_date ON retail_leasing_comps (lease_date)`);
}

/**
 * Upserts extracted comps. Dedupes by `dedupe_key` (addressNorm|tenant|YYYY-MM).
 * Returns the number of rows actually inserted (ignores conflicts).
 */
export async function upsertExtractedComps(
  comps: ExtractedComp[],
  opts: { submarket?: string; createdBy?: string } = {},
): Promise<number> {
  if (!comps.length) return 0;
  let inserted = 0;
  for (const c of comps) {
    const key = makeDedupeKey(c);
    const res = await pool.query(
      `INSERT INTO retail_leasing_comps (
         address, postcode, outward_code, submarket, tenant, landlord,
         use_class, sector, rent_pa, rent_psf, area_sqft, premium,
         rent_free_months, lease_date, term_years, break_years,
         source_type, source_id, source_ref, source_date,
         agent, notes, confidence, dedupe_key, created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
         $17,$18,$19,$20,$21,$22,$23,$24,$25
       )
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        c.address,
        c.postcode || null,
        outwardCode(c.postcode) || null,
        opts.submarket || null,
        c.tenant || null,
        c.landlord || null,
        c.useClass || null,
        c.sector || null,
        c.rentPa ?? null,
        c.rentPsf ?? null,
        c.areaSqft ?? null,
        c.premium ?? null,
        c.rentFreeMonths ?? null,
        c.leaseDate || null,
        c.termYears ?? null,
        c.breakYears ?? null,
        "email",
        c.sourceMsgId,
        c.sourceSubject,
        c.sourceDate,
        c.agent || null,
        c.notes || null,
        c.confidence,
        key,
        opts.createdBy || null,
      ],
    );
    if ((res.rowCount || 0) > 0) inserted++;
  }
  return inserted;
}

/**
 * Look up retail leasing comps near a postcode. Matches full postcode first,
 * falls back to outward code. Returns up to `limit` most-recent rows.
 */
export async function findNearbyComps(
  postcode: string,
  limit = 20,
): Promise<any[]> {
  const out = outwardCode(postcode);
  if (!postcode && !out) return [];
  const { rows } = await pool.query(
    `SELECT * FROM retail_leasing_comps
       WHERE ($1::text IS NOT NULL AND postcode = $1)
          OR ($2::text IS NOT NULL AND outward_code = $2)
       ORDER BY COALESCE(lease_date, source_date) DESC NULLS LAST, created_at DESC
       LIMIT $3`,
    [postcode || null, out || null, limit],
  );
  return rows;
}
