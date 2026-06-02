// ─────────────────────────────────────────────────────────────────────────
// Mobile expenses — full receipt-to-Xero workflow on phone.
//
// Replaces the desktop-only EditExpenseDialog. Designed for one-handed
// use in the back of a cab on the way home from dinner:
//
//   List view ────────────────
//     Pending receipts: big card per row, Snap button → camera
//     Recent: compact rows, tap to edit
//
//   Tap a row ────────────────
//     Slides up a full-screen Sheet:
//       • Merchant + date (text + date input)
//       • Category — single-select scrolling chip list of nominals
//       • Business purpose — textarea
//       • Attendees — typeahead + chip stack (entertainment categories only)
//       • Related deal — typeahead picker
//       • Related property — typeahead picker
//       • Mark as personal
//       • Save
//
// All endpoints identical to the desktop page (/api/expenses/me, PATCH
// /api/expenses/:id, PUT /api/expenses/:id/attendees, POST /api/expenses/
// :id/receipt) so the server doesn't care which surface edited.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useRef, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Camera, Receipt, CheckCircle2, AlertCircle, Loader2, ChevronLeft,
  X, Search, Tag, Users, Building2, Briefcase, UserX, Save,
} from "lucide-react";
import { Link } from "wouter";

interface Expense {
  id: string;
  merchant: string | null;
  amountPence: number;
  status: string;
  category: string | null;
  transactionDate: string | null;
  businessPurpose: string | null;
  attendees: string | null;
  relatedDealId: string | null;
  relatedPropertyId: string | null;
  receiptFilename: string | null;
  xeroExpenseId: string | null;
  isPersonal: boolean | null;
  attendeeContacts?: { id: string; name: string | null }[];
}
interface NominalCode { code: string; name: string; }
interface CrmContact { id: string; name: string; email?: string | null; companyId?: string | null; companyName?: string | null; }
interface CrmProperty { id: string; name: string; postcode?: string | null; }
interface CrmDeal { id: string; name: string; status?: string | null; }
interface MyData {
  cardholder: { id: string; userName: string } | null;
  card: { id: string; last4: string } | null;
  expenses: Expense[];
}

const ENTERTAINMENT_CATEGORIES = new Set([
  "Client Entertainment",
  "Agent Entertainment (External)",
  "Staff Entertainment",
  "Directors Meetings",
  "Meals & Drinks",
]);

