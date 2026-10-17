import { useEffect, useMemo, useRef, useState } from "react";
import ListingCard from "../components/ListingCard";
import KeyContacts from "../components/KeyContacts";
import CaseStudyStrip from "../components/CaseStudyStrip";
import { Hero, SectionHead } from "../components/Wire";
import { findCaseStudy, useSiteContent } from "../lib/site-content";
import { LEASING_INTRO } from "../lib/content";
import { Listing, fetchListings } from "../lib/api";

const SIZE_BANDS = [
  { label: "Up to 1,000 sq ft", min: 0, max: 1000 },
  { label: "1,000–2,500 sq ft", min: 1000, max: 2500 },
  { label: "2,500–5,000 sq ft", min: 2500, max: 5000 },
  { label: "5,000+ sq ft", min: 5000, max: Infinity },
];

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="label-caps md:text-[0.7rem] font-bold flex items-center justify-between sm:justify-start gap-1.5 text-bgp-ink w-full sm:w-auto py-2.5 sm:py-0 border-b border-bgp-wine/10 sm:border-0">
      <span className="whitespace-nowrap">
        {label} <span className="text-bgp-wine" aria-hidden>{"↘︎"}</span>
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent label-caps md:text-[0.7rem] text-bgp-ink outline-none cursor-pointer hover:text-bgp-wine text-right sm:text-left shrink-0 max-w-[60%] sm:max-w-none [text-align-last:right] sm:[text-align-last:auto]"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function Leasing() {
  const content = useSiteContent();
  const [listings, setListings] = useState<Listing[]>([]);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState("");
  const [type, setType] = useState("");
  const [size, setSize] = useState("");
  // Nine listings a page with page numbers underneath, so the case studies
  // and contacts are never pushed below a long run (Woody, 2026-10-15).
  // Slide 26: a page of listings, then "+ More listings" to extend it.
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const gridTop = useRef<HTMLDivElement>(null);
  useEffect(() => { setPage(1); }, [location, type, size]);

  useEffect(() => {
    fetchListings().then(({ listings, live }) => {
      setListings(listings);
      setLive(live);
      setLoading(false);
      // Deep links from the nav rollover (slide 22): /leasing?location=…&type=…
      // Applied after the feed arrives, matched loosely against the options
      // that exist, and only in the browser so the prerendered HTML hydrates clean.
      const q = new URLSearchParams(window.location.search);
      const pick = (want: string | null, options: Array<string | null | undefined>) => {
        if (!want) return "";
        const w = want.toLowerCase();
        return options.find((o) => (o || "").toLowerCase() === w) || options.find((o) => (o || "").toLowerCase().includes(w)) || "";
      };
      const loc = pick(q.get("location"), listings.map((l) => l.location));
      const typ = pick(q.get("type"), listings.map((l) => l.useClass));
      if (loc) setLocation(loc as string);
      if (typ) setType(typ as string);
      if (q.get("location") || q.get("type")) setTimeout(() => document.getElementById("availability")?.scrollIntoView({ block: "start" }), 50);
    });
  }, []);

  const locations = useMemo(
    () => Array.from(new Set(listings.map((l) => l.location).filter(Boolean))) as string[],
    [listings],
  );
  const types = useMemo(
    () => Array.from(new Set(listings.map((l) => l.useClass).filter(Boolean))) as string[],
    [listings],
  );

  const filtered = useMemo(() => {
    return listings.filter((l) => {
      if (location && l.location !== location) return false;
      if (type && l.useClass !== type) return false;
      if (size) {
        const band = SIZE_BANDS.find((b) => b.label === size);
        if (band && !(l.sqft && l.sqft >= band.min && l.sqft < band.max)) return false;
      }
      return true;
    });
  }, [listings, location, type, size]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(0, page * PAGE_SIZE);
  const goTo = (n: number) => {
    setPage(Math.min(Math.max(1, n), pageCount));
    gridTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };


  return (
    <div>
      <Hero src="/images/gallery/mayfair-3.jpg" alt="North Audley Street, Mayfair" label="Leasing" statement={LEASING_INTRO.headline} />

      {/* Slide 26: the hero runs straight into the listings; the four teams live in the Leasing rollover. */}

      {/* Snapshot of available properties */}
      <section id="availability" className="mx-auto max-w-[1360px] px-4 pt-16 pb-14 scroll-mt-24">
        <SectionHead
          rule={false}
          title="Snapshot of available properties"
          sub={!live && !loading ? "Showing sample listings. The live availability feed is not connected in this environment." : "Please contact us for full availability"}
        />
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-x-10 sm:gap-y-3 border-b border-bgp-ink pb-3 -mt-2">
          <span className="label-caps md:text-[0.92rem] font-bold text-bgp-ink py-2.5 sm:py-0 border-b border-bgp-wine/10 sm:border-0">Filter by</span>
          <FilterSelect label="Location" value={location} options={locations} onChange={setLocation} />
          <FilterSelect label="Type" value={type} options={types} onChange={setType} />
          <FilterSelect label="Size" value={size} options={SIZE_BANDS.map((b) => b.label)} onChange={setSize} />
        </div>

        {loading ? (
          <p className="py-16 label-caps text-bgp-ink/40">Loading availability…</p>
        ) : listings.length === 0 ? (
          <div className="py-16">
            <p className="display text-xl md:text-2xl">Current availability is being updated.</p>
            <p className="mt-3 text-[15px] text-bgp-ink">
              For our latest opportunities, contact the leasing team below.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-[15px] text-bgp-ink">
            Nothing matches those filters. Please contact us for full availability.
          </p>
        ) : (
          <>
            {/* Slide 26, measured: three tiles 29.5% wide at 1.15, then a 61% tile at 1.84 beside a 30% portrait tile at 0.89, then three again. */}
            <div ref={gridTop} className="scroll-mt-28 mt-12 space-y-14">
              {Array.from({ length: Math.ceil(pageItems.length / 5) }, (_, r) => pageItems.slice(r * 5, r * 5 + 5)).map((chunk, r) => (
                <div key={r} className="space-y-14">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-[2.7%] gap-y-14">
                    {chunk.slice(0, 3).map((l) => <ListingCard key={l.id} listing={l} />)}
                  </div>
                  {chunk.length > 3 && (
                    <div className="grid grid-cols-1 md:grid-cols-[61fr_6fr_30fr_3fr] gap-6 md:gap-0 items-end">
                      <ListingCard listing={chunk[3]} aspect="aspect-[1.84]" />
                      <div className="hidden md:block" />
                      {chunk[4] && <ListingCard listing={chunk[4]} aspect="aspect-[0.89]" />}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {pageItems.length > 1 && (
              <p className="mt-2 label-caps text-bgp-ink/40 text-right sm:hidden">
                {pageItems.length} on this page, swipe for more <span aria-hidden>{"→"}</span>
              </p>
            )}
            {page < pageCount && (
              <p className="mt-10 text-left">
                <button type="button" onClick={() => setPage(page + 1)} className="label-caps md:text-[1.15rem] font-bold text-bgp-ink hover:text-bgp-wine">+ More listings ({filtered.length - pageItems.length})</button>
              </p>
            )}
          </>
        )}
      </section>

      <KeyContacts people={content.contacts.leasing} band={false} layout="row" />
      <CaseStudyStrip band caseStudies={["lucent-piccadilly", "st-christophers-place", "south-molton-triangle", "canary-wharf"].map((slug) => findCaseStudy(content, slug))} />
    </div>
  );
}
