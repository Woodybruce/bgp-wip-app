import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { apiRequest, queryClient, isSessionVerified, refreshSession } from "./queryClient";
import { useToast } from "@/hooks/use-toast";

export const TEAMS = [
  "Development",
  "London F&B",
  "London Retail",
  "National Leasing",
  "Investment",
  "Tenant Rep",
  "Lease Advisory",
  "Office / Corporate",
  "Landsec",
] as const;

export type TeamName = (typeof TEAMS)[number];

interface TeamContextType {
  activeTeam: TeamName | "all" | null;
  setActiveTeam: (team: TeamName | "all") => Promise<boolean>;
  exitClientView: () => Promise<boolean>;
  userTeam: TeamName | null;
  setUserTeam: (team: TeamName | null) => void;
  setUserId: (id: string | null) => void;
  isAllTeams: boolean;
  additionalTeams: TeamName[];
  setAdditionalTeams: (teams: TeamName[]) => void;
  setTeamLocked: (locked: boolean) => void;
  setServerActiveTeam: (team: TeamName | "all" | null | undefined) => void;
}

const TeamContext = createContext<TeamContextType>({
  activeTeam: null,
  setActiveTeam: async () => false,
  exitClientView: async () => false,
  userTeam: null,
  setUserTeam: () => {},
  setUserId: () => {},
  isAllTeams: false,
  additionalTeams: [],
  setAdditionalTeams: () => {},
  setTeamLocked: () => {},
  setServerActiveTeam: () => {},
});

// Scope writes must reach the server in click order. Commit the displayed
// team only after a successful response; a failed save leaves it unchanged.
export function createTeamSwitcher({ getUserId, onConfirmed, onError }: {
  getUserId: () => string | null;
  onConfirmed: (team: TeamName | "all") => void;
  onError: (error: unknown) => void;
}) {
  let pending: Promise<unknown> = Promise.resolve();
  const confirmTeam = async (userId: string, fallback?: TeamName | "all") => {
    // Hide the previous scope while verifying, including when a write
    // succeeded but the following auth request fails.
    const user = await refreshSession();
    if (getUserId() !== userId || user?.id !== userId) return false;
    const confirmed = user.activeTeam === null || user.activeTeam === "all" ? "all"
      : TEAMS.includes(user.activeTeam as TeamName) ? user.activeTeam as TeamName : fallback;
    if (confirmed === undefined) return false;
    try { localStorage.setItem(`bgp_active_team_${userId}`, confirmed); } catch {}
    onConfirmed(confirmed);
    void queryClient.invalidateQueries({ predicate: query => query.queryKey[0] !== "/api/auth/me" }).catch(() => {});
    return true;
  };
  return (team: TeamName | "all", exitClientView = false): Promise<boolean> => {
    const userId = getUserId();
    const change = pending.then(async () => {
      if (!userId || getUserId() !== userId) return false;
      try {
        const user = queryClient.getQueryData<{ canViewAsClient?: boolean }>(["/api/auth/me"]);
        if (exitClientView && user?.canViewAsClient) {
          await apiRequest("POST", "/api/auth/client-view-mode", { enabled: false });
        }
        if (getUserId() !== userId) return false;
        await apiRequest("POST", "/api/auth/active-team", { team });
        if (getUserId() !== userId) return false;
        // Validate the new scope before refreshing private data. The auth
        // query clears responses belonging to the previous company scope.
        return await confirmTeam(userId, team);
      } catch (error) {
        if (getUserId() === userId) {
          onError(error);
          // The first half of an exit may have succeeded. Reconcile with
          // the server even when the second write fails.
          await confirmTeam(userId).catch(() => false);
        }
        return false;
      }
    });
    pending = change.catch(() => false);
    return change;
  };
}

export function TeamProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const currentUserId = useRef(userId);
  currentUserId.current = userId;
  const [userTeam, setUserTeam] = useState<TeamName | null>(null);
  const [additionalTeams, setAdditionalTeams] = useState<TeamName[]>([]);
  const [activeTeam, setActiveTeamState] = useState<TeamName | "all" | null>(null);
  // Client logins are pinned to their own team — switching would flip them
  // into BGP-internal team views. (Landsec audit.)
  const [teamLocked, setTeamLocked] = useState(false);
  const [serverActiveTeam, setServerActiveTeam] = useState<TeamName | "all" | null | undefined>();

  useEffect(() => {
    if (!userId || !userTeam) { setActiveTeamState(null); return; }
    if (teamLocked) { setActiveTeamState(userTeam); return; }

    const key = `bgp_active_team_${userId}`;
    if (serverActiveTeam !== undefined) {
      const confirmed = serverActiveTeam ?? "all";
      setActiveTeamState(confirmed);
      try { localStorage.setItem(key, confirmed); } catch {}
      return;
    }
    const migratedKey = `bgp_team_oc_migrated_${userId}`;
    const stored = localStorage.getItem(key);
    const migrated = localStorage.getItem(migratedKey) === "1";

    // One-time migration: Office / Corporate users (PAs, Office Managers,
    // Bookkeepers) had their team filter defaulted to their own team, which
    // wiped the WIP report. Force them to 'all' once, then leave their
    // choice alone going forward.
    if (!migrated && userTeam === "Office / Corporate") {
      localStorage.setItem(migratedKey, "1");
      localStorage.setItem(key, "all");
      setActiveTeamState("all");
      return;
    }

    if (stored === "all") {
      setActiveTeamState("all");
    } else if (stored && TEAMS.includes(stored as TeamName)) {
      setActiveTeamState(stored as TeamName);
    } else {
      setActiveTeamState(userTeam);
      localStorage.setItem(key, userTeam);
      const initial: TeamName | "all" = userTeam === "Office / Corporate" ? "all" : userTeam;
      setActiveTeamState(initial);
      localStorage.setItem(key, initial);
    }
  }, [userId, userTeam, teamLocked, serverActiveTeam]);

  const switchTeam = useMemo(() => createTeamSwitcher({
    getUserId: () => {
      const user = queryClient.getQueryData<{ id: string } | null>(["/api/auth/me"]);
      return isSessionVerified(user) && user?.id === currentUserId.current ? user.id : null;
    },
    onConfirmed: (team) => {
      setServerActiveTeam(team);
      setActiveTeamState(team);
    },
    onError: (error) => toast({
      title: "Could not confirm team change",
      description: error instanceof Error ? error.message : "Please try again.",
      variant: "destructive",
    }),
  }), [toast]);
  const setActiveTeam = useCallback((team: TeamName | "all") =>
    teamLocked ? Promise.resolve(false) : switchTeam(team), [teamLocked, switchTeam]);
  const exitClientView = useCallback(() =>
    teamLocked ? Promise.resolve(false) : switchTeam("all", true), [teamLocked, switchTeam]);

  const isAllTeams = activeTeam === "all";

  return (
    <TeamContext.Provider value={{ activeTeam, setActiveTeam, exitClientView, userTeam, setUserTeam, setUserId, isAllTeams, additionalTeams, setAdditionalTeams, setTeamLocked, setServerActiveTeam }}>
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam() {
  return useContext(TeamContext);
}
