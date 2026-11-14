// PM2: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "supaniga-penguin",
      script: "index.js",
      max_memory_restart: "700M",
      autorestart: true,
      env: { NODE_ENV: "production", PORT: 3000 },
    },
  ],
};
