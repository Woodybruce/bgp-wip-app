import { Link } from "wouter";
import Placeholder from "./Placeholder";
import type { InvestmentDeal } from "../lib/content";
import { investmentCaseStudySlug } from "../lib/investment-links";

export default function InvestmentCard({ deal, aspect }: { deal: InvestmentDeal; aspect: string }) {
  const caseStudySlug = investmentCaseStudySlug(deal);
  const href = caseStudySlug ? `/case-studies/${caseStudySlug}` : undefined;
  const photograph = (
    <div className="relative img-frame">
      <Placeholder className={`${aspect} w-full`} src={deal.image} alt={deal.name} label="Photo to follow" />
      <span className={`absolute inset-x-0 top-0 label-caps px-3 py-2 text-right ${deal.status === "Under offer" ? "bg-bgp-nectar text-bgp-wine" : "bg-bgp-wine text-bgp-cream"}`}>
        {deal.status}
      </span>
    </div>
  );
  const title = <>{deal.name}{deal.address && deal.address !== deal.name && <span className="font-normal"> · {deal.address}</span>}</>;

  return (
    <article className="min-w-0">
      {href ? <Link href={href} className="group block" aria-label={`Read the ${deal.name} case study`}>{photograph}</Link> : photograph}
      <div className="mt-3 space-y-0.5">
        <h3 className="label-caps font-bold text-bgp-wine">
          {href ? <Link href={href} className="hover:underline underline-offset-4">{title}</Link> : title}
        </h3>
        <p className="label-caps text-bgp-ink">
          {deal.client}{deal.type !== "Transaction" && <> · {deal.type}</>}
        </p>
        <p className="label-caps text-bgp-ink tabular">
          {deal.price || "Price not disclosed"}{" / "}
          {deal.capRate ? `Cap rate ${deal.capRate}` : <span className="italic text-bgp-wine/70">Yield to follow</span>}
        </p>
      </div>
    </article>
  );
}
