import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard, Snowflake, CheckCircle2, AlertCircle, Plus, Pencil, RefreshCw, Loader2, Trash2, Eye, EyeOff, Copy, Check } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

  const { data: cardholders = [], isLoading: chLoading, refetch: refetchCh } = useQuery<Cardholder[]>({
    queryKey: ["/api/expenses/cardholders"],
  });

  const { data: expenses = [], isLoading: expLoading, refetch: refetchExp } = useQuery<ExpenseRow[]>({
    queryKey: ["/api/expenses"],
  });

  const { data: summary, refetch: refetchSummary } = useQuery<{
    totalMonthPence: number; totalMonthCount: number;
    pendingReceipts: number; pendingApproval: number; postedToXero: number; personalFlagged: number;
    cardholderCount: number; activeCards: number;
    byCardholder: Array<{ cardholderId: string; name: string; spentPence: number; monthlyLimit: number; utilisation: number; txCount: number; status: string }>;
    byCategory: Array<{ category: string; count: number; pence: number }>;
  }>({ queryKey: ["/api/expenses/admin/summary"] });

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
      toast({ title: "Limits updated", description: "Synced to Stripe" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Expenses & Cards</h1>
          <p className="text-sm text-muted-foreground">Stripe Issuing card programme — manage limits, freeze cards, review expenses</p>
        </div>
        <div className="flex gap-2">
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

      {summary && summary.byCardholder.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Spend by Cardholder (this month)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="text-left">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium text-right">Spent</th>
                    <th className="px-4 py-2 font-medium text-right">Limit</th>
                    <th className="px-4 py-2 font-medium text-right">Utilisation</th>
                    <th className="px-4 py-2 font-medium text-right">Transactions</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byCardholder.map(row => (
                    <tr key={row.cardholderId} className="border-t">
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
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Cardholders ({cardholders.length})
          </CardTitle>
        </CardHeader>
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
                    <th className="px-4 py-2 font-medium">Email</th>
                    <th className="px-4 py-2 font-medium">Phone</th>
                    <th className="px-4 py-2 font-medium text-right">Monthly</th>
                    <th className="px-4 py-2 font-medium text-right">Daily</th>
                    <th className="px-4 py-2 font-medium text-right">Per-tx</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cardholders.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-muted/20" data-testid={`cardholder-${c.id}`}>
                      <td className="px-4 py-2 font-medium">{c.userName}</td>
                      <td className="px-4 py-2 text-muted-foreground">{c.email}</td>
                      <td className="px-4 py-2 text-muted-foreground">{c.phone || "—"}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmtLimit(c.monthlyLimit)}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmtLimit(c.dailyLimit)}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmtLimit(c.singleTxLimit)}</td>
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
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Recent Expenses ({expenses.length})</CardTitle>
        </CardHeader>
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
                        {e.receiptFilename ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-amber-500" />}
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
