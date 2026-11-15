# Setup Esdeath AI

Tambahkan environment variable `GEMINI_API_KEY` pada menu Variables/Environment di panel hosting (ambil API key dari Google AI Studio). Model default adalah `gemini-3.5-flash`; pastikan model ini tersedia untuk API key dan region akun Anda, atau set `GEMINI_MODEL` ke model Flash yang tersedia.

Esdeath menyimpan konteks percakapan per chat dan user pada `historyAI.json` di root project (maksimum 20 pesan terakhir per percakapan). File dibuat otomatis dan dikecualikan dari Git agar riwayat tetap lokal di host dan tidak ikut ter-push.

Command `.sticker` mengubah foto yang dikirim atau dibalas menjadi sticker WebP. Install dependency setelah update dengan `npm install`.

Simpan API key sebagai secret pada hosting dan jangan commit key ke GitHub atau kirimkan ke chat. Jika memakai file `.env` secara lokal, pastikan proses Node/hosting benar-benar memuat file itu; `.env.example` hanya template.

Admin bot yang ditetapkan pada `config.json` adalah nomor WhatsApp dengan format internasional tanpa tanda `+`.
