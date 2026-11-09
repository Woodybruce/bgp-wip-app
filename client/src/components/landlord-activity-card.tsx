import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Matching, compact entrances to the landlord's correspondence and diary. */
export function LandlordActivityCard({ title, icon, count, children, footer, onOpen, actionLabel, testId }: {
  title: string; icon: ReactNode; count?: string; children: ReactNode; footer?: ReactNode;
  onOpen: () => void; actionLabel: string; testId: string;
}) {
  return <section className="min-w-0 rounded-xl border border-border bg-background/70 flex flex-col" data-testid={testId}>
    <div className="px-4 pt-3.5 pb-2 flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</h3>
      {count && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
    </div>
    <div className="px-4 pb-3 space-y-3 flex-1 min-w-0">{children}</div>
    <div className="border-t border-border/60 px-4 py-2 flex items-center justify-between gap-2">
      <div className="text-xs text-muted-foreground min-w-0">{footer}</div>
      <Button variant="ghost" size="sm" className="shrink-0 h-8 px-2" onClick={onOpen}>{actionLabel}</Button>
    </div>
  </section>;
}
