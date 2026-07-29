import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Sparkles, Mail, BarChart3, Newspaper } from "lucide-react";

const NAV_ITEMS = [
  { label: "Home", icon: LayoutDashboard, path: "/" },
  { label: "ChatBGP", icon: Sparkles, path: "/chatbgp" },
  { label: "Mail", icon: Mail, path: "/mail" },
  { label: "Deals", icon: BarChart3, path: "/deals" },
  { label: "News", icon: Newspaper, path: "/news" },
] as const;

export function MobileBottomNav() {
  const [location, navigate] = useLocation();
  // Client logins have no Microsoft 365 access, so the Mail tab would just
  // show a connect screen that can never work — hide it for them.
  const { data: navUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const items = (navUser?.role === "Client" || !!(navUser as any)?.companyScopeId)
    ? NAV_ITEMS.filter((i) => i.label !== "Mail")
    : NAV_ITEMS;

  const isActive = (path: string) => {
    if (path === "/") return location === "/";
    return location.startsWith(path);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      data-testid="mobile-bottom-nav"
    >
      <div className="flex items-center justify-around h-14">
        {items.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] min-h-[44px] px-2 py-1.5 rounded-lg transition-colors ${
                active ? "text-foreground" : "text-muted-foreground"
              }`}
              data-testid={`bottom-nav-${item.label.toLowerCase()}`}
            >
              <Icon className="w-[22px] h-[22px]" />
              <span className="text-[10px] font-semibold">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Paths that are handled by the bottom nav bar.
 * These should not show the standard mobile header back button behavior
 * and instead just display in the content area above the bottom nav.
 */
export const BOTTOM_NAV_PATHS = ["/", "/chatbgp", "/mail", "/deals", "/news"];
