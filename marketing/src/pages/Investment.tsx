import KeyContacts from "../components/KeyContacts";
import CaseStudyStrip from "../components/CaseStudyStrip";
import Placeholder from "../components/Placeholder";
import { INVESTMENT_DEALS, SERVICE_COPY, SERVICES } from "../lib/content";
import { findCaseStudy, useSiteContent } from "../lib/site-content";

// Same page shape as before; the copy, the transactions and the photos come
// from the February 2026 Royal Exchange pitch (Woody, 2026-10-12).
export default function Investment() {
  const content = useSiteContent();
  const INVESTMENT_CONTACTS = content.contacts.investment;
  const service = SERVICES.find((s) => s.slug === "investment")!;
  return (
    <div>
      <section className="relative min-h-[18rem] md:min-h-[24rem] flex items-end">
        <Placeholder className="absolute inset-0 h-full w-full" src={service.image} alt="The Royal Exchange, City of London" />
        <div className="absolute inset-0 bg-gradient-to-t from-bgp-ink/85 via-bgp-ink/45 to-bgp-ink/15 md:from-bgp-ink/70 md:via-bgp-ink/10 md:to-transparent" />
        <div className="relative w-full">
          <div className="mx-auto max-w-6xl px-4 pt-28 pb-8 md:pb-10 w-full">
            <p className="max-w-xl text-2xl md:text-3xl font-light leading-[1.2] text-white" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7), 0 2px 18px rgba(0,0,0,0.55)" }}>{service.intro}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-14">
        <span className="section-label">Our approach</span>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4 max-w-5xl">
          {SERVICE_COPY.investment.body.map((p, i) => (
            <p key={p.slice(0, 24)} className={`text-base md:text-lg ${i === 0 ? "font-semibold text-bgp-ink" : "text-bgp-ink/90"}`}>{p}</p>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-bgp-wine/25 pb-6 mb-10">
          <div>
            <span className="section-label">Track record</span>
            <h1 className="display text-3xl md:text-4xl">A snapshot of recent transactions</h1>
          </div>
          <p className="text-base text-bgp-ink/70 max-w-[28ch]">
            Contact the team for current opportunities and our full track record.
          </p>
        </div>

        <div className="card-strip sm:grid-cols-2 lg:grid-cols-4 sm:gap-x-6 sm:gap-y-12">
          {INVESTMENT_DEALS.map((deal) => (
            <div key={deal.name} className="group">
              <div className="relative img-frame">
                <Placeholder className="aspect-[4/3] w-full" src={deal.image} alt={deal.name} label="Photo to follow" />
                <span className={`absolute top-0 right-0 label-caps px-3 py-1.5 ${deal.status === "Under offer" ? "bg-bgp-nectar text-bgp-wine" : "bg-bgp-wine text-bgp-cream"}`}>
                  {deal.status}
                </span>
              </div>
              <div className="mt-3 border-t border-bgp-wine/30 pt-3">
                <p className="font-normal text-lg text-bgp-wine">{deal.name}</p>
                {deal.address && deal.address !== deal.name && <p className="mt-0.5 text-sm text-bgp-ink/60">{deal.address}</p>}
                <p className="mt-0.5 label-caps text-bgp-ink/45">{deal.client}</p>
                <p className="mt-1.5 text-sm text-bgp-ink/80 tabular">
                  {deal.type === "Transaction" ? "" : deal.type}
                  {deal.type !== "Transaction" && deal.price ? " · " : ""}
                  {deal.price}
                  {deal.capRate ? ` / cap rate ${deal.capRate}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <CaseStudyStrip caseStudy={findCaseStudy(content, "the-royal-exchange")} />
      <KeyContacts people={INVESTMENT_CONTACTS} />
    </div>
  );
}
