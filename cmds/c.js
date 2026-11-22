function botID(value) {
  if (!/^#?[1-9]\d*$/.test(value || "")) return null;
  const id = Number(value.replace("#", ""));
  return Number.isSafeInteger(id) ? id : null;
}

async function findGroup({ api, event, groupsData, prefix }, action, value) {
  if (value !== undefined) {
    const id = botID(value);
    if (!id) {
      await api.reply(`Gunakan: ${prefix}c ${action} <ID bot grup>`);
      return null;
    }
    const group = await groupsData.getByGid(id);
    if (!group) await api.reply(`Grup dengan GID ${id} tidak ditemukan.`);
    return group;
  }
  if (!event.isGroup) {
    await api.reply(`Di chat pribadi, sertakan ID bot grup: ${prefix}c ${action} <ID>`);
    return null;
  }
  return groupsData.get(event.chatJid);
}

module.exports = {
  config: {
    name: "c",
    aliases: ["cardinal"],
    cooldown: 3,
    description: "Cardinal: registrasi grup, moderasi user/grup, dan pemuatan command",
    usage: "c gr/ugr [GID] | ban/unban <ID user> | gban/ungban | cmdload [config.name]",
    category: "Admin",
    price: 0,
    role: 2,
  },
  onStart: async function (context) {
    const { api, event, args, groupsData, usersData, config, utils, prefix, role } = context;
    if (!(role >= 2)) return api.reply("Command Cardinal khusus Moderator Bot dan Admin Bot.");
    const [rawAction, target, ...rest] = args;
    const action = rawAction?.toLowerCase();

    if (action === "cmdload") {
      // Reload tetap khusus Admin Bot, sesuai izin command reload sebelumnya.
      if (!(role >= 3)) return api.reply("Pemuatan command khusus Admin Bot.");
      const { loadCommands, loadCommand } = await import("../core/commands.js");
      if (!target) return api.reply(`${loadCommands()} command berhasil dimuat ulang.`);
      try {
        const command = loadCommand(target);
        return api.reply(`Command ${command.config.name} berhasil dimuat ulang.`);
      } catch (error) {
        return api.reply(`Gagal memuat command: ${error.message}`);
      }
    }

    if (action === "gr" || action === "ugr") {
      const group = await findGroup(context, action, target);
      if (!group) return;
      const updated = await groupsData[action === "gr" ? "regist" : "unregist"](group.groupID);
      return api.reply(`Grup *${updated.groupName}* (GID ${updated.gid}) ${action === "gr" ? "berhasil diregistrasi. Bot aktif untuk semua anggota." : "dicabut registrasinya. Bot hanya merespon admin dan moderator bot."}`);
    }

    if (action === "ban" || action === "unban") {
      const id = botID(target);
      if (!id) return api.reply(`Gunakan: ${prefix}c ${action} <ID bot user>${action === "ban" ? " [alasan]" : ""}`);
      const user = await usersData.getByID(id);
      if (!user) return api.reply(`User dengan ID ${id} tidak ditemukan.`);
      const protectedUser = [...(config.admin || []), ...(config.moderator || [])]
        .some((number) => utils.normalizeNumber(number) === utils.normalizeNumber(user.nomor));
      if (action === "ban" && protectedUser) return api.reply("Admin dan moderator bot tidak bisa dibanned.");
      const reason = rest.join(" ").trim() || null;
      const updated = await usersData[action](user.nomor, reason);
      return api.reply(`User #${updated.userID} (${updated.nama}) ${action === "ban" ? "dibanned" : "sudah tidak dibanned"}.${action === "ban" && reason ? `\nAlasan: ${reason}` : ""}`);
    }

    if (action === "gban" || action === "ungban") {
      if (!event.isGroup) return api.reply("Command ini hanya untuk grup.");
      const reason = args.slice(1).join(" ").trim() || null;
      const group = await groupsData[action === "gban" ? "ban" : "unban"](event.chatJid, reason);
      return api.reply(`Grup *${group.groupName}* (GID ${group.gid}) ${action === "gban" ? "dibanned" : "sudah tidak dibanned"}.${action === "gban" && reason ? `\nAlasan: ${reason}` : ""}`);
    }

    return api.reply([
      "*Cardinal*",
      `${prefix}c gr [ID bot grup]`,
      `${prefix}c ugr [ID bot grup]`,
      `${prefix}c ban <ID bot user> [alasan]`,
      `${prefix}c unban <ID bot user>`,
      `${prefix}c gban [alasan]`,
      `${prefix}c ungban`,
      ...(role >= 3 ? [`${prefix}c cmdload [nama command di config]`] : []),
    ].join("\n"));
  },
};