import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://unused@localhost/unused';
globalThis.window = globalThis.window || globalThis;

function fakeWord(paragraphs) {
  const log = [];
  const para = (text, i) => ({
    text, style: i === 0 ? 'Heading 1' : 'Normal', tableNestingLevel: 0,
    getRange: (w) => ({ insertHtml: (h, loc) => log.push(['paraHtml', i + 1, w, loc, h]) }),
    insertTable: (r, c, loc, v) => { log.push(['paraTable', i + 1, r, c, v]); return {}; },
  });
  const hit = (n) => ({ insertText: (t, loc) => log.push(['replace', n, t, loc]), insertComment: (t) => log.push(['comment', n, t]) });
  const doc = {
    changeTrackingMode: 'Off',
    body: {
      paragraphs: { items: paragraphs.map(para), load() {} },
      tables: { items: [], load() {} },
      insertHtml: (h, loc) => log.push(['bodyHtml', loc, h]),
      insertTable: (r, c, loc, v) => { log.push(['bodyTable', r, c, loc, v]); return {}; },
      search: (q) => ({ items: paragraphs.filter(p => p.includes(q)).map((_, n) => hit(n)), load() {} }),
    },
    getSelection: () => ({ text: 'selected words', load() {}, insertHtml: (h, loc) => log.push(['selHtml', loc, h]), insertComment: (t) => log.push(['selComment', t]) }),
  };
  globalThis.Word = { run: async (fn) => { const ctx = { document: doc, sync: async () => { if (doc.changeTrackingMode !== 'Off') log.push(['tracking', doc.changeTrackingMode]); } }; return fn(ctx); } };
  window.Office = { context: { document: { url: 'https://x/sites/BGP/Brixton%20heads%20of%20terms.docx' } } };
  return { log, doc };
}

function fakePpt() {
  const log = [];
  const mkShape = (id, name, text) => ({ id, name, type: 'Placeholder', left: 10, top: 20, width: 800, height: 60,
    textFrame: { textRange: { text, load() {}, font: {} } }, delete: () => log.push(['deleteShape', id]) });
  const slides = [
    { id: '256', shapes: { items: [mkShape('2', 'Title 1', 'Brixton Village'), mkShape('3', 'Content 2', 'Opportunity')], load() {} }, delete: () => log.push(['deleteSlide', '256']) },
  ];
  const pres = {
    slides: {
      get items() { return slides; }, load() {},
      add: (o) => { log.push(['add', o]); slides.push({ id: '300', shapes: { items: [mkShape('9', 'Title 1', '')], load() {}, addTextBox() {} }, moveTo: (i) => log.push(['moveTo', i]) }); },
    },
    slideMasters: { items: [{ id: 'm1', name: 'BGP', layouts: { items: [{ id: 'l1', name: 'Title Only' }, { id: 'l2', name: 'Title and Content' }] } }], load() {} },
  };
  slides[0].shapes.addTextBox = (text, pos) => { log.push(['textbox', text, pos]); return { textFrame: { textRange: { font: {} } } }; };
  globalThis.PowerPoint = { run: async (fn) => fn({ presentation: pres, sync: async () => {} }) };
  return { log, slides };
}

const word = await import('../../client/src/lib/word-agent-tools.ts');
const ppt = await import('../../client/src/lib/ppt-agent-tools.ts');
const server = await import('../../server/office-agents.ts');

test('every Word and PowerPoint tool the server offers has a pane executor', async () => {
  fakeWord(['a']); fakePpt();
  for (const n of server.WORD_TOOL_NAMES) {
    const r = await word.runWordTool(n, { search: 'zzz', text: 'x', html: '<p/>', location: 'end', rows: [['a']], on: true }, { suggest: false });
    assert.doesNotMatch(String(r.error || ''), /Unknown/, n);
  }
  for (const n of server.PPT_TOOL_NAMES) {
    if (n === 'ppt_go_to_slide' || n === 'ppt_delete') continue;
    const r = await ppt.runPptTool(n, { slide: 1, text: 'x', shapeId: '2' });
    assert.doesNotMatch(String(r.error || ''), /Unknown/, n);
  }
});

