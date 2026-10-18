import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import Placeholder from "../components/Placeholder";
import ListingCard from "../components/ListingCard";
import KeyContacts from "../components/KeyContacts";
import { MapSlot, SectionHead } from "../components/Wire";
import { Suspense, lazy } from "react";
// Leaflet touches `window` when it loads, so the map stays out of the
// build-time render and arrives lazily in the browser.
const ListingMap = lazy(() => import("../components/ListingMap"));
const isBrowser = typeof window !== "undefined";
import { CONTACT, LEASING_CONTACTS, OFFICE_PHONE, type Person } from "../lib/content";
import { useSiteContent } from "../lib/site-content";
import { Listing, areaLabel, fetchListing, fetchListings, fileUrl, focalPosition, formatSqft, isImage, listingNames, rentLabel, useClassLabel } from "../lib/api";
import { downloadParticulars } from "../lib/particulars-pdf";
import "../property-typography.css";

// WhatsApp goes to the unit's own agent from the letting tracker (the first
// one with a mobile, phones from HR), else the head of the leasing contact
// list (Woody, 2026-10-15: Bakers Annexe should reach Tracey, not Charlotte).
const isMobile = (phone: string | null | undefined) => /^(\+44\s*\(?0?\)?\s*7|07)/.test(String(phone || "").trim());
const waLink = (listing: Listing) => {
  const agent = (listing.agents || []).find((a) => isMobile(a.phone));
  const who = agent ? { name: agent.name, phone: agent.phone as string } : LEASING_CONTACTS[0];
  const digits = who.phone.replace(/[^0-9]/g, "").replace(/^440/, "44").replace(/^0/, "44");
  return `https://wa.me/${digits}?text=${encodeURIComponent(
    `Hi ${who.name.split(" ")[0]}, I'd like to find out more about ${listing.unitName.replace(/^\[Sample\]\s*/, "")}.`,
  )}`;
};

export default function ListingDetail() {
  const [, params] = useRoute("/leasing/:id");
  const id = params?.id ?? "";
  const siteContent = useSiteContent();
  const [listing, setListing] = useState<Listing | null>(null);
  const [similar, setSimilar] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchListing(id).then((l) => {
      setListing(l);
      setLoading(false);
      if (l) {
        fetchListings().then(({ listings }) => {
          setSimilar(
            listings
              .filter((o) => o.id !== l.id && (!l.location || o.location === l.location))
              .slice(0, 3),
          );
        });
      }
    });
    window.scrollTo(0, 0);
  }, [id]);

  if (loading) {
    return <p className="py-32 text-center label-caps text-bgp-ink/40">Loading…</p>;
  }
  if (!listing) {
    return (
      <div className="site-container py-32 text-center">
        <p className="label-caps text-bgp-burgundy">Listing not found</p>
        <p className="mt-4">
          <Link href="/leasing" className="explore-link inline-block">Back to leasing</Link>
        </p>
      </div>
    );
  }

  const images = listing.files.filter((f) => isImage(f) && f.category !== "floorplan");
  const plans = listing.files.filter((f) => isImage(f) && f.category === "floorplan");
  const brochurePdf = listing.files.find((f) => f.mimeType === "application/pdf");
  const brochureHref = listing.brochureUrl ?? (brochurePdf ? fileUrl(brochurePdf.id) : null);
  const mailSubject = encodeURIComponent(`Viewing request — ${listing.unitName}`);
  const hasCoords = listing.latitude && listing.longitude;
  const lat = Number(listing.latitude);
  const lon = Number(listing.longitude);
  const displayName = listing.unitName.replace(/^\[Sample\]\s*/, "");
  const names = listingNames(listing);

  const headline = [
    formatSqft(listing.sqft),
    useClassLabel(listing.useClass) ? `${useClassLabel(listing.useClass)} opportunity` : null,
    listing.availableDate ? `available ${listing.availableDate.toLowerCase() === "immediately" ? "immediately" : listing.availableDate}` : null,
  ].filter(Boolean).join(" — ");

  const keyInfo: Array<[string, string | null]> = [
    ["Address", listing.addressLine || areaLabel(listing)],
    ["Size", formatSqft(listing.sqft)],
    ["Rent", rentLabel(listing)],
    ["Rates", listing.ratesPa ? `£${Math.round(listing.ratesPa).toLocaleString("en-GB")} pa` : "To be re-assessed"],
    ["Service charge", listing.serviceChargePa ? `£${Math.round(listing.serviceChargePa).toLocaleString("en-GB")} pa` : "On application"],
    ["Lease terms", listing.leaseTerms || null],
    ["Use class", useClassLabel(listing.useClass)],
    ["Condition", listing.condition],
    ["Available", listing.availableDate || "Immediately"],
    ["EPC", listing.epcRating || "Available on request"],
    ["Legal costs", "Each party to bear their own legal costs"],
  ];
  const summaryInfo: Array<[string, string]> = [
    ["Location", areaLabel(listing) || "Location to follow"],
    ["Size", formatSqft(listing.sqft) || "Size to follow"],
    ["Price", rentLabel(listing)],
    ["Transport", "Details to follow"],
  ];
  const unitAgents: Person[] = (listing.agents || []).map((a) => ({
    name: a.name,
    title: siteContent.team.find((person) => person.name === a.name)?.title || "BGP Leasing",
    phone: a.phone || OFFICE_PHONE,
    email: a.email || CONTACT.email,
  }));
  const contacts = unitAgents.length ? unitAgents : siteContent.contacts.leasing.slice(0, 3);

  const onDownload = async () => {
    setGenerating(true);
    try { await downloadParticulars(listing); } finally { setGenerating(false); }
  };

  return (
    <div className="property-page property-listing pb-24 md:pb-0">
      {/* Wireframe slide 27: photo with the facts panel to its right, then the
          title at left with the headline statement at right. */}
      <section className="site-container section-space">
        <div className="grid grid-cols-1 gap-y-10 lg:grid-cols-[84fr_3fr_13fr] lg:gap-0">
          <div className="min-w-0">
            <div className="overflow-hidden">
              {images.length > 0 ? (
                <img src={fileUrl(images[0].id)} alt={displayName} className="aspect-[1.73] w-full object-cover" style={{ objectPosition: focalPosition(images[0]) }} />
              ) : (
                <Placeholder className="aspect-[1.73] w-full" src={listing.image} alt={displayName} />
              )}
            </div>
            <div className="mt-3 flex flex-col items-start justify-between gap-5 border-t border-bgp-wine pt-5 sm:flex-row sm:gap-6">
              <div className="min-w-0">
                <h1 className="display property-title">{names.title}</h1>
                {(names.secondary || listing.addressLine) && (
                  <p className="mt-3 body-copy property-body text-bgp-ink">
                    {[names.secondary, listing.addressLine].filter(Boolean).join(" · ")}
                  </p>
                )}
                {listing.marketingStatus === "Under Offer" && (
                  <p className="mt-4 inline-block bg-bgp-nectar text-bgp-wine label-caps px-3 py-1.5">Under offer</p>
                )}
              </div>
              <div className="property-actions flex shrink-0 gap-5 label-caps font-bold text-bgp-wine sm:flex-col sm:items-end sm:gap-2">
                <a href={`mailto:${CONTACT.email}?subject=${mailSubject}`} className="hover:text-bgp-wine">Book viewing</a>
                {brochureHref ? <a href={brochureHref} target="_blank" rel="noreferrer" className="hover:text-bgp-wine">Download</a> : <button onClick={onDownload} className="hover:text-bgp-wine">Download</button>}
              </div>
            </div>
          </div>
          <div className="hidden lg:block" />
          <aside className="min-w-0">
            <dl className="property-facts grid grid-cols-2 gap-x-6 border-t border-bgp-wine lg:block">
              {summaryInfo.map(([k, v]) => (
                  <div key={k} className="min-w-0 border-b border-bgp-line py-3">
                    <dt className="label-caps font-bold text-bgp-wine">{k}</dt>
                    <dd className={`mt-1 text-sm leading-snug tabular break-words ${k === "Transport" ? "italic text-bgp-ink/70" : ""}`}>{v}</dd>
                  </div>
                ))}
            </dl>
          </aside>
        </div>
        <div className="mt-10 md:ml-[34%] md:mr-[3%] lg:mt-14">
          {headline.length >= 100 ? (
            <p className="intro-copy property-intro text-bgp-ink">{headline.charAt(0).toUpperCase() + headline.slice(1)}.</p>
          ) : (
            <div>
              <p className="label-caps property-eyebrow text-bgp-wine mb-3">Placeholder introduction</p>
              <p className="intro-copy property-intro text-bgp-ink">
                {headline && <>{headline.charAt(0).toUpperCase() + headline.slice(1)}. </>}
                <span className="italic">An introduction to the property's setting, character and opportunity will follow.</span>
              </p>
            </div>
          )}
        </div>
            {/* Slide 27: a narrow description beside a photo, then a landscape photo and a lower portrait one. */}
            <div className="mt-12 grid grid-cols-1 gap-y-8 md:mt-20 md:grid-cols-[26fr_8fr_66fr] md:gap-0 items-start">
              <div>
                <p className="body-copy property-body text-bgp-ink">
                  {[
                    formatSqft(listing.sqft),
                    listing.propertyName && listing.propertyName !== listing.unitName ? `within ${listing.propertyName.replace(/^\[Sample\]\s*/, "")}` : null,
                    areaLabel(listing) ? `in ${areaLabel(listing)}` : null,
                  ].filter(Boolean).join(" ") || "Full particulars available on request."}
                  {" "}Full particulars, floor plans and viewing arrangements from the leasing team below.
                </p>
                <div className="mt-6">
                  <p className="label-caps property-eyebrow text-bgp-wine mb-3">Placeholder copy — property overview</p>
                  <p className="body-copy property-body text-bgp-ink italic">
                    This paragraph will describe the unit, the building and the surrounding street. The leasing team will add the property's defining features, its relationship to neighbouring occupiers and the types of business it could accommodate. Property-specific wording is awaiting review.
                  </p>
                </div>
              </div>
              <div className="hidden md:block" />
              {images[1] ? (
                <img src={fileUrl(images[1].id)} alt="" className="aspect-[1.61] w-full object-cover" style={{ objectPosition: focalPosition(images[1]) }} />
              ) : (
                <Placeholder className="aspect-[1.61] w-full" alt="Placeholder image of a retail interior" label="Property interior photography to follow" stock="/images/shop-browse.jpg" />
              )}
            </div>
            <div className="mt-10 grid grid-cols-1 md:grid-cols-[59fr_9fr_32fr] gap-6 md:gap-0 items-start">
              {images[2] ? (
                <img src={fileUrl(images[2].id)} alt="" className="aspect-[1.67] w-full object-cover" style={{ objectPosition: focalPosition(images[2]) }} />
              ) : (
                <Placeholder className="aspect-[1.67] w-full" alt="Placeholder image of a London streetscape" label="Local area photography to follow" stock="/images/st-christophers-place.jpg" />
              )}
              <div className="hidden md:block" />
              <div className="md:mt-24 lg:mt-36">
                {images[3] ? (
                  <img src={fileUrl(images[3].id)} alt="" className="aspect-[1.24] w-full object-cover md:aspect-[0.89]" style={{ objectPosition: focalPosition(images[3]) }} />
                ) : (
                  <Placeholder className="aspect-[1.24] w-full md:aspect-[0.89]" alt="Placeholder image of a shop interior" label="Property detail photography to follow" stock="/images/shop-menswear.jpg" />
                )}
              </div>
            </div>
        <details className="group mt-12 border-y border-bgp-wine/30 md:mt-16">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-bgp-wine [&::-webkit-details-marker]:hidden">
            <h2 className="label-caps property-eyebrow font-bold">Property details</h2>
            <span aria-hidden className="text-2xl leading-none transition-transform group-open:rotate-45">+</span>
          </summary>
          <dl className="property-commercial-facts grid grid-cols-1 gap-x-8 pb-6 sm:grid-cols-2 lg:grid-cols-3">
            {keyInfo.filter(([, value]) => value).map(([label, value]) => (
              <div key={label} className="min-w-0 border-t border-bgp-line py-4">
                <dt className="label-caps font-bold text-bgp-wine">{label}</dt>
                <dd className="mt-2 text-base leading-snug tabular break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      </section>

      {/* Location */}
      <section className="site-container section-space">
        <SectionHead title="Location" />
        {hasCoords && isBrowser ? (
          <Suspense fallback={<div className="aspect-[1.2] w-full bg-bgp-mist md:aspect-[1.86]" />}><ListingMap lat={lat} lon={lon} className="aspect-[1.2] w-full md:aspect-[1.86]" /></Suspense>
        ) : (
          <MapSlot className="aspect-[1.2] w-full md:aspect-[1.86]" />
        )}
      </section>

      <KeyContacts band={false}
        people={contacts}
        minimumSlots={3}
        blurb="Our team would be delighted to arrange a viewing or share full particulars."
      />

      {similar.length > 0 && (
        <section className="site-container section-space">
          <SectionHead title="Similar properties" sub="By location" />
          <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {similar.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        </section>
      )}

      {/* Phone: sticky action bar so viewing/download are always a thumb away */}
      <div className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 gap-2 border-t border-bgp-wine/20 bg-bgp-cream/95 px-3 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <a
          href={`mailto:${CONTACT.email}?subject=${mailSubject}`}
          className="btn min-w-0 px-2 text-xs"
        >
          Book viewing
        </a>
        <a
          href={waLink(listing)}
          target="_blank"
          rel="noreferrer"
          className="btn-outline min-w-0 px-2 text-xs"
        >
          WhatsApp
        </a>
        <button
          onClick={onDownload}
          disabled={generating}
          className="btn-outline min-w-0 px-2 text-xs disabled:opacity-50"
        >
          {generating ? "…" : "Details PDF"}
        </button>
      </div>
    </div>
  );
}
