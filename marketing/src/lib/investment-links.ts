import type { InvestmentDeal } from "./content";

// Only explicitly matched property records link to a project page. A similar
// name or a shared city is not sufficient evidence of the same instruction.
const CASE_STUDY_BY_DEAL: Readonly<Record<string, string>> = {
  "The Royal Exchange, London": "the-royal-exchange",
};

export function investmentCaseStudySlug(deal: InvestmentDeal): string | undefined {
  return CASE_STUDY_BY_DEAL[deal.name];
}
