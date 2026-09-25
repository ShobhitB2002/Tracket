require('./_setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../lib/store');
const core = require('../lib/core');
const alerts = require('../lib/alerts');
const prefs = require('../lib/prefs');
const leave = require('../lib/leave');

const tz = 'UTC';
let state = { running: null, suspect: null, ended: [] };
core.getState = async () => state;
core.nextTicket = async () => ({ gid: '111', name: 'Last open', url: 'u111' });
core.ticketInfo = async (c, g) => ({ gid: g, name: `T${g}`, url: `u${g}` });
core.buildDay = async () => ({ fetchedAt: Date.now(), totalMinutes: 100, tasks: [] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const day = () => core.ymdIn(Date.now(), tz);

test('cap label', () => {
  assert.equal(alerts.capLabel(7), '7h');
  assert.equal(alerts.capLabel(7.5), '7h 30m');
  assert.equal(alerts.capLabel(7 + 5 / 60), '7h 05m');
});

test('manual start / busy / switch / stop', async () => {
  const ctx = { uid: 'm1' };
  await prefs.update('m1', { tz });
  await assert.rejects(alerts.command(ctx, { action: 'stop' }), /Nothing is running/);
  const a = await alerts.command(ctx, { action: 'start' });
  assert.equal(a.action, 'start'); assert.equal(a.gid, '111'); assert.equal(a.kind, 'manual');
  await assert.rejects(alerts.command(ctx, { action: 'start' }), /Busy/);
  assert.equal((await alerts.autoOp(ctx, { id: a.id, op: 'claim' })).go, true);
  assert.equal((await alerts.autoOp(ctx, { id: a.id, op: 'claim' })).go, false); // only one taker
  await alerts.autoOp(ctx, { id: a.id, op: 'result', ok: true });
  assert.equal((await alerts.feed('m1')).items.length, 0); // manual success: no alert
  state = { running: { taskGid: '111', taskName: 'Last open', url: 'u111', startedAt: Date.now() - 60000 }, ended: [] };
  await assert.rejects(alerts.command(ctx, { action: 'start', gid: '111' }), /already running/);
  const sw = await alerts.command(ctx, { action: 'start', gid: '222' });
  assert.equal(sw.action, 'switch'); assert.equal(sw.stopGid, '111');
  await alerts.autoOp(ctx, { id: sw.id, op: 'claim' }); await alerts.autoOp(ctx, { id: sw.id, op: 'result', ok: false, error: 'boom' });
  assert.match((await alerts.feed('m1')).items.at(-1).title, /couldn’t switch/);
});

test('failsafe: stops outside the shift, no Deny, skipped on leave', async () => {
  const ctx = { uid: 'f1' };
  await prefs.update('f1', { tz, auto: { failsafe: true } });
  await store.set('u:f1:shift', { days: { [new Date().getUTCDay()]: { start: '00:00', end: '00:01' } } });
  state = { running: { taskGid: '5', taskName: 'Late', url: 'u5', startedAt: Date.now() - 1000 }, ended: [] };
  await assert.rejects(alerts.command(ctx, { action: 'start', gid: '9' }), /Failsafe/);
  const { offered } = await alerts.autoStep(ctx, { tz, state });
  assert.equal(offered.kind, 'failsafe'); assert.equal(offered.noDeny, true);
  assert.equal((await alerts.autoOp(ctx, { id: offered.id, op: 'deny' })).status, 'locked');
  // on leave: no failsafe
  await leave.update('f2', { add: { from: day(), label: 'Leave' } });
  await prefs.update('f2', { tz, auto: { failsafe: true } });
  await store.set('u:f2:shift', { days: { [new Date().getUTCDay()]: { start: '00:00', end: '00:01' } } });
  await wait(2100);
  assert.equal((await alerts.autoStep({ uid: 'f2' }, { tz, state })).offered, null);
});

test('forgot-to-stop nudge fires once per run', async () => {
  const ctx = { uid: 'n1' };
  await prefs.update('n1', { tz });
  await store.set('u:n1:shift', { days: { [new Date().getUTCDay()]: { start: '00:00', end: '00:01' } } });
  await store.set('u:n1:hb', { at: Date.now() });
  state = { running: { taskGid: '7', taskName: 'Still going', url: 'u7', startedAt: Date.now() - 5000 }, ended: [] };
  await alerts.evaluate(ctx, { tz, state, source: 'cron' });
  await wait(2100);
  await alerts.evaluate(ctx, { tz, state, source: 'cron' });
  assert.equal((await alerts.feed('n1')).items.filter((a) => /still running/.test(a.title)).length, 1);
});
