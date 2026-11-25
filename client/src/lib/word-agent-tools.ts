// The Word pane's half of ChatBGP-in-Word (server/office-agents.ts).
declare const Word: any;

const MAX_PARAS = 900;
const MAX_CHARS = 60000;

export async function readDocument(from?: number, to?: number): Promise<any> {
  return Word.run(async (ctx: any) => {
    const body = ctx.document.body;
    const paras = body.paragraphs;
    paras.load("items/text,items/style,items/tableNestingLevel");
    const sel = ctx.document.getSelection();
    sel.load("text");
    const tables = body.tables;
    tables.load("items/rowCount");
    await ctx.sync();
    const start = Math.max(1, Number(from) || 1);
    const end = Math.min(paras.items.length, Number(to) || paras.items.length);
    const lines: string[] = [];
    let chars = 0;
    for (let i = start; i <= end && lines.length < MAX_PARAS; i++) {
      const p = paras.items[i - 1];
      const text = String(p.text || "");
      if (!text.trim()) continue;
      const line = `[${i}]${p.style && p.style !== "Normal" ? ` (${p.style})` : ""}${p.tableNestingLevel ? " (table)" : ""} ${text}`;
      chars += line.length;
      if (chars > MAX_CHARS) { lines.push(`… stopped at paragraph ${i} — read from ${i} for more`); break; }
      lines.push(line);
    }
    return { paragraphs: paras.items.length, tables: tables.items.length, selection: String(sel.text || "").slice(0, 4000), text: lines.join("\n") };
  });
}

export async function documentName(): Promise<string> {
  try {
    const url = (window as any).Office?.context?.document?.url || "";
    return decodeURIComponent(String(url).split(/[\\/]/).pop() || "").split("?")[0];
  } catch { return ""; }
}

export async function setTracking(on: boolean): Promise<boolean> {
  try {
    await Word.run(async (ctx: any) => { ctx.document.changeTrackingMode = on ? "TrackAll" : "Off"; await ctx.sync(); });
    return true;
  } catch { return false; }
}

const HEADER_KINDS = ["Primary", "FirstPage", "EvenPages"];

// Every header and footer body in the document (each section's primary,
// first-page and even-page ones).
async function headerFooterBodies(ctx: any, want: { headers?: boolean; footers?: boolean } = { headers: true, footers: true }): Promise<any[]> {
  const sections = ctx.document.sections;
  sections.load("items");
  await ctx.sync();
  const out: any[] = [];
  for (const s of sections.items) for (const k of HEADER_KINDS) {
    if (want.headers) out.push(s.getHeader(k));
    if (want.footers) out.push(s.getFooter(k));
  }
  return out;
}

async function logoBase64(variant: string): Promise<{ data: string; width: number; height: number }> {
  const url = variant === "holder" ? "/brand-logos/bgp-black-holder.png" : "/brand-logos/bgp-black-wordmark.png";
  const blob = await (await fetch(url)).blob();
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error("Could not read BGP's logo"));
    r.readAsDataURL(blob);
  });
  const size = await new Promise<{ width: number; height: number }>(resolve => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 1510, height: 596 });
    img.src = url;
  });
  return { data, ...size };
}

const WRITES = new Set(["word_insert", "word_replace_text", "word_insert_table"]);

export async function runWordTool(name: string, a: any, opts: { suggest: boolean }): Promise<any> {
  try {
    if (WRITES.has(name) && opts.suggest) await setTracking(true);
    switch (name) {
      case "word_read_document":
        return await readDocument(a.fromParagraph, a.toParagraph);
      case "word_insert":
        return await Word.run(async (ctx: any) => {
          const body = ctx.document.body;
          const html = String(a.html || "");
          if (a.location === "replaceSelection") ctx.document.getSelection().insertHtml(html, "Replace");
          else if (a.location === "afterSelection") ctx.document.getSelection().insertHtml(html, "After");
          else if (a.location === "start") body.insertHtml(html, "Start");
          else if (a.location === "end") body.insertHtml(html, "End");
          else {
            const paras = body.paragraphs;
            paras.load("items");
            await ctx.sync();
            const p = paras.items[Number(a.paragraphIndex) - 1];
            if (!p) return { error: `There's no paragraph ${a.paragraphIndex}.` };
            if (a.location === "replaceParagraph") p.getRange("Content").insertHtml(html, "Replace");
            else p.getRange("Whole").insertHtml(html, "After");
          }
          await ctx.sync();
          return { done: `Wrote into the document${opts.suggest ? " as tracked changes" : ""}.` };
        });
      case "word_replace_text":
        return await Word.run(async (ctx: any) => {
          const hits = ctx.document.body.search(String(a.search || ""), { matchCase: !!a.matchCase });
          hits.load("items");
          await ctx.sync();
          const targets = a.all === false ? hits.items.slice(0, 1) : hits.items;
          for (const h of targets) h.insertText(String(a.replacement ?? ""), "Replace");
          await ctx.sync();
          return { done: `Replaced ${targets.length} match${targets.length === 1 ? "" : "es"}${opts.suggest ? " as tracked changes" : ""}.`, count: targets.length };
        });
      case "word_insert_table":
        return await Word.run(async (ctx: any) => {
          const rows: string[][] = (a.rows || []).map((r: any[]) => r.map(c => String(c ?? "")));
          const cols = Math.max(1, ...rows.map(r => r.length));
          const values = rows.map(r => Array.from({ length: cols }, (_, i) => r[i] ?? ""));
          let table: any;
          if (a.location === "afterParagraph") {
            const paras = ctx.document.body.paragraphs;
            paras.load("items");
            await ctx.sync();
            const p = paras.items[Number(a.paragraphIndex) - 1];
            if (!p) return { error: `There's no paragraph ${a.paragraphIndex}.` };
            table = p.insertTable(values.length, cols, "After", values);
          } else if (a.location === "afterSelection") {
            table = ctx.document.getSelection().insertTable(values.length, cols, "After", values);
          } else {
            table = ctx.document.body.insertTable(values.length, cols, "End", values);
          }
          table.headerRowCount = 1;
          await ctx.sync();
          return { done: `Added a ${values.length}×${cols} table.` };
        });
      case "word_add_comment":
        return await Word.run(async (ctx: any) => {
          let range: any;
          if (a.search) {
            const hits = ctx.document.body.search(String(a.search), { matchCase: false });
            hits.load("items");
            await ctx.sync();
            range = hits.items[0];
            if (!range) return { error: `Couldn't find "${a.search}".` };
          } else range = ctx.document.getSelection();
          range.insertComment(String(a.text || ""));
          await ctx.sync();
          return { done: "Added a comment." };
        });
      case "word_set_font_color":
        return await Word.run(async (ctx: any) => {
          const color = /^#[0-9a-f]{6}$/i.test(String(a.color || "")) ? String(a.color) : "#000000";
          const where = String(a.where || "everything");
          let n = 0;
          if (where === "search") {
            const hits = ctx.document.body.search(String(a.search || ""), { matchCase: false });
            hits.load("items");
            await ctx.sync();
            for (const h of hits.items) h.font.color = color;
            n = hits.items.length;
            await ctx.sync();
            return { done: `Coloured ${n} match${n === 1 ? "" : "es"} ${color}.` };
          }
          if (where === "everything" || where === "body") {
            // The whole range takes in each paragraph mark, which list numbers follow.
            ctx.document.body.getRange("Whole").font.color = color;
            const paras = ctx.document.body.paragraphs;
            paras.load("items");
            await ctx.sync();
            for (const p of paras.items) p.getRange("Whole").font.color = color;
          }
          if (where === "everything" || where === "headersFooters") {
            const bodies = await headerFooterBodies(ctx);
            for (const b of bodies) { b.getRange("Whole").font.color = color; n++; }
          }
          await ctx.sync();
          return { done: `Set the text to ${color === "#000000" ? "black" : color}${where === "everything" ? " in the body, numbering, headers and footers" : where === "body" ? " in the body" : " in the headers and footers"}.` };
        });
      case "word_set_logo":
        return await Word.run(async (ctx: any) => {
          const logo = await logoBase64(String(a.variant || "wordmark"));
          const headers = await headerFooterBodies(ctx, { headers: true });
          const pics = headers.map(h => { const p = h.inlinePictures; p.load("items/height,items/width"); return p; });
          await ctx.sync();
          let replaced = 0, added = 0;
          for (let i = 0; i < headers.length; i++) {
            for (const pic of pics[i].items) {
              const height = Number(pic.height) || 34;
              const placed = pic.insertInlinePictureFromBase64(logo.data, "Replace");
              placed.height = height;
              placed.width = height * logo.width / logo.height;
              replaced++;
            }
            // Added only to each section's main header (the first of its three).
            if (!pics[i].items.length && a.insertIfNone && i % HEADER_KINDS.length === 0) {
              const placed = headers[i].insertInlinePictureFromBase64(logo.data, "Start");
              placed.height = 34;
              placed.width = 34 * logo.width / logo.height;
              added++;
            }
          }
          await ctx.sync();
          if (!replaced && !added) return { error: "No picture in the headers that an add-in can reach: the current logo is probably floating (in front of or behind the text). Ask again with insertIfNone to add BGP's logo to the header, then delete the old one by hand, or right-click the old logo › Change Picture › From a File." };
          return { done: `${replaced ? `Replaced ${replaced} header picture${replaced === 1 ? "" : "s"}` : ""}${replaced && added ? " and " : ""}${added ? `added the logo to ${added} header${added === 1 ? "" : "s"}` : ""} with BGP's black ${a.variant === "holder" ? "logo" : "wordmark"}.` };
        });
      case "word_track_changes": {
        const ok = await setTracking(!!a.on);
        return ok ? { done: `Track Changes ${a.on ? "on" : "off"}.` } : { error: "This version of Word can't switch Track Changes from an add-in." };
      }
      default:
        return { error: `Unknown Word tool ${name}` };
    }
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}
