// One way to link to a unit (consistency review, 14 November 2026, part 1):
// to its row on the login's own Letting Tracker, and to the unit on its
// property page (the Plan tab opens it in the unit panel; the classic page
// scrolls to its schedule row). Every screen that links a unit uses these.
export type UnitLinkViewer = { staff: boolean; landsecView: boolean; restricted: boolean };

export function trackerUnitHref(trackerId: string | null | undefined, propertyId: string | null | undefined, viewer: UnitLinkViewer): string | null {
  if (!trackerId) return null;
  const unit = encodeURIComponent(trackerId);
  if (viewer.restricted) return `/landsec/tracker?unit=${unit}`;
  const base = viewer.staff && !viewer.landsecView ? "/available" : "/deals/letting";
  return `${base}?unitId=${unit}${propertyId ? `&propertyId=${encodeURIComponent(propertyId)}` : ""}`;
}

export function propertyUnitHref(propertyId: string | null | undefined, scheduleRowId: string | null | undefined): string | null {
  if (!propertyId || !scheduleRowId) return null;
  return `/properties/${encodeURIComponent(propertyId)}#tenancy-unit-${encodeURIComponent(scheduleRowId)}`;
}
