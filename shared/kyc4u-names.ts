// Which companies a KYC4U request is about, by name (Woody, 25 November 2026:
// "these guys should have been KYC4U but saying there isn't one"). KYC4U's
// request REQ103894, "SHEET ANCHOR EVOLVE LONDON LIMITED", was read in on
// 21 November and matched by the short name "Sheet Anchor", because the Sheet
// Anchor Evolve (London) Ltd record was only added on 24 November; its window
// then said KYC4U held no check. A request is about the company it is named
// for and every company KYC4U filed in a folder of its own inside it (the
// companies up the chain: "SHEET ANCHOR PROPERTIES LIMITED"), so it shows on
// each record whose registered company it names, wherever the matcher filed it.
//
// Registered names only (the record's own registered name and the companies
// filed under it), compared with every word kept and the legal form aside
// (legalNameKey: "Braeburn Estates (Holdings) Limited" is another company).
// Never a brand or display name, never a shortened name.

import { legalNameKey } from "./deal-hots";

// A folder is a company's when its name carries a legal form; KYC4U's other
// folders are headings ("1.0 HOTs", "Emails", "Instructing Party").
const LEGAL_FORM = /\b(limited|ltd|plc|llp|lp|llc|inc|incorporated|gmbh|ag|sa|sas|sarl|s\.?a\.?r\.?l|bv|b\.v\.|nv|n\.v\.|spa|srl|ab|a\/s|aps|oy|kg|pty|corp|corporation)\b\.?/i;

const MIN_KEY = 4;

/** The folder names in a request's Sections field ("NAME 2 · NAME 1"), counts aside. */
export function kyc4uSectionNames(sections: unknown): string[] {
  return String(sections ?? "").split(" · ").map(s => s.replace(/\s+\d+$/, "").trim()).filter(Boolean);
}

/** The full names a request's entity can be read as: as given, its "_..._" aside dropped, and the part after "t/a". */
function entityNames(entity: unknown): string[] {
  const base = String(entity ?? "").replace(/\s+/g, " ").replace(/company (?:number|no\.?)\s*:?\s*[A-Z]{0,2}\d{6,8}/i, "").trim();
  if (!base) return [];
  const out = [base, base.replace(/_[^_]*_/g, " ").replace(/\s+/g, " ").trim()];
  const ta = base.match(/^(.*?)\s+t\/a\s+(.+)$/i);
  if (ta) out.push(ta[1].trim());
  return [...new Set(out.filter(Boolean))];
}

/** The registered-name keys a request is about: its entity, and each folder inside it named for a company. */
export function kyc4uRequestKeys(entityName: unknown, sections: unknown): string[] {
  const keys = new Set<string>();
  for (const n of entityNames(entityName)) { const k = legalNameKey(n); if (k.length >= MIN_KEY) keys.add(k); }
  for (const s of kyc4uSectionNames(sections)) {
    if (!LEGAL_FORM.test(s)) continue;
    const k = legalNameKey(s.replace(/_/g, " "));
    if (k.length >= MIN_KEY) keys.add(k);
  }
  return [...keys];
}

/** The keys of a record's registered companies: its own registered name and the companies filed under it. */
export function kyc4uCompanyKeys(names: Array<string | null | undefined>): string[] {
  const keys = new Set<string>();
  for (const n of names) { const k = legalNameKey(n || ""); if (k.length >= MIN_KEY) keys.add(k); }
  return [...keys];
}

/** True when the request names one of the record's registered companies. */
export function kyc4uRequestNames(requestKeys: string[], companyKeys: string[]): boolean {
  if (!requestKeys.length || !companyKeys.length) return false;
  const mine = new Set(companyKeys);
  return requestKeys.some(k => mine.has(k));
}
