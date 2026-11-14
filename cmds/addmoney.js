module.exports = {
  config: {
    name: "addmoney",
    cooldown: 2,
    description: "Tambah saldo user",
    usage: "addmoney <@tag | reply | nomor> <jumlah>",
    price: 0,
    role: 3,
  },
  onStart: async function ({ api, args, event, usersData, utils, prefix }) {
    let target = event.targetNumber;
    let amount = Number(args.find((a) => /^-?\d+$/.test(a) && a.length < 10));
    if (!target && args.length >= 2) {
      target = utils.normalizeNumber(args[0]);
      amount = Number(args[1]);
    }
    if (!target || !Number.isFinite(amount)) return api.reply(`Contoh: *${prefix}addmoney @user 5000*`);
    const u = await usersData.addMoney(target, amount);
    await api.reply(`💰 Saldo User #${u.userID} (${u.nama}) sekarang ${u.money.toLocaleString("id-ID")}`);
  },
};
