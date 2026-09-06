import pg from 'pg';
const c = new pg.Client({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
const { rows: co } = await c.query(`SELECT id, name FROM crm_companies WHERE name ILIKE '%landsec%'`);
console.log('companies:', co);
const cid = co[0].id;
const q = async (label, sql) => { const r = await c.query(sql, [cid]); console.log(label, JSON.stringify(r.rows)); };
await q('TILE count (broad union):', `SELECT COUNT(DISTINCT d.id) total, COUNT(DISTINCT d.id) FILTER (WHERE d.status NOT IN ('WIT','COM','INV')) active
  FROM crm_deals d LEFT JOIN crm_properties p ON d.property_id=p.id
  WHERE d.landlord_id=$1 OR p.landlord_id=$1 OR d.group_name ILIKE '%'||(SELECT name FROM crm_companies WHERE id=$1)||'%'`);
await q('LIST rows (landlord_id only):', `SELECT COUNT(*) n FROM crm_deals d WHERE d.landlord_id=$1 AND d.status NOT IN ('WIT','COM','INV')`);
await q('LIST detail:', `SELECT d.id,d.name,d.status,p.name property FROM crm_deals d LEFT JOIN crm_properties p ON d.property_id=p.id WHERE d.landlord_id=$1 AND d.status NOT IN ('WIT','COM','INV') ORDER BY p.name`);
await q('BROAD detail:', `SELECT DISTINCT d.id,d.name,d.status,p.name property, d.landlord_id=$1 AS by_ll, p.landlord_id=$1 AS by_prop, (d.group_name ILIKE '%'||(SELECT name FROM crm_companies WHERE id=$1)||'%') AS by_group
  FROM crm_deals d LEFT JOIN crm_properties p ON d.property_id=p.id
  WHERE (d.landlord_id=$1 OR p.landlord_id=$1 OR d.group_name ILIKE '%'||(SELECT name FROM crm_companies WHERE id=$1)||'%') AND d.status NOT IN ('WIT','COM','INV')`);
await c.end();
