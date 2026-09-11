/**
 * Pathway Stage 4 enrichment helpers — CCOD/OCOD sweep, ROE filings,
 * LLP member chains.
 *
 * Why these live in their own module: the existing Stage 4 in
 * property-pathway.ts has been refined many times for the single-title
 * Clouseau-driven flow. These helpers AUGMENT that flow rather than
 * replace it — they surface additional freeholds in the same building
 * (Gainesville-style carve-outs), and chase UBOs through ROE filings
 * (Al-Mana-style BVI vehicles) or LLP members (Geaney-style family
 * partnerships).
 *
 * All three return structured data that Stage 4 stores under
 * stage4.candidateTitles, stage4.roeFilings and stage4.llpMembers.
 */

import { findProprietorsByAddress } from "./hmlr-direct";
import { chFetch } from "./companies-house";

export interface CandidateTitle {
  titleNumber: string;
  tenure: string | null;
  propertyAddress: string | null;
  pricePaid: string | null;
  dateProprietorAdded: string | null;
  proprietors: Array<{
    proprietorName: string | null;
    proprietorCategory: string | null;
    companyRegistrationNo: string | null;
    countryIncorporated: string | null;
    dataset: "ccod" | "ocod";
  }>;
  isLikelyAtAddress: boolean;
}

export interface RoeFilingSummary {
  overseasEntityNumber: string;
  entityName: string | null;
  registeredOn: string | null;
  lastConfirmationDate: string | null;
  ubos: Array<{
    name: string;
    nationality?: string | null;
    controlNatures: string[];
    addedOn?: string | null;
  }>;
  error?: string;
}

export interface LlpMemberSummary {
  llpNumber: string;
  llpName: string | null;
  members: Array<{
    name: string;
    role: string;
    appointedOn?: string | null;
    nationality?: string | null;
  }>;
  pscs: Array<{ name: string; natureOfControl: string[] }>;
  error?: string;
}

/**
 * Extract a UK-style street number / range from a free-text address.
 * Returns "18-22" for "18-22 Haymarket", "5" for "5 Orange Street",
 * "5a" for "5a Mount Street", null when no leading number is present
 * (named buildings, estates).
 */
function extractStreetNumber(address: string | null | undefined): string | null {
  if (!address) return null;
  const m = address.trim().match(/^(\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?)\b/i);
  if (!m) return null;
  return m[1].replace(/\s+/g, "").toLowerCase();
}

/**
 * Multi-title sweep. Given a resolved property address + postcode, find
 * every commercial freehold at that location in CCOD/OCOD. The "primary"
 * title (street-number-matched) is sorted to the top with
 * isLikelyAtAddress = true; other postcode siblings come below with
 * isLikelyAtAddress = false so the UI can show them as "also at this
 * postcode — confirm if relevant".
 *
 * Returns up to 50 rows. Empty if CCOD/OCOD isn't yet ingested or the
 * postcode doesn't match any commercial freehold (residential street,
 * Scotland, very new registrations).
 */
export async function sweepCandidateTitles(
  address: string | null | undefined,
  postcode: string | null | undefined,
): Promise<CandidateTitle[]> {
  if (!postcode) return [];
  const streetNumber = extractStreetNumber(address);

  // Primary search — address-anchored. Picks up the 18-22 Haymarket
  // case where Gainesville's carve-out (NGL939200) and Al-Mana's main
  // (NGL952166) both list "18 to 22 Haymarket" or "Scotch House, 18 to
  // 22 Haymarket" in property_address.
  const primary = streetNumber
    ? await findProprietorsByAddress(postcode, streetNumber).catch(() => [])
    : [];

  // Secondary search — postcode only. Catches anything we'd miss when
  // the address has no leading number (named buildings) and surfaces
  // sibling titles in the same postcode so the user can include them.
  const all = await findProprietorsByAddress(postcode, null).catch(() => []);

  const primarySet = new Set(primary.map((t) => t.titleNumber));
  const allRows: CandidateTitle[] = all.map((t) => ({
    titleNumber: t.titleNumber,
    tenure: t.tenure,
    propertyAddress: t.propertyAddress,
    pricePaid: t.pricePaid,
    dateProprietorAdded: t.dateProprietorAdded,
    proprietors: t.proprietors.map((p) => ({
      proprietorName: p.proprietorName,
      proprietorCategory: p.proprietorCategory,
      companyRegistrationNo: p.companyRegistrationNo,
      countryIncorporated: p.countryIncorporated,
      dataset: p.dataset,
    })),
    isLikelyAtAddress: primarySet.has(t.titleNumber),
  }));

  // Primary titles first, then siblings; within each group keep
  // CCOD-direct ordering (title_number ASC).
  allRows.sort((a, b) => {
    if (a.isLikelyAtAddress !== b.isLikelyAtAddress) return a.isLikelyAtAddress ? -1 : 1;
    return a.titleNumber.localeCompare(b.titleNumber);
  });

  return allRows;
}

