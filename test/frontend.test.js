// Static checks on the browser code: everything parses, no clashing CSS
// animations, and every theme exists in all three places.
require('./_setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('page scripts parse', () => {
  for (const f of ['public/index.html', 'public/admin.html', 'public/guide.html', 'public/timesheet.html']) {
    const html = read(f);
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(m[1], { filename: f }), f);
  }
  for (const f of ['public/themes.js', 'tracket.user.js', 'public/sw.js']) assert.doesNotThrow(() => new vm.Script(read(f), { filename: f }), f);
  // Scriptable / JXA files use top-level await / osascript globals: wrap before parsing
  assert.doesNotThrow(() => new vm.Script(`(async () => {${read('tracket.widget.js')}\n})`, { filename: 'tracket.widget.js' }));
  assert.doesNotThrow(() => new vm.Script(read('tracket.menubar.js').replace(/^#!.*\n/, ''), { filename: 'tracket.menubar.js' }));
});

test('no @keyframes name is defined twice', () => {
  const names = [...read('public/index.html').matchAll(/@keyframes\s+([\w-]+)/g), ...read('public/themes.css').matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(dup, []);
});

test('every theme is known to the server and styled', () => {
  const sandbox = { window: {}, document: { readyState: 'complete', documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, head: { appendChild() {} }, body: null, addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  vm.runInNewContext(read('public/themes.js'), sandbox);
  const order = sandbox.window.TT.ORDER;
  const server = require('../lib/prefs');
  const css = read('public/themes.css');
  for (const k of order) {
    assert.ok(sandbox.window.TT.THEMES[k], k);
    if (!['default', 'system'].includes(k)) assert.ok(css.includes(`[data-theme="${k}"]{`), `themes.css has ${k}`);
  }
  // prefs.update accepts each of them
  return Promise.all(order.map((k) => server.update(`t-${k}`, { theme: k })));
});
