// The twelve-month PIPnet catch-up (19 November 2026): what must stay true in
// the source. The run itself is tested in server/pipnet-catchup.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the catch-up is an admin\'s, started by a person and only carried on after a deploy', () => {
  const routes = read('server/pipnet-catchup.ts');
  for (const method of ['get', 'post']) {
    assert.match(routes, new RegExp(`router\\.${method}\\("/api/admin/pipnet-catchup", requireAuth, requireAdmin,`), `${method} is admin only`);
  }
  const boot = read('server/index.ts');
  assert.match(boot, /import\("\.\/pipnet-catchup"\)\.then\(m => m\.resumePipnetCatchup\(\)\)/);
  assert.doesNotMatch(boot, /startPipnetCatchup/, 'nothing starts a run at boot or on a timer');
  const resume = routes.slice(routes.indexOf('export async function resumePipnetCatchup('));
  assert.match(resume.slice(0, 400), /if \(state\?\.status !== "running"\) return;/);
});

test('each search is its own PIPnet session, logged off after, taking turns with the daily import', () => {
  const pipnet = read('server/pipnet.ts');
  for (const name of ['importPipnetRequirements', 'importPipnetProperties', 'importPipnetCatchupStep', 'listPipnetTradeTypes']) {
    const line = pipnet.match(new RegExp(`^export const ${name} = .*$`, 'm'))?.[0] ?? '';
    assert.match(line, /oneAtATime\(\(\) => withPipnetSession\(/, `${name} takes its turn in a session of its own`);
  }
  assert.match(read('server/pipnet-catchup.ts'), /\(await pipnet\(\)\)\.importPipnetCatchupStep\(params\)/);
});

test('one trade type per search, listed since a date, to PIPnet\'s cap', () => {
  const pipnet = read('server/pipnet.ts');
  assert.match(pipnet, /if \(params\.tradeType\) body\.set\("tradeTypeListBox", params\.tradeType\);/);
  const step = pipnet.slice(pipnet.indexOf('async function importPipnetCatchupStepInner('));
  assert.match(step.slice(0, 900), /documentDate: params\.since,[\s\S]*maxPages: PIPNET_PAGE_CAP,/);
});

test('each flyer is read by AI once, and what a read costs is logged', () => {
  const pipnet = read('server/pipnet.ts');
  const row = pipnet.slice(pipnet.indexOf('async function importPipnetRow('));
  const reuse = row.indexOf('if (flyerAlreadyRead(');
  assert.ok(reuse > 0 && reuse < row.indexOf('downloadBrochureAsPdf('), 'the stored flyer is checked before any download');
  assert.ok(reuse < row.indexOf('parseRequirementBrochure('), '…and before any AI read');
  assert.match(row, /parseRequirementBrochure\(\{ pdfBuffer: brochurePack\.buffer, feature: "pipnet-flyer" \}\)/);
  const parser = read('server/requirement-vision-parser.ts');
  assert.match(parser, /logAiUsage\(\{ provider: "anthropic", model: "claude-sonnet-4-5", feature: args\.feature \|\| "requirement-flyer"/);
  // The pause reads that spend back.
  assert.match(read('server/pipnet-catchup.ts'), /WHERE feature = 'pipnet-flyer' AND at >= \$1::timestamptz/);
});

test('the admin card is on the requirements board\'s Sync tools, for admins', () => {
  const page = read('client/src/pages/requirements.tsx');
  assert.match(page, /\{reqUser\?\.isAdmin && \(\s*<DropdownMenuItem onClick=\{\(\) => setCatchupOpen\(true\)\} data-testid="button-pipnet-catchup">PIPnet, last 12 months<\/DropdownMenuItem>/);
});
