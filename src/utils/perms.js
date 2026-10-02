// Role hierarchy checks shared by moderation commands.
function checkTarget(interaction, target, action = 'هذا الإجراء') {
  const { guild, member: moderator } = interaction;
  const me = guild.members.me;
  if (!target) return null;
  if (target.id === moderator.id) return `ما تقدر تسوي ${action} على نفسك.`;
  if (target.id === guild.ownerId) return 'ما تقدر تعاقب مالك السيرفر.';
  if (target.id === me.id) return 'ما أقدر أسوي هذا على نفسي ⚔️';
  if (moderator.id !== guild.ownerId && target.roles.highest.position >= moderator.roles.highest.position) {
    return 'رتبة العضو أعلى منك أو مساوية لك.';
  }
  if (target.roles.highest.position >= me.roles.highest.position) {
    return 'رتبة العضو أعلى من رتبتي، ارفع رتبة البوت فوقه.';
  }
  return null;
}

function canManageRole(interaction, role) {
  const { guild, member } = interaction;
  if (role.managed || role.id === guild.id) return 'هذي الرتبة ما ينفع تتعدل (رتبة بوت أو @everyone).';
  if (role.position >= guild.members.me.roles.highest.position) return 'الرتبة أعلى من رتبة البوت.';
  if (member.id !== guild.ownerId && role.position >= member.roles.highest.position) return 'الرتبة أعلى من رتبتك.';
  return null;
}

module.exports = { checkTarget, canManageRole };
