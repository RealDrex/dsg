// Arabic names for slash commands. Plugin code keeps English keys; this layer
// renames everything Discord sees and maps it back when commands arrive.

// Top-level command names.
const COMMANDS = {
  help: 'مساعدة', plugins: 'الأقسام', prefix: 'البريفكس', update: 'تحديث', ping: 'بنق', botinfo: 'معلومات_البوت',
  serverinfo: 'معلومات_السيرفر', userinfo: 'معلومات_عضو', avatar: 'افتار',
  ban: 'باند', unban: 'فك_باند', kick: 'طرد', timeout: 'تايم_اوت', untimeout: 'فك_تايم_اوت',
  warn: 'تحذير', warnings: 'تحذيرات', history: 'سجل', clear: 'مسح', lock: 'قفل', unlock: 'فتح',
  hide: 'إخفاء', show: 'إظهار', slowmode: 'وضع_بطيء', nick: 'لقب', role: 'رتبة', say: 'قول',
  protection: 'حماية', welcome: 'ترحيب', logs: 'لوقات',
  autorole: 'رتب_تلقائية', reactionrole: 'رتب_رياكشن', rolepanel: 'بانل_رتب',
  ticket: 'تذكرة', autoreply: 'رد_تلقائي', autoreact: 'رياكشن_تلقائي', autoline: 'خط_تلقائي',
  counter: 'عداد', colors: 'ألوان', clo: 'كلو',
};

// Subcommands, groups and options (one Arabic word per English key).
const WORDS = {
  // subcommands / groups
  list: 'القائمة', add: 'إضافة', remove: 'إزالة', delete: 'حذف', clear: 'مسح', punish: 'عقوبة', info: 'معلومات',
  panel: 'لوحة', spam: 'سبام', links: 'روابط', mentions: 'منشنات', raid: 'رايد', nuke: 'تخريب',
  ignore: 'استثناء', whitelist: 'وايت_ليست', words: 'كلمات', channel: 'الروم', message: 'الرسالة',
  style: 'الشكل', dm: 'الخاص', leave: 'المغادرة', test: 'تجربة', disable: 'إيقاف', setup: 'إعداد',
  set: 'تحديد', view: 'عرض', reward: 'مكافآت', stack: 'تجميع', announce: 'إعلان', xp: 'الخبرة',
  reset: 'تصفير', delay: 'التأخير', create: 'إنشاء', type: 'النوع', close: 'إغلاق', claim: 'استلام',
  rename: 'تسمية', image: 'صورة', refresh: 'تحديث',
  // options
  user: 'العضو', reason: 'السبب', user_id: 'الآيدي', duration: 'المدة', case: 'رقم_القضية',
  count: 'العدد', action: 'العقوبة', nickname: 'اللقب', role: 'الرتبة', embed: 'امبد', amount: 'الكمية',
  bots: 'البوتات', messages: 'الرسائل', seconds: 'الثواني', minutes: 'الدقائق', mode: 'الوضع',
  max: 'الحد_الأقصى', min: 'الحد_الأدنى', limit: 'العدد_المسموح', joins: 'الداخلين', target: 'الهدف',
  word: 'الكلمة', text: 'النص', mention: 'منشن', enabled: 'تفعيل', level: 'اللفل', cooldown: 'الانتظار',
  voice: 'فويس', for: 'لمن', message_id: 'آيدي_الرسالة', emoji: 'الإيموجي', title: 'العنوان',
  description: 'الوصف', single: 'رتبة_وحدة', label: 'اسم_الزر', name: 'الاسم', category: 'الكاتقوري',
  staff: 'الدعم', logs: 'روم_اللوقات', max_open: 'الحد_المفتوح', ping_staff: 'منشن_الدعم',
  dm_transcript: 'نسخة_بالخاص', trigger: 'المحفز', response: 'الرد', match: 'المطابقة',
  reply: 'رد_مباشر', emojis: 'الإيموجيات', url: 'الرابط', template: 'القالب', value: 'القيمة',
};

const invert = (map) => Object.fromEntries(Object.entries(map).map(([en, ar]) => [ar, en]));
const COMMANDS_EN = invert(COMMANDS);
const WORDS_EN = invert(WORDS);

// Plugins can add their own Arabic names before commands are loaded.
function register({ commands = {}, words = {} } = {}) {
  for (const [en, ar] of Object.entries(commands)) {
    COMMANDS[en] = ar;
    COMMANDS_EN[ar] = en;
  }
  for (const [en, ar] of Object.entries(words)) {
    WORDS[en] = ar;
    WORDS_EN[ar] = en;
  }
}

const ar = (name) => WORDS[name] || name;
const en = (name) => WORDS_EN[name] || name;
const commandAr = (name) => COMMANDS[name] || name;
const commandEn = (name) => COMMANDS_EN[name] || name;

// Deep-rename a command's JSON (from SlashCommandBuilder#toJSON) to Arabic.
function translateCommand(json) {
  const walk = (options) => (options || []).map((opt) => ({
    ...opt,
    name: ar(opt.name),
    ...(opt.options ? { options: walk(opt.options) } : {}),
  }));
  return { ...json, name: commandAr(json.name), ...(json.options ? { options: walk(json.options) } : {}) };
}

// Loose Arabic normalisation for typed (prefix) commands: hamza forms, taa marbuta, tatweel.
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[_\-\s]+/g, '');
}

module.exports = { COMMANDS, WORDS, ar, en, commandAr, commandEn, translateCommand, normalize, register };
