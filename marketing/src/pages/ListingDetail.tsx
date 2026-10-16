import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import Placeholder from "../components/Placeholder";
import ListingCard from "../components/ListingCard";
import KeyContacts from "../components/KeyContacts";
import { SectionHead } from "../components/Wire";
import { Suspense, lazy } from "react";
// Leaflet touches `window` when it loads, so the map stays out of the
// build-time render and arrives lazily in the browser.
const ListingMap = lazy(() => import("../components/ListingMap"));
const isBrowser = typeof window !== "undefined";
import { CONTACT, LEASING_CONTACTS, OFFICE_PHONE, type Person } from "../lib/content";
import { useSiteContent } from "../lib/site-content";
import { Listing, areaLabel, fetchListing, fetchListings, fileUrl, focalPosition, formatSqft, isImage, listingNames, rentLabel, useClassLabel } from "../lib/api";
import { downloadParticulars } from "../lib/particulars-pdf";

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
      <div className="mx-auto max-w-6xl px-4 py-32 text-center">
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
  const unitAgents: Person[] = (listing.agents || []).map((a) => ({
    name: a.name,
    title: "BGP Leasing",
    phone: a.phone || OFFICE_PHONE,
    email: a.email || CONTACT.email,
  }));
  const contacts = unitAgents.length ? unitAgents : siteContent.contacts.leasing.slice(0, 3);

  const onDownload = async () => {
    setGenerating(true);
    try { await downloadParticulars(listing); } finally { setGenerating(false); }
  };

  return (
    <div className="pb-24 md:pb-0">
      <section className="mx-auto max-w-6xl px-4 pt-8 md:pt-10">
        <p className="label-caps text-bgp-ink/50 border-b border-bgp-ink pb-2">
          <Link href="/leasing" className="hover:text-bgp-wine transition-colors">Leasing</Link>
          <span className="mx-2 text-bgp-wine/40">/</span>
          <span className="text-bgp-wine">{areaLabel(listing) || "Availability"}</span>
        </p>
      </section>

      {/* Wireframe slide 27: photo with the facts panel to its right, then the
          title at left with the headline statement at right. */}
      <section className="mx-auto max-w-6xl px-4 py-8 md:py-10">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-10">
          <div>
            <div className="overflow-hidden">
              {images.length > 0 ? (
                <img src={fileUrl(images[0].id)} alt={displayName} className="aspect-[16/10] w-full object-cover" style={{ objectPosition: focalPosition(images[0]) }} />
              ) : (
                <Placeholder className="aspect-[16/10] w-full" src={listing.image} alt={displayName} />
              )}
            </div>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 border-b border-bgp-ink pb-6">
              <div>
                <h1 className="display text-3xl md:text-4xl">{names.title}</h1>
                {(names.secondary || listing.addressLine) && (
                  <p className="mt-2 text-[15px] md:text-base text-bgp-ink/80">
                    {[names.secondary, listing.addressLine].filter(Boolean).join(" · ")}
                  </p>
                )}
                {listing.marketingStatus === "Under Offer" && (
                  <p className="mt-4 inline-block bg-bgp-nectar text-bgp-wine label-caps px-3 py-1.5">Under offer</p>
                )}
              </div>
              {headline && <p className="font-bold text-lg md:text-xl text-bgp-ink/85 md:pt-1">{headline.charAt(0).toUpperCase() + headline.slice(1)}.</p>}
            </div>
            {images.length > 1 && (
              <div className="mt-3 grid grid-cols-4 gap-3">
                {images.slice(1, 5).map((f) => (
                  <img key={f.id} src={fileUrl(f.id)} alt="" className="aspect-[4/3] w-full object-cover" style={{ objectPosition: focalPosition(f) }} />
                ))}
              </div>
            )}
            {plans.length > 0 && (
              <div className="mt-8">
                <span className="section-label">Plans</span>
                <div className={`mt-3 grid gap-3 ${plans.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                  {plans.slice(0, 4).map((f) => (
                    <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noopener" className="img-frame block border border-bgp-line">
                      <img src={fileUrl(f.id)} alt={f.fileName || "Plan"} className="w-full object-contain bg-white" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-6 max-w-lg text-base text-bgp-ink/80">
              {[
                formatSqft(listing.sqft),
                listing.propertyName && listing.propertyName !== listing.unitName ? `within ${listing.propertyName.replace(/^\[Sample\]\s*/, "")}` : null,
                areaLabel(listing) ? `in ${areaLabel(listing)}` : null,
              ].filter(Boolean).join(" ") || "Full particulars available on request."}
              {" "}Full particulars, floor plans and viewing arrangements from the leasing team below.
            </p>
          </div>

          <aside>
            <dl className="border-t border-bgp-ink">
              {keyInfo
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="border-b border-bgp-line py-3">
                    <dt className="label-caps text-bgp-ink/50">{k}</dt>
                    <dd className="mt-1 text-sm tabular">{v}</dd>
                  </div>
                ))}
            </dl>
            <div className="mt-4 flex flex-col items-end gap-1 label-caps text-bgp-wine">
              <a href={`mailto:${CONTACT.email}?subject=${mailSubject}`} className="hover:opacity-70">Book viewing</a>
              {brochureHref ? <a href={brochureHref} target="_blank" rel="noreferrer" className="hover:opacity-70">Download</a> : <button onClick={onDownload} className="hover:opacity-70">Download</button>}
            </div>
            {/* Desktop action stack — on phones these live in the sticky bar */}
            <div className="mt-8 space-y-3 hidden md:block">
              <a
                href={`mailto:${CONTACT.email}?subject=${mailSubject}`}
                className="btn block"
              >
                Book viewing
              </a>
              <a
                href={waLink(listing)}
                target="_blank"
                rel="noreferrer"
                className="btn-outline block"
              >
                WhatsApp us
              </a>
              <button
                onClick={onDownload}
                disabled={generating}
                className="btn-outline block w-full disabled:opacity-50"
              >
                {generating ? "Preparing…" : "Download details"}
              </button>
              {brochureHref && (
                <a
                  href={brochureHref}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-outline block"
                >
                  Download brochure
                </a>
              )}
            </div>
          </aside>
        </div>
      </section>

      {/* Location */}
      <section className="mx-auto max-w-6xl px-4 py-8 md:py-10">
        <SectionHead title="Location" />
        {hasCoords && isBrowser ? (
          <Suspense fallback={<div className="h-72 md:h-80 w-full bg-bgp-mist" />}><ListingMap lat={lat} lon={lon} className="h-72 md:h-80 w-full" /></Suspense>
        ) : (
          <Placeholder label={listing.postcode ? `Map — ${listing.postcode}` : "Map TBC"} className="h-72 md:h-80 w-full" />
        )}
      </section>

      <KeyContacts
        people={contacts}
        blurb="Our team would be delighted to arrange a viewing or share full particulars."
      />

      {similar.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-10">
          <SectionHead title="Similar properties" sub="By location" />
          <div className="card-strip sm:grid-cols-3 sm:gap-6">
            {similar.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        </section>
      )}

      {/* Phone: sticky action bar so viewing/download are always a thumb away */}
      <div className="fixed inset-x-0 bottom-0 z-40 md:hidden bg-bgp-cream/95 backdrop-blur border-t border-bgp-wine/20 px-3 py-2.5 flex gap-2">
        <a
          href={`mailto:${CONTACT.email}?subject=${mailSubject}`}
          className="btn flex-1"
        >
          Book viewing
        </a>
        <a
          href={waLink(listing)}
          target="_blank"
          rel="noreferrer"
          className="btn-outline flex-1"
        >
          WhatsApp
        </a>
        <button
          onClick={onDownload}
          disabled={generating}
          className="btn-outline flex-1 disabled:opacity-50"
        >
          {generating ? "…" : "Details PDF"}
        </button>
      </div>
    </div>
  );
}
