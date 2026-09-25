require('./_setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const prefs = require('../lib/prefs');

test('defaults', async () => {
  const p = await prefs.get('u1');
  assert.equal(p.auto.cap.on, false);
  assert.equal(p.auto.cap.hours, 7);
  assert.equal(p.auto.failsafe, false);
  assert.deepEqual(p.nudge, { idle: true, late: true });
  assert.equal(p.team.share, false);
  assert.equal(p.theme, 'default');
  assert.equal(p.slack.on, false);
});

test('daily limit is kept to the minute and bounded', async () => {
  assert.equal((await prefs.update('u2', { auto: { cap: { on: true, hours: 7 + 20 / 60 } } })).auto.cap.hours, 7 + 20 / 60);
  await assert.rejects(prefs.update('u2', { auto: { cap: { hours: 0.5 } } }), /between/);
  await assert.rejects(prefs.update('u2', { auto: { cap: { hours: 17 } } }), /between/);
});

test('partial updates merge', async () => {
  await prefs.update('u3', { report: { on: true } });
  const p = await prefs.update('u3', { report: { weekly: true, monthly: true }, auto: { failsafe: true }, nudge: { idle: false }, team: { share: true } });
  assert.equal(p.report.on, true);
  assert.equal(p.report.weekly, true);
  assert.equal(p.report.monthly, true);
  assert.equal(p.auto.failsafe, true);
  assert.deepEqual(p.nudge, { idle: false, late: true });
  assert.equal(p.team.share, true);
});

test('lunch auto stop needs lunch times; lunch needs valid times', async () => {
  await assert.rejects(prefs.update('u4', { auto: { lunch: true } }), /lunch times/);
  await assert.rejects(prefs.update('u4', { lunch: { start: '14:00', end: '13:00' } }), /after it starts/);
  const p = await prefs.update('u4', { lunch: { start: '13:00', end: '14:00' }, auto: { lunch: true } });
  assert.equal(p.auto.lunch, true);
});

test('themes and slack emoji are validated', async () => {
  assert.equal((await prefs.update('u5', { theme: 'cricket' })).theme, 'cricket');
  await assert.rejects(prefs.update('u5', { theme: 'nope' }), /Unknown theme/);
  assert.equal((await prefs.update('u5', { slack: { emoji: ':rocket:' } })).slack.emoji, ':rocket:');
  assert.equal((await prefs.update('u5', { slack: { emoji: 'not an emoji' } })).slack.emoji, ':rocket:');
});
