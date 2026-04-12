import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient, getQueryFn, apiRequest } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MessageSquare, ArrowLeft, Sparkles, Menu, Smartphone } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ColorSchemeSelector } from "@/components/color-scheme-selector";
import { TeamProvider, useTeam } from "@/lib/team-context";
import type { TeamName } from "@/lib/team-context";
import { BrandProvider } from "@/lib/brand-context";
import { EntitySidebarProvider } from "@/components/crm/entity-sidebar";
import { ChatPanel } from "@/components/chat-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/error-boundary";
import { ConnectionStatus } from "@/components/connection-status";
import { GlobalSearch } from "@/components/global-search";
import { NotificationCenter } from "@/components/notification-center";
import bgpLogoDark from "@assets/BGP_BlackHolder_1771853582461.png";
import bgpLogoLight from "@assets/BGP_WhiteHolder.png_-_new_1771853582466.png";
import LoginPage from "@/pages/login";
import { useSocket } from "@/hooks/use-socket";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useIsMobile, isNativeMobile, getForceDesktop, setForceDesktop } from "@/hooks/use-mobile";
import MobileApp from "@/components/mobile-app";
import { MobileBottomNav, BOTTOM_NAV_PATHS } from "@/components/mobile-bottom-nav";
import { MobileSidebarOverlay } from "@/components/app-sidebar";
import type { User } from "@shared/schema";

