// Exercise actual evidence SELECTs against copies of the existing QA schema.
// No public rows, providers or production credentials are used.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import pg from 'pg';
import { brandActionEvidence, brandBriefWithoutEvidence, brandLegalEvidenceContext } from '../../server/brand-brief-evidence.ts';
import { requirementReason, requirementStateSql, requirementClientVisibleSql, requirementLiveColumnsSql } from '../../shared/requirement-live.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const supplied = process.env.BRAND_BRIEF_DATABASE_URL;
const url = new URL(supplied || 'file:///');
if (url.hostname || url.pathname !== '/bgp_smoke' || url.searchParams.get('host') !== '/tmp/bgp-propertyqa-20260916/socket' || url.searchParams.get('port') !== '55446') throw new Error('Disposable local QA database required');
const schema = `qa_brand_brief_${process.pid}_${Date.now()}`;
const db = new pg.Pool({ connectionString: supplied, ssl: false, options: `-c search_path=${schema}` });
const fn = name => find('server/brand-ai-take.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const { loadBrandSlice, loadUkSlice } = evaluate(fn('marketListings') + '\n' + fn('loadBrandSlice') + '\n' + fn('loadUkSlice') + '\nexports.loadBrandSlice=loadBrandSlice;exports.loadUkSlice=loadUkSlice;', {
  pool: db, brandActionEvidence, brandLegalEvidenceContext,
  requirementReason, requirementStateSql, requirementClientVisibleSql, requirementLiveColumnsSql,
  bgpDealEvidence: deal => ({ property: deal.name }), relationshipEvidence: async () => null,
});
let checks = 0;
const check = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`); };
try {
  await db.query(`CREATE SCHEMA ${schema}`);
  for (const table of ['crm_companies', 'crm_requirements_leasing', 'brand_signals', 'turnover_data', 'covenant_reports']) {
    await db.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS)`);
  }
  await db.query(`INSERT INTO crm_companies(id,name,domain,domain_url,description,industry,employee_count,store_count,uk_entity_name,companies_house_number,companies_house_data,ai_generated_fields)
    VALUES ('synthetic-cook','COOK','cookfood.net','https://cookfood.net','Synthetic ready-meal retailer','Food retail',900,90,'COOK Trading Ltd','04611064',$1,$2)`,
    [JSON.stringify({ profile: { companyName: 'COOK TRADING LIMITED', companyNumber: '04611064' } }), JSON.stringify({ brand_identity: { status: 'verified', domain: 'cookfood.net', aliases: ['COOK Trading Ltd'] } })]);
  await db.query(`INSERT INTO crm_requirements_leasing(id,name,company_id,status,"use",size,requirement_locations,requirement_date,sources,origin,last_listed_at)
    VALUES ('active','Synthetic Bristol requirement','synthetic-cook',' active ',ARRAY['Retail'],ARRAY['1000 sq ft'],ARRAY['Bristol'],'2026-09-17',ARRAY['Manual'],NULL,NULL),
      ('listed','Synthetic Leeds listing','synthetic-cook','Active',ARRAY['Retail'],ARRAY['1500 sq ft'],ARRAY['Leeds'],NULL,ARRAY['PIPnet'],'pipnet','2026-09-03'),
      ('closed','Old requirement','synthetic-cook','Closed',NULL,NULL,NULL,NULL,ARRAY['PIPnet'],'pipnet',NULL),
      ('other','Other brand requirement','other-brand','Active',NULL,NULL,NULL,NULL,ARRAY['PIPnet'],'pipnet',NULL)`);
  await db.query(`INSERT INTO brand_signals(id,brand_company_id,signal_type,headline,source,signal_date,confidence,ai_relevant)
    VALUES ('valid','synthetic-cook','opening','COOK frozen ready-meal retailer opens a shop','https://cookfood.net/synthetic-test',now()-interval '1 day','reported',true),
      ('collision','synthetic-cook','opening','Cook Islands resort opening boosts tourism','https://travel.example/cook-islands',now()-interval '1 day','reported',true),
      ('old','synthetic-cook','opening','Old event','manual',now()-interval '2 years','confirmed',true),
      ('future','synthetic-cook','opening','Future event','manual',now()+interval '2 years','reported',true),
      ('staff','synthetic-cook','requirement','Staff recorded requirement','bgp-deal:synthetic',now()-interval '1 day','confirmed',true)`);
  // The take is read by client logins too: only this company's open PIPnet listings reach it, never BGP's own rows.
  await check('actual requirements query uses existing columns and gives this company\'s open market listings only', async () => {
    const slice = await loadBrandSlice('synthetic-cook');
    assert.equal(slice.active_requirements.length, 0);
    assert.deepEqual(slice.market_listings.map(row => row.name), ['Synthetic Leeds listing']);
    assert.deepEqual(slice.market_listings[0].locations, ['Leeds']); assert.deepEqual(slice.market_listings[0].sizes, ['1500 sq ft']);
    assert.match(slice.market_listings[0].listing, /^PIPnet listing from Sep/);
    assert.doesNotMatch(JSON.stringify(slice), /employee_count|store_count|900|Bristol/);
  });
  await check('actual signal query excludes stale/future events and wrong-identity news while retaining staff evidence', async () => {
    const slice = await loadBrandSlice('synthetic-cook');
    assert.deepEqual(slice.recent_site_events.map(row => row.id).sort(), ['staff', 'valid']);
  });
  await check('actual UK slice reads legal and covenant columns without fabricating missing flags', async () => {
    const slice = await loadUkSlice('synthetic-cook');
    assert.equal(slice.legal_entity_context.needs_review, false); assert.equal(slice.covenant, null);
    assert.equal(slice.accounts_overdue, null); assert.equal(slice.insolvency_history, null);
  });
  await check('wrong linked legal entity is withheld without rewriting its stored record', async () => {
    await db.query("UPDATE crm_companies SET uk_entity_name='Wrong Legacy Entity' WHERE id='synthetic-cook'");
    const slice = await loadUkSlice('synthetic-cook');
    assert.equal(slice.legal_entity_context.needs_review, true); assert.equal(slice.covenant, null);
    assert.equal((await db.query("SELECT uk_entity_name FROM crm_companies WHERE id='synthetic-cook'")).rows[0].uk_entity_name, 'Wrong Legacy Entity');
  });
  await check('counts plus a Cook Islands collision alone produce an honest unknown-strategy brief', async () => {
    await db.query("DELETE FROM crm_requirements_leasing; DELETE FROM brand_signals WHERE id <> 'collision'");
    const slice = await loadBrandSlice('synthetic-cook');
    assert.match(brandBriefWithoutEvidence(slice), /strategy is unconfirmed/);
  });
  console.log(`PASS ${checks} PostgreSQL brand brief evidence checks`);
} finally { try { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await db.end(); } }
