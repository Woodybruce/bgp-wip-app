import { Link } from "wouter";
import Placeholder from "./Placeholder";
import { Listing, fileUrl, formatRent, formatSqft, isImage } from "../lib/api";

export default function ListingCard({ listing, wide = false }: { listing: Listing; wide?: boolean }) {
  const img = listing.files.find(isImage);
  const brochure = listing.files.find((f) => f.mimeType === "application/pdf");
  const facts = [listing.location, formatRent(listing.askingRent), formatSqft(listing.sqft)]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <Link href={`/leasing/${listing.id}`} className="block group relative">
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
        {listing.marketingStatus === "Under Offer" && (
          <span className="absolute top-0 right-0 bg-bgp-burgundy text-bgp-paper label-caps px-3 py-1.5">
            Under offer
          </span>
        )}
      </Link>
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <Link href={`/leasing/${listing.id}`} className="label-caps hover:text-bgp-burgundy">
          {listing.unitName}
        </Link>
        {listing.useClass && <span className="label-caps text-bgp-ink/50 whitespace-nowrap">{listing.useClass}</span>}
      </div>
      <p className="mt-1 text-sm text-bgp-ink/70 tabular">{facts || "Details on application"}</p>
      <div className="mt-3 flex justify-between border-t border-bgp-ink pt-2">
        <Link href={`/leasing/${listing.id}`} className="label-caps hover:text-bgp-burgundy">
          Book viewing
        </Link>
        {brochure ? (
          <a href={fileUrl(brochure.id)} target="_blank" rel="noreferrer" className="label-caps hover:text-bgp-burgundy">
            Download
          </a>
        ) : (
          <span className="label-caps text-bgp-ink/30">Download</span>
        )}
      </div>
    </div>
  );
}
