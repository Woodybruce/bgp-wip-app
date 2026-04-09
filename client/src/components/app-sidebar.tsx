import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
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
  Check,
  MapPin,
  Receipt,
  Presentation,
  TrendingUp,
  Palette,
  ImageIcon,
  ListTodo,
  Ruler,
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
import type { User } from "@shared/schema";
import { useRecentItems, type RecentItem } from "@/hooks/use-recent-items";
import { History } from "lucide-react";

const coreNav = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "My Tasks", url: "/tasks", icon: ListTodo },
  { title: "Properties", url: "/properties", icon: Building2 },
  { title: "Deals", url: "/deals", icon: BarChart3 },
  { title: "Requirements", url: "/requirements", icon: FileText },
  { title: "People Hub", url: "/contacts", icon: Users },
  { title: "Leasing Schedule", url: "/leasing-schedule", icon: Calendar },
  { title: "Comps", url: "/comps", icon: Scale },
];

const aiNav = [
  { title: "Chat BGP", url: "/chatbgp", icon: Sparkles },
  { title: "Model Studio", url: "/models", icon: FileSpreadsheet },
  { title: "Document Studio", url: "/templates", icon: FileTextIcon },
  { title: "Image Studio", url: "/image-studio", icon: ImageIcon },
];

const microsoftNav = [
  { title: "SharePoint", url: "/sharepoint", icon: Cloud },
  { title: "Calendar", url: "/calendar", icon: Calendar },
  { title: "Mail", url: "/mail", icon: Mail },
];

const adminNav = [
  { title: "Board Report", url: "/board-report", icon: Presentation },
  { title: "WhatsApp", url: "/whatsapp", icon: MessageCircle },
  { title: "News", url: "/news", icon: Newspaper, badge: "AI" },
  { title: "Leads", url: "/leads", icon: UserPlus },
  { title: "Enrichment Hub", url: "/enrichment", icon: Sparkles, badge: "AI" },
  { title: "Subscriptions & APIs", url: "/subscriptions", icon: CreditCard },
  { title: "Office Add-ins", url: "/addins", icon: Puzzle },
  { title: "Settings", url: "/settings", icon: Settings },
];

const toolsNav = [
  { title: "KYC Clouseau", url: "/kyc-clouseau", icon: Scale, badge: "AI" },
  { title: "Land Registry", url: "/land-registry", icon: Landmark },
  { title: "Business Rates", url: "/business-rates", icon: Receipt },
  { title: "Turnover Data", url: "/turnover", icon: BarChart3 },
  { title: "Cann CAD", url: "/cad-measure", icon: Ruler },
];

function NavSection({ label, items }: { label: string; items: Array<{ title: string; url: string; icon: any; badge?: string }> }) {
  const [location] = useLocation();
  const isActive = (url: string) => {
    if (url === "/") return location === "/";
    if (url.startsWith("#")) return false;
    if (url === "/contacts") return location.startsWith("/contacts") || location.startsWith("/companies");
    if (url === "/properties") return location.startsWith("/properties") || location.startsWith("/map") || location.startsWith("/edozo");
    if (url === "/deals") return location.startsWith("/deals") || location.startsWith("/investment-tracker") || location.startsWith("/wip-report");
    return location.startsWith(url);
  };

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            return (
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
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

const TYPE_CONFIG: Record<RecentItem["type"], { icon: any; path: string; color: string }> = {
  deal: { icon: BarChart3, path: "/deals", color: "text-blue-400" },
  contact: { icon: Users, path: "/contacts", color: "text-green-400" },
  company: { icon: Briefcase, path: "/companies", color: "text-amber-400" },
  property: { icon: Building2, path: "/properties", color: "text-purple-400" },
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
          <div className="cursor-pointer overflow-hidden h-16 flex items-center justify-center">
            <img src={bgpLogoWhite} alt="Bruce Gillingham Pollard" className="w-full scale-[2] object-cover" />
          </div>
        </Link>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <NavSection label="Core" items={coreNav} />
        <QuickAccessSection />
        <SidebarSeparator />
        <NavSection label="AI Tools" items={user?.isAdmin ? aiNav : aiNav.filter(i => i.url !== "/image-studio")} />
        <SidebarSeparator />
        <NavSection label="Microsoft 365" items={microsoftNav} />
        <SidebarSeparator />
        <NavSection label="Admin" items={adminNav} />
        <SidebarSeparator />
        <NavSection label="Tools" items={toolsNav} />
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
