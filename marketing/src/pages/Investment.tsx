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
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto max-w-6xl px-4 pb-10 w-full">
            <p className="max-w-md text-xl md:text-2xl leading-snug bg-bgp-cream/90 p-4 -ml-4 font-display text-bgp-wine">{service.intro}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h1 className="text-lg font-semibold">Snapshot of recent transactions</h1>
        <p className="mt-1 text-xs text-bgp-ink/50">
          Please contact us for current opportunities and full track record
        </p>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
          {INVESTMENT_DEALS.map((deal) => (
            <div key={deal.name} className={deal.wide ? "sm:col-span-2" : ""}>
              <div className="relative">
                <Placeholder className="aspect-[4/3] w-full" src={deal.image} alt={deal.name} />
                {deal.sold && (
                  <span className="absolute top-0 right-0 bg-bgp-stone text-bgp-ink label-caps px-3 py-1.5">
                    Completed
                  </span>
                )}
              </div>
              <p className="label-caps mt-3">{deal.name}</p>
              <p className="text-xs text-bgp-ink/50 uppercase">{deal.client}</p>
              <p className="mt-1 text-sm tabular">
                {deal.price}
                {deal.capRate ? ` / cap rate ${deal.capRate}` : ""}
              </p>
            </div>
          ))}
        </div>
      </section>

      <KeyContacts people={INVESTMENT_CONTACTS} />
      <CaseStudyStrip caseStudy={CASE_STUDIES[1]} />
    </div>
  );
}
