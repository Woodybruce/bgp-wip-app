// The website scrape grabs "X Limited" with whatever came before it on the
// page — "of Boots UK Limited", "Copyright 2026 Wildstone Capital Limited",
// "Cookie Preferences Superdrug Stores plc", "s Chickenland Limited" (the
// tail of Nando’s). Keep only the trailing run of name words (Woody,
// 2026-09-27: ~70 brands had junk UK trading entities).
const SUFFIX = /^(?:limited|ltd\.?|plc|llp|lp)$/i;
const CONNECTOR = /^(?:and|of|&|the|for)$/i;
const STOP = /^(?:copyright|©|privacy|policy|terms|conditions|cookie|cookies|preferences|sitemap|accessibility|top|back|home|details|information|reserved|rights|registered|website|contact|about|menu|search|login|who|we|are|our|us|here|by|at|is|means|operated|owned|register|introduction|careers|app|purpose|download|read|more|close)$/i;
// Payment / finance providers named in site footers, never the brand's entity.
const THIRD_PARTY = /^(?:paypal|klarna|stripe|creation consumer finance|clearpay|adyen|worldpay|google payment)\b/i;

export function cleanEntityName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const tokens = String(raw).replace(/’/g, "'").replace(/\s+/g, " ").trim().split(" ");
  if (!tokens.length || !SUFFIX.test(tokens[tokens.length - 1].replace(/[.,]$/, "")) && !/\b(?:limited|ltd\.?|plc|llp|lp)\.?$/i.test(tokens[tokens.length - 1])) return null;
  const nameWord = (t: string) => /^[A-Z0-9(&]/.test(t) && !STOP.test(t.replace(/[.,:]$/, "")) && !/^\d{4}$/.test(t)
    && !/[,:]$/.test(t) && !(t.endsWith(".") && t.length > 4) && !/^[A-Z]{1,2}\d[A-Z\d]?$/.test(t) && !/^\d[A-Z]{2}$/.test(t) && !/^\d+(?:\.\d+)*\.?$/.test(t) && !/\d{5,}/.test(t);
  const out: string[] = [tokens[tokens.length - 1]];
  for (let i = tokens.length - 2; i >= 0; i--) {
    const t = tokens[i];
    if (SUFFIX.test(t)) break;                       // an earlier entity's suffix
    if (nameWord(t)) { out.unshift(t); continue; }
    if (CONNECTOR.test(t) && i > 0 && nameWord(tokens[i - 1])) { out.unshift(t); continue; }
    // "eurochange Ltd": a lower-case single word straight before the suffix.
    if (out.length === 1 && /^[a-z][a-z0-9-]+$/.test(t) && !STOP.test(t) && !CONNECTOR.test(t)) { out.unshift(t); }
    break;
  }
  while (out.length && CONNECTOR.test(out[0]) && !/^the$/i.test(out[0])) out.shift();
  const name = out.join(" ");
  if (out.length < 2 || THIRD_PARTY.test(name)) return null;
  return name;
}

// Only rewrite a stored name that is visibly page text — upper-case
// Companies House names ("INSOMNIA COOKIES UK LTD") and clean names are
// left alone. Returns the tidied name, null for a third-party provider,
// or the input unchanged.
const JUNK_START = /^(?:copyright|©|all rights reserved|privacy|policy|about|who we are|search|global network|thought leadership|download|here at|at |form\.|emap|on accessibility|mumbai|founder|comments|fall sincerely|jan |feb|february|youtube|school\.|policy)/i;
export function tidyScrapedEntityName(raw: string | null | undefined): string | null {
  if (!raw) return raw ?? null;
  const value = raw.replace(/\s+/g, " ").trim();
  const junk = /^[a-z]/.test(value) || JUNK_START.test(value) || /[a-z0-9]\.\s+\S/.test(value)
    || /\b(?:Cookie|Privacy|Copyright|Contact|Menu|Sitemap)\b/.test(value)
    // "Land 2026 The British Land Company PLC" — a copyright year mid-name.
    || /^[A-Z][a-z]+ (?:19|20)\d{2} (?:The )?[A-Z]/.test(value);
  if (THIRD_PARTY.test(value.replace(/^.*\b(?:by|of)\s+/i, ""))) return null;
  if (!junk || value === value.toUpperCase()) return value;
  const cleaned = cleanEntityName(value);
  return cleaned ?? value;
}
