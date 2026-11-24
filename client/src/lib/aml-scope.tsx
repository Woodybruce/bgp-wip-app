// Where the AML pieces talk to: a transaction's party (the default), or a
// client file, BGP's client checked with no transaction (Woody, 24 November
// 2026: "build it within companies"). The client checks, people to check and
// documents components read their addresses from here, so the same screens
// serve both (server/client-kyc.ts registers the client file's addresses).

import { createContext, useContext, type ReactNode } from "react";

export interface AmlUrls {
  /** The client checks list, send, people and address proofs: `${clientChecks}/people` and so on. */
  clientChecks: (dealId: string) => string;
  /** A party's own routes: documents, public sources, certified documents, owners abroad. */
  party: (dealId: string, role: string) => string;
  /** Set on a client file: the deal routes it has no answer for are not offered. */
  clientFile?: { companyId: string; entity: string };
}

export const DEAL_AML_URLS: AmlUrls = {
  clientChecks: dealId => `/api/aml/deal/${dealId}/client-checks`,
  party: (dealId, role) => `/api/deals/${dealId}/parties/${role}`,
};

export const clientFileUrls = (companyId: string, entity: string): AmlUrls => {
  const base = `/api/client-kyc/${encodeURIComponent(companyId)}/subjects/${encodeURIComponent(entity)}`;
  return { clientChecks: () => `${base}/client-checks`, party: () => base, clientFile: { companyId, entity } };
};

/** The cache key a client file uses where a transaction's id goes (it never reaches the server). */
export const clientFileKey = (companyId: string, entity: string) => `client:${companyId}:${entity}`;

const AmlUrlsContext = createContext<AmlUrls>(DEAL_AML_URLS);

export function AmlUrlsProvider({ urls, children }: { urls: AmlUrls; children: ReactNode }) {
  return <AmlUrlsContext.Provider value={urls}>{children}</AmlUrlsContext.Provider>;
}

export const useAmlUrls = () => useContext(AmlUrlsContext);
