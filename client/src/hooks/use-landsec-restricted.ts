import { useQuery } from "@tanstack/react-query";
import { RESTRICTED_LANDSEC_ROLES } from "@shared/landsec";

// True for a Landsec joint agent login, the one restricted role (an asset
// manager is a full Landsec login: Woody, 2026-11-13). The server refuses a
// joint agent most of the CRM's lists (restrictedLandsecApiRule in
// shared/landsec.ts), so a screen it can open uses this to not ask for
// what will be refused. It only ever switches a request off: what such a
// login may read is decided on the server.
export function useLandsecRestricted(): boolean {
  const { data } = useQuery<{ landsecRole?: string | null } | null>({ queryKey: ["/api/auth/me"] });
  return (RESTRICTED_LANDSEC_ROLES as string[]).includes(String(data?.landsecRole || ""));
}
