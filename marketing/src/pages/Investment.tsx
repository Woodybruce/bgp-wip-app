import { useMemo, useState } from "react";
import KeyContacts from "../components/KeyContacts";
import CaseStudyStrip from "../components/CaseStudyStrip";
import Placeholder from "../components/Placeholder";
import { INVESTMENT_DEALS, SERVICE_COPY, SERVICES } from "../lib/content";
import { findCaseStudy, useSiteContent } from "../lib/site-content";

// Same page shape as before; the copy, the transactions and the photos come
// from the February 2026 Royal Exchange pitch (Woody, 2026-10-12).
const INITIAL_VISIBLE = 8;

function Filter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="label-caps flex items-center gap-1.5 text-bgp-wine">
      <span className="whitespace-nowrap">{label} <span aria-hidden>{"↘︎"}</span></span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent label-caps text-bgp-wine outline-none cursor-pointer hover:opacity-70">
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
  const deals = useMemo(() => INVESTMENT_DEALS.filter((d) => (!status || d.status === status) && (!type || d.type === type)), [status, type]);
  const shown = expanded || status || type ? deals : deals.slice(0, INITIAL_VISIBLE);
  const INVESTMENT_CONTACTS = content.contacts.investment;
  const service = SERVICES.find((s) => s.slug === "investment")!;
  return (
    <div>
      <Placeholder className="h-64 md:h-[22rem] w-full" src={service.image} alt="The Royal Exchange, City of London" />
      <section className="mx-auto max-w-3xl px-4 pt-12 pb-4 text-center">
        <h1 className="display text-4xl md:text-5xl">Investment</h1>
        <p className="mt-5 font-light text-xl md:text-2xl text-bgp-wine">{service.intro}</p>
      </section>

      <section className="mx-auto max-w-3xl px-4 pt-4 text-center">
        <div className="space-y-4">
          {SERVICE_COPY.investment.body.map((p, i) => (
            <p key={p.slice(0, 24)} className={`text-base md:text-lg ${i === 0 ? "text-bgp-ink" : "text-bgp-ink/90"}`}>{p}</p>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-bgp-wine/25 pb-6 mb-10">
          <div>
            <span className="section-label">Track record</span>
            <h2 className="display text-3xl md:text-4xl">A snapshot of recent transactions</h2>
          </div>
          <p className="text-base text-bgp-ink/70 max-w-[28ch]">
            Contact the team for current opportunities and our full track record.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-10 gap-y-3 border-y border-bgp-wine/30 py-3 mb-10">
          <span className="label-caps text-bgp-ink/60">Filter by</span>
          <Filter label="Status" value={status} options={["Completed", "Under offer"]} onChange={setStatus} />
          <Filter label="Type" value={type} options={types} onChange={setType} />
        </div>

        <div className="card-strip sm:grid-cols-2 lg:grid-cols-4 sm:gap-x-6 sm:gap-y-12">
          {shown.map((deal) => (
            <div key={deal.name} className={`group ${deal.wide ? "sm:col-span-2" : ""}`}>
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
        {!expanded && !status && !type && deals.length > INITIAL_VISIBLE && (
          <p className="mt-10 text-right">
            <button onClick={() => setExpanded(true)} className="label-caps text-bgp-wine hover:opacity-70">
              + More transactions ({deals.length - INITIAL_VISIBLE})
            </button>
          </p>
        )}
      </section>

      <KeyContacts people={INVESTMENT_CONTACTS} />
      <CaseStudyStrip caseStudy={findCaseStudy(content, "the-royal-exchange")} />
    </div>
  );
}
