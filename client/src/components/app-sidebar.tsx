import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import bgpLogoWhite from "@assets/BGP_WhiteHolder.png_-_new_1771853582466.png";
import { useTheme, COLOR_SCHEMES } from "@/components/theme-provider";
import {
  LayoutDashboard,
  Building2,
  Briefcase,
  Scale,
  BarChart3,
  Newspaper,
  Users,
  X,

  FileText,
  Settings,
  LogOut,
  Cloud,
  Calendar,
  Mail,
  MessageCircle,
  Zap,
  FileSpreadsheet,
  FileText as FileTextIcon,
  CreditCard,
  Puzzle,
  Sparkles,
  Landmark,
  UserPlus,
  ChevronsUpDown,
  ChevronDown,
  ChevronRight,
  Check,
  MapPin,
  Receipt,
  Presentation,
  TrendingUp,
  Palette,
  ImageIcon,
  ListTodo,
  Ruler,
  Sun,
  ShieldCheck,
  GraduationCap,
  Store,
  Globe,
  Target,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTeam, TEAMS } from "@/lib/team-context";
import type { TeamName } from "@/lib/team-context";
import { useBrand } from "@/lib/brand-context";
import type { User } from "@shared/schema";
import { useRecentItems, type RecentItem } from "@/hooks/use-recent-items";
import { History } from "lucide-react";

const coreNavBase = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "My Tasks", url: "/tasks", icon: ListTodo },
  { title: "My Card", url: "/my-expenses", icon: CreditCard },
  { title: "People & HR", url: "/hr", icon: Users },
  { title: "Properties", url: "/properties", icon: Building2 },
  { title: "Deals", url: "/deals", icon: BarChart3 },
  { title: "AML Compliance", url: "/kyc-clouseau?tab=board", icon: ShieldCheck },
  { title: "Requirements", url: "/requirements", icon: FileText },
  { title: "Tenant Rep", url: "/tenant-rep", icon: Target },
  { title: "Letting Hunter", url: "/hunters/letting", icon: Target },
  { title: "Investment Hunter", url: "/hunters/investment", icon: Target },
  { title: "Brand Intelligence", url: "/brands", icon: Store },
  { title: "People Hub", url: "/contacts", icon: Users },
  { title: "Landlords", url: "/landlords", icon: Briefcase },
  { title: "Leasing Schedule", url: "/leasing-schedule", icon: Calendar },
  { title: "Comps", url: "/comps", icon: Scale },
  { title: "Lease Events", url: "/lease-events", icon: Calendar },
];

const aiNav = [
  { title: "Chat BGP", url: "/chatbgp", icon: Sparkles },
  { title: "Model Studio", url: "/models", icon: FileSpreadsheet },
  { title: "Document Studio", url: "/templates", icon: FileTextIcon },
  { title: "Image Studio", url: "/image-studio", icon: ImageIcon },
  { title: "Property Intelligence", url: "/property-intelligence", icon: Globe, badge: "AI" },
  { title: "Cann CAD", url: "/cad-measure", icon: Ruler, badge: "Beta" },
];

const microsoftNav = [
  { title: "SharePoint", url: "/sharepoint", icon: Cloud },
  { title: "Calendar", url: "/calendar", icon: Calendar },
  { title: "Mail", url: "/mail", icon: Mail },
];

const adminNavBase = [
  { title: "Reporting", url: "/reporting", icon: TrendingUp },
  { title: "Board Report", url: "/board-report", icon: Presentation },
  { title: "WhatsApp", url: "/whatsapp", icon: MessageCircle },
  { title: "News", url: "/news", icon: Newspaper, badge: "AI" },
  { title: "Leads", url: "/leads", icon: UserPlus },
  { title: "Enrichment Hub", url: "/enrichment", icon: Sparkles, badge: "AI" },
  { title: "Subscriptions & APIs", url: "/subscriptions", icon: CreditCard },
  { title: "Expenses", url: "/expenses", icon: Receipt },
  { title: "Office Add-ins", url: "/addins", icon: Puzzle },
  { title: "Settings", url: "/settings", icon: Settings },
];

