import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, MessageCircle, BarChart3, Newspaper, CheckSquare, Store, Handshake, Target, Layers, Eye, Building2 } from "lucide-react";
import { useKeyboardOpen } from "@/hooks/use-mobile";
import { useBrand } from "@/lib/brand-context";
import { LANDSEC_MENU, LANDSEC_RESTRICTED_MENU, LANDSEC_STAFF_TASKS, landsecMenuActive, openTaskCount } from "@shared/landsec-menu";

// ChatBGP tab REMOVED (Woody, 2026-08-22: "it's the same thing as
// Messages") — supersedes the 2026-08-18 decision that put it there.
// ChatBGP is still one tap away: the pinned row at the top of Messages,
// and the "Ask ChatBGP" button on the Dashboard home.
const NAV_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/" },
  { label: "Messages", icon: MessageCircle, path: "/messages" },
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

// Landsec's phone tabs follow its menu (docs/landsec-menu-plan-2026-11-12.md,
// part 1): Properties, Deals, Tracker, Tasks, Brands and Chat. Chat opens
// Messages, where ChatBGP is the pinned row. Tasks is every Landsec role's
// (Woody, 2026-11-13), with the number of open tasks on it.
const LANDSEC_NAV_ITEMS = [
  { label: "Properties", icon: Building2, path: LANDSEC_MENU.properties },
  { label: "Deals", icon: BarChart3, path: LANDSEC_MENU.deals },
  { label: "Tracker", icon: Store, path: LANDSEC_MENU.tracker },
  { label: "Tasks", icon: CheckSquare, path: LANDSEC_MENU.tasks },
  { label: "Brands", icon: Handshake, path: LANDSEC_MENU.brands },
  { label: "Chat", icon: MessageCircle, path: LANDSEC_MENU.chat },
] as const;

// BGP staff viewing as Landsec keep a Home tab in place of Brands: the tile
// home at "/" carries the banner that takes them out of the Landsec view ("a
// phone stuck in Landsec view has no way back", Woody, 7 Aug). Their Tasks
// tab is their own My Tasks.
const LANDSEC_STAFF_NAV_ITEMS = [
  { label: "Home", icon: LayoutDashboard, path: "/" },
  ...LANDSEC_NAV_ITEMS.filter(i => i.label !== "Brands").map(i => (i.label === "Tasks" ? { ...i, path: LANDSEC_STAFF_TASKS } : i)),
] as const;

// A joint agent's phone tabs: the schemes and the deals on their login, and
// their own tracker, viewings and tasks.
const LANDSEC_JOINT_AGENT_NAV_ITEMS = [
  { label: "Properties", icon: Building2, path: LANDSEC_RESTRICTED_MENU.properties },
  { label: "Deals", icon: BarChart3, path: LANDSEC_RESTRICTED_MENU.deals },
  { label: "Tracker", icon: Layers, path: "/landsec/tracker" },
  { label: "Viewings", icon: Eye, path: "/landsec/viewings" },
  { label: "Tasks", icon: CheckSquare, path: LANDSEC_MENU.tasks },
] as const;

export function MobileBottomNav() {
  const [location, navigate] = useLocation();
  const { data: navUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const { brand } = useBrand();
  const isClientNav = navUser?.role === "Client" || !!(navUser as any)?.companyScopeId;
  const landsecRole = (navUser as any)?.landsecRole as string | undefined;
  const isLandsecNav = isClientNav && brand.id === "landsec";
  const items: readonly { label: string; icon: any; path: string }[] = isLandsecNav
    ? landsecRole === "joint_agent"
      // A joint agent has no Brands tab: its Brand CRM is a Landsec workspace page.
      ? [...LANDSEC_JOINT_AGENT_NAV_ITEMS, { label: "CRM", icon: Target, path: "/landsec/brand-crm" }]
      : navUser?.role === "Client"
      ? LANDSEC_NAV_ITEMS
      : LANDSEC_STAFF_NAV_ITEMS
    : isClientNav
    ? CLIENT_NAV_ITEMS
    : NAV_ITEMS;
  // Unread badge on Messages — same feed the desktop sidebar uses.
  const { data: navNotifications } = useQuery<{ unseenCount: number }>({
    queryKey: ["/api/chat/notifications"],
    // A joint agent has no Messages, and the feed is closed to that login.
    enabled: !!navUser && landsecRole !== "joint_agent",
    refetchInterval: 20000,
  });
  const unseen = navNotifications?.unseenCount || 0;
  // The number on the Landsec Tasks tab: the login's own open tasks (the same
  // feed the Tasks page reads).
  const { data: landsecTaskRows } = useQuery<any[]>({ queryKey: ["/api/tasks"], enabled: !!navUser && isLandsecNav, refetchInterval: 60000 });
  const openTasks = isLandsecNav ? openTaskCount(landsecTaskRows) : 0;

  const isActive = (path: string) => {
    // The Landsec tabs have their own rule: Deals is not lit on the
    // Properties and Tracker addresses.
    const landsecActive = isLandsecNav ? landsecMenuActive(path, location) : null;
    if (landsecActive !== null) return landsecActive;
    if (path === "/") return location === "/" || location === "/home";
    // The staff cold-open lands on /chatbgp, which renders the Messages
    // list — keep the Messages tab lit there.
    if (path === "/messages") return location.startsWith("/messages") || location.startsWith("/chatbgp");
    return location.startsWith(path);
  };

  // Hide while the keyboard is up — a fixed tab bar otherwise rides the
  // iOS keyboard and floats mid-screen between the composer and the keys
  // (Woody, 2026-08-22). WhatsApp behaviour: typing = no tab bar.
  const keyboardOpen = useKeyboardOpen();
  if (keyboardOpen) return null;

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
              <span className="relative">
                <Icon className="w-[22px] h-[22px]" />
                {item.label === "Messages" && unseen > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none" data-testid="badge-messages-unseen">
                    {unseen > 99 ? "99+" : unseen}
                  </span>
                )}
                {item.label === "Tasks" && openTasks > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-foreground text-background text-[9px] font-bold font-mono tabular-nums flex items-center justify-center leading-none" data-testid="badge-tasks-open">
                    {openTasks > 99 ? "99+" : openTasks}
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
export const BOTTOM_NAV_PATHS = ["/", "/home", "/messages", "/chatbgp", "/mail", "/deals", "/news", "/tasks", "/landsec/tracker", "/landsec/viewings", "/landsec/tasks"];
