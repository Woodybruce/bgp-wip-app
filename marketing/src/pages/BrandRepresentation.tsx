import { Link } from "wouter";
import KeyContacts from "../components/KeyContacts";
import ClientRow from "../components/ClientRow";
import Placeholder from "../components/Placeholder";
import { BRAND_REP_CLIENTS, SERVICE_COPY, SERVICES } from "../lib/content";
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

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="display text-2xl md:text-3xl mb-8">A snapshot of clients</h2>
        <ClientRow clients={BRAND_REP_CLIENTS} />
      </section>

      <section className="mx-auto max-w-6xl px-4 py-6">
        <h2 className="display text-2xl md:text-3xl mb-8">Case studies</h2>
        <div className="card-strip sm:grid-cols-2">
          {BRAND_REP_CASE_STUDIES.map((cs) => (
            <Link key={cs.slug} href={`/case-studies/${cs.slug}`} className="group block">
              <div className="img-frame">
                <Placeholder className="aspect-[4/3] w-full" src={cs.image} alt={cs.title} />
              </div>
              <p className="label-caps mt-4 group-hover:text-bgp-burgundy transition-colors">{cs.title}</p>
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
