import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Receipt, Building2 } from "lucide-react";
import { Link } from "wouter";

type Company = {
  id: string;
  name: string;
  companyType?: string | null;
  headOfficeAddress?: any;
  companiesHouseNumber?: string | null;
  kycStatus?: string | null;
  kycCheckedAt?: string | null;
};

type Deal = {
  id: string;
  name: string;
  status?: string | null;
  invoicingEntityId?: string | null;
  propertyId?: string | null;
};

export function BillingEntityPanel({ company }: { company: Company }) {
  const { data: deals = [] } = useQuery<Deal[]>({
    queryKey: ["/api/crm/deals"],
  });

  const linkedDeals = deals.filter((d) => d.invoicingEntityId === company.id);

  const addr = company.headOfficeAddress
    ? typeof company.headOfficeAddress === "string"
      ? company.headOfficeAddress
      : (company.headOfficeAddress.address || [
          company.headOfficeAddress.line1,
          company.headOfficeAddress.line2,
          company.headOfficeAddress.city,
          company.headOfficeAddress.postcode,
        ].filter(Boolean).join(", "))
    : null;

  const kycBadge = company.kycStatus
    ? company.kycStatus === "approved"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : company.kycStatus === "rejected" || company.kycStatus === "expired"
        ? "bg-red-50 text-red-700 border-red-200"
        : "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-zinc-50 text-zinc-600 border-zinc-200";

  return (
    <Card data-testid="billing-entity-panel">
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Receipt className="w-4 h-4 text-zinc-500" />
          Invoicing Entity
          <Badge className={`${kycBadge} text-[10px]`}>KYC {company.kycStatus || "not run"}</Badge>
          {company.companiesHouseNumber && (
            <Badge variant="outline" className="text-[10px]">CH {company.companiesHouseNumber}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="border border-border/40 rounded p-1.5">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Type</div>
            <div className="text-xs font-medium">{company.companyType || "Billing Entity"}</div>
          </div>
          <div className="border border-border/40 rounded p-1.5">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide">KYC checked</div>
            <div className="text-xs font-medium">{company.kycCheckedAt ? new Date(company.kycCheckedAt).toLocaleDateString("en-GB") : "—"}</div>
          </div>
        </div>
        {addr && (
          <div className="border border-border/40 rounded p-2">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Registered address</div>
            <div className="text-xs">{addr}</div>
          </div>
        )}
        <div>
          <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
            <Building2 className="w-3 h-3" /> Linked deals ({linkedDeals.length})
          </div>
          {linkedDeals.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">Not used as invoicing entity on any deal</div>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {linkedDeals.map((d) => (
                <div key={d.id} className="flex justify-between text-xs border-b border-border/40 pb-1">
                  <Link href={`/deals/${d.id}`} className="hover:underline truncate flex-1">{d.name}</Link>
                  {d.status && <Badge variant="outline" className="text-[10px] shrink-0 ml-2">{d.status}</Badge>}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
