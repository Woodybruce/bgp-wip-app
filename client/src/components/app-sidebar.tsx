import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import bgpLogoWhite from "@assets/BGP_WhiteHolder.png_-_new_1771853582466.png";
import { ClientBrandLogo } from "@/components/client-brand-logo";
import { useTheme, COLOR_SCHEMES } from "@/components/theme-provider";
import {
  LayoutDashboard,
  Building2,
  Briefcase,
  Scale,
  BarChart3,
  Newspaper,
  Users,
  Handshake,
  X,

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
  Layers,
  UserPlus,
  ChevronsUpDown,
  ChevronDown,
  ChevronRight,
  Check,
  MapPin,
  Receipt,
  TrendingUp,
  Palette,
  ImageIcon,
  ListTodo,
  Ruler,
  Sun,
  GraduationCap,
  Store,
  Globe,
  Target,
  Eye,
  IdCard,
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
  useSidebar,
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
import { clearPersistedQueries } from "@/lib/query-persist";
import { useTeam, TEAMS } from "@/lib/team-context";
import type { TeamName } from "@/lib/team-context";
import { useBrand } from "@/lib/brand-context";
import { isEquityUser } from "@/lib/utils";
import { leasingSideOnly, LEASING_SIDE_HIDDEN_URLS, investmentSideOnly, INVESTMENT_SIDE_HIDDEN_URLS, isBgpTeam } from "@shared/teams";
import type { User } from "@shared/schema";
import { LANDSEC_MENU, JOINT_AGENT_MENU, landsecMenuActive, landsecTasksPath, openTaskCount } from "@shared/landsec-menu";
import { isRestrictedLandsecRole } from "@/components/landsec/deal-clock";
import { useRecentItems, type RecentItem } from "@/hooks/use-recent-items";
import { History, ClipboardCheck, Film } from "lucide-react";
import { dealDisplayTitle } from "@/lib/format";

export { dealDisplayTitle };

const coreNavBase = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "My Tasks", url: "/tasks", icon: ListTodo },
  // Properties is reachable as a tab inside Deals (alongside Letting
  // Tracker / Investment / WIP Report), so the standalone sidebar entry
  // was dropped — it duplicated the Deals view.
  { title: "Deals", url: "/deals", icon: BarChart3 },
  // Requirements is a pill inside Brands for every login (Woody, 2026-11-17:
  // "put requirements in the brands section for everyone"); /requirements
  // forwards there.
  // Work-in-progress modules (AML, Tenant Rep, hunters, Landlord Intel,
  // Leasing Schedule, Lease Advisory, London Restaurants) moved to the
  // "Unfinished" group below so the everyday Core nav stays clean.
  // One Brands entry, as on the Landsec menu (Woody, 2026-11-16): the brand
  // directory, with the Brand CRM a pill inside it.
  { title: "Brands", url: "/brands", icon: Store },
  { title: "CRM", url: "/contacts", icon: Handshake },
  // My BGP: the people page, renamed from People & HR, with your own page
  // (business card, BGP card and expenses folded in) inside it (Woody,
  // 2026-11-16 "call it my BGP"; 2026-11-17 "remove the my BGP link from
  // the side bar and rename People and HR to my BGP"). /my-bgp,
  // /business-card and /my-expenses still open and light this entry.
  { title: "My BGP", url: "/hr", icon: IdCard },
  // Lease Advisory is Pete's toolset (Woody, 2026-09-02): jobs, evidence
  // plans and leasing comps linked by pill row across the three pages.
  // Comps has no standalone entry for staff — it's reached through here
  // (clients still get a direct Comps entry below).
  { title: "Lease Advisory", url: "/pla/matters", icon: Scale },
  // Investment's own entry (Woody, 2026-09-28): one hub with Tracker /
  // Requirements / Comps pills. Replaces the standalone Investment Comps.
  { title: "Investment", url: "/investment", icon: TrendingUp },
];

// Landsec's menu (desktop sidebar and phone overlay), for a full Landsec
// login (an asset manager is one) and for staff viewing as Landsec (Woody,
// 2026-11-12: "The side bar should have Properties, deals and letting
// tracker"; Brands stays). Tasks joins these four in landsecNavFor below.
// Portfolio and Lettings are folded into Properties and Deals, and Ask is
// gone: chat is the ChatBGP rail on the right
// (docs/landsec-menu-plan-2026-11-12.md, part 1).
export const LANDSEC_NAV = [
  { title: "Properties", url: LANDSEC_MENU.properties, icon: Building2 },
  { title: "Deals", url: LANDSEC_MENU.deals, icon: BarChart3 },
  { title: "Letting Tracker", url: LANDSEC_MENU.tracker, icon: Store },
  { title: "Calendar", url: LANDSEC_MENU.calendar, icon: Calendar },
  { title: "Brands", url: LANDSEC_MENU.brands, icon: Handshake },
  { title: "CRM", url: LANDSEC_MENU.crm, icon: Users },
];

