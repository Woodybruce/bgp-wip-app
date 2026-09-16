import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, ts } = require('./source-harness.cjs');

function sectionFixture(props) {
  const declaration = find('client/src/components/property-detail.tsx', node => ts.isFunctionDeclaration(node) && node.name?.text === 'PropertySection');
  const compiled = ts.transpileModule(`${declaration}\nexports.Section = PropertySection;`, { fileName: 'fixture.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const slots = [], effects = [], exports = {};
  let cursor = 0;
  const bindings = {
    React, exports,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => slots[index] = typeof next === 'function' ? next(slots[index]) : next];
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index][i]))) {
        slots[index] = deps;
        effects.push(fn);
      }
    },
  };
  vm.runInNewContext(compiled, bindings);
  return {
    props,
    render() {
      cursor = 0;
      const tree = exports.Section(props);
      while (effects.length) effects.shift()();
      return tree;
    },
  };
}

const draftChild = () => React.createElement('textarea', { defaultValue: 'Unsaved property note', 'data-testid': 'draft' });

test('simple sections defer heavy children until first opened and preserve them when changing tabs', () => {
  const child = React.createElement(draftChild);
  const app = sectionFixture({ name: 'research', active: 'overview', simple: true, children: child });
  assert.equal(app.render(), null, 'the unvisited integration has no mounted subtree');
  app.props.active = 'files';
  assert.equal(app.render(), null);
  app.props.active = 'research';
  const opened = app.render();
  assert.equal(opened.props.children, child);
  assert.equal(opened.props.className, 'space-y-3');
  app.props.active = 'overview';
  const hidden = app.render();
  assert.equal(hidden.type, opened.type, 'the same wrapper remains in the React tree');
  assert.equal(hidden.props.className, 'hidden');
  assert.equal(hidden.props.children, child, 'hiding the tab retains the child instance and its draft');
});

test('full-page sections retain their child subtree when moving to simple tabs even if never selected', () => {
  const child = React.createElement(draftChild);
  const app = sectionFixture({ name: 'boards', active: 'overview', simple: false, children: child });
  const full = app.render();
  assert.equal(full.props.children, child);
  assert.match(full.props.className, /lg:block/);
  app.props.simple = true;
  app.props.name = 'activity';
  const simple = app.render();
  assert.equal(simple.type, full.type);
  assert.equal(simple.props.className, 'hidden');
  assert.equal(simple.props.children, child, 'a draft made on the full desktop page must not unmount');
});

test('opening full page from an unvisited simple section also preserves it on return', () => {
  const child = React.createElement(draftChild);
  const app = sectionFixture({ name: 'files', active: 'overview', simple: true, children: child });
  assert.equal(app.render(), null);
  app.props.simple = false;
  assert.equal(app.render().props.children, child);
  app.props.simple = true;
  const returned = app.render();
  assert.equal(returned.props.className, 'hidden');
  assert.equal(returned.props.children, child);
});
