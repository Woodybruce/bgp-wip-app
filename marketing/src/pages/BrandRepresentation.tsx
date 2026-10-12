import ServicePage from "../components/ServicePage";
import ClientRow from "../components/ClientRow";
import { BRAND_REP_CLIENTS, BRAND_REP_SERVICES, SERVICE_COPY, SERVICES } from "../lib/content";
import { useSiteContent } from "../lib/site-content";

export default function BrandRepresentation() {
  const service = SERVICES.find((s) => s.slug === "brand-representation")!;
  const { caseStudies, contacts } = useSiteContent();
  return (
    <ServicePage
      hero={{ src: "/images/case-studies/percival-neal-street.jpg", alt: "Percival's store on Neal Street, Seven Dials" }}
      intro={service.intro}
      body={SERVICE_COPY.brandRepresentation.body}
      clientsBlurb="Four pillars, one approach: international labels making their UK debut, independents finding the right street, hospitality operators rolling out, and wellness brands building neighbourhoods."
      clients={<ClientRow clients={BRAND_REP_CLIENTS} />}
      services={BRAND_REP_SERVICES}
      caseStudies={caseStudies.filter((c) => c.service === "Brand Representation")}
      contacts={contacts.brand_representation}
      contactsBlurb="Our brand representation team supports occupiers from first site to full network."
    />
  );
}