// A joint agent uses the real Properties and Deals pages, cut to its own
// schemes on the server (Woody, 2026-11-14: "joint agent can do anything
// other than see brands").
const LANDSEC_RESTRICTED_NAV = [
  { title: "Properties", url: JOINT_AGENT_MENU.properties, icon: Building2 },
  { title: "Deals", url: JOINT_AGENT_MENU.deals, icon: BarChart3 },
];

// A joint agent's own working pages, for the schemes on their login
// (Woody, 2026-11-12: "Joint agents should have full control like us",
// "only on their instructed properties"). Its Letting Tracker is its own
// tracker: the staff one reads BGP's notes on target brands.
// Since 14 November 2026 its menu is a Landsec login's less Brands (Woody:
// "The only difference is the lack of access to the brands page"), with its
// own tracker (BGP's notes on target brands left out) and its Brand CRM.
export const LANDSEC_JOINT_AGENT_NAV = [
  { title: "Letting Tracker", url: JOINT_AGENT_MENU.tracker, icon: Layers },
  { title: "Calendar", url: LANDSEC_MENU.calendar, icon: Calendar },
  { title: "Tasks", url: "/landsec/tasks", icon: ListTodo },
];

// Tasks is on every Landsec menu (Woody, 2026-11-13: "we need each person to
// have this update their own task list ... and add to the side bar"): one
// page for every Landsec role, /landsec/tasks. BGP staff viewing as Landsec
// keep their own My Tasks (/tasks) behind the same entry.
const LANDSEC_TASKS_NAV = { title: "Tasks", url: LANDSEC_MENU.tasks, icon: ListTodo };

// A joint agent has no Brands and has its own tracker, viewings and tasks,
// all filtered to its schemes server-side. Every other Landsec login, an
// asset manager included (Woody, 2026-11-13: "asset managers and leasing
// landsec should be the same"), has the five-entry menu. Nobody has an Ask
// entry now.
// A joint agent has no Brand Intelligence, so its Brand CRM (targets and
// diary for its own schemes) is a page inside the Landsec workspace.
const JOINT_AGENT_BRAND_CRM = { title: "Brand CRM", url: "/landsec/brand-crm", icon: Target };
export function landsecNavFor(role: string | null | undefined, staffView = false) {
  if (role === "joint_agent") return [...LANDSEC_RESTRICTED_NAV, ...LANDSEC_JOINT_AGENT_NAV, JOINT_AGENT_BRAND_CRM];
  return [...LANDSEC_NAV.filter(i => i.title !== "Brands" && i.title !== "CRM"), { ...LANDSEC_TASKS_NAV, url: landsecTasksPath(staffView) }, ...LANDSEC_NAV.filter(i => i.title === "Brands" || i.title === "CRM")];
}

// The Tasks entry with its number: the login's open tasks. Nothing is shown
// at nought.
export function withOpenTaskCount<T extends { title: string }>(items: T[], open: number): Array<T & { badge?: string }> {
  return items.map(i => (i.title === LANDSEC_TASKS_NAV.title && open > 0 ? { ...i, badge: String(open) } : i));
}

const aiNav = [
  { title: "ChatBGP", url: "/chatbgp", icon: Sparkles },
  // Full /image-studio for ALL staff, admin or not (Woody 2026-08-13, UX #43).
  { title: "Image Studio", url: "/image-studio", icon: ImageIcon },
  { title: "Property Intelligence", url: "/property-intelligence", icon: Globe, badge: "AI" },
  { title: "Cann CAD", url: "/cad-measure", icon: Ruler, badge: "Beta" },
];

const microsoftNav = [
  { title: "SharePoint", url: "/sharepoint", icon: Cloud },
  { title: "Calendar", url: "/calendar", icon: Calendar },
  { title: "Mail", url: "/mail", icon: Mail },
];

