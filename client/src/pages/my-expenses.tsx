import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  CreditCard, Eye, EyeOff, Copy, Check, Upload, Receipt, AlertCircle,
  CheckCircle2, Loader2, RefreshCw, Sparkles,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Expense {
  id: string;
  merchant: string | null;
  amountPence: number;
  status: string;
  category: string | null;
  transactionDate: string | null;
  businessPurpose: string | null;
  receiptFilename: string | null;
  xeroExpenseId: string | null;
  isPersonal: boolean | null;
}
interface Cardholder {
  id: string; userName: string; email: string; phone: string | null;
  monthlyLimit: number; dailyLimit: number; singleTxLimit: number;
  status: "active" | "inactive";
}
interface MyData {
  cardholder: Cardholder | null;
  card: { id: string; last4: string; status: string } | null;
  expenses: Expense[];
  summary: {
    monthlySpendPence: number;
    monthlyLimitPence: number;
    remainingPence: number;
    pendingReceipts: number;
    totalThisMonth: number;
  } | null;
}

const fmt = (p: number) => `£${(p / 100).toFixed(2)}`;
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";

function StatusBadge({ status, isPersonal }: { status: string; isPersonal: boolean | null }) {
  if (isPersonal) return <Badge variant="outline" className="text-amber-600 border-amber-600/30">Personal</Badge>;
  if (status === "posted_to_xero") return <Badge variant="outline" className="text-emerald-600 border-emerald-600/30">In Xero</Badge>;
  if (status === "pending_receipt") return <Badge variant="outline" className="text-amber-600 border-amber-600/30">Receipt needed</Badge>;
  if (status === "pending_approval") return <Badge variant="outline" className="text-blue-600 border-blue-600/30">Pending</Badge>;
  if (status === "approved") return <Badge variant="outline" className="text-blue-600 border-blue-600/30">Approved</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export default function MyExpenses() {
  const { toast } = useToast();
  const [showCardDetails, setShowCardDetails] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, refetch } = useQuery<MyData>({
    queryKey: ["/api/expenses/me"],
  });

  const uploadMutation = useMutation({
    mutationFn: async (args: { id: string; file: File }) => {
      const fd = new FormData();
      fd.append("receipt", args.file);
      const r = await fetch(`/api/expenses/${args.id}/receipt`, { method: "POST", credentials: "include", body: fd });
      if (!r.ok) throw new Error((await r.json()).error || "Upload failed");
      return r.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/me"] });
      setUploadingFor(null);
      if (data.autoposted) {
        toast({ title: "Receipt processed", description: "Auto-posted to Xero." });
      } else if (data.parsed) {
        toast({ title: "Receipt processed", description: `${data.parsed.merchant || "Receipt"} — review and approve.` });
      } else {
        toast({ title: "Receipt saved", description: "Couldn't auto-parse — please add details manually." });
      }
    },
    onError: (e: any) => {
      setUploadingFor(null);
      toast({ title: "Upload failed", description: e?.message, variant: "destructive" });
    },
  });

  const markPersonalMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("PATCH", `/api/expenses/${id}/mark-personal`, {});
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/me"] });
      toast({ title: "Marked as personal", description: "Will be deducted from payroll." });
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  const handleFile = (id: string, file: File) => {
    setUploadingFor(id);
    uploadMutation.mutate({ id, file });
  };

  if (isLoading) {
    return <div className="container mx-auto p-6"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  if (!data?.cardholder) {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <Card>
          <CardContent className="p-8 text-center">
            <CreditCard className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <h2 className="text-lg font-semibold">No card issued</h2>
            <p className="text-sm text-muted-foreground mt-1">
              You don't have a BGP card yet. Ask Woody or Layla to issue one for you on the Expenses admin page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { cardholder, card, expenses, summary } = data;
  const utilisation = summary && summary.monthlyLimitPence > 0
    ? Math.min(100, Math.round((summary.monthlySpendPence / summary.monthlyLimitPence) * 100))
    : 0;

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Card & Expenses</h1>
          <p className="text-sm text-muted-foreground">{cardholder.userName} · {cardholder.email}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Card visual + summary */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="md:col-span-2 bg-gradient-to-br from-slate-900 to-slate-700 text-white border-0">
          <CardContent className="p-6 space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider opacity-70">BGP Virtual Card</div>
                <div className="text-xl font-semibold mt-1">{cardholder.userName}</div>
              </div>
              {card?.status === "active" ? (
                <Badge className="bg-emerald-500/20 text-emerald-200 border-emerald-400/30">Active</Badge>
              ) : (
                <Badge className="bg-amber-500/20 text-amber-200 border-amber-400/30">Frozen</Badge>
              )}
            </div>
            <div>
              <div className="font-mono text-2xl tracking-widest">•••• •••• •••• {card?.last4 || "0000"}</div>
              <div className="flex gap-6 mt-3 text-xs opacity-80">
                <div>MONTHLY LIMIT: {fmt(cardholder.monthlyLimit)}</div>
                <div>DAILY LIMIT: {fmt(cardholder.dailyLimit)}</div>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowCardDetails(true)}
                disabled={card?.status !== "active"}
              >
                <Eye className="w-4 h-4 mr-1.5" /> Show details
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowWallet(true)}>
                Add to Apple Wallet
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">This Month</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-2xl font-bold">{fmt(summary?.monthlySpendPence || 0)}</div>
              <div className="text-xs text-muted-foreground">of {fmt(summary?.monthlyLimitPence || 0)} limit</div>
            </div>
            <Progress value={utilisation} className="h-2" />
            <div className="text-xs text-muted-foreground">{fmt(summary?.remainingPence || 0)} remaining</div>
            {(summary?.pendingReceipts || 0) > 0 && (
              <div className="flex items-center gap-2 text-xs text-amber-600 pt-1 border-t">
                <AlertCircle className="w-3.5 h-3.5" />
                {summary?.pendingReceipts} receipt{summary?.pendingReceipts === 1 ? "" : "s"} needed
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* How it works */}
      <Card className="bg-blue-50/50 border-blue-200/50 dark:bg-blue-950/20 dark:border-blue-900/30">
        <CardContent className="p-4 flex gap-3 text-sm">
          <Sparkles className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <strong>How it works:</strong> Tap the card to pay (Apple Pay or online). You'll get a WhatsApp message —
            reply with a photo of the receipt. ChatBGP reads it and posts it to Xero automatically. No spreadsheets,
            no monthly review, no Wendy chasing you. Mark anything personal with one tap and it goes straight to payroll.
          </div>
        </CardContent>
      </Card>

      {/* Expenses table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            My Expenses ({expenses.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {expenses.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No expenses yet. Tap your card to make a purchase, or say "log £25 cash for taxi" in ChatBGP.
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
                    <th className="px-4 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(e.transactionDate)}</td>
                      <td className="px-4 py-2 font-medium">{e.merchant || "—"}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmt(e.amountPence)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{e.category || "—"}</td>
                      <td className="px-4 py-2"><StatusBadge status={e.status} isPersonal={e.isPersonal} /></td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {!e.receiptFilename && !e.isPersonal && e.status !== "posted_to_xero" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              disabled={uploadingFor === e.id}
                              onClick={() => {
                                if (fileInputRef.current) {
                                  fileInputRef.current.dataset.expenseId = e.id;
                                  fileInputRef.current.click();
                                }
                              }}
                            >
                              {uploadingFor === e.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
                              Receipt
                            </Button>
                          )}
                          {e.receiptFilename && (
                            <Badge variant="outline" className="text-xs">
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Receipt
                            </Badge>
                          )}
                          {!e.isPersonal && e.status !== "posted_to_xero" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-amber-600"
                              onClick={() => markPersonalMutation.mutate(e.id)}
                            >
                              Personal
                            </Button>
                          )}
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

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const id = e.target.dataset.expenseId;
          if (file && id) handleFile(id, file);
          e.target.value = "";
        }}
      />

      <CardDetailsDialog open={showCardDetails} onOpenChange={setShowCardDetails} />
      <AppleWalletDialog open={showWallet} onOpenChange={setShowWallet} onShowDetails={() => { setShowWallet(false); setShowCardDetails(true); }} />
    </div>
  );
}

function CardDetailsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{
    last4: string; brand: string; expMonth: number; expYear: number;
    number: string | null; cvc: string | null; isTestMode: boolean;
  }>({
    queryKey: ["/api/expenses/me/card-details"],
    enabled: open,
  });

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
    toast({ title: `${label} copied` });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setRevealed(false); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Card Details</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : data ? (
          <div className="space-y-4">
            {data.isTestMode && (
              <div className="text-xs p-2 rounded bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-900">
                Stripe test mode — these are not real card numbers.
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
      </DialogContent>
    </Dialog>
  );
}

function AppleWalletDialog({ open, onOpenChange, onShowDetails }: { open: boolean; onOpenChange: (v: boolean) => void; onShowDetails: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Apple Wallet</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            One-tap "Add to Wallet" needs a native iOS app (coming later). For now, add the card manually on your iPhone — it takes about 30 seconds.
          </p>
          <ol className="space-y-2 list-decimal pl-5">
            <li>Open the <strong>Wallet</strong> app on your iPhone</li>
            <li>Tap the <strong>+</strong> button (top-right)</li>
            <li>Choose <strong>Debit or Credit Card</strong></li>
            <li>Tap <strong>Enter Card Details Manually</strong></li>
            <li>Type the card number, expiry, and CVC from below</li>
            <li>Approve any verification prompt</li>
          </ol>
          <div className="text-xs p-2 rounded bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-900">
            <strong>Test mode:</strong> If the card is in Stripe test mode, Apple Wallet will reject it. Use the card number directly for online purchases until we go live.
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={onShowDetails}>Show card details</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
