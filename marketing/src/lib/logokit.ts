// LogoKit (logokit.com) — primary logo source once a publishable key is set;
// self-hosted PNGs in public/brand-logos/ remain the fallback.
export const LOGOKIT_TOKEN = (import.meta.env.VITE_LOGOKIT_TOKEN as string | undefined) ?? "";

export const logoKitEnabled = LOGOKIT_TOKEN.length > 0;

export function logoKitUrl(domain: string, size = 256): string {
  return `https://img.logokit.com/${domain}?token=${LOGOKIT_TOKEN}&size=${size}`;
}
