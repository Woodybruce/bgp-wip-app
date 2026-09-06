/**
 * Receipt-AI learning memory.
 *
 * When the receipt parser (server/expense-receipt-parser.ts) gets a field
 * wrong and someone corrects it on the expense screen, the correction is
 * recorded here. Two things then improve future parses:
 *
 *   1. A deterministic merchant → category memory. Once someone fixes
 *      "Pret" from "Meals & Drinks" to "Subsistence", every later Pret
 *      receipt is forced to "Subsistence" after the vision call — whatever
 *      the model guesses. Exact, explainable, instant.
 *
 *   2. A free-text hint list (mirrors the document_design_preferences
 *      "house style" pattern) prepended to the parse prompt, so the harder
 *      lessons ("on Selfridges receipts the total is the bottom line, not
 *      the subtotal") nudge the model on the next read.
 *
 * The table is created at runtime (CREATE TABLE IF NOT EXISTS), the same
 * pattern as api_usage_log / system_settings — no shared/schema.ts change
 * and no migration, so it can't collide with Wendy's commission rules or
 * the deploy's migration set.
 */
import { pool } from "./db";

const FIELD = {
  merchant: "merchant",
  amount: "amount",
  date: "date",
  category: "category",
  note: "note",
} as const;
export type CorrectionField = keyof typeof FIELD;

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expense_receipt_corrections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      expense_id text,
      merchant_raw text,
      merchant_key text,
      field text NOT NULL,
      ai_value text,
      correct_value text,
      note text,
      corrected_by text,
      created_at timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_erc_merchant_key ON expense_receipt_corrections(merchant_key);
    CREATE INDEX IF NOT EXISTS idx_erc_field ON expense_receipt_corrections(field);
  `);
  tableReady = true;
}

// Group merchant variants ("PRET A MANGER #4502 LONDON", "Pret a Manger")
// under one key: letters + spaces only, collapsed, first 30 chars. Store
// numbers and card-terminal noise drop out. Matching is prefix-tolerant so
// "pret a manger" still hits "pret a manger london" (see matchKey below).
export function normaliseMerchant(name: string | null | undefined): string {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30);
}

function keysMatch(a: string, b: string): boolean {
  if (!a || !b || a.length < 4 || b.length < 4) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

// ── Caches — the parser reads these on every receipt, so keep them off the
// DB hot-path. 60s is plenty; corrections are rare and a one-minute lag
// before a new lesson applies is invisible in practice.
const CACHE_TTL_MS = 60_000;
let catCache: { at: number; rows: { key: string; category: string }[] } | null = null;
let hintCache: { at: number; text: string } | null = null;

function bustCaches() { catCache = null; hintCache = null; }

async function loadCategoryRows(): Promise<{ key: string; category: string }[]> {
  if (catCache && Date.now() - catCache.at < CACHE_TTL_MS) return catCache.rows;
  await ensureTable();
  // Most-recent corrected category per merchant key.
  const r = await pool.query<{ merchant_key: string; correct_value: string }>(
    `SELECT DISTINCT ON (merchant_key) merchant_key, correct_value
       FROM expense_receipt_corrections
      WHERE field = 'category' AND merchant_key <> '' AND correct_value IS NOT NULL
      ORDER BY merchant_key, created_at DESC
      LIMIT 200`,
  );
  const rows = r.rows.map((x) => ({ key: x.merchant_key, category: x.correct_value }));
  catCache = { at: Date.now(), rows };
  return rows;
}

/**
 * The category a human last assigned to this merchant, or null. Applied as
 * a deterministic override after the vision parse — but only when the
 * caller confirms it's still a real category (live Xero list).
 */
export async function learnedCategoryForMerchant(merchant: string | null | undefined): Promise<string | null> {
  const key = normaliseMerchant(merchant);
  if (!key) return null;
  try {
    const rows = await loadCategoryRows();
    const hit = rows.find((row) => keysMatch(key, row.key));
    return hit?.category || null;
  } catch (e: any) {
    console.warn("[expense-ai-memory] learnedCategoryForMerchant failed:", e?.message);
    return null;
  }
}

/**
 * Prompt fragment of accumulated lessons, prepended to the receipt-parse
 * prompt. Empty string when nothing's been learned yet (keeps the prompt
 * clean on a fresh deploy).
 */
export async function learnedReceiptHints(): Promise<string> {
  if (hintCache && Date.now() - hintCache.at < CACHE_TTL_MS) return hintCache.text;
  let text = "";
  try {
    await ensureTable();
    const cats = await loadCategoryRows();
    const notes = await pool.query<{ note: string }>(
      `SELECT DISTINCT note FROM expense_receipt_corrections
        WHERE field = 'note' AND note IS NOT NULL AND note <> ''
        ORDER BY note
        LIMIT 25`,
    );
    const lines: string[] = [];
    if (cats.length > 0) {
      lines.push("Merchant → category (a human corrected these before — match them):");
      for (const c of cats.slice(0, 40)) lines.push(`- if the merchant is "${c.key}" use category "${c.category}"`);
    }
    if (notes.rows.length > 0) {
      if (lines.length) lines.push("");
      lines.push("Lessons from past mistakes (apply where relevant):");
      for (const n of notes.rows) lines.push(`- ${n.note}`);
    }
    if (lines.length > 0) {
      text = ["", "---", "LEARNED CORRECTIONS (from this firm's own fixes — trust these over your defaults):", ...lines, "---"].join("\n");
    }
  } catch (e: any) {
    console.warn("[expense-ai-memory] learnedReceiptHints failed:", e?.message);
    text = "";
  }
  hintCache = { at: Date.now(), text };
  return text;
}

/**
 * Record a batch of field corrections (and/or a free-text note) for one
 * expense. `changes` carries what the AI had vs what the human set; only
 * fields that actually changed should be passed. Fire-and-forget safe —
 * failures are logged, never thrown, so a learning hiccup can't block a
 * user saving their expense.
 */
export async function recordReceiptCorrections(args: {
  expenseId?: string | null;
  merchant?: string | null;
  changes?: Array<{ field: CorrectionField; from: string | null; to: string | null }>;
  note?: string | null;
  userId?: string | null;
}): Promise<{ recorded: number }> {
  try {
    await ensureTable();
    const merchantRaw = args.merchant || null;
    const merchantKey = normaliseMerchant(merchantRaw);
    const rows: any[][] = [];
    for (const c of args.changes || []) {
      if (!c || !FIELD[c.field]) continue;
      if ((c.from || "") === (c.to || "")) continue; // no-op
      rows.push([args.expenseId || null, merchantRaw, merchantKey, c.field, c.from ?? null, c.to ?? null, null, args.userId || null]);
    }
    const note = (args.note || "").trim();
    if (note) rows.push([args.expenseId || null, merchantRaw, merchantKey, "note", null, null, note, args.userId || null]);
    if (rows.length === 0) return { recorded: 0 };

    const values: string[] = [];
    const params: any[] = [];
    rows.forEach((r, i) => {
      const b = i * 8;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`);
      params.push(...r);
    });
    await pool.query(
      `INSERT INTO expense_receipt_corrections
         (expense_id, merchant_raw, merchant_key, field, ai_value, correct_value, note, corrected_by)
       VALUES ${values.join(",")}`,
      params,
    );
    bustCaches();
    return { recorded: rows.length };
  } catch (e: any) {
    console.warn("[expense-ai-memory] recordReceiptCorrections failed:", e?.message);
    return { recorded: 0 };
  }
}

/**
 * What the system has learned, for the transparency panel. Returns the
 * merchant→category map plus the most recent free-text lessons.
 */
export async function getLearnedSummary(): Promise<{
  merchantCategories: { merchant: string; category: string }[];
  lessons: string[];
  totalCorrections: number;
}> {
  try {
    await ensureTable();
    const cats = await loadCategoryRows();
    const notes = await pool.query<{ note: string }>(
      `SELECT DISTINCT note FROM expense_receipt_corrections
        WHERE field = 'note' AND note IS NOT NULL AND note <> '' ORDER BY note LIMIT 50`,
    );
    const total = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM expense_receipt_corrections`);
    return {
      merchantCategories: cats.map((c) => ({ merchant: c.key, category: c.category })),
      lessons: notes.rows.map((n) => n.note),
      totalCorrections: Number(total.rows[0]?.n || 0),
    };
  } catch (e: any) {
    console.warn("[expense-ai-memory] getLearnedSummary failed:", e?.message);
    return { merchantCategories: [], lessons: [], totalCorrections: 0 };
  }
}
