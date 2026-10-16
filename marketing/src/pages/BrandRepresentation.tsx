import ServicePage from "../components/ServicePage";
import { ClientCircle } from "../components/ClientRow";
import { BRAND_REP_PILLARS, BRAND_REP_SERVICES, SERVICE_COPY, SERVICES } from "../lib/content";
import { useSiteContent } from "../lib/site-content";

export default function BrandRepresentation() {
  const service = SERVICES.find((s) => s.slug === "brand-representation")!;
  const { caseStudies, contacts } = useSiteContent();
  return (
    <ServicePage
      title="Brand Representation"
      hero={{ src: "/images/case-studies/percival-neal-street.jpg", alt: "Percival's store on Neal Street, Seven Dials" }}
      intro={service.intro}
      body={SERVICE_COPY.brandRepresentation.body}
      clientsBlurb="Four pillars, one approach: international labels making their UK debut, independents finding the right street, hospitality operators rolling out, and wellness brands building neighbourhoods."
      clients={
        // Harry's four pillars stay grouped (Woody, 2026-10-12).
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-12">
          {BRAND_REP_PILLARS.map((pillar) => (
            <div key={pillar.name}>
              <p className="label-caps border-b border-bgp-ink pb-2 mb-6">{pillar.name}</p>
              <div className="flex flex-wrap gap-4">
                {pillar.clients.map((c) => <ClientCircle key={c.name} client={c} />)}
              </div>
            </div>
          ))}
        </div>
      }
      services={BRAND_REP_SERVICES}
      caseStudies={caseStudies.filter((c) => c.service === "Brand Representation")}
      caseStudyLayout="stacked"
      contacts={contacts.brand_representation}
      contactsBlurb="Our brand representation team supports occupiers from first site to full network."
    />
  );
}
