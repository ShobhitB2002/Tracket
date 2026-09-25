require('./_setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const leave = require('../lib/leave');
const usage = require('../lib/usage');
const store = require('../lib/store');

test('leave: ranges, labels, removal, bad input', async () => {
  const r = await leave.update('l1', { add: { from: '2026-10-20', to: '2026-10-22', label: 'Diwali' } });
  assert.deepEqual(Object.keys(r.days), ['2026-10-20', '2026-10-21', '2026-10-22']);
  assert.equal(await leave.on('l1', '2026-10-21'), 'Diwali');
  await leave.update('l1', { remove: ['2026-10-21'] });
  assert.equal(await leave.on('l1', '2026-10-21'), null);
  await assert.rejects(leave.update('l1', { add: { from: '2026-10-22', to: '2026-10-20' } }), /start and end/);
});

test('usage: counts are flushed into the day and projected', async () => {
  usage.add('requests', 10); usage.add('asana', 3);
  await store.get('anything');
  const r = await usage.report();
  const req = r.metrics.find((m) => m.key === 'requests');
  assert.ok(req.month >= 10);
  assert.ok(req.projected >= req.month);
  assert.ok(r.metrics.find((m) => m.key === 'reads').month >= 1);
});
