// Shared utilities
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024, sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
function getBaseUrlOrOrigin(inputEl) {
  const v = inputEl && inputEl.value.trim();
  if (v) return v.replace(/\/+$/, "");
  return window.location.origin;
}
window.ShareLiteUtils = { formatBytes, getBaseUrlOrOrigin };

// Init common UI
document.addEventListener("DOMContentLoaded", () => {
  const navToggle = document.getElementById("navToggle");
  const header = document.querySelector(".app-header");
  if (navToggle && header) {
    navToggle.addEventListener("click", () => {
      const open = header.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", (e) => {
      if (!header.contains(e.target) && header.classList.contains("open")) {
        header.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      }
    });

    // Close mobile nav when any nav link is clicked (fix)
    const navLinks = document.querySelectorAll(".nav a");
    navLinks.forEach(link => {
      link.addEventListener("click", () => {
        if (header.classList.contains("open")) {
          header.classList.remove("open");
          navToggle.setAttribute("aria-expanded", "false");
        }
      });
    });
  }

  const btn = document.getElementById("themeToggle");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const stored = localStorage.getItem("theme");
  const body = document.body;
  function applyTheme(mode) {
    const dark = mode === "dark";
    body.classList.toggle("theme-dark", dark);
    const icon = btn?.querySelector("i");
    if (icon) icon.className = dark ? "fa-solid fa-sun" : "fa-solid fa-moon";
  }
  applyTheme(stored || (prefersDark ? "dark" : "light"));
  btn && btn.addEventListener("click", () => {
    const next = body.classList.contains("theme-dark") ? "light" : "dark";
    localStorage.setItem("theme", next);
    applyTheme(next);
  });

  initSender();
  initReceiver();
});

