// What the Letting Tracker reads when it opens, kept apart from the page so
// the Deals hub can ask for it while the tracker's own code is still loading
// (the page is a separate download of some fifty files).
import { apiRequest } from "@/lib/queryClient";

// Company names, types and the two picker sub-labels: five fields of each
// company from the list route, never the whole list (over a hundred fields a
// row, about 60 MB on the live data). Same rows and the same client cut. Its
// key starts with the list's, so a change to any company refreshes it.
const TRACKER_COMPANIES_URL = "/api/crm/companies?fields=id,name,companyType,ukEntityName,domainUrl";
export const trackerCompaniesQuery = {
  queryKey: ["/api/crm/companies", "tracker-lookup"] as const,
  queryFn: async () => (await apiRequest("GET", TRACKER_COMPANIES_URL)).json(),
};

// The four reads the table is drawn from: the tracker shows its rows once
// each has answered.
export const TRACKER_TABLE_READS = ["/api/available-units", "/api/crm/deals", "/api/crm/properties", "/api/unit-briefs"] as const;

// The reads that fill cells and chips after that. Each one landing by itself
// draws the whole table again, so on a first open they are asked for early
// and are, as a rule, all there when the table is first drawn.
export const TRACKER_CELL_READS = [
  "/api/deal-checklists/summary",
  "/api/unit-recommendations/summary",
  "/api/available-units/all-viewings",
  "/api/available-units/all-interest",
  "/api/available-units/all-offers",
  "/api/crm/fee-allocations",
] as const;
