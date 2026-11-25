// The A to Z letters down the right of a list (Woody, 25 November 2026: "on the
// right side can you put letters alphabetic so can click and search companies
// and also transactions"). Pressing a letter shows only the names under it;
// pressing it again, or All, shows them all again. A letter with nothing under
// it is greyed and does nothing. The rule for a name's letter is
// shared/letter-index.ts.
import type { ReactNode } from "react";
import { INDEX_LETTERS, type IndexLetter } from "@shared/letter-index";
import { cn } from "@/lib/utils";

// A list with the letters beside it. On a computer the letters sit in the
// page's right margin, so a table keeps its full width (the AML table's Agents
// column must not run off a 1440px screen); on a phone, beside the cards.
export function WithLetterRail({ rail, children, testId }: { rail: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <div className="relative flex items-start gap-1 md:block" data-testid={testId}>
      <div className="min-w-0 flex-1">{children}</div>
      <div className="shrink-0 self-stretch md:absolute md:inset-y-0 md:-right-6 md:w-6">{rail}</div>
    </div>
  );
}

export function LetterRail({ counts, active, onPick, testId }: {
  counts: Record<IndexLetter, number>;
  active: IndexLetter | null;
  onPick: (letter: IndexLetter | null) => void;
  testId?: string;
}) {
  const id = (l: IndexLetter) => (testId ? `${testId}-${l === "#" ? "num" : l}` : undefined);
  return (
    <nav aria-label="Letters" data-compact-taps
      className="sticky top-2 z-10 flex w-6 shrink-0 flex-col items-center rounded-full border bg-background/95 py-1 shadow-sm"
      data-testid={testId}>
      <button type="button" onClick={() => onPick(null)} aria-pressed={!active} title="Show every letter"
        className={cn("mb-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-semibold leading-none", !active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
        data-testid={testId ? `${testId}-all` : undefined}>All</button>
      {INDEX_LETTERS.map(l => {
        const n = counts[l] || 0;
        const on = active === l;
        return (
          <button key={l} type="button" disabled={!n && !on} onClick={() => onPick(on ? null : l)} aria-pressed={on}
            title={n ? `${n} under ${l}` : `Nothing under ${l}`}
            className={cn("flex h-[15px] w-5 items-center justify-center rounded-full text-[10px] font-semibold leading-none",
              on ? "bg-primary text-primary-foreground" : n ? "text-foreground hover:bg-muted" : "cursor-default text-muted-foreground/40")}
            data-testid={id(l)}>{l}</button>
        );
      })}
    </nav>
  );
}
