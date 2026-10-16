import type { ReactNode } from "react";
import Placeholder from "./Placeholder";

// The wireframe's layout primitives (December 2025 deck, slides 22–49):
// a photo hero with the statement bottom-left, grey bands for secondary
// sections, and left-aligned section headings over a rule. Every page is
// composed from these so the geometry matches the drawings (Woody,
// 2026-10-16: "clear design mismatches").

export function Hero({ src, alt, label, statement, caption, tall = false }: { src?: string; alt: string; label?: ReactNode; statement: ReactNode; caption?: ReactNode; tall?: boolean }) {
  return (
    <section className={`relative flex items-end overflow-hidden ${tall ? "h-[70vh] min-h-[480px]" : "h-[52vh] min-h-[380px] md:min-h-[440px]"}`}>
      <Placeholder className="absolute inset-0 h-full w-full" src={src} alt={alt} />
      <div className="absolute inset-0 bg-gradient-to-t from-bgp-ink/80 via-bgp-ink/30 to-bgp-ink/5" />
      <div className="relative mx-auto w-full max-w-6xl px-4 pb-10 md:pb-14">
        {label && <p className="label-caps text-white/80 mb-3">{label}</p>}
        <p className="max-w-2xl font-light text-2xl md:text-4xl leading-[1.15] text-white" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>{statement}</p>
        {caption}
      </div>
    </section>
  );
}

export function Band({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`bg-bgp-mist ${className}`}>
      <div className="mx-auto max-w-6xl px-4 py-12 md:py-14">{children}</div>
    </section>
  );
}

export function SectionHead({ title, sub, right, as: Tag = "h2" }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; as?: "h1" | "h2" }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2 border-b border-bgp-ink pb-3 mb-8">
      <div>
        <Tag className="display text-2xl md:text-3xl">{title}</Tag>
        {sub && <p className="mt-1.5 text-sm text-bgp-ink/70">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
