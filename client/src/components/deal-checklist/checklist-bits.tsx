// Small shared pieces for the deal checklist screen.
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { pillMetrics } from "@/components/ui/pill";
import { CHECKLIST_SIDES, type ChecklistSide, type DealChecklist } from "@shared/deal-checklist";

// What a write answers with: the fresh checklist, and for an assignment
// whether a task was made and whether the email went.
export type ChecklistWriteResult = DealChecklist & { emailed?: boolean; emailError?: string | null; taskCreated?: boolean; selfAssigned?: boolean };

export const MICRO_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
export const AMBER_TEXT = "text-amber-700 dark:text-amber-400";
export const EMERALD_TEXT = "text-emerald-700 dark:text-emerald-400";

const TONES = {
  neutral: "border-border text-muted-foreground",
  ink: "border-border text-foreground",
  amber: "border-amber-500/60 text-amber-700 dark:text-amber-400",
  emerald: "border-emerald-600/60 text-emerald-700 dark:text-emerald-400",
} as const;

// A state chip in the pill standard's metrics (a label, not a control).
export function Chip({ tone = "neutral", className, children, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof TONES }) {
  return (
    <span className={cn(pillMetrics, "border max-w-full", TONES[tone], className)} {...props}>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export const sideLabel = (side: ChecklistSide | null | undefined): string => CHECKLIST_SIDES.find(s => s.key === side)?.label || "";

// "17 Dec 2025", from a timestamp or a plain yyyy-mm-dd date.
export const fmtDate = (d: string | null | undefined): string => {
  if (!d) return "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

// Today as yyyy-mm-dd, to compare with a due date.
export const todayIso = (): string => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

// apiRequest throws "409: the server's message".
export const serverMessage = (e: unknown, fallback: string): string =>
  (e instanceof Error ? e.message.replace(/^\d{3}:\s*/, "") : "") || fallback;
export const statusOf = (e: unknown): number => {
  const m = e instanceof Error ? e.message.match(/^(\d{3}):/) : null;
  return m ? Number(m[1]) : 0;
};
