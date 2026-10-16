import { Link } from "wouter";
import Placeholder from "./Placeholder";
import { Listing, areaLabel, fileUrl, focalPosition, formatRent, formatSqft, isImage, listingNames, useClassLabel } from "../lib/api";
import { CONTACT } from "../lib/content";

// v2c card: photo, serif address + TYPE label, details line, CONTACT rule-link
export default function ListingCard({ listing, wide = false }: { listing: Listing; wide?: boolean }) {
  const img = listing.files.find(isImage);
  const details = [formatSqft(listing.sqft), listing.rentPoa ? "POA" : formatRent(listing.askingRent)].filter(Boolean).join(", ");
  // Wireframe cards carry Book viewing and Download; the download is the
  // brochure when the tracker holds one, otherwise the listing page.
  const brochure = listing.brochureUrl ?? (() => { const f = listing.files.find((x) => x.mimeType === "application/pdf"); return f ? fileUrl(f.id) : null; })();
  const viewing = `mailto:${CONTACT.email}?subject=${encodeURIComponent(`Viewing request — ${listing.unitName}`)}`;

  return (
    // Flex column filling the grid cell so the CONTACT rule sits on the same
    // line across a row whatever the text above it (Woody, 2026-10-15).
    <div className={`flex h-full flex-col ${wide ? "sm:col-span-2" : ""}`}>
      <Link href={`/leasing/${listing.id}`} className="block group relative">
        <div className="img-frame">
          {img ? (
            <img
              src={fileUrl(img.id)}
              alt={listing.unitName}
              className="aspect-[4/3] w-full object-cover"
              style={{ objectPosition: focalPosition(img) }}
              loading="lazy"
            />
          ) : (
            <Placeholder className="aspect-[4/3] w-full" src={listing.image} alt={listing.unitName} />
          )}
        </div>
        {listing.marketingStatus === "Under Offer" && (
          <span className="absolute top-0 right-0 bg-bgp-nectar text-bgp-wine label-caps px-3 py-1.5">
            Under offer
          </span>
        )}
      </Link>
      {/* Title hierarchy per listingNames: address-named buildings lead
          with the address, named centres lead with the unit. */}
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <Link href={`/leasing/${listing.id}`} className="font-normal text-bgp-wine text-lg leading-tight hover:opacity-70 transition-colors">
          {listingNames(listing).title}
        </Link>
        {useClassLabel(listing.useClass) && (
          <span className="label-caps text-bgp-ink/70 whitespace-nowrap shrink-0">{useClassLabel(listing.useClass)}</span>
        )}
      </div>
      <p className="mt-1 text-base text-bgp-ink/75">
        {listingNames(listing).secondary && (
          <span className="text-bgp-ink/85">{listingNames(listing).secondary}<br /></span>
        )}
        {(listing.addressLine || areaLabel(listing)) && (
          <span>{listing.addressLine || areaLabel(listing)}<br /></span>
        )}
        <span className="tabular">{details || "Details on application"}</span>
      </p>
      <div className="mt-auto pt-3 flex justify-between border-b border-bgp-wine pb-1">
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
