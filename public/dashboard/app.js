(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const state = { online: false, paused: false, filter: "all", logs: [], cpuHistory: [], es: null, overview: null };

  function ensureDashboardNotice() {
    let notice = $("#dashboardNotice");
    const app = $("#app");
    if (!notice && app) {
      notice = document.createElement("div");
      notice.id = "dashboardNotice";
      notice.className = "dashboard-notice";
      notice.setAttribute("role", "status");
      notice.hidden = true;
      app.prepend(notice);
    }
    return notice;
  }
  ensureDashboardNotice();

  function showDashboardError(message) {
    const notice = ensureDashboardNotice();
    if (!notice) return;
    notice.hidden = false;
    notice.textContent = message;
  }

  window.addEventListener("error", (event) => {
    if (!$("#app")?.hidden) showDashboardError(`Dashboard mengalami error: ${event.message || "JavaScript error"}. Coba refresh; jika tetap terjadi, kirim pesan ini ke admin.`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (!$("#app")?.hidden) showDashboardError(`Dashboard gagal memuat data: ${event.reason?.message || event.reason || "permintaan gagal"}. Periksa koneksi server lalu refresh.`);
  });

  (function particles() {
    const c = $("#particles");
    if (!c) return;
    const ctx = c.getContext("2d");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w, h, dpr, pts = [];
    const mouse = { x: -9999, y: -9999 };
    function resize() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = c.width = innerWidth * dpr;
      h = c.height = innerHeight * dpr;
      const n = Math.round(Math.min(90, (innerWidth * innerHeight) / 16000));
      pts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .35 * dpr, vy: (Math.random() - .5) * .35 * dpr, r: (Math.random() * 1.6 + .6) * dpr }));
    }
    addEventListener("resize", resize);
    addEventListener("pointermove", (e) => { mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr; });
    resize();
    function frame() {
      ctx.clearRect(0, 0, w, h);
      const max = 130 * dpr;
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        const dx = p.x - mouse.x, dy = p.y - mouse.y, dm = Math.hypot(dx, dy);
        if (dm > 0 && dm < 120 * dpr) { p.x += (dx / dm) * .8; p.y += (dy / dm) * .8; }
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i], b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < max) {
            ctx.strokeStyle = `rgba(34,211,238,${.16 * (1 - d / max)})`;
            ctx.lineWidth = dpr * .8;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (const p of pts) {
        ctx.fillStyle = "rgba(163,230,53,.65)";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      if (!reduce) requestAnimationFrame(frame);
    }
    frame();
  })();

  const fmtBytes = (b) => {
    if (!b && b !== 0) return "—";
    const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return `${b.toFixed(b >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
  };
  const fmtDur = (sec) => {
    sec = Math.floor(sec || 0);
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (d ? `${d}d ` : "") + `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ROLE_NAMES = ["Semua User", "Admin Grup", "Moderator Bot", "Admin Bot"];

  function toast(msg) {
    const t = $("#toast"); if (!t) return;
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function animateNumber(el, to) {
    if (!el) return;
    const from = Number(el.dataset.v || 0); el.dataset.v = to;
    if (from === to) { el.textContent = to.toLocaleString("id-ID"); return; }
    const start = performance.now(), dur = 700;
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e).toLocaleString("id-ID");
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...opts });
    const type = res.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await res.json() : null;
    return { ok: res.ok, status: res.status, data };
  }

  const clock = $("#clock");
  if (clock) setInterval(() => { clock.textContent = new Date().toLocaleTimeString("id-ID", { hour12: false }); }, 1000);

  function renderStatus(s) {
    if (!s) return;
    const pill = $("#statusPill"), label = pill?.querySelector("span");
    const card = document.querySelector(".qr-card");
    const img = $("#qrImg"), ok = $("#qrConnected"), loading = $("#qrLoading");
    if (!pill || !card || !img || !ok || !loading) return;
    pill.className = "pill"; img.hidden = true; ok.hidden = true; loading.hidden = true; card.classList.remove("is-connected");
    if (s.status === "connected") {
      pill.classList.add("ok"); if (label) label.textContent = "online"; card.classList.add("is-connected"); ok.hidden = false;
      $("#qrConnectedNumber").textContent = s.botNumber ? `+${s.botNumber}` : "terhubung";
      $("#qrTag").textContent = "connected"; $("#qrHelp").textContent = "Bot sudah tertaut ke WhatsApp. Logout sesi untuk menautkan nomor lain.";
    } else if (s.status === "qr" && s.qr) {
      pill.classList.add("wait"); if (label) label.textContent = "menunggu scan"; img.src = s.qr; img.hidden = false;
      $("#qrTag").textContent = "scan me"; $("#qrHelp").textContent = "Buka WhatsApp → Perangkat tertaut → Tautkan perangkat, lalu scan QR ini.";
    } else {
      pill.classList.add(s.status === "disconnected" ? "bad" : "wait"); if (label) label.textContent = s.status === "disconnected" ? "terputus" : "menghubungkan"; loading.hidden = false;
      $("#qrTag").textContent = s.status || "connecting"; $("#qrHelp").textContent = "Menyiapkan koneksi WhatsApp…";
    }
    $("#botNumber").textContent = s.status === "connected" && s.botNumber ? `+${s.botNumber}` : "belum terhubung";
    if (s.stats) { animateNumber($("#sMessages"), s.stats.messages || 0); animateNumber($("#sCommands"), s.stats.commands || 0); }
  }

  function setGauge(key, pct) {
    const g = document.querySelector(`.gauge[data-key="${key}"]`); if (!g) return;
    const v = Math.max(0, Math.min(100, pct || 0));
    const bar = g.querySelector(".g-bar"), label = g.querySelector("b");
    if (bar) bar.style.strokeDashoffset = String(314.16 * (1 - v / 100));
    if (label) label.textContent = `${v.toFixed(0)}%`;
    g.classList.toggle("hot", v >= 85);
  }

  function renderSystem(sys) {
    if (!sys) return;
    setGauge("cpu", sys.cpuUsage); setGauge("ram", (sys.memory.used / sys.memory.total) * 100); setGauge("disk", sys.disk ? sys.disk.used / sys.disk.total * 100 : 0);
    $("#hostName").textContent = sys.hostname || "—"; $("#procUptime").textContent = fmtDur(sys.uptime.process);
    const rows = [["OS", sys.os], ["Platform", `${sys.platform} / ${sys.arch}`], ["CPU", sys.cpuModel], ["Core", `${sys.cpuCores} core${sys.cpuSpeed ? ` @ ${(sys.cpuSpeed / 1000).toFixed(2)} GHz` : ""}`], ["RAM", `${fmtBytes(sys.memory.used)} / ${fmtBytes(sys.memory.total)}`], ["Disk", sys.disk ? `${fmtBytes(sys.disk.used)} / ${fmtBytes(sys.disk.total)}` : "—"], ["Proses (RSS)", fmtBytes(sys.process.rss)], ["Heap", `${fmtBytes(sys.process.heapUsed)} / ${fmtBytes(sys.process.heapTotal)}`], ["Load avg", (sys.loadavg || []).join("  ")], ["PID", sys.process.pid], ["Node.js", sys.node], ["Baileys", `v${sys.baileys}`], ["Uptime server", fmtDur(sys.uptime.system)], ["Uptime bot", fmtDur(sys.uptime.process)]];
    $("#specs").innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd title="${esc(v)}">${esc(v)}</dd></div>`).join("");
    state.cpuHistory.push(sys.cpuUsage); if (state.cpuHistory.length > 60) state.cpuHistory.shift(); drawSpark(); renderTicker(sys);
  }

  function drawSpark() {
    const c = $("#spark"); if (!c) return;
    const ctx = c.getContext("2d"), dpr = Math.min(devicePixelRatio || 1, 2), w = c.width = c.clientWidth * dpr, h = c.height = 60 * dpr, data = state.cpuHistory;
    if (data.length < 2) return;
    ctx.clearRect(0, 0, w, h); const step = w / 59;
    const pts = data.map((v, i) => [w - (data.length - 1 - i) * step, h - v / 100 * (h - 6 * dpr) - 3 * dpr]);
    const grad = ctx.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, "rgba(34,211,238,.35)"); grad.addColorStop(1, "rgba(34,211,238,0)");
    ctx.beginPath(); ctx.moveTo(pts[0][0], h); pts.forEach(([x,y]) => ctx.lineTo(x,y)); ctx.lineTo(pts.at(-1)[0],h); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); pts.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 2*dpr; ctx.stroke();
    ctx.fillStyle = "rgba(125,138,163,.8)"; ctx.font = `${10*dpr}px JetBrains Mono, monospace`; ctx.fillText("CPU · 2 menit terakhir",4*dpr,12*dpr);
  }

  function renderTicker(sys) {
    const s = state.overview?.status, items = [["SYSTEM", s?.status === "connected" ? "ONLINE" : "STANDBY"], ["NODE", sys.node], ["BAILEYS", `v${sys.baileys}`], ["CPU", `${sys.cpuUsage}%`], ["RAM", fmtBytes(sys.memory.used)], ["CORES", sys.cpuCores], ["ARCH", sys.arch], ["DB", "SQLITE"], ["EDITION", "PENGUIN 1.0.0 PRO"], ["DEV", "DEMIAN (LUXION)"]];
    const html = items.map(([k,v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join(""); $("#ticker").innerHTML = html + html;
  }

  function renderDatabase(db) {
    if (!db) return;
    animateNumber($("#sUsers"), db.users.total); animateNumber($("#sGroups"), db.groups.total);
    $("#dbUsers").textContent = db.users.total; $("#dbBanned").textContent = db.users.banned; $("#dbRegist").textContent = db.groups.regist; $("#dbGBanned").textContent = db.groups.banned;
    const rows = db.groupList || [];
    $("#groupRows").innerHTML = rows.length ? rows.map((g) => {
      const st = g.status.banned ? '<span class="st ban">banned</span>' : g.status.regist ? '<span class="st on">aktif</span>' : '<span class="st off">belum regist</span>';
      return `<tr><td>#${g.gid}</td><td title="${esc(g.groupName)}">${esc(g.groupName)}</td><td>${st}</td></tr>`;
    }).join("") : '<tr><td colspan="3" class="muted">Belum ada grup</td></tr>';
  }

  function renderCommands(list, prefix) {
    $("#cmdCount").textContent = `(${list.length})`;
    $("#cmdGrid").innerHTML = list.map((c) => `<div class="cmd"><div class="cmd-top"><span class="cmd-name">${esc(prefix)}${esc(c.name)}</span><span class="role role-${c.role}">R${c.role} · ${ROLE_NAMES[c.role] || "User"}</span></div><div class="cmd-desc">${esc(c.description || "—")}</div><div class="cmd-meta"><span>⏱ ${c.cooldown}s</span><span>💰 ${c.price ? Number(c.price).toLocaleString("id-ID") : "gratis"}</span>${c.aliases?.length ? `<span>↪ ${esc(c.aliases.join(", "))}</span>` : ""}</div></div>`).join("");
  }

  function lineHtml(e) {
    const t = new Date(e.time).toLocaleTimeString("id-ID", { hour12: false });
    return `<div class="line" data-lv="${esc(e.level)}"><span class="t">${t}</span><span class="lv lv-${esc(e.level)}">${esc(e.level).toUpperCase()}</span><span>${esc(e.text)}</span></div>`;
  }

  function renderConsole() {
    const list = state.filter === "all" ? state.logs : state.logs.filter((l) => l.level === state.filter);
    $("#console").innerHTML = list.slice(-300).map(lineHtml).join("") + '<div class="line"><span class="caret"></span></div>';
    scrollConsole();
  }

  function pushLog(e) {
    state.logs.push(e); if (state.logs.length > 600) state.logs.shift(); if (state.paused || (state.filter !== "all" && state.filter !== e.level)) return;
    const box = $("#console"), caret = box.lastElementChild; if (caret) caret.insertAdjacentHTML("beforebegin", lineHtml(e)); while (box.children.length > 301) box.firstElementChild.remove(); scrollConsole();
  }

  function scrollConsole() { const b = $("#console"); if (b) b.scrollTop = b.scrollHeight; }
  $("#logFilter")?.addEventListener("change", (e) => { state.filter = e.target.value; renderConsole(); });
  $("#pauseBtn")?.addEventListener("click", (e) => { state.paused = !state.paused; e.target.textContent = state.paused ? "Lanjut" : "Jeda"; if (!state.paused) renderConsole(); });
  $("#clearBtn")?.addEventListener("click", () => { state.logs = []; renderConsole(); });

  async function loadOverview() {
    const r = await api("/api/overview");
    if (r.status === 401) { showLogin(); return false; }
    if (!r.ok || !r.data) throw new Error(`API /api/overview gagal (HTTP ${r.status || "tidak diketahui"})`);
    const o = state.overview = r.data; ensureDashboardNotice().hidden = true;
    $("#prefix").textContent = o.prefix; renderStatus(o.status); renderSystem(o.system); renderDatabase(o.database); renderCommands(o.commands, o.prefix); state.logs = o.logs || []; renderConsole();
    return true;
  }

  function connectStream() {
    state.es?.close(); const es = state.es = new EventSource("/api/stream");
    es.addEventListener("log", (ev) => pushLog(JSON.parse(ev.data)));
    es.addEventListener("status", (ev) => { const s = JSON.parse(ev.data); if (state.overview) state.overview.status = s; renderStatus(s); });
    es.addEventListener("system", (ev) => renderSystem(JSON.parse(ev.data)));
  }

  setInterval(async () => { if (!state.online || $("#app").hidden) return; try { const r = await api("/api/overview"); if (r.ok && r.data) { state.overview = r.data; renderDatabase(r.data.database); } } catch (error) { showDashboardError(`Gagal memperbarui dashboard: ${error.message}`); } }, 15000);

  function showLogin() { state.es?.close(); $("#app").hidden = true; $("#login").hidden = false; setTimeout(() => $("#password")?.focus(), 50); }
  function showApp() { $("#login").hidden = true; $("#app").hidden = false; const notice = ensureDashboardNotice(); notice.hidden = true; notice.textContent = "Memuat dashboard…"; loadOverview().then((loaded) => { if (loaded) { connectStream(); loadShellInfo(); } }).catch((error) => showDashboardError(`${error.message}. Dashboard tetap terbuka; periksa log server dan endpoint /api/overview.`)); }

  $("#loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault(); const btn = $("#loginBtn"), err = $("#loginError"); err.textContent = ""; btn.disabled = true;
    try {
      const r = await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("#password").value }) });
      if (!r.data) { setOffline(true); err.textContent = "Server bot tidak terhubung. Pastikan bot berjalan (npm start)."; return; }
      setOffline(false);
      if (r.ok && r.data.ok) { $("#password").value = ""; showApp(); }
      else { err.textContent = r.data?.error || "Sandi salah."; const card = document.querySelector(".login-card"); card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake"); }
    } catch { err.textContent = "Tidak bisa menghubungi server."; } finally { btn.disabled = false; }
  });

  $("#logoutBtn")?.addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); showLogin(); });
  $("#waLogoutBtn")?.addEventListener("click", async () => { if (!confirm("Logout sesi WhatsApp? Bot akan membuat QR Code baru.")) return; const r = await api("/api/wa/logout", { method: "POST" }); toast(r.ok ? "Sesi dihapus, menunggu QR baru…" : "Gagal logout sesi"); });
  $("#reloadBtn")?.addEventListener("click", async () => { const r = await api("/api/cmds/reload", { method: "POST" }); if (r.ok) { renderCommands(r.data.commands, state.overview?.prefix || "."); toast(`${r.data.total} command dimuat ulang`); } else toast("Gagal reload command"); });

  // ---------- Shell ----------
  const shellState = { history: [], index: -1, busy: false };
  function shellLine(html, cls = "") { const box = $("#shellOutput"); if (!box) return; box.insertAdjacentHTML("beforeend", `<div class="line ${cls}">${html}</div>`); while (box.children.length > 400) box.firstElementChild.remove(); box.scrollTop = box.scrollHeight; }
  async function loadShellInfo() { try { const r = await api("/api/shell"); if (r.ok && r.data) { $("#shellCwd").textContent = r.data.enabled ? r.data.cwd : "nonaktif"; $("#shellInput").disabled = !r.data.enabled; $("#shellRun").disabled = !r.data.enabled; } } catch { /* opsional */ } }
  $("#shellForm")?.addEventListener("submit", async (e) => {
    e.preventDefault(); if (shellState.busy) return;
    const input = $("#shellInput"), command = input.value.trim(); if (!command) return;
    shellState.history.push(command); if (shellState.history.length > 50) shellState.history.shift(); shellState.index = shellState.history.length; input.value = "";
    shellLine(`<span class="lv lv-cmd">$</span><span>${esc(command)}</span>`);
    shellState.busy = true; $("#shellRun").disabled = true;
    try {
      const r = await api("/api/shell", { method: "POST", body: JSON.stringify({ command }) });
      if (r.status === 401) { showLogin(); return; }
      if (!r.ok || !r.data) { shellLine(esc(r.data?.error || `Gagal (HTTP ${r.status})`), "shell-err"); return; }
      const d = r.data;
      if (d.stdout) shellLine(`<pre>${esc(d.stdout)}</pre>`);
      if (d.stderr) shellLine(`<pre>${esc(d.stderr)}</pre>`, "shell-err");
      shellLine(`${d.timedOut ? "dihentikan: melewati batas waktu" : `kode keluar ${d.code ?? d.signal ?? "-"}`} · ${d.durationMs} ms${d.truncated ? " · output dipotong" : ""}`, "muted");
    } catch (error) { shellLine(esc(`Tidak bisa menghubungi server: ${error.message}`), "shell-err"); }
    finally { shellState.busy = false; $("#shellRun").disabled = false; input.focus(); }
  });
  $("#shellInput")?.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return; e.preventDefault();
    const h = shellState.history; if (!h.length) return;
    shellState.index = Math.max(0, Math.min(h.length, shellState.index + (e.key === "ArrowUp" ? -1 : 1)));
    e.target.value = h[shellState.index] || "";
  });
  $("#shellClear")?.addEventListener("click", () => { $("#shellOutput").innerHTML = ""; });

  function setOffline(off) { state.online = !off; $("#offlineNote").hidden = !off; }

  async function checkServer() {
    try { const h = await api("/api/health"); const ok = h.ok && h.data?.app === "supaniga-penguin"; setOffline(!ok); return ok; } catch { setOffline(true); return false; }
  }
  $("#retryBtn")?.addEventListener("click", async () => { const btn = $("#retryBtn"); btn.disabled = true; const ok = await checkServer(); btn.disabled = false; toast(ok ? "Server bot terhubung" : "Server bot masih belum terhubung"); if (ok) $("#password").focus(); });

  (async function boot() {
    const ok = await checkServer();
    if (!ok) { showLogin(); const t = setInterval(async () => { if (await checkServer()) clearInterval(t); }, 5000); return; }
    try { const s = await api("/api/session"); if (s.data?.authenticated) showApp(); else showLogin(); } catch { showLogin(); }
  })();
})();
