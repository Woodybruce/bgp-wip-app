import assert from 'node:assert/strict';
import test from 'node:test';
import { landlordBriefFromRecords } from '../../server/brand-brief-evidence.ts';

const evidence = () => ({ name: 'Hammerson', landlord: true,
  recorded_properties: [
    { id: 'p1', name: 'Bullring', status: 'Owned' }, { id: 'p2', name: 'Brent Cross' },
    { id: 'p3', name: 'Cabot Circus' }, { id: 'p4', name: 'Victoria Gate' },
  ],
  activity: {
    deals: [{ name: 'Historic disposal', status: 'Completed', type: 'INV' }, { name: 'Historic instruction', status: 'Closed', type: 'SOL' }],
    contacts: [{ name: 'Recorded contact', role: 'CEO' }, { name: 'Other contact', role: 'Director' }],
  },
});

test('landlord brief states linked-record counts and named properties without implying mandates or confirmed decision-makers', () => {
  const text = landlordBriefFromRecords(evidence());
  assert.equal(text.split('\n').length, 4);
  assert.match(text, /Hammerson — linked CRM records/);
  assert.match(text, /4 linked CRM properties shown, including Bullring, Brent Cross, Cabot Circus/);
  assert.doesNotMatch(text, /Victoria Gate/);
  assert.match(text, /2 most recently updated deal records shown/);
  assert.match(text, /2 listed CRM contacts included/);
  assert.match(text, /Review the latest deal stages with the BGP team/);
  assert.doesNotMatch(text, /confirmed decision-makers|active leasing momentum|live mandates|expansion strategy|CEO|Director/i);
});

test('property, deal and contact samples are bounded and cannot become portfolio or open-deal totals', () => {
  const text = landlordBriefFromRecords({ name: 'Landlord',
    recorded_properties: Array.from({ length: 45 }, (_, i) => ({ id: `p${i}`, name: `Property ${i}` })),
    activity: { deals: Array.from({ length: 22 }, (_, i) => ({ name: `Deal ${i}`, status: 'Completed' })),
      contacts: Array.from({ length: 28 }, (_, i) => ({ name: `Contact ${i}` })) },
  });
  assert.match(text, /30 linked CRM properties shown \(up to 30\)/);
  assert.match(text, /10 most recently updated deal records shown/);
  assert.match(text, /12 listed CRM contacts included/);
  assert.doesNotMatch(text, /45|22|28|Property 3(?:,|;|\.)/);
});

test('bogus activity counts, future timestamps and reused AI interpretations cannot alter the factual landlord brief', () => {
  const baseline = evidence();
  const augmented = { ...baseline, profile_context: { description: 'Aggressive expansion; immediate action required' },
    employee_count: 50000, store_count: 90000, rollout_status: 'scaling', evidence_checked_at: '2099-01-01',
    activity: { ...baseline.activity, interactions_90d: 99999, interactions_total: 88888,
      days_since_last_touch: -9000, last_at: '2099-01-01', last_touchpoint: '2099-01-01',
      confirmed_decision_makers: 77777, active_leasing_deals: 66666, lead_broker: 'Invented urgent mandate',
      deals: baseline.activity.deals.map(row => ({ ...row, updated_at: '2099-01-01', created_at: '2099-01-01' })),
    },
  };
  assert.equal(landlordBriefFromRecords(augmented), landlordBriefFromRecords(baseline));
  assert.doesNotMatch(landlordBriefFromRecords(augmented), /99999|88888|77777|66666|2099|urgency|momentum|expansion|immediate|financial/i);
});

test('missing records produce honest empty sample language and a useful next action without a profile-approval demand', () => {
  const text = landlordBriefFromRecords({ name: 'Hammerson', recorded_properties: null, activity: null });
  assert.match(text, /No properties linked in this CRM summary/);
  assert.match(text, /No deal records in this summary; no CRM contacts in this summary/);
  assert.match(text, /Next step/);
  assert.doesNotMatch(text, /approve|verify profile|manual review|strategy is unconfirmed|confirm.*requirement|weak|distress/i);
  assert.equal(text.split('\n').length, 4);
});

