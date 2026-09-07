import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import type { CrmCompany } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { EntityCombobox } from "@/components/entity-combobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

interface Finding {
  id: number;
  contact_id: string;
  contact_name: string;
  contact_email?: string | null;
  live_company_name: string | null;
  current_company_name: string | null;
  suggested_company_name: string | null;
  reasoning: string | null;
  brand_links?: { id: string; name: string; source: "requirement" | "representation" }[];
}

const PAGE_SIZE = 6;
const message = (error: Error) => error.message.replace(/^\d{3}:\s*/, "");

export function ContactDataHealth() {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<Finding | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const returnFocus = useRef<HTMLElement | null>(null);
  const queueButton = useRef<HTMLButtonElement>(null);
  const queue = useQuery<{ pending: Finding[] } | null>({
    queryKey: ["/api/crm/data-health", "v2"],
    queryFn: async () => {
      try { return await (await apiRequest("GET", "/api/crm/data-health")).json(); }
      catch (error) {
        if (error instanceof Error && /^(401|403):/.test(error.message)) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    refetchInterval: false,
  });
  const companies = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies"], enabled: !!review,
    refetchInterval: false,
  });
  const options = useMemo(() => (companies.data || []).filter(c => !c.mergedIntoId).map(c => ({
    id: c.id, label: c.name,
    subLabel: [c.companyType, c.domain].filter(Boolean).join(" · "),
    keywords: [c.id, c.domain || ""],
  })), [companies.data]);
  const exact = options.filter(c => c.label.trim().toLowerCase() === review?.suggested_company_name?.trim().toLowerCase());
  const selectedId = choice ?? (exact.length === 1 ? exact[0].id : "");
  const selected = options.find(c => c.id === selectedId);
  const pending = queue.data?.pending || [];
  const filtered = pending.filter(row => [row.contact_name, row.contact_email, row.live_company_name, row.suggested_company_name,
    ...(row.brand_links || []).map(b => b.name)].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);

  const act = useMutation({
    mutationFn: async ({ finding, action }: { finding: Finding; action: "apply" | "dismiss" }) => {
      const result = await apiRequest("POST", `/api/crm/data-health/${finding.id}/${action}`, action === "apply" ? { companyId: selectedId } : {});
      return result.json();
    },
    onSuccess: (result, { action }) => {
      toast({ title: action === "apply" ? `Employer saved: ${result.linkedCompany}` : "Finding dismissed" });
      setReview(null); setChoice(null);
      void queryClient.invalidateQueries({ queryKey: ["/api/crm/data-health"] });
      if (action === "apply") {
        void queryClient.invalidateQueries({ predicate: query => {
          const path = String(query.queryKey[0]);
          return ["/api/crm/contacts", "/api/crm/companies", "/api/brand", "/api/client/agent-directory", "/api/company-portfolio"].some(prefix => path.startsWith(prefix));
        } });
      }
    },
  });

  function show(finding: Finding | null) {
    returnFocus.current = document.activeElement as HTMLElement;
    act.reset(); setReview(finding); setChoice(null); setOpen(true);
  }
  function close(value: boolean) {
    if (act.isPending) return;
    setOpen(value);
    if (!value) { setReview(null); setChoice(null); act.reset(); }
  }
  function focusBack(event: Event) {
    event.preventDefault();
    const target = returnFocus.current?.isConnected ? returnFocus.current : queueButton.current;
    target?.focus();
  }
  function brandLinks(finding: Finding, compact = false) {
    const byBrand = new Map<string, { id: string; name: string; sources: string[] }>();
    for (const link of finding.brand_links || []) {
      const brand = byBrand.get(link.id) || { id: link.id, name: link.name, sources: [] };
      const source = link.source === "requirement" ? "Current requirement" : "Recorded representation";
      if (!brand.sources.includes(source)) brand.sources.push(source);
      byBrand.set(link.id, brand);
    }
    const links = [...byBrand.values()];
    if (!links.length) return <p className="text-[11px] text-muted-foreground">No current agent-to-brand link recorded.</p>;
    return <div className="text-sm" data-testid="dh-brand-links">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Represents</p>
      {(compact ? links.slice(0, 2) : links).map(brand => <div key={brand.id} className="flex flex-wrap items-center gap-x-2">
        <Link href={`/companies/${brand.id}`} className="inline-flex min-h-11 items-center font-medium hover:underline break-words" onClick={() => close(false)}>{brand.name}</Link>
        <span className="text-[11px] text-muted-foreground">{brand.sources.join(" · ")}</span>
      </div>)}
      {compact && links.length > 2 && <p className="text-[11px] text-muted-foreground">More brand links in employer review.</p>}
    </div>;
  }
  function row(finding: Finding) {
    return <article key={finding.id} className="min-w-0 rounded-lg border border-border p-3 space-y-2" data-testid={`dh-finding-${finding.id}`}>
      <Link href={`/contacts/${finding.contact_id}`} className="inline-flex min-h-11 items-center text-sm font-semibold hover:underline break-words" onClick={() => close(false)}>{finding.contact_name}</Link>
      <p className="text-sm break-words"><span className="text-muted-foreground">Recorded employer: </span>{finding.live_company_name || "Not recorded"}</p>
      <p className="text-sm break-words"><span className="text-muted-foreground">Suggested employer: </span>{finding.suggested_company_name || "Needs review"}</p>
      {brandLinks(finding, true)}
      <Button variant="outline" size="sm" className="min-h-11" onClick={() => show(finding)} data-testid={`dh-review-${finding.id}`}>Review employer</Button>
    </article>;
  }
  const list = <div className="space-y-4">
    <Input aria-label="Search employer reviews" placeholder="Search people, employers or brands…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="min-h-11" />
    {queue.isError && <p role="alert" className="text-sm text-destructive">Could not refresh the queue. <Button variant="ghost" onClick={() => void queue.refetch()}>Retry</Button></p>}
    <div className="space-y-3">{filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(row)}</div>
    {!filtered.length && <p role="status" className="py-6 text-center text-sm text-muted-foreground">{pending.length ? "No reviews match your search." : "No employer reviews need attention."}</p>}
    {pageCount > 1 && <div className="flex items-center justify-between gap-2">
      <Button variant="outline" size="sm" className="min-h-11" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft className="w-4 h-4 mr-1" />Previous</Button>
      <span className="text-[11px] font-mono tabular-nums">{currentPage} / {pageCount}</span>
      <Button variant="outline" size="sm" className="min-h-11" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next<ChevronRight className="w-4 h-4 ml-1" /></Button>
    </div>}
  </div>;
  const editor = review && <div className="space-y-4" data-testid="dh-employer-editor">
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <p className="text-sm"><span className="text-muted-foreground">Recorded employer: </span>{review.live_company_name || "Not recorded"}</p>
      <p className="text-sm"><span className="text-muted-foreground">Suggested employer: </span>{review.suggested_company_name || "Needs review"}</p>
      {review.contact_email && <p className="text-sm break-all text-muted-foreground">{review.contact_email}</p>}
      <p className="text-sm text-muted-foreground break-words">{review.reasoning}</p>
    </div>
    {brandLinks(review)}
    <p className="text-sm text-muted-foreground">Choose their employer. Existing brand and requirement links will be kept.</p>
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Employer in CRM</p>
      <EntityCombobox items={options} value={selectedId} onChange={setChoice} loading={companies.isLoading} disabled={companies.isLoading || companies.isError || act.isPending} allowClear={false}
        placeholder="Choose employer" searchPlaceholder="Search CRM companies…" emptyText="No matching company in CRM." testId="dh-employer-picker" className="[&>button]:min-h-11" />
      {companies.isError ? <p className="text-sm text-destructive" role="alert">Could not load companies. <Button variant="ghost" onClick={() => void companies.refetch()}>Retry</Button></p>
        : <p className="text-[11px] text-muted-foreground">If the employer is missing, leave this review pending until its company record has been added.</p>}
    </div>
    <Link href={`/contacts/${review.contact_id}`} onClick={() => close(false)} className="inline-flex min-h-11 items-center text-sm underline">Open contact record</Link>
  </div>;
  const errorNotice = act.isError && <div role="alert" className="shrink-0 rounded-lg border border-destructive p-3 text-sm text-destructive" data-testid="dh-save-error">
      <p>{message(act.error)}</p><Button variant="outline" className="mt-2 min-h-11" onClick={() => { act.reset(); setReview(null); setChoice(null); void queue.refetch(); }}>Refresh queue</Button>
    </div>;
  const actions = review && <div className="shrink-0 flex flex-wrap justify-end gap-2 border-t border-border bg-background pt-3">
      <Button variant="ghost" className="min-h-11" disabled={act.isPending} onClick={() => { setReview(null); act.reset(); }}>Back</Button>
      <Button variant="outline" className="min-h-11" disabled={act.isPending} onClick={() => act.mutate({ finding: review, action: "dismiss" })}>Dismiss finding</Button>
      <Button className="min-h-11" disabled={!selected || companies.isError || act.isPending} onClick={() => act.mutate({ finding: review, action: "apply" })} data-testid="dh-save-employer">{act.isPending ? "Saving…" : "Save employer"}</Button>
    </div>;
  const title = review ? "Review employer" : "Employer reviews";
  const description = review ? review.contact_name : "One current finding per person. Search people, employers or brands.";
  const contents = review ? editor : list;

  if (!open && queue.isLoading) return <Skeleton className="h-24 w-full rounded-lg" aria-label="Loading employer reviews" />;
  if (!open && queue.isError) return <Card><CardContent className="p-4 flex items-center justify-between gap-3"><p className="text-sm" role="alert">Employer reviews could not load.</p><Button variant="outline" onClick={() => void queue.refetch()}>Retry</Button></CardContent></Card>;
  if (!pending.length && !open) return null;
  return <>
    <Card data-testid="data-health-queue">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0 text-primary" />Employer reviews <span className="font-mono tabular-nums" data-testid="dh-count">{pending.length}</span></h2>
          <Button ref={queueButton} variant="outline" size="sm" className="min-h-11" onClick={() => show(null)} data-testid="dh-show-all">Show all <span className="font-mono tabular-nums">{pending.length}</span></Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Check where these people work. Brand representation is recorded separately.</p>
        <div className="grid gap-3 md:grid-cols-3">{pending.slice(0, isMobile ? 1 : 3).map(row)}</div>
      </CardContent>
    </Card>
    {isMobile ? <Sheet open={open} onOpenChange={close}><SheetContent side="bottom" className="flex flex-col max-h-[90dvh] rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" onCloseAutoFocus={focusBack}>
      <SheetHeader className="shrink-0 text-left pr-8"><SheetTitle>{title}</SheetTitle><SheetDescription>{description}</SheetDescription></SheetHeader><div className="min-h-0 overflow-y-auto">{contents}</div>{errorNotice}{actions}
    </SheetContent></Sheet> : <Dialog open={open} onOpenChange={close}><DialogContent className="flex flex-col max-w-2xl max-h-[85dvh]" onCloseAutoFocus={focusBack}>
      <DialogHeader className="shrink-0 pr-6"><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><div className="min-h-0 overflow-y-auto">{contents}</div>{errorNotice}{actions}
    </DialogContent></Dialog>}
  </>;
}
