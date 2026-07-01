import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ToastAction } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  CreditCard, Eye, EyeOff, Copy, Check, Upload, Receipt, AlertCircle,
  CheckCircle2, Loader2, RefreshCw, Sparkles, Camera, ImagePlus, Pencil,
  Users as UsersIcon, Building2, Briefcase, X as XIcon, ChevronsUpDown, CalendarClock,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import ReceiptViewer from "@/components/receipt-viewer";

interface Expense {
  id: string;
  merchant: string | null;
  amountPence: number;
  status: string;
  category: string | null;
  transactionDate: string | null;
  businessPurpose: string | null;
  attendees: string | null;
  calendarEventId: string | null;
  relatedDealId: string | null;
  relatedPropertyId: string | null;
  receiptFilename: string | null;
  xeroExpenseId: string | null;
  isPersonal: boolean | null;
  rejectedReason?: string | null;
  attendeeContacts?: { id: string; name: string | null }[];
  // Card-feed rows carry the real charged amount — set when the row came
  // from Revolut / Stripe. Receipt-photo and cash claims leave both null,
  // and only those have an AI-parsed (therefore editable) amount.
  revolutTransactionId?: string | null;
  stripeTransactionId?: string | null;
}
interface NominalCode { code: string; name: string; }
interface CrmContact { id: string; name: string; email?: string | null; companyId?: string | null; }
interface CrmProperty { id: string; name: string; postcode?: string | null; }
interface CrmDeal { id: string; name: string; status?: string | null; }
interface Cardholder {
  id: string; userName: string; email: string; phone: string | null;
  monthlyLimit: number; dailyLimit: number; singleTxLimit: number;
  status: "active" | "inactive";
}
interface MyData {
  cardholder: Cardholder | null;
  card: { id: string; last4: string; status: string; expiry?: string | null; virtual?: boolean | null; productCode?: string | null } | null;
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
  if (status === "rejected") return <Badge variant="outline" className="text-red-600 border-red-600/30">Rejected</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export default function MyExpenses() {
  const { toast } = useToast();
  const [showCardDetails, setShowCardDetails] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<Expense | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ total: number; done: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<MyData>({
    queryKey: ["/api/expenses/me"],
    // Live updates — repoll every 60s while the page is open + on
    // window focus, matching the mobile My Card view. No manual
    // Refresh button needed.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
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
      return { id, body: await r.json() };
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/me"] });
      // Mis-tap is the common case — offer a one-click undo via the toast
      // action so the fix doesn't require opening Edit.
      toast({
        title: "Marked as personal",
        description: "Will be deducted from payroll.",
        action: (
          <ToastAction
            altText="Undo mark as personal"
            onClick={async () => {
              try {
                await apiRequest("PATCH", `/api/expenses/${id}`, { isPersonal: false });
                queryClient.invalidateQueries({ queryKey: ["/api/expenses/me"] });
                toast({ title: "Reverted to business expense" });
              } catch (e: any) {
                toast({ title: "Undo failed", description: e?.message, variant: "destructive" });
              }
            }}
          >
            Undo
          </ToastAction>
        ),
      });
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  // Resubmit a rejected expense after fixing it — flips it back to
  // pending_approval and re-routes to Wendy/Layla for a fresh look.
  const resubmitMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("POST", `/api/expenses/${id}/resubmit`, {});
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/me"] });
      toast({ title: "Resubmitted", description: "Sent back to Wendy & Layla for approval." });
    },
    onError: (e: any) => toast({ title: "Resubmit failed", description: e?.message, variant: "destructive" }),
  });

  const noReceiptMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("POST", `/api/expenses/${id}/no-receipt`, {});
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/me"] });
      toast({ title: "Submitted without receipt", description: "Sent to Wendy & Layla for review." });
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  const handleFile = (id: string, file: File) => {
    setUploadingFor(id);
    uploadMutation.mutate({ id, file });
  };

