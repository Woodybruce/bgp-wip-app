import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "wouter";
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
  value = "",
  options = [],
  onChange,
  unavailable = false,
}: {
  label: string;
  value?: string;
  options?: string[];
  onChange?: (v: string) => void;
  unavailable?: boolean;
}) {
  return (
    <label className="label-caps flex min-w-0 items-center justify-between gap-3 text-bgp-wine w-full sm:w-auto py-2 border-b border-bgp-wine/15 sm:border-0">
      <span className="whitespace-nowrap">
        {label} <span className="text-bgp-wine" aria-hidden>{"↘︎"}</span>
      </span>
      <select
        value={value}
        disabled={unavailable}
        aria-label={`${label} filter${unavailable ? " — placeholder, to follow" : ""}`}
        onChange={(e) => onChange?.(e.target.value)}
        className="min-w-0 max-w-[65%] cursor-pointer bg-transparent py-2 pr-1 label-caps text-bgp-ink hover:text-bgp-wine disabled:cursor-not-allowed disabled:italic disabled:text-bgp-wine/60 disabled:opacity-100 sm:max-w-[210px]"
      >
        <option value="">{unavailable ? "To follow" : "All"}</option>
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
  const search = useSearch();
  const [listings, setListings] = useState<Listing[]>([]);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState("");
  const [type, setType] = useState("");
  const [size, setSize] = useState("");
  // Slide 26: a short mixed-size grid, then "+ More listings" to extend it.
  const PAGE_SIZE = 8;
  const [page, setPage] = useState(1);
  const gridTop = useRef<HTMLDivElement>(null);
  const appliedSearch = useRef<string | null>(null);
  useEffect(() => { setPage(1); }, [location, type, size]);

  useEffect(() => {
    fetchListings().then(({ listings, live }) => {
      setListings(listings);
      setLive(live);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    // Apply each URL search only after the feed arrives. Browser history and
    // same-page navigation update the filters; ordinary dropdown choices do not
    // get overwritten when the search string has stayed the same.
    if (loading || appliedSearch.current === search) return;
    appliedSearch.current = search;
    const q = new URLSearchParams(search);
    const pick = (want: string | null, options: Array<string | null | undefined>) => {
      if (!want) return "";
      const w = want.toLowerCase();
      return options.find((option) => (option || "").toLowerCase() === w)
        || options.find((option) => (option || "").toLowerCase().includes(w))
        || want;
    };
    setLocation(pick(q.get("location"), listings.map((listing) => listing.location)));
    setType(pick(q.get("type"), listings.map((listing) => listing.useClass)));
    setSize("");
    setPage(1);
    if (!q.get("location") && !q.get("type")) return;
    const frame = window.requestAnimationFrame(() => document.getElementById("availability")?.scrollIntoView({ block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [search, loading, listings]);

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

  return (
    <div>
      <h1 className="sr-only">Leasing</h1>
      <Hero src="/images/gallery/mayfair-3.jpg" alt="North Audley Street, Mayfair" label="Leasing" statement={LEASING_INTRO.headline} />

      {/* Slide 26: the hero runs straight into the listings; the four teams live in the Leasing rollover. */}

      {/* Snapshot of available properties */}
      <section id="availability" className="site-container section-space scroll-mt-24">
        <SectionHead
          rule={false}
          title="Snapshot of available properties"
          sub={!live && !loading ? "Showing sample listings. The live availability feed is not connected in this environment." : "Please contact us for full availability"}
        />
        <div className="property-filters flex flex-col items-stretch gap-x-8 border-b border-bgp-wine pb-2 sm:flex-row sm:flex-wrap sm:items-center">
          <span className="property-filters__label label-caps font-bold text-bgp-wine py-2">Filter by</span>
          <FilterSelect label="Location" value={location} options={location && !locations.includes(location) ? [location, ...locations] : locations} onChange={setLocation} />
          <FilterSelect label="Estates" unavailable />
          <FilterSelect label="Type" value={type} options={type && !types.includes(type) ? [type, ...types] : types} onChange={setType} />
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
            <div ref={gridTop} className="scroll-mt-28 mt-8 space-y-12 md:mt-10 md:space-y-16">
              {Array.from({ length: Math.ceil(pageItems.length / 5) }, (_, r) => pageItems.slice(r * 5, r * 5 + 5)).map((chunk, r) => (
                <div key={r} className="space-y-12 md:space-y-16">
                  <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-3 lg:gap-x-8">
                    {chunk.slice(0, 3).map((l) => <ListingCard key={l.id} listing={l} />)}
                  </div>
                  {chunk.length > 3 && (
                    <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-3 lg:gap-x-8">
                      <ListingCard listing={chunk[3]} wide aspect="aspect-[1.84]" />
                      {chunk[4] && <ListingCard listing={chunk[4]} aspect="aspect-[8/7] sm:aspect-[0.89]" />}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {page < pageCount && (
              <p className="mt-10 text-left">
                <button type="button" onClick={() => setPage(page + 1)} className="property-more label-caps font-bold text-bgp-wine py-3 hover:opacity-70">+ More listings ({filtered.length - pageItems.length})</button>
              </p>
            )}
          </>
        )}
      </section>

      <KeyContacts people={content.contacts.leasing} band={false} layout="row" minimumSlots={5} />
      <CaseStudyStrip band caseStudies={["lucent-piccadilly", "st-christophers-place", "south-molton-triangle", "canary-wharf"].map((slug) => findCaseStudy(content, slug))} />
    </div>
  );
}
