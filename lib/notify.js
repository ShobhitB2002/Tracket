// Pings the admin about new access requests. Uses whichever is configured:
//   Email:    RESEND_API_KEY + ADMIN_EMAIL   (resend.com, free tier)
//   Telegram: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
// Requests are always saved and shown in the admin panel regardless.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

async function notifyRequest(r, siteUrl) {
  const admin = siteUrl ? `${siteUrl.replace(/\/+$/, '')}/admin` : '/admin';
  const text = `New Tracket access request\n\n${r.name} <${r.email}>\n${r.note ? `“${r.note}”\n` : ''}\nReview: ${admin}`;
  const jobs = [];

  if (process.env.RESEND_API_KEY && process.env.ADMIN_EMAIL) {
    jobs.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Tracket <onboarding@resend.dev>',
        to: [process.env.ADMIN_EMAIL],
        reply_to: r.email,
        subject: `Tracket: ${r.name} wants access`,
        text,
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">
          <p><b>${esc(r.name)}</b> &lt;${esc(r.email)}&gt; asked for access to Tracket.</p>
          ${r.note ? `<blockquote style="margin:0;padding:8px 12px;border-left:3px solid #ffb547;color:#555">${esc(r.note)}</blockquote>` : ''}
          <p><a href="${esc(admin)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#ffb547;color:#111;text-decoration:none;font-weight:700">Review in admin panel</a></p></div>`,
      }),
    }));
  }
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    jobs.push(fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    }));
  }
  const results = await Promise.allSettled(jobs);
  return results.some((x) => x.status === 'fulfilled' && x.value.ok);
}

module.exports = { notifyRequest };
