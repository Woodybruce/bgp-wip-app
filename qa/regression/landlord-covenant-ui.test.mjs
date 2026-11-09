import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
const code = ts.transpileModule(source('client/src/components/landlord-covenant-summary.tsx'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function render(report, props = {}) {
  const effects = [], invalidations = [];
  const client = { invalidateQueries: options => { invalidations.push(options); return Promise.resolve(); } };
  const sandbox = {
    exports: {},
    require: name => name === 'react' ? { ...React, useId: () => 'rating-details', useEffect: (callback, dependencies) => effects.push({ callback, dependencies }) }
      : name === '@tanstack/react-query' ? { useQuery: () => ({ data: report }), useQueryClient: () => client }
      : name === '@/lib/queryClient' ? { apiRequest: () => assert.fail('No provider calls during rendering') }
      : require(name),
  };
  vm.runInNewContext(code, sandbox);
  return {
    html: renderToStaticMarkup(React.createElement(sandbox.exports.LandlordCovenantSummary, { companyId: 'landlord-1', companyName: 'Example Group', ...props })),
    effects, invalidations,
  };
}

const report = {
  companyName: 'Example Group PLC', companyNumber: '12345678', status: 'active', checkedAt: '2026-10-27T12:00:00Z', sourceUrl: null,
  interpretation: { kind: 'standard', title: 'Legal entity covenant', summary: 'No recorded proceedings.', context: [], dates: [] },
  overview: { title: 'Company financial context.', company: 'Recorded financial facts.', evidence: [], limitations: [] },
  assessment: { grade: 'A', score: 94, verdict: 'An old overly confident verdict.', computedAt: '2026-10-26T12:00:00Z', flags: [], missing: ['Directors’ track record not checked'] },
};

test('the guarded internal grade and score are visible outside expansion, with provenance and gaps available', () => {
  for (const grade of ['A', 'B', 'C', 'D', 'E']) {
    const { html } = render({ ...report, assessment: { ...report.assessment, grade } });
    const collapsed = html.slice(0, html.indexOf('<details'));
    assert.match(collapsed, /BGP covenant/);
    assert.ok(collapsed.includes(`${grade} · 94/100`));
    assert.match(collapsed, /aria-describedby="rating-details"/);
    assert.match(html, /internal A–E assessment/);
    assert.match(html, /not an external agency credit rating/);
    assert.match(html, /26 Oct 2026/);
    assert.match(html, /Directors’ track record not checked/);
    assert.doesNotMatch(html, /old overly confident verdict/);
  }
});

test('no badge is recreated when the server withholds the entity assessment', () => {
  const { html } = render({ ...report, assessment: undefined, interpretation: { ...report.interpretation, kind: 'members-voluntary-liquidation' } });
  assert.doesNotMatch(html, /landlord-covenant-rating|94\/100|BGP covenant:/);
  assert.match(html, /Recorded financial facts/);
});

test('a completed shared report refreshes only this landlord summary, without requesting another credit check', () => {
  const { effects, invalidations } = render(report, { covenantComputedAt: '2026-10-27T12:00:00Z' });
  assert.equal(effects.length, 1);
  assert.equal(effects[0].dependencies[1], 'landlord-1');
  assert.equal(effects[0].dependencies[2], '2026-10-27T12:00:00Z');
  effects[0].callback();
  assert.equal(invalidations.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(invalidations[0])), { queryKey: ['/api/landlord-relationships', 'landlord-1', 'covenant'], exact: true });
  const pending = render(report);
  pending.effects[0].callback();
  assert.equal(pending.invalidations.length, 0);
});
