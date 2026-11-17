// Landlord, agent firm and lender pages in the brand page's shape (Woody,
// 2026-11-15: "Company pages yes", then "Yes to all" on the design): a
// summary card, the conversation as one line, then pills that show one
// section at a time. brand-profile-panel.tsx owns the data and hands the
// pieces in; this file is the frame they sit in.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Target } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { StartStrategyDialog } from "@/components/crm-engagement/start-strategy";
import { BandHeading } from "@/components/brand-page/brand-top";
import type { EngagementData } from "@shared/crm-engagement";
import { crmEngagementLink, landlordEngagementView } from "@shared/landlord-engagement-view";

export type CompanySection = { key: string; label: string; count?: number | null; body: React.ReactNode };
type Built = { top: React.ReactNode; sections: CompanySection[]; foot?: React.ReactNode };

// One section shows at a time and the open one is kept in the address
// (?section=people), so a link can land on it. Changing section replaces the
// history entry: it is never a step for Back. A section is drawn the first
// time it is opened and then kept, so its lists and maps keep their state.
// Mount it with key={companyId}: another company starts on its first section.
export function CompanyKindPage({ testId, children }: { testId: string; children: (select: (key: string) => void) => Built }) {
  const [asked, setAsked] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("section") || "");
  const [opened, setOpened] = useState<string[]>([]);
  const select = (key: string) => {
    setAsked(key);
    setOpened(keys => keys.includes(key) ? keys : [...keys, key]);
    const url = new URL(window.location.href);
    url.searchParams.set("section", key);
    window.history.replaceState(window.history.state, "", url);
  };
  const { top, sections, foot } = children(select);
  const current = sections.find(section => section.key === asked)?.key || sections[0]?.key;
  return (
    <div className="flex flex-col gap-3 w-full min-w-0 [container-type:inline-size]" data-testid={testId}>
      {top}
      <div className="sticky top-0 z-20 -mx-1 px-1 py-2 flex flex-wrap items-center gap-1.5 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85" data-testid="company-sections">
        {sections.map(section => (
          <Pill key={section.key} active={section.key === current} aria-pressed={section.key === current} onClick={() => select(section.key)} data-testid={`company-section-${section.key}`}>
            {section.label}{section.count ? <span className="font-mono tabular-nums">{section.count.toLocaleString("en-GB")}</span> : null}
          </Pill>
        ))}
      </div>
      {sections.map(section => (section.key === current || opened.includes(section.key)) && (
        <div key={section.key} className={section.key === current ? "grid grid-cols-1 gap-3 min-w-0 [@container(min-width:900px)]:gap-4" : "hidden"} data-company-section={section.key}>
          {section.body}
        </div>
      ))}
      {foot}
    </div>
  );
}

// Two cards side by side on a wide page; a card on its own takes the row.
export const companyPair = "grid grid-cols-1 gap-3 items-start [@container(min-width:900px)]:grid-cols-2 [@container(min-width:900px)]:gap-4 [&>*:only-child]:col-span-full empty:hidden";
export const companyStack = "grid grid-cols-1 gap-3 min-w-0 content-start empty:hidden";

// The summary card: About, the relationship in figures and, for BGP staff,
// where the account stands. Each column after the first is ruled off; a
// column that is not given is not drawn.
export function CompanySummaryCard({ about, figuresTitle, figures, figuresNote, where }: {
  about: React.ReactNode; figuresTitle: string; figures?: React.ReactNode; figuresNote?: React.ReactNode; where?: React.ReactNode;
}) {
  const three = !!figures && !!where;
  const two = !three && (!!figures || !!where);
  // Three columns on a wide card. On a middling one About takes the first
  // row and the figures sit beside "Where we are" under it; narrower, one
  // column.
  const grid = three ? "[@container(min-width:640px)]:grid-cols-2 [@container(min-width:900px)]:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,4fr)]"
    : two ? "[@container(min-width:640px)]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : "";
  const aboutSpan = three ? "[@container(min-width:640px)]:col-span-2 [@container(min-width:900px)]:col-span-1" : "";
  const side = "border-t border-border pt-3 [@container(min-width:640px)]:border-t-0 [@container(min-width:640px)]:pt-0 [@container(min-width:640px)]:border-l [@container(min-width:640px)]:pl-6";
  const figuresRule = three
    ? "border-t border-border pt-3 [@container(min-width:900px)]:border-t-0 [@container(min-width:900px)]:pt-0 [@container(min-width:900px)]:border-l [@container(min-width:900px)]:pl-6"
    : side;
  const whereRule = three
    ? "border-t border-border pt-3 [@container(min-width:640px)]:border-l [@container(min-width:640px)]:pl-6 [@container(min-width:900px)]:border-t-0 [@container(min-width:900px)]:pt-0"
    : side;
  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm p-3 min-w-0 [container-type:inline-size]" data-testid="company-summary-card">
      <div className={`grid gap-x-6 gap-y-3 ${grid}`}>
        <div className={`min-w-0 space-y-2 ${aboutSpan}`} data-testid="company-summary-about">{about}</div>
        {figures && (
          <div className={`min-w-0 space-y-2 ${figuresRule}`} data-testid="company-summary-figures">
            <BandHeading>{figuresTitle}</BandHeading>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">{figures}</div>
            {figuresNote}
          </div>
        )}
        {where && <div className={`min-w-0 space-y-2 ${whereRule}`}>{where}</div>}
      </div>
    </div>
  );
}

