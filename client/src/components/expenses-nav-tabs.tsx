// Shared tab strip rendered at the top of the three admin expense
// pages so they feel like one tabbed view instead of three sidebar
// entries. Pages keep their own URLs (Wendy's bookmark to
// /expenses/approvals still works) — we just collapsed the sidebar.
import { Link, useLocation } from "wouter";

// Cards & Revolut was folded into 'All expenses' — the Cardholders table
// there now shows card type + last 4, and the Spend by Cardholder rows
// expand to the per-person breakdown. The /expenses/revolut route still
// works (used for one-time bootstrap + webhook register) but it doesn't
// need a tab anymore.
const TABS = [
  { label: "All expenses", href: "/expenses" },
  { label: "Approvals", href: "/expenses/approvals" },
];

export function ExpensesNavTabs() {
  const [location] = useLocation();
  return (
    <div className="border-b border-border/60 mb-4">
      <nav className="flex gap-1">
        {TABS.map((t) => {
          const active = location === t.href || (t.href === "/expenses" && location === "/expenses/");
          return (
            <Link
              key={t.href}
              href={t.href}
              className={
                "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors " +
                (active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
              data-testid={`expenses-tab-${t.href}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
