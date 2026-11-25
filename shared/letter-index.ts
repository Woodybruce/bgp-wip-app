// The A to Z letters down the right of the AML page (Woody, 25 November 2026:
// "on the right side can you put letters alphabetic so can click and search
// companies and also transactions"). A name is under its first letter, accents
// aside; one that starts with a number, or has no letter at all, is under "#".
// "@Home pizza" is under H, "1 Rebel" under #.

export const INDEX_LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"] as const;
export type IndexLetter = (typeof INDEX_LETTERS)[number];

export const isIndexLetter = (v: unknown): v is IndexLetter => typeof v === "string" && (INDEX_LETTERS as readonly string[]).includes(v);

/** The letter a name is filed under. */
export function indexLetter(name: string | null | undefined): IndexLetter {
  const plain = String(name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const first = plain.match(/[A-Za-z0-9]/)?.[0];
  if (!first || /[0-9]/.test(first)) return "#";
  return first.toUpperCase() as IndexLetter;
}

/** How many names are under each letter. */
export function letterCounts(names: Array<string | null | undefined>): Record<IndexLetter, number> {
  const out = Object.fromEntries(INDEX_LETTERS.map(l => [l, 0])) as Record<IndexLetter, number>;
  for (const n of names) out[indexLetter(n)]++;
  return out;
}

/** A to Z by name, numbers in a name read as numbers ("2" before "10"). */
export const byName = (a: string, b: string): number => a.localeCompare(b, "en-GB", { sensitivity: "base", numeric: true });
