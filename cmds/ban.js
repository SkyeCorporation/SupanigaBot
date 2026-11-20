module.exports = {
  config: {
    name: "ban",
    cooldown: 3,
    description: "Memblokir user dari penggunaan bot melalui mention, balasan, atau nomor",
    usage: "ban <@tag | reply | nomor> [alasan]",
    category: "Moderasi",
    price: 0,
    role: 2,
  },
  onStart: async function ({ api, args, event, usersData, config, utils, prefix }) {
    let target = event.targetNumber;
    let rest = args;
    if (!target && args[0]) {
      target = utils.normalizeNumber(args[0]);
      rest = args.slice(1);
    } else if (target) {
      rest = args.filter((a) => !a.startsWith("@"));
    }
    if (!target) return api.reply(`Contoh: *${prefix}ban @user spam* atau *${prefix}ban 62812xxxx spam*`);
    if (config.admin.includes(target) || config.moderator.includes(target)) {
      return api.reply("❌ Admin / moderator bot tidak bisa dibanned.");
    }
    const reason = rest.join(" ").trim() || null;
    const u = await usersData.ban(target, reason);
    await api.reply(`🔨 User #${u.userID} (${u.nama}) dibanned.${reason ? `\nAlasan: ${reason}` : ""}`);
  },
};