const fmtPence = (p: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format((p || 0) / 100);
const fmtDate = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

function StatusBadge({ status }: { status: string }) {
  if (status === "pending_receipt") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">Receipt needed</span>;
  if (status === "receipt_uploaded") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">Receipt added</span>;
  if (status === "categorised") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-medium">Categorised</span>;
  if (status === "approved") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">Approved</span>;
  if (status === "synced_to_xero") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">In Xero</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{status}</span>;
}

// ─── Edit sheet ─────────────────────────────────────────────────────────

function EditExpenseSheet({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const open = !!expense;
  const { toast } = useToast();

  // Lazy-load the picker data ONLY when the sheet opens. Saves payload
  // on first page render — most users won't open every expense.
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
  const [businessPurpose, setBusinessPurpose] = useState("");
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [relatedPropertyId, setRelatedPropertyId] = useState<string | null>(null);
  const [relatedDealId, setRelatedDealId] = useState<string | null>(null);

  useEffect(() => {
    if (!expense) return;
    setMerchant(expense.merchant || "");
    setTransactionDate(expense.transactionDate ? expense.transactionDate.slice(0, 10) : "");
    setCategory(expense.category || "");
    setBusinessPurpose(expense.businessPurpose || "");
    setAttendeeIds((expense.attendeeContacts || []).map((c) => c.id));
    setRelatedPropertyId(expense.relatedPropertyId || null);
    setRelatedDealId(expense.relatedDealId || null);
  }, [expense?.id]);

  const isPosted = !!expense?.xeroExpenseId;
  const showEntertainmentFields = ENTERTAINMENT_CATEGORIES.has(category);
  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!expense) throw new Error("No expense");
      const payload: Record<string, unknown> = {
        merchant: merchant || null,
        transactionDate: transactionDate ? new Date(transactionDate).toISOString() : null,
        category: category || null,
        businessPurpose: businessPurpose || null,
        relatedPropertyId: relatedPropertyId || null,
        relatedDealId: relatedDealId || null,
      };
      await apiRequest("PATCH", `/api/expenses/${expense.id}`, payload);
      await apiRequest("PUT", `/api/expenses/${expense.id}/attendees`, { contactIds: attendeeIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/me"] });
      toast({ title: "Expense saved" });
      onClose();
    },
    onError: (e: any) => {
      toast({ title: "Save failed", description: e?.message || "Try again", variant: "destructive" });
    },
  });

  const personalMutation = useMutation({
    mutationFn: async () => {
      if (!expense) throw new Error("No expense");
      await apiRequest("PATCH", `/api/expenses/${expense.id}/mark-personal`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/me"] });
      toast({ title: "Marked as personal" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  // Picker state — typeahead for contacts/deals/properties
  const [contactSearch, setContactSearch] = useState("");
  const [dealSearch, setDealSearch] = useState("");
  const [propSearch, setPropSearch] = useState("");

  const filteredContacts = useMemo(() => {
    const q = contactSearch.toLowerCase().trim();
    if (!q) return contacts.slice(0, 30);
    return contacts.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.companyName || "").toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q)
    ).slice(0, 30);
  }, [contacts, contactSearch]);

  const filteredDeals = useMemo(() => {
    const q = dealSearch.toLowerCase().trim();
    if (!q) return deals.slice(0, 20);
    return deals.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 20);
  }, [deals, dealSearch]);

  const filteredProps = useMemo(() => {
    const q = propSearch.toLowerCase().trim();
    if (!q) return properties.slice(0, 20);
    return properties.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.postcode || "").toLowerCase().includes(q)
    ).slice(0, 20);
  }, [properties, propSearch]);

  if (!expense) return null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="bottom" className="h-[92dvh] p-0 rounded-t-2xl overflow-y-auto">
        <SheetHeader className="px-4 pt-4 pb-3 border-b sticky top-0 bg-background z-10">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="text-base text-left">
              {expense.merchant || "Edit expense"}
            </SheetTitle>
            <button onClick={onClose} className="p-1.5 -mr-1.5 rounded-full active:bg-gray-100">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono font-semibold">{fmtPence(expense.amountPence)}</span>
            <span className="text-muted-foreground">{fmtDate(expense.transactionDate)}</span>
            <StatusBadge status={expense.status} />
          </div>
          {isPosted && (
            <p className="text-[11px] text-emerald-700 mt-1">
              Posted to Xero — core fields locked
            </p>
          )}
        </SheetHeader>

        <div className="px-4 py-4 space-y-5 pb-32">
          {/* Merchant + date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="m-merchant" className="text-xs">Merchant</Label>
              <Input
                id="m-merchant"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                disabled={isPosted}
                placeholder="e.g. Quo Vadis"
                className="h-11"
                data-testid="m-input-merchant"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-date" className="text-xs">Date</Label>
              <Input
                id="m-date"
                type="date"
                value={transactionDate}
                onChange={(e) => setTransactionDate(e.target.value)}
                disabled={isPosted}
                className="h-11"
                data-testid="m-input-date"
              />
            </div>
          </div>

          {/* Category — chip list */}
          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5" /> Category
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {nominalCodes.length === 0 ? (
                <p className="text-[11px] text-muted-foreground italic">Loading categories…</p>
              ) : (
                nominalCodes.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => !isPosted && setCategory(c.name)}
                    disabled={isPosted}
                    className={`text-[12px] px-3 py-1.5 rounded-full border transition-colors ${
                      category === c.name
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border text-foreground active:bg-muted"
                    } ${isPosted ? "opacity-50" : ""}`}
                    data-testid={`m-cat-${c.code}`}
                  >
                    {c.name}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Business purpose */}
          <div className="space-y-1.5">
            <Label htmlFor="m-purpose" className="text-xs">Business purpose</Label>
            <Textarea
              id="m-purpose"
              value={businessPurpose}
              onChange={(e) => setBusinessPurpose(e.target.value)}
              disabled={isPosted}
              placeholder="What was this for?"
              rows={2}
              className="text-sm"
              data-testid="m-input-purpose"
            />
          </div>

          {/* Attendees — entertainment categories only */}
          {showEntertainmentFields && (
            <div className="space-y-2">
              <Label className="text-xs flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Attendees
                <span className="text-[10px] font-normal text-muted-foreground">
                  (HMRC requires names for entertainment)
                </span>
              </Label>
              {/* Selected chips */}
              {attendeeIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {attendeeIds.map((id) => {
                    const c = contactById.get(id);
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[12px]"
                      >
                        {c?.name || "Unknown"}
                        <button
                          type="button"
                          onClick={() => setAttendeeIds((prev) => prev.filter((x) => x !== id))}
                          className="hover:opacity-70"
                          aria-label="Remove attendee"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Add attendee by name…"
                  className="h-10 pl-8 text-sm"
                  disabled={isPosted}
                  data-testid="m-attendee-search"
                />
              </div>
              {contactSearch && (
                <div className="border rounded-lg max-h-48 overflow-y-auto divide-y">
                  {filteredContacts.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground italic p-3">No match</p>
                  ) : (
                    filteredContacts
                      .filter((c) => !attendeeIds.includes(c.id))
                      .map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setAttendeeIds((prev) => [...prev, c.id]);
                            setContactSearch("");
                          }}
                          className="w-full text-left px-3 py-2 active:bg-muted text-sm"
                          data-testid={`m-attendee-pick-${c.id}`}
                        >
                          <div className="font-medium">{c.name}</div>
                          {c.companyName && (
                            <div className="text-[11px] text-muted-foreground">{c.companyName}</div>
                          )}
                        </button>
                      ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* Related deal */}
          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5" /> Related deal
              <span className="text-[10px] font-normal text-muted-foreground">(optional)</span>
            </Label>
            {relatedDealId && (
              <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                <span className="text-sm truncate">
                  {deals.find((d) => d.id === relatedDealId)?.name || "Deal"}
                </span>
                <button
                  type="button"
                  onClick={() => setRelatedDealId(null)}
                  className="p-1 -mr-1 rounded-full active:bg-muted"
                  aria-label="Clear deal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            {!relatedDealId && (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    value={dealSearch}
                    onChange={(e) => setDealSearch(e.target.value)}
                    placeholder="Search deals…"
                    className="h-10 pl-8 text-sm"
                    disabled={isPosted}
                    data-testid="m-deal-search"
                  />
                </div>
                {dealSearch && (
                  <div className="border rounded-lg max-h-48 overflow-y-auto divide-y">
                    {filteredDeals.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground italic p-3">No match</p>
                    ) : (
                      filteredDeals.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => { setRelatedDealId(d.id); setDealSearch(""); }}
                          className="w-full text-left px-3 py-2 active:bg-muted text-sm"
                          data-testid={`m-deal-pick-${d.id}`}
                        >
                          <div className="font-medium">{d.name}</div>
                          {d.status && (
                            <div className="text-[11px] text-muted-foreground">{d.status}</div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Related property */}
          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" /> Related property
              <span className="text-[10px] font-normal text-muted-foreground">(optional)</span>
            </Label>
            {relatedPropertyId && (
              <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                <span className="text-sm truncate">
                  {properties.find((p) => p.id === relatedPropertyId)?.name || "Property"}
                </span>
                <button
                  type="button"
                  onClick={() => setRelatedPropertyId(null)}
                  className="p-1 -mr-1 rounded-full active:bg-muted"
                  aria-label="Clear property"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            {!relatedPropertyId && (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    value={propSearch}
                    onChange={(e) => setPropSearch(e.target.value)}
                    placeholder="Search properties…"
                    className="h-10 pl-8 text-sm"
                    disabled={isPosted}
                    data-testid="m-prop-search"
                  />
                </div>
                {propSearch && (
                  <div className="border rounded-lg max-h-48 overflow-y-auto divide-y">
                    {filteredProps.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground italic p-3">No match</p>
                    ) : (
                      filteredProps.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => { setRelatedPropertyId(p.id); setPropSearch(""); }}
                          className="w-full text-left px-3 py-2 active:bg-muted text-sm"
                          data-testid={`m-prop-pick-${p.id}`}
                        >
                          <div className="font-medium">{p.name}</div>
                          {p.postcode && (
                            <div className="text-[11px] text-muted-foreground">{p.postcode}</div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Mark personal */}
          {!isPosted && (
            <button
              type="button"
              onClick={() => personalMutation.mutate()}
              disabled={personalMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-border text-xs text-muted-foreground active:bg-muted"
              data-testid="m-mark-personal"
            >
              <UserX className="w-3.5 h-3.5" />
              Mark as personal (not a business expense)
            </button>
          )}
        </div>

        {/* Sticky Save bar at the bottom */}
        {!isPosted && (
          <div className="fixed bottom-0 inset-x-0 border-t bg-background p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="w-full h-12 text-base font-medium"
              data-testid="m-save"
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save expense
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── List view ──────────────────────────────────────────────────────────

export default function MobileExpenses() {
  const { toast } = useToast();
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);

  const { data, isLoading } = useQuery<MyData>({
    queryKey: ["/api/expenses/me"],
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const fd = new FormData();
      fd.append("receipt", file);
      const r = await fetch(`/api/expenses/${id}/receipt`, { method: "POST", credentials: "include", body: fd });
      if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/me"] });
      toast({ title: "Receipt uploaded" });
      setUploadingFor(null);
    },
    onError: (e: any) => {
      toast({ title: "Upload failed", description: e?.message || "Try again", variant: "destructive" });
      setUploadingFor(null);
    },
  });

  const expenses = data?.expenses || [];
  const pending = expenses.filter((e) => e.status === "pending_receipt");
  const recent = expenses.filter((e) => e.status !== "pending_receipt").slice(0, 30);

  const snapForExpense = (expense: Expense) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,application/pdf";
    input.setAttribute("capture", "environment");
    input.onchange = (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setUploadingFor(expense.id);
      uploadMutation.mutate({ id: expense.id, file });
    };
    input.click();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full pt-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.cardholder) {
    return (
      <div className="p-6 text-center pt-12">
        <Receipt className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
        <h2 className="text-base font-semibold">No card on file</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Ask Finance to issue you a BGP expense card.
        </p>
      </div>
    );
  }

  return (
    <div className="pb-24" data-testid="mobile-expenses">
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <Link href="/" className="p-1.5 -ml-1.5 rounded-full active:bg-gray-100">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-lg font-semibold flex-1">Expenses</h1>
        {data.card && (
          <span className="text-[11px] text-muted-foreground">···· {data.card.last4}</span>
        )}
      </div>

      {pending.length > 0 && (
        <div className="mx-4 mb-3 rounded-2xl bg-amber-50 border border-amber-200 p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <AlertCircle className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-amber-900">
              {pending.length} receipt{pending.length === 1 ? "" : "s"} needed
            </div>
            <div className="text-[11px] text-amber-700">
              Tap Snap on each row to add the photo, then tap the row to categorise.
            </div>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <section className="px-4 mb-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Awaiting receipt
          </h2>
          <div className="space-y-2">
            {pending.map((e) => (
              <div
                key={e.id}
                className="rounded-2xl bg-white dark:bg-card border border-border shadow-sm p-3 flex items-center gap-3"
                data-testid={`mobile-expense-pending-${e.id}`}
              >
                <button
                  type="button"
                  onClick={() => setEditing(e)}
                  className="flex-1 min-w-0 text-left active:opacity-70"
                >
                  <div className="font-medium text-sm truncate">{e.merchant || "Unknown merchant"}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {fmtDate(e.transactionDate)} · {fmtPence(e.amountPence)}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => snapForExpense(e)}
                  disabled={uploadingFor === e.id}
                  className="shrink-0 h-11 px-3 rounded-full bg-primary text-primary-foreground flex items-center gap-1.5 text-sm font-medium disabled:opacity-50 active:scale-95 transition-transform"
                  data-testid={`mobile-expense-snap-${e.id}`}
                >
                  {uploadingFor === e.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Camera className="w-4 h-4" />
                  )}
                  {uploadingFor === e.id ? "Uploading…" : "Snap"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="px-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Recent
        </h2>
        {recent.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center">
            <Receipt className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No expenses yet</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {recent.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setEditing(e)}
                className="w-full text-left rounded-xl bg-white dark:bg-card border border-border/60 p-2.5 flex items-center gap-3 active:bg-muted/40"
                data-testid={`mobile-expense-recent-${e.id}`}
              >
                <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[13px] truncate">{e.merchant || "Unknown merchant"}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <span>{fmtDate(e.transactionDate)}</span>
                    <span>·</span>
                    <span className="font-medium">{fmtPence(e.amountPence)}</span>
                    {e.category && <><span>·</span><span className="truncate">{e.category}</span></>}
                  </div>
                </div>
                <StatusBadge status={e.status} />
              </button>
            ))}
          </div>
        )}
      </section>

      <EditExpenseSheet expense={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
