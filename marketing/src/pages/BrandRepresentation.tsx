import { Link } from "wouter";
import ClientRow from "../components/ClientRow";
import ContactCard from "../components/ContactCard";
import Placeholder from "../components/Placeholder";
import { BRAND_REP_CLIENTS, SERVICES } from "../lib/content";
import { useSiteContent } from "../lib/site-content";

// Built to wireframe slide 35 exactly (Woody, 2026-10-16): no hero photo,
// the intro as large light text at the top, a flat two-row grid of client
// circles under a small ruled heading, three stacked case-study blocks
// alternating grey and white, then key contacts on white. Nothing else.
export default function BrandRepresentation() {
  const service = SERVICES.find((s) => s.slug === "brand-representation")!;
  const { caseStudies, contacts, team } = useSiteContent();
  const studies = caseStudies.filter((c) => c.service === "Brand Representation").slice(0, 3);
  // Slide 35 shows three contacts: the two directors from the feed, then the
  // next person on the Brand Representation team.
  const people = [...contacts.brand_representation, ...team.filter((p) => p.team === "Tenant Rep" && !contacts.brand_representation.some((c) => c.name === p.name))].slice(0, 3);
  const clients = BRAND_REP_CLIENTS.slice(0, 14);

  return (
    <div className="mx-auto max-w-[1360px] px-4 pt-10 md:pt-14">
      <h1 className="sr-only">Brand Representation</h1>

      {/* Overview / intro */}
      <p className="max-w-[66%] font-normal text-2xl md:text-4xl leading-[1.1] text-bgp-ink">
        {service.intro}
      </p>

      {/* A snapshot of clients */}
      <section className="mt-10">
        <h2 className="text-2xl font-bold text-bgp-ink border-b-[3px] border-bgp-ink pb-3 mb-8 md:ml-[3%] md:mr-[7%] md:pl-[4%]">A snapshot of clients</h2>
        <ClientRow clients={clients} />
      </section>

      {/* Case studies */}
      <section className="mt-10 border-t-[3px] border-bgp-ink pt-6">
        <h2 className="text-2xl font-bold text-bgp-ink mb-4">Case studies</h2>
        <div className="grid grid-cols-1 gap-1">
          {studies.map((cs, i) => (
            <Link
              key={cs.slug}
              href={`/case-studies/${cs.slug}`}
              className={`group block p-5 md:p-6 ${i % 2 ? "" : "bg-bgp-mist"}`}
            >
              <p className="text-xs font-bold uppercase text-bgp-ink mb-3">{cs.title}</p>
              <div className={`grid grid-cols-1 md:grid-cols-[53fr_4fr_37fr] gap-6 md:gap-0 md:pl-[3%] ${i % 2 ? "md:[direction:rtl]" : ""}`}>
                <div className="img-frame [direction:ltr]">
                  <Placeholder className="aspect-[4/3] w-full" src={cs.image} alt={cs.title} label="Photo to follow" />
                </div>
                <div className="hidden md:block" />
                <div className="[direction:ltr] flex flex-col">
                  {/* Slide 35 gives each case study a full paragraph, so the blurb and body run together. */}
                  <div className={`space-y-3 text-lg md:text-xl leading-snug text-bgp-ink ${cs.draft ? "italic" : ""}`}>
                    {[cs.blurb, ...(cs.body || [])].map((para, k) => <p key={k}>{para}</p>)}
                  </div>
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
          <h2 className="text-2xl font-bold text-bgp-ink">Key contacts</h2>
          <p className="mt-3 text-lg md:text-xl leading-snug text-bgp-ink">
            Our brand representation team supports occupiers from first site to full network. Talk to us about a first UK store, the next ten, or a portfolio review.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {people.map((p) => (
            <ContactCard key={p.name} person={p} compact />
          ))}
          {Array.from({ length: Math.max(0, 3 - people.length) }, (_, i) => (
            <div key={i} className="w-full max-w-[9.5rem] italic text-bgp-stone">
              <div className="aspect-[3/4] w-full bg-bgp-stone/30" />
              <p className="mt-3 label-caps text-bgp-stone">Name {people.length + i + 1}</p>
              <div className="mt-1 text-sm space-y-0.5"><p>Job title</p><p>+44 (0)20 0000 0000</p><p>name@bgp.uk.com</p></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
