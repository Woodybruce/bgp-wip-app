import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { calendarDateValue } from "../shared/calendar-date";

const id = z.string().trim().min(1).max(200);
const date = z.string().refine(value => !!calendarDateValue(value) && Number.isFinite(Date.parse(value)), "Enter a valid date").nullable();
const fields = z.object({
  brandCompanyId: id,
  agentCompanyId: id.nullable().optional(),
  primaryContactId: id.nullable().optional(),
  agentType: z.enum(["tenant_rep", "landlord_rep", "investment"]),
  region: z.string().trim().max(200).nullable().optional(),
  startDate: date.optional(), endDate: date.optional(),
  notes: z.string().max(20000).nullable().optional(),
});

function invalid(message: string, status = 400) { return Object.assign(new Error(message), { status }); }
function parse(input: unknown, partial = false) {
  const result = (partial ? fields.omit({ brandCompanyId: true }).partial() : fields).safeParse(input);
  if (!result.success) throw invalid(result.error.issues.map(issue => issue.message).join("; "));
  return result.data;
}
function normaliseInput(body: any) {
  return Object.fromEntries(Object.entries(body || {}).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
}
async function transact<T>(pool: Pick<Pool, "connect">, work: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try { await db.query("BEGIN"); const result = await work(db); await db.query("COMMIT"); return result; }
  catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

async function validateParties(db: PoolClient, value: any, inferFirm: boolean) {
  const brand = (await db.query("SELECT id FROM crm_companies WHERE id=$1 AND merged_into_id IS NULL FOR SHARE", [value.brandCompanyId])).rows[0];
  if (!brand) throw invalid("Brand company not found", 404);
  const contact = value.primaryContactId
    ? (await db.query("SELECT id,company_id FROM crm_contacts WHERE id=$1 FOR SHARE", [value.primaryContactId])).rows[0] : null;
  if (value.primaryContactId && !contact) throw invalid("Agent contact not found", 404);
  let firmId = inferFirm ? null : value.agentCompanyId || null;
  if (inferFirm && contact?.company_id && contact.company_id !== value.brandCompanyId) {
    const employer = (await db.query("SELECT id,company_type FROM crm_companies WHERE id=$1 AND merged_into_id IS NULL FOR SHARE", [contact.company_id])).rows[0];
    if (/^agent(?:\s|-|$)/i.test(employer?.company_type || "")) firmId = employer.id;
  }
  if (firmId) {
    if (firmId === value.brandCompanyId) throw invalid("A brand cannot be its own representing agent");
    const firm = (await db.query("SELECT id,company_type FROM crm_companies WHERE id=$1 AND merged_into_id IS NULL FOR SHARE", [firmId])).rows[0];
    if (!firm || !/^agent(?:\s|-|$)/i.test(firm.company_type || "")) throw invalid("Choose a company recorded as an agent firm, or add the named agent with their firm unconfirmed");
    if (contact && contact.company_id !== firmId) throw invalid("The selected firm does not match this contact's recorded employer. Choose the contact alone or correct their contact record first.");
  }
  if (!firmId && !contact) throw invalid("Choose an agent firm or a named agent contact");
  return firmId;
}

function validateDates(value: any) {
  if (value.startDate && value.endDate && new Date(value.endDate).getTime() < new Date(value.startDate).getTime()) throw invalid("End date must not be before start date");
}

export async function createBrandRepresentation(pool: Pick<Pool, "connect">, body: unknown) {
  const value = parse(normaliseInput(body)) as z.infer<typeof fields>;
  validateDates(value);
  return transact(pool, async db => {
    const firmId = await validateParties(db, value, value.agentCompanyId === undefined);
    const saved = await db.query(`INSERT INTO brand_agent_representations
      (brand_company_id,agent_company_id,agent_type,region,primary_contact_id,start_date,end_date,notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [value.brandCompanyId, firmId, value.agentType, value.region || null, value.primaryContactId || null, value.startDate || null, value.endDate || null, value.notes || null]);
    return saved.rows[0];
  });
}

export async function updateBrandRepresentation(pool: Pick<Pool, "connect">, representationId: string, body: unknown) {
  const patch = parse(normaliseInput(body), true);
  if (!Object.keys(patch).length) throw invalid("No representation fields to update");
  return transact(pool, async db => {
    const old = (await db.query("SELECT * FROM brand_agent_representations WHERE id=$1 FOR UPDATE", [representationId])).rows[0];
    if (!old) throw invalid("Representation not found", 404);
    const value = { ...normaliseInput(old), ...patch };
    validateDates(value);
    const partiesChanged = "agentCompanyId" in patch || "primaryContactId" in patch;
    if (partiesChanged) value.agentCompanyId = await validateParties(db, value, typeof patch.primaryContactId === "string" && !("agentCompanyId" in patch));
    const changes = { ...patch, ...(partiesChanged ? { agentCompanyId: value.agentCompanyId } : {}) };
    const entries = Object.entries(changes);
    const saved = await db.query(`UPDATE brand_agent_representations SET ${entries.map(([key], index) => `${key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}=$${index + 2}`).join(",")},updated_at=now() WHERE id=$1 RETURNING *`, [representationId,...entries.map(([,value]) => value)]);
    return saved.rows[0];
  });
}
