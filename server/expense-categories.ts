// Expense category catalogue. The historic source-of-truth was the
// static EXPENSE_CATEGORY_MAP in server/stripe-issuing.ts — 33 hardcoded
// `{ name, code }` pairs that Wendy couldn't edit without a deploy.
// This module makes Xero the source of truth instead: fetches the
// expense-side chart of accounts on demand, caches with a short TTL,
// and falls back to the static map if Xero is unreachable.
//
// The static map stays in place as the seed list (used when Xero is
// down or pre-bootstrap) and as the parser's training-time list for
// the receipt-categorisation prompt. Once Wendy has confirmed her
// Xero list is the truth, the static map can be retired.

import { xeroApiWithFallback } from "./xero";

// Static seed list (was historically defined in stripe-issuing.ts). Used as
// the fallback when Xero is unreachable / pre-bootstrap, and as the
// receipt-categorisation prompt's training list. Lives here now so the
// expense pipeline doesn't depend on the legacy Stripe module.
export const EXPENSE_CATEGORY_MAP: Record<string, { code: string; name: string }> = {
  // Codes aligned to the firm's live Xero chart of accounts (confirmed Jun 2026).
  // Live Xero stays the source of truth (getExpenseCategories); this static map
  // is only the fallback when Xero is unreachable or a name doesn't match.
  // Codes still marked "(seed)" below are pre-Xero guesses — they're protected
  // by the post-time guard until the full chart is supplied.
  "Client Entertainment":           { code: "7403", name: "Client Entertainment" },
  "Agent Entertainment (External)": { code: "740321", name: "Agent Entertainment (External)" },
  "Staff Entertainment":            { code: "740319", name: "Staff Entertainment" },
  "Directors Meetings":             { code: "413", name: "Directors Meetings" },           // seed
  "Subsistence":                    { code: "74017", name: "Subsistence" },
  "Meals & Drinks":                 { code: "416", name: "Meals & Drinks" },               // seed
  "Travel - Train":                 { code: "471", name: "Travel - Train" },               // seed
  "Travel - Tube":                  { code: "472", name: "Travel - Tube" },                // seed
  "Travel - Taxi":                  { code: "74014", name: "Travel - Taxi" },
  "Travel - Flights":               { code: "474", name: "Travel - Flights" },             // seed
  "Travel - Hotels":                { code: "475", name: "Travel - Hotels" },              // seed
  "Travel - Car Hire":              { code: "476", name: "Travel - Car Hire" },            // seed
  "Travel - Parking & Tolls":       { code: "477", name: "Travel - Parking & Tolls" },     // seed
  "Travel - TFL Bike":              { code: "74019", name: "Travel - TFL Bike" },
  "Mileage Claims (HMRC 45p)":      { code: "479", name: "Mileage Claims (HMRC 45p)" },     // seed
  "Marketing & Advertising":        { code: "480", name: "Marketing & Advertising" },      // seed
  "PR (Literature & Brochures)":    { code: "481", name: "PR (Literature & Brochures)" },  // seed
  "Advertising":                    { code: "482", name: "Advertising" },                  // seed
  "Office Supplies / Stationery":   { code: "500", name: "Office Supplies / Stationery" }, // seed
  "Office Expenses (general)":      { code: "501", name: "Office Expenses (general)" },     // seed
  "Printing - Pitch Documents":     { code: "512", name: "Printing - Pitch Documents" },   // seed
  "Software (subscriptions)":       { code: "750301", name: "Software (subscriptions)" },
  "IT Charges":                     { code: "750301", name: "IT Charges" },
  "Mobile Phone":                   { code: "611", name: "Mobile Phone" },                 // seed
  "Phone & Internet":               { code: "612", name: "Phone & Internet" },            // seed
  "Premises Expenses":              { code: "700", name: "Premises Expenses" },            // seed
  "RICS Fees":                      { code: "750", name: "RICS Fees" },                    // seed
  "Training":                       { code: "751", name: "Training" },                     // seed
  "Subscriptions - Magazines/Memberships": { code: "753", name: "Subscriptions - Magazines/Memberships" }, // seed
  "Staff Gifts":                    { code: "780", name: "Staff Gifts" },                  // seed
  "Client Gifts":                   { code: "781", name: "Client Gifts" },                 // seed
  "Other Expenses":                 { code: "900", name: "Other Expenses" },               // seed
  "Personal (deduct from payroll)": { code: "1106", name: "Personal (deduct from payroll)" },
  "Sainsburys / Tesco / Ocado":     { code: "8205", name: "Sainsburys / Tesco / Ocado" },
};