// Sender page logic
function initSender() {
  const newSessionBtn = document.getElementById("newSessionBtn");
  if (!newSessionBtn) return; // not on sender page

  const sessionInfo = document.getElementById("sessionInfo");
  const sessionCodeEl = document.getElementById("sessionCode");
  const localIpsEl = document.getElementById("localIps");
  const fileInput = document.getElementById("fileInput");
  const selectedFilesEl = document.getElementById("selectedFiles");
  const uploadBtn = document.getElementById("uploadBtn");
  const progressBar = document.getElementById("uploadProgress");
  const uploadStatus = document.getElementById("uploadStatus");

  const maxSizeSpan = document.getElementById("maxSize");
  const maxBytes = Number(document.querySelector("[data-bytes]")?.dataset.bytes || "0");
  if (maxSizeSpan) maxSizeSpan.textContent = ShareLiteUtils.formatBytes(maxBytes);

  let sessionId = null;
  let filesToUpload = [];

  function setUploadingProgress(pct) {
    progressBar.style.width = `${pct}%`;
    progressBar.textContent = `${Math.floor(pct)}%`;
  }
  function resetProgress() { setUploadingProgress(0); uploadStatus.textContent = ""; }

  newSessionBtn.addEventListener("click", async () => {
    resetProgress();
    sessionInfo.classList.add("hidden");
    uploadBtn.disabled = true;
    sessionId = null;

    try {
      const resp = await fetch("/api/session/new", { method: "POST" });
      const data = await resp.json();
      if (!data.ok) throw new Error("Failed to create session");
      sessionId = data.session_id;
      sessionCodeEl.textContent = sessionId;
      const proto = window.location.protocol;
      const port = window.location.port ? `:${window.location.port}` : "";
      localIpsEl.textContent = `Reachable on: ${data.ips.map(ip => `${proto}//${ip}${port}`).join(", ")}`;
      sessionInfo.classList.remove("hidden");
      if (filesToUpload.length > 0) uploadBtn.disabled = false;
    } catch (e) {
      alert("Could not create session. Please try again.");
      console.error(e);
    }
  });

  fileInput.addEventListener("change", () => {
    filesToUpload = Array.from(fileInput.files || []);
    selectedFilesEl.innerHTML = "";
    if (filesToUpload.length === 0) { uploadBtn.disabled = true; return; }

    const overLimit = []; let total = 0;
    for (const f of filesToUpload) {
      total += f.size;
      if (maxBytes && f.size > maxBytes) overLimit.push(`${f.name} (${ShareLiteUtils.formatBytes(f.size)})`);
    }

    const list = document.createElement("ul");
    for (const f of filesToUpload) {
      const li = document.createElement("li");
      li.textContent = `${f.name} — ${ShareLiteUtils.formatBytes(f.size)}`;
      list.appendChild(li);
    }
    selectedFilesEl.appendChild(list);
    const summary = document.createElement("div");
    summary.className = "muted";
    summary.textContent = `Total: ${ShareLiteUtils.formatBytes(total)} in ${filesToUpload.length} file(s)`;
    selectedFilesEl.appendChild(summary);

    if (overLimit.length > 0) {
      uploadBtn.disabled = true;
      uploadStatus.innerHTML = `<span style="color:#ef4444">These files exceed server max size and will be rejected:</span><br>${overLimit.join("<br>")}`;
    } else {
      uploadStatus.textContent = "";
      uploadBtn.disabled = !sessionId;
    }
  });

  uploadBtn.addEventListener("click", () => {
    if (!sessionId) { alert("Please create a session first."); return; }
    if (filesToUpload.length === 0) { alert("Please select files to upload."); return; }

    const form = new FormData();
    for (const f of filesToUpload) form.append("files", f);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/upload/${sessionId}`);
    setUploadingProgress(0);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) setUploadingProgress((evt.loaded / evt.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setUploadingProgress(100);
        uploadStatus.textContent = "Upload complete! Receiver can now download the files.";
      } else {
        uploadStatus.textContent = `Upload failed: ${xhr.responseText || xhr.statusText}`;
      }
    };
    xhr.onerror = () => { uploadStatus.textContent = "Network error during upload."; };
    xhr.send(form);
  });
}

// Receiver page logic
function initReceiver() {
  const sessionInput = document.getElementById("sessionInput");
  if (!sessionInput) return; // not on receiver page

  const connectBtn = document.getElementById("connectBtn");
  const filesPanel = document.getElementById("filesPanel");
  const filesList = document.getElementById("filesList");
  const downloadSelectedBtn = document.getElementById("downloadSelectedBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const progressWrap = document.getElementById("downloadProgressWrapper");
  const progressBar = document.getElementById("downloadProgress");
  const downloadStatus = document.getElementById("downloadStatus");

  let sessionId = "";
  let selections = new Set();
  let filesCache = [];

  function setProgress(pct, label = "") {
    const clamped = Math.max(0, Math.min(100, Math.floor(pct)));
    progressBar.style.width = `${clamped}%`;
    progressBar.textContent = `${clamped}%`;
    downloadStatus.textContent = label;
  }
  function resetProgress() { progressWrap.classList.add("hidden"); setProgress(0, ""); }
  function normalizeSession(v) { return (v || "").trim().toUpperCase(); }

  async function fetchFiles(id) {
    const resp = await fetch(`/api/files/${encodeURIComponent(id)}`);
    if (!resp.ok) throw new Error("Unable to fetch files");
    const data = await resp.json();
    if (!data.ok) throw new Error("Server error");
    return data.files || [];
  }

  function renderFiles(items) {
    filesCache = items.slice();
    filesList.innerHTML = "";
    selections = new Set(Array.from(selections).filter(id => items.some(x => x.id === id)));

    if (items.length === 0) {
      filesList.innerHTML = `<div class="muted">No files available yet.</div>`;
      downloadSelectedBtn.disabled = true;
      return;
    }

    for (const f of items) {
      const row = document.createElement("div");
      row.className = "file-row";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selections.has(f.id);
      cb.addEventListener("change", () => {
        if (cb.checked) selections.add(f.id); else selections.delete(f.id);
        downloadSelectedBtn.disabled = selections.size === 0;
      });

      const name = document.createElement("div");
      name.className = "file-name"; name.textContent = f.name;

      const size = document.createElement("div");
      size.className = "file-size"; size.textContent = ShareLiteUtils.formatBytes(f.size);

      row.appendChild(cb); row.appendChild(name); row.appendChild(size);
      filesList.appendChild(row);
    }
    downloadSelectedBtn.disabled = selections.size === 0;
  }

  async function refresh() {
    if (!sessionId) return;
    try { renderFiles(await fetchFiles(sessionId)); }
    catch (e) {
      console.error(e);
      filesList.innerHTML = `<div class="muted">Could not load files. Check session code or network.</div>`;
      downloadSelectedBtn.disabled = true;
    }
  }

  async function downloadFile(fileId, fileName) {
    progressWrap.classList.remove("hidden");
    setProgress(0, `Starting download: ${fileName}`);

    const resp = await fetch(`/download/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileId)}`);
    if (!resp.ok) throw new Error(`Download failed (${resp.status})`);

    const total = Number(resp.headers.get("content-length") || "0");
    const reader = resp.body.getReader();
    const chunks = []; let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.byteLength;
      if (total > 0) setProgress((received / total) * 100, `Downloading ${fileName} — ${ShareLiteUtils.formatBytes(received)} / ${ShareLiteUtils.formatBytes(total)}`);
      else setProgress(0, `Downloading ${fileName} — ${ShareLiteUtils.formatBytes(received)}`);
    }

    const blob = new Blob(chunks);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadSelected() {
    const rows = Array.from(filesList.querySelectorAll(".file-row"));
    const selectedMeta = rows.map((row, idx) => {
      const cb = row.querySelector("input[type=checkbox]");
      if (!cb || !cb.checked) return null;
      const nameEl = row.querySelector(".file-name");
      const fileName = nameEl?.textContent || `file-${idx}`;
      const id = filesCache[idx]?.id;
      return id ? { id, fileName } : null;
    }).filter(Boolean);

    if (selectedMeta.length === 0) return;

    try {
      for (let i = 0; i < selectedMeta.length; i++) {
        const { id, fileName } = selectedMeta[i];
        setProgress(0, `Preparing ${fileName} (${i + 1}/${selectedMeta.length})`);
        await downloadFile(id, fileName);
      }
      setProgress(100, "All downloads complete.");
      await refresh();
    } catch (e) {
      console.error(e);
      downloadStatus.textContent = e.message || "Download error.";
    } finally {
      setTimeout(() => resetProgress(), 1500);
    }
  }

  connectBtn.addEventListener("click", async () => {
    sessionId = normalizeSession(sessionInput.value);
    if (!sessionId) { alert("Please enter a session code."); return; }
    filesPanel.classList.remove("hidden");
    await refresh();
  });
  refreshBtn.addEventListener("click", refresh);
  downloadSelectedBtn.addEventListener("click", downloadSelected);

  // Immediately apply prefill (was incorrectly registered as a second DOMContentLoaded handler)
  const prefill = normalizeSession(sessionInput.value);
  if (prefill) {
    sessionId = prefill;
    filesPanel.classList.remove("hidden");
    refresh();
  }
}