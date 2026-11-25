// One build for every AML screen (Woody, 24 November 2026, of the client KYC
// window: "can we use this as the template and make them match?", then "one
// build for AML ... we dont want loads of things looking differently or built
// separately"). The pieces every AML and KYC screen draws with: the Next box,
// the step lines, the chips, the label and value list, the company as the
// register gives it, and the screening lines. The transaction's Parties & AML
// box (deal-aml-status.tsx), the client KYC window (client-kyc/client-kyc-dialog.tsx),
// the AML page's Transactions and Companies views (pages/aml-dashboard.tsx,
// kyc-companies/companies-view.tsx), the Companies and KYC card
// (account-entities-panel.tsx) and the CRM lists' KYC chip all use them. Each
// step's words come from one rule, shared/aml-steps.ts. Add a look here, never
// a second copy on a screen.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Clock, ExternalLink, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { AML_STAGE_LABEL, amlDealStatusWords, type AmlStage } from "@shared/aml-dashboard";
import { DEAL_STATUS_COLORS } from "@shared/deal-status";
import { amlNextTone, type AmlStepState } from "@shared/aml-steps";
import type { PrecheckCardLine, PrecheckCompany } from "@shared/kyc-prechecks";

// ── Chips ───────────────────────────────────────────────────────────────────

/** The size every AML and KYC chip is drawn at. */
export const AML_CHIP_BASE = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap";
const CHIP = AML_CHIP_BASE;

export const AML_STAGE_TONE: Record<AmlStage, string> = {
  not_started: "bg-muted text-muted-foreground",
  bgp_checked: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  client_sent: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  joint_asked: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  joint_in: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200",
  client_finished: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200",
  relied: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200",
  with_kyc4u: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  expiring: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  expired: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  not_required: "bg-muted text-muted-foreground",
};

// A company's KYC in a few words (shared/client-kyc.ts clientKycWords, shared/kyc-companies.ts).
export type KycChipTone = "ok" | "warn" | "bad" | "none";
export const KYC_CHIP_TONE: Record<KycChipTone, string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  bad: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  none: "bg-muted text-muted-foreground",
};

export function AmlChip({ className, title, testId, children, onClick }: {
  className: string; title?: string; testId?: string; children: ReactNode; onClick?: (e: React.MouseEvent) => void;
}) {
  if (onClick) {
    return <button type="button" data-no-min-touch data-view-ok className={cn(CHIP, className, "hover:opacity-90")} title={title} data-testid={testId} onClick={onClick}>{children}</button>;
  }
  return <span className={cn(CHIP, className)} title={title} data-testid={testId}>{children}</span>;
}

const chipDay = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "");

/** Where a party's checks stand, in the AML page's words. */
export function AmlStageChip({ stage, expiresAt, testId }: { stage: AmlStage; expiresAt?: string | null; testId?: string }) {
  return <AmlChip className={AML_STAGE_TONE[stage]} testId={testId}>{stage === "expiring" && expiresAt ? `Expires ${chipDay(expiresAt)}` : AML_STAGE_LABEL[stage]}</AmlChip>;
}

/** Past the point BGP's policy (Issue 4) needs the checks by, and not decided. */
export function AmlLateChip({ deadline, testId }: { deadline?: string | null; testId?: string }) {
  return <AmlChip className={KYC_CHIP_TONE.bad} title={deadline ? `Needed ${deadline}` : undefined} testId={testId}>Late</AmlChip>;
}

/** A company's KYC: "KYC cleared", "KYC 2 of 5", "No KYC". */
export function KycStatusChip({ label, tone, title, testId }: { label: string; tone: KycChipTone; title?: string; testId?: string }) {
  return <AmlChip className={KYC_CHIP_TONE[tone]} title={title} testId={testId}>{label}</AmlChip>;
}

/** The transaction's own status, in the Transactions board's words and colours. */
export function DealStatusChip({ status, dealType, testId }: { status: string | null | undefined; dealType?: string | null; testId?: string }) {
  const { code, words } = amlDealStatusWords({ dealStatus: status || null, dealType: dealType || null });
  if (!words) return null;
  return <AmlChip className={code ? DEAL_STATUS_COLORS[code] : "bg-muted text-muted-foreground"} testId={testId}>{words}</AmlChip>;
}

export const LEVEL_CHIP_WORDS = { simplified: "Simplified (SDD)", standard: "Standard", enhanced: "Enhanced" } as const;
/** The level of due diligence when it is not standard. */
export function AmlLevelChip({ level, title, testId }: { level: "simplified" | "standard" | "enhanced"; title?: string; testId?: string }) {
  if (level === "standard") return null;
  return <AmlChip className={level === "enhanced" ? KYC_CHIP_TONE.warn : KYC_CHIP_TONE.ok} title={title} testId={testId}>{LEVEL_CHIP_WORDS[level]}</AmlChip>;
}

