// Country helpers shared by the brand profile, landlord discovery, the
// geocoder and the reconciliation report (Delivery 2). Discovery used to
// assume the UK everywhere — "Dundrum Town Centre" (Dublin) geocoded to
// "Dundrum, Newcastle BT33, UK" — so country is now explicit ISO 3166-1
// alpha-2 end to end, and "UK" is only ever a fallback when a scrape found
// no country evidence at all.

// Cheap ISO 3166-1 alpha-2 inference from a Google formatted_address.
// We only get formatted_address back from Text Search / Geocoding (no
// structured components without an extra call), so we parse the tail.
// Returns null when nothing matches — the UI treats null as "Other".
export const COUNTRY_TAIL_TO_ISO: Array<[RegExp, string]> = [
  [/\b(UK|United Kingdom)\.?$/i, "GB"],
  [/\bUSA\.?$/i, "US"], [/\bUnited States\.?$/i, "US"],
  [/\bFrance\.?$/i, "FR"], [/\bItaly\.?$/i, "IT"], [/\bSpain\.?$/i, "ES"],
  [/\bGermany\.?$/i, "DE"], [/\bNetherlands\.?$/i, "NL"],
  [/\bBelgium\.?$/i, "BE"], [/\bSwitzerland\.?$/i, "CH"],
  [/\bAustria\.?$/i, "AT"], [/\bIreland\.?$/i, "IE"],
  [/\bDenmark\.?$/i, "DK"], [/\bSweden\.?$/i, "SE"],
  [/\bNorway\.?$/i, "NO"], [/\bFinland\.?$/i, "FI"],
  [/\bPortugal\.?$/i, "PT"], [/\bPoland\.?$/i, "PL"],
  [/\b(UAE|United Arab Emirates)\.?$/i, "AE"],
  [/\bSaudi Arabia\.?$/i, "SA"], [/\bQatar\.?$/i, "QA"],
  [/\bJapan\.?$/i, "JP"], [/\bSouth Korea\.?$/i, "KR"],
  [/\bChina\.?$/i, "CN"], [/\bHong Kong\.?$/i, "HK"],
  [/\bSingapore\.?$/i, "SG"], [/\bThailand\.?$/i, "TH"],
  [/\bAustralia\.?$/i, "AU"], [/\bNew Zealand\.?$/i, "NZ"],
  [/\bCanada\.?$/i, "CA"], [/\bBrazil\.?$/i, "BR"], [/\bMexico\.?$/i, "MX"],
];

export function inferCountryFromAddress(addr: string | null | undefined): string | null {
  if (!addr) return null;
  for (const [re, iso] of COUNTRY_TAIL_TO_ISO) if (re.test(addr.trim())) return iso;
  return null;
}

// Reverse of the tail table, for building geocode queries ("Dundrum Town
// Centre, Dublin, Ireland" instead of a bare ISO code Google can't use).
// GB deliberately renders as "UK" — the tail both parsers and Google treat
// it as canonical for the United Kingdom.
const ISO_TO_COUNTRY_NAME: Record<string, string> = {
  GB: "UK",
  US: "USA",
  FR: "France", IT: "Italy", ES: "Spain", DE: "Germany", NL: "Netherlands",
  BE: "Belgium", CH: "Switzerland", AT: "Austria", IE: "Ireland",
  DK: "Denmark", SE: "Sweden", NO: "Norway", FI: "Finland",
  PT: "Portugal", PL: "Poland", AE: "UAE", SA: "Saudi Arabia", QA: "Qatar",
  JP: "Japan", KR: "South Korea", CN: "China", HK: "Hong Kong",
  SG: "Singapore", TH: "Thailand", AU: "Australia", NZ: "New Zealand",
  CA: "Canada", BR: "Brazil", MX: "Mexico",
};

export function countryNameFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return ISO_TO_COUNTRY_NAME[iso.trim().toUpperCase()] ?? null;
}

// UK postcode shape (wide — validates format, not deliverability). Used to
// spot non-UK stock: a property with country='IE'/'FR' and a UK-shaped
// postcode is a mismatch, and a country-less CRM row whose postcode doesn't
// match this needs review.
export const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

// Build the geocode query for a scraped property. The literal "UK" tail is
// only the fallback when neither the asset's own context nor the landlord's
// home page evidenced a country — the old unconditional "UK" append is what
// plotted Dundrum in Newcastle.
export function buildGeocodeQuery(
  item: { name: string; postcode?: string | null; address?: string | null; country?: string | null },
  homeCountry?: string | null,
): { query: string; countryHint: string | null } {
  const country = item.country ?? homeCountry ?? null;
  const tail = country ? countryNameFromIso(country) : "UK";
  const parts = [item.name, item.postcode, item.address, tail].filter(Boolean);
  return { query: parts.join(", "), countryHint: country };
}
