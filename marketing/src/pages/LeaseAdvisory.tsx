import ServicePage from "../components/ServicePage";
import ClientRow from "../components/ClientRow";
import { LEASE_ADVISORY_BODY, LEASE_ADVISORY_CLIENTS, LEASE_ADVISORY_SERVICES, SERVICES } from "../lib/content";
import { useSiteContent } from "../lib/site-content";

export default function LeaseAdvisory() {
  const service = SERVICES.find((s) => s.slug === "lease-advisory")!;
  const { caseStudies, contacts } = useSiteContent();
  return (
    <ServicePage
      title="Lease Advisory"
      hero={{ src: "/images/clients/birmingham-st-martins.jpg", alt: "St Martin's Square, Birmingham" }}
      intro={service.intro}
      body={LEASE_ADVISORY_BODY}
      clients={<ClientRow clients={LEASE_ADVISORY_CLIENTS} />}
      services={LEASE_ADVISORY_SERVICES}
      caseStudies={caseStudies.filter((c) => c.service === "Lease Advisory")}
      contacts={contacts.lease_advisory}
    />
  );
}
