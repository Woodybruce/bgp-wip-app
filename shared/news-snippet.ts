// Google News snippets are usually the headline again plus the outlet
// ("Bluewater arrests after 'chaos'… BBC") — only show a snippet that adds
// something (Woody, 2026-09-27).
export function snippetAddsNothing(title: string | null | undefined, snippet: string | null | undefined): boolean {
  const norm = (v: string) => v.toLowerCase().replace(/\s[-–—|]\s[^-–—|]{2,60}$/, "").replace(/[^a-z0-9]+/g, " ").trim();
  const t = norm(String(title || "")), s = norm(String(snippet || ""));
  if (!s) return true;
  return !!t && (s.startsWith(t.slice(0, Math.min(t.length, 60))) || t.startsWith(s));
}
