// The client view of CRM → "<client> Contacts" (Woody, 2026-11-12): only the
// people at the client's own company, laid out like the Agents tab beside
// it. Brand contacts are on brand pages and agents on the Agents tab. Who is
// listed, and in which group, is decided by server/client-own-contacts.ts.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertCircle, Pencil, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, PillCount } from "@/components/ui/pill";
import type { ClientAgentScheme, ClientOwnContacts, ClientOwnPerson } from "@shared/client-agent-directory";
import { filterOwnPeople, ownSchemeNames, OWN_ROLE_LABEL } from "./model";
import {
  TH, TD, Count, SectionHeading, TableShell, EmailLink, PhoneLink, NotRecorded, NameChips, ShowAllButton, useCardLayout,
} from "./parts";

export const CLIENT_OWN_CONTACTS_KEY = ["/api/client/own-contacts"] as const;

type SectionKey = "leasing" | "asset" | "others";

// Fold a section to `fold` people, but only when that hides more than FOLD_SLACK.
const FOLD_SLACK = 3;

interface RowActions {
  onEdit: (person: ClientOwnPerson) => void;
  onAddDetails?: (person: ClientOwnPerson) => void;
}

const rowTestId = (person: ClientOwnPerson) => (person.contactId ? `client-contact-${person.contactId}` : `client-own-sheet-${person.key.replace(/[^a-z0-9]+/gi, "-")}`);
const roleText = (person: ClientOwnPerson) => person.roles.map(r => OWN_ROLE_LABEL[r]).join(" · ");

function PersonName({ person, withTitle }: { person: ClientOwnPerson; withTitle: boolean }) {
  return (
    <span className="block min-w-0">
      {person.contactId ? (
        <Link href={`/contacts/${person.contactId}`} className="block break-words font-medium hover:underline">{person.name}</Link>
      ) : (
        <span className="block break-words font-medium">{person.name}</span>
      )}
      {withTitle && person.title && <span className="block break-words text-[11px] text-muted-foreground">{person.title}</span>}
      {person.company && <span className="block break-words text-[11px] text-muted-foreground">{person.company}</span>}
    </span>
  );
}

function RowAction({ person, onEdit, onAddDetails }: { person: ClientOwnPerson } & RowActions) {
  if (person.contactId && person.editable) {
    return (
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => onEdit(person)}
        title="Edit contact" aria-label={`Edit ${person.name}`} data-testid={`client-edit-own-contact-${person.contactId}`}>
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    );
  }
  if (!person.contactId && onAddDetails) {
    return (
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => onAddDetails(person)}
        title="Add contact details" aria-label={`Add contact details for ${person.name}`} data-testid={`client-own-add-details-${person.key.replace(/[^a-z0-9]+/gi, "-")}`}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    );
  }
  return null;
}

