// Setting up a new property (Woody, 23 November 2026: "when we set up a new
// property should ask before its set up some basic questions I think? correct
// address? then documents where do we want the files options are existing
// folder with a pop out to the BGP share drive and ability to go in and pick a
// folder. or create new folder tree. Add joint agent and tenancy schedule or
// areas schedule for marketing and add brochure and add plans").
//
// The steps, in order, each one skippable. The dialog is
// client/src/components/property-page/property-setup.tsx; the folder tree is
// made by server/property-setup.ts.

export const SETUP_STEPS = [
  { key: "address", label: "Address" },
  { key: "owner", label: "Owner" },
  { key: "files", label: "Files" },
  { key: "agent", label: "Joint agent" },
  { key: "schedule", label: "Schedule" },
  { key: "brochure", label: "Brochure" },
  { key: "plans", label: "Plans" },
] as const;
export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"];

/** A name SharePoint takes for a folder: no " * : < > ? / \ |, no trailing dot or space. */
export function safeFolderName(name: unknown): string {
  return String(name ?? "").replace(/["*:<>?/\\|]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 120);
}

/**
 * A folder template's paths ("Financial Analysis/Cashflow Models"), checked:
 * at most 80, at most four deep, each part a name SharePoint takes.
 */
export function folderTreePaths(input: unknown): { paths: string[][] } | { problem: string } {
  if (!Array.isArray(input)) return { problem: "Which folders?" };
  if (input.length > 80) return { problem: "Too many folders: at most 80." };
  const out: string[][] = [];
  for (const raw of input) {
    const parts = String(raw ?? "").split("/").map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (!parts.length) continue;
    if (parts.length > 4) return { problem: `"${String(raw)}" is more than four folders deep.` };
    if (parts.some(p => safeFolderName(p) !== p)) return { problem: `"${String(raw)}" has characters SharePoint does not allow.` };
    out.push(parts);
  }
  return { paths: out };
}

/** Every folder a tree makes, parents first: "A", "A/B", "A/B/C". */
export function folderTreeOrder(paths: string[][]): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const parts of paths) {
    for (let i = 1; i <= parts.length; i++) {
      const key = parts.slice(0, i).join("/");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(parts.slice(0, i));
    }
  }
  return out;
}

/** A SharePoint folder on BGP's own tenant (what the picker and the tree link a property to). */
export function bgpSharePointUrl(url: unknown): boolean {
  try {
    const u = new URL(String(url ?? ""));
    return u.protocol === "https:" && /^brucegillinghampollardlimited(-my)?\.sharepoint\.com$/i.test(u.hostname);
  } catch { return false; }
}
