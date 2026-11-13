// The Landsec menu (docs/landsec-menu-plan-2026-11-12.md, parts 1, 2 and 6).
// Woody, 2026-11-12: "The side bar should have Properties, deals and letting
// tracker"; Brands stays; Ask goes, because chat is the chat panel.
//
// One list of addresses and one rule for which entry is lit, used by the
// desktop side bar and the phone tabs, so the two cannot drift.
import { RESTRICTED_LANDSEC_ROLES } from "./landsec";
import { legacyToCode } from "./deal-status";

// A full Landsec login (no role, a leasing manager or an asset manager) and
// BGP staff viewing as Landsec use the real pages.
export const LANDSEC_MENU = {
  properties: "/deals/properties",
  deals: "/deals",
  tracker: "/deals/letting",
  brands: "/brands",
  chat: "/messages",
} as const;

// A joint agent keeps the scheme-limited pages: the same two labels, its
// own addresses. "/deals" is not on its route list, so it is never sent to
// the addresses above. An asset manager is a full Landsec login (Woody,
// 2026-11-13) and uses the menu above.
export const LANDSEC_RESTRICTED_MENU = {
  properties: "/",
  deals: "/landsec/deals",
} as const;

export const landsecRestrictedRole = (role: unknown): boolean =>
  (RESTRICTED_LANDSEC_ROLES as string[]).includes(String(role || ""));

// Which menu entry is lit at an address. `url` is the entry's own address,
// `location` the page's path. Returns null for an entry this rule does not
// own (a joint agent's Tracker, Viewings, Tasks and Brand CRM), so the menu's
// ordinary rule decides.
//
// "/deals" used to mean "any address starting /deals", which lit Deals on
// Properties and the Letting Tracker as well.
export function landsecMenuActive(url: string, location: string): boolean | null {
  const loc = location.split("?")[0].split("#")[0];
  const at = (p: string) => loc === p || loc.startsWith(p + "/");
  switch (url.split("?")[0]) {
    case LANDSEC_MENU.properties:
      return at("/deals/properties") || at("/properties") || at("/landsec/unit");
    case LANDSEC_MENU.tracker:
      return at("/deals/letting") || at("/available");
    case LANDSEC_MENU.deals:
      return at("/deals") && !at("/deals/properties") && !at("/deals/letting");
    case LANDSEC_MENU.brands:
      // Any Brands address, the Brand CRM tab included, and the brand cases
      // that are reached from Brands.
      return at("/brands") || loc.startsWith("/landsec/brand-case");
    case LANDSEC_MENU.chat:
      return at("/messages") || at("/chatbgp");
    case LANDSEC_RESTRICTED_MENU.properties:
      return loc === "/" || loc === "/home";
    case LANDSEC_RESTRICTED_MENU.deals:
      return at("/landsec/deals");
    default:
      return null;
  }
}

// Where the old scheme page sends a full login: the scheme's property page,
// open on its "Units and lettings" section. A scheme with no property record
// has no page to open, so it goes to Properties.
export function landsecSchemeRedirect(propertyId: string | null | undefined): string {
  return propertyId ? `/properties/${encodeURIComponent(propertyId)}?section=units` : LANDSEC_MENU.properties;
}

// What the Deals list opens with (deals.tsx): the address first, then the
// filters saved in the session. A link that names a stage or a clock filter
// (the Properties stage pills, "?status=NEG" and "?clock=stuck") is the WHOLE
// filter: the other one, the search, the property, its scheme and the region
// are taken as "all", never from the session. Read one by one, Negotiating
// then Stuck opened "?clock=stuck&status=NEG", and a stale clock filter
// stayed on behind every later pill. The saved column filters go too, bar the
// team (it has its own rule): a saved Deal Type filter left no deal at the
// stage, and Deals then fell back to listing every deal.
export interface DealListSaved {
  search?: string;
  activeGroup?: string;
  columnFilters?: Record<string, string[]>;
  propertyId?: string | null;
  scheme?: string;
  location?: string;
  clock?: string;
}
export const dealsLinkIsWholeFilter = (params: URLSearchParams): boolean => params.has("status") || params.has("clock");
export function dealListSeed(params: URLSearchParams, saved: DealListSaved | null | undefined) {
  const whole = dealsLinkIsWholeFilter(params);
  const kept = whole ? null : saved;
  const team = saved?.columnFilters?.team;
  return {
    search: params.get("q") || params.get("search") || kept?.search || "",
    status: legacyToCode(params.get("status")) || kept?.activeGroup || "all",
    propertyId: params.get("propertyId") || kept?.propertyId || null,
    scheme: params.get("scheme") || kept?.scheme || "",
    location: params.get("location") || kept?.location || "all",
    clock: params.get("clock") || kept?.clock || "all",
    columnFilters: whole ? (team ? { team } : {}) : { ...(saved?.columnFilters || {}) },
  };
}
