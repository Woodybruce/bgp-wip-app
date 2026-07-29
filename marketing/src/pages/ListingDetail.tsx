import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import Placeholder from "../components/Placeholder";
import ListingCard from "../components/ListingCard";
import KeyContacts from "../components/KeyContacts";
import { CONTACT, LEASING_CONTACTS } from "../lib/content";
import { Listing, fetchListing, fetchListings, fileUrl, formatRent, formatSqft, isImage } from "../lib/api";

export default function ListingDetail() {
  const [, params] = useRoute("/leasing/:id");
  const id = params?.id ?? "";
  const [listing, setListing] = useState<Listing | null>(null);
  const [similar, setSimilar] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

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
  const brochure = listing.files.find((f) => f.mimeType === "application/pdf");
  const mailSubject = encodeURIComponent(`Viewing request — ${listing.unitName}`);
  const hasCoords = listing.latitude && listing.longitude;
  const lat = Number(listing.latitude);
  const lon = Number(listing.longitude);

  const keyInfo: Array<[string, string | null]> = [
    ["Location", listing.location || listing.postcode],
    ["Size", formatSqft(listing.sqft)],
    ["Price", formatRent(listing.askingRent) || "On application"],
    ["Use class", listing.useClass],
    ["Condition", listing.condition],
    ["Available", listing.availableDate],
    ["EPC", listing.epcRating],
  ];

  return (
    <div>
      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-10">
          <div>
            {images.length > 0 ? (
              <img src={fileUrl(images[0].id)} alt={listing.unitName} className="aspect-[16/10] w-full object-cover" />
            ) : (
              <Placeholder className="aspect-[16/10] w-full" src={listing.image} alt={listing.unitName} />
            )}
            {images.length > 1 && (
              <div className="mt-3 grid grid-cols-4 gap-3">
                {images.slice(1, 5).map((f) => (
                  <img key={f.id} src={fileUrl(f.id)} alt="" className="aspect-[4/3] w-full object-cover" />
                ))}
              </div>
            )}
            <h1 className="mt-8 display text-3xl md:text-4xl">{listing.unitName}</h1>
            {listing.useClass && <p className="mt-1 text-sm text-bgp-ink/60">{listing.useClass} opportunity</p>}
            {listing.marketingStatus === "Under Offer" && (
              <p className="mt-3 inline-block bg-bgp-burgundy text-bgp-paper label-caps px-3 py-1.5">Under offer</p>
            )}
            <p className="mt-6 max-w-md text-lg leading-relaxed">
              {[formatSqft(listing.sqft), listing.propertyName && listing.propertyName !== listing.unitName ? `within ${listing.propertyName}` : null, listing.location ? `in ${listing.location}` : null]
                .filter(Boolean)
                .join(" ") || "Full particulars available on request."}
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
            <div className="mt-6 space-y-3">
              <a
                href={`mailto:${CONTACT.email}?subject=${mailSubject}`}
                className="block bg-bgp-burgundy text-bgp-paper text-center label-caps py-3 hover:bg-bgp-ink transition-colors"
              >
                Book viewing
              </a>
              {brochure && (
                <a
                  href={fileUrl(brochure.id)}
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
      <section className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="display text-2xl md:text-3xl mb-6">Location</h2>
        {hasCoords ? (
          <iframe
            title="Location map"
            className="h-80 w-full border border-bgp-line"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.008}%2C${lat - 0.004}%2C${lon + 0.008}%2C${lat + 0.004}&layer=mapnik&marker=${lat}%2C${lon}`}
          />
        ) : (
          <Placeholder label={listing.postcode ? `Map — ${listing.postcode}` : "Map TBC"} className="h-80 w-full" />
        )}
      </section>

      <KeyContacts
        people={LEASING_CONTACTS.slice(0, 3)}
        blurb="Our team would be delighted to arrange a viewing or share full particulars."
      />

      {similar.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-10">
          <h2 className="display text-2xl md:text-3xl mb-8">Similar properties</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {similar.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
