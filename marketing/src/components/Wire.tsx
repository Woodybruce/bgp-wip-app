import type { ReactNode } from "react";
import { Suspense, lazy } from "react";
import Placeholder from "./Placeholder";
const ListingMap = lazy(() => import("./ListingMap"));
const isBrowser = typeof window !== "undefined";

// Dashed slot for copy that has not arrived yet. Same look everywhere so
// the team can see at a glance what is still owed (Woody, 2026-10-16:
// "continuity across the whole site").
export function TextPlaceholder({ label, lines = 3, className = "" }: { label: string; lines?: number; className?: string }) {
  return (
    <div className={`border border-dashed border-bgp-stone p-4 ${className}`}>
      <p className="label-caps text-bgp-stone">{label}</p>
      <div className="mt-3 space-y-2" aria-hidden>
        {Array.from({ length: lines }, (_, i) => <div key={i} className="h-2.5 bg-bgp-stone/25" style={{ width: `${[92, 78, 85, 60][i % 4]}%` }} />)}
      </div>
    </div>
  );
}

// Draft copy the team still has to replace is set in italics so it can be
// seen on the page (Woody, 2026-10-16: "in italics where need to change").
export const DRAFT_QUOTE = "Client quote to follow.";

// Client quote with photo (slides 32 and 41). A missing quote shows draft
// words in italics; a missing photo shows a stock image.
export function QuoteBlock({ quote, image, imageAlt = "", imageSide = "right" }: { quote?: { quote: string; name: string; title: string } | null; image?: string; imageAlt?: string; imageSide?: "left" | "right" }) {
  const hasQuote = !!quote?.quote && !/^lorem ipsum/i.test(quote.quote);
  const draft = !hasQuote;
  return (
    <section className="site-container section-space">
      <div className={`grid grid-cols-1 gap-8 md:gap-16 items-center ${imageSide === "left" ? "md:grid-cols-[1.4fr_1fr] md:[direction:rtl]" : "md:grid-cols-[1fr_1.2fr]"}`}>
        <div className={`[direction:ltr] ${draft ? "italic" : ""}`}>
          <blockquote className="intro-copy text-bgp-wine">{hasQuote ? `“${quote!.quote}”` : DRAFT_QUOTE}</blockquote>
          <p className="mt-4 label-caps">{quote?.name || "Client name"}</p>
          <p className="label-caps text-bgp-ink">{quote?.title || "Title, company"}</p>
        </div>
        <Placeholder className={`${imageSide === "left" ? "aspect-[0.74]" : "aspect-[1.84]"} w-full [direction:ltr]`} src={image} alt={imageAlt || "Client quote photo"} label="Photo to follow" />
      </div>
    </section>
  );
}

// Location map, or the placeholder slot when there are no coordinates yet.
export function MapSlot({ lat, lon, zoom = 15, marker = true, pins, className = "h-72 md:h-80 w-full" }: { lat?: number; lon?: number; zoom?: number; marker?: boolean; pins?: Array<{ lat: number; lon: number; label: string }>; className?: string }) {
  if (lat == null || lon == null) return <Placeholder className={className} label="Map to follow" stock={false} />;
  if (!isBrowser) return <div className={`${className} bg-bgp-mist`} />;
  return (
    <Suspense fallback={<div className={`${className} bg-bgp-mist`} />}>
      <ListingMap lat={lat} lon={lon} zoom={zoom} marker={marker} pins={pins ?? []} className={className} />
    </Suspense>
  );
}

// The wireframe's layout primitives (December 2025 deck, slides 22–49):
// a photo hero with the statement bottom-left, grey bands for secondary
// sections, and left-aligned section headings over a rule. Every page is
// composed from these so the geometry matches the drawings (Woody,
// 2026-10-16: "clear design mismatches").

export function Hero({ src, alt, label, statement, caption, tall = false, big = false }: { src?: string; alt: string; label?: ReactNode; statement: ReactNode; caption?: ReactNode; tall?: boolean; big?: boolean }) {
  return (
    <section data-hero className={`site-hero ${tall ? "site-hero--tall" : ""}`}>
      <Placeholder className="absolute inset-0 h-full w-full" src={src} alt={alt} />
      <div className="hero-shade" />
      <div className="site-container hero-content">
        {label && <p className="label-caps text-bgp-cream mb-5">{label}</p>}
        <p className={`hero-statement ${big ? "lg:max-w-[24ch]" : ""}`}>{statement}</p>
        {caption}
      </div>
    </section>
  );
}

export function Band({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`bg-bgp-mist ${className}`}>
      <div className="site-container section-space">{children}</div>
    </section>
  );
}

// Use the wireframes' heading-and-rule structure with the brand guide's
// uppercase Century Gothic Pro Bold display typography.
export function SectionHead({ title, sub, right, as: Tag = "h2", rule = true }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; as?: "h1" | "h2"; rule?: boolean }) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-x-8 gap-y-4 ${rule ? "border-b border-bgp-wine pb-5 mb-8 md:mb-10" : "mb-8"}`}>
      <div>
        <Tag className="section-title">{title}</Tag>
        {sub && <p className="mt-3 body-copy text-bgp-ink">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
