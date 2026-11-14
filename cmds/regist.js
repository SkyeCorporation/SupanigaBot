module.exports = {
  config: {
    name: "regist",
    cooldown: 5,
    description: "Daftarkan grup ini agar bot aktif",
    category: "Admin Grup",
    price: 0,
    role: 2,
  },
  onStart: async function ({ api, event, groupsData }) {
    if (!event.isGroup) return api.reply("Command ini hanya untuk grup.");
    const g = await groupsData.regist(event.chatJid);
    await api.reply(`✅ Grup *${g.groupName}* (GID ${g.gid}) berhasil diregistrasi. Bot aktif untuk semua anggota.`);
  },
};
