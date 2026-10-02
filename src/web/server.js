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
const redirectUri = () => `${baseUrl()}/auth/callback`;
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
    id: p.id, name: p.name, nameAr: p.nameAr, emoji: p.emoji, description: p.description,
  }));
  const commands = describeCommands(plugins).map((c) => ({ ...c, usage: usage(c) }));
  const ready = () => !!client?.isReady();

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
    states.set(state, Date.now());
    for (const [k, t] of states) if (Date.now() - t > 600_000) states.delete(k);
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: config.clientId, response_type: 'code', scope: 'identify', redirect_uri: redirectUri(), state, prompt: 'none',
    });
    res.redirect(url.toString());
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !states.delete(String(state))) return res.redirect('/dashboard?error=state');
    try {
      const token = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code',
          code: String(code), redirect_uri: redirectUri(),
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
      emoji: plugin.emoji,
      description: plugin.description,
      toggleable: plugin.toggleable,
      enabled: !plugin.toggleable || store.isEnabled(guild.id, plugin.id),
      sections,
      config: schema.present(sections, store.get(guild.id, configKey(plugin))),
      actions: Object.entries(plugin.actions || {}).map(([id, a]) => ({ id, label: a.label, description: a.description, params: a.params || [], danger: !!a.danger })),
      commands: commands.filter((c) => c.plugin === plugin.id),
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
    const channels = guild.channels.cache
      .filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildCategory].includes(c.type))
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((c) => ({ id: c.id, name: c.name, type: c.type === ChannelType.GuildCategory ? 'category' : 'text', parent: c.parentId }));
    const roles = guild.roles.cache
      .filter((r) => r.id !== guild.id && !r.managed)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }));
    res.json({
      guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }), members: guild.memberCount },
      prefix: store.get(guild.id, 'core').prefix,
      channels,
      roles,
      plugins: [...plugins.values()].map((p) => pluginPayload(guild, p)),
    });
  });

  app.put('/api/guilds/:guildId/plugins/:pluginId', auth, guildAccess, async (req, res) => {
    const plugin = plugins.get(req.params.pluginId);
    if (!plugin) return res.status(404).json({ error: 'بلوقن غير موجود' });
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
    if (plugin.toggleable && !store.isEnabled(req.guild.id, plugin.id)) return res.status(400).json({ error: 'شغّل البلوقن أول' });
    try {
      const params = schema.apply([{ fields: action.params || [] }], {}, req.body.params || {}, req.guild);
      const message = await action.run(req.guild, params, req.user);
      logger.info(`🌐 ${req.user.username} نفّذ ${plugin.id}.${req.params.actionId} في ${req.guild.name}`);
      res.json({ message: message || 'تم ✅', plugin: pluginPayload(req.guild, plugin) });
    } catch (err) {
      if (err instanceof schema.FieldError || err.userFacing) return res.status(400).json({ error: err.message });
      logger.error('dashboard action:', err);
      res.status(500).json({ error: err.rawError?.message || 'فشل الإجراء — تأكد من صلاحيات البوت' });
    }
  });

  // ── Static ───────────────────────────────────────────────────
  app.use('/assets', express.static(ASSETS, { maxAge: '7d' }));
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
  app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

  return app.listen(config.web.port, () => logger.info(`🌐 موقع Sword شغال على ${baseUrl()} — لوحة التحكم: ${baseUrl()}/dashboard`));
}

module.exports = { start };
