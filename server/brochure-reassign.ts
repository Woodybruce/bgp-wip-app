// Move a brochure filed on the wrong property, with what its ingest put
// there (feedback #78/#79, 13 Nov 2026: the Cavendish House IM landed on 9
// Conduit Street, and sql_write could not touch property_brochures). One
// audited operation, Preview then Apply, reversible by batch:
// - the property_brochures row (same stored PDF, same id) moves, with a
//   line in its notes saying where it came from;
// - images the ingest stamped `brochure:<id>` move with it; one the target
//   already has is moved hidden, so nothing is duplicated or deleted;
// - tenancy rows the ingest stamped `[brochure:<id>]` move, unless the
//   target already has that tenant on that unit (then the stamped copy is
//   removed: the ingest itself replaces those rows on every re-run);
// - extract blocks in the old property's notes that name the target
//   building (and not the old one) come out of the old notes. They are not
//   copied onto the target, whose own record of the brochure stands; the
//   removed text is kept in the log.
// Property fields the ingest only fills when blank are not guessed at.
import { pool } from "./db";
import type { Querier } from "./account-resolver";

type Change = { table: string; id: string; action: "moved" | "moved hidden" | "removed" | "updated"; detail: string; prior: any };

const BLOCK_SPLIT = /(?=^--- Brochure extract \()/m;

async function log(q: Querier, batch: string, c: Change) {
  await q.query(
    `INSERT INTO investment_comp_migration_log (batch, table_name, record_id, action, prior, note) VALUES ($1, $2, $3, $4, $5, $6)`,
    [batch, c.table, c.id, c.action, c.prior ? JSON.stringify(c.prior) : null, c.detail],
  );
}

/** Words that name a building ("cavendish house", "18 cavendish sq"). */
async function buildingTerms(name: string, address: any, opts: { streetOnly: boolean } = { streetOnly: true }): Promise<string[]> {
  const { addressKey } = await import("./investment-sale-evidence");
  const a = address && typeof address === "object" ? address : {};
  const parts = [name, a.street, a.line, a.line1, a.formatted].filter((v) => typeof v === "string" && v.trim()).flatMap((v: string) => v.split(","));
  const keys = parts.map((p) => addressKey(p)).filter((k) => (k.length >= 8 && /\s/.test(k)) || (k.length >= 6 && !/\d/.test(k) && !/\s/.test(k)));
  // The street on its own too ("cavendish sq"): extract blocks rarely
  // repeat the number ("fronting Cavendish Square").
  const streets = keys.filter((k) => /^\d/.test(k)).map((k) => k.replace(/^(\d+\s)+/, "")).filter((k) => k.length >= 8 && /\s/.test(k));
  return Array.from(new Set([...keys, ...(opts.streetOnly ? streets : [])]));
}

export async function reassignBrochure(args: { brochureId: string; toPropertyId: string; apply: boolean; actorId?: string | null; reason?: string | null }) {
  const q: Querier = pool;
  const { rows: [b] } = await q.query(`SELECT id, property_id, original_name, type, notes FROM property_brochures WHERE id = $1`, [args.brochureId]);
  if (!b) return { ok: false, error: "Brochure not found" };
  const fromId: string = b.property_id;
  if (fromId === args.toPropertyId) return { ok: false, error: "The brochure is already on that property" };
  const { rows: props } = await q.query(`SELECT id, name, address, notes FROM crm_properties WHERE id = ANY($1::text[])`, [[fromId, args.toPropertyId]]);
  const from = props.find((p: any) => p.id === fromId);
  const to = props.find((p: any) => p.id === args.toPropertyId);
  if (!to) return { ok: false, error: "Target property not found" };
  const batch = `brochure-move-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const changes: Change[] = [];
  const tag = `brochure:${b.id}`;

  // 1. The brochure row itself.
  const moveNote = `Moved from ${from?.name || fromId} to ${to.name} on ${new Date().toISOString().slice(0, 10)}${args.reason ? ` (${args.reason})` : ""}.`;
  changes.push({ table: "property_brochures", id: b.id, action: "moved", detail: `${b.original_name}: ${from?.name || fromId} → ${to.name}`, prior: { property_id: fromId, notes: b.notes } });

  // 2. Images the ingest stamped with this brochure.
  const { rows: assets } = await q.query(
    `SELECT a.id, a.property_id, a.image_studio_id, a.kind, COALESCE(a.pinned, false) AS pinned, COALESCE(a.hidden, false) AS hidden
       FROM property_imagery_assets a JOIN image_studio_images i ON i.id = a.image_studio_id
      WHERE a.property_id = $1 AND $2 = ANY(i.tags)`, [fromId, tag]);
  const { rows: targetHas } = await q.query(`SELECT image_studio_id FROM property_imagery_assets WHERE property_id = $1`, [args.toPropertyId]);
  const have = new Set(targetHas.map((r: any) => r.image_studio_id));
  for (const a of assets) {
    changes.push({ table: "property_imagery_assets", id: a.id, action: have.has(a.image_studio_id) ? "moved hidden" : "moved", detail: `${a.kind} image`, prior: { property_id: a.property_id, pinned: a.pinned, hidden: a.hidden } });
  }
  const { rows: studio } = await q.query(`SELECT id, property_id FROM image_studio_images WHERE $1 = ANY(tags) AND property_id IS DISTINCT FROM $2`, [tag, args.toPropertyId]);

  // 3. Tenancy rows the ingest stamped with this brochure.
  const { rows: tenancy } = await q.query(`SELECT * FROM tenancy_schedule_units WHERE property_id = $1 AND comments LIKE $2`, [fromId, `%[brochure:${b.id}]%`]);
  const { rows: targetTenancy } = await q.query(`SELECT * FROM tenancy_schedule_units WHERE property_id = $1`, [args.toPropertyId]);
  const norm = (v: any) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const t of tenancy) {
    const dup = targetTenancy.some((x: any) => norm(x.tenant_name) && norm(x.tenant_name) === norm(t.tenant_name) && (!norm(t.unit_number) || norm(x.unit_number) === norm(t.unit_number)));
    changes.push({ table: "tenancy_schedule_units", id: t.id, action: dup ? "removed" : "moved", detail: `${t.unit_number || "unit"} — ${t.tenant_name || "no tenant"}${dup ? " (already on the target)" : ""}`, prior: t });
  }

  // 4. Extract blocks in the old notes that are about the target building.
  let newFromNotes: string | null = null;
  const removedBlocks: string[] = [];
  if (from?.notes) {
    const targetTerms = await buildingTerms(to.name, to.address);
    // The old property's own building, by name and numbered street only:
    // a bare street ("conduit st") would also catch Devlin House at 24-25
    // Conduit Street.
    const fromTerms = await buildingTerms(from.name, from.address, { streetOnly: false });
    const { addressKey } = await import("./investment-sale-evidence");
    const blocks = String(from.notes).split(BLOCK_SPLIT);
    const kept = blocks.filter((blk) => {
      if (!/^--- Brochure extract \(/.test(blk)) return true;
      const k = ` ${addressKey(blk)} `;
      const aboutTarget = targetTerms.some((t) => k.includes(` ${t} `));
      const aboutFrom = fromTerms.some((t) => k.includes(` ${t} `));
      if (aboutTarget && !aboutFrom) { removedBlocks.push(blk.trim()); return false; }
      return true;
    });
    if (removedBlocks.length) {
      newFromNotes = kept.join("").replace(/\n{3,}/g, "\n\n").trim();
      changes.push({ table: "crm_properties", id: fromId, action: "updated", detail: `${removedBlocks.length} brochure extract block(s) about ${to.name} taken out of the notes`, prior: { notes: from.notes } });
    }
  }

  if (args.apply) {
    await q.query(`UPDATE property_brochures SET property_id = $2, notes = TRIM(BOTH E'\n' FROM COALESCE(notes, '') || E'\n' || $3), updated_at = NOW() WHERE id = $1`, [b.id, args.toPropertyId, moveNote]);
    for (const a of assets) {
      await q.query(`UPDATE property_imagery_assets SET property_id = $2, pinned = CASE WHEN $3 THEN false ELSE pinned END, hidden = CASE WHEN $3 THEN true ELSE hidden END WHERE id = $1`,
        [a.id, args.toPropertyId, have.has(a.image_studio_id)]);
    }
    for (const s of studio) {
      await q.query(`UPDATE image_studio_images SET property_id = $2 WHERE id = $1`, [s.id, args.toPropertyId]);
      await log(q, batch, { table: "image_studio_images", id: s.id, action: "moved", detail: "image file record", prior: { property_id: s.property_id } });
    }
    for (const c of changes.filter((x) => x.table === "tenancy_schedule_units")) {
      if (c.action === "removed") await q.query(`DELETE FROM tenancy_schedule_units WHERE id = $1`, [c.id]);
      else await q.query(`UPDATE tenancy_schedule_units SET property_id = $2 WHERE id = $1`, [c.id, args.toPropertyId]);
    }
    if (newFromNotes !== null) await q.query(`UPDATE crm_properties SET notes = $2, updated_at = NOW() WHERE id = $1`, [fromId, newFromNotes]);
    for (const c of changes) await log(q, batch, c);
  }
  return {
    ok: true,
    applied: args.apply,
    batch: args.apply ? batch : null,
    brochure: { id: b.id, name: b.original_name, from: { id: fromId, name: from?.name }, to: { id: to.id, name: to.name } },
    changes: changes.map(({ prior, ...c }) => c),
    imageFileRecords: studio.length,
    removedNoteBlocks: removedBlocks.map((x) => x.slice(0, 160)),
  };
}

/** Put a brochure move back exactly as it was. */
export async function undoBrochureMove(batch: string) {
  const q: Querier = pool;
  const { rows } = await q.query(`SELECT * FROM investment_comp_migration_log WHERE batch = $1 AND batch LIKE 'brochure-move-%' ORDER BY id DESC`, [batch]);
  for (const r of rows) {
    const p = typeof r.prior === "string" ? JSON.parse(r.prior) : r.prior;
    if (!p) continue;
    if (r.table_name === "property_brochures") await q.query(`UPDATE property_brochures SET property_id = $2, notes = $3, archived = COALESCE($4, archived) WHERE id = $1`, [r.record_id, p.property_id, p.notes, p.archived ?? null]);
    else if (r.table_name === "property_imagery_assets") await q.query(`UPDATE property_imagery_assets SET property_id = $2, pinned = $3, hidden = $4 WHERE id = $1`, [r.record_id, p.property_id, p.pinned, p.hidden]);
    else if (r.table_name === "image_studio_images") await q.query(`UPDATE image_studio_images SET property_id = $2 WHERE id = $1`, [r.record_id, p.property_id]);
    else if (r.table_name === "crm_properties") await q.query(`UPDATE crm_properties SET notes = $2 WHERE id = $1`, [r.record_id, p.notes]);
    else if (r.table_name === "tenancy_schedule_units") {
      if (r.action === "removed") {
        const cols = Object.keys(p);
        await q.query(`INSERT INTO tenancy_schedule_units (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) ON CONFLICT (id) DO NOTHING`, cols.map((c) => p[c]));
      } else await q.query(`UPDATE tenancy_schedule_units SET property_id = $2 WHERE id = $1`, [r.record_id, p.property_id]);
    }
  }
  return { batch, undone: rows.length };
}

/** Take a brochure off a property for good (archived, so it can be brought
 *  back) with what its ingest put there: stamped images are hidden,
 *  stamped tenancy rows removed, and extract blocks naming `noteTerms` (and
 *  not the property itself) taken out of the notes. All logged by batch. */
export async function removeBrochure(args: { brochureId: string; apply: boolean; noteTerms?: string[]; reason?: string | null }) {
  const q: Querier = pool;
  const { addressKey } = await import("./investment-sale-evidence");
  const { rows: [b] } = await q.query(`SELECT id, property_id, original_name, notes, COALESCE(archived, false) AS archived FROM property_brochures WHERE id = $1`, [args.brochureId]);
  if (!b) return { ok: false, error: "Brochure not found" };
  const { rows: [p] } = await q.query(`SELECT id, name, address, notes FROM crm_properties WHERE id = $1`, [b.property_id]);
  const batch = `brochure-move-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const tag = `brochure:${b.id}`;
  const changes: Change[] = [{ table: "property_brochures", id: b.id, action: "removed", detail: `${b.original_name} archived on ${p?.name || b.property_id}`, prior: { property_id: b.property_id, notes: b.notes, archived: b.archived } }];
  const { rows: assets } = await q.query(
    `SELECT a.id, a.property_id, COALESCE(a.pinned, false) AS pinned, COALESCE(a.hidden, false) AS hidden FROM property_imagery_assets a JOIN image_studio_images i ON i.id = a.image_studio_id
      WHERE a.property_id = $1 AND $2 = ANY(i.tags)`, [b.property_id, tag]);
  for (const a of assets) changes.push({ table: "property_imagery_assets", id: a.id, action: "updated", detail: "image hidden", prior: { property_id: a.property_id, pinned: a.pinned, hidden: a.hidden } });
  const { rows: tenancy } = await q.query(`SELECT * FROM tenancy_schedule_units WHERE property_id = $1 AND comments LIKE $2`, [b.property_id, `%[brochure:${b.id}]%`]);
  for (const t of tenancy) changes.push({ table: "tenancy_schedule_units", id: t.id, action: "removed", detail: `${t.unit_number || "unit"} — ${t.tenant_name || "no tenant"}`, prior: t });
  const terms = (args.noteTerms || []).map((t) => addressKey(t)).filter(Boolean);
  const ownTerms = p ? await buildingTerms(p.name, p.address, { streetOnly: false }) : [];
  const removed: string[] = [];
  let newNotes: string | null = null;
  if (p?.notes && terms.length) {
    const kept = String(p.notes).split(BLOCK_SPLIT).filter((blk) => {
      if (!/^--- Brochure extract \(/.test(blk)) return true;
      const k = ` ${addressKey(blk)} `;
      if (terms.some((t) => k.includes(` ${t} `)) && !ownTerms.some((t) => k.includes(` ${t} `))) { removed.push(blk.trim()); return false; }
      return true;
    });
    if (removed.length) {
      newNotes = kept.join("").replace(/\n{3,}/g, "\n\n").trim();
      changes.push({ table: "crm_properties", id: p.id, action: "updated", detail: `${removed.length} brochure extract block(s) taken out of the notes`, prior: { notes: p.notes } });
    }
  }
  if (args.apply) {
    await q.query(`UPDATE property_brochures SET archived = true, notes = TRIM(BOTH E'\n' FROM COALESCE(notes, '') || E'\n' || $2), updated_at = NOW() WHERE id = $1`,
      [b.id, `Removed from ${p?.name || b.property_id} on ${new Date().toISOString().slice(0, 10)}${args.reason ? ` (${args.reason})` : ""}.`]);
    for (const a of assets) await q.query(`UPDATE property_imagery_assets SET hidden = true, pinned = false WHERE id = $1`, [a.id]);
    for (const t of tenancy) await q.query(`DELETE FROM tenancy_schedule_units WHERE id = $1`, [t.id]);
    if (newNotes !== null) await q.query(`UPDATE crm_properties SET notes = $2, updated_at = NOW() WHERE id = $1`, [p.id, newNotes]);
    for (const c of changes) await log(q, batch, c);
  }
  return { ok: true, applied: args.apply, batch: args.apply ? batch : null, brochure: { id: b.id, name: b.original_name, property: p?.name }, changes: changes.map(({ prior, ...c }) => c), removedNoteBlocks: removed.map((x) => x.slice(0, 160)) };
}
