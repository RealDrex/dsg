// Template variables for welcome/level messages.
function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

const memberVars = (member) => ({
  user: `<@${member.id}>`,
  username: member.user.username,
  tag: member.user.tag,
  server: member.guild.name,
  count: member.guild.memberCount,
});

const truncate = (text, max) => (text && text.length > max ? `${text.slice(0, max - 1)}…` : text || '');

module.exports = { fill, memberVars, truncate };