test('Word: reads numbered paragraphs, selection and file name', async () => {
  fakeWord(['Heads of terms', '', 'Rent: £45,000 pa']);
  const d = await word.readDocument();
  assert.equal(d.paragraphs, 3);
  assert.equal(d.selection, 'selected words');
  assert.match(d.text, /^\[1\] \(Heading 1\) Heads of terms\n\[3\] Rent/);
  assert.equal(await word.documentName(), 'Brixton heads of terms.docx');
});

test('Word: edits go in as tracked changes when suggest is on', async () => {
  const { log, doc } = fakeWord(['Rent: £45,000 pa', 'Term: 10 years']);
  const r = await word.runWordTool('word_replace_text', { search: '£45,000', replacement: '£47,500' }, { suggest: true });
  assert.equal(doc.changeTrackingMode, 'TrackAll');
  assert.equal(r.count, 1);
  assert.match(r.done, /tracked changes/);
  assert.deepEqual(log.find(l => l[0] === 'replace'), ['replace', 0, '£47,500', 'Replace']);
});

test('Word: suggest off leaves Track Changes alone', async () => {
  const { doc } = fakeWord(['Rent']);
  await word.runWordTool('word_insert', { html: '<p>x</p>', location: 'end' }, { suggest: false });
  assert.equal(doc.changeTrackingMode, 'Off');
});

test('Word: insert after a paragraph, a table and a comment', async () => {
  const { log } = fakeWord(['One', 'Two']);
  await word.runWordTool('word_insert', { html: '<p>New</p>', location: 'afterParagraph', paragraphIndex: 2 }, { suggest: false });
  assert.deepEqual(log.at(-1), ['paraHtml', 2, 'Whole', 'After', '<p>New</p>']);
  const bad = await word.runWordTool('word_insert', { html: 'x', location: 'replaceParagraph', paragraphIndex: 9 }, { suggest: false });
  assert.match(bad.error, /no paragraph 9/);
  await word.runWordTool('word_insert_table', { rows: [['Unit', 'Rent'], ['12']] }, { suggest: false });
  assert.deepEqual(log.at(-1), ['bodyTable', 2, 2, 'End', [['Unit', 'Rent'], ['12', '']]]);
  await word.runWordTool('word_add_comment', { search: 'Two', text: 'Check this' }, { suggest: false });
  assert.deepEqual(log.at(-1), ['comment', 0, 'Check this']);
});

test('PowerPoint: reads slides, shapes and layouts', async () => {
  fakePpt();
  const d = await ppt.readPresentation();
  assert.equal(d.slides, 1);
  assert.deepEqual(d.layouts, ['Title Only', 'Title and Content']);
  assert.equal(d.detail[0].shapes[0].text, 'Brixton Village');
});

test('PowerPoint: adds a slide on the deck layout and sets text by shape id', async () => {
  const { log, slides } = fakePpt();
  const r = await ppt.runPptTool('ppt_add_slide', { layoutName: 'title and content' });
  assert.deepEqual(log[0], ['add', { layoutId: 'l2', slideMasterId: 'm1' }]);
  assert.equal(r.slide, 2);
  assert.deepEqual(r.placeholders, [{ id: '9', name: 'Title 1' }]);
  await ppt.runPptTool('ppt_set_text', { slide: 1, shapeId: '3', text: 'Why buy' });
  assert.equal(slides[0].shapes.items[1].textFrame.textRange.text, 'Why buy');
  const miss = await ppt.runPptTool('ppt_set_text', { slide: 7, shapeId: '3', text: 'x' });
  assert.match(miss.error, /no slide 7/);
  await ppt.runPptTool('ppt_add_textbox', { slide: 1, text: 'Source: BGP comps', fontSize: 10 });
  assert.equal(log.at(-1)[0], 'textbox');
  await ppt.runPptTool('ppt_delete', { slide: 1, shapeId: '2' });
  assert.deepEqual(log.at(-1), ['deleteShape', '2']);
});
