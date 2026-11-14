import type { ReactNode } from "react";
import { Mail, MoreHorizontal, Phone } from "lucide-react";
import { MemberAvatar } from "@/components/ClientTeamOrgChart";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { pillMetrics } from "@/components/ui/pill";
import { cn } from "@/lib/utils";
import { lastContactShort } from "@shared/last-contact";

// The BGP team, drawn as the first group of People on every record page
// (Woody, 2026-11-14: "the bGP team block should be wrapped into people rather
// than have a block"). One row per person, the same shape as the people rows:
// photo, name, job title, their roles on this record as pills, their own
// correspondence with it (staff only: the caller passes none to a client),
// email and phone, and a menu. Each page passes its own data and actions.
export type BgpTeamPerson = {
  id: string;
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  photo?: string | null;
  roles: string[];
  // Words under the name, e.g. "Suggested: Leasing agent · Bluewater".
  note?: string | null;
  former?: boolean;
  history?: Array<{ label: string; onOpen?: () => void }>;
  lastAt?: string | null;
};

export function BgpTeamRow({ person, menu }: { person: BgpTeamPerson; menu?: ReactNode }) {
  const last = lastContactShort(person.lastAt);
  const history = person.history?.filter(h => h.label) || [];
  return (
    <div className="flex items-center gap-2 text-sm rounded px-1 py-1 -mx-1 hover:bg-muted/50 transition-colors min-w-0" data-testid={`bgp-team-row-${person.id}`}>
      <MemberAvatar member={{ full_name: person.name, username: person.name, user_id: person.id, profile_pic_url: person.photo || null }} className="w-7 h-7 text-[10px] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <span className="font-semibold truncate">{person.name}</span>
          {person.roles.map(role => (
            <span key={role} className={cn(pillMetrics, "shrink-0 border border-border text-foreground normal-case tracking-normal max-w-full overflow-hidden text-ellipsis")} data-testid="bgp-team-role">{role}</span>
          ))}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {[person.title, person.former ? "Former team member" : null].filter(Boolean).join(" · ")}
          {history.map((h, i) => (
            <span key={h.label}>
              {(i > 0 || person.title || person.former) && " · "}
              {h.onOpen
                ? <button type="button" data-no-min-touch className="underline decoration-dotted underline-offset-2 hover:text-primary" onClick={h.onOpen}>{h.label}</button>
                : h.label}
            </span>
          ))}
          {last && history.length > 0 && <span className="whitespace-nowrap"> · {last}</span>}
          {person.note && <span className="block truncate">{person.note}</span>}
        </div>
      </div>
      <div className="flex items-center shrink-0">
        {person.email && <a href={`mailto:${person.email}`} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted" aria-label={`Email ${person.name}`} title={person.email}><Mail className="w-4 h-4" /></a>}
        {person.phone && <a href={`tel:${person.phone.replace(/[^\d+]/g, "")}`} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted" aria-label={`Call ${person.name}`} title={person.phone}><Phone className="w-4 h-4" /></a>}
        {menu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" data-no-min-touch className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted" aria-label={`More for ${person.name}`} data-testid={`bgp-team-menu-${person.id}`}>
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs w-56">{menu}</DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

export function BgpTeamGroup({ people, menuFor, addControl, emptyText, loading, extra, title = "BGP team", bare }: {
  people: BgpTeamPerson[];
  menuFor?: (person: BgpTeamPerson) => ReactNode | null;
  addControl?: ReactNode;
  emptyText?: string;
  loading?: boolean;
  extra?: ReactNode;
  title?: string;
  // Inside a board that already draws group headings in its own style.
  bare?: boolean;
}) {
  return (
    <div className="space-y-0.5 min-w-0" data-testid="bgp-team-group">
      {!bare && (
        <div className="flex items-center justify-between gap-2 pb-0.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}{people.length ? <span className="font-normal normal-case tracking-normal"> · {people.length}</span> : null}</h4>
          {addControl}
        </div>
      )}
      {bare && addControl && <div className="pb-1">{addControl}</div>}
      {loading ? <p className="text-xs text-muted-foreground">Loading the team…</p>
        : !people.length ? (emptyText ? <p className="text-xs text-muted-foreground">{emptyText}</p> : null)
        : people.map(person => <BgpTeamRow key={person.id} person={person} menu={menuFor?.(person) || undefined} />)}
      {extra}
    </div>
  );
}
