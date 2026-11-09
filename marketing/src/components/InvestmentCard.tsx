import { Link } from "wouter";
import Placeholder from "./Placeholder";
import type { InvestmentDeal } from "../lib/content";
import { investmentCaseStudySlug } from "../lib/investment-links";

export default function InvestmentCard({ deal, aspect }: { deal: InvestmentDeal; aspect: string }) {
  const caseStudySlug = investmentCaseStudySlug(deal);
  const href = caseStudySlug ? `/case-studies/${caseStudySlug}` : undefined;
  const photograph = (
    <div className="img-frame">
      <Placeholder className={`${aspect} w-full`} src={deal.image} alt={deal.name} label="Photo to follow" />
    </div>
  );
  const title = <>{deal.name}{deal.address && deal.address !== deal.name && <span className="font-normal"> · {deal.address}</span>}</>;

  return (
    <article className="min-w-0">
      {href ? <Link href={href} className="group block" aria-label={`Read the ${deal.name} case study`}>{photograph}</Link> : photograph}
      {/* Slide 31: 9.3556pt metadata on a 537.886pt-wide page is 25px
          when the page is normalized to 1440px; its line step is 28px. */}
      <div className="mt-4 font-sans text-[clamp(16px,1.74vw,25px)] font-medium uppercase leading-[1.12] tracking-normal">
        <h3 className="font-bold text-bgp-wine">
          {href ? <Link href={href} className="hover:underline underline-offset-4">{title}</Link> : title}
        </h3>
        <p className="text-bgp-ink">
          {deal.client}{deal.type !== "Transaction" && <> · {deal.type}</>}
          <span className="whitespace-nowrap text-[clamp(14px,1.18vw,17px)] text-bgp-wine"> · <span className="sr-only">Status: </span>{deal.status}</span>
        </p>
        <p className="text-bgp-ink tabular">
          {deal.price || "Price not disclosed"}{" / "}
          {deal.capRate ? `Cap rate ${deal.capRate}` : <span className="italic text-bgp-wine/70">Yield to follow</span>}
        </p>
      </div>
    </article>
  );
}
