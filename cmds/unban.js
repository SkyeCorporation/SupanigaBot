module.exports = {
  config: {
    name: "unban",
    cooldown: 3,
    description: "Membuka blokir user",
    usage: "unban <@tag | reply | nomor>",
    category: "Moderasi",
    price: 0,
    role: 2,
  },
  onStart: async function ({ api, args, event, usersData, utils, prefix }) {
    const target = event.targetNumber || utils.normalizeNumber(args[0]);
    if (!target) return api.reply(`Contoh: *${prefix}unban @user*`);
    const u = await usersData.unban(target);
    await api.reply(`✅ User #${u.userID} (${u.nama}) sudah tidak dibanned.`);
  },
};
