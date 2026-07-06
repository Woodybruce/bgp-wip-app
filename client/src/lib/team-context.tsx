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
});

export function TeamProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [userTeam, setUserTeam] = useState<TeamName | null>(null);
  const [additionalTeams, setAdditionalTeams] = useState<TeamName[]>([]);
  const [activeTeam, setActiveTeamState] = useState<TeamName | "all" | null>(null);

  useEffect(() => {
    if (!userId || !userTeam) return;

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
  }, [userId, userTeam]);

  const setActiveTeam = useCallback((team: TeamName | "all") => {
    setActiveTeamState(team);
    if (userId) {
      localStorage.setItem(`bgp_active_team_${userId}`, team);
    }
  }, [userId]);

  const isAllTeams = activeTeam === "all";

  return (
    <TeamContext.Provider value={{ activeTeam, setActiveTeam, userTeam, setUserTeam, setUserId, isAllTeams, additionalTeams, setAdditionalTeams }}>
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam() {
  return useContext(TeamContext);
}
