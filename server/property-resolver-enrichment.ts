import { createHash } from 'node:crypto';
import type { PropertyEnrichmentResult } from '../shared/property-enrichment';
import type { ResolveBuildingTitlesInput, ResolveBuildingTitlesResult } from './land-registry';
import { fullPropertyPostcode, propertyLookupIdentity } from '../shared/property-lookup-identity';

type Queryable = { query: (sql: string, values?: any[]) => Promise<any> };
type Connection = Queryable & { release: (destroy?: boolean) => void };
export type EnrichmentDependencies = {
  pool: { connect: () => Promise<Connection> };
  lookupTitles: (input: ResolveBuildingTitlesInput) => Promise<ResolveBuildingTitlesResult>;
  lookupVoa: (postcode: string) => Promise<{ available: boolean; rows: any[] }>;
};
export const enrichmentKey = (id: string) => `property-resolver-enrichment:${id}`;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const postcode = (value: unknown) => (fullPropertyPostcode(value) || '').replace(/\s+/g, '');
const titleNumber = (row: any) => text(row?.title_number || row?.titleNumber || row?.title).toUpperCase();
const empty = (value: unknown) => value == null || value === '';
export function canonicalPropertyAddress(property: any): string {
  const address = property.address;
  if (typeof address === 'string') return address.trim();
  return text(address?.formatted || address?.address || address?.text)
    || [address?.line1 || address?.street, address?.line2, address?.city, address?.postcode].filter(Boolean).join(', ')
    || text(property.name);
}
export function propertyIdentityFingerprint(property: any): string {
  // Do not treat an unrelated note edit as a different building, but changing
  // its canonical identity during research must invalidate the whole result.
  return createHash('sha256').update(JSON.stringify({ id: property.id, address: canonicalPropertyAddress(property),
    postcode: propertyLookupIdentity(property).postcode, uprn: text(property.uprn),
    latitude: property.latitude, longitude: property.longitude })).digest('hex');
}
function uniqueTitles(rows: any[]): any[] {
  const found = new Map<string, any>();
  for (const row of rows) {
    const number = titleNumber(row);
    if (number && !found.has(number)) found.set(number, row);
  }
  return [...found.values()];
}
function candidateAddress(value: unknown, pc: string): string {
  return text(value).toUpperCase().replace(new RegExp(pc.split('').join('\\s*'), 'g'), '')
    .replace(/[^A-Z0-9]/g, '');
}
/** A strict full-address match is required; the first postcode result is never
 * promoted to a building-level assessment, nor are multiple assessments merged. */
export function exactVoaCandidate(property: any, rows: any[]): any | null {
  const pc = postcode(propertyLookupIdentity(property).postcode);
  if (!pc) return null;
  const address = candidateAddress(canonicalPropertyAddress(property), pc);
  if (!address) return null;
  const matches = rows.filter(row => row.baRef && postcode(row.postcode) === pc && candidateAddress(row.address, pc) === address);
  return new Set(matches.map(row => row.baRef)).size === 1 ? matches[0] : null;
}

