import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import Placeholder from "../components/Placeholder";
import ListingCard from "../components/ListingCard";
import KeyContacts from "../components/KeyContacts";
import ListingMap from "../components/ListingMap";
import { CONTACT, LEASING_CONTACTS } from "../lib/content";
import { Listing, fetchListing, fetchListings, fileUrl, formatRent, formatSqft, isImage } from "../lib/api";
import { downloadParticulars } from "../lib/particulars-pdf";

// WhatsApp goes to the head of the leasing contact list — same number the
// team page already publishes.
const WHATSAPP = LEASING_CONTACTS[0];
const waLink = (unitName: string) =>
  `https://wa.me/${WHATSAPP.phone.replace(/[^0-9]/g, "").replace(/^0/, "44")}?text=${encodeURIComponent(
    `Hi ${WHATSAPP.name.split(" ")[0]}, I'd like to find out more about ${unitName.replace(/^\[Sample\]\s*/, "")}.`,
  )}`;

export default function ListingDetail() {
  const [, params] = useRoute("/leasing/:id");
  const id = params?.id ?? "";
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

  const images = listing.files.filter(isImage);
  const brochurePdf = listing.files.find((f) => f.mimeType === "application/pdf");
  const brochureHref = listing.brochureUrl ?? (brochurePdf ? fileUrl(brochurePdf.id) : null);
  const mailSubject = encodeURIComponent(`Viewing request — ${listing.unitName}`);
  const hasCoords = listing.latitude && listing.longitude;
  const lat = Number(listing.latitude);
  const lon = Number(listing.longitude);
  const displayName = listing.unitName.replace(/^\[Sample\]\s*/, "");

  const headline = [
    formatSqft(listing.sqft),
    listing.useClass ? `${listing.useClass} opportunity` : null,
    listing.availableDate ? `available ${listing.availableDate.toLowerCase() === "immediately" ? "immediately" : listing.availableDate}` : null,
  ].filter(Boolean).join(" — ");

  const keyInfo: Array<[string, string | null]> = [
    ["Address", listing.addressLine || listing.location || listing.postcode],
    ["Size", formatSqft(listing.sqft)],
    ["Rent", formatRent(listing.askingRent) || "On application"],
    ["Rates", listing.ratesPa ? `£${Math.round(listing.ratesPa).toLocaleString("en-GB")} pa` : "To be re-assessed"],
    ["Use class", listing.useClass],
    ["Condition", listing.condition],
    ["Available", listing.availableDate || "Immediately"],
    ["EPC", listing.epcRating || "Available on request"],
  ];

  const onDownload = async () => {
    setGenerating(true);
    try { await downloadParticulars(listing); } finally { setGenerating(false); }
  };

  return (
    <div className="pb-24 md:pb-0">
      <section className="mx-auto max-w-6xl px-4 pt-8 md:pt-10">
        <p className="label-caps text-bgp-ink/50">
          <Link href="/leasing" className="hover:text-bgp-red transition-colors">Leasing</Link>
          <span className="mx-2 text-bgp-wine/40">/</span>
          <span className="text-bgp-wine">{listing.location || "Availability"}</span>
        </p>
        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-b border-bgp-wine/25 pb-6">
          <div>
            <h1 className="display text-3xl md:text-5xl leading-tight">{displayName}</h1>
            {(listing.propertyName !== listing.unitName || listing.addressLine) && (
              <p className="mt-2 text-[15px] md:text-base font-light text-bgp-ink/80">
                {[
                  listing.propertyName && listing.propertyName !== listing.unitName ? listing.propertyName.replace(/^\[Sample\]\s*/, "") : null,
                  listing.addressLine,
                ].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          {headline && <p className="font-display italic text-bgp-ink/70 text-lg md:text-xl">{headline}</p>}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-8 md:py-10">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-10">
          <div>
            <div className="overflow-hidden">
              {images.length > 0 ? (
                <img src={fileUrl(images[0].id)} alt={displayName} className="aspect-[16/10] w-full object-cover" />
              ) : (
                <Placeholder className="aspect-[16/10] w-full" src={listing.image} alt={displayName} />
              )}
            </div>
            {images.length > 1 && (
              <div className="mt-3 grid grid-cols-4 gap-3">
                {images.slice(1, 5).map((f) => (
                  <img key={f.id} src={fileUrl(f.id)} alt="" className="aspect-[4/3] w-full object-cover" />
                ))}
              </div>
            )}
            {listing.marketingStatus === "Under Offer" && (
              <p className="mt-6 inline-block bg-bgp-burgundy text-bgp-paper label-caps px-3 py-1.5">Under offer</p>
            )}
            <p className="mt-6 max-w-lg text-lg font-light leading-relaxed text-bgp-ink/80">
              {[
                formatSqft(listing.sqft),
                listing.propertyName && listing.propertyName !== listing.unitName ? `within ${listing.propertyName.replace(/^\[Sample\]\s*/, "")}` : null,
                listing.location ? `in ${listing.location}` : null,
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
            {/* Desktop action stack — on phones these live in the sticky bar */}
            <div className="mt-6 space-y-3 hidden md:block">
              <a
                href={`mailto:${CONTACT.email}?subject=${mailSubject}`}
                className="block bg-bgp-burgundy text-bgp-paper text-center label-caps py-3 hover:bg-bgp-ink transition-colors"
              >
                Book viewing
              </a>
              <a
                href={waLink(listing.unitName)}
                target="_blank"
                rel="noreferrer"
                className="block border border-bgp-burgundy text-bgp-burgundy text-center label-caps py-3 hover:bg-bgp-burgundy hover:text-bgp-paper transition-colors"
              >
                WhatsApp us
              </a>
              <button
                onClick={onDownload}
                disabled={generating}
                className="block w-full border border-bgp-ink text-center label-caps py-3 hover:border-bgp-burgundy hover:text-bgp-burgundy transition-colors disabled:opacity-50"
              >
                {generating ? "Preparing…" : "Download details"}
              </button>
              {brochureHref && (
                <a
                  href={brochureHref}
                  target="_blank"
                  rel="noreferrer"
                  className="block border border-bgp-ink text-center label-caps py-3 hover:border-bgp-burgundy hover:text-bgp-burgundy transition-colors"
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
        <h2 className="display text-2xl md:text-3xl mb-6">Location</h2>
        {hasCoords ? (
          <ListingMap lat={lat} lon={lon} className="h-72 md:h-80 w-full" />
        ) : (
          <Placeholder label={listing.postcode ? `Map — ${listing.postcode}` : "Map TBC"} className="h-72 md:h-80 w-full" />
        )}
      </section>

      <KeyContacts
        people={LEASING_CONTACTS.slice(0, 3)}
        blurb="Our team would be delighted to arrange a viewing or share full particulars."
      />

      {similar.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-10">
          <h2 className="display text-2xl md:text-3xl mb-8">Similar properties</h2>
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
          className="flex-1 bg-bgp-burgundy text-bgp-paper text-center label-caps py-3"
        >
          Book viewing
        </a>
        <a
          href={waLink(listing.unitName)}
          target="_blank"
          rel="noreferrer"
          className="flex-1 border border-bgp-burgundy text-bgp-burgundy text-center label-caps py-3"
        >
          WhatsApp
        </a>
        <button
          onClick={onDownload}
          disabled={generating}
          className="flex-1 border border-bgp-ink text-center label-caps py-3 disabled:opacity-50"
        >
          {generating ? "…" : "Details PDF"}
        </button>
      </div>
    </div>
  );
}
