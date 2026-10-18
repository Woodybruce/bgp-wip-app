import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import Placeholder from "./Placeholder";
import type { CaseStudy } from "../lib/content";

export default function CaseStudyStrip({ caseStudy, caseStudies, band = false }: { caseStudy?: CaseStudy; caseStudies?: CaseStudy[]; band?: boolean }) {
  const items = (caseStudies?.length ? caseStudies : caseStudy ? [caseStudy] : []).filter(Boolean);
  const [index, setIndex] = useState(0);
  const [photo, setPhoto] = useState(0);
  if (!items.length) return null;
  const current = items[index % items.length];
  const photos = [current.image, ...(current.gallery || [])].filter(Boolean) as string[];
  const shown = photos[photo % Math.max(photos.length, 1)];
  const many = items.length > 1;
  const steps = many ? items.length : photos.length;
  const at = (many ? index : photo) % Math.max(steps, 1);
  const goTo = (next: number) => {
    if (many) { setPhoto(0); setIndex((next + items.length) % items.length); }
    else if (photos.length) setPhoto((next + photos.length) % photos.length);
  };

  return (
    <Strip band={band}>
      <h2 className="mb-8 text-lg font-bold">Case study</h2>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-[2fr_3fr] md:gap-12 lg:gap-16">
        <div className="flex flex-col items-start">
          <h3 className={`section-title ${current.draft ? "italic" : ""}`}>
            <Link href={`/case-studies/${current.slug}`} className="hover:opacity-80">{current.title}</Link>
          </h3>
          <p className={`body-copy mt-6 ${current.draft ? "italic" : ""}`}>{current.blurb}</p>
          <Link href={`/case-studies/${current.slug}`} className="explore-link mt-8">Find out more</Link>
        </div>
        <div className="relative self-start" role="region" aria-roledescription="carousel" aria-label="Case studies">
          <Link href={`/case-studies/${current.slug}`} className="block img-frame">
            <Placeholder className="aspect-[3/2] w-full" src={shown} alt={current.title} label="Photo to follow" />
          </Link>
          {steps > 1 && (
            <>
              <button type="button" onClick={() => goTo(at - 1)} aria-label="Previous case study or photograph" className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center bg-bgp-cream/90 text-3xl text-bgp-wine hover:bg-bgp-cream">‹</button>
              <button type="button" onClick={() => goTo(at + 1)} aria-label="Next case study or photograph" className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center bg-bgp-cream/90 text-3xl text-bgp-wine hover:bg-bgp-cream">›</button>
              <div className="absolute inset-x-0 bottom-1 flex justify-center">
                {Array.from({ length: steps }, (_, step) => (
                  <button type="button" key={step} onClick={() => goTo(step)} aria-label={`Show ${many ? "case study" : "photograph"} ${step + 1}`} aria-current={step === at ? "true" : undefined} className="flex h-11 w-8 items-center justify-center">
                    <span className={`h-2 w-2 rounded-full ${step === at ? "bg-white" : "bg-white/50"}`} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Strip>
  );
}

function Strip({ children, band }: { children: ReactNode; band: boolean }) {
  return (
    <section className={band ? "bg-bgp-mist" : ""}>
      <div className="site-container section-space">{children}</div>
    </section>
  );
}
