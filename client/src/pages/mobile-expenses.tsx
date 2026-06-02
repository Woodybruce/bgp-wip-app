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
  X, Search, Tag, Users, Building2, Briefcase, UserX, Save, Sparkles, Trash2, UserPlus,
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

interface AutoClassifyResult {
  merchant: string | null;
  category: string | null;
  businessPurpose: string | null;
  attendeeContactIds: string[];
  proposedAttendees: { email: string; name: string }[];
  relatedDealId: string | null;
  relatedPropertyId: string | null;
  followUpQuestion: string | null;
  confidence: "high" | "medium" | "low";
  reasoning: string | null;
  matchedCalendarEvent: { subject: string; start: string; attendees: { email: string; name: string | null }[] } | null;
  matchedContactCount: number;
}

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
  // Free-text attendee names — used when the diary attendees aren't in the
  // CRM. Captures everyone for HMRC entertainment records.
  const [attendeesText, setAttendeesText] = useState("");
  const [relatedPropertyId, setRelatedPropertyId] = useState<string | null>(null);
  const [relatedDealId, setRelatedDealId] = useState<string | null>(null);

  // AI suggestion state — populated on sheet open if the expense has a
  // receipt but isn't yet categorised. Server cross-references the
  // user's Outlook calendar + CRM contacts and proposes category +
  // purpose + attendees the user can accept with one tap.
  const [aiSuggestion, setAiSuggestion] = useState<AutoClassifyResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiApplied, setAiApplied] = useState(false);

  useEffect(() => {
    if (!expense) return;
    setMerchant(expense.merchant || "");
    setTransactionDate(expense.transactionDate ? expense.transactionDate.slice(0, 10) : "");
    setCategory(expense.category || "");
    setBusinessPurpose(expense.businessPurpose || "");
    setAttendeeIds((expense.attendeeContacts || []).map((c) => c.id));
    setAttendeesText(expense.attendees || "");
    setRelatedPropertyId(expense.relatedPropertyId || null);
    setRelatedDealId(expense.relatedDealId || null);
    setAiSuggestion(null);
    setAiError(null);
    setAiApplied(false);

    // Auto-fire AI classify when the expense has a receipt but the user
    // hasn't categorised it yet. Skip if already posted to Xero (locked)
    // or already categorised (user has their own answer).
    const needsClassify = expense.receiptFilename && !expense.category && !expense.xeroExpenseId;
    if (!needsClassify) return;
    setAiLoading(true);
    fetch(`/api/expenses/${expense.id}/auto-classify`, { method: "POST", credentials: "include" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((s: AutoClassifyResult) => {
        setAiSuggestion(s);
        // Auto-apply on high confidence — user can still override every
        // field before tapping Save. Medium/low → user has to accept.
        if (s.confidence === "high") {
          if (s.category) setCategory(s.category);
          if (s.businessPurpose) setBusinessPurpose(s.businessPurpose);
          if (s.attendeeContactIds.length > 0) setAttendeeIds(s.attendeeContactIds);
          if (s.proposedAttendees.length > 0) setAttendeesText(s.proposedAttendees.map((p) => p.name).join(", "));
          setAiApplied(true);
        }
      })
      .catch((e) => setAiError(e?.message || "AI classify failed"))
      .finally(() => setAiLoading(false));
  }, [expense?.id]);

  const applySuggestion = () => {
    if (!aiSuggestion) return;
    if (aiSuggestion.category) setCategory(aiSuggestion.category);
    if (aiSuggestion.businessPurpose) setBusinessPurpose(aiSuggestion.businessPurpose);
    if (aiSuggestion.attendeeContactIds.length > 0) setAttendeeIds(aiSuggestion.attendeeContactIds);
    if (aiSuggestion.proposedAttendees.length > 0) setAttendeesText(aiSuggestion.proposedAttendees.map((p) => p.name).join(", "));
    if (aiSuggestion.relatedDealId) setRelatedDealId(aiSuggestion.relatedDealId);
    if (aiSuggestion.relatedPropertyId) setRelatedPropertyId(aiSuggestion.relatedPropertyId);
    setAiApplied(true);
  };

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
        attendees: attendeesText || null,
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

  // Add a calendar attendee to crm_contacts via Apollo / RocketReach
  // enrichment. On success we drop them into the attendeeIds chip list,
  // pull their name out of the free-text fallback field, and refresh the
  // contacts query so subsequent typeahead picks them up.
  const [addingEmail, setAddingEmail] = useState<string | null>(null);
  const [addedEmails, setAddedEmails] = useState<Set<string>>(new Set());
  const addAttendeeMutation = useMutation({
    mutationFn: async (args: { email: string; name: string }) => {
      const r = await fetch("/api/contacts/from-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(args),
      });
      const body = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(body?.error || `Failed (${r.status})`);
      return body as { contact: { id: string; name: string }; created: boolean; source: string };
    },
    onSuccess: (body, vars) => {
      setAttendeeIds((prev) => prev.includes(body.contact.id) ? prev : [...prev, body.contact.id]);
      setAttendeesText((prev) => prev
        .split(/\s*,\s*/)
        .filter((n) => n && n.toLowerCase() !== vars.name.toLowerCase())
        .join(", "));
      setAddedEmails((prev) => new Set(prev).add(vars.email));
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      toast({
        title: body.created ? "Added to CRM" : "Already in CRM",
        description: body.created && body.source !== "fallback"
          ? `Enriched via ${body.source === "apollo" ? "Apollo" : "RocketReach"}`
          : undefined,
      });
      setAddingEmail(null);
    },
    onError: (e: any, vars) => {
      toast({ title: `Couldn't add ${vars.name}`, description: e?.message, variant: "destructive" });
      setAddingEmail(null);
    },
  });
  const addAttendee = (a: { email: string; name: string }) => {
    setAddingEmail(a.email);
    addAttendeeMutation.mutate(a);
  };

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
          {/* ─── AI suggestion banner ───────────────────────────────────
              Fires when the sheet opens for a receipt that hasn't been
              categorised yet. Server pulls the user's calendar + CRM
              contacts + the parsed receipt and proposes a full set of
              fields. High-confidence suggestions auto-apply; medium /
              low need user confirmation. */}
          {(aiLoading || aiSuggestion || aiError) && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-900 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900 flex items-center justify-center shrink-0">
                  {aiLoading ? <Loader2 className="w-4 h-4 text-violet-600 animate-spin" /> : <Sparkles className="w-4 h-4 text-violet-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-violet-900 dark:text-violet-100">
                    {aiLoading ? "AI is checking your diary…" : aiError ? "AI couldn't classify" : aiApplied ? "AI suggestions applied" : "AI suggestion ready"}
                  </div>
                  {aiSuggestion?.matchedCalendarEvent && (
                    <div className="text-[11px] text-violet-700 dark:text-violet-300 truncate">
                      Matched to: {aiSuggestion.matchedCalendarEvent.subject}
                    </div>
                  )}
                  {aiSuggestion && aiSuggestion.proposedAttendees.length > 0 && (
                    <div className="text-[11px] text-violet-700 dark:text-violet-300 truncate">
                      Attendees from diary: {aiSuggestion.proposedAttendees.map((p) => p.name).join(", ")}
                    </div>
                  )}
                </div>
                {aiSuggestion && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider ${
                    aiSuggestion.confidence === "high" ? "bg-emerald-100 text-emerald-700" :
                    aiSuggestion.confidence === "medium" ? "bg-amber-100 text-amber-700" :
                    "bg-gray-100 text-gray-600"
                  }`}>
                    {aiSuggestion.confidence}
                  </span>
                )}
              </div>

              {aiSuggestion?.reasoning && (
                <p className="text-[12px] text-violet-800 dark:text-violet-200 leading-relaxed">
                  {aiSuggestion.reasoning}
                </p>
              )}

              {aiSuggestion?.followUpQuestion && (
                <div className="rounded-lg bg-white dark:bg-violet-950 border border-violet-200 dark:border-violet-800 p-2.5">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-violet-600 mb-0.5">Question</div>
                  <p className="text-[12px] text-foreground">{aiSuggestion.followUpQuestion}</p>
                </div>
              )}

              {aiSuggestion && !aiApplied && (
                <button
                  type="button"
                  onClick={applySuggestion}
                  className="w-full py-2 rounded-lg bg-violet-600 text-white text-sm font-medium active:bg-violet-700"
                  data-testid="m-apply-ai"
                >
                  Apply AI suggestion
                </button>
              )}

              {aiError && (
                <p className="text-[11px] text-violet-700 italic">{aiError}</p>
              )}
            </div>
          )}

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
              {/* Diary attendees who aren't in the CRM yet — offer one-tap
                  Add (Apollo/RocketReach enrichment behind the scenes). */}
              {aiSuggestion?.proposedAttendees && aiSuggestion.proposedAttendees
                .filter((a) => !addedEmails.has(a.email))
                .length > 0 && (
                <div className="space-y-1.5 rounded-lg bg-violet-50/60 border border-violet-100 p-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                    From your diary — not in CRM
                  </div>
                  {aiSuggestion.proposedAttendees
                    .filter((a) => !addedEmails.has(a.email))
                    .map((a) => (
                      <div key={a.email} className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{a.name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{a.email}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => addAttendee(a)}
                          disabled={addingEmail === a.email || isPosted}
                          className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-full bg-violet-600 text-white text-[11px] font-semibold disabled:opacity-60 active:scale-95 transition-transform"
                          data-testid={`m-attendee-add-${a.email}`}
                        >
                          {addingEmail === a.email ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <UserPlus className="w-3 h-3" />
                          )}
                          Add to CRM
                        </button>
                      </div>
                    ))}
                </div>
              )}
              {/* Free-text fallback — anyone not in the CRM yet. Auto-filled
                  from the matched diary entry's attendee list. */}
              <Textarea
                value={attendeesText}
                onChange={(e) => setAttendeesText(e.target.value)}
                disabled={isPosted}
                placeholder="Other attendees not in the CRM (comma separated)"
                rows={2}
                className="text-sm"
                data-testid="m-input-attendees-text"
              />
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
  // Real DOM input refs — dynamically created <input>.click() doesn't
  // open the iOS PWA file picker reliably. Hidden inputs that already
  // exist in the tree do.
  const newReceiptInputRef = useRef<HTMLInputElement>(null);
  const expenseReceiptInputRef = useRef<HTMLInputElement>(null);
  const targetExpenseIdRef = useRef<string | null>(null);

  const { data, isLoading } = useQuery<MyData>({
    queryKey: ["/api/expenses/me"],
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const fd = new FormData();
      fd.append("receipt", file);
      const r = await fetch(`/api/expenses/${id}/receipt`, { method: "POST", credentials: "include", body: fd });
      const body = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(body?.error || `Upload failed (${r.status})`);
      return body;
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/expenses/me"] });
      // Land the user straight in the edit sheet for the just-uploaded
      // expense — the sheet auto-fires AI classify on mount, so the
      // suggestion is ready (or loading) by the time they look at it.
      const fresh = queryClient.getQueryData<MyData>(["/api/expenses/me"]);
      const updated = fresh?.expenses.find((e) => e.id === variables.id) || null;
      if (updated) setEditing(updated);
      toast({ title: "Receipt uploaded — AI is checking your diary" });
      setUploadingFor(null);
    },
    onError: (e: any) => {
      toast({ title: "Upload failed", description: e?.message || "Try again", variant: "destructive" });
      setUploadingFor(null);
    },
  });

  // Card-less flow: upload a receipt with no pre-existing expense. The
  // server runs OCR, creates the expense row, and we drop the user into
  // the edit sheet so AI classify can run.
  const submitMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("receipt", file);
      const r = await fetch(`/api/expenses/submit`, { method: "POST", credentials: "include", body: fd });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body?.ok) throw new Error(body?.error || `Upload failed: ${r.status}`);
      return body as { ok: true; expenseId: string; duplicateOf?: string };
    },
    onSuccess: async (body) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/expenses/me"] });
      const fresh = queryClient.getQueryData<MyData>(["/api/expenses/me"]);
      const created = fresh?.expenses.find((e) => e.id === body.expenseId) || null;
      if (created) setEditing(created);
      if (body.duplicateOf) {
        toast({ title: "Already on file", description: "Same merchant, amount and date — opened the existing one." });
      } else {
        toast({ title: "Receipt uploaded — AI is checking your diary" });
      }
      setUploadingFor(null);
    },
    onError: (e: any) => {
      toast({ title: "Upload failed", description: e?.message || "Try again", variant: "destructive" });
      setUploadingFor(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/expenses/${id}`, { method: "DELETE", credentials: "include" });
      const body = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(body?.error || `Delete failed (${r.status})`);
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/me"] });
      toast({ title: "Expense deleted" });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't delete", description: e?.message, variant: "destructive" });
    },
  });

  const askDelete = (e: Expense) => {
    if (!window.confirm(`Delete this ${fmtPence(e.amountPence)} expense at ${e.merchant || "unknown merchant"}?`)) return;
    deleteMutation.mutate(e.id);
  };

  const expenses = data?.expenses || [];
  const pending = expenses.filter((e) => e.status === "pending_receipt");
  const recent = expenses.filter((e) => e.status !== "pending_receipt").slice(0, 30);

  // Hidden inputs already mounted below — clicking them directly from
  // the user-initiated tap reliably opens iOS / Android's native picker
  // (which then offers Take Photo / Photo Library / Browse Files).
  const snapForExpense = (expense: Expense) => {
    targetExpenseIdRef.current = expense.id;
    expenseReceiptInputRef.current?.click();
  };

  const snapNewReceipt = () => {
    newReceiptInputRef.current?.click();
  };

  const handleNewReceiptChange = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setUploadingFor("__new__");
    submitMutation.mutate(file);
  };

  const handleExpenseReceiptChange = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    const expenseId = targetExpenseIdRef.current;
    ev.target.value = "";
    targetExpenseIdRef.current = null;
    if (!file || !expenseId) return;
    setUploadingFor(expenseId);
    uploadMutation.mutate({ id: expenseId, file });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full pt-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isUploading = uploadingFor !== null;

  return (
    <div className="pb-24" data-testid="mobile-expenses">
      <input
        ref={newReceiptInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={handleNewReceiptChange}
        data-testid="mobile-expense-new-input"
      />
      <input
        ref={expenseReceiptInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={handleExpenseReceiptChange}
        data-testid="mobile-expense-existing-input"
      />

      {isUploading && (
        <div className="fixed inset-0 z-50 bg-background/85 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
          <div className="text-center px-6">
            <div className="text-base font-semibold">Reading your receipt…</div>
            <div className="text-xs text-muted-foreground mt-1">
              AI is pulling the merchant, total and date. This takes 5–10 seconds.
            </div>
          </div>
        </div>
      )}

      <div
        className="px-4 pb-3 flex items-center gap-3 border-b border-border/40 bg-background/95 backdrop-blur sticky top-0 z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <Link href="/" className="p-2 -ml-2 rounded-full active:bg-gray-100">
          <ChevronLeft className="w-6 h-6" />
        </Link>
        <h1 className="text-2xl font-semibold flex-1">Expenses</h1>
      </div>

      <div className="px-4 mb-3">
        <button
          type="button"
          onClick={snapNewReceipt}
          disabled={uploadingFor === "__new__"}
          className="w-full h-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center gap-2 text-base font-semibold shadow-sm disabled:opacity-60 active:scale-[0.98] transition-transform"
          data-testid="mobile-expense-snap-new"
        >
          {uploadingFor === "__new__" ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Uploading…</>
          ) : (
            <><Camera className="w-5 h-5" /> Add a receipt</>
          )}
        </button>
        <p className="text-[11px] text-muted-foreground text-center mt-1.5">
          Take a photo or pick one from your library — AI fills the rest.
        </p>
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
              <div
                key={e.id}
                className="rounded-xl bg-white dark:bg-card border border-border/60 flex items-center gap-1"
                data-testid={`mobile-expense-recent-${e.id}`}
              >
                <button
                  type="button"
                  onClick={() => setEditing(e)}
                  className="flex-1 min-w-0 text-left p-2.5 flex items-center gap-3 active:bg-muted/40 rounded-l-xl"
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
                <button
                  type="button"
                  onClick={() => askDelete(e)}
                  disabled={deleteMutation.isPending}
                  className="shrink-0 p-3 text-muted-foreground active:text-red-600 active:bg-red-50 rounded-r-xl disabled:opacity-50"
                  aria-label="Delete expense"
                  data-testid={`mobile-expense-delete-${e.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <EditExpenseSheet expense={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