export type ExpenseCategory = {
  code: string;        // Xero account code, e.g. "410"
  name: string;        // Xero account name, e.g. "Client Entertainment"
  type?: string;       // Xero account Type (EXPENSE | OVERHEADS | ...)
  taxType?: string;    // Xero default TaxType, e.g. "INPUT2" / "NONE" / "ZERORATEDINPUT"
  description?: string;
};

// Xero account types we consider "expense-relevant" for the card / cash
// claim flow. DEPRECIATN intentionally excluded — it's not a thing you
// pay for on a Revolut card.
const EXPENSE_TYPES = new Set(["EXPENSE", "DIRECTCOSTS", "OVERHEADS", "OTHEREXPENSE"]);

const TTL_MS = 10 * 60 * 1000; // 10 min — Wendy can force-refresh

let cached: { categories: ExpenseCategory[]; fetchedAt: number } | null = null;
let inFlight: Promise<ExpenseCategory[]> | null = null;

function staticFallback(): ExpenseCategory[] {
  return Object.values(EXPENSE_CATEGORY_MAP).map(v => ({ code: v.code, name: v.name }));
}

export async function getExpenseCategories(opts?: { forceRefresh?: boolean }): Promise<ExpenseCategory[]> {
  const fresh = cached && Date.now() - cached.fetchedAt < TTL_MS && !opts?.forceRefresh;
  if (fresh) return cached!.categories;

  // De-duplicate concurrent callers — one in-flight fetch shared by all.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      // Use the system Xero session so this works from background jobs
      // (receipt parser, post-to-Xero) too, not just authed requests.
      const data = await xeroApiWithFallback(null, "/Accounts");
      const rows: ExpenseCategory[] = (data?.Accounts || [])
        .filter((a: any) => a.Status === "ACTIVE" && EXPENSE_TYPES.has(a.Type))
        .map((a: any) => ({
          code: String(a.Code),
          name: String(a.Name),
          type: a.Type,
          taxType: a.TaxType || undefined,
          description: a.Description || undefined,
        }))
        .sort((a: ExpenseCategory, b: ExpenseCategory) => a.code.localeCompare(b.code));

      if (rows.length === 0) {
        console.warn("[expense-categories] Xero returned 0 expense accounts — falling back to static map");
        cached = { categories: staticFallback(), fetchedAt: Date.now() };
      } else {
        cached = { categories: rows, fetchedAt: Date.now() };
      }
      return cached.categories;
    } catch (e: any) {
      console.warn("[expense-categories] Xero fetch failed, using static fallback:", e?.message);
      // Don't poison the cache with a failed fetch — leave any previous
      // good cache in place if there is one.
      return cached?.categories || staticFallback();
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

// Normalise a category/account name for matching — lowercase, and collapse
// any run of non-alphanumerics to a single space. So "Travel - Taxi",
// "travel taxi" and "Taxi " all compare equal, which stops a cosmetic name
// difference from silently dropping to the static fallback code.
function normaliseCategoryName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Resolve a category name to a Xero account code. Prefers the live Xero
 * list; falls back to the static map for names that have been renamed or
 * removed in Xero (so historic expense rows still post against the right
 * code on retry).
 */
export async function getCategoryCode(name: string): Promise<string | undefined> {
  if (!name) return undefined;
  const list = await getExpenseCategories();
  const exact = list.find(c => c.name === name);
  if (exact) return exact.code;
  // Fall back to a normalised match before the static map, so an app name
  // that differs only in case/spacing/punctuation from Xero's still resolves
  // to the real, live code rather than a stale seed value.
  const target = normaliseCategoryName(name);
  const fuzzy = list.find(c => normaliseCategoryName(c.name) === target);
  if (fuzzy) return fuzzy.code;
  return EXPENSE_CATEGORY_MAP[name]?.code;
}

/** Is this Xero account code one we recognise — either in the live chart
 *  (when Xero is reachable) or in the static seed map? Used by the poster as
 *  a guard so a junk/stale code never reaches Xero. When Xero is unreachable
 *  the live list IS the static map, so this still allows every seed code. */
export async function isKnownExpenseCode(code: string | null | undefined): Promise<boolean> {
  if (!code) return false;
  const c = String(code).trim();
  const list = await getExpenseCategories();
  if (list.some(x => x.code === c)) return true;
  return Object.values(EXPENSE_CATEGORY_MAP).some(v => v.code === c);
}

/** Cheap synchronous lookup against the static map. Use when async isn't
 *  worth it (e.g. in a tight Xero-post path that already has the code). */
export function getCategoryCodeStatic(name: string): string | undefined {
  return EXPENSE_CATEGORY_MAP[name]?.code;
}

export function invalidateCache(): void {
  cached = null;
}

// ── VAT / tax-type resolution ───────────────────────────────────────────────
// Per-category VAT treatment. The source of truth is Xero: each expense
// account carries a default TaxType, which we pull live (cached with the
// category list). This static map mirrors the firm's historic hardcoded rules
// and is the fallback when Xero is unreachable or an account has no tax type.
//
//   INPUT2          standard-rated input VAT (20%, reclaimable)
//   ZERORATEDINPUT  zero-rated purchases (e.g. flights) — 0%, nothing to reclaim
//   EXEMPTINPUT     exempt purchases — 0%, nothing to reclaim
//   NONE            no VAT / outside scope — used for irrecoverable input VAT
//                   (client entertainment) and no-VAT items (gifts, mileage…)
export function fallbackTaxType(category: string | null): string {
  if (!category) return "INPUT2";
  if (category === "Client Entertainment") return "NONE";
  if (category === "Travel - Flights") return "ZERORATEDINPUT";
  if (["Donations", "Staff Gifts", "Client Gifts", "RICS Fees", "Mileage Claims (HMRC 45p)",
       "Eye Tests", "Flu Jabs & Covid Tests", "Personal (deduct from payroll)"].includes(category)) {
    return "NONE";
  }
  return "INPUT2";
}

/** Resolve a category's Xero TaxType — live from Xero's chart of accounts,
 *  falling back to the static rules above. */
export async function getCategoryTaxType(name: string | null): Promise<string> {
  if (!name) return "INPUT2";
  try {
    const list = await getExpenseCategories();
    const live = list.find(c => c.name === name);
    if (live?.taxType) return live.taxType;
  } catch { /* fall through to static */ }
  return fallbackTaxType(name);
}

/** Display info for a tax type: is the input VAT reclaimable, and the rate %.
 *  Powers "VAT £x (20%, reclaimable)" vs "VAT £x (not reclaimable)". */
export function vatInfoForTaxType(taxType: string | null | undefined): { reclaimable: boolean; ratePct: number } {
  const t = (taxType || "").toUpperCase();
  if (t === "INPUT2" || t === "INPUT") return { reclaimable: true, ratePct: 20 };
  if (t === "RRINPUT") return { reclaimable: true, ratePct: 5 };
  if (t === "ZERORATEDINPUT") return { reclaimable: true, ratePct: 0 };
  return { reclaimable: false, ratePct: 0 };   // EXEMPTINPUT, NONE, unknown → not reclaimable
}

/** Effective reclaimability for a category, honouring a per-expense override.
 *  override === false forces the VAT into the cost (posts as TaxType NONE). */
export async function isCategoryVatReclaimable(name: string | null, override?: boolean | null): Promise<boolean> {
  if (override === false) return false;
  if (override === true) return true;
  return vatInfoForTaxType(await getCategoryTaxType(name)).reclaimable;
}
