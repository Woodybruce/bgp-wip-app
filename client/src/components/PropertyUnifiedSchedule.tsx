// ─────────────────────────────────────────────────────────────────────────
// Unified Schedule — the tenancy rent roll for a property.
//
// The old Lettings lens was retired (Woody, 2026-08-03): it doubled up
// what the Letting Tracker already does, so the board is tenancy-only and
// the schedule toolbar leads with a Letting Tracker button instead.
// ─────────────────────────────────────────────────────────────────────────
import { PropertyTenancySchedule } from "@/components/PropertyTenancySchedule";
import { useQuery } from "@tanstack/react-query";

export function PropertyUnifiedSchedule({ propertyId }: { propertyId: string }) {
  const { data: schedUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isClientSched = !schedUser || schedUser.role === "Client" || !!schedUser.companyScopeId;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 text-[11px] flex-wrap">
        <span className="text-[10px] text-muted-foreground">
          {isClientSched
            ? "The master rent roll — every unit with tenant, rent and lease dates. Live lettings are worked on the Letting Tracker; changes here flow through automatically."
            : "Full rent roll — every column. Toggle off what you don't need. Live lettings live on the Letting Tracker."}
        </span>
      </div>
      <PropertyTenancySchedule propertyId={propertyId} lens="tenancy" />
    </div>
  );
}
