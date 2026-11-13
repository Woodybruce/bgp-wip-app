// Data and actions for the plan-led property page
// (docs/property-page-rebuild-2026-11-13.md). One read of the property's units
// (GET /api/properties/:id/units) feeds the unit list, the plan colouring and
// the pills, so a unit says the same thing in each place. The plan's outlines
// and proposals come from the match board (GET /api/plans/:id/match). Every
// change here refreshes both, and the older Plans card's own reads.
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { PropertyUnitDetail, PropertyUnitsFeed } from "@shared/property-units";
import type { PlanMatchBoard } from "@shared/property-plan-match";
import type { PropertyPlanPolygon } from "@shared/property-plan-scan";

export const propertyUnitsKey = (propertyId: string) => ["/api/properties", propertyId, "units"] as const;
export const planMatchKey = (planId: string) => ["/api/plans", planId, "match"] as const;

// "409: This unit already has an outline…" reads better without the number.
export const plainError = (error: unknown) => String((error as any)?.message || error || "Something went wrong").replace(/^\d{3}:\s*/, "");

export function usePropertyUnits(propertyId: string | null) {
  return useQuery<PropertyUnitsFeed>({
    queryKey: propertyUnitsKey(propertyId || ""),
    queryFn: async () => (await apiRequest("GET", `/api/properties/${encodeURIComponent(propertyId!)}/units`)).json(),
    enabled: !!propertyId,
    staleTime: 30 * 1000,
    retry: false,
  });
}

export function usePropertyUnitDetail(propertyId: string, unitId: string | null) {
  return useQuery<PropertyUnitDetail>({
    queryKey: [...propertyUnitsKey(propertyId), unitId],
    queryFn: async () => (await apiRequest("GET", `/api/properties/${encodeURIComponent(propertyId)}/units/${encodeURIComponent(unitId!)}`)).json(),
    enabled: !!unitId,
    staleTime: 30 * 1000,
    retry: false,
  });
}

// The board is re-read every few seconds while a scan is running.
export function usePlanMatchBoard(planId: string | null) {
  return useQuery<PlanMatchBoard>({
    queryKey: planMatchKey(planId || ""),
    queryFn: async () => (await apiRequest("GET", `/api/plans/${encodeURIComponent(planId!)}/match`)).json(),
    enabled: !!planId,
    staleTime: 15 * 1000,
    retry: false,
    refetchInterval: query => (query.state.data?.scan?.status === "running" ? 3000 : false),
  });
}

export interface PlanMatchActions {
  busy: boolean;
  // Save a scan's proposal as an outline: on a schedule row, or with none (context).
  accept: (input: { scanId: string; candidateId: string; scheduleRowId: string | null; label?: string }) => Promise<{ outlineId: string }>;
  acceptSuggested: (scanId: string) => Promise<{ created: number; skipped: Array<{ label: string; reason: string }> }>;
  // "Not a unit": the proposal leaves the queue. dismissed: false puts it back.
  dismiss: (input: { scanId: string; candidateId: string; dismissed: boolean }) => Promise<void>;
  restoreDismissed: (scanId: string) => Promise<void>;
  // Point a saved outline at another schedule row, or at none (context).
  relink: (outlineId: string, scheduleRowId: string | null) => Promise<void>;
  removeOutline: (outlineId: string) => Promise<void>;
  // Find the walls around a point on the plan. Nothing is saved until saveTraced.
  trace: (point: { x: number; y: number }) => Promise<{ polygon: PropertyPlanPolygon; imageKey: string }>;
  saveTraced: (input: { polygon: PropertyPlanPolygon; imageKey: string; scheduleRowId: string | null; label: string }) => Promise<{ id: string }>;
  startScan: () => Promise<void>;
}

export function usePlanMatchActions(propertyId: string, planId: string | null): PlanMatchActions {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(0);
  const refresh = useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["/api/plans", planId, "match"] }),
    queryClient.invalidateQueries({ queryKey: propertyUnitsKey(propertyId) }),
    queryClient.invalidateQueries({ queryKey: ["/api/plans", planId, "units"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/plans", planId, "scan"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/plans", "property-links", propertyId] }),
  ]), [queryClient, propertyId, planId]);
  const run = useCallback(async <T,>(method: string, path: string, body?: unknown, refreshAfter = true): Promise<T> => {
    if (!planId) throw new Error("Choose a plan first");
    setRunning(n => n + 1);
    try {
      const reply = await (await apiRequest(method, path, body)).json();
      return reply as T;
    } finally {
      if (refreshAfter) await refresh().catch(() => {});
      setRunning(n => n - 1);
    }
  }, [planId, refresh]);
  const plan = `/api/plans/${encodeURIComponent(planId || "")}`;
  return {
    busy: running > 0,
    accept: input => run("POST", `${plan}/match/accept`, input),
    acceptSuggested: scanId => run("POST", `${plan}/match/accept-suggested`, { scanId }),
    dismiss: async input => { await run("POST", `${plan}/match/dismiss`, input); },
    restoreDismissed: async scanId => { await run("POST", `${plan}/match/dismiss`, { scanId, restoreAll: true }); },
    relink: async (outlineId, scheduleRowId) => { await run("PATCH", `/api/plan-units/${encodeURIComponent(outlineId)}`, { tenancy_unit_id: scheduleRowId, unit_id: null }); },
    removeOutline: async outlineId => { await run("DELETE", `/api/plan-units/${encodeURIComponent(outlineId)}`); },
    trace: point => run("POST", `${plan}/trace-unit`, point, false),
    saveTraced: input => run("POST", `${plan}/units`, { polygon: input.polygon, imageKey: input.imageKey, tenancy_unit_id: input.scheduleRowId, label: input.label }),
    startScan: async () => { await run("POST", `${plan}/scan`, {}); },
  };
}

// The plan-led page is opt-in while it is being tried. The choice is kept in
// this browser; ?layout=plan or ?layout=classic in the address sets it, so a
// link can open the page either way.
const LAYOUT_KEY = "bgp_property_plan_layout";
export function usePlanLedLayout(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => {
    try {
      const asked = new URLSearchParams(window.location.search).get("layout");
      if (asked === "plan" || asked === "classic") {
        window.localStorage.setItem(LAYOUT_KEY, asked === "plan" ? "1" : "0");
        return asked === "plan";
      }
      return window.localStorage.getItem(LAYOUT_KEY) === "1";
    } catch { return false; }
  });
  const set = useCallback((next: boolean) => {
    try { window.localStorage.setItem(LAYOUT_KEY, next ? "1" : "0"); } catch { /* private browsing: the choice lasts for this visit */ }
    setOn(next);
  }, []);
  return [on, set];
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
export const money = (value: number | null | undefined) => (value == null ? "—" : gbp.format(value));
export const area = (value: number | null | undefined) => (value == null ? "—" : `${Math.round(value).toLocaleString("en-GB")} sq ft`);
// "2027-03-25" as "Mar 2027" (lists) or "25 Mar 2027" (the unit panel).
export function shortDate(value: string | null | undefined, withDay = false): string {
  if (!value) return "—";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", withDay ? { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } : { month: "short", year: "numeric", timeZone: "UTC" });
}