/** The red flags as a count; pressing it opens them where the screen can. */
export function RedFlagChip({ count, onClick, testId }: { count: number; onClick?: (e: React.MouseEvent) => void; testId?: string }) {
  if (!count) return null;
  return <AmlChip className={KYC_CHIP_TONE.bad} onClick={onClick} testId={testId}><Flag className="h-3 w-3" />{count} red flag{count === 1 ? "" : "s"}</AmlChip>;
}

// ── The Next box ────────────────────────────────────────────────────────────

const NEXT_TONE = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  act: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  wait: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
  bad: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
} as const;

/** What happens next, in a few words, with at most one button on the right. */
export function AmlNextBox({ tone, lead, words, action, who, testId, wordsTestId, className }: {
  tone: "done" | "act" | "flag" | "wait" | "ok" | "bad"; lead: string; words?: string | null; action?: ReactNode;
  // Read out before the lead for a screen reader ("Waiting on BGP").
  who?: string; testId?: string; wordsTestId?: string; className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm", NEXT_TONE[amlNextTone(tone)], className)} data-testid={testId}>
      <span className="min-w-0 flex-1 basis-40 leading-snug" data-testid={wordsTestId}>
        {who && <span className="sr-only">{who}: </span>}
        <span className="font-semibold">{lead}</span>{words ? <> · {words}</> : null}
      </span>
      {action && <span className="ml-auto flex flex-wrap items-center gap-1.5">{action}</span>}
    </div>
  );
}

// ── The steps ───────────────────────────────────────────────────────────────

/** A green tick when done, red for a red flag, otherwise the step's number (or a dot). */
export function AmlStepIcon({ n, state }: { n?: number; state: AmlStepState }) {
  const base = "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold";
  if (state === "done") return <span className={cn(base, "bg-emerald-600 text-white")} data-state="done"><CheckCircle2 className="h-3.5 w-3.5" /></span>;
  if (state === "flag") return <span className={cn(base, "bg-red-600 text-white")} data-state="flag"><Flag className="h-3 w-3" /></span>;
  return <span className={cn(base, "border border-border text-muted-foreground")} data-state="todo">{n ?? <span className="h-1.5 w-1.5 rounded-full bg-current" />}</span>;
}

/** One step: its name and a line in grey (red for a red flag); the detail opens under it. */
export function AmlStep({ id, n, label, state, summary, open, onToggle, children, testId }: {
  id?: string; n?: number; label: string; state: AmlStepState; summary: ReactNode; open: boolean; onToggle: () => void; children?: ReactNode; testId: string;
}) {
  return (
    <section id={id} className="scroll-mt-4 border-t border-border first:border-t-0" data-testid={testId}>
      <button type="button" data-view-ok onClick={onToggle} aria-expanded={open} data-testid={`${testId}-toggle`}
        className="flex w-full items-center gap-2 rounded py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <AmlStepIcon n={n} state={state} />
        {/* On a phone the line sits under the name, so it has the width. */}
        <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-2">
          <span className="block text-sm font-medium sm:shrink-0">{label}</span>
          <span className={cn("block min-w-0 break-words text-xs", state === "flag" ? "text-red-700 dark:text-red-400" : "text-muted-foreground")}>{summary}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-3 pb-3 pl-7" data-testid={`${testId}-detail`}>{children}</div>}
    </section>
  );
}

// ── A label and value list ──────────────────────────────────────────────────

export function AmlFactList({ children, testId, className }: { children: ReactNode; testId?: string; className?: string }) {
  return <dl className={cn("grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs", className)} data-testid={testId}>{children}</dl>;
}

export function AmlFact({ label, children, testId, tone }: { label: ReactNode; children: ReactNode; testId?: string; tone?: "warn" | "bad" }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-words", tone === "warn" && "text-amber-800 dark:text-amber-300", tone === "bad" && "text-red-700 dark:text-red-400")} data-testid={testId}>{children}</dd>
    </>
  );
}

// ── The company, as the register gives it ───────────────────────────────────

