// Deck assembler — turns a deck's locked cards into a designed PDF.
//
// Strategy: build a markdown brief from each locked card's structured
// content, concatenate in sort order, and hand to generateClaudeDesignedPdf
// with the deck's template pdf_scope. The PDF designer already knows BGP
// house style and accumulates document_design_preferences per scope, so
// we don't repeat that knowledge here — we just produce a faithful,
// structured brief from the cards.
//
// Each card type renders to its own markdown shape. Unknown types
// gracefully fall through to a generic title + JSON dump so adding new
// card types doesn't break assembly.

import { pool } from "./db";
import { generateClaudeDesignedPdf } from "./claude-designed-pdf";

// Wide content type — each card type defines its own shape. We're
// intentionally permissive so the assembler doesn't crash on
// half-edited cards.
type CardContent = Record<string, any> | null;

function renderCover(c: CardContent, title: string | null): string {
  const t = title || "Cover";
  const subtitle = (c?.subtitle || "").trim();
  const hero = (c?.hero || "").trim();
  return [
    `# ${t}`,
    subtitle ? `**${subtitle}**` : "",
    hero ? `_${hero}_` : "",
  ].filter(Boolean).join("\n\n");
}

function renderNarrative(c: CardContent, title: string | null): string {
  const md = String(c?.markdown || "").trim();
  return [
    title ? `## ${title}` : "",
    md || "_(empty)_",
  ].filter(Boolean).join("\n\n");
}

function renderImage(c: CardContent, title: string | null): string {
  const caption = (c?.caption || "").trim();
  const id = c?.imageStudioId || c?.imageId;
  return [
    title ? `## ${title}` : "",
    id ? `**Image (Image Studio · ${id})**` : "_(no image attached)_",
    caption,
  ].filter(Boolean).join("\n\n");
}

function renderImageGrid(c: CardContent, title: string | null): string {
  const ids: string[] = Array.isArray(c?.imageIds) ? c.imageIds : [];
  return [
    title ? `## ${title}` : "",
    ids.length ? `Image grid (${ids.length} images): ${ids.join(", ")}` : "_(no images selected)_",
  ].filter(Boolean).join("\n\n");
}

function renderMap(c: CardContent, title: string | null): string {
  const propertyId = c?.propertyId;
  const zoom = c?.zoom || "default";
  return [
    title ? `## ${title}` : "",
    propertyId ? `Map of property ${propertyId} (zoom: ${zoom}).` : "_(no map target)_",
  ].filter(Boolean).join("\n\n");
}

function renderKpiBlock(c: CardContent, title: string | null): string {
  const kpis: Array<{ label?: string; value?: string; note?: string }> = Array.isArray(c?.kpis) ? c.kpis : [];
  if (!kpis.length) return [title ? `## ${title}` : "", "_(no KPIs entered)_"].filter(Boolean).join("\n\n");
  const lines = kpis.map(k => {
    const label = (k.label || "").trim();
    const value = (k.value || "").trim();
    const note = (k.note || "").trim();
    return `- **${value || "—"}** — ${label}${note ? ` _(${note})_` : ""}`;
  });
  return [title ? `## ${title}` : "", ...lines].filter(Boolean).join("\n");
}

function renderDataTable(c: CardContent, title: string | null): string {
  const headers: string[] = Array.isArray(c?.headers) ? c.headers : [];
  const rows: string[][] = Array.isArray(c?.rows) ? c.rows : [];
  if (!headers.length || !rows.length) {
    return [title ? `## ${title}` : "", "_(empty table)_"].filter(Boolean).join("\n\n");
  }
  const headerLine = `| ${headers.join(" | ")} |`;
  const sepLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map(r => `| ${r.map(cell => String(cell ?? "")).join(" | ")} |`);
  return [title ? `## ${title}` : "", headerLine, sepLine, ...rowLines].filter(Boolean).join("\n");
}

function renderModelLink(c: CardContent, title: string | null): string {
  const ref = c?.modelRef || c?.fileName || c?.filename || c?.url;
  const summary = (c?.summary || "").trim();
  return [
    title ? `## ${title}` : "",
    ref ? `**Linked model:** ${ref}` : "_(no model attached)_",
    summary,
  ].filter(Boolean).join("\n\n");
}

function renderRiskRegister(c: CardContent, title: string | null): string {
  const items: Array<{ risk?: string; mitigant?: string; severity?: string }> = Array.isArray(c?.items) ? c.items : [];
  if (!items.length) return [title ? `## ${title}` : "", "_(no risks logged)_"].filter(Boolean).join("\n\n");
  const lines = items.map(i => {
    const risk = (i.risk || "").trim();
    const mit = (i.mitigant || "").trim();
    const sev = (i.severity || "").trim();
    return `- **${risk || "Risk"}**${sev ? ` _(${sev})_` : ""}${mit ? ` — _Mitigant:_ ${mit}` : ""}`;
  });
  return [title ? `## ${title}` : "", ...lines].filter(Boolean).join("\n");
}

function renderNextSteps(c: CardContent, title: string | null): string {
  const items: Array<string | { action?: string; owner?: string; by?: string }> = Array.isArray(c?.items) ? c.items : [];
  if (!items.length) return [title ? `## ${title}` : "", "_(no actions listed)_"].filter(Boolean).join("\n\n");
  const lines = items.map(it => {
    if (typeof it === "string") return `- ${it}`;
    const a = (it.action || "").trim();
    const owner = (it.owner || "").trim();
    const by = (it.by || "").trim();
    return `- ${a}${owner ? ` _(${owner}${by ? `, by ${by}` : ""})_` : ""}`;
  });
  return [title ? `## ${title}` : "", ...lines].filter(Boolean).join("\n");
}

function renderSignatureBlock(c: CardContent, title: string | null): string {
  const team: Array<string | { name?: string; role?: string; email?: string }> = Array.isArray(c?.team) ? c.team : [];
  const fee = (c?.fee || "").trim();
  const lines: string[] = [];
  if (title) lines.push(`## ${title}`);
  if (team.length) {
    lines.push("**Team:**");
    for (const m of team) {
      if (typeof m === "string") lines.push(`- ${m}`);
      else lines.push(`- ${m.name || "—"}${m.role ? ` · ${m.role}` : ""}${m.email ? ` · ${m.email}` : ""}`);
    }
  }
  if (fee) {
    lines.push("");
    lines.push(`**Fee structure:** ${fee}`);
  }
  if (lines.length === (title ? 1 : 0)) lines.push("_(no signature details)_");
  return lines.join("\n");
}

const RENDERERS: Record<string, (c: CardContent, title: string | null) => string> = {
  cover: renderCover,
  narrative: renderNarrative,
  image: renderImage,
  image_grid: renderImageGrid,
  map: renderMap,
  kpi_block: renderKpiBlock,
  data_table: renderDataTable,
  model_link: renderModelLink,
  risk_register: renderRiskRegister,
  next_steps: renderNextSteps,
  signature_block: renderSignatureBlock,
};

export async function assembleDeck(deckId: string): Promise<
  | { success: true; downloadUrl: string; chatMediaFilename: string; title: string; cardCount: number }
  | { success: false; error: string }
> {
  const deckRes = await pool.query(
    `SELECT d.*, t.pdf_scope FROM decks d
     LEFT JOIN deck_templates t ON t.key = d.template_key
     WHERE d.id = $1`,
    [deckId]
  );
  const deck = deckRes.rows[0];
  if (!deck) return { success: false, error: "Deck not found" };

  const cardsRes = await pool.query(
    `SELECT * FROM deck_cards WHERE deck_id = $1 AND state = 'locked' ORDER BY sort_order, created_at`,
    [deckId]
  );
  const cards = cardsRes.rows;
  if (!cards.length) return { success: false, error: "No locked cards — lock at least one card before assembling." };

  const sections: string[] = [];
  for (const c of cards) {
    const renderer = RENDERERS[c.type] || ((cc: CardContent, t: string | null) =>
      [t ? `## ${t}` : `## ${c.type}`, "```json", JSON.stringify(cc, null, 2), "```"].filter(Boolean).join("\n")
    );
    const md = renderer(c.content as CardContent, c.title);
    if (md && md.trim()) sections.push(md);
  }

  if (sections.length === 0) {
    return { success: false, error: "Locked cards rendered to no content — check that the cards have content set." };
  }

  // Header preamble — gives the designer enough scaffolding to build a
  // proper cover slide even if the deck's cover card is sparse.
  const preamble = [
    `# ${deck.name}`,
    deck.notes ? `\n${deck.notes}` : "",
  ].join("\n");

  const brief = [preamble, "", ...sections].join("\n\n").trim();

  const designed = await generateClaudeDesignedPdf({
    title: deck.name,
    brief,
    scope: deck.pdf_scope || "general",
    additionalInstructions: `Designed from a BGP Deck (${cards.length} locked cards, template "${deck.template_key}"). Each ## heading is a separate slide. Preserve the order of sections.`,
  });

  if ("error" in designed) {
    return { success: false, error: designed.error };
  }

  // Stamp the deck status as 'ready' once it's been successfully
  // assembled so the list view reflects the milestone.
  await pool.query(
    `UPDATE decks SET status = CASE WHEN status = 'draft' THEN 'ready' ELSE status END,
                       updated_at = NOW() WHERE id = $1`,
    [deckId]
  ).catch(() => {});

  // Index into the Document Studio library so every assembled deck shows in the
  // hub (with a page preview). Best-effort — never fail assembly over indexing.
  try {
    const { getFile } = await import("./file-storage");
    const storageKey = `chat-media/${designed.chatMediaFilename}`;
    const file = await getFile(storageKey);
    if (file) {
      const { upsertDocumentForDeck } = await import("./documents");
      await upsertDocumentForDeck({
        deckId, title: deck.name, category: deck.template_key || "deck",
        buffer: file.data, fileName: `${deck.name}.pdf`, storageKey, contentType: "application/pdf",
      });
    }
  } catch (e: any) { console.warn("[deck-assembler] library index:", e?.message); }

  return {
    success: true,
    downloadUrl: designed.downloadUrl,
    chatMediaFilename: designed.chatMediaFilename,
    title: designed.title,
    cardCount: cards.length,
  };
}
