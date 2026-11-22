module.exports = {
  config: {
    name: "nya",
    cooldown: 10,
    description: "Memeriksa kecepatan respons bot",
    category: "Umum",
    price: 0,
    role: 0,
  },
  onStart: async function ({ api, event }) {
    await api.sendMessage(`Nyaaw..`);
  },
};
