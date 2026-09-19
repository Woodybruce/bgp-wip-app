import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { getBrandIdentity } from '../../server/brand-identity.ts';
import { currentOfficialProfileEvidence, prepareOfficialProfileEvidence, retainedProfileFactsCorroborated } from '../../server/brand-profile-evidence.ts';
import { brandActionEvidence } from '../../server/brand-brief-evidence.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const company = () => ({ id:'landlord',name:'Synthetic Landlord',domain:'landlord.example',description:'Saved description',industry:'Real estate',
  ai_generated_fields:{brand_identity:{status:'verified',domain:'landlord.example',previousFactsNeedReview:true}} });
const pages = [{url:'https://landlord.example/about',text:'Synthetic Landlord owns and manages retail properties across the UK.'}];
const output = () => ({official_profile:{description:'A retail property owner.',industry:'Real estate',url:pages[0].url,quote:pages[0].text}});

test('official profile requires a quote from the fetched page, known source and verified identity', () => {
  assert.ok(prepareOfficialProfileEvidence(company(), output(), pages));
  assert.equal(prepareOfficialProfileEvidence(company(), {...output(),official_profile:{...output().official_profile,quote:'Invented statement about portfolio performance.'}},pages),null);
  assert.equal(prepareOfficialProfileEvidence(company(), {...output(),official_profile:{...output().official_profile,url:'https://unrelated.example'}},pages),null);
  assert.equal(prepareOfficialProfileEvidence({...company(),domain:'wrong.example'},output(),pages),null);
});

test('old, malformed or changed-identity official evidence cannot unblock a brief', () => {
  const c=company(); c.ai_generated_fields.official_profile=prepareOfficialProfileEvidence(c,output(),pages);
  assert.ok(currentOfficialProfileEvidence(c));
  c.ai_generated_fields.official_profile.checkedAt='2020-01-01'; assert.equal(currentOfficialProfileEvidence(c),null);
  c.ai_generated_fields.official_profile.checkedAt='bad-date'; assert.equal(currentOfficialProfileEvidence(c),null);
  c.ai_generated_fields.official_profile.checkedAt=new Date().toISOString(); c.domain='different.example'; assert.equal(currentOfficialProfileEvidence(c),null);
});

test('retained facts need separate corroboration; new description alone does not certify an old address', () => {
  const c={...company(),head_office_address:{city:'Beijing'}};
  const check={supported:true,url:pages[0].url,quote:pages[0].text};
  const out={retained_fact_checks:{description:check,industry:check}};
  assert.equal(retainedProfileFactsCorroborated(c,out,pages),false);
  delete c.head_office_address;
  assert.equal(retainedProfileFactsCorroborated(c,out,pages),true);
  out.retained_fact_checks.industry={...check,supported:false};
  assert.equal(retainedProfileFactsCorroborated(c,out,pages),false);
});

test('a freshly sourced profile lets the brief ignore unreviewed legacy facts without changing them', () => {
  const c=company();c.description='Wrong construction company';c.industry='Construction';
  assert.equal(brandActionEvidence(c,[],[]).profile_context.description,null);
  c.ai_generated_fields.official_profile=prepareOfficialProfileEvidence(c,output(),pages);
  const evidence=brandActionEvidence(c,[],[]);
  assert.equal(evidence.profile_context.description,'A retail property owner.');
  assert.equal(evidence.profile_context.source,pages[0].url);
  assert.equal(c.description,'Wrong construction company');
  assert.equal(c.ai_generated_fields.brand_identity.previousFactsNeedReview,true);
});

test('actual enrichment saves sourced profile and auto review without overwriting human-maintained fields', async () => {
  const c={...company(),enrichment_revision:'revision'};let written;
  const check={supported:true,url:pages[0].url,quote:pages[0].text};
  const aiOut={...output(),description:'AI replacement',industry:'AI sector',retained_fact_checks:{description:check,industry:check}};
  const code=find('server/brand-enrichment.ts',n=>ts.isFunctionDeclaration(n)&&n.name?.text==='enrichCompany');
  const {enrichCompany}=evaluate(code+'\nexports.enrichCompany=enrichCompany;',{
    getBrandIdentity,process:{env:{ANTHROPIC_API_KEY:'test'}},ENRICHABLE_FIELDS:['description','industry'],ROLLOUT_VALUES:[],
    MODEL_PRIMARY:'test',MODEL_FALLBACK_1:'test',MODEL_FALLBACK_2:'test',fetchBrandWebContext:async()=>'',buildPrompt:()=>'',
    readBrandOfficialEvidence:async()=>pages,prepareOfficialProfileEvidence,retainedProfileFactsCorroborated,
    anthropic:{messages:{create:async()=>({content:[{type:'text',text:JSON.stringify(aiOut)}]})}},
    pool:{query:async(sql,values)=>{if(sql.startsWith('SELECT'))return{rows:[c]};written={sql,values};return{rowCount:1};}},
  });
  const result=await enrichCompany(c.id);assert.equal(result.reason,undefined);
  assert.doesNotMatch(written.sql,/\bdescription =|\bindustry =/);
  const metadata=JSON.parse(written.values[0]);
  assert.equal(metadata.official_profile.description,'A retail property owner.');
  assert.equal(metadata.brand_identity.previousFactsNeedReview,false);
  assert.equal(metadata.brand_identity.factReview.actor,'official-website-ai-review');
  assert.equal(c.ai_generated_fields.brand_identity.previousFactsNeedReview,true);
  assert.equal(written.values.at(-1),'revision');
});
