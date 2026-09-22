const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { find, ts } = require('./source-harness.cjs');

// Execute the production parser, hook and three components with deterministic
// hook scheduling. No browser, app server, providers or database are involved.
// Intentionally batch events without a render to exercise stale event handlers.
const names = ['parseInlineNumber', 'useInlineDraft', 'InlineEditFeedback', 'InlineText', 'InlineNumber', 'InlineSelect'];
const source = names.map(name => find('client/src/components/inline-edit.tsx', n =>
  ts.isFunctionDeclaration(n) && n.name?.text === name)).join('\n');
const compiled = ts.transpileModule(`${source}\nexport { parseInlineNumber, useInlineDraft, InlineEditFeedback };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function harness() {
  let cursor = 0;
  let pending = [];
  const slots = [];
  const exports = {};
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useId() { return `inline-${cursor++}`; },
    useEffect(setup, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        pending.push(() => {
          previous?.cleanup?.();
          slots[index] = { deps, setup, cleanup: setup() };
        });
      }
    },
  };
  vm.runInNewContext(compiled, { exports, require, console, ...hooks });
  return {
    ...exports,
    render(callback) {
      cursor = 0;
      const result = callback();
      const effects = pending;
      pending = [];
      effects.forEach(effect => effect());
      return result;
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    replayEffects() {
      slots.forEach(slot => {
        if (slot?.setup) { slot.cleanup?.(); slot.cleanup = slot.setup(); }
      });
    },
  };
}

function numberEditor(onSave, value = 10) {
  const h = harness();
  const render = () => h.render(() => h.useInlineDraft(value?.toString() || '', value, onSave, h.parseInlineNumber, true));
  return { ...h, render };
}
const outside = { currentTarget: { contains: () => false }, relatedTarget: null };
const inside = { currentTarget: { contains: () => true }, relatedTarget: {} };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test('numbers accept full decimals, negatives, thousands groups and blank-to-null', () => {
  const { parseInlineNumber } = harness();
  for (const [input, expected] of [['', null], ['  ', null], ['0', 0], ['-12', -12], ['+4', 4],
    ['.5', 0.5], ['-.5', -0.5], ['12.', 12], ['1,200', 1200], [' -1,234,567.89 ', -1234567.89]]) {
    assert.equal(parseInlineNumber(input), expected, input);
  }
});

test('partial/invalid numeric drafts remain editable and never reach onSave', () => {
  for (const invalid of ['120k', '12oops', '1,20', '1234,567', '1.2.3', 'NaN', 'Infinity', '-', '9'.repeat(400)]) {
    const calls = [];
    const h = numberEditor(value => calls.push(value));
    let editor = h.render();
    editor.begin();
    editor.change(invalid);
    editor.save();
    editor.blur(outside);
    editor = h.render();
    assert.equal(editor.editing, true, invalid);
    assert.equal(editor.draft, invalid);
    assert.match(editor.error, /number/);
    h.unmount();
    assert.deepEqual(calls, []);
  }
});

test('Enter, blur and unmount in one event batch save a valid number only once', () => {
  const calls = [];
  const h = numberEditor(value => { calls.push(value); });
  const editor = h.render();
  editor.begin();
  editor.change('1,200.50');
  editor.save(undefined, true);
  editor.blur(outside);
  h.unmount();
  assert.deepEqual(calls, [1200.5]);
});

test('Escape followed by blur and unmount cannot commit the cancelled draft', () => {
  const calls = [];
  const h = numberEditor(value => { calls.push(value); });
  const editor = h.render();
  editor.begin();
  editor.change('900');
  editor.cancel();
  editor.blur(outside);
  h.unmount();
  assert.deepEqual(calls, []);
});

test('popover unmount still commits a pending valid number, including before a rerender', () => {
  const calls = [];
  const h = numberEditor(value => { calls.push(value); });
  const editor = h.render();
  h.replayEffects();
  editor.begin();
  editor.change('-1,200');
  h.unmount();
  assert.deepEqual(calls, [-1200]);
});

test('pending save ignores duplicate events, draft changes and cancellation; rejection keeps draft', async () => {
  const request = deferred();
  const calls = [];
  const h = numberEditor(value => { calls.push(value); return request.promise; });
  let editor = h.render();
  editor.begin();
  editor.change('300');
  editor.save();
  editor.save();
  editor.blur(outside);
  editor.change('400');
  editor.cancel();
  editor = h.render();
  assert.equal(editor.saving, true);
  assert.equal(editor.editing, true);
  assert.equal(editor.draft, '300');
  request.reject(new Error('Synthetic failure'));
  await settled();
  editor = h.render();
  assert.equal(editor.saving, false);
  assert.equal(editor.editing, true);
  assert.equal(editor.draft, '300');
  assert.match(editor.error, /Could not save/);
  editor.blur(outside);
  h.unmount();
  assert.deepEqual(calls, [300], 'failure is not silently retried on blur or unmount');
});

test('explicit retry retains draft until success and closes after the promise resolves', async () => {
  const first = deferred(), retry = deferred();
  let calls = 0;
  const h = numberEditor(() => (++calls === 1 ? first.promise : retry.promise));
  let editor = h.render();
  editor.begin(); editor.change('500'); editor.save();
  first.reject(new Error('Synthetic failure'));
  await settled();
  editor = h.render();
  editor.blur(inside);
  assert.equal(calls, 1, 'tabbing to Save/Cancel does not retry');
  editor.save();
  editor = h.render();
  assert.equal(editor.draft, '500');
  assert.equal(editor.editing, true);
  assert.equal(editor.saving, true);
  retry.resolve();
  await settled();
  editor = h.render();
  assert.equal(editor.editing, false);
  assert.equal(editor.error, null);
  h.unmount();
  assert.equal(calls, 2);
});

test('synchronous save exceptions keep the draft and cancelling clears it without retry', () => {
  let calls = 0;
  const h = numberEditor(() => { calls++; throw new Error('Synthetic failure'); });
  let editor = h.render();
  editor.begin(); editor.change('800'); editor.save();
  editor = h.render();
  assert.equal(editor.draft, '800');
  assert.match(editor.error, /Could not save/);
  editor.cancel();
  editor = h.render();
  assert.equal(editor.draft, '10');
  assert.equal(editor.editing, false);
  h.unmount();
  assert.equal(calls, 1);
});

test('pending saves do not duplicate on unmount, even if callback itself unmounts', async () => {
  const request = deferred();
  let calls = 0;
  const h = numberEditor(() => { calls++; h.unmount(); return request.promise; });
  const editor = h.render();
  editor.begin(); editor.change('100'); editor.save();
  request.reject(new Error('Synthetic failure after unmount'));
  await settled();
  assert.equal(calls, 1);
});

test('unchanged and blank numeric values do not introduce redundant writes', () => {
  const calls = [];
  const h = numberEditor(value => { calls.push(value); });
  let editor = h.render();
  editor.begin(); editor.change('10.0'); editor.save();
  assert.deepEqual(calls, []);
  editor = h.render();
  editor.begin(); editor.change(''); editor.save();
  assert.deepEqual(calls, [null]);
});

test('an async keyboard save does not steal focus after tabbing away', async () => {
  const request = deferred();
  const h = numberEditor(() => request.promise);
  let editor = h.render();
  let focusCalls = 0;
  editor.triggerRef.current = { focus: () => { focusCalls++; } };
  editor.begin(); editor = h.render();
  editor.change('20'); editor.save(undefined, true); editor.blur(outside);
  request.resolve();
  await settled();
  h.render();
  assert.equal(focusCalls, 0);
});

function nodes(element) {
  if (!element || typeof element !== 'object') return [];
  return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
}
const key = name => ({ key: name, nativeEvent: {}, preventDefault() {} });

test('text, number and select expose native labelled keyboard buttons and labelled inputs', () => {
  for (const [name, value, inputType] of [['InlineText', 'Original', 'input'], ['InlineNumber', 10, 'input'], ['InlineSelect', 'A', 'select']]) {
    const h = harness();
    const props = { value, label: 'Synthetic field', options: ['A', 'B'], onSave() {} };
    const render = () => h.render(() => h[name](props));
    let tree = render();
    const trigger = nodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === 'Edit Synthetic field');
    assert.ok(trigger, name);
    assert.equal(trigger.props.type, 'button');
    trigger.props.onClick();
    tree = render();
    const input = nodes(tree).find(node => node.type === inputType);
    assert.equal(input.props['aria-label'], 'Synthetic field');
    input.props.onKeyDown(key('Escape'));
    tree = render();
    assert.ok(nodes(tree).some(node => node.props?.['aria-label'] === 'Edit Synthetic field'));
  }
});

test('multiline Enter preserves newlines; single-line Enter trims before saving', () => {
  for (const multiline of [false, true]) {
    const h = harness(), calls = [];
    const render = () => h.render(() => h.InlineText({ value: 'old', multiline, onSave: value => { calls.push(value); } }));
    nodes(render()).find(node => node.type === 'button').props.onClick();
    const input = nodes(render()).find(node => node.type === (multiline ? 'textarea' : 'input'));
    input.props.onChange({ target: { value: '  next  ' } });
    input.props.onKeyDown(key('Enter'));
    assert.deepEqual(calls, multiline ? [] : ['next']);
  }
});

test('select sends the newly selected value immediately and retains it on rejection', async () => {
  const h = harness(), calls = [], request = deferred();
  const render = () => h.render(() => h.InlineSelect({ value: 'A', options: ['A', 'B'], onSave: value => { calls.push(value); return request.promise; } }));
  render().props.onClick();
  let select = nodes(render()).find(node => node.type === 'select');
  select.props.onChange({ target: { value: 'B' } });
  select = nodes(render()).find(node => node.type === 'select');
  assert.equal(select.props.value, 'B');
  assert.equal(select.props.disabled, true);
  request.reject(new Error('Synthetic failure'));
  await settled();
  select = nodes(render()).find(node => node.type === 'select');
  assert.equal(select.props.value, 'B');
  assert.equal(select.props.disabled, false);
  assert.equal(select.props['aria-invalid'], true);
  assert.deepEqual(calls, ['B']);
});

test('saving and failure feedback expose a live status, alert and explicit retry', () => {
  const h = harness();
  const props = { saving: true, error: null, errorId: 'synthetic-error', retry() {}, cancel() {} };
  assert.equal(h.InlineEditFeedback(props).props.role, 'status');
  const errorNodes = nodes(h.InlineEditFeedback({ ...props, saving: false, error: 'Could not save' }));
  assert.ok(errorNodes.some(node => node.props?.role === 'alert' && node.props.id === 'synthetic-error'));
  assert.ok(errorNodes.some(node => node.type === 'button' && node.props['data-testid'] === 'inline-edit-retry'));
});
