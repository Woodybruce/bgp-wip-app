import { Link } from "wouter";
import { ClientCircle } from "../components/ClientRow";
import ContactCard from "../components/ContactCard";
import Placeholder from "../components/Placeholder";
import { BRAND_REP_CLIENTS, SERVICE_COPY, SERVICES } from "../lib/content";
import { useSiteContent } from "../lib/site-content";

// Built to wireframe slide 35 exactly (Woody, 2026-10-16): no hero photo,
// the intro as large light text at the top, a flat two-row grid of client
// circles under a small ruled heading, three stacked case-study blocks
// alternating grey and white, then key contacts on white. Nothing else.
export default function BrandRepresentation() {
  const service = SERVICES.find((s) => s.slug === "brand-representation")!;
  const { caseStudies, contacts, team } = useSiteContent();
  const studies = caseStudies.filter((c) => c.service === "Brand Representation").slice(0, 4);
  // Slide 35 shows three contacts: the two directors from the feed, then the
  // next person on the Brand Representation team.
  const people = [...contacts.brand_representation, ...team.filter((p) => p.team === "Tenant Rep" && !contacts.brand_representation.some((c) => c.name === p.name))].slice(0, 3);
  const clients = BRAND_REP_CLIENTS.slice(0, 14);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 md:pt-14">
      <h1 className="sr-only">Brand Representation</h1>

      {/* Overview / intro */}
      <p className="max-w-2xl font-light text-2xl md:text-[2rem] leading-[1.2] text-bgp-ink">
        {service.intro} {SERVICE_COPY.brandRepresentation.body[0]}
      </p>

      {/* A snapshot of clients */}
      <section className="mt-10">
        <h2 className="text-sm font-bold text-bgp-ink border-b border-bgp-ink pb-2 mb-5">A snapshot of clients</h2>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-4 md:gap-6">
          {clients.map((c) => (
            <ClientCircle key={c.name} client={c} />
          ))}
        </div>
      </section>

      {/* Case studies */}
      <section className="mt-12 border-t border-bgp-ink pt-6">
        <h2 className="text-sm font-bold text-bgp-ink mb-4">Case studies</h2>
        <div className="grid grid-cols-1 gap-4">
          {studies.map((cs, i) => (
            <Link
              key={cs.slug}
              href={`/case-studies/${cs.slug}`}
              className={`group block p-5 md:p-6 ${i % 2 ? "" : "bg-bgp-mist"}`}
            >
              <p className="text-xs font-bold uppercase text-bgp-ink mb-3">{cs.title}</p>
              <div className={`grid grid-cols-1 md:grid-cols-[1.2fr_1fr] gap-6 md:gap-8 ${i % 2 ? "md:[direction:rtl]" : ""}`}>
                <div className="img-frame [direction:ltr]">
                  <Placeholder className="aspect-[4/3] w-full" src={cs.image} alt={cs.title} label="Photo to follow" />
                </div>
                <div className="[direction:ltr] flex flex-col">
                  <p className="text-sm text-bgp-ink/85 max-w-xs">{cs.blurb}</p>
                  <p className="mt-auto pt-6 text-[11px] font-bold text-bgp-ink self-end">Read more</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Key contacts */}
      <section className="mt-12 mb-16 grid grid-cols-1 md:grid-cols-[1fr_1.4fr] gap-8 md:gap-12 items-start">
        <div>
          <h2 className="text-sm font-bold text-bgp-ink">Key contacts</h2>
          <p className="mt-3 text-sm text-bgp-ink/85 max-w-[30ch]">
            Our brand representation team supports occupiers from first site to full network.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {people.map((p) => (
            <ContactCard key={p.name} person={p} compact />
          ))}
        </div>
      </section>
    </div>
  );
}
