// Builds a self-contained, Sword-themed HTML transcript of a ticket channel.
const fs = require('node:fs');
const path = require('node:path');
const { ASSETS } = require('../../core/theme');

const logo = `data:image/png;base64,${fs.readFileSync(path.join(ASSETS, 'logo-96.png')).toString('base64')}`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function fetchAll(channel, max = 1000) {
  const out = [];
  let before;
  while (out.length < max) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    out.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return out.reverse();
}

function renderMessage(m) {
  const embeds = m.embeds.map((e) => `<div class="embed">${e.title ? `<b>${esc(e.title)}</b>` : ''}${e.description ? `<p>${esc(e.description)}</p>` : ''}</div>`).join('');
  const files = [...m.attachments.values()].map((a) => (a.contentType?.startsWith('image/')
    ? `<a href="${esc(a.url)}"><img class="att" src="${esc(a.url)}" alt=""></a>`
    : `<a class="file" href="${esc(a.url)}">مرفق: ${esc(a.name)}</a>`)).join('');
  return `<div class="msg">
  <img class="av" src="${esc(m.author.displayAvatarURL({ size: 64 }))}" alt="">
  <div class="body">
    <div class="head"><span class="name${m.author.bot ? ' bot' : ''}">${esc(m.member?.displayName || m.author.username)}</span>${m.author.bot ? '<span class="tag">BOT</span>' : ''}<span class="time">${new Date(m.createdTimestamp).toLocaleString('en-GB')}</span></div>
    ${m.content ? `<div class="content">${esc(m.content)}</div>` : ''}${embeds}${files}
  </div>
</div>`;
}

async function build(channel, ticket) {
  const messages = await fetchAll(channel);
  const html = `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sword • Ticket #${String(ticket.number).padStart(4, '0')}</title>
<style>
:root{--bg:#050505;--panel:#0f0f10;--line:#1d1d1f;--text:#e8e8e8;--muted:#8a8a8a;--accent:#9e1b1b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}
header{display:flex;gap:16px;align-items:center;padding:24px 32px;border-bottom:1px solid var(--line);background:linear-gradient(90deg,#000,#0f0f10)}
header img{width:56px;height:56px;border-radius:50%}header h1{margin:0;font-size:20px;letter-spacing:.5px}
header p{margin:4px 0 0;color:var(--muted);font-size:13px}.bar{height:2px;background:var(--accent);width:120px;margin-top:8px}
main{max-width:960px;margin:0 auto;padding:16px}
.msg{display:flex;gap:12px;padding:10px 12px;border-radius:8px}.msg:hover{background:var(--panel)}
.av{width:40px;height:40px;border-radius:50%;flex:none}.body{min-width:0;flex:1}
.head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.name{font-weight:600}.name.bot{color:#cfcfcf}
.tag{background:var(--accent);color:#fff;font-size:10px;padding:1px 5px;border-radius:3px}.time{color:var(--muted);font-size:12px}
.content{white-space:pre-wrap;word-wrap:break-word;margin-top:2px;line-height:1.5}
.embed{border-inline-start:3px solid #d4d4d4;background:var(--panel);padding:8px 12px;margin-top:6px;border-radius:4px;white-space:pre-wrap}
.embed p{margin:4px 0 0;color:#cfcfcf}.att{max-width:360px;max-height:280px;border-radius:6px;margin-top:6px;display:block}
.file{display:inline-block;margin-top:6px;color:#d4d4d4}footer{text-align:center;color:var(--muted);font-size:12px;padding:24px}
</style></head><body>
<header><img src="${logo}" alt="Sword"><div><h1>Ticket #${String(ticket.number).padStart(4, '0')} — ${esc(ticket.typeLabel)}</h1>
<p>${esc(channel.guild.name)} • صاحب التذكرة: ${esc(ticket.ownerTag)} • ${messages.length} رسالة</p><div class="bar"></div></div></header>
<main>${messages.map(renderMessage).join('\n')}</main>
<footer>Sword • Private Server — ${new Date().toLocaleString('en-GB')}</footer>
</body></html>`;
  return { html, count: messages.length };
}

module.exports = { build };
