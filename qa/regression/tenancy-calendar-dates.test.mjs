import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { calendarDateValue, formatCalendarDate } from '../../shared/calendar-date.ts';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');

function realFunction(file, name, bindings = {}) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, `${file} ${name}`);
  const javascript = ts.transpileModule(`${node.getText(ast)}\nexports.fn = ${name};`, { fileName: 'fixture.tsx', compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, { exports, React, Date, calendarDateValue, formatCalendarDate, ...bindings });
  return exports.fn;
}
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!React.isValidElement(node)) return [];
  return [node, ...descendants(node.props.children)];
}

test('calendar dates reject invalid days and preserve leap days without timezone conversion', () => {
  assert.equal(calendarDateValue('2028-02-29'), '2028-02-29');
  for (const value of [null, undefined, '', 'nonsense', '2027-02-29', '2028-02-30', '2027-13-01', '2027-00-01', '2027-03-00']) {
    assert.equal(calendarDateValue(value), null, String(value));
    assert.equal(formatCalendarDate(value), null, String(value));
  }
});

test('plan drawer, tenancy cells and edit values preserve the same written day in UK and other time zones', () => {
  const planFormat = realFunction('client/src/components/property-plans-panel.tsx', 'formatDate');
  const scheduleFormat = realFunction('client/src/components/PropertyTenancySchedule.tsx', 'fmtDate');
  const stub = () => null;
  const UnitRow = realFunction('client/src/components/PropertyTenancySchedule.tsx', 'UnitRow', {
    InlineEdit: stub, Badge: stub, MapPinIcon: stub, Trash2: stub,
  });
  const originalTimezone = process.env.TZ;
  try {
    for (const timezone of ['Europe/London', 'UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
      process.env.TZ = timezone;
      for (const [value, displayed] of [['2027-03-31', '31 Mar 2027'], ['2028-09-01', '1 Sept 2028'], ['2028-02-29', '29 Feb 2028']]) {
        assert.equal(planFormat(value), displayed, timezone);
        assert.equal(scheduleFormat(value), displayed.replace(/^1 /, '01 '), timezone);
        const tree = UnitRow({ unit: { id: 'unit-1', status: 'Occupied', lease_expiry: value }, columns: [{ field: 'lease_expiry', type: 'date' }], onUpdate() {}, onDelete() {} });
        const editor = descendants(tree).find(node => node.type === stub && node.props.field === 'lease_expiry');
        assert.equal(editor.props.value, value, `${timezone} date editor must not silently change the date`);
        assert.equal(editor.props.type, 'date');
      }
    }
  } finally { if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone; }
});
