import { Link } from "wouter";
import Placeholder from "./Placeholder";
import { Listing, areaLabel, fileUrl, focalPosition, formatRent, formatSqft, isImage, listingNames, useClassLabel } from "../lib/api";
import { CONTACT } from "../lib/content";

// Wireframe listing card (slide 26): photo, ADDRESS and TYPE as caps
// labels, a details line, then BOOK VIEWING and DOWNLOAD above a rule.
export default function ListingCard({ listing, wide = false }: { listing: Listing; wide?: boolean }) {
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
            <img src={fileUrl(img.id)} alt={listing.unitName} className="aspect-[3/2] w-full object-cover" style={{ objectPosition: focalPosition(img) }} loading="lazy" />
          ) : (
            <Placeholder className="aspect-[3/2] w-full" src={listing.image} alt={listing.unitName} />
          )}
        </div>
        {listing.marketingStatus === "Under Offer" && (
          <span className="absolute top-0 right-0 bg-bgp-nectar text-bgp-wine label-caps px-3 py-1.5">Under offer</span>
        )}
      </Link>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <Link href={`/leasing/${listing.id}`} className="label-caps text-bgp-wine hover:opacity-70">{names.title}</Link>
        {type && <span className="label-caps text-bgp-ink/60 whitespace-nowrap shrink-0">{type}</span>}
      </div>
      <p className="mt-1.5 text-sm text-bgp-ink/80">
        {names.secondary && <>{names.secondary}<br /></>}
        {(listing.addressLine || areaLabel(listing)) && <>{listing.addressLine || areaLabel(listing)}<br /></>}
        <span className="tabular">{details || "Details on application"}</span>
      </p>
      <div className="mt-auto pt-3 flex justify-between border-b border-bgp-ink pb-1.5">
        <a href={viewing} className="label-caps text-bgp-wine hover:opacity-70">Book viewing</a>
        {brochure ? (
          <a href={brochure} target="_blank" rel="noreferrer" className="label-caps text-bgp-wine hover:opacity-70">Download</a>
        ) : (
          <Link href={`/leasing/${listing.id}`} className="label-caps text-bgp-wine hover:opacity-70">Details</Link>
        )}
      </div>
    </div>
  );
}
