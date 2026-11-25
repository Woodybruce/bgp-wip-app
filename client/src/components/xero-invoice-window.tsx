// The invoice window on a transaction's Fees & invoicing pill (Woody,
// 20 November 2026, on draft INV-05587: "at this point need the ability to
// edit that draft or also see that draft in the app ... does the api allow for
// approval and email from the app? ... so layla doesn't need to go on to
// Xero"; 24 November 2026, asked who may approve and send: "xero all admin").
// The invoice as Xero holds it, its PDF in the pop-out viewer, the draft
// changed here; admins approve, email and void it; any BGP person deletes a
// draft. Rules: shared/xero-invoice.ts. Routes: server/xero-invoice-actions.ts.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders, startXeroConnect } from "@/lib/queryClient";
import { FilePopout } from "@/components/file-popout";
import { XeroContactPicker, type XeroContact } from "@/components/xero-contact-picker";
import { ExternalLink, FileText, Loader2, Mail, Pencil, Plus, Trash2, X } from "lucide-react";
import { INVOICE_MAX_LINES, type InvoiceActions, type XeroInvoiceView } from "@shared/xero-invoice";

export const XERO_STATUS_COLOURS: Record<string, string> = {
  DRAFT: "bg-zinc-500",
  SUBMITTED: "bg-blue-500",
  AUTHORISED: "bg-green-600",
  PAID: "bg-emerald-600",
  VOIDED: "bg-red-500",
  DELETED: "bg-red-700",
  ERROR: "bg-red-500",
};

interface Detail {
  row: { id: string; dealId: string; status: string | null; invoiceNumber: string | null; errorMessage: string | null; xeroUrl: string | null };
  admin: boolean;
  view: XeroInvoiceView | null;
  actions: InvoiceActions;
  emailed: { at: string; by: string | null; to: string } | null;
}

type Mode = "view" | "edit" | "approve" | "email" | "void" | "delete";
interface LineDraft { lineItemId: string | null; description: string; quantity: string; unitAmount: string }

class CallError extends Error { constructor(message: string, public status: number, public code?: string, public data?: any) { super(message); } }

