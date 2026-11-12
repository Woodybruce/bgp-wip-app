// The one intake's rules, run against an in-memory store (no database).
//   node --import tsx --test server/requirement-intake.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { requirementLive } from "@shared/requirement-live";
import {
  suggest, confirm, attach, dismiss, markSatisfied, setSuggestionBrand, stillLive, setOwner, howSure, matchBrand, brandKey,
  listSuggestions, requirementEvidence, IntakeError, DIRECT_REASON, PROPOSAL_MARK_SATISFIED, PROPOSAL_STILL_LIVE, markNotLive, checkPeople,
  type IntakeStore, type EvidenceRow, type RequirementRow, type Actor, type EvidenceInput,
} from "./requirement-intake";
import { dismissFromNews, addRequirementFromNews } from "./requirement-news";

const NOW = new Date("2026-11-12T10:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86400000);
const EMILY: Actor = { id: "u-emily", name: "Emily Stone" };
const TOM: Actor = { id: "u-tom", name: "Tom Reed" };

interface Company { id: string; name: string; type?: string; hidden?: boolean; mergedInto?: string; otherNames?: string[] }
interface Contact { id: string; email?: string; companyId?: string; actsFor?: string[] }

function fakeStore(seed: { companies?: Company[]; contacts?: Contact[]; requirements?: RequirementRow[]; viewings?: any[]; offers?: any[] } = {}) {
  const companies = seed.companies || [];
  const contacts = seed.contacts || [];
  const staff: Actor[] = [EMILY, TOM];
  const evidence: EvidenceRow[] = [];
  const requirements: RequirementRow[] = (seed.requirements || []).map(r => ({ ...r }));
  const viewings = seed.viewings || [];
  const offers = seed.offers || [];
  let n = 0;
  const isBrand = (c: Company) => /^tenant/i.test(c.type || "") || (c.type || "").toLowerCase() === "brand";
  const ref = (c: Company) => ({ id: c.id, name: c.name, hidden: !!c.hidden, brandType: isBrand(c), companyType: c.type ?? null });
  const survivor = (id: string) => { const c = companies.find(x => x.id === id); return c?.mergedInto ? companies.find(x => x.id === c.mergedInto) : c; };
  const blank: EvidenceRow = {
    id: "", requirement_id: null, company_id: null, brand_name: null, candidate_company_ids: null, kind: "note", source_label: null, source_ref: null,
    evidence_date: null, headline: null, excerpt: null, url: null, said_by: null, details: null, confidence: null, status: "open",
    created_by_kind: "machine", created_by_user_id: null, created_by_name: null, resolved_by_user_id: null, resolved_by_name: null, resolved_at: null,
    resolved_reason: null, dedupe_key: null, suggestion_id: null, created_at: null, updated_at: null,
  };
  const store: IntakeStore = {
    async lock() {},
    async brandsForContacts(contactIds, emails) {
      const people = contacts.filter(c => contactIds.includes(c.id) || (!!c.email && emails.includes(c.email.toLowerCase())));
      const direct = people.map(p => p.companyId && survivor(p.companyId)).filter((c): c is Company => !!c && isBrand(c));
      if (direct.length) return direct.map(ref);
      return people.flatMap(p => p.actsFor || []).map(survivor).filter((c): c is Company => !!c).map(ref);
    },
    async brandsByIds(ids) { return ids.map(survivor).filter((c): c is Company => !!c).map(ref); },
    async brandsNamedLike(name) {
      const word = brandKey(name).split(" ").sort((a, b) => b.length - a.length)[0] || "";
      return companies.filter(c => !c.mergedInto && [c.name, ...(c.otherNames || [])].some(x => x.toLowerCase().includes(word)))
        .map(c => ({ ...ref(c), otherNames: [c.name, ...(c.otherNames || [])] }));
    },
    async staffByIds(ids) { return staff.filter(u => ids.includes(u.id)); },
    async evidenceById(id) { return evidence.find(e => e.id === id) || null; },
    async evidenceByDedupeKey(key) { return evidence.find(e => e.dedupe_key === key) || null; },
    async openHeads(kind, companyId) { return evidence.filter(e => e.status === "open" && !e.suggestion_id && e.kind === kind && (companyId ? e.company_id === companyId : !e.company_id)); },
    async personDismissalsSince(kind, companyId, since) {
      return evidence.filter(e => e.status === "dismissed" && !!e.resolved_by_user_id && e.kind === kind
        && (companyId ? e.company_id === companyId : !e.company_id) && !!e.resolved_at && e.resolved_at >= since);
    },
    async suggestionLines(headId) { return evidence.filter(e => e.id === headId || e.suggestion_id === headId); },
    async insertEvidence(values) {
      if (values.dedupe_key && evidence.some(e => e.dedupe_key === values.dedupe_key)) return null;
      const row: EvidenceRow = { ...blank, ...values, id: `e${++n}`, created_at: new Date(NOW.getTime() + n), updated_at: NOW } as EvidenceRow;
      evidence.push(row);
      return row;
    },
    async updateEvidence(ids, patch) { for (const e of evidence) if (ids.includes(e.id)) Object.assign(e, patch); },
    async requirementById(id) { return requirements.find(r => r.id === id) || null; },
    async requirementsForCompanies(companyIds) { return requirements.filter(r => !!r.company_id && companyIds.includes(r.company_id)); },
    async insertRequirement(values) {
      const row = { id: `r${++n}`, created_at: NOW, updated_at: NOW, ...values } as RequirementRow;
      requirements.push(row);
      return row;
    },
    async updateRequirement(id, patch) { const r = requirements.find(x => x.id === id)!; Object.assign(r, patch); return r; },
    async evidenceForRequirement(requirementId) { return evidence.filter(e => e.requirement_id === requirementId && ["confirmed", "attached"].includes(e.status)); },
    async viewingsForRequirement(requirementId) {
      const brand = requirements.find(r => r.id === requirementId)?.company_id;
      return viewings.filter(v => v.requirement_id === requirementId || (!v.requirement_id && !!brand && v.company_id === brand));
    },
    async offersForRequirement(requirementId) {
      const brand = requirements.find(r => r.id === requirementId)?.company_id;
      return offers.filter(o => !!brand && o.company_id === brand && !!o.confirmed_at);
    },
    async linkViewings(viewingIds, requirementId, companyId) {
      for (const v of viewings) if (viewingIds.includes(v.id) && !v.requirement_id && v.company_id === companyId) v.requirement_id = requirementId;
    },
    async listHeads(f) {
      return evidence.filter(e => !e.suggestion_id && e.status === (f.status || "open") && e.resolved_reason !== DIRECT_REASON && e.resolved_reason !== "quiet"
        && (!f.kind || e.kind === f.kind) && (!f.companyId || e.company_id === f.companyId) && (!f.unmatched || !e.company_id));
    },
    async joinedLines(headIds) { return evidence.filter(e => !!e.suggestion_id && headIds.includes(e.suggestion_id)); },
    async openCounts() {
      const heads = evidence.filter(e => e.status === "open" && !e.suggestion_id);
      return [...new Set(heads.map(h => h.kind))].map(kind => ({ kind, count: heads.filter(h => h.kind === kind).length, unmatched: heads.filter(h => h.kind === kind && !h.company_id).length }));
    },
    async draftRequirements() { return requirements.filter(r => String(r.status || "").toLowerCase() === "draft"); },
  };
  return { store, evidence, requirements, viewings };
}

const PRET: Company = { id: "c-pret", name: "Pret A Manger", type: "Tenant - Café", otherNames: ["Pret", "Pret A Manger (Europe) Limited"] };
const GAILS: Company = { id: "c-gails", name: "Gail's Bakery", type: "Tenant - Bakery" };
const press = (name: string, extra: Partial<EvidenceInput> = {}): EvidenceInput =>
  ({ kind: "press", brand: { name }, sourceLabel: "Propel", headline: `${name} to open 20 UK sites`, evidenceDate: NOW, detectedBy: "News reader", ...extra });
const refused = (code: string) => (e: any) => e instanceof IntakeError && e.code === code;

test("a detection becomes a suggestion and never a requirement", async () => {
  const { store, evidence, requirements } = fakeStore({ companies: [PRET] });
  const out = await suggest(store, press("Pret A Manger", { excerpt: "x".repeat(900) }), { now: NOW });
  assert.equal(out.outcome, "opened");
  assert.equal(out.evidence.status, "open");
  assert.equal(out.evidence.company_id, "c-pret");
  assert.equal(out.evidence.created_by_kind, "machine");
  assert.equal(out.evidence.created_by_name, "News reader");
  assert.equal(out.evidence.requirement_id, null);
  assert.ok(out.evidence.excerpt!.length <= 300, "a quote is cut short, never a whole message");
  assert.equal(requirements.length, 0);
  assert.equal(evidence.length, 1);
});

test("one open suggestion per brand and source kind: later evidence joins it", async () => {
  const { store, evidence } = fakeStore({ companies: [PRET, GAILS] });
  const first = await suggest(store, press("Pret A Manger", { dedupeKey: "propel:1" }), { now: NOW });
  const second = await suggest(store, press("Pret", { dedupeKey: "propel:2" }), { now: NOW });
  assert.equal(second.outcome, "joined");
  assert.equal(second.suggestionId, first.evidence.id);
  assert.equal(second.evidence.suggestion_id, first.evidence.id);
  // A different kind of source for the same brand is its own suggestion.
  const chat = await suggest(store, { kind: "team_chat", brand: { companyIds: ["c-pret"] }, sourceLabel: "Team chat", headline: "Pret want Leeds" }, { now: NOW });
  assert.equal(chat.outcome, "opened");
  // And so is another brand.
  assert.equal((await suggest(store, press("Gail's Bakery"), { now: NOW })).outcome, "opened");
  assert.equal(evidence.filter(e => e.status === "open" && !e.suggestion_id).length, 3);
});

test("the same source record is never suggested twice", async () => {
  const { store, evidence } = fakeStore({ companies: [PRET] });
  await suggest(store, press("Pret", { dedupeKey: "propel:2026-11-12:pret" }), { now: NOW });
  const again = await suggest(store, press("Pret", { dedupeKey: "propel:2026-11-12:pret" }), { now: NOW });
  assert.equal(again.outcome, "duplicate");
  assert.equal(evidence.length, 1);
});

test("brand matching: a contact's company, then a tag, then the name and its other names", async () => {
  const { store } = fakeStore({
    companies: [PRET, GAILS, { id: "c-agent", name: "Shelley Sandzer", type: "Agent" }, { id: "c-old", name: "Pret Old", type: "Tenant - Café", mergedInto: "c-pret" }],
    contacts: [{ id: "ct-1", email: "anna@pret.com", companyId: "c-pret" }, { id: "ct-2", email: "agent@firm.com", companyId: "c-agent", actsFor: ["c-pret", "c-gails"] }],
  });
  // The contact wins even when the text names another brand.
  const byContact = await matchBrand(store, { emails: ["Anna@Pret.com"], companyIds: ["c-gails"], name: "Gail's Bakery" });
  assert.deepEqual([byContact.companyId, byContact.by], ["c-pret", "contact"]);
  const byTag = await matchBrand(store, { companyIds: ["c-gails"], name: "Pret" });
  assert.deepEqual([byTag.companyId, byTag.by], ["c-gails", "tag"]);
  assert.deepEqual([(await matchBrand(store, { name: "pret a manger ltd" })).companyId, (await matchBrand(store, { name: "pret a manger ltd" })).by], ["c-pret", "name"]);
  const byAlias = await matchBrand(store, { name: "Pret" });
  assert.deepEqual([byAlias.companyId, byAlias.by, byAlias.brandName], ["c-pret", "alias", "Pret"]);
  // A tag on a merged brand follows it to the surviving record.
  assert.equal((await matchBrand(store, { companyIds: ["c-old"] })).companyId, "c-pret");
  // An agent acting for two brands: the name in the text picks between them…
  assert.equal((await matchBrand(store, { contactIds: ["ct-2"], name: "Gail's Bakery" })).companyId, "c-gails");
  // …and without one, both are carried for the reviewer.
  const tie = await matchBrand(store, { contactIds: ["ct-2"] });
  assert.equal(tie.companyId, null);
  assert.deepEqual(tie.candidates.map(c => c.id).sort(), ["c-gails", "c-pret"]);
});

test("a brand is never invented: an unmatched name stays a suggestion carrying the name", async () => {
  const { store, evidence, requirements } = fakeStore({ companies: [PRET] });
  const out = await suggest(store, press("Blank Street Coffee"), { now: NOW });
  assert.equal(out.evidence.company_id, null);
  assert.equal(out.evidence.brand_name, "Blank Street Coffee");
  // The same unmatched name, written differently, joins the same suggestion.
  const again = await suggest(store, press("BLANK STREET COFFEE LTD"), { now: NOW });
  assert.equal(again.outcome, "joined");
  // Confirming is refused until a person picks the brand.
  await assert.rejects(confirm(store, { suggestionId: out.evidence.id }, EMILY, NOW), refused("BRAND_NEEDED"));
  assert.equal(requirements.length, 0);
  // No brand and no name at all is refused outright.
  await assert.rejects(suggest(store, { kind: "press", brand: {} }, { now: NOW }), refused("NO_BRAND"));
  // The reviewer picks: both lines move to the brand and a requirement is made.
  const done = await confirm(store, { suggestionId: out.evidence.id, companyId: "c-pret" }, EMILY, NOW);
  assert.equal(done.outcome, "created");
  assert.equal(done.requirement!.company_id, "c-pret");
  assert.ok(evidence.every(e => e.company_id === "c-pret" && e.status === "confirmed" && e.requirement_id === done.requirement!.id));
});

test("a two-way tie carries both candidates and waits for the reviewer", async () => {
  const twins: Company[] = [{ id: "c-a", name: "Wingstop", type: "Tenant - Quick Service" }, { id: "c-b", name: "Wingstop", type: "Tenant - Restaurant" }];
  const { store } = fakeStore({ companies: twins });
  const out = await suggest(store, press("Wingstop"), { now: NOW });
  assert.equal(out.evidence.company_id, null);
  assert.deepEqual(out.evidence.candidate_company_ids!.sort(), ["c-a", "c-b"]);
  const listed = await listSuggestions(store, {}, NOW);
  assert.equal(listed.suggestions[0].proposed, "pick_brand");
  assert.deepEqual(listed.suggestions[0].brand.candidates.map(c => c.id).sort(), ["c-a", "c-b"]);
  await assert.rejects(confirm(store, { suggestionId: out.evidence.id }, EMILY, NOW), refused("BRAND_NEEDED"));
  // A hidden twin loses the tie to the one in the directory.
  const { store: tidy } = fakeStore({ companies: [twins[0], { ...twins[1], hidden: true }] });
  assert.equal((await matchBrand(tidy, { name: "Wingstop" })).companyId, "c-a");
});

test("confirm makes BGP's own requirement, confirmed by the named person, and links the evidence", async () => {
  const { store, evidence, requirements } = fakeStore({ companies: [GAILS] });
  const s = await suggest(store, { kind: "team_chat", brand: { companyIds: ["c-gails"] }, sourceLabel: "Team chat", headline: "Gail's want 1,500 sq ft in Leeds", details: { size: ["1,500 sq ft"], locations: ["Leeds"] } }, { now: NOW });
  const out = await confirm(store, { suggestionId: s.evidence.id }, EMILY, NOW);
  assert.equal(out.outcome, "created");
  const r = requirements[0];
  assert.equal(r.origin, "bgp");
  assert.equal(r.status, "Active");
  assert.equal(r.last_confirmed_by, "u-emily");
  assert.equal(r.last_confirmed_by_name, "Emily Stone");
  assert.equal(r.confirmed_how, "chat");
  assert.deepEqual(r.size, ["1,500 sq ft"]);
  assert.deepEqual(r.requirement_locations, ["Leeds"]);
  assert.deepEqual(r.bgp_contact_user_ids, ["u-emily"]);
  assert.equal(requirementLive(r, NOW).state, "live");
  const line = evidence[0];
  assert.deepEqual([line.status, line.requirement_id, line.resolved_by_user_id, line.resolved_by_name], ["confirmed", r.id, "u-emily", "Emily Stone"]);
  assert.equal(line.resolved_at, NOW);
  // Answered once: a second answer is refused.
  await assert.rejects(dismiss(store, { suggestionId: s.evidence.id, reason: "not_a_requirement" }, TOM, NOW), refused("ALREADY_ANSWERED"));
});

test("a confirmed press story is press-reported until someone records speaking to the brand", async () => {
  const { store, requirements } = fakeStore({ companies: [PRET] });
  const s = await suggest(store, press("Pret A Manger"), { now: NOW });
  await confirm(store, { suggestionId: s.evidence.id }, EMILY, NOW);
  const r = requirements[0];
  assert.equal(r.confirmed_how, "press");
  assert.match(r.comments, /Press-reported \(Propel, 2026-11-12\).*Nobody at BGP has recorded speaking to the brand/);
  assert.equal(requirementLive(r, NOW).pressReported, true);
  assert.equal(howSure(r, [{ kind: "press", status: "confirmed" }], NOW).key, "press");
  // Still live on its own keeps it press-reported…
  await stillLive(store, r.id, TOM, null, days(10));
  assert.equal(r.confirmed_how, "press");
  assert.equal(r.last_confirmed_by, "u-tom");
  // …a recorded call lifts it…
  await stillLive(store, r.id, TOM, "call", days(11));
  assert.equal(r.confirmed_how, "call");
  assert.equal(howSure(r, [{ kind: "press", status: "confirmed" }], days(11)).key, "conversation");
  // …and a later press story confirmed onto it never downgrades it.
  const later = await suggest(store, press("Pret A Manger", { headline: "Pret plans 50 more" }), { now: days(20) });
  await confirm(store, { suggestionId: later.evidence.id, requirementId: r.id }, EMILY, days(20));
  assert.equal(r.confirmed_how, "call");
  assert.equal(new Date(r.last_confirmed_at).getTime(), days(20).getTime());
});

test("a brand with a requirement already: the reviewer says which one, or says it is a new search", async () => {
  const existing: RequirementRow = { id: "r-old", name: "Pret A Manger", company_id: "c-pret", status: "Active", origin: "pipnet", sources: ["PIPnet"], requirement_date: "2026-03-01" };
  const closed: RequirementRow = { id: "r-past", name: "Pret A Manger", company_id: "c-pret", status: "Past" };
  const other: RequirementRow = { id: "r-gails", name: "Gail's", company_id: "c-gails", status: "Active" };
  const { store, requirements } = fakeStore({ companies: [PRET, GAILS], requirements: [existing, closed, other] });
  const s = await suggest(store, { kind: "meeting", brand: { name: "Pret" }, sourceLabel: "Meeting note", headline: "Pret want Manchester" }, { now: NOW });
  await assert.rejects(confirm(store, { suggestionId: s.evidence.id }, EMILY, NOW),
    (e: any) => refused("EXISTING_REQUIREMENT")(e) && e.extra.existing.length === 1 && e.extra.existing[0].id === "r-old");
  await assert.rejects(confirm(store, { suggestionId: s.evidence.id, requirementId: "r-past" }, EMILY, NOW), refused("REQUIREMENT_CLOSED"));
  await assert.rejects(confirm(store, { suggestionId: s.evidence.id, requirementId: "r-gails" }, EMILY, NOW), refused("OTHER_BRAND"));
  const out = await confirm(store, { suggestionId: s.evidence.id, requirementId: "r-old" }, EMILY, NOW);
  assert.equal(out.outcome, "confirmed_existing");
  const r = requirements.find(x => x.id === "r-old")!;
  // A market listing a person has confirmed is live; it is still PIPnet's listing by origin.
  assert.deepEqual([r.origin, r.confirmed_how, r.last_confirmed_by_name, r.requirement_date], ["pipnet", "meeting", "Emily Stone", "2026-03-01"]);
  assert.equal(requirementLive(r, NOW).state, "live");
  assert.equal(requirements.length, 3);
  // A second search for the same brand is allowed when the reviewer says so.
  const s2 = await suggest(store, { kind: "call", brand: { name: "Pret" }, headline: "Second search: drive-thru" }, { now: NOW, by: TOM });
  assert.equal(s2.evidence.created_by_kind, "person");
  assert.equal((await confirm(store, { suggestionId: s2.evidence.id, createNew: true, fields: { name: "Pret drive-thru", bgpContactUserIds: ["u-tom"] } }, EMILY, NOW)).outcome, "created");
  assert.equal(requirements.length, 4);
  assert.deepEqual([requirements[3].name, requirements[3].bgp_contact_user_id, requirements[3].confirmed_how], ["Pret drive-thru", "u-tom", "call"]);
});

test("confirming a Draft makes it Active; attach adds evidence without confirming", async () => {
  const draft: RequirementRow = { id: "r-draft", name: "Gail's viewing requirement", company_id: "c-gails", status: "Draft", origin: "bgp", sources: ["Viewing"] };
  const { store, evidence, requirements } = fakeStore({ companies: [GAILS, PRET], requirements: [draft] });
  const s = await suggest(store, press("Gail's Bakery"), { now: NOW });
  const out = await attach(store, { suggestionId: s.evidence.id, requirementId: "r-draft" }, EMILY, NOW);
  assert.equal(out.outcome, "attached");
  assert.deepEqual([evidence[0].status, evidence[0].requirement_id, evidence[0].resolved_by_name], ["attached", "r-draft", "Emily Stone"]);
  assert.equal(requirements[0].status, "Draft");
  assert.equal(requirements[0].last_confirmed_at, undefined);
  assert.equal(requirementLive(requirements[0], NOW).state, "to_confirm");
  // A suggestion for another brand cannot be added to it by mistake.
  const wrong = await suggest(store, press("Pret A Manger"), { now: NOW });
  await assert.rejects(attach(store, { suggestionId: wrong.evidence.id, requirementId: "r-draft" }, EMILY, NOW), refused("OTHER_BRAND"));
  await stillLive(store, "r-draft", EMILY, "viewing", NOW);
  assert.deepEqual([requirements[0].status, requirements[0].confirmed_how], ["Active", "viewing"]);
  assert.equal(requirementLive(requirements[0], NOW).state, "live");
});

test("Dismiss on the Expanding list keeps the story as a person's dismissal and quietens the brand's news", async () => {
  const { store, evidence, requirements } = fakeStore({ companies: [PRET, GAILS] });
  const story = { companyId: "c-pret", headline: "Pret to open 20 UK sites", url: "https://www.propelinfo.com/story/1", source: "Propel", date: "2026-11-10T00:00:00Z" };
  const out = await dismissFromNews(store, story, EMILY, NOW);
  assert.equal(out.quietUntil!.getTime(), days(30).getTime());
  assert.deepEqual([evidence.length, evidence[0].kind, evidence[0].company_id, evidence[0].status, evidence[0].resolved_reason, evidence[0].resolved_by_user_id, evidence[0].source_label, evidence[0].created_by_kind],
    [1, "press", "c-pret", "dismissed", "not_a_requirement", "u-emily", "Propel", "person"]);
  assert.equal(requirements.length, 0, "a dismissal never makes a requirement");
  // Pressed again the same day: nothing more is written.
  assert.equal((await dismissFromNews(store, story, EMILY, NOW)).evidenceIds[0], evidence[0].id);
  assert.equal(evidence.length, 1);
  // The brand's machine-read news is quiet for the 30 days; another brand's is not.
  assert.equal((await suggest(store, press("Pret", { dedupeKey: "propel:after-dismiss" }), { now: days(5) })).outcome, "quiet");
  assert.equal((await suggest(store, press("Gail's Bakery"), { now: days(5) })).outcome, "opened");
  // A company that is not in the CRM is refused: a brand is never made up.
  await assert.rejects(dismissFromNews(store, { ...story, companyId: "c-nobody" }, EMILY, NOW), refused("NO_BRAND"));
});

test("a dismissal needs a reason and quietens that brand's news for 30 days", async () => {
  const { store, evidence } = fakeStore({ companies: [PRET, GAILS] });
  const s = await suggest(store, press("Pret A Manger"), { now: NOW });
  await assert.rejects(dismiss(store, { suggestionId: s.evidence.id, reason: " " }, EMILY, NOW), refused("REASON_NEEDED"));
  const out = await dismiss(store, { suggestionId: s.evidence.id, reason: "not_a_requirement" }, EMILY, NOW);
  assert.equal(out.quietUntil!.getTime(), days(30).getTime());
  assert.deepEqual([evidence[0].status, evidence[0].resolved_reason, evidence[0].resolved_by_user_id], ["dismissed", "not_a_requirement", "u-emily"]);
  // More Pret news inside the 30 days is kept, but raises nothing…
  const quiet = await suggest(store, press("Pret", { dedupeKey: "propel:later" }), { now: days(29) });
  assert.equal(quiet.outcome, "quiet");
  assert.equal(quiet.evidence.status, "dismissed");
  assert.equal(quiet.evidence.resolved_by_user_id, null);
  assert.equal((await suggest(store, press("Pret", { dedupeKey: "propel:later" }), { now: days(29) })).outcome, "duplicate");
  assert.equal((await listSuggestions(store, {}, days(29))).suggestions.length, 0);
  // …other brands and other kinds of source are not quietened…
  assert.equal((await suggest(store, press("Gail's Bakery"), { now: days(1) })).outcome, "opened");
  assert.equal((await suggest(store, { kind: "team_chat", brand: { name: "Pret" }, headline: "Pret looking" }, { now: days(1) })).outcome, "opened");
  // …a person raising a story by hand is not quietened…
  const byHand = await suggest(store, press("Pret", { headline: "Raised by hand" }), { now: days(2), by: TOM });
  assert.equal(byHand.outcome, "opened");
  await dismiss(store, { suggestionId: byHand.evidence.id, reason: "wrong_brand" }, TOM, days(2));
  // …"wrong brand" says nothing about Pret, so it does not restart the clock,
  // and the quiet line itself never extends it: day 31 raises again.
  assert.equal((await suggest(store, press("Pret", { dedupeKey: "propel:day31" }), { now: days(31) })).outcome, "opened");
});

test("a staff member's own word (ChatBGP) is a confirmation; an unmatched brand still only suggests", async () => {
  const { store, evidence, requirements } = fakeStore({ companies: [GAILS] });
  const said: EvidenceInput = { kind: "chat", brand: { name: "Gail's Bakery" }, sourceLabel: "ChatBGP", headline: "Gail's want 1,200 sq ft in Bath", dedupeKey: "chat:m1" };
  const out = await confirm(store, { evidence: said, fields: { size: ["1,200 sq ft"], requirementLocations: ["Bath"] } }, EMILY, NOW);
  assert.equal(out.outcome, "created");
  assert.deepEqual([requirements[0].origin, requirements[0].confirmed_how, requirements[0].last_confirmed_by], ["bgp", "chat", "u-emily"]);
  assert.deepEqual([evidence[0].status, evidence[0].created_by_kind, evidence[0].created_by_user_id, evidence[0].requirement_id, evidence[0].resolved_reason],
    ["confirmed", "person", "u-emily", requirements[0].id, DIRECT_REASON]);
  // Said twice (a retried tool call): nothing new.
  const again = await confirm(store, { evidence: said }, EMILY, NOW);
  assert.equal(again.outcome, "duplicate");
  assert.equal(again.requirement!.id, requirements[0].id);
  assert.equal(requirements.length, 1);
  // The brand now has a requirement: a second word needs "which one" or "a new search".
  await assert.rejects(confirm(store, { evidence: { ...said, dedupeKey: "chat:m2" } }, EMILY, NOW), refused("EXISTING_REQUIREMENT"));
  assert.equal(evidence.length, 1, "a refused confirmation writes nothing");
  // A name with no CRM brand: no requirement, a suggestion carrying the name, raised by the person.
  const unknown = await confirm(store, { evidence: { kind: "chat", brand: { name: "Farmer J" }, headline: "Farmer J want the City" } }, EMILY, NOW);
  assert.deepEqual([unknown.outcome, unknown.reason, unknown.requirement], ["suggested", "unmatched", null]);
  assert.equal(requirements.length, 1);
  const waiting = evidence.find(e => e.brand_name === "Farmer J")!;
  assert.deepEqual([waiting.status, waiting.company_id, waiting.created_by_name], ["open", null, "Emily Stone"]);
  // Direct confirmations are not listed as suggestions.
  assert.equal((await listSuggestions(store, { status: "confirmed" }, NOW)).suggestions.length, 0);
});

test("every action needs a named person", async () => {
  const { store } = fakeStore({ companies: [PRET] });
  const s = await suggest(store, press("Pret A Manger"), { now: NOW });
  await assert.rejects(confirm(store, { suggestionId: s.evidence.id }, { id: "u-x", name: "" }, NOW), refused("NO_PERSON"));
  await assert.rejects(dismiss(store, { suggestionId: s.evidence.id, reason: "duplicate" }, { id: "", name: "Nobody" }, NOW), refused("NO_PERSON"));
  await assert.rejects(attach(store, { suggestionId: s.evidence.id, requirementId: "r" }, null, NOW), refused("NO_PERSON"));
  await assert.rejects(confirm(store, { suggestionId: s.evidence.id, how: "created" as any }, EMILY, NOW), refused("BAD_HOW"));
});

test("Still live stamps the caller, refuses a closed requirement and leaves a dated line", async () => {
  const rows: RequirementRow[] = [
    { id: "r1", name: "Pret", company_id: "c-pret", status: "Active", origin: "bgp", last_confirmed_at: days(-200), last_confirmed_by: "u-tom", last_confirmed_by_name: "Tom Reed", confirmed_how: "created" },
    { id: "r2", name: "Pret old", company_id: "c-pret", status: "Archived" },
  ];
  const { store, evidence, requirements } = fakeStore({ companies: [PRET], requirements: rows });
  assert.equal(requirementLive(requirements[0], NOW).state, "to_confirm");
  const r = await stillLive(store, "r1", EMILY, undefined, NOW);
  assert.deepEqual([r.last_confirmed_by, r.last_confirmed_by_name, r.confirmed_how], ["u-emily", "Emily Stone", "still_live"]);
  assert.equal(r.last_confirmed_at, NOW);
  assert.equal(r.updated_at, NOW);
  assert.equal(requirementLive(r, NOW).state, "live");
  assert.deepEqual([evidence[0].kind, evidence[0].headline, evidence[0].created_by_name, evidence[0].requirement_id], ["note", "Confirmed still live", "Emily Stone", "r1"]);
  await assert.rejects(stillLive(store, "r2", EMILY, null, NOW), refused("REQUIREMENT_CLOSED"));
  await assert.rejects(stillLive(store, "nope", EMILY, null, NOW), refused("REQUIREMENT_NOT_FOUND"));
});

test("the owner is an active BGP colleague, and setting one is not a confirmation", async () => {
  const { store, evidence, requirements } = fakeStore({ requirements: [{ id: "r1", name: "Pret", company_id: null, status: "Active" }] });
  await assert.rejects(setOwner(store, "r1", ["u-client"], EMILY, NOW), refused("NOT_STAFF"));
  const r = await setOwner(store, "r1", ["u-tom", "u-emily"], EMILY, NOW);
  assert.deepEqual([r.bgp_contact_user_id, r.bgp_contact_user_ids], ["u-tom", ["u-tom", "u-emily"]]);
  assert.equal(requirements[0].last_confirmed_at, undefined);
  assert.equal(evidence[0].headline, "Owner set to Tom Reed, Emily Stone");
  assert.equal(evidence[0].created_by_name, "Emily Stone");
  const cleared = await setOwner(store, "r1", [], EMILY, NOW);
  assert.deepEqual([cleared.bgp_contact_user_id, cleared.bgp_contact_user_ids], [null, null]);
});

test("the reviewer re-points a wrong brand, and it joins that brand's open suggestion", async () => {
  const { store, evidence } = fakeStore({ companies: [PRET, GAILS] });
  const pret = await suggest(store, press("Pret A Manger"), { now: NOW });
  const wrong = await suggest(store, press("Gail's Bakery", { headline: "Really about Pret" }), { now: NOW });
  const out = await setSuggestionBrand(store, { suggestionId: wrong.evidence.id, companyId: "c-pret" }, EMILY, NOW);
  assert.deepEqual([out.joined, out.suggestionId], [true, pret.evidence.id]);
  assert.equal(evidence[1].company_id, "c-pret");
  assert.equal(evidence[1].suggestion_id, pret.evidence.id);
  const listed = await listSuggestions(store, {}, NOW);
  assert.equal(listed.suggestions.length, 1);
  assert.equal(listed.suggestions[0].lineCount, 2);
  await assert.rejects(setSuggestionBrand(store, { suggestionId: pret.evidence.id, companyId: "c-missing" }, EMILY, NOW), refused("BRAND_NOT_FOUND"));
});

test("the list groups lines, proposes the next step and counts what is waiting", async () => {
  const reqs: RequirementRow[] = [
    { id: "r-pret", name: "Pret A Manger", company_id: "c-pret", status: "Active", origin: "pipnet" },
    { id: "r-draft", name: "Viewing draft", company_id: "c-gails", status: "Draft", origin: "bgp" },
  ];
  const { store } = fakeStore({ companies: [PRET, GAILS], requirements: reqs });
  await suggest(store, press("Pret A Manger"), { now: NOW });
  await suggest(store, press("Pret", { headline: "More Pret" }), { now: NOW });
  await suggest(store, press("Farmer J"), { now: NOW });
  await suggest(store, { kind: "gossip", brand: { companyIds: ["c-gails"] }, headline: "Gail's looking in Bath", saidBy: "Tom Reed" }, { now: NOW });
  const all = await listSuggestions(store, {}, NOW);
  assert.equal(all.suggestions.length, 3);
  assert.deepEqual(all.counts.byKind, { press: 2, gossip: 1 });
  assert.deepEqual([all.counts.open, all.counts.unmatched, all.counts.drafts, all.counts.suggestionsAndDrafts], [3, 1, 1, 4]);
  const pret = all.suggestions.find(s => s.brand.companyId === "c-pret")!;
  assert.deepEqual([pret.lineCount, pret.proposed, pret.existingRequirements[0].id, pret.existingRequirements[0].state], [2, "confirm_existing", "r-pret", "background"]);
  assert.equal(pret.matchedBy, "name");
  assert.equal(pret.details, null, "the matcher's own notes are not sent as details");
  assert.equal(all.suggestions.find(s => !s.brand.matched)!.proposed, "pick_brand");
  // A Draft on the brand is an open requirement: the reviewer is offered it.
  assert.equal(all.suggestions.find(s => s.brand.companyId === "c-gails")!.proposed, "confirm_existing");
  assert.equal((await listSuggestions(store, { kind: "gossip" }, NOW)).suggestions.length, 1);
  assert.equal((await listSuggestions(store, { unmatched: true }, NOW)).suggestions[0].brand.name, "Farmer J");
});

test("how sure: conversation, viewing-backed, press-reported, market listing only", async () => {
  const viewings = [{ id: "v1", requirement_id: "r-list", viewing_date: "2026-11-01", status: "completed", company_name: "Pret", unit_name: "Unit 4", property_name: "Trinity Leeds" }];
  const listing: RequirementRow = { id: "r-list", name: "Pret", company_id: "c-pret", status: "Active", origin: "pipnet", last_listed_at: days(-40), last_listed_source: "PIPnet" };
  const { store } = fakeStore({ companies: [PRET], requirements: [listing], viewings });
  assert.equal(howSure(listing, [], NOW).label, "Market listing only");
  assert.equal(howSure({ ...listing, origin: "bgp" }, [], NOW).label, "Not yet confirmed");
  assert.equal(howSure(listing, [{ kind: "press", status: "attached" }], NOW).label, "Press-reported");
  assert.equal(howSure(listing, [{ kind: "press", status: "dismissed" }], NOW).label, "Market listing only");
  assert.equal(howSure(listing, [{ kind: "press", status: "attached" }, { kind: "viewing", status: "attached" }], NOW).label, "Viewing-backed");
  // A confirmed viewing linked to the requirement is read live as evidence.
  const page = await requirementEvidence(store, "r-list", NOW);
  assert.equal(page.howSure.key, "viewing");
  assert.deepEqual([page.evidence[0].kind, page.evidence[0].headline], ["viewing", "Viewed: Unit 4, Trinity Leeds"]);
  assert.equal(page.requirement.live.state, "background");
  await stillLive(store, "r-list", EMILY, "call", NOW);
  const after = await requirementEvidence(store, "r-list", NOW);
  assert.deepEqual([after.howSure.label, after.requirement.live.state], ["Confirmed by conversation", "live"]);
  // The still-live note, the viewing, and the PIPnet listing as a line of its own.
  assert.deepEqual(after.evidence.map(e => e.kind), ["note", "viewing", "listing"]);
  const listed = after.evidence[2];
  assert.deepEqual([listed.id, listed.sourceLabel, listed.headline, listed.url], ["listing:r-list", "PIPnet", "Listed on PIPnet", null]);
  assert.equal(new Date(listed.evidenceDate!).getTime(), days(-40).getTime());
});

test("the market listing is a line on its requirement and never changes the how-sure label", async () => {
  const requirements: RequirementRow[] = [
    { id: "r-old", name: "Pret", company_id: "c-pret", status: "Active", origin: null, sources: ["TRL"] },
    { id: "r-own", name: "Gail's", company_id: "c-gails", status: "Active", origin: "bgp", last_listed_at: days(-10), last_listed_source: "PIPnet", external_requirement_id: "x1" },
    { id: "r-plain", name: "Gail's kiosk", company_id: "c-gails", status: "Active", origin: "bgp" },
  ];
  const { store } = fakeStore({ companies: [PRET, GAILS], requirements });
  const urls: string[] = [];
  const withUrl: IntakeStore = { ...store, listingUrl: async id => { urls.push(id); return "https://www.pipnet.co.uk/requirement/1"; } };
  // An old import row with only its label: listed on The Requirement List, no date kept.
  const old = await requirementEvidence(withUrl, "r-old", NOW);
  assert.deepEqual(old.evidence.map(e => [e.kind, e.sourceLabel, e.headline, e.evidenceDate, e.url]), [["listing", "The Requirement List", "Listed on The Requirement List; the import kept no date", null, null]]);
  assert.equal(old.howSure.label, "Market listing only");
  // BGP's own requirement that PIPnet also lists: the line shows, with the import's link, and the label stays BGP's.
  const own = await requirementEvidence(withUrl, "r-own", NOW);
  assert.deepEqual(own.evidence.map(e => [e.kind, e.url]), [["listing", "https://www.pipnet.co.uk/requirement/1"]]);
  assert.equal(own.howSure.label, "Not yet confirmed");
  assert.deepEqual(urls, ["x1"]);
  assert.equal((await requirementEvidence(withUrl, "r-plain", NOW)).evidence.length, 0);
});

test("evidence can be put straight onto a requirement without confirming it", async () => {
  const { store, evidence, requirements } = fakeStore({ companies: [PRET], requirements: [{ id: "r1", name: "Pret", company_id: "c-pret", status: "Active", origin: "pipnet" }] });
  const line: EvidenceInput = { kind: "listing", brand: {}, sourceLabel: "PIPnet", headline: "Re-listed on PIPnet", dedupeKey: "pipnet:123:2026-11-12", detectedBy: "PIPnet import" };
  const out = await attach(store, { requirementId: "r1", evidence: line }, null, NOW);
  assert.equal(out.outcome, "attached");
  assert.deepEqual([evidence[0].status, evidence[0].company_id, evidence[0].brand_name, evidence[0].created_by_kind, evidence[0].resolved_by_name], ["attached", "c-pret", "Pret A Manger", "machine", "PIPnet import"]);
  assert.equal((await attach(store, { requirementId: "r1", evidence: line }, null, NOW)).outcome, "duplicate");
  assert.equal(evidence.length, 1);
  assert.equal(requirements[0].last_confirmed_at, undefined);
  assert.equal(requirementLive(requirements[0], NOW).state, "background");
});

test("a brand's confirmed viewings and offers are read live onto its requirement, never copied", async () => {
  const viewings = [
    { id: "v-own", requirement_id: "r1", company_id: "c-pret", viewing_date: "2026-11-01", status: "completed", unit_name: "Unit 4", property_name: "Trinity Leeds" },
    { id: "v-brand", requirement_id: null, company_id: "c-pret", viewing_date: "2026-10-20", status: "completed", unit_name: "Unit 9", property_name: "White Rose" },
    { id: "v-other-search", requirement_id: "r2", company_id: "c-pret", viewing_date: "2026-10-25", status: "completed", unit_name: "Kiosk", property_name: "Bluewater" },
    { id: "v-gails", requirement_id: null, company_id: "c-gails", viewing_date: "2026-10-30", status: "completed", unit_name: "Unit 1", property_name: "Trinity Leeds" },
  ];
  const offers = [
    { id: "o1", company_id: "c-pret", offer_date: "2026-11-05", status: "Pending", confirmed_at: NOW, unit_name: "Unit 4", property_name: "Trinity Leeds" },
    { id: "o-unconfirmed", company_id: "c-pret", offer_date: "2026-11-06", status: "Pending", confirmed_at: null, unit_name: "Unit 4", property_name: "Trinity Leeds" },
  ];
  const requirements: RequirementRow[] = [
    { id: "r1", name: "Pret", company_id: "c-pret", status: "Active", origin: "pipnet" },
    { id: "r2", name: "Pret drive-thru", company_id: "c-pret", status: "Active", origin: "bgp" },
  ];
  const { store, evidence } = fakeStore({ companies: [PRET, GAILS], requirements, viewings, offers });
  const page = await requirementEvidence(store, "r1", NOW);
  assert.deepEqual(page.evidence.map(e => e.id), ["offer:o1", "viewing:v-own", "viewing:v-brand", "listing:r1"]);
  assert.equal(page.evidence[0].headline, "Offer (pending): Unit 4, Trinity Leeds");
  assert.equal(page.howSure.label, "Viewing-backed");
  assert.equal(evidence.length, 0, "nothing was written");
  assert.equal(page.requirement.live.state, "background", "a viewing is evidence, not a confirmation");
});

test("confirming a suggestion raised from viewings points those viewings at the new requirement", async () => {
  const seedViewings = [
    { id: "v1", requirement_id: null, company_id: "c-gails", viewing_date: "2026-10-01" },
    { id: "v2", requirement_id: null, company_id: "c-gails", viewing_date: "2026-11-01" },
    { id: "v3", requirement_id: null, company_id: "c-pret", viewing_date: "2026-11-02" },
  ];
  const { store, requirements, viewings } = fakeStore({ companies: [PRET, GAILS], viewings: seedViewings });
  const line = (id: string): EvidenceInput => ({ kind: "viewing", brand: { companyIds: ["c-gails"] }, sourceLabel: "Viewing", sourceRef: id, headline: "Viewed: Unit 1", dedupeKey: `viewing:${id}`, detectedBy: "Viewing rule" });
  const first = await suggest(store, line("v1"), { now: NOW });
  assert.equal((await suggest(store, line("v2"), { now: NOW })).outcome, "joined");
  const out = await confirm(store, { suggestionId: first.evidence.id, how: "viewing" }, EMILY, NOW);
  assert.deepEqual([out.outcome, requirements[0].confirmed_how, requirements[0].last_confirmed_by_name, requirements[0].status], ["created", "viewing", "Emily Stone", "Active"]);
  assert.deepEqual(viewings.map(v => v.requirement_id), [requirements[0].id, requirements[0].id, null]);
});

test("\"mark as satisfied?\": a person closes the requirement as Past; confirming is refused", async () => {
  const live: RequirementRow = { id: "r1", name: "Gail's", company_id: "c-gails", status: "Active", origin: "bgp", last_confirmed_at: days(-10), last_confirmed_by: "u-tom", last_confirmed_by_name: "Tom Reed", confirmed_how: "call" };
  const { store, evidence, requirements } = fakeStore({ companies: [PRET, GAILS], requirements: [live] });
  const s = await suggest(store, { kind: "deal", brand: { companyIds: ["c-gails"] }, sourceLabel: "Deal", sourceRef: "d1", headline: "Deal #412 for Gail's Bakery at Unit 4 reached solicitors. Mark the requirement as satisfied?",
    details: { proposal: PROPOSAL_MARK_SATISFIED, requirementId: "r1", dealId: "d1" }, dedupeKey: "deal-solicitors:d1", detectedBy: "Deal status rule" }, { now: NOW });
  assert.equal(s.outcome, "opened");
  assert.equal(requirements[0].status, "Active", "the machine only asks");
  assert.equal((await listSuggestions(store, {}, NOW)).suggestions[0].proposed, "mark_satisfied");
  // "Confirm" would stamp the requirement as live: the opposite of the question.
  await assert.rejects(confirm(store, { suggestionId: s.evidence.id, requirementId: "r1" }, EMILY, NOW), refused("SATISFIED_QUESTION"));
  await assert.rejects(markSatisfied(store, { suggestionId: s.evidence.id }, { id: "", name: "" }, NOW), refused("NO_PERSON"));
  const out = await markSatisfied(store, { suggestionId: s.evidence.id }, EMILY, NOW);
  assert.equal(out.requirement.status, "Past");
  assert.equal(requirementLive(requirements[0], NOW).state, "closed");
  assert.deepEqual([requirements[0].last_confirmed_by_name, requirements[0].confirmed_how], ["Tom Reed", "call"], "closing is not a confirmation");
  assert.deepEqual([evidence[0].status, evidence[0].requirement_id, evidence[0].resolved_by_name, evidence[0].resolved_reason], ["attached", "r1", "Emily Stone", "satisfied"]);
  assert.ok(evidence.some(e => e.kind === "note" && /^Marked satisfied/.test(e.headline || "") && e.created_by_name === "Emily Stone"));
  await assert.rejects(markSatisfied(store, { suggestionId: s.evidence.id }, EMILY, NOW), refused("ALREADY_ANSWERED"));
});

test("mark satisfied: with several open requirements the reviewer says which; other suggestions cannot be answered that way", async () => {
  const requirements: RequirementRow[] = [
    { id: "r1", name: "Pret", company_id: "c-pret", status: "Active", origin: "bgp" },
    { id: "r2", name: "Pret drive-thru", company_id: "c-pret", status: "Active", origin: "bgp" },
    { id: "r-gails", name: "Gail's", company_id: "c-gails", status: "Active", origin: "bgp" },
  ];
  const { store } = fakeStore({ companies: [PRET, GAILS], requirements });
  const s = await suggest(store, { kind: "deal", brand: { companyIds: ["c-pret"] }, headline: "Deal reached solicitors", details: { proposal: PROPOSAL_MARK_SATISFIED, requirementId: null } }, { now: NOW });
  await assert.rejects(markSatisfied(store, { suggestionId: s.evidence.id }, EMILY, NOW), (e: any) => refused("REQUIREMENT_NEEDED")(e) && e.extra.existing.length === 2);
  await assert.rejects(markSatisfied(store, { suggestionId: s.evidence.id, requirementId: "r-gails" }, EMILY, NOW), refused("OTHER_BRAND"));
  // "No, still looking": dismissed, and nothing is closed.
  await dismiss(store, { suggestionId: s.evidence.id, reason: "still looking for more sites" }, EMILY, NOW);
  assert.deepEqual(requirements.map(r => r.status), ["Active", "Active", "Active"]);
  const pressStory = await suggest(store, press("Gail's Bakery"), { now: NOW });
  await assert.rejects(markSatisfied(store, { suggestionId: pressStory.evidence.id, requirementId: "r-gails" }, EMILY, NOW), refused("NOT_A_SATISFIED_QUESTION"));
});

// ── "Still live?" (a closure, CVA or administration story) ─────────────────

const stillLiveStory = (extra: Partial<EvidenceInput> = {}): EvidenceInput => ({
  kind: "press", brand: { companyIds: ["c-pret"] }, sourceLabel: "Propel", headline: "Still live? Pret A Manger: Pret launches CVA", evidenceDate: NOW,
  details: { proposal: PROPOSAL_STILL_LIVE, requirementId: "r1", signalType: "closure" }, detectedBy: "News reader", ...extra,
});
const liveByCall = (): RequirementRow => ({ id: "r1", name: "Pret", company_id: "c-pret", status: "Active", origin: "bgp", last_confirmed_at: days(-20), last_confirmed_by: "u-tom", last_confirmed_by_name: "Tom Reed", confirmed_how: "call" });

test("\"still live?\": yes confirms the requirement the question is about and never makes a new one", async () => {
  const { store, evidence, requirements } = fakeStore({ companies: [PRET, GAILS], requirements: [liveByCall()] });
  const s = await suggest(store, stillLiveStory(), { now: NOW });
  assert.equal(s.outcome, "opened");
  assert.equal((await listSuggestions(store, {}, NOW)).suggestions[0].proposed, "still_live");
  assert.deepEqual([requirements[0].status, requirements[0].last_confirmed_by_name], ["Active", "Tom Reed"], "the story itself changes nothing");
  // "Yes": the named person confirms it today. A conversation is not downgraded to press, and the record of the call is kept.
  const yes = await confirm(store, { suggestionId: s.evidence.id, createNew: true }, EMILY, days(1));
  assert.deepEqual([yes.outcome, yes.requirement!.id, requirements.length], ["confirmed_existing", "r1", 1]);
  assert.deepEqual([requirements[0].last_confirmed_by_name, requirements[0].confirmed_how, requirements[0].last_confirmed_at.getTime()], ["Emily Stone", "call", days(1).getTime()]);
  assert.deepEqual([evidence[0].status, evidence[0].requirement_id], ["confirmed", "r1"]);
});

test("\"still live?\": no archives the requirement, by a named person, and the story stays on it", async () => {
  const { store, evidence, requirements } = fakeStore({ companies: [PRET, GAILS], requirements: [liveByCall()] });
  const s = await suggest(store, stillLiveStory(), { now: NOW });
  await assert.rejects(markNotLive(store, { suggestionId: s.evidence.id }, { id: "", name: "" }, NOW), refused("NO_PERSON"));
  const no = await markNotLive(store, { suggestionId: s.evidence.id }, EMILY, NOW);
  assert.equal(no.requirement.status, "Archived");
  assert.equal(requirementLive(requirements[0], NOW).state, "closed");
  assert.deepEqual([requirements[0].last_confirmed_by_name, requirements[0].confirmed_how], ["Tom Reed", "call"], "closing is not a confirmation");
  assert.deepEqual([evidence[0].status, evidence[0].requirement_id, evidence[0].resolved_by_name, evidence[0].resolved_reason], ["attached", "r1", "Emily Stone", "not_live"]);
  assert.ok(evidence.some(e => e.kind === "note" && /^Marked no longer live/.test(e.headline || "") && e.created_by_name === "Emily Stone"));
  // Only a "still live?" question can be answered that way.
  const story = await suggest(store, press("Gail's Bakery"), { now: NOW });
  await assert.rejects(markNotLive(store, { suggestionId: story.evidence.id }, EMILY, NOW), refused("NOT_A_STILL_LIVE_QUESTION"));
});

test("\"still live?\" is kept apart from the brand's expansion stories and from the news quiet period", async () => {
  const { store, requirements } = fakeStore({ companies: [PRET, GAILS], requirements: [liveByCall()] });
  // An expansion story and a closure question for the same brand are two suggestions, not one.
  const expansion = await suggest(store, press("Pret A Manger", { dedupeKey: "propel:1" }), { now: NOW });
  const question = await suggest(store, stillLiveStory({ dedupeKey: "still-live:1" }), { now: NOW });
  assert.deepEqual([expansion.outcome, question.outcome], ["opened", "opened"]);
  // A second closure story joins the open question; a second expansion story joins the expansion suggestion.
  assert.deepEqual(await suggest(store, stillLiveStory({ dedupeKey: "still-live:2" }), { now: NOW }).then(o => [o.outcome, o.suggestionId]), ["joined", question.evidence.id]);
  assert.deepEqual(await suggest(store, press("Pret", { dedupeKey: "propel:2" }), { now: NOW }).then(o => [o.outcome, o.suggestionId]), ["joined", expansion.evidence.id]);
  // Dismissing the expansion story quietens expansion news, not the question…
  await dismiss(store, { suggestionId: expansion.evidence.id, reason: "not_a_requirement" }, EMILY, NOW);
  assert.equal((await suggest(store, press("Pret", { dedupeKey: "propel:3" }), { now: days(3) })).outcome, "quiet");
  assert.equal((await suggest(store, stillLiveStory({ dedupeKey: "still-live:3" }), { now: days(3) })).outcome, "joined");
  // …and dismissing the question ("the story is about another company") quietens nothing.
  const dismissed = await dismiss(store, { suggestionId: question.evidence.id, reason: "wrong_brand" }, EMILY, days(4));
  assert.equal(dismissed.quietUntil, null);
  const again = await suggest(store, stillLiveStory({ dedupeKey: "still-live:4" }), { now: days(5) });
  assert.equal(again.outcome, "opened");
  const other = await dismiss(store, { suggestionId: again.evidence.id, reason: "not_a_requirement" }, EMILY, days(5));
  assert.equal(other.quietUntil, null, "a dismissed question never starts the news quiet period");
  assert.equal((await suggest(store, press("Pret", { dedupeKey: "propel:day40" }), { now: days(40) })).outcome, "opened");
  assert.equal(requirements[0].status, "Active");
});

test("\"still live?\" with no requirement left to ask about is refused, never turned into a new requirement", async () => {
  const closed: RequirementRow = { ...liveByCall(), status: "Archived" };
  const { store, requirements } = fakeStore({ companies: [PRET], requirements: [closed] });
  const s = await suggest(store, stillLiveStory(), { now: NOW });
  await assert.rejects(confirm(store, { suggestionId: s.evidence.id }, EMILY, NOW), (e: any) => refused("REQUIREMENT_NEEDED")(e) && e.extra.existing.length === 0);
  await assert.rejects(confirm(store, { suggestionId: s.evidence.id, createNew: true }, EMILY, NOW), refused("REQUIREMENT_NEEDED"));
  await assert.rejects(confirm(store, { suggestionId: s.evidence.id, requirementId: "r1" }, EMILY, NOW), refused("REQUIREMENT_CLOSED"));
  await assert.rejects(markNotLive(store, { suggestionId: s.evidence.id }, EMILY, NOW), refused("REQUIREMENT_NEEDED"));
  assert.equal(requirements.length, 1);
  // Two open requirements: the reviewer says which.
  const two = fakeStore({ companies: [PRET], requirements: [liveByCall(), { ...liveByCall(), id: "r2", name: "Pret drive-thru" }] });
  const q = await suggest(two.store, stillLiveStory({ details: { proposal: PROPOSAL_STILL_LIVE, requirementId: null } }), { now: NOW });
  await assert.rejects(confirm(two.store, { suggestionId: q.evidence.id }, EMILY, NOW), (e: any) => refused("REQUIREMENT_NEEDED")(e) && e.extra.existing.length === 2);
  assert.equal((await confirm(two.store, { suggestionId: q.evidence.id, requirementId: "r2" }, EMILY, NOW)).requirement!.id, "r2");
});

// ── Faults found in testing (2026-11-12) ───────────────────────────────────

test("how sure says \"by conversation\" only when a call, meeting, email or chat is recorded", async () => {
  const own = (how: string): RequirementRow => ({ id: "r1", name: "Pret", company_id: "c-pret", status: "Active", origin: "bgp", last_confirmed_at: days(-1), last_confirmed_by: "u-emily", last_confirmed_by_name: "Emily Stone", confirmed_how: how });
  for (const how of ["call", "meeting", "email", "chat"]) assert.equal(howSure(own(how), [], NOW).label, "Confirmed by conversation");
  for (const how of ["created", "still_live", "suggestion"]) {
    assert.deepEqual([howSure(own(how), [], NOW).key, howSure(own(how), [], NOW).label], ["person", "Confirmed by Emily, no conversation recorded"]);
  }
  assert.equal(howSure(own("viewing"), [], NOW).label, "Viewing-backed, confirmed by Emily");
  // A bare first Confirm on a market listing is a person vouching for it, not a conversation…
  const listing: RequirementRow = { id: "r-list", name: "Pret", company_id: "c-pret", status: "Active", origin: "pipnet", sources: ["PIPnet"], last_listed_at: days(-400), last_listed_source: "PIPnet" };
  const { store, requirements } = fakeStore({ companies: [PRET], requirements: [listing] });
  await stillLive(store, "r-list", EMILY, null, NOW);
  assert.equal((await requirementEvidence(store, "r-list", NOW)).howSure.label, "Confirmed by Emily, no conversation recorded");
  // …the person who confirmed it owns it, as nobody did; and no date is written onto a row client logins are shown.
  assert.deepEqual([requirements[0].bgp_contact_user_ids, requirements[0].requirement_date], [["u-emily"], undefined]);
  // A recorded call lifts it, and a later bare "still live" keeps that record.
  await stillLive(store, "r-list", TOM, "call", days(1));
  await stillLive(store, "r-list", EMILY, null, days(2));
  assert.deepEqual([requirements[0].confirmed_how, requirements[0].last_confirmed_by, requirements[0].bgp_contact_user_ids], ["call", "u-emily", ["u-emily"]]);
});

test("confirming the requirement on file fills its empty size, use and places from what was detected", async () => {
  const draft: RequirementRow = { id: "r-draft", name: "Pret: viewing requirement", company_id: "c-pret", status: "Draft", origin: "bgp", size: ["1,000 - 2,000 sq ft"] };
  const listing: RequirementRow = { id: "r-list", name: "Gail's", company_id: "c-gails", status: "Active", origin: "pipnet", sources: ["PIPnet"] };
  const { store, requirements } = fakeStore({ companies: [PRET, GAILS], requirements: [draft, listing] });
  const details = { size: ["1,500 - 2,500 sq ft"], use: ["Restaurant"], locations: ["Leeds", "Liverpool"] };
  const s = await suggest(store, { kind: "chat", brand: { companyIds: ["c-pret"] }, sourceLabel: "ChatBGP", headline: "Pret want Leeds", details }, { now: NOW });
  await confirm(store, { suggestionId: s.evidence.id, requirementId: "r-draft" }, EMILY, NOW);
  // Empty fields are filled; the saved size is never replaced.
  assert.deepEqual([requirements[0].status, requirements[0].size, requirements[0].use, requirements[0].requirement_locations, requirements[0].bgp_contact_user_ids],
    ["Active", ["1,000 - 2,000 sq ft"], ["Restaurant"], ["Leeds", "Liverpool"], ["u-emily"]]);
  // A PIPnet-labelled row is shown to client logins: nothing detected is copied onto it.
  const g = await suggest(store, { kind: "chat", brand: { companyIds: ["c-gails"] }, sourceLabel: "ChatBGP", headline: "Gail's want York", details }, { now: NOW });
  await confirm(store, { suggestionId: g.evidence.id, requirementId: "r-list" }, EMILY, NOW);
  assert.deepEqual([requirements[1].confirmed_how, requirements[1].size, requirements[1].use, requirements[1].requirement_locations], ["chat", undefined, undefined, undefined]);
});

test("a requirement belongs to a tenant brand: a landlord or agent company is refused as the brand", async () => {
  const LANDLORD: Company = { id: "c-land", name: "Landsec", type: "Landlord" };
  const { store, requirements } = fakeStore({ companies: [PRET, LANDLORD] });
  const refused = (e: any) => e instanceof IntakeError && e.code === "NOT_A_BRAND" && e.status === 400;
  await assert.rejects(addRequirementFromNews(store, { companyId: "c-land", headline: "Landsec to open ten sites", source: "Propel" }, EMILY, NOW), refused);
  const s = await suggest(store, { kind: "gossip", brand: { name: "Farmer J" }, headline: "Farmer J want Leeds" }, { now: NOW });
  await assert.rejects(setSuggestionBrand(store, { suggestionId: s.evidence.id, companyId: "c-land" }, EMILY, NOW), refused);
  await assert.rejects(confirm(store, { suggestionId: s.evidence.id, companyId: "c-land" }, EMILY, NOW), refused);
  assert.equal(requirements.length, 0);
  await setSuggestionBrand(store, { suggestionId: s.evidence.id, companyId: "c-pret" }, EMILY, NOW);
});

test("Add requirement from a story works again once the requirement it made is archived or deleted", async () => {
  const { store, requirements } = fakeStore({ companies: [PRET] });
  const story = { companyId: "c-pret", headline: "Pret to open 20 UK sites", url: "https://example.com/pret", source: "Propel" };
  const first = await addRequirementFromNews(store, story, EMILY, NOW);
  // Made from a press story: labelled News whichever screen confirmed it.
  assert.deepEqual([first.outcome, first.requirement!.sources, first.requirement!.confirmed_how], ["created", ["News"], "press"]);
  assert.equal((await addRequirementFromNews(store, story, EMILY, NOW)).outcome, "duplicate", "still open: pressed twice is one requirement");
  requirements[0].status = "Archived";
  const again = await addRequirementFromNews(store, story, EMILY, days(1));
  assert.deepEqual([again.outcome, requirements.length, again.requirement!.status], ["created", 2, "Active"]);
  // Deleted outright: the same.
  requirements.splice(0, requirements.length);
  assert.equal((await addRequirementFromNews(store, story, EMILY, days(2))).outcome, "created");
  // The tray's confirm of a press suggestion carries the same label.
  const g = fakeStore({ companies: [GAILS] });
  const s = await suggest(g.store, press("Gail's Bakery"), { now: NOW });
  await confirm(g.store, { suggestionId: s.evidence.id }, EMILY, NOW);
  assert.deepEqual(g.requirements[0].sources, ["News"]);
});

test("the people named on a confirmed requirement must be real: BGP colleagues as owners", async () => {
  const { store } = fakeStore({ companies: [PRET] });
  await checkPeople(store, undefined);
  await checkPeople(store, { bgpContactUserIds: ["u-emily", "u-tom"] });
  await assert.rejects(checkPeople(store, { bgpContactUserIds: ["u-emily", "client-login"] }), (e: any) => e instanceof IntakeError && e.code === "NOT_STAFF");
  const withContacts: IntakeStore = { ...store, contactsExist: async ids => ids.filter(id => id === "ct-1") };
  await checkPeople(withContacts, { principalContactId: "ct-1" });
  await assert.rejects(checkPeople(withContacts, { principalContactId: "ct-1", agentContactId: "not-a-contact" }), (e: any) => e instanceof IntakeError && e.code === "CONTACT_NOT_FOUND");
});

