import ExcelJS from "exceljs";

// grain:      "unit 1:1" | "deal 1:1" | "deal 1:many" | "unit 1:many" | "derived" | "external"
// onSchedule: "Yes" (appears on a schedule/list view) | "No" (detail view only)
const rows: Array<{
  section: string;
  fact: string;
  grain: string;
  owner: string;
  tenancy: string;
  tracker: string;
  leasing: string;
  deals: string;
  onSchedule: string;
  notes?: string;
}> = [
  // ============ AREA — physical, owned by property_units ============
  { section: "AREA", fact: "NIA sqft",                                  grain: "unit 1:1", owner: "property_units",    tenancy: "read", tracker: "read", leasing: "read", deals: "read", onSchedule: "Yes", notes: "Physical. Today on tenancy.nia_sqft — migrate to property_units." },
  { section: "AREA", fact: "GIA sqft",                                  grain: "unit 1:1", owner: "property_units",    tenancy: "read", tracker: "read", leasing: "",     deals: "read", onSchedule: "Yes", notes: "Physical. Today on tenancy.gia_sqft — migrate." },
  { section: "AREA", fact: "ITZA sqft",                                 grain: "unit 1:1", owner: "property_units",    tenancy: "read", tracker: "read", leasing: "read", deals: "read", onSchedule: "Yes", notes: "Physical. Today on tenancy.itza_sqft — migrate." },
  { section: "AREA", fact: "Floor breakdown (bsmt/ground/first/other)", grain: "unit 1:1", owner: "property_units",    tenancy: "read", tracker: "read", leasing: "",     deals: "read", onSchedule: "Yes", notes: "Physical. Detailed area split today on tenancy." },

  // ============ RENT — four flavours, never collapsed ============
  { section: "RENT", fact: "Passing rent pa (current tenant)",          grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     onSchedule: "Yes", notes: "Only changes on deal Complete. Sum = rent roll." },
  { section: "RENT", fact: "ERV pa (BGP & client valuation view)",      grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "read", leasing: "read", deals: "",     onSchedule: "Yes", notes: "Agreed between BGP & client. Visible to all." },
  { section: "RENT", fact: "Quoting rent pa (asking, to market)",       grain: "unit 1:1", owner: "tenancy (NEW)",    tenancy: "edit", tracker: "read", leasing: "read", deals: "read", onSchedule: "Yes", notes: "Defaults to ERV when marketing on; editable on tenancy." },
  { section: "RENT", fact: "Agreed deal rent pa (final number hit)",    grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "read", leasing: "read", deals: "edit", onSchedule: "Yes", notes: "Final agreed rent. Can differ from passing / ERV / quoting. Becomes passing on Complete. (= 'Headline rent' on deal detail)" },
  { section: "RENT", fact: "Net effective rent pa",                     grain: "derived",  owner: "derived",          tenancy: "",     tracker: "",     leasing: "",     deals: "read", onSchedule: "No",  notes: "Read on deal detail; computed FROM agreed deal rent − rent free / lease length." },
  { section: "RENT", fact: "Rent psf",                                  grain: "derived",  owner: "derived",          tenancy: "✓",    tracker: "✓",    leasing: "✓",    deals: "✓",    onSchedule: "Yes" },
  { section: "RENT", fact: "Price psf (investment)",                    grain: "derived",  owner: "derived",          tenancy: "",     tracker: "",     leasing: "",     deals: "read", onSchedule: "No" },
  { section: "RENT", fact: "Price ITZA (retail)",                       grain: "derived",  owner: "derived",          tenancy: "",     tracker: "",     leasing: "",     deals: "read", onSchedule: "No" },
  { section: "RENT", fact: "Turnover rent payable / %",                 grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "edit", onSchedule: "Yes" },
  { section: "RENT", fact: "Rent free (months / £)",                    grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "RENT", fact: "Capital contribution / capex",              grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "RENT", fact: "Rent review profile (open/fixed/RPI)",      grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     onSchedule: "Yes" },

  // ============ LEASE DATES & TERMS ============
  { section: "LEASE DATES", fact: "Lease start",                        grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "",     deals: "",     onSchedule: "Yes" },
  { section: "LEASE DATES", fact: "Lease expiry",                       grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     onSchedule: "Yes" },
  { section: "LEASE DATES", fact: "Tenant break date",                 grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     onSchedule: "Yes" },
  { section: "LEASE DATES", fact: "Landlord break date",               grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     onSchedule: "Yes" },
  { section: "LEASE DATES", fact: "Next rent review date",             grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     onSchedule: "Yes" },
  { section: "LEASE DATES", fact: "Term years",                        grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "",     deals: "",     onSchedule: "Yes" },
  { section: "LEASE DATES", fact: "Unexpired term (to break / expiry)",grain: "derived",  owner: "derived",          tenancy: "✓",    tracker: "",     leasing: "✓",    deals: "",     onSchedule: "Yes" },
  { section: "LEASE DATES", fact: "Lease length on new deal",          grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "read", leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "LEASE DATES", fact: "Break option on new deal",          grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "read", leasing: "",     deals: "edit", onSchedule: "No" },

  // ============ OCCUPANCY & MARKETING ============
  { section: "OCCUPANCY & MARKETING", fact: "Occupancy (Vacant/Trading/HO/LEP/Archived)", grain: "unit 1:1", owner: "tenancy (NEW)", tenancy: "edit", tracker: "", leasing: "", deals: "", onSchedule: "Yes" },
  { section: "OCCUPANCY & MARKETING", fact: "Marketing active (bool)", grain: "unit 1:1", owner: "tenancy (NEW)",    tenancy: "edit", tracker: "filter", leasing: "filter", deals: "", onSchedule: "Yes" },
  { section: "OCCUPANCY & MARKETING", fact: "Marketing reason",        grain: "unit 1:1", owner: "tenancy (NEW)",    tenancy: "edit", tracker: "read", leasing: "read", deals: "",     onSchedule: "Yes" },
  { section: "OCCUPANCY & MARKETING", fact: "Marketing start date",    grain: "unit 1:1", owner: "available_units",  tenancy: "",     tracker: "edit", leasing: "read", deals: "",     onSchedule: "Yes" },
  { section: "OCCUPANCY & MARKETING", fact: "Available date (occupation)", grain: "unit 1:1", owner: "available_units", tenancy: "", tracker: "edit", leasing: "read", deals: "",  onSchedule: "Yes" },
  { section: "OCCUPANCY & MARKETING", fact: "EPC rating",              grain: "unit 1:1", owner: "property_units",    tenancy: "read", tracker: "edit", leasing: "read", deals: "",     onSchedule: "Yes", notes: "Physical. Duplicated on property_units + available_units + tenancy today." },
  { section: "OCCUPANCY & MARKETING", fact: "Use class / permitted use", grain: "unit 1:1", owner: "property_units",  tenancy: "read", tracker: "edit", leasing: "read", deals: "",     onSchedule: "Yes", notes: "Physical/planning attribute. On property_units + available_units + tenancy today." },
  { section: "OCCUPANCY & MARKETING", fact: "Condition (Shell/CatA/CatB/Fitted...)", grain: "unit 1:1", owner: "property_units", tenancy: "", tracker: "edit", leasing: "", deals: "", onSchedule: "Yes", notes: "Physical. On property_units + available_units today." },
  { section: "OCCUPANCY & MARKETING", fact: "Location / UK region",    grain: "unit 1:1", owner: "available_units",  tenancy: "",     tracker: "edit", leasing: "",     deals: "",     onSchedule: "No" },
  { section: "OCCUPANCY & MARKETING", fact: "Restrictions (free-text for ads)", grain: "unit 1:1", owner: "available_units", tenancy: "", tracker: "", leasing: "", deals: "", onSchedule: "No" },

  // ============ UNIT ADDRESS — physical, owned by property_units (already there) ============
  { section: "UNIT ADDRESS", fact: "Address line",                     grain: "unit 1:1", owner: "property_units",    tenancy: "read", tracker: "read", leasing: "read", deals: "read", onSchedule: "No", notes: "Already on property_units.unit_address." },
  { section: "UNIT ADDRESS", fact: "Postcode",                         grain: "unit 1:1", owner: "property_units",    tenancy: "read", tracker: "read", leasing: "read", deals: "read", onSchedule: "No", notes: "Already on property_units.unit_postcode." },
  { section: "UNIT ADDRESS", fact: "UPRN",                             grain: "unit 1:1", owner: "property_units",    tenancy: "read", tracker: "",     leasing: "",     deals: "read", onSchedule: "No", notes: "Already on property_units.unit_uprn." },
  { section: "UNIT ADDRESS", fact: "Free-text address fallback (non-PAF)", grain: "unit 1:1", owner: "property_units", tenancy: "read", tracker: "",    leasing: "",     deals: "read", onSchedule: "No", notes: "Already on property_units.unit_address_free_text." },

  // ============ TENANT (sitting / current) ============
  { section: "TENANT", fact: "Tenant company (current sitting tenant)", grain: "unit 1:1", owner: "tenancy",         tenancy: "edit", tracker: "",     leasing: "read", deals: "",     onSchedule: "Yes" },
  { section: "TENANT", fact: "Trading name",                           grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     onSchedule: "Yes" },
  { section: "TENANT", fact: "Tenant mix / category",                  grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     onSchedule: "Yes" },
  { section: "TENANT", fact: "Credit rating",                          grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     onSchedule: "Yes" },

  // ============ DEAL — core ============
  { section: "DEAL", fact: "Deal / group name",                        grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "DEAL", fact: "Deal type / asset class",                  grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "edit", leasing: "",     deals: "edit", onSchedule: "Yes" },
  { section: "DEAL", fact: "Tenure (freehold/leasehold)",              grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "DEAL", fact: "Deal status (the 7)",                      grain: "deal 1:1", owner: "crm_deals",        tenancy: "pill", tracker: "pill", leasing: "pill (cap @ Completed)", deals: "pill", onSchedule: "Yes" },
  { section: "DEAL", fact: "Counterparty: Tenant (deal)",              grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "edit", leasing: "read", deals: "edit", onSchedule: "Yes" },
  { section: "DEAL", fact: "Counterparty: Landlord (deal)",            grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "read", leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "DEAL", fact: "Counterparty: Vendor (deal)",              grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "DEAL", fact: "Counterparty: Purchaser (deal)",           grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "DEAL", fact: "Internal team",                            grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "read", leasing: "read", deals: "edit", onSchedule: "Yes" },
  { section: "DEAL", fact: "Internal agents on deal",                  grain: "deal 1:many", owner: "crm_deals",     tenancy: "",     tracker: "filter (me)", leasing: "read", deals: "edit", onSchedule: "Yes" },
  { section: "DEAL", fact: "Target date",                              grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "edit", leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "DEAL", fact: "Date of entry (deal createdAt)",           grain: "deal 1:1", owner: "crm_deals (auto)",  tenancy: "",     tracker: "read", leasing: "",     deals: "read", onSchedule: "Yes", notes: "Already on crm_deals.created_at — surface + make sortable. 'How long open?'" },
  { section: "DEAL", fact: "Instructed (BGP put on deal) / target / exchanged / completed / invoiced dates", grain: "deal 1:1", owner: "crm_deals", tenancy: "", tracker: "read", leasing: "read (to Completed)", deals: "edit", onSchedule: "Yes", notes: "instructed_at ≠ created_at ≠ solicitor_instructed_at — keep distinct." },
  { section: "DEAL", fact: "Pricing / yield (investment)",             grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No" },

  // ============ DEAL CONTACTS ============
  { section: "DEAL CONTACTS", fact: "Client contact",                  grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "DEAL CONTACTS", fact: "Vendor agent",                    grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "DEAL CONTACTS", fact: "Acquisition agent",               grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "DEAL CONTACTS", fact: "Purchaser agent",                 grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "DEAL CONTACTS", fact: "Leasing agent",                   grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No" },

  // ============ FEES ============
  { section: "FEES", fact: "Total fee £",                              grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "edit", leasing: "",     deals: "edit", onSchedule: "Yes" },
  { section: "FEES", fact: "Agency fee %",                             grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "edit", leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "FEES", fact: "Fee agreement signed (Y/N) + URL",         grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "edit", leasing: "",     deals: "edit", onSchedule: "Yes" },
  { section: "FEES", fact: "BGP house % (locked 15%)",                 grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "read", leasing: "",     deals: "read", onSchedule: "No" },
  { section: "FEES", fact: "Agent fee allocations (split, %-or-£)",    grain: "deal 1:many", owner: "crm_deals",     tenancy: "",     tracker: "edit", leasing: "",     deals: "edit", onSchedule: "No", notes: "Sub-table: one row per agent, sums to 85%." },

  // ============ COMPLIANCE / KYC / AML ============
  { section: "COMPLIANCE", fact: "AML check completed (YES/NO/N-A)",   grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "edit", leasing: "",     deals: "edit", onSchedule: "Yes", notes: "The gate. Compliance flag on tracker row." },
  { section: "COMPLIANCE", fact: "Compliance override (ack gaps at SOL)", grain: "deal 1:1", owner: "crm_deals",     tenancy: "",     tracker: "edit", leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "COMPLIANCE", fact: "KYC record per party (MLR scope)",   grain: "deal 1:many", owner: "kyc/crm",       tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No", notes: "Sub-table per counterparty." },
  { section: "COMPLIANCE", fact: "Source-of-funds (SoF) analysis",     grain: "deal 1:many", owner: "kyc/crm",       tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "COMPLIANCE", fact: "MLRO documentation status",          grain: "deal 1:many", owner: "kyc/crm",       tenancy: "",     tracker: "",     leasing: "",     deals: "read", onSchedule: "No" },
  { section: "COMPLIANCE", fact: "AI AML triage / compliance gaps",    grain: "deal 1:1", owner: "kyc/crm",          tenancy: "",     tracker: "",     leasing: "",     deals: "read", onSchedule: "No" },
  { section: "COMPLIANCE", fact: "MLRO risk-assessment PDF",           grain: "deal 1:1", owner: "kyc/crm",          tenancy: "",     tracker: "",     leasing: "",     deals: "read", onSchedule: "No" },

  // ============ SOLICITOR SUB-JOURNEY (exists in schema, invisible in UI today) ============
  { section: "SOLICITOR", fact: "Solicitor firm + contact",            grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No", notes: "solicitor_firm / solicitor_contact." },
  { section: "SOLICITOR", fact: "Solicitor instructed date",           grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No", notes: "solicitor_instructed_at." },
  { section: "SOLICITOR", fact: "Draft lease received / comments returned / engrossment dates", grain: "deal 1:1", owner: "crm_deals", tenancy: "", tracker: "", leasing: "", deals: "edit", onSchedule: "No", notes: "draft_lease_received_at / comments_returned_at / engrossment_at — drive Solicitors-stage progress." },
  { section: "SOLICITOR", fact: "Solicitor notes",                     grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No", notes: "solicitor_notes." },

  // ============ INVOICING / XERO ============
  { section: "INVOICING (Xero)", fact: "Xero billing entity per party (L/T/V/P)", grain: "deal 1:many", owner: "crm_deals", tenancy: "", tracker: "", leasing: "", deals: "edit", onSchedule: "No", notes: "ContactID + name for each party." },
  { section: "INVOICING (Xero)", fact: "Xero account number",          grain: "deal 1:1", owner: "crm_deals/xero",   tenancy: "",     tracker: "",     leasing: "",     deals: "read", onSchedule: "No" },
  { section: "INVOICING (Xero)", fact: "PO number",                    grain: "deal 1:1", owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "INVOICING (Xero)", fact: "Billing address",              grain: "deal 1:1", owner: "crm_deals/xero",   tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No" },

  // ============ BRAND PROFILES ============
  { section: "BRAND", fact: "Tenant brand profile / history / reputation",   grain: "company", owner: "companies",  tenancy: "",     tracker: "",     leasing: "",     deals: "read", onSchedule: "No" },
  { section: "BRAND", fact: "Landlord brand profile / history / reputation", grain: "company", owner: "companies",  tenancy: "",     tracker: "",     leasing: "",     deals: "read", onSchedule: "No" },

  // ============ HISTORY / AUDIT / ACTIVITY ============
  { section: "HISTORY / AUDIT", fact: "Status-change timeline (+ reason)", grain: "deal 1:many", owner: "crm audit", tenancy: "",   tracker: "",     leasing: "",     deals: "read", onSchedule: "No", notes: "Sub-table." },
  { section: "HISTORY / AUDIT", fact: "Field-level audit log (before/after)", grain: "deal 1:many", owner: "crm audit", tenancy: "", tracker: "",   leasing: "",     deals: "read", onSchedule: "No", notes: "Sub-table." },
  { section: "HISTORY / AUDIT", fact: "AI activity feed (emails + meetings)", grain: "external", owner: "graph/AI",  tenancy: "",     tracker: "",     leasing: "",     deals: "read", onSchedule: "No" },

  // ============ FILES ============
  { section: "FILES", fact: "Deal folder / SharePoint files",          grain: "external", owner: "sharepoint",       tenancy: "",     tracker: "",     leasing: "",     deals: "edit", onSchedule: "No" },
  { section: "FILES", fact: "Marketing collateral (photos/floorplans/EPC docs)", grain: "unit 1:many", owner: "files/blob", tenancy: "", tracker: "edit", leasing: "read", deals: "edit", onSchedule: "Yes" },

  // ============ SUB-TABLES: VIEWINGS & OFFERS ============
  { section: "VIEWINGS (sub-table)", fact: "Viewing: company · contact · date · time · attendees · outcome · notes", grain: "unit 1:many", owner: "unit_viewings", tenancy: "", tracker: "edit", leasing: "read", deals: "", onSchedule: "Yes", notes: "Tracker shows count; detail shows records." },
  { section: "OFFERS (sub-table)", fact: "Offer: company · contact · date · rent · rent-free · term · break · incentives · premium · fit-out · comments", grain: "unit 1:many", owner: "unit_offers", tenancy: "", tracker: "edit", leasing: "read", deals: "", onSchedule: "Yes", notes: "Competing tenants live here. Accepted offer promotes to deal terms." },

  // ============ CLIENT-STRATEGY (leasing-led, editable from tracker too) ============
  { section: "CLIENT-STRATEGY", fact: "Zone / positioning",            grain: "unit 1:1", owner: "leasing_schedule", tenancy: "",     tracker: "",     leasing: "edit", deals: "",     onSchedule: "Yes" },
  { section: "CLIENT-STRATEGY", fact: "Priority",                      grain: "unit 1:1", owner: "leasing_schedule", tenancy: "",     tracker: "",     leasing: "edit", deals: "",     onSchedule: "Yes" },
  { section: "CLIENT-STRATEGY", fact: "Target brands / optimum target", grain: "unit 1:1", owner: "leasing_schedule", tenancy: "",    tracker: "edit", leasing: "edit", deals: "",     onSchedule: "Yes", notes: "Retires tenancy.targetTenants/targetCompanyIds." },
  { section: "CLIENT-STRATEGY", fact: "Client updates (narrative)",    grain: "unit 1:1", owner: "leasing_schedule", tenancy: "",     tracker: "edit", leasing: "edit", deals: "",     onSchedule: "Yes" },

  // ============ RATES & SERVICE CHARGE ============
  { section: "RATES & SC", fact: "Rateable value",                     grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "read", leasing: "",     deals: "",     onSchedule: "Yes" },
  { section: "RATES & SC", fact: "Rates payable pa",                   grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "read", leasing: "read", deals: "",     onSchedule: "Yes" },
  { section: "RATES & SC", fact: "Service charge pa",                  grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "read", leasing: "read", deals: "",     onSchedule: "Yes" },
  { section: "RATES & SC", fact: "Service charge cap",                 grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     onSchedule: "Yes" },
  { section: "RATES & SC", fact: "Insurance pa",                       grain: "unit 1:1", owner: "tenancy",          tenancy: "edit", tracker: "read", leasing: "read", deals: "",     onSchedule: "Yes" },
  { section: "RATES & SC", fact: "Occupancy cost %",                   grain: "derived",  owner: "derived",          tenancy: "",     tracker: "✓",    leasing: "✓",    deals: "",     onSchedule: "Yes" },
];

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BGP";
  wb.created = new Date();

  const ws = wb.addWorksheet("Column ownership", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 1 }],
  });

  ws.columns = [
    { header: "Section",          key: "section",    width: 22 },
    { header: "Fact (one row per atomic value / sub-table)", key: "fact", width: 56 },
    { header: "Grain",            key: "grain",      width: 13 },
    { header: "Owner (source of truth)", key: "owner", width: 20 },
    { header: "Tenancy Schedule", key: "tenancy",    width: 16 },
    { header: "Letting Tracker",  key: "tracker",    width: 16 },
    { header: "Leasing Schedule", key: "leasing",    width: 20 },
    { header: "Deals Board / Deal detail", key: "deals", width: 20 },
    { header: "On a schedule?",   key: "onSchedule", width: 14 },
    { header: "Notes",            key: "notes",      width: 62 },
  ];

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
  header.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  header.height = 38;

  const sectionColours: Record<string, string> = {
    "AREA":                  "FFE0F2FE",
    "RENT":                  "FFFEF3C7",
    "LEASE DATES":           "FFF3E8FF",
    "OCCUPANCY & MARKETING": "FFDCFCE7",
    "UNIT ADDRESS":          "FFEFF6FF",
    "TENANT":                "FFFEE2E2",
    "DEAL":                  "FFE0E7FF",
    "DEAL CONTACTS":         "FFE7E5E4",
    "SOLICITOR":             "FFEDE9FE",
    "FEES":                  "FFFAE8FF",
    "COMPLIANCE":            "FFFEE2E2",
    "INVOICING (Xero)":      "FFD1FAE5",
    "BRAND":                 "FFFFE4E6",
    "HISTORY / AUDIT":       "FFF1F5F9",
    "FILES":                 "FFFEF9C3",
    "VIEWINGS (sub-table)":  "FFFCE7F3",
    "OFFERS (sub-table)":    "FFFCE7F3",
    "CLIENT-STRATEGY":       "FFFFEDD5",
    "RATES & SC":            "FFE5E7EB",
  };

  const verbColours: Record<string, string> = {
    edit:   "FF15803D",
    read:   "FF6B7280",
    filter: "FF7C3AED",
    pill:   "FF0F766E",
    "✓":    "FF6B7280",
  };

  let lastSection = "";
  for (const r of rows) {
    const row = ws.addRow(r);
    const fill = sectionColours[r.section] ?? "FFFFFFFF";
    row.getCell("section").fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    row.getCell("section").font = { bold: r.section !== lastSection };
    if (r.section === lastSection) row.getCell("section").value = "";
    lastSection = r.section;

    for (const key of ["tenancy", "tracker", "leasing", "deals"] as const) {
      const cell = row.getCell(key);
      const v = String(cell.value ?? "").trim();
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      const verb = v.split(" ")[0];
      if (verbColours[verb]) cell.font = { bold: true, color: { argb: verbColours[verb] } };
    }

    const g = row.getCell("grain");
    g.alignment = { horizontal: "center", vertical: "middle" };
    if (String(g.value).includes("1:many")) g.font = { bold: true, color: { argb: "FFB45309" } };
    else if (String(g.value) === "derived") g.font = { italic: true, color: { argb: "FF6B7280" } };
    else if (String(g.value) === "external" || String(g.value) === "company") g.font = { italic: true, color: { argb: "FF7C3AED" } };

    const os = row.getCell("onSchedule");
    os.alignment = { horizontal: "center", vertical: "middle" };
    os.font = String(os.value) === "No"
      ? { bold: true, color: { argb: "FFDC2626" } }
      : { color: { argb: "FF15803D" } };

    row.getCell("notes").font = { italic: true, color: { argb: "FF6B7280" } };
    row.getCell("notes").alignment = { vertical: "middle", wrapText: true };
    row.getCell("fact").alignment = { vertical: "middle", wrapText: true };
    row.alignment = { vertical: "middle" };
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 10 } };

  // ===== Legend sheet =====
  const legend = wb.addWorksheet("Legend");
  legend.columns = [
    { header: "Term",  key: "term",  width: 18 },
    { header: "Means", key: "means", width: 95 },
  ];
  legend.getRow(1).font = { bold: true };
  const legendRows: Array<[string, string]> = [
    ["edit",   "This surface is where the value is created/changed — the single source of truth for it."],
    ["read",   "Displayed but not editable here; reads through a join from the owning table."],
    ["filter", "Used to decide which rows appear (e.g. marketing_active = true)."],
    ["pill",   "Shown as a coloured status pill, not the raw value."],
    ["✓",      "Derived value (computed) — no storage, just shown."],
    ["", ""],
    ["GRAIN", ""],
    ["unit 1:1",   "One value per unit. Candidate for a column on the owning unit table."],
    ["deal 1:1",   "One value per deal. Lives on crm_deals."],
    ["x 1:many",   "A SUB-TABLE, not a column. Many rows per unit/deal (viewings, offers, fee splits, KYC, audit)."],
    ["derived",    "Computed from other fields. Don't store."],
    ["external",   "Lives in another system (SharePoint, MS Graph, Xero, AI)."],
    ["", ""],
    ["On a schedule?", ""],
    ["Yes", "Appears on a schedule / list view (tenancy, letting tracker, leasing)."],
    ["No (red)", "DETAIL-VIEW ONLY — the schedules never show this. The facts the list views were hiding."],
    ["", ""],
    ["RULES", ""],
    ["", "TWO-LAYER SPINE: property_units owns PHYSICAL facts (address, area, EPC, condition, use class) — permanent, survives lease changes. tenancy_schedule_units owns LEASE/INCOME facts. Everyone reads through."],
    ["", "Each fact has exactly one owner. Other surfaces read it via the spine link (unit_id → property_units, tenancy_unit_id → tenancy, deal_id → crm_deals)."],
    ["", "GAP: tenancy_schedule_units has no FK to property_units yet — must be added + back-filled (see integrity-gate-report.sql query 4)."],
    ["", "FOUR rents, all distinct: passing · ERV · quoting · agreed. Never collapsed."],
    ["", "The Leasing Schedule IS the client view — there is no separate client property page."],
    ["", "Letting Tracker is mostly a read-through view; editing happens at the source of truth."],
    ["", "Deal is born at Solicitors (WIP form), NOT on Add-Unit. Add-Unit writes property_units + tenancy_schedule_units."],
  ];
  for (const [term, means] of legendRows) {
    const r = legend.addRow({ term, means });
    if (["GRAIN", "On a schedule?", "RULES"].includes(term)) r.font = { bold: true };
  }

  const out = "docs/unit-column-ownership.xlsx";
  await wb.xlsx.writeFile(out);
  const detailOnly = rows.filter((r) => r.onSchedule === "No").length;
  console.log(`wrote ${out} — ${rows.length} facts, ${detailOnly} detail-only`);
}

main().catch((e) => { console.error(e); process.exit(1); });
