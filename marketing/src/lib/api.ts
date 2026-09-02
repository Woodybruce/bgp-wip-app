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
  postcode: string | null;
  latitude: string | null;
  longitude: string | null;
  assetClass: string | null;
  files: ListingFile[];
  image?: string;
  isSample?: boolean;
  brochureUrl?: string;
}

const API_BASE = (import.meta.env.VITE_BGP_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

// Real availability at Brent Cross Shopping Centre (Hammerson) — BGP is joint
// F&B leasing agent. Figures from the Completely Group site plan, 08/2026.
// Always shown alongside the live tracker feed; refresh when a new plan lands.
const BRENT_CROSS = {
  ratesPa: null,
  serviceChargePa: null,
  askingRent: null,
  useClass: "Retail / F&B",
  condition: null,
  epcRating: null,
  availableDate: null,
  location: "Brent Cross",
  propertyName: "Brent Cross Shopping Centre",
  propertyAddress: null,
  postcode: "NW4 3FP",
  latitude: "51.5766",
  longitude: "-0.2240",
  assetClass: "Retail",
  files: [],
  image: "/images/brent-cross-plan.jpg",
  brochureUrl: "/files/brent-cross-site-plan.pdf",
} as const;

export const STATIC_LISTINGS: Listing[] = [
  { ...BRENT_CROSS, id: "brent-cross-e1y", unitName: "Unit E1Y, Brent Cross", floor: "Lower Level", sqft: 525, marketingStatus: "Available" },
  { ...BRENT_CROSS, id: "brent-cross-kiosk-21", unitName: "Kiosk 21, Brent Cross", floor: "Lower Level", sqft: 900, marketingStatus: "Available" },
  { ...BRENT_CROSS, id: "brent-cross-b12", unitName: "Unit B12, Brent Cross", floor: "Upper Level", sqft: 1028, marketingStatus: "Available" },
  { ...BRENT_CROSS, id: "brent-cross-d11-12", unitName: "Unit D11/12, Brent Cross", floor: "Lower Level", sqft: 4129, marketingStatus: "Under Offer" },
  { ...BRENT_CROSS, id: "brent-cross-n13", unitName: "Unit N13, Brent Cross", floor: "Upper Level", sqft: 15100, marketingStatus: "Under Offer" },
];

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
    postcode: "W1F 9JG",
    latitude: null,
    longitude: null,
    assetClass: "Leisure",
    files: [],
    isSample: true,
  },
];

export async function fetchListings(): Promise<{ listings: Listing[]; live: boolean }> {
  if (!API_BASE) return { listings: [...STATIC_LISTINGS, ...SAMPLE_LISTINGS], live: false };
  try {
    const res = await fetch(`${API_BASE}/api/public/leasing-listings`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const listings: Listing[] = await res.json();
    return { listings: [...STATIC_LISTINGS, ...listings], live: true };
  } catch {
    return { listings: [...STATIC_LISTINGS, ...SAMPLE_LISTINGS], live: false };
  }
}

export async function fetchListing(id: string): Promise<Listing | null> {
  const local = [...STATIC_LISTINGS, ...SAMPLE_LISTINGS].find((l) => l.id === id);
  if (local) return local;
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