const NotFound = lazy(() => import("@/pages/not-found"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const PropertiesHub = lazy(() => import("@/pages/properties-hub"));
const DealsHub = lazy(() => import("@/pages/deals-hub"));
const Requirements = lazy(() => import("@/pages/requirements"));
const News = lazy(() => import("@/pages/news"));
const PeoplePage = lazy(() => import("@/pages/people"));
const SharePoint = lazy(() => import("@/pages/sharepoint"));
const Calendar = lazy(() => import("@/pages/calendar"));
const Mail = lazy(() => import("@/pages/mail"));
const WhatsApp = lazy(() => import("@/pages/whatsapp"));
const Models = lazy(() => import("@/pages/models"));
const DocumentTemplates = lazy(() => import("@/pages/document-templates"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const Comps = lazy(() => import("@/pages/comps"));
const InvestmentComps = lazy(() => import("@/pages/investment-comps"));
const Leads = lazy(() => import("@/pages/leads"));
const Subscriptions = lazy(() => import("@/pages/subscriptions"));
const ChatBGP = lazy(() => import("@/pages/chatbgp"));
const Instructions = lazy(() => import("@/pages/instructions"));
const Enrichment = lazy(() => import("@/pages/enrichment"));
const LandRegistry = lazy(() => import("@/pages/land-registry"));
const VoaRatings = lazy(() => import("@/pages/voa-ratings"));
const BoardReport = lazy(() => import("@/pages/board-report"));
const LeasingSchedule = lazy(() => import("@/pages/leasing-schedule"));
const UploadPage = lazy(() => import("@/pages/upload"));
const MarketingFilesPage = lazy(() => import("@/pages/marketing-files"));
const AddinOutlook = lazy(() => import("@/pages/addin-outlook"));
const AddinExcel = lazy(() => import("@/pages/addin-excel"));
const AddinWord = lazy(() => import("@/pages/addin-word"));
const AddinTeams = lazy(() => import("@/pages/addin-teams"));
const AddinPowerPoint = lazy(() => import("@/pages/addin-powerpoint"));
const AddinAdobe = lazy(() => import("@/pages/addin-adobe"));
const ImageStudio = lazy(() => import("@/pages/image-studio"));
const AddinsPage = lazy(() => import("@/pages/addins"));
const AvailableUnitsPage = lazy(() => import("@/pages/available-units"));
const TurnoverBoard = lazy(() => import("@/pages/turnover-board"));
const TasksPage = lazy(() => import("@/pages/tasks"));
const CadMeasure = lazy(() => import("@/pages/cad-measure"));
const KycClouseau = lazy(() => import("@/pages/kyc-clouseau"));
const Reporting = lazy(() => import("@/pages/reporting"));
const TodayPage = lazy(() => import("@/pages/today"));


function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <div className="h-0.5 w-24 bg-neutral-200 dark:bg-neutral-800 rounded overflow-hidden">
        <div className="h-full w-8 bg-neutral-400 dark:bg-neutral-600 rounded animate-pulse" />
      </div>
    </div>
  );
}

function DiaryRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/calendar"); }, [setLocation]);
  return null;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { data: user } = useQuery<User | null>({ queryKey: ["/api/auth/me"], queryFn: getQueryFn({ on401: "returnNull" }) });
  const [, navigate] = useLocation();
  useEffect(() => { if (user && !user.isAdmin) navigate("/"); }, [user, navigate]);
  if (!user || !user.isAdmin) return <PageLoader />;
  return <>{children}</>;
}

function Router() {
  return (
    <ErrorBoundary>
    <Suspense fallback={<PageLoader />}>
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/instructions" component={Instructions} />
      <Route path="/properties" component={PropertiesHub} />
      <Route path="/properties/:id" component={PropertiesHub} />
      <Route path="/map" component={PropertiesHub} />
      <Route path="/deals" component={DealsHub} />
      <Route path="/deals/:rest*" component={DealsHub} />
      <Route path="/requirements" component={Requirements} />
      <Route path="/today" component={TodayPage} />
      <Route path="/news" component={News} />
      <Route path="/diary" component={DiaryRedirect} />
      <Route path="/companies" component={PeoplePage} />
      <Route path="/companies/:id" component={PeoplePage} />
      <Route path="/contacts" component={PeoplePage} />
      <Route path="/contacts/:id" component={PeoplePage} />
      <Route path="/sharepoint" component={SharePoint} />
      <Route path="/calendar" component={Calendar} />
      <Route path="/mail" component={Mail} />
      <Route path="/whatsapp" component={WhatsApp} />
      <Route path="/models" component={Models} />
      <Route path="/templates" component={DocumentTemplates} />
      <Route path="/image-studio">{() => <AdminRoute><ImageStudio /></AdminRoute>}</Route>
      <Route path="/settings" component={SettingsPage} />
      <Route path="/comps" component={Comps} />
      <Route path="/comps/:id" component={Comps} />
      <Route path="/investment-comps" component={InvestmentComps} />
      <Route path="/leads" component={Leads} />
      <Route path="/subscriptions" component={Subscriptions} />
      <Route path="/chatbgp" component={ChatBGP} />
      <Route path="/enrichment" component={Enrichment} />
      <Route path="/land-registry" component={LandRegistry} />
      <Route path="/business-rates" component={VoaRatings} />
      <Route path="/board-report" component={BoardReport} />
      <Route path="/reporting" component={Reporting} />
      <Route path="/leasing-schedule" component={LeasingSchedule} />
      <Route path="/leasing-schedule/:propertyId" component={LeasingSchedule} />
      <Route path="/tasks" component={TasksPage} />
      <Route path="/cad-measure" component={CadMeasure} />
      <Route path="/kyc-clouseau" component={KycClouseau} />
      <Route path="/turnover" component={TurnoverBoard} />
      <Route path="/wip-report" component={DealsHub} />
      <Route path="/upload" component={UploadPage} />
      <Route path="/available" component={AvailableUnitsPage} />
      <Route path="/investment-tracker" component={DealsHub} />
      <Route path="/marketing-files" component={MarketingFilesPage} />
      <Route path="/addins" component={AddinsPage} />
      <Route path="/edozo" component={PropertiesHub} />
      <Route component={NotFound} />
    </Switch>
    </Suspense>
    </ErrorBoundary>
  );
}

function AuthenticatedApp() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [chatOpen, setChatOpen] = useState(true);
  const [aiChatRequested, setAiChatRequested] = useState(false);
  const [location, navigate] = useLocation();
  const isChatBGP = location === "/chatbgp";
  const { data: currentUser } = useQuery<User | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  useSocket(currentUser?.id || null);

  useEffect(() => {
    if (!currentUser?.id) return;
    const sendHeartbeat = () => {
      apiRequest("POST", "/api/heartbeat").catch(() => {});
    };
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 60000);
    return () => clearInterval(interval);
  }, [currentUser?.id]);

  const { subscribe: subscribePush, isSubscribed: isPushSubscribed, isSupported: isPushSupported } = usePushNotifications();
  useEffect(() => {
    if (currentUser && isPushSupported && !isPushSubscribed && Notification.permission !== "denied") {
      subscribePush();
    }
  }, [currentUser, isPushSupported, isPushSubscribed, subscribePush]);
  const { data: chatNotifications } = useQuery<{ unseenCount: number }>({
    queryKey: ["/api/chat/notifications"],
    enabled: !!currentUser,
    refetchInterval: 15000,
  });
  const chatUnseenCount = chatNotifications?.unseenCount || 0;
  const style = {
    "--sidebar-width": "14rem",
    "--sidebar-width-icon": "3rem",
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const msError = params.get("microsoft_error");
    const msConnected = params.get("microsoft_connected");

    if (params.get("share") === "pending") {
      navigate("/upload?share=pending");
      return;
    }

    if (msConnected === "true") {
      toast({ title: "Microsoft 365 connected", description: "Your email, calendar and files are now accessible." });
      queryClient.invalidateQueries({ queryKey: ["/api/microsoft/status"] });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (msError) {
      toast({ title: "Microsoft connection failed", description: decodeURIComponent(msError), variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [toast, navigate]);

  useEffect(() => {
    const handler = () => {
      setChatOpen(true);
      setAiChatRequested(true);
    };
    window.addEventListener("open-ai-chat", handler);
    return () => window.removeEventListener("open-ai-chat", handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      setChatOpen(true);
    };
    window.addEventListener("open-ai-chat-with-prompt", handler);
    return () => window.removeEventListener("open-ai-chat-with-prompt", handler);
  }, []);

  const nativeMobile = isNativeMobile();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  if ((isMobile || nativeMobile) && (location === "/" || location === "/chatbgp")) {
    return <MobileApp initialTab="ai" />;
  }

  if ((isMobile || nativeMobile) && location === "/upload") {
    return (
      <div className="flex flex-col" style={{ height: "100dvh" }}>
        <Router />
      </div>
    );
  }

  if (isMobile || nativeMobile) {
    const isBottomNavRoute = BOTTOM_NAV_PATHS.some(p => p !== "/" && location.startsWith(p));
    return (
      <div className="flex flex-col" style={{ height: "100dvh" }}>
        <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0" style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}>
          {!isBottomNavRoute && (
            <button onClick={() => navigate("/")} className="p-1" data-testid="button-mobile-page-back">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <span className="text-sm font-semibold flex-1">
            {location === "/" ? "Dashboard" : location.replace(/^\//, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 pb-14 md:pb-0">
          <Router />
        </div>
        <MobileBottomNav onMoreTap={() => setMobileSidebarOpen(true)} />
        <MobileSidebarOverlay open={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />
      </div>
    );
  }

  if (isChatBGP) {
    return (
      <div className="h-screen w-screen max-w-[100vw] overflow-hidden flex flex-col">
        <header className="flex items-center justify-between gap-2 px-3 py-2 border-b h-12 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/")}
              className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
              title="Back to Dashboard"
              data-testid="button-chatbgp-back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <img src={bgpLogoDark} alt="BGP" className="h-5 dark:hidden" />
            <img src={bgpLogoLight} alt="BGP" className="h-5 hidden dark:block" />
          </div>
          <div className="flex items-center gap-2">
            <ColorSchemeSelector />
          </div>
        </header>
        <div className="flex-1 min-h-0 overflow-hidden">
          <Suspense fallback={<PageLoader />}>
            <ChatBGP />
          </Suspense>
        </div>
      </div>
    );
  }

  const isForceDesktop = getForceDesktop();

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <header className="flex items-center justify-between gap-2 p-2 border-b h-12 shrink-0">
            <div className="flex items-center gap-2">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <GlobalSearch />
            </div>
            <div className="flex items-center gap-2">
              <ColorSchemeSelector />
              <NotificationCenter />
              <button
                data-testid="button-chat-toggle"
                onClick={() => setChatOpen(prev => !prev)}
                className="relative inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                title="Team Chat"
              >
                <MessageSquare className="h-4 w-4" />
                {chatUnseenCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-medium">
                    {chatUnseenCount > 99 ? "99+" : chatUnseenCount}
                  </span>
                )}
              </button>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto min-h-0">
            <Router />
          </div>
        </div>
        <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} openAiChat={aiChatRequested} onAiChatHandled={() => setAiChatRequested(false)} />
      </div>
      {isForceDesktop && (
        <button
          onClick={() => setForceDesktop(false)}
          className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 px-3 py-2 rounded-full bg-black text-white text-xs font-medium shadow-lg hover:bg-gray-800 transition-colors"
          data-testid="button-back-to-mobile"
        >
          <Smartphone className="w-3.5 h-3.5" />
          Mobile view
        </button>
      )}
    </SidebarProvider>
  );
}

function AddinRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/addin/outlook" component={AddinOutlook} />
        <Route path="/addin/excel" component={AddinExcel} />
        <Route path="/addin/word" component={AddinWord} />
        <Route path="/addin/teams" component={AddinTeams} />
        <Route path="/addin/powerpoint" component={AddinPowerPoint} />
        <Route path="/addin/adobe" component={AddinAdobe} />
      </Switch>
    </Suspense>
  );
}

function AppContent() {
  const { setUserTeam, setUserId, setAdditionalTeams } = useTeam();
  const [location] = useLocation();
  const isAddin = location.startsWith("/addin/");
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    enabled: !isAddin,
  });

  useEffect(() => {
    if (user?.id) {
      setUserId(user.id);
    }
    if (user?.team) {
      setUserTeam(user.team as TeamName);
    }
    const extra = (user as any)?.additionalTeams;
    if (extra && Array.isArray(extra)) {
      setAdditionalTeams(extra as TeamName[]);
    }
  }, [user?.team, user?.id, (user as any)?.additionalTeams, setUserTeam, setUserId, setAdditionalTeams]);

  if (isAddin) {
    return <AddinRouter />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="space-y-4 text-center">
          <img src={bgpLogoDark} alt="BGP" className="h-10 w-auto mx-auto dark:hidden" />
          <img src={bgpLogoLight} alt="BGP" className="h-10 w-auto mx-auto hidden dark:block" />
          <div className="h-0.5 w-24 mx-auto bg-neutral-200 dark:bg-neutral-800 rounded overflow-hidden">
            <div className="h-full w-8 bg-neutral-400 dark:bg-neutral-600 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage
        onLogin={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        }}
      />
    );
  }

  return (
    <>
      <ConnectionStatus />
      <AuthenticatedApp />
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TeamProvider>
          <BrandProvider>
            <TooltipProvider>
              <EntitySidebarProvider>
                <AppContent />
                <Toaster />
              </EntitySidebarProvider>
            </TooltipProvider>
          </BrandProvider>
        </TeamProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
