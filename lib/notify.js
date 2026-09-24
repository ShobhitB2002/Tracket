// Email + admin pings.
//   Email, preferred:  GMAIL_USER + GMAIL_APP_PASSWORD — a Gmail account sends
//                      over SMTP (free, ~500 emails a day, any recipient)
//   Email, fallback:   RESEND_API_KEY (without a verified domain in RESEND_FROM,
//                      Resend only delivers to the Resend account's own address)
//   Admin pings:       ADMIN_EMAIL gets access requests
// Requests are always saved and shown in the admin panel regardless.
const tls = require('tls');
const net = require('net');
const crypto = require('crypto');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const gmail = () => (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD ? {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  tls: process.env.SMTP_TLS !== '0', // only for local tests
  user: process.env.GMAIL_USER.trim(),
  pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, ''), // Google shows it in groups of 4
} : null);
const emailVia = () => (gmail() ? 'gmail' : process.env.RESEND_API_KEY ? 'resend' : null);

// ---------- SMTP (implicit TLS, AUTH PLAIN) ----------
const b64lines = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

function message({ from, to, subject, html, text, replyTo }) {
  const b = 'tk' + crypto.randomBytes(12).toString('hex');
  const domain = from.split('@')[1] || 'tracket';
  return [
    `From: ${encWord('Tracket')} <${from}>`, `To: <${to}>`, ...(replyTo ? [`Reply-To: <${replyTo}>`] : []),
    `Subject: ${encWord(subject)}`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${b}"`, '',
    `--${b}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(text || ''),
    `--${b}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(html || esc(text || '')),
    `--${b}--`, '',
  ].join('\r\n');
}

function smtpSend(cfg, mail) {
  return new Promise((resolve) => {
    const sock = cfg.tls ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }) : net.connect({ host: cfg.host, port: cfg.port });
    let buf = '', waiting = null, finished = false;
    const done = (r) => { if (finished) return; finished = true; clearTimeout(timer); sock.destroy(); resolve(r); };
    const timer = setTimeout(() => done({ ok: false, error: 'Gmail didn’t answer in time' }), 15000);
    sock.setEncoding('utf8');
    sock.on('error', (e) => done({ ok: false, error: `Gmail: ${e.message}` }));
    // a reply is complete at a line "NNN text" (no dash after the code)
    const deliver = () => {
      const m = buf.match(/(^|\r\n)(\d{3}) [^\r\n]*\r\n$/);
      if (m && waiting) { const code = Number(m[2]), all = buf; buf = ''; const w = waiting; waiting = null; w({ code, text: all.trim() }); }
    };
    sock.on('data', (d) => { buf += d; deliver(); });
    const read = () => new Promise((r) => { waiting = r; deliver(); });
    const cmd = (line) => { const p = read(); sock.write(line + '\r\n'); return p; };
    const expect = (r, ok, what) => { if (r.code !== ok) throw new Error(`${what}: ${r.text.split('\r\n').pop().slice(0, 160)}`); };
    (async () => {
      expect(await read(), 220, 'Gmail greeting');
      expect(await cmd('EHLO tracket'), 250, 'EHLO');
      const auth = await cmd('AUTH PLAIN ' + Buffer.from(`\0${cfg.user}\0${cfg.pass}`).toString('base64'));
      if (auth.code === 535 || auth.code === 534) throw new Error('Gmail rejected the login — check GMAIL_USER and the 16-letter app password (2-Step Verification must be on)');
      expect(auth, 235, 'Login');
      if (mail.verifyOnly) { sock.write('QUIT\r\n'); return done({ ok: true, verified: true }); }
      expect(await cmd(`MAIL FROM:<${cfg.user}>`), 250, 'Sender');
      expect(await cmd(`RCPT TO:<${mail.to}>`), 250, 'Recipient');
      expect(await cmd('DATA'), 354, 'DATA');
      // dot-stuffing (base64 bodies never start with ".", headers could)
      const body = message({ ...mail, from: cfg.user }).replace(/\r\n\./g, '\r\n..');
      expect(await cmd(body + '\r\n.'), 250, 'Send');
      sock.write('QUIT\r\n');
      done({ ok: true });
    })().catch((e) => done({ ok: false, error: e.message }));
  });
}

// Any email → { ok, error }
async function sendEmail({ to, subject, html, text, replyTo }) {
  const g = gmail();
  if (g) return smtpSend(g, { to, subject, html, text, replyTo });
  if (!process.env.RESEND_API_KEY) return { ok: false, error: 'Email isn’t set up on this Tracket (add GMAIL_USER + GMAIL_APP_PASSWORD in Vercel)' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.RESEND_FROM || 'Tracket <onboarding@resend.dev>', to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: String(body.message || body.error || `Resend ${res.status}`).slice(0, 200) };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200) }; }
}

async function notifyRequest(r, siteUrl) {
  const admin = siteUrl ? `${siteUrl.replace(/\/+$/, '')}/admin` : '/admin';
  const text = `New Tracket access request\n\n${r.name} <${r.email}>\n${r.note ? `“${r.note}”\n` : ''}\nReview: ${admin}`;
  const jobs = [];
  if (process.env.ADMIN_EMAIL && emailVia()) {
    jobs.push(sendEmail({
      to: process.env.ADMIN_EMAIL, replyTo: r.email, subject: `Tracket: ${r.name} wants access`, text,
      html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">
        <p><b>${esc(r.name)}</b> &lt;${esc(r.email)}&gt; asked for access to Tracket.</p>
        ${r.note ? `<blockquote style="margin:0;padding:8px 12px;border-left:3px solid #ffb547;color:#555">${esc(r.note)}</blockquote>` : ''}
        <p><a href="${esc(admin)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#ffb547;color:#111;text-decoration:none;font-weight:700">Review in admin panel</a></p></div>`,
    }).then((x) => ({ ok: x.ok })));
  }
  const results = await Promise.allSettled(jobs);
  return results.some((x) => x.status === 'fulfilled' && x.value.ok);
}

// Logs in to Gmail and quits without sending — for the admin panel's check.
async function checkEmail() {
  const g = gmail();
  if (!g) return { ok: false, via: emailVia(), error: 'GMAIL_USER / GMAIL_APP_PASSWORD not set (or not deployed yet)' };
  return { via: 'gmail', user: g.user, ...(await smtpSend(g, { verifyOnly: true })) };
}

module.exports = { notifyRequest, sendEmail, emailVia, checkEmail, esc, _internal: { message } };
