/**
 * File Manager dashboard: menjelajah, mengedit (CodeMirror), membuat, mengganti
 * nama, menghapus, dan mengunggah file di folder bot lewat endpoint /api/fs/*.
 */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const card = $("#fmCard");
  if (!card) return;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmtBytes = (b) => {
    if (b == null) return "—";
    const u = ["B", "KB", "MB", "GB"]; let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return `${b.toFixed(b >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
  };
  const toast = (msg) => (window.PenguinToast ? window.PenguinToast(msg) : console.log(msg));
  const basename = (p) => p.split("/").pop();
  const dirname = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const join = (dir, name) => (dir ? `${dir}/${name}` : name);
  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico)$/i;
  const AUDIO_EXT = /\.(mp3|ogg|wav|m4a|opus)$/i;
  const VIDEO_EXT = /\.(mp4|webm)$/i;
  const MODES = {
    javascript: "javascript", json: { name: "javascript", json: true }, css: "css", html: "htmlmixed",
    markdown: "markdown", shell: "shell", yaml: "yaml", properties: "properties", text: "text/plain",
  };
  const LANG_LABEL = { javascript: "JavaScript", json: "JSON", css: "CSS", html: "HTML", markdown: "Markdown", shell: "Shell", yaml: "YAML", properties: "Properties", text: "Teks" };

  const state = {
    entries: [], expanded: new Set(JSON.parse(localStorage.getItem("fm.expanded") || '["cmds"]')),
    target: "", selected: null, tabs: [], active: null, editor: null, loaded: false, filter: "",
  };

  async function request(url, opts = {}) {
    const res = await fetch(url, { credentials: "same-origin", ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    if (res.status === 401) { window.dispatchEvent(new CustomEvent("penguin:unauthorized")); throw new Error("Sesi dashboard berakhir. Silakan masuk lagi."); }
    const type = res.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await res.json() : null;
    return { ok: res.ok, status: res.status, data };
  }
  const post = (url, body) => request(url, { method: "POST", body: JSON.stringify(body) });

  // ---------- Dialog ----------
  const dialog = $("#fmDialog");
  function ask({ title, text = "", input = null, buttons }) {
    return new Promise((resolve) => {
      $("#fmDialogTitle").textContent = title;
      $("#fmDialogText").textContent = text;
      $("#fmDialogText").hidden = !text;
      const field = $("#fmDialogInput");
      field.hidden = input === null;
      field.value = input ?? "";
      const box = $("#fmDialogBtns");
      box.innerHTML = buttons.map((b, i) => `<button class="btn sm ${b.kind === "primary" ? "btn-primary" : b.kind === "danger" ? "btn-ghost fm-danger" : "btn-ghost"}" value="${i}" type="submit">${esc(b.label)}</button>`).join("");
      const finish = () => {
        dialog.removeEventListener("close", finish);
        const index = Number(dialog.returnValue);
        const chosen = Number.isInteger(index) && dialog.returnValue !== "" ? buttons[index] : null;
        resolve(chosen ? { value: chosen.value, input: field.value.trim() } : { value: null, input: "" });
      };
      dialog.returnValue = "";
      dialog.addEventListener("close", finish);
      dialog.showModal();
      if (input !== null) { field.focus(); const dot = field.value.lastIndexOf("."); const slash = field.value.lastIndexOf("/"); field.setSelectionRange(slash + 1, dot > slash ? dot : field.value.length); }
      else box.querySelector(".btn-primary, .fm-danger")?.focus();
    });
  }
  $("#fmDialogInput").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const primary = $("#fmDialogBtns .btn-primary");
    if (primary) { dialog.returnValue = primary.value; dialog.close(primary.value); }
  });

  // ---------- Tree ----------
  function buildTree(entries) {
    const root = { path: "", type: "dir", children: [] };
    const dirs = new Map([["", root]]);
    for (const entry of entries) {
      const node = { ...entry, name: basename(entry.path), children: entry.type === "dir" ? [] : null };
      if (node.type === "dir") dirs.set(node.path, node);
      const parent = dirs.get(dirname(entry.path)) || root;
      parent.children.push(node);
    }
    const sort = (node) => {
      node.children?.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
      node.children?.forEach(sort);
    };
    sort(root);
    return root;
  }

  function iconFor(node) {
    if (node.type === "dir") return `<span class="fm-ico fm-ico-dir">${state.expanded.has(node.path) || state.filter ? "▾" : "▸"}</span>`;
    const ext = (node.name.includes(".") ? node.name.split(".").pop() : node.name).toLowerCase();
    const map = { js: ["JS", "js"], mjs: ["JS", "js"], cjs: ["JS", "js"], json: ["{}", "json"], md: ["MD", "md"], css: ["#", "css"], html: ["<>", "html"], png: ["IMG", "img"], jpg: ["IMG", "img"], jpeg: ["IMG", "img"], gif: ["GIF", "img"], webp: ["IMG", "img"], svg: ["SVG", "img"], ttf: ["Aa", "font"], txt: ["TXT", "txt"], sh: ["$", "sh"], dockerfile: ["DK", "sh"] };
    const [label, cls] = map[ext] || ["·", "txt"];
    return `<span class="fm-ico fm-ico-${cls}">${label}</span>`;
  }

  function matches(node, q) {
    if (node.type === "file") return node.path.toLowerCase().includes(q);
    return node.children.some((child) => matches(child, q));
  }

  function renderTree() {
    const tree = $("#fmTree");
    const q = state.filter.toLowerCase();
    const root = buildTree(state.entries);
    const dirty = new Set(state.tabs.filter(isDirty).map((t) => t.path));
    const rows = [];
    const walk = (node, depth) => {
      for (const child of node.children) {
        if (q && !matches(child, q)) continue;
        const open = child.type === "dir" && (q || state.expanded.has(child.path));
        const selected = state.selected === child.path ? " is-selected" : "";
        const active = state.active?.path === child.path ? " is-active" : "";
        rows.push(`<div class="fm-row${selected}${active}" role="treeitem" tabindex="-1" data-path="${esc(child.path)}" data-type="${child.type}" style="--depth:${depth}"${child.type === "dir" ? ` aria-expanded="${open}"` : ""}>
          ${iconFor(child)}<span class="fm-name" title="${esc(child.path)}">${esc(child.name)}${dirty.has(child.path) ? ' <i class="fm-dot" title="Belum disimpan"></i>' : ""}</span>
          <span class="fm-meta">${child.type === "file" ? fmtBytes(child.size) : ""}</span>
          <span class="fm-row-actions"><button type="button" data-act="rename" title="Ganti nama" aria-label="Ganti nama ${esc(child.name)}">✎</button><button type="button" data-act="delete" title="Hapus" aria-label="Hapus ${esc(child.name)}">✕</button></span>
        </div>`);
        if (open) walk(child, depth + 1);
      }
    };
    walk(root, 0);
    tree.innerHTML = rows.join("") || `<div class="fm-tree-empty muted">${q ? "Tidak ada file yang cocok." : "Folder kosong."}</div>`;
    const files = state.entries.filter((e) => e.type === "file");
    $("#fmSummary").textContent = `${files.length} file · ${fmtBytes(files.reduce((n, f) => n + (f.size || 0), 0))}`;
    $("#fmTarget").textContent = `/${state.target}`;
  }

  async function loadTree() {
    try {
      const r = await request("/api/fs/tree");
      if (!r.ok) throw new Error(r.data?.error || `HTTP ${r.status}`);
      state.entries = r.data.entries;
      state.loaded = true;
      renderTree();
      if (r.data.truncated) toast("Daftar file dipotong karena terlalu banyak.");
    } catch (error) {
      $("#fmTree").innerHTML = `<div class="fm-tree-empty fm-err">${esc(error.message)}</div>`;
    }
  }

  function setTarget(dir) { state.target = dir; $("#fmTarget").textContent = `/${dir}`; }

  $("#fmTree").addEventListener("click", async (e) => {
    const row = e.target.closest(".fm-row"); if (!row) return;
    const { path, type } = row.dataset;
    const act = e.target.closest("button")?.dataset.act;
    if (act === "rename") return renameEntry(path);
    if (act === "delete") return deleteEntry(path, type);
    state.selected = path;
    if (type === "dir") {
      if (state.expanded.has(path)) state.expanded.delete(path); else state.expanded.add(path);
      localStorage.setItem("fm.expanded", JSON.stringify([...state.expanded]));
      setTarget(path);
      renderTree();
    } else {
      setTarget(dirname(path));
      openFile(path);
    }
  });
  $("#fmFilter").addEventListener("input", (e) => { state.filter = e.target.value.trim(); renderTree(); });
  $("#fmRefresh").addEventListener("click", () => loadTree().then(() => toast("Daftar file diperbarui")));

  // ---------- Editor & tabs ----------
  function ensureEditor() {
    if (state.editor || !window.CodeMirror) return state.editor;
    const save = () => saveActive();
    state.editor = window.CodeMirror($("#fmEditor"), {
      theme: "penguin", lineNumbers: true, matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true,
      indentUnit: 2, tabSize: 2, indentWithTabs: false, lineWrapping: false, viewportMargin: 30,
      extraKeys: {
        "Ctrl-S": save, "Cmd-S": save, "Ctrl-/": "toggleComment", "Cmd-/": "toggleComment", "Alt-G": "jumpToLine",
        Tab: (cm) => (cm.somethingSelected() ? cm.indentSelection("add") : cm.replaceSelection("  ", "end")),
        Esc: () => { if (card.classList.contains("fm-full")) toggleFullscreen(false); },
      },
    });
    state.editor.on("changes", () => { clearProblem(); updateChrome(); });
    state.editor.on("cursorActivity", updateCursor);
    return state.editor;
  }

  const isDirty = (tab) => Boolean(tab.doc && !tab.doc.isClean(tab.cleanGen));
  const isCommandFile = (p) => /^cmds\/.+\.js$/.test(p);

  async function openFile(path, { reload = false } = {}) {
    let tab = state.tabs.find((t) => t.path === path);
    if (tab && !reload) return activate(tab);
    const r = await request(`/api/fs/file?path=${encodeURIComponent(path)}`);
    if (!r.ok) { toast(r.data?.error || "Gagal membuka file"); return; }
    const info = r.data;
    const data = { path, size: info.size, mtime: info.mtime, language: info.language, binary: info.binary, tooLarge: info.tooLarge, mime: info.mime, sha256: info.sha256 || null };
    if (!info.binary && !info.tooLarge) {
      ensureEditor();
      if (tab?.doc) { tab.doc.setValue(info.content); tab.doc.clearHistory(); }
      data.doc = tab?.doc || new window.CodeMirror.Doc(info.content, MODES[info.language] || "text/plain");
      data.cleanGen = data.doc.changeGeneration(true);
    }
    if (tab) Object.assign(tab, data); else { tab = data; state.tabs.push(tab); }
    activate(tab);
  }

  function activate(tab) {
    state.active = tab;
    state.selected = tab.path;
    const editorEl = $("#fmEditor"), preview = $("#fmPreview");
    $("#fmEmpty").hidden = true;
    clearProblem();
    if (tab.doc) {
      editorEl.hidden = false; preview.hidden = true;
      const editor = ensureEditor();
      if (editor.getDoc() !== tab.doc) editor.swapDoc(tab.doc);
      editor.refresh(); editor.focus();
    } else {
      editorEl.hidden = true; preview.hidden = false;
      const src = `/api/fs/raw?path=${encodeURIComponent(tab.path)}&t=${Math.round(tab.mtime || 0)}`;
      let body;
      if (IMAGE_EXT.test(tab.path)) body = `<div class="fm-img-wrap"><img src="${src}" alt="${esc(basename(tab.path))}" /></div><p class="mono muted" id="fmImgInfo">${fmtBytes(tab.size)}</p>`;
      else if (AUDIO_EXT.test(tab.path)) body = `<audio controls src="${src}"></audio><p class="mono muted">${fmtBytes(tab.size)}</p>`;
      else if (VIDEO_EXT.test(tab.path)) body = `<video controls src="${src}"></video><p class="mono muted">${fmtBytes(tab.size)}</p>`;
      else body = `<p class="eyebrow mono">// ${tab.tooLarge ? "file terlalu besar" : "file biner"}</p><h4>${tab.tooLarge ? "File ini melebihi batas 1 MB untuk editor." : "File ini bukan teks sehingga tidak dapat diedit di sini."}</h4><p class="mono muted">${fmtBytes(tab.size)} · ${esc(tab.mime)}</p><a class="btn btn-ghost sm" href="${src}&download=1">Unduh file</a>`;
      preview.innerHTML = body;
      const img = preview.querySelector("img");
      if (img) img.addEventListener("load", () => { const info = $("#fmImgInfo"); if (info) info.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${fmtBytes(tab.size)}`; }, { once: true });
    }
    renderTabs(); renderTree(); updateChrome(); updateCursor();
  }

  function renderTabs() {
    $("#fmTabs").innerHTML = state.tabs.map((t, i) => `<div class="fm-tab${t === state.active ? " is-active" : ""}" role="tab" aria-selected="${t === state.active}" data-i="${i}" title="${esc(t.path)}">
      <span>${esc(basename(t.path))}</span>${isDirty(t) ? '<i class="fm-dot" title="Belum disimpan"></i>' : ""}<button type="button" data-close="${i}" aria-label="Tutup ${esc(basename(t.path))}">×</button></div>`).join("");
  }
  $("#fmTabs").addEventListener("click", (e) => {
    const close = e.target.closest("[data-close]");
    if (close) return closeTab(state.tabs[Number(close.dataset.close)]);
    const tab = e.target.closest(".fm-tab"); if (tab) activate(state.tabs[Number(tab.dataset.i)]);
  });
  $("#fmTabs").addEventListener("auxclick", (e) => { const tab = e.target.closest(".fm-tab"); if (tab && e.button === 1) closeTab(state.tabs[Number(tab.dataset.i)]); });

  async function closeTab(tab, { skipConfirm = false } = {}) {
    if (!tab) return;
    if (!skipConfirm && isDirty(tab)) {
      const { value } = await ask({ title: "Tutup tanpa menyimpan?", text: `Perubahan pada ${tab.path} belum disimpan.`, buttons: [{ label: "Batal", value: null }, { label: "Simpan", value: "save", kind: "primary" }, { label: "Buang perubahan", value: "discard", kind: "danger" }] });
      if (!value) return;
      if (value === "save" && !(await saveTab(tab))) return;
    }
    const index = state.tabs.indexOf(tab);
    state.tabs.splice(index, 1);
    if (state.active === tab) {
      const next = state.tabs[index] || state.tabs[index - 1];
      if (next) return activate(next);
      state.active = null;
      $("#fmEditor").hidden = true; $("#fmPreview").hidden = true; $("#fmEmpty").hidden = false;
      clearProblem();
    }
    renderTabs(); renderTree(); updateChrome();
  }

  function updateChrome() {
    const tab = state.active;
    const dirty = tab ? isDirty(tab) : false;
    $("#fmCrumb").innerHTML = tab ? tab.path.split("/").map((part, i, all) => `<span${i === all.length - 1 ? ' class="fm-crumb-last"' : ""}>${esc(part)}</span>`).join('<i>/</i>') : "Belum ada file yang dibuka";
    $("#fmSave").disabled = !tab?.doc || !dirty;
    $("#fmSaveReload").hidden = !(tab?.doc && isCommandFile(tab.path));
    $("#fmSaveReload").disabled = !tab?.doc;
    $("#fmRevert").disabled = !tab;
    $("#fmRename").disabled = !tab;
    $("#fmDelete").disabled = !tab;
    const dl = $("#fmDownload");
    if (tab) { dl.href = `/api/fs/raw?path=${encodeURIComponent(tab.path)}&download=1`; dl.removeAttribute("aria-disabled"); }
    else { dl.removeAttribute("href"); dl.setAttribute("aria-disabled", "true"); }
    $("#fmLang").textContent = tab ? (tab.doc ? LANG_LABEL[tab.language] || "Teks" : tab.mime) : "—";
    $("#fmSize").textContent = tab ? fmtBytes(tab.doc ? new Blob([tab.doc.getValue()]).size : tab.size) : "";
    const st = $("#fmState");
    st.textContent = tab?.doc ? (dirty ? "Belum disimpan" : "Tersimpan") : "";
    st.className = dirty ? "fm-state-dirty" : "";
    renderTabs();
    const dirtyNames = new Set(state.tabs.filter(isDirty).map((t) => t.path));
    document.querySelectorAll("#fmTree .fm-row").forEach((row) => {
      const has = row.querySelector(".fm-dot");
      if (dirtyNames.has(row.dataset.path) && !has) row.querySelector(".fm-name").insertAdjacentHTML("beforeend", ' <i class="fm-dot" title="Belum disimpan"></i>');
      else if (!dirtyNames.has(row.dataset.path) && has) has.remove();
    });
  }

  function updateCursor() {
    const tab = state.active;
    if (!tab?.doc || !state.editor) { $("#fmCursor").textContent = ""; return; }
    const c = state.editor.getCursor();
    const sel = state.editor.getSelection().length;
    $("#fmCursor").textContent = `Ln ${c.line + 1}, Col ${c.ch + 1}${sel ? ` (${sel} dipilih)` : ""} · ${tab.doc.lineCount()} baris`;
  }

  let problemLine = null;
  function showProblem(check) {
    const box = $("#fmProblem");
    box.hidden = false;
    box.innerHTML = `<b>Sintaks tidak valid${check.line ? ` di baris ${check.line}` : ""}:</b> ${esc(check.message)}${check.line ? ' <button type="button" class="btn btn-ghost sm" id="fmGoLine">Lompat ke baris</button>' : ""}`;
    if (check.line && state.editor) {
      problemLine = state.editor.addLineClass(check.line - 1, "background", "fm-error-line");
      $("#fmGoLine")?.addEventListener("click", () => { state.editor.setCursor({ line: check.line - 1, ch: 0 }); state.editor.scrollIntoView(null, 120); state.editor.focus(); });
    }
  }
  function clearProblem() {
    $("#fmProblem").hidden = true;
    if (problemLine && state.editor) { state.editor.removeLineClass(problemLine, "background", "fm-error-line"); problemLine = null; }
  }

  async function saveTab(tab, options = {}) {
    if (!tab?.doc || tab.saving) return false;
    tab.saving = true;
    try { return await saveTabNow(tab, options); } finally { tab.saving = false; }
  }

  async function saveTabNow(tab, { reloadCommands = false } = {}) {
    let opts = { force: false, skipCheck: false };
    for (let attempt = 0; attempt < 3; attempt++) {
      const content = tab.doc.getValue();
      const r = await request("/api/fs/file", { method: "PUT", body: JSON.stringify({ path: tab.path, content, sha256: tab.sha256, ...opts }) });
      if (r.ok) {
        tab.sha256 = r.data.sha256; tab.size = r.data.size; tab.mtime = r.data.mtime;
        tab.cleanGen = tab.doc.changeGeneration(true);
        const entry = state.entries.find((e) => e.path === tab.path); if (entry) { entry.size = r.data.size; entry.mtime = r.data.mtime; }
        clearProblem(); updateChrome(); renderTree();
        toast(`Tersimpan: ${tab.path}`);
        if (reloadCommands) {
          const rr = await post("/api/cmds/reload", {});
          toast(rr.ok ? `Tersimpan, ${rr.data.total} command dimuat ulang` : "Tersimpan, tetapi reload command gagal");
        }
        return true;
      }
      if (r.status === 422 && r.data?.check) {
        if (tab === state.active) showProblem(r.data.check);
        const { value } = await ask({ title: "Sintaks tidak valid", text: `${r.data.check.line ? `Baris ${r.data.check.line}: ` : ""}${r.data.check.message}`, buttons: [{ label: "Perbaiki dulu", value: null, kind: "primary" }, { label: "Simpan tetap", value: "skip", kind: "danger" }] });
        if (value !== "skip") return false;
        opts = { ...opts, skipCheck: true };
        continue;
      }
      if (r.status === 409) {
        const { value } = await ask({ title: "File berubah di server", text: `${tab.path} sudah diubah dari tempat lain sejak dibuka. Pilih tindakan agar tidak ada perubahan yang hilang tanpa sengaja.`, buttons: [{ label: "Batal", value: null }, { label: "Muat versi server", value: "reload" }, { label: "Timpa dengan versi saya", value: "force", kind: "danger" }] });
        if (value === "reload") { await openFile(tab.path, { reload: true }); return false; }
        if (value !== "force") return false;
        opts = { ...opts, force: true };
        continue;
      }
      toast(r.data?.error || `Gagal menyimpan (HTTP ${r.status})`);
      return false;
    }
    return false;
  }
  const saveActive = (reloadCommands = false) => saveTab(state.active, { reloadCommands });
  $("#fmSave").addEventListener("click", () => saveActive());
  $("#fmSaveReload").addEventListener("click", () => saveActive(true));
  $("#fmRevert").addEventListener("click", async () => {
    const tab = state.active; if (!tab) return;
    if (isDirty(tab)) {
      const { value } = await ask({ title: "Muat ulang dari server?", text: "Perubahan yang belum disimpan akan dibuang.", buttons: [{ label: "Batal", value: null }, { label: "Muat ulang", value: "ok", kind: "danger" }] });
      if (!value) return;
    }
    await openFile(tab.path, { reload: true });
    toast("Isi file dimuat ulang dari server");
  });
  $("#fmRename").addEventListener("click", () => state.active && renameEntry(state.active.path));
  $("#fmDelete").addEventListener("click", () => state.active && deleteEntry(state.active.path, "file"));
  $("#fmDownload").addEventListener("click", (e) => { if (!state.active) e.preventDefault(); });

  // ---------- Create / rename / delete ----------
  async function createEntry(type) {
    const label = type === "dir" ? "folder" : "file";
    const { value, input } = await ask({ title: `Buat ${label} baru`, text: "Path relatif terhadap folder bot. Folder perantara dibuat otomatis.", input: join(state.target, type === "dir" ? "folder-baru" : "baru.js"), buttons: [{ label: "Batal", value: null }, { label: "Buat", value: "ok", kind: "primary" }] });
    if (!value || !input) return;
    const r = await post("/api/fs/create", { path: input, type });
    if (!r.ok) return toast(r.data?.error || `Gagal membuat ${label}`);
    toast(`${type === "dir" ? "Folder" : "File"} dibuat: ${r.data.path}`);
    let dir = type === "dir" ? r.data.path : dirname(r.data.path);
    while (dir) { state.expanded.add(dir); dir = dirname(dir); }
    await loadTree();
    if (type === "dir") setTarget(r.data.path); else openFile(r.data.path);
  }
  $("#fmNewFile").addEventListener("click", () => createEntry("file"));
  $("#fmNewDir").addEventListener("click", () => createEntry("dir"));

  async function renameEntry(from) {
    const { value, input } = await ask({ title: "Ganti nama atau pindahkan", text: from, input: from, buttons: [{ label: "Batal", value: null }, { label: "Simpan nama", value: "ok", kind: "primary" }] });
    if (!value || !input || input === from) return;
    const r = await post("/api/fs/rename", { from, to: input });
    if (!r.ok) return toast(r.data?.error || "Gagal mengganti nama");
    for (const tab of state.tabs) {
      if (tab.path === from) tab.path = r.data.to;
      else if (tab.path.startsWith(`${from}/`)) tab.path = r.data.to + tab.path.slice(from.length);
    }
    if (state.selected === from) state.selected = r.data.to;
    if (state.target === from || state.target.startsWith(`${from}/`)) setTarget(r.data.to + state.target.slice(from.length));
    toast(`Dipindahkan ke ${r.data.to}`);
    await loadTree(); updateChrome();
  }

  async function deleteEntry(target, type) {
    const { value } = await ask({ title: `Hapus ${type === "dir" ? "folder" : "file"}?`, text: `${target}${type === "dir" ? " beserta seluruh isinya" : ""} akan dihapus permanen dari server. Tindakan ini tidak dapat dibatalkan.`, buttons: [{ label: "Batal", value: null }, { label: "Hapus permanen", value: "ok", kind: "danger" }] });
    if (!value) return;
    const r = await post("/api/fs/delete", { path: target });
    if (!r.ok) return toast(r.data?.error || "Gagal menghapus");
    for (const tab of [...state.tabs]) if (tab.path === target || tab.path.startsWith(`${target}/`)) await closeTab(tab, { skipConfirm: true });
    if (state.target === target || state.target.startsWith(`${target}/`)) setTarget(dirname(target));
    toast(`Dihapus: ${target}`);
    await loadTree();
  }

  // ---------- Upload ----------
  async function uploadFiles(files, dir = state.target) {
    const list = [...files]; if (!list.length) return;
    let done = 0;
    for (const file of list) {
      const target = join(dir, file.name);
      const send = (overwrite) => fetch(`/api/fs/upload?path=${encodeURIComponent(target)}${overwrite ? "&overwrite=1" : ""}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/octet-stream" }, body: file });
      toast(`Mengunggah ${file.name}…`);
      let res = await send(false);
      if (res.status === 409) {
        const { value } = await ask({ title: "File sudah ada", text: `${target} sudah ada. Timpa dengan file yang diunggah?`, buttons: [{ label: "Lewati", value: null }, { label: "Timpa", value: "ok", kind: "danger" }] });
        if (!value) continue;
        res = await send(true);
      }
      if (res.status === 401) { window.dispatchEvent(new CustomEvent("penguin:unauthorized")); return; }
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast(data?.error || `Gagal mengunggah ${file.name}`); continue; }
      done++;
      const open = state.tabs.find((t) => t.path === data.path);
      if (open) await openFile(data.path, { reload: true });
    }
    if (dir) state.expanded.add(dir);
    await loadTree();
    if (done) toast(`${done} file diunggah ke /${dir}`);
  }
  $("#fmUpload").addEventListener("click", () => $("#fmUploadInput").click());
  $("#fmUploadInput").addEventListener("change", (e) => { uploadFiles(e.target.files); e.target.value = ""; });

  let dragDepth = 0;
  const fm = card.querySelector(".fm");
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  fm.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $("#fmDropTarget").textContent = `/${state.target}`; $("#fmDrop").hidden = false; });
  fm.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  fm.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("#fmDrop").hidden = true; });
  fm.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; $("#fmDrop").hidden = true;
    const row = e.target.closest?.(".fm-row");
    const dir = row ? (row.dataset.type === "dir" ? row.dataset.path : dirname(row.dataset.path)) : state.target;
    uploadFiles(e.dataTransfer.files, dir);
  });

  // ---------- Fullscreen & guards ----------
  function toggleFullscreen(force) {
    const on = typeof force === "boolean" ? force : !card.classList.contains("fm-full");
    card.classList.toggle("fm-full", on);
    document.body.classList.toggle("fm-locked", on);
    $("#fmFullscreen").textContent = on ? "Keluar layar penuh" : "Layar penuh";
    setTimeout(() => state.editor?.refresh(), 30);
  }
  $("#fmFullscreen").addEventListener("click", () => toggleFullscreen());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && card.classList.contains("fm-full") && !dialog.open) toggleFullscreen(false);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && card.contains(document.activeElement) && state.active?.doc) { e.preventDefault(); saveActive(); }
  });
  window.addEventListener("beforeunload", (e) => { if (state.tabs.some(isDirty)) { e.preventDefault(); e.returnValue = ""; } });

  window.addEventListener("penguin:ready", () => { if (!state.loaded) loadTree(); });
})();
