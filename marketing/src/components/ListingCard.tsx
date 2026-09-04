import { Link } from "wouter";
import Placeholder from "./Placeholder";
import { Listing, fileUrl, formatRent, formatSqft, isImage } from "../lib/api";

// v2c card: photo, serif address + TYPE label, details line, CONTACT rule-link
export default function ListingCard({ listing, wide = false }: { listing: Listing; wide?: boolean }) {
  const img = listing.files.find(isImage);
  const details = [formatSqft(listing.sqft), formatRent(listing.askingRent)].filter(Boolean).join(", ");

  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <Link href={`/leasing/${listing.id}`} className="block group relative">
        <div className="img-frame">
          {img ? (
            <img
              src={fileUrl(img.id)}
              alt={listing.unitName}
              className="aspect-[4/3] w-full object-cover"
              loading="lazy"
            />
          ) : (
            <Placeholder className="aspect-[4/3] w-full" src={listing.image} alt={listing.unitName} />
          )}
        </div>
        {listing.marketingStatus === "Under Offer" && (
          <span className="absolute top-0 right-0 bg-bgp-red text-white label-caps px-3 py-1.5">
            Under offer
          </span>
        )}
      </Link>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <Link href={`/leasing/${listing.id}`} className="font-display text-bgp-ink text-xl leading-tight hover:text-bgp-wine transition-colors">
          {listing.unitName}
        </Link>
        {listing.useClass && (
          <span className="label-caps text-bgp-ink/70 whitespace-nowrap shrink-0">{listing.useClass}</span>
        )}
      </div>
      <p className="mt-1 text-sm font-light text-bgp-ink/70">
        {listing.propertyName && listing.propertyName !== listing.unitName && (
          <span className="text-bgp-ink/85">{listing.propertyName}<br /></span>
        )}
        {(listing.addressLine || listing.location || listing.postcode) && (
          <span>{listing.addressLine || listing.location || listing.postcode}<br /></span>
        )}
        <span className="tabular">{details || "Details on application"}</span>
      </p>
      <p className="mt-3">
        <Link href={`/leasing/${listing.id}`} className="rule-link inline-block w-full">
          Contact
        </Link>
      </p>
    </div>
  );
}
