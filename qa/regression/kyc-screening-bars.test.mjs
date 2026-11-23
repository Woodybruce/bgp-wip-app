// Which screening matches are red flags (Woody, 19 November 2026, asked why
// ComplyAdvantage "red flags everything", chose "Tighten"): a bare-name match
// too often finds someone else of the same name. Sanctions and warning lists
// stay red flags whatever the score; a public role needs the birth year to
// agree or 60%; anything else the birth year or 90%; the rest are possible
// namesakes, listed and never flagged. A person goes to Mesh with their birth
// month and year and a UK nationality, and the bare name when Mesh refuses
// them. Source guards; the rules are tested in server/kyc-prechecks.test.ts
// and server/comply-advantage.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

test('the bars: sanctions always, a public role at 60%, anything else (warning lists too, since 23 November 2026) at 90%, an agreeing birth year always', () => {
  const rules = read('shared/kyc-prechecks.ts');
  assert.match(rules, /export const PROVIDER_FLAG_BARS = \{ pep: 0\.6, other: 0\.9 \} as const;/);
  // Woody, 23 November 2026: "buffalo bill restaurant" at 20% on a warning list was a red flag against BILLS RESTAURANTS LTD.
  assert.match(rules, /const ALWAYS_FLAG_KIND = \/sanction\/;/);
  const fn = rules.slice(rules.indexOf('export function providerMatchFlags'), rules.indexOf('/** A ComplyAdvantage line'));
  // Since later on 19 November 2026 a person screened with their date of birth is judged by it: only sanctions
  // whatever the score, and a profile with no date of birth is a possible namesake.
  assert.match(fn, /if \(dated \? \/sanction\/\.test\(kind\) : ALWAYS_FLAG_KIND\.test\(kind\)\) return true;/);
  assert.match(fn, /if \(dated && line!\.dobKnown\) return false;/);
  assert.match(rules, /flagged: matches\.filter\(m => providerMatchFlags\(m, line\)\)/);
  assert.match(fn, /if \(m\.unread \?\? !m\.profileId\) return true;/);
  assert.match(fn, /if \(m\.birthYearAgrees === true\) return true;/);
  // The red flags, the card and KYC4U's note all split the matches the same way.
  for (const where of ['export function precheckRedFlags', 'export function precheckCardLines', 'export function precheckNote']) {
    const at = rules.indexOf(where);
    assert.ok(at > 0, where);
    assert.ok(rules.slice(at, at + 12000).includes('splitProviderMatches('), `${where} splits the matches by the bars`);
  }
});

