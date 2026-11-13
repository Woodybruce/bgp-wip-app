// The client view of CRM → Agents (Woody, 2026-11-12): BGP first (the joint
// agent, us), then the other joint agents, then the tenant rep agents. One
// search and, for Landsec, one scheme filter run across all three sections.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, PillCount } from "@/components/ui/pill";
import type { ClientAgentsOverview } from "@shared/client-agent-directory";
import {
  buildRepFirms, filterBgp, filterJoint, filterRepFirms, jointPeopleCount, repAgentCount,
  type SectionKey,
} from "./model";
import { Count, useCardLayout } from "./parts";
import { BgpSection, JointAgentsSection } from "./team-sections";
import { TenantRepSection } from "./tenant-rep-section";

export const CLIENT_AGENTS_OVERVIEW_KEY = ["/api/client/agents-overview"] as const;

export function ClientAgentsDirectory() {
  const { rootRef, cards: isMobile } = useCardLayout();
  const [search, setSearch] = useState("");
  const [scheme, setScheme] = useState<string>("all");
  const [section, setSection] = useState<"all" | SectionKey>("all");
  const [repsIgnoreScheme, setRepsIgnoreScheme] = useState(false);
  const { data, isLoading, isError, isFetching, refetch } = useQuery<ClientAgentsOverview>({ queryKey: CLIENT_AGENTS_OVERVIEW_KEY });

  const q = search.trim().toLowerCase();
  const searching = !!q;
  const landsec = data?.viewer === "landsec";
  const activeScheme = landsec && scheme !== "all" ? scheme : null;
  const schemeNames = useMemo(() => new Map((data?.schemes || []).map(s => [s.key, s.name])), [data]);
  const repFirms = useMemo(() => buildRepFirms(data?.tenantReps || []), [data]);
  const ties = data?.brandSchemes || {};

  // The scheme narrows the tenant reps only where a tie can be known: a
  // brand being targeted at one of the scheme's properties. With no such
  // tie recorded anywhere, the section is left whole and says so.
  const tiesKnown = Object.keys(ties).length > 0;
  const repsByScheme = !!activeScheme && tiesKnown && !repsIgnoreScheme;
  const bgp = useMemo(() => filterBgp(data?.bgp || [], schemeNames, q, activeScheme), [data, schemeNames, q, activeScheme]);
  const joint = useMemo(() => filterJoint(data?.jointAgents || [], schemeNames, q, activeScheme), [data, schemeNames, q, activeScheme]);
  const reps = useMemo(
    () => filterRepFirms(repFirms, q, repsByScheme ? id => !!ties[id]?.includes(activeScheme!) : null),
    [repFirms, q, repsByScheme, ties, activeScheme],
  );

  const showBgp = !!landsec || (data?.bgp.length || 0) > 0;
  const showJoint = landsec;
  const sections: { key: SectionKey; label: string; count: number }[] = [
    ...(showBgp ? [{ key: "bgp" as const, label: landsec ? "BGP" : "Your BGP team", count: bgp.length }] : []),
    ...(showJoint ? [{ key: "joint" as const, label: "Joint agents", count: jointPeopleCount(joint) }] : []),
    { key: "reps" as const, label: "Tenant rep agents", count: repAgentCount(reps) },
  ];
  // A search that finds nobody in BGP or the joint agents hides that
  // section instead of printing an empty box above the matches.
  const counts = new Map(sections.map(s => [s.key, s.count]));
  const visible = (key: SectionKey) => (section === "all" || section === key)
    && (key === "reps" || !searching || section === key || (counts.get(key) || 0) > 0);
  const activeSchemeName = activeScheme ? schemeNames.get(activeScheme) || activeScheme : null;
  const total = sections.reduce((n, s) => n + s.count, 0);

  const repsNote = !activeScheme ? undefined : !tiesKnown
    ? `Not narrowed to ${activeSchemeName}: no brand in your Brand Directory is recorded as being targeted at a scheme yet.`
    : repsIgnoreScheme
      ? <>Showing every tenant rep agent. <button type="button" data-no-min-touch className="underline underline-offset-2" onClick={() => setRepsIgnoreScheme(false)} data-testid="client-agent-reps-follow-scheme">Narrow to {activeSchemeName}</button></>
      : <>Narrowed to agents acting for brands being targeted at {activeSchemeName}. <button type="button" data-no-min-touch className="underline underline-offset-2" onClick={() => setRepsIgnoreScheme(true)} data-testid="client-agent-reps-ignore-scheme">Show every tenant rep agent</button></>;

  return (
    <div ref={rootRef} className="space-y-4" data-testid="client-agent-directory">
      {data && sections.length > 1 && (
        <p className="text-sm text-muted-foreground">
          {landsec
            ? "The agents on your instruction and in your market: BGP, the other joint agents, then the tenant rep agents acting for brands in your Brand Directory."
            : "Your BGP team, then the tenant rep agents acting for brands in your Brand Directory."}
        </p>
      )}

      {data && sections.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Agent sections" data-testid="client-agent-section-pills">
          <Pill active={section === "all"} onClick={() => setSection("all")} aria-pressed={section === "all"} data-testid="client-agent-section-pill-all">
            All <PillCount n={total} active={section === "all"} />
          </Pill>
          {sections.map(s => (
            <Pill key={s.key} active={section === s.key} onClick={() => setSection(s.key)} aria-pressed={section === s.key} data-testid={`client-agent-section-pill-${s.key}`}>
              {s.label} <PillCount n={s.count} active={section === s.key} />
            </Pill>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search firms, people or brands…"
          aria-label="Search firms, people or brands"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="min-h-11 w-full md:min-h-9 md:max-w-sm"
          data-testid="client-agent-search"
        />
        {landsec && (data?.schemes.length || 0) > 0 && (
          <select
            value={scheme}
            onChange={e => { setScheme(e.target.value); setRepsIgnoreScheme(false); }}
            aria-label="Scheme"
            className="h-9 max-w-full rounded-full border border-border bg-background px-3 text-xs text-foreground"
            data-testid="client-agent-scheme-filter"
          >
            <option value="all">All schemes</option>
            {["North", "South", "Outlets", "London"].map(group => {
              const inGroup = data!.schemes.filter(s => s.group === group);
              return inGroup.length === 0 ? null : (
                <optgroup key={group} label={group}>
                  {inGroup.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
                </optgroup>
              );
            })}
          </select>
        )}
        {data && (searching || activeScheme) && (
          <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="client-agent-results-count">
            <Count n={total} /> {total === 1 ? "person" : "people"} found
            {(searching || activeScheme) && (
              <button type="button" data-no-min-touch className="ml-2 underline underline-offset-2" onClick={() => { setSearch(""); setScheme("all"); setRepsIgnoreScheme(false); }} data-testid="client-agent-clear-filters">Clear</button>
            )}
          </p>
        )}
      </div>

      {isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4" data-testid="client-agent-error">
          <AlertCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm">{data ? "Agents couldn’t be refreshed. Showing the last loaded list." : "Agents couldn’t be loaded. Please try again."}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="client-agent-retry">{isFetching ? "Retrying…" : "Retry"}</Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3" aria-label="Loading agents" data-testid="client-agent-loading">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-2xl md:rounded-lg" />)}
        </div>
      ) : data && (
        <div className="space-y-8">
          {showBgp && visible("bgp") && (
            <BgpSection people={bgp} landsec={!!landsec} schemeNames={schemeNames} activeScheme={activeScheme} searching={searching} isMobile={isMobile} />
          )}
          {showJoint && visible("joint") && (
            <JointAgentsSection firms={joint} schemeNames={schemeNames} activeScheme={activeScheme} searching={searching} isMobile={isMobile} />
          )}
          {visible("reps") && (
            <TenantRepSection
              firms={reps}
              searching={searching}
              isMobile={isMobile}
              note={repsNote}
              emptyText={searching
                ? total === 0 && section === "all" ? "No agents match your search." : "No tenant rep agents match your search."
                : repsByScheme
                  ? `No tenant rep agent is linked to a brand being targeted at ${activeSchemeName}.`
                  : "No agents are linked to brands in your Brand Directory yet."}
              onClear={searching ? () => setSearch("") : repsByScheme ? () => setRepsIgnoreScheme(true) : undefined}
              clearLabel={searching ? "Clear search" : "Show every tenant rep agent"}
            />
          )}
        </div>
      )}
    </div>
  );
}
