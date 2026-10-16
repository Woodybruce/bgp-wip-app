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
    <div className={`flex h-full flex-col ${wide ? "sm:col-span-2" : ""}`}>
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
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <Link href={`/leasing/${listing.id}`} className="label-caps font-bold text-bgp-ink hover:text-bgp-wine">{names.title}</Link>
        {type && <span className="label-caps font-bold text-bgp-ink whitespace-nowrap shrink-0">{type}</span>}
      </div>
      <p className="mt-5 text-lg leading-snug text-bgp-ink">
        {(listing.addressLine || areaLabel(listing) || names.secondary) && <>{listing.addressLine || areaLabel(listing) || names.secondary}<br /></>}
        <span className="tabular">{details || "Details on application"}</span>
      </p>
      <div className="mt-auto pt-6 flex justify-between border-b-2 border-bgp-ink pb-2">
        <a href={viewing} className="label-caps font-bold text-bgp-ink hover:text-bgp-wine">Book viewing</a>
        {brochure ? (
          <a href={brochure} target="_blank" rel="noreferrer" className="label-caps font-bold text-bgp-ink hover:text-bgp-wine">Download</a>
        ) : (
          <Link href={`/leasing/${listing.id}`} className="label-caps font-bold text-bgp-ink hover:text-bgp-wine">Details</Link>
        )}
      </div>
    </div>
  );
}
