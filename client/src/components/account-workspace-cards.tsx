// Account workspace cards (Delivery 3) — the landlord workspace's People &
// team / next-actions / investment-strategy read-outs, backed by
// GET /api/accounts/:id/workspace (the account resolver read model).
//
// Team and next actions are staff-only server-side: scoped viewers get an
// empty team / nextActions array, so these cards simply render nothing when
// there is nothing to show. Investment requirements are real
// crm_requirements_investment records only — never inferred from ownership.
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { getAuthHeaders } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CheckSquare, TrendingUp } from "lucide-react";

export interface WorkspaceTeamMember {
  userId: string;
  name: string | null;
  email: string | null;
  role: string | null;
  teamGroup: string | null;
  sources: string[];
  isLead: boolean;
  propertyNames: string[];
  lastContributionAt: string | null;
}

export interface WorkspaceContact {
  contactId: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  avatarUrl: string | null;
  employerCompanyId: string | null;
  via: string[];
  interactionCount: number;
  lastInteractionAt: string | null;
  employerName: string | null;
  propertyNames: string[];
}

export interface WorkspaceNextAction {
  taskId: string;
  title: string;
  status: string | null;
  priority: string | null;
  dueDate: string | null;
  ownerName: string | null;
  linkKind: "deal" | "property" | "contact";
  linkId: string;
  linkLabel: string | null;
}

export interface WorkspaceInvestmentRequirement {
  id: string;
  name: string;
  status: string | null;
  use: string[] | null;
  size: string[] | null;
  locations: string[] | null;
  updatedAt: string | null;
}

export interface AccountWorkspace {
  team: WorkspaceTeamMember[];
  contacts: WorkspaceContact[];
  nextActions: WorkspaceNextAction[];
  investmentRequirements: WorkspaceInvestmentRequirement[];
  totals: { deals: number; completedDeals: number };
}

// One shared query — every card on the workspace uses the same key, so
// react-query dedupes them into a single fetch.
export function useAccountWorkspace(companyId: string | undefined) {
  return useQuery<AccountWorkspace>({
    queryKey: ["/api/accounts", companyId, "workspace"],
    enabled: !!companyId,
    queryFn: async () => {
      const res = await fetch(`/api/accounts/${companyId}/workspace`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function sourcePills(m: WorkspaceTeamMember) {
  const pills: string[] = [];
  if (m.sources.includes("curated")) pills.push(m.teamGroup || "Client team");
  if (m.sources.includes("property_agent")) pills.push(m.propertyNames.length > 0 ? `Property team · ${m.propertyNames.join(", ")}` : "Property team");
  if (m.sources.includes("deal_contributor")) pills.push("Deal team");
  if (m.sources.includes("recent_contributor")) pills.push("Recent activity");
  return pills;
}

export function AccountTeamCard({ companyId }: { companyId: string }) {
  const { data } = useAccountWorkspace(companyId);
  // Staff-only data — render nothing for scoped viewers or empty accounts.
  if (!data || data.team.length === 0) return null;
  return (
    <div className="space-y-1" data-testid={`account-team-${companyId}`}>
      {data.team.map(m => (
        <div key={m.userId} className="flex items-start gap-2 py-1" data-testid={`account-team-member-${m.userId}`}>
          <Avatar className="h-6 w-6 mt-0.5">
            <AvatarImage src={undefined} />
            <AvatarFallback className="text-[9px]">{initials(m.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-medium truncate">{m.name || m.email || "—"}</span>
              {m.isLead && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 bg-primary/10 text-primary border-primary/30">Lead</Badge>
              )}
              {m.role && <span className="text-[10px] text-muted-foreground truncate">{m.role}</span>}
            </div>
            <div className="flex items-center gap-1 flex-wrap mt-0.5">
              {sourcePills(m).map(p => (
                <span key={p} className="text-[9px] text-muted-foreground bg-muted/60 rounded px-1 py-px">{p}</span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function actionLink(a: WorkspaceNextAction): string {
  if (a.linkKind === "deal") return `/deals?id=${a.linkId}`;
  if (a.linkKind === "property") return `/properties/${a.linkId}`;
  return `/contacts/${a.linkId}`;
}

export function AccountNextActionsCard({ companyId }: { companyId: string }) {
  const { data } = useAccountWorkspace(companyId);
  if (!data || data.nextActions.length === 0) return null;
  const actions = data.nextActions.slice(0, 8);
  return (
    <Card data-testid={`account-next-actions-${companyId}`}>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-[11px] flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
          <CheckSquare className="w-3.5 h-3.5" /> Next actions
          <Badge variant="outline" className="text-[11px] font-mono tabular-nums">{data.nextActions.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-1.5">
        {actions.map(a => (
          <div key={a.taskId} className="flex items-center justify-between gap-2" data-testid={`account-next-action-${a.taskId}`}>
            <div className="min-w-0">
              <span className="block text-xs truncate">{a.title}</span>
              <span className="block text-[10px] text-muted-foreground truncate">
                {[a.ownerName, a.dueDate ? `due ${new Date(a.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : null].filter(Boolean).join(" · ")}
              </span>
            </div>
            {a.linkLabel && (
              <Link href={actionLink(a)} className="shrink-0">
                <Badge variant="outline" className="text-[9px] hover:bg-muted max-w-[10rem] truncate">{a.linkLabel}</Badge>
              </Link>
            )}
          </div>
        ))}
        <Link href="/tasks" className="block text-[11px] text-primary hover:underline pt-0.5">View all tasks</Link>
      </CardContent>
    </Card>
  );
}

export function InvestmentRequirementsCard({ companyId }: { companyId: string }) {
  const { data } = useAccountWorkspace(companyId);
  if (!data || data.investmentRequirements.length === 0) return null;
  return (
    <Card data-testid={`account-investment-reqs-${companyId}`}>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-[11px] flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
          <TrendingUp className="w-3.5 h-3.5" /> Investment requirements
          <Badge variant="outline" className="text-[11px] font-mono tabular-nums">{data.investmentRequirements.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-2">
        {data.investmentRequirements.map(r => (
          <div key={r.id} className="space-y-0.5" data-testid={`account-investment-req-${r.id}`}>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium truncate">{r.name}</span>
              {r.status && <Badge variant="outline" className="text-[9px] px-1 py-0">{r.status}</Badge>}
            </div>
            <div className="text-[10px] text-muted-foreground space-y-px">
              {r.use && r.use.length > 0 && <span className="block truncate">Use: {r.use.join(", ")}</span>}
              {r.size && r.size.length > 0 && <span className="block truncate">Size: {r.size.join(", ")}</span>}
              {r.locations && r.locations.length > 0 && <span className="block truncate">Locations: {r.locations.join(", ")}</span>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
