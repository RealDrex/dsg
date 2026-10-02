// Sword website: landing page + live stats + full command list.
const path = require('node:path');
const express = require('express');
const config = require('../config');
const logger = require('../core/logger');
const { describeCommands, usage } = require('../core/loader');
const { ASSETS } = require('../core/theme');

const started = Date.now();

function start(client, plugins = client?.plugins) {
  const app = express();
  app.disable('x-powered-by');

  const pluginList = [...plugins.values()].map((p) => ({
    id: p.id, name: p.name, nameAr: p.nameAr, emoji: p.emoji, description: p.description,
  }));
  const commands = describeCommands(plugins).map((c) => ({ ...c, usage: usage(c) }));

  app.get('/api/stats', (req, res) => {
    const ready = !!client?.isReady();
    res.json({
      online: ready,
      name: ready ? client.user.username : 'Sword',
      avatar: ready ? client.user.displayAvatarURL({ size: 256 }) : null,
      ping: ready ? Math.round(client.ws.ping) : null,
      guilds: ready ? client.guilds.cache.size : null,
      members: ready ? client.guilds.cache.reduce((sum, g) => sum + g.memberCount, 0) : null,
      uptime: ready ? client.uptime : Date.now() - started,
      plugins: pluginList.length,
      commands: commands.length,
      invite: config.serverInvite,
    });
  });
  app.get('/api/plugins', (req, res) => res.json(pluginList));
  app.get('/api/commands', (req, res) => res.json(commands));

  app.use('/assets', express.static(ASSETS, { maxAge: '7d' }));
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
  app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

  return app.listen(config.web.port, () => logger.info(`🌐 موقع Sword شغال على http://localhost:${config.web.port}`));
}

module.exports = { start };
