import ServicePage from "../components/ServicePage";
import ClientRow from "../components/ClientRow";
import { CONSULTANCY_BODY, CONSULTANCY_CLIENTS, CONSULTANCY_SERVICES, CONSULTANCY_TESTIMONIAL, SERVICES } from "../lib/content";
import { useSiteContent } from "../lib/site-content";

export default function Consultancy() {
  const service = SERVICES.find((s) => s.slug === "consultancy")!;
  const { caseStudies, contacts } = useSiteContent();
  return (
    <ServicePage
      hero={{ src: "/images/centres/one-new-change.jpg", alt: "The One New Change roof terrace and St Paul's" }}
      intro={service.intro}
      body={CONSULTANCY_BODY}
      clients={<ClientRow clients={CONSULTANCY_CLIENTS} />}
      services={CONSULTANCY_SERVICES}
      quote={CONSULTANCY_TESTIMONIAL}
      caseStudies={caseStudies.filter((c) => c.service === "Consultancy")}
      contacts={contacts.consultancy}
    />
  );
}
