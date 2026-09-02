import KeyContacts from "../components/KeyContacts";
import CaseStudyStrip from "../components/CaseStudyStrip";
import Placeholder from "../components/Placeholder";
import { CASE_STUDIES, INVESTMENT_CONTACTS, INVESTMENT_DEALS, SERVICES } from "../lib/content";

export default function Investment() {
  const service = SERVICES.find((s) => s.slug === "investment")!;
  return (
    <div>
      <section className="relative">
        <Placeholder className="h-72 md:h-96 w-full" src="/images/skyline-night.jpg" alt="London skyline at night" />
        <div className="absolute inset-0 bg-gradient-to-t from-bgp-ink/70 via-bgp-ink/10 to-transparent" />
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto max-w-6xl px-4 pb-10 w-full">
            <p className="max-w-xl text-2xl md:text-3xl leading-snug font-display italic text-white" style={{ textShadow: "0 2px 16px rgba(0,0,0,0.45)" }}>{service.intro}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-bgp-wine/25 pb-6 mb-10">
          <div>
            <span className="section-label">Track record</span>
            <h1 className="display text-3xl md:text-4xl">A snapshot of recent transactions</h1>
          </div>
          <p className="text-sm font-light text-bgp-ink/60 max-w-[28ch]">
            Contact the team for current opportunities and our full track record.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-12">
          {INVESTMENT_DEALS.map((deal) => (
            <div key={deal.name} className="group">
              <div className="relative img-frame">
                <Placeholder className="aspect-[4/3] w-full" src={deal.image} alt={deal.name} />
                {deal.sold && (
                  <span className="absolute top-0 right-0 bg-bgp-wine text-bgp-cream label-caps px-3 py-1.5">
                    Completed
                  </span>
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

      <KeyContacts people={INVESTMENT_CONTACTS} />
      <CaseStudyStrip caseStudy={CASE_STUDIES[1]} />
    </div>
  );
}
