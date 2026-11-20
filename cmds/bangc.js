module.exports = {
  config: {
    name: "bangc",
    cooldown: 3,
    description: "Memblokir grup ini dari penggunaan bot",
    usage: "bangc [alasan]",
    category: "Moderasi",
    price: 0,
    role: 2,
  },
  onStart: async function ({ api, args, event, groupsData }) {
    if (!event.isGroup) return api.reply("Command ini hanya untuk grup.");
    const reason = args.join(" ").trim() || null;
    const g = await groupsData.ban(event.chatJid, reason);
    await api.reply(`🔨 Grup *${g.groupName}* (GID ${g.gid}) dibanned.${reason ? `\nAlasan: ${reason}` : ""}`);
  },
};
