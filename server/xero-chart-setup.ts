/**
 * Xero Chart of Accounts + Tracking Categories Setup
 * ===================================================
 *
 * One-shot provisioning of BGP's Xero chart of accounts.
 * Idempotent: existing accounts are skipped, new ones created.
 * Pushes ~50 accounts and 2 tracking categories.
 *
 * VAT/Tax treatment follows HMRC rules:
 *   - Client Entertainment: NONE (input VAT not recoverable, disallowed corp tax)
 *   - Donations / Trivial Benefits / Mileage: NONE
 *   - Flights: ZERORATEDINPUT (international zero-rated)
 *   - Most expenses: INPUT2 (20% standard recoverable)
 */
import { xeroApi } from "./xero";

type XeroAccountType =
  | "REVENUE"
  | "DIRECTCOSTS"
  | "EXPENSE"
  | "OVERHEADS"
  | "CURRENT"
  | "CURRLIAB"
  | "FIXED";

type XeroTaxType =
  | "INPUT2"          // 20% input VAT (recoverable)
  | "OUTPUT2"         // 20% output VAT
  | "ZERORATEDINPUT"  // 0% input
  | "ZERORATEDOUTPUT" // 0% output
  | "NONE"            // No VAT
  | "EXEMPTINPUT";    // VAT exempt

interface AccountSpec {
  code: string;
  name: string;
  type: XeroAccountType;
  tax: XeroTaxType;
  description?: string;
}

