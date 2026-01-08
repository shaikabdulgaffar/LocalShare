(() => {
  const sessionInput = document.getElementById("sessionInput");
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

  function setProgress(pct, label = "") {
    const clamped = Math.max(0, Math.min(100, Math.floor(pct)));
    progressBar.style.width = `${clamped}%`;
    progressBar.textContent = `${clamped}%`;
    downloadStatus.textContent = label;
  }

  function resetProgress() {
    progressWrap.classList.add("hidden");
    setProgress(0, "");
  }

  function normalizeSession(v) {
    return (v || "").trim().toUpperCase();
  }

  async function fetchFiles(id) {
    const resp = await fetch(`/api/files/${encodeURIComponent(id)}`);
    if (!resp.ok) throw new Error("Unable to fetch files");
    const data = await resp.json();
    if (!data.ok) throw new Error("Server error");
    return data.files || [];
  }

  function renderFiles(items) {
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
        if (cb.checked) selections.add(f.id);
        else selections.delete(f.id);
        downloadSelectedBtn.disabled = selections.size === 0;
      });

      const name = document.createElement("div");
      name.className = "file-name";
      name.textContent = f.name;

      const size = document.createElement("div");
      size.className = "file-size";
      size.textContent = ShareLiteUtils.formatBytes(f.size);

      row.appendChild(cb);
      row.appendChild(name);
      row.appendChild(size);
      filesList.appendChild(row);
    }

    downloadSelectedBtn.disabled = selections.size === 0;
  }

  async function refresh() {
    if (!sessionId) return;
    try {
      const items = await fetchFiles(sessionId);
      renderFiles(items);
    } catch (e) {
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
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (total > 0) {
        setProgress((received / total) * 100, `Downloading ${fileName} — ${ShareLiteUtils.formatBytes(received)} / ${ShareLiteUtils.formatBytes(total)}`);
      } else {
        setProgress(0, `Downloading ${fileName} — ${ShareLiteUtils.formatBytes(received)}`);
      }
    }

    const blob = new Blob(chunks);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadSelected() {
    const rows = Array.from(filesList.querySelectorAll(".file-row"));
    const selectedMeta = rows
      .map((row, idx) => {
        const cb = row.querySelector("input[type=checkbox]");
        if (!cb || !cb.checked) return null;
        const nameEl = row.querySelector(".file-name");
        const fileName = nameEl?.textContent || `file-${idx}`;
        const meta = { id: (window._filesCache || [])[idx]?.id, fileName };
        return meta;
      })
      .filter(Boolean);

    if (selectedMeta.length === 0) return;

    try {
      for (let i = 0; i < selectedMeta.length; i++) {
        const { id, fileName } = selectedMeta[i];
        setProgress(0, `Preparing ${fileName} (${i + 1}/${selectedMeta.length})`);
        await downloadFile(id, fileName);
      }
      setProgress(100, "All downloads complete.");
      // Refresh to reflect server-side deletions after download
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
    if (!sessionId) {
      alert("Please enter a session code.");
      return;
    }
    filesPanel.classList.remove("hidden");
    await refresh();
  });

  refreshBtn.addEventListener("click", refresh);
  downloadSelectedBtn.addEventListener("click", downloadSelected);

  // Auto-connect if session was prefilled
  document.addEventListener("DOMContentLoaded", () => {
    const prefill = normalizeSession(sessionInput.value);
    if (prefill) {
      sessionId = prefill;
      filesPanel.classList.remove("hidden");
      refresh();
    }
  });

  // Keep a simple cache aligned with render order for ids (used during download)
  const origRender = renderFiles;
  renderFiles = function(items) {
    window._filesCache = items.slice();
    origRender(items);
  };
})();