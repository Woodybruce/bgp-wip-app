import type { ReactNode } from "react";
import { Link } from "wouter";
import KeyContacts from "./KeyContacts";
import ServiceList from "./ServiceList";
import Placeholder from "./Placeholder";
import type { Person } from "../lib/content";

// One layout for the single-page services (Brand Representation, Lease
// Advisory, Consultancy), so they read as one site (Charlotte / Woody,
// 2026-10-12): hero with the team's line, body copy, a snapshot of
// clients, "What we offer", an optional client quote, case studies, key
// contacts. Leasing and Investment keep their own pages (sub-pages and
// the deals board).
export interface ServicePageProps {
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

export default function ServicePage({ hero, intro, body, clients, clientsBlurb, services, quote, caseStudies, contacts, contactsBlurb }: ServicePageProps) {
  const cols = caseStudies.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : caseStudies.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <div>
      <section className="relative">
        <Placeholder className="h-72 md:h-96 w-full" src={hero.src} alt={hero.alt} />
        <div className="absolute inset-0 bg-gradient-to-t from-bgp-ink/70 via-bgp-ink/10 to-transparent" />
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto max-w-6xl px-4 pb-10 w-full">
            <p className="max-w-xl text-3xl md:text-4xl leading-snug font-display italic text-white" style={{ textShadow: "0 2px 16px rgba(0,0,0,0.45)" }}>{intro}</p>
          </div>
        </div>
      </section>

      {body && body.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pt-14">
          <div className="max-w-3xl space-y-4">
            {body.map((p, i) => (
              <p key={p.slice(0, 24)} className={`text-base md:text-lg leading-relaxed ${i === 0 ? "font-semibold text-bgp-ink" : "text-bgp-ink/90"}`}>
                {p.includes(": ") ? <><strong className="text-bgp-ink">{p.split(": ")[0]}:</strong> {p.split(": ").slice(1).join(": ")}</> : p}
              </p>
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="display text-2xl md:text-3xl mb-3">A snapshot of clients</h2>
        {clientsBlurb && <p className="max-w-2xl text-base md:text-lg text-bgp-ink/90 leading-relaxed mb-10">{clientsBlurb}</p>}
        {!clientsBlurb && <div className="mb-5" />}
        {clients}
      </section>

      <ServiceList services={services} />

      {quote && (
        <section className="mx-auto max-w-6xl px-4 py-14">
          <div className="max-w-2xl border-l-2 border-bgp-red pl-6">
            <p className="text-lg italic leading-relaxed text-bgp-ink/80">"{quote.quote}"</p>
            <p className="label-caps mt-4">{quote.name}</p>
            <p className="text-xs text-bgp-ink/50 uppercase">{quote.title}</p>
          </div>
        </section>
      )}

      {caseStudies.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-10">
          <span className="section-label">Case studies</span>
          <div className={`card-strip ${cols} mt-6`}>
            {caseStudies.map((cs) => (
              <Link key={cs.slug} href={`/case-studies/${cs.slug}`} className="group block">
                <div className="img-frame">
                  <Placeholder className="aspect-[4/3] w-full" src={cs.image} alt={cs.title} label="Photo to follow" />
                </div>
                <p className="label-caps mt-4 group-hover:text-bgp-burgundy transition-colors">{cs.title}</p>
                <p className="mt-2 text-base md:text-lg text-bgp-ink/90 leading-relaxed">{cs.blurb}</p>
                <p className="mt-3"><span className="explore-link">Read more</span></p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <KeyContacts people={contacts} blurb={contactsBlurb} />
    </div>
  );
}