test('web results: "may be someone else" is listed, not flagged; one flag per person and kind; a company is worded as ownership', () => {
  const rules = read('shared/kyc-prechecks.ts');
  // Each reader takes the findings less any that only says nothing was found (21 November 2026).
  // A finding the search was unsure of, or one about the person's company only (23 November 2026), is listed, not flagged.
  assert.match(rules, /const sure = webFindingsOf\(line\)\.filter\(f => f\.kind === kind && !webFindingUnsure\(line, f\)\);/);
  assert.match(rules, /Possibly owned or controlled by the state or a politically exposed person: \$\{line\.name\}/);
  assert.match(rules, /const findings = searched\.flatMap\(l => webFindingsOf\(l\)\.filter\(f => !webFindingUnsure\(l, f\)\)/);
  assert.match(rules, /if \(!summary \|\| webFindingSaysNothing\(summary\)\) continue;/);
  assert.doesNotMatch(rules, /\bline\.findings\.(filter|map)\(/, "no reader takes a stored line's findings as they are");
  assert.match(rules, /key: "namesakes", label: `Possible namesakes to check: \$\{namesakes\.length\}`, state: "info"/);
  assert.match(read('server/kyc-prechecks.ts'), /person: subject\.person, ran: false/);
});

test('a person goes to Mesh with their birth month, year and a UK nationality, and the bare name when Mesh refuses them', () => {
  const ca = read('server/comply-advantage.ts');
  assert.match(ca, /out\.date_of_birth = \{ year, month: /);
  assert.match(ca, /if \(s\.nationality && \/\^\[A-Z\]\{2\}\$\/\.test\(s\.nationality\)\) out\.nationality = \[s\.nationality\];/);
  assert.match(ca, /if \(!bare && \(call\.status === 400 \|\| call\.status === 422\)\) \{/);
  assert.match(ca, /noteMeshRefusedDetails\(deps\.now\(\), words \|\| `answered \$\{call\.status\}`\);/);
  // Mesh takes exactly one of full_name or last_name: a person goes by last_name and given names, never both (22 Nov 2026).
  assert.match(ca, /customer\.person = \{ \.\.\.meshNameParts\(s\), \.\.\.\(opts\.bare \? \{\} : meshPersonDetails\(s\)\) \};/);
  assert.doesNotMatch(ca, /customer\.person = \{[^}]*full_name/);
  // Mesh's screens score 0 to 100.
  assert.match(ca, /\(raw <= 1 \? raw : raw <= 100 \? raw \/ 100 : undefined\)/);
  const pre = read('server/kyc-prechecks.ts');
  assert.match(pre, /birthMonth: s\.dobMonth \?\? null, nationality: s\.person \? meshNationality\(s\.nationality\) : null,/);
  assert.match(pre, /const UK_NATIONALITY = \/\^\(british\|/);
  assert.match(pre, /birthYearAgrees: typeof d\.birthYearAgrees === "boolean" \? d\.birthYearAgrees : null, unread: !!d\.unread,/);
});

test('only the company and its beneficial owners go to ComplyAdvantage and the web search; everyone to the sanctions lists', () => {
  const pre = read('server/kyc-prechecks.ts');
  assert.match(pre, /const screen = chooseScreened\(subjects, \{ individual: subjectKind === "individual", listed: !!companiesHouse\?\.listing, maxPeople: KYC_PRECHECK_MAX_WEB_PEOPLE \}\);/);
  assert.match(pre, /screenSubjects\(subjects\),/);
  assert.match(pre, /screenComplyAdvantage\(screen\.full\),/);
  // The party, the companies registered abroad that own it (20 November 2026: Monaco), then the people.
  assert.match(pre, /const searched = \[\.\.\.screen\.full\.filter\(s => !s\.person\)\.slice\(0, 1\), \.\.\.screen\.full\.filter\(s => !s\.person && s\.abroad\)\.slice\(0, 2\), \.\.\.screen\.full\.filter\(s => s\.person\)\];/);
  // The people up the ownership chain are owners, screened with the date of birth the register gives.
  assert.match(pre, /role: `owner of \$\{p\.foundAt\}`, person: true, owner: true, dobYear: p\.dob\?\.year \|\| null, dobMonth: p\.dob\?\.month \|\| null,/);
  assert.match(read('server/companies-house.ts'), /dob: chainDob\(p\.date_of_birth\)/);
  // Each ComplyAdvantage line says whether a person was screened with a date of birth.
  assert.match(pre, /person: !!subjectOf\(r\.name, i\)\?\.person, dobKnown: !!\(subjectOf\(r\.name, i\)\?\.person && subjectOf\(r\.name, i\)\?\.dobYear\),/);
});

// Woody, 21 November 2026: "comply advantage keeps hitting miss spells of the names and picking up adverse media
// on things not spelt the same but are similar", then "Yes want it". Rules tested in server/kyc-prechecks.test.ts.
test('adverse media (and a company\'s warning lists) under a name spelt differently is set aside, never sanctions or public roles, and the officers still see it', () => {
  const rules = read('shared/kyc-prechecks.ts');
  const fn = rules.slice(rules.indexOf('export function providerSpellingVariant'), rules.indexOf('/** A ComplyAdvantage line'));
  assert.match(fn, /const companyList = !providerLineIsPerson\(line\) && \/warning\|fitness\/\.test\(kind\);/, 'a company\'s warning lists too');
  assert.match(fn, /if \(kind !== "adverse_media" && !companyList\) return false;/, 'never sanctions or public roles');
  assert.match(fn, /if \(m\.birthYearAgrees === true\) return false;/, 'a date of birth that agrees keeps it');
  assert.match(rules, /const variants = all\.filter\(m => providerSpellingVariant\(m, line\)\);/);
  // Set aside, not hidden: the deal card, KYC4U's note and the red flag's facts all list them.
  for (const where of ['export function precheckCardLines', 'export function precheckNote']) {
    const at = rules.indexOf(where);
    const body = rules.slice(at, rules.indexOf('\nexport ', at + where.length));
    assert.ok(body.includes('precheckSpellingVariants('), `${where} lists the spelling variants`);
  }
  assert.match(rules, /label: "Set aside, spelt differently"/);
});
