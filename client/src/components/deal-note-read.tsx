// The deal, as the "Describe the deal" box read it (Woody, 20 November 2026:
// the box "doesn't search the adress", "didn't pick up the tenant",
// "couldn't add landlord or tenant once worked out they are not in the CRM",
// "didnt change the deal typ to new letting", "didnt help with the billing
// entiryies either"). Shown under the box on the deal form. What was sure is
// already in the form (client/src/lib/deal-note.ts, dealReadPatch); this
// shows it with the words it came from, and offers the rest: a property or
// party to pick, a property to find or add, a party to add to the CRM, a
// billing entity to bill. Each button is the person's own action; nothing is
// sent anywhere until they press one, and the deal itself is saved only by
// the form's Create.
import { Check, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DEAL_NOTE_ROLE_WORDS, type DealNoteCandidate, type DealNoteParty, type DealNoteRead, type DealNoteRegisterHit, type DealNoteRole } from "@shared/deal-note";
import { PARTY_FORM_KEYS, rolesShownFor } from "@/lib/deal-note";

export interface DealNoteReadProps {
  read: DealNoteRead;
  form: Record<string, any>;
  /** The action under way ("add:tenant", "bill:landlord"), so its button shows it. */
  busy: string | null;
  /** Billing entities are BGP's Xero: shown only when the form shows them. */
  billing: boolean;
  onUseType: (value: string) => void;
  onPickProperty: (id: string) => void;
  onFindProperty: (text: string) => void;
  onPickParty: (role: DealNoteRole, c: DealNoteCandidate) => void;
  onAddParty: (role: DealNoteRole, name: string, hit: DealNoteRegisterHit | null) => void;
  onBill: (role: DealNoteRole, companyId: string, number: string) => void;
}

const From = ({ quote }: { quote: string }) => <span className="text-[11px] text-muted-foreground"> · from “{quote}”</span>;
const Done = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 text-sm"><Check className="h-3.5 w-3.5 shrink-0 text-foreground" />{children}</span>
);
const Act = ({ children, onClick, busy, testId, disabled }: { children: ReactNode; onClick: () => void; busy?: boolean; testId: string; disabled?: boolean }) => (
  <Button type="button" variant="outline" size="sm" className="h-7 rounded-full px-2.5 text-[11px]" onClick={onClick} disabled={busy || disabled} data-testid={testId}>
    {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}{children}
  </Button>
);

function Row({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-start gap-x-2 gap-y-1" data-testid={testId}>
      <span className="pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="min-w-0 space-y-1 break-words">{children}</div>
    </div>
  );
}

const signs = (c: DealNoteCandidate) => (c.entityName ? ` · signs as ${c.entityName}${c.entityNumber ? ` (${c.entityNumber})` : ""}` : "");

