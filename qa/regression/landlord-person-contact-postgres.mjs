import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { resolveAccountContactIdentity } from '../../server/account-resolver.ts';
import { resolveLandlordActivityPerson } from '../../server/landlord-activity-person.ts';
import { PRIVATE_MAILBOX } from '../../shared/private-mail.ts';

test('narrow person identity preserves account employer and property-contact scope without reading deals or interaction statistics',async()=>{
 const schema=`landlord_contact_${randomUUID().replaceAll('-','')}`;
 const pool=new pg.Pool({host:'/tmp',database:'postgres',max:1});
 const queries=[];
 const q={query:async(sql,params)=>{queries.push(sql);return pool.query(sql,params);}};
 try {
  await pool.query(`CREATE SCHEMA ${schema}`);await pool.query(`SET search_path TO ${schema}`);
  await pool.query(`CREATE TABLE crm_companies(id text,name text,company_type text,companies_house_number text,parent_company_id text,merged_into_id text);
    CREATE TABLE crm_trading_entities(id text,name text,companies_house_number text,parent_company_id text);
    CREATE TABLE crm_contacts(id text,name text,email text,company_id text);
    CREATE TABLE crm_properties(id text,landlord_id text,freeholder_id text,long_leaseholder_id text,asset_manager_id text);
    CREATE TABLE crm_company_properties(company_id text,property_id text);
    CREATE TABLE crm_contact_properties(contact_id text,property_id text);
    CREATE TABLE crm_property_clients(contact_id text,property_id text);
    CREATE TABLE crm_deals(id text,landlord_id text,status text);
    CREATE TABLE users(id text,name text,username text,email text,role text,is_active boolean);
    INSERT INTO crm_companies VALUES ('root','Example Estates','Landlord',NULL,'parent',NULL),('parent','Parent Estates','Landlord',NULL,NULL,NULL),
      ('child','Subsidiary Estates','Landlord',NULL,'root',NULL),('sibling','Sibling Estates','Landlord',NULL,'parent',NULL),('other','Other Landlord','Landlord',NULL,NULL,NULL);
    INSERT INTO crm_properties VALUES ('owned','child',NULL,NULL,NULL),('freeheld',NULL,'root',NULL,NULL),('leaseheld',NULL,NULL,'root',NULL),
      ('managed',NULL,NULL,NULL,'root'),('linked',NULL,NULL,NULL,NULL),('unrelated','other',NULL,NULL,NULL);
    INSERT INTO crm_company_properties VALUES ('sibling','linked');`);
  const identities=[['direct','root'],['parent-contact','parent'],['child-contact','child'],['sibling-contact','sibling'],
    ['owned-contact','other'],['freehold-contact','other'],['lease-client','other'],['linked-client','other'],['unrelated-contact','other'],['manager-only','other']];
  for(const [id,employer]of identities)await pool.query('INSERT INTO crm_contacts VALUES ($1,$1,$2,$3)',[id,`${id}@example.test`,employer]);
  await pool.query(`INSERT INTO crm_contact_properties VALUES ('owned-contact','owned'),('freehold-contact','freeheld'),('unrelated-contact','unrelated'),('manager-only','managed');
    INSERT INTO crm_property_clients VALUES ('lease-client','leaseheld'),('linked-client','linked');`);
  queries.length=0;
  assert.deepEqual(await resolveAccountContactIdentity('root','direct',q),{name:'direct',email:'direct@example.test'});
  assert.equal(queries.length,1,'a direct employer contact needs only its identity lookup');
  for(const id of ['parent-contact','child-contact','sibling-contact','owned-contact','freehold-contact','lease-client','linked-client']) {
    assert.equal((await resolveAccountContactIdentity('root',id,q))?.name,id);
  }
  for(const id of ['unrelated-contact','manager-only','missing'])assert.equal(await resolveAccountContactIdentity('root',id,q),null);
  assert.equal(await resolveAccountContactIdentity('other','direct',q),null,'a contact from another landlord cannot be opened merely by knowing its ID');
  assert.ok(queries.every(sql=>!sql.includes('crm_interactions')&&!sql.includes('FROM crm_deals')&&!sql.includes('leasing_schedule_units')));
  assert.ok(queries.every(sql=>/^\s*(SELECT|WITH)\b/.test(sql)),'identity lookup is read-only');
  // Active status belongs to the viewer gate, not the historical colleague.
  await pool.query('INSERT INTO users VALUES ($1,$2,$2,$3,$4,$5)',['former','Former Colleague','former@brucegillinghampollard.com','Director',false]);
  assert.equal((await resolveLandlordActivityPerson('root',{userId:'former'},{q}))?.name,'Former Colleague');
  await pool.query('INSERT INTO users VALUES ($1,$2,$2,$3,$4,$5)',['client','Client User','client@brucegillinghampollard.com','Client',true]);
  await assert.rejects(resolveLandlordActivityPerson('root',{userId:'client'},{q}),/no available linked email/);
  await pool.query('INSERT INTO crm_contacts VALUES ($1,$2,$3,$4)',['private','Private',PRIVATE_MAILBOX,'root']);
  await assert.rejects(resolveLandlordActivityPerson('root',{contactId:'private'},{q}),/no available linked email/);
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}
});
