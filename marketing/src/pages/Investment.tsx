import { useMemo, useState } from "react";
import KeyContacts from "../components/KeyContacts";
import CaseStudyStrip from "../components/CaseStudyStrip";
import Placeholder from "../components/Placeholder";
import { Hero, SectionHead } from "../components/Wire";
import { INVESTMENT_DEALS, SERVICES } from "../lib/content";
import { findCaseStudy, useSiteContent } from "../lib/site-content";

// Same page shape as before; the copy, the transactions and the photos come
// from the February 2026 Royal Exchange pitch (Woody, 2026-10-12).
const INITIAL_VISIBLE = 7;

function Filter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="label-caps flex min-w-0 items-center justify-between gap-3 text-bgp-wine w-full sm:w-auto py-2 border-b border-bgp-wine/15 sm:border-0">
      <span className="whitespace-nowrap">{label} <span aria-hidden>{"↘︎"}</span></span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 max-w-[65%] cursor-pointer bg-transparent py-2 pr-1 label-caps text-bgp-ink hover:text-bgp-wine sm:max-w-[210px]">
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

export default function Investment() {
  const content = useSiteContent();
  // Wireframe: filter row, a short mixed-size grid, expand for the rest
  // (Woody, 2026-10-16).
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [expanded, setExpanded] = useState(false);
  const types = useMemo(() => Array.from(new Set(INVESTMENT_DEALS.map((d) => d.type).filter((t) => t !== "Transaction"))), []);
  const deals = useMemo(() => INVESTMENT_DEALS
    .filter((d) => (!status || d.status === status) && (!type || d.type === type))
    .sort((a, b) => Number(a.status === "Completed") - Number(b.status === "Completed")), [status, type]);
  const shown = expanded || status || type ? deals : deals.slice(0, INITIAL_VISIBLE);
  const INVESTMENT_CONTACTS = content.contacts.investment;
  const service = SERVICES.find((s) => s.slug === "investment")!;
  return (
    <div>
      <h1 className="sr-only">Investment</h1>
      <Hero src="/images/investment/royal-exchange-interior.jpg" alt="The Royal Exchange, City of London" label="Investment" statement={service.intro} />

      <section className="site-container section-space">
        <SectionHead rule={false} title="Snapshot of properties" sub="Please contact us for full availability" />
        <div className="mb-8 flex flex-col items-stretch gap-x-8 border-b border-bgp-wine pb-2 sm:flex-row sm:flex-wrap sm:items-center md:mb-10">
          <span className="label-caps font-bold text-bgp-wine py-2">Filter by</span>
          <Filter label="Status" value={status} options={["Completed", "Under offer"]} onChange={setStatus} />
          <Filter label="Type" value={type} options={types} onChange={setType} />
        </div>

        {/* Slide 31: a wide tile and a small one, then a small and a wide, then three across. */}
        {(() => {
          const Tile = ({ deal, aspect }: { deal: (typeof shown)[number]; aspect: string }) => (
            <article className="group min-w-0">
              <div className="relative img-frame">
                <Placeholder className={`${aspect} w-full`} src={deal.image} alt={deal.name} label="Photo to follow" />
                <span className={`absolute inset-x-0 top-0 label-caps px-3 py-2 text-right ${deal.status === "Under offer" ? "bg-bgp-nectar text-bgp-wine" : "bg-bgp-wine text-bgp-cream"}`}>
                  {deal.status}
                </span>
              </div>
              <div className="mt-3">
                <h3 className="label-caps font-bold text-bgp-wine">{deal.name}</h3>
                {deal.address && deal.address !== deal.name && <p className="mt-0.5 label-caps text-bgp-ink">{deal.address}</p>}
                <p className="mt-0.5 label-caps text-bgp-ink">{deal.client}</p>
                <p className="mt-1 label-caps text-bgp-ink tabular">
                  {deal.type === "Transaction" ? "" : deal.type}
                  {deal.type !== "Transaction" && deal.price ? " · " : ""}
                  {deal.price}
                  {deal.capRate ? ` / cap rate ${deal.capRate}` : ""}
                </p>
              </div>
            </article>
          );
          const [a, b, c, d, ...rest] = shown;
          return (
            <div className="space-y-12 md:space-y-16">
              {a && (
                <div className="grid grid-cols-1 md:grid-cols-[58fr_9fr_33fr] gap-y-10 md:gap-0 items-start">
                  <Tile deal={a} aspect="aspect-[1.55]" />
                  <div className="hidden md:block" />
                  {b && <Tile deal={b} aspect="aspect-[1.16]" />}
                </div>
              )}
              {c && (
                <div className="grid grid-cols-1 md:grid-cols-[33fr_9fr_58fr] gap-y-10 md:gap-0 items-start">
                  <Tile deal={c} aspect="aspect-[1.16] md:aspect-[0.86]" />
                  <div className="hidden md:block" />
                  {d && <Tile deal={d} aspect="aspect-[1.55]" />}
                </div>
              )}
              {rest.length > 0 && (
                <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-3 lg:gap-x-8">
                  {rest.map((deal) => <Tile key={deal.name} deal={deal} aspect="aspect-[8/5]" />)}
                </div>
              )}
            </div>
          );
        })()}
        {deals.length === 0 && <p className="body-copy py-12">No transactions match these filters.</p>}
        {!expanded && !status && !type && deals.length > INITIAL_VISIBLE && (
          <p className="mt-10">
            <button onClick={() => setExpanded(true)} className="label-caps font-bold text-bgp-wine py-3 hover:opacity-70">
              + More transactions ({deals.length - INITIAL_VISIBLE})
            </button>
          </p>
        )}
      </section>

      <KeyContacts people={INVESTMENT_CONTACTS} band={false} layout="row" />
      <CaseStudyStrip band caseStudies={["the-royal-exchange", "19-golden-square", "213-214-upper-street"].map((s) => findCaseStudy(content, s)).filter(Boolean) as any} />
    </div>
  );
}
