// Unified source vocabulary for tracking where comps and leads came from.
// Used on both the comps schedule and leads board so badges/labels match.

export type SourceType =
  | "Email"
  | "WhatsApp"
  | "File"
  | "Brochure"
  | "News"
  | "SharePoint"
  | "Dropbox"
  | "Manual"
  | "ChatBGP"
  | "BGP Direct";

export interface SourceMeta {
  label: string;
  badgeClass: string;
  description: string;
}

export const SOURCE_TYPES: Record<SourceType, SourceMeta> = {
  "Email":      { label: "Email",     badgeClass: "bg-purple-100 text-purple-700 border-purple-200",     description: "Extracted from a team inbox email" },
  "WhatsApp":   { label: "WhatsApp",  badgeClass: "bg-green-100 text-green-700 border-green-200",        description: "Extracted from WhatsApp chat" },
  "File":       { label: "File",      badgeClass: "bg-cyan-100 text-cyan-700 border-cyan-200",           description: "Found in a shared document" },
  "Brochure":   { label: "Brochure",  badgeClass: "bg-pink-100 text-pink-700 border-pink-200",           description: "Extracted from a property brochure" },
  "News":       { label: "News",      badgeClass: "bg-amber-100 text-amber-700 border-amber-200",        description: "Picked up from news feed" },
  "SharePoint": { label: "SharePoint",badgeClass: "bg-cyan-100 text-cyan-700 border-cyan-200",           description: "Direct SharePoint source" },
  "Dropbox":    { label: "Dropbox",   badgeClass: "bg-blue-100 text-blue-700 border-blue-200",           description: "Direct Dropbox source" },
  "Manual":     { label: "Manual",    badgeClass: "bg-slate-100 text-slate-700 border-slate-200",        description: "Manually entered by user" },
  "ChatBGP":    { label: "ChatBGP",   badgeClass: "bg-indigo-100 text-indigo-700 border-indigo-200",     description: "Created via ChatBGP AI" },
  "BGP Direct": { label: "BGP",       badgeClass: "bg-emerald-100 text-emerald-700 border-emerald-200",  description: "BGP-originated deal" },
};

export const SOURCE_LIST: SourceType[] = Object.keys(SOURCE_TYPES) as SourceType[];

// Map legacy/loose values to canonical ones so old records render correctly.
const LEGACY_MAP: Record<string, SourceType> = {
  "News Feed": "News",
  "news": "News",
  "Team Email": "Email",
  "team email": "Email",
  "email": "Email",
  "SharePoint File": "File",
  "sharepoint file": "File",
  "file": "File",
  "whatsapp": "WhatsApp",
  "WhatsApp Message": "WhatsApp",
  "brochure": "Brochure",
  "manual": "Manual",
  "chatbgp": "ChatBGP",
  "bgp direct": "BGP Direct",
  "BGP": "BGP Direct",
};

export function normaliseSource(raw: string | null | undefined): SourceType | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed in SOURCE_TYPES) return trimmed as SourceType;
  if (trimmed in LEGACY_MAP) return LEGACY_MAP[trimmed];
  const lower = trimmed.toLowerCase();
  for (const [legacy, canonical] of Object.entries(LEGACY_MAP)) {
    if (legacy.toLowerCase() === lower) return canonical;
  }
  return null;
}
