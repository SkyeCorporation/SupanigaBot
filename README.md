# 🐧 Supaniga MX's — Penguin 1.0.0 Pro

Bot WhatsApp **NodeJS + Baileys** dengan **Database SQL (SQLite)** dan **Web Dashboard** (QR Code, spesifikasi hosting, console live).

> **Fullstack Developer: Demian (Luxion)**

---

## ⚡ Jalankan (di hosting / VPS / laptop)

Butuh **Node.js 20 atau lebih baru**.

```bash
git clone https://github.com/SkyeCorporation/SupanigaBot.git
cd SupanigaBot
npm install
npm start
```

Buka `http://IP-HOSTING:3000/dashboard/` → masukkan sandi dashboard → scan QR Code dari WhatsApp
(**WhatsApp → Perangkat tertaut → Tautkan perangkat**).

Sandi dashboard default: `#Supaniga123` (ubah di `config.json` atau env `DASHBOARD_PASSWORD`).

---

## ⚙️ config.json

```json
{
  "prefix": ".",
  "admin": ["6281234567890"],
  "moderator": ["6289876543210"],
  "botName": "Penguin",
  "dashboard": { "port": 3000, "password": "#Supaniga123" }
}
```

- Isi **nomor WhatsApp** (bukan ID). Format `08xx` otomatis jadi `628xx`.
- `admin` = role 3, `moderator` = role 2.

## 👥 Role command

| Role | Siapa |
|------|-------|
| 0 | Semua user |
| 1 | Admin grup |
| 2 | Moderator bot |
| 3 | Admin bot |

Aturan respon:
- User yang **dibanned** tidak direspon.
- Grup yang **dibanned / belum diregist** hanya merespon **admin & moderator bot**.
  Daftarkan grup dengan `.regist` (role 2).
- Admin & moderator bot tidak dikenai harga command.

## 🧩 Membuat command baru

Buat file di `./cmds`, contoh `cmds/halo.js`:

```js
module.exports = {
  config: {
    name: "halo",
    aliases: ["hai"],     // opsional
    cooldown: 10,         // detik
    description: "Menyapa user",
    price: 0,             // harga (dipotong dari money user)
    role: 0,              // 0 user, 1 admin grup, 2 moderator bot, 3 admin bot
  },
  onStart: async function ({ api, usersData, groupsData, event, args, user, group, role, prefix }) {
    await api.sendMessage(`Halo ${user.nama}! 👋`);
  },
};
```

Lalu ketik `.reload` (admin bot) atau klik **Reload** di dashboard — tanpa restart.

Isi parameter `onStart`:

| Nama | Isi |
|------|-----|
| `api` | `sendMessage(teks/konten, [nomor/jid])`, `reply()`, `react(emoji)`, `getGroupMeta()`, `sock` |
| `usersData` | `get(nomor)`, `set(nomor, data)`, `addMoney`, `subtractMoney`, `ban`, `unban`, `getAll`, `getByID` |
| `groupsData` | `get(groupID)`, `set`, `regist`, `unregist`, `ban`, `unban`, `getAll`, `getByGid` |
| `event` | `senderNumber`, `isGroup`, `chatJid`, `targetNumber` (dari tag/reply), `mentionNumbers`, `quotedNumber` |
| `user` / `group` | data dari database (lihat bentuk di bawah) |
| `role`, `args`, `prefix`, `config`, `commands`, `utils` | info tambahan |

## 🗄️ Bentuk data

```js
// user
{ nomor: "6281234567890", nama: "Unknown", userID: 1, money: 0,
  status: { banned: false, bannedReason: null } }

// group
{ groupID: "1203630xxxx@g.us", groupName: "Nama group", gid: 1,
  status: { regist: false, banned: false, bannedReason: null } }
```

Database: `database/supaniga.db` (SQLite, dibuat otomatis).

## 🔒 Privasi console

Console (terminal & dashboard) **tidak pernah menampilkan nomor orang lain** — user ditampilkan sebagai `User #ID (nama)`.
Hanya nomor bot yang terhubung yang tampil.

---

## 🚀 Panduan hosting

### Panel Pterodactyl (hosting bot WA)
1. Upload / pull repo ini, pilih egg **Node.js 20+**.
2. Startup: `npm install && npm start` (atau main file `index.js`).
3. Port otomatis dari `SERVER_PORT`. Buka `http://IP:PORT/dashboard/`.

### VPS (Ubuntu) + PM2
```bash
git clone <repo-kamu> && cd <repo-kamu>
npm install
npm install -g pm2
pm2 start ecosystem.config.cjs && pm2 save
```

### Docker
```bash
docker build -t supaniga-penguin .
docker run -d -p 3000:3000 -v $(pwd)/session:/app/session -v $(pwd)/database:/app/database supaniga-penguin
```

### Railway / Render / Koyeb
- Start command: `npm start` • Build command: `npm install`
- Pasang **volume/disk** di `session/` dan `database/` agar login WA & data tidak hilang saat redeploy.

> ❗ Bot WhatsApp butuh server yang **selalu menyala** (VPS, panel, Docker). Hosting statis / serverless (Vercel, Netlify, Cloudflare) **tidak bisa** menjalankan bot.

---

## 📁 Struktur

```
index.js          ← file utama (npm start)
config.json       ← prefix, admin, moderator, sandi dashboard
cmds/             ← semua command
core/             ← mesin bot: koneksi WA, handler, database, dashboard server
public/dashboard/ ← tampilan web dashboard
database/         ← file database SQL (otomatis, tidak di-push)
session/          ← sesi login WhatsApp (otomatis, tidak di-push)
```

## 🔐 Catatan GitHub

- `session/`, `database/*.db`, `.env` sudah ada di `.gitignore` — jangan pernah di-push.
- Jika repo **publik**, ganti sandi lewat env `DASHBOARD_PASSWORD` di hosting, jangan simpan sandi asli di `config.json`.

---

**Supaniga MX's — Penguin 1.0.0 Pro** · Fullstack Developer: **Demian (Luxion)**
