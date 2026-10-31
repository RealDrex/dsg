// Sword website: landing page, command list, and the settings dashboard.
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const config = require('../config');
const db = require('../core/db');
const store = require('../core/store');
const logger = require('../core/logger');
const { describeCommands, usage } = require('../core/loader');
const { ASSETS } = require('../core/theme');
const schema = require('./schema');
const { LIST: ICONS } = require('../core/icons');
const images = require('../core/images');

const started = Date.now();
const SESSION_DAYS = 7;
const COOKIE = 'sword_sid';

// ── Sessions (SQLite, survive restarts) ─────────────────────────
const sessions = {
  get: db.prepare('SELECT data FROM sessions WHERE id = ? AND expires > ?'),
  put: db.prepare('INSERT OR REPLACE INTO sessions (id, data, expires) VALUES (?, ?, ?)'),
  drop: db.prepare('DELETE FROM sessions WHERE id = ?'),
  sweep: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
};

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

const baseUrl = () => (config.web.publicUrl || `http://localhost:${config.web.port}`).replace(/\/$/, '');
// Without PUBLIC_URL, use the address the visitor actually opened (IP or localhost).
const siteUrl = (req) => (config.web.publicUrl ? baseUrl() : `${req.protocol}://${req.get('host')}`);
const redirectUri = (req) => `${siteUrl(req)}/auth/callback`;
const oauthReady = () => !!(config.clientId && config.clientSecret);
const secure = () => baseUrl().startsWith('https://');

