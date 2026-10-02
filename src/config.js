require('dotenv').config({ quiet: true });

const list = (value) => (value || '').split(',').map((v) => v.trim()).filter(Boolean);

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,
  ownerIds: list(process.env.OWNER_IDS),
  dbPath: process.env.DB_PATH || 'data/sword.db',
  web: {
    enabled: process.env.WEB_ENABLED !== 'false',
    port: Number(process.env.PORT) || 3000,
    publicUrl: process.env.PUBLIC_URL || null,
  },
  serverInvite: process.env.SERVER_INVITE || null,
};
