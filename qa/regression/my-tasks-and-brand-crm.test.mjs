// Woody, 16 November 2026, "1 and 2 yes": (1) the Brand CRM is Targets only
// for BGP staff, its Diary and Strategies and events being the CRM page's own
// views; (2) My Tasks shows what the Landsec Tasks page shows. Cut from the
// source so a change that undoes either shows here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { crmEngagementLink } from '../../shared/landlord-engagement-view.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');

const TAB = 'client/src/components/brand-crm/brand-crm-tab.tsx';
const TASKS = 'client/src/pages/tasks.tsx';

test('staff Brand CRM: Targets only; Landsec keeps Targets and Diary', () => {
  const views = find(TAB, node => ts.isVariableStatement(node) && node.getText().startsWith('const VIEWS'));
  assert.match(views, /\{ key: "targets", label: "Targets" \}/);
  assert.match(views, /\{ key: "diary", label: "Diary", clientOnly: true \}/);
  assert.ok(!views.includes('strategies'));
  const tab = source(TAB);
  assert.match(tab, /const views = VIEWS\.filter\(view => !staff \|\| !view\.clientOnly\);/);
  assert.match(tab, /\{view === "diary" && !staff && <Diary staff=\{staff\} \/>\}/);
  assert.ok(!tab.includes('CrmEngagementPanel'), 'no Strategies and events view in the Brand CRM');
});

test('old staff links to the Brand CRM diary or strategies go to the CRM page with what they named', () => {
  const { brandCrmMovedHref } = evaluate(find(TAB, node => ts.isFunctionDeclaration(node) && node.name?.text === 'brandCrmMovedHref'), { URLSearchParams });
  const go = query => { const p = new URLSearchParams(query); return brandCrmMovedHref(p.get('view'), p); };
  assert.equal(go('tab=crm&view=diary'), '/contacts?tab=diary');
  assert.equal(go('tab=crm&view=strategies&company=b1&action=a1'), '/contacts?tab=overview&company=b1&action=a1');
  assert.equal(go('tab=crm&view=strategies&strategy=s1&event=e1'), '/contacts?tab=overview&event=e1&strategy=s1');
  assert.equal(go('tab=crm&view=targets'), null);
  assert.equal(go('tab=crm'), null);
});

test('every company\'s plan opens on the CRM page, a brand\'s included', () => {
  assert.equal(crmEngagementLink('brand-1', { action: 'a1' }), '/contacts?tab=overview&company=brand-1&action=a1');
  assert.ok(!source('shared/landlord-engagement-view.ts').includes('/brands?'));
  // The joined Overview shows a brand action's scheme and sharing, with its change button.
  assert.match(source('client/src/components/crm-engagement/overview.tsx'), /kind === "brand" \|\| \(kind === "all" && \(nounOf\.get\(editor\.record\.companyId\) === "brand"/);
});

test('My Tasks: Waiting on you first, each task once, with counts', () => {
  const page = source(TASKS);
  assert.match(page, /const waitingTasks = activeTasks\.filter\(t => !t\.parent_task_id && dealIsWaitingOn\(t\)\)\.sort\(\(a, b\) => \(b\.waitingDays \?\? -1\) - \(a\.waitingDays \?\? -1\)\);/);
  assert.match(page, /const overdueTasks = activeTasks\.filter\(t => !waitingIds\.has\(t\.id\) &&/);
  assert.match(page, /!overdueIds\.has\(t\.id\) && !waitingIds\.has\(t\.id\)/);
  assert.match(page, /data-testid="tasks-waiting-on-you"/);
  assert.match(page, /<PillCount n=\{statusCount\(f\)\} active=\{filter === f\} \/>/);
  assert.match(page, /with a deal waiting on \$\{viewAssigned \? "them" : "you"\}/);
});

test('My Tasks: checklist rows, instant ticks, a real error and a phone-sized tick', () => {
  const page = source(TASKS);
  assert.match(page, /data-testid=\{`task-open-checklist-\$\{task\.id\}`\}/);
  assert.match(page, /checklistLinkPath\("tracker", task\.unit_id\)/);
  assert.match(page, /\{stage\} stage/);
  assert.match(page, /filter\(line => !\/\^Deal checklist, \/i\.test\(line\.trim\(\)\)\)/);
  // Shown at once, put back on failure, then the checklist and deal clock read again.
  assert.match(page, /onMutate: async v => \{\s*await queryClient\.cancelQueries\(\{ queryKey: tasksKey \}\);/);
  assert.match(page, /if \(ctx\?\.before\) queryClient\.setQueryData\(tasksKey, ctx\.before\);/);
  assert.match(page, /k\.startsWith\("\/api\/deal-checklists"\) \|\| k\.startsWith\("\/api\/landsec\/deal"\)/);
  // A failed load is never "All clear!".
  assert.match(page, /const loadFailed = tasksFailed && !tasksData;/);
  assert.ok(page.indexOf('loadFailed ? (') > 0 && page.indexOf('loadFailed ? (') < page.indexOf('>All clear!<'));
  // The 20px circle in a 40px button, kept out of the phone's 44px rule.
  assert.match(page, /data-no-min-touch\s+onClick=\{onToggle\}/);
  assert.match(page, /-m-2\.5 flex h-10 w-10 flex-shrink-0/);
});
