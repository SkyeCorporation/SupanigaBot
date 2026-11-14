module.exports = {
  config: {
    name: "tagall",
    cooldown: 60,
    description: "Mention semua anggota grup",
    usage: "tagall [pesan]",
    price: 0,
    role: 1,
  },
  onStart: async function ({ api, args, event }) {
    if (!event.isGroup) return api.reply("Command ini hanya untuk grup.");
    const meta = await api.getGroupMeta();
    const ids = (meta?.participants || []).map((p) => p.id);
    const note = args.join(" ") || "Perhatian semua!";
    await api.sendMessage({ text: `📢 ${note}\n\n` + ids.map((id) => `@${id.split("@")[0]}`).join(" "), mentions: ids });
  },
};
