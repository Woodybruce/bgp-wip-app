// Offers on a unit, on the joint agent's tracker: the unit's offers, each
// with its negotiation log (the same NegotiationPanel BGP's tracker mounts),
// and a form to log or edit one through the unit's existing offer routes.
// The brand is typed, or picked from the brands already named on the unit;
// the contact is a typed name. No CRM contact is linked and there is no link
// to a brand page. On an offer another login logged, the contact and the
// comments are not sent to a joint agent, so the form does not show or send
// them.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HandCoins, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { NegotiationPanel, NegotiationSummary } from "@/components/unit-negotiation/negotiation-panel";
import { isOpenOffer } from "@shared/unit-negotiation";
import { BrandInput, type BrandValue } from "./brand-input";
import { MICRO_LABEL, money, serverMessage, shortDay, todayIso, typedNumber } from "./format";

interface OfferRow {
  id: string; companyName: string | null; contactName: string | null; offerDate: string | null; status: string | null;
  rentPa: number | null; rentFreeMonths: number | null; termYears: number | null; breakOption: string | null;
  incentives: string | null; premium: number | null; fittingOutContribution: number | null; comments: string | null;
  own?: boolean;                    // set for a joint agent: their own login logged this offer
}
interface Form {
  brand: BrandValue; contactName: string; offerDate: string; rentPa: string; rentFreeMonths: string; termYears: string;
  breakOption: string; premium: string; fittingOutContribution: string; incentives: string; comments: string;
}
const NUMBER_FIELDS = ["rentPa", "rentFreeMonths", "termYears", "premium", "fittingOutContribution"] as const;
const emptyForm = (): Form => ({ brand: { id: null, name: "" }, contactName: "", offerDate: todayIso(), rentPa: "", rentFreeMonths: "", termYears: "", breakOption: "", premium: "", fittingOutContribution: "", incentives: "", comments: "" });
const str = (v: number | null | undefined) => (v != null ? String(v) : "");
const isAgreed = (s: string | null | undefined) => /^(agreed|accepted)$/i.test(String(s || ""));
const statusTone = (s: string | null | undefined): string =>
  isAgreed(s) ? "border-emerald-600/60 text-emerald-700 dark:text-emerald-400"
    : /^(rejected|withdrawn|closed)$/i.test(String(s || "")) ? "border-border text-muted-foreground"
    : s === "Negotiating" ? "border-amber-500/60 text-amber-700 dark:text-amber-400" : "border-border text-foreground";

