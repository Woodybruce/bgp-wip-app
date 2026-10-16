import type { ReactNode } from "react";
import { Link } from "wouter";
import KeyContacts from "./KeyContacts";
import ServiceList from "./ServiceList";
import Placeholder from "./Placeholder";
import { Hero, SectionHead } from "./Wire";
import CaseStudyStrip from "./CaseStudyStrip";
import { findCaseStudy, useSiteContent } from "../lib/site-content";
import type { Person } from "../lib/content";

// One layout for the single-page services (Brand Representation, Lease
// Advisory, Consultancy), so they read as one site (Charlotte / Woody,
// 2026-10-12): hero with the team's line, body copy, a snapshot of
// clients, "What we offer", an optional client quote, case studies, key
// contacts. Leasing and Investment keep their own pages (sub-pages and
// the deals board).
export interface ServicePageProps {
  title: string;
  hero: { src: string; alt: string; position?: string };
  intro: string;
  body?: string[];
  clients: ReactNode;
  clientsBlurb?: string;
  services: Array<{ name: string; detail: string }>;
  quote?: { quote: string; name: string; title: string };
  caseStudies: Array<{ slug: string; title: string; blurb: string; image?: string }>;
  caseStudyLayout?: "stacked" | "band"; // slide 35 stacks them; slides 38 and 41 end with one band
  contacts: Person[];
  contactsBlurb?: string;
}

export default function ServicePage({ title, hero, intro, body, clients, clientsBlurb, services, quote, caseStudies, caseStudyLayout = "band", contacts, contactsBlurb }: ServicePageProps) {
  const content = useSiteContent();
  return (
    <div>
      {/* Wireframe slides 35, 38, 41: statement over the hero, left-aligned
          sections over rules, grey bands for contacts and the case study. */}
      <Hero src={hero.src} alt={hero.alt} label={title} statement={intro} />

      <h1 className="sr-only">{title}</h1>
      <section className="mx-auto max-w-6xl px-4 pt-12 md:pt-14 pb-10">
        <SectionHead title="A snapshot of clients" sub={clientsBlurb} />
        {clients}
      </section>

      <ServiceList services={services} body={body} />

      {quote && (
        <section className="mx-auto max-w-6xl px-4 py-14">
          <div className="max-w-2xl border-l-2 border-bgp-wine pl-6">
            <p className="text-lg font-light text-bgp-ink/80">“{quote.quote}”</p>
            <p className="label-caps mt-4">{quote.name}</p>
            <p className="text-xs text-bgp-ink/50 uppercase">{quote.title}</p>
          </div>
        </section>
      )}

      {caseStudies.length > 0 && caseStudyLayout === "stacked" && (
        <section className="mx-auto max-w-6xl px-4 py-10">
          <SectionHead title="Case studies" />
          {/* Wireframe slide 35: stacked blocks, text beside image, alternating sides */}
          <div className="grid grid-cols-1 gap-4">
            {caseStudies.map((cs, i) => (
              <Link key={cs.slug} href={`/case-studies/${cs.slug}`} className={`group grid grid-cols-1 md:grid-cols-[1fr_1.4fr] gap-6 md:gap-10 p-5 md:p-7 ${i % 2 ? "bg-bgp-mist md:[direction:rtl]" : "border border-bgp-line"}`}>
                <div className="[direction:ltr]">
                  <p className="label-caps text-bgp-wine">{cs.title}</p>
                  <p className="mt-3 text-base text-bgp-ink/90 max-w-md">{cs.blurb}</p>
                  <p className="mt-4"><span className="explore-link">Read more</span></p>
                </div>
                <div className="img-frame [direction:ltr]">
                  <Placeholder className="aspect-[16/10] w-full" src={cs.image} alt={cs.title} label="Photo to follow" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <KeyContacts people={contacts} blurb={contactsBlurb} />
      {caseStudies.length > 0 && caseStudyLayout === "band" && (
        <CaseStudyStrip caseStudies={caseStudies.map((c) => findCaseStudy(content, c.slug)).filter(Boolean) as any} />
      )}
    </div>
  );
}
