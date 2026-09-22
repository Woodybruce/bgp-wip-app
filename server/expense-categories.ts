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
  // Codes aligned to the September 2026 chart of accounts from Accounts
  // (reference copy: server/assets/xero-chart-of-accounts-2026-09.csv).
  // Live Xero stays the source of truth (getExpenseCategories); this static
  // map is only the fallback when Xero is unreachable or a name doesn't match.
  "Client Entertainment":           { code: "7403", name: "Client Entertainment" },
  "Agent Entertainment (External)": { code: "740321", name: "Agent Entertainment" },
  "Staff Entertainment":            { code: "740319", name: "Staff Entertainment" },
  "Directors Meetings":             { code: "740320", name: "Directors Meetings" },
  "Subsistence":                    { code: "74017", name: "Subsistence" },
  "Meals & Drinks":                 { code: "74017", name: "Subsistence" },
  "Travel - Train":                 { code: "74015", name: "Trains" },
  "Travel - Tube":                  { code: "74016", name: "Tube" },
  "Travel - Taxi":                  { code: "74014", name: "Taxi" },
  "Travel - Flights":               { code: "74011", name: "Flights" },
  "Travel - Hotels":                { code: "74013", name: "Hotels" },
  "Travel - Car Hire":              { code: "74012", name: "Car Hire" },
  "Travel - Parking & Tolls":       { code: "74018", name: "Parking & Tolls" },
  "Travel - TFL Bike":              { code: "74019", name: "TFL Bike" },
  "Mileage Claims (HMRC 45p)":      { code: "7306", name: "Mileage Claims" },
  "Marketing & Advertising":        { code: "6201", name: "Advertising" },
  "PR (Literature & Brochures)":    { code: "6203", name: "PR (literature & brochures)" },
  "Advertising":                    { code: "6201", name: "Advertising" },
  "Office Supplies / Stationery":   { code: "750401", name: "Office Supplies/Stationery" },
  "Office Expenses (general)":      { code: "750401", name: "Office Supplies/Stationery" },
  "Office Supplies - Equipment":    { code: "750402", name: "Office Supplies - Equipment" },
  "Printing - Pitch Documents":     { code: "750001", name: "Printing - Pitch Documents" },
  "Printing - Non Day to Day":      { code: "750002", name: "Printing - Non Day to Day" },
  "Printing BGP Own":               { code: "7500", name: "Printing BGP Own" },
  "Software (subscriptions)":       { code: "750301", name: "Subscriptions - IT Charges/Software" },
  "IT Charges":                     { code: "750301", name: "Subscriptions - IT Charges/Software" },
  // Computer Equipment is capitalised to a balance-sheet fixed-asset account
  // (0032), not a P&L expense code. This map entry lets it past the poster's
  // isKnownExpenseCode guard; BALANCE_SHEET_ALLOWLIST (below) surfaces it in
  // the live picker, which otherwise only lists expense-type accounts.
  "Computer Equipment":             { code: "0032", name: "Computer Equipment Additions" },
  "Mobile Phone":                   { code: "750202", name: "Mobile Phone" },
  "Phone & Internet":               { code: "750201", name: "Telephone" },
  "WIFI":                           { code: "750203", name: "WIFI" },
  "Postage & Carriage":             { code: "7501", name: "Postage & Carriage" },
  "Premises Expenses":              { code: "7803", name: "Premises Expenses" },
  "Room Hire":                      { code: "7106", name: "Room Hire" },
  "RICS Fees":                      { code: "820101", name: "Subscriptions - RICS" },
  "Training":                       { code: "8203", name: "Training" },
  "Seminar/Conferences":            { code: "820201", name: "Seminar/Conferences" },
  "Winter Conference":              { code: "820208", name: "Winter Conference" },
  "Subscriptions - Magazines/Memberships": { code: "820102", name: "Subscriptions - Magazines/Memberships" },
  "Staff Gifts":                    { code: "6202", name: "Staff & Client Gifts" },
  "Client Gifts":                   { code: "6202", name: "Staff & Client Gifts" },
  "Donations":                      { code: "8200", name: "Donations" },
  "Land Registry":                  { code: "6302", name: "Land Registry" },
  "Flu Jabs & Covid Tests":         { code: "7014", name: "Flu Jabs & Covid Tests" },
  "Eye Tests":                      { code: "7017", name: "Eye Tests" },
  "Equipment Hire":                 { code: "7700", name: "Equipment Hire" },
  "Repairs & Maintenance":          { code: "7800", name: "Repairs & Maintenance" },
  "Cleaning":                       { code: "7801", name: "Cleaning" },
  "Bank Fees":                      { code: "7901", name: "Bank Fees" },
  "Legal & Professional Fees":      { code: "7600", name: "Legal & Professional Fees" },
  "Consultancy Fees":               { code: "7602", name: "Consultancy Fees" },
  "Motor Vehicle Expenses":         { code: "7304", name: "Motor Vehicle Expenses" },
  "Client Recharges":               { code: "6300", name: "Client Recharges" },
  // No "Other Expenses" nominal on the 2026 chart — an unmatched category
  // must be coded properly before posting (the poster's guard enforces it).
  "Personal (deduct from payroll)": { code: "1106", name: "Personal/Staff Loan" },
  "Sainsburys / Tesco / Ocado":     { code: "8205", name: "Sainsburys/Tesco/Ocado" },
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

// Balance-sheet / non-P&L accounts that should still appear in the expense
// picker even though their Xero account Type isn't a P&L expense type:
//   0032  Computer Equipment (fixed asset — capitalised)
//   1106  Personal (deduct from payroll)
const BALANCE_SHEET_ALLOWLIST = new Set(["0032", "1106"]);

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
        .filter((a: any) => a.Status === "ACTIVE" && (EXPENSE_TYPES.has(a.Type) || BALANCE_SHEET_ALLOWLIST.has(String(a.Code))))
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