function PartyRow({ party, props }: { party: DealNoteParty; props: DealNoteReadProps }) {
  const { form, busy, billing } = props;
  const k = PARTY_FORM_KEYS[party.role];
  const role = DEAL_NOTE_ROLE_WORDS[party.role];
  const chosen = String(form[k.id] || "");
  const shown = rolesShownFor(form.dealType).includes(party.role);
  const picked = party.candidates.find(c => c.companyId === chosen) || null;
  const billed = String(form[k.entityName] || "");
  const testId = `deal-note-party-${party.role}`;

  const billingLine = () => {
    if (!billing || !picked) return null;
    if (billed) return <Done>Billed to {billed}</Done>;
    const options: Array<{ name: string; number: string }> = [];
    if (picked.entityNumber) options.push({ name: picked.entityName || picked.companyName, number: picked.entityNumber });
    for (const hit of party.register) if (!options.some(o => o.number === hit.number)) options.push({ name: hit.name, number: hit.number });
    if (!options.length) {
      return (
        <p className="text-[11px] text-muted-foreground">
          {picked.entityName ? `Signs as ${picked.entityName}, which has no Companies House number: pick its billing entity below.` : party.registerNote || "Pick the billing entity below."}
        </p>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Billing entity:</span>
        {options.map(o => (
          <Act key={o.number} busy={busy === `bill:${party.role}`} disabled={!!busy} onClick={() => props.onBill(party.role, picked.companyId, o.number)} testId={`${testId}-bill-${o.number}`}>
            Bill {o.name} ({o.number})
          </Act>
        ))}
      </div>
    );
  };

  let body: ReactNode;
  if (!shown) {
    body = <p className="text-[11px] text-muted-foreground">A {form.dealType || "deal of this type"} has no {role.toLowerCase()}: change the deal type to use it.</p>;
  } else if (picked) {
    body = <><Done>{picked.companyName}{signs(picked)}</Done>{billingLine()}</>;
  } else if (party.candidates.length) {
    body = (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">{party.candidates.length > 1 ? "In the CRM more than once: pick one" : chosen ? "The note names" : "In the CRM:"}</span>
        {party.candidates.map(c => (
          <Act key={`${c.companyId}:${c.entityId || ""}`} disabled={!!busy} onClick={() => props.onPickParty(party.role, c)} testId={`${testId}-pick-${c.companyId}`}>
            Use {c.companyName}{signs(c)}
          </Act>
        ))}
      </div>
    );
  } else {
    body = (
      <>
        <p className="text-[11px] text-muted-foreground">Not in the CRM.</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {billing && party.register.map(hit => (
            <Act key={hit.number} busy={busy === `add:${party.role}`} disabled={!!busy} onClick={() => props.onAddParty(party.role, party.name, hit)} testId={`${testId}-add-${hit.number}`}>
              Add {party.name} as {role.toLowerCase()}, billed to {hit.name} ({hit.number})
            </Act>
          ))}
          <Act busy={busy === `add:${party.role}`} disabled={!!busy} onClick={() => props.onAddParty(party.role, party.name, null)} testId={`${testId}-add`}>
            Add {party.name} as {role.toLowerCase()}{billing && party.register.length ? " only" : ""}
          </Act>
        </div>
        {billing && !party.register.length && party.registerNote && <p className="text-[11px] text-muted-foreground">{party.registerNote}</p>}
      </>
    );
  }
  return (
    <Row label={role} testId={testId}>
      <p className="text-sm"><span className="font-medium">{party.name}</span><From quote={party.quote} /></p>
      {body}
    </Row>
  );
}

export function DealNoteReadPanel(props: DealNoteReadProps) {
  const { read, form, busy } = props;
  const place = read.place;
  const type = read.dealType;
  const placePicked = place?.properties.find(p => p.id === form.propertyId) || null;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3" data-testid="deal-note-read">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">The deal, from the note</p>

      <Row label="Deal type" testId="deal-note-type">
        {type ? (
          form.dealType === type.value
            ? <p><Done>{type.value}</Done><From quote={type.quote} /></p>
            : <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm">{type.value}<From quote={type.quote} /></span>
                <Act disabled={!!busy} onClick={() => props.onUseType(type.value)} testId="deal-note-type-use">Use</Act>
              </div>
        ) : <p className="text-[11px] text-muted-foreground">The note does not say what kind of deal: pick it below.</p>}
      </Row>

      {place && (
        <Row label="Property" testId="deal-note-place">
          <p className="text-sm"><span className="font-medium">{place.text}</span><From quote={place.quote} /></p>
          {placePicked ? (
            <Done>{placePicked.name}{placePicked.address && placePicked.address !== placePicked.name ? ` · ${placePicked.address}` : ""}</Done>
          ) : place.properties.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">{place.approximate || place.properties.length > 1 ? "Is it one of these?" : "In the CRM:"}</span>
              {place.properties.map(p => (
                <Act key={p.id} disabled={!!busy} onClick={() => props.onPickProperty(p.id)} testId={`deal-note-place-pick-${p.id}`}>
                  {p.name}{p.address && p.address !== p.name ? ` · ${p.address}` : ""}
                </Act>
              ))}
              <Act disabled={!!busy} onClick={() => props.onFindProperty(place.text)} testId="deal-note-place-find">None of these: find or add it</Act>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">No property in the CRM matches.</span>
              <Act disabled={!!busy} onClick={() => props.onFindProperty(place.text)} testId="deal-note-place-find">Find or add it</Act>
            </div>
          )}
          {place.unit && <p className="text-[11px] text-muted-foreground">Unit: {place.unit.value}{form.unitId ? "" : ": pick it below"}</p>}
        </Row>
      )}

      {read.parties.map(p => <PartyRow key={p.role} party={p} props={props} />)}

      {read.dropped.length > 0 && (
        <p className="break-words text-[11px]" data-testid="deal-note-dropped">
          <span className="text-muted-foreground">Left out: </span>
          {read.dropped.map((d, i) => <span key={i}>{i ? "; " : ""}{d.what} “{d.value}” ({d.reason})</span>)}
        </p>
      )}
    </div>
  );
}
