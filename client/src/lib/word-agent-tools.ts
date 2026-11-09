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
