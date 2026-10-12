import { Link } from "wouter";
import KeyContacts from "../components/KeyContacts";
import { ClientCircle } from "../components/ClientRow";
import Placeholder from "../components/Placeholder";
import { BRAND_REP_PILLARS, BRAND_REP_SERVICES, SERVICE_COPY, SERVICES } from "../lib/content";
import ServiceList from "../components/ServiceList";
import { useSiteContent } from "../lib/site-content";

export default function BrandRepresentation() {
  const service = SERVICES.find((s) => s.slug === "brand-representation")!;
  const { caseStudies, contacts } = useSiteContent();
  const BRAND_REP_CASE_STUDIES = caseStudies.filter((c) => c.service === "Brand Representation");
  const BRAND_REP_CONTACTS = contacts.brand_representation;
  return (
    <div>
      <section className="mx-auto max-w-6xl px-4 pt-14">
        <p className="max-w-xl text-3xl md:text-4xl leading-snug">{service.intro}</p>
        <div className="mt-6 max-w-2xl space-y-3">
          {SERVICE_COPY.brandRepresentation.body.map((p, i) => (
            <p key={p.slice(0, 24)} className={`text-base md:text-lg leading-relaxed ${i === 0 ? "font-semibold text-bgp-ink" : "text-bgp-ink/90"}`}>
              {p.includes(": ") ? <><strong className="text-bgp-ink">{p.split(": ")[0]}:</strong> {p.split(": ").slice(1).join(": ")}</> : p}
            </p>
          ))}
        </div>
      </section>

      <div className="mt-8" />
      <ServiceList services={BRAND_REP_SERVICES} />

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="display text-2xl md:text-3xl mb-3">A snapshot of clients</h2>
        <p className="max-w-2xl text-base md:text-lg text-bgp-ink/90 leading-relaxed mb-10">
          Four pillars, one approach: international labels making their UK debut, independents finding the right street, hospitality operators rolling out, and wellness brands building neighbourhoods.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-12">
          {BRAND_REP_PILLARS.map((pillar) => (
            <div key={pillar.name}>
              <p className="label-caps border-b border-bgp-ink pb-2 mb-6">{pillar.name}</p>
              <div className="grid grid-cols-4 gap-4">
                {pillar.clients.map((c) => <ClientCircle key={c.name} client={c} />)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-6">
        <h2 className="display text-2xl md:text-3xl mb-8">Case studies</h2>
        <div className="card-strip sm:grid-cols-2">
          {BRAND_REP_CASE_STUDIES.map((cs) => (
            <Link key={cs.slug} href={`/case-studies/${cs.slug}`} className="group block">
              {cs.image && (
                <div className="img-frame">
                  <Placeholder className="aspect-[4/3] w-full" src={cs.image} alt={cs.title} />
                </div>
              )}
              <p className={`label-caps group-hover:text-bgp-burgundy transition-colors ${cs.image ? "mt-4" : "border-t border-bgp-wine/30 pt-4"}`}>{cs.title}</p>
              <p className="mt-2 text-base md:text-lg text-bgp-ink/90 leading-relaxed">{cs.blurb}</p>
              <p className="mt-3"><span className="explore-link">Read more</span></p>
            </Link>
          ))}
        </div>
      </section>

      <KeyContacts
        people={BRAND_REP_CONTACTS}
        blurb="Our brand representation team supports occupiers from first site to full network."
      />
    </div>
  );
}
