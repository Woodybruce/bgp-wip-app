// The Brand CRM inside the Landsec workspace (/landsec/brand-crm). A joint
// agent cannot open Brand Intelligence, so its targets and diary live here,
// cut by the server to its own schemes with no brand ids, contacts or notes.
// Other Landsec logins and BGP staff reach the same views from the Brand CRM
// pill in Brand Intelligence; this page shows them the same thing.
import { useQuery } from "@tanstack/react-query";
import { useBrand } from "@/lib/brand-context";
import { BrandCrmTab } from "@/components/brand-crm/brand-crm-tab";

export default function LandsecBrandCrm() {
  const { data: user, isLoading } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const { brand } = useBrand();
  const isClient = user?.role === "Client" || !!user?.companyScopeId;
  const staff = !!user && !isClient;
  const allowed = staff || (!!user && brand.id === "landsec");
  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="landsec-brand-crm">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Brand CRM</h1>
        <p className="text-sm text-muted-foreground mt-0.5">The brands being targeted for your schemes and the stage each has reached</p>
      </div>
      {allowed ? <BrandCrmTab staff={staff} /> : !isLoading && <p className="text-sm text-muted-foreground">The Brand CRM is not available for this account.</p>}
    </div>
  );
}
