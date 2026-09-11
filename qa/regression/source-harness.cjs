const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function source(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function find(file, predicate) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);
  let found;
  function visit(node) { if (predicate(node, ast)) found = node.getText(ast); ts.forEachChild(node, visit); }
  visit(ast);
  assert.ok(found, `Missing source node in ${file}`);
  return found;
}
function route(file, method, url) {
  return find(file, (n, ast) => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
    n.expression.expression.getText(ast) === 'app' && n.expression.name.text === method &&
    ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === url) + ';';
}
function evaluate(input, bindings = {}) {
  const exports = {};
  const js = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(js, { exports, console, Date, Buffer, ...bindings });
  return exports;
}
module.exports = { source, find, route, evaluate, ts };
