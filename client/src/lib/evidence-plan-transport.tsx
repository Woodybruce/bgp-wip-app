import { createContext, useContext, type ReactNode } from "react";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";

export type EvidencePlanDocument = {
  id: string;
  source_key?: string | null;
  document_url?: string | null;
};

export interface EvidencePlanTransport {
  /** External editors keep the plan tools, without navigation into the CRM. */
  external: boolean;
  /** An optional local identity for preferences; external preferences stay in memory. */
  viewerIdentity?: string | null;
  request(method: string, path: string, data?: unknown): Promise<Response>;
  fetch(path: string, options?: RequestInit): Promise<Response>;
  url(path: string): string;
  sourceDocumentUrl(entry: EvidencePlanDocument): string | null;
  originalPlanUrl(levelId: string, sourceUrl: string | null | undefined): string | null;
  tenancyImportUrl(planId: string, propertyId: string | null): string;
}

const staffTransport: EvidencePlanTransport = {
  external: false,
  request: apiRequest,
  fetch: (path, options) => {
    const headers = new Headers(options?.headers);
    for (const [name, value] of Object.entries(getAuthHeaders())) headers.set(name, value);
    return fetch(path, { ...options, credentials: "include", headers });
  },
  url: path => path,
  sourceDocumentUrl: entry => entry.source_key
    ? `/api/evidence-plans/source?key=${encodeURIComponent(entry.source_key)}` : null,
  originalPlanUrl: (_levelId, sourceUrl) => sourceUrl || null,
  tenancyImportUrl: (planId, propertyId) => propertyId
    ? "/api/tenancy-schedule/import-excel" : `/api/evidence-plans/${planId}/import-tenancy`,
};

const EvidencePlanTransportContext = createContext<EvidencePlanTransport>(staffTransport);

export function EvidencePlanTransportProvider({ transport, children }: {
  transport: EvidencePlanTransport;
  children: ReactNode;
}) {
  return <EvidencePlanTransportContext.Provider value={transport}>{children}</EvidencePlanTransportContext.Provider>;
}

export function useEvidencePlanTransport() {
  return useContext(EvidencePlanTransportContext);
}
