// A joint agent's viewings calendar (Woody, 2026-11-12: joint agents have
// full control of the letting work on their instructed schemes, and no
// access to the brand pages). The same calendar and conversion report BGP
// uses, in its joint agent mode: every viewing at the schemes on their login,
// BGP's included, fed only by /api/leasing-viewings. The brand's contact and
// its agent are typed names; nothing here reads BGP's CRM. An offer recorded
// from a viewing goes through the tracker's own offer route and carries on in
// the unit's negotiation log.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { ViewingRecord } from "@shared/viewing-workflow";
import { LeasingViewings } from "@/components/leasing-viewings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { NoteFill } from "@/components/letting-note/note-fill";
import { noteDay, noteFigure, noteText, withNote } from "@/components/landsec-tracker/format";
import type { LettingNoteReading } from "@shared/letting-note";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const emptyOffer = () => ({ offerDate: londonToday(), rentPa: "", termYears: "", rentFreeMonths: "", breakOption: "", premium: "", fittingOutContribution: "", turnoverRentPct: "", rentReview: "", rentDeposit: "", incentives: "", comments: "" });
const OFFER_FIGURES = ["rentPa", "termYears", "rentFreeMonths", "premium", "fittingOutContribution", "turnoverRentPct"] as const;
const OFFER_WORDS = ["breakOption", "rentReview", "rentDeposit", "incentives"] as const;
// A typed figure as a number, or null when the box is empty or not a number.
const figure = (value: string) => { const n = Number(value.replace(/[£,\s]/g, "")); return value.trim() && Number.isFinite(n) ? n : null; };

