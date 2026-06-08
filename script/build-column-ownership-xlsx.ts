import ExcelJS from "exceljs";

const rows: Array<{
  section: string;
  fact: string;
  owner: string;
  tenancy: string;
  tracker: string;
  leasing: string;
  deals: string;
  clientPage: string;
  notes?: string;
}> = [
  // AREA
  { section: "AREA", fact: "NIA sqft",                                     owner: "tenancy",          tenancy: "edit", tracker: "read", leasing: "read", deals: "read", clientPage: "read" },
  { section: "AREA", fact: "GIA sqft",                                     owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "",     deals: "read", clientPage: "" },
  { section: "AREA", fact: "ITZA sqft",                                    owner: "tenancy",          tenancy: "edit", tracker: "read", leasing: "read", deals: "read", clientPage: "read" },
  { section: "AREA", fact: "Floor breakdown (bsmt/ground/first/other)",    owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "",     deals: "read", clientPage: "" },

  // RENT — three flavours never collapsed
  { section: "RENT", fact: "Passing rent pa (current tenant)",             owner: "tenancy",          tenancy: "edit", tracker: "read", leasing: "read", deals: "",     clientPage: "read", notes: "Only changes on deal Complete. Sum = rent roll." },
  { section: "RENT", fact: "ERV pa (BGP/client valuation view)",           owner: "tenancy",          tenancy: "edit", tracker: "read", leasing: "read", deals: "",     clientPage: "read", notes: "Agreed between BGP & client. Visible to all." },
  { section: "RENT", fact: "Quoting rent pa (asking, going to market)",    owner: "tenancy (NEW col)",tenancy: "edit", tracker: "read", leasing: "read", deals: "read", clientPage: "read", notes: "Defaults to ERV when marketing turns on, editable." },
  { section: "RENT", fact: "Agreed deal rent pa (final number we hit)",    owner: "crm_deals",        tenancy: "",     tracker: "read", leasing: "read", deals: "edit", clientPage: "",     notes: "The final agreed rental — can differ from passing, ERV AND quoting. Becomes the new passing rent on Complete." },
  { section: "RENT", fact: "Rent psf (derived)",                           owner: "derived",          tenancy: "✓",    tracker: "✓",    leasing: "✓",    deals: "✓",    clientPage: "✓" },
  { section: "RENT", fact: "Turnover rent payable / %",                    owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     clientPage: "" },
  { section: "RENT", fact: "Rent free (months / £)",                       owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", clientPage: "" },
  { section: "RENT", fact: "Capex / capital contribution",                 owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", clientPage: "" },
  { section: "RENT", fact: "Rent review profile (open/fixed/RPI)",         owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     clientPage: "" },

  // LEASE DATES
  { section: "LEASE DATES", fact: "Lease start",                           owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "",     deals: "",     clientPage: "" },
  { section: "LEASE DATES", fact: "Lease expiry",                          owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     clientPage: "read" },
  { section: "LEASE DATES", fact: "Tenant break date",                     owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     clientPage: "" },
  { section: "LEASE DATES", fact: "Landlord break date",                   owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     clientPage: "" },
  { section: "LEASE DATES", fact: "Next rent review date",                 owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     clientPage: "" },
  { section: "LEASE DATES", fact: "Term years",                            owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "",     deals: "",     clientPage: "" },
  { section: "LEASE DATES", fact: "Unexpired term (to break / expiry)",    owner: "derived",          tenancy: "✓",    tracker: "",     leasing: "✓",    deals: "",     clientPage: "✓" },
  { section: "LEASE DATES", fact: "Lease length on new deal",              owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", clientPage: "" },
  { section: "LEASE DATES", fact: "Break option on new deal",              owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", clientPage: "" },

  // OCCUPANCY & MARKETING
  { section: "OCCUPANCY & MARKETING", fact: "Occupancy (Vacant/Trading/HO/LEP/Archived)", owner: "tenancy (NEW col)", tenancy: "edit", tracker: "", leasing: "", deals: "", clientPage: "read" },
  { section: "OCCUPANCY & MARKETING", fact: "Marketing active (bool)",     owner: "tenancy (NEW col)",tenancy: "edit", tracker: "filter", leasing: "filter", deals: "", clientPage: "" },
  { section: "OCCUPANCY & MARKETING", fact: "Marketing reason",            owner: "tenancy (NEW col)",tenancy: "edit", tracker: "read", leasing: "read", deals: "",     clientPage: "" },
  { section: "OCCUPANCY & MARKETING", fact: "Marketing start date",        owner: "available_units",  tenancy: "",     tracker: "edit", leasing: "read", deals: "",     clientPage: "read" },
  { section: "OCCUPANCY & MARKETING", fact: "EPC rating",                  owner: "tenancy",          tenancy: "edit", tracker: "read", leasing: "read", deals: "",     clientPage: "read" },
  { section: "OCCUPANCY & MARKETING", fact: "Use class / permitted use",   owner: "tenancy",          tenancy: "edit", tracker: "read", leasing: "read", deals: "",     clientPage: "read" },
  { section: "OCCUPANCY & MARKETING", fact: "Condition",                   owner: "available_units",  tenancy: "",     tracker: "edit", leasing: "",     deals: "",     clientPage: "read" },

  // TENANT
  { section: "TENANT", fact: "Tenant company (current)",                   owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     clientPage: "read (if Trading)" },
  { section: "TENANT", fact: "Trading name",                               owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     clientPage: "read" },
  { section: "TENANT", fact: "Tenant mix / category",                      owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     clientPage: "" },
  { section: "TENANT", fact: "Credit rating",                              owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     clientPage: "" },
  { section: "TENANT", fact: "Tenant on the deal (counterparty)",          owner: "crm_deals",        tenancy: "",     tracker: "read", leasing: "read", deals: "edit", clientPage: "" },

  // DEAL
  { section: "DEAL", fact: "Deal status (the 7)",                          owner: "crm_deals",        tenancy: "",     tracker: "pill", leasing: "pill (cap @ Completed)", deals: "pill", clientPage: "pill (cap @ Completed)" },
  { section: "DEAL", fact: "Internal agents on deal",                      owner: "crm_deals",        tenancy: "",     tracker: "filter (me)", leasing: "read", deals: "read", clientPage: "" },
  { section: "DEAL", fact: "Fee / fee agreement",                          owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", clientPage: "" },
  { section: "DEAL", fact: "AML status",                                   owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", clientPage: "" },
  { section: "DEAL", fact: "Instructed/exchanged/completed/invoiced dates",owner: "crm_deals",        tenancy: "",     tracker: "read", leasing: "read (to Completed)", deals: "edit", clientPage: "" },
  { section: "DEAL", fact: "Pricing / yield (investment deals)",           owner: "crm_deals",        tenancy: "",     tracker: "",     leasing: "",     deals: "edit", clientPage: "" },

  // MARKETING-OPS (tracker)
  { section: "MARKETING-OPS", fact: "Viewings count + last date",          owner: "available_units",  tenancy: "",     tracker: "edit", leasing: "",     deals: "",     clientPage: "" },
  { section: "MARKETING-OPS", fact: "Offers (table)",                      owner: "unit_offers",      tenancy: "",     tracker: "edit", leasing: "",     deals: "",     clientPage: "" },
  { section: "MARKETING-OPS", fact: "Notes / restrictions for ads",        owner: "available_units",  tenancy: "",     tracker: "edit", leasing: "",     deals: "",     clientPage: "read" },

  // CLIENT-STRATEGY (leasing)
  { section: "CLIENT-STRATEGY", fact: "Zone / positioning",                owner: "leasing_schedule", tenancy: "",     tracker: "",     leasing: "edit", deals: "",     clientPage: "read" },
  { section: "CLIENT-STRATEGY", fact: "Priority",                          owner: "leasing_schedule", tenancy: "",     tracker: "",     leasing: "edit", deals: "",     clientPage: "" },
  { section: "CLIENT-STRATEGY", fact: "Target brands / optimum target",    owner: "leasing_schedule", tenancy: "",     tracker: "",     leasing: "edit", deals: "",     clientPage: "" },
  { section: "CLIENT-STRATEGY", fact: "Client updates (narrative)",        owner: "leasing_schedule", tenancy: "",     tracker: "",     leasing: "edit", deals: "",     clientPage: "read" },

  // RATES & SC
  { section: "RATES & SC", fact: "Rateable value",                         owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "",     deals: "",     clientPage: "" },
  { section: "RATES & SC", fact: "Rates payable pa",                       owner: "tenancy",          tenancy: "edit", tracker: "read", leasing: "read", deals: "",     clientPage: "read" },
  { section: "RATES & SC", fact: "Service charge pa",                      owner: "tenancy",          tenancy: "edit", tracker: "read", leasing: "read", deals: "",     clientPage: "read" },
  { section: "RATES & SC", fact: "Service charge cap",                     owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     clientPage: "" },
  { section: "RATES & SC", fact: "Insurance pa",                           owner: "tenancy",          tenancy: "edit", tracker: "",     leasing: "read", deals: "",     clientPage: "" },
  { section: "RATES & SC", fact: "Occupancy cost % (derived)",             owner: "derived",          tenancy: "",     tracker: "",     leasing: "✓",    deals: "",     clientPage: "" },
];

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BGP";
  wb.created = new Date();

  const ws = wb.addWorksheet("Column ownership", {
    views: [{ state: "frozen", xSplit: 3, ySplit: 1 }],
  });

  ws.columns = [
    { header: "Section",          key: "section",    width: 22 },
    { header: "Fact (one row per atomic value)", key: "fact", width: 50 },
    { header: "Owner (source of truth)", key: "owner", width: 22 },
    { header: "Tenancy Schedule",  key: "tenancy",    width: 18 },
    { header: "Letting Tracker",   key: "tracker",    width: 18 },
    { header: "Leasing Schedule",  key: "leasing",    width: 22 },
    { header: "Deals Board",       key: "deals",      width: 20 },
    { header: "Client Property Page", key: "clientPage", width: 22 },
    { header: "Notes",             key: "notes",      width: 60 },
  ];

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
  header.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  header.height = 32;

  const sectionColours: Record<string, string> = {
    "AREA":                    "FFE0F2FE",
    "RENT":                    "FFFEF3C7",
    "LEASE DATES":             "FFF3E8FF",
    "OCCUPANCY & MARKETING":   "FFDCFCE7",
    "TENANT":                  "FFFEE2E2",
    "DEAL":                    "FFE0E7FF",
    "MARKETING-OPS":           "FFFCE7F3",
    "CLIENT-STRATEGY":         "FFFFEDD5",
    "RATES & SC":              "FFE5E7EB",
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

    for (const key of ["tenancy", "tracker", "leasing", "deals", "clientPage"] as const) {
      const cell = row.getCell(key);
      const v = String(cell.value ?? "").trim();
      cell.alignment = { horizontal: "center", vertical: "middle" };
      const verb = v.split(" ")[0];
      if (verbColours[verb]) {
        cell.font = { bold: true, color: { argb: verbColours[verb] } };
      }
    }
    row.getCell("notes").font = { italic: true, color: { argb: "FF6B7280" } };
    row.alignment = { vertical: "middle" };
    row.getCell("fact").alignment = { vertical: "middle", wrapText: true };
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };

  // Legend sheet
  const legend = wb.addWorksheet("Legend");
  legend.columns = [
    { header: "Verb",   key: "verb",  width: 14 },
    { header: "Means",  key: "means", width: 80 },
  ];
  legend.getRow(1).font = { bold: true };
  const legendRows = [
    ["edit",   "This board is where the value is created or changed. The single source of truth."],
    ["read",   "This board displays the value but cannot edit it. Reads through a join from the owning table."],
    ["filter", "This board uses the value to decide which rows appear (e.g. marketing_active = true)."],
    ["pill",   "Shown as a coloured status pill rather than the raw value."],
    ["✓",      "Derived value (computed from other columns) — no storage, just shown."],
    ["",       ""],
    ["RULES",  ""],
    ["",       "Each fact has exactly one owner. Other boards read it via the spine link (tenancy_unit_id)."],
    ["",       "FOUR rents, all distinct: passing (current tenant) · ERV (BGP & client valuation) · quoting (asking) · agreed (final on deal). Never collapsed."],
    ["",       "Edit any cell in columns D–H below to change who sees what. Owner column drives the schema."],
  ];
  for (const [verb, means] of legendRows) {
    const r = legend.addRow({ verb, means });
    if (verb === "RULES") r.font = { bold: true };
  }

  const out = "docs/unit-column-ownership.xlsx";
  await wb.xlsx.writeFile(out);
  console.log(`wrote ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
