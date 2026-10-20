import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import Placeholder from "./Placeholder";
import FittedHeading from "./FittedHeading";
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
      <h2 className="case-study-strip__label">Case study</h2>
      <div className="case-study-strip__grid">
        <div className="flex min-w-0 flex-col items-start">
          <FittedHeading as="h3" className={`display case-study-strip__title ${current.draft ? "italic" : ""}`}>
            <Link href={`/case-studies/${current.slug}`} className="hover:opacity-80">{current.title}</Link>
          </FittedHeading>
          <p className={`case-study-strip__copy ${current.draft ? "italic" : ""}`}>{current.blurb}</p>
          <Link href={`/case-studies/${current.slug}`} className="explore-link case-study-strip__link">Find out more</Link>
        </div>
        <div className="relative self-start" role="region" aria-roledescription="carousel" aria-label="Case studies">
          <Link href={`/case-studies/${current.slug}`} className="block img-frame">
            <Placeholder className="aspect-[302/215] w-full" src={shown} alt={current.title} label="Photo to follow" />
          </Link>
          {steps > 1 && (
            <>
              <button type="button" onClick={() => goTo(at - 1)} aria-label="Previous case study or photograph" className="absolute left-3 top-1/2 flex min-h-11 min-w-20 -translate-y-1/2 items-center justify-center bg-bgp-cream/90 px-3 text-sm text-bgp-wine hover:bg-bgp-cream">Previous</button>
              <button type="button" onClick={() => goTo(at + 1)} aria-label="Next case study or photograph" className="absolute right-3 top-1/2 flex min-h-11 min-w-20 -translate-y-1/2 items-center justify-center bg-bgp-cream/90 px-3 text-sm text-bgp-wine hover:bg-bgp-cream">Next</button>
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
    <section className={`case-study-strip ${band ? "bg-bgp-mist" : ""}`}>
      <div className="site-container case-study-strip__inner">{children}</div>
    </section>
  );
}
