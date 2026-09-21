export interface ListingFile {
  id: string;
  fileName: string;
  mimeType: string | null;
  category?: string | null;
  focalX?: number | null;
  focalY?: number | null;
}

export interface ListingAgent {
  name: string;
  email: string | null;
  phone: string | null;
}

export interface Listing {
  id: string;
  unitName: string;
  floor: string | null;
  sqft: number | null;
  askingRent: number | null;
  rentPoa?: boolean | null;
  leaseTerms?: string | null;
  agents?: ListingAgent[];
  ratesPa: number | null;
  serviceChargePa: number | null;
  useClass: string | null;
  condition: string | null;
  availableDate: string | null;
  marketingStatus: string | null;
  location: string | null;
  epcRating: string | null;
  propertyName: string | null;
  propertyAddress: unknown;
  addressLine: string | null;
  brochureUrl?: string;
  postcode: string | null;
  latitude: string | null;
  longitude: string | null;
  assetClass: string | null;
  files: ListingFile[];
  image?: string;
  isSample?: boolean;
}

const API_BASE = (import.meta.env.VITE_BGP_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export const SAMPLE_LISTINGS: Listing[] = [
  {
    id: "sample-1",
    image: "/images/nova-victoria.jpg",
    unitName: "[Sample] Nova, Victoria",
    floor: "Ground",
    sqft: 3297,
    askingRent: 185000,
    ratesPa: null,
    serviceChargePa: null,
    useClass: "Café / Restaurant",
    condition: "Shell",
    availableDate: "Immediately",
    marketingStatus: "Available",
    location: "Victoria",
    epcRating: "B",
    propertyName: "[Sample] Nova, Victoria",
    propertyAddress: null,
    addressLine: null,
    postcode: "SW1V 1RB",
    latitude: null,
    longitude: null,
    assetClass: "Retail",
    files: [],
    isSample: true,
  },
  {
    id: "sample-2",
    image: "/images/grosvenor-square.jpg",
    unitName: "[Sample] 30 Grosvenor Square",
    floor: "Ground + Basement",
    sqft: 5120,
    askingRent: 320000,
    ratesPa: null,
    serviceChargePa: null,
    useClass: "Retail",
    condition: "Fitted",
    availableDate: "Q3 2026",
    marketingStatus: "Available",
    location: "Mayfair",
    epcRating: "C",
    propertyName: "[Sample] 30 Grosvenor Square",
    propertyAddress: null,
    addressLine: null,
    postcode: "W1S 1JY",
    latitude: null,
    longitude: null,
    assetClass: "Retail",
    files: [],
    isSample: true,
  },
  {
    id: "sample-3",
    image: "/images/middle-eight.jpg",
    unitName: "[Sample] Middle Eight, Great Queen Street",
    floor: "Ground",
    sqft: 1480,
    askingRent: 98000,
    ratesPa: null,
    serviceChargePa: null,
    useClass: "Leisure",
    condition: "Shell",
    availableDate: "Immediately",
    marketingStatus: "Under Offer",
    location: "Soho",
    epcRating: "B",
    propertyName: "[Sample] Middle Eight, Great Queen Street",
    propertyAddress: null,
    addressLine: null,
    postcode: "W1F 9JG",
    latitude: null,
    longitude: null,
    assetClass: "Leisure",
    files: [],
    isSample: true,
  },
];

export async function fetchListings(): Promise<{ listings: Listing[]; live: boolean }> {
  if (!API_BASE) return { listings: SAMPLE_LISTINGS, live: false };
  try {
    const res = await fetch(`${API_BASE}/api/public/leasing-listings`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const listings: Listing[] = await res.json();
    return { listings, live: true };
  } catch {
    return { listings: SAMPLE_LISTINGS, live: false };
  }
}

export async function fetchListing(id: string): Promise<Listing | null> {
  const sample = SAMPLE_LISTINGS.find((l) => l.id === id);
  if (sample) return sample;
  if (!API_BASE) return null;
  try {
    const res = await fetch(`${API_BASE}/api/public/leasing-listings/${id}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function fileUrl(fileId: string): string {
  return `${API_BASE}/api/public/unit-files/${fileId}`;
}

// Listing title hierarchy (Carly, 2026-09-21): a building named by its
// street address ("8-14 Meard St") leads with the address and the unit sits
// in the smaller line; a named scheme ("Brent Cross Shopping Centre") leads
// with the unit, centre name below. Address-named = starts with a street
// number ("8-14 …", "30 Grosvenor Square").
const ADDRESS_NAME_RE = /^\d+[\w-]*\s/;
export function listingNames(listing: Listing): { title: string; secondary: string | null } {
  const unit = (listing.unitName || "").replace(/^\[Sample\]\s*/, "");
  const prop = (listing.propertyName || "").replace(/^\[Sample\]\s*/, "");
  if (!prop || prop === unit) return { title: unit, secondary: null };
  return ADDRESS_NAME_RE.test(prop)
    ? { title: prop, secondary: unit }
    : { title: unit, secondary: prop };
}

export async function newsletterSignup(email: string): Promise<void> {
  if (!API_BASE) throw new Error("Newsletter signup unavailable");
  const res = await fetch(`${API_BASE}/api/public/newsletter-signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || "Signup failed");
  }
}

export function isImage(f: ListingFile): boolean {
  return !!f.mimeType?.startsWith("image/");
}

export function formatSqft(sqft: number | null): string | null {
  if (!sqft) return null;
  return `${Math.round(sqft).toLocaleString("en-GB")} sq ft`;
}

export function formatRent(rent: number | null): string | null {
  if (!rent) return null;
  return `£${Math.round(rent).toLocaleString("en-GB")} pa`;
}

// object-position for a photo the team framed in the tracker (0–1 focal point).
export const focalPosition = (f?: { focalX?: number | null; focalY?: number | null } | null): string | undefined =>
  f && f.focalX != null && f.focalY != null ? `${Math.round(f.focalX * 100)}% ${Math.round(f.focalY * 100)}%` : undefined;

// Rent label — explicit POA beats a blank figure.
export const rentLabel = (l: { askingRent: number | null; rentPoa?: boolean | null }): string =>
  l.rentPoa ? "POA" : (formatRent(l.askingRent) || "On application");
