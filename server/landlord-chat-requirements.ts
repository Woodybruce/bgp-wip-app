import { createHash, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';

const text = z.string().trim().max(8000);
const list = z.array(z.string().trim().min(1).max(300)).max(30);
const fields = {
  name: text.optional(), category: z.literal('Investment').optional(), companyName: text.optional(),
  contactName: text.optional(), use: list.optional(), requirementType: list.optional(),
  size: list.optional(), requirementLocations: list.optional(), location: text.optional(),
  budget: text.optional(), sizeMin: text.optional(), sizeMax: text.optional(), notes: text.optional(),
  status: z.enum(['Active', 'Past', 'Archived', 'On hold', 'active', 'fulfilled', 'withdrawn', 'on_hold']).optional(),
};
const createSchema = z.object(fields).strict();
const updateSchema = z.object({ ...fields, id: z.string().uuid() }).strict();

const properties = {
  name: { type: 'string', description: 'Short requirement title; default is this landlord’s name.' },
  category: { type: 'string', enum: ['Investment'] },
  use: { type: 'array', items: { type: 'string' }, description: 'Requested property uses. Only facts supplied by the user.' },
  requirementType: { type: 'array', items: { type: 'string' }, description: 'Investment or acquisition types requested.' },
  size: { type: 'array', items: { type: 'string' }, description: 'Monetary lot-size ranges, e.g. £5m–£10m. Not floor area.' },
  requirementLocations: { type: 'array', items: { type: 'string' }, description: 'Requested locations.' },
  contactName: { type: 'string' }, budget: { type: 'string', description: 'Monetary lot-size budget if not provided in size.' },
  sizeMin: { type: 'string', description: 'Physical area minimum, saved in notes with units.' },
  sizeMax: { type: 'string', description: 'Physical area maximum, saved in notes with units.' },
  notes: { type: 'string', description: 'User-provided brief. On update, appended to existing notes without erasing them.' },
  status: { type: 'string', enum: ['Active', 'Past', 'Archived', 'On hold'] },
};

/** Only installed on an authenticated internal landlord thread; Brands keep their existing tools. */
export const landlordRequirementTools = [
  { type: 'function', function: { name: 'search_landlord_requirements', description: 'Read the current Investment Requirements board for this landlord. Use before updating a requirement, or before creating one to check for duplicates. Returns record IDs and the saved brief.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: [] } } },
  { type: 'function', function: { name: 'create_requirement', description: 'Save a new investment requirement on the CURRENT landlord’s Investment Requirements board. Use when explicitly asked to add/log/save a requirement. The company is linked automatically from this conversation. Do not create a duplicate of an existing brief. Missing criteria stay blank; do not invent them.', parameters: { type: 'object', properties, required: [] } } },
  { type: 'function', function: { name: 'update_requirement', description: 'Update a saved investment requirement for THIS landlord. Read search_landlord_requirements first for the exact ID. Only supplied fields change; notes are appended. Cannot update another company’s requirement.', parameters: { type: 'object', properties: { id: { type: 'string' }, ...properties }, required: ['id'] } } },
];

type Context = { companyId: string; threadId: string; messageId?: string; userId: string };
const statusName = (value: string | undefined) => ({ active: 'Active', fulfilled: 'Past', withdrawn: 'Archived', on_hold: 'On hold' }[value || ''] || value);
const shortBrief = (args: any) => [args.notes, args.sizeMin ? `Minimum floor area: ${args.sizeMin}` : '', args.sizeMax ? `Maximum floor area: ${args.sizeMax}` : ''].filter(Boolean).join('\n');
function receipt(row: any, operation: 'created' | 'updated', reused = false) {
  const url = `/requirements?type=investment&requirementId=${encodeURIComponent(row.id)}`;
  return { data: { success: true, action: operation, entity: 'requirement', category: 'Investment', id: row.id, companyId: row.company_id, name: row.name, record: row, url, reused },
    action: { success: true, type: `crm_${operation}`, entityType: 'requirement', category: 'Investment', id: row.id, companyId: row.company_id, url } };
}

/** Uses the same table as the current Requirements UI and company account-team view. */
export async function runLandlordRequirementTool(pool: Pool, context: Context, tool: string, input: unknown) {
  const failure = (error: string) => ({ data: { success: false, error } });
  if (!context.companyId || !context.userId || !context.threadId) return failure('The landlord conversation could not be verified. Nothing was saved.');
  if (tool === 'search_landlord_requirements') {
    const args = z.object({ query: text.optional() }).strict().safeParse(input);
    if (!args.success) return failure('Please provide a valid requirement search.');
    const rows = await pool.query(`SELECT id,name,company_id,status,use_types,requirement_types,size_range,requirement_locations,contact_name,comments,updated_at
      FROM crm_requirements_investment WHERE company_id=$1
      AND ($2='' OR concat_ws(' ',name,comments,contact_name,array_to_string(requirement_locations,' ')) ILIKE '%' || $2 || '%')
      ORDER BY updated_at DESC NULLS LAST LIMIT 40`, [context.companyId, args.data.query || '']);
    return { data: { success: true, companyId: context.companyId, requirements: rows.rows } };
  }
  if (!['create_requirement', 'update_requirement'].includes(tool)) return failure('Unsupported requirement action.');
  const parsed = (tool === 'create_requirement' ? createSchema : updateSchema).safeParse(input);
  if (!parsed.success) return failure('The requirement fields are invalid. Nothing was saved: ' + parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  const args: any = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: companies } = await client.query('SELECT id,name FROM crm_companies WHERE id=$1', [context.companyId]);
    if (!companies.length || (args.companyName && args.companyName.toLowerCase() !== companies[0].name.toLowerCase())) {
      await client.query('ROLLBACK'); return failure('This action is limited to the landlord linked to this conversation. Nothing was saved.');
    }
    const brief = shortBrief(args);
    if (tool === 'create_requirement') {
      if (!brief && !args.use?.length && !args.requirementType?.length && !args.size?.length && !args.budget && !args.requirementLocations?.length && !args.location) {
        await client.query('ROLLBACK'); return failure('Please provide at least one requirement detail, such as use, budget or location. Nothing was saved.');
      }
      // A provider retry of the same message/brief returns the same saved record.
      const canonical = Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b)));
      const hash = createHash('sha256').update(JSON.stringify([context.threadId, context.messageId || randomUUID(), canonical])).digest('hex');
      const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      const result = await client.query(`INSERT INTO crm_requirements_investment
        (id,name,company_id,status,group_name,use_types,requirement_types,size_range,requirement_locations,locations,contact_name,comments,requirement_date,bgp_contact_user_ids)
        VALUES ($1,$2,$3,$4,'Active Buyers',$5,$6,$7,$8,$9,$10,$11,to_char(CURRENT_DATE,'YYYY-MM-DD'),$12)
        ON CONFLICT(id) DO NOTHING RETURNING *`, [id, args.name || companies[0].name, context.companyId, statusName(args.status) || 'Active',
        args.use || null, args.requirementType || null, args.size || (args.budget ? [args.budget] : null), args.requirementLocations || (args.location ? [args.location] : null),
        args.location || null, args.contactName || null, brief || null, [context.userId]]);
      const row = result.rows[0] || (await client.query('SELECT * FROM crm_requirements_investment WHERE id=$1 AND company_id=$2', [id, context.companyId])).rows[0];
      if (!row) throw new Error('The saved requirement could not be read back.');
      await client.query('COMMIT');
      return receipt(row, 'created', result.rows.length === 0);
    }
    const existing = (await client.query('SELECT * FROM crm_requirements_investment WHERE id=$1 AND company_id=$2 FOR UPDATE', [args.id, context.companyId])).rows[0];
    if (!existing) { await client.query('ROLLBACK'); return failure('No investment requirement with that ID belongs to this landlord. Nothing was saved.'); }
    const updates: Record<string, any> = {};
    const map = { name: 'name', contactName: 'contact_name', use: 'use_types', requirementType: 'requirement_types', size: 'size_range', requirementLocations: 'requirement_locations' };
    for (const [key, column] of Object.entries(map)) if (args[key] !== undefined) updates[column] = args[key];
    if (args.budget !== undefined && args.size === undefined) updates.size_range = args.budget ? [args.budget] : [];
    if (args.location !== undefined) { updates.locations = args.location; if (args.requirementLocations === undefined) updates.requirement_locations = args.location ? [args.location] : []; }
    if (args.status !== undefined) updates.status = statusName(args.status);
    if (brief) updates.comments = !existing.comments ? brief : existing.comments.includes(brief) ? existing.comments : `${existing.comments}\n\n${brief}`;
    if (!Object.keys(updates).length) { await client.query('ROLLBACK'); return failure('No requirement fields were supplied to update. Nothing was saved.'); }
    const entries = Object.entries(updates);
    const result = await client.query(`UPDATE crm_requirements_investment SET ${entries.map(([column], i) => `${column}=$${i + 3}`).join(',')},updated_at=now() WHERE id=$1 AND company_id=$2 RETURNING *`, [args.id, context.companyId, ...entries.map(([, value]) => value)]);
    if (!result.rows[0]) throw new Error('The saved requirement could not be read back.');
    await client.query('COMMIT');
    return receipt(result.rows[0], 'updated');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function executeLandlordRequirementTool(req: Request, context: Omit<Context, 'userId'>, tool: string, args: unknown) {
  const userId = req.session?.userId || (req as any).tokenUserId;
  const { canReadLandlordMeetings } = await import('./landlord-meetings');
  const { isInternalLandlordThread, LANDLORD_RELATIONSHIP_SQL } = await import('./landlord-relationship-brief');
  const { pool } = await import('./db');
  if (!userId || !await canReadLandlordMeetings(req) || !await isInternalLandlordThread(context.threadId)) return { data: { success: false, error: 'This action is available in internal staff landlord conversations only.' } };
  const company = (await pool.query(LANDLORD_RELATIONSHIP_SQL, [context.companyId])).rows[0];
  const thread = (await pool.query("SELECT id FROM chat_threads WHERE id=$1 AND linked_type='company' AND linked_id=$2", [context.threadId, context.companyId])).rows[0];
  if (!company?.is_landlord || !thread) return { data: { success: false, error: 'The linked landlord could not be verified. Nothing was saved.' } };
  const result = await runLandlordRequirementTool(pool, { ...context, userId }, tool, args);
  if (tool !== 'search_landlord_requirements') {
    const { logAudit } = await import('./sql-tools');
    await logAudit({ tableName: 'crm_requirements_investment', op: tool === 'create_requirement' ? 'INSERT' : 'UPDATE', data: args,
      where: { companyId: context.companyId, id: (result.data as any).id }, affectedRows: result.data.success ? 1 : 0,
      userId, threadId: context.threadId, success: result.data.success, error: (result.data as any).error });
  }
  return result;
}
