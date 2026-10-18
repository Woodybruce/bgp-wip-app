import type { ReactNode } from "react";
import { Link } from "wouter";
import KeyContacts from "./KeyContacts";
import ServiceList from "./ServiceList";
import Placeholder from "./Placeholder";
import { Hero, QuoteBlock } from "./Wire";
import CaseStudyStrip from "./CaseStudyStrip";
import type { CaseStudy, Person } from "../lib/content";

export interface ServicePageProps {
  title: string;
  hero?: { src: string; alt: string; position?: string };
  intro: string;
  body?: string[];
  clients: ReactNode;
  clientsBlurb?: string;
  services: Array<{ name: string; detail: string }>;
  servicesVariant?: "panel" | "list";
  quote?: { quote: string; name: string; title: string };
  caseStudies: CaseStudy[];
  caseStudyLayout?: "stacked" | "band";
  contacts: Person[];
  contactsBlurb?: string;
}

export default function ServicePage({ title, hero, intro, body, clients, clientsBlurb, services, servicesVariant = "panel", quote, caseStudies, caseStudyLayout = "band", contacts, contactsBlurb }: ServicePageProps) {
  return (
    <div className="service-page">
      {hero ? (
        <Hero src={hero.src} alt={hero.alt} label={title} statement={intro} big />
      ) : (
        <section className="site-container section-space">
          <p className="label-caps mb-5">{title}</p>
          <p className="service-page__intro intro-copy max-w-4xl">{intro}</p>
        </section>
      )}
      <h1 className="sr-only">{title}</h1>

      <section className="site-container section-space">
        <div className="client-snapshot mx-auto w-full max-w-[1100px] md:w-[84.2%]">
          <h2 className="service-page__client-heading mb-6 border-b border-bgp-ink pb-4 font-bold">A snapshot of clients</h2>
          {clientsBlurb && <p className="service-page__client-copy body-copy mb-6">{clientsBlurb}</p>}
          {clients}
        </div>
      </section>

      <ServiceList services={services} body={body} variant={servicesVariant} heading={servicesVariant === "list" ? "Additional services" : "What we offer"} />
      {quote && <QuoteBlock quote={quote} />}

      {caseStudies.length > 0 && caseStudyLayout === "stacked" && (
        <section className="service-case-cards site-container section-space">
          <h2 className="section-title mb-8 border-t border-bgp-ink pt-8">Case studies</h2>
          <div className="space-y-6">
            {caseStudies.map((study, index) => (
              <Link key={study.slug} href={`/case-studies/${study.slug}`} className="group block bg-bgp-mist p-5 md:p-8">
                <h3 className="label-caps mb-5">{study.title}</h3>
                <div className={`grid gap-7 md:gap-10 ${index % 2 ? "md:grid-cols-[2fr_3fr]" : "md:grid-cols-[3fr_2fr]"}`}>
                  <Placeholder className={`aspect-[4/3] w-full ${index % 2 ? "md:order-2" : ""}`} src={study.image} alt={study.title} label="Photo to follow" />
                  <div className="flex flex-col items-start">
                    <p className={`body-copy ${study.draft ? "italic" : ""}`}>{study.blurb}</p>
                    <span className="explore-link mt-auto pt-8">Read more</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <KeyContacts people={contacts} blurb={contactsBlurb} />
      {caseStudyLayout === "band" && <CaseStudyStrip caseStudies={caseStudies} />}
    </div>
  );
}
