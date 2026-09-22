// Group entities panel (Delivery 5, Task 7) — ONE deduplicated legal-entity
// list for an account, backed by GET /api/accounts/:id/entities (the
// canonical group view). The header reads "X of Y entities current" with
// the explicit buckets beside it — an approved parent beside an unchecked
// child can never make the summary read "current".
//
// Rows render worst-bucket-first (rejected → expired → unchecked → in
// review → current). Approve/reject actions are admin-only and hit the
// per-entity KYC endpoints — a child approve never touches the parent.
// Staff-only server-side: scoped viewers get a 403 and the panel renders
// nothing.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthHeaders, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, AlertTriangle, CheckCircle2, AlertCircle, XCircle, ShieldCheck, Clock } from "lucide-react";

interface GroupEntityKyc {
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  expiresAt: string | null;
  nextReviewAt: string | null;
  outstanding: { key: string; label: string }[];
  lastCheckedAt: string | null;
  source: string;
}

interface GroupEntity {
  entityKind: "company" | "trading_entity";
  entityId: string | null;
  name: string;
  companiesHouseNumber: string | null;
  relation: "self" | "parent" | "subsidiary" | "trading_entity";
  relationConfidence: string;
  evidence: string[];
  representationConflicts: string[];
  kyc: GroupEntityKyc | null;
  groupRollupBlocks: boolean;
}

interface AccountEntitiesReport {
  accountId: string;
  accountName: string;
  entities: GroupEntity[];
  summary: { total: number; current: number; inReview: number; unchecked: number; expired: number; rejected: number };
}

type Bucket = "current" | "expired" | "inReview" | "rejected" | "unchecked";

function bucketOf(e: GroupEntity): Bucket {
  const kyc = e.kyc;
  if (!kyc) return "unchecked";
  const expires = kyc.expiresAt ? new Date(kyc.expiresAt).getTime() : null;
  if (kyc.status === "approved") return expires == null || expires > Date.now() ? "current" : "expired";
  if (kyc.status === "expired") return "expired";
  if (kyc.status === "in_review") return "inReview";
  if (kyc.status === "rejected") return "rejected";
  return "unchecked";
}

const BUCKET_ORDER: Bucket[] = ["rejected", "expired", "unchecked", "inReview", "current"];

// Same colour language as SubCompaniesPanel (companies.tsx).
function KycChip({ bucket, expiresAt }: { bucket: Bucket; expiresAt?: string | null }) {
  if (bucket === "current") return <Badge className="text-[9px] bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 border-0 px-1.5"><CheckCircle2 className="w-2.5 h-2.5 mr-0.5 inline" />KYC</Badge>;
  if (bucket === "inReview") return <Badge className="text-[9px] bg-yellow-100 text-yellow-700 border-0 px-1.5"><AlertCircle className="w-2.5 h-2.5 mr-0.5 inline" />Review</Badge>;
  if (bucket === "rejected") return <Badge className="text-[9px] bg-red-100 text-red-700 border-0 px-1.5"><XCircle className="w-2.5 h-2.5 mr-0.5 inline" />Fail</Badge>;
  if (bucket === "expired") return <Badge className="text-[9px] bg-amber-100 text-amber-700 border-0 px-1.5"><Clock className="w-2.5 h-2.5 mr-0.5 inline" />Expired{expiresAt ? ` ${new Date(expiresAt).toLocaleDateString()}` : ""}</Badge>;
  return <Badge variant="outline" className="text-[9px] px-1.5"><ShieldCheck className="w-2.5 h-2.5 mr-0.5 inline" />No KYC</Badge>;
}

const RELATION_LABEL: Record<GroupEntity["relation"], string> = {
  self: "Account",
  parent: "Parent",
  subsidiary: "Subsidiary",
  trading_entity: "Trading entity",
};

