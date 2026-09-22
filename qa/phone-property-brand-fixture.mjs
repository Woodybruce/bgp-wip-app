// Exact synthetic records for the local/CI phone smoke. Never accepts a remote
// database or the app's normal DATABASE_URL environment variable.
import { randomUUID } from 'node:crypto';
import pg from 'pg';

export function phoneFixtureConfig(connectionString) {
  if (!connectionString) throw new Error('PHONE_SMOKE_DATABASE_URL is required for property/brand phone checks');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('A disposable PostgreSQL smoke database is required');
  const socket = url.searchParams.get('host');
  const socketAllowed = !url.hostname && url.pathname === '/bgp_smoke' && /^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(socket || '');
  const tcpAllowed = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname === '/bgpsmoke' && !socket;
  if ((!socketAllowed && !tcpAllowed) || [...url.searchParams.keys()].some(key => !['host', 'port', 'user', 'password'].includes(key))) {
    throw new Error('Only the disposable local bgpsmoke database or guarded bgp_smoke Unix socket is allowed');
  }
  return { host: socketAllowed ? socket : url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || url.searchParams.get('port') || 5432),
    database: url.pathname.slice(1), user: decodeURIComponent(url.username || url.searchParams.get('user') || 'postgres'),
    password: decodeURIComponent(url.password || url.searchParams.get('password') || ''), ssl: false };
}

export async function createPhonePropertyBrandFixture(connectionString) {
  const db = new pg.Client(phoneFixtureConfig(connectionString));
  const ids = Object.fromEntries(['property', 'brand', 'agency', 'namedContact', 'agencyContact', 'namedRepresentation', 'agencyRepresentation', 'currentTenancy', 'archivedTenancy'].map(key => [key, randomUUID()]));
  const names = { property: 'QA Phone Property', brand: 'QA Phone Brand', agency: 'QA Phone Agency', namedContact: 'QA Phone Named Agent', agencyContact: 'QA Phone Agency Agent' };
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query("INSERT INTO crm_companies (id,name,company_type,ai_disabled) VALUES ($1,$2,'Tenant - Restaurant',true),($3,$4,'Agent',true)", [ids.brand, names.brand, ids.agency, names.agency]);
    await db.query("INSERT INTO crm_contacts (id,name,company_id,role) VALUES ($1,$2,NULL,'Agent'),($3,$4,$5,'Agent')", [ids.namedContact, names.namedContact, ids.agencyContact, names.agencyContact, ids.agency]);
    await db.query("INSERT INTO brand_agent_representations (id,brand_company_id,agent_company_id,primary_contact_id,agent_type) VALUES ($1,$2,NULL,$3,'tenant_rep'),($4,$2,$5,$6,'tenant_rep')", [ids.namedRepresentation, ids.brand, ids.namedContact, ids.agencyRepresentation, ids.agency, ids.agencyContact]);
    await db.query("INSERT INTO crm_properties (id,name,status,asset_class,property_view,group_name,bgp_engagement) VALUES ($1,$2,'BGP Active','Office','building','Properties',ARRAY['Leasing'])", [ids.property, names.property]);
    await db.query("INSERT INTO tenancy_schedule_units (id,property_id,unit_number,premises,status,tenant_name,tenant_company_id,nia_sqft,passing_rent_pa) VALUES ($1,$2,'Unit 1','Ground floor','Occupied',$3,$4,1250,24000),($5,$2,'Historic unit','Historic tenancy','Archived','QA Historic Tenant',NULL,5000,90000)", [ids.currentTenancy, ids.property, names.brand, ids.brand, ids.archivedTenancy]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    await db.end();
    throw error;
  }
  return { ids, names, async cleanup() {
    try {
      await db.query('BEGIN');
      await db.query('DELETE FROM tenancy_schedule_units WHERE id=ANY($1::varchar[])', [[ids.currentTenancy, ids.archivedTenancy]]);
      await db.query('DELETE FROM brand_agent_representations WHERE id=ANY($1::varchar[])', [[ids.namedRepresentation, ids.agencyRepresentation]]);
      await db.query('DELETE FROM crm_contacts WHERE id=ANY($1::varchar[])', [[ids.namedContact, ids.agencyContact]]);
      await db.query('DELETE FROM crm_properties WHERE id=$1', [ids.property]);
      await db.query('DELETE FROM crm_companies WHERE id=ANY($1::varchar[])', [[ids.brand, ids.agency]]);
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
    finally { await db.end(); }
  } };
}
