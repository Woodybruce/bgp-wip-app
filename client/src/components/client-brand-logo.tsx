import { useState } from "react";
import landsecLogo from "@assets/landsec-logo.png";
import type { BrandConfig } from "@/lib/brand-context";

export function ClientBrandLogo({ brand }: { brand: Pick<BrandConfig, "id" | "name" | "logoUrl"> }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const isLandsec = brand.id === "landsec" || brand.name.trim().toLowerCase() === "landsec";

  if (isLandsec) {
    // Only the bundled mark has verified transparency. An opaque logo from
    // enrichment becomes a solid rectangle when flattened into a silhouette.
    const mask = `url("${landsecLogo}") center / contain no-repeat`;
    return (
      <span
        role="img"
        aria-label="Landsec"
        className="block h-11 w-11 shrink-0 bg-current text-sidebar-foreground"
        style={{ mask, WebkitMask: mask, maskMode: "alpha" }}
        data-testid="sidebar-client-logo"
      />
    );
  }

  if (!brand.logoUrl || failedUrl === brand.logoUrl) {
    return <span className="max-w-[150px] truncate text-base font-semibold text-sidebar-foreground" title={brand.name} data-testid="sidebar-client-logo-fallback">{brand.name}</span>;
  }

  return (
    <span className="flex h-11 max-w-[150px] items-center justify-center rounded bg-white p-1">
      <img
        key={brand.logoUrl}
        src={brand.logoUrl}
        alt={brand.name}
        className="max-h-full max-w-full object-contain"
        onError={() => setFailedUrl(brand.logoUrl!)}
        data-testid="sidebar-client-logo"
      />
    </span>
  );
}
