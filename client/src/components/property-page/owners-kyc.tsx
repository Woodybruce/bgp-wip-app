// The KYC of the building's owners on the property page (Woody, 24 November
// 2026, on Touchwood: "I think this KYC board is old?"). The shared Companies
// and KYC card for its Owner, Freeholder and Long leaseholder: one build for
// AML, the same card as the company page and the AML page's Companies view.
// Replaces the older company checks card here for BGP staff.
import { AccountEntitiesPanel } from "@/components/account-entities-panel";

const ROLES = [["Owner", "landlordId"], ["Freeholder", "freeholderId"], ["Long leaseholder", "longLeaseholderId"]] as const;

/** "Owner", "Owner and Freeholder", "Owner, Freeholder and Long leaseholder". */
export function joinRoles(labels: string[]): string {
  return labels.length <= 1 ? labels[0] || "" : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function PropertyOwnersKyc({ property }: { property: { landlordId?: string | null; freeholderId?: string | null; longLeaseholderId?: string | null } }) {
  const byCompany = new Map<string, string[]>();
  for (const [label, field] of ROLES) {
    const id = property[field];
    if (id) byCompany.set(id, [...(byCompany.get(id) || []), label]);
  }
  if (!byCompany.size) return null;
  return (
    <div className="space-y-3" data-testid="property-owners-kyc">
      {[...byCompany.entries()].map(([id, labels]) => <AccountEntitiesPanel key={id} companyId={id} label={joinRoles(labels)} />)}
    </div>
  );
}