export function AccountEntitiesPanel({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isAdmin = !!me?.isAdmin;

  const { data } = useQuery<AccountEntitiesReport>({
    queryKey: ["/api/accounts", companyId, "entities"],
    enabled: !!companyId,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/accounts/${companyId}/entities`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/accounts", companyId, "entities"] });
  const approve = useMutation({
    mutationFn: async (e: GroupEntity) => apiRequest("POST", `/api/entities/${e.entityKind}/${e.entityId}/kyc/approve`, {}),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: async (e: GroupEntity) => apiRequest("POST", `/api/entities/${e.entityKind}/${e.entityId}/kyc/reject`, {}),
    onSuccess: invalidate,
  });

  // Staff-only / any error → render nothing (same convention as the other
  // account workspace cards).
  if (!data) return null;

  const s = data.summary;
  const rows = [...data.entities].sort((a, b) => BUCKET_ORDER.indexOf(bucketOf(a)) - BUCKET_ORDER.indexOf(bucketOf(b)));
  const bucketBadges: [number, string, string][] = [
    [s.unchecked, "unchecked", "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"],
    [s.inReview, "in review", "bg-yellow-100 text-yellow-700"],
    [s.expired, "expired", "bg-amber-100 text-amber-700"],
    [s.rejected, "rejected", "bg-red-100 text-red-700"],
  ];

  return (
    <Card data-testid={`account-entities-${companyId}`}>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-[11px] flex items-center gap-2 uppercase tracking-wider text-muted-foreground flex-wrap">
          <Building2 className="w-3.5 h-3.5" /> Group entities
          <Badge className={`text-[9px] px-1.5 border-0 ${s.current === s.total ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-amber-100 text-amber-700"}`} data-testid="entities-current-summary">
            {s.current} of {s.total} current
          </Badge>
          {bucketBadges.filter(([n]) => n > 0).map(([n, label, cls]) => (
            <Badge key={label} className={`text-[9px] px-1.5 border-0 ${cls}`}>{n} {label}</Badge>
          ))}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="max-h-80 overflow-y-auto space-y-px">
          {rows.map((e, i) => {
            const bucket = bucketOf(e);
            const actionable = isAdmin && e.entityId;
            return (
              <div
                key={`${e.entityKind}-${e.entityId ?? `jsonb-${i}`}`}
                className="flex items-center gap-1.5 py-1"
                data-testid={`entity-row-${e.entityId ?? `jsonb-${i}`}`}
              >
                <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium truncate">{e.name}</span>
                {e.companiesHouseNumber ? (
                  <Badge variant="outline" className="text-[9px] font-mono shrink-0">CH {e.companiesHouseNumber}</Badge>
                ) : (
                  <Badge variant="outline" className="text-[9px] shrink-0 text-amber-600 border-amber-300">no CH no.</Badge>
                )}
                <Badge variant="secondary" className="text-[9px] shrink-0">{RELATION_LABEL[e.relation]}</Badge>
                {e.representationConflicts.length > 0 && (
                  <span title={e.representationConflicts.join("\n")} data-testid={`entity-conflict-${e.entityId ?? i}`}>
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1.5 shrink-0">
                  {e.kyc && e.kyc.outstanding.length > 0 && (
                    <Badge variant="outline" className="text-[9px] px-1.5" title={e.kyc.outstanding.map(o => o.label).join("\n")}>
                      {e.kyc.outstanding.length} outstanding
                    </Badge>
                  )}
                  {e.kyc?.nextReviewAt && bucket === "current" && (
                    <span className="text-[9px] text-muted-foreground">review {new Date(e.kyc.nextReviewAt).toLocaleDateString()}</span>
                  )}
                  <KycChip bucket={bucket} expiresAt={e.kyc?.expiresAt} />
                  {actionable && bucket !== "current" && (
                    <Button
                      size="sm" variant="ghost" className="h-5 text-[10px] px-1.5"
                      disabled={approve.isPending}
                      onClick={() => approve.mutate(e)}
                      data-testid={`entity-approve-${e.entityId}`}
                    >Approve</Button>
                  )}
                  {actionable && bucket !== "rejected" && bucket !== "current" && (
                    <Button
                      size="sm" variant="ghost" className="h-5 text-[10px] px-1.5 text-rose-500"
                      disabled={reject.isPending}
                      onClick={() => reject.mutate(e)}
                      data-testid={`entity-reject-${e.entityId}`}
                    >Reject</Button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {rows.some(e => !e.entityId) && (
          <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">
            Rows without an id come from the legacy trading-entities list only — resolve the representation conflict before KYC can be recorded on them.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