export default function LandsecViewings() {
  const { toast } = useToast();
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const jointAgent = me?.landsecRole === "joint_agent";
  const [view, setView] = useState<"viewings" | "reports">("viewings");
  // A task or an email opens one viewing: /landsec/viewings?viewingId=<id>.
  const [focusedViewingId, setFocusedViewingId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("viewingId"));
  const [offerFor, setOfferFor] = useState<ViewingRecord | null>(null);
  const [offer, setOffer] = useState(emptyOffer);
  useEffect(() => { if (focusedViewingId) setView("viewings"); }, [focusedViewingId]);

  const clearFocus = () => {
    setFocusedViewingId(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has("viewingId")) { url.searchParams.delete("viewingId"); window.history.replaceState(null, "", `${url.pathname}${url.search}`); }
  };

  const recordOffer = useMutation({
    mutationFn: async () => {
      if (!offerFor?.unitId) throw new Error("This viewing has no unit");
      return (await apiRequest("POST", `/api/available-units/${offerFor.unitId}/offers`, {
        viewingId: offerFor.id, offerDate: offer.offerDate, rentPa: figure(offer.rentPa), termYears: figure(offer.termYears),
        rentFreeMonths: figure(offer.rentFreeMonths), breakOption: offer.breakOption.trim() || null,
        premium: figure(offer.premium), fittingOutContribution: figure(offer.fittingOutContribution), turnoverRentPct: figure(offer.turnoverRentPct),
        rentReview: offer.rentReview.trim() || null, rentDeposit: offer.rentDeposit.trim() || null,
        incentives: offer.incentives.trim() || null, comments: offer.comments.trim() || null,
      })).json();
    },
    onSuccess: async () => {
      setOfferFor(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/leasing-viewings"] }),
        queryClient.invalidateQueries({ predicate: query => String(query.queryKey[0] || "").startsWith("/api/landsec/") }),
      ]);
      toast({ title: "Offer recorded", description: "It is on the unit in your tracker, where its negotiation carries on." });
    },
    onError: (error: Error) => toast({ title: "Could not record the offer", description: error.message, variant: "destructive" }),
  });

  if (!me) return <div className="p-4 md:p-6"><Skeleton className="h-64 rounded-lg" /></div>;
  if (!jointAgent) {
    const restricted = !!me.landsecRole && me.landsecRole !== "leasing_manager";
    return (
      <div className="p-4 md:p-6 space-y-2" data-testid="landsec-viewings">
        <h1 className="text-2xl font-bold tracking-tight">Viewings</h1>
        <p className="text-sm text-muted-foreground">
          This is the viewings calendar for a joint agent login.{" "}
          {!restricted && <Link href="/available?tab=viewings" className="underline hover:text-foreground">Yours is on the Letting Tracker.</Link>}
        </p>
      </div>
    );
  }

  const set = (key: keyof ReturnType<typeof emptyOffer>) => (e: { target: { value: string } }) => setOffer(current => ({ ...current, [key]: e.target.value }));
  // A read note fills the terms and saves nothing. The brand and the contact
  // are the viewing's, so whatever the note says about them is not used.
  const applyNote = (reading: LettingNoteReading) => {
    const f = reading?.fields || {};
    setOffer(current => {
      const next = { ...current };
      const day = noteDay(f.date);
      if (day) next.offerDate = day;
      for (const key of OFFER_FIGURES) { const n = noteFigure(f[key]); if (n != null) next[key] = n; }
      for (const key of OFFER_WORDS) { const words = noteText(f[key]); if (words) next[key] = words; }
      next.comments = withNote(current.comments, noteText(f.note, 4000));
      return next;
    });
  };
  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="landsec-viewings">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Viewings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Every viewing at your schemes: book one, complete its details, report what happened and record the offer that follows.</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Pill active={view === "viewings"} aria-pressed={view === "viewings"} onClick={() => setView("viewings")} data-testid="landsec-viewings-calendar">Calendar</Pill>
        <Pill active={view === "reports"} aria-pressed={view === "reports"} onClick={() => setView("reports")} data-testid="landsec-viewings-reports">Reports</Pill>
      </div>
      <LeasingViewings
        mode={view}
        units={[]}
        isClient
        jointAgent
        currentUserId={me.id ? String(me.id) : undefined}
        focusedViewingId={focusedViewingId}
        onFocusHandled={clearFocus}
        onRecordOffer={viewing => { setOffer(emptyOffer()); setOfferFor(viewing); }}
      />
      <Dialog open={!!offerFor} onOpenChange={open => { if (!open) setOfferFor(null); }}>
        <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record offer</DialogTitle>
            <DialogDescription>
              {[offerFor?.companyName, [offerFor?.unitName, offerFor?.propertyName].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "The offer that followed this viewing"}. The brand and the contact are taken from the viewing.
            </DialogDescription>
          </DialogHeader>
          {offerFor?.unitId && <NoteFill key={offerFor.id} kind="offer" unitId={offerFor.unitId} onApply={applyNote} />}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5 sm:col-span-1"><Label htmlFor="landsec-offer-date" className={labelClass}>Offer date</Label><Input id="landsec-offer-date" type="date" value={offer.offerDate} onChange={set("offerDate")} data-testid="landsec-offer-date" /></div>
            <div className="col-span-2 space-y-1.5 sm:col-span-1"><Label htmlFor="landsec-offer-rent" className={labelClass}>Rent, £ a year</Label><Input id="landsec-offer-rent" inputMode="decimal" className="font-mono tabular-nums" value={offer.rentPa} onChange={set("rentPa")} placeholder="For example 85,000" data-testid="landsec-offer-rent" /></div>
            <div className="space-y-1.5"><Label htmlFor="landsec-offer-term" className={labelClass}>Term, years</Label><Input id="landsec-offer-term" inputMode="decimal" className="font-mono tabular-nums" value={offer.termYears} onChange={set("termYears")} data-testid="landsec-offer-term" /></div>
            <div className="space-y-1.5"><Label htmlFor="landsec-offer-rent-free" className={labelClass}>Rent free, months</Label><Input id="landsec-offer-rent-free" inputMode="decimal" className="font-mono tabular-nums" value={offer.rentFreeMonths} onChange={set("rentFreeMonths")} data-testid="landsec-offer-rent-free" /></div>
            <div className="col-span-2 space-y-1.5"><Label htmlFor="landsec-offer-break" className={labelClass}>Break option</Label><Input id="landsec-offer-break" value={offer.breakOption} onChange={set("breakOption")} placeholder="For example: tenant break at year 5" data-testid="landsec-offer-break" /></div>
            <div className="col-span-2 space-y-1.5 sm:col-span-1"><Label htmlFor="landsec-offer-premium" className={labelClass}>Premium, £</Label><Input id="landsec-offer-premium" inputMode="decimal" className="font-mono tabular-nums" value={offer.premium} onChange={set("premium")} data-testid="landsec-offer-premium" /></div>
            <div className="col-span-2 space-y-1.5 sm:col-span-1"><Label htmlFor="landsec-offer-fitout" className={labelClass}>Capital contribution, £</Label><Input id="landsec-offer-fitout" inputMode="decimal" className="font-mono tabular-nums" value={offer.fittingOutContribution} onChange={set("fittingOutContribution")} data-testid="landsec-offer-fitout" /></div>
            <div className="col-span-2 space-y-1.5 sm:col-span-1"><Label htmlFor="landsec-offer-turnover" className={labelClass}>Turnover rent, %</Label><Input id="landsec-offer-turnover" inputMode="decimal" className="font-mono tabular-nums" value={offer.turnoverRentPct} onChange={set("turnoverRentPct")} data-testid="landsec-offer-turnover" /></div>
            <div className="col-span-2 space-y-1.5 sm:col-span-1"><Label htmlFor="landsec-offer-rent-deposit" className={labelClass}>Rent deposit</Label><Input id="landsec-offer-rent-deposit" value={offer.rentDeposit} onChange={set("rentDeposit")} placeholder="For example: 6 months" data-testid="landsec-offer-rent-deposit" /></div>
            <div className="col-span-2 space-y-1.5"><Label htmlFor="landsec-offer-rent-review" className={labelClass}>Rent review</Label><Input id="landsec-offer-rent-review" value={offer.rentReview} onChange={set("rentReview")} placeholder="For example: year 5, upward only" data-testid="landsec-offer-rent-review" /></div>
            <div className="col-span-2 space-y-1.5"><Label htmlFor="landsec-offer-incentives" className={labelClass}>Incentives</Label><Input id="landsec-offer-incentives" value={offer.incentives} onChange={set("incentives")} data-testid="landsec-offer-incentives" /></div>
            <div className="col-span-2 space-y-1.5"><Label htmlFor="landsec-offer-comments" className={labelClass}>Comments</Label><Textarea id="landsec-offer-comments" rows={3} value={offer.comments} onChange={set("comments")} data-testid="landsec-offer-comments" /></div>
          </div>
          <p className="text-[11px] text-muted-foreground">The offer starts as pending. Counter-offers, agreeing it and the Heads of Terms are on the unit in your tracker.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOfferFor(null)} data-testid="landsec-offer-cancel">Cancel</Button>
            <Button size="sm" disabled={recordOffer.isPending || !offer.offerDate} onClick={() => recordOffer.mutate()} data-testid="landsec-offer-save">{recordOffer.isPending ? "Saving…" : "Record offer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
