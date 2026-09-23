// UK trading entity from BGP's own deal records.
//
// Woody, 2026-09-23: "For Canary Wharf example a deal has happened so there
// should be some HOTs on the sharefolder … the app should check for both" —
// the website AND the deal paperwork. A done deal's heads of terms, lease or
// fee email names the contracting tenant ("New Letting to HGUK Restaurants
// Ltd on behalf of Canary Wharf Properties (RT5) Limited"), which is better
// evidence than any website scrape. This reads the indexed SharePoint files
// and deal emails (knowledge_base) that mention the brand, asks Claude which
// named company is the tenant, and accepts the answer only when its quote is
// really in the document and names the entity. Companies House confirmation
// stays with the caller (exact title or verified number, never similarity).
export type DealRecordDoc = { id: string; fileName: string; fileUrl: string | null; filePath: string | null; content: string };
export type DealRecordEntity = { entityName: string; chNumber: string | null; quote: string; doc: { id: string; fileName: string; fileUrl: string | null } };

const ENTITY_RE = /[A-Z0-9][A-Za-z0-9&'’().,\- ]{1,80}?\s(?:Limited|Ltd\.?|PLC|plc|LLP)\b/g;
const DEAL_DOC_RE = /\b(hots|heads of terms|heads|lease|agreement for lease|afl|licence|letting|fee|invoice)\b/i;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const legal = (s: string) => squash(s).toLowerCase().replace(/[.'’,]/g, "").replace(/\blimited\b/g, "ltd").replace(/[^a-z0-9]+/g, " ").trim();

/** The passages of a document that name registered companies — what the
 *  model reads, instead of whole leases. */
export function entityPassages(content: string, maxChars = 1800): string[] {
  const text = squash(content);
  const out: string[] = [];
  let used = 0;
  for (const match of text.matchAll(ENTITY_RE)) {
    const at = match.index ?? 0;
    const passage = text.slice(Math.max(0, at - 220), at + match[0].length + 160);
    if (out.some(p => p.includes(match[0]))) continue;
    out.push(passage);
    used += passage.length;
    if (used >= maxChars) break;
  }
  return out;
}

/** Accept the model's pick only when it is the tenant, its quote is really in
 *  that document, and the quote names the entity. */
export function checkedDealEntity(docs: DealRecordDoc[], answer: any): DealRecordEntity | null {
  if (!answer || answer.role !== "tenant" || typeof answer.entityName !== "string" || typeof answer.quote !== "string") return null;
  const doc = docs[Number(answer.doc) - 1];
  const entityName = squash(answer.entityName);
  const quote = squash(answer.quote);
  if (!doc || quote.length < 15 || !/\b(limited|ltd|plc|llp)\b\.?$/i.test(entityName)) return null;
  if (!squash(doc.content).includes(quote) || !` ${legal(quote)} `.includes(` ${legal(entityName)} `)) return null;
  let chNumber: string | null = typeof answer.chNumber === "string" ? answer.chNumber.replace(/[^0-9A-Za-z]/g, "").toUpperCase() : null;
  if (chNumber && /^[0-9]+$/.test(chNumber) && chNumber.length < 8) chNumber = chNumber.padStart(8, "0");
  if (chNumber && (chNumber.length !== 8 || !squash(doc.content).replace(/\s/g, "").includes(chNumber.replace(/^0+/, "")))) chNumber = null;
  return { entityName, chNumber, quote, doc: { id: doc.id, fileName: doc.fileName, fileUrl: doc.fileUrl } };
}

async function dealRecordDocs(company: any): Promise<DealRecordDoc[]> {
  const name = squash(String(company?.name || ""));
  if (name.length < 3) return [];
  const like = `%${name.replace(/[\\%_]/g, m => `\\${m}`)}%`;
  const { pool } = await import("./db");
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = 20000");
    const rows = (await client.query(
      `SELECT id, file_name, file_url, file_path, content FROM knowledge_base
        WHERE to_tsvector('english', coalesce(file_name,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(content,'') || ' ' || coalesce(category,'')) @@ phraseto_tsquery('english', $1)
          AND (file_name ILIKE $2 OR content ILIKE $2) AND content ~* '\\m(ltd|limited|plc|llp)\\M'
        ORDER BY (file_name ~* '(hots|heads of terms|lease|agreement for lease)') DESC, (category IN ('deal_terms','legal')) DESC, last_modified DESC NULLS LAST
        LIMIT 12`, [name, like])).rows;
    return rows
      .filter((r: any) => DEAL_DOC_RE.test(`${r.file_name} ${r.file_path || ""}`) || /\b(tenant|letting|heads of terms)\b/i.test(r.content || ""))
      .slice(0, 6)
      .map((r: any) => ({ id: r.id, fileName: r.file_name, fileUrl: r.file_url, filePath: r.file_path, content: r.content || "" }));
  } finally {
    await client.query("RESET statement_timeout").catch(() => {});
    client.release();
  }
}

async function askForTenant(brand: string, docs: DealRecordDoc[]): Promise<any> {
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const blocks = docs.map((d, i) => `[${i + 1}] ${d.fileName}\n${entityPassages(d.content).join("\n…\n")}`).filter(b => b.includes("\n")).join("\n\n");
  if (!blocks) return null;
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const msg = await new Anthropic({ apiKey }).messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [{ role: "user", content: `These are extracts from Bruce Gillingham Pollard's own deal records (heads of terms, leases, fee emails) that mention the brand "${brand}". Which UK registered company is the TENANT / operator of ${brand} — the party taking the space? Not the landlord, not an agent, not a guarantor unless it is the tenant.

${blocks}

Reply with ONLY JSON: {"entityName": "<exact name as written, ending Ltd/Limited/PLC/LLP>", "chNumber": "<company number if written in the extract, else null>", "doc": <extract number>, "quote": "<the exact sentence from that extract naming the tenant, copied verbatim>", "role": "tenant"} — or {"role": null} if the extracts don't name ${brand}'s tenant entity.` }],
  });
  const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
  const json = text.match(/\{[\s\S]*\}/);
  return json ? JSON.parse(json[0]) : null;
}

/** The brand's tenant entity as named in BGP's own deal records, or null. */
export async function findTenantEntityInDealRecords(company: any, deps: { docs?: typeof dealRecordDocs; ask?: typeof askForTenant } = {}): Promise<DealRecordEntity | null> {
  const docs = await (deps.docs || dealRecordDocs)(company);
  if (!docs.length) return null;
  const answer = await (deps.ask || askForTenant)(squash(String(company.name)), docs);
  return checkedDealEntity(docs, answer);
}
