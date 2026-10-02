const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const store = require('../../core/store');
const { emoji, DIVIDER, reply } = require('../../core/theme');
const { canManageRole } = require('../../utils/perms');

const TARGETS = { humans: '👤 الأعضاء', bots: '🤖 البوتات' };

async function onJoin(member) {
  const cfg = store.get(member.guild.id, 'autorole');
  const ids = member.user.bot ? cfg.bots : cfg.humans;
  if (!ids.length) return;
  const give = async () => {
    const me = member.guild.members.me;
    const roles = ids.filter((id) => {
      const role = member.guild.roles.cache.get(id);
      return role && role.position < me.roles.highest.position;
    });
    if (roles.length) await member.roles.add(roles, 'Sword Autorole').catch(() => null);
  };
  if (cfg.delay > 0) setTimeout(give, cfg.delay * 1000);
  else await give();
}

const targetOpt = (o) => o.setName('for').setDescription('لمن').setRequired(true)
  .addChoices({ name: TARGETS.humans, value: 'humans' }, { name: TARGETS.bots, value: 'bots' });

const data = new SlashCommandBuilder()
  .setName('autorole')
  .setDescription('الرتب التلقائية للداخلين الجدد')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((s) => s.setName('add').setDescription('إضافة رتبة تلقائية')
    .addRoleOption((o) => o.setName('role').setDescription('الرتبة').setRequired(true))
    .addStringOption(targetOpt))
  .addSubcommand((s) => s.setName('remove').setDescription('إزالة رتبة تلقائية')
    .addRoleOption((o) => o.setName('role').setDescription('الرتبة').setRequired(true)))
  .addSubcommand((s) => s.setName('delay').setDescription('تأخير إعطاء الرتبة (مفيد مع التحقق)')
    .addIntegerOption((o) => o.setName('seconds').setDescription('الثواني (0 = فوراً)').setRequired(true).setMinValue(0).setMaxValue(600)))
  .addSubcommand((s) => s.setName('list').setDescription('عرض الرتب التلقائية'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const { guildId } = interaction;
  const role = interaction.options.getRole('role');

  if (sub === 'list') {
    const cfg = store.get(guildId, 'autorole');
    const show = (ids) => ids.map((id) => `<@&${id}>`).join(' ') || '—';
    return reply.info(interaction, `✅ **الرتب التلقائية**\n${DIVIDER}\n${TARGETS.humans}: ${show(cfg.humans)}\n${TARGETS.bots}: ${show(cfg.bots)}\n⏱️ التأخير: \`${cfg.delay}s\``);
  }
  if (sub === 'delay') {
    store.update(guildId, 'autorole', (cfg) => { cfg.delay = interaction.options.getInteger('seconds'); });
    return reply.success(interaction, `التأخير صار \`${interaction.options.getInteger('seconds')}s\``);
  }
  if (sub === 'add') {
    const problem = canManageRole(interaction, role);
    if (problem) return reply.error(interaction, problem);
    const target = interaction.options.getString('for');
    store.update(guildId, 'autorole', (cfg) => {
      if (!cfg[target].includes(role.id)) cfg[target].push(role.id);
    });
    return reply.success(interaction, `${role} بتنعطى تلقائياً لـ ${TARGETS[target]}`);
  }
  store.update(guildId, 'autorole', (cfg) => {
    cfg.humans = cfg.humans.filter((id) => id !== role.id);
    cfg.bots = cfg.bots.filter((id) => id !== role.id);
  });
  return reply.success(interaction, `تمت إزالة ${role} من الرتب التلقائية ${emoji.sword}`);
}

module.exports = {
  id: 'autorole',
  name: 'Autorole Plugin',
  nameAr: 'بلوقن الرولات التلقائية',
  emoji: '✅',
  description: 'رتب تلقائية للأعضاء الجدد وللبوتات مع إمكانية التأخير.',
  defaults: { humans: [], bots: [], delay: 0 },
  commands: [{ data, execute }],
  dashboard: [
    {
      title: '✅ الرتب التلقائية',
      fields: [
        { key: 'humans', type: 'roles', label: '👤 رتب الأعضاء الجدد' },
        { key: 'bots', type: 'roles', label: '🤖 رتب البوتات' },
        { key: 'delay', type: 'number', label: 'التأخير (ثواني)', min: 0, max: 600, hint: 'مفيد إذا عندك نظام تحقق' },
      ],
    },
  ],
  events: { guildMemberAdd: onJoin },
};
