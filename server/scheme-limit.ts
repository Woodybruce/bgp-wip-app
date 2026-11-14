import { AsyncLocalStorage } from "async_hooks";

// The property ids a Landsec login is held to for the request in hand (set
// by the /api middleware in server/index.ts; none = no scheme limit). Read by
// the scope checks in company-scope.ts, so every caller of them is cut to the login's
// schemes without needing the request.
const schemeLimitStore = new AsyncLocalStorage<Set<string>>();
export function runWithSchemeLimit<T>(propertyIds: Set<string>, fn: () => T): T {
  return schemeLimitStore.run(propertyIds, fn);
}
export function currentSchemeLimit(): Set<string> | null {
  return schemeLimitStore.getStore() || null;
}
// True when the property is within the request's scheme limit (or there is none).
export function inSchemeLimit(propertyId: string | null | undefined): boolean {
  const limit = currentSchemeLimit();
  return !limit || (!!propertyId && limit.has(propertyId));
}

// The same limit as SQL text for a query that lists the client's properties
// itself: " AND <column> = ANY('{...}'::text[])", or "" with no limit. An empty
// limit matches nothing. Ids are the app's own property ids, quoted.
export function schemeLimitSql(column: string): string {
  const limit = currentSchemeLimit();
  if (!limit) return "";
  const list = [...limit].map(id => `"${String(id).replace(/["\\{}]/g, "")}"`).join(",");
  return ` AND ${column} = ANY('{${list.replace(/'/g, "''")}}'::text[])`;
}
