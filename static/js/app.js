// Shared utilities
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

window.ShareLiteUtils = { formatBytes };

// Init common UI
document.addEventListener("DOMContentLoaded", () => {
  // Mobile nav toggle
  const navToggle = document.getElementById("navToggle");
  const header = document.querySelector(".app-header");

  if (navToggle && header) {
    navToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = header.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    // Close nav when clicking outside
    document.addEventListener("click", (e) => {
      if (header.classList.contains("open") && !header.contains(e.target)) {
        header.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      }
    });

    // Close nav when clicking nav links
    document.querySelectorAll(".nav a").forEach((link) => {
      link.addEventListener("click", () => {
        header.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // Copy-session handler (works for both send & receive)
  function setupCopyButtons() {
    document.querySelectorAll("[data-copy-session]").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const targetId = btn.dataset.copySession;
        const el = document.getElementById(targetId);
        if (!el) return;
        const text = el.textContent?.trim();
        if (!text) return;
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
          } catch {}
        }
        const icon = btn.querySelector("i");
        if (icon) {
          const prev = icon.className;
          icon.className = "fa-solid fa-check";
          setTimeout(() => (icon.className = prev), 900);
        }
      });
    });
  }

  setupCopyButtons();

  initSender();
  initReceiver();
});

// Sender page logic
function initSender() {
  const sendPage = document.getElementById("sendPage");
  if (!sendPage) return;

  const senderGrid = document.getElementById("senderGrid");
  const sessionCodePanel = document.getElementById("sessionCodePanel");
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const selectedFilesEl = document.getElementById("selectedFiles");
  const uploadBtn = document.getElementById("uploadBtn");
  const clearBtn = document.getElementById("clearBtn");
  const progressBar = document.getElementById("uploadProgress");
  const uploadStatus = document.getElementById("uploadStatus");

  const maxBytes = Number(document.querySelector("[data-bytes]")?.dataset.bytes || "0");
  const maxSizeSpan = document.getElementById("maxSize");
  if (maxSizeSpan) maxSizeSpan.textContent = ShareLiteUtils.formatBytes(maxBytes);

  let sessionId = null;
  let filesToUpload = [];
  let cleanupSent = false;

  function setUploadingProgress(pct) {
    if (!progressBar) return;
    const val = Math.max(0, Math.min(100, pct));
    progressBar.style.width = `${val}%`;
    progressBar.textContent = `${Math.floor(val)}%`;
  }

  function resetProgress() {
    setUploadingProgress(0);
    if (uploadStatus) uploadStatus.textContent = "";
  }

  function renderSelectedFiles() {
    if (!selectedFilesEl) return;
    selectedFilesEl.innerHTML = "";

    if (filesToUpload.length === 0) {
      if (uploadBtn) uploadBtn.disabled = true;
      return;
    }

    const list = document.createElement("ul");
    let totalSize = 0;
    const overLimit = [];

    for (const file of filesToUpload) {
      totalSize += file.size;
      if (maxBytes && file.size > maxBytes) {
        overLimit.push(file.name);
      }
      const li = document.createElement("li");
      li.innerHTML = `
        <span>${file.name}</span>
        <span class="muted">${ShareLiteUtils.formatBytes(file.size)}</span>
      `;
      list.appendChild(li);
    }

    selectedFilesEl.appendChild(list);

    const summary = document.createElement("div");
    summary.className = "muted";
    summary.textContent = `Total: ${ShareLiteUtils.formatBytes(totalSize)} in ${filesToUpload.length} file(s)`;
    selectedFilesEl.appendChild(summary);

    if (overLimit.length > 0) {
      if (uploadBtn) uploadBtn.disabled = true;
      if (uploadStatus) {
        uploadStatus.textContent = `Some files exceed the maximum size: ${overLimit.join(", ")}`;
      }
    } else {
      if (uploadStatus) uploadStatus.textContent = "";
      if (uploadBtn) uploadBtn.disabled = false;
    }
  }

  // Dropzone interactions - open native picker reliably
  if (dropzone && fileInput) {
    dropzone.addEventListener("click", () => {
      // Prefer showPicker (Chrome/Edge), fallback to click
      if (typeof fileInput.showPicker === "function") {
        try {
          fileInput.showPicker();
        } catch {
          fileInput.click();
        }
      } else {
        fileInput.click();
      }
    });

    // Keyboard accessibility
    dropzone.setAttribute("tabindex", "0");
    dropzone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (typeof fileInput.showPicker === "function") {
          try {
            fileInput.showPicker();
          } catch {
            fileInput.click();
          }
        } else {
          fileInput.click();
        }
      }
    });

    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragging");
    });
    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("dragging");
    });
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove("dragging");
      filesToUpload = Array.from(e.dataTransfer.files || []);
      renderSelectedFiles();
    });

    fileInput.addEventListener("change", () => {
      filesToUpload = Array.from(fileInput.files || []);
      renderSelectedFiles();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      filesToUpload = [];
      if (fileInput) fileInput.value = "";
      renderSelectedFiles();
      resetProgress();
    });
  }

  // Auto-create session on page load
  (async function createSession() {
    resetProgress();
    if (uploadBtn) uploadBtn.disabled = true;

    try {
      const resp = await fetch("/api/session/new", { method: "POST" });
      const data = await resp.json();

      if (!data.ok) {
        if (uploadStatus) uploadStatus.textContent = "Failed to create session.";
        return;
      }

      sessionId = data.session_id;

      if (sessionCodePanel) {
        sessionCodePanel.textContent = sessionId;
      }
      if (senderGrid) {
        senderGrid.classList.remove("hidden");
        sendPage.classList.remove("initial");
        sendPage.classList.add("active");
      }
    } catch (e) {
      if (uploadStatus) uploadStatus.textContent = "Error creating session.";
    }
  })();

  // Upload handler
  if (uploadBtn) {
    uploadBtn.addEventListener("click", async () => {
      if (!sessionId) {
        if (uploadStatus) uploadStatus.textContent = "No session.";
        return;
      }
      if (!filesToUpload.length) {
        if (uploadStatus) uploadStatus.textContent = "No files selected.";
        return;
      }
      const form = new FormData();
      for (const f of filesToUpload) {
        form.append("files", f, f.name);
      }
      resetProgress();
      if (uploadStatus) uploadStatus.textContent = "Uploading...";
      try {
        const resp = await fetch(`/api/upload/${encodeURIComponent(sessionId)}`, {
          method: "POST",
          body: form,
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          throw new Error(data.error || "Upload failed");
        }
        setUploadingProgress(100);
        if (uploadStatus) uploadStatus.textContent = `Uploaded ${data.uploaded.length} file(s).`;
      } catch (e) {
        if (uploadStatus) uploadStatus.textContent = "Upload error.";
      }
    });
  }

  // Auto end session when navigating away or closing tab
  function endSessionKeepAlive() {
    if (!sessionId || cleanupSent) return;
    cleanupSent = true;
    const url = `/api/session/end/${encodeURIComponent(sessionId)}`;
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([], { type: "application/json" });
        navigator.sendBeacon(url, blob);
      } else {
        // Fallback
        fetch(url, { method: "POST", keepalive: true }).catch(() => {});
      }
    } catch {}
  }

  // Trigger cleanup on page lifecycle events
  window.addEventListener("pagehide", endSessionKeepAlive);
  window.addEventListener("beforeunload", endSessionKeepAlive);

  // Also trigger before following header nav links
  document.querySelectorAll(".nav a").forEach((a) => {
    a.addEventListener("click", endSessionKeepAlive, { capture: true });
  });
}

