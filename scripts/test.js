// Unit tests for the Arabic command layer and prefix parser (no Discord connection).
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const { Collection, ChannelType } = require('discord.js');
const { loadPlugins } = require('../src/core/loader');
const { fromPrefix, fromSlash } = require('../src/core/options');
const { normalize } = require('../src/core/i18n');

const { commands, aliases } = loadPlugins();
const byKey = (key) => [...commands.values()].find((c) => c.key === key);

const USER_ID = '111111111111111111';
const ROLE_ID = '222222222222222222';
const CHAN_ID = '333333333333333333';
const user = { id: USER_ID, username: 'drex' };
const member = { id: USER_ID, user, displayName: 'Drex' };
const guild = {
  members: {
    fetch: async (id) => (id === USER_ID ? member : null),
    cache: new Collection([[USER_ID, member]]),
  },
  roles: { cache: new Collection([[ROLE_ID, { id: ROLE_ID, name: 'Staff' }]]) },
  channels: { cache: new Collection([[CHAN_ID, { id: CHAN_ID, name: 'general', type: ChannelType.GuildText }]]) },
};
const client = { users: { fetch: async () => user } };
const parse = (key, text) => fromPrefix(byKey(key).json, text, guild, client);

test('aliases resolve Arabic, English and loose spelling', () => {
  assert.equal(aliases.get(normalize('باند')).key, 'ban');
  assert.equal(aliases.get(normalize('ban')).key, 'ban');
  assert.equal(aliases.get(normalize('اخفاء')).key, 'hide'); // typed without hamza
  assert.equal(aliases.get(normalize('فك_باند')).key, 'unban');
});

test('ban: user mention + multi-word reason', async () => {
  const { options } = await parse('ban', `<@${USER_ID}> سبام في الشات`);
  assert.equal(options.getUser('user').id, USER_ID);
  assert.equal(options.getMember('user'), member);
  assert.equal(options.getString('reason'), 'سبام في الشات');
});

test('missing required option reports usage', async () => {
  const res = await parse('kick', '');
  assert.equal(res.error, 'missing');
  assert.equal(res.option.name, 'العضو');
});

test('timeout: user, duration then reason', async () => {
  const { options } = await parse('timeout', `${USER_ID} 10m كثرة سبام`);
  assert.equal(options.getString('duration'), '10m');
  assert.equal(options.getString('reason'), 'كثرة سبام');
});

test('subcommand groups: protection whitelist add (two-word group typed with space)', async () => {
  const { options } = await parse('protection', `وايت ليست اضافة <@&${ROLE_ID}>`);
  assert.equal(options.getSubcommandGroup(), 'whitelist');
  assert.equal(options.getSubcommand(), 'add');
  assert.equal(options.getMentionable('target').id, ROLE_ID);
});

test('subcommand by English name and choice by Arabic label', async () => {
  const { options } = await parse('warnings', 'punish 3 طرد');
  assert.equal(options.getSubcommand(), 'punish');
  assert.equal(options.getInteger('count'), 3);
  assert.equal(options.getString('action'), 'kick');
});

test('booleans and channels', async () => {
  const dm = await parse('welcome', 'الخاص نعم مرحبا فيك');
  assert.equal(dm.options.getSubcommand(), 'dm');
  assert.equal(dm.options.getBoolean('enabled'), true);
  assert.equal(dm.options.getString('text'), 'مرحبا فيك');

  const leave = await parse('welcome', `المغادرة <#${CHAN_ID}> وداعا`);
  assert.equal(leave.options.getSubcommand(), 'leave');
  assert.equal(leave.options.getChannel('channel').id, CHAN_ID);
  assert.equal(leave.options.getString('text'), 'وداعا');
});

test('integer range is enforced', async () => {
  const res = await parse('clear', '500');
  assert.equal(res.error, 'invalid');
});

test('missing subcommand lists the choices', async () => {
  const res = await parse('ticket', '');
  assert.equal(res.error, 'missing-sub');
});

test('slash adapter maps Arabic names back to English', () => {
  const interaction = {
    options: {
      data: [{
        type: 2, name: 'وايت_ليست',
        options: [{ type: 1, name: 'إضافة', options: [{ type: 9, name: 'الهدف', value: USER_ID, user, member }] }],
      }],
    },
  };
  const options = fromSlash(interaction);
  assert.equal(options.getSubcommandGroup(), 'whitelist');
  assert.equal(options.getSubcommand(), 'add');
  assert.equal(options.getMentionable('target'), member);
});

test('game commands resolve by Arabic name, including ة/ه spelling', () => {
  assert.equal(aliases.get(normalize('حجره')).key, 'rps');
  assert.equal(aliases.get(normalize('حجرة')).key, 'rps');
  assert.equal(aliases.get(normalize('روليتز')).key, 'roulettez');
  assert.equal(aliases.get(normalize('توب')).key, 'gtop');
  assert.equal(aliases.get(normalize('ايقاف')).key, 'gstop');
});

test('game prefix arguments: transfer, top, vote, duel', async () => {
  let r = await parse('transfer', `<@${USER_ID}> 50`);
  assert.equal(r.options.getUser('user').id, USER_ID);
  assert.equal(r.options.getInteger('amount'), 50);
  r = await parse('gtop', 'روليت');
  assert.equal(r.options.getString('game'), 'روليت');
  r = await parse('vote', 'أفضل لعبة؟ | روليت | مافيا');
  assert.equal(r.options.getString('question'), 'أفضل لعبة؟ | روليت | مافيا');
  r = await parse('rps', '');
  assert.equal(r.options.getUser('user'), null);
});
