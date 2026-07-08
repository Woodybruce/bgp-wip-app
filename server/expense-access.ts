// Read-only, team-scoped expense visibility for designated non-admin staff.
//
// A "team overseer" can VIEW (never edit / approve) every expense belonging
// to a member of the team(s) they oversee — e.g. a team lead keeping an eye
// on their people's card spend. Admins already see everything via the admin
// console, so they don't need an entry here.
//
// Keyed by the user's name or email, lowercased + trimmed (same lightweight
// style as the WIP restricted-agent / senior-email lists). To grant someone
// oversight of a team, add a row: "<name or email>": ["<Team>", ...].
// Team names must match the values used in the team picker
// (client/src/lib/team-context.tsx → TEAMS).
const EXPENSE_TEAM_OVERSEERS: Record<string, string[]> = {
  "victoria broadhead": ["National Leasing"],
};

/** Teams whose expenses `user` may view read-only. Empty = no oversight. */
export function expenseOverseerTeams(
  user: { name?: string | null; email?: string | null } | null | undefined,
): string[] {
  if (!user) return [];
  const keys = [user.name, user.email]
    .filter(Boolean)
    .map((s) => String(s).trim().toLowerCase());
  for (const k of keys) {
    if (EXPENSE_TEAM_OVERSEERS[k]) return [...EXPENSE_TEAM_OVERSEERS[k]];
  }
  return [];
}