// Receiver page logic
function initReceiver() {
  const receivePage = document.getElementById("receivePage");
  const sessionInput = document.getElementById("sessionInput");
  const receiverGrid = document.getElementById("receiverGrid");
  const mainHero = document.querySelector(".main-hero");
  if (!sessionInput || !receivePage) return;

  // Ensure initial visibility: show only form, hide grid
  try {
    if (receiverGrid) receiverGrid.style.display = "none";
    if (mainHero) mainHero.style.display = "";
  } catch {}

  // Auto-uppercase and format session input
  sessionInput.addEventListener("input", (e) => {
    let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (value.length > 6) value = value.slice(0, 6);
    e.target.value = value;
  });

  // will be assigned below
  let connectBtn = null;

  // Auto-submit on Enter key (connectBtn may be assigned later)
  sessionInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (connectBtn) connectBtn.click();
    }
  });

  connectBtn = document.getElementById("connectBtn");
  const sessionCodePanelR = document.getElementById("sessionCodePanelR");
  const filesList = document.getElementById("filesList");
  const downloadSelectedBtn = document.getElementById("downloadSelectedBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const progressBar = document.getElementById("downloadProgress");
  const downloadStatus = document.getElementById("downloadStatus");
  const leaveSessionBtn = document.getElementById("leaveSessionBtn");
  const filePreview = document.getElementById("filePreview");

  let sessionId = "";
  let selections = new Set();
  let filesCache = [];
  let cleanupSent = false;

  function setProgress(pct, label = "") {
    const clamped = Math.max(0, Math.min(100, Math.floor(pct)));
    if (progressBar) {
      progressBar.style.width = `${clamped}%`;
      progressBar.textContent = `${clamped}%`;
    }
    if (downloadStatus) {
      downloadStatus.innerHTML = label ? `<i class="fa-solid fa-spinner"></i> ${label}` : "";
    }
  }

  function resetProgress() {
    setProgress(0, "");
  }

  function normalizeSession(val) {
    return (val || "").trim().toUpperCase();
  }

  async function fetchFiles(id) {
    const resp = await fetch(`/api/files/${encodeURIComponent(id)}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    if (!data.ok) return [];
    return data.files || [];
  }

  function getFileIcon(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const iconMap = {
      'pdf': 'fa-file-pdf',
      'doc': 'fa-file-word', 'docx': 'fa-file-word',
      'xls': 'fa-file-excel', 'xlsx': 'fa-file-excel',
      'ppt': 'fa-file-powerpoint', 'pptx': 'fa-file-powerpoint',
      'zip': 'fa-file-zipper', 'rar': 'fa-file-zipper', '7z': 'fa-file-zipper',
      'jpg': 'fa-file-image', 'jpeg': 'fa-file-image', 'png': 'fa-file-image', 'gif': 'fa-file-image',
      'mp4': 'fa-file-video', 'avi': 'fa-file-video', 'mkv': 'fa-file-video',
      'mp3': 'fa-file-audio', 'wav': 'fa-file-audio',
      'txt': 'fa-file-lines',
      'js': 'fa-file-code', 'html': 'fa-file-code', 'css': 'fa-file-code', 'py': 'fa-file-code'
    };
    return iconMap[ext] || 'fa-file';
  }

  function updatePreview(file) {
    if (!filePreview) return;

    if (!file) {
      filePreview.className = 'file-preview';
      filePreview.innerHTML = `
        <i class="fa-solid fa-folder-open file-preview-icon"></i>
        <div class="muted">Select a file to preview</div>
      `;
      return;
    }

    filePreview.className = 'file-preview active';
    filePreview.innerHTML = `
      <i class="fa-solid ${getFileIcon(file.name)} file-preview-icon"></i>
      <div class="file-preview-name">${file.name}</div>
      <div class="file-preview-size">${ShareLiteUtils.formatBytes(file.size)}</div>
      <div class="file-preview-meta">
        <div class="file-preview-meta-row">
          <span class="file-preview-meta-label">Type</span>
          <span class="file-preview-meta-value">${file.name.split('.').pop().toUpperCase()}</span>
        </div>
        <div class="file-preview-meta-row">
          <span class="file-preview-meta-label">Size</span>
          <span class="file-preview-meta-value">${ShareLiteUtils.formatBytes(file.size)}</span>
        </div>
      </div>
    `;
  }

  function renderFiles(items) {
    filesCache = items.slice();
    if (filesList) filesList.innerHTML = "";
    selections = new Set(Array.from(selections).filter((id) => items.some((x) => x.id === id)));

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "files-empty";
      empty.innerHTML = `
        <i class="fa-solid fa-inbox"></i>
        <h3>No files yet</h3>
        <p>Waiting for sender to upload files...</p>
      `;
      if (filesList) filesList.appendChild(empty);
      if (downloadSelectedBtn) downloadSelectedBtn.disabled = true;
      updatePreview(null);
      return;
    }

    items.forEach((file) => {
      const row = document.createElement("div");
      row.className = "file-row";
      if (selections.has(file.id)) row.classList.add("selected");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selections.has(file.id);
      checkbox.addEventListener("change", (e) => {
        e.stopPropagation();
        if (checkbox.checked) {
          selections.add(file.id);
          row.classList.add("selected");
        } else {
          selections.delete(file.id);
          row.classList.remove("selected");
        }
        if (downloadSelectedBtn) downloadSelectedBtn.disabled = selections.size === 0;
      });

      const iconWrapper = document.createElement("div");
      iconWrapper.className = "file-icon-wrapper";
      iconWrapper.innerHTML = `<i class="fa-solid ${getFileIcon(file.name)}"></i>`;

      const infoWrapper = document.createElement("div");
      infoWrapper.className = "file-info";

      const nameEl = document.createElement("div");
      nameEl.className = "file-name";
      nameEl.textContent = file.name;

      const sizeEl = document.createElement("div");
      sizeEl.className = "file-size";
      sizeEl.textContent = ShareLiteUtils.formatBytes(file.size);

      infoWrapper.appendChild(nameEl);
      infoWrapper.appendChild(sizeEl);

      row.appendChild(checkbox);
      row.appendChild(iconWrapper);
      row.appendChild(infoWrapper);

      row.addEventListener("click", (e) => {
        if (e.target === checkbox) return;
        updatePreview(file);
      });

      if (filesList) filesList.appendChild(row);
    });

    if (downloadSelectedBtn) downloadSelectedBtn.disabled = selections.size === 0;

    // Auto-preview first file
    if (items.length > 0) {
      updatePreview(items[0]);
    }
  }

  async function refresh() {
    if (!sessionId) return;
    try {
      const items = await fetchFiles(sessionId);
      renderFiles(items);
    } catch (e) {
      if (downloadStatus) downloadStatus.textContent = "Refresh error.";
    }
  }

  async function downloadFile(fileId, fileName) {
    setProgress(0, `Starting: ${fileName}`);
    const resp = await fetch(`/download/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileId)}`);
    if (!resp.ok) {
      setProgress(0, "Download failed.");
      return;
    }

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
        setProgress((received / total) * 100, `Downloading: ${fileName}`);
      } else {
        setProgress(Math.min(100, received / (1024 * 1024) * 5), `Downloading: ${fileName}`);
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
    setProgress(100, `✓ Downloaded: ${fileName}`);
  }

  async function downloadSelected() {
    const selectedMeta = filesCache
      .map((file) => (selections.has(file.id) ? { id: file.id, name: file.name } : null))
      .filter(Boolean);

    if (selectedMeta.length === 0) return;

    try {
      for (const file of selectedMeta) {
        await downloadFile(file.id, file.name);
      }
      setTimeout(resetProgress, 2000);
    } catch (e) {
      if (downloadStatus) downloadStatus.textContent = "Download error.";
    }
  }

  // connect action: hide form, show grid
  if (connectBtn) {
    connectBtn.addEventListener("click", async () => {
      sessionId = normalizeSession(sessionInput.value);
      if (!sessionId) {
        if (downloadStatus) downloadStatus.textContent = "Enter a session code.";
        return;
      }

      // Hide the form/hero and show the receiver grid
      try {
        if (mainHero) mainHero.style.display = "none";
        if (receiverGrid) receiverGrid.style.display = "block";
      } catch {}

      // Switch to active state (for any CSS)
      receivePage.classList.remove("initial");
      receivePage.classList.add("active");

      if (sessionCodePanelR) sessionCodePanelR.textContent = sessionId;

      await refresh();
    });
  }

  if (refreshBtn) refreshBtn.addEventListener("click", refresh);
  if (downloadSelectedBtn) downloadSelectedBtn.addEventListener("click", downloadSelected);

  // Auto-connect if session prefilled
  const prefill = normalizeSession(sessionInput.value);
  if (prefill) {
    sessionId = prefill;

    // Hide form and show grid
    try {
      if (mainHero) mainHero.style.display = "none";
      if (receiverGrid) receiverGrid.style.display = "block";
    } catch {}

    receivePage.classList.remove("initial");
    receivePage.classList.add("active");
    if (sessionCodePanelR) sessionCodePanelR.textContent = sessionId;
    refresh();
  }

  // Leave Session button
  if (leaveSessionBtn) {
    leaveSessionBtn.addEventListener("click", async () => {
      if (!sessionId) return;
      try {
        await fetch(`/api/session/end/${encodeURIComponent(sessionId)}`, { method: "POST" });
      } catch {}
      // reload receiver page so initial form is shown again
      window.location.href = "/receiver";
    });
  }

  // Best-effort cleanup
  function endSessionKeepAlive() {
    if (!sessionId || cleanupSent) return;
    cleanupSent = true;
    const url = `/api/session/end/${encodeURIComponent(sessionId)}`;
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([], { type: "application/json" });
        navigator.sendBeacon(url, blob);
      } else {
        fetch(url, { method: "POST", keepalive: true }).catch(() => {});
      }
    } catch {}
  }
  window.addEventListener("pagehide", endSessionKeepAlive);
  window.addEventListener("beforeunload", endSessionKeepAlive);
}