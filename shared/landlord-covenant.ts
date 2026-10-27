export type LandlordCovenantKind = "members-voluntary-liquidation" | "creditor-process" | "mixed-history" | "unknown" | "standard" | "unlinked";
export interface LandlordCovenantEvidence {
  text: string;
  sourceLabel: string;
  sourceUrl: string;
  reviewedAt: string;
}
export interface LandlordCovenantReport {
  companyName: string;
  companyNumber: string | null;
  status: string;
  interpretation: {
    kind: LandlordCovenantKind;
    title: string;
    summary: string;
    context: string[];
    dates: Array<{ type: string; label: string; date: string; caseType: string }>;
    evidence?: LandlordCovenantEvidence[];
  };
  sourceUrl: string | null;
  checkedAt: string;
  financial?: { period?: string | null; turnover?: string | number | null; netAssets?: string | number | null; cash?: string | number | null; profitBeforeTax?: string | number | null };
  /** Only supplied after a successful check with no recorded insolvency cases. */
  assessment?: { grade: "A" | "B" | "C" | "D" | "E"; score: number; verdict: string | null; flags: Array<{ level: "red" | "amber" | "info"; label: string; detail?: string }>; missing: string[]; computedAt: string };
}
