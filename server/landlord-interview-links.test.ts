import test from "node:test";
import assert from "node:assert/strict";
import { getLandlordInterviewMentions, linkLandlordInterviewMentions } from "./landlord-interview-links";
import { matchLandlordMeeting } from "./landlord-meeting-matching";

const companies = [
  { id: "aew", name: "AEW", domain: "aew.com", company_type: "Landlord" },
  { id: "landsec", name: "Landsec", domain: "landsec.com", company_type: "Landlord" },
  { id: "brand", name: "Wingstop", domain: "wingstop.com", company_type: "Tenant - F&B" },
];
const interview = (text: string) => ({ id: "interview", team: "London Estate", interviewee: "Nick & Lizzie", meeting_date: "2026-10-27", updated_at: "2026-10-27T09:00:00Z", responses: { rl1: text } });

test("saved landlord mentions link source sentences without treating notes as instructions", () => {
  const result = linkLandlordInterviewMentions([interview("AEW disinstructed us on New Oxford Street; Dough T2 continues as a legacy deal. Landsec needs a follow-up.")], companies);
  assert.equal(result.length, 2);
  const aew = result.find(r => r.companyId === "aew")!;
  assert.equal(aew.excerpt, "AEW disinstructed us on New Oxford Street; Dough T2 continues as a legacy deal.");
  assert.equal(aew.interviewee, "Nick & Lizzie");
  assert.equal(aew.meetingDate, "2026-10-27");
  assert.equal(aew.sourceUrl, "/contacts?tab=meetings&interview=interview");
});

test("AEW subdomain email links, lookalikes and tenant names do not", () => {
  assert.equal(linkLandlordInterviewMentions([interview("Speak to manish@eu.aew.com next week.")], companies)[0]?.companyId, "aew");
  assert.equal(linkLandlordInterviewMentions([interview("not-aew.com, x@aew.com.evil.test, BAEW, Wingstop")], companies).length, 0);
});

test("company-name lists retain the question that explains why they were mentioned", () => {
  const links = linkLandlordInterviewMentions([{ ...interview(""), responses: {
    cp3: "Landsec, AEW", rl3: "Landsec", custom: "AEW needs a follow-up",
  }}], companies);
  const feeClient = links.find(link => link.companyId === "landsec" && link.questionId === "cp3")!;
  assert.equal(feeClient.questionLabel, "Top fee clients");
  assert.match(feeClient.questionText!, /paid the most fees/);
  assert.equal(links.find(link => link.questionId === "rl3")?.questionLabel, "Cross-team relationships");
  assert.equal(links.find(link => link.questionId === "custom")?.questionText, undefined);
  assert.equal(feeClient.excerpt, "Landsec, AEW");
});

test("duplicate names/domains and public email hosts do not create ambiguous links", () => {
  const duplicate = [...companies, { ...companies[0], id: "aew2" }];
  assert.deepEqual(linkLandlordInterviewMentions([interview("AEW and x@eu.aew.com")], duplicate), []);
  assert.deepEqual(linkLandlordInterviewMentions([interview("x@gmail.com")], [{ id: "personal", name: "Example Estate", company_type: "Landlord", domain: "gmail.com" }]), []);
});

test("edited and deleted responses remove links; malformed responses are ignored", () => {
  const iv = interview("AEW");
  assert.equal(linkLandlordInterviewMentions([iv], companies).length, 1);
  iv.responses.rl1 = "Other discussion";
  assert.equal(linkLandlordInterviewMentions([iv], companies).length, 0);
  assert.equal(linkLandlordInterviewMentions([], companies).length, 0);
  assert.equal(linkLandlordInterviewMentions([{ ...iv, responses: { bad: { nested: "AEW" } } }], companies).length, 0);
});

test("database reader only SELECTs landlord catalogue and returns requested company evidence", async () => {
  const sqls: string[] = [];
  const pool = { query: async (sql: string) => { sqls.push(sql); return { rows: sql.includes("crm_companies") ? companies : [interview("AEW and Landsec")] }; } };
  const result = await getLandlordInterviewMentions("aew", { pool });
  assert.equal(result.length, 1);
  assert.equal(result[0].companyId, "aew");
  assert.ok(sqls.every(sql => sql.trim().startsWith("SELECT")));
  assert.match(sqls[0], /NOT LIKE 'tenant%'/);
});

test("each source sentence is matched once even with 250 landlords", () => {
  const catalogue = Array.from({length:250},(_,i)=>({id:`ll-${i}`,name:`Example Landlord ${i}`,domain:`landlord${i}.example`,company_type:"Landlord"}));
  const interviews = Array.from({length:7},(_,i)=>({...interview("Example Landlord 7 is a current relationship. Example Landlord 17 needs follow-up."),id:`interview-${i}`,
    responses:{rl1:"Example Landlord 7 is a current relationship. Example Landlord 17 needs follow-up.",rl2:"Example Landlord 40 is mentioned.",pp1:"Diary links should improve."}}));
  let calls = 0;
  const links = linkLandlordInterviewMentions(interviews,catalogue,(...args)=>{calls++;return matchLandlordMeeting(...args);});
  assert.equal(calls,7*4);
  assert.equal(links.length,21);
  assert.deepEqual([...new Set(links.map(link=>link.companyId))].sort(),["ll-17","ll-40","ll-7"]);
});

test("invalid dates and non-object answer collections cannot break other interview links", () => {
  const links=linkLandlordInterviewMentions([{...interview("AEW"),updated_at:"invalid-date"},
    {...interview("AEW"),responses:["AEW"] as any}],companies);
  assert.equal(links.length,1);
  assert.equal(links[0].updatedAt,null);
});
