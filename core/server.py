import threading
import time
import zipfile
import shutil
import json
import os
import subprocess
from flask import Flask, request, jsonify, send_from_directory, make_response, Response, stream_with_context
from werkzeug.serving import make_server
from werkzeug.utils import secure_filename
from core.config import logger, DOWNLOADS_DIR, LOCAL_AGENT_HOST, LOCAL_AGENT_PORT, WORKING_DIR
from core.security import apply_cors_headers, init_limiter, safe_path_resolve, validate_spotify_url
from core.downloader import downloader, start_download_process, start_youtube_download_process, PROGRESS_TRACKER, get_job
from core.transcriber import transcriber

app = Flask(__name__)
limiter = init_limiter(app)

# Temp folder for uploads
UPLOAD_DIR = WORKING_DIR / "temp_uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

def resolve_download_file_exact(filename):
    if not filename or not isinstance(filename, str):
        return None

    candidate = os.path.basename(filename)
    if candidate != filename:
        return None

    try:
        target_path = (DOWNLOADS_DIR / candidate).resolve()
        if not str(target_path).startswith(str(DOWNLOADS_DIR.resolve())):
            return None
        if not target_path.exists() or target_path.is_dir():
            return None
        return target_path
    except Exception:
        return None

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        res = make_response()
        return apply_cors_headers(res)

@app.after_request
def after_request(response):
    return apply_cors_headers(response)

@app.route("/")
def index():
    return "TorkTool Agent Ready"

@app.route("/api/status")
def status():
    from core.bridge import get_bridge_service
    return jsonify({
        "status": "online", "mode": "remote-bridge",
        "bridge_connected": get_bridge_service().get_status().get("connected", False)
    })

@app.route("/api/playlist/info", methods=["POST"])
@limiter.limit("20 per minute")
def playlist_info():
    data = request.json
    url = data.get("url")
    stype = validate_spotify_url(url)
    if stype == "unknown": return jsonify({"success": False, "error": "URL no válida"}), 400
    
    try:
        if stype == "track": return jsonify(downloader.get_track_info(url))
        info = downloader.sp.get_playlist_info(url)
        return jsonify({
            "success": True, "kind": "playlist", "name": info["name"],
            "owner": downloader.normalize_owner(info.get("owner")),
            "total_tracks": len(info.get("tracks", [])),
            "image": info.get("images", [{}])[0].get("url"),
            "download_supported": True
        })
    except Exception as e: return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/playlist/download", methods=["POST"])
@limiter.limit("5 per minute")
def playlist_download():
    success, payload = start_download_process(request.json.get("url"))
    if success:
        return jsonify({"success": True, **payload})
    return jsonify({"success": False, "error": payload}), 400

@app.route("/api/url", methods=["POST"])
@limiter.limit("10 per minute")
def download_url():
    data = request.get_json(silent=True) or {}
    urls = data.get("urls") or []
    filename = data.get("filename") or f"torktool_{int(time.time())}"
    type_ = data.get("type") or "mp3"

    if isinstance(urls, str):
        urls = [urls]
    if not isinstance(urls, list) or not urls:
        return jsonify({"success": False, "error": "No se proporcionaron URLs"}), 400

    try:
        success, payload = start_youtube_download_process(urls, filename, type_)
        if success:
            return jsonify({"success": True, **payload})
        return jsonify({"success": False, "error": payload}), 500
    except Exception as e:
        logger.error(f"Error en descarga de URL: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/download/status")
@limiter.exempt
def download_status():
    job_id = request.args.get("job_id")
    url = request.args.get("url")
    if job_id:
        job = get_job(job_id)
        return jsonify({"success": True, **(job or {"status": "not_found"})})
    return jsonify({"success": True, **PROGRESS_TRACKER.get(url, {"status": "not_found"})})

@app.route("/api/download/events/<job_id>")
@limiter.exempt
def download_events(job_id):
    @stream_with_context
    def event_stream():
        last_payload = None
        while True:
            job = get_job(job_id)
            payload = {"success": True, **(job or {"status": "not_found"})}
            if payload != last_payload:
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                last_payload = payload
                if payload.get("status") in {"finished", "error", "not_found"}:
                    break
            time.sleep(1)

    return Response(event_stream(), mimetype="text/event-stream")

@app.route("/api/files")
@limiter.limit("500 per hour")
def list_files():
    files = [{"name": f.name, "size": f"{f.stat().st_size/(1024*1024):.1f} MB"} for f in DOWNLOADS_DIR.glob("*.zip")]
    return jsonify({"success": True, "files": files})

@app.route("/api/download/<filename>")
@limiter.limit("10 per minute")
def download_file(filename):
    path = resolve_download_file_exact(filename)
    if not path or not path.exists(): return jsonify({"success": False, "error": "No encontrado"}), 404
    return send_from_directory(DOWNLOADS_DIR, path.name)

@app.route("/api/open-folder", methods=["POST"])
@limiter.limit("30 per minute")
def open_downloads_folder():
    data = request.get_json(silent=True) or {}
    filename = data.get("filename")
    logger.info(f"Solicitud para abrir carpeta. filename={filename!r}")

    try:
        path = resolve_download_file_exact(filename) if filename else None

        if path:
            if os.name == "nt":
                subprocess.Popen(["explorer.exe", f"/select,{str(path)}"], creationflags=0x08000000)
            else:
                subprocess.Popen(["explorer", str(path.parent)])
            return jsonify({"success": True, "found": True})

        if os.name == "nt":
            os.startfile(str(DOWNLOADS_DIR))
        else:
            subprocess.Popen(["explorer", str(DOWNLOADS_DIR)], creationflags=0x08000000 if os.name == "nt" else 0)

        return jsonify({"success": True, "found": False, "folder": str(DOWNLOADS_DIR)})
    except Exception as e:
        logger.error(f"Error abriendo carpeta: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/transcribe", methods=["POST"])
@limiter.limit("5 per minute")
def transcribe_audio():
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "No hay archivo en la petición"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"success": False, "error": "No se seleccionó ningún archivo"}), 400
    
    try:
        temp_path = UPLOAD_DIR / secure_filename(file.filename)
        file.save(str(temp_path))
        
        text = transcriber.transcribe(temp_path)
        
        # Cleanup
        if temp_path.exists():
            temp_path.unlink()
            
        return jsonify({"success": True, "text": text})
    except Exception as e:
        logger.error(f"Error en transcripción: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/delete/<filename>", methods=["DELETE"])
@limiter.limit("10 per minute")
def delete_file(filename):
    path = safe_path_resolve(filename)
    if not path or not path.exists(): return jsonify({"success": False, "error": "No encontrado"}), 404
    path.unlink()
    return jsonify({"success": True})

class LocalAgentServer:
    def __init__(self):
        self.server = make_server(LOCAL_AGENT_HOST, LOCAL_AGENT_PORT, app, threaded=True)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self): self.thread.start()
    def stop(self):
        if self.server: self.server.shutdown()