/**
 * Pull the Register of Overseas Entities filing for an OE-prefix number.
 * Companies House Public Data API exposes overseas entities as standard
 * /company/{number} records — the UBOs come back from the PSC endpoint
 * tagged with kind="registered-overseas-entity-beneficial-owner".
 *
 * Free, no rate-limit concerns at our volume. Returns the most useful
 * fields flattened; the full payload is preserved in kyc_investigations
 * via Clouseau when Stage 4 runs that anyway.
 */
export async function pullRoeFiling(oeNumber: string): Promise<RoeFilingSummary> {
  const summary: RoeFilingSummary = {
    overseasEntityNumber: oeNumber,
    entityName: null,
    registeredOn: null,
    lastConfirmationDate: null,
    ubos: [],
  };
  try {
    const profile = await chFetch(`/company/${encodeURIComponent(oeNumber)}`);
    summary.entityName = profile?.company_name || null;
    summary.registeredOn = profile?.date_of_creation || null;
    summary.lastConfirmationDate = profile?.confirmation_statement?.last_made_up_to || null;

    const pscData = await chFetch(`/company/${encodeURIComponent(oeNumber)}/persons-with-significant-control`);
    const items = pscData?.items || [];
    for (const item of items) {
      // ROE filings use the "individual-beneficial-owner",
      // "corporate-entity-beneficial-owner" and "legal-person-beneficial-owner"
      // kinds. Skip "ceased" entries.
      if (item.ceased_on) continue;
      const kind = item.kind || "";
      if (!/beneficial-owner|persons-with-significant-control/.test(kind)) continue;
      summary.ubos.push({
        name: item.name || "(unnamed)",
        nationality: item.nationality || null,
        controlNatures: item.natures_of_control || [],
        addedOn: item.notified_on || null,
      });
    }
  } catch (err: any) {
    summary.error = err?.message || "ROE pull failed";
  }
  return summary;
}

/**
 * Pull the members + PSCs of an LLP (OC-prefix). Companies House Public
 * Data API treats LLPs as regular /company/{number} records. Designated
 * members + members come back from /officers; PSCs are the usual.
 *
 * Used to surface family-LLP composition — the four Geaney members of
 * The Gainesville Partnership LLP at 55 Conduit Street that ChatBGP had
 * to pull manually today.
 */
export async function pullLlpMembers(llpNumber: string): Promise<LlpMemberSummary> {
  const summary: LlpMemberSummary = {
    llpNumber,
    llpName: null,
    members: [],
    pscs: [],
  };
  try {
    const profile = await chFetch(`/company/${encodeURIComponent(llpNumber)}`);
    summary.llpName = profile?.company_name || null;

    const officersData = await chFetch(`/company/${encodeURIComponent(llpNumber)}/officers`);
    const officers = officersData?.items || [];
    for (const o of officers) {
      if (o.resigned_on) continue;
      const role = (o.officer_role || "").toLowerCase();
      // LLP "officers" are members and designated members — include both.
      if (!role.includes("member")) continue;
      summary.members.push({
        name: o.name || "(unnamed)",
        role: o.officer_role || "member",
        appointedOn: o.appointed_on || null,
        nationality: o.nationality || null,
      });
    }

    const pscData = await chFetch(`/company/${encodeURIComponent(llpNumber)}/persons-with-significant-control`);
    const pscs = pscData?.items || [];
    for (const p of pscs) {
      if (p.ceased_on) continue;
      summary.pscs.push({
        name: p.name || "(unnamed)",
        natureOfControl: p.natures_of_control || [],
      });
    }
  } catch (err: any) {
    summary.error = err?.message || "LLP members pull failed";
  }
  return summary;
}

/**
 * For each unique proprietor company number found in the candidate
 * titles, route to ROE pull (OE-prefix) or LLP pull (OC-prefix). Plain
 * UK companies (no prefix or numeric) are left to Clouseau's existing
 * chain walk — no point duplicating that work.
 *
 * Returns the two arrays separately so Stage 4 can store each in its
 * own field.
 */
export async function enrichProprietorChains(
  candidates: CandidateTitle[],
): Promise<{ roeFilings: RoeFilingSummary[]; llpMembers: LlpMemberSummary[] }> {
  const seen = new Set<string>();
  const oeNumbers: string[] = [];
  const ocNumbers: string[] = [];
  for (const t of candidates) {
    for (const p of t.proprietors) {
      const num = (p.companyRegistrationNo || "").trim().toUpperCase();
      if (!num || seen.has(num)) continue;
      seen.add(num);
      if (num.startsWith("OE")) oeNumbers.push(num);
      else if (num.startsWith("OC")) ocNumbers.push(num);
    }
  }

  const [roeFilings, llpMembers] = await Promise.all([
    Promise.all(oeNumbers.map((n) => pullRoeFiling(n))),
    Promise.all(ocNumbers.map((n) => pullLlpMembers(n))),
  ]);

  return { roeFilings, llpMembers };
}
