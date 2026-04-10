import React, { createContext, useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink } from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";
import { Link } from "wouter";

// ── Types ────────────────────────────────────────────────────────────────────

type EntityType = "deal" | "company" | "contact" | "property";

interface EntityState {
  type: EntityType;
  id: string;
  name: string;
}

interface EntitySidebarContextValue {
  openEntity: (type: EntityType, id: string, name: string) => void;
}

// ── Context ──────────────────────────────────────────────────────────────────

const EntitySidebarContext = createContext<EntitySidebarContextValue>({
  openEntity: () => {},
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function entityHref(type: EntityType, id: string): string {
  switch (type) {
    case "deal": return `/deals/${id}`;
    case "company": return `/companies/${id}`;
    case "contact": return `/contacts/${id}`;
    case "property": return `/properties/${id}`;
  }
}

function entityApiPath(type: EntityType, id: string): string {
  switch (type) {
    case "deal": return `/api/crm/deals/${id}`;
    case "company": return `/api/crm/companies/${id}`;
    case "contact": return `/api/crm/contacts/${id}`;
    case "property": return `/api/crm/properties/${id}`;
  }
}

const TYPE_LABELS: Record<EntityType, string> = {
  deal: "Deal",
  company: "Company",
  contact: "Contact",
  property: "Property",
};

const TYPE_COLORS: Record<EntityType, string> = {
  deal: "bg-indigo-600",
  company: "bg-blue-600",
  contact: "bg-emerald-600",
  property: "bg-amber-600",
};

// ── Detail renderers ─────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex justify-between gap-2 text-sm py-1 border-b border-border last:border-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right font-medium truncate max-w-[60%]">{String(value)}</span>
    </div>
  );
}

function DealDetails({ data }: { data: any }) {
  return (
    <div className="space-y-0.5">
      <Row label="Status" value={data.status} />
      <Row label="Type" value={data.dealType} />
      <Row label="Team" value={Array.isArray(data.team) ? data.team.join(", ") : data.team} />
      <Row label="Agent" value={data.internalAgent} />
      <Row label="Fee" value={data.fee != null ? `£${Number(data.fee).toLocaleString()}` : null} />
      <Row label="Property" value={data.propertyName || (data.property?.name)} />
      <Row label="Company" value={data.companyName || (data.company?.name)} />
      <Row label="Contact" value={data.contactName || (data.contact?.name)} />
    </div>
  );
}

function CompanyDetails({ data }: { data: any }) {
  const contacts = Array.isArray(data.contacts) ? data.contacts : [];
  const activeDeals = Array.isArray(data.activeDeals) ? data.activeDeals : [];
  return (
    <div className="space-y-0.5">
      <Row label="Type" value={data.companyType} />
      <Row label="Sector" value={data.sector} />
      <Row label="Website" value={data.website} />
      {contacts.length > 0 && (
        <Row label="Contacts" value={contacts.map((c: any) => c.name || `${c.firstName} ${c.lastName}`).join(", ")} />
      )}
      {activeDeals.length > 0 && (
        <Row label="Active Deals" value={activeDeals.map((d: any) => d.name).join(", ")} />
      )}
    </div>
  );
}

function ContactDetails({ data }: { data: any }) {
  const activeDeals = Array.isArray(data.activeDeals) ? data.activeDeals : [];
  return (
    <div className="space-y-0.5">
      <Row label="Role" value={data.role || data.jobTitle} />
      <Row label="Company" value={data.companyName || data.company?.name} />
      <Row label="Email" value={data.email} />
      <Row label="Phone" value={data.phone} />
      {activeDeals.length > 0 && (
        <Row label="Active Deals" value={activeDeals.map((d: any) => d.name).join(", ")} />
      )}
    </div>
  );
}

function PropertyDetails({ data }: { data: any }) {
  const linkedCompanies = Array.isArray(data.linkedCompanies) ? data.linkedCompanies : [];
  const activeDeals = Array.isArray(data.activeDeals) ? data.activeDeals : [];
  return (
    <div className="space-y-0.5">
      <Row label="Address" value={data.address} />
      <Row label="Area (sqft)" value={data.areaSqft != null ? Number(data.areaSqft).toLocaleString() : null} />
      <Row label="Status" value={data.status} />
      {linkedCompanies.length > 0 && (
        <Row label="Companies" value={linkedCompanies.map((c: any) => c.name).join(", ")} />
      )}
      {activeDeals.length > 0 && (
        <Row label="Active Deals" value={activeDeals.map((d: any) => d.name).join(", ")} />
      )}
    </div>
  );
}

function EntityDetails({ type, id }: { type: EntityType; id: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: [`entity-sidebar-${type}-${id}`],
    queryFn: async () => {
      const r = await fetch(entityApiPath(type, id), {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-2 mt-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return <p className="text-sm text-muted-foreground mt-4">Could not load details.</p>;
  }

  return (
    <div className="mt-4">
      {type === "deal" && <DealDetails data={data} />}
      {type === "company" && <CompanyDetails data={data} />}
      {type === "contact" && <ContactDetails data={data} />}
      {type === "property" && <PropertyDetails data={data} />}
    </div>
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function EntitySidebarProvider({ children }: { children: React.ReactNode }) {
  const [entity, setEntity] = useState<EntityState | null>(null);

  const openEntity = (type: EntityType, id: string, name: string) => {
    setEntity({ type, id, name });
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) setEntity(null);
  };

  return (
    <EntitySidebarContext.Provider value={{ openEntity }}>
      {children}
      <Sheet open={entity !== null} onOpenChange={handleOpenChange}>
        <SheetContent side="right" className="w-96 flex flex-col gap-0 p-0">
          {entity && (
            <>
              <SheetHeader className="px-5 pt-5 pb-3 border-b">
                <div className="flex items-center gap-2 pr-6">
                  <Badge className={`text-[10px] px-1.5 py-0.5 ${TYPE_COLORS[entity.type]} text-white`}>
                    {TYPE_LABELS[entity.type]}
                  </Badge>
                </div>
                <SheetTitle className="text-base leading-snug">{entity.name}</SheetTitle>
                <Link
                  href={entityHref(entity.type, entity.id)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1"
                  onClick={() => setEntity(null)}
                >
                  Open full record
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <EntityDetails type={entity.type} id={entity.id} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </EntitySidebarContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useEntitySidebar() {
  return useContext(EntitySidebarContext);
}
