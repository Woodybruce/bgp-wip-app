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
    const stored = localStorage.getItem(key);

    if (stored === "all") {
      setActiveTeamState("all");
    } else if (stored && TEAMS.includes(stored as TeamName)) {
      setActiveTeamState(stored as TeamName);
    } else {
      // Office / Corporate has no deal pipeline of its own — PAs, Office
      // Managers and Bookkeepers need cross-team visibility, not a filter
      // that wipes the WIP report. Default them to "all" instead.
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
