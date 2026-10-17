import type { ReactNode } from "react";
import { Link } from "wouter";
import KeyContacts from "./KeyContacts";
import ServiceList from "./ServiceList";
import Placeholder from "./Placeholder";
import { Hero, QuoteBlock, SectionHead } from "./Wire";
void SectionHead;
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
  hero?: { src: string; alt: string; position?: string }; // slide 35 (Brand Representation) has no photo: the statement sits on white
  intro: string;
  body?: string[];
  clients: ReactNode;
  clientsBlurb?: string;
  services: Array<{ name: string; detail: string }>;
  servicesVariant?: "panel" | "list"; // slide 41 (Consultancy) draws a static list box
  quote?: { quote: string; name: string; title: string };
  caseStudies: Array<{ slug: string; title: string; blurb: string; image?: string; draft?: boolean; body?: string[] }>;
  caseStudyLayout?: "stacked" | "band"; // slide 35 stacks them; slides 38 and 41 end with one band
  contacts: Person[];
  contactsBlurb?: string;
}

export default function ServicePage({ title, hero, intro, body, clients, clientsBlurb, services, servicesVariant = "panel", quote, caseStudies, caseStudyLayout = "band", contacts, contactsBlurb }: ServicePageProps) {
  const content = useSiteContent();
  return (
    <div>
      {/* Wireframe slides 35, 38, 41: statement over the hero, left-aligned
          sections over rules, grey bands for contacts and the case study. */}
      {hero ? (
        <Hero src={hero.src} alt={hero.alt} label={title} statement={intro} />
      ) : (
        <section className="mx-auto max-w-[1360px] px-4 pt-12 md:pt-16">
          <p className="label-caps text-bgp-ink/50 mb-3">{title}</p>
          <p className="max-w-4xl font-light text-2xl md:text-4xl leading-[1.15] text-bgp-wine">{intro}</p>
        </section>
      )}

      <h1 className="sr-only">{title}</h1>
      <section className="mx-auto max-w-[1360px] px-4 pt-12 md:pt-14 pb-10">
        <h2 className="text-[1.65rem] font-bold text-bgp-ink border-b-[3px] border-bgp-ink pb-3 mb-8 md:ml-[3%] md:mr-[7%] md:pl-[4%]">A snapshot of clients</h2>
        {clientsBlurb && <p className="text-sm text-bgp-ink/70 mb-4">{clientsBlurb}</p>}
        {clients}
      </section>

      <ServiceList services={services} body={body} variant={servicesVariant} heading={servicesVariant === "list" ? "Additional services" : "What we offer"} />

      {quote && <QuoteBlock quote={quote} />}

      {caseStudies.length > 0 && caseStudyLayout === "stacked" && (
        <section className="mx-auto max-w-[1360px] px-4 py-7">
          <SectionHead title="Case studies" />
          {/* Wireframe slide 35: stacked blocks, text beside image, alternating sides */}
          <div className="grid grid-cols-1 gap-4">
            {caseStudies.map((cs, i) => (
              <Link key={cs.slug} href={`/case-studies/${cs.slug}`} className={`group grid grid-cols-1 md:grid-cols-[1fr_1.4fr] gap-6 md:gap-10 p-5 md:p-7 ${i % 2 ? "" : "bg-bgp-mist md:[direction:rtl]"}`}>
                <div className="[direction:ltr]">
                  <p className={`label-caps text-bgp-wine ${cs.draft ? "italic" : ""}`}>{cs.title}</p>
                  <div className={`mt-3 space-y-3 text-base text-bgp-ink ${cs.draft ? "italic" : ""}`}>
                    {[cs.blurb, ...(cs.body || [])].map((para, k) => <p key={k}>{para}</p>)}
                  </div>
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
