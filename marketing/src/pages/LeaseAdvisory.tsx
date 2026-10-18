import ServicePage from "../components/ServicePage";
import ClientRow from "../components/ClientRow";
import { LEASE_ADVISORY_BODY, LEASE_ADVISORY_CLIENTS, LEASE_ADVISORY_SERVICES, SERVICES } from "../lib/content";
import { useSiteContent } from "../lib/site-content";

export default function LeaseAdvisory() {
  const service = SERVICES.find((s) => s.slug === "lease-advisory")!;
  const { caseStudies, contacts, team } = useSiteContent();
  // Slide 38 shows three contacts: the feed's directors, then the rest of the team.
  const people = [...contacts.lease_advisory, ...team.filter((p) => /lease advisory/i.test(p.team || p.title) && !contacts.lease_advisory.some((c) => c.name === p.name))].slice(0, 3);
  return (
    <ServicePage
      title="Lease Advisory"
      hero={{ src: "/images/clients/birmingham-st-martins.jpg", alt: "St Martin's Square, Birmingham" }}
      intro={service.intro}
      body={LEASE_ADVISORY_BODY}
      clients={<ClientRow clients={LEASE_ADVISORY_CLIENTS} minimumSlots={14} />}
      services={LEASE_ADVISORY_SERVICES}
      caseStudies={caseStudies.filter((c) => c.service === "Lease Advisory")}
      contacts={people}
    />
  );
}
