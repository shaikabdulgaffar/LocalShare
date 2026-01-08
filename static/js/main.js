// Shared utilities for frontend pages

// Format bytes for display (e.g., 1.2 MB)
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Helper to get base URL either from input or current location (origin)
function getBaseUrlOrOrigin(inputEl) {
  const v = inputEl && inputEl.value.trim();
  if (v) return v.replace(/\/+$/, "");
  return window.location.origin;
}

// Expose to global
window.ShareLiteUtils = { formatBytes, getBaseUrlOrOrigin };

// Mobile nav toggle
document.addEventListener("DOMContentLoaded", () => {
  const navToggle = document.getElementById("navToggle");
  const header = document.querySelector(".app-header");
  if (navToggle && header) {
    navToggle.addEventListener("click", () => {
      const open = header.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    // close nav when clicking outside
    document.addEventListener("click", (e) => {
      if (!header.contains(e.target) && header.classList.contains("open")) {
        header.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  // Theme toggle
  const btn = document.getElementById("themeToggle");
  const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  const stored = localStorage.getItem("theme"); // 'light' | 'dark' | null
  const body = document.body;

  function applyTheme(mode) {
    const light = mode === "light";
    body.classList.toggle("theme-light", light);
    const icon = btn?.querySelector("i");
    if (icon) {
      // show moon when in light (to switch to dark), sun when in dark (to switch to light)
      icon.className = light ? "fa-solid fa-moon" : "fa-solid fa-sun";
    }
  }

  const initial = stored || (prefersLight ? "light" : "dark");
  applyTheme(initial);

  if (btn) {
    btn.addEventListener("click", () => {
      const next = body.classList.contains("theme-light") ? "dark" : "light";
      localStorage.setItem("theme", next);
      applyTheme(next);
    });
  }
});