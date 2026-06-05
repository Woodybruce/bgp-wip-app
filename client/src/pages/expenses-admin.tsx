import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard, Snowflake, CheckCircle2, AlertCircle, Plus, Pencil, RefreshCw, Loader2, Trash2, Eye, EyeOff, Copy, Check, Mail, ChevronRight } from "lucide-react";

// React doesn't accept fragments directly inside a <tbody> when each
// 'logical row' has TWO real <tr> children (the row itself + its expand
// row). This thin wrapper lets us return both without an outer element.
const FragmentRows: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;

// Compact status pill for the expandable per-cardholder drilldown.
// Named DrilldownStatusBadge because the file already has an
// ExpenseStatusBadge with a different signature used elsewhere.
function DrilldownStatusBadge({ status, isPersonal, hasReceipt, hasXero }: { status: string; isPersonal: boolean | null; hasReceipt: boolean; hasXero: boolean }) {
  if (isPersonal) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">Personal</span>;
  if (hasXero) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">In Xero</span>;
  if (status === "approved") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">Approved</span>;
  if (status === "pending_approval") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">Pending approval</span>;
  if (status === "pending_receipt") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">{hasReceipt ? "Receipt added" : "Receipt needed"}</span>;
  if (status === "rejected") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">Rejected</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{status}</span>;
}
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ExpensesNavTabs } from "@/components/expenses-nav-tabs";

interface Cardholder {
  id: string;
  userId: string;
  userName: string;
  email: string;
  phone: string | null;
  stripeCardholderId: string;
  monthlyLimit: number;   // pence
  dailyLimit: number;
  singleTxLimit: number;
  status: "active" | "inactive";
  createdAt: string;
  // Joined from stripe_cards on the server side so Cardholders can show
  // type + last 4 inline (the old Cards & Revolut tab is now folded in).
  card?: {
    last4: string | null;
    expiry: string | null;
    virtual: boolean | null;
    productCode: string | null;
    status: string;
  } | null;
}

interface ExpenseRow {
  id: string;
  cardholderId: string | null;
  merchant: string | null;
  amountPence: number;
  status: string;
  category: string | null;
  transactionDate: string | null;
  businessPurpose: string | null;
  attendees: string | null;
  receiptFilename: string | null;
  xeroExpenseId: string | null;
  isPersonal: boolean | null;
}

const fmt = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const fmtLimit = (pence: number) => `£${(pence / 100).toFixed(0)}`;

export default function ExpensesAdmin() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Cardholder | null>(null);
  const [viewingCard, setViewingCard] = useState<Cardholder | null>(null);
  // Spend by Cardholder rows are expandable — click to drill into the
  // cardholder's individual expenses for the period. Set to the
  // cardholder id of the open row (or null when collapsed).
  const [expandedCardholderId, setExpandedCardholderId] = useState<string | null>(null);

  const { data: cardholders = [], isLoading: chLoading, refetch: refetchCh } = useQuery<Cardholder[]>({
    queryKey: ["/api/expenses/cardholders"],
  });

  const { data: expenses = [], isLoading: expLoading, refetch: refetchExp } = useQuery<ExpenseRow[]>({
    queryKey: ["/api/expenses"],
  });

  // Range selector for the Analysis tab + the by-cardholder + by-category
  // aggregates. Default 'month' = current calendar month. Custom uses the
  // free-text from/to inputs (ISO date strings).
  type Range = "month" | "lastMonth" | "quarter" | "ytd" | "year";
  const [rangePreset, setRangePreset] = useState<Range>("month");

  const { from: rangeFrom, to: rangeTo, label: rangeLabel } = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfRollingYear = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    switch (rangePreset) {
      case "month":      return { from: startOfMonth, to: endOfMonth, label: "This month" };
      case "lastMonth":  return { from: startOfLastMonth, to: endOfLastMonth, label: "Last month" };
      case "quarter":    return { from: startOfQuarter, to: now, label: "This quarter" };
      case "ytd":        return { from: startOfYear, to: now, label: "Year to date" };
      case "year":       return { from: startOfRollingYear, to: now, label: "Last 12 months" };
    }
  }, [rangePreset]);

  const { data: summary, refetch: refetchSummary } = useQuery<{
    totalMonthPence: number; totalMonthCount: number;
    totalRangePence: number; totalRangeCount: number;
    pendingReceipts: number; pendingApproval: number; postedToXero: number; personalFlagged: number;
    cardholderCount: number; activeCards: number;
    byCardholder: Array<{ cardholderId: string; name: string; spentPence: number; monthlyLimit: number; utilisation: number; txCount: number; status: string }>;
    byCategory: Array<{ category: string; count: number; pence: number }>;
    byMonth: Array<{ month: string; count: number; pence: number }>;
    range: { from: string; to: string };
  }>({
    queryKey: ["/api/expenses/admin/summary", rangeFrom.toISOString(), rangeTo.toISOString()],
    queryFn: async () => {
      const url = `/api/expenses/admin/summary?from=${encodeURIComponent(rangeFrom.toISOString())}&to=${encodeURIComponent(rangeTo.toISOString())}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const freezeMutation = useMutation({
    mutationFn: async (args: { id: string; status: "active" | "inactive" }) => {
      const r = await apiRequest("PATCH", `/api/expenses/cardholders/${args.id}/status`, { status: args.status });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/cardholders"] });
      toast({ title: "Card status updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("DELETE", `/api/expenses/cardholders/${id}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/cardholders"] });
      toast({ title: "Cardholder removed" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e?.message, variant: "destructive" }),
  });

  const limitsMutation = useMutation({
    mutationFn: async (args: { id: string; monthlyLimit: number; dailyLimit: number; singleTxLimit: number }) => {
      const r = await apiRequest("PATCH", `/api/expenses/cardholders/${args.id}/limits`, args);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/cardholders"] });
      setEditing(null);
      toast({ title: "Limits updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });

  const [findingId, setFindingId] = useState<string | null>(null);
  const findReceiptMutation = useMutation({
    mutationFn: async (id: string) => {
      setFindingId(id);
      const r = await apiRequest("POST", `/api/expenses/${id}/find-email-receipt`);
      return r.json();
    },
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/admin/summary"] });
      if (d?.found) {
        toast({
          title: "Receipt found in email ✓",
          description: `Matched "${d.matched?.subject}" (£${((d.amountPence || 0) / 100).toFixed(2)}).${d.posted ? " Posted to Xero." : ""}`,
        });
      } else {
        toast({ title: "No matching receipt found", description: `Scanned ${d?.scanned ?? 0} emails around the purchase time — none matched the amount.` });
      }
    },
    onError: (e: any) => toast({ title: "Search failed", description: e?.message, variant: "destructive" }),
    onSettled: () => setFindingId(null),
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <ExpensesNavTabs />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">All expenses</h1>
          <p className="text-sm text-muted-foreground">Every card transaction, manual claim, and pending receipt across the firm.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                const r = await apiRequest("POST", "/api/expenses/admin/reset-self-approved");
                const d = await r.json();
                toast({
                  title: "Approval routing reset",
                  description: `${d.autoApprovedReset || 0} auto-approved rolled back, ${d.selfApproverCleared || 0} self-approver cleared.`,
                });
                refetchExp(); refetchSummary();
                queryClient.invalidateQueries({ queryKey: ["/api/expenses/pending-approval"] });
              } catch (e: any) {
                toast({ title: "Reset failed", description: e?.message, variant: "destructive" });
              }
            }}
            title="Roll back any expenses that were auto-approved or self-routed so Wendy/Layla can sign them off"
          >
            Send pending to Wendy
          </Button>
          <Button variant="outline" size="sm" onClick={() => { refetchCh(); refetchExp(); refetchSummary(); }}>
            <RefreshCw className="w-4 h-4 mr-1.5" />
            Refresh
          </Button>
          <CreateCardholderDialog open={showCreate} onOpenChange={setShowCreate} onCreated={() => refetchCh()} existingUserIds={cardholders.map(c => c.userId)} />
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryTile label="Spend this month" value={fmt(summary.totalMonthPence)} sub={`${summary.totalMonthCount} txs`} />
          <SummaryTile label="Active cards" value={`${summary.activeCards}`} sub={`of ${summary.cardholderCount} cardholders`} />
          <SummaryTile label="Receipts needed" value={`${summary.pendingReceipts}`} tone={summary.pendingReceipts > 0 ? "warn" : "ok"} />
          <SummaryTile label="Pending approval" value={`${summary.pendingApproval}`} tone={summary.pendingApproval > 0 ? "warn" : "ok"} />
          <SummaryTile label="Posted to Xero" value={`${summary.postedToXero}`} tone="ok" />
        </div>
      )}

      {/* Three tabs on one board (was three stacked cards). Same data,
          much tighter. Spend by Cardholder rows expand to the per-person
          drilldown so all three views are reachable without scrolling. */}
      <Card>
        <Tabs defaultValue="spend">
          <CardHeader className="pb-0 space-y-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <TabsList className="grid grid-cols-4 w-full max-w-2xl">
                <TabsTrigger value="spend">Spend by cardholder</TabsTrigger>
                <TabsTrigger value="cardholders">Cardholders ({cardholders.length})</TabsTrigger>
                <TabsTrigger value="recent">Recent ({expenses.length})</TabsTrigger>
                <TabsTrigger value="analysis">Analysis</TabsTrigger>
              </TabsList>
              {/* Date range — shared across Spend by cardholder + Analysis
                  tabs. 'This month' is the default so the existing tile
                  values don't shift. */}
              <Select value={rangePreset} onValueChange={(v) => setRangePreset(v as Range)}>
                <SelectTrigger className="h-8 w-[160px] text-xs" data-testid="expenses-range">
                  <SelectValue placeholder="Range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">This month</SelectItem>
                  <SelectItem value="lastMonth">Last month</SelectItem>
                  <SelectItem value="quarter">This quarter</SelectItem>
                  <SelectItem value="ytd">Year to date</SelectItem>
                  <SelectItem value="year">Last 12 months</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>

      <TabsContent value="spend" className="m-0">
        {summary && summary.byCardholder.length > 0 ? (
          <CardContent className="p-0">
            <p className="text-xs text-muted-foreground px-4 pt-3 pb-2">Click a row to see what each person bought, the category, and the approval state.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="text-left">
                    <th className="px-4 py-2 font-medium w-8"></th>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium text-right">Spent</th>
                    <th className="px-4 py-2 font-medium text-right">Limit</th>
                    <th className="px-4 py-2 font-medium text-right">Utilisation</th>
                    <th className="px-4 py-2 font-medium text-right">Transactions</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byCardholder.map(row => {
                    const isOpen = expandedCardholderId === row.cardholderId;
                    // Filter the already-loaded expenses list down to this
                    // cardholder for the current month — same window the
                    // summary uses, so the row counts always tally.
                    const startOfMonth = new Date();
                    startOfMonth.setDate(1);
                    startOfMonth.setHours(0, 0, 0, 0);
                    const myExpenses = expenses
                      .filter(e => e.cardholderId === row.cardholderId)
                      .filter(e => e.transactionDate && new Date(e.transactionDate) >= startOfMonth)
                      .sort((a, b) => (b.transactionDate || "").localeCompare(a.transactionDate || ""));
                    return (
                      <FragmentRows key={row.cardholderId}>
                        <tr
                          className={`border-t cursor-pointer hover:bg-muted/20 ${isOpen ? "bg-muted/30" : ""}`}
                          onClick={() => setExpandedCardholderId(isOpen ? null : row.cardholderId)}
                          data-testid={`spend-row-${row.cardholderId}`}
                        >
                          <td className="px-4 py-2 text-muted-foreground">
                            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                          </td>
                          <td className="px-4 py-2 font-medium">{row.name}</td>
                          <td className="px-4 py-2 text-right font-mono">{fmt(row.spentPence)}</td>
                          <td className="px-4 py-2 text-right font-mono text-muted-foreground">{fmtLimit(row.monthlyLimit)}</td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${row.utilisation > 90 ? "bg-red-500" : row.utilisation > 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                                  style={{ width: `${Math.min(100, row.utilisation)}%` }}
                                />
                              </div>
                              <span className="font-mono text-xs w-10">{row.utilisation}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right text-muted-foreground">{row.txCount}</td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-muted/10">
                            <td></td>
                            <td colSpan={5} className="px-4 py-3">
                              {myExpenses.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No expenses this month.</p>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                                      <th className="py-1 font-medium">Date</th>
                                      <th className="py-1 font-medium">Merchant</th>
                                      <th className="py-1 font-medium text-right">Amount</th>
                                      <th className="py-1 font-medium">Category</th>
                                      <th className="py-1 font-medium">Purpose / Attendees</th>
                                      <th className="py-1 font-medium">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {myExpenses.map(e => (
                                      <tr key={e.id} className="border-t border-border/40">
                                        <td className="py-1.5 text-muted-foreground whitespace-nowrap">
                                          {e.transactionDate ? new Date(e.transactionDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
                                        </td>
                                        <td className="py-1.5 font-medium">{e.merchant || "—"}</td>
                                        <td className="py-1.5 text-right font-mono">{fmt(e.amountPence)}</td>
                                        <td className="py-1.5 text-muted-foreground">{e.category || "—"}</td>
                                        <td className="py-1.5 text-muted-foreground max-w-[300px] truncate" title={[e.businessPurpose, e.attendees].filter(Boolean).join(" · ")}>
                                          {e.businessPurpose || e.attendees || "—"}
                                        </td>
                                        <td className="py-1.5">
                                          <DrilldownStatusBadge status={e.status} isPersonal={e.isPersonal} hasReceipt={!!e.receiptFilename} hasXero={!!e.xeroExpenseId} />
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </FragmentRows>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        ) : (
          <CardContent className="p-6 text-center text-sm text-muted-foreground">No spend yet this month.</CardContent>
        )}
      </TabsContent>

      <TabsContent value="cardholders" className="m-0">
        <CardContent className="p-0">
          {chLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading...</div>
          ) : cardholders.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No cardholders yet. Click "New Cardholder" to issue the first card.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="text-left">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Last 4</th>
                    <th className="px-4 py-2 font-medium">Email</th>
                    <th className="px-4 py-2 font-medium text-right">Monthly</th>
                    <th className="px-4 py-2 font-medium text-right">Daily</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cardholders.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-muted/20" data-testid={`cardholder-${c.id}`}>
                      <td className="px-4 py-2 font-medium">{c.userName}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {c.card?.virtual === false ? "Physical" : c.card?.virtual === true ? "Virtual" : "—"}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {c.card?.last4 ? `•••• ${c.card.last4}` : "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{c.email}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmtLimit(c.monthlyLimit)}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmtLimit(c.dailyLimit)}</td>
                      <td className="px-4 py-2">
                        {c.status === "active" ? (
                          <Badge variant="outline" className="text-emerald-600 border-emerald-600/30">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-600 border-amber-600/30">Frozen</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => setViewingCard(c)} data-testid={`view-card-${c.id}`} title="Show card details">
                            <Eye className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(c)} data-testid={`edit-${c.id}`}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            onClick={() => freezeMutation.mutate({ id: c.id, status: c.status === "active" ? "inactive" : "active" })}
                            data-testid={`freeze-${c.id}`}
                            title={c.status === "active" ? "Freeze card" : "Unfreeze card"}
                          >
                            <Snowflake className={`w-3 h-3 ${c.status === "inactive" ? "text-amber-600" : ""}`} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-red-600 hover:text-red-700"
                            onClick={() => {
                              if (confirm(`Remove ${c.userName} as cardholder?\n\nThis deletes the cardholder, card, and any expense rows from the BGP database. The Stripe card itself stays in Stripe — cancel it in the Stripe dashboard if needed.`)) {
                                deleteMutation.mutate(c.id);
                              }
                            }}
                            data-testid={`delete-${c.id}`}
                            title="Remove cardholder"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </TabsContent>

      <TabsContent value="recent" className="m-0">
        <CardContent className="p-0">
          {expLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading...</div>
          ) : expenses.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No expenses yet. They'll appear here as cards are tapped.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="text-left">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Merchant</th>
                    <th className="px-4 py-2 font-medium text-right">Amount</th>
                    <th className="px-4 py-2 font-medium">Category</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Receipt</th>
                    <th className="px-4 py-2 font-medium">Xero</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id} className="border-t hover:bg-muted/20" data-testid={`expense-${e.id}`}>
                      <td className="px-4 py-2 text-muted-foreground">
                        {e.transactionDate ? new Date(e.transactionDate).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-2 font-medium">{e.merchant || "—"}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmt(e.amountPence)}</td>
                      <td className="px-4 py-2 text-muted-foreground text-xs">
                        {e.category || (e.isPersonal ? <span className="text-amber-600">Personal</span> : "—")}
                      </td>
                      <td className="px-4 py-2">
                        <ExpenseStatusBadge status={e.status} />
                      </td>
                      <td className="px-4 py-2">
                        {e.receiptFilename ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            disabled={findingId === e.id}
                            onClick={() => findReceiptMutation.mutate(e.id)}
                            title="Search this person's email around the purchase time for a matching receipt"
                            data-testid={`find-receipt-${e.id}`}
                          >
                            {findingId === e.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                            Find in email
                          </Button>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {e.xeroExpenseId ? (
                          <span className="text-emerald-600 font-mono" title={e.xeroExpenseId}>Posted</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </TabsContent>

      <TabsContent value="analysis" className="m-0">
        <CardContent className="p-6 space-y-6">
          {!summary ? (
            <div className="py-12 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          ) : (
            <>
              {/* Headline numbers for the selected range. */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{rangeLabel} spend</div>
                  <div className="text-xl font-semibold mt-0.5">{fmt(summary.totalRangePence)}</div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Transactions</div>
                  <div className="text-xl font-semibold mt-0.5">{summary.totalRangeCount}</div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg per tx</div>
                  <div className="text-xl font-semibold mt-0.5">{summary.totalRangeCount > 0 ? fmt(Math.round(summary.totalRangePence / summary.totalRangeCount)) : "—"}</div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Personal flagged</div>
                  <div className="text-xl font-semibold mt-0.5">{summary.personalFlagged}</div>
                </div>
              </div>

              {/* Spend by category. Bar widths are proportional to the
                  biggest category — gives an at-a-glance read on which
                  buckets dominate without a charting library. */}
              <section>
                <h3 className="text-sm font-semibold mb-2">Spend by category</h3>
                {summary.byCategory.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No expenses in this range.</p>
                ) : (
                  <div className="space-y-1.5">
                    {summary.byCategory.map((c) => {
                      const max = summary.byCategory[0].pence;
                      const pct = max > 0 ? Math.round((c.pence / max) * 100) : 0;
                      return (
                        <div key={c.category} className="flex items-center gap-3 text-xs">
                          <div className="w-48 truncate">{c.category}</div>
                          <div className="flex-1 h-5 bg-muted rounded relative overflow-hidden">
                            <div className="absolute inset-y-0 left-0 bg-primary/70" style={{ width: `${pct}%` }} />
                            <div className="absolute inset-0 flex items-center px-2 text-[10px] text-foreground/80">{c.count} tx</div>
                          </div>
                          <div className="font-mono w-20 text-right">{fmt(c.pence)}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Spend over time — monthly bars across the range. Empty
                  months are folded out by the server, so 'This month' and
                  'Last month' presets show a single bar, while longer
                  ranges show a proper trend. */}
              <section>
                <h3 className="text-sm font-semibold mb-2">Spend over time</h3>
                {summary.byMonth.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No expenses in this range.</p>
                ) : (
                  <div className="flex items-end gap-2 h-32">
                    {summary.byMonth.map((m) => {
                      const max = Math.max(...summary.byMonth.map((x) => x.pence));
                      const heightPct = max > 0 ? Math.max(2, Math.round((m.pence / max) * 100)) : 2;
                      const [year, month] = m.month.split("-");
                      const label = new Date(Number(year), Number(month) - 1, 1).toLocaleString("en-GB", { month: "short", year: "2-digit" });
                      return (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-1 group" title={`${label}: ${fmt(m.pence)} (${m.count} tx)`}>
                          <div className="text-[9px] font-mono text-muted-foreground opacity-0 group-hover:opacity-100">{fmt(m.pence)}</div>
                          <div className="w-full bg-primary/60 rounded-t hover:bg-primary transition-colors" style={{ height: `${heightPct}%` }} />
                          <div className="text-[10px] text-muted-foreground whitespace-nowrap">{label}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* By cardholder — same data as the Spend by cardholder
                  tab but laid out as a flat ranking with bars. Useful
                  for the 'who spent what' question in one glance. */}
              <section>
                <h3 className="text-sm font-semibold mb-2">By cardholder</h3>
                {summary.byCardholder.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No spend in this range.</p>
                ) : (
                  <div className="space-y-1.5">
                    {summary.byCardholder.filter(c => c.spentPence > 0).map((c) => {
                      const max = summary.byCardholder[0].spentPence;
                      const pct = max > 0 ? Math.round((c.spentPence / max) * 100) : 0;
                      return (
                        <div key={c.cardholderId} className="flex items-center gap-3 text-xs">
                          <div className="w-40 truncate">{c.name}</div>
                          <div className="flex-1 h-5 bg-muted rounded relative overflow-hidden">
                            <div className="absolute inset-y-0 left-0 bg-emerald-500/70" style={{ width: `${pct}%` }} />
                            <div className="absolute inset-0 flex items-center px-2 text-[10px] text-foreground/80">{c.txCount} tx</div>
                          </div>
                          <div className="font-mono w-20 text-right">{fmt(c.spentPence)}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </CardContent>
      </TabsContent>
        </Tabs>
      </Card>

      {editing && (
        <EditLimitsDialog
          cardholder={editing}
          onClose={() => setEditing(null)}
          onSave={(monthly, daily, singleTx) =>
            limitsMutation.mutate({ id: editing.id, monthlyLimit: monthly, dailyLimit: daily, singleTxLimit: singleTx })
          }
          saving={limitsMutation.isPending}
        />
      )}
      {viewingCard && (
        <AdminCardDetailsDialog
          cardholder={viewingCard}
          onClose={() => setViewingCard(null)}
        />
      )}
    </div>
  );
}

function AdminCardDetailsDialog({ cardholder, onClose }: { cardholder: Cardholder; onClose: () => void }) {
  const { toast } = useToast();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{
    last4: string; brand: string; expMonth: number; expYear: number;
    number: string | null; cvc: string | null; isTestMode: boolean;
  }>({
    queryKey: [`/api/expenses/cardholders/${cardholder.id}/card-details`],
  });

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
    toast({ title: `${label} copied` });
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{cardholder.userName} — Card</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : data ? (
          <div className="space-y-4">
            {data.isTestMode && (
              <div className="text-xs p-2 rounded bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-900">
                Stripe test mode — these are not real card numbers. Use Stripe's test transaction simulator to generate activity.
              </div>
            )}
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Card Number</label>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 font-mono text-base bg-muted px-3 py-2 rounded">
                  {revealed && data.number ? data.number.match(/.{1,4}/g)?.join(" ") : `•••• •••• •••• ${data.last4}`}
                </code>
                <Button size="sm" variant="ghost" onClick={() => setRevealed(!revealed)}>
                  {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
                {revealed && data.number && (
                  <Button size="sm" variant="ghost" onClick={() => copy(data.number!, "Number")}>
                    {copied === "Number" ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Expiry</label>
                <code className="block font-mono text-base bg-muted px-3 py-2 rounded mt-1">
                  {String(data.expMonth).padStart(2, "0")} / {String(data.expYear).slice(-2)}
                </code>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider text-muted-foreground">CVC</label>
                <div className="flex items-center gap-1 mt-1">
                  <code className="flex-1 font-mono text-base bg-muted px-3 py-2 rounded">
                    {revealed && data.cvc ? data.cvc : "•••"}
                  </code>
                  {revealed && data.cvc && (
                    <Button size="sm" variant="ghost" onClick={() => copy(data.cvc!, "CVC")}>
                      {copied === "CVC" ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Failed to load card details.</div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending_receipt: { label: "Awaiting receipt", className: "text-amber-600 border-amber-600/30" },
    pending_approval: { label: "In review", className: "text-blue-600 border-blue-600/30" },
    approved: { label: "Approved", className: "text-emerald-600 border-emerald-600/30" },
    posted_to_xero: { label: "In Xero", className: "text-emerald-700 border-emerald-700/30" },
    rejected: { label: "Rejected", className: "text-red-600 border-red-600/30" },
  };
  const conf = map[status] || { label: status, className: "" };
  return <Badge variant="outline" className={conf.className}>{conf.label}</Badge>;
}

interface UserOption { id: string; name?: string; email?: string; firstName?: string; lastName?: string; phone?: string; }

function CreateCardholderDialog({ open, onOpenChange, onCreated, existingUserIds }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void; existingUserIds: string[] }) {
  const { toast } = useToast();
  const { data: users = [] } = useQuery<UserOption[]>({ queryKey: ["/api/users"] });
  const [selectedUserId, setSelectedUserId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [monthly, setMonthly] = useState(1000);
  const [daily, setDaily] = useState(250);
  const [singleTx, setSingleTx] = useState(250);

  const eligibleUsers = users.filter(u => !existingUserIds.includes(u.id));

  const handleUserSelect = (userId: string) => {
    setSelectedUserId(userId);
    const u = users.find(x => x.id === userId);
    if (u) {
      const display = u.name || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "";
      setName(display);
      setEmail(u.email || "");
      setPhone(u.phone || "");
    }
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/expenses/cardholders", {
        userId: selectedUserId,
        name, email, phone,
        monthlyLimit: monthly, dailyLimit: daily, singleTxLimit: singleTx,
      });
      return r.json();
    },
    onSuccess: () => {
      onOpenChange(false);
      onCreated();
      setSelectedUserId(""); setName(""); setEmail(""); setPhone("");
      toast({ title: "Cardholder created", description: "Virtual card issued in Stripe" });
    },
    onError: (e: any) => toast({ title: "Create failed", description: e?.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="button-new-cardholder">
          <Plus className="w-4 h-4 mr-1.5" />
          New Cardholder
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Cardholder</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="ch-user">Staff member</Label>
            <Select value={selectedUserId} onValueChange={handleUserSelect}>
              <SelectTrigger id="ch-user">
                <SelectValue placeholder="Select a staff member" />
              </SelectTrigger>
              <SelectContent>
                {eligibleUsers.length === 0 ? (
                  <SelectItem value="__none__" disabled>All users already have cards</SelectItem>
                ) : eligibleUsers.map(u => {
                  const display = u.name || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.id;
                  return <SelectItem key={u.id} value={u.id}>{display}{u.email ? ` — ${u.email}` : ""}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="ch-name">Full name</Label>
            <Input id="ch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam Smith" />
          </div>
          <div>
            <Label htmlFor="ch-email">Email</Label>
            <Input id="ch-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sam@bgpllp.co.uk" />
          </div>
          <div>
            <Label htmlFor="ch-phone">WhatsApp number — international format, e.g. +447700900000</Label>
            <Input id="ch-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+447700900000" />
          </div>
          <div className="grid grid-cols-3 gap-2 pt-2">
            <div>
              <Label htmlFor="ch-monthly" className="text-xs">Monthly £</Label>
              <Input id="ch-monthly" type="number" value={monthly} onChange={(e) => setMonthly(parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label htmlFor="ch-daily" className="text-xs">Daily £</Label>
              <Input id="ch-daily" type="number" value={daily} onChange={(e) => setDaily(parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label htmlFor="ch-tx" className="text-xs">Per-tx £</Label>
              <Input id="ch-tx" type="number" value={singleTx} onChange={(e) => setSingleTx(parseInt(e.target.value) || 0)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!selectedUserId || !name || !email || createMutation.isPending}>
            {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            Create + Issue Card
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditLimitsDialog({
  cardholder,
  onClose,
  onSave,
  saving,
}: {
  cardholder: Cardholder;
  onClose: () => void;
  onSave: (monthly: number, daily: number, singleTx: number) => void;
  saving: boolean;
}) {
  const [monthly, setMonthly] = useState(Math.round(cardholder.monthlyLimit / 100));
  const [daily, setDaily] = useState(Math.round(cardholder.dailyLimit / 100));
  const [singleTx, setSingleTx] = useState(Math.round(cardholder.singleTxLimit / 100));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit limits — {cardholder.userName}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3 py-3">
          <div>
            <Label htmlFor="el-monthly">Monthly £</Label>
            <Input id="el-monthly" type="number" value={monthly} onChange={(e) => setMonthly(parseInt(e.target.value) || 0)} />
          </div>
          <div>
            <Label htmlFor="el-daily">Daily £</Label>
            <Input id="el-daily" type="number" value={daily} onChange={(e) => setDaily(parseInt(e.target.value) || 0)} />
          </div>
          <div>
            <Label htmlFor="el-tx">Per-tx £</Label>
            <Input id="el-tx" type="number" value={singleTx} onChange={(e) => setSingleTx(parseInt(e.target.value) || 0)} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Changes sync to Stripe immediately.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(monthly, daily, singleTx)} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function SummaryTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" }) {
  const valueClass = tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-emerald-600" : "";
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${valueClass}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
