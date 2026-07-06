import Placeholder from "./Placeholder";
import type { CaseStudy } from "../lib/content";

export default function CaseStudyStrip({ caseStudy }: { caseStudy: CaseStudy }) {
  return (
    <section className="bg-bgp-mist">
      <div className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="text-lg font-semibold border-b border-bgp-ink pb-2 mb-8">Case study</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
          <div>
            <h3 className="text-3xl md:text-4xl leading-tight">{caseStudy.title}</h3>
            <p className="mt-4 text-sm text-bgp-ink/70 leading-relaxed max-w-sm">{caseStudy.blurb}</p>
            <p className="mt-6"><span className="rule-link inline-block cursor-pointer">Find out more</span></p>
          </div>
          <Placeholder className="aspect-[4/3] w-full" />
        </div>
      </div>
    </section>
  );
}
