// Web Push with zero dependencies: VAPID (ES256 JWT) + aes128gcm payload
// encryption (RFC 8291 / 8188). Works for desktop browsers, Android Chrome and
// iPhone/iPad (Tracket added to the Home Screen, iOS 16.4+) — and so on watches
// that mirror the phone's notifications.
//
// The VAPID key pair is made on first use and kept in the store (private half
// encrypted), unless VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are set.
const crypto = require('crypto');
const store = require('./store');
const c = require('./crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');

async function vapid() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
  for (let i = 0; i < 5; i++) {
    const v = await store.get('vapid');
    const priv = v && c.decrypt(v.priv);
    if (priv) return { pub: v.pub, priv };
    // only one request may create it, or devices would subscribe to a key we then lose
    if (await store.lock('vapidgen', 5000)) {
      const ecdh = crypto.createECDH('prime256v1');
      ecdh.generateKeys();
      const out = { pub: b64u(ecdh.getPublicKey()), priv: b64u(ecdh.getPrivateKey()) };
      await store.set('vapid', { pub: out.pub, priv: c.encrypt(out.priv) });
      return out;
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error('Could not load push keys');
}

function jwt(aud, v, sub) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub }));
  const pub = Buffer.from(v.pub, 'base64url');
  const key = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: v.priv, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${body}.${b64u(sig)}`;
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// aes128gcm body for one subscription (a single record).
function encrypt(payload, keys) {
  const uaPub = Buffer.from(keys.p256dh, 'base64url');
  const auth = Buffer.from(keys.auth, 'base64url');
  const ecdh = crypto.createECDH('prime256v1');
  const asPub = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPub);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub, Buffer.from([1])]));
  const salt = crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(4096, 16);
  head[20] = asPub.length;
  return Buffer.concat([head, asPub, ct]);
}

const subject = () => (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'mailto:tracket@example.com');

// → HTTP status from the push service (201 = delivered to it)
async function sendOne(sub, payload, v) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: '3600', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      Authorization: `vapid t=${jwt(new URL(sub.endpoint).origin, v, subject())}, k=${v.pub}`,
    },
    body: encrypt(JSON.stringify(payload), sub.keys),
  });
  return res.status;
}

// ---------- per-member subscriptions: u:<id>:push = { <hash>: { sub, ua, at } } ----------
const K = (uid) => `u:${uid}:push`;
const validSub = (s) => s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.keys?.p256dh && s.keys?.auth;

async function subscribe(uid, sub, ua) {
  if (!validSub(sub)) { const e = new Error('Bad subscription'); e.status = 400; throw e; }
  const all = (await store.get(K(uid))) || {};
  all[c.sha(sub.endpoint).slice(0, 16)] = { sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, ua: String(ua || '').slice(0, 60), at: Date.now() };
  await store.set(K(uid), all);
  return Object.keys(all).length;
}

async function unsubscribe(uid, endpoint) {
  const all = (await store.get(K(uid))) || {};
  delete all[c.sha(String(endpoint || '')).slice(0, 16)];
  await store.set(K(uid), all);
}

const devices = async (uid) => Object.values((await store.get(K(uid))) || {}).map((d) => ({ ua: d.ua, at: d.at }));

// Sends to every device of a member; drops subscriptions the service says are gone.
async function sendTo(uid, payload) {
  require('./usage').add('push');
  const all = (await store.get(K(uid))) || {};
  const ids = Object.keys(all);
  if (!ids.length) return { sent: 0, devices: 0 };
  const v = await vapid();
  let sent = 0, dirty = false;
  await Promise.all(ids.map(async (id) => {
    try {
      const st = await sendOne(all[id].sub, payload, v);
      if (st >= 200 && st < 300) sent++;
      else if ([403, 404, 410].includes(st)) { delete all[id]; dirty = true; }
    } catch {}
  }));
  if (dirty) await store.set(K(uid), all);
  return { sent, devices: ids.length };
}

module.exports = { vapid, subscribe, unsubscribe, devices, sendTo, _internal: { encrypt, jwt } };
