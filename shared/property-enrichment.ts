export type PropertyEnrichmentStatus = 'running' | 'ready' | 'partial' | 'needs_review' | 'no_match' | 'unavailable' | 'failed';
export type PropertyEnrichmentResult = {
  ok: boolean;
  status: PropertyEnrichmentStatus;
  message: string;
  checkedAt: string | null;
  cached?: boolean;
  historyId?: number;
  updatedFields: string[];
  titleCandidates: number;
  voaCandidates: number;
  stages: { titles: string; ownership: string; voa: string };
  httpStatus?: number;
};
