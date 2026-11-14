module.exports = {
  config: {
    name: "unbangc",
    cooldown: 3,
    description: "Buka banned grup ini",
    category: "Moderasi",
    price: 0,
    role: 2,
  },
  onStart: async function ({ api, event, groupsData }) {
    if (!event.isGroup) return api.reply("Command ini hanya untuk grup.");
    const g = await groupsData.unban(event.chatJid);
    await api.reply(`✅ Grup *${g.groupName}* sudah tidak dibanned.`);
  },
};
