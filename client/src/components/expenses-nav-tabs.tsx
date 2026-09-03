// Shared tab strip rendered at the top of the three admin expense
// pages so they feel like one tabbed view instead of three sidebar
// entries. Pages keep their own URLs (Wendy's bookmark to
// /expenses/approvals still works) — we just collapsed the sidebar.
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { pillMetrics, pillActive, pillInactive } from "@/components/ui/pill";

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
  // Live count of what's in the current user's approval queue, so the
  // Approvals tab carries a badge (e.g. "Approvals 5"). Without this the
  // queue had zero discoverability — Wendy lands on /my-expenses, sees
  // nothing, and assumes there's nothing to approve.
  const { data: pending = [] } = useQuery<any[]>({
    queryKey: ["/api/expenses/pending-approval"],
    refetchInterval: 60_000,
  });
  // "All expenses" is the admin page (/expenses is AdminRoute-gated) —
  // non-admin approvers on /expenses/approvals only get their own tab.
  const { data: me } = useQuery<{ isAdmin?: boolean } | null>({ queryKey: ["/api/auth/me"] });
  const tabs = me?.isAdmin ? TABS : TABS.filter((t) => t.href !== "/expenses");

  return (
    <div className="mb-4">
      <nav className="flex flex-wrap gap-1.5">
        {tabs.map((t) => {
          const active = location === t.href || (t.href === "/expenses" && location === "/expenses/");
          const badge = t.href === "/expenses/approvals" && pending.length > 0 ? pending.length : null;
          return (
            <Link
              key={t.href}
              href={t.href}
              data-no-min-touch
              className={cn(pillMetrics, active ? pillActive : pillInactive)}
              data-testid={`expenses-tab-${t.href}`}
            >
              {t.label}
              {badge != null && (
                <span className="text-[10px] min-w-[16px] px-1 rounded-full bg-amber-500 text-white font-semibold font-mono normal-case flex items-center justify-center">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