  // Bulk upload: server matches each file to a pending_receipt row by
  // amount + date, otherwise creates a cardless cash claim. Server takes
  // up to 20 files per request; we batch in slices of 20 if user drops
  // more.
  const bulkUploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const results: any[] = [];
      const chunkSize = 20;
      setBulkProgress({ total: files.length, done: 0 });
      for (let i = 0; i < files.length; i += chunkSize) {
        const chunk = files.slice(i, i + chunkSize);
        const fd = new FormData();
        for (const f of chunk) fd.append("receipts", f);
        const r = await fetch("/api/expenses/bulk-receipts", { method: "POST", credentials: "include", body: fd });
        if (!r.ok) throw new Error((await r.json()).error || "Bulk upload failed");
        const json = await r.json();
        results.push(...(json.results || []));
        setBulkProgress({ total: files.length, done: Math.min(i + chunk.length, files.length) });
      }
      return { results };
    },
    onSuccess: ({ results }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/me"] });
      setBulkProgress(null);
      const matched = results.filter((r: any) => r.outcome === "matched").length;
      const created = results.filter((r: any) => r.outcome === "created").length;
      const failed = results.filter((r: any) => r.outcome === "failed").length;
      const duplicates = results.filter((r: any) => r.outcome === "duplicate").length;
      const parts = [
        matched > 0 ? `${matched} matched to card spend` : null,
        created > 0 ? `${created} new cash claim${created === 1 ? "" : "s"}` : null,
        duplicates > 0 ? `${duplicates} duplicate skip` : null,
        failed > 0 ? `${failed} failed` : null,
      ].filter(Boolean);
      toast({
        title: "Receipts processed",
        description: parts.join(" · "),
        variant: failed > 0 ? "destructive" : "default",
      });
    },
    onError: (e: any) => {
      setBulkProgress(null);
      toast({ title: "Upload failed", description: e?.message, variant: "destructive" });
    },
  });

  const onBulkFiles = (files: FileList | File[] | null | undefined) => {
    if (!files) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    bulkUploadMutation.mutate(arr);
  };

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    onBulkFiles(e.dataTransfer?.files);
  }, []);

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
      </div>

      {/* Card visual + summary */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="md:col-span-2 bg-gradient-to-br from-slate-900 to-slate-700 text-white border-0">
          <CardContent className="p-6 space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider opacity-70">BGP {card?.virtual === false ? "Physical" : "Virtual"} Card</div>
                <div className="text-xl font-semibold mt-1">{cardholder.userName}</div>
              </div>
              {/* Status comes from the cardholder, not a Stripe card row —
                  Revolut cardholders have no stripe_cards record, so keying
                  off card?.status falsely showed every Revolut card as
                  "Frozen". cardholder.status is the source of truth. */}
              {cardholder.status === "active" ? (
                <Badge className="bg-emerald-500/20 text-emerald-200 border-emerald-400/30">Active</Badge>
              ) : (
                <Badge className="bg-amber-500/20 text-amber-200 border-amber-400/30">Frozen</Badge>
              )}
            </div>
            <div>
              <div className="font-mono text-2xl tracking-widest">•••• •••• •••• {card?.last4 || "0000"}</div>
              <div className="flex gap-6 mt-3 text-xs opacity-80">
                {card?.expiry && (
                  <div>EXPIRES: {card.expiry}</div>
                )}
                <div>MONTHLY: {fmt(cardholder.monthlyLimit)}</div>
                <div>DAILY: {fmt(cardholder.dailyLimit)}</div>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowCardDetails(true)}
                disabled={cardholder.status !== "active"}
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

      {/* Bulk receipt dropzone — desktop drag-drop, phone gallery/camera */}
      <Card
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
        onDrop={onDrop}
        className={`border-dashed border-2 transition-colors ${dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/20"}`}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <ImagePlus className={`w-5 h-5 shrink-0 ${dragActive ? "text-primary" : "text-muted-foreground"}`} />
            <div className="text-sm flex-1 min-w-[200px]">
              <div className="font-medium">Drop receipts here, or pick from your device</div>
              <div className="text-xs text-muted-foreground">
                Each file gets matched to a pending card transaction by amount + date. No match → logged as a cash claim.
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => bulkInputRef.current?.click()}
              disabled={bulkUploadMutation.isPending}
              data-testid="button-upload-receipts"
            >
              {bulkUploadMutation.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}
              Choose files
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="md:hidden"
              onClick={() => cameraInputRef.current?.click()}
              disabled={bulkUploadMutation.isPending}
              data-testid="button-camera-receipt"
            >
              <Camera className="w-4 h-4 mr-1.5" />
              Camera
            </Button>
          </div>
          {bulkProgress && (
            <div className="mt-3 space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Processing receipts…</span>
                <span>{bulkProgress.done} / {bulkProgress.total}</span>
              </div>
              <Progress value={(bulkProgress.done / bulkProgress.total) * 100} className="h-1.5" />
            </div>
          )}
        </CardContent>
      </Card>

      <input
        ref={bulkInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => { onBulkFiles(e.target.files); e.target.value = ""; }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => { onBulkFiles(e.target.files); e.target.value = ""; }}
      />

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
                      <td className="px-4 py-2 font-medium">
                        {e.merchant || "—"}
                        {e.calendarEventId && e.businessPurpose && (
                          <div className="flex items-start gap-1 mt-0.5 text-[11px] font-normal text-emerald-600" title="Auto-matched to a diary event">
                            <CalendarClock className="w-3 h-3 mt-0.5 shrink-0" />
                            <span>
                              matched: {e.businessPurpose}
                              {e.attendees ? <span className="text-muted-foreground"> · {e.attendees}</span> : null}
                            </span>
                          </div>
                        )}
                        {e.status === "rejected" && e.rejectedReason && (
                          <div className="flex items-start gap-1 mt-0.5 text-[11px] font-normal text-red-600" title="Rejected by approver">
                            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                            <span>Rejected: {e.rejectedReason}</span>
                          </div>
                        )}
                      </td>
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
                          {e.status === "pending_receipt" && !e.isPersonal && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-muted-foreground"
                              disabled={noReceiptMutation.isPending && noReceiptMutation.variables === e.id}
                              onClick={() => noReceiptMutation.mutate(e.id)}
                              data-testid={`button-no-receipt-${e.id}`}
                            >
                              {noReceiptMutation.isPending && noReceiptMutation.variables === e.id
                                ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                : <XIcon className="w-3 h-3 mr-1" />}
                              No receipt
                            </Button>
                          )}
                          {e.receiptFilename && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-emerald-700 dark:text-emerald-400"
                              onClick={() => setViewingReceipt(e)}
                              data-testid={`button-view-receipt-${e.id}`}
                            >
                              <Receipt className="w-3 h-3 mr-1" /> Receipt
                            </Button>
                          )}
                          {e.status !== "posted_to_xero" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => setEditing(e)}
                              data-testid={`button-edit-expense-${e.id}`}
                            >
                              <Pencil className="w-3 h-3 mr-1" />
                              Edit
                            </Button>
                          )}
                          {e.status === "rejected" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-blue-600"
                              disabled={resubmitMutation.isPending && resubmitMutation.variables === e.id}
                              onClick={() => resubmitMutation.mutate(e.id)}
                              data-testid={`button-resubmit-${e.id}`}
                            >
                              {resubmitMutation.isPending && resubmitMutation.variables === e.id
                                ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                : <RefreshCw className="w-3 h-3 mr-1" />}
                              Resubmit
                            </Button>
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
      <EditExpenseDialog
        expense={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); queryClient.invalidateQueries({ queryKey: ["/api/expenses/me"] }); }}
      />

      <ReceiptViewer
        open={!!viewingReceipt}
        onClose={() => setViewingReceipt(null)}
        expenseId={viewingReceipt?.id ?? null}
        title={viewingReceipt ? `${viewingReceipt.merchant || "Receipt"} · ${fmt(viewingReceipt.amountPence)}` : "Receipt"}
        filename={viewingReceipt?.receiptFilename}
      />
    </div>
  );
}