export function planPropertyEnrichment(property: any, titles: Extract<ResolveBuildingTitlesResult, { ok: true }>, voa: { available: boolean; rows: any[] }, now = new Date()) {
  const rawMatched = [...(titles.matched?.freeholds || []), ...(titles.matched?.leaseholds || [])];
  const matchedFreeholds = uniqueTitles(titles.matched?.freeholds || []);
  const matchedLeaseholds = uniqueTitles(titles.matched?.leaseholds || []);
  const candidates = uniqueTitles([...matchedFreeholds, ...matchedLeaseholds, ...(titles.fallback?.freeholds || []), ...(titles.fallback?.leaseholds || [])]);
  const exact = !!text(property.uprn) && titles.source === 'uprn' && titles.matched.exact
    && titles.uprns.length === 1 && titles.uprns[0] === text(property.uprn) && titles.pdErrors.length === 0;
  const ownerSignature = (row: any) => JSON.stringify([
    row.proprietor_name_1 || row.ownership?.details?.owner, row.proprietor_name_2, row.proprietor_name_3, row.proprietor_name_4,
    row.company_registration_no_1 || row.ownership?.details?.company_reg,
    row.proprietor_address_1 || row.ownership?.details?.owner_address,
  ].map(value => text(value).toUpperCase()));
  const consistentOwner = new Set(rawMatched.map(ownerSignature)).size <= 1;
  const tenure = text(property.tenure).toLowerCase();
  const tenureCompatible = !(matchedFreeholds.length && matchedLeaseholds.length)
    && !(tenure.includes('leasehold') && matchedFreeholds.length) && !(tenure === 'freehold' && matchedLeaseholds.length);
  const candidate = exact && consistentOwner && tenureCompatible && uniqueTitles(rawMatched).length === 1 ? candidates[0] : null;
  const existingTitle = text(property.title_number).toUpperCase();
  const titleCompatible = !!candidate && (!existingTitle || existingTitle === titleNumber(candidate));
  const fields: Record<string, any> = {};
  let titleStatus = candidates.length ? 'needs_review' : titles.pdErrors.length ? 'unavailable' : 'no_match';
  let ownershipStatus = 'needs_review';
  if (titleCompatible) {
    titleStatus = 'ready';
    if (!existingTitle) { fields.title_number = titleNumber(candidate); fields.title_search_date = now; }
    // Do not combine fresh owner fragments with an existing human/legal owner.
    const ownerFields = ['proprietor_name', 'proprietor_type', 'proprietor_address', 'proprietor_company_number', 'landlord_id', 'freeholder_id', 'long_leaseholder_id'];
    const hasExistingOwner = ownerFields.some(key => !empty(property[key]));
    const owner = text(candidate.proprietor_name_1 || candidate.ownership?.details?.owner);
    const secondOwner = text(candidate.proprietor_name_2 || candidate.proprietor_name_3 || candidate.proprietor_name_4);
    const companyNumber = text(candidate.company_registration_no_1 || candidate.ownership?.details?.company_reg);
    if (!hasExistingOwner && owner && !secondOwner) {
      fields.proprietor_name = owner;
      if (companyNumber) { fields.proprietor_company_number = companyNumber; fields.proprietor_type = 'company'; }
      const address = text(candidate.proprietor_address_1 || candidate.ownership?.details?.owner_address);
      if (address) fields.proprietor_address = address;
      ownershipStatus = 'ready';
    } else if (hasExistingOwner) ownershipStatus = 'preserved';
  }
  const voaCandidate = empty(property.voa_ba_reference) ? exactVoaCandidate(property, voa.rows) : null;
  if (voaCandidate) fields.voa_ba_reference = voaCandidate.baRef;
  const voaStatus = !empty(property.voa_ba_reference) ? 'preserved' : voaCandidate ? 'ready'
    : !voa.available ? 'unavailable' : voa.rows.length ? 'needs_review' : 'no_match';
  const needsReview = titleStatus === 'needs_review' || ownershipStatus === 'needs_review' || voaStatus === 'needs_review';
  const status = titleStatus === 'unavailable' ? 'unavailable' : titleStatus === 'no_match' ? 'no_match'
    : needsReview ? 'needs_review' : titles.pdErrors.length || voaStatus === 'unavailable' ? 'partial' : 'ready';
  if (status === 'unavailable') {
    // A failed action must not quietly apply rating data while telling the
    // caller that no details changed. Candidates remain available in history.
    for (const field of Object.keys(fields)) delete fields[field];
  }
  const result: PropertyEnrichmentResult = {
    ok: status !== 'unavailable', status, checkedAt: now.toISOString(), updatedFields: Object.keys(fields),
    titleCandidates: candidates.length, voaCandidates: voa.rows.length,
    stages: { titles: titleStatus, ownership: ownershipStatus, voa: status === 'unavailable' && voaCandidate ? 'needs_review' : voaStatus },
    message: status === 'ready' ? 'Property research saved. Existing title, owner links and KYC decisions have been kept.'
      : status === 'no_match' ? 'No title match found. Existing property details have been kept.'
        : status === 'unavailable' ? 'The title lookup could not finish. Existing property details have been kept.'
          : 'Research saved. Review the title or rating candidates before making further changes; existing details have been kept.',
    ...(status === 'unavailable' ? { httpStatus: 502 } : {}),
  };
  return { fields, result, freeholds: uniqueTitles([...matchedFreeholds, ...(titles.fallback?.freeholds || [])]),
    leaseholds: uniqueTitles([...matchedLeaseholds, ...(titles.fallback?.leaseholds || [])]),
    provenance: { exactUprn: exact ? text(property.uprn) : null, source: titles.source,
      providerErrors: titles.pdErrors.map(error => ({ endpoint: error.endpoint, status: error.status || null })), voaCandidates: voa.rows } };
}

async function readRecentResearch(db: Queryable, propertyId: string, identity: string): Promise<PropertyEnrichmentResult | null> {
  const row = (await db.query(`SELECT id,intelligence FROM land_registry_searches
    WHERE crm_property_id=$1 AND source='resolver' AND intelligence->'propertyEnrichment'->>'identity'=$2
    ORDER BY created_at DESC,id DESC LIMIT 1`, [propertyId, identity])).rows[0];
  const result = row?.intelligence?.propertyEnrichment?.result;
  return result ? { ...result, historyId: row.id } : null;
}

/** One explicit, awaited action. The session lock deduplicates charged lookups
 * across workers. Only saved candidate research is cached; no fake background job. */
