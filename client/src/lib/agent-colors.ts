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
