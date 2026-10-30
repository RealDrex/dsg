// Scheduled chat cleaner: wipes the messages of chosen rooms on a fixed cycle
// (default every 2 hours). Useful for media/spam rooms that should stay clean.
const store = require('../../core/store');
const logger = require('../../core/logger');
const { I } = require('../../core/icons');

const ID = 'autoclean';
const cfgOf = (guildId) => store.get(guildId, ID);

const lastClear = new Map(); // channelId -> timestamp
const FRESH = 14 * 24 * 60 * 60 * 1000; // bulkDelete only works on messages < 14 days

// Delete as many (non-pinned, < 14 day) messages as possible from a channel.
async function clearChat(channel) {
  let removed = 0;
  for (let i = 0; i < 10; i += 1) {
    const batch = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!batch || !batch.size) break;
    const fresh = batch.filter((m) => Date.now() - m.createdTimestamp < FRESH && !m.pinned);
    if (!fresh.size) break;
    const res = await channel.bulkDelete(fresh, true).catch(() => null);
    if (!res || !res.size) break;
    removed += res.size;
    if (res.size < 100) break;
  }
  return removed;
}

async function sweep(client) {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    if (!store.isEnabled(guild.id, ID)) continue;
    const cfg = cfgOf(guild.id);
    if (!cfg.channels?.length) continue;
    const everyMs = Math.max(1, cfg.hours || 2) * 60 * 60 * 1000;
    for (const channelId of cfg.channels) {
      const ch = guild.channels.cache.get(channelId);
      if (!ch || typeof ch.bulkDelete !== 'function') continue;
      if (now - (lastClear.get(channelId) || 0) < everyMs) continue;
      lastClear.set(channelId, now);
      await clearChat(ch).catch((err) => logger.warn('autoclean:', err.message));
    }
  }
}

module.exports = {
  id: ID,
  name: 'Auto Clean',
  nameAr: 'المسح التلقائي',
  emoji: I.clear,
  description: 'يمسح رسائل الرومات المحددة تلقائياً كل فترة (افتراضي كل ساعتين).',
  defaults: {
    channels: [],
    hours: 2,
  },
  dashboard: [
    {
      title: 'المسح التلقائي', icon: 'clear',
      description: 'حدد الرومات اللي تنمسح رسائلها تلقائياً وكل كم ساعة.',
      fields: [
        { key: 'channels', type: 'channels', label: 'الرومات اللي تنمسح', max: 25 },
        { key: 'hours', type: 'number', label: 'كل كم ساعة', min: 1, max: 168 },
      ],
    },
  ],
  actions: {
    now: {
      label: 'امسح الرومات الآن',
      description: 'يمسح رسائل كل الرومات المحددة فوراً بدون انتظار الدورة.',
      danger: true,
      async run(guild) {
        const cfg = cfgOf(guild.id);
        if (!cfg.channels?.length) return 'ما فيه رومات محددة للمسح.';
        let total = 0;
        for (const channelId of cfg.channels) {
          const ch = guild.channels.cache.get(channelId);
          if (ch && typeof ch.bulkDelete === 'function') {
            lastClear.set(channelId, Date.now());
            total += await clearChat(ch).catch(() => 0);
          }
        }
        return `تم مسح \`${total}\` رسالة من ${cfg.channels.length} روم.`;
      },
    },
  },
  async ready(client) {
    // Check every 10 minutes; each room is cleared on its own hour cycle.
    setInterval(() => sweep(client).catch(() => null), 10 * 60 * 1000);
  },
};
