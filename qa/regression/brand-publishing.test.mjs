import test from 'node:test';
import assert from 'node:assert/strict';
import { getBrandIdentity } from '../../server/brand-identity.ts';
import { isOfficialBrandWebsite, brandImageIdentityTag, publishableBrandImage, publishableBrandStore, prepareBrandIdentityUpdate } from '../../server/brand-publishing.ts';

const company = { id:'brand-1', name:'COOK', domain:'cookfood.net', domain_url:'https://www.cookfood.net',
  ai_generated_fields:{brand_identity:{status:'verified',domain:'cookfood.net',aliases:['COOK Trading Ltd'],country:'GB'}} };

test('official store website must be the confirmed domain or its subdomain', () => {
  assert.equal(isOfficialBrandWebsite(company, 'https://www.cookfood.net/shops'), true);
  assert.equal(isOfficialBrandWebsite(company, 'https://shops.cookfood.net/'), true);
  for (const website of ['https://cook.com','https://cookfood.net.example.com','https://fakecookfood.net','https://cookfood.net@evil.example','javascript:alert(1)',null]) {
    assert.equal(isOfficialBrandWebsite(company, website), false);
  }
  assert.equal(isOfficialBrandWebsite({...company,ai_generated_fields:{}},'https://cookfood.net'),false);
});

test('old name-matched pictures and pictures from another company cannot reappear', () => {
  assert.equal(publishableBrandImage(company,{company_id:null,brand_name:'COOK',tags:['brand-auto','places']}),false);
  assert.equal(publishableBrandImage(company,{company_id:'brand-2',brand_name:'COOK',tags:[]}),false);
  assert.equal(publishableBrandImage(company,{company_id:company.id,tags:['brand-auto','places']}),false);
  assert.equal(publishableBrandImage(company,{company_id:company.id,tags:['brand-auto',brandImageIdentityTag(company)]}),true);
  assert.equal(publishableBrandImage(company,{company_id:company.id,tags:['brand-auto',brandImageIdentityTag(company),'identity-review']}),false);
});

test('manual photos and explicitly pinned company photos remain available', () => {
  assert.equal(publishableBrandImage(company,{company_id:company.id,tags:[]}),true);
  assert.equal(publishableBrandImage(company,{company_id:null,brand_name:'cook',tags:[]}),true);
  assert.equal(publishableBrandImage(company,{company_id:company.id,tags:['brand-auto','brand-hero']}),true);
});

test('automatic logo and website caches need the current identity too', () => {
  for (const tag of ['logo-dev-cache','website-refresh','bulk-import']) {
    assert.equal(publishableBrandImage(company,{company_id:company.id,tags:['brand-logo',tag]}),false);
    assert.equal(publishableBrandImage(company,{company_id:company.id,tags:[tag,brandImageIdentityTag(company)]}),true);
  }
});

test('only current website-verified automatic stores are mapped; manual records survive', () => {
  const verified={source_type:'google_places_verified',notes:JSON.stringify({brandIdentity:{fingerprint:getBrandIdentity(company).fingerprint,website:'https://cookfood.net/shops'}})};
  assert.equal(publishableBrandStore(company,verified),true);
  assert.equal(publishableBrandStore(company,{...verified,source_type:'google_places'}),false);
  assert.equal(publishableBrandStore(company,{...verified,source_type:'identity_review'}),false);
  assert.equal(publishableBrandStore({...company,name:'A different business'},verified),false);
  assert.equal(publishableBrandStore(company,{source_type:'google_places_verified',notes:'human note'}),false);
  assert.equal(publishableBrandStore(company,{source_type:'manual',notes:'agreed with owner'}),true);
});

test('identity correction clears marked guesses and old narratives while preserving human facts', () => {
  const old={...company,domain:'cook.com',domain_url:'https://cook.com',description:'Human description',industry:'Construction',store_count:100,
    brand_analysis:{bad:true},menu_intel:{bad:true},last_enriched_at:'2026-09-01',
    ai_generated_fields:{industry:{source:'ai'},backers_detail:[{name:'Wrong business investor'}],brand_identity:{status:'verified',domain:'cook.com'}}};
  const result=prepareBrandIdentityUpdate(old,{domain:'https://www.cookfood.net/shops',aliases:['COOK Trading Ltd'],country:'GB'},'user-1',new Date('2026-09-10T10:00:00Z'));
  assert.equal(result.identityChanged,true);
  assert.equal(result.fields.domain,'cookfood.net'); assert.equal(result.fields.domain_url,'https://cookfood.net');
  assert.equal(result.fields.industry,null); assert.equal(result.fields.brand_analysis,null); assert.equal(result.fields.menu_intel,null);
  assert.equal(Object.hasOwn(result.fields,'description'),false); assert.equal(Object.hasOwn(result.fields,'store_count'),false);
  assert.equal(result.fields.ai_generated_fields.brand_identity.verifiedBy,'user-1');
  assert.equal(result.fields.ai_generated_fields.brand_identity.previousFactsNeedReview,true);
  assert.equal(result.fields.ai_generated_fields.backers_detail,undefined);
  assert.equal(old.industry,'Construction');
});

test('reconfirming the same identity does not repeatedly clear prepared facts', () => {
  const result=prepareBrandIdentityUpdate(company,{domain:'www.cookfood.net'},'user-2');
  assert.equal(result.identityChanged,false);
  assert.equal(Object.hasOwn(result.fields,'brand_analysis'),false);
});

test('confirmation reconciles all website columns and retains unresolved fact review', () => {
  const old = {...company,website:'https://cook.com'};
  const result=prepareBrandIdentityUpdate(old,{domain:'cookfood.net'},'user-1');
  assert.equal(getBrandIdentity({...old,...result.fields}).status,'verified');
  assert.equal(result.fields.website,'https://cookfood.net');
  const reconfirmed=prepareBrandIdentityUpdate({...old,...result.fields},{domain:'cookfood.net'},'user-1');
  assert.equal(reconfirmed.fields.ai_generated_fields.brand_identity.previousFactsNeedReview,true);
});

test('identity input rejects invalid domains and ambiguous alias shapes', () => {
  for (const domain of ['', 'localhost','https://user:secret@cookfood.net','https://cookfood.net:8080']) assert.throws(()=>prepareBrandIdentityUpdate(company,{domain},'user-1'));
  assert.throws(()=>prepareBrandIdentityUpdate(company,{domain:'cookfood.net',aliases:'anything'},'user-1'));
  assert.throws(()=>prepareBrandIdentityUpdate(company,{domain:'cookfood.net',aliases:['']},'user-1'));
});
