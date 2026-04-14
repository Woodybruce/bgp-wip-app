import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Clock, ShieldCheck, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { KycPanel } from "@/components/kyc-panel";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";

export interface DealAmlStatus {
  dealId: string;
  dealName: string;
  counterparties: Array<{
    id: string;
    name: string;
    role: string;
    kyc_status: string | null;
    kyc_expires_at: string | null;
    kyc_approved_by: string | null;
    isApproved: boolean;
    isExpired: boolean;
  }>;
  allApproved: boolean;
  canInvoice: boolean;
  missing: string[];
}

export function useDealAmlStatus(dealId: string) {
  return useQuery<DealAmlStatus>({
    queryKey: ["/api/kyc/deal", dealId, "status"],
    queryFn: async () => {
      const res = await fetch(`/api/kyc/deal/${dealId}/status`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load AML status");
      return res.json();
    },
  });
}

export function DealAmlStatusCard({ dealId }: { dealId: string }) {
  const { data, isLoading } = useDealAmlStatus(dealId);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading) return (
    <Card><CardContent className="py-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin" /></CardContent></Card>
  );
  if (!data) return null;

  if (data.counterparties.length < 2) {
    return (
      <Card>
        <CardContent className="p-3 flex items-center gap-2 text-sm" data-testid="deal-aml-status-incomplete">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            Only {data.counterparties.length} counterparty linked to this deal — both sides need to be set on the deal record before AML can be tracked.
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="deal-aml-status-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className={`w-4 h-4 ${data.allApproved ? "text-emerald-600" : "text-muted-foreground"}`} />
            <h3 className="font-semibold text-sm">AML status — both counterparties</h3>
          </div>
          {data.allApproved ? (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200" data-testid="badge-deal-aml-clear">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              AML CLEAR — invoice unlocked
            </Badge>
          ) : (
            <Badge variant="secondary" data-testid="badge-deal-aml-blocked">
              <Clock className="w-3 h-3 mr-1" />
              AML pending
            </Badge>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-2">
          {data.counterparties.map(cp => {
            const status = cp.isApproved && !cp.isExpired ? "approved" : cp.isExpired ? "expired" : cp.kyc_status || "pending";
            const colour = status === "approved" ? "border-emerald-300 bg-emerald-50/50" :
                          status === "expired" ? "border-red-300 bg-red-50/50" :
                          status === "rejected" ? "border-red-300 bg-red-50/50" :
                          "border-amber-300 bg-amber-50/30";
            const icon = status === "approved" ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> :
                        status === "expired" ? <Clock className="w-4 h-4 text-red-600" /> :
                        <AlertCircle className="w-4 h-4 text-amber-600" />;
            const isOpen = expanded === cp.id;
            return (
              <div key={cp.id} className={`border-2 rounded-lg p-3 ${colour}`} data-testid={`counterparty-${cp.id}`}>
                <div className="flex items-start gap-2">
                  {icon}
                  <div className="flex-1 min-w-0">
                    <Badge variant="outline" className="text-[10px] mb-1 uppercase">{cp.role}</Badge>
                    <Link href={`/companies/${cp.id}`} className="font-medium text-sm hover:underline block truncate">
                      {cp.name}
                    </Link>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {status === "approved" ? `Approved${cp.kyc_approved_by ? ` by ${cp.kyc_approved_by}` : ""}` :
                       status === "expired" ? "Expired — re-check needed" :
                       status === "rejected" ? "Rejected" :
                       status === "in_review" ? "In review" : "No KYC yet"}
                    </div>
                    {cp.kyc_expires_at && (
                      <div className="text-[11px] text-muted-foreground">
                        {cp.isExpired ? "Was valid until" : "Valid until"} {new Date(cp.kyc_expires_at).toLocaleDateString("en-GB")}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => setExpanded(isOpen ? null : cp.id)}
                    data-testid={`button-expand-counterparty-${cp.id}`}
                  >
                    {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {isOpen ? "Close" : "Manage"}
                  </Button>
                </div>
                {isOpen && (
                  <div className="mt-3 pt-3 border-t border-current/10">
                    <KycPanel companyId={cp.id} dealId={dealId} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!data.allApproved && data.missing.length > 0 && (
          <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-md text-sm" data-testid="deal-aml-blocker">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-medium">Invoice locked.</span> Waiting on AML approval for {data.missing.join(", ")}.
              Open each counterparty above and complete the checklist + upload supporting documents, then click MLRO Approve.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
