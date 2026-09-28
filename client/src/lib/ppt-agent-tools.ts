// The PowerPoint pane's half of ChatBGP-in-PowerPoint (server/office-agents.ts).
declare const PowerPoint: any;

const MAX_SLIDES = 60;

async function shapeText(ctx: any, shape: any): Promise<string | null> {
  try {
    const tr = shape.textFrame.textRange;
    tr.load("text");
    await ctx.sync();
    return String(tr.text ?? "");
  } catch { return null; }
}

export async function readPresentation(from?: number, to?: number): Promise<any> {
  return PowerPoint.run(async (ctx: any) => {
    const slides = ctx.presentation.slides;
    slides.load("items/id");
    await ctx.sync();
    const start = Math.max(1, Number(from) || 1);
    const end = Math.min(slides.items.length, Number(to) || slides.items.length, start + MAX_SLIDES - 1);
    const out: any[] = [];
    for (let i = start; i <= end; i++) {
      const slide = slides.items[i - 1];
      const shapes = slide.shapes;
      shapes.load("items/id,items/name,items/type,items/left,items/top,items/width,items/height");
      await ctx.sync();
      const list: any[] = [];
      for (const s of shapes.items) {
        list.push({ id: s.id, name: s.name, type: s.type, left: Math.round(s.left), top: Math.round(s.top), width: Math.round(s.width), height: Math.round(s.height), text: await shapeText(ctx, s) });
      }
      out.push({ slide: i, id: slide.id, shapes: list });
    }
    let layouts: string[] = [];
    try {
      const masters = ctx.presentation.slideMasters;
      masters.load("items/id,items/name,items/layouts/items/name");
      await ctx.sync();
      layouts = masters.items.flatMap((m: any) => m.layouts.items.map((l: any) => l.name));
    } catch {}
    return { slides: slides.items.length, shown: `${start}–${end}`, layouts: [...new Set(layouts)], detail: out };
  });
}

async function findShape(ctx: any, slideIndex: number, shapeId?: string, shapeName?: string) {
  const slides = ctx.presentation.slides;
  slides.load("items");
  await ctx.sync();
  const slide = slides.items[slideIndex - 1];
  if (!slide) throw new Error(`There's no slide ${slideIndex}.`);
  const shapes = slide.shapes;
  shapes.load("items/id,items/name");
  await ctx.sync();
  const shape = shapes.items.find((s: any) => (shapeId && s.id === shapeId) || (shapeName && s.name === shapeName));
  return { slide, shape };
}

export async function runPptTool(name: string, a: any): Promise<any> {
  try {
    switch (name) {
      case "ppt_read_presentation":
        return await readPresentation(a.fromSlide, a.toSlide);
      case "ppt_add_slide":
        return await PowerPoint.run(async (ctx: any) => {
          const opts: any = {};
          if (a.layoutName) {
            const masters = ctx.presentation.slideMasters;
            masters.load("items/id,items/layouts/items/id,items/layouts/items/name");
            await ctx.sync();
            for (const m of masters.items) {
              const layout = m.layouts.items.find((l: any) => String(l.name).toLowerCase() === String(a.layoutName).toLowerCase());
              if (layout) { opts.layoutId = layout.id; opts.slideMasterId = m.id; break; }
            }
          }
          ctx.presentation.slides.add(opts);
          await ctx.sync();
          const slides = ctx.presentation.slides;
          slides.load("items/id");
          await ctx.sync();
          let index = slides.items.length;
          const added = slides.items[index - 1];
          if (a.afterSlide && Number(a.afterSlide) < index - 1) {
            try { added.moveTo(Number(a.afterSlide)); await ctx.sync(); index = Number(a.afterSlide) + 1; } catch {}
          }
          const shapes = added.shapes;
          shapes.load("items/id,items/name");
          await ctx.sync();
          return { done: `Added slide ${index}${opts.layoutId ? ` (${a.layoutName})` : ""}.`, slide: index, placeholders: shapes.items.map((s: any) => ({ id: s.id, name: s.name })) };
        });
      case "ppt_set_text":
        return await PowerPoint.run(async (ctx: any) => {
          const { shape } = await findShape(ctx, Number(a.slide), a.shapeId, a.shapeName);
          if (!shape) return { error: "Couldn't find that shape — read the deck for shape ids." };
          shape.textFrame.textRange.text = String(a.text ?? "");
          await ctx.sync();
          return { done: `Updated text on slide ${a.slide}.` };
        });
      case "ppt_add_textbox":
        return await PowerPoint.run(async (ctx: any) => {
          const slides = ctx.presentation.slides;
          slides.load("items");
          await ctx.sync();
          const slide = slides.items[Number(a.slide) - 1];
          if (!slide) return { error: `There's no slide ${a.slide}.` };
          const box = slide.shapes.addTextBox(String(a.text ?? ""), { left: a.left ?? 60, top: a.top ?? 120, width: a.width ?? 840, height: a.height ?? 80 });
          const font = box.textFrame.textRange.font;
          if (a.fontSize) font.size = a.fontSize;
          if (typeof a.bold === "boolean") font.bold = a.bold;
          if (a.color) font.color = a.color;
          await ctx.sync();
          return { done: `Added text to slide ${a.slide}.` };
        });
      case "ppt_delete":
        return await PowerPoint.run(async (ctx: any) => {
          const { slide, shape } = await findShape(ctx, Number(a.slide), a.shapeId);
          if (a.shapeId) { if (!shape) return { error: "Couldn't find that shape." }; shape.delete(); }
          else slide.delete();
          await ctx.sync();
          return { done: a.shapeId ? "Removed the shape." : `Deleted slide ${a.slide}.` };
        });
      case "ppt_go_to_slide": {
        const Office = (window as any).Office;
        await new Promise<void>((resolve) => Office.context.document.goToByIdAsync(Number(a.slide), Office.GoToType.Index, () => resolve()));
        return { done: `Showing slide ${a.slide}.` };
      }
      default:
        return { error: `Unknown PowerPoint tool ${name}` };
    }
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}
