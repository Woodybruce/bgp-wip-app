// Official-destination baselines for account reconciliation (Delivery 2).
//
// The Hammerson list below is the published destination portfolio, encoded
// as seed rows for account_reconciliation_baselines. Bullring & Grand
// Central is ONE official destination expecting TWO CRM properties — the
// grouping is carried by official_group_key + expected_crm_property_count
// so the CRM rows stay separate. Development sites and disposed assets
// would be seeded as their own category rows and are excluded from the
// "all destinations accounted for" gate.
//
// The seed doubles as the known-non-UK checklist for the geocode repair
// script (scripts/repair-landlord-geocodes.ts): a scraped item named like
// one of these but geocoded to the UK is a mismatch.

export interface BaselineSeed {
  destination_name: string;
  country: string;                 // ISO-2 from the official source
  official_group_key: string | null;
  expected_crm_property_count: number;
  category: "destination" | "development" | "disposed";
  source_url: string;
  source_date: string;             // date the list was taken from the source
}

export const HAMMERSON_BASELINE_NAME = "hammerson-official-destinations";

const HAMMERSON_PORTFOLIO_URL = "https://www.hammerson.com/our-destinations";

export const HAMMERSON_OFFICIAL_DESTINATIONS: BaselineSeed[] = [
  { destination_name: "Manchester Arndale", country: "GB", official_group_key: null, expected_crm_property_count: 1, category: "destination", source_url: HAMMERSON_PORTFOLIO_URL, source_date: "2026-09-20" },
  { destination_name: "Brent Cross", country: "GB", official_group_key: null, expected_crm_property_count: 1, category: "destination", source_url: HAMMERSON_PORTFOLIO_URL, source_date: "2026-09-20" },
  { destination_name: "Bullring & Grand Central", country: "GB", official_group_key: "bullring-grand-central", expected_crm_property_count: 2, category: "destination", source_url: HAMMERSON_PORTFOLIO_URL, source_date: "2026-09-20" },
  { destination_name: "Cabot Circus", country: "GB", official_group_key: null, expected_crm_property_count: 1, category: "destination", source_url: HAMMERSON_PORTFOLIO_URL, source_date: "2026-09-20" },
  { destination_name: "The Oracle", country: "GB", official_group_key: null, expected_crm_property_count: 1, category: "destination", source_url: HAMMERSON_PORTFOLIO_URL, source_date: "2026-09-20" },
  { destination_name: "Westquay", country: "GB", official_group_key: null, expected_crm_property_count: 1, category: "destination", source_url: HAMMERSON_PORTFOLIO_URL, source_date: "2026-09-20" },
  { destination_name: "Dundrum Town Centre", country: "IE", official_group_key: null, expected_crm_property_count: 1, category: "destination", source_url: HAMMERSON_PORTFOLIO_URL, source_date: "2026-09-20" },
  { destination_name: "Ilac Centre", country: "IE", official_group_key: null, expected_crm_property_count: 1, category: "destination", source_url: HAMMERSON_PORTFOLIO_URL, source_date: "2026-09-20" },
  { destination_name: "Pavilions", country: "IE", official_group_key: null, expected_crm_property_count: 1, category: "destination", source_url: HAMMERSON_PORTFOLIO_URL, source_date: "2026-09-20" },
  { destination_name: "Les 3 Fontaines", country: "FR", official_group_key: null, expected_crm_property_count: 1, category: "destination", source_url: HAMMERSON_PORTFOLIO_URL, source_date: "2026-09-20" },
  { destination_name: "Les Terrasses du Port", country: "FR", official_group_key: null, expected_crm_property_count: 1, category: "destination", source_url: HAMMERSON_PORTFOLIO_URL, source_date: "2026-09-20" },
];

// ── Landsec ─────────────────────────────────────────────────────────────
// Baseline taken from the official property listing (content.landsec.com,
// 63 current entries) cross-checked against the FY26 results (14 May 2026)
// and Annual Report 2026 (26 Jun 2026). Landsec reports four segments —
// office-led places, retail-led destinations, residential-led places and
// "other assets" earmarked for gradual divestment — so the categories here
// are destination (current income-producing), development (committed or
// consented pre-development) and disposed (documented sales). MYO flex
// locations are sub-brands inside listed buildings, not separate assets.
// JV stakes (Bluewater 64%, Liverpool ONE 96.5%, Westgate 50%, Southside
// 50%, Nova 50%, West India Quay 50%, Mayfield 50%) are ownership facts
// that belong on the CRM relationship rows, not in this name baseline.

export const LANDSEC_BASELINE_NAME = "landsec-official-portfolio";

const LANDSEC_PORTFOLIO_URL = "https://www.landsec.com/en/about/about-landsec/our-properties/";
const LANDSEC_FY26_URL = "https://content.landsec.com/media/l3ooffzu/results-for-the-year-ended-31-march-2026.pdf";
const LANDSEC_SOURCE_DATE = "2026-09-21";

const landsecSeed = (
  destination_name: string,
  category: BaselineSeed["category"],
  source_url = LANDSEC_PORTFOLIO_URL,
): BaselineSeed => ({
  destination_name,
  country: "GB",
  official_group_key: null,
  expected_crm_property_count: 1,
  category,
  source_url,
  source_date: LANDSEC_SOURCE_DATE,
});

