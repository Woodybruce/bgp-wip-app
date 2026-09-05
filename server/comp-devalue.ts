// ─────────────────────────────────────────────────────────────────────────
// Comp devaluation — headline package → net effective rent.
//
// UK agency convention: spread the incentives over the term certain
// (to the earliest break), i.e.
//
//   NER pa = (headline × (term − rentFree) − capital) / term
//
// where rentFree is in years and capital = capex + fit-out contribution.
// Comp fields are free-text imports ("£85,000 pa", "10 yrs (break 5th)",
// "6 months"), so every parse is best-effort and a comp that can't be
// read returns null rather than a wrong number.
// ─────────────────────────────────────────────────────────────────────────

const num = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const m = String(s).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

// "£85,000 pa" → {value, isPsf:false}; "£45 psf" / "£45 per sq ft" → isPsf.
function parseMoney(s: string | null | undefined): { value: number; isPsf: boolean } | null {
  const v = num(s);
  if (v === null || v <= 0) return null;
  const isPsf = /psf|per\s*sq|\/\s*sq|sq\s*ft|zone\s*a|za\b/i.test(String(s));
  return { value: v, isPsf };
}

// Rent free expressed in months unless it says weeks/years.
function parseRentFreeMonths(s: string | null | undefined): number {
  const v = num(s);
  if (v === null || v < 0) return 0;
  const str = String(s).toLowerCase();
  if (/week|wk/.test(str)) return v / 4.345;
  if (/year|yr/.test(str) && !/month|mo\b/.test(str)) return v * 12;
  return v; // "6", "6 months", "6 mo"
}

// "10 years", "10 yrs break 5", "10 (5th yr break)" → term certain = the
// break year when one is stated, else the full term. The comp's separate
// Break field is applied on top by devalueComp (the app's own form writes the
// break there, not into the term string).
function parseTermYears(s: string | null | undefined): number | null {
  if (!s) return null;
  const str = String(s).toLowerCase();
  const full = num(str);
  if (full === null || full <= 0) return null;
  const brk = str.match(/(?:break|bo|b\/o)[^\d]{0,12}(\d+(\.\d+)?)/) || str.match(/(\d+(\.\d+)?)[^\d]{0,10}break/);
  const breakYear = brk ? parseFloat(brk[1]) : null;
  const term = breakYear && breakYear > 0 && breakYear < full ? breakYear : full;
  return term > 0 && term <= 999 ? term : null;
}

export interface Devaluation {
  netEffectiveRentPa: number;
  netEffectiveRentPsf: number | null;
  headlineRentPa: number;
  termCertainYears: number;
  rentFreeMonths: number;
  capitalDeducted: number;
  note: string;
}

export function devalueComp(comp: {
  headlineRent?: string | null;
  passingRent?: string | null;
  term?: string | null;
  breakClause?: string | null;
  rentFree?: string | null;
  rentFreeMonths?: string | null;
  capex?: string | null;
  fitoutContribution?: string | null;
  areaSqft?: string | null;
  niaSqft?: string | null;
  giaSqft?: string | null;
}): Devaluation | null {
  const area = num(comp.areaSqft) || num(comp.niaSqft) || num(comp.giaSqft);
  const rent = parseMoney(comp.headlineRent) || parseMoney(comp.passingRent);
  if (!rent) return null;

  // psf-quoted headline needs the area to annualise.
  let headlinePa = rent.value;
  if (rent.isPsf) {
    if (!area || area <= 0) return null;
    headlinePa = rent.value * area;
  }
  // Sanity: a "pa" figure smaller than a plausible psf on a known area is
  // probably actually psf ("45" on 2,400 sq ft). Reinterpret when obvious.
  if (!rent.isPsf && area && area > 0 && headlinePa < 300 && headlinePa * area > 5000) {
    headlinePa = headlinePa * area;
  }
  if (headlinePa < 1000) return null; // can't be an annual rent — refuse rather than mislead

  const fullTerm = parseTermYears(comp.term) ?? 5; // UK default assumption when unstated
  // The Break field is its own column on the comp — an earliest break there
  // shortens the term certain exactly as one written into the term string does.
  const breakYears = parseTermYears(comp.breakClause);
  const termYears = breakYears && breakYears > 0 && breakYears < fullTerm ? breakYears : fullTerm;
  const rentFreeMonths = parseRentFreeMonths(comp.rentFreeMonths || comp.rentFree);
  const rentFreeYears = Math.min(rentFreeMonths / 12, termYears);
  const capital = (num(comp.capex) || 0) + (num(comp.fitoutContribution) || 0);

  const ner = (headlinePa * (termYears - rentFreeYears) - capital) / termYears;
  if (!Number.isFinite(ner) || ner <= 0) return null;

  const parts = [`${termYears} yr term certain${termYears < fullTerm ? " (to break)" : ""}`];
  if (rentFreeMonths > 0) parts.push(`${Math.round(rentFreeMonths)} mo rent free`);
  if (capital > 0) parts.push(`£${Math.round(capital).toLocaleString("en-GB")} capital`);
  if (!comp.term) parts.push("term assumed 5 yrs");

  return {
    netEffectiveRentPa: Math.round(ner),
    netEffectiveRentPsf: area && area > 0 ? Math.round((ner / area) * 100) / 100 : null,
    headlineRentPa: Math.round(headlinePa),
    termCertainYears: termYears,
    rentFreeMonths: Math.round(rentFreeMonths * 10) / 10,
    capitalDeducted: Math.round(capital),
    note: parts.join(" · "),
  };
}
