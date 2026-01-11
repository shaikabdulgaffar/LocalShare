import os
import shutil
import threading
import socket
import time
import uuid
import io
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Any, List

from flask import (
    Flask, request, jsonify, render_template, send_file, abort, Response, url_for
)
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge

# ---------------------------------------
# Configuration
# ---------------------------------------
BASE_DIR = Path(__file__).resolve().parent
# Store all uploaded files directly in tmp (no per-session folders)
SESSIONS_DIR = BASE_DIR / "tmp"
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)

# Max individual file size (in bytes).
# Adjust as needed. 2 GiB by default.
MAX_CONTENT_LENGTH = 2 * 1024 * 1024 * 1024

# Session TTL: sessions auto-delete after this period of inactivity
SESSION_TTL_SECONDS = 60 * 60  # 1 hour

# Cleanup interval for background cleaner
CLEANUP_INTERVAL_SECONDS = 60

# Allowed session id characters (for readability)
SESSION_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # No I/O/1/0

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH

# ---------------------------------------
# In-memory store for sessions
# Structure:
# SESSIONS = {
#   "ABC123": {
#       "id": "ABC123",
#       "dir": "/abs/path/to/session",
#       "created_at": 1700000000.0,
#       "last_activity": 1700000000.0,
#       "files": [
#           {"id": "uuid", "name": "original.ext", "saved_name": "safe.ext", "size": 1234, "downloaded": False}
#       ]
#   }
# }
# ---------------------------------------
SESSIONS: Dict[str, Dict[str, Any]] = {}
SESSIONS_LOCK = threading.Lock()  # Protect SESSIONS for concurrency


# ---------------------------------------
# Utilities
# ---------------------------------------
def generate_session_id(length: int = 6) -> str:
    import random
    while True:
        code = "".join(random.choice(SESSION_ID_ALPHABET) for _ in range(length))
        with SESSIONS_LOCK:
            if code not in SESSIONS:
                return code


def get_local_ip_candidates() -> List[str]:
    """
    Best-effort collection of local IPs for the server device.
    This helps the sender share the address with receivers on the same LAN.
    """
    candidates = set()

    # Try UDP connect trick (no packets are actually sent).
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.0.2.1", 80))  # TEST-NET-1, doesn't need to be reachable
        candidates.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass

    # Add hostname resolution
    try:
        hostname = socket.gethostname()
        host_ips = socket.gethostbyname_ex(hostname)[2]
        for ip in host_ips:
            if not ip.startswith("127."):
                candidates.add(ip)
    except Exception:
        pass

    # Always include localhost last
    candidates.add("127.0.0.1")
    return sorted(candidates)


def ensure_session(session_id: str) -> Dict[str, Any]:
    """Create a session if it doesn't exist; return the session dict."""
    with SESSIONS_LOCK:
        sess = SESSIONS.get(session_id)
        if not sess:
            sess = {
                "id": session_id,
                # No per-session dir anymore; keep root for reference
                "dir": str(SESSIONS_DIR),
                "created_at": time.time(),
                "last_activity": time.time(),
                "files": [],
            }
            SESSIONS[session_id] = sess
        return sess


def get_session(session_id: str) -> Dict[str, Any]:
    with SESSIONS_LOCK:
        return SESSIONS.get(session_id)


def touch_session(session_id: str):
    with SESSIONS_LOCK:
        if session_id in SESSIONS:
            SESSIONS[session_id]["last_activity"] = time.time()


def safe_join(base: Path, *paths) -> Path:
    """
    Prevent directory traversal by resolving final path and verifying
    it stays within the base directory.
    """
    final_path = (base.joinpath(*paths)).resolve()
    if not str(final_path).startswith(str(base.resolve())):
        abort(400, "Invalid path")
    return final_path


def delete_session(session_id: str):
    """Remove session files (saved directly in tmp) and metadata."""
    with SESSIONS_LOCK:
        sess = SESSIONS.pop(session_id, None)

    if sess:
        # Delete each saved file for this session
        for f in list(sess.get("files", [])):
            try:
                p = safe_join(SESSIONS_DIR, f["saved_name"])
                if p.exists():
                    p.unlink(missing_ok=True)
            except Exception:
                pass

    # Back-compat: remove any legacy tmp/sessions/<id> folder if it exists
    legacy_dir = BASE_DIR / "tmp" / "sessions" / session_id
    try:
        if legacy_dir.exists():
            shutil.rmtree(legacy_dir, ignore_errors=True)
    except Exception:
        pass


def cleanup_expired_sessions():
    """Background thread to delete sessions that have timed out."""
    while True:
        try:
            now = time.time()
            expired = []
            with SESSIONS_LOCK:
                for sid, sess in list(SESSIONS.items()):
                    if now - sess.get("last_activity", now) > SESSION_TTL_SECONDS:
                        expired.append(sid)
            for sid in expired:
                delete_session(sid)
        except Exception:
            pass
        time.sleep(CLEANUP_INTERVAL_SECONDS)


# Kick off cleaner thread
threading.Thread(target=cleanup_expired_sessions, daemon=True).start()


# ---------------------------------------
# Error handlers
# ---------------------------------------
@app.errorhandler(RequestEntityTooLarge)
def handle_large_file(e):
    return jsonify({"ok": False, "error": f"File too large. Max {MAX_CONTENT_LENGTH} bytes."}), 413