// Modules being polished — grouped together so they're easy for admins to
// find without cluttering Core. Hidden from non-admins entirely. Order
// matches the list Woody dictated (AML → Enrichment Hub).
const unfinishedNav = [
  { title: "Portfolios", url: "/portfolios", icon: Layers },
  // KYC4U is a section of Subscriptions & APIs (Woody, 2026-11-21: "Move
  // KYC4U into subscriptions and APIS"); /kyc-clouseau still opens it.
  { title: "Tenant Rep", url: "/tenant-rep", icon: Target },
  { title: "Letting Hunter", url: "/hunters/letting", icon: Target },
  { title: "Investment Hunter", url: "/hunters/investment", icon: Target },
  { title: "Double Bill", url: "/leisure-platform", icon: Film, badge: "NEW" },
  { title: "Landlord Intelligence", url: "/landlords", icon: Briefcase },
  // Leasing Schedule retired (archived) — Tenancy Schedule + Letting
  // Tracker are the two boards now. Route stays live for old links.
  // Lease Advisory (with Evidence Plans + Comps folded in) graduated to
  // Core (Woody, 2026-09-02).
  { title: "London Restaurants", url: "/westminster-restaurants", icon: Store, badge: "BD" },
  { title: "Model Studio", url: "/models", icon: FileSpreadsheet },
  // Document Studio v2 — the unified documents hub (library + previews +
  // upload + SharePoint filing). The briefs cockpit (/document-briefs, with
  // Templates + Decks folded in as tabs) stays as its own entry — the hub's
  // "New document → AI briefs" also links into it.
  { title: "Document Studio", url: "/document-studio", icon: FileTextIcon },
  { title: "Document Briefs", url: "/document-briefs", icon: FileTextIcon, badge: "AI" },
  // Reporting and Board Report are Finance → Fees & pipeline (Woody,
  // 2026-11-17: "fold reporting and board report in to finance").
  { title: "Leads", url: "/leads", icon: UserPlus },
  { title: "Enrichment Hub", url: "/enrichment", icon: Sparkles, badge: "AI" },
];

const adminNavBase = [
  { title: "Finance", url: "/finance", icon: Landmark },
  { title: "Expenses", url: "/expenses", icon: Receipt },
  // Public website content (bgp.uk.com team / case studies / news), also
  // editable through ChatBGP's manage_website_content tool. In Admin since
  // Woody, 2026-11-16: "Website goes to admin".
  { title: "Website", url: "/website", icon: Globe },
  { title: "WhatsApp", url: "/whatsapp", icon: MessageCircle },
  { title: "News", url: "/news", icon: Newspaper, badge: "AI" },
  { title: "Subscriptions & APIs", url: "/subscriptions", icon: CreditCard },
  { title: "Office Add-ins", url: "/addins", icon: Puzzle },
  { title: "Settings", url: "/settings", icon: Settings },
];

// My BGP is lit on the people page, your own page and the two pages folded into it.
const MY_BGP_PATHS = ["/my-bgp", "/my-expenses", "/business-card"];

