import { useLocation } from "wouter";
import { LayoutDashboard, Sparkles, Building2, BarChart3, Menu } from "lucide-react";

const NAV_ITEMS = [
  { label: "Home", icon: LayoutDashboard, path: "/" },
  { label: "ChatBGP", icon: Sparkles, path: "/chatbgp" },
  { label: "Properties", icon: Building2, path: "/properties" },
  { label: "Deals", icon: BarChart3, path: "/deals" },
  { label: "More", icon: Menu, path: "__more__" },
] as const;

export function MobileBottomNav({ onMoreTap }: { onMoreTap: () => void }) {
  const [location, navigate] = useLocation();

  const isActive = (path: string) => {
    if (path === "__more__") return false;
    if (path === "/") return location === "/";
    return location.startsWith(path);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-background border-t border-border/60 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      data-testid="mobile-bottom-nav"
    >
      <div className="flex items-center justify-around h-14">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              onClick={() => {
                if (item.path === "__more__") {
                  onMoreTap();
                } else {
                  navigate(item.path);
                }
              }}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] min-h-[44px] px-2 py-1.5 rounded-lg transition-colors ${
                active
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground"
              }`}
              data-testid={`bottom-nav-${item.label.toLowerCase()}`}
            >
              <Icon className={`w-[22px] h-[22px] ${active ? "text-emerald-600 dark:text-emerald-400" : ""}`} />
              <span className={`text-[10px] font-semibold ${active ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
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
export const BOTTOM_NAV_PATHS = ["/", "/chatbgp", "/properties", "/deals"];
