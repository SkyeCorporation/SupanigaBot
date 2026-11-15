# Setup Esdeath AI

Tambahkan environment variable `GEMINI_API_KEY` pada menu Variables/Environment di panel hosting (ambil API key dari Google AI Studio). Opsional: atur `GEMINI_MODEL`; default-nya `gemini-2.5-flash`.

Simpan API key sebagai secret pada hosting dan jangan commit key ke GitHub atau kirimkan ke chat. Jika memakai file `.env` secara lokal, pastikan proses Node/hosting benar-benar memuat file itu; `.env.example` hanya template.

Admin bot yang ditetapkan pada `config.json` adalah nomor WhatsApp dengan format internasional tanpa tanda `+`.
