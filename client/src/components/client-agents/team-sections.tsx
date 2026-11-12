// The first two sections of the client Agents page: BGP (the joint agent,
// us) and the other joint agency firms. A table on desktop, cards on phones.
import { useState } from "react";
import type { ClientBgpPerson, ClientJointAgentFirm, ClientJointAgentPerson, ClientJointFirmSource } from "@shared/client-agent-directory";
import { jointPeopleCount, foldGroups } from "./model";
import {
  TH, TD, Count, SectionHeading, TableShell, EmailLink, PhoneLink, NotRecorded, NameChips, ShowAllButton, PersonAvatar,
} from "./parts";

// Fold to FOLD_ROWS people, but only when that hides more than FOLD_SLACK.
const FOLD_ROWS = 12;
const FOLD_SLACK = 3;

const schemeChips = (keys: string[], schemeNames: Map<string, string>) => keys.map(key => ({ key, name: schemeNames.get(key) || key }));

function BgpPersonName({ person }: { person: ClientBgpPerson }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <PersonAvatar name={person.name} photoUrl={person.photoUrl} />
      <span className="min-w-0">
        <span className="block break-words font-medium">{person.name}</span>
        {person.title && <span className="block break-words text-[11px] text-muted-foreground">{person.title}</span>}
      </span>
    </span>
  );
}

