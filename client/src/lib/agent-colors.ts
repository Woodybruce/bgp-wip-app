export const BGP_TEAM_COLORS: Record<string, string> = {
  "Rupert": "bg-blue-600",
  "Lucy": "bg-violet-500",
  "Sohail": "bg-emerald-600",
  "Woody": "bg-amber-600",
  "Tom Cater": "bg-rose-500",
};

export const FALLBACK_COLORS = [
  "bg-cyan-600", "bg-indigo-500", "bg-teal-600", "bg-orange-500",
  "bg-pink-500", "bg-sky-600", "bg-fuchsia-500", "bg-lime-600",
];

export function buildUserColorMap(users: { id: string; name: string }[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!users) return map;
  let fallbackIdx = 0;
  for (const u of users) {
    const firstName = u.name.split(" ")[0];
    if (BGP_TEAM_COLORS[firstName]) {
      map[u.name] = BGP_TEAM_COLORS[firstName];
    } else if (BGP_TEAM_COLORS[u.name]) {
      map[u.name] = BGP_TEAM_COLORS[u.name];
    } else {
      map[u.name] = FALLBACK_COLORS[fallbackIdx % FALLBACK_COLORS.length];
      fallbackIdx++;
    }
  }
  return map;
}

export function buildUserIdColorMap(users: { id: string; name: string }[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!users) return map;
  let fallbackIdx = 0;
  for (const u of users) {
    const firstName = u.name.split(" ")[0];
    if (BGP_TEAM_COLORS[firstName]) {
      map[String(u.id)] = BGP_TEAM_COLORS[firstName];
    } else if (BGP_TEAM_COLORS[u.name]) {
      map[String(u.id)] = BGP_TEAM_COLORS[u.name];
    } else {
      map[String(u.id)] = FALLBACK_COLORS[fallbackIdx % FALLBACK_COLORS.length];
      fallbackIdx++;
    }
  }
  return map;
}

/**
 * Resolve a deal's agent payload into a unified list. Prefers the IDs
 * column (internalAgentIds, populated by storage.normaliseInternalAgents
 * on every write since the name→id migration) so a user rename doesn't
 * grey out the chip. Falls back to the legacy names column for historic
 * rows whose IDs haven't been backfilled.
 *
 * Returns one entry per resolved user. Unresolvable entries (a name that
 * no longer exists in users) are dropped to avoid orphan chips.
 */
export function resolveDealAgents(
  deal: { internalAgent?: string[] | null; internalAgentIds?: string[] | null },
  users: { id: string; name: string }[] | undefined,
): { userId: string; name: string; color: string }[] {
  if (!users || users.length === 0) return [];
  const userById = new Map(users.map(u => [u.id, u]));
  const userByName = new Map(users.map(u => [u.name, u]));
  const idMap = buildUserIdColorMap(users);
  const nameMap = buildUserColorMap(users);

  const resolved = new Map<string, { userId: string; name: string; color: string }>();

  const ids = Array.isArray(deal.internalAgentIds) ? deal.internalAgentIds : [];
  for (const id of ids) {
    const u = userById.get(id);
    if (u) resolved.set(u.id, { userId: u.id, name: u.name, color: idMap[u.id] || "bg-zinc-500" });
  }

  // Fall back to names for historic deals whose IDs column is still NULL
  // (or for any name entry whose ID isn't in the IDs array yet).
  if (resolved.size === 0) {
    const names = Array.isArray(deal.internalAgent) ? deal.internalAgent : [];
    for (const n of names) {
      const u = userByName.get(n);
      if (u) resolved.set(u.id, { userId: u.id, name: u.name, color: nameMap[u.name] || "bg-zinc-500" });
    }
  }

  return Array.from(resolved.values());
}