const CHART: AccountSpec[] = [
  // Revenue 200s
  { code: "200", name: "Sales - Agency Fees",       type: "REVENUE", tax: "OUTPUT2" },
  { code: "210", name: "Sales - Investment Fees",   type: "REVENUE", tax: "OUTPUT2" },
  { code: "220", name: "Sales - Professional Fees", type: "REVENUE", tax: "OUTPUT2" },
  { code: "225", name: "Sales - Consultant Fees",    type: "REVENUE", tax: "OUTPUT2" },
  { code: "230", name: "Client Recharges (income)", type: "REVENUE", tax: "OUTPUT2" },

  // Entertainment 410s — split for HMRC corp tax & VAT rules
  { code: "410", name: "Client Entertainment",            type: "OVERHEADS", tax: "NONE",   description: "HMRC: VAT not recoverable, disallowed for corporation tax" },
  { code: "411", name: "Agent Entertainment (External)",  type: "OVERHEADS", tax: "INPUT2", description: "HMRC: allowable for corp tax" },
  { code: "412", name: "Staff Entertainment",             type: "OVERHEADS", tax: "INPUT2", description: "P11D-watched, taxable benefit if >£150/head/year" },
  { code: "413", name: "Directors Meetings",              type: "OVERHEADS", tax: "INPUT2" },
  { code: "415", name: "Subsistence",                     type: "OVERHEADS", tax: "INPUT2" },
  { code: "416", name: "Meals & Drinks",                  type: "OVERHEADS", tax: "INPUT2" },

  // Travel 470s
  { code: "470", name: "Travel - General",          type: "OVERHEADS", tax: "INPUT2" },
  { code: "471", name: "Travel - Train",            type: "OVERHEADS", tax: "INPUT2" },
  { code: "472", name: "Travel - Tube",             type: "OVERHEADS", tax: "INPUT2" },
  { code: "473", name: "Travel - Taxi",             type: "OVERHEADS", tax: "INPUT2" },
  { code: "474", name: "Travel - Flights",          type: "OVERHEADS", tax: "ZERORATEDINPUT" },
  { code: "475", name: "Travel - Hotels",           type: "OVERHEADS", tax: "INPUT2" },
  { code: "476", name: "Travel - Car Hire",         type: "OVERHEADS", tax: "INPUT2" },
  { code: "477", name: "Travel - Parking & Tolls",  type: "OVERHEADS", tax: "INPUT2" },
  { code: "478", name: "Travel - TFL Bike",         type: "OVERHEADS", tax: "INPUT2" },
  { code: "479", name: "Mileage Claims (HMRC 45p)", type: "OVERHEADS", tax: "NONE", description: "HMRC approved mileage rate, 45p/mile first 10k, 25p thereafter" },

  // Marketing 480s
  { code: "480", name: "Marketing & Advertising",   type: "OVERHEADS", tax: "INPUT2" },
  { code: "481", name: "PR (Literature & Brochures)", type: "OVERHEADS", tax: "INPUT2" },
  { code: "482", name: "Advertising",               type: "OVERHEADS", tax: "INPUT2" },

  // Office 500s
  { code: "500", name: "Office Supplies / Stationery", type: "OVERHEADS", tax: "INPUT2" },
  { code: "501", name: "Office Expenses (general)",    type: "OVERHEADS", tax: "INPUT2" },
  { code: "502", name: "Postage & Carriage",           type: "OVERHEADS", tax: "INPUT2" },
  { code: "503", name: "Sainsburys / Tesco / Ocado",   type: "OVERHEADS", tax: "INPUT2" },
  { code: "510", name: "Printing - Day to Day (BGP own)", type: "OVERHEADS", tax: "INPUT2" },
  { code: "511", name: "Printing - Non Day to Day",    type: "OVERHEADS", tax: "INPUT2" },
  { code: "512", name: "Printing - Pitch Documents",   type: "OVERHEADS", tax: "INPUT2", description: "Often rechargeable to client" },
  { code: "520", name: "Winter Conference",            type: "OVERHEADS", tax: "INPUT2" },

  // IT & Phone 600s
  { code: "600", name: "Software (subscriptions)",  type: "OVERHEADS", tax: "INPUT2" },
  { code: "601", name: "IT Charges",                type: "OVERHEADS", tax: "INPUT2" },
  { code: "610", name: "WiFi",                      type: "OVERHEADS", tax: "INPUT2" },
  { code: "611", name: "Mobile Phone",              type: "OVERHEADS", tax: "INPUT2" },
  { code: "612", name: "Phone & Internet",          type: "OVERHEADS", tax: "INPUT2" },

  // Premises 700s
  { code: "700", name: "Premises Expenses",         type: "OVERHEADS", tax: "INPUT2" },
  { code: "710", name: "Room Hire",                 type: "OVERHEADS", tax: "INPUT2" },

  // Professional / Staff 750s
  { code: "750", name: "RICS Fees",                 type: "OVERHEADS", tax: "NONE" },
  { code: "751", name: "Training",                  type: "OVERHEADS", tax: "INPUT2" },
  { code: "752", name: "Seminars / Conferences",    type: "OVERHEADS", tax: "INPUT2" },
  { code: "753", name: "Subscriptions - Magazines/Memberships", type: "OVERHEADS", tax: "INPUT2" },
  { code: "760", name: "Flu Jabs & Covid Tests",    type: "OVERHEADS", tax: "NONE" },
  { code: "761", name: "Eye Tests",                 type: "OVERHEADS", tax: "NONE" },
  { code: "770", name: "Donations",                 type: "OVERHEADS", tax: "NONE" },
  { code: "780", name: "Staff Gifts",               type: "OVERHEADS", tax: "NONE", description: "HMRC trivial benefits ≤£50 per gift if rules met" },
  { code: "781", name: "Client Gifts",              type: "OVERHEADS", tax: "NONE" },

  // Fixed Asset Additions 800s
  { code: "800", name: "Computer Equipment Additions", type: "FIXED", tax: "INPUT2" },
  { code: "801", name: "Furniture Additions",          type: "FIXED", tax: "INPUT2" },
  { code: "802", name: "Office Supplies - Equipment",  type: "FIXED", tax: "INPUT2" },
  { code: "803", name: "Equipment & Hardware",         type: "FIXED", tax: "INPUT2" },

  // Other / Balance Sheet
  { code: "900",  name: "Other Expenses",                type: "OVERHEADS", tax: "INPUT2" },
  { code: "910",  name: "Personal (deduct from payroll)", type: "OVERHEADS", tax: "NONE", description: "Personal spend on company card — recovered via payroll deduction" },
  { code: "1100", name: "Client Recharges (debtors)",    type: "CURRENT",   tax: "NONE", description: "Rechargeable expenses awaiting re-billing to client" },
  { code: "1300", name: "Interco - BGP 55 Wells",        type: "CURRENT",   tax: "NONE" },
];

const TRACKING_CATEGORIES = [
  { name: "Property / Deal", options: [] as string[] }, // populated dynamically from CRM
  { name: "Team Member",     options: ["Woody", "Layla", "Charlotte", "Jack", "Rupert"] },
];

export interface ChartSetupResult {
  accounts: { created: number; skipped: number; failed: { code: string; error: string }[] };
  trackingCategories: { created: number; skipped: number; failed: { name: string; error: string }[] };
}