function setCookie(res, name, value, maxAge) {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure() ? '; Secure' : ''}`);
}

function start(client, plugins = client?.plugins) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '200kb' }));

  const pluginList = [...plugins.values()].map((p) => ({
    id: p.id, name: p.name, nameAr: p.nameAr, icon: p.emoji.key, description: p.description,
  }));
  const commands = describeCommands(plugins).map((c) => ({ ...c, usage: usage(c) }));
  const ready = () => !!client?.isReady();

  // ── Ticket / activation transcripts (opened as a web page) ─────
  const transcripts = require('../core/transcripts');
  app.get('/t/:id', (req, res) => {
    const html = transcripts.get(req.params.id);
    if (!html) return res.status(404).type('text/plain').send('Transcript not found.');
    return res.type('text/html').send(html);
  });

  // ── Public API ────────────────────────────────────────────────
  app.get('/api/stats', (req, res) => {
    res.json({
      online: ready(),
      name: ready() ? client.user.username : 'Sword',
      avatar: ready() ? client.user.displayAvatarURL({ size: 256 }) : null,
      ping: ready() ? Math.round(client.ws.ping) : null,
      guilds: ready() ? client.guilds.cache.size : null,
      members: ready() ? client.guilds.cache.reduce((sum, g) => sum + g.memberCount, 0) : null,
      uptime: ready() ? client.uptime : Date.now() - started,
      plugins: pluginList.length,
      commands: commands.length,
      invite: config.serverInvite,
      prefix: ready() && config.guildId ? store.get(config.guildId, 'core').prefix : '!',
    });
  });
  app.get('/api/plugins', (req, res) => res.json(pluginList));
  app.get('/api/commands', (req, res) => res.json(commands));

  // ── Auth (Discord OAuth2, scope: identify) ───────────────────
  const states = new Map();

  app.get('/auth/login', (req, res) => {
    if (!oauthReady()) return res.redirect('/dashboard?error=oauth');
    const state = crypto.randomBytes(16).toString('hex');
    const redirect = redirectUri(req);
    states.set(state, { at: Date.now(), redirect });
    for (const [k, v] of states) if (Date.now() - v.at > 600_000) states.delete(k);
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: config.clientId, response_type: 'code', scope: 'identify', redirect_uri: redirect, state, prompt: 'none',
    });
    res.redirect(url.toString());
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    const pending = states.get(String(state));
    if (!code || !pending) return res.redirect('/dashboard?error=state');
    states.delete(String(state));
    try {
      const token = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code',
          code: String(code), redirect_uri: pending.redirect,
        }),
      }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`token ${r.status}`))));
      const me = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`me ${r.status}`))));

      const id = crypto.randomBytes(32).toString('hex');
      const user = { id: me.id, username: me.global_name || me.username, avatar: me.avatar };
      sessions.sweep.run(Date.now());
      sessions.put.run(id, JSON.stringify(user), Date.now() + SESSION_DAYS * 86_400_000);
      setCookie(res, COOKIE, id, SESSION_DAYS * 86_400);
      res.redirect('/dashboard');
    } catch (err) {
      logger.warn('OAuth callback failed:', err.message);
      res.redirect('/dashboard?error=login');
    }
  });

  app.get('/auth/logout', (req, res) => {
    const sid = cookies(req)[COOKIE];
    if (sid) sessions.drop.run(sid);
    setCookie(res, COOKIE, '', 0);
    res.redirect('/');
  });

  function auth(req, res, next) {
    const sid = cookies(req)[COOKIE];
    const row = sid && sessions.get.get(sid, Date.now());
    if (!row) return res.status(401).json({ error: 'login', oauth: oauthReady() });
    req.user = JSON.parse(row.data);
    next();
  }

  // Only members who can Manage Server (or bot owners) may touch a guild's settings.
  async function canManage(guild, userId) {
    if (config.ownerIds.includes(userId)) return true;
    const member = await guild.members.fetch(userId).catch(() => null);
    return !!member?.permissions.has(PermissionFlagsBits.ManageGuild);
  }

  async function guildAccess(req, res, next) {
    if (!ready()) return res.status(503).json({ error: 'البوت غير متصل حالياً' });
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild || !(await canManage(guild, req.user.id))) return res.status(403).json({ error: 'ما عندك صلاحية على هذا السيرفر' });
    req.guild = guild;
    next();
  }

  // Plugin config key: Bot Settings edits the shared "core" config (prefix etc.).
  const configKey = (plugin) => plugin.configKey || plugin.id;

  function pluginPayload(guild, plugin) {
    const sections = plugin.dashboard || [];
    return {
      id: plugin.id,
      name: plugin.name,
      nameAr: plugin.nameAr,
      icon: plugin.emoji.key,
      description: plugin.description,
      toggleable: plugin.toggleable,
      enabled: !plugin.toggleable || store.isEnabled(guild.id, plugin.id),
      sections,
      config: schema.present(sections, store.get(guild.id, configKey(plugin))),
      actions: Object.entries(plugin.actions || {}).map(([id, a]) => ({ id, label: a.label, description: a.description, params: a.params || [], danger: !!a.danger })),
      commands: commands.filter((c) => c.plugin === plugin.id),
      images: (plugin.images || []).map((im) => ({ ...im, custom: !!images.find(guild.id, plugin.id, im.key) })),
    };
  }

  app.get('/api/me', auth, (req, res) => res.json({ user: req.user, online: ready() }));

  app.get('/api/guilds', auth, async (req, res) => {
    if (!ready()) return res.json({ online: false, guilds: [] });
    const guilds = [];
    for (const guild of client.guilds.cache.values()) {
      if (await canManage(guild, req.user.id)) {
        guilds.push({ id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }), members: guild.memberCount });
      }
    }
    res.json({ online: true, guilds });
  });

  app.get('/api/guilds/:guildId', auth, guildAccess, (req, res) => {
    const { guild } = req;
    const channelType = (c) => {
      if (c.type === ChannelType.GuildCategory) return 'category';
      if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(c.type)) return 'voice';
      return 'text';
    };
    const channels = guild.channels.cache
      .filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildCategory, ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(c.type))
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((c) => ({ id: c.id, name: c.name, type: channelType(c), parent: c.parentId }));
    const roles = guild.roles.cache
      .filter((r) => r.id !== guild.id && !r.managed)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }));
    res.json({
      guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }), members: guild.memberCount },
      prefix: store.get(guild.id, 'core').prefix,
      icons: Object.keys(ICONS).filter((k) => !k.startsWith('dot') && !['on', 'off', 'arrow'].includes(k)),
      channels,
      roles,
      plugins: [...plugins.values()].map((p) => pluginPayload(guild, p)),
    });
  });

  // ── Live log feed (the website's own "log rooms") ─────────────
  const logstore = require('../core/logstore');
  app.get('/api/guilds/:guildId/logs', auth, guildAccess, (req, res) => {
    res.json({ entries: logstore.recent(req.guild.id, { type: req.query.type, limit: req.query.limit }) });
  });

  // ── Music bots management ─────────────────────────────────────
  const musicManager = require('../plugins/voicebots/manager');
  const { encrypt } = require('../core/secrets');
  const SNOWFLAKE = /^\d{17,20}$/;
  const TOKEN_SHAPE = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/;

  const musicList = (guild) => (store.get(guild.id, 'voicebots').bots || []).map((b) => {
    const live = musicManager.info(b.id);
    return {
      id: b.id, botId: b.botId, name: b.name, channelId: b.channelId,
      commandChannelId: b.commandChannelId || null, volume: b.volume || 100,
      running: !!b.running, status: musicManager.status(b.id).status,
      error: musicManager.status(b.id).error || null,
      avatar: live?.avatar || null,
    };
  });
  const findMusic = (guild, id) => store.get(guild.id, 'voicebots').bots.find((b) => b.id === id);
  const saveMusic = (guild, id, patch) => store.update(guild.id, 'voicebots', (cfg) => {
    const b = cfg.bots.find((x) => x.id === id); if (b) Object.assign(b, patch);
  });
  async function discordBot(token, route) {
    const r = await fetch(`https://discord.com/api/v10${route}`, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(8000) });
    return { ok: r.ok, status: r.status, body: r.ok ? await r.json() : null };
  }

  app.get('/api/guilds/:guildId/music', auth, guildAccess, (req, res) => res.json({ bots: musicList(req.guild) }));

  app.post('/api/guilds/:guildId/music', auth, guildAccess, async (req, res) => {
    try {
      const token = String(req.body.token || '').trim().replace(/^Bot\s+/i, '');
      const channelId = String(req.body.channelId || '').trim();
      const commandChannelId = String(req.body.commandChannelId || '').trim();
      if (!TOKEN_SHAPE.test(token)) return res.status(400).json({ error: 'صيغة التوكن غير صحيحة' });
      if (!SNOWFLAKE.test(channelId)) return res.status(400).json({ error: 'روم الفويس غير صحيح' });
      if (commandChannelId && !SNOWFLAKE.test(commandChannelId)) return res.status(400).json({ error: 'روم الأوامر غير صحيح' });
      const me = await discordBot(token, '/users/@me').catch(() => ({ ok: false }));
      if (!me.ok || !me.body?.bot) return res.status(400).json({ error: 'توكن غير صالح أو مو توكن بوت' });
      if (me.body.id === client.user.id) return res.status(400).json({ error: 'هذا توكن سورد نفسه' });
      const cfg = store.get(req.guild.id, 'voicebots');
      if (cfg.bots.length >= 25) return res.status(400).json({ error: 'الحد الأقصى 25 بوت' });
      const existing = cfg.bots.find((b) => b.botId === me.body.id);
      const entry = {
        id: existing?.id || crypto.randomBytes(4).toString('hex'),
        botId: me.body.id, name: me.body.global_name || me.body.username,
        token: encrypt(token), guildId: req.guild.id, channelId,
        commandChannelId: commandChannelId || null, volume: existing?.volume || 100,
        running: true, addedBy: req.user.id, addedAt: Date.now(),
      };
      store.update(req.guild.id, 'voicebots', (c) => { c.bots = c.bots.filter((b) => b.botId !== entry.botId); c.bots.push(entry); });
      musicManager.start(entry).catch((e) => logger.warn('music add:', e.message));
      logger.info(`🌐 ${req.user.username} أضاف بوت أغاني ${entry.name}`);
      res.json({ bots: musicList(req.guild) });
    } catch (err) {
      logger.error('music add:', err);
      res.status(500).json({ error: 'فشل إضافة البوت' });
    }
  });

  app.patch('/api/guilds/:guildId/music/:id', auth, guildAccess, async (req, res) => {
    const bot = findMusic(req.guild, req.params.id);
    if (!bot) return res.status(404).json({ error: 'البوت غير موجود' });
    const patch = {};
    if (typeof req.body.channelId === 'string' && SNOWFLAKE.test(req.body.channelId)) patch.channelId = req.body.channelId;
    if (typeof req.body.commandChannelId === 'string') patch.commandChannelId = SNOWFLAKE.test(req.body.commandChannelId) ? req.body.commandChannelId : null;
    if (Number.isFinite(req.body.volume)) patch.volume = Math.min(150, Math.max(10, Math.round(req.body.volume)));
    const rename = typeof req.body.name === 'string' && req.body.name.trim() && req.body.name.trim() !== bot.name ? req.body.name.trim() : null;
    if (rename) patch.name = rename;
    saveMusic(req.guild, bot.id, patch);
    const fresh = findMusic(req.guild, bot.id);
    try {
      if (rename) await musicManager.applyProfile(fresh, { name: rename });
      if (patch.channelId || 'commandChannelId' in patch) await musicManager.start(fresh); // restart to apply channels
    } catch (err) {
      return res.status(400).json({ error: err.userFacing ? err.message : (err.message || 'فشل التعديل') });
    }
    res.json({ bots: musicList(req.guild) });
  });

  app.post('/api/guilds/:guildId/music/:id/avatar', auth, guildAccess, express.raw({ type: () => true, limit: 8 * 1024 * 1024 }), async (req, res) => {
    const bot = findMusic(req.guild, req.params.id);
    if (!bot) return res.status(404).json({ error: 'البوت غير موجود' });
    try {
      await musicManager.applyProfile(bot, { avatar: req.body });
      res.json({ bots: musicList(req.guild) });
    } catch (err) {
      res.status(400).json({ error: err.userFacing ? err.message : 'فشل تغيير الأفتار (جرّب بعد شوي — في حد أقصى للتغييرات)' });
    }
  });

  app.post('/api/guilds/:guildId/music/:id/start', auth, guildAccess, async (req, res) => {
    const bot = findMusic(req.guild, req.params.id);
    if (!bot) return res.status(404).json({ error: 'البوت غير موجود' });
    saveMusic(req.guild, bot.id, { running: true });
    await musicManager.start(findMusic(req.guild, bot.id)).catch(() => null);
    res.json({ bots: musicList(req.guild) });
  });

  app.post('/api/guilds/:guildId/music/:id/stop', auth, guildAccess, async (req, res) => {
    const bot = findMusic(req.guild, req.params.id);
    if (!bot) return res.status(404).json({ error: 'البوت غير موجود' });
    saveMusic(req.guild, bot.id, { running: false });
    await musicManager.stop(bot.id);
    res.json({ bots: musicList(req.guild) });
  });

  app.delete('/api/guilds/:guildId/music/:id', auth, guildAccess, async (req, res) => {
    const bot = findMusic(req.guild, req.params.id);
    if (!bot) return res.status(404).json({ error: 'البوت غير موجود' });
    await musicManager.stop(bot.id);
    store.update(req.guild.id, 'voicebots', (c) => { c.bots = c.bots.filter((b) => b.id !== bot.id); });
    res.json({ bots: musicList(req.guild) });
  });

  app.put('/api/guilds/:guildId/plugins/:pluginId', auth, guildAccess, async (req, res) => {
    const plugin = plugins.get(req.params.pluginId);
    if (!plugin) return res.status(404).json({ error: 'قسم غير موجود' });
    const { guild } = req;
    try {
      if (typeof req.body.enabled === 'boolean' && plugin.toggleable) store.setEnabled(guild.id, plugin.id, req.body.enabled);
      if (req.body.config && plugin.dashboard) {
        const key = configKey(plugin);
        const previous = structuredClone(store.get(guild.id, key));
        const next = schema.apply(plugin.dashboard, previous, req.body.config, guild);
        plugin.validate?.(next);
        store.save(guild.id, key, next);
        await plugin.dashboardSaved?.(guild, previous, next);
      }
      logger.info(`🌐 ${req.user.username} حدّث ${plugin.id} في ${guild.name}`);
      res.json(pluginPayload(guild, plugin));
    } catch (err) {
      if (err instanceof schema.FieldError || err.userFacing) return res.status(400).json({ error: err.message, field: err.field });
      logger.error('dashboard save:', err);
      res.status(500).json({ error: 'صار خطأ أثناء الحفظ' });
    }
  });

  app.post('/api/guilds/:guildId/plugins/:pluginId/actions/:actionId', auth, guildAccess, async (req, res) => {
    const plugin = plugins.get(req.params.pluginId);
    const action = plugin?.actions?.[req.params.actionId];
    if (!action) return res.status(404).json({ error: 'إجراء غير موجود' });
    if (plugin.toggleable && !store.isEnabled(req.guild.id, plugin.id)) return res.status(400).json({ error: 'شغّل القسم أول' });
    try {
      const params = schema.apply([{ fields: action.params || [] }], {}, req.body.params || {}, req.guild);
      const message = await action.run(req.guild, params, req.user);
      logger.info(`🌐 ${req.user.username} نفّذ ${plugin.id}.${req.params.actionId} في ${req.guild.name}`);
      res.json({ message: message || 'تم', plugin: pluginPayload(req.guild, plugin) });
    } catch (err) {
      if (err instanceof schema.FieldError || err.userFacing) return res.status(400).json({ error: err.message });
      logger.error('dashboard action:', err);
      res.status(500).json({ error: err.rawError?.message || 'فشل الإجراء — تأكد من صلاحيات البوت' });
    }
  });

  // ── Custom images (e.g. game banners) ────────────────────────
  const imageTarget = (req, res) => {
    const plugin = plugins.get(req.params.pluginId);
    const entry = plugin?.images?.find((im) => im.key === req.params.key);
    if (!entry) {
      res.status(404).json({ error: 'صورة غير موجودة' });
      return null;
    }
    return plugin;
  };

  app.get('/api/guilds/:guildId/plugins/:pluginId/images/:key', auth, guildAccess, async (req, res) => {
    const plugin = imageTarget(req, res);
    if (!plugin) return;
    const custom = images.find(req.guild.id, plugin.id, req.params.key);
    res.set('Cache-Control', 'no-store');
    if (custom) return res.type(custom.type).sendFile(custom.file);
    try {
      res.type('image/png').send(await plugin.renderImage(req.params.key, req.guild));
    } catch (err) {
      logger.error('render image:', err);
      res.status(500).end();
    }
  });

  app.put('/api/guilds/:guildId/plugins/:pluginId/images/:key', auth, guildAccess,
    express.raw({ type: () => true, limit: images.MAX_BYTES }), (req, res) => {
      const plugin = imageTarget(req, res);
      if (!plugin) return;
      try {
        images.save(req.guild.id, plugin.id, req.params.key, req.body);
        logger.info(`🌐 ${req.user.username} رفع صورة ${plugin.id}/${req.params.key} في ${req.guild.name}`);
        res.json(pluginPayload(req.guild, plugin));
      } catch (err) {
        res.status(400).json({ error: err.userFacing ? err.message : 'فشل رفع الصورة' });
      }
    });

  app.delete('/api/guilds/:guildId/plugins/:pluginId/images/:key', auth, guildAccess, (req, res) => {
    const plugin = imageTarget(req, res);
    if (!plugin) return;
    images.remove(req.guild.id, plugin.id, req.params.key);
    res.json(pluginPayload(req.guild, plugin));
  });

  // ── Static ───────────────────────────────────────────────────
  app.use('/assets', express.static(ASSETS, { maxAge: '7d' }));
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
  app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

  return app.listen(config.web.port, () => logger.info(`🌐 موقع Sword شغال على ${baseUrl()} — لوحة التحكم: ${baseUrl()}/dashboard`));
}

module.exports = { start };