/** Every fact BGP's checks read about the company, in one list. testKey keeps each row's test id. */
export function CompanyFactsList({ company: c, testKey }: { company: PrecheckCompany; testKey: string }) {
  const [more, setMore] = useState(false);
  const directors = more ? c.directors : c.directors.slice(0, 4);
  const ids = (c.identity || []);
  return (
    <AmlFactList testId={`kyc-company-${testKey}`}>
      <AmlFact label="Registered name">
        <a href={c.registerUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{c.name}</a>
        {c.number && <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">{c.number}</span>}
      </AmlFact>
      {c.status && <AmlFact label="Status">{c.status}</AmlFact>}
      {c.type && <AmlFact label="Type">{c.type}</AmlFact>}
      {c.incorporatedOn && <AmlFact label="Incorporated">{c.incorporatedOn}</AmlFact>}
      {c.warnings.map(w => <dd key={w} className="col-span-2 text-red-700 dark:text-red-400">{w}</dd>)}
      {c.registeredOffice && <AmlFact label="Registered office">{c.registeredOffice}</AmlFact>}
      {c.business.length > 0 && <AmlFact label="Business">{c.business.join("; ")}</AmlFact>}
      {c.listing && <AmlFact label="Listed" testId={`kyc-company-listing-${testKey}`}>{c.listing}.{c.listingNote ? ` ${c.listingNote}` : ""}</AmlFact>}
      {c.overseasEntity && <AmlFact label={/^An overseas entity/.test(c.overseasEntity) ? "Overseas entity" : "Incorporated abroad"} testId={`kyc-company-overseas-${testKey}`}>{c.overseasEntity}</AmlFact>}
      {c.home && <AmlFact label="Home register" testId={`kyc-company-home-${testKey}`}>{c.home}</AmlFact>}
      {directors.length > 0 && (
        <AmlFact label="Directors">
          {directors.join(", ")}
          {c.directors.length > 4 && <button type="button" data-view-ok className="ml-1 text-primary hover:underline" onClick={() => setMore(m => !m)}>{more ? "fewer" : `and ${c.directors.length - 4} more`}</button>}
        </AmlFact>
      )}
      {c.owners.length > 0 && <AmlFact label="Owners">{c.owners.map(o => `${o.name}${o.control ? ` (${o.control})` : ""}`).join("; ")}</AmlFact>}
      {c.ownerNote && <AmlFact label={c.owners.length ? "" : "Owners"}>{c.ownerNote}</AmlFact>}
      {c.chain.length > 0 && <AmlFact label="Owned through">{c.chain.join(" › ")}</AmlFact>}
      {c.accounts && <AmlFact label="Latest accounts">{c.accounts}</AmlFact>}
      {c.trading && (
        <AmlFact label="Trading" testId={`kyc-company-trading-${testKey}`}>{c.trading.words || (c.trading.trading ? "Yes: it files trading accounts" : "Not shown: no accounts filed yet")}</AmlFact>
      )}
      {ids.length > 0 && (
        <AmlFact label="ID verified at Companies House" testId={`kyc-company-idv-${testKey}`}>
          {ids.map((i, n) => (
            <span key={`${i.name}-${n}`} className={i.state === "overdue" ? "text-red-700 dark:text-red-400" : i.state === "verified" ? "" : "text-muted-foreground"}>
              {n ? "; " : ""}{i.name}: {i.state === "verified" ? "yes" : i.words}
            </span>
          ))}
          <span className="text-muted-foreground">. Information only: BGP still checks identity itself.</span>
        </AmlFact>
      )}
      {c.documents.some(d => d.onFile) && <AmlFact label="On the KYC record">{c.documents.filter(d => d.onFile).map(d => d.title).join("; ")}</AmlFact>}
      {c.gleif && <AmlFact label="GLEIF" testId={`kyc-company-gleif-${testKey}`}>{c.gleif.replace(/^GLEIF:\s*/, "")}</AmlFact>}
    </AmlFactList>
  );
}

// ── Screening ───────────────────────────────────────────────────────────────

/** One line of BGP's checks before asking: its icon, its name and what it found. */
// A line that only says what was done or found (GLEIF, who was screened,
// namesakes set against the bars) is a green tick, as a clear check is: only
// an issue looks like one (Woody, 25 November 2026: "it looks like they are a
// problem ... better just to be a green tick ... all we care about is a issue").
export function AmlCheckLine({ line }: { line: PrecheckCardLine }) {
  const icon = line.state === "attention" ? <Flag className="h-3.5 w-3.5 text-amber-600" />
    : line.failed ? <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
    : line.state === "not_run" ? <Clock className="h-3.5 w-3.5 text-muted-foreground" />
    : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  return (
    <li className="flex items-start gap-2 text-xs" data-testid={`aml-check-${line.key}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 break-words">
        <span className={cn("font-medium", line.failed && "text-amber-800 dark:text-amber-300")}>{line.label}</span>
        {line.detail && <span className="text-muted-foreground"> · {line.detail}</span>}
        {line.links.map(l => (
          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-primary hover:underline">{l.label}<ExternalLink className="h-3 w-3" /></a>
        ))}
      </span>
    </li>
  );
}

/** The lines in order: what needs a look first. */
export function AmlCheckLines({ lines, only, testId }: { lines: PrecheckCardLine[]; only?: string[]; testId?: string }) {
  const rank = (l: PrecheckCardLine) => (l.state === "attention" ? 0 : l.failed ? 1 : l.state === "not_run" ? 2 : 3);
  const shown = lines.filter(l => !only || only.includes(l.key)).sort((a, b) => rank(a) - rank(b));
  if (!shown.length) return null;
  return <ul className="space-y-1" data-testid={testId}>{shown.map(l => <AmlCheckLine key={l.key} line={l} />)}</ul>;
}

/** Run again, and the level of due diligence with why, on one line. */
export function AmlScreeningHead({ action, level, testId }: {
  action?: ReactNode; level?: { level: string; why: string[]; toWeigh?: string[] } | null; testId?: string;
}) {
  const bare = (t: string) => t.trim().replace(/\.$/, "");
  const why = level ? (level.level === "enhanced" ? `because of: ${level.why.map(bare).join("; ")}` : bare(level.why[0] || "")) : "";
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={testId}>
      {action}
      {level && (
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">
          Due diligence: <span className="font-medium text-foreground">{level.level}</span>{why ? ` · ${why}` : ""}
          {level.toWeigh && level.toWeigh.length > 0 && <> · to weigh: {level.toWeigh.map(bare).join("; ")}</>}
        </span>
      )}
    </div>
  );
}

// ── Cards (Woody, 24 November 2026: "can we have a cards view of the AML checks? like we do with CRM") ──

const CARD_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

/**
 * One card in the CRM lists' look: a title with chips beside it, a grey line, labelled rows, a footer.
 * On a computer every card is one height (Woody, 24 November 2026: "can you sort the cards so they all
 * the same size and add scroll within as required"): the title and the footer stay put and the rows
 * scroll inside the card, with a fade while more is below. 288px fits about three cards in four on live
 * (measured that day: transactions 145 to 378px, companies 187 to 315px). A phone keeps each card's own
 * height: one column, and no scroll box inside the page's.
 */
export function AmlCard({ title, sub, chips, rows, footer, onOpen, selected, testId }: {
  title: ReactNode; sub?: ReactNode; chips?: ReactNode; rows: Array<[string, ReactNode]>; footer?: ReactNode;
  onOpen: () => void; selected?: boolean; testId?: string;
}) {
  const body = useRef<HTMLDListElement>(null);
  const [more, setMore] = useState(false);
  const check = () => { const el = body.current; if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 2); };
  // After every render (the rows may have changed), on scrolling, and when the card changes size.
  useEffect(check);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    el.addEventListener("scroll", check, { passive: true });
    const seen = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    seen?.observe(el);
    return () => { el.removeEventListener("scroll", check); seen?.disconnect(); };
  }, []);
  return (
    <div role="link" tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className={cn("flex min-w-0 cursor-pointer flex-col gap-2.5 overflow-hidden rounded-xl border border-card-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-72",
        selected && "ring-2 ring-primary")}
      data-testid={testId}>
      <div className="flex shrink-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="break-words font-semibold leading-snug">{title}</div>
          {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
        </div>
        {chips && <div className="flex shrink-0 flex-col items-end gap-1">{chips}</div>}
      </div>
      <div className="relative min-h-0 flex-1">
        <dl ref={body} className="grid h-full grid-cols-[auto_minmax(0,1fr)] content-start gap-x-3 gap-y-1.5 overflow-y-auto text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className={cn(CARD_LABEL, "pt-0.5")}>{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {more && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-card to-transparent" />}
      </div>
      {footer && <div className="shrink-0 border-t border-border pt-2 text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}

/** Cards in the CRM lists' grid, with Show more past a page. */
export function AmlCardGrid<T>({ items, render, page = 90, testId }: { items: T[]; render: (item: T) => ReactNode; page?: number; testId?: string }) {
  const [shown, setShown] = useState(page);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid={testId}>{items.slice(0, shown).map(render)}</div>
      {items.length > shown && (
        <div className="text-center">
          <button type="button" data-view-ok className="rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted" onClick={() => setShown(n => n + page)} data-testid={testId ? `${testId}-more` : undefined}>
            Show more ({(items.length - shown).toLocaleString("en-GB")} left)
          </button>
        </div>
      )}
    </div>
  );
}

// Table or cards, remembered for each list in this browser (the CRM lists' way).
export type AmlListView = "table" | "card";
export function storedAmlView(key: string, fallback: AmlListView = "table"): AmlListView {
  try { const v = window.localStorage.getItem(`bgp_aml_view_${key}`); return v === "card" || v === "table" ? v : fallback; } catch { return fallback; }
}
export function storeAmlView(key: string, view: AmlListView) {
  try { window.localStorage.setItem(`bgp_aml_view_${key}`, view); } catch { /* the choice lasts for this visit only */ }
}
