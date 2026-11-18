// The Company outlook exactly as Finance shows it, for any screen that quotes
// a Finance figure (Woody, 2026-11-17: one rule for every Finance figure, the
// dashboard's projected figure included). Same queries, same builder, same
// Xero fallback as the Finance page, so a tile can never disagree with it.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { type CashflowData, type CashflowXero, cashflowFetch } from "@/lib/cashflow-model";
import { buildCompanyOutlook, type CompanyOutlook } from "@/lib/outlook-model";

// The Finance headline feed (/api/xero/financials) as a cash flow Xero
// snapshot, for when the cash flow's own Xero pull is empty.
export function xeroFallbackFrom(fin: any): CashflowXero | undefined {
  if (!fin || fin.notConnected || fin.needsReconnect || !fin.headline) return undefined;
  return {
    cashTotal: fin.cashTotal ?? null,
    fytdIncome: fin.headline.income ?? null,
    fytdExpenses: fin.headline.operatingExpenses ?? null,
    monthly: fin.monthly || [],
    bankAccounts: fin.bankAccounts || [],
  };
}

export function withXeroFallback(cashflow: CashflowData | undefined, fallback: CashflowXero | undefined): CashflowData | undefined {
  if (!cashflow) return undefined;
  if (cashflow.xero || !fallback) return cashflow;
  return { ...cashflow, xero: fallback };
}

export function useCompanyOutlook(enabled = true): CompanyOutlook | null {
  const { data: cashflow } = useQuery<CashflowData>({
    queryKey: ["/api/cashflow"],
    queryFn: async () => (await cashflowFetch("GET", "/api/cashflow")).json(),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
  const { data: fin } = useQuery<any>({
    queryKey: ["/api/xero/financials"],
    staleTime: 5 * 60 * 1000,
    enabled,
  });
  return useMemo(() => buildCompanyOutlook(withXeroFallback(cashflow, xeroFallbackFrom(fin)), null), [cashflow, fin]);
}

// The weighted deal book in the outlook's stage rows (every stage, every
// date): the figure Finance → Fees & pipeline leads with.
export function outlookBookWeighted(outlook: CompanyOutlook | null): number | null {
  if (!outlook) return null;
  return outlook.income.byStage.reduce((s, st) => s + st.weighted, 0);
}