export const LANDSEC_OFFICIAL_PORTFOLIO: BaselineSeed[] = [
  // Retail-led destinations
  landsecSeed("Bluewater", "destination"),
  landsecSeed("Trinity Leeds", "destination"),
  landsecSeed("White Rose", "destination"),
  landsecSeed("St David's Dewi Sant", "destination"),
  landsecSeed("Buchanan Galleries", "destination"),
  landsecSeed("Buchanan Street", "destination"),
  landsecSeed("Westgate Oxford", "destination"),
  landsecSeed("Gunwharf Quays", "destination"),
  landsecSeed("Liverpool ONE", "destination"),
  landsecSeed("Southside", "destination"),
  landsecSeed("Lewisham Shopping Centre", "destination"),
  landsecSeed("Braintree Village", "destination"),
  landsecSeed("Clarks Village", "destination"),
  landsecSeed("Brighton Marina", "destination"),
  landsecSeed("MediaCity", "destination"),
  landsecSeed("O2 Centre", "destination"),
  // Office-led places (income-producing)
  landsecSeed("Cardinal Place", "destination"),
  landsecSeed("123 Victoria Street", "destination"),
  landsecSeed("Nova", "destination"),
  landsecSeed("n2", "destination"),
  landsecSeed("The Zig Zag Building", "destination"),
  landsecSeed("62 Buckingham Gate", "destination"),
  landsecSeed("16 Palace Street", "destination"),
  landsecSeed("Cathedral Piazza", "destination"),
  landsecSeed("New Street Square", "destination"),
  landsecSeed("Dashwood House", "destination"),
  landsecSeed("One New Change", "destination"),
  landsecSeed("Moorgate Hall", "destination"),
  landsecSeed("The Forge", "destination"),
  landsecSeed("Timber Square", "destination"),
  landsecSeed("City Gate", "destination"),
  landsecSeed("6-17 Tottenham Court Road", "destination"),
  landsecSeed("Monico", "destination"),
  landsecSeed("Oval Works", "destination"),
  landsecSeed("Westminster City Hall", "destination"),
  landsecSeed("Lucent", "destination"),
  // Media, leisure and other current assets
  landsecSeed("Piccadilly Lights", "destination"),
  landsecSeed("West India Quay", "destination"),
  landsecSeed("Castle Quarter", "destination"),
  landsecSeed("Xscape Milton Keynes", "destination"),
  landsecSeed("Xscape Yorkshire", "destination"),
  landsecSeed("Bentley Bridge", "destination"),
  landsecSeed("Cambridge Leisure Park", "destination"),
  landsecSeed("Cardigan Fields", "destination"),
  landsecSeed("East Kent Leisure Park", "destination"),
  landsecSeed("Eureka Leisure Park", "destination"),
  landsecSeed("Fountain Park", "destination"),
  landsecSeed("Kingsmead Leisure Centre", "destination"),
  landsecSeed("Parrs Wood", "destination"),
  landsecSeed("Ravenside Retail Park", "destination"),
  landsecSeed("Riverside Leisure Park", "destination"),
  landsecSeed("Tower Park", "destination"),
  landsecSeed("Westwood Cross", "destination"),
  // Committed developments and consented pre-development
  landsecSeed("Thirty High", "development"),
  landsecSeed("The Republic", "development"),
  landsecSeed("Mayfield", "development"),
  landsecSeed("Hill House", "development"),
  landsecSeed("Liberty of Southwark", "development"),
  landsecSeed("55 Old Broad Street", "development"),
  // Documented disposals — a match here means the CRM still links a sold
  // asset and the ownership link needs review, not that the row is healthy.
  landsecSeed("32-50 Strand", "disposed", LANDSEC_FY26_URL),            // sold 2022
  landsecSeed("One New Street Square", "disposed", LANDSEC_FY26_URL),   // sold 2023
  landsecSeed("Junction 32", "disposed", LANDSEC_FY26_URL),             // sold 2023
  landsecSeed("Lakeside Retail Park", "disposed", LANDSEC_FY26_URL),    // sold Apr 2025
  landsecSeed("Queen Anne's Mansions", "disposed", LANDSEC_FY26_URL),   // sold Aug 2025
  landsecSeed("Bexhill Retail Park", "disposed", LANDSEC_FY26_URL),     // sold Oct 2025
  landsecSeed("The Peel Centre", "disposed", LANDSEC_FY26_URL),         // sold Apr 2026
  landsecSeed("Kings Gate", "disposed", LANDSEC_FY26_URL),              // resi scheme sold out
];

// ── Registry ─────────────────────────────────────────────────────────────
// One baseline per account, chosen by company name; the ?baseline= query
// param remains an explicit override. Adding a pilot = one more entry here.

export interface BaselineDef {
  name: string;
  companyPattern: RegExp;
  seeds: BaselineSeed[];
}

export const RECONCILIATION_BASELINES: BaselineDef[] = [
  { name: HAMMERSON_BASELINE_NAME, companyPattern: /hammerson/i, seeds: HAMMERSON_OFFICIAL_DESTINATIONS },
  { name: LANDSEC_BASELINE_NAME, companyPattern: /\blandsec\b|land securities/i, seeds: LANDSEC_OFFICIAL_PORTFOLIO },
];

export function defaultBaselineForCompany(companyName: string): BaselineDef | undefined {
  return RECONCILIATION_BASELINES.find(b => b.companyPattern.test(companyName));
}
