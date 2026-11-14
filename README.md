# SupanigaBot

WhatsApp bot built with Node.js, Baileys, SQLite, and a web dashboard.

## Esdeath AI

Set `GEMINI_API_KEY` in your hosting environment (or in a local `.env` file loaded by your host) to enable Esdeath. The default model is `gemini-2.5-flash`; override it with `GEMINI_MODEL` if needed. Gemini API quotas and free-tier availability depend on Google AI Studio eligibility, region, and current limits.

Call her by sending `Esdeath hai`, `Esdeath jelaskan hal ini`, or by replying to a message sent by the bot. You can also use `.esdeath <prompt>` or `.ai <prompt>`. Esdeath can analyze images, video, audio, and PDF attachments up to 15 MB.

Use `.help` or `.menu` to view command categories, and `.help <command>` / `.menu <command>` for command details.
