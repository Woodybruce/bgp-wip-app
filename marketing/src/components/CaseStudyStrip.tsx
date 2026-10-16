import { useState } from "react";
import { Link } from "wouter";
import Placeholder from "./Placeholder";
import { Band } from "./Wire";
import type { CaseStudy } from "../lib/content";

// Wireframe case study band: "Case study" label, title and intro at left
// with Find out more, an image carousel with arrows and dots at right.
// With several case studies the arrows step through them; with one they
// step through its photos.
export default function CaseStudyStrip({ caseStudy, caseStudies }: { caseStudy?: CaseStudy; caseStudies?: CaseStudy[] }) {
  const items = (caseStudies && caseStudies.length ? caseStudies : caseStudy ? [caseStudy] : []).filter(Boolean);
  const [index, setIndex] = useState(0);
  const [photo, setPhoto] = useState(0);
  if (!items.length) {
    return (
      <Band>
        <p className="label-caps text-bgp-ink/60 mb-4">Case study</p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr] gap-8 md:gap-12 items-start">
          <div className="italic">
            <h2 className="display text-2xl md:text-3xl">Case study title</h2>
            <p className="mt-5 text-base text-bgp-ink/85 max-w-md">Draft: three or four lines on a recent instruction for this team, the client, the brief and the outcome, to be written by the team.</p>
            <p className="mt-5"><span className="explore-link">Find out more</span></p>
          </div>
          <Placeholder className="aspect-[16/10] w-full" label="Photo to follow" alt="Case study photo" />
        </div>
      </Band>
    );
  }
  const current = items[index % items.length];
  const italic = current.draft ? "italic" : "";
  const photos = [current.image, ...(current.gallery || [])].filter(Boolean) as string[];
  const shown = photos[photo % Math.max(photos.length, 1)];
  const many = items.length > 1;
  const steps = many ? items.length : photos.length;
  const at = many ? index : photo;
  const step = (d: number) => {
    if (many) { setPhoto(0); setIndex((i) => (i + d + items.length) % items.length); }
    else setPhoto((p) => (p + d + photos.length) % photos.length);
  };
  return (
    <Band>
      <p className="label-caps text-bgp-ink/60 mb-4">Case study</p>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr] gap-8 md:gap-12 items-start">
        <div>
          <h2 className={`display text-2xl md:text-3xl ${italic}`}>
            <Link href={`/case-studies/${current.slug}`} className="hover:opacity-80">{current.title}</Link>
          </h2>
          <p className={`mt-5 text-base text-bgp-ink/85 max-w-md ${italic}`}>{current.blurb}</p>
          <p className="mt-5"><Link href={`/case-studies/${current.slug}`} className="explore-link">Find out more</Link></p>
        </div>
        <div className="relative">
          <Link href={`/case-studies/${current.slug}`} className="block img-frame">
            <Placeholder className="aspect-[16/10] w-full" src={shown} alt={current.title} label="Photo to follow" />
          </Link>
          {steps > 1 && (
            <>
              <button type="button" onClick={() => step(-1)} aria-label="Previous" className="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 flex items-center justify-center bg-bgp-cream/85 text-bgp-wine text-xl hover:bg-bgp-cream">‹</button>
              <button type="button" onClick={() => step(1)} aria-label="Next" className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 flex items-center justify-center bg-bgp-cream/85 text-bgp-wine text-xl hover:bg-bgp-cream">›</button>
              <div className="absolute bottom-3 inset-x-0 flex justify-center gap-1.5" aria-hidden>
                {Array.from({ length: steps }, (_, i) => (
                  <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === at ? "bg-bgp-cream" : "bg-bgp-cream/45"}`} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Band>
  );
}