export function OffersDialog({ unit, startAdding, onClose, onChanged, onMoveToNegotiating, onOpenHots, onOpenRecommendation }: {
  unit: { id: string; unitName: string; propertyName: string } | null;
  startAdding?: boolean;            // open with the Add offer form showing
  onClose: () => void;
  onChanged: () => void;
  onMoveToNegotiating: () => void;  // the negotiation log offers to move the unit to Negotiating
  onOpenHots: () => void;           // the unit's Heads of Terms
  onOpenRecommendation: () => void; // the unit's transaction recommendation
}) {
  const { toast } = useToast();
  const unitId = unit?.id || "";
  const key = ["/api/available-units", unitId, "offers"];
  const { data: rows = [], isLoading, error } = useQuery<OfferRow[]>({
    queryKey: key,
    queryFn: async () => {
      const r = await fetch(`/api/available-units/${unitId}/offers`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || "The offers could not be loaded");
      const json = await r.json();
      return Array.isArray(json) ? json : [];
    },
    enabled: !!unitId,
  });
  // The brands already named on the unit (id and name): the only brands an
  // offer logged here can be linked to.
  const { data: unitBrands = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/unit-offers/unit", unitId, "brands"],
    queryFn: async () => {
      const r = await fetch(`/api/unit-offers/unit/${unitId}/brands`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      const json = await r.json();
      return Array.isArray(json) ? json : [];
    },
    enabled: !!unitId,
    staleTime: 30_000,
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OfferRow | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [negotiationId, setNegotiationId] = useState<string | null>(null);
  useEffect(() => { setForm(emptyForm()); setEditing(null); setFormError(null); setNegotiationId(null); setFormOpen(!!startAdding); }, [unitId, startAdding]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ["/api/unit-offers/unit", unitId] });
    queryClient.invalidateQueries({ queryKey: ["/api/leasing-viewings"] });
    onChanged();
  };
  const closeForm = () => { setFormOpen(false); setEditing(null); setForm(emptyForm()); setFormError(null); };
  const startEdit = (o: OfferRow) => {
    setForm({
      brand: { id: null, name: o.companyName || "" }, contactName: o.contactName || "", offerDate: o.offerDate || todayIso(),
      rentPa: str(o.rentPa), rentFreeMonths: str(o.rentFreeMonths), termYears: str(o.termYears), breakOption: o.breakOption || "",
      premium: str(o.premium), fittingOutContribution: str(o.fittingOutContribution), incentives: o.incentives || "", comments: o.comments || "",
    });
    setEditing(o); setFormError(null); setFormOpen(true);
  };
  // The contact and comments on an offer another login logged are not ours
  // to see or change.
  const ownFields = !editing || editing.own !== false;
  const badNumber = NUMBER_FIELDS.find(k => Number.isNaN(typedNumber(form[k])));

  const save = async () => {
    if (busy || !unitId || badNumber) return;
    if (!editing && !form.brand.name.trim() && !form.contactName.trim()) { setFormError("Name the brand making the offer."); return; }
    const body: Record<string, unknown> = {
      companyName: form.brand.name.trim() || null, offerDate: form.offerDate,
      breakOption: form.breakOption.trim() || null, incentives: form.incentives.trim() || null,
    };
    if (form.brand.id && unitBrands.some(b => b.id === form.brand.id)) body.companyId = form.brand.id;
    if (ownFields) { body.contactName = form.contactName.trim() || null; body.comments = form.comments.trim() || null; }
    // On add, an empty figure is left out; on edit it clears the stored one.
    for (const k of NUMBER_FIELDS) {
      const n = typedNumber(form[k]);
      if (n != null) body[k] = n;
      else if (editing) body[k] = null;
    }
    setBusy(true); setFormError(null);
    try {
      if (editing) await apiRequest("PATCH", `/api/available-units/offers/${editing.id}`, body);
      else await apiRequest("POST", `/api/available-units/${unitId}/offers`, body);
      toast({ title: editing ? "Offer saved" : "Offer logged" });
      closeForm();
      refresh();
    } catch (e) {
      setFormError(serverMessage(e, "The offer could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (o: OfferRow) => {
    if (!window.confirm(`Delete the offer from ${o.companyName || "this brand"}? Its negotiation history goes with it.`)) return;
    setRemoving(o.id);
    try {
      await apiRequest("DELETE", `/api/available-units/offers/${o.id}`);
      if (negotiationId === o.id) setNegotiationId(null);
      refresh();
    } catch (e) {
      toast({ title: "The offer could not be deleted", description: serverMessage(e, ""), variant: "destructive" });
    } finally {
      setRemoving(null);
    }
  };

  const numberInput = (k: (typeof NUMBER_FIELDS)[number], testId: string) => (
    <Input value={form[k]} onChange={e => set(k, e.target.value)} inputMode="decimal" placeholder="0"
      className={`font-mono tabular-nums ${Number.isNaN(typedNumber(form[k])) ? "border-destructive" : ""}`} disabled={busy} data-testid={testId} />
  );

  return (
    <Dialog open={!!unit} onOpenChange={v => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="ja-offers-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><HandCoins className="h-5 w-5 shrink-0" /> Offers</DialogTitle>
          <DialogDescription className="truncate">{unit ? `${unit.unitName} · ${unit.propertyName}` : ""}</DialogDescription>
        </DialogHeader>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{serverMessage(error, "The offers could not be loaded.")}</p>}
        {!isLoading && !error && rows.length === 0 && !formOpen && <p className="py-4 text-center text-sm text-muted-foreground">No offers yet.</p>}

        {rows.length > 0 && (
          <ul className="space-y-2" data-testid="ja-offers-list">
            {rows.map(o => (
              <li key={o.id} className="min-w-0 space-y-1 rounded-lg border border-border p-3 text-sm" data-testid={`ja-offer-row-${o.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 font-medium">
                    {o.companyName || o.contactName || "No brand named"}
                    {o.contactName && o.companyName && <span className="ml-2 text-xs font-normal text-muted-foreground">({o.contactName})</span>}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${statusTone(o.status)}`}>{o.status === "Accepted" ? "Agreed" : (o.status || "Pending")}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{shortDay(o.offerDate)}</span>
                    {/* An agreed, rejected or withdrawn offer is changed by reopening it in its negotiation log. */}
                    {isOpenOffer(o.status) && (
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" aria-label="Edit offer" title="Edit offer" onClick={() => startEdit(o)} data-testid={`ja-offer-edit-${o.id}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {!isAgreed(o.status) && (
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" disabled={removing === o.id} aria-label="Delete offer" title="Delete offer" onClick={() => remove(o)} data-testid={`ja-offer-delete-${o.id}`}>
                        {removing === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3">
                  {o.rentPa != null && <div><span className="text-muted-foreground">Rent: </span><span className="font-mono tabular-nums">{money(o.rentPa)}</span> a year</div>}
                  {o.rentFreeMonths != null && <div><span className="text-muted-foreground">Rent free: </span><span className="font-mono tabular-nums">{o.rentFreeMonths}</span> months</div>}
                  {o.termYears != null && <div><span className="text-muted-foreground">Term: </span><span className="font-mono tabular-nums">{o.termYears}</span> years</div>}
                  {o.breakOption && <div><span className="text-muted-foreground">Break: </span>{o.breakOption}</div>}
                  {o.premium != null && <div><span className="text-muted-foreground">Premium: </span><span className="font-mono tabular-nums">{money(o.premium)}</span></div>}
                  {o.fittingOutContribution != null && <div><span className="text-muted-foreground">Capital contribution: </span><span className="font-mono tabular-nums">{money(o.fittingOutContribution)}</span></div>}
                </div>
                {o.incentives && <p className="text-xs"><span className="text-muted-foreground">Incentives: </span>{o.incentives}</p>}
                {o.comments && <p className="text-xs text-muted-foreground break-words">{o.comments}</p>}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setNegotiationId(negotiationId === o.id ? null : o.id)} aria-expanded={negotiationId === o.id} data-testid={`ja-offer-negotiation-${o.id}`}>
                    {negotiationId === o.id ? "Hide the negotiation" : "Negotiation"}
                  </Button>
                  {isAgreed(o.status) && (
                    <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={onOpenRecommendation} data-testid={`ja-offer-recommendation-${o.id}`}>Transaction recommendation</Button>
                  )}
                  {negotiationId !== o.id && <span className="text-[11px] text-muted-foreground"><NegotiationSummary unitId={unitId} offerId={o.id} /></span>}
                </div>
                {negotiationId === o.id && (
                  <div className="mt-2 min-w-0 border-t border-border pt-3">
                    <NegotiationPanel offerId={o.id} onChanged={refresh} onMoveToNegotiating={onMoveToNegotiating} onGenerateHots={onOpenHots} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {formOpen ? (
          <div className="space-y-3 rounded-lg border border-border p-3" data-testid="ja-offer-form">
            <p className="text-sm font-medium">{editing ? "Edit offer" : "Log an offer"}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block min-w-0"><span className={MICRO_LABEL}>Brand</span>
                <BrandInput value={form.brand} onChange={v => set("brand", v)} options={unitBrands} placeholder="Brand making the offer" disabled={busy} testId="ja-offer-brand" />
              </label>
              {ownFields && (
                <label className="block min-w-0"><span className={MICRO_LABEL}>Contact</span>
                  <Input value={form.contactName} onChange={e => set("contactName", e.target.value)} placeholder="Who the offer came from" disabled={busy} data-testid="ja-offer-contact" />
                </label>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block min-w-0"><span className={MICRO_LABEL}>Date</span>
                <Input type="date" className="min-w-0" value={form.offerDate} onChange={e => set("offerDate", e.target.value)} disabled={busy} data-testid="ja-offer-date" />
              </label>
              <label className="block min-w-0"><span className={MICRO_LABEL}>Rent, £ a year</span>{numberInput("rentPa", "ja-offer-rent")}</label>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block min-w-0"><span className={MICRO_LABEL}>Rent free, months</span>{numberInput("rentFreeMonths", "ja-offer-rent-free")}</label>
              <label className="block min-w-0"><span className={MICRO_LABEL}>Term, years</span>{numberInput("termYears", "ja-offer-term")}</label>
              <label className="block min-w-0"><span className={MICRO_LABEL}>Break</span>
                <Input value={form.breakOption} onChange={e => set("breakOption", e.target.value)} placeholder="e.g. Year 5" disabled={busy} data-testid="ja-offer-break" />
              </label>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block min-w-0"><span className={MICRO_LABEL}>Premium, £</span>{numberInput("premium", "ja-offer-premium")}</label>
              <label className="block min-w-0"><span className={MICRO_LABEL}>Capital contribution, £</span>{numberInput("fittingOutContribution", "ja-offer-fitout")}</label>
            </div>
            <label className="block"><span className={MICRO_LABEL}>Other incentives</span>
              <Input value={form.incentives} onChange={e => set("incentives", e.target.value)} disabled={busy} data-testid="ja-offer-incentives" />
            </label>
            {ownFields && (
              <label className="block"><span className={MICRO_LABEL}>Comments</span>
                <Textarea value={form.comments} onChange={e => set("comments", e.target.value)} rows={2} disabled={busy} data-testid="ja-offer-comments" />
              </label>
            )}
            {badNumber && <p className="text-xs text-destructive">The figures are numbers, for example 95000.</p>}
            {formError && <p className="text-sm text-destructive" role="alert" data-testid="ja-offer-error">{formError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={closeForm}>Cancel</Button>
              <Button size="sm" disabled={busy || !form.offerDate || !!badNumber} onClick={save} data-testid="ja-offer-save">
                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {busy ? "Saving…" : editing ? "Save" : "Log offer"}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full" onClick={() => { setEditing(null); setForm(emptyForm()); setFormError(null); setFormOpen(true); }} data-testid="ja-offer-add">
            <Plus className="mr-1 h-3.5 w-3.5" /> Log an offer
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
