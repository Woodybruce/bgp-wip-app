import { useEffect, useMemo, useState } from "react";
import ListingCard from "../components/ListingCard";
import KeyContacts from "../components/KeyContacts";
import CaseStudyStrip from "../components/CaseStudyStrip";
import { CASE_STUDIES, LEASING_CONTACTS } from "../lib/content";
import { Listing, fetchListings } from "../lib/api";

const INITIAL_VISIBLE = 9;

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
    <label className="label-caps flex items-center gap-1.5 text-bgp-wine">
      <span>{label}</span>
      <span className="text-bgp-red" aria-hidden>↘</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent label-caps text-bgp-wine outline-none cursor-pointer hover:text-bgp-red"
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
  const [listings, setListings] = useState<Listing[]>([]);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState("");
  const [type, setType] = useState("");
  const [size, setSize] = useState("");
  const [expanded, setExpanded] = useState(false);

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

  const visible = expanded ? filtered : filtered.slice(0, INITIAL_VISIBLE);

  return (
    <div>
      {/* Centred serif intro per v2c */}
      <section className="mx-auto max-w-3xl px-4 pt-12 pb-8 text-center">
        <h1 className="display text-3xl md:text-4xl leading-snug">
          Our Leasing team creates neighbourhoods that people love — across London's
          leading estates and the UK's landmark destinations.
        </h1>
        {!live && !loading && (
          <p className="mt-4 text-xs text-bgp-red">
            Showing sample listings — live availability feed not connected in this environment.
          </p>
        )}
      </section>

      {/* Filter row */}
      <section className="mx-auto max-w-6xl px-4">
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 border-y border-bgp-wine/30 py-3">
          <span className="label-caps text-bgp-ink/60">Filter by</span>
          <FilterSelect label="Location" value={location} options={locations} onChange={setLocation} />
          <FilterSelect label="Type" value={type} options={types} onChange={setType} />
          <FilterSelect label="Size" value={size} options={SIZE_BANDS.map((b) => b.label)} onChange={setSize} />
        </div>

        {loading ? (
          <p className="py-16 text-center label-caps text-bgp-ink/40">Loading availability…</p>
        ) : listings.length === 0 ? (
          <div className="py-16 text-center">
            <p className="display text-xl md:text-2xl">Current availability is being updated.</p>
            <p className="mt-3 text-sm font-light text-bgp-ink/60">
              For our latest opportunities, contact the leasing team — details below.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm font-light text-bgp-ink/60">
            Nothing matches those filters — please contact us for full availability.
          </p>
        ) : (
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-12">
            {visible.map((l, i) => (
              <ListingCard key={l.id} listing={l} wide={i % 5 === 3} />
            ))}
          </div>
        )}

        {!expanded && filtered.length > INITIAL_VISIBLE && (
          <p className="mt-10 text-right">
            <button onClick={() => setExpanded(true)} className="label-caps text-bgp-wine hover:text-bgp-red">
              + More listings
            </button>
          </p>
        )}
      </section>

      <div className="mt-16">
        <CaseStudyStrip caseStudy={CASE_STUDIES[0]} />
      </div>
      <KeyContacts people={LEASING_CONTACTS} />
    </div>
  );
}
