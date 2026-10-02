const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

// "1d2h", "30m", "45s", "2w" -> milliseconds (null when invalid)
function parseDuration(input) {
  if (!input) return null;
  const text = String(input).toLowerCase().replace(/\s+/g, '');
  if (/^\d+$/.test(text)) return Number(text) * UNITS.m;
  const parts = [...text.matchAll(/(\d+)([smhdw])/g)];
  if (!parts.length || parts.map((p) => p[0]).join('') !== text) return null;
  return parts.reduce((sum, [, n, u]) => sum + Number(n) * UNITS[u], 0);
}

function formatDuration(ms) {
  if (!ms || ms < 1000) return 'أقل من ثانية';
  const out = [];
  const add = (value, word) => value && out.push(`${value} ${word}`);
  add(Math.floor(ms / UNITS.d), 'يوم');
  add(Math.floor((ms % UNITS.d) / UNITS.h), 'ساعة');
  add(Math.floor((ms % UNITS.h) / UNITS.m), 'دقيقة');
  add(Math.floor((ms % UNITS.m) / UNITS.s), 'ثانية');
  return out.slice(0, 3).join(' و ');
}

const ts = (date, style = 'R') => `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;

module.exports = { parseDuration, formatDuration, ts };
