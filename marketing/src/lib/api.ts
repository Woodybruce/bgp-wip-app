export interface ListingFile {
  id: string;
  fileName: string;
  mimeType: string | null;
}

export interface Listing {
  id: string;
  unitName: string;
  floor: string | null;
  sqft: number | null;
  askingRent: number | null;
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
