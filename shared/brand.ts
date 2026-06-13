/**
 * White-label brand layer.
 *
 * One core, many brands. Every tenant differs ONLY by the config below plus
 * its own deployment (separate DB + Azure tenant + env). To add a brand:
 * add an entry here, deploy with BRAND=<id> (server) / VITE_BRAND=<id>
 * (client build), and point it at its own database + Microsoft tenant.
 *
 * Shared by server and client — do not import server- or browser-only code
 * here. Environment resolution lives at the edges (server/brand.ts and
 * client brand-context) so this module stays portable.
 */

export interface BrandConfig {
  /** Stable id, also the value of the BRAND / VITE_BRAND env var. */
  id: string;
  /** Full display / legal name, e.g. "Bruce Gillingham Pollard". */
  name: string;
  /** Short label, e.g. "BGP". */
  shortName: string;
  /** Product/app name shown in UI + generated docs, e.g. "BGP Dashboard". */
  productName: string;
  /** Email domain used for self-registration + SSO gating (no leading @). */
  emailDomain: string;
  /** Permanent admin baseline — auto-promoted on login. */
  adminEmails: string[];
  /** Legal entity name for documents / privacy text. */
  legalEntity: string;
  /** Support / contact address. */
  supportEmail: string;
  /** Optional logo path (falls back to bundled asset when omitted). */
  logoUrl?: string;
  primaryColor: string;
  accentColor: string;
  headerText: string;
  footerText: string;
  tagline?: string;
}

export const DEFAULT_BRAND_ID = "bgp";

export const BRANDS: Record<string, BrandConfig> = {
  bgp: {
    id: "bgp",
    name: "Bruce Gillingham Pollard",
    shortName: "BGP",
    productName: "BGP Dashboard",
    emailDomain: "brucegillinghampollard.com",
    adminEmails: [
      "woody@brucegillinghampollard.com",
      "rupert@brucegillinghampollard.com",
      "layla@brucegillinghampollard.com",
      "wendy@brucegillinghampollard.com",
      "accounts@brucegillinghampollard.com",
      "charlotte@brucegillinghampollard.com",
      "jack@brucegillinghampollard.com",
    ],
    legalEntity: "Bruce Gillingham Pollard",
    supportEmail: "accounts@brucegillinghampollard.com",
    primaryColor: "#2E5E3F",
    accentColor: "#C4A35A",
    headerText: "BGP Dashboard",
    footerText: "© Bruce Gillingham Pollard",
  },
  landsec: {
    id: "landsec",
    name: "Landsec",
    shortName: "Landsec",
    productName: "Landsec Portfolio",
    emailDomain: "brucegillinghampollard.com",
    adminEmails: [],
    legalEntity: "Landsec",
    supportEmail: "accounts@brucegillinghampollard.com",
    primaryColor: "#00263A",
    accentColor: "#00A3E0",
    headerText: "Landsec Portfolio",
    footerText: "Powered by Bruce Gillingham Pollard",
  },
  pave: {
    id: "pave",
    name: "Pave",
    shortName: "Pave",
    productName: "Pave",
    emailDomain: "pave.london",
    adminEmails: ["woody@pave.london"],
    legalEntity: "Pave",
    supportEmail: "woody@pave.london",
    primaryColor: "#14253b",
    accentColor: "#f5ead0",
    headerText: "Pave",
    footerText: "Street level thematic focus",
    tagline: "The Circle of PAVE — street level thematic focus",
  },
};

/** Resolve a brand by id, falling back to the default. */
export function getBrand(id?: string | null): BrandConfig {
  if (id && BRANDS[id]) return BRANDS[id];
  return BRANDS[DEFAULT_BRAND_ID];
}