test('landlord correction invalidates its old brief without invalidating prepared tenant briefs', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { find, evaluate, ts } = require('./source-harness.cjs');
  const { getBrandIdentity } = await import('../../server/brand-identity.ts');
  const { currentOfficialProfileEvidence } = await import('../../server/brand-profile-evidence.ts');
  const { BRAND_BRIEF_POLICY_VERSION } = await import('../../server/brand-brief-evidence.ts');
  const company={id:'test',name:'Test',company_type:'Tenant - Retail',domain:'example.com',ai_generated_fields:{brand_identity:{status:'verified',domain:'example.com'}}};
  const saved={text:'Prepared tenant brief',policyVersion:BRAND_BRIEF_POLICY_VERSION,fingerprint:getBrandIdentity(company).fingerprint,generatedAt:100,expiresAt:Date.now()+10000};
  const code=find('server/brand-ai-take.ts',n=>ts.isFunctionDeclaration(n)&&n.name?.text==='readPreparedBrandAiTake');
  const {readPreparedBrandAiTake}=evaluate(code,{getBrandIdentity,currentOfficialProfileEvidence,BRAND_BRIEF_POLICY_VERSION,takeKey:()=>'',pool:{query:async sql=>({rows:sql.includes('crm_companies')?[company]:[{value:saved}]})}});
  assert.equal((await readPreparedBrandAiTake('test','brand')).text,saved.text);
  company.company_type='Landlord';
  assert.equal((await readPreparedBrandAiTake('test','brand')).text,'');
  saved.policyVersion+=':landlord-records-1';saved.text='Factual landlord brief';
  assert.equal((await readPreparedBrandAiTake('test','brand')).text,saved.text);
});

test('actual landlord preparation replaces the old brief with deterministic CRM evidence and saves its landlord-only policy', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { find, evaluate, ts } = require('./source-harness.cjs');
  const { getBrandIdentity } = await import('../../server/brand-identity.ts');
  const { BRAND_BRIEF_POLICY_VERSION } = await import('../../server/brand-brief-evidence.ts');
  const company = { id: 'hammerson', name: 'Hammerson', company_type: 'Landlord', domain: 'hammerson.com', brief_revision: 'same-revision',
    ai_generated_fields: { brand_identity: { status: 'verified', domain: 'hammerson.com' } } };
  const records = evidence(), writes = [], transactions = [];
  let helperCalls = 0, modelCalls = 0, released = 0;
  const old = { text: 'Confirmed decision-makers and active leasing momentum', policyVersion: BRAND_BRIEF_POLICY_VERSION,
    fingerprint: getBrandIdentity(company).fingerprint, dataHash: 'same-data', expiresAt: Date.now() + 10000 };
  const code = find('server/brand-ai-take.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'prepareBrandAiTake');
  const { prepareBrandAiTake } = evaluate(code, {
    getBrandIdentity, BRAND_BRIEF_POLICY_VERSION, CACHE_TTL_MS: 7 * 86400000,
    takeKey: () => 'brand-prepared-take:hammerson:brand', dataHash: () => 'same-data',
    loadBrandSlice: async () => records, landlordPrompt: () => 'Unused model prompt',
    landlordBriefFromRecords: slice => { helperCalls++; assert.equal(slice, records); return landlordBriefFromRecords(slice); },
    callClaude: async () => { modelCalls++; throw new Error('Landlord record summaries must not call a model'); },
    pool: {
      query: async sql => ({ rows: sql.includes('crm_companies') ? [company] : [{ value: old }] }),
      connect: async () => ({
        query: async (sql, values) => {
          transactions.push(sql);
          if (sql.startsWith('SELECT')) return { rows: [company] };
          if (sql.includes('INSERT')) writes.push(JSON.parse(values[1]));
          return { rowCount: 1 };
        }, release() { released++; },
      }),
    },
  });
  const result = await prepareBrandAiTake('hammerson', 'brand');
  assert.equal(helperCalls, 1); assert.equal(modelCalls, 0);
  assert.equal(result.cached, false); assert.equal(result.text, landlordBriefFromRecords(records));
  assert.equal(writes.length, 1); assert.equal(writes[0].text, result.text);
  assert.equal(writes[0].policyVersion, `${BRAND_BRIEF_POLICY_VERSION}:landlord-records-1`);
  assert.equal(writes[0].fingerprint, getBrandIdentity(company).fingerprint);
  assert.equal(transactions.at(-1), 'COMMIT'); assert.equal(released, 1);
});
