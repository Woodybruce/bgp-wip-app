import { Link } from "wouter";
import Placeholder from "./Placeholder";
import type { CaseStudy } from "../lib/content";

// v2c: dusty-pink band, centred serif title, carousel arrows
export default function CaseStudyStrip({ caseStudy }: { caseStudy: CaseStudy }) {
  return (
    <section className="bg-bgp-pink">
      <div className="mx-auto max-w-6xl px-4 py-16 text-center">
        <p className="label-caps text-bgp-red">Case study</p>
        <h2 className="display text-4xl md:text-5xl mt-3">{caseStudy.title}</h2>
        <Link href={`/case-studies/${caseStudy.slug}`} className="group block mt-8">
          <div className="relative mx-auto max-w-3xl">
            <span className="hidden md:block absolute -left-14 top-1/2 -translate-y-1/2 text-bgp-red text-3xl" aria-hidden>‹</span>
            <Placeholder className="aspect-[16/9] w-full" src={caseStudy.image} alt={caseStudy.title} />
            <span className="hidden md:block absolute -right-14 top-1/2 -translate-y-1/2 text-bgp-red text-3xl" aria-hidden>›</span>
          </div>
          <p className="mx-auto mt-6 max-w-md text-sm font-light text-bgp-ink/75 leading-relaxed">
            {caseStudy.blurb}
          </p>
          <p className="mt-5"><span className="explore-link">Read more</span></p>
        </Link>
      </div>
    </section>
  );
}
