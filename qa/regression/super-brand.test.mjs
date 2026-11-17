import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Super Brands are BGP's own starred choice of expansion targets, VIP in the
// CRM (Woody, 17 November 2026: "super brand lets have those as VIP CRM brands
// ... prime targets for expansion via our choice ... they get the CRM VIP
// treatment and massive focus"; the card had listed the Luxury types, which
// put Beaverbrooks there). The star is the brand's hunter_flag.
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const crm = read('server/crm.ts');
const profile = read('server/brand-profile.ts');
const watch = read('server/crm-watch.ts');
const watchList = read('server/crm-watch-list.ts');
const hub = read('server/crm-hub.ts');
const plan = read('server/brand-scheme-plan.ts');

test('the Super Brands card lists the starred brands, not a set of brand types', () => {
  const hubRoute = crm.slice(crm.indexOf('const superRows'), crm.indexOf('// Top turnover'));
  assert.match(hubRoute, /WHERE c\.hunter_flag IS TRUE AND c\.company_type ILIKE 'tenant%'/);
  assert.doesNotMatch(hubRoute, /Tenant - Luxury/);
  assert.match(hubRoute, /clientScoped \? \[\]/);
});

test('only BGP staff signed in as themselves set the star; a client brand save never does', () => {
  for (const route of ['"/api/brands/:id/super-brand"', '"/api/brands/:id/hunter-flag"']) {
    const at = crm.indexOf(route);
    assert.ok(at > 0, route);
    assert.match(crm.slice(at, at + 500), /\(await contactViewer\(req\)\)\.staff\) return res\.status\(403\)/, route);
  }
  const set = crm.slice(crm.indexOf('"/api/brands/:id/super-brand"'), crm.indexOf('"/api/brands/:id/hunter-flag"'));
  assert.match(set, /typeof req\.body\?\.on !== "boolean"/);
  const patch = profile.slice(profile.indexOf('router.patch("/api/brand/:companyId"'), profile.indexOf('router.post("/api/brand/:companyId/identity"'));
  assert.match(patch, /delete req\.body\.hunter_flag; delete req\.body\.hunterFlag;/);
});

test('a Super Brand is watched as closely as a company on a running strategy', () => {
  assert.match(watch, /export const watchedSql = \(alias: string\) => `\(\$\{onStrategySql\(alias\)\} OR COALESCE\(\$\{alias\}\.hunter_flag, false\)\)`/);
  for (const file of ['server/brand-pipeline.ts', 'server/brand-store-count.ts', 'server/expansion-intel.ts', 'server/accounts-plans.ts']) {
    const source = read(file);
    assert.match(source, /watchedSql\("c"\)/, file);
    assert.doesNotMatch(source, /onStrategySql\("c"\)/, file);
  }
});

test('the Watch list holds every Super Brand, owing "No strategy yet" until one starts', () => {
  assert.match(watchList, /AND \(s\.id IS NOT NULL OR \(c\.hunter_flag IS TRUE AND c\.company_type ILIKE 'tenant%' AND c\.archived_at IS NULL\)\)/);
  assert.match(watchList, /if \(superBrand && !strategies\.length\) owed\.push\("No strategy yet"\);/);
});

test('Super Brands lead the CRM Brands list and, for BGP staff, the Brand CRM Targets board', () => {
  assert.match(hub, /if \(brand\) rows\.sort\(\(a, b\) => Number\(!!b\.superBrand\) - Number\(!!a\.superBrand\)\);/);
  assert.match(plan, /UNION SELECT c\.id FROM crm_companies c WHERE c\.hunter_flag IS TRUE AND c\.company_type ILIKE 'tenant%'/);
  assert.match(plan, /if \(staff\) out\.sort\(\(a, b\) => Number\(!!b\.superBrand\) - Number\(!!a\.superBrand\)\);/);
  // The star on the board is BGP's: it is set inside the staff block only.
  const staffBlock = plan.slice(plan.indexOf('entry.onHold = isOnHold'), plan.indexOf('out.push(entry);'));
  assert.match(staffBlock, /if \(b\.hunter_flag === true\) entry\.superBrand = true;/);
});

test('the brand page gives BGP staff the star, and a starred brand on no strategy its Start strategy', () => {
  const panel = read('client/src/components/brand-profile-panel.tsx');
  assert.match(panel, /\{staffPlan && <SuperBrandStar companyId=\{companyId\} companyName=\{c\.name\} on=\{!!c\.hunter_flag\} \/>\}/);
  assert.match(panel, /\{staffPlan && c\.hunter_flag && <CompanyStartStrategy companyId=\{companyId\} companyName=\{c\.name\} variant="outline" \/>\}/);
  assert.match(panel, /\{c\.hunter_flag && !staffPlan && <SuperBrandBadge \/>\}/);
  const star = read('client/src/components/brand-page/super-brand-star.tsx');
  assert.match(star, /apiRequest\("POST", `\/api\/brands\/\$\{encodeURIComponent\(companyId\)\}\/super-brand`, \{ on \}\)/);
  assert.match(star, /if \(onStrategy === false\) setKickoff\(true\);/);
  // The old wording is gone from the screens.
  for (const file of ['client/src/components/brand-profile-panel.tsx', 'client/src/components/brand-hunter-board.tsx', 'client/src/pages/brands-hub.tsx']) {
    assert.doesNotMatch(read(file), /Hunter Pick|Hunter pick|Hunter-flagged/, file);
  }
});
