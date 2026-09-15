import { useEffect, useState } from "react";
import type { Person } from "./content";

// Headshots dropped into the share drive's "For website" folder are served
// by the dashboard (chatbgp.app/api/public/team-photos). A person's photo
// resolves to the bundled file first, then to the share-drive copy whose
// file name matches their name — so a new "Firstname Surname.jpg" in that
// folder appears on the site without a deploy.
const API_BASE = (import.meta.env.VITE_BGP_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

const norm = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/\b(bw|b&w|mono)\b/g, "").replace(/[^a-z]/g, "");

let cache: Record<string, string> | null = null;
let inflight: Promise<Record<string, string>> | null = null;

async function loadRemote(): Promise<Record<string, string>> {
  if (cache) return cache;
  if (!API_BASE) return (cache = {});
  if (!inflight) {
    inflight = fetch(`${API_BASE}/api/public/team-photos`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ name: string; url: string }>) => {
        const map: Record<string, string> = {};
        for (const row of rows) map[norm(row.name)] = row.url.startsWith("http") ? row.url : `${API_BASE}${row.url}`;
        return (cache = map);
      })
      .catch(() => (cache = {}));
  }
  return inflight;
}

export function useTeamPhoto(person: Person): string | undefined {
  const [remote, setRemote] = useState<Record<string, string> | null>(cache);
  useEffect(() => {
    if (person.photo || remote) return;
    let alive = true;
    loadRemote().then((m) => { if (alive) setRemote(m); });
    return () => { alive = false; };
  }, [person.photo, remote]);
  return person.photo ?? remote?.[norm(person.name)];
}
