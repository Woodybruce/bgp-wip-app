import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";

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
  setActiveTeam: (team: TeamName | "all") => void;
  userTeam: TeamName | null;
  setUserTeam: (team: TeamName | null) => void;
  setUserId: (id: string) => void;
  isAllTeams: boolean;
  additionalTeams: TeamName[];
  setAdditionalTeams: (teams: TeamName[]) => void;
  setTeamLocked: (locked: boolean) => void;
}

const TeamContext = createContext<TeamContextType>({
  activeTeam: null,
  setActiveTeam: () => {},
  userTeam: null,
  setUserTeam: () => {},
  setUserId: () => {},
  isAllTeams: false,
  additionalTeams: [],
  setAdditionalTeams: () => {},
  setTeamLocked: () => {},
});

export function TeamProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [userTeam, setUserTeam] = useState<TeamName | null>(null);
  const [additionalTeams, setAdditionalTeams] = useState<TeamName[]>([]);
  const [activeTeam, setActiveTeamState] = useState<TeamName | "all" | null>(null);
  // Client logins are pinned to their own team — switching would flip them
  // into BGP-internal team views. (Landsec audit.)
  const [teamLocked, setTeamLocked] = useState(false);

  useEffect(() => {
    if (!userId || !userTeam) return;
    if (teamLocked) { setActiveTeamState(userTeam); return; }

    const key = `bgp_active_team_${userId}`;
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
  }, [userId, userTeam, teamLocked]);

  const setActiveTeam = useCallback((team: TeamName | "all") => {
    if (teamLocked) return;
    setActiveTeamState(team);
    if (userId) {
      localStorage.setItem(`bgp_active_team_${userId}`, team);
    }
    // Persist to the server too. Selecting a CLIENT team (e.g. "Landsec")
    // scopes the whole session to that client's view, so every query has to
    // be refetched — otherwise the switch only re-brands the UI and looks
    // like nothing happened.
    (async () => {
      try {
        // Same storage key as getAuthHeaders — this read used the wrong key
        // ("authToken"), so the team save posted unauthenticated, failed
        // silently, and staff were stuck in client-view mode: the exit
        // button appeared to do nothing.
        const token = localStorage.getItem("bgp_auth_token");
        await fetch("/api/auth/active-team", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ team }),
        });
        const { queryClient } = await import("@/lib/queryClient");
        await queryClient.invalidateQueries();
      } catch { /* offline / logged out — localStorage still holds the choice */ }
    })();
  }, [userId, teamLocked]);

  const isAllTeams = activeTeam === "all";

  return (
    <TeamContext.Provider value={{ activeTeam, setActiveTeam, userTeam, setUserTeam, setUserId, isAllTeams, additionalTeams, setAdditionalTeams, setTeamLocked }}>
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam() {
  return useContext(TeamContext);
}
