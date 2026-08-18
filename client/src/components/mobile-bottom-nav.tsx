import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, MessageCircle, Sparkles, BarChart3, Newspaper, CheckSquare } from "lucide-react";

// ChatBGP replaced Mail in the tab bar (Woody, 2026-08-18) — the sparkle
// always starts a FRESH AI chat; Mail lives on via the Dashboard tile at
// /mail. The tile dashboard stays at "/", the unified chat list at /messages.
const NAV_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/" },
  { label: "Messages", icon: MessageCircle, path: "/messages" },
  { label: "ChatBGP", icon: Sparkles, path: "/chatbgp" },
  { label: "Deals", icon: BarChart3, path: "/deals" },
  { label: "News", icon: Newspaper, path: "/news" },
] as const;

const CLIENT_NAV_ITEMS = [
  { label: "Portfolio", icon: LayoutDashboard, path: "/" },
  { label: "Messages", icon: MessageCircle, path: "/messages" },
  { label: "Deals", icon: BarChart3, path: "/deals" },
  { label: "Tasks", icon: CheckSquare, path: "/tasks" },
  { label: "News", icon: Newspaper, path: "/news" },
] as const;

export function MobileBottomNav() {
  const [location, navigate] = useLocation();
  const { data: navUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const items = (navUser?.role === "Client" || !!(navUser as any)?.companyScopeId)
    ? CLIENT_NAV_ITEMS
    : NAV_ITEMS;
  // Unread badge on Messages — same feed the desktop sidebar uses.
  const { data: navNotifications } = useQuery<{ unseenCount: number }>({
    queryKey: ["/api/chat/notifications"],
    enabled: !!navUser,
    refetchInterval: 20000,
  });
  const unseen = navNotifications?.unseenCount || 0;

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
              onClick={() => {
                if (item.path === "/chatbgp") {
                  // The sparkle always means "new chat": clear the restored-
                  // thread marker (fresh mount) and tell an already-mounted
                  // chat screen to reset to the greeting.
                  try {
                    sessionStorage.removeItem("mobile-chat-thread");
                    sessionStorage.removeItem("mobile-chat-thread-ai");
                  } catch {}
                  window.dispatchEvent(new Event("chatbgp-new-chat"));
                }
                navigate(item.path);
              }}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] min-h-[44px] px-2 py-1.5 rounded-lg transition-colors ${
                active ? "text-foreground" : "text-muted-foreground"
              }`}
              data-testid={`bottom-nav-${item.label.toLowerCase()}`}
            >
              <span className="relative">
                <Icon className="w-[22px] h-[22px]" />
                {item.label === "Messages" && unseen > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none" data-testid="badge-messages-unseen">
                    {unseen > 99 ? "99+" : unseen}
                  </span>
                )}
              </span>
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
export const BOTTOM_NAV_PATHS = ["/", "/home", "/messages", "/chatbgp", "/mail", "/deals", "/news", "/tasks"];
