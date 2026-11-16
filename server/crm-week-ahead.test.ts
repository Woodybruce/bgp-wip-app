// The CRM week (Woody, 2026-11-16): the rules the calendar on the CRM
// Overview and Monday's email to the directors share.
import test from "node:test";
import assert from "node:assert/strict";
import type { LandlordMeeting } from "../shared/landlord-meetings";
import { groupWeekMeetings, londonDayOf, londonTimeOf, mondayOf, moveWeek, weekAheadHtml, weekAheadSubject, weekDaysFrom, weekLabel, type WeekAhead } from "../shared/crm-week-ahead";

const person = (name: string, domain: string) => ({ name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@${domain}` });
function meeting(over: Partial<LandlordMeeting> & { companyId: string; companyName: string; uid: string }): LandlordMeeting {
  const bgp = [person("Alex Agent", "agency.example")];
  return {
    id: `${over.companyId}:${over.uid}`, subject: "Quarterly review", start: "2026-11-18T14:30:00.000Z", end: "2026-11-18T15:30:00.000Z",
    location: "Teams", participants: [...bgp, person("Lena Landlord", "landlord.example")], bgpParticipants: bgp, source: "calendar", sourceId: over.uid,
    mailbox: bgp[0].email, webLink: null, matchReasons: [], checkedAt: "2026-11-16T07:00:00.000Z", ...over,
  };
}
const coverage = { status: "current" as const, checkedAt: "2026-11-16T07:00:00.000Z", mailboxesChecked: 17, mailboxesExpected: 17, issues: [] };

test("one diary entry that names two landlords is one meeting with both names", () => {
  const grouped = groupWeekMeetings([
    meeting({ companyId: "h", companyName: "Hammerson", uid: "walk" }),
    meeting({ companyId: "b", companyName: "British Land", uid: "walk" }),
    meeting({ companyId: "l", companyName: "Landsec", uid: "review", start: "2026-11-16T10:00:00.000Z" }),
  ]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped.map(m => m.companies.map(c => c.name)), [["Landsec"], ["Hammerson", "British Land"]]);
  assert.deepEqual(grouped[1].bgp, ["Alex Agent"]);
  assert.deepEqual(grouped[1].others, ["Lena Landlord"]);
});

test("days and times are London's, on both sides of a clock change", () => {
  assert.equal(londonDayOf("2026-07-01T23:30:00.000Z"), "2026-07-02");
  assert.equal(londonTimeOf("2026-07-01T23:30:00.000Z"), "00:30");
  assert.equal(londonDayOf("2026-11-18T14:30:00.000Z"), "2026-11-18");
  assert.equal(londonTimeOf("2026-11-18T14:30:00.000Z"), "14:30");
});

test("a week runs Monday to Sunday", () => {
  assert.equal(mondayOf("2026-11-16"), "2026-11-16");
  assert.equal(mondayOf("2026-11-22"), "2026-11-16");
  assert.equal(mondayOf("2026-11-23"), "2026-11-23");
  assert.deepEqual(weekDaysFrom("2026-11-16"), ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
  assert.equal(moveWeek("2026-11-16", 1), "2026-11-23");
  assert.equal(moveWeek("2026-11-16", -1), "2026-11-09");
  assert.equal(weekLabel("2026-11-16"), "16 November to 22 November 2026");
});

const week = (over: Partial<WeekAhead> = {}): WeekAhead => ({
  week: { start: "2026-11-16T00:00:00.000Z", end: "2026-11-23T00:00:00.000Z" },
  meetings: groupWeekMeetings([meeting({ companyId: "l", companyName: "Landsec", uid: "review" })]),
  events: [{ id: "e1", title: "Landlord dinner", startsAt: "2026-11-19T19:00:00.000Z", endsAt: null, location: "Soho", ownerName: "Alex Agent", companies: ["Landsec", "Hammerson"] }],
  coverage, ...over,
});

test("the subject counts the week", () => {
  assert.equal(weekAheadSubject(week()), "CRM week ahead: 1 landlord meeting, 1 event (16 November to 22 November 2026)");
  assert.equal(weekAheadSubject(week({ meetings: [], events: [] })), "CRM week ahead: 0 landlord meetings, 0 events (16 November to 22 November 2026)");
});

test("the email lists each day's meetings and events, in time order, with links to the app only", () => {
  const html = weekAheadHtml(week(), "https://app.example/");
  assert.ok(html.indexOf("Wednesday 18 November") < html.indexOf("Thursday 19 November"));
  assert.match(html, /14:30/);
  assert.match(html, /href="https:\/\/app\.example\/companies\/l"/);
  assert.match(html, /BGP: Alex Agent/);
  assert.match(html, /With: Lena Landlord/);
  assert.match(html, /CRM event<\/span> <a href="https:\/\/app\.example\/contacts\?tab=overview&amp;event=e1"/);
  assert.match(html, /For: Landsec, Hammerson/);
  assert.doesNotMatch(html, /Monday 16 November|Tuesday 17 November/);
  for (const link of html.match(/href="[^"]+"/g) || []) assert.ok(link.startsWith('href="https://app.example/'), link);
  assert.match(html, /Meetings are read from 17 of 17 BGP diaries\./);
  assert.match(html, /Private diary entries are never included\./);
});

test("words from a diary are escaped, never run as markup", () => {
  const html = weekAheadHtml(week({ meetings: groupWeekMeetings([meeting({ companyId: "l", companyName: "Land & <Co>", uid: "x", subject: '<img src=x onerror="alert(1)">', location: "<script>1</script>" })]), events: [] }), "https://app.example");
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /Land &amp; &lt;Co&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test("an empty week and a partly read set of diaries both say so", () => {
  const empty = weekAheadHtml(week({ meetings: [], events: [] }), "https://app.example");
  assert.match(empty, /No landlord meetings were found in BGP diaries for this week, and no CRM events are confirmed\./);
  const partial = weekAheadHtml(week({ coverage: { ...coverage, status: "partial", mailboxesChecked: 12 } }), "https://app.example");
  assert.match(partial, /12 of 17 BGP diaries\. Some diaries are missing or out of date, so this list may be incomplete\./);
  const none = weekAheadHtml(week({ coverage: { ...coverage, status: "not_synced", mailboxesChecked: 0 } }), "https://app.example");
  assert.match(none, /BGP diaries have not been read yet/);
});

test("a long guest list is cut with a count", () => {
  const many = Array.from({ length: 9 }, (_, i) => person(`Guest ${i + 1}`, "landlord.example"));
  const bgp = [person("Alex Agent", "agency.example")];
  const html = weekAheadHtml(week({ meetings: groupWeekMeetings([meeting({ companyId: "l", companyName: "Landsec", uid: "big", participants: [...bgp, ...many], bgpParticipants: bgp })]), events: [] }), "https://app.example");
  assert.match(html, /With: Guest 1, Guest 2, Guest 3, Guest 4, Guest 5, Guest 6 and 3 more/);
});