export async function initialiseXeroChart(session: any): Promise<ChartSetupResult> {
  const result: ChartSetupResult = {
    accounts: { created: 0, skipped: 0, failed: [] },
    trackingCategories: { created: 0, skipped: 0, failed: [] },
  };

  // Fetch existing accounts so we don't duplicate
  let existingCodes = new Set<string>();
  try {
    const existing = await xeroApi(session, "/Accounts");
    for (const acc of existing.Accounts || []) {
      if (acc.Code) existingCodes.add(String(acc.Code));
    }
    console.log(`[xero-chart] Found ${existingCodes.size} existing accounts`);
  } catch (e: any) {
    console.warn(`[xero-chart] Could not fetch existing accounts: ${e?.message}`);
  }

  // Push accounts
  for (const acc of CHART) {
    if (existingCodes.has(acc.code)) {
      result.accounts.skipped++;
      continue;
    }
    try {
      await xeroApi(session, "/Accounts", {
        method: "PUT",
        body: JSON.stringify({
          Code: acc.code,
          Name: acc.name,
          Type: acc.type,
          TaxType: acc.tax,
          Description: acc.description || undefined,
          ShowInExpenseClaims: acc.type === "OVERHEADS" || acc.type === "EXPENSE",
        }),
      });
      result.accounts.created++;
      console.log(`[xero-chart] Created ${acc.code} ${acc.name}`);
    } catch (e: any) {
      result.accounts.failed.push({ code: acc.code, error: e?.message || String(e) });
      console.error(`[xero-chart] Failed ${acc.code}: ${e?.message}`);
    }
  }

  // Tracking categories
  let existingCats = new Map<string, string>(); // name → ID
  try {
    const cats = await xeroApi(session, "/TrackingCategories");
    for (const c of cats.TrackingCategories || []) {
      existingCats.set(c.Name, c.TrackingCategoryID);
    }
  } catch (e: any) {
    console.warn(`[xero-chart] Could not fetch tracking categories: ${e?.message}`);
  }

  for (const cat of TRACKING_CATEGORIES) {
    let catId = existingCats.get(cat.name);
    if (catId) {
      result.trackingCategories.skipped++;
    } else {
      try {
        const created = await xeroApi(session, "/TrackingCategories", {
          method: "PUT",
          body: JSON.stringify({ Name: cat.name }),
        });
        catId = created.TrackingCategories?.[0]?.TrackingCategoryID;
        result.trackingCategories.created++;
      } catch (e: any) {
        result.trackingCategories.failed.push({ name: cat.name, error: e?.message || String(e) });
        continue;
      }
    }

    // Add options
    if (catId && cat.options.length > 0) {
      for (const opt of cat.options) {
        try {
          await xeroApi(session, `/TrackingCategories/${catId}/Options`, {
            method: "PUT",
            body: JSON.stringify({ Options: [{ Name: opt }] }),
          });
        } catch (e: any) {
          // Likely already exists — Xero returns 400 on duplicate option
          console.log(`[xero-chart] Option "${opt}" on ${cat.name}: ${e?.message}`);
        }
      }
    }
  }

  console.log(`[xero-chart] Done — accounts: ${result.accounts.created} created, ${result.accounts.skipped} skipped, ${result.accounts.failed.length} failed; categories: ${result.trackingCategories.created} created`);
  return result;
}

/**
 * Sync the Property/Deal tracking category options from CRM.
 * Call this whenever a new deal/property is added so Xero stays in sync.
 */
export async function syncPropertyDealTrackingOptions(session: any, dealNames: string[]): Promise<void> {
  const cats = await xeroApi(session, "/TrackingCategories");
  const propCat = (cats.TrackingCategories || []).find((c: any) => c.Name === "Property / Deal");
  if (!propCat) throw new Error("Property / Deal tracking category not found — run initialiseXeroChart first");

  const existing = new Set((propCat.Options || []).map((o: any) => o.Name));
  for (const name of dealNames) {
    if (existing.has(name)) continue;
    try {
      await xeroApi(session, `/TrackingCategories/${propCat.TrackingCategoryID}/Options`, {
        method: "PUT",
        body: JSON.stringify({ Options: [{ Name: name }] }),
      });
    } catch (e: any) {
      console.warn(`[xero-chart] Option ${name}: ${e?.message}`);
    }
  }
}
