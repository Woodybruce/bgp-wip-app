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
