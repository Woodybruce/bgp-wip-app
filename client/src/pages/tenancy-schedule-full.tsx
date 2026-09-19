// Full-board view of a property's tenancy schedule. Mirrors what
// /leasing-schedule/:propertyId does for the leasing side — a wide,
// dedicated route for when the sidebar-sized inline view isn't enough.
import { useRoute, useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import { PropertyTenancySchedule } from "@/components/PropertyTenancySchedule";
import type { CrmProperty } from "@shared/schema";

export default function TenancyScheduleFull() {
  const [, params] = useRoute("/tenancy-schedule/:propertyId");
  const [, navigate] = useLocation();
  const propertyId = params?.propertyId;
  const { data: property } = useQuery<CrmProperty>({
    queryKey: ["/api/crm/properties", propertyId],
    enabled: !!propertyId,
  });
  if (!propertyId) return <div className="p-6 text-center text-muted-foreground">No property selected.</div>;

  return (
    <div className="p-4 sm:p-6 max-w-[1800px] mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/properties/${propertyId}`)}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to property
        </Button>
        <FileSpreadsheet className="w-5 h-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Tenancy Schedule</h1>
        {property && (
          <Link href={`/properties/${property.id}`} className="text-sm text-muted-foreground hover:underline">
            · {property.name}
          </Link>
        )}
      </div>
      <PropertyTenancySchedule propertyId={propertyId} />
    </div>
  );
}
