require('./_setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { dispatch } = require('../lib/routes');

const req = { headers: {}, socket: {} };
const call = (method, pathname, body) => dispatch({ method, pathname, query: {}, body, req });

test('health is public, unknown routes 404', async () => {
  assert.equal((await call('GET', '/api/health')).status, 200);
  assert.equal((await call('GET', '/api/nope')).status, 404);
});

test('member and admin routes need a login', async () => {
  for (const p of ['/api/today', '/api/next', '/api/timesheet', '/api/leave', '/api/insights']) assert.equal((await call('GET', p)).status, 401, p);
  assert.equal((await call('POST', '/api/control', { action: 'start' })).status, 401);
  for (const p of ['/api/admin/team', '/api/admin/usage']) assert.equal((await call('GET', p)).status, 401, p);
});
