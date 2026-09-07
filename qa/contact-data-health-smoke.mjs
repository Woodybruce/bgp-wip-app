// Authenticated local app checks; all writes use disposable synthetic fixture IDs.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import pg from 'pg';
import { chromium, devices } from '../node_modules/playwright/index.mjs';

const BASE = new URL(process.env.SMOKE_BASE || 'https://127.0.0.1:5446');
if (!['localhost','127.0.0.1','[::1]'].includes(BASE.hostname) || BASE.username || BASE.password) throw new Error('Local app required');
const supplied = process.env.CRM_SMOKE_DATABASE_URL;
const url = new URL(supplied || 'http://invalid');
if (url.hostname || url.pathname !== '/bgp_smoke' || !/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(url.searchParams.get('host') || '')) throw new Error('Disposable smoke Unix socket required');
const db = new pg.Client({ connectionString:supplied, ssl:false });
const OUTPUT = resolve(process.env.UX_OUTPUT || 'qa/smoke-shots/contact-data-health');
mkdirSync(OUTPUT, { recursive:true });
const smoke = readFileSync(new URL('./smoke.mjs',import.meta.url),'utf8');
const fixture = name => smoke.match(new RegExp(`const ${name} = '([^']+)'`))[1];
const id = n => `ed00ed00-0907-4000-8000-${String(n).padStart(12,'0')}`;
const companies = [id(1),id(2),id(3)];
const allContacts = [], allRequirements = [], allRepresentations = [];
const results = { checks:[], screenshots:[], pageErrors:[] };
let browser, seeded = false;
function check(name, condition) { assert.ok(condition,name); results.checks.push(name); console.log(`PASS ${name}`); }
async function api(page,path,method='GET',body) {
  return page.evaluate(async ({path,method,body}) => {
    const token = localStorage.getItem('bgp_auth_token');
    const r = await fetch(path,{method,credentials:'include',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:r.status,body:await r.json()};
  },{path,method,body});
}
async function login(page,role='STAFF') {
  page.on('pageerror',e=>results.pageErrors.push(e.message));
  await page.goto(`${BASE.origin}/messages`);
  await page.getByTestId('card-login').waitFor({timeout:30000});
  if (await page.getByTestId('button-show-guest-login').isVisible()) await page.getByTestId('button-show-guest-login').click();
  await page.getByTestId('input-guest-email').fill(fixture(role));
  await page.getByTestId('input-guest-password').fill(fixture('PASSWORD'));
  await page.getByTestId('button-guest-login').click();
  await page.getByTestId('card-login').waitFor({state:'hidden',timeout:30000});
  const me=await api(page,'/api/auth/me'); assert.equal(me.status,200);
  assert.equal(me.body.email.toLowerCase(),fixture(role).toLowerCase());
}
async function context(phone) {
  const ctx=await browser.newContext({...(phone?devices['iPhone 13']:{viewport:{width:1440,height:1000}}),serviceWorkers:'block',ignoreHTTPSErrors:true});
  await ctx.route('**/*',r=>new URL(r.request().url()).origin===BASE.origin?r.continue():r.abort());
  return ctx;
}
async function shot(page,name) { await page.screenshot({path:join(OUTPUT,`${name}.png`),fullPage:false}); results.screenshots.push(`${name}.png`); }
async function noOverflow(page,label) { check(`${label}: no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1 && [...document.querySelectorAll('[role=dialog]')].every(e=>e.scrollWidth<=e.clientWidth+1))); }
async function openReview(page,name,findingId) {
  if (!(await page.getByRole('dialog').isVisible())) await page.getByTestId('dh-show-all').click();
  await page.getByRole('textbox',{name:'Search employer reviews'}).fill(name);
  await page.getByTestId(`dh-review-${findingId}`).last().click();
  await page.getByTestId('dh-employer-editor').waitFor();
}
await db.connect();
try {
  const prior=await db.query('SELECT id FROM crm_companies WHERE id=ANY($1::varchar[])',[companies]);
  assert.equal(prior.rowCount,0,'Refusing to overwrite existing fixture companies');
  await db.query('BEGIN');
  for (const [co,name,type] of [[id(1),'QA Employer Brand','Tenant - Restaurant'],[id(2),'QA Employer Agency','Agent'],[id(3),'QA Employer Other Agency','Agent']]) {
    await db.query('INSERT INTO crm_companies (id,name,company_type,industry,domain) VALUES ($1,$2,$3,$4,$5)',[co,name,type,'Hospitality','example.test']);
  }
  await db.query('COMMIT'); seeded=true;
  browser=await chromium.launch({headless:true,...(process.env.SMOKE_CHROMIUM?{executablePath:process.env.SMOKE_CHROMIUM}:{})});
  for (const [phone,offset] of [[false,100],[true,200]]) {
    const label=phone?'phone':'desktop';
    const ctx=await context(phone); const page=await ctx.newPage(); await login(page);
    const initial=await api(page,'/api/crm/data-health'); assert.equal(initial.status,200,JSON.stringify(initial.body));
    const findingIds = {}, people = {};
    await db.query('BEGIN');
    for (let n=1;n<=8;n++) {
      const contact=id(offset+n); const name=`QA ${label} Agent ${n}`;
      people[n]={id:contact,name}; allContacts.push(contact);
      await db.query('INSERT INTO crm_contacts (id,name,email,company_id,company_name,role) VALUES ($1,$2,$3,$4,$5,$6)',[contact,name,`qa-employer-${offset+n}@example.test`,id(1),'QA Employer Brand','Property Agent']);
      for (let repeat=0;repeat<(n===1||n===4?2:1);repeat++) {
        const v=await db.query('INSERT INTO contact_verifications (contact_id,status,confidence,current_company_name,suggested_company_name,reasoning,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',[contact,'mismatch','high','QA Employer Brand',n===2?'QA Employer Agency Limited':'QA Employer Agency','Synthetic evidence: the person works for an agency and represents the brand.',JSON.stringify({companyIdAtVerification:id(1)})]);
        findingIds[n]=v.rows[0].id;
      }
    }
    const requirement=id(offset+20), representation=id(offset+21); allRequirements.push(requirement); allRepresentations.push(representation);
    await db.query('INSERT INTO crm_requirements_leasing (id,name,company_id,agent_contact_id,status,sources) VALUES ($1,$2,$3,$4,$5,$6)',[requirement,'QA Employer Requirement',id(1),people[1].id,'Active',['PIPnet']]);
    await db.query('INSERT INTO brand_agent_representations (id,brand_company_id,agent_company_id,primary_contact_id,agent_type) VALUES ($1,$2,$3,$4,$5)',[representation,id(1),id(2),people[1].id,'tenant_rep']);
    await db.query('COMMIT');
    const queue=await api(page,'/api/crm/data-health');
    check(`${label}: queue has one latest finding per person`,queue.body.pending.filter(v=>Object.values(people).some(p=>p.id===v.contact_id)).length===8);
    check(`${label}: API exposes both brand relationship sources`,queue.body.pending.find(v=>v.contact_id===people[1].id).brand_links.length===2);
    const unmatched=await api(page,`/api/crm/data-health/${findingIds[2]}/apply`,'POST',{});
    check(`${label}: unknown employer never returns notes-only success`,unmatched.status===409 && unmatched.body.code==='EMPLOYER_SELECTION_REQUIRED');
    const unchanged=await db.query('SELECT c.company_id,v.resolution FROM crm_contacts c JOIN contact_verifications v ON v.contact_id=c.id WHERE v.id=$1',[findingIds[2]]);
    check(`${label}: failed automatic match leaves contact and finding unchanged`,unchanged.rows[0].company_id===id(1)&&unchanged.rows[0].resolution===null);
    await page.goto(`${BASE.origin}/contacts`);
    await page.getByTestId('dh-show-all').waitFor({timeout:30000});
    check(`${label}: compact queue preview`,await page.getByTestId('data-health-queue').locator('[data-testid^="dh-finding-"]').count()===(phone?1:3));
    check(`${label}: displayed count matches actual unique queue`,Number(await page.getByTestId('dh-count').innerText())===queue.body.pending.length);
    await noOverflow(page,`${label} preview`); await shot(page,`${label}-reviews-preview`);
    await page.getByTestId('dh-show-all').click();
    const search=page.getByRole('textbox',{name:'Search employer reviews'});
    await search.fill(`QA ${label}`);
    check(`${label}: full queue has bounded six-person pages`,await page.getByRole('dialog').locator('[data-testid^="dh-finding-"]').count()===6);
    await page.getByRole('button',{name:'Next',exact:true}).click();
    check(`${label}: remaining people accessible on next page`,await page.getByRole('dialog').locator('[data-testid^="dh-finding-"]').count()===2);
    await search.fill('no employer review matches');
    check(`${label}: search empty state`,await page.getByText('No reviews match your search.').isVisible());
    await openReview(page,people[1].name,findingIds[1]);
    check(`${label}: review distinguishes employer and represented brand`,(await page.getByTestId('dh-employer-editor').innerText()).includes('Recorded employer: QA Employer Brand') && await page.getByTestId('dh-employer-editor').getByRole('link',{name:'QA Employer Brand',exact:true}).count()===1 && (await page.getByTestId('dh-brand-links').last().innerText()).includes('Current requirement'));
    await page.getByTestId('dh-employer-picker').waitFor();
    await page.getByTestId('dh-save-employer').waitFor();
    await page.waitForFunction(()=>!document.querySelector('[data-testid="dh-save-employer"]')?.disabled);
    await noOverflow(page,`${label} employer editor`); await shot(page,`${label}-employer-review`);
    if (phone) {
      const saveBounds=await page.getByTestId('dh-save-employer').boundingBox();
      check('phone: employer actions have 44px touch targets',saveBounds.height>=44 && (await page.getByTestId('dh-employer-picker').boundingBox()).height>=44);
      check('phone: Save employer stays within visible sheet',saveBounds.y>=0&&saveBounds.y+saveBounds.height<=(await page.evaluate(()=>innerHeight)));
    }
    await page.getByTestId('dh-save-employer').click(); await page.getByTestId('dh-employer-editor').waitFor({state:'hidden'});
    const corrected=await db.query('SELECT company_id FROM crm_contacts WHERE id=$1',[people[1].id]);
    const req=await db.query('SELECT company_id,agent_contact_id FROM crm_requirements_leasing WHERE id=$1',[requirement]);
    const rep=await db.query('SELECT brand_company_id,primary_contact_id FROM brand_agent_representations WHERE id=$1',[representation]);
    check(`${label}: UI save corrects employer and preserves requirement and representation`,corrected.rows[0].company_id===id(2)&&req.rows[0].company_id===id(1)&&req.rows[0].agent_contact_id===people[1].id&&rep.rows[0].brand_company_id===id(1)&&rep.rows[0].primary_contact_id===people[1].id);
    check(`${label}: correction clears historical duplicates`,!(await api(page,'/api/crm/data-health')).body.pending.some(v=>v.contact_id===people[1].id));
    await openReview(page,people[2].name,findingIds[2]);
    check(`${label}: employer alias is not silently guessed`,await page.getByTestId('dh-save-employer').isDisabled());
    await page.getByTestId('dh-employer-picker').click();
    await page.getByPlaceholder('Search CRM companies…').fill('QA Employer Agency');
    await page.getByRole('option').filter({hasText:'QA Employer Agency'}).first().click();
    await page.getByTestId('dh-save-employer').click(); await page.getByTestId('dh-employer-editor').waitFor({state:'hidden'});
    check(`${label}: explicit company selection resolves an unmatched suggestion`,(await db.query('SELECT company_id FROM crm_contacts WHERE id=$1',[people[2].id])).rows[0].company_id===id(2));
    await openReview(page,people[3].name,findingIds[3]);
    await db.query('UPDATE crm_contacts SET company_id=$1,company_name=$2 WHERE id=$3',[id(3),'QA Employer Other Agency',people[3].id]);
    await page.getByTestId('dh-save-employer').click(); await page.getByTestId('dh-save-error').waitFor();
    check(`${label}: stale review shows useful error and preserves choice`,(await page.getByTestId('dh-save-error').innerText()).includes('changed')&&(await page.getByTestId('dh-employer-picker').innerText()).includes('QA Employer Agency'));
    check(`${label}: stale save cannot overwrite another correction`,(await db.query('SELECT company_id FROM crm_contacts WHERE id=$1',[people[3].id])).rows[0].company_id===id(3));
    await shot(page,`${label}-stale-review`);
    await page.getByRole('button',{name:'Refresh queue',exact:true}).click();
    await openReview(page,people[4].name,findingIds[4]);
    await page.getByRole('button',{name:'Dismiss finding'}).click(); await page.getByTestId('dh-employer-editor').waitFor({state:'hidden'});
    check(`${label}: dismiss clears old duplicate findings`,!(await api(page,'/api/crm/data-health')).body.pending.some(v=>v.contact_id===people[4].id));
    await page.getByRole('button',{name:'Close',exact:true}).click();

    // Actual import endpoint, provider discovery mocked to avoid external calls.
    const newEmail=`qa-employer-import-${offset}@example.test`;
    const discovery=[{name:`QA ${label} Discovered Agent`,email:newEmail,current_employer:'QA Employer Agency',role:'Property Agent',source:'brand'},
      {name:`QA ${label} Missing Employer`,email:`qa-employer-missing-${offset}@example.test`,role:'Property Agent',source:'brand'},
      {name:people[1].name,email:`qa-employer-${offset+1}@example.test`,current_employer:'QA Employer Other Agency',role:'Property Agent',source:'brand'}];
    if (phone) {
      // The phone uses MobileBrandView, which has no discovery control.
      const importedResponse=await api(page,`/api/brand/${id(1)}/rocketreach/import`,'POST',{people:discovery,enrich:false});
      assert.equal(importedResponse.status,200);
    } else {
      await page.route(`**/api/brand/${id(1)}/rocketreach/discover`,r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({people:discovery})}));
      await page.goto(`${BASE.origin}/companies/${id(1)}`);
      await page.getByTestId('button-refresh-contacts').waitFor({timeout:45000});
      if (!(await page.getByTestId('contact-import-results').isVisible())) await page.getByTestId('button-refresh-contacts').click();
      await page.getByTestId('contact-import-results').waitFor({timeout:30000});
    }
    const imported=await db.query('SELECT id,company_id FROM crm_contacts WHERE email=$1',[newEmail]);
    imported.rows.forEach(c=>allContacts.push(c.id));
    check(`${label}: real import attaches person to agency instead of browsed brand`,imported.rowCount===1&&imported.rows[0].company_id===id(2));
    if (phone) {
      await page.goto(`${BASE.origin}/companies/${id(2)}`);
      await page.getByTestId('company-section-contacts').click();
      await page.getByText(`QA ${label} Discovered Agent`,{exact:true}).first().waitFor({timeout:30000});
      check('phone: imported person appears under the agency on the real mobile profile',await page.getByText(`QA ${label} Discovered Agent`,{exact:true}).first().isVisible());
      await noOverflow(page,'phone agency contacts'); await shot(page,'phone-agency-contacts');
    } else {
      const report=page.getByTestId('contact-import-results');
      check(`${label}: import summary includes skipped and existing conflicts`,(await report.innerText()).includes('2 need review'));
      await report.getByText('Show import details',{exact:true}).click();
      check(`${label}: imported agent has accessible employer and contact links`,await report.locator(`a[href="/contacts/${imported.rows[0].id}"]`).count()===1&&await report.locator(`a[href="/companies/${id(2)}"]`).count()>0);
      await report.scrollIntoViewIfNeeded(); await noOverflow(page,`${label} import report`); await shot(page,`${label}-import-report`);
    }
    const again=await api(page,`/api/brand/${id(1)}/rocketreach/import`,'POST',{people:discovery,enrich:false});
    check(`${label}: repeated discovery does not recreate corrected contacts`,again.status===200&&again.body.inserted===0&&again.body.existing===2);
    check(`${label}: unknown employer is not attached to brand`,(await db.query('SELECT id FROM crm_contacts WHERE email=$1',[`qa-employer-missing-${offset}@example.test`])).rowCount===0);

    // The shared Key contacts board has a separate discovery/Add path.
    const boardEmail=`qa-employer-board-${offset}@example.test`;
    const boardCandidates=[{name:`QA ${label} Board Agent`,email:boardEmail,title:'Property Agent',phone:'020 0000 0000',linkedin:`https://www.linkedin.com/in/qa-employer-board-${offset}`,sources:['rocketreach']},
      {name:people[1].name,email:`qa-employer-${offset+1}@example.test`,title:'Property Agent',sources:['rocketreach']}];
    await page.route(`**/api/brand/${id(1)}/contacts-cascade`,r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({contacts:boardCandidates,summary:{}})}));
    await page.goto(`${BASE.origin}/companies/${id(1)}`);
    if(phone) await page.getByTestId('company-section-contacts').click();
    const board=page.getByTestId(`company-contacts-board-${id(1)}`);
    await board.getByTestId('contact-cascade-refresh').click();
    await board.getByTestId(`button-add-known-${boardEmail}`).click();
    await board.getByTestId(`contact-cascade-open-${boardEmail}`).waitFor();
    const boardCreated=await db.query('SELECT id,company_id,company_name,phone,linkedin_url,notes FROM crm_contacts WHERE email=$1',[boardEmail]);
    boardCreated.rows.forEach(c=>allContacts.push(c.id));
    check(`${label}: shared-board addition preserves person details with unconfirmed employer`,boardCreated.rowCount===1&&boardCreated.rows[0].company_id===null&&boardCreated.rows[0].company_name===null&&boardCreated.rows[0].phone==='020 0000 0000'&&boardCreated.rows[0].notes.includes('QA Employer Brand'));
    check(`${label}: shared-board addition provides an Open contact link`,await board.getByTestId(`contact-cascade-open-${boardEmail}`).getAttribute('href')===`/contacts/${boardCreated.rows[0].id}`);
    await board.getByTestId(`button-add-known-qa-employer-${offset+1}@example.test`).click();
    await board.getByTestId(`contact-cascade-open-qa-employer-${offset+1}@example.test`).waitFor();
    check(`${label}: shared-board addition reuses corrected agency contact`,await board.getByTestId(`contact-cascade-open-qa-employer-${offset+1}@example.test`).getAttribute('href')===`/contacts/${people[1].id}`&&(await db.query('SELECT company_id FROM crm_contacts WHERE id=$1',[people[1].id])).rows[0].company_id===id(2));
    check(`${label}: discovered person name remains readable`,await board.getByText(`QA ${label} Board Agent`,{exact:true}).evaluate(element=>element.scrollWidth<=element.clientWidth+1));
    await board.scrollIntoViewIfNeeded(); await noOverflow(page,`${label} shared-board review`); await shot(page,`${label}-shared-board-review`);
    const pendingEmail=`qa-employer-pending-${offset}@example.test`;
    const promoted=await api(page,`/api/brand/${id(1)}/promote-sender`,'POST',{name:`QA ${label} Pending Agent`,email:pendingEmail});
    assert.equal(promoted.status,200,JSON.stringify(promoted.body)); allContacts.push(promoted.body.id);
    check(`${label}: pending email promotion leaves employer unconfirmed`,promoted.body.created===true&&promoted.body.employerConfirmed===false&&(await db.query('SELECT company_id FROM crm_contacts WHERE id=$1',[promoted.body.id])).rows[0].company_id===null);
    await ctx.close();
  }
  const clientCtx=await context(false); const client=await clientCtx.newPage(); await login(client,'CLIENT');
  for (const [path,method] of [['/api/crm/data-health','GET'],['/api/crm/data-health/1/apply','POST'],['/api/crm/data-health/1/dismiss','POST']]) {
    check(`client cannot access staff employer review ${method} ${path}`,(await api(client,path,method,method==='POST'?{companyId:id(2)}:undefined)).status===403);
  }
  await clientCtx.close();
  check('no uncaught browser errors',results.pageErrors.length===0);
} finally {
  if(browser) await browser.close();
  if(seeded) {
    // Also cover a failure immediately after the importer wrote its fixture person.
    const imported=await db.query("SELECT id FROM crm_contacts WHERE email=ANY($1::text[])",[ ['import','board','pending'].flatMap(kind=>[100,200].map(offset=>`qa-employer-${kind}-${offset}@example.test`)) ]);
    imported.rows.forEach(c=>allContacts.push(c.id));
    await db.query('DELETE FROM contact_verifications WHERE contact_id=ANY($1::varchar[])',[allContacts]);
    await db.query('DELETE FROM brand_agent_representations WHERE id=ANY($1::varchar[])',[allRepresentations]);
    await db.query('DELETE FROM crm_requirements_leasing WHERE id=ANY($1::varchar[])',[allRequirements]);
    await db.query('DELETE FROM crm_contacts WHERE id=ANY($1::varchar[])',[allContacts]);
    await db.query('DELETE FROM crm_companies WHERE id=ANY($1::varchar[])',[companies]);
  }
  await db.end();
  writeFileSync(join(OUTPUT,'results.json'),JSON.stringify(results,null,2));
}
console.log(`PASS ${results.checks.length} authenticated CRM employer browser/API checks`);
