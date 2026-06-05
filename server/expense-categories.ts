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
  "Client Entertainment":           { code: "410", name: "Client Entertainment" },
  "Agent Entertainment (External)": { code: "411", name: "Agent Entertainment (External)" },
  "Staff Entertainment":            { code: "412", name: "Staff Entertainment" },
  "Directors Meetings":             { code: "413", name: "Directors Meetings" },
  "Subsistence":                    { code: "415", name: "Subsistence" },
  "Meals & Drinks":                 { code: "416", name: "Meals & Drinks" },
  "Travel - Train":                 { code: "471", name: "Travel - Train" },
  "Travel - Tube":                  { code: "472", name: "Travel - Tube" },
  "Travel - Taxi":                  { code: "473", name: "Travel - Taxi" },
  "Travel - Flights":               { code: "474", name: "Travel - Flights" },
  "Travel - Hotels":                { code: "475", name: "Travel - Hotels" },
  "Travel - Car Hire":              { code: "476", name: "Travel - Car Hire" },
  "Travel - Parking & Tolls":       { code: "477", name: "Travel - Parking & Tolls" },
  "Travel - TFL Bike":              { code: "478", name: "Travel - TFL Bike" },
  "Mileage Claims (HMRC 45p)":      { code: "479", name: "Mileage Claims (HMRC 45p)" },
  "Marketing & Advertising":        { code: "480", name: "Marketing & Advertising" },
  "PR (Literature & Brochures)":    { code: "481", name: "PR (Literature & Brochures)" },
  "Advertising":                    { code: "482", name: "Advertising" },
  "Office Supplies / Stationery":   { code: "500", name: "Office Supplies / Stationery" },
  "Office Expenses (general)":      { code: "501", name: "Office Expenses (general)" },
  "Printing - Pitch Documents":     { code: "512", name: "Printing - Pitch Documents" },
  "Software (subscriptions)":       { code: "600", name: "Software (subscriptions)" },
  "IT Charges":                     { code: "601", name: "IT Charges" },
  "Mobile Phone":                   { code: "611", name: "Mobile Phone" },
  "Phone & Internet":               { code: "612", name: "Phone & Internet" },
  "Premises Expenses":              { code: "700", name: "Premises Expenses" },
  "RICS Fees":                      { code: "750", name: "RICS Fees" },
  "Training":                       { code: "751", name: "Training" },
  "Subscriptions - Magazines/Memberships": { code: "753", name: "Subscriptions - Magazines/Memberships" },
  "Staff Gifts":                    { code: "780", name: "Staff Gifts" },
  "Client Gifts":                   { code: "781", name: "Client Gifts" },
  "Other Expenses":                 { code: "900", name: "Other Expenses" },
  "Personal (deduct from payroll)": { code: "910", name: "Personal (deduct from payroll)" },
  "Sainsburys / Tesco / Ocado":     { code: "503", name: "Sainsburys / Tesco / Ocado" },
};

export type ExpenseCategory = {
  code: string;        // Xero account code, e.g. "410"
  name: string;        // Xero account name, e.g. "Client Entertainment"
  type?: string;       // Xero account Type (EXPENSE | OVERHEADS | ...)
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

/**
 * Resolve a category name to a Xero account code. Prefers the live Xero
 * list; falls back to the static map for names that have been renamed or
 * removed in Xero (so historic expense rows still post against the right
 * code on retry).
 */
export async function getCategoryCode(name: string): Promise<string | undefined> {
  if (!name) return undefined;
  const list = await getExpenseCategories();
  const live = list.find(c => c.name === name);
  if (live) return live.code;
  return EXPENSE_CATEGORY_MAP[name]?.code;
}

/** Cheap synchronous lookup against the static map. Use when async isn't
 *  worth it (e.g. in a tight Xero-post path that already has the code). */
export function getCategoryCodeStatic(name: string): string | undefined {
  return EXPENSE_CATEGORY_MAP[name]?.code;
}

export function invalidateCache(): void {
  cached = null;
}