// The CRM plan card asks for the same record under the same key, so the page
// makes one request. The Super Brand star reads it too.
export function useEngagement(companyId: string) {
  return useQuery<EngagementData>({
    queryKey: ["/api/crm/engagement", { companyId }],
    queryFn: async () => (await apiRequest("GET", `/api/crm/engagement?companyId=${encodeURIComponent(companyId)}`)).json(),
    staleTime: 60_000, retry: false, refetchInterval: false,
  });
}

const dueDay = (value: string | null) => value && Number.isFinite(new Date(value).getTime())
  ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) : null;

// "Where we are" (BGP staff only: the plan is refused to every other login):
// who at BGP has the account, when BGP was last in touch, the next CRM action
// and the strategy it is on. Read from the records; nothing is typed here.
export function CompanyWhereWeAre({ companyId, owners, lastContact, onOpenPlan }: {
  companyId: string; owners: string[]; lastContact: string | null; onOpenPlan: () => void;
}) {
  const query = useEngagement(companyId);
  const view = query.data ? landlordEngagementView(query.data, companyId) : null;
  const next = view?.actions[0];
  const more = view ? view.actions.length - 1 : 0;
  const line = (label: string, value: React.ReactNode, testId: string) => (
    <p className="text-sm leading-snug min-w-0" data-testid={testId}><span className="text-muted-foreground">{label}</span> <span className="text-foreground">{value}</span></p>
  );
  const none = (text: string) => <span className="text-muted-foreground">{text}</span>;
  return (
    <div className="space-y-2 min-w-0" data-testid="company-where-we-are">
      <BandHeading>Where we are</BandHeading>
      <div className="space-y-1.5">
        {line("BGP owner", owners.length ? `${owners.slice(0, 2).join(", ")}${owners.length > 2 ? ` +${owners.length - 2}` : ""}` : none("not set"), "company-where-owner")}
        {line("Last contact", lastContact || none("none on record"), "company-where-last-contact")}
        {line("Next action", query.isLoading ? none("…") : query.isError ? none("could not be loaded") : next
          ? <><button type="button" className="text-left hover:underline underline-offset-2" onClick={onOpenPlan} data-testid="button-where-next-action">{next.title}</button>
              {(next.ownerName || dueDay(next.dueAt)) && <span className="text-muted-foreground"> · {[next.ownerName, dueDay(next.dueAt) && `due ${dueDay(next.dueAt)}`].filter(Boolean).join(" · ")}</span>}
              {more > 0 && <span className="text-muted-foreground"> · +<span className="font-mono tabular-nums">{more}</span> more</span>}</>
          : none("none open"), "company-where-next-action")}
        {line("Strategy", query.isLoading ? none("…") : view?.strategies.length
          ? view.strategies.map((strategy, index) => <span key={strategy.id}>{index > 0 && ", "}<Link href={crmEngagementLink(companyId, { strategy: strategy.id })} className="hover:underline underline-offset-2">{strategy.name}</Link></span>)
          : none("none yet"), "company-where-strategy")}
      </div>
    </div>
  );
}

// Start strategy on the page's header line: BGP staff, on a company that is
// on no running strategy. The kick-off dialog is the CRM page's own.
export function CompanyStartStrategy({ companyId, companyName, variant = "default" }: { companyId: string; companyName: string; variant?: "default" | "outline" }) {
  const [, navigate] = useLocation();
  const [starting, setStarting] = useState(false);
  const query = useEngagement(companyId);
  const view = query.data ? landlordEngagementView(query.data, companyId) : null;
  if (!view || view.strategies.length) return null;
  return <>
    <Button size="sm" variant={variant} onClick={() => setStarting(true)} data-testid="button-header-start-strategy"><Target />Start strategy</Button>
    {starting && <StartStrategyDialog company={{ id: companyId, name: companyName }} onClose={() => setStarting(false)}
      onStarted={strategyId => navigate(`/contacts?tab=overview&strategy=${encodeURIComponent(strategyId)}`)} />}
  </>;
}