// Entertainment categories — when one of these is picked, the dialog
// surfaces a "this is going to need attendees + a property/deal link
// for HMRC" hint. Same set the server uses for flag computation.
const ENTERTAINMENT_CATEGORIES = new Set([
  "Client Entertainment",
  "Agent Entertainment (External)",
  "Staff Entertainment",
  "Directors Meetings",
  "Meals & Drinks",
]);

function EditExpenseDialog({ expense, onClose, onSaved }: { expense: Expense | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const open = !!expense;

  const { data: nominalCodes = [] } = useQuery<NominalCode[]>({
    queryKey: ["/api/expenses/nominal-codes"],
    enabled: open,
  });
  const { data: contacts = [] } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
    enabled: open,
  });
  const { data: properties = [] } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
    enabled: open,
  });
  const { data: deals = [] } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/deals"],
    enabled: open,
  });

  const [merchant, setMerchant] = useState("");
  const [transactionDate, setTransactionDate] = useState("");
  const [category, setCategory] = useState("");
  const [amountPounds, setAmountPounds] = useState("");     // editable only on non-card (AI-parsed) rows
  const [businessPurpose, setBusinessPurpose] = useState("");
  const [attendeesText, setAttendeesText] = useState("");   // free-text attendees (e.g. auto-filled from calendar)
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [relatedPropertyId, setRelatedPropertyId] = useState<string | null>(null);
  const [relatedDealId, setRelatedDealId] = useState<string | null>(null);
  const [isPersonal, setIsPersonal] = useState(false);
  const [aiNote, setAiNote] = useState("");                 // "what did the AI get wrong?" — re-read hint + lesson
  // What the row held when the dialog opened — diffed on save so we only
  // teach the parser about fields the human actually changed.
  const original = useRef({ merchant: "", category: "", date: "", amountPence: 0 });

  // Re-seed the form whenever a new expense opens.
  useEffect(() => {
    if (!expense) return;
    setMerchant(expense.merchant || "");
    setTransactionDate(expense.transactionDate ? expense.transactionDate.slice(0, 10) : "");
    setCategory(expense.category || "");
    setAmountPounds((expense.amountPence / 100).toFixed(2));
    setBusinessPurpose(expense.businessPurpose || "");
    setAttendeesText(expense.attendees || "");
    setAttendeeIds((expense.attendeeContacts || []).map(c => c.id));
    setRelatedPropertyId(expense.relatedPropertyId || null);
    setRelatedDealId(expense.relatedDealId || null);
    setIsPersonal(!!expense.isPersonal);
    setAiNote("");
    original.current = {
      merchant: expense.merchant || "",
      category: expense.category || "",
      date: expense.transactionDate ? expense.transactionDate.slice(0, 10) : "",
      amountPence: expense.amountPence,
    };
  }, [expense?.id]);

  const showEntertainmentFields = ENTERTAINMENT_CATEGORIES.has(category);
  const contactById = useMemo(() => new Map(contacts.map(c => [c.id, c])), [contacts]);

  const isCard = !!(expense?.revolutTransactionId || expense?.stripeTransactionId);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!expense) throw new Error("No expense");
      const parsedAmount = Math.round(parseFloat(amountPounds) * 100);
      const amountPence = Number.isFinite(parsedAmount) && parsedAmount >= 0 ? parsedAmount : original.current.amountPence;

      const payload: Record<string, unknown> = {
        merchant: merchant || null,
        transactionDate: transactionDate ? new Date(transactionDate).toISOString() : null,
        category: category || null,
        businessPurpose: businessPurpose || null,
        attendees: attendeesText.trim() || null,
        relatedPropertyId: relatedPropertyId || null,
        relatedDealId: relatedDealId || null,
        isPersonal,
      };
      // Amount is editable only on non-card rows (the server rejects it on
      // the card feed regardless), and only sent when it actually changed.
      if (!isCard && amountPence !== original.current.amountPence) payload.amountPence = amountPence;

      await apiRequest("PATCH", `/api/expenses/${expense.id}`, payload);
      await apiRequest("PUT", `/api/expenses/${expense.id}/attendees`, { contactIds: attendeeIds });

      // Teach the parser: record only the fields the human changed, plus any
      // free-text lesson typed into the "what did it get wrong?" box.
      const changes: { field: string; from: string | null; to: string | null }[] = [];
      if ((merchant || "") !== original.current.merchant) changes.push({ field: "merchant", from: original.current.merchant || null, to: merchant || null });
      if ((category || "") !== original.current.category) changes.push({ field: "category", from: original.current.category || null, to: category || null });
      if ((transactionDate || "") !== original.current.date) changes.push({ field: "date", from: original.current.date || null, to: transactionDate || null });
      if (!isCard && amountPence !== original.current.amountPence) changes.push({ field: "amount", from: (original.current.amountPence / 100).toFixed(2), to: (amountPence / 100).toFixed(2) });
      if (changes.length > 0 || aiNote.trim()) {
        try {
          await apiRequest("POST", `/api/expenses/${expense.id}/receipt-correction`, {
            merchant: merchant || original.current.merchant || null,
            changes,
            note: aiNote.trim() || null,
          });
        } catch { /* learning is best-effort — must not fail the save */ }
      }
    },
    onSuccess: () => {
      toast({ title: "Expense updated" });
      onSaved();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });

  // Re-read the receipt with the user's correction as a hint. Fills the form
  // with the fresh parse; the user then Saves to confirm (and teach) it.
  const reparseMutation = useMutation({
    mutationFn: async () => {
      if (!expense) throw new Error("No expense");
      const r = await apiRequest("POST", `/api/expenses/${expense.id}/reparse`, { hint: aiNote.trim() || undefined });
      const body = await r.json();
      return body.parsed as { merchant?: string; totalPence?: number; date?: string; category?: string; confidence?: string } | null;
    },
    onSuccess: (parsed) => {
      if (!parsed) { toast({ title: "Couldn't re-read the receipt", variant: "destructive" }); return; }
      if (parsed.merchant) setMerchant(parsed.merchant);
      if (parsed.category) setCategory(parsed.category);
      if (parsed.date) setTransactionDate(parsed.date.slice(0, 10));
      if (!isCard && typeof parsed.totalPence === "number" && parsed.totalPence > 0) setAmountPounds((parsed.totalPence / 100).toFixed(2));
      toast({ title: "Re-read the receipt", description: "Check the fields, then Save to confirm and teach it." });
    },
    onError: (e: any) => toast({ title: "Re-read failed", description: e?.message, variant: "destructive" }),
  });

  if (!expense) return null;
  const isPosted = !!expense.xeroExpenseId;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit expense</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* Amount — editable on receipt/cash rows (AI-parsed); read-only on
              the card feed, where it's the real charged figure. */}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label htmlFor="exp-amount" className="text-xs">Amount (£)</Label>
              {isCard ? (
                <div className="font-mono font-medium text-sm py-2">
                  {fmt(expense.amountPence)}
                  <span className="ml-2 text-[10px] text-muted-foreground font-sans">from card feed — fixed</span>
                </div>
              ) : (
                <Input
                  id="exp-amount"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={amountPounds}
                  onChange={(e) => setAmountPounds(e.target.value)}
                  disabled={isPosted}
                  data-testid="input-expense-amount"
                />
              )}
            </div>
            {isPosted && <span className="text-[11px] text-emerald-600 pb-2.5">Posted to Xero — cannot edit core fields</span>}
          </div>

          {/* Receipt AI — tell it what it got wrong. Fix the fields by hand,
              or type the correction and hit Re-read for another AI pass.
              Saving teaches it (merchant→category memory + the note). */}
          {expense.receiptFilename && (
            <div className="rounded-lg border border-violet-200 dark:border-violet-900/40 bg-violet-50/50 dark:bg-violet-950/20 px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                <span className="text-xs font-medium">Receipt AI got something wrong?</span>
              </div>
              <Textarea
                value={aiNote}
                onChange={(e) => setAiNote(e.target.value)}
                placeholder="Tell it what's wrong — e.g. 'the total is £68.50 not £6.85', or 'receipts here are always Subsistence, not Meals'. It'll remember for next time."
                rows={2}
                className="text-xs bg-background"
                data-testid="input-ai-correction"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-muted-foreground">Fix the fields below by hand, or let the AI re-read with your note.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs shrink-0"
                  onClick={() => reparseMutation.mutate()}
                  disabled={reparseMutation.isPending}
                  data-testid="button-reparse-receipt"
                >
                  {reparseMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                  Re-read
                </Button>
              </div>
            </div>
          )}

          {/* Personal/business toggle — lets you undo an accidental "Personal" tag. */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
            <div>
              <Label htmlFor="exp-is-personal" className="text-sm font-medium">Personal expense</Label>
              <p className="text-[11px] text-muted-foreground">On = deducted from payroll. Off = business expense, goes to Xero.</p>
            </div>
            <Switch
              id="exp-is-personal"
              checked={isPersonal}
              onCheckedChange={setIsPersonal}
              disabled={isPosted}
              data-testid="toggle-expense-personal"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="exp-merchant" className="text-xs">Merchant</Label>
              <Input id="exp-merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} disabled={isPosted} placeholder="e.g. Quo Vadis" data-testid="input-expense-merchant" />
            </div>
            <div>
              <Label htmlFor="exp-date" className="text-xs">Transaction date</Label>
              <Input id="exp-date" type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} disabled={isPosted} data-testid="input-expense-date" />
            </div>
          </div>

          <div>
            <Label htmlFor="exp-category" className="text-xs">Category (Xero nominal)</Label>
            <Select value={category} onValueChange={setCategory} disabled={isPosted}>
              <SelectTrigger id="exp-category" data-testid="select-expense-category">
                <SelectValue placeholder="Pick a category…" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {nominalCodes.map((c) => (
                  <SelectItem key={c.code} value={c.name}>
                    <span className="text-muted-foreground mr-2 font-mono text-[10px]">{c.code}</span>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="exp-purpose" className="text-xs">Business purpose</Label>
            <Textarea
              id="exp-purpose"
              value={businessPurpose}
              onChange={(e) => setBusinessPurpose(e.target.value)}
              placeholder="What was this for? (e.g. 'Pitch dinner with John Smith from BlackRock — Bond St freehold deal')"
              rows={3}
              data-testid="input-expense-purpose"
            />
            {showEntertainmentFields && (
              <p className="text-[10px] text-amber-600 mt-1">
                HMRC needs purpose + attendees for entertainment to be deductible — fill both in.
              </p>
            )}
          </div>

          {/* Free-text attendees — auto-filled from the calendar match at
              swipe time. Editable so a wrong/auto-pulled name can be removed
              (the "can't see where to delete it" problem). Only shown when
              there's something there to avoid cluttering manual entries. */}
          {attendeesText.trim().length > 0 && (
            <div>
              <Label htmlFor="exp-attendees-text" className="text-xs flex items-center gap-1.5">
                <UsersIcon className="w-3 h-3" /> Attendees note (auto-filled from calendar)
              </Label>
              <Input
                id="exp-attendees-text"
                value={attendeesText}
                onChange={(e) => setAttendeesText(e.target.value)}
                placeholder="Edit or clear — e.g. if the wrong meeting was matched"
                data-testid="input-expense-attendees-text"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Clear this box and save to remove an incorrectly-matched meeting's attendees.</p>
            </div>
          )}

          {/* Attendees — multi-pick from crm_contacts. Shown for all
              categories (still useful for staff entertainment + meals),
              but enforced as a flag only on entertainment. */}
          <div>
            <Label className="text-xs flex items-center gap-1.5"><UsersIcon className="w-3 h-3" /> Attendees</Label>
            <ContactMultiPicker
              contacts={contacts}
              selected={attendeeIds}
              onChange={setAttendeeIds}
            />
            {attendeeIds.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {attendeeIds.map((id) => {
                  const c = contactById.get(id);
                  return (
                    <Badge key={id} variant="secondary" className="text-[10px] gap-1 pl-2 pr-1">
                      {c?.name || id.slice(0, 8)}
                      <button
                        type="button"
                        className="hover:text-red-500"
                        onClick={() => setAttendeeIds(attendeeIds.filter(x => x !== id))}
                        data-testid={`button-remove-attendee-${id}`}
                      >
                        <XIcon className="w-3 h-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          {/* Property + Deal link — both optional. Useful for filtering
              the expenses report by deal / property at year end. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs flex items-center gap-1.5"><Building2 className="w-3 h-3" /> Property</Label>
              <SearchableCombobox
                items={properties.map(p => ({ value: p.id, label: p.name, sub: p.postcode || undefined }))}
                value={relatedPropertyId}
                onChange={setRelatedPropertyId}
                placeholder="Optional — pick a property"
                testId="combobox-expense-property"
              />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1.5"><Briefcase className="w-3 h-3" /> Deal</Label>
              <SearchableCombobox
                items={deals.map(d => ({ value: d.id, label: d.name, sub: d.status || undefined }))}
                value={relatedDealId}
                onChange={setRelatedDealId}
                placeholder="Optional — pick a deal"
                testId="combobox-expense-deal"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            data-testid="button-save-expense"
          >
            {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Searchable single-select combobox for property + deal pickers.
// Keeps the dialog self-contained — the existing property-combobox
// component carries Google Places autocomplete which isn't needed here.
function SearchableCombobox({
  items: rawItems, value, onChange, placeholder, testId,
}: {
  items: { value: string; label: string; sub?: string }[];
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  // Defensive alphabetical sort — particularly important here because
  // the deal picker call site receives /api/crm/deals output which the
  // server returns in updatedAt DESC, not name.
  const items = useMemo(
    () => [...rawItems].sort((a, b) => a.label.localeCompare(b.label, "en-GB", { sensitivity: "base" })),
    [rawItems],
  );
  const current = value ? items.find(i => i.value === value) : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal" data-testid={testId}>
          <span className="truncate">{current?.label || placeholder || "—"}</span>
          <ChevronsUpDown className="w-3.5 h-3.5 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command>
          <CommandInput placeholder="Search…" />
          <CommandList>
            <CommandEmpty>None found.</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  onSelect={() => { onChange(null); setOpen(false); }}
                  className="text-muted-foreground"
                >
                  <XIcon className="w-3.5 h-3.5 mr-2" /> Clear selection
                </CommandItem>
              )}
              {items.slice(0, 200).map((i) => (
                <CommandItem
                  key={i.value}
                  value={`${i.label} ${i.sub || ""}`}
                  onSelect={() => { onChange(i.value); setOpen(false); }}
                >
                  <Check className={`w-3.5 h-3.5 mr-2 ${value === i.value ? "opacity-100" : "opacity-0"}`} />
                  <div className="flex flex-col">
                    <span>{i.label}</span>
                    {i.sub && <span className="text-[10px] text-muted-foreground">{i.sub}</span>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Multi-pick contact picker. Always-on inline command so adding several
// attendees in sequence is cheap (no dropdown re-open per addition).
function ContactMultiPicker({
  contacts: rawContacts, selected, onChange,
}: {
  contacts: CrmContact[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  // Defensive alphabetical sort. Filter applied after sort so the visible
  // 200-row cap doesn't truncate late-alphabet names from the searchable set.
  const contacts = useMemo(
    () => [...rawContacts].sort((a, b) => (a.name || "").localeCompare(b.name || "", "en-GB", { sensitivity: "base" })),
    [rawContacts],
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal" data-testid="button-add-attendee">
          <span className="text-muted-foreground">
            {selected.length === 0 ? "Add attendee from CRM…" : `${selected.length} added — click to add more`}
          </span>
          <ChevronsUpDown className="w-3.5 h-3.5 opacity-50 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command>
          <CommandInput placeholder="Search contacts…" />
          <CommandList>
            <CommandEmpty>No contacts found.</CommandEmpty>
            <CommandGroup>
              {contacts.slice(0, 200).map((c) => {
                const isSelected = selected.includes(c.id);
                return (
                  <CommandItem
                    key={c.id}
                    value={`${c.name} ${c.email || ""}`}
                    onSelect={() => {
                      onChange(isSelected ? selected.filter(x => x !== c.id) : [...selected, c.id]);
                    }}
                    data-testid={`option-attendee-${c.id}`}
                  >
                    <Check className={`w-3.5 h-3.5 mr-2 ${isSelected ? "opacity-100" : "opacity-0"}`} />
                    <div className="flex flex-col">
                      <span>{c.name}</span>
                      {c.email && <span className="text-[10px] text-muted-foreground">{c.email}</span>}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CardDetailsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{
    last4: string; brand: string; expMonth: number; expYear: number;
    number: string | null; cvc: string | null; isTestMode: boolean;
    revolut?: boolean; message?: string;
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
        ) : data?.revolut ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              {data.message || "Card details are managed in the Revolut app."}
            </p>
            <ol className="space-y-1.5 list-decimal pl-5 text-muted-foreground">
              <li>Open the <strong>Revolut</strong> app</li>
              <li>Go to the <strong>Cards</strong> tab</li>
              <li>Tap your BGP card to view the number, expiry and CVC</li>
            </ol>
          </div>
        ) : data ? (
          <div className="space-y-4">
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

function AppleWalletDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void; onShowDetails: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Apple Wallet</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Apple Wallet provisioning needs iOS-native PassKit + an issuer-certified flow that's only built into the Revolut iOS app — no web app can add a card on your behalf. Add it once via Revolut on your phone; spend then still flows back to BGP via the webhook.
          </p>
          <ol className="space-y-2 list-decimal pl-5">
            <li>Open the <strong>Revolut</strong> app on your iPhone</li>
            <li>Go to the <strong>Cards</strong> tab</li>
            <li>Tap your <strong>BGP</strong> card</li>
            <li>Tap <strong>Add to Apple Wallet</strong></li>
          </ol>
          <p className="text-xs text-muted-foreground">
            Once added, Apple Pay works in Safari and any app — and the spend still flows back to BGP automatically via the Revolut webhook.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
