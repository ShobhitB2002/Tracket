require('./_setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/core');
const store = require('../lib/store');
const { judge } = core._internal;

const task = (status, sections, assignee = '1') => ({ assignee: assignee && { gid: assignee, name: 'X' }, custom_fields: status === undefined ? [] : [{ name: 'Task Status', enum_value: status && { name: status } }], memberships: sections.map((n) => ({ section: { name: n } })) });

test('ticket check: status and board section', () => {
  assert.equal(judge(task('In Development', ['In Development']), '1').ok, true);
  assert.equal(judge(task('In Grooming', []), '1').ok, true); // a subtask: no section of its own
  const r = judge(task('In Development', ['Groomed']), '1');
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(), /Groomed/);
  assert.match(judge(task('Backlog', ['In Grooming']), '1').reasons.join(), /Backlog/);
  assert.match(judge(task('In Development', ['In Development'], '2'), '1').reasons.join(), /Assigned to/);
  assert.match(judge(task(undefined, []), '1').reasons.join(), /No Task Status/);
});

test('days and times in a zone', () => {
  assert.equal(core.ymdIn(Date.parse('2026-09-25T20:00:00Z'), 'Asia/Kolkata'), '2026-09-26');
  assert.equal(core.ymdIn(Date.parse('2026-09-25T20:00:00Z'), 'UTC'), '2026-09-25');
  assert.equal(new Date(core.atTimeIn('2026-09-25', '10:00', 'Asia/Kolkata')).toISOString(), '2026-09-25T04:30:00.000Z');
});

test('timesheet from cached days (no Asana)', async () => {
  const ctx = { uid: 'ts', pat: 'x' };
  const d1 = '2026-09-21', d2 = '2026-09-22';
  await store.set(`u:ts:day:${d1}`, { totalMinutes: 90, tasks: [{ gid: 'a', name: 'Alpha', url: 'u', minutes: 60 }, { gid: 'b', name: 'Beta', url: 'v', minutes: 30 }] });
  await store.set(`u:ts:day:${d2}`, { totalMinutes: 45, tasks: [{ gid: 'a', name: 'Alpha', url: 'u', minutes: 45 }] });
  await store.set('u:ts:leave', { days: { '2026-09-23': 'Diwali' } });
  const orig = global.fetch; global.fetch = async () => ({ ok: false, status: 400, json: async () => ({}) }); // Asana unreachable
  try {
    const t = await core.timesheet(ctx, { tz: 'UTC', from: d1, to: '2026-09-23' });
    assert.equal(t.total, 135);
    assert.deepEqual(t.rows.map((r) => [r.date, r.name, r.minutes]), [[d1, 'Alpha', 60], [d1, 'Beta', 30], [d2, 'Alpha', 45]]);
    assert.deepEqual(t.leave, { '2026-09-23': 'Diwali' });
    await assert.rejects(core.timesheet(ctx, { tz: 'UTC', from: '2026-01-01', to: '2026-09-01' }), /62 days/);
  } finally { global.fetch = orig; }
});
