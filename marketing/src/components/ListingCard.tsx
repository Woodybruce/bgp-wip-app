import { Link } from "wouter";
import Placeholder from "./Placeholder";
import { Listing, areaLabel, fileUrl, focalPosition, formatRent, formatSqft, isImage, listingNames, useClassLabel } from "../lib/api";
import { CONTACT } from "../lib/content";

// Wireframe listing card (slide 26): photo, ADDRESS and TYPE as caps
// labels, a details line, then BOOK VIEWING and DOWNLOAD above a rule.
export default function ListingCard({ listing, wide = false, aspect = "aspect-[8/7]" }: { listing: Listing; wide?: boolean; aspect?: string }) {
  const img = listing.files.find(isImage);
  const names = listingNames(listing);
  const details = [formatSqft(listing.sqft), listing.rentPoa ? "POA" : formatRent(listing.askingRent)].filter(Boolean).join(", ");
  const brochure = listing.brochureUrl ?? (() => { const f = listing.files.find((x) => x.mimeType === "application/pdf"); return f ? fileUrl(f.id) : null; })();
  const viewing = `mailto:${CONTACT.email}?subject=${encodeURIComponent(`Viewing request — ${listing.unitName}`)}`;
  const type = useClassLabel(listing.useClass);

  return (
    <article className={`listing-card flex h-full min-w-0 flex-col ${wide ? "sm:col-span-2" : ""}`}>
      <Link href={`/leasing/${listing.id}`} className="block group relative">
        <div className="img-frame">
          {img ? (
            <img src={fileUrl(img.id)} alt={listing.unitName} className={`${aspect} w-full object-cover`} style={{ objectPosition: focalPosition(img) }} loading="lazy" />
          ) : (
            <Placeholder className={`${aspect} w-full`} src={listing.image} alt={listing.unitName} />
          )}
        </div>
        {listing.marketingStatus === "Under Offer" && (
          <span className="absolute top-0 right-0 bg-bgp-nectar text-bgp-wine label-caps px-3 py-1.5">Under offer</span>
        )}
      </Link>
      <div className="mt-4 flex items-start justify-between gap-4">
        <h3 className="min-w-0 listing-card__label font-bold text-bgp-wine">
          <Link href={`/leasing/${listing.id}`} className="hover:opacity-70">{names.title}</Link>
        </h3>
        {type && <span className="max-w-[42%] listing-card__label text-right text-bgp-ink">{type}</span>}
      </div>
      <p className="listing-card__details text-bgp-ink">
        {(listing.addressLine || areaLabel(listing) || names.secondary) && <>{listing.addressLine || areaLabel(listing) || names.secondary}<br /></>}
        <span className="tabular">{details || "Details on application"}</span>
      </p>
      <div className="mt-auto flex flex-wrap justify-between gap-x-4 gap-y-2 border-b border-bgp-wine pt-8 pb-4">
        <a href={viewing} className="listing-card__label font-bold text-bgp-wine hover:opacity-70">Book viewing</a>
        {brochure ? (
          <a href={brochure} target="_blank" rel="noreferrer" className="listing-card__label font-bold text-bgp-wine hover:opacity-70">Download</a>
        ) : (
          <Link href={`/leasing/${listing.id}`} className="listing-card__label font-bold text-bgp-wine hover:opacity-70">Details</Link>
        )}
      </div>
    </article>
  );
}
