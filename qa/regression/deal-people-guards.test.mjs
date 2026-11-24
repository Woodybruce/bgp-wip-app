// Everyone on a transaction, and the party box with its choices folded away
// once made (Woody, 24 November 2026, on #4664). Source guards: who may read
// and change the People card, what a client is never sent, the card on the
// Parties & AML pill, and the party box showing who to ask once. Unit tests:
// server/deal-people.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const server = read("server/deal-people.ts");

test("BGP staff only, signed in as themselves, before anything is read or written", () => {
  for (const route of [
    'router.get("/api/deals/:id/people"', 'router.get("/api/deals/:id/people/search"', 'router.post("/api/deals/:id/people"',
    'router.delete("/api/deals/:id/people/:contactId"', 'router.post("/api/deals/:id/people/:contactId/details"',
  ]) {
    const at = server.indexOf(route);
    assert.ok(at > 0, route);
    assert.match(server.slice(at, at + 260), /await staffMe\(req\)\)?\)?;?[\s\S]{0,80}return res\.status\(403\)/, `${route} checks staff first`);
  }
  assert.match(server, /if \(!\(await contactViewer\(req\)\)\.staff\) return null;/);
  assert.match(read("server/index.ts"), /app\.use\(amlCommentaryRouter\);\n  app\.use\(dealPeopleRouter\);/);
});

test("details are filled where blank, never overwritten; only a contact added on the card is taken off there", () => {
  const details = server.slice(server.indexOf('router.post("/api/deals/:id/people/:contactId/details"'));
  assert.match(details, /if \(email && !emailOf\(held\.email\)\) fill\.email = email;/);
  assert.match(details, /if \(phone && !personPhones\(held\)\.length\)/);
  assert.match(details, /Those are already held\. Change them on the contact's page\./);
  const remove = server.slice(server.indexOf('router.delete("/api/deals/:id/people/:contactId"'));
  assert.match(remove, /DELETE FROM crm_contact_deals l USING crm_contacts c WHERE l\.deal_id = \$1 AND l\.contact_id = \$2/);
  assert.doesNotMatch(remove.slice(0, 800), /UPDATE crm_deals/, "taking someone off never changes the transaction's own fields");
  // BGP's own people are on the BGP team, never added as contacts.
  assert.match(server, /BGP's own people are on the BGP team, set in Fees & invoicing\./);
});

test("the card's history lines and the link table columns: kept from client logins, added at boot", () => {
  assert.match(read("server/crm.ts"), /"deal_people",\n  \]\);/);
  const index = read("server/index.ts");
  for (const col of ["deal_group text", "deal_label text", "added_by varchar", "added_by_name text", "added_at timestamptz"]) {
    assert.ok(index.includes(`ALTER TABLE crm_contact_deals ADD COLUMN IF NOT EXISTS ${col}`), col);
  }
});

test("the People card leads Parties & AML for BGP staff, with the team changed in Fees & invoicing", () => {
  const detail = read("client/src/components/deal-detail.tsx");
  assert.match(detail, /<DealPeopleCard dealId=\{dealId\} bgpTeam=\{dealBgpTeam\} onChangeTeam=\{onChangeTeam\} \/>/);
  assert.match(detail, /onChangeTeam=\{\(\) => goTo\("fees"\)\}/);
  assert.match(detail, /\{!jointAgent && !staffView && <LinkedContactsCard deal=\{deal\} \/>\}/);
  const card = read("client/src/components/deal-people.tsx");
  assert.match(card, /Change the team \(Fees &amp; invoicing\)/);
  assert.match(card, /<BgpTeamGroup\s+people=\{bgpTeam\}\s+details/);
  assert.doesNotMatch(card, /<form/, "no form in a dialog on the transaction page");
});

test("the party box: choices fold behind Change once made, who to ask shown once, owners passed on by the person acting", () => {
  const box = read("client/src/components/deal-parties.tsx");
  assert.match(box, /\{party\.company && !changingCompany && !hotsOpen \? \(/);
  assert.match(box, /data-testid="deal-party-company-change">Change</);
  assert.match(box, /\{party\.person && !changingPerson && !adding \? \(/);
  assert.match(box, /askListed \? <span className="font-normal text-muted-foreground"> · details above<\/span>/);
  assert.match(box, /data-testid="deal-party-guarantor-options"/);
  assert.match(box, /can pass \{name\} their link from their own page/);
  assert.match(box, /data-testid="deal-party-editor-to-reach"/);
  // The person acting's page reads the owners live, and so do their reminders.
  const portal = read("server/aml-portal.ts");
  assert.match(portal, /async function ownersToLink\(row: TokenRow\)/);
  assert.match(portal, /ownLinksFor: progress\.ownersToLink \?\? \(request\.ownLinksFor \|\| \[\]\)\.map\(o => o\.name\),\n    person:/);
  assert.match(read("shared/aml-box.ts"), /return step\("wait", "client", `Waiting on \$\{to\}`, `to pass \$\{who\}/);
});
