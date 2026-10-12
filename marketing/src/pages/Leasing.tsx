import { useEffect, useMemo, useState } from "react";
import ListingCard from "../components/ListingCard";
import KeyContacts from "../components/KeyContacts";
import CaseStudyStrip from "../components/CaseStudyStrip";
import { Link } from "wouter";
import Placeholder from "../components/Placeholder";
import { findCaseStudy, useSiteContent } from "../lib/site-content";
import { LEASING_INTRO, LEASING_SECTORS } from "../lib/content";
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
    <label className="label-caps flex items-center justify-between sm:justify-start gap-1.5 text-bgp-wine w-full sm:w-auto py-2.5 sm:py-0 border-b border-bgp-wine/10 sm:border-0">
      <span className="whitespace-nowrap">
        {label} <span className="text-bgp-red" aria-hidden>{"↘︎"}</span>
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent label-caps text-bgp-wine outline-none cursor-pointer hover:text-bgp-red text-right sm:text-left shrink-0 max-w-[60%] sm:max-w-none [text-align-last:right] sm:[text-align-last:auto]"
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
  const sectors = LEASING_SECTORS;
  const [listings, setListings] = useState<Listing[]>([]);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState("");
  const [type, setType] = useState("");
  const [size, setSize] = useState("");

  useEffect(() => {
    fetchListings().then(({ listings, live }) => {
      setListings(listings);
      setLive(live);
      setLoading(false);
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


  return (
    <div>
      {/* Centred serif intro per v2c */}
      <section className="mx-auto max-w-3xl px-4 pt-12 pb-8 text-center">
        <span className="section-label">Leasing</span>
        <h1 className="display text-3xl md:text-4xl leading-snug">{LEASING_INTRO.headline}</h1>
        {LEASING_INTRO.body.map((p) => (
          <p key={p.slice(0, 24)} className="mt-5 text-base md:text-lg text-bgp-ink/90 leading-relaxed">{p}</p>
        ))}
      </section>

      {/* Where we work — one tile per sector */}
      <section className="mx-auto max-w-6xl px-4 pb-14">
        {sectors.length === 1 ? (
          <Link href={`/leasing/sectors/${sectors[0].slug}`} className="group grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="img-frame">
              <Placeholder className="aspect-[4/3] w-full" src={sectors[0].image} alt={sectors[0].name} />
            </div>
            <div>
              <span className="section-label">Where we act</span>
              <h2 className="display text-3xl md:text-4xl group-hover:text-bgp-burgundy transition-colors">{sectors[0].name}</h2>
              <p className="mt-4 text-base md:text-lg text-bgp-ink/90 leading-relaxed">{sectors[0].headline}</p>
              <p className="mt-5"><span className="explore-link">Explore</span></p>
            </div>
          </Link>
        ) : (
        <div className={`card-strip sm:grid-cols-2 ${sectors.length > 2 ? "lg:grid-cols-4" : ""}`}>
          {sectors.map((x) => (
            <Link key={x.slug} href={`/leasing/sectors/${x.slug}`} className="group block">
              <div className="img-frame">
                <Placeholder className="aspect-[4/3] w-full" src={x.image} alt={x.name} />
              </div>
              <p className="label-caps mt-4 group-hover:text-bgp-burgundy transition-colors">
                {x.name}
              </p>
              <p className="mt-3"><span className="explore-link">Explore</span></p>
            </Link>
          ))}
        </div>
        )}
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-8 text-center">
        <span className="section-label">Availability</span>
        <h2 className="display text-3xl md:text-4xl leading-snug">Current opportunities</h2>
        {!live && !loading && (
          <p className="mt-4 text-xs text-bgp-red">
            Showing sample listings — live availability feed not connected in this environment.
          </p>
        )}
      </section>

      {/* Filter row */}
      <section className="mx-auto max-w-6xl px-4">
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-center gap-x-10 sm:gap-y-3 border-y border-bgp-wine/30 py-2 sm:py-3">
          <span className="label-caps text-bgp-ink/60 py-2.5 sm:py-0 border-b border-bgp-wine/10 sm:border-0">Filter by</span>
          <FilterSelect label="Location" value={location} options={locations} onChange={setLocation} />
          <FilterSelect label="Type" value={type} options={types} onChange={setType} />
          <FilterSelect label="Size" value={size} options={SIZE_BANDS.map((b) => b.label)} onChange={setSize} />
        </div>

        {loading ? (
          <p className="py-16 text-center label-caps text-bgp-ink/40">Loading availability…</p>
        ) : listings.length === 0 ? (
          <div className="py-16 text-center">
            <p className="display text-xl md:text-2xl">Current availability is being updated.</p>
            <p className="mt-3 text-[15px] text-bgp-ink/80">
              For our latest opportunities, contact the leasing team — details below.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-[15px] text-bgp-ink/80">
            Nothing matches those filters — please contact us for full availability.
          </p>
        ) : (
          <>
            {/* Horizontal swipe strip — keeps the case study and contacts in
                view below instead of pushing them down a long grid */}
            <div className="mt-10 card-strip sm:grid-cols-2 lg:grid-cols-3 sm:gap-x-6 sm:gap-y-12">
              {filtered.map((l) => (
                <div key={l.id}>
                  <ListingCard listing={l} />
                </div>
              ))}
            </div>
            {filtered.length > 1 && (
              <p className="mt-2 label-caps text-bgp-ink/40 text-right sm:hidden">
                {filtered.length} available — swipe for more <span aria-hidden>{"→"}</span>
              </p>
            )}
          </>
        )}
      </section>

      <div className="mt-16">
        <CaseStudyStrip caseStudies={["lucent-piccadilly", "st-christophers-place", "south-molton-triangle", "canary-wharf"].map((slug) => findCaseStudy(content, slug))} />
      </div>
      <KeyContacts people={content.contacts.leasing} />
    </div>
  );
}
