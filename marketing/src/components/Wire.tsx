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
export const DRAFT_QUOTE = "BGP understood what we needed from the space from the first meeting. Their advice was clear and commercial, they moved quickly, and the result was better than we had planned for.";

// Client quote with photo (slides 32 and 41). A missing quote shows draft
// words in italics; a missing photo shows a stock image.
export function QuoteBlock({ quote, image, imageAlt = "", imageSide = "right" }: { quote?: { quote: string; name: string; title: string } | null; image?: string; imageAlt?: string; imageSide?: "left" | "right" }) {
  const hasQuote = !!quote?.quote && !/^lorem ipsum/i.test(quote.quote);
  const draft = !hasQuote;
  return (
    <section className="mx-auto max-w-[1360px] px-4 py-12 md:py-14">
      <div className={`grid grid-cols-1 gap-8 md:gap-12 items-start ${imageSide === "left" ? "md:grid-cols-[55fr_32fr] md:[direction:rtl] md:ml-[8%] md:gap-[5%]" : "md:grid-cols-[49fr_41fr] md:gap-[3%]"}`}>
        <div className={`[direction:ltr] ${draft ? "italic" : ""}`}>
          <p className="font-normal text-2xl md:text-3xl leading-snug text-bgp-ink">“{hasQuote ? quote!.quote : DRAFT_QUOTE}”</p>
          <p className="mt-4 label-caps">{quote?.name || "Client name"}</p>
          <p className="text-xs text-bgp-ink/55 uppercase">{quote?.title || "Title, company"}</p>
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

export function Hero({ src, alt, label, statement, caption, tall = false }: { src?: string; alt: string; label?: ReactNode; statement: ReactNode; caption?: ReactNode; tall?: boolean }) {
  return (
    <section data-hero className={`relative flex items-end overflow-hidden -mt-16 md:-mt-24 lg:-mt-28 ${tall ? "h-[min(85vw,100vh)] min-h-[480px]" : "h-[min(63vw,100vh)] min-h-[420px]"}`}>
      <Placeholder className="absolute inset-0 h-full w-full" src={src} alt={alt} />
      <div className="absolute inset-0 bg-gradient-to-t from-bgp-ink/80 via-bgp-ink/25 to-bgp-ink/35" />
      <div className="relative mx-auto w-full max-w-[1360px] px-4 pb-8 md:pb-10">
        {label && <p className="label-caps text-white/80 mb-3">{label}</p>}
        <p className="max-w-[66%] font-normal text-2xl md:text-4xl leading-[1.1] text-white" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>{statement}</p>
        {caption}
      </div>
    </section>
  );
}

export function Band({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`bg-bgp-mist ${className}`}>
      <div className="mx-auto max-w-[1360px] px-4 pt-10 pb-12 md:pt-10 md:pb-14">{children}</div>
    </section>
  );
}

// Section headings on every slide are small bold text over a rule (slides
// 26, 28, 31, 32, 35, 38, 41, 45); page and case-study titles are large
// light type. Brand Rep set the pattern on 2026-10-16; the rest follow.
export function SectionHead({ title, sub, right, as: Tag = "h2", rule = true }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; as?: "h1" | "h2"; rule?: boolean }) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-x-8 gap-y-2 ${rule ? "border-b-[3px] border-bgp-ink pb-3 mb-8" : "mb-6"}`}>
      <div>
        <Tag className="text-2xl font-bold text-bgp-ink">{title}</Tag>
        {sub && <p className="mt-1 text-sm text-bgp-ink/70">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
