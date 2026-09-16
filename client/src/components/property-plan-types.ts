export interface PropertyPlan {
  id: string;
  property_id: string;
  floor: string;
  display_order: number;
  width: number | null;
  height: number | null;
  source: string | null;
  notes: string | null;
}

export interface PlanPolygon { points: [number, number][] }

export interface PropertyPlanUnit {
  id: string;
  plan_id: string;
  unit_id: string | null;
  tenancy_unit_id: string | null;
  stored_tenancy_unit_id?: string | null;
  link_state?: "linked" | "ambiguous" | "unlinked" | "legacy";
  label: string | null;
  polygon: PlanPolygon;
  status_override: string | null;
  unit_name: string | null;
  unit_sqft: number | null;
  unit_floor: string | null;
  tenant_name: string | null;
  rent_pa: number | null;
  lease_expiry: string | null;
  lease_break: string | null;
  rent_review: string | null;
  lease_status: string | null;
  leasing_schedule_unit_id: string | null;
  available_unit_id: string | null;
  marketing_status: string | null;
  asking_rent: number | null;
  active_deals: Array<{ id: string; name: string; status: string; tenant_id: string | null; deal_type: string | null }> | null;
  status: string;
}

export interface PickablePlanUnit {
  id: string | null;
  unit_id: string | null;
  tenancy_unit_id: string | null;
  unit_name: string;
  floor: string | null;
  sqft: number | null;
  tenant_name: string | null;
  lease_status: string | null;
}

export function planUnitChoiceKey(unit: { tenancy_unit_id?: string | null; unit_id?: string | null }): string {
  return unit.tenancy_unit_id ? `tenancy:${unit.tenancy_unit_id}` : unit.unit_id ? `unit:${unit.unit_id}` : "";
}
