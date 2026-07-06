// LogoKit (logokit.com) — replacement for the Clearbit logo API, which
// HubSpot retired on 1 Dec 2025. Publishable key, safe to embed client-side.
// Paste the pk_ key from logokit.com/account/logo-api to enable.
export const LOGOKIT_TOKEN = "";

export const logoKitEnabled = LOGOKIT_TOKEN.length > 0;

export function logoKitUrl(domain: string, size = 128): string {
  return `https://img.logokit.com/${domain}?token=${LOGOKIT_TOKEN}&size=${size}`;
}