@app.errorhandler(404)
def handle_not_found(e):
    if request.accept_mimetypes.accept_json and not request.accept_mimetypes.accept_html:
        return jsonify({"ok": False, "error": "Not found"}), 404
    return render_template("app.html", page="404"), 404


# ---------------------------------------
# Pages
# ---------------------------------------
@app.route("/")
def index():
    ip_candidates = get_local_ip_candidates()
    return render_template("app.html", page="index", ip_candidates=ip_candidates)


@app.route("/sender")
def sender_page():
    return render_template("app.html", page="sender")


@app.route("/receiver")
def receiver_page():
    session_prefill = request.args.get("session", "")
    return render_template("app.html", page="receiver", session_prefill=session_prefill)


@app.route("/about")
def about_page():
    return render_template("app.html", page="about")


# ---------------------------------------
# API
# ---------------------------------------
@app.route("/api/session/new", methods=["POST", "GET"])
def api_new_session():
    """Create and return a fresh session code and local IP candidates."""
    session_id = generate_session_id()
    sess = ensure_session(session_id)
    ips = get_local_ip_candidates()
    return jsonify({"ok": True, "session_id": session_id, "ips": ips})


@app.route("/api/upload/<session_id>", methods=["POST"])
def api_upload(session_id):
    sess = ensure_session(session_id)
    files = request.files.getlist("files")
    if not files:
        return jsonify({"ok": False, "error": "No files provided"}), 400

    uploaded = []
    for file in files:
        if not file or not file.filename:
            continue
        original_name = secure_filename(file.filename)
        if not original_name:
            continue

        # Unique saved name directly under tmp with session prefix
        fid = uuid.uuid4().hex
        saved_name = f"{session_id}__{fid}__{original_name}"
        dest = safe_join(SESSIONS_DIR, saved_name)

        file.save(str(dest))
        size = dest.stat().st_size

        meta = {
            "id": fid,
            "name": original_name,
            "saved_name": saved_name,
            "size": size,
        }
        uploaded.append(meta)

    if not uploaded:
        return jsonify({"ok": False, "error": "Nothing uploaded"}), 400

    with SESSIONS_LOCK:
        sess["files"].extend(uploaded)
        sess["last_activity"] = time.time()

    return jsonify({"ok": True, "uploaded": uploaded})


@app.route("/api/files/<session_id>", methods=["GET"])
def api_list_files(session_id):
    """List available files in a session."""
    sess = get_session(session_id)
    touch_session(session_id)
    files_view = []
    for f in sess["files"]:
        # Only show files that still exist on disk (not yet cleaned/deleted)
        f_path = Path(sess["dir"]) / f["saved_name"]
        if f_path.exists():
            files_view.append({
                "id": f["id"],
                "name": f["name"],
                "size": f.get("size", f_path.stat().st_size),
                "downloaded": f.get("downloaded", False)
            })
    return jsonify({"ok": True, "files": files_view})


@app.route("/download/<session_id>/<file_id>", methods=["GET"])
def download_file(session_id, file_id):
    sess = get_session(session_id)
    if not sess:
        abort(404)

    meta = next((f for f in sess.get("files", []) if f["id"] == file_id), None)
    if not meta:
        abort(404)

    path = safe_join(SESSIONS_DIR, meta["saved_name"])
    if not path.exists():
        abort(404)

    touch_session(session_id)
    return send_file(str(path), as_attachment=True, download_name=meta["name"])


@app.route("/api/session/end/<session_id>", methods=["POST", "GET"])
def api_end_session(session_id):
    """End a session and delete its files (stored directly in tmp)."""
    delete_session(session_id)
    return jsonify({"ok": True})


# ---------------------------------------
# QR Code API (optional)
# ---------------------------------------
# Try to enable QR code generation (optional dependency)
try:
    import qrcode
except Exception:
    qrcode = None
try:
    from PIL import Image
except Exception:
    Image = None


@app.route("/api/qr.png")
def api_qr_png():
    text = request.args.get("text", "")
    if not text:
        abort(400, description="Missing text")

    try:
        size = max(128, min(int(request.args.get("size", "256")), 1024))
    except ValueError:
        size = 256

    if qrcode is None:
        return jsonify({"ok": False, "error": "QR support not installed. Run: py -m pip install qrcode[pil]"}), 500

    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")

    if Image is not None:
        try:
            img = img.resize((size, size), Image.NEAREST)
        except Exception:
            pass

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png")


# ---------------------------------------
# Run
# ---------------------------------------
@app.context_processor
def inject_globals():
    return {
        "max_file_size": app.config["MAX_CONTENT_LENGTH"],
        "session_ttl_seconds": SESSION_TTL_SECONDS
    }


def main():
    # Host on all interfaces so other devices on the LAN can reach it.
    port = int(os.environ.get("PORT", "5000"))
    print("\nLocal IPs (share one of these with receiver devices on the same Wi‑Fi/LAN):")
    for ip in get_local_ip_candidates():
        print(f"  -> http://{ip}:{port}/")
    print("\nPress Ctrl+C to stop.")
    app.run(host="0.0.0.0", port=port, debug=False)


if __name__ == "__main__":
    main()