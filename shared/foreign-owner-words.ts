// The words for a company abroad's trace (21 November 2026): the parent note
// in the accounts and the GLEIF chain, as the AML box, KYC4U's note and the
// AML file say them. Kept apart from shared/foreign-owners.ts so that
// shared/kyc-prechecks.ts can use them: foreign-owners reads kyc-prechecks'
// name rules, and this file reads nothing but types.
import type { AbroadTrace, ParentNoteLine, ParentRole } from "./foreign-owners";

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
