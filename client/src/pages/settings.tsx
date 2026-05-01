import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Users, ChevronDown, ChevronRight, ShieldCheck, AlertTriangle, CheckCircle2, Loader2, Building, Contact, Home, Trash2, Mail, RefreshCw, Play, Inbox, Activity, Wifi, WifiOff, Shield, Clock, MessageSquare, Eye, ExternalLink, User, Landmark, Plus, Power, FolderOpen, Upload, Download, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

interface TeamMember {
  id: string;
  username: string;
  name: string;
  role: string | null;
  department: string | null;
  team: string | null;
  isActive?: boolean;
}

const TEAM_GROUPS = ["Development", "London F&B", "London Retail", "National Leasing", "Investment", "Tenant Rep", "Lease Advisory", "Office / Corporate", "Landsec"] as const;

const TEAM_GROUP_MEMBERS: Record<string, string[]> = {
  Investment: ["Investment"],
  "London F&B": ["London F&B"],
  "London Retail": ["London Retail"],
  "Lease Advisory": ["Lease Advisory"],
  "Office / Corporate": ["Office / Corporate"],
  "National Leasing": ["National Leasing"],
  "Tenant Rep": ["Tenant Rep"],
  Development: ["Development"],
  Landsec: ["Landsec"],
};

const teamColors: Record<string, string> = {
  Investment: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "London F&B": "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  "London Retail": "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  "Lease Advisory": "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  "Office / Corporate": "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300",
  "National Leasing": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Tenant Rep": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  Development: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  Landsec: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

const teamDotColors: Record<string, string> = {
  Investment: "bg-blue-500",
  "London F&B": "bg-rose-500",
  "London Retail": "bg-teal-500",
  "Lease Advisory": "bg-indigo-500",
  "Office / Corporate": "bg-slate-500",
  "National Leasing": "bg-emerald-500",
  "Tenant Rep": "bg-purple-500",
  Development: "bg-amber-500",
  Landsec: "bg-rose-500",
};

function getTeamGroup(memberTeam: string | null): string | null {
  if (!memberTeam) return null;
  for (const [group, subTeams] of Object.entries(TEAM_GROUP_MEMBERS)) {
    if (subTeams.includes(memberTeam)) return group;
  }
  return null;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>({
    Investment: true, "Lease Advisory": true,
    "Office / Corporate": true, "National Leasing": true, "Tenant Rep": true, Development: true,
  });

  const { data: currentUser } = useQuery<{ isAdmin?: boolean; is_admin?: boolean }>({
    queryKey: ["/api/auth/me"],
  });
  const isAdmin = currentUser?.isAdmin || currentUser?.is_admin;

  const { data: members, isLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/team-members"],
  });

  const updateTeam = useMutation({
    mutationFn: async ({ id, team }: { id: string; team: string }) => {
      await apiRequest("PATCH", `/api/team-members/${id}/team`, { team });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-members"] });
      toast({ title: "Team updated", description: "Team assignment saved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update team.", variant: "destructive" });
    },
  });

  const toggleAccess = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await apiRequest("POST", `/api/admin/users/${id}/toggle-access`, { active });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: data.isActive ? "Access enabled" : "Access revoked", description: `${data.name}'s access has been ${data.isActive ? "enabled" : "disabled and they have been logged out"}.` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to update access.", variant: "destructive" });
    },
  });

  const forceLogout = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/users/${id}/force-logout`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Logged out", description: `${data.name} has been logged out (${data.sessionsCleared} session${data.sessionsCleared !== 1 ? "s" : ""} cleared).` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to force logout.", variant: "destructive" });
    },
  });

  const toggleTeam = (team: string) => {
    setExpandedTeams((prev) => ({ ...prev, [team]: !prev[team] }));
  };

  const getMembersForGroup = (group: string) =>
    (members || []).filter((m) => getTeamGroup(m.team) === group);

  const teamCounts = TEAM_GROUPS.map((t) => ({
    name: t,
    count: getMembersForGroup(t).length,
  }));

  const getMembersForSubTeam = (group: string, subTeam: string) =>
    (members || []).filter((m) => getTeamGroup(m.team) === group && m.team === subTeam);

  const unassigned = (members || []).filter((m) => !m.team || !getTeamGroup(m.team));

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="settings-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Organisation</h1>
        <p className="text-sm text-muted-foreground">
          Team structure and assignments — {members?.length || 0} members across {TEAM_GROUPS.length} teams
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {teamCounts.map((t) => (
          <Card
            key={t.name}
            className="flex-1 min-w-[140px] cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => toggleTeam(t.name)}
          >
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className={`text-[10px] ${teamColors[t.name] || ""}`}>
                  {t.name}
                </Badge>
                <span className="text-lg font-bold ml-auto">{t.count}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (<>
        <div className="space-y-4">
          {TEAM_GROUPS.map((group) => {
            const groupMembers = getMembersForGroup(group);
            if (groupMembers.length === 0) return null;
            const isExpanded = expandedTeams[group];
            const predefined = TEAM_GROUP_MEMBERS[group] || [];
            const allSubTeams = Array.from(new Set(groupMembers.map((m) => m.team || "Other")));
            const extraSubTeams = allSubTeams.filter((st) => !predefined.includes(st));
            const subTeams = [...predefined, ...extraSubTeams];

            return (
              <Card key={group}>
                <CardHeader
                  className="cursor-pointer pb-2 hover:bg-muted/30 transition-colors"
                  onClick={() => toggleTeam(group)}
                  data-testid={`team-header-${group}`}
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    <div className={`w-3 h-3 rounded-full ${teamDotColors[group]}`} />
                    <CardTitle className="text-base">{group}</CardTitle>
                    <span className="text-sm text-muted-foreground ml-auto">{groupMembers.length} members</span>
                  </div>
                </CardHeader>
                {isExpanded && (
                  <CardContent className="pt-0">
                    <div className="space-y-4">
                      {subTeams.map((subTeam) => {
                        const subTeamMembers = getMembersForSubTeam(group, subTeam);
                        if (subTeamMembers.length === 0) return null;
                        return (
                          <div key={subTeam}>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{subTeam}</span>
                              <div className="flex-1 border-t border-border/50" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                              {subTeamMembers.map((member) => (
                                <div
                                  key={member.id}
                                  className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${member.isActive === false ? "bg-red-50 opacity-60" : "bg-muted/30 hover:bg-muted/50"}`}
                                  data-testid={`member-card-${member.username}`}
                                >
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${member.isActive === false ? "bg-red-100" : "bg-primary/10"}`}>
                                    <span className={`text-[11px] font-medium ${member.isActive === false ? "text-red-500" : "text-primary"}`}>
                                      {member.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                                    </span>
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium truncate">{member.name}{member.isActive === false && <span className="text-red-500 ml-1 text-[10px]">(disabled)</span>}</p>
                                    <p className="text-[11px] text-muted-foreground truncate">{member.role || "—"}</p>
                                  </div>
                                  {isAdmin && (
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        onClick={() => toggleAccess.mutate({ id: member.id, active: member.isActive === false })}
                                        className={`p-1 rounded-md text-[10px] transition-colors ${member.isActive === false ? "hover:bg-green-100 text-green-600" : "hover:bg-red-100 text-red-500"}`}
                                        title={member.isActive === false ? "Enable access" : "Disable access"}
                                        data-testid={`toggle-access-${member.username}`}
                                      >
                                        {member.isActive === false ? <Power className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                                      </button>
                                      {member.isActive !== false && (
                                        <button
                                          onClick={() => forceLogout.mutate(member.id)}
                                          className="p-1 rounded-md hover:bg-orange-100 text-orange-500 transition-colors"
                                          title="Force logout"
                                          data-testid={`force-logout-${member.username}`}
                                        >
                                          <WifiOff className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  <Select
                                    value={member.team || ""}
                                    onValueChange={(val) => updateTeam.mutate({ id: member.id, team: val })}
                                  >
                                    <SelectTrigger
                                      className="h-7 w-[100px] text-[10px] border-transparent bg-transparent hover:bg-background hover:border-border shrink-0"
                                      data-testid={`select-team-${member.username}`}
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {Object.entries(TEAM_GROUP_MEMBERS).map(([grp, subs]) =>
                                        subs.map((st) => (
                                          <SelectItem key={st} value={st}>
                                            <span className="flex items-center gap-1.5">
                                              <span className={`w-1.5 h-1.5 rounded-full inline-block ${teamDotColors[grp]}`} />
                                              {st}
                                            </span>
                                          </SelectItem>
                                        ))
                                      )}
                                    </SelectContent>
                                  </Select>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}

          {unassigned.length > 0 && (
            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-muted-foreground">Unassigned</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {unassigned.map((member) => (
                    <div
                      key={member.id}
                      className={`flex items-center gap-3 p-2.5 rounded-lg ${member.isActive === false ? "bg-red-50 opacity-60" : "bg-muted/30"}`}
                      data-testid={`member-card-${member.username}`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${member.isActive === false ? "bg-red-100" : "bg-muted"}`}>
                        <span className={`text-[11px] font-medium ${member.isActive === false ? "text-red-500" : "text-muted-foreground"}`}>
                          {member.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{member.name}{member.isActive === false && <span className="text-red-500 ml-1 text-[10px]">(disabled)</span>}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{member.role || member.department || "—"}</p>
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => toggleAccess.mutate({ id: member.id, active: member.isActive === false })}
                            className={`p-1 rounded-md text-[10px] transition-colors ${member.isActive === false ? "hover:bg-green-100 text-green-600" : "hover:bg-red-100 text-red-500"}`}
                            title={member.isActive === false ? "Enable access" : "Disable access"}
                            data-testid={`toggle-access-${member.username}`}
                          >
                            {member.isActive === false ? <Power className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                          </button>
                          {member.isActive !== false && (
                            <button
                              onClick={() => forceLogout.mutate(member.id)}
                              className="p-1 rounded-md hover:bg-orange-100 text-orange-500 transition-colors"
                              title="Force logout"
                              data-testid={`force-logout-${member.username}`}
                            >
                              <WifiOff className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                      <Select
                        value={member.team || ""}
                        onValueChange={(val) => updateTeam.mutate({ id: member.id, team: val })}
                      >
                        <SelectTrigger
                          className="h-7 w-[100px] text-[10px] shrink-0"
                          data-testid={`select-team-${member.username}`}
                        >
                          <SelectValue placeholder="Assign..." />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(TEAM_GROUP_MEMBERS).map(([grp, subs]) =>
                            subs.map((st) => (
                              <SelectItem key={st} value={st}>
                                <span className="flex items-center gap-1.5">
                                  <span className={`w-1.5 h-1.5 rounded-full inline-block ${teamDotColors[grp]}`} />
                                  {st}
                                </span>
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {isAdmin && (
          <Card data-testid="card-landsec-demo">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Landmark className="w-4 h-4 text-blue-500" />
                Landsec Demo Account
                <Badge className="bg-blue-500 text-white text-[10px] ml-1">Demo</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Preview the Landsec demo data set up for Mark Warne. This includes 6 flagship London properties, 38 tenancy entries, 8 active deals, and 29 contacts with character avatars.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href="/contacts/901d8273-6c67-4860-a23f-ab7152e4666e">
                  <Button variant="outline" size="sm" className="gap-1.5" data-testid="button-view-mark-warne">
                    <User className="w-3.5 h-3.5" />
                    Mark Warne
                    <ExternalLink className="w-3 h-3 ml-0.5 opacity-50" />
                  </Button>
                </Link>
                <Link href="/companies/8f24f46b-77f9-4b32-bb30-63ee1c6cafb7">
                  <Button variant="outline" size="sm" className="gap-1.5" data-testid="button-view-landsec">
                    <Building className="w-3.5 h-3.5" />
                    Landsec Company
                    <ExternalLink className="w-3 h-3 ml-0.5 opacity-50" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
        <TeamFoldersSection />
        {isAdmin && <UserActivitySection />}
        {isAdmin && <EmailIntelligenceSection />}
        <DataHealthSection />
        <ChatBGPLearningsSection />
        <AppFeedbackSection />
        <ChangeRequestsSection />
        <EmailProcessorSection />
      </>)}
    </div>
  );
}

interface UserActivityData {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  team: string | null;
  profile_pic_url: string | null;
  last_login_at: string | null;
  login_count: number;
  last_active_at: string | null;
  login_method: string | null;
  o365_linked: boolean;
  o365_linked_at: string | null;
  has_msal_cache: boolean;
  msal_cache_updated: string | null;
  active_token_count: string;
  total_ai_messages: string;
  last_ai_message_at: string | null;
  is_currently_online: boolean;
  has_session_ms_tokens: boolean;
  page_views: number;
  total_session_minutes: number;
  current_session_minutes: number;
  last_heartbeat_at: string | null;
}

interface UserActivitySummary {
  totalUsers: number;
  usersOnline: number;
  usersWithO365: number;
  usersEverLoggedIn: number;
  usersActiveThisWeek: number;
  totalLogins: number;
  totalAiMessages: number;
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatDuration(minutes: number): string {
  if (!minutes || minutes < 1) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

function UserActivitySection() {
  const { data, isLoading } = useQuery<{ users: UserActivityData[]; summary: UserActivitySummary }>({
    queryKey: ["/api/admin/user-activity"],
    refetchInterval: 30000,
  });

  const summary = data?.summary;
  const userList = data?.users || [];

  return (
    <Card data-testid="card-user-activity">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4" />
            User Activity & Office 365
          </CardTitle>
          {summary && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Wifi className="w-3 h-3 text-green-500" />
                {summary.usersOnline} online
              </span>
              <span className="flex items-center gap-1">
                <Shield className="w-3 h-3 text-blue-500" />
                {summary.usersWithO365} O365
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {summary.usersEverLoggedIn}/{summary.totalUsers} activated
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : (
          <>
            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-green-700 dark:text-green-400">{summary.usersOnline}</div>
                  <div className="text-[10px] text-green-600 dark:text-green-500 uppercase tracking-wider">Online Now</div>
                </div>
                <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-blue-700 dark:text-blue-400">{summary.usersWithO365}</div>
                  <div className="text-[10px] text-blue-600 dark:text-blue-500 uppercase tracking-wider">O365 Linked</div>
                </div>
                <div className="bg-purple-50 dark:bg-purple-950/30 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-purple-700 dark:text-purple-400">{summary.usersActiveThisWeek}</div>
                  <div className="text-[10px] text-purple-600 dark:text-purple-500 uppercase tracking-wider">Active This Week</div>
                </div>
                <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-amber-700 dark:text-amber-400">{summary.totalAiMessages}</div>
                  <div className="text-[10px] text-amber-600 dark:text-amber-500 uppercase tracking-wider">ChatBGP Messages</div>
                </div>
              </div>
            )}
            <div className="border rounded-lg overflow-hidden">
              <div className="grid grid-cols-[1fr_70px_70px_80px_70px_80px_70px_70px] gap-0 bg-muted/50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b">
                <span>User</span>
                <span className="text-center">Status</span>
                <span className="text-center">O365</span>
                <span className="text-center">Last Active</span>
                <span className="text-center">Logins</span>
                <span className="text-center">Time Spent</span>
                <span className="text-center">Session</span>
                <span className="text-center">AI Msgs</span>
              </div>
              <div className="max-h-[400px] overflow-y-auto divide-y divide-border/50">
                {userList.map((user) => {
                  const o365Status = user.o365_linked || user.has_msal_cache;
                  return (
                    <div
                      key={user.id}
                      className="grid grid-cols-[1fr_70px_70px_80px_70px_80px_70px_70px] gap-0 px-3 py-2 items-center hover:bg-muted/20 transition-colors"
                      data-testid={`user-activity-row-${user.id}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="relative shrink-0">
                          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                            {user.profile_pic_url ? (
                              <img src={user.profile_pic_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-[10px] font-medium text-muted-foreground">
                                {user.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                              </span>
                            )}
                          </div>
                          {user.is_currently_online && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-background" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{user.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{user.role || user.team || "—"}</p>
                        </div>
                      </div>
                      <div className="flex justify-center">
                        {user.is_currently_online ? (
                          <Badge className="text-[9px] px-1.5 py-0 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0">Online</Badge>
                        ) : user.last_active_at ? (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground">Offline</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground/50">Never</Badge>
                        )}
                      </div>
                      <div className="flex justify-center">
                        {o365Status ? (
                          <Badge className="text-[9px] px-1.5 py-0 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0">
                            <Shield className="w-2.5 h-2.5 mr-0.5" />
                            Linked
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground/50">
                            <WifiOff className="w-2.5 h-2.5 mr-0.5" />
                            No
                          </Badge>
                        )}
                      </div>
                      <div className="text-center">
                        <span className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {formatTimeAgo(user.last_active_at)}
                        </span>
                      </div>
                      <div className="text-center">
                        <span className="text-xs font-medium">{user.login_count || 0}</span>
                      </div>
                      <div className="text-center">
                        <span className="text-[10px] font-medium text-muted-foreground" data-testid={`time-spent-${user.id}`}>
                          {formatDuration(user.total_session_minutes || 0)}
                        </span>
                      </div>
                      <div className="text-center">
                        {user.is_currently_online && user.current_session_minutes > 0 ? (
                          <span className="text-[10px] font-medium text-green-600 dark:text-green-400" data-testid={`session-time-${user.id}`}>
                            {formatDuration(user.current_session_minutes)}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </div>
                      <div className="text-center">
                        <span className="text-xs font-medium flex items-center justify-center gap-1">
                          <MessageSquare className="w-2.5 h-2.5 text-muted-foreground" />
                          {parseInt(user.total_ai_messages || '0')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface DupeScanResult {
  companies: { duplicates: Array<{ name: string; ids: string[]; count: number }>; count: number };
  contacts: {
    emailDuplicates: Array<{ email: string; ids: string[]; names: string[]; count: number }>;
    emailCount: number;
    nameDuplicates: Array<{ name: string; ids: string[]; companies: string[]; count: number }>;
    nameCount: number;
  };
  properties: { duplicates: Array<{ name: string; ids: string[]; count: number }>; count: number };
  summary: { totalDuplicateGroups: number; clean: boolean };
}

function EmailIntelligenceSection() {
  const [activeTab, setActiveTab] = useState<"health" | "engagement" | "leaderboard" | "discover">("health");

  const { data: healthData, isLoading: healthLoading } = useQuery<{
    totalInteractions: number;
    emailInteractions: number;
    calendarInteractions: number;
    contactsCovered: number;
    totalContacts: number;
    coveragePercent: number;
    lastSyncTime: string | null;
    interactionsByDay: Array<{ date: string; count: number }>;
    topDomains: Array<{ domain: string; count: number }>;
  }>({
    queryKey: ["/api/interactions/sync-health"],
    enabled: activeTab === "health",
  });

  const { data: engagementData, isLoading: engagementLoading } = useQuery<{
    scores: Array<{
      contactId: string;
      contactName: string;
      companyName: string | null;
      totalInteractions: number;
      emailsIn: number;
      emailsOut: number;
      meetings: number;
      lastContact: string;
      engagementScore: number;
      trend: "rising" | "stable" | "cooling";
      bgpAgents: string[];
    }>;
  }>({
    queryKey: ["/api/interactions/engagement"],
    enabled: activeTab === "engagement",
  });

  const { data: leaderboardData, isLoading: leaderboardLoading } = useQuery<{
    leaderboard: Array<{
      agent: string;
      emailsSent: number;
      emailsReceived: number;
      meetingsHeld: number;
      meetingsUpcoming: number;
      uniqueContacts: number;
      totalActivity: number;
    }>;
  }>({
    queryKey: ["/api/interactions/leaderboard"],
    enabled: activeTab === "leaderboard",
  });

  const { data: discoverData, isLoading: discoverLoading } = useQuery<{
    suggestions: Array<{
      email: string;
      name: string;
      domain: string;
      frequency: number;
      bgpUsers: string[];
      lastSeen: string;
      sampleSubjects: string[];
    }>;
    scannedUsers: number;
    totalEmails: number;
  }>({
    queryKey: ["/api/contacts/discover-from-email"],
    enabled: activeTab === "discover",
  });

  const { toast } = useToast();

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/interactions/sync?daysBack=90&daysForward=60"),
    onSuccess: () => {
      toast({ title: "Sync triggered", description: "Email & calendar sync is running" });
      queryClient.invalidateQueries({ queryKey: ["/api/interactions/sync-health"] });
    },
    onError: () => toast({ title: "Sync failed", variant: "destructive" }),
  });

  const autoCreateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/contacts/auto-create?minFrequency=3&daysBack=90"),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Contacts Created", description: `${data.created?.length || 0} new contacts added, ${data.skipped || 0} skipped` });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/discover-from-email"] });
    },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  const trendIcon = (trend: string) => {
    if (trend === "rising") return <span className="text-green-500">↑</span>;
    if (trend === "cooling") return <span className="text-red-400">↓</span>;
    return <span className="text-gray-400">→</span>;
  };

  const tabs = [
    { key: "health" as const, label: "Sync Health", icon: Activity },
    { key: "engagement" as const, label: "Engagement", icon: Users },
    { key: "leaderboard" as const, label: "Agent Activity", icon: Eye },
    { key: "discover" as const, label: "Discover Contacts", icon: Contact },
  ];

  return (
    <Card data-testid="email-intelligence-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="w-4 h-4" />
          Email Intelligence
        </CardTitle>
        <div className="flex gap-1 mt-2 flex-wrap">
          {tabs.map(t => (
            <Button
              key={t.key}
              data-testid={`tab-${t.key}`}
              variant={activeTab === t.key ? "default" : "outline"}
              size="sm"
              className="text-xs h-7"
              onClick={() => setActiveTab(t.key)}
            >
              <t.icon className="w-3 h-3 mr-1" />
              {t.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {activeTab === "health" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Last sync: {healthData?.lastSyncTime ? formatTimeAgo(healthData.lastSyncTime) : "Never"}
              </span>
              <Button
                data-testid="trigger-sync"
                size="sm"
                variant="outline"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="text-xs h-7"
              >
                {syncMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                Sync Now
              </Button>
            </div>

            {healthLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-4 w-full" />)}</div>
            ) : healthData ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold" data-testid="text-total-interactions">{healthData.totalInteractions.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Total Interactions</div>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold" data-testid="text-email-count">{healthData.emailInteractions.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Emails Tracked</div>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold" data-testid="text-calendar-count">{healthData.calendarInteractions.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Calendar Events</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">CRM Coverage:</span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${healthData.coveragePercent}%` }} />
                  </div>
                  <span className="font-medium">{healthData.coveragePercent}%</span>
                  <span className="text-xs text-muted-foreground">({healthData.contactsCovered}/{healthData.totalContacts})</span>
                </div>

                {healthData.topDomains.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-2">Top External Domains</div>
                    <div className="flex flex-wrap gap-1">
                      {healthData.topDomains.slice(0, 10).map(d => (
                        <Badge key={d.domain} variant="outline" className="text-xs">{d.domain} ({d.count})</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {healthData.interactionsByDay.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-2">Daily Activity (30 days)</div>
                    <div className="flex items-end gap-px h-16">
                      {healthData.interactionsByDay.slice(0, 30).reverse().map((d, i) => {
                        const max = Math.max(...healthData.interactionsByDay.map(x => x.count));
                        const pct = max > 0 ? (d.count / max) * 100 : 0;
                        return (
                          <div key={i} className="flex-1 bg-primary/60 hover:bg-primary rounded-t transition-colors" style={{ height: `${Math.max(pct, 2)}%` }} title={`${d.date}: ${d.count}`} />
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}

        {activeTab === "engagement" && (
          <div className="space-y-2">
            {engagementLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : engagementData?.scores.length ? (
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left py-1.5 pr-2">Contact</th>
                      <th className="text-center py-1.5 px-1">Score</th>
                      <th className="text-center py-1.5 px-1">Trend</th>
                      <th className="text-center py-1.5 px-1">Emails</th>
                      <th className="text-center py-1.5 px-1">Meetings</th>
                      <th className="text-right py-1.5 pl-1">Agents</th>
                    </tr>
                  </thead>
                  <tbody>
                    {engagementData.scores.slice(0, 30).map(s => (
                      <tr key={s.contactId} className="border-b border-muted/50 hover:bg-muted/30" data-testid={`engagement-row-${s.contactId}`}>
                        <td className="py-1.5 pr-2">
                          <div className="font-medium text-xs">{s.contactName}</div>
                          {s.companyName && <div className="text-xs text-muted-foreground">{s.companyName}</div>}
                        </td>
                        <td className="text-center py-1.5 px-1">
                          <Badge variant={s.engagementScore > 50 ? "default" : "secondary"} className="text-xs">{s.engagementScore}</Badge>
                        </td>
                        <td className="text-center py-1.5 px-1">{trendIcon(s.trend)}</td>
                        <td className="text-center py-1.5 px-1 text-xs">{s.emailsIn + s.emailsOut}</td>
                        <td className="text-center py-1.5 px-1 text-xs">{s.meetings}</td>
                        <td className="text-right py-1.5 pl-1 text-xs text-muted-foreground">{s.bgpAgents.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="text-sm text-muted-foreground text-center py-4">No engagement data yet</div>}
          </div>
        )}

        {activeTab === "leaderboard" && (
          <div className="space-y-2">
            {leaderboardLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : leaderboardData?.leaderboard.length ? (
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left py-1.5 pr-2">Agent</th>
                      <th className="text-center py-1.5 px-1">Sent</th>
                      <th className="text-center py-1.5 px-1">Received</th>
                      <th className="text-center py-1.5 px-1">Meetings</th>
                      <th className="text-center py-1.5 px-1">Upcoming</th>
                      <th className="text-center py-1.5 px-1">Contacts</th>
                      <th className="text-right py-1.5 pl-1">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboardData.leaderboard.map((a, i) => (
                      <tr key={a.agent} className="border-b border-muted/50 hover:bg-muted/30" data-testid={`leaderboard-row-${a.agent}`}>
                        <td className="py-1.5 pr-2 font-medium text-xs capitalize">
                          {i < 3 && <span className="mr-1">{["🥇", "🥈", "🥉"][i]}</span>}
                          {a.agent}
                        </td>
                        <td className="text-center py-1.5 px-1 text-xs">{a.emailsSent}</td>
                        <td className="text-center py-1.5 px-1 text-xs">{a.emailsReceived}</td>
                        <td className="text-center py-1.5 px-1 text-xs">{a.meetingsHeld}</td>
                        <td className="text-center py-1.5 px-1 text-xs">{a.meetingsUpcoming}</td>
                        <td className="text-center py-1.5 px-1 text-xs">{a.uniqueContacts}</td>
                        <td className="text-right py-1.5 pl-1">
                          <Badge variant="outline" className="text-xs">{a.totalActivity}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="text-sm text-muted-foreground text-center py-4">No activity data yet</div>}
          </div>
        )}

        {activeTab === "discover" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {discoverData?.suggestions.length || 0} potential contacts found
              </span>
              <Button
                data-testid="auto-create-contacts"
                size="sm"
                variant="outline"
                onClick={() => autoCreateMutation.mutate()}
                disabled={autoCreateMutation.isPending}
                className="text-xs h-7"
              >
                {autoCreateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Contact className="w-3 h-3 mr-1" />}
                Auto-Create Top Contacts
              </Button>
            </div>

            {discoverLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : discoverData?.suggestions.length ? (
              <div className="max-h-96 overflow-y-auto space-y-1">
                {discoverData.suggestions.slice(0, 30).map(s => (
                  <div key={s.email} className="flex items-start justify-between p-2 border rounded-md hover:bg-muted/30 text-xs" data-testid={`discover-row-${s.email}`}>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{s.name}</div>
                      <div className="text-muted-foreground truncate">{s.email}</div>
                      {s.domain && <Badge variant="outline" className="text-[10px] mt-0.5">{s.domain}</Badge>}
                    </div>
                    <div className="text-right ml-2 flex-shrink-0">
                      <div className="font-medium">{s.frequency}x</div>
                      <div className="text-muted-foreground">{s.bgpUsers.join(", ")}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="text-sm text-muted-foreground text-center py-4">No new contacts discovered</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DataHealthSection() {
  const { toast } = useToast();
  const [scanResult, setScanResult] = useState<DupeScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [renamingTeams, setRenamingTeams] = useState(false);

  const runScan = async () => {
    setScanning(true);
    try {
      const res = await apiRequest("GET", "/api/crm/duplicates/scan");
      const data = await res.json();
      setScanResult(data);
    } catch (err: any) {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const runBackfill = async () => {
    setBackfilling(true);
    try {
      const res = await apiRequest("POST", "/api/admin/backfill-tracker-deals");
      const data = await res.json();
      toast({ title: "Backfill complete", description: data.message || `${data.created || 0} deals created` });
    } catch (err: any) {
      toast({ title: "Backfill failed", description: err.message, variant: "destructive" });
    } finally {
      setBackfilling(false);
    }
  };

  const runRenameTeams = async () => {
    setRenamingTeams(true);
    try {
      const res = await apiRequest("POST", "/api/admin/rename-teams");
      const data = await res.json();
      toast({ title: "Teams renamed", description: data.message });
    } catch (err: any) {
      toast({ title: "Rename failed", description: err.message, variant: "destructive" });
    } finally {
      setRenamingTeams(false);
    }
  };

  const mergeMutation = useMutation({
    mutationFn: async (params: { entity: string; keepId: string; deleteIds: string[] }) => {
      const res = await apiRequest("POST", "/api/crm/duplicates/merge", params);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Duplicates merged" });
      runScan();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
    },
    onError: (err: Error) => {
      toast({ title: "Merge failed", description: err.message, variant: "destructive" });
    },
  });

  const mergeAll = async (entity: string, duplicates: Array<{ ids: string[] }>) => {
    let succeeded = 0;
    let failed = 0;
    for (const group of duplicates) {
      try {
        const [keepId, ...deleteIds] = group.ids;
        await mergeMutation.mutateAsync({ entity, keepId, deleteIds });
        succeeded++;
      } catch {
        failed++;
      }
    }
    if (failed > 0) {
      toast({ title: `Merge partially complete`, description: `${succeeded} merged, ${failed} failed`, variant: "destructive" });
    }
  };

  return (
    <Card data-testid="card-data-health">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            Data Health
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={runBackfill} disabled={backfilling} data-testid="button-backfill-tracker-deals">
              {backfilling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
              {backfilling ? "Backfilling..." : "Backfill Tracker Deals"}
            </Button>
            <Button size="sm" variant="outline" onClick={runRenameTeams} disabled={renamingTeams}>
              {renamingTeams ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
              {renamingTeams ? "Renaming..." : "Rename Legacy Teams"}
            </Button>
            <Button size="sm" variant="outline" onClick={runScan} disabled={scanning} data-testid="button-scan-duplicates">
              {scanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
              {scanning ? "Scanning..." : "Scan for Duplicates"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!scanResult ? (
          <p className="text-sm text-muted-foreground" data-testid="text-scan-prompt">
            Click "Scan for Duplicates" to check your CRM data for duplicate companies, contacts, and properties.
          </p>
        ) : scanResult.summary.clean ? (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400" data-testid="text-scan-clean">
            <CheckCircle2 className="w-4 h-4" />
            All clear — no duplicates found across companies, contacts, or properties.
          </div>
        ) : (
          <div className="space-y-4">
            {scanResult.companies.count > 0 && (
              <div data-testid="section-company-dupes">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Building className="w-4 h-4" />
                    Company Duplicates
                    <Badge variant="destructive" className="text-xs">{scanResult.companies.count}</Badge>
                  </h4>
                  <Button size="sm" variant="outline" onClick={() => mergeAll("company", scanResult.companies.duplicates)} disabled={mergeMutation.isPending} data-testid="button-merge-all-companies">
                    <Trash2 className="w-3 h-3 mr-1" /> Merge All
                  </Button>
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {scanResult.companies.duplicates.slice(0, 20).map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1 px-2 bg-muted/50 rounded">
                      <span>"{d.name}" — {d.count} copies</span>
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => mergeMutation.mutate({ entity: "company", keepId: d.ids[0], deleteIds: d.ids.slice(1) })} data-testid={`button-merge-company-${i}`}>
                        Merge
                      </Button>
                    </div>
                  ))}
                  {scanResult.companies.count > 20 && <p className="text-xs text-muted-foreground">...and {scanResult.companies.count - 20} more</p>}
                </div>
              </div>
            )}

            {scanResult.contacts.emailCount > 0 && (
              <div data-testid="section-contact-email-dupes">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Contact className="w-4 h-4" />
                    Contact Email Duplicates
                    <Badge variant="destructive" className="text-xs">{scanResult.contacts.emailCount}</Badge>
                  </h4>
                  <Button size="sm" variant="outline" onClick={() => mergeAll("contact", scanResult.contacts.emailDuplicates)} disabled={mergeMutation.isPending} data-testid="button-merge-all-contact-emails">
                    <Trash2 className="w-3 h-3 mr-1" /> Merge All
                  </Button>
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {scanResult.contacts.emailDuplicates.slice(0, 20).map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1 px-2 bg-muted/50 rounded">
                      <span>{d.email} — {d.names.join(", ")}</span>
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => mergeMutation.mutate({ entity: "contact", keepId: d.ids[0], deleteIds: d.ids.slice(1) })} data-testid={`button-merge-contact-email-${i}`}>
                        Merge
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {scanResult.properties.count > 0 && (
              <div data-testid="section-property-dupes">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Home className="w-4 h-4" />
                    Property Duplicates
                    <Badge variant="destructive" className="text-xs">{scanResult.properties.count}</Badge>
                  </h4>
                  <Button size="sm" variant="outline" onClick={() => mergeAll("property", scanResult.properties.duplicates)} disabled={mergeMutation.isPending} data-testid="button-merge-all-properties">
                    <Trash2 className="w-3 h-3 mr-1" /> Merge All
                  </Button>
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {scanResult.properties.duplicates.slice(0, 20).map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1 px-2 bg-muted/50 rounded">
                      <span>"{d.name}" — {d.count} copies</span>
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => mergeMutation.mutate({ entity: "property", keepId: d.ids[0], deleteIds: d.ids.slice(1) })} data-testid={`button-merge-property-${i}`}>
                        Merge
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {scanResult.contacts.nameCount > 0 && (
              <div data-testid="section-contact-name-dupes">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Contact className="w-4 h-4" />
                    Contact Name Matches (may be different people)
                    <Badge variant="secondary" className="text-xs">{scanResult.contacts.nameCount}</Badge>
                  </h4>
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {scanResult.contacts.nameDuplicates.slice(0, 20).map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1 px-2 bg-muted/50 rounded">
                      <span>{d.name} — at {d.companies.join(", ")}</span>
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => mergeMutation.mutate({ entity: "contact", keepId: d.ids[0], deleteIds: d.ids.slice(1) })} data-testid={`button-merge-contact-name-${i}`}>
                        Merge
                      </Button>
                    </div>
                  ))}
                  {scanResult.contacts.nameCount > 20 && <p className="text-xs text-muted-foreground">...and {scanResult.contacts.nameCount - 20} more</p>}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ChangeRequest {
  id: string;
  description: string;
  requestedBy: string | null;
  status: string;
  category: string | null;
  priority: string | null;
  developerNotes: string | null;
  adminNotes: string | null;
  createdAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
}

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  reviewed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  implemented: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
};

const LEARNING_CATEGORY_COLORS: Record<string, string> = {
  client_intel: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  market_knowledge: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  bgp_process: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  property_insight: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  team_preference: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  general: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
};

const LEARNING_CATEGORY_LABELS: Record<string, string> = {
  client_intel: "Client Intel",
  market_knowledge: "Market",
  bgp_process: "BGP Process",
  property_insight: "Property",
  team_preference: "Team Pref",
  general: "General",
};

function ChatBGPLearningsSection() {
  const { toast } = useToast();
  const { data: learnings, isLoading } = useQuery<any[]>({
    queryKey: ["/api/chatbgp-learnings"],
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      await apiRequest("PATCH", `/api/chatbgp-learnings/${id}`, { active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chatbgp-learnings"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/chatbgp-learnings/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chatbgp-learnings"] });
      toast({ title: "Deleted", description: "Learning removed." });
    },
  });

  const activeCount = (learnings || []).filter((l: any) => l.active).length;
  const categoryCounts = (learnings || []).reduce((acc: Record<string, number>, l: any) => {
    acc[l.category] = (acc[l.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <Card data-testid="card-chatbgp-learnings">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              ChatBGP Memory
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                {activeCount} active
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Business knowledge ChatBGP has learned from conversations with your team. These facts are loaded into every conversation to give smarter, more relevant answers.
            </p>
          </div>
        </div>
        {Object.keys(categoryCounts).length > 0 && (
          <div className="flex gap-2 flex-wrap mt-2">
            {Object.entries(categoryCounts).map(([cat, count]) => (
              <Badge key={cat} variant="outline" className="text-[10px]">
                {LEARNING_CATEGORY_LABELS[cat] || cat}: {count as number}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : !learnings?.length ? (
          <p className="text-sm text-muted-foreground">No learnings yet. As your team chats with ChatBGP, it will automatically save useful business knowledge here.</p>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {learnings.map((item: any) => (
              <div key={item.id} className={`border rounded-lg p-3 space-y-1 ${!item.active ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={`text-[10px] ${LEARNING_CATEGORY_COLORS[item.category] || "bg-gray-100 text-gray-800"}`}>
                        {LEARNING_CATEGORY_LABELS[item.category] || item.category}
                      </Badge>
                      {!item.active && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">disabled</Badge>
                      )}
                    </div>
                    <p className="text-sm mt-1">{item.learning}</p>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                      <span>From: {item.sourceUserName || "Unknown"}</span>
                      <span>{new Date(item.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => toggleMutation.mutate({ id: item.id, active: !item.active })}
                      data-testid={`toggle-learning-${item.id}`}
                    >
                      {item.active ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[10px] text-red-500 hover:text-red-700"
                      onClick={() => deleteMutation.mutate(item.id)}
                      data-testid={`delete-learning-${item.id}`}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const FEEDBACK_CATEGORY_COLORS: Record<string, string> = {
  bug: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  suggestion: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  complaint: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  praise: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const FEEDBACK_STATUS_COLORS: Record<string, string> = {
  new: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  acknowledged: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  in_progress: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  dismissed: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
};

function AppFeedbackSection() {
  const { toast } = useToast();
  const { data: feedback, isLoading } = useQuery<any[]>({
    queryKey: ["/api/app-feedback"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status, adminNotes }: { id: number; status?: string; adminNotes?: string }) => {
      await apiRequest("PATCH", `/api/app-feedback/${id}`, { status, adminNotes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/app-feedback"] });
      toast({ title: "Updated", description: "Feedback status updated." });
    },
  });

  const newCount = (feedback || []).filter((f: any) => f.status === "new").length;
  const bugCount = (feedback || []).filter((f: any) => f.category === "bug" && f.status !== "resolved" && f.status !== "dismissed").length;

  return (
    <Card data-testid="card-app-feedback">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              AI Feedback Log
              {newCount > 0 && (
                <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                  {newCount} new
                </Badge>
              )}
              {bugCount > 0 && (
                <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                  {bugCount} bugs
                </Badge>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Bugs, suggestions, and feedback captured by ChatBGP from user conversations
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : !feedback?.length ? (
          <p className="text-sm text-muted-foreground">No feedback logged yet. ChatBGP will automatically capture bugs, suggestions, and complaints from conversations.</p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {feedback.map((item: any) => (
              <div key={item.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={`text-[10px] ${FEEDBACK_CATEGORY_COLORS[item.category] || "bg-gray-100 text-gray-800"}`}>
                        {item.category}
                      </Badge>
                      <Badge className={`text-[10px] ${FEEDBACK_STATUS_COLORS[item.status] || "bg-gray-100 text-gray-800"}`}>
                        {item.status.replace("_", " ")}
                      </Badge>
                      {item.pageContext && (
                        <span className="text-[10px] text-muted-foreground">{item.pageContext}</span>
                      )}
                    </div>
                    <p className="text-sm font-medium mt-1">{item.summary}</p>
                    {item.detail && (
                      <p className="text-xs text-muted-foreground mt-1">{item.detail}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                      <span>{item.userName || "Unknown"}</span>
                      <span>{new Date(item.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </div>
                  <Select
                    value={item.status}
                    onValueChange={(val) => updateMutation.mutate({ id: item.id, status: val })}
                  >
                    <SelectTrigger className="h-7 w-[110px] text-[10px] shrink-0" data-testid={`feedback-status-${item.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="acknowledged">Acknowledged</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="dismissed">Dismissed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChangeRequestsSection() {
  const { toast } = useToast();

  const { data: requests, isLoading } = useQuery<ChangeRequest[]>({
    queryKey: ["/api/change-requests"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      await apiRequest("PATCH", `/api/change-requests/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/change-requests"] });
      toast({ title: "Request updated" });
    },
    onError: () => {
      toast({ title: "Failed to update request", variant: "destructive" });
    },
  });

  return (
    <Card data-testid="section-change-requests">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Change Requests
          {requests && requests.length > 0 && (
            <Badge variant="secondary" className="text-xs">{requests.filter(r => r.status === "pending").length} pending</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-20 w-full" />}
        {!isLoading && (!requests || requests.length === 0) && (
          <p className="text-sm text-muted-foreground">No change requests yet. ChatBGP will log structural change requests here.</p>
        )}
        {requests && requests.length > 0 && (
          <div className="space-y-3">
            {requests.map((req) => (
              <div key={req.id} className="border rounded-lg p-3 space-y-2" data-testid={`change-request-${req.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{req.description}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge variant="secondary" className={`text-[10px] ${statusColors[req.status] || ""}`}>
                        {req.status}
                      </Badge>
                      {req.category && <Badge variant="outline" className="text-[10px]">{req.category}</Badge>}
                      {req.priority && req.priority !== "normal" && (
                        <Badge variant="outline" className="text-[10px]">{req.priority}</Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        by {req.requestedBy || "Unknown"} — {req.createdAt ? new Date(req.createdAt).toLocaleDateString() : ""}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {req.status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => updateMutation.mutate({ id: req.id, updates: { status: "approved" } })}
                          data-testid={`button-approve-${req.id}`}
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-red-600"
                          onClick={() => updateMutation.mutate({ id: req.id, updates: { status: "rejected" } })}
                          data-testid={`button-reject-${req.id}`}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {req.status === "approved" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => updateMutation.mutate({ id: req.id, updates: { status: "implemented" } })}
                        data-testid={`button-implemented-${req.id}`}
                      >
                        Mark Done
                      </Button>
                    )}
                  </div>
                </div>
                {req.developerNotes && (
                  <p className="text-xs text-muted-foreground border-t pt-1">Dev: {req.developerNotes}</p>
                )}
                {req.adminNotes && (
                  <p className="text-xs text-muted-foreground">Admin: {req.adminNotes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface EmailLogEntry {
  id: number;
  messageId: string;
  subject: string | null;
  senderEmail: string | null;
  senderName: string | null;
  receivedAt: string | null;
  classification: string;
  actionsTaken: any[];
  aiSummary: string | null;
  replySent: boolean;
  processedAt: string | null;
  error: string | null;
}

const classificationColors: Record<string, string> = {
  instruction: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  cc_correspondence: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  news: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  document: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  auto_reply: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300",
  error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  unknown: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
};

const classificationLabels: Record<string, string> = {
  instruction: "Instruction",
  cc_correspondence: "CC'd Email",
  news: "News",
  document: "Document",
  auto_reply: "Auto-reply",
  error: "Error",
  unknown: "Unknown",
};

function EmailProcessorSection() {
  const { toast } = useToast();

  const { data: logs, isLoading } = useQuery<EmailLogEntry[]>({
    queryKey: ["/api/email-processor/log"],
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery<{
    total: number;
    byClassification: Record<string, number>;
    repliesSent: number;
  }>({
    queryKey: ["/api/email-processor/stats"],
    refetchInterval: 30000,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/email-processor/run");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-processor/log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-processor/stats"] });
      toast({
        title: "Email scan complete",
        description: `Processed ${data.processed} emails${data.errors > 0 ? `, ${data.errors} errors` : ""}`,
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to process emails", variant: "destructive" });
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: async (logId: number) => {
      const res = await apiRequest("POST", `/api/email-processor/reprocess/${logId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-processor/log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-processor/stats"] });
      toast({ title: "Reprocessing complete", description: "Email has been requeued for processing" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to reprocess email", variant: "destructive" });
    },
  });

  return (
    <Card data-testid="card-email-processor">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Inbox className="w-5 h-5" />
            <CardTitle className="text-lg">ChatBGP Email Processor</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              data-testid="button-run-email-processor"
            >
              {runMutation.isPending ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Play className="w-3 h-3 mr-1" />
              )}
              Scan Now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/email-processor/log"] });
                queryClient.invalidateQueries({ queryKey: ["/api/email-processor/stats"] });
              }}
              data-testid="button-refresh-email-log"
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Monitors chatbgp@brucegillinghampollard.com — classifies emails, tracks interactions, processes instructions, and extracts news
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {stats && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs">
              <Mail className="w-3 h-3 text-muted-foreground" />
              <span className="font-medium">{stats.total}</span> processed
            </div>
            {Object.entries(stats.byClassification || {}).map(([cls, count]) => (
              <Badge key={cls} variant="secondary" className={`text-[10px] ${classificationColors[cls] || ""}`}>
                {classificationLabels[cls] || cls}: {count}
              </Badge>
            ))}
            {stats.repliesSent > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-blue-600">
                <CheckCircle2 className="w-3 h-3" />
                {stats.repliesSent} replies sent
              </div>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !logs?.length ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No emails processed yet. Click "Scan Now" to check the inbox.
          </p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {logs.map((entry) => (
              <div
                key={entry.id}
                className="border rounded-lg p-3 space-y-1 hover:bg-muted/30 transition-colors"
                data-testid={`email-log-${entry.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className={`text-[10px] ${classificationColors[entry.classification] || ""}`}>
                        {classificationLabels[entry.classification] || entry.classification}
                      </Badge>
                      {entry.replySent && (
                        <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-600">
                          Reply sent
                        </Badge>
                      )}
                      {entry.error && (
                        <Badge variant="destructive" className="text-[10px]">Error</Badge>
                      )}
                      {(entry.classification === "unknown" || entry.classification === "error") && !entry.replySent && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1.5 text-[10px]"
                          onClick={() => reprocessMutation.mutate(entry.id)}
                          disabled={reprocessMutation.isPending}
                          data-testid={`button-reprocess-${entry.id}`}
                        >
                          <RefreshCw className="w-3 h-3 mr-0.5" />
                          Retry
                        </Button>
                      )}
                    </div>
                    <p className="text-sm font-medium truncate mt-1">{entry.subject || "(no subject)"}</p>
                    <p className="text-xs text-muted-foreground">
                      From: {entry.senderName || entry.senderEmail || "Unknown"}
                      {entry.receivedAt && ` — ${new Date(entry.receivedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
                    </p>
                  </div>
                </div>
                {entry.aiSummary && (
                  <p className="text-xs text-muted-foreground border-t pt-1">{entry.aiSummary}</p>
                )}
                {entry.actionsTaken && Array.isArray(entry.actionsTaken) && entry.actionsTaken.length > 0 && (
                  <div className="text-xs text-muted-foreground border-t pt-1">
                    {(entry.actionsTaken as any[]).map((a: any, i: number) => (
                      <div key={i} className="flex items-center gap-1">
                        {a.success ? (
                          <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />
                        )}
                        <span>{a.result}</span>
                      </div>
                    ))}
                  </div>
                )}
                {entry.error && (
                  <p className="text-xs text-red-500 border-t pt-1">{entry.error}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TeamFoldersSection() {
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const { data: foldersData, isLoading } = useQuery<{
    folders: { name: string; fileCount: number }[];
    userTeam: string;
    isAdmin: boolean;
  }>({ queryKey: ["/api/team-folders"] });

  const { data: files, isLoading: filesLoading } = useQuery<
    { name: string; size: number; modified: string }[]
  >({
    queryKey: ["/api/team-folders", openFolder, "files"],
    queryFn: async () => {
      if (!openFolder) return [];
      const res = await fetch(`/api/team-folders/${encodeURIComponent(openFolder)}/files`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load files");
      return res.json();
    },
    enabled: !!openFolder,
  });

  const userTeam = foldersData?.userTeam || "";
  const isAdmin = foldersData?.isAdmin || false;

  const canWrite = (folderName: string) => {
    if (isAdmin) return true;
    const ut = userTeam.toLowerCase();
    const fl = folderName.toLowerCase();
    return ut === fl || (fl === "office corporate" && ut === "office / corporate");
  };

  const handleUpload = async (folderName: string, file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/team-folders/${encodeURIComponent(folderName)}/upload`, {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      toast({ title: "File uploaded" });
      queryClient.invalidateQueries({ queryKey: ["/api/team-folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team-folders", folderName, "files"] });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (folderName: string, filename: string) => {
    if (!confirm("Delete this file?")) return;
    try {
      await apiRequest("DELETE", `/api/team-folders/${encodeURIComponent(folderName)}/${encodeURIComponent(filename)}`);
      toast({ title: "File deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/team-folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team-folders", folderName, "files"] });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const displayName = (filename: string) => filename.replace(/^\d+-/, "");

  return (
    <Card data-testid="team-folders-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5" />
          Team Property Folders
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="space-y-2">
            {foldersData?.folders.map((folder) => (
              <div key={folder.name} className="border rounded-lg overflow-hidden">
                <button
                  data-testid={`folder-${folder.name.replace(/\s+/g, "-").toLowerCase()}`}
                  className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                  onClick={() => setOpenFolder(openFolder === folder.name ? null : folder.name)}
                >
                  <div className="flex items-center gap-2">
                    {openFolder === folder.name ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <FolderOpen className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">{folder.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {folder.fileCount} file{folder.fileCount !== 1 ? "s" : ""}
                    </Badge>
                    {canWrite(folder.name) && (
                      <Badge variant="outline" className="text-xs text-green-600 border-green-300">
                        Write
                      </Badge>
                    )}
                  </div>
                </button>

                {openFolder === folder.name && (
                  <div className="border-t p-3 space-y-3 bg-muted/20">
                    {canWrite(folder.name) && (
                      <div className="flex items-center gap-2">
                        <label
                          data-testid={`upload-${folder.name.replace(/\s+/g, "-").toLowerCase()}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90 transition-colors"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          {uploading ? "Uploading..." : "Upload File"}
                          <input
                            type="file"
                            className="hidden"
                            disabled={uploading}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleUpload(folder.name, f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <span className="text-xs text-muted-foreground">Max 50MB</span>
                      </div>
                    )}

                    {filesLoading ? (
                      <Skeleton className="h-8 w-full" />
                    ) : !files?.length ? (
                      <p className="text-sm text-muted-foreground italic">No files yet</p>
                    ) : (
                      <div className="space-y-1">
                        {files.map((file) => (
                          <div
                            key={file.name}
                            data-testid={`file-${file.name}`}
                            className="flex items-center justify-between p-2 rounded hover:bg-muted/50 text-sm"
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="truncate">{displayName(file.name)}</span>
                              <span className="text-xs text-muted-foreground shrink-0">{formatSize(file.size)}</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 ml-2">
                              <a
                                href={`/api/team-folders/${encodeURIComponent(folder.name)}/download/${encodeURIComponent(file.name)}`}
                                data-testid={`download-${file.name}`}
                                className="p-1 rounded hover:bg-muted transition-colors"
                                title="Download"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </a>
                              {canWrite(folder.name) && (
                                <button
                                  data-testid={`delete-${file.name}`}
                                  className="p-1 rounded hover:bg-destructive/10 text-destructive transition-colors"
                                  onClick={() => handleDelete(folder.name, file.name)}
                                  title="Delete"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