// team = Name (with job title), Team, Schemes, Email, Phone: the people on
// the team sheet. plain = Name, Job title, Email, Phone. Both use the same
// columns (Job title spans Team and Schemes), so Email and Phone sit in the
// same place in every table.
function OwnPeopleSection({
  testId, title, description, noun = ["person", "people"], people, layout, schemes, activeScheme, searching, cards,
  fold, startClosed = false, emptyText, onEdit, onAddDetails,
}: {
  testId: string; title: string; description: string; noun?: [string, string]; people: ClientOwnPerson[];
  layout: "team" | "plain"; schemes: ClientAgentScheme[]; activeScheme: string | null; searching: boolean; cards: boolean;
  fold: number; startClosed?: boolean; emptyText: string;
} & RowActions) {
  const [showAll, setShowAll] = useState(false);
  const folds = startClosed ? people.length > 0 : people.length > fold + FOLD_SLACK;
  const open = showAll || searching || !folds;
  const shown = open ? people : startClosed ? [] : people.slice(0, fold);
  const chips = (person: ClientOwnPerson) => ownSchemeNames(person.schemes, schemes);

  return (
    <section className="space-y-2" data-testid={testId} aria-labelledby={`${testId}-title`}>
      <div id={`${testId}-title`}>
        <SectionHeading testId={testId} title={title} count={people.length} noun={noun} description={description} />
      </div>
      {people.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground" data-testid={`${testId}-empty`}>{emptyText}</p>
      ) : shown.length === 0 ? null : cards ? (
        <div className="rounded-2xl border border-border bg-card" data-testid={`${testId}-cards`}>
          {shown.map(person => (
            <div key={person.key} className="space-y-2 border-b border-border p-4 last:border-b-0" data-testid={rowTestId(person)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-sm"><PersonName person={person} withTitle /></div>
                <RowAction person={person} onEdit={onEdit} onAddDetails={onAddDetails} />
              </div>
              <div className="flex flex-col items-start text-sm">
                <EmailLink email={person.email} phone />
                <PhoneLink number={person.phone} phone />
                {!person.email && !person.phone && <NotRecorded>Contact details not recorded</NotRecorded>}
              </div>
              {layout === "team" && (
                <div className="space-y-1">
                  <p className="text-[11px] text-muted-foreground">{roleText(person)}</p>
                  <NameChips names={chips(person)} active={activeScheme} empty="No scheme recorded" />
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <TableShell testId={`${testId}-table`}>
          <colgroup>
            <col className="w-[17%]" /><col className="w-[136px]" /><col className="w-[18%]" />
            <col /><col className="w-[168px]" /><col className="w-[52px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Name</th>
              {layout === "team" ? <><th className={TH}>Team</th><th className={TH}>Schemes</th></> : <th className={TH} colSpan={2}>Job title</th>}
              <th className={TH}>Email</th>
              <th className={TH}>Phone</th>
              <th className={TH}><span className="sr-only">Edit</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map(person => (
              <tr key={person.key} className="border-b border-border last:border-b-0" data-testid={rowTestId(person)}>
                <td className={TD}><PersonName person={person} withTitle={layout === "team"} /></td>
                {layout === "team" ? (
                  <>
                    <td className={TD}>{person.roles.map(r => <span key={r} className="block whitespace-nowrap text-xs leading-5">{OWN_ROLE_LABEL[r]}</span>)}</td>
                    <td className={TD}><NameChips names={chips(person)} active={activeScheme} empty="No scheme recorded" /></td>
                  </>
                ) : (
                  <td className={TD} colSpan={2}>{person.title ? <span className="block break-words text-xs leading-5 text-muted-foreground">{person.title}</span> : <NotRecorded />}</td>
                )}
                {person.email || person.phone ? (
                  <>
                    <td className={TD}>{person.email ? <EmailLink email={person.email} /> : <NotRecorded />}</td>
                    <td className={TD}>{person.phone ? <PhoneLink number={person.phone} /> : <NotRecorded />}</td>
                  </>
                ) : (
                  <td className={TD} colSpan={2}><NotRecorded>Contact details not recorded</NotRecorded></td>
                )}
                <td className="px-2 py-1 align-top"><RowAction person={person} onEdit={onEdit} onAddDetails={onAddDetails} /></td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      {folds && !searching && (startClosed ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setShowAll(!showAll)} aria-expanded={open} data-testid={`${testId}-show-all`}>
          <span>{open ? `Hide ${noun[1]}` : <>Show <Count n={people.length} /> {people.length === 1 ? noun[0] : noun[1]}</>}</span>
        </Button>
      ) : (
        <ShowAllButton open={open} total={people.length} noun={noun[1]} onToggle={() => setShowAll(!showAll)} testId={`${testId}-show-all`} />
      ))}
    </section>
  );
}

export function ClientOwnContactsTab({ clientName, onAdd, onEdit, onAddDetails }: {
  clientName: string;
  onAdd?: () => void;
} & RowActions) {
  const { rootRef, cards } = useCardLayout();
  const [search, setSearch] = useState("");
  const [scheme, setScheme] = useState("all");
  const [section, setSection] = useState<"all" | SectionKey>("all");
  const { data, isLoading, isError, isFetching, refetch } = useQuery<ClientOwnContacts>({ queryKey: CLIENT_OWN_CONTACTS_KEY });

  const q = search.trim().toLowerCase();
  const searching = !!q;
  const landsec = data?.viewer === "landsec";
  const schemes = data?.schemes || [];
  const activeScheme = landsec && scheme !== "all" ? scheme : null;
  const schemeNames = useMemo(() => new Map((data?.schemes || []).map(s => [s.key, s.name])), [data]);
  const activeSchemeName = activeScheme ? schemeNames.get(activeScheme) || activeScheme : null;

  const leasing = useMemo(() => filterOwnPeople(data?.leasing || [], schemeNames, q, activeScheme), [data, schemeNames, q, activeScheme]);
  const asset = useMemo(() => filterOwnPeople(data?.assetManagement || [], schemeNames, q, activeScheme), [data, schemeNames, q, activeScheme]);
  // Nobody outside the team sheet is tied to a scheme, so a chosen scheme
  // leaves these two lists out and says so.
  const others = useMemo(() => (activeScheme ? [] : filterOwnPeople(data?.others || [], schemeNames, q, null)), [data, schemeNames, q, activeScheme]);
  const mailboxes = useMemo(() => (activeScheme ? [] : filterOwnPeople(data?.mailboxes || [], schemeNames, q, null)), [data, schemeNames, q, activeScheme]);
  // Recorded at the client's company with another organisation's email
  // address: kept, folded shut, and not counted as the client's people.
  const elsewhere = useMemo(() => (activeScheme ? [] : filterOwnPeople(data?.elsewhere || [], schemeNames, q, null)), [data, schemeNames, q, activeScheme]);

  const filtering = searching || !!activeScheme;
  const total = leasing.length + asset.length + others.length;
  const recorded = (data?.peopleCount || 0) + (data?.mailboxes.length || 0) + (data?.elsewhere?.length || 0);
  const unscoped = (data?.others.length || 0) + (data?.mailboxes.length || 0) + (data?.elsewhere?.length || 0);
  const pills: { key: SectionKey; label: string; count: number }[] = [
    { key: "leasing", label: "Leasing", count: leasing.length },
    { key: "asset", label: "Asset management", count: asset.length },
    { key: "others", label: `Others at ${clientName}`, count: others.length },
  ];
  // While filtering, a section with no match is left out rather than
  // printed as an empty box above the matches.
  const visible = (key: SectionKey, count: number) => (section === "all" || section === key) && (!filtering || section === key || count > 0);
  const noMatch = searching ? "Nobody here matches your search." : `Nobody here is recorded on ${activeSchemeName}.`;
  const showMailboxes = (section === "all" || section === "others") && mailboxes.length > 0;
  const showElsewhere = (section === "all" || section === "others") && elsewhere.length > 0;
  const clear = () => { setSearch(""); setScheme("all"); };
  const rowActions = { onEdit, onAddDetails };
  const sheetNote = data?.sheetDate ? ` From BGP's team sheet of ${data.sheetDate}.` : "";

  return (
    <div ref={rootRef} className="space-y-4" data-testid="client-own-contacts">
      <p className="text-sm text-muted-foreground">
        The people at {clientName}. A brand's contacts are on that brand's page in the Brand Directory, and agents are on the Agents tab.
      </p>

      {landsec && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Contact sections" data-testid="client-own-section-pills">
          <Pill active={section === "all"} onClick={() => setSection("all")} aria-pressed={section === "all"} data-testid="client-own-section-pill-all">
            All <PillCount n={total} active={section === "all"} />
          </Pill>
          {pills.map(s => (
            <Pill key={s.key} active={section === s.key} onClick={() => setSection(s.key)} aria-pressed={section === s.key} data-testid={`client-own-section-pill-${s.key}`}>
              {s.label} <PillCount n={s.count} active={section === s.key} />
            </Pill>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={landsec ? "Search name, job title, scheme or email…" : "Search name, job title or email…"}
          aria-label={landsec ? "Search name, job title, scheme or email" : "Search name, job title or email"}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="min-h-11 w-full md:min-h-9 md:max-w-sm"
          data-testid="client-own-search"
        />
        {landsec && schemes.length > 0 && (
          <select
            value={scheme}
            onChange={e => setScheme(e.target.value)}
            aria-label="Scheme"
            className="h-9 max-w-full rounded-full border border-border bg-background px-3 text-xs text-foreground"
            data-testid="client-own-scheme-filter"
          >
            <option value="all">All schemes</option>
            {[...new Set(schemes.map(s => s.group))].map(group => (
              <optgroup key={group} label={group}>
                {schemes.filter(s => s.group === group).map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
              </optgroup>
            ))}
          </select>
        )}
        {data && filtering && (
          <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="client-own-results-count">
            <Count n={total} /> {total === 1 ? "person" : "people"} found
            {elsewhere.length > 0 && <> · <Count n={elsewhere.length} /> with another organisation's email address</>}
            {mailboxes.length > 0 && <> · <Count n={mailboxes.length} /> shared mailbox {mailboxes.length === 1 ? "record" : "records"}</>}
            <button type="button" data-no-min-touch className="ml-2 underline underline-offset-2" onClick={clear} data-testid="client-own-clear-filters">Clear</button>
          </p>
        )}
        {onAdd && (
          <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={onAdd} data-testid="client-add-own-contact">
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Add contact
          </Button>
        )}
      </div>

      {isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4" data-testid="client-own-error">
          <AlertCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm">{data ? "Contacts couldn’t be refreshed. Showing the last loaded list." : "Contacts couldn’t be loaded. Please try again."}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="client-own-retry">{isFetching ? "Retrying…" : "Retry"}</Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3" aria-label="Loading contacts" data-testid="client-own-loading">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-2xl md:rounded-lg" />)}
        </div>
      ) : data && recorded === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-4 py-8 text-center" data-testid="client-own-empty">
          <p className="text-sm text-muted-foreground">Nobody is recorded at {clientName} yet.</p>
          {onAdd && <Button type="button" variant="outline" size="sm" onClick={onAdd}><Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Add contact</Button>}
        </div>
      ) : data && (
        <div className="space-y-8">
          {landsec && visible("leasing", leasing.length) && (
            <OwnPeopleSection
              testId="client-own-section-leasing" title="Leasing" people={leasing} layout="team" fold={12}
              description={`${clientName}'s leasing leads and the schemes each covers.${sheetNote}`}
              emptyText={filtering ? noMatch : "No leasing lead is recorded."} schemes={schemes} activeScheme={activeScheme} searching={searching} cards={cards} {...rowActions}
            />
          )}
          {landsec && visible("asset", asset.length) && (
            <OwnPeopleSection
              testId="client-own-section-asset" title="Asset management" people={asset} layout="team" fold={12}
              description={`${clientName}'s asset managers and the schemes each covers.${sheetNote}`}
              emptyText={filtering ? noMatch : "No asset manager is recorded."} schemes={schemes} activeScheme={activeScheme} searching={searching} cards={cards} {...rowActions}
            />
          )}
          {!activeScheme && visible("others", others.length) && (
            <OwnPeopleSection
              testId="client-own-section-others" title={landsec ? `Others at ${clientName}` : `People at ${clientName}`} people={others} layout="plain" fold={25}
              description={landsec ? `Everyone else recorded at ${clientName}, in alphabetical order.` : `Everyone recorded at ${clientName}, in alphabetical order.`}
              emptyText={filtering ? noMatch : landsec ? `Nobody else is recorded at ${clientName} yet.` : `Nobody is recorded at ${clientName} yet.`}
              schemes={schemes} activeScheme={null} searching={searching} cards={cards} {...rowActions}
            />
          )}
          {showElsewhere && (
            <OwnPeopleSection
              testId="client-own-section-elsewhere" title={`Recorded at ${clientName} with another organisation's email address`} people={elsewhere} layout="plain" fold={0} startClosed
              description={`People recorded at ${clientName} whose email address is at another organisation. They are not counted in the people at ${clientName}.`}
              emptyText="" schemes={schemes} activeScheme={null} searching={searching} cards={cards} {...rowActions}
            />
          )}
          {showMailboxes && (
            <OwnPeopleSection
              testId="client-own-section-mailboxes" title="Shared mailboxes and system addresses" people={mailboxes} layout="plain" fold={0} startClosed
              noun={["record", "records"]}
              description={`Records at ${clientName} that are a shared mailbox or a system address, not a person.`}
              emptyText="" schemes={schemes} activeScheme={null} searching={searching} cards={cards} {...rowActions}
            />
          )}
          {activeScheme && unscoped > 0 && (section === "all" || section === "others") && (
            <p className="text-[11px] text-muted-foreground" data-testid="client-own-scheme-note">
              Showing the leasing leads and asset managers on {activeSchemeName}. The <Count n={unscoped} /> other {unscoped === 1 ? "record" : "records"} at {clientName} {unscoped === 1 ? "is" : "are"} not tied to a scheme.{" "}
              <button type="button" data-no-min-touch className="underline underline-offset-2" onClick={() => setScheme("all")} data-testid="client-own-show-all-schemes">Show everyone</button>
            </p>
          )}
          {filtering && total === 0 && !showMailboxes && !showElsewhere && section === "all" && (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-4 py-8 text-center" data-testid="client-own-no-match">
              <p className="text-sm text-muted-foreground">
                {searching ? `Nobody at ${clientName} matches your search.` : `Nobody at ${clientName} is recorded on ${activeSchemeName}.`}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={clear}>{searching ? "Clear search" : "Show everyone"}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
