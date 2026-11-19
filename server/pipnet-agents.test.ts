// The agents on PIPnet's flyers (19 November 2026): shared/pipnet-agents.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { agentFirmKey, agentFirmSearchWord, pickAgentFirm, pipnetContactNote, pipnetTenantRepNote, sourceWords } from "../shared/pipnet-agents";

test("one firm however the flyer spells it", () => {
  assert.equal(agentFirmKey("CBRE Ltd"), "cbre");
  assert.equal(agentFirmKey("CBRE"), "cbre");
  assert.equal(agentFirmKey("C.B.R.E."), "cbre");
  assert.equal(agentFirmKey("Cushman & Wakefield LLP"), agentFirmKey("Cushman and Wakefield"));
  assert.equal(agentFirmKey("Savills (UK) Limited"), "savills");
  assert.equal(agentFirmKey("The Retail Partnership"), agentFirmKey("Retail Partnership Ltd"));
  assert.equal(agentFirmKey("Harper Dennis Hobbs Limited"), "harperdennishobbs");
  // A legal ending alone is still a name, and different firms stay different.
  assert.equal(agentFirmKey("Limited"), "limited");
  assert.notEqual(agentFirmKey("Knight Frank"), agentFirmKey("Knight Frank Retail"));
  assert.equal(agentFirmKey(""), "");
  assert.equal(agentFirmKey(null), "");
});

test("the database is narrowed by the longest word of the name", () => {
  assert.equal(agentFirmSearchWord("The Retail Partnership"), "partnership");
  assert.equal(agentFirmSearchWord("CBRE Ltd"), "cbre");
  assert.equal(agentFirmSearchWord("   "), null);
});

const firm = (id: string, name: string, companyType: string | null, createdAt = "2026-01-01") => ({ id, name, companyType, createdAt });

test("an agent firm is preferred, then a company recorded as nothing, never another kind of company", () => {
  assert.deepEqual(pickAgentFirm([firm("b", "CBRE", "Tenant - Retail"), firm("a", "CBRE", "Agent")], "CBRE Ltd")?.firm.id, "a");
  const untyped = pickAgentFirm([firm("u", "Knight Frank", null)], "Knight Frank LLP");
  assert.equal(untyped?.firm.id, "u");
  assert.equal(untyped?.setType, true, "a company recorded as nothing becomes an agent firm, as the import always did");
  assert.equal(pickAgentFirm([firm("l", "Savills", "Landlord"), firm("t", "Savills", "Tenant - Leisure")], "Savills"), null, "a landlord or brand of the same name is not the agent");
  assert.equal(pickAgentFirm([firm("a", "Agent - Investment", "Agent")], "CBRE"), null);
  assert.equal(pickAgentFirm([], ""), null);
});

test("of several matching agent firms, the one spelt as the flyer spells it, then the oldest", () => {
  const candidates = [firm("new", "CBRE", "Agent", "2026-06-01"), firm("old", "CBRE Ltd", "Agent - Leasing", "2025-01-01"), firm("same", "CBRE Limited", "Agent", "2026-09-01")];
  assert.equal(pickAgentFirm(candidates, "CBRE Limited")?.firm.id, "same");
  assert.equal(pickAgentFirm(candidates, "C.B.R.E.")?.firm.id, "old");
});

test("what the import writes on the records it makes", () => {
  assert.equal(sourceWords("pipnet"), "From PIPnet");
  assert.equal(sourceWords("email-sync"), "email-sync");
  assert.equal(sourceWords(null), null);
  assert.equal(pipnetContactNote("Pret A Manger", "2026-11-09"), "Added from PIPnet — the agent on Pret A Manger's requirement, listed 2026-11-09");
  assert.equal(pipnetContactNote(null, null), "Added from PIPnet — the agent on a requirement that names no client");
  assert.equal(pipnetTenantRepNote("Pret A Manger", "2026-11-09", "123456"), "Named as the agent on Pret A Manger's PIPnet requirement, listed 2026-11-09 (PIPnet ref 123456).");
  assert.equal(pipnetTenantRepNote("Itsu", null, null), "Named as the agent on Itsu's PIPnet requirement.");
});
