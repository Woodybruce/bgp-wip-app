import { useMemo, useState } from "react";
import KeyContacts from "../components/KeyContacts";
import CaseStudyStrip from "../components/CaseStudyStrip";
import Placeholder from "../components/Placeholder";
import { Hero, SectionHead } from "../components/Wire";
import { INVESTMENT_DEALS, SERVICE_COPY, SERVICES } from "../lib/content";
import { findCaseStudy, useSiteContent } from "../lib/site-content";

// Same page shape as before; the copy, the transactions and the photos come
// from the February 2026 Royal Exchange pitch (Woody, 2026-10-12).
const INITIAL_VISIBLE = 7;

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
      <Hero src="/images/investment/royal-exchange-interior.jpg" alt="The Royal Exchange, City of London" label="Investment" statement={service.intro} />

      <section className="mx-auto max-w-[1360px] px-4 pb-9">
        <SectionHead title="Snapshot of properties" sub="Please contact us for full availability" />
        <div className="flex flex-wrap items-center gap-x-10 gap-y-3 border-b border-bgp-wine/30 pb-3 mb-8 -mt-4">
          <span className="label-caps text-bgp-ink/60">Filter by</span>
          <Filter label="Status" value={status} options={["Completed", "Under offer"]} onChange={setStatus} />
          <Filter label="Type" value={type} options={types} onChange={setType} />
        </div>

        {/* Slide 31: a wide tile and a small one, then a small and a wide, then three across. */}
        {(() => {
          const Tile = ({ deal, aspect }: { deal: (typeof shown)[number]; aspect: string }) => (
            <div className="group">
              <div className="relative img-frame">
                <Placeholder className={`${aspect} w-full`} src={deal.image} alt={deal.name} label="Photo to follow" />
                <span className={`absolute top-0 right-0 label-caps px-3 py-1.5 ${deal.status === "Under offer" ? "bg-bgp-nectar text-bgp-wine" : "bg-bgp-wine text-bgp-cream"}`}>
                  {deal.status}
                </span>
              </div>
              <div className="mt-3">
                <p className="label-caps font-bold text-bgp-ink">{deal.name}</p>
                {deal.address && deal.address !== deal.name && <p className="mt-0.5 text-sm text-bgp-ink/60">{deal.address}</p>}
                <p className="mt-0.5 text-xs text-bgp-ink/55 uppercase">{deal.client}</p>
                <p className="mt-1 text-sm text-bgp-ink/80 tabular">
                  {deal.type === "Transaction" ? "" : deal.type}
                  {deal.type !== "Transaction" && deal.price ? " · " : ""}
                  {deal.price}
                  {deal.capRate ? ` / cap rate ${deal.capRate}` : ""}
                </p>
              </div>
            </div>
          );
          const [a, b, c, d, ...rest] = shown;
          return (
            <div className="space-y-10">
              {a && (
                <div className="grid grid-cols-1 md:grid-cols-[51fr_8fr_29fr_12fr] gap-6 md:gap-0 items-end">
                  <Tile deal={a} aspect="aspect-[8/5]" />
                  <div className="hidden md:block" />
                  {b && <Tile deal={b} aspect="aspect-[5/4]" />}
                </div>
              )}
              {c && (
                <div className="grid grid-cols-1 md:grid-cols-[29fr_12fr_51fr_8fr] gap-6 md:gap-0 items-end">
                  <Tile deal={c} aspect="aspect-[5/4]" />
                  <div className="hidden md:block" />
                  {d && <Tile deal={d} aspect="aspect-[8/5]" />}
                </div>
              )}
              {rest.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  {rest.map((deal) => <Tile key={deal.name} deal={deal} aspect="aspect-[3/2]" />)}
                </div>
              )}
            </div>
          );
        })()}
        {!expanded && !status && !type && deals.length > INITIAL_VISIBLE && (
          <p className="mt-10 text-right">
            <button onClick={() => setExpanded(true)} className="label-caps text-bgp-wine hover:opacity-70">
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