function NavSection({
  label,
  items,
  defaultOpen = true,
  storageKey,
  landsecMenu = false,
  closedBadge,
}: {
  label: string;
  items: Array<{ title: string; url: string; icon: any; badge?: string }>;
  defaultOpen?: boolean;
  storageKey?: string;
  landsecMenu?: boolean;
  // Shown beside the group's name while it is closed, so a count inside it
  // is not hidden (the Admin group's approvals).
  closedBadge?: { text: string; title: string } | null;
}) {
  const [location] = useLocation();
  const isActive = (url: string) => {
    // The Landsec menu has its own rule: Deals is not lit on the Properties
    // and Letting Tracker addresses, and Brands is lit on any Brands address.
    const landsecActive = landsecMenu ? landsecMenuActive(url, location) : null;
    if (landsecActive !== null) return landsecActive;
    if (url === "/") return location === "/";
    if (url.startsWith("#")) return false;
    const path = url.split("?")[0];
    if (path === "/hr") return location.startsWith("/hr") || MY_BGP_PATHS.some(p => location.startsWith(p));
    if (path === "/contacts") return location.startsWith("/contacts") || location.startsWith("/companies");
    if (path === "/properties") return location.startsWith("/properties") || location.startsWith("/map") || location.startsWith("/edozo");
    if (path === "/deals") return location.startsWith("/deals") || location.startsWith("/wip-report");
    if (path === "/expenses" && location.startsWith("/expenses/approvals") && items.some(i => i.url === "/expenses/approvals")) return false;
    if (path === "/investment") return location === "/investment" || location.startsWith("/investment/") || location.startsWith("/investment-tracker") || location.startsWith("/investment-comps");
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
        <span className="flex items-center gap-1.5">
          {label}
          {!open && closedBadge && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0" title={closedBadge.title} data-testid={`nav-section-badge-${storageKey || label.toLowerCase()}`}>{closedBadge.text}</Badge>
          )}
        </span>
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
                  tooltip={item.title}
                >
                  <Link href={item.url}>
                    <item.icon className="w-4 h-4" />
                    <span>{item.title}</span>
                    {item.badge && (
                      <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0" data-testid={`nav-badge-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>{item.badge}</Badge>
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
  // Entries saved before the shared deal title still carry the raw deal
  // name ("South Molton - unit 3") — re-title from the cached deal when the
  // deal page's queries are in the cache (Woody, 2026-09-28).
  const withDealTitle = (item: RecentItem): RecentItem => {
    const deal = queryClient.getQueryData<any>(["/api/crm/deals", item.id]);
    if (!deal || item.name !== (deal.name || deal.propertyName || "Untitled Deal")) return item;
    const props = queryClient.getQueryData<any[]>(["/api/crm/properties"]) || [];
    const cos = queryClient.getQueryData<any[]>(["/api/crm/companies"]) || [];
    const units = queryClient.getQueryData<any[]>(["/api/property-units"]) || [];
    const prop = deal.propertyId ? props.find((p) => p.id === deal.propertyId) : null;
    const unit = deal.unitId ? units.find((u) => u.id === deal.unitId && u.propertyId === deal.propertyId) : null;
    const name = dealDisplayTitle({
      name: deal.name,
      propertyName: prop?.name || deal.propertyName,
      propertyAddress: typeof prop?.address === "string" ? prop.address : prop?.address?.formatted,
      tenantName: deal.tenantId ? cos.find((c) => c.id === deal.tenantId)?.name : null,
      unitName: unit?.unitName,
      isInvestment: deal.dealType === "Sale" || deal.dealType === "Purchase",
    });
    return { ...item, name, subtitle: item.subtitle && item.subtitle !== name ? item.subtitle : deal.status || undefined };
  };

  if (recentItems.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>
        <History className="w-3 h-3 mr-1 inline" />
        Quick Access
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {recentItems.map((raw) => {
            const item = raw.type === "deal" ? withDealTitle(raw) : raw;
            const config = TYPE_CONFIG[item.type];
            const Icon = config.icon;
            return (
              <SidebarMenuItem key={`${item.type}-${item.id}`}>
                <SidebarMenuButton
                  asChild
                  className="h-7"
                  data-testid={`nav-recent-${item.type}-${item.id.substring(0, 8)}`}
                  tooltip={item.subtitle && item.subtitle !== item.name ? `${item.type === "deal" ? "Deal" : item.type === "property" ? "Property" : item.type === "company" ? "Company" : "Contact"}: ${item.name} · ${item.subtitle}` : item.name}
                >
                  <Link href={`${config.path}/${item.id}`} title={`${item.type === "deal" ? "Deal" : item.type === "property" ? "Property" : item.type === "company" ? "Company" : "Contact"} — ${item.name}${item.subtitle && item.subtitle !== item.name ? ` · ${item.subtitle}` : ""}`}>
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
  const { activeTeam, setActiveTeam, exitClientView, userTeam, additionalTeams } = useTeam();
  const { colorScheme, setColorScheme } = useTheme();
  const { brand, isLandsec } = useBrand();

  // Hover-to-peek: when the sidebar is collapsed to an icon rail, hovering
  // expands it as a floating overlay over the main content (no layout
  // shift). Click on a nav item or mouse-leave tucks it back.
  const { open, isMobile, setPeeking } = useSidebar();
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePeek = (next: boolean) => {
    if (open || isMobile) {
      setPeeking(false);
      return;
    }
    if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
    peekTimerRef.current = setTimeout(() => setPeeking(next), next ? 180 : 120);
  };
  useEffect(() => {
    if (open || isMobile) setPeeking(false);
    return () => {
      if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
    };
  }, [open, isMobile, setPeeking]);
  const collapsePeekNow = () => {
    if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
    setPeeking(false);
  };

  // Core hides anything still admin-gated for non-admins (none at present —
  // Team now lives in the Admin group).
  const coreNavFiltered = coreNavBase.filter((i: any) => !i.adminOnly || user?.isAdmin);
  // Surface an "Approvals" entry (with a count badge) for anyone who actually
  // has expenses assigned to them to approve — Wendy/Layla (Stage 1) and the
  // directors (Stage 2). Without this there was no nav route to the approvals
  // inbox, so approvers couldn't find their queue even though items were
  // correctly assigned. /expenses/approvals is not admin-gated, so this works
  // for Wendy's non-admin "Accounts" login too.
  const { data: pendingApprovals } = useQuery<any[]>({
    queryKey: ["/api/expenses/pending-approval"],
    refetchInterval: 60_000,
    enabled: user?.role !== "Client",
  });
  const approvalCount = Array.isArray(pendingApprovals) ? pendingApprovals.length : 0;
  const approvalsEntry = approvalCount > 0
    ? { title: "Approvals", url: "/expenses/approvals", icon: ClipboardCheck, badge: String(approvalCount) }
    : null;
  // Approvals is in the Admin group for admins, beside Expenses, with its
  // count on the group's name while it is closed (Woody, 2026-11-17: "move
  // approvals into admin"). Every approver today is on the admin list
  // (ADMIN_EMAILS, Wendy's Accounts login included); one who is not an admin
  // has no Admin group, so theirs would stay here.
  const coreWithApprovals = approvalsEntry && !user?.isAdmin ? [...coreNavFiltered, approvalsEntry] : coreNavFiltered;
  // Read-only "Team Expenses" for designated team overseers — non-admin team
  // leads (e.g. Victoria → Shopping Centre). Admins use the full Expenses
  // console instead, so this is only for non-admins. The overseer flag rides
  // on /api/auth/me (server: expenseOverseerTeams).
  const isExpenseOverseer =
    Array.isArray((user as any)?.expenseOverseerTeams) && (user as any).expenseOverseerTeams.length > 0;
  const coreWithTeamExpenses = isExpenseOverseer && !user?.isAdmin
    ? [...coreWithApprovals, { title: "Team Expenses", url: "/team-expenses", icon: Receipt }]
    : coreWithApprovals;
  // Client logins (e.g. Landsec) get a trimmed nav: no People & HR, My BGP,
  // Reporting or WIP — those are BGP-internal. Staff nav is unchanged.
  const isClientUser = user?.role === "Client" || !!(user as any)?.companyScopeId;
  // A REAL external client login vs a BGP staff member who has switched the
  // team picker to a client team. Both see the client nav (that's the point —
  // "we see what they see"), but only a real client login is pinned to it.
  // Staff must keep the switcher, or switching in traps them with no way back.
  const isRealClientLogin = user?.role === "Client";
  const isViewingAsClient = !isRealClientLogin && !!(user as any)?.companyScopeId;
  const viewingAsName = (user as any)?.companyScopeName || activeTeam;
  // My BGP (staff HR, business card, BGP card) is BGP-internal — the route
  // jail already bounces clients back to the Dashboard, so for them the entry
  // would be a dead link that looked broken.
  const CLIENT_HIDDEN_URLS = ["/hr", "/my-bgp", "/team-expenses", "/wip-report", "/pla/matters", "/investment", "/investment-comps", "/evidence-plans"];
  const coreNavStaff = isClientUser
    ? [
        ...coreWithTeamExpenses.filter(i => !CLIENT_HIDDEN_URLS.includes(i.url)),
        // Clients keep their scoped read-only Comps view — staff reach comps
        // through the Lease Advisory toolset instead.
        { title: "Comps", url: "/comps", icon: Scale },
        // Clients get the read-only brand-signals feed (UX #35) — News
        // otherwise lives in the staff/admin nav only.
        { title: "News", url: "/news", icon: Newspaper },
      ]
    : coreWithTeamExpenses;
  // Equity directors who aren't admins still get Finance (Woody, 2026-08-22:
  // equity = Woody, Jack, Rupert, Charlotte). Admins already have it in the
  // admin section below.
  // The leasing teams and Tenant Rep have no Lease Advisory or Investment
  // entries (Woody, 2026-11-16; leasingSideOnly in shared/teams.ts), and
  // nobody has them while the team switcher is on one of those teams, so
  // "view as London Estate" shows that team's menu (Woody, 2026-11-17).
  const ownTeams = [user?.team, ...(Array.isArray((user as any)?.additionalTeams) ? (user as any).additionalTeams : [])];
  const leasingSideLogin = !isClientUser && leasingSideOnly(ownTeams);
  const leasingOnly = !isClientUser && (leasingSideLogin || leasingSideOnly([activeTeam]));
  // The Investment team's menu has no Brands (Woody, 2026-11-17: "move brands
  // out of investment side panel"; investmentSideOnly in shared/teams.ts).
  // The team on the switcher decides when it is a BGP team, so Jack viewing
  // a leasing team sees that team's menu; else the login's own teams.
  const investmentOnly = !isClientUser && (isBgpTeam(activeTeam) ? activeTeam === "Investment" : investmentSideOnly(ownTeams));
  // Picking a team that is not your own shows you that team's menu (Woody,
  // 2026-11-17: "when I click on a team i should see what they see"): its
  // Core entries, and none of the admin groups, which come back under All
  // Teams or your own team.
  const viewingAsTeam = !isClientUser && isBgpTeam(activeTeam) && activeTeam !== user?.team
    && !(Array.isArray((user as any)?.additionalTeams) && (user as any).additionalTeams.includes(activeTeam));
  const coreNavLeasing = leasingOnly ? coreNavStaff.filter(i => !LEASING_SIDE_HIDDEN_URLS.includes(i.url)) : coreNavStaff;
  const coreNavTeam = investmentOnly ? coreNavLeasing.filter(i => !INVESTMENT_SIDE_HIDDEN_URLS.includes(i.url)) : coreNavLeasing;
  const coreNav = !isClientUser && !user?.isAdmin && isEquityUser(user as any)
    ? [...coreNavTeam, { title: "Finance", url: "/finance", icon: Landmark }]
    : coreNavTeam;
  const unfinishedNavCleaned = isClientUser
    ? unfinishedNav.filter(i => !CLIENT_HIDDEN_URLS.includes(i.url))
    : unfinishedNav;
  const adminNav = approvalsEntry ? adminNavBase.flatMap(i => i.url === "/expenses" ? [i, approvalsEntry] : [i]) : adminNavBase;
  // The Landsec menu (docs/landsec-menu-plan-2026-11-12.md, part 1):
  // Properties, Deals, Letting Tracker, Tasks and Brands. Applies to Landsec
  // logins and to staff viewing as Landsec; other client teams keep the
  // trimmed client nav.
  const isLandsecClientNav = isClientUser && brand.id === "landsec";
  // The number on its Tasks entry: the login's own open tasks (the same feed
  // the Tasks page reads, so a tick there changes it at once).
  const { data: landsecTaskRows } = useQuery<any[]>({ queryKey: ["/api/tasks"], enabled: !!user && isLandsecClientNav, refetchInterval: 60_000 });
  const landsecNav = withOpenTaskCount(landsecNavFor((user as any)?.landsecRole, !isRealClientLogin), openTaskCount(landsecTaskRows));

  const handleLogout = async () => {
    await apiRequest("POST", "/api/auth/logout");
    localStorage.removeItem("bgp_auth_token");
    localStorage.removeItem("bgp_active_team");
    clearPersistedQueries();
    queryClient.clear();
    window.location.href = "/";
  };

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  return (
    // collapsible="none" pins the left nav permanently open (the hover-peek
    // behaviour moved to the chat panel on the right edge — see App.tsx).
    <Sidebar collapsible="none">
      <SidebarHeader className="p-3 pt-5 pb-5">
        <Link href="/">
          {isLandsec ? (
            <div className="cursor-pointer flex flex-col items-center justify-center h-16 gap-1">
              <ClientBrandLogo brand={brand} />
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
        {isLandsecClientNav ? (
          <>
          <NavSection label="Landsec" items={landsecNav} storageKey="landsec" landsecMenu />
          {/* Back on the Landsec side bar (Woody, 2026-11-14: "add back in the
              side bar Chat BGP Image Studio Cann CAD also quick access"). A
              joint agent's route jail does not open these pages, so its menu
              keeps its own Chat. */}
          {!isRestrictedLandsecRole((user as any)?.landsecRole) && (
            <>
              <QuickAccessSection />
              <SidebarSeparator />
              <NavSection label="AI Tools" items={aiNav.filter(i => i.url !== "/property-intelligence")} storageKey="landsec-ai" />
            </>
          )}
          </>
        ) : (
        <>
        <NavSection label="Core" items={coreNav} storageKey="core" />
        <QuickAccessSection />
        <SidebarSeparator />
        <NavSection
          label="AI Tools"
          items={aiNav
            // CAD Measure stays staff-only. Property Intelligence is client-
            // visible again — its layer endpoints (land-registry, VOA, map
            // layers, OS data, Edozo) are on the client read allowlist now.
            // Image Studio stays: the server scopes the gallery to the
            // client's own buildings.
            .filter(i => !(isClientUser && ["/cad-measure"].includes(i.url)))}
          storageKey="ai"
        />
        <SidebarSeparator />
        <NavSection
          // §15: section labels name the content, not the stack — a client
          // reads "Files & calendar", not BGP's Microsoft licensing.
          label={isClientUser ? "Files & calendar" : "Microsoft 365"}
          items={isClientUser
            ? microsoftNav.filter(i => i.url !== "/mail").map(i => (i.url === "/sharepoint" ? { ...i, title: "Files" } : i))
            : microsoftNav}
          storageKey="ms"
          defaultOpen={false}
        />
        <SidebarSeparator />
        {user?.isAdmin && viewingAsTeam && (
          <p className="px-4 py-2 text-[11px] text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden" data-testid="nav-viewing-as-team">
            More and Admin are under All Teams.
          </p>
        )}
        {user?.isAdmin && !viewingAsTeam && (
          <>
            {/* Shown as "More" — "Unfinished" read as broken to anyone
                glancing at the nav (Woody, 2026-09-27). storageKey kept so
                the open/closed memory survives. */}
            <NavSection
              label="More"
              items={unfinishedNavCleaned}
              storageKey="unfinished"
              defaultOpen={false}
            />
            <SidebarSeparator />
            <NavSection label="Admin" items={adminNav} storageKey="admin" defaultOpen={false}
              closedBadge={approvalsEntry ? { text: approvalsEntry.badge, title: `${approvalCount} expense${approvalCount === 1 ? "" : "s"} to approve` } : null} />
          </>
        )}
        </>
        )}
      </SidebarContent>

      <SidebarFooter className="p-3 space-y-2 group-data-[collapsible=icon]:overflow-hidden group-data-[collapsible=icon]:p-2">
        <div className="flex items-center gap-1 px-1 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs hover:bg-sidebar-accent transition-colors text-sidebar-foreground/70 hover:text-sidebar-foreground group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center"
                data-testid="button-color-scheme"
              >
                <Palette className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate group-data-[collapsible=icon]:hidden">{COLOR_SCHEMES.find(s => s.id === colorScheme)?.label}</span>
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

        {/* Staff who've switched to a client team are seeing exactly what that
            client sees. Say so plainly, with a one-click way out — otherwise
            missing staff data reads as the app being broken. */}
        {isViewingAsClient && (
          <button
            type="button"
            onClick={() => void exitClientView()}
            className="flex items-center justify-between gap-2 w-full px-2 py-1.5 mb-1 rounded-md text-[11px] font-medium bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/80 transition-colors group-data-[collapsible=icon]:hidden"
            title="You're seeing the client's view. Click to return to the full BGP view."
            data-testid="button-exit-client-view"
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <Eye className="w-3 h-3 shrink-0" />
              <span className="truncate">Viewing as {viewingAsName}</span>
            </span>
            <span className="shrink-0 opacity-70">Exit</span>
          </button>
        )}

        {isRealClientLogin ? (
          // Real client logins are pinned to their own team — no switching into
          // BGP's internal team views. (Landsec audit.)
          <div className="flex items-center gap-2 w-full px-2 py-1.5 text-xs font-medium" data-testid="client-team-label">
            <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center shrink-0">
              <Users className="w-3 h-3 text-primary" />
            </div>
            <span className="truncate group-data-[collapsible=icon]:hidden">{userTeam || activeTeam}</span>
          </div>
        ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center justify-between w-full px-2 py-1.5 rounded-md text-xs font-medium hover:bg-sidebar-accent transition-colors group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center"
              data-testid="button-team-switcher"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center shrink-0">
                  <Users className="w-3 h-3 text-primary" />
                </div>
                <span className="truncate group-data-[collapsible=icon]:hidden">{activeTeam === "all" ? "All Teams" : activeTeam || "Select Team"}</span>
              </div>
              <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 opacity-50 group-data-[collapsible=icon]:hidden" />
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
            {/* A leasing-side login is not offered Investment or Lease Advisory. */}
            {TEAMS.filter((team) => !(leasingSideLogin && (team === "Investment" || team === "Lease Advisory"))).map((team) => (
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
        )}

        <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-xs font-medium text-primary">{initials}</span>
          </div>
          <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="text-xs font-medium truncate" data-testid="text-current-user">{user?.name || "Loading..."}</p>
            <p className="text-[10px] text-muted-foreground truncate">{user?.role || "BGP Team"}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 group-data-[collapsible=icon]:hidden"
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
export const mobileOverlayItems = [
  { title: "Today", url: "/today", icon: Sun },
  { title: "My Tasks", url: "/tasks", icon: ListTodo },
  { title: "Tenant Rep", url: "/tenant-rep", icon: Target, adminOnly: true },
  { title: "Letting Hunter", url: "/hunters/letting", icon: Target, adminOnly: true },
  { title: "Investment Hunter", url: "/hunters/investment", icon: Target, adminOnly: true },
  { title: "Double Bill", url: "/leisure-platform", icon: Film, adminOnly: true },
  { title: "Brands", url: "/brands", icon: Store },
  { title: "CRM", url: "/contacts", icon: Handshake },
  { title: "My BGP", url: "/hr", icon: IdCard },
  { title: "Landlord Intelligence", url: "/landlords", icon: Briefcase, adminOnly: true },
  // Leasing Schedule retired (archived) — route stays live for old links.
  { title: "Comps", url: "/comps", icon: Scale },
  { title: "Lease Advisory", url: "/pla/matters", icon: Scale },
  { title: "Investment", url: "/investment", icon: TrendingUp },
  { title: "London Restaurants", url: "/westminster-restaurants", icon: Store, adminOnly: true, badge: "BD" },
  // Studio tools admin-only on mobile too (parity with desktop Admin section) — WIP.
  { title: "Model Studio", url: "/models", icon: FileSpreadsheet, adminOnly: true },
  { title: "Document Studio", url: "/document-studio", icon: FileTextIcon, adminOnly: true },
  { title: "Document Briefs", url: "/document-briefs", icon: FileTextIcon, badge: "AI", adminOnly: true },
  // On mobile everyone uses the lightweight images page (works on auth; the
  // full /image-studio power page is desktop-admin only).
  { title: "Image Studio", url: "/m/images", icon: ImageIcon },
  { title: "SharePoint", url: "/sharepoint", icon: Cloud },
  { title: "Calendar", url: "/calendar", icon: Calendar },
  { title: "Mail", url: "/mail", icon: Mail },
  // Admin gating mirrors the desktop sidebar (Admin + Unfinished groups)
  // so non-admins don't get mobile links into pages whose APIs will 403.
  { title: "Website", url: "/website", icon: Globe, adminOnly: true },
  { title: "WhatsApp", url: "/whatsapp", icon: MessageCircle, adminOnly: true },
  { title: "News", url: "/news", icon: Newspaper, adminOnly: true },
  { title: "Leads", url: "/leads", icon: UserPlus, adminOnly: true },
  { title: "Property Intelligence", url: "/property-intelligence", icon: Globe },
  { title: "Cann CAD", url: "/cad-measure", icon: Ruler, badge: "Beta" },
  { title: "Enrichment Hub", url: "/enrichment", icon: Sparkles, adminOnly: true },
  { title: "Office Add-ins", url: "/addins", icon: Puzzle, adminOnly: true },
  { title: "Settings", url: "/settings", icon: Settings, adminOnly: true },
];

export function MobileSidebarOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [location] = useLocation();
  const { brand } = useBrand();
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });

  // Client logins lose the BGP-internal items (My BGP, WIP).
  const filteredByAdmin = user?.isAdmin ? mobileOverlayItems : mobileOverlayItems.filter((i: any) => !i.adminOnly);
  const clientHidden = ["/hr", "/my-bgp", "/wip-report", "/today", "/mail", "/cad-measure", "/investment"];
  const isOverlayClient = user?.role === "Client" || !!(user as any)?.companyScopeId;
  const overlayLeasingOnly = !isOverlayClient && leasingSideOnly([user?.team, ...(Array.isArray(user?.additionalTeams) ? user.additionalTeams : [])]);
  const overlayInvestmentOnly = !isOverlayClient && investmentSideOnly([user?.team, ...(Array.isArray(user?.additionalTeams) ? user.additionalTeams : [])]);
  const items = isOverlayClient && brand.id === "landsec"
    ? landsecNavFor((user as any)?.landsecRole, user?.role !== "Client")
    : isOverlayClient
    ? filteredByAdmin.filter(i => !clientHidden.includes(i.url))
    : filteredByAdmin.filter(i => !(overlayLeasingOnly && LEASING_SIDE_HIDDEN_URLS.includes(i.url)) && !(overlayInvestmentOnly && INVESTMENT_SIDE_HIDDEN_URLS.includes(i.url)));

  const isActive = (url: string) => {
    const landsecActive = isOverlayClient && brand.id === "landsec" ? landsecMenuActive(url, location) : null;
    if (landsecActive !== null) return landsecActive;
    if (url === "/") return location === "/";
    if (url === "/hr") return location.startsWith("/hr") || MY_BGP_PATHS.some(p => location.startsWith(p));
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
          {(() => {
            // Surface the field-relevant boards first; tuck tools/utilities
            // under a "Tools & more" divider so the phone menu isn't a wall.
            const PRIMARY = new Set(["/today", "/tasks", "/contacts", "/brands", "/comps", "/leads", "/calendar", "/mail", "/news", "/property-intelligence"]);
            const primary = items.filter((i: any) => PRIMARY.has(i.url));
            const more = items.filter((i: any) => !PRIMARY.has(i.url));
            const renderRow = (item: any) => {
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
            };
            return (
              <>
                {primary.map(renderRow)}
                {more.length > 0 && (
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-5 pt-3 pb-1">Tools &amp; more</p>
                )}
                {more.map(renderRow)}
              </>
            );
          })()}
        </div>
      </div>
    </>
  );
}
