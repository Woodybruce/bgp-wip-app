// The words for a company abroad's trace (21 November 2026): the parent note
// in the accounts and the GLEIF chain, as the AML box, KYC4U's note and the
// AML file say them. Kept apart from shared/foreign-owners.ts so that
// shared/kyc-prechecks.ts can use them: foreign-owners reads kyc-prechecks'
// name rules, and this file reads nothing but types.
import type { AbroadTrace, GleifEntity, ParentNoteLine, ParentRole, PrecheckGleif } from "./foreign-owners";

export const PARENT_ROLE_WORDS: Record<ParentRole, string> = {
  immediate: "immediate parent",
  ultimate: "ultimate parent",
  parent: "parent",
  largest_group: "parent of the largest group that consolidates it",
  smallest_group: "parent of the smallest group that consolidates it",
  controlling_party: "ultimate controlling party",
};

/** "the ultimate parent and the parent of the largest group that consolidates it". */
export const parentRolesWords = (roles: ParentRole[]): string => {
  const w = roles.map(r => PARENT_ROLE_WORDS[r]);
  return w.length < 2 ? w.join("") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;
};

/** One line for a reading: "KIRKBI A/S (Denmark): the ultimate parent ...". */
export function parentLineWords(line: ParentNoteLine): string {
  if (line.none) return "The accounts say there is no ultimate controlling party";
  return `${line.name}${line.country ? ` (${line.country})` : ""}: the ${parentRolesWords(line.roles)}`;
}

/** "KIRKBI A/S (Denmark): in GLEIF, owned or controlled by individuals". */
export function gleifTraceWords(t: Pick<AbroadTrace, "name" | "country" | "gleif">): string {
  const g = t.gleif;
  if (g.status === "skipped") return `${t.name} (${t.country}): not looked up in GLEIF`;
  if (g.status === "error") return `${t.name} (${t.country}): GLEIF could not be read${g.error ? ` (${g.error})` : ""}`;
  if (g.status === "ambiguous") return `${t.name} (${t.country}): GLEIF has ${g.candidates} entities of that name, so none is taken`;
  if (g.status === "not_found" || !g.entity) return `${t.name} (${t.country}): not in GLEIF (no LEI under that name or number)`;
  const chain = g.parents.length ? `; owned by ${g.parents.map(p => `${p.name}${p.jurisdiction ? ` (${p.jurisdiction})` : ""}`).join(", then ")}` : "";
  const lapsed = g.entity.leiStatus && g.entity.leiStatus !== "ISSUED" ? ` (LEI ${g.entity.leiStatus.toLowerCase()}${g.entity.lastUpdate ? `, last updated ${g.entity.lastUpdate}` : ""})` : "";
  return `${t.name} (${t.country}): in GLEIF as ${g.entity.name}, LEI ${g.entity.lei}${lapsed}${chain}${g.top ? `; at the top, ${g.top.words}` : ""}`;
}

// GLEIF's registration authorities for the UK's own registers (read from
// GLEIF's list on 21 November 2026). A UK company's LEI record names
// Companies House and its company number; a registered charity's names the
// Charity Commission and its charity number.
export type GleifUkRegisterKind = "companies_house" | "charity_commission" | "scottish_charity" | "mutuals" | "fca";
export const GLEIF_UK_REGISTERS: Record<string, { register: GleifUkRegisterKind; words: string }> = {
  RA000585: { register: "companies_house", words: "Companies House (England and Wales)" },
  RA000586: { register: "companies_house", words: "Companies House (Northern Ireland)" },
  RA000587: { register: "companies_house", words: "Companies House (Scotland)" },
  RA000588: { register: "mutuals", words: "the FCA's Mutuals Public Register" },
  RA000589: { register: "charity_commission", words: "the Charity Commission for England and Wales" },
  RA000590: { register: "scottish_charity", words: "the Scottish Charity Register (OSCR)" },
  RA000592: { register: "fca", words: "the FCA's Financial Services Register" },
};
export const COMPANIES_HOUSE_AUTHORITIES = ["RA000585", "RA000586", "RA000587"];

/** The UK register GLEIF records an entity on, or null (abroad, or not said). */
export const gleifUkRegister = (e: Pick<GleifEntity, "registeredAt"> | null | undefined): { register: GleifUkRegisterKind; words: string } | null =>
  (e?.registeredAt && GLEIF_UK_REGISTERS[e.registeredAt]) || null;

/** The party itself in GLEIF, in one line (21 November 2026: UK parties too). */
export function gleifPartyWords(g: PrecheckGleif): string {
  const t = g.trace;
  const as = g.by === "number" ? "its Companies House number" : `the name ${g.name}`;
  if (t.status === "skipped") return `GLEIF: not looked up${t.error ? ` (${t.error})` : ""}`;
  if (t.status === "error") return `GLEIF could not be read${t.error ? ` (${t.error})` : ""}`;
  if (t.status === "ambiguous") return `GLEIF has ${t.candidates} entities named ${g.name}, so none is taken`;
  if (t.status === "not_found" || !t.entity) return `Not in GLEIF (no LEI under ${as})`;
  const reg = gleifUkRegister(t.entity);
  const where = reg ? `on ${reg.words}${t.entity.registeredAs ? ` as ${t.entity.registeredAs}` : ""}` : `registered in ${t.entity.jurisdiction || t.entity.country || "a country GLEIF does not give"}`;
  const lapsed = t.entity.leiStatus && t.entity.leiStatus !== "ISSUED" ? ` (LEI ${t.entity.leiStatus.toLowerCase()}${t.entity.lastUpdate ? `, last updated ${t.entity.lastUpdate}` : ""})` : "";
  const chain = t.parents.length ? `; its parents in GLEIF: ${t.parents.map(p => `${p.name}${p.jurisdiction ? ` (${p.jurisdiction})` : ""}`).join(", then ")}` : "";
  return `GLEIF: ${t.entity.name}, LEI ${t.entity.lei}${lapsed}, ${where}, found by ${as}${chain}${t.top ? `; at the top, ${t.top.words}` : ""}`;
}
