import ServicePage from "../components/ServicePage";
import ClientRow from "../components/ClientRow";
import { CONSULTANCY_BODY, CONSULTANCY_CLIENTS, CONSULTANCY_SERVICES, CONSULTANCY_TESTIMONIAL, SERVICES } from "../lib/content";
import { useSiteContent } from "../lib/site-content";

export default function Consultancy() {
  const service = SERVICES.find((s) => s.slug === "consultancy")!;
  const { caseStudies, contacts, team } = useSiteContent();
  // Slide 41 shows three contacts: the feed's directors, then the rest of the team.
  const people = [...contacts.consultancy, ...team.filter((p) => /consultan/i.test(p.team || p.title) && !contacts.consultancy.some((c) => c.name === p.name))].slice(0, 3);
  return (
    <ServicePage
      title="Consultancy"
      hero={{ src: "/images/centres/one-new-change.jpg", alt: "The One New Change roof terrace and St Paul's" }}
      intro={service.intro}
      body={CONSULTANCY_BODY}
      clients={<ClientRow clients={CONSULTANCY_CLIENTS} />}
      services={CONSULTANCY_SERVICES}
      servicesVariant="list"
      quote={CONSULTANCY_TESTIMONIAL}
      caseStudies={caseStudies.filter((c) => c.service === "Consultancy")}
      contacts={people}
    />
  );
}
