const auth = require('./auth');

async function handleLogin({ body }) {
  if (!(process.env.TRACKET_SECRET || '').trim()) return { status: 200, body: { ok: true, open: true } };
  const cookie = auth.loginCookie(body.password);
  if (!cookie) return { status: 401, body: { error: 'Wrong password' } };
  return { status: 200, body: { ok: true }, headers: { 'Set-Cookie': cookie } };
}

module.exports = { handleLogin };