export function BgpSection({ people, landsec, schemeNames, activeScheme, searching, isMobile }: {
  people: ClientBgpPerson[]; landsec: boolean; schemeNames: Map<string, string>;
  activeScheme: string | null; searching: boolean; isMobile: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const open = showAll || searching || people.length <= FOLD_ROWS + FOLD_SLACK;
  const shown = open ? people : people.slice(0, FOLD_ROWS);
  const covers = (p: ClientBgpPerson) => p.covers.map(name => ({ key: name, name }));

  return (
    <section className="space-y-2" data-testid="client-agent-section-bgp" aria-labelledby="client-agent-section-bgp-title">
      <div id="client-agent-section-bgp-title">
        <SectionHeading
          testId="client-agent-section-bgp"
          title={landsec ? "BGP" : "Your BGP team"}
          count={people.length}
          noun={["person", "people"]}
          description={landsec
            ? "Your joint agent. The BGP team on your schemes, with the schemes each person leads or supports."
            : "The BGP people working on your properties."}
        />
      </div>
      {people.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground" data-testid="client-agent-section-bgp-empty">
          {searching || activeScheme ? "No BGP people match." : "No BGP team is recorded yet."}
        </p>
      ) : isMobile ? (
        <div className="rounded-2xl border border-border bg-card" data-testid="client-agent-bgp-cards">
          {shown.map(person => (
            <div key={person.key} className="space-y-2 border-b border-border p-4 last:border-b-0" data-testid={`client-agent-bgp-${person.key}`}>
              <BgpPersonName person={person} />
              <div className="flex flex-col items-start text-sm">
                <EmailLink email={person.email} phone />
                <PhoneLink number={person.phone} phone />
                {!person.email && !person.phone && <NotRecorded>Contact details not recorded</NotRecorded>}
              </div>
              {landsec ? (
                <>
                  {person.lead.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">Leads</p>
                      <NameChips names={schemeChips(person.lead, schemeNames)} active={activeScheme} />
                    </div>
                  )}
                  {person.support.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">Supports</p>
                      <NameChips names={schemeChips(person.support, schemeNames)} active={activeScheme} />
                    </div>
                  )}
                </>
              ) : person.covers.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] text-muted-foreground">{person.isLead ? "Lead · works on" : "Works on"}</p>
                  <NameChips names={covers(person)} />
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <TableShell testId="client-agent-bgp-table">
          <colgroup>
            <col className="w-[20%]" /><col className="w-[18%]" /><col className="w-[18%]" /><col /><col className="w-[176px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Name</th>
              {landsec ? <><th className={TH}>Leads</th><th className={TH}>Supports</th></> : <th className={TH} colSpan={2}>Works on</th>}
              <th className={TH}>Email</th>
              <th className={TH}>Phone</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(person => (
              <tr key={person.key} className="border-b border-border last:border-b-0" data-testid={`client-agent-bgp-${person.key}`}>
                <td className={TD}><BgpPersonName person={person} /></td>
                {landsec ? (
                  <>
                    <td className={TD}><NameChips names={schemeChips(person.lead, schemeNames)} active={activeScheme} /></td>
                    <td className={TD}><NameChips names={schemeChips(person.support, schemeNames)} active={activeScheme} /></td>
                  </>
                ) : (
                  <td className={TD} colSpan={2}>
                    <span className="flex flex-wrap items-center gap-1">
                      {person.isLead && <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Lead</span>}
                      <NameChips names={covers(person)} empty={person.isLead ? "" : "—"} />
                    </span>
                  </td>
                )}
                <td className={TD}>{person.email ? <EmailLink email={person.email} /> : <NotRecorded />}</td>
                <td className={TD}>{person.phone ? <PhoneLink number={person.phone} /> : <NotRecorded />}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      {people.length > FOLD_ROWS + FOLD_SLACK && !searching && (
        <ShowAllButton open={open} total={people.length} noun="people" onToggle={() => setShowAll(!showAll)} testId="client-agent-bgp-show-all" />
      )}
    </section>
  );
}

// How the firm's name is known, in the viewer's words, shown on hover and
// carried as data-firm-sources. "scheme" is the instruction's named joint
// agency for the scheme.
const FIRM_SOURCE_TEXT: Record<ClientJointFirmSource, string> = {
  login: "joint agent login",
  crm: "CRM record",
  scheme: "scheme's named joint agency",
};

function basisText(sources: ClientJointFirmSource[]): string | null {
  if (sources.length === 0) return null;
  const parts = sources.map(s => FIRM_SOURCE_TEXT[s]);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Firm from the ${list}`;
}

const firmBasis = (firm: ClientJointAgentFirm) => (firm.name ? basisText(firm.firmSources) : null);

function JointContact({ person, phone = false }: { person: ClientJointAgentPerson; phone?: boolean }) {
  if (!person.email && !person.phone) return <NotRecorded>Contact details not recorded</NotRecorded>;
  return (
    <span className="flex flex-col items-start">
      <EmailLink email={person.email} phone={phone} />
      <PhoneLink number={person.phone} phone={phone} />
    </span>
  );
}

export function JointAgentsSection({ firms, schemeNames, activeScheme, searching, isMobile }: {
  firms: ClientJointAgentFirm[]; schemeNames: Map<string, string>;
  activeScheme: string | null; searching: boolean; isMobile: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const total = jointPeopleCount(firms);
  const open = showAll || searching || total <= FOLD_ROWS + FOLD_SLACK;
  const shown = open ? firms : foldGroups(firms, f => f.people.length, FOLD_ROWS);

  return (
    <section className="space-y-2" data-testid="client-agent-section-joint" aria-labelledby="client-agent-section-joint-title">
      <div id="client-agent-section-joint-title">
        <SectionHeading
          testId="client-agent-section-joint"
          title="Joint agents"
          count={total}
          noun={["person", "people"]}
          description="The other joint agency firms on the instruction, their named people and the schemes they cover."
        />
      </div>
      {firms.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground" data-testid="client-agent-section-joint-empty">
          {searching || activeScheme
            ? activeScheme && !searching ? "No joint agency is recorded on this scheme." : "No joint agents match."
            : "No joint agents are recorded yet."}
        </p>
      ) : isMobile ? (
        <div className="space-y-3" data-testid="client-agent-joint-cards">
          {shown.map(firm => (
            <div key={firm.key} className="rounded-2xl border border-border bg-card" data-testid={`client-agent-joint-${firm.key}`} data-firm-sources={firm.firmSources.join(",")}>
              <div className="border-b border-border p-4">
                <h3 className="text-sm font-semibold break-words">{firm.name || "Firm not confirmed"}</h3>
                <p className="text-[11px] text-muted-foreground">
                  <Count n={firm.people.length} /> {firm.people.length === 1 ? "person" : "people"}
                </p>
              </div>
              {firm.people.map(person => (
                <div key={person.key} className="space-y-2 border-b border-border p-4 last:border-b-0" data-testid={`client-agent-joint-person-${person.key}`}>
                  <div>
                    <p className="text-sm font-medium break-words">{person.name}</p>
                    {person.role && <p className="text-[11px] text-muted-foreground break-words">{person.role}</p>}
                  </div>
                  <div className="text-sm"><JointContact person={person} phone /></div>
                  <NameChips names={schemeChips(person.schemes, schemeNames)} active={activeScheme} empty="No scheme recorded" />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <TableShell testId="client-agent-joint-table">
          <colgroup>
            <col className="w-[13%]" /><col className="w-[15%]" /><col className="w-[28%]" /><col /><col className="w-[176px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Firm</th><th className={TH}>Agent</th><th className={TH}>Schemes</th><th className={TH}>Email</th><th className={TH}>Phone</th>
            </tr>
          </thead>
          {shown.map(firm => (
            <tbody key={firm.key} className="border-b border-border last:border-b-0" data-testid={`client-agent-joint-${firm.key}`} data-firm-sources={firm.firmSources.join(",")}>
              {firm.people.map((person, i) => (
                <tr key={person.key} className={i > 0 ? "border-t border-border/60" : undefined} data-testid={`client-agent-joint-person-${person.key}`}>
                  {i === 0 && (
                    <td className={`${TD} border-r border-border/60`} rowSpan={firm.people.length} title={firmBasis(firm) || undefined}>
                      <span className={`block break-words font-semibold ${firm.name ? "" : "text-muted-foreground"}`}>{firm.name || "Firm not confirmed"}</span>
                      <span className="block text-[11px] text-muted-foreground"><Count n={firm.people.length} /> {firm.people.length === 1 ? "person" : "people"}</span>
                    </td>
                  )}
                  <td className={TD} title={basisText(person.firmSources) || undefined}>
                    <span className="block break-words font-medium">{person.name}</span>
                    {person.role && <span className="block break-words text-[11px] text-muted-foreground">{person.role}</span>}
                  </td>
                  <td className={TD}><NameChips names={schemeChips(person.schemes, schemeNames)} active={activeScheme} empty="No scheme recorded" /></td>
                  {person.email || person.phone ? (
                    <>
                      <td className={TD}>{person.email ? <EmailLink email={person.email} /> : <NotRecorded />}</td>
                      <td className={TD}>{person.phone ? <PhoneLink number={person.phone} /> : <NotRecorded />}</td>
                    </>
                  ) : (
                    <td className={TD} colSpan={2}><NotRecorded>Contact details not recorded</NotRecorded></td>
                  )}
                </tr>
              ))}
            </tbody>
          ))}
        </TableShell>
      )}
      {total > FOLD_ROWS + FOLD_SLACK && !searching && (
        <ShowAllButton open={open} total={total} noun="people" onToggle={() => setShowAll(!showAll)} testId="client-agent-joint-show-all" />
      )}
    </section>
  );
}