function NavSection({
  label,
  items,
  defaultOpen = true,
  storageKey,
}: {
  label: string;
  items: Array<{ title: string; url: string; icon: any; badge?: string }>;
  defaultOpen?: boolean;
  storageKey?: string;
}) {
  const [location] = useLocation();
  const isActive = (url: string) => {
    if (url === "/") return location === "/";
    if (url.startsWith("#")) return false;
    const path = url.split("?")[0];
    if (path === "/contacts") return location.startsWith("/contacts") || location.startsWith("/companies");
    if (path === "/properties") return location.startsWith("/properties") || location.startsWith("/map") || location.startsWith("/edozo");
    if (path === "/deals") return location.startsWith("/deals") || location.startsWith("/investment-tracker") || location.startsWith("/wip-report");
    if (path === "/property-intelligence") return location.startsWith("/property-intelligence");
    if (path === "/kyc-clouseau") return location.startsWith("/kyc-clouseau") || location.startsWith("/aml-compliance") || location.startsWith("/compliance-board") || location.startsWith("/aml-training");
    return location.startsWith(path);
  };

  // Always expand if a child is active so users never lose their bearings
  const sectionHasActive = items.some(i => isActive(i.url));
  const key = storageKey ? `bgp-nav-section-${storageKey}` : null;
  const [open, setOpen] = useState<boolean>(() => {
    if (sectionHasActive) return true;
    if (key && typeof window !== "undefined") {
      const stored = localStorage.getItem(key);
      if (stored !== null) return stored === "1";
    }
    return defaultOpen;
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (key) localStorage.setItem(key, next ? "1" : "0");
  };

  return (
    <SidebarGroup>
      <SidebarGroupLabel
        onClick={toggle}
        className="cursor-pointer select-none flex items-center justify-between hover:text-sidebar-foreground transition-colors"
      >
        <span>{label}</span>
        {open ? <ChevronDown className="w-3 h-3 opacity-60" /> : <ChevronRight className="w-3 h-3 opacity-60" />}
      </SidebarGroupLabel>
      {open && (
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  asChild
                  data-active={isActive(item.url)}
                  data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <Link href={item.url}>
                    <item.icon className="w-4 h-4" />
                    <span>{item.title}</span>
                    {item.badge && (
                      <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">{item.badge}</Badge>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
}

const TYPE_CONFIG: Record<RecentItem["type"], { icon: any; path: string; color: string }> = {
  deal: { icon: BarChart3, path: "/deals", color: "text-sidebar-primary opacity-80" },
  contact: { icon: Users, path: "/contacts", color: "text-sidebar-foreground opacity-60" },
  company: { icon: Briefcase, path: "/companies", color: "text-sidebar-primary opacity-70" },
  property: { icon: Building2, path: "/properties", color: "text-sidebar-foreground opacity-50" },
};

function QuickAccessSection() {
  const recentItems = useRecentItems(5);

  if (recentItems.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>
        <History className="w-3 h-3 mr-1 inline" />
        Quick Access
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {recentItems.map((item) => {
            const config = TYPE_CONFIG[item.type];
            const Icon = config.icon;
            return (
              <SidebarMenuItem key={`${item.type}-${item.id}`}>
                <SidebarMenuButton
                  asChild
                  className="h-7"
                  data-testid={`nav-recent-${item.type}-${item.id.substring(0, 8)}`}
                >
                  <Link href={`${config.path}/${item.id}`}>
                    <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                    <span className="truncate text-xs">{item.name}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const { data: user } = useQuery<User>({ queryKey: ["/api/auth/me"] });
  const { activeTeam, setActiveTeam, userTeam, additionalTeams } = useTeam();
  const { colorScheme, setColorScheme } = useTheme();
  const { brand, isLandsec } = useBrand();

  // Reporting lives in Core for Landsec tenants, otherwise it's hidden in Admin.
  const coreNav = isLandsec
    ? [...coreNavBase, { title: "Reporting", url: "/reporting", icon: TrendingUp }]
    : coreNavBase;
  const adminNav = isLandsec
    ? adminNavBase.filter(i => i.url !== "/reporting")
    : adminNavBase;

  const handleLogout = async () => {
    await apiRequest("POST", "/api/auth/logout");
    localStorage.removeItem("bgp_auth_token");
    localStorage.removeItem("bgp_active_team");
    queryClient.clear();
    window.location.href = "/";
  };

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  return (
    <Sidebar>
      <SidebarHeader className="p-3 pt-5 pb-5">
        <Link href="/">
          {isLandsec ? (
            <div className="cursor-pointer flex flex-col items-center justify-center h-16 gap-1">
              <span
                className="text-lg font-bold tracking-tight text-sidebar-foreground"
                style={{ color: brand.accentColor }}
              >
                {brand.headerText}
              </span>
              <span className="text-[10px] text-sidebar-foreground/50">Powered by BGP</span>
            </div>
          ) : (
            <div className="cursor-pointer overflow-hidden h-16 flex items-center justify-center px-3">
              <img src={bgpLogoWhite} alt="Bruce Gillingham Pollard" className="w-full h-auto max-h-12 object-contain" />
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <NavSection label="Core" items={coreNav} storageKey="core" />
        <QuickAccessSection />
        <SidebarSeparator />
        <NavSection label="AI Tools" items={user?.isAdmin ? aiNav : aiNav.filter(i => i.url !== "/image-studio")} storageKey="ai" />
        <SidebarSeparator />
        <NavSection label="Microsoft 365" items={microsoftNav} storageKey="ms" defaultOpen={false} />
        <SidebarSeparator />
        {user?.isAdmin && <NavSection label="Admin" items={adminNav} storageKey="admin" defaultOpen={false} />}
      </SidebarContent>

      <SidebarFooter className="p-3 space-y-2">
        <div className="flex items-center gap-1 px-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs hover:bg-sidebar-accent transition-colors text-sidebar-foreground/70 hover:text-sidebar-foreground"
                data-testid="button-color-scheme"
              >
                <Palette className="w-3.5 h-3.5" />
                <span className="truncate">{COLOR_SCHEMES.find(s => s.id === colorScheme)?.label}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-48">
              {COLOR_SCHEMES.map((scheme) => (
                <DropdownMenuItem
                  key={scheme.id}
                  onClick={() => setColorScheme(scheme.id)}
                  className="flex items-center gap-2.5 cursor-pointer"
                  data-testid={`button-scheme-${scheme.id}`}
                >
                  <div
                    className="w-4 h-4 rounded-full border border-border shrink-0"
                    style={{ backgroundColor: scheme.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{scheme.label}</p>
                  </div>
                  {colorScheme === scheme.id && (
                    <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center justify-between w-full px-2 py-1.5 rounded-md text-xs font-medium hover:bg-sidebar-accent transition-colors"
              data-testid="button-team-switcher"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center shrink-0">
                  <Users className="w-3 h-3 text-primary" />
                </div>
                <span className="truncate">{activeTeam === "all" ? "All Teams" : activeTeam || "Select Team"}</span>
              </div>
              <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 opacity-50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-52">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Switch Team</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setActiveTeam("all")}
              data-testid="menu-team-all"
            >
              <span className="flex-1">All Teams</span>
              {activeTeam === "all" && <Check className="w-3.5 h-3.5 ml-2" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {TEAMS.map((team) => (
              <DropdownMenuItem
                key={team}
                onClick={() => setActiveTeam(team)}
                data-testid={`menu-team-${team.toLowerCase().replace(/[\s/]+/g, "-")}`}
              >
                <span className="flex-1">{team}</span>
                {activeTeam === team && <Check className="w-3.5 h-3.5 ml-2" />}
                {(userTeam === team || additionalTeams.includes(team)) && activeTeam !== team && (
                  <Badge variant="outline" className="ml-2 text-[9px] px-1 py-0">You</Badge>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-xs font-medium text-primary">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate" data-testid="text-current-user">{user?.name || "Loading..."}</p>
            <p className="text-[10px] text-muted-foreground truncate">{user?.role || "BGP Team"}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="w-3.5 h-3.5" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * Mobile sidebar overlay — slides in from the left when "More" is tapped
 * in the bottom nav bar. Shows all navigation items not present in the
 * bottom nav (Home, ChatBGP, Properties, Deals are in the bottom nav).
 */
const mobileOverlayItems = [
  { title: "Today", url: "/today", icon: Sun },
  { title: "Properties", url: "/properties", icon: Building2 },
  { title: "My Tasks", url: "/tasks", icon: ListTodo },
  { title: "Requirements", url: "/requirements", icon: FileText },
  { title: "Tenant Rep", url: "/tenant-rep", icon: Target },
  { title: "Letting Hunter", url: "/hunters/letting", icon: Target },
  { title: "Investment Hunter", url: "/hunters/investment", icon: Target },
  { title: "Brand Intelligence", url: "/brands", icon: Store },
  { title: "People Hub", url: "/contacts", icon: Users },
  { title: "Landlords", url: "/landlords", icon: Briefcase },
  { title: "Leasing Schedule", url: "/leasing-schedule", icon: Calendar },
  { title: "Comps", url: "/comps", icon: Scale },
  { title: "Model Studio", url: "/models", icon: FileSpreadsheet },
  { title: "Document Studio", url: "/templates", icon: FileTextIcon },
  { title: "Image Studio", url: "/image-studio", icon: ImageIcon },
  { title: "SharePoint", url: "/sharepoint", icon: Cloud },
  { title: "Calendar", url: "/calendar", icon: Calendar },
  { title: "Mail", url: "/mail", icon: Mail },
  { title: "Reporting", url: "/reporting", icon: TrendingUp },
  { title: "Board Report", url: "/board-report", icon: Presentation },
  { title: "WhatsApp", url: "/whatsapp", icon: MessageCircle },
  { title: "News", url: "/news", icon: Newspaper },
  { title: "Leads", url: "/leads", icon: UserPlus },
  { title: "Property Intelligence", url: "/property-intelligence", icon: Globe },
  { title: "Cann CAD", url: "/cad-measure", icon: Ruler, badge: "Beta" },
  { title: "AML Compliance", url: "/kyc-clouseau?tab=board", icon: ShieldCheck },
  { title: "Enrichment Hub", url: "/enrichment", icon: Sparkles },
  { title: "Office Add-ins", url: "/addins", icon: FileSpreadsheet },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function MobileSidebarOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [location] = useLocation();
  const { isLandsec } = useBrand();

  // Hide Reporting in mobile overlay for non-Landsec tenants (parity with desktop).
  const items = isLandsec ? mobileOverlayItems : mobileOverlayItems.filter(i => i.url !== "/reporting");

  const isActive = (url: string) => {
    if (url === "/") return location === "/";
    return location.startsWith(url);
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 transition-opacity"
          onClick={onClose}
          data-testid="mobile-sidebar-backdrop"
        />
      )}
      {/* Sidebar panel */}
      <div
        className={`fixed inset-y-0 left-0 z-[70] w-[280px] bg-background border-r shadow-xl flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ paddingTop: "env(safe-area-inset-top)" }}
        data-testid="mobile-sidebar-overlay"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <span className="text-sm font-bold">Menu</span>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
            data-testid="button-close-mobile-sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.url);
            return (
              <Link key={item.url} href={item.url}>
                <div
                  onClick={onClose}
                  className={`flex items-center gap-3 px-4 py-3 mx-2 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
                    active
                      ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400"
                      : "text-foreground hover:bg-muted"
                  }`}
                  data-testid={`mobile-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <Icon className={`w-5 h-5 shrink-0 ${active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`} />
                  <span>{item.title}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
