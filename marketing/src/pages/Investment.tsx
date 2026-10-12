import { Link } from "wouter";
import KeyContacts from "../components/KeyContacts";
import CaseStudyStrip from "../components/CaseStudyStrip";
import Placeholder from "../components/Placeholder";
import {
  CITY_COVERAGE,
  INVESTMENT_APPROACH,
  INVESTMENT_DEALS,
  INVESTMENT_TRACK_RECORD,
  ROYAL_EXCHANGE_FEATURE,
  SERVICE_COPY,
  SERVICES,
} from "../lib/content";
import { findCaseStudy, useSiteContent } from "../lib/site-content";

// Shaped on the February 2026 Royal Exchange pitch (Woody, 2026-10-12):
// approach, the flagship instruction with its journey and metrics, track
// record, City coverage. Deck-resolution photos stand in until the
// high-res set arrives.
export default function Investment() {
  const content = useSiteContent();
  const INVESTMENT_CONTACTS = content.contacts.investment;
  const service = SERVICES.find((s) => s.slug === "investment")!;
  const rex = ROYAL_EXCHANGE_FEATURE;
  const rexStudy = content.caseStudies.find((c) => c.slug === rex.caseStudySlug);
  return (
    <div>
      <section className="relative">
        <Placeholder className="h-72 md:h-96 w-full" src={service.image} alt="The Royal Exchange, City of London" />
        <div className="absolute inset-0 bg-gradient-to-t from-bgp-ink/70 via-bgp-ink/10 to-transparent" />
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto max-w-6xl px-4 pb-10 w-full">
            <p className="max-w-xl text-3xl md:text-4xl leading-snug font-display italic text-white" style={{ textShadow: "0 2px 16px rgba(0,0,0,0.45)" }}>{service.intro}</p>
          </div>
        </div>
      </section>

      {/* Approach */}
      <section className="mx-auto max-w-6xl px-4 pt-14 pb-6">
        <span className="section-label">Our approach</span>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
          <div className="space-y-4">
            {SERVICE_COPY.investment.body.map((p, i) => (
              <p key={p.slice(0, 24)} className={`text-base md:text-lg leading-relaxed ${i === 0 ? "font-semibold text-bgp-ink" : "text-bgp-ink/90"}`}>{p}</p>
            ))}
          </div>
          <div>
            <p className="label-caps mb-4">What makes BGP different</p>
            <ul className="space-y-3">
              {INVESTMENT_APPROACH.map((item) => (
                <li key={item} className="flex gap-3 text-base md:text-lg text-bgp-ink/90 leading-relaxed">
                  <span className="text-bgp-red font-display" aria-hidden>/</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Flagship instruction */}
      <section className="bg-bgp-mist">
        <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
          <span className="section-label">Flagship instruction</span>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
            <div className="img-frame">
              <Placeholder className="aspect-[4/3] w-full" src={rex.image} alt={rex.imageAlt} />
            </div>
            <div>
              <h2 className="display text-3xl md:text-4xl">{rex.title}</h2>
              <p className="label-caps text-bgp-ink/50 mt-1">For {rex.client}, 2022 to 2026</p>
              <p className="mt-5 text-base md:text-lg font-semibold text-bgp-ink leading-relaxed">{rex.intro}</p>
              <div className="mt-8 grid grid-cols-3 gap-4 border-t border-bgp-ink pt-6">
                {rex.kpis.map((k) => (
                  <div key={k.label}>
                    <p className="label-caps text-bgp-ink/50">{k.label}</p>
                    <p className="mt-1 text-sm text-bgp-ink/60 tabular">{k.before}</p>
                    <p className="display text-3xl md:text-4xl text-bgp-wine tabular">{k.after}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <ol className="mt-12 grid grid-cols-1 md:grid-cols-4 gap-6">
            {rex.journey.map((j, i) => (
              <li key={j.step} className="border-t border-bgp-wine/40 pt-4">
                <p className="label-caps text-bgp-red tabular">{String(i + 1).padStart(2, "0")} <span className="text-bgp-ink/50 ml-2">{j.year}</span></p>
                <p className="mt-2 text-base text-bgp-ink/90 leading-relaxed">{j.step}</p>
              </li>
            ))}
          </ol>
          {rexStudy && (
            <p className="mt-10">
              <Link href={`/case-studies/${rexStudy.slug}`} className="explore-link">Read the Royal Exchange story</Link>
            </p>
          )}
        </div>
      </section>

      {/* Track record */}
      <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-bgp-wine/25 pb-6 mb-10">
          <div>
            <span className="section-label">Track record</span>
            <h2 className="display text-3xl md:text-4xl">Acquisitions and disposals we have led</h2>
          </div>
          <p className="text-base text-bgp-ink/70 max-w-[28ch]">Contact the team for current opportunities and our full track record.</p>
        </div>
        <div className="card-strip sm:grid-cols-2 lg:grid-cols-4 sm:gap-x-6 sm:gap-y-12">
          {INVESTMENT_TRACK_RECORD.map((t) => (
            <div key={t.name}>
              {t.image && (
                <div className="img-frame"><Placeholder className="aspect-[4/3] w-full" src={t.image} alt={t.name} /></div>
              )}
              <div className={`${t.image ? "mt-3" : ""} border-t border-bgp-wine/30 pt-3`}>
                <p className="font-display text-lg leading-snug text-bgp-wine">{t.name}</p>
                <p className="mt-0.5 label-caps text-bgp-ink/45">{t.client}</p>
                <p className="mt-1.5 text-sm text-bgp-ink/80 leading-relaxed">{t.note}</p>
              </div>
            </div>
          ))}
        </div>

        <h3 className="display text-2xl md:text-3xl mt-16 mb-8">Recent transactions</h3>
        <div className="card-strip sm:grid-cols-2 lg:grid-cols-3 sm:gap-x-6 sm:gap-y-12">
          {INVESTMENT_DEALS.map((deal) => (
            <div key={deal.name} className="group">
              <div className="relative img-frame">
                <Placeholder className="aspect-[4/3] w-full" src={deal.image} alt={deal.name} />
                {deal.sold && (
                  <span className="absolute top-0 right-0 bg-bgp-wine text-bgp-cream label-caps px-3 py-1.5">Completed</span>
                )}
              </div>
              <div className="mt-3 border-t border-bgp-wine/30 pt-3">
                <p className="font-display text-lg leading-snug text-bgp-wine">{deal.name}</p>
                <p className="mt-0.5 label-caps text-bgp-ink/45">{deal.client}</p>
                <p className="mt-1.5 text-sm tabular">
                  {deal.price}
                  {deal.capRate ? ` / cap rate ${deal.capRate}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* City coverage */}
      <section className="mx-auto max-w-6xl px-4 pb-16">
        <span className="section-label">Unrivalled City retail expertise</span>
        <p className="max-w-2xl text-base md:text-lg text-bgp-ink/90 leading-relaxed">
          Investment advice backed by the team that leases and manages the City's best retail. We act, or have acted, at:
        </p>
        <ul className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
          {CITY_COVERAGE.map((name) => (
            <li key={name} className="label-caps text-bgp-wine border-b border-bgp-wine/40 pb-1">{name}</li>
          ))}
        </ul>
      </section>

      <KeyContacts people={INVESTMENT_CONTACTS} />
      <CaseStudyStrip caseStudy={findCaseStudy(content, "19-golden-square")} />
    </div>
  );
}
