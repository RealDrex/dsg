// Validates dashboard input against a plugin's field schema. Only fields declared
// in the schema can change; everything is type-checked against the live guild.
const crypto = require('node:crypto');
const { ChannelType } = require('discord.js');
const { isIcon } = require('../core/icons');

const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const SNOWFLAKE = /^\d{17,20}$/;

const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

class FieldError extends Error {
  constructor(field, message) {
    super(`${field.label}: ${message}`);
    this.field = field.key;
  }
}

function value(field, input, guild, previous) {
  const isNull = input === null || input === undefined || input === '';
  switch (field.type) {
    case 'text':
    case 'textarea': {
      if (isNull) {
        if (field.required) throw new FieldError(field, 'مطلوب');
        return field.nullable ? null : '';
      }
      const text = String(input).slice(0, field.max || 2000);
      if (field.pattern && !new RegExp(field.pattern).test(text)) throw new FieldError(field, 'صيغة غير صحيحة');
      return text;
    }
    case 'number': {
      const num = Number(input);
      if (!Number.isFinite(num)) throw new FieldError(field, 'لازم رقم');
      const clamped = Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, Math.round(num)));
      return clamped * (field.scale || 1);
    }
    case 'bool':
      return input === true || input === 'true';
    case 'select': {
      const allowed = field.options.map((o) => o.value);
      if (!allowed.includes(input)) throw new FieldError(field, 'اختيار غير صحيح');
      return input;
    }
    case 'icon': {
      if (isNull) {
        if (field.required) throw new FieldError(field, 'اختر أيقونة');
        return null;
      }
      // Icon names from the Sword set; older configs may still hold a typed emoji.
      if (isIcon(input) || (input === previous && typeof input === 'string')) return input;
      throw new FieldError(field, 'أيقونة غير معروفة');
    }
    case 'channel':
    case 'category': {
      if (isNull) return null;
      const channel = guild.channels.cache.get(String(input));
      const ok = field.type === 'category' ? channel?.type === ChannelType.GuildCategory : TEXT_TYPES.includes(channel?.type);
      if (!ok) throw new FieldError(field, 'روم غير موجود');
      return channel.id;
    }
    case 'role': {
      if (isNull) return null;
      const role = guild.roles.cache.get(String(input));
      if (!role || role.managed || role.id === guild.id) throw new FieldError(field, 'رتبة غير صالحة');
      return role.id;
    }
    case 'channels':
      return [...new Set((Array.isArray(input) ? input : []).map(String))]
        .filter((id) => TEXT_TYPES.includes(guild.channels.cache.get(id)?.type))
        .slice(0, field.max || 50);
    case 'roles':
      return [...new Set((Array.isArray(input) ? input : []).map(String))]
        .filter((id) => {
          const role = guild.roles.cache.get(id);
          return role && !role.managed && role.id !== guild.id;
        })
        .slice(0, field.max || 50);
    case 'tags':
      return [...new Set((Array.isArray(input) ? input : []).map((t) => String(t).trim().slice(0, field.itemMax || 100)))]
        .filter((t) => t && (!field.snowflake || SNOWFLAKE.test(t)))
        .map((t) => (field.lowercase ? t.toLowerCase() : t))
        .slice(0, field.max || 100);
    case 'list': {
      const items = (Array.isArray(input) ? input : []).slice(0, field.max || 25);
      return items.map((item, i) => {
        const out = {};
        const old = Array.isArray(previous) ? previous.find((p) => field.idKey && p?.[field.idKey] === item?.[field.idKey]) : null;
        if (field.idKey) {
          const id = typeof item?.[field.idKey] === 'string' && /^[\w-]{1,40}$/.test(item[field.idKey]) ? item[field.idKey] : null;
          out[field.idKey] = id || crypto.randomBytes(4).toString('hex');
        }
        for (const sub of field.fields) {
          try {
            out[sub.key] = value(sub, item?.[sub.key], guild, old?.[sub.key]);
          } catch (err) {
            throw new FieldError(field, `العنصر ${i + 1} — ${err.message}`);
          }
        }
        return out;
      });
    }
    default:
      throw new FieldError(field, 'نوع غير معروف');
  }
}

const fieldsOf = (sections = []) => sections.flatMap((s) => s.fields || []);

// Returns a new config with schema fields taken from `input`.
function apply(sections, current, input, guild) {
  const next = structuredClone(current);
  for (const field of fieldsOf(sections)) {
    const raw = getPath(input, field.key);
    if (raw === undefined) continue;
    setPath(next, field.key, value(field, raw, guild, getPath(current, field.key)));
  }
  return next;
}

// What the browser sees: schema values in UI units (e.g. minutes instead of ms).
function present(sections, config) {
  const out = {};
  for (const field of fieldsOf(sections)) {
    let v = getPath(config, field.key);
    if (field.type === 'number' && field.scale) v = Math.round(v / field.scale);
    setPath(out, field.key, v ?? null);
  }
  return out;
}

module.exports = { apply, present, FieldError, getPath };
