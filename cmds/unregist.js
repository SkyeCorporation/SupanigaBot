module.exports = {
  config: {
    name: "unregist",
    cooldown: 5,
    description: "Batalkan registrasi grup ini",
    price: 0,
    role: 2,
  },
  onStart: async function ({ api, event, groupsData }) {
    if (!event.isGroup) return api.reply("Command ini hanya untuk grup.");
    const g = await groupsData.unregist(event.chatJid);
    await api.reply(`🚫 Registrasi grup *${g.groupName}* dicabut. Bot hanya merespon admin & moderator bot.`);
  },
};