export async function runPropertyEnrichment(deps: EnrichmentDependencies, propertyId: string, actorId: string): Promise<PropertyEnrichmentResult> {
  const failure = (status: 'failed' | 'unavailable' | 'needs_review', message: string, httpStatus = 500): PropertyEnrichmentResult => ({
    ok: false, status, message, checkedAt: new Date().toISOString(), updatedFields: [], titleCandidates: 0, voaCandidates: 0,
    stages: { titles: status, ownership: 'preserved', voa: 'preserved' }, httpStatus,
  });
  if (!actorId) return failure('failed', 'An authenticated researcher is required.', 401);
  const client = await deps.pool.connect();
  let locked = false, identity = '', inTransaction = false;
  try {
    locked = !!(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [enrichmentKey(propertyId)])).rows[0]?.locked;
    if (!locked) return { ...failure('failed', 'Property research is already running.', 202), ok: true, status: 'running' };
    const property = (await client.query('SELECT * FROM crm_properties WHERE id=$1', [propertyId])).rows[0];
    if (!property) return failure('failed', 'Property not found.', 404);
    identity = propertyIdentityFingerprint(property);
    const cached = await readRecentResearch(client, propertyId, identity);
    const cacheAge = cached?.checkedAt ? Date.now() - Date.parse(cached.checkedAt) : Infinity;
    if (cached && cached.status !== 'running' && cached.status !== 'failed' && cached.status !== 'unavailable' && cacheAge >= 0 && cacheAge < 24 * 60 * 60_000) return { ...cached, cached: true };
    const address = canonicalPropertyAddress(property);
    const lookupIdentity = propertyLookupIdentity(property);
    const pc = lookupIdentity.postcode;
    if (!address || !pc || (text(property.uprn) && !lookupIdentity.uprn)) {
      return failure('needs_review', 'Confirm the property address and postcode before researching titles.', 422);
    }
    const titles = await deps.lookupTitles({ address, postcode: pc, uprn: lookupIdentity.uprn,
      exactUprnOnly: !!lookupIdentity.uprn, lat: property.latitude == null ? undefined : Number(property.latitude),
      lng: property.longitude == null ? undefined : Number(property.longitude), source: 'resolver', userId: actorId, skipPersist: true });
    if (!titles.ok) {
      const result = failure('unavailable', titles.status === 503 ? 'Title research is unavailable. Existing property details have been kept.' : 'Title research failed. Check the address or retry later.', titles.status === 503 ? 503 : 502);
      return result;
    }
    const voa = empty(property.voa_ba_reference) ? await deps.lookupVoa(pc).catch(() => ({ available: false, rows: [] })) : { available: true, rows: [] };
    await client.query('BEGIN'); inTransaction = true;
    const current = (await client.query('SELECT * FROM crm_properties WHERE id=$1 FOR UPDATE', [propertyId])).rows[0];
    if (!current || propertyIdentityFingerprint(current) !== identity) {
      await client.query('ROLLBACK'); inTransaction = false;
      const result = failure('needs_review', 'The property identity changed during research. Nothing was applied; retry using the current address.', 409);
      return result;
    }
    // Re-plan against locked CURRENT facts: a human may have added a title or
    // owner while the provider was running. Never overwrite that work.
    const plan = planPropertyEnrichment(current, titles, voa);
    const history = await client.query(`INSERT INTO land_registry_searches
      (user_id,address,postcode,freeholds_count,leaseholds_count,freeholds,leaseholds,intelligence,crm_property_id,source,status)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,'resolver',$10) RETURNING id`,
    [actorId, address, pc, plan.freeholds.length, plan.leaseholds.length, JSON.stringify(plan.freeholds), JSON.stringify(plan.leaseholds),
      JSON.stringify({ propertyEnrichment: { ...plan.provenance, identity, checkedAt: plan.result.checkedAt, stages: plan.result.stages, result: plan.result } }), propertyId,
      plan.result.status === 'ready' ? 'Completed' : 'Review']);
    const entries = Object.entries(plan.fields);
    if (entries.length) await client.query(`UPDATE crm_properties SET ${entries.map(([field], index) => `${field}=$${index + 1}`).join(',')},updated_at=now() WHERE id=$${entries.length + 1}`, [...entries.map(([, value]) => value), propertyId]);
    plan.result.historyId = history.rows[0].id;
    await client.query('COMMIT'); inTransaction = false;
    return plan.result;
  } catch {
    if (inTransaction) { await client.query('ROLLBACK'); inTransaction = false; }
    const result = failure('failed', 'Property research could not be saved. Existing details have been kept; retry later.');
    return result;
  } finally {
    let destroy = false;
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [enrichmentKey(propertyId)]).catch(() => { destroy = true; });
    client.release(destroy);
  }
}
