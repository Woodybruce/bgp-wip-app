// Team Expenses — a read-only view of a whole team's card / cash spend for a
// designated "team overseer" (a non-admin team lead, e.g. Victoria for
// National Leasing). Backed by /api/expenses/team, which the server scopes to
// the team(s) the viewer oversees. Strictly view-only: no edit / approve /
// delete — those stay with the owner, the approvers and admins.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Receipt, Loader2, Users as UsersIcon } from "lucide-react";
import ReceiptViewer from "@/components/receipt-viewer";

interface TeamExpense {
  id: string;
  ownerName: string | null;
  merchant: string | null;
  amountPence: number;
  status: string;
  category: string | null;
  transactionDate: string | null;
  receiptFilename: string | null;
  isPersonal: boolean | null;
}
interface TeamExpensesResponse {
  teams: string[];
  expenses: TeamExpense[];
}

const fmt = (p: number) => `£${((p || 0) / 100).toFixed(2)}`;
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

function StatusBadge({ status, isPersonal }: { status: string; isPersonal: boolean | null }) {
  if (isPersonal) return <Badge variant="outline" className="text-amber-600 border-amber-600/30">Personal</Badge>;
  if (status === "posted_to_xero") return <Badge variant="outline" className="text-emerald-600 border-emerald-600/30">In Xero</Badge>;
  if (status === "pending_receipt") return <Badge variant="outline" className="text-amber-600 border-amber-600/30">Receipt needed</Badge>;
  if (status === "pending_approval") return <Badge variant="outline" className="text-blue-600 border-blue-600/30">Pending</Badge>;
  if (status === "approved") return <Badge variant="outline" className="text-blue-600 border-blue-600/30">Approved</Badge>;
  if (status === "rejected") return <Badge variant="outline" className="text-red-600 border-red-600/30">Rejected</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

const STATUS_LABELS: { key: string; label: string }[] = [
  { key: "pending_receipt", label: "Receipt needed" },
  { key: "pending_approval", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "posted_to_xero", label: "In Xero" },
  { key: "rejected", label: "Rejected" },
];

export default function TeamExpenses() {
  const { data, isLoading, error } = useQuery<TeamExpensesResponse>({
    queryKey: ["/api/expenses/team"],
  });
  const [personFilter, setPersonFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewing, setViewing] = useState<TeamExpense | null>(null);

  const expenses = data?.expenses || [];
  const teams = data?.teams || [];

  // People present in the data, for the person dropdown.
  const people = useMemo(() => {
    const s = new Set<string>();
    expenses.forEach((e) => { if (e.ownerName) s.add(e.ownerName); });
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [expenses]);

  const statusChips = useMemo(
    () => STATUS_LABELS
      .map((o) => ({ ...o, count: expenses.filter((e) => e.status === o.key).length }))
      .filter((o) => o.count > 0),
    [expenses],
  );

  const filtered = useMemo(
    () => expenses.filter((e) =>
      (personFilter === "all" || e.ownerName === personFilter) &&
      (statusFilter === "all" || e.status === statusFilter)),
    [expenses, personFilter, statusFilter],
  );

  const total = useMemo(() => filtered.reduce((sum, e) => sum + (e.amountPence || 0), 0), [filtered]);

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <UsersIcon className="w-5 h-5" />
              Team Expenses
              {teams.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {teams.map((t) => (
                    <Badge key={t} variant="secondary" className="font-normal">{t}</Badge>
                  ))}
                </span>
              )}
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? "expense" : "expenses"} · <span className="font-mono font-medium text-foreground">{fmt(total)}</span>
            </div>
          </div>

          {/* Read-only view — no edit / approve. Filters help a team lead
              zero in on one person or one status. */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {people.length > 1 && (
              <Select value={personFilter} onValueChange={setPersonFilter}>
                <SelectTrigger className="h-8 w-[200px] text-xs" data-testid="team-expenses-person">
                  <SelectValue placeholder="All people" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All people ({people.length})</SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {statusChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5" data-testid="team-expenses-status-filter">
                <button
                  onClick={() => setStatusFilter("all")}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:text-foreground"}`}
                >
                  All {expenses.length}
                </button>
                {statusChips.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setStatusFilter(statusFilter === s.key ? "all" : s.key)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === s.key ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:text-foreground"}`}
                  >
                    {s.label} {s.count}
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading team expenses…</span>
            </div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {(error as any)?.message?.includes("403") ? "You don't have access to a team's expenses." : "Couldn't load team expenses."}
            </div>
          ) : expenses.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No expenses for this team yet.</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nothing matches those filters. <button onClick={() => { setPersonFilter("all"); setStatusFilter("all"); }} className="text-primary hover:underline">Clear</button>
            </div>
          ) : (
            <>
              {/* Mobile: stacked cards — a 7-column table is unreadable on a
                  phone, so the same rows render as cards here. */}
              <div className="sm:hidden divide-y">
                {filtered.map((e) => (
                  <div key={e.id} className="px-4 py-3" data-testid={`team-expense-card-${e.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate">{e.ownerName || "—"}</span>
                      <span className="font-mono text-sm shrink-0">{fmt(e.amountPence)}</span>
                    </div>
                    <div className="text-[13px] text-muted-foreground truncate">{e.merchant || "—"}</div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
                      <span>{fmtDate(e.transactionDate)}</span>
                      {e.category && <><span>·</span><span className="truncate">{e.category}</span></>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-3">
                      <StatusBadge status={e.status} isPersonal={e.isPersonal} />
                      {e.receiptFilename && (
                        <button
                          onClick={() => setViewing(e)}
                          className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1 active:opacity-70"
                          data-testid={`team-expense-m-view-receipt-${e.id}`}
                        >
                          <Receipt className="w-3 h-3" /> Receipt
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop: full table. */}
              <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="text-left">
                    <th className="px-4 py-2 font-medium">Person</th>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Merchant</th>
                    <th className="px-4 py-2 font-medium text-right">Amount</th>
                    <th className="px-4 py-2 font-medium">Category</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium text-right">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr key={e.id} className="border-t hover:bg-muted/20" data-testid={`team-expense-${e.id}`}>
                      <td className="px-4 py-2 whitespace-nowrap font-medium">{e.ownerName || "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(e.transactionDate)}</td>
                      <td className="px-4 py-2">{e.merchant || "—"}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmt(e.amountPence)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{e.category || "—"}</td>
                      <td className="px-4 py-2"><StatusBadge status={e.status} isPersonal={e.isPersonal} /></td>
                      <td className="px-4 py-2 text-right">
                        {e.receiptFilename ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-emerald-700 dark:text-emerald-400"
                            onClick={() => setViewing(e)}
                            data-testid={`team-expense-view-receipt-${e.id}`}
                          >
                            <Receipt className="w-3 h-3 mr-1" /> View
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ReceiptViewer
        open={!!viewing}
        onClose={() => setViewing(null)}
        expenseId={viewing?.id || null}
        filename={viewing?.receiptFilename}
        title={viewing?.ownerName ? `${viewing.ownerName} — receipt` : "Receipt"}
      />
    </div>
  );
}
