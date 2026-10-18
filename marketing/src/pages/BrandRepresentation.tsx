import { Link } from "wouter";
import ClientRow from "../components/ClientRow";
import KeyContacts from "../components/KeyContacts";
import Placeholder from "../components/Placeholder";
import { BRAND_REP_CLIENTS, SERVICES } from "../lib/content";
import { useSiteContent } from "../lib/site-content";

export default function BrandRepresentation() {
  const service = SERVICES.find((item) => item.slug === "brand-representation")!;
  const { caseStudies, contacts, team } = useSiteContent();
  const studies = caseStudies.filter((study) => study.service === "Brand Representation").slice(0, 4);
  const people = [...contacts.brand_representation, ...team.filter((person) => person.team === "Tenant Rep" && !contacts.brand_representation.some((contact) => contact.name === person.name))].slice(0, 3);

  return (
    <div>
      <section className="site-container section-space">
        <h1 className="label-caps mb-7 text-bgp-wine">Brand Representation</h1>
        <p className="intro-copy max-w-[920px] text-bgp-ink">{service.intro}</p>
      </section>

      <section className="site-container pb-14 md:pb-20">
        <div className="client-snapshot mx-auto w-full max-w-[1100px] md:w-[84.2%]">
          <h2 className="mb-6 border-b border-bgp-ink pb-4 text-lg font-bold">A snapshot of clients</h2>
          <ClientRow clients={BRAND_REP_CLIENTS} initialCount={14} minimumSlots={14} />
        </div>
      </section>

      {studies.length > 0 && (
        <section className="site-container pb-12 md:pb-20">
          <h2 className="section-title mb-8 border-t border-bgp-ink pt-10">Case studies</h2>
          <div className="space-y-6">
            {studies.map((study, index) => {
              const excerpt = study.body.find((paragraph) => paragraph.trim() && paragraph.trim() !== study.blurb.trim() && !paragraph.startsWith("## "));
              return (
              <Link key={study.slug} href={`/case-studies/${study.slug}`} className="group block bg-bgp-mist p-5 md:p-8">
                <h3 className="label-caps mb-5">{study.title}</h3>
                <div className={`grid grid-cols-1 gap-7 md:gap-10 ${index % 2 ? "md:grid-cols-[2fr_3fr]" : "md:grid-cols-[3fr_2fr]"}`}>
                  <div className={`img-frame ${index % 2 ? "md:order-2" : ""}`}>
                    <Placeholder className="aspect-[4/3] w-full" src={study.image} alt={study.title} label="Photo to follow" />
                  </div>
                  <div className="flex flex-col items-start">
                    <p className={`body-copy ${study.draft ? "italic" : ""}`}>{study.blurb}</p>
                    {excerpt && <p className={`body-copy mt-5 ${study.draft ? "italic" : ""}`}>{excerpt}</p>}
                    <span className="explore-link mt-auto pt-8">Read more</span>
                  </div>
                </div>
              </Link>
              );
            })}
          </div>
        </section>
      )}

      <KeyContacts people={people} band={false} blurb="Our brand representation team supports occupiers from first site to full network. Talk to us about a first UK store, the next ten, or a portfolio review." />
    </div>
  );
}