async function call(method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method, credentials: "include",
    headers: { ...getAuthHeaders(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CallError(data?.message || `Xero answered ${res.status}.`, res.status, data?.code, data);
  return data;
}

const day = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
};

const keyFor = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function XeroInvoiceWindow({ invoiceId, open, onOpenChange, onChanged }: {
  invoiceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("view");
  const [pdf, setPdf] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; code?: string } | null>(null);

  const { data, isLoading, error, refetch } = useQuery<Detail>({
    queryKey: ["/api/xero/invoices", invoiceId, "detail"],
    queryFn: () => call("GET", `/api/xero/invoices/${invoiceId}/detail`),
    enabled: open && !!invoiceId,
    staleTime: 0,
    retry: false,
  });
  useEffect(() => { if (!open) { setMode("view"); setProblem(null); } }, [open]);

  const view = data?.view || null;
  const actions = data?.actions;
  const money = useMemo(() => {
    const currency = view?.currency === "USD" ? "USD" : "GBP";
    const f = new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 });
    return (n: number | null | undefined) => (n == null ? "–" : f.format(n));
  }, [view?.currency]);
  const name = view?.number || data?.row.invoiceNumber || "Draft invoice";

  const done = (title: string, description?: string) => {
    toast({ title, description });
    setMode("view");
    setProblem(null);
    onChanged?.();
    refetch();
  };
  const failed = (e: any) => setProblem({ message: String(e?.message || e), code: e?.code });

  const loadError = error as CallError | null;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="xero-invoice-window">
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-base">
                <span className="font-mono tabular-nums" data-testid="xero-invoice-window-number">{name}</span>
                {view && (
                  <Badge variant="outline" className={`border-transparent text-[10px] text-white ${XERO_STATUS_COLOURS[view.status] || "bg-zinc-500"}`} data-testid="xero-invoice-window-status">
                    {view.statusWords}
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription className="truncate" data-testid="xero-invoice-window-contact">{view?.contact.name || (isLoading ? "Reading it from Xero…" : "")}</DialogDescription>
            </div>
            {data?.row.xeroUrl && (
              <a href={data.row.xeroUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1" data-testid="xero-invoice-window-open-xero">
                Open in Xero <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {isLoading && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Reading the invoice from Xero…</p>}
          {loadError && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20 px-3 py-2 text-sm text-amber-900 dark:text-amber-200" data-testid="xero-invoice-window-error">
              {loadError.message}
            </div>
          )}
          {data && !view && (
            <p className="text-sm text-muted-foreground" data-testid="xero-invoice-window-not-in-xero">
              This invoice never reached Xero{data.row.errorMessage ? `: ${data.row.errorMessage}` : "."}
            </p>
          )}

          {view && mode !== "edit" && <InvoiceBody view={view} money={money} emailed={data?.emailed || null} />}
          {view && mode === "edit" && (
            <EditDraft
              view={view}
              money={money}
              onCancel={() => { setMode("view"); setProblem(null); }}
              busy={busy}
              onSave={async (body) => {
                setBusy(true); setProblem(null);
                try { await call("PUT", `/api/xero/invoices/${invoiceId}`, body); done("Draft saved in Xero"); }
                catch (e) { failed(e); }
                finally { setBusy(false); }
              }}
            />
          )}

          {problem && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20 px-3 py-2 text-sm text-amber-900 dark:text-amber-200 space-y-2" data-testid="xero-invoice-window-problem">
              <p>{problem.message}</p>
              {problem.code === "XERO_CONNECT" && (
                <Button size="sm" variant="outline" onClick={() => startXeroConnect({ returnTo: window.location.pathname + window.location.search })} data-testid="xero-invoice-window-connect">
                  Connect Xero
                </Button>
              )}
            </div>
          )}

          {view && actions && mode === "approve" && (
            <Confirm
              testId="xero-invoice-approve-panel"
              words={`Approve ${name} for ${money(view.total)} (VAT included) to ${view.contact.name || "the contact"}? Xero posts it to the accounts: after that it can be voided, not deleted.`}
              busy={busy}
              onCancel={() => { setMode("view"); setProblem(null); }}
              buttons={[
                { label: "Approve", testId: "xero-invoice-approve-confirm", secondary: true, run: async () => {
                  const out = await call("POST", `/api/xero/invoices/${invoiceId}/approve`, {});
                  if (out) done(`${name} approved in Xero`);
                } },
                { label: "Approve and email", testId: "xero-invoice-approve-email", run: async () => {
                  const out = await call("POST", `/api/xero/invoices/${invoiceId}/approve`, { andEmail: true });
                  if (out?.emailRefused) {
                    onChanged?.(); refetch();
                    setMode("email");
                    setProblem({ message: `Approved. Not emailed: ${out.emailRefused.message}`, code: out.emailRefused.code });
                    return;
                  }
                  done(`${name} approved and emailed`, out?.emailed?.to ? `Xero emailed it to ${out.emailed.to}.` : undefined);
                } },
              ]}
              setBusy={setBusy}
              onFail={failed}
            />
          )}

          {view && mode === "email" && invoiceId && (
            <EmailPanel invoiceId={invoiceId} name={name} busy={busy} setBusy={setBusy} onCancel={() => { setMode("view"); setProblem(null); }}
              onSent={(to) => done(`${name} emailed`, to ? `Xero emailed it to ${to}.` : undefined)} onFail={failed} problemCode={problem?.code} />
          )}

          {view && mode === "void" && invoiceId && (
            <VoidPanel name={name} busy={busy} onCancel={() => { setMode("view"); setProblem(null); }}
              onVoid={async (reason) => {
                setBusy(true); setProblem(null);
                try { await call("POST", `/api/xero/invoices/${invoiceId}/void`, { reason }); done(`${name} voided in Xero`); }
                catch (e) { failed(e); }
                finally { setBusy(false); }
              }} />
          )}

          {view && mode === "delete" && (
            <Confirm
              testId="xero-invoice-delete-panel"
              words={`Delete draft ${name} in Xero? It goes from Xero's drafts; the transaction keeps a line saying it was deleted.`}
              busy={busy}
              onCancel={() => { setMode("view"); setProblem(null); }}
              buttons={[{ label: "Delete the draft", testId: "xero-invoice-delete-confirm", destructive: true, run: async () => {
                await call("POST", `/api/xero/invoices/${invoiceId}/delete-draft`, {});
                done(`Draft ${name} deleted in Xero`);
              } }]}
              setBusy={setBusy}
              onFail={failed}
            />
          )}

          {view && actions && mode === "view" && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3" data-testid="xero-invoice-window-actions">
              {actions.pdf && (
                <Button size="sm" variant="outline" onClick={() => setPdf(0)} data-testid="xero-invoice-pdf">
                  <FileText className="w-3.5 h-3.5 mr-1" />See the PDF
                </Button>
              )}
              {actions.edit && (
                <Button size="sm" variant="outline" onClick={() => { setMode("edit"); setProblem(null); }} data-testid="xero-invoice-edit">
                  <Pencil className="w-3.5 h-3.5 mr-1" />Change the draft
                </Button>
              )}
              {actions.approve && (
                <Button size="sm" onClick={() => { setMode("approve"); setProblem(null); }} data-testid="xero-invoice-approve">
                  Approve
                </Button>
              )}
              {actions.email && (
                <Button size="sm" onClick={() => { setMode("email"); setProblem(null); }} data-testid="xero-invoice-email">
                  <Mail className="w-3.5 h-3.5 mr-1" />{view.sentToContact || data?.emailed ? "Email it again" : "Email to the client"}
                </Button>
              )}
              {actions.void && (
                <Button size="sm" variant="ghost" className="text-red-700 dark:text-red-400" onClick={() => { setMode("void"); setProblem(null); }} data-testid="xero-invoice-void">
                  Void
                </Button>
              )}
              {actions.deleteDraft && (
                <Button size="sm" variant="ghost" className="text-red-700 dark:text-red-400" onClick={() => { setMode("delete"); setProblem(null); }} data-testid="xero-invoice-delete">
                  <Trash2 className="w-3.5 h-3.5 mr-1" />Delete the draft
                </Button>
              )}
              {!data?.admin && (view.status === "DRAFT" || view.status === "SUBMITTED") && (
                <span className="text-xs text-muted-foreground" data-testid="xero-invoice-admin-note">An admin approves and sends it.</span>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      {invoiceId && (
        <FilePopout
          files={[{ key: `xero-${invoiceId}`, name: `${name}.pdf`, url: `/api/xero/invoices/${invoiceId}/pdf`, mime: "application/pdf", caption: view?.statusWords || null }]}
          index={pdf}
          onIndex={setPdf}
        />
      )}
    </>
  );
}

function InvoiceBody({ view, money, emailed }: { view: XeroInvoiceView; money: (n: number | null | undefined) => string; emailed: Detail["emailed"] }) {
  const facts = [
    view.date ? `Dated ${day(view.date)}` : null,
    view.dueDate ? `Due ${day(view.dueDate)}` : null,
    view.reference ? `Ref ${view.reference}` : null,
  ].filter(Boolean);
  return (
    <div className="space-y-3 text-sm" data-testid="xero-invoice-window-body">
      {facts.length > 0 && <p className="text-xs text-muted-foreground" data-testid="xero-invoice-window-facts">{facts.join(" · ")}</p>}
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="text-left font-medium px-3 py-1.5">Description</th><th className="text-right font-medium px-2 py-1.5">Qty</th><th className="text-right font-medium px-2 py-1.5">Price</th><th className="text-right font-medium px-3 py-1.5">Amount</th></tr>
          </thead>
          <tbody>
            {view.lines.map((l, i) => (
              <tr key={l.lineItemId || i} className="border-t align-top" data-testid={`xero-invoice-line-${i}`}>
                <td className="px-3 py-2 whitespace-pre-wrap">{l.description}</td>
                <td className="px-2 py-2 text-right tabular-nums">{l.quantity ?? ""}</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(l.unitAmount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.lineAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ml-auto w-full max-w-xs space-y-0.5 text-sm tabular-nums" data-testid="xero-invoice-window-totals">
        <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{money(view.subTotal)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">VAT</span><span>{money(view.totalTax)}</span></div>
        <div className="flex justify-between font-semibold"><span>Total</span><span>{money(view.total)}</span></div>
        {(view.status === "AUTHORISED" || view.status === "PAID") && (
          <div className="flex justify-between text-muted-foreground"><span>{(view.amountPaid || 0) > 0 ? `Paid ${money(view.amountPaid)} · due` : "Due"}</span><span>{money(view.amountDue)}</span></div>
        )}
      </div>
      {(view.status === "AUTHORISED" || view.status === "PAID") && (
        <p className="text-xs text-muted-foreground" data-testid="xero-invoice-window-sent">
          {emailed ? `Emailed ${day(emailed.at)}${emailed.by ? ` by ${emailed.by}` : ""} to ${emailed.to}.` : view.sentToContact ? "Marked as sent in Xero." : "Not sent to the client yet."}
        </p>
      )}
    </div>
  );
}

function EditDraft({ view, money, busy, onCancel, onSave }: {
  view: XeroInvoiceView;
  money: (n: number | null | undefined) => string;
  busy: boolean;
  onCancel: () => void;
  onSave: (body: any) => void;
}) {
  const [date, setDate] = useState(view.date || "");
  const [dueDate, setDueDate] = useState(view.dueDate || "");
  const [reference, setReference] = useState(view.reference || "");
  const [contact, setContact] = useState<{ id: string | null; name: string | null }>(view.contact);
  const [changeContact, setChangeContact] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>(() => view.lines.length
    ? view.lines.map(l => ({ lineItemId: l.lineItemId, description: l.description, quantity: String(l.quantity ?? 1), unitAmount: l.unitAmount == null ? "" : String(l.unitAmount) }))
    : [{ lineItemId: null, description: "", quantity: "1", unitAmount: "" }]);
  const set = (i: number, patch: Partial<LineDraft>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const net = lines.reduce((sum, l) => {
    const q = Number(l.quantity || 1), p = Number(String(l.unitAmount).replace(/[£$,\s]/g, ""));
    return Number.isFinite(q) && Number.isFinite(p) ? sum + q * p : sum;
  }, 0);
  return (
    <div className="space-y-3 text-sm" data-testid="xero-invoice-edit-form">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div><Label className="text-xs mb-1 block">Invoice date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} data-testid="xero-invoice-edit-date" /></div>
        <div><Label className="text-xs mb-1 block">Due date</Label><Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} data-testid="xero-invoice-edit-due" /></div>
        <div><Label className="text-xs mb-1 block">Reference</Label><Input value={reference} onChange={e => setReference(e.target.value)} data-testid="xero-invoice-edit-reference" /></div>
      </div>
      <div>
        <Label className="text-xs mb-1 block">Bill to</Label>
        {changeContact ? (
          <XeroContactPicker
            value={contact.id}
            cachedName={contact.name}
            onChange={(c: XeroContact | null) => { if (c) { setContact({ id: c.ContactID, name: c.Name }); setChangeContact(false); } }}
            testIdPrefix="xero-invoice-edit-contact"
          />
        ) : (
          <p className="flex items-center gap-2">
            <span data-testid="xero-invoice-edit-contact-name">{contact.name || "No contact"}</span>
            <button type="button" className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground" onClick={() => setChangeContact(true)} data-testid="xero-invoice-edit-contact-change">Change</button>
          </p>
        )}
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="rounded-md border p-2 space-y-2" data-testid={`xero-invoice-edit-line-${i}`}>
            <div className="flex items-start gap-2">
              <Textarea value={l.description} onChange={e => set(i, { description: e.target.value })} rows={Math.min(8, Math.max(2, l.description.split("\n").length))} className="text-sm" placeholder="What the invoice is for" data-testid={`xero-invoice-edit-description-${i}`} />
              {lines.length > 1 && (
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Take this line off" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} data-testid={`xero-invoice-edit-remove-${i}`}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <div className="w-24"><Label className="text-xs mb-1 block">Qty</Label><Input inputMode="decimal" value={l.quantity} onChange={e => set(i, { quantity: e.target.value })} data-testid={`xero-invoice-edit-qty-${i}`} /></div>
              <div className="flex-1"><Label className="text-xs mb-1 block">Price (before VAT)</Label><Input inputMode="decimal" value={l.unitAmount} onChange={e => set(i, { unitAmount: e.target.value })} data-testid={`xero-invoice-edit-price-${i}`} /></div>
            </div>
          </div>
        ))}
        {lines.length < INVOICE_MAX_LINES && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setLines(ls => [...ls, { lineItemId: null, description: "", quantity: "1", unitAmount: "" }])} data-testid="xero-invoice-edit-add-line">
            <Plus className="w-3.5 h-3.5 mr-1" />Add a line
          </Button>
        )}
      </div>
      <p className="text-right tabular-nums text-sm"><span className="text-muted-foreground">Before VAT </span>{money(Math.round(net * 100) / 100)}</p>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => onSave({
          date: date || null, dueDate: dueDate || null, reference,
          contactId: contact.id && contact.id !== view.contact.id ? contact.id : null,
          lines: lines.map(l => ({ lineItemId: l.lineItemId, description: l.description, quantity: l.quantity, unitAmount: l.unitAmount })),
        })} data-testid="xero-invoice-edit-save">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}Save in Xero
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel} data-testid="xero-invoice-edit-cancel">Cancel</Button>
      </div>
    </div>
  );
}

function Confirm({ words, buttons, busy, setBusy, onCancel, onFail, testId }: {
  words: string;
  buttons: Array<{ label: string; testId: string; destructive?: boolean; secondary?: boolean; run: () => Promise<void> }>;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onCancel: () => void;
  onFail: (e: any) => void;
  testId: string;
}) {
  return (
    <div className="rounded-md border p-3 space-y-3 text-sm" data-testid={testId}>
      <p>{words}</p>
      <div className="flex flex-wrap gap-2">
        {buttons.map(b => (
          <Button key={b.label} size="sm" variant={b.destructive ? "destructive" : b.secondary ? "outline" : "default"} disabled={busy} data-testid={b.testId}
            onClick={async () => { setBusy(true); try { await b.run(); } catch (e) { onFail(e); } finally { setBusy(false); } }}>
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}{b.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function EmailPanel({ invoiceId, name, busy, setBusy, onCancel, onSent, onFail, problemCode }: {
  invoiceId: string;
  name: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onCancel: () => void;
  onSent: (to: string | null) => void;
  onFail: (e: any) => void;
  problemCode?: string;
}) {
  const [key] = useState(keyFor);
  const [address, setAddress] = useState("");
  const [again, setAgain] = useState(false);
  const { data, isLoading, error } = useQuery<{ contactName: string | null; recipients: { primary: string | null; others: string[] }; words: string; emailed?: Detail["emailed"] }>({
    queryKey: ["/api/xero/invoices", invoiceId, "recipients"],
    queryFn: () => call("GET", `/api/xero/invoices/${invoiceId}/recipients`),
    staleTime: 0,
    retry: false,
  });
  const none = !!data && !data.recipients.primary && !data.recipients.others.length;
  const send = async () => {
    setBusy(true);
    try {
      const out = await call("POST", `/api/xero/invoices/${invoiceId}/email`, { key, ...(none ? { setEmail: address.trim() } : {}), ...(again ? { again: true } : {}) });
      onSent(out?.to || null);
    } catch (e: any) {
      if (e?.code === "SENT_RECENTLY") setAgain(true);
      onFail(e);
    } finally { setBusy(false); }
  };
  return (
    <div className="rounded-md border p-3 space-y-3 text-sm" data-testid="xero-invoice-email-panel">
      {isLoading && <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Checking who Xero emails…</p>}
      {error && <p className="text-amber-800 dark:text-amber-300">{(error as Error).message}</p>}
      {data && !none && <p data-testid="xero-invoice-email-to">{data.words} It comes from Xero with BGP's usual invoice email.</p>}
      {data && none && (
        <div className="space-y-1">
          <p data-testid="xero-invoice-email-none">Xero has no email address for {data.contactName || "this contact"}. Give the one the invoice goes to: it is saved on the contact in Xero.</p>
          <Input type="email" value={address} onChange={e => setAddress(e.target.value)} placeholder="accounts@company.co.uk" data-testid="xero-invoice-email-address" />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || isLoading || !data || (none && !address.trim())} onClick={send} data-testid="xero-invoice-email-send">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}{again || problemCode === "SENT_RECENTLY" ? `Send ${name} again` : `Email ${name}`}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function VoidPanel({ name, busy, onCancel, onVoid }: { name: string; busy: boolean; onCancel: () => void; onVoid: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="rounded-md border p-3 space-y-3 text-sm" data-testid="xero-invoice-void-panel">
      <p>Void {name}? Xero keeps it as voided and takes it out of the accounts. It can't be restored.</p>
      <div><Label className="text-xs mb-1 block">Why (optional, noted in Xero)</Label><Input value={reason} onChange={e => setReason(e.target.value)} data-testid="xero-invoice-void-reason" /></div>
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={busy} onClick={() => onVoid(reason.trim())} data-testid="xero-invoice-void-confirm">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}Void {name}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
