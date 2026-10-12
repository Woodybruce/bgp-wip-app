import { useState } from "react";
import { Link } from "wouter";
import Placeholder from "./Placeholder";
import type { CaseStudy } from "../lib/content";

// v2c: dusty-pink band, centred serif title. With several case studies the
// arrows step through them in place (Woody, 2026-10-12); the image and
// "Read more" open the case study.
export default function CaseStudyStrip({ caseStudy, caseStudies }: { caseStudy?: CaseStudy; caseStudies?: CaseStudy[] }) {
  const items = (caseStudies && caseStudies.length ? caseStudies : caseStudy ? [caseStudy] : []).filter(Boolean);
  const [index, setIndex] = useState(0);
  if (!items.length) return null;
  const current = items[index % items.length];
  const step = (d: number) => setIndex((i) => (i + d + items.length) % items.length);
  const many = items.length > 1;
  return (
    <section className="bg-bgp-pink">
      <div className="mx-auto max-w-6xl px-4 py-16 text-center">
        <p className="label-caps text-bgp-red">Case study{many ? ` ${index + 1} of ${items.length}` : ""}</p>
        <h2 className="display text-4xl md:text-5xl mt-3">{current.title}</h2>
        <div className="relative mx-auto max-w-3xl mt-8">
          {many && (
            <button type="button" onClick={() => step(-1)} aria-label="Previous case study" className="hidden md:block absolute -left-14 top-1/2 -translate-y-1/2 text-bgp-red text-4xl leading-none px-2 hover:text-bgp-wine">‹</button>
          )}
          <Link href={`/case-studies/${current.slug}`} className="block">
            <Placeholder className="aspect-[16/9] w-full" src={current.image} alt={current.title} label="Photo to follow" />
          </Link>
          {many && (
            <button type="button" onClick={() => step(1)} aria-label="Next case study" className="hidden md:block absolute -right-14 top-1/2 -translate-y-1/2 text-bgp-red text-4xl leading-none px-2 hover:text-bgp-wine">›</button>
          )}
        </div>
        {many && (
          <div className="mt-5 flex justify-center gap-3 md:hidden">
            <button type="button" onClick={() => step(-1)} aria-label="Previous case study" className="label-caps text-bgp-red px-3 py-2">‹ Prev</button>
            <button type="button" onClick={() => step(1)} aria-label="Next case study" className="label-caps text-bgp-red px-3 py-2">Next ›</button>
          </div>
        )}
        <p className="mx-auto mt-6 max-w-md text-base md:text-lg text-bgp-ink/90 leading-relaxed">{current.blurb}</p>
        <p className="mt-5"><Link href={`/case-studies/${current.slug}`} className="explore-link">Read more</Link></p>
        {many && (
          <div className="mt-6 flex justify-center gap-2" aria-hidden>
            {items.map((it, i) => (
              <button key={it.slug} type="button" onClick={() => setIndex(i)} className={`h-1.5 w-6 transition-colors ${i === index ? "bg-bgp-red" : "bg-bgp-wine/25"}`} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
