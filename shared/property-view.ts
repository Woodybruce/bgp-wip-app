import { calendarDateValue } from "./calendar-date";
import type { PropertyView } from "./schema";
import { isArchivedTenancy } from "./tenancy-schedule-display";

export interface PropertyOverviewUnit {
  id: string | number;
  property_unit_id?: string | null;
  unit_number?: string | null;
  premises?: string | null;
  floor_level?: string | null;
  permitted_use?: string | null;
  tenant_name?: string | null;
  trading_name?: string | null;
  status?: string | null;
  occupancy_status?: string | null;
  is_vacant?: boolean;
  passing_rent_pa?: number | string | null;
  lease_expiry?: string | null;
  break_date?: string | null;
  landlord_break_date?: string | null;
  next_review_date?: string | null;
}

export const PROPERTY_VIEW_LABELS: Record<PropertyView, string> = {
  building: "Building", multi_let: "Multi-let / mixed-use", centre: "Shopping centre / estate",
};

export function currentPropertyUnits(rows: PropertyOverviewUnit[]): PropertyOverviewUnit[] {
  return rows.filter(row => !isArchivedTenancy(row));
}

// Presentation can be simple for a known office without asserting a unit
// count. Physical IDs avoid counting separate leases as units.
export function suggestPropertyView(assetClass: string | null | undefined, rows: PropertyOverviewUnit[] | undefined): PropertyView | null {
  if (/\bshopping cent(?:re|er)\b|\bretail park\b|\bindustrial estate\b/i.test(assetClass || "")) return "centre";
  const fallback = /\bmixed[ -]use\b/i.test(assetClass || "") ? "multi_let" : /\boffices?\b|\bresidential\b/i.test(assetClass || "") ? "building" : null;
  if (!rows) return fallback;
  const current = currentPropertyUnits(rows);
  const canonical = current.filter(row => !row.is_vacant);
  if (!canonical.length) return fallback;
  const count = new Set(current.map(row => row.property_unit_id || `row:${row.id}`)).size;
  if (count > 1 || /\bmixed[ -]use\b/i.test(assetClass || "")) return "multi_let";
  return "building";
}

export function propertyOverviewFacts(rows: PropertyOverviewUnit[], today: string) {
  const current = currentPropertyUnits(rows);
  let knownRent = 0, rentRows = 0;
  const events: Array<{ unit: PropertyOverviewUnit; kind: string; date: string }> = [];
  for (const unit of current) {
    if (unit.passing_rent_pa !== null && unit.passing_rent_pa !== undefined && String(unit.passing_rent_pa).trim() !== "") {
      const rent = Number(unit.passing_rent_pa);
      if (Number.isFinite(rent) && rent >= 0) { knownRent += rent; rentRows++; }
    }
    for (const [key, kind] of [["lease_expiry", "Lease expiry"], ["break_date", "Break date"], ["landlord_break_date", "Landlord break"], ["next_review_date", "Rent review"]] as const) {
      const date = calendarDateValue(unit[key]);
      if (date) events.push({ unit, kind, date });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  return { units: current, knownRent: rentRows ? knownRent : null, rentRows,
    nextEvents: events.filter(event => event.date >= today),
    pastEvents: events.filter(event => event.date < today),
  };
}
