(() => {
  const newSessionBtn = document.getElementById("newSessionBtn");
  const sessionInfo = document.getElementById("sessionInfo");
  const sessionCodeEl = document.getElementById("sessionCode");
  const localIpsEl = document.getElementById("localIps");

  const fileInput = document.getElementById("fileInput");
  const selectedFilesEl = document.getElementById("selectedFiles");
  const uploadBtn = document.getElementById("uploadBtn");
  const progressBar = document.getElementById("uploadProgress");
  const uploadStatus = document.getElementById("uploadStatus");

  const maxSizeSpan = document.getElementById("maxSize");
  const maxBytes = Number(document.querySelector("[data-bytes]").dataset.bytes || "0");
  if (maxSizeSpan) maxSizeSpan.textContent = ShareLiteUtils.formatBytes(maxBytes);

  let sessionId = null;
  let filesToUpload = [];

  function setUploadingProgress(pct) {
    progressBar.style.width = `${pct}%`;
    progressBar.textContent = `${Math.floor(pct)}%`;
  }

  function resetProgress() {
    setUploadingProgress(0);
    uploadStatus.textContent = "";
  }

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
      // FIX: use current protocol/port instead of hardcoded :5000
      const proto = window.location.protocol; // http: or https:
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
    if (filesToUpload.length === 0) {
      uploadBtn.disabled = true;
      return;
    }

    // Validate sizes on client
    const overLimit = [];
    let total = 0;
    for (const f of filesToUpload) {
      total += f.size;
      if (maxBytes && f.size > maxBytes) {
        overLimit.push(`${f.name} (${ShareLiteUtils.formatBytes(f.size)})`);
      }
    }

    // Render selection
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
    if (!sessionId) {
      alert("Please create a session first.");
      return;
    }
    if (filesToUpload.length === 0) {
      alert("Please select files to upload.");
      return;
    }

    const form = new FormData();
    for (const f of filesToUpload) form.append("files", f);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/upload/${sessionId}`);
    setUploadingProgress(0);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        const pct = (evt.loaded / evt.total) * 100;
        setUploadingProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setUploadingProgress(100);
        uploadStatus.textContent = "Upload complete! Receiver can now download the files.";
      } else {
        uploadStatus.textContent = `Upload failed: ${xhr.responseText || xhr.statusText}`;
      }
    };

    xhr.onerror = () => {
      uploadStatus.textContent = "Network error during upload.";
    };

    xhr.send(form);
  });
})();