import { useEffect, useMemo, useState } from "react";
import ListingCard from "../components/ListingCard";
import KeyContacts from "../components/KeyContacts";
import CaseStudyStrip from "../components/CaseStudyStrip";
import Placeholder from "../components/Placeholder";
import { CASE_STUDIES, LEASING_CONTACTS, SERVICES } from "../lib/content";
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
    <label className="label-caps flex items-center gap-2">
      <span className="text-bgp-ink/50">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent label-caps outline-none cursor-pointer hover:text-bgp-burgundy"
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
  const leasing = SERVICES.find((s) => s.slug === "leasing")!;

  return (
    <div>
      {/* Intro hero */}
      <section className="relative">
        <Placeholder className="h-72 md:h-96 w-full" src="/images/restaurant.jpg" alt="Restaurant interior" />
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto max-w-6xl px-4 pb-10 w-full">
            <p className="max-w-md text-xl md:text-2xl leading-snug bg-bgp-paper/85 p-4 -ml-4">
              {leasing.intro}
            </p>
          </div>
        </div>
      </section>

      {/* Listings */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <h1 className="text-lg font-semibold">Snapshot of available properties</h1>
        <p className="mt-1 text-xs text-bgp-ink/50">Please contact us for full availability</p>
        {!live && !loading && (
          <p className="mt-2 text-xs text-bgp-burgundy">
            Showing sample listings — live availability feed not connected in this environment.
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 border-y border-bgp-ink py-3">
          <span className="label-caps text-bgp-ink/50">Filter by</span>
          <FilterSelect label="Location" value={location} options={locations} onChange={setLocation} />
          <FilterSelect label="Type" value={type} options={types} onChange={setType} />
          <FilterSelect label="Size" value={size} options={SIZE_BANDS.map((b) => b.label)} onChange={setSize} />
        </div>

        {loading ? (
          <p className="py-16 text-center label-caps text-bgp-ink/40">Loading availability…</p>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-bgp-ink/60">
            Nothing matches those filters — please contact us for full availability.
          </p>
        ) : (
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
            {visible.map((l, i) => (
              <ListingCard key={l.id} listing={l} wide={i % 5 === 3} />
            ))}
          </div>
        )}

        {!expanded && filtered.length > INITIAL_VISIBLE && (
          <button onClick={() => setExpanded(true)} className="mt-10 rule-link">
            + More listings
          </button>
        )}
      </section>

      <KeyContacts people={LEASING_CONTACTS} />
      <CaseStudyStrip caseStudy={CASE_STUDIES[0]} />
    </div>
  );
}
