import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/queryClient";
import { useTeam } from "@/lib/team-context";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, ClipboardList } from "lucide-react";
import type { User } from "@shared/schema";

// Client-facing portfolio tasks (Messages Phase 2, Woody 2026-08-05:
// "being able to see tasks and see who has done what"). Read-only roll-up
// of BGP tasks linked to the client's properties — titles, owners and
// outcomes; descriptions stay internal.

type PortfolioTask = {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  category: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string | null;
  assignee_name: string | null;
  property_name: string | null;
  deal_name: string | null;
};

const shortDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;

function TaskRow({ t, done }: { t: PortfolioTask; done: boolean }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5" data-testid={`client-task-${t.id}`}>
      {done
        ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-600" />
        : <Circle className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground/50" />}
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${done ? "text-muted-foreground" : "font-medium"}`}>{t.title}</div>
        <div className="text-xs text-muted-foreground truncate">
          {[
            done
              ? `${t.assignee_name || "BGP"} · done ${shortDate(t.completed_at) || ""}`.trim()
              : t.assignee_name || "BGP",
            t.property_name || t.deal_name,
          ].filter(Boolean).join(" — ")}
        </div>
      </div>
      {!done && t.due_date && (
        <Badge variant="outline" className={`text-[10px] shrink-0 ${new Date(t.due_date) < new Date() ? "text-red-600 border-red-200" : ""}`}>
          {shortDate(t.due_date)}
        </Badge>
      )}
    </div>
  );
}

export function PortfolioTasksBoard() {
  const { data: user } = useQuery<User>({ queryKey: ["/api/auth/me"] });
  const { activeTeam } = useTeam();
  const effectiveTeam = activeTeam && activeTeam !== "all" ? activeTeam : user?.team;
  const clientCompanyId = (user as any)?.companyScopeId || (user as any)?.clientTeamCompanyId || null;

  const { data: companyLookup } = useQuery<any>({
    queryKey: ["/api/company-by-name", effectiveTeam],
    queryFn: async () => {
      const res = await fetch(`/api/company-by-name/${encodeURIComponent(effectiveTeam!)}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!effectiveTeam && !clientCompanyId,
    staleTime: 30 * 60 * 1000,
  });
  const companyId = clientCompanyId || companyLookup?.id || null;

  const { data, isLoading } = useQuery<{ open: PortfolioTask[]; done: PortfolioTask[] }>({
    queryKey: ["/api/company-portfolio", companyId, "tasks"],
    queryFn: async () => {
      const res = await fetch(`/api/company-portfolio/${companyId}/tasks`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return { open: [], done: [] };
      return res.json();
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const open = data?.open || [];
  const done = data?.done || [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <ClipboardList className="w-4 h-4" /> Portfolio activity — BGP team
        </h2>
        <p className="text-sm text-muted-foreground">
          What the BGP team is working on across the portfolio — and what's been done.
        </p>
      </div>

      <div className="border rounded-xl overflow-hidden">
        <div className="px-3 py-2 bg-muted/50 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
          <span>In progress</span><span>{open.length}</span>
        </div>
        <div className="divide-y">
          {open.map((t) => <TaskRow key={t.id} t={t} done={false} />)}
          {!open.length && !isLoading && (
            <div className="px-3 py-6 text-sm text-muted-foreground text-center">Nothing open right now.</div>
          )}
        </div>
      </div>

      <div className="border rounded-xl overflow-hidden">
        <div className="px-3 py-2 bg-muted/50 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
          <span>Done — last 60 days</span><span>{done.length}</span>
        </div>
        <div className="divide-y">
          {done.map((t) => <TaskRow key={t.id} t={t} done />)}
          {!done.length && !isLoading && (
            <div className="px-3 py-6 text-sm text-muted-foreground text-center">No completed tasks yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ClientTasksPage() {
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <PortfolioTasksBoard />
    </div>
  );
}
