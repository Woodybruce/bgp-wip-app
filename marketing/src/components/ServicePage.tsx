import type { ReactNode } from "react";
import { Link } from "wouter";
import KeyContacts from "./KeyContacts";
import ServiceList from "./ServiceList";
import Placeholder from "./Placeholder";
import { Band, Hero, SectionHead } from "./Wire";
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
  contacts: Person[];
  contactsBlurb?: string;
}

export default function ServicePage({ title, hero, intro, body, clients, clientsBlurb, services, quote, caseStudies, contacts, contactsBlurb }: ServicePageProps) {
  return (
    <div>
      {/* Wireframe slides 35, 38, 41: statement over the hero, left-aligned
          sections over rules, grey bands for contacts and the case study. */}
      <Hero src={hero.src} alt={hero.alt} label={title} statement={intro} />

      {body && body.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-12 md:py-14">
          <h1 className="sr-only">{title}</h1>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12">
            {body.map((p, i) => (
              <p key={p.slice(0, 24)} className={`text-base md:text-lg ${i === 0 ? "text-bgp-ink" : "text-bgp-ink/90"}`}>
                {p.includes(": ") ? <><strong className="text-bgp-ink">{p.split(": ")[0]}:</strong> {p.split(": ").slice(1).join(": ")}</> : p}
              </p>
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-4 pb-14">
        <SectionHead title="A snapshot of clients" sub={clientsBlurb} />
        {clients}
      </section>

      <ServiceList services={services} />

      {quote && (
        <section className="mx-auto max-w-6xl px-4 py-14">
          <div className="max-w-2xl border-l-2 border-bgp-wine pl-6">
            <p className="text-lg font-light text-bgp-ink/80">“{quote.quote}”</p>
            <p className="label-caps mt-4">{quote.name}</p>
            <p className="text-xs text-bgp-ink/50 uppercase">{quote.title}</p>
          </div>
        </section>
      )}

      {caseStudies.length > 0 && (
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
    </div>
  );
}
