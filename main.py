import asyncio
import ctypes
import json
import logging
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
import zipfile
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen

from flask import Flask, request, jsonify, send_from_directory, make_response
from flask_cors import CORS
from werkzeug.serving import make_server
from yt_dlp import YoutubeDL

# Bundle support
if getattr(sys, 'frozen', False):
    BASE_DIR = Path(sys._MEIPASS)
else:
    BASE_DIR = Path(__file__).parent

# Downloads should be in a real directory, not in the temp bundle
DOWNLOADS_DIR = Path(os.getcwd()) / "Downloads_playlists"
DOWNLOADS_DIR.mkdir(exist_ok=True)

# Import placeholders for spotify_scraper (assuming it's installed or provided)
try:
    from spotify_scraper import SpotifyClient
    from spotify_scraper.extractors.playlist import PlaylistExtractor
    from spotify_scraper.core.constants import PLAYLIST_JSON_PATH
    from spotify_scraper.parsers.json_parser import extract_json_from_next_data, extract_json_from_resource
except ImportError:
    SpotifyClient = None
    PlaylistExtractor = None
    logger = logging.getLogger(__name__)
    logger.error("spotify_scraper not found. Spotify playlist support will be unavailable in this build.")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

MAX_WORKERS = 6
YTDL_TIMEOUT = 20
LOCAL_AGENT_HOST = "127.0.0.1"
LOCAL_AGENT_PORT = 7777
WEB_APP_URL = os.environ.get("TORKTOOL_WEB_URL", "https://torktool.roftcore.work").rstrip("/")
ALLOWED_ORIGINS = [
    WEB_APP_URL,
    "http://localhost:7777",
    "http://127.0.0.1:7777",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

DOWNLOAD_JOBS = {}
DOWNLOAD_JOBS_LOCK = threading.Lock()

IS_WINDOWS = sys.platform.startswith("win")

if IS_WINDOWS:
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    WM_DESTROY = 0x0002
    WM_COMMAND = 0x0111
    WM_CLOSE = 0x0010
    WM_LBUTTONDOWN = 0x0201
    WM_NCLBUTTONDOWN = 0x00A1
    WS_OVERLAPPED = 0x00000000
    WS_CAPTION = 0x00C00000
    WS_POPUP = 0x80000000
    WS_BORDER = 0x00800000
    WS_SYSMENU = 0x00080000
    WS_MINIMIZEBOX = 0x00020000
    WS_VISIBLE = 0x10000000
    WS_CHILD = 0x40000000
    WS_TABSTOP = 0x00010000
    BS_PUSHBUTTON = 0x00000000
    SS_LEFT = 0x00000000
    CW_USEDEFAULT = 0x80000000
    SW_SHOW = 5
    SW_MINIMIZE = 6
    IDC_ARROW = 32512
    COLOR_WINDOW = 5
    BUTTON_OPEN_ID = 1001
    BUTTON_MINIMIZE_ID = 1002
    BUTTON_CLOSE_ID = 1003
    HTCAPTION = 2
else:
    user32 = None
    kernel32 = None

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": ALLOWED_ORIGINS}})


def _is_allowed_origin(origin):
    return bool(origin and origin in ALLOWED_ORIGINS)


@app.before_request
def handle_private_network_preflight():
    if request.method != "OPTIONS" or not request.path.startswith("/api/"):
        return None

    origin = request.headers.get("Origin")
    response = make_response("", 204)
    if _is_allowed_origin(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"

    response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = request.headers.get(
        "Access-Control-Request-Headers",
        "Content-Type, Authorization",
    )

    if request.headers.get("Access-Control-Request-Private-Network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"

    return response


@app.after_request
def add_private_network_headers(response):
    if not request.path.startswith("/api/"):
        return response

    origin = request.headers.get("Origin")
    if _is_allowed_origin(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"

    response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = request.headers.get(
        "Access-Control-Request-Headers",
        response.headers.get("Access-Control-Allow-Headers", "Content-Type, Authorization"),
    )

    if request.headers.get("Access-Control-Request-Private-Network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"

    return response


def resolve_frontend_entry():
    candidates = [
        BASE_DIR / "production" / "index.html",
        BASE_DIR / "dist" / "index.html",
        BASE_DIR / "template.html",
        BASE_DIR / "index.html",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate.parent, candidate.name
    return BASE_DIR, "template.html"


def resolve_production_static(path):
    production_dir = BASE_DIR / "production"
    production_path = production_dir / path
    if production_path.exists():
        return production_dir, path
    return BASE_DIR, path


def create_download_job(kind, title="", total_items=0):
    job_id = uuid.uuid4().hex
    with DOWNLOAD_JOBS_LOCK:
        DOWNLOAD_JOBS[job_id] = {
            "id": job_id,
            "kind": kind,
            "title": title,
            "status": "queued",
            "total_items": total_items,
            "completed_items": 0,
            "failed_items": 0,
            "filename": None,
            "error": None,
            "updated_at": time.time(),
        }
    return job_id


def update_download_job(job_id, **updates):
    with DOWNLOAD_JOBS_LOCK:
        job = DOWNLOAD_JOBS.get(job_id)
        if not job:
            return None
        job.update(updates)
        job["updated_at"] = time.time()
        return dict(job)


def increment_download_job(job_id, *, completed_delta=0, failed_delta=0, **updates):
    with DOWNLOAD_JOBS_LOCK:
        job = DOWNLOAD_JOBS.get(job_id)
        if not job:
            return None
        job["completed_items"] = max(0, job.get("completed_items", 0) + completed_delta)
        job["failed_items"] = max(0, job.get("failed_items", 0) + failed_delta)
        job.update(updates)
        job["updated_at"] = time.time()
        return dict(job)


def get_download_job(job_id):
    with DOWNLOAD_JOBS_LOCK:
        job = DOWNLOAD_JOBS.get(job_id)
        return dict(job) if job else None

class SystemSetup:
    @staticmethod
    def verify_ffmpeg():
        try:
            return subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=10).returncode == 0
        except Exception:
            return False

    @staticmethod
    def check_ffmpeg():
        if SystemSetup.verify_ffmpeg():
            return True
        logger.warning("FFmpeg no encontrado.")
        return False

class SpotifyDownloader:
    def __init__(self):
        self.ffmpeg_available = SystemSetup.check_ffmpeg()
        self.sp = SpotifyClient() if SpotifyClient else None
        self.playlist_parser = PlaylistExtractor(None) if PlaylistExtractor else None

    @staticmethod
    def clean_name(text):
        return text.translate(str.maketrans('\\/.:*?"<>|', "__________")).strip()

    @staticmethod
    def normalize_owner(owner):
        if isinstance(owner, dict):
            return owner.get("name") or owner.get("display_name") or owner.get("id") or "Unknown"
        if owner is None:
            return "Unknown"
        return str(owner)

    @staticmethod
    def _extract_playlist_id(url):
        path = urlparse(url).path.strip("/")
        parts = path.split("/")
        return parts[-1] if parts else url.split("/")[-1].split("?")[0]

    def _normalize_playlist_tracks(self, playlist_data):
        tracks = []
        raw_tracks = (playlist_data or {}).get("tracks") or []
        if isinstance(raw_tracks, dict):
            items = raw_tracks.get("items") or []
        else:
            items = raw_tracks
        for item in items:
            track = item.get("track") if isinstance(item, dict) and isinstance(item.get("track"), dict) else item
            if not isinstance(track, dict): continue
            name = track.get("name")
            artists = track.get("artists") or []
            if name and artists:
                tracks.append({
                    "name": name,
                    "artists": artists,
                    "duration_ms": track.get("duration_ms") or 0
                })
        return tracks

    def _find_youtube(self, track, artist, duration_seconds):
        query = f"{artist} - {track} official audio"
        options = {"quiet": True, "no_warnings": True, "extract_flat": True}
        try:
            with YoutubeDL(options) as ydl:
                result = ydl.extract_info(f"ytsearch1:{query}", download=False)
                if result.get("entries"):
                    return result["entries"][0]["url"]
        except Exception:
            pass
        return None

    @staticmethod
    def detect_spotify_type(url):
        path = urlparse(url).path.lower()
        if "/track/" in path:
            return "track"
        if "/playlist/" in path:
            return "playlist"
        return "unknown"

    def fetch_spotify_oembed(self, url):
        endpoint = f"https://open.spotify.com/oembed?url={url}"
        request_obj = Request(
            endpoint,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json",
            },
        )
        with urlopen(request_obj, timeout=YTDL_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))

    @staticmethod
    def parse_track_title(raw_title, author_name="Spotify"):
        title = (raw_title or "").strip()
        author = (author_name or "Spotify").strip() or "Spotify"
        if " - " in title:
            artist, track = title.split(" - ", 1)
            return {
                "name": track.strip() or title,
                "artist": artist.strip() or author,
            }
        return {
            "name": title or "Spotify Track",
            "artist": author,
        }

    def get_spotify_track_info(self, url):
        embed = self.fetch_spotify_oembed(url)
        parsed = self.parse_track_title(embed.get("title"), embed.get("author_name"))
        return {
            "success": True,
            "kind": "track",
            "name": parsed["name"],
            "owner": parsed["artist"],
            "total_tracks": 1,
            "tracks": [{
                "name": parsed["name"],
                "artists": [{"name": parsed["artist"]}],
                "duration_ms": 0,
            }],
            "image": embed.get("thumbnail_url"),
            "download_supported": True,
        }

    def queue_spotify_track_download(self, url, type_="mp3"):
        track_info = self.get_spotify_track_info(url)
        track = track_info["tracks"][0]
        track_name = track["name"]
        artist_name = track["artists"][0]["name"]
        safe_base_name = self.clean_name(f"{artist_name} - {track_name}")
        download_url = self._find_youtube(track_name, artist_name, 0)
        if not download_url:
            return False, "No se pudo encontrar una fuente en YouTube para esta pista."

        def run_track_download():
            folder = DOWNLOADS_DIR / f"temp_spotify_{int(time.time() * 1000)}"
            folder.mkdir(exist_ok=True)
            try:
                downloaded_file = self._download(download_url, folder, safe_base_name, type_)
                if not downloaded_file:
                    logger.error("Spotify track download failed for %s", url)
                    return
                zip_path = DOWNLOADS_DIR / f"{safe_base_name}.zip"
                with zipfile.ZipFile(zip_path, "w") as archive:
                    archive.write(downloaded_file, downloaded_file.name)
            finally:
                shutil.rmtree(folder, ignore_errors=True)

        threading.Thread(target=run_track_download, daemon=True).start()
        return True, f"{safe_base_name}.zip"

    def _download(self, url, path, filename, type_="mp3"):
        ext = "mp4" if type_ == "mp4" else "mp3"
        options = {
            "format": "bestvideo+bestaudio/best" if type_ == "mp4" else "bestaudio/best",
            "outtmpl": str(path / f"{filename}.%(ext)s"),
            "quiet": True,
        }
        if type_ == "mp3":
            options["postprocessors"] = [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }]
        try:
            with YoutubeDL(options) as ydl:
                ydl.download([url])
            return path / f"{filename}.{ext}"
        except Exception:
            return None

    async def download_playlist(self, url):
        if not self.sp: return None, "Spotify Client not available"
        try:
            playlist = self.sp.get_playlist_info(url)
            name = self.clean_name(playlist["name"])
            folder = DOWNLOADS_DIR / name
            folder.mkdir(exist_ok=True)
            tracks = self._normalize_playlist_tracks(playlist)
            
            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                loop = asyncio.get_event_loop()
                tasks = [loop.run_in_executor(executor, self._process_track, t, folder) for t in tracks]
                await asyncio.gather(*tasks)

            zip_path = DOWNLOADS_DIR / f"{name}.zip"
            with zipfile.ZipFile(zip_path, "w") as z:
                for f in folder.glob("*.mp3"):
                    z.write(f, f.name)
            shutil.rmtree(folder)
            return f"{name}.zip", None
        except Exception as e:
            return None, str(e)

    def _process_track(self, track, folder):
        name = self.clean_name(track["name"])
        artist = self.clean_name(", ".join(a["name"] for a in track["artists"]))
        filename = f"{artist} - {name}"
        url = self._find_youtube(name, artist, track["duration_ms"] // 1000)
        if url:
            return self._download(url, folder, filename, "mp3")
        return None

downloader = SpotifyDownloader()

# Static Routes
@app.route("/")
def index():
    directory, filename = resolve_frontend_entry()
    return send_from_directory(directory, filename)

@app.route("/<path:path>")
def serve_static(path):
    directory, filename = resolve_production_static(path)
    return send_from_directory(directory, filename)

@app.route("/api/status", methods=["GET"])
def status():
    return jsonify({
        "status": "online",
        "version": "1.0.0",
        "mode": "remote-bridge",
        "local_api": f"http://{LOCAL_AGENT_HOST}:{LOCAL_AGENT_PORT}",
        "web_app_url": WEB_APP_URL,
    })

@app.route("/api/playlist/info", methods=["POST"])
def playlist_info():
    data = request.json
    url = data.get("url")
    spotify_type = downloader.detect_spotify_type(url or "")
    if not url or spotify_type == "unknown":
        return jsonify({"success": False, "error": "Invalid Spotify URL"})
    if spotify_type == "track":
        try:
            return jsonify(downloader.get_spotify_track_info(url))
        except Exception as e:
            return jsonify({"success": False, "error": str(e)})
    if not downloader.sp:
        return jsonify({"success": False, "error": "Spotify playlist support is missing from this build"})
    try:
        info = downloader.sp.get_playlist_info(url)
        return jsonify({
            "success": True,
            "kind": "playlist",
            "name": info["name"],
            "owner": downloader.normalize_owner(info.get("owner", "Unknown")),
            "total_tracks": len(info.get("tracks", [])),
            "tracks": downloader._normalize_playlist_tracks(info)[:10],
            "image": info.get("images", [{}])[0].get("url"),
            "download_supported": True,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route("/api/playlist/download", methods=["POST"])
def playlist_download():
    data = request.json
    url = data.get("url")
    spotify_type = downloader.detect_spotify_type(url or "")
    if not url or spotify_type == "unknown":
        return jsonify({"success": False, "error": "Invalid Spotify URL"})
    if spotify_type == "track":
        success, result = downloader.queue_spotify_track_download(url)
        if not success:
            return jsonify({"success": False, "error": result})
        return jsonify({"success": True, "message": "Track download started in background."})
    if not downloader.sp:
        return jsonify({"success": False, "error": "Spotify playlist support is missing from this build"})
    
    def run_download():
        filename, error = asyncio.run(downloader.download_playlist(url))
        logger.info(f"Download finished: {filename} Error: {error}")

    threading.Thread(target=run_download).start()
    return jsonify({"success": True, "message": "Download started in background. Check 'Archivos' soon."})

@app.route("/api/files", methods=["POST", "GET"])
def list_files():
    files = []
    for f in DOWNLOADS_DIR.glob("*.zip"):
        size_mb = f.stat().st_size / (1024 * 1024)
        files.append({"name": f.name, "size": f"{size_mb:.1f} MB"})
    return jsonify({"success": True, "files": files, "key": ""})

@app.route("/api/download/<filename>")
def download_file(filename):
    return send_from_directory(DOWNLOADS_DIR, filename)

@app.route("/api/delete/<filename>", methods=["DELETE"])
def delete_file(filename):
    try:
        file_path = DOWNLOADS_DIR / filename
        if file_path.exists():
            file_path.unlink()
            return jsonify({"success": True})
        return jsonify({"success": False, "error": "File not found"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route("/api/url", methods=["POST"])
def download_yt_urls():
    data = request.json
    urls = data.get("urls", [])
    filename = data.get("filename", "download")
    type_ = data.get("type", "mp3")
    
    folder = DOWNLOADS_DIR / "temp_yt"
    folder.mkdir(exist_ok=True)
    
    def run_yt_download():
        for url in urls:
            downloader._download(url, folder, f"video_{hash(url)}", type_)
        zip_path = DOWNLOADS_DIR / f"{filename}.zip"
        with zipfile.ZipFile(zip_path, "w") as z:
            for f in folder.glob("*.*"):
                if f.suffix in [".mp3", ".mp4"]:
                    z.write(f, f.name)
        shutil.rmtree(folder)

    threading.Thread(target=run_yt_download).start()
    return jsonify({
        "success": True, 
        "title": filename, 
        "filename": f"{filename}.zip",
        "download_url": f"/api/download/{filename}.zip"
    })

def open_browser():
    # Wait for server to start and then open the hosted web app.
    time.sleep(1.5)
    webbrowser.open(WEB_APP_URL)

class LocalAgentServer:
    def __init__(self, flask_app):
        self.flask_app = flask_app
        self.server = None
        self.thread = None

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.server = make_server(LOCAL_AGENT_HOST, LOCAL_AGENT_PORT, self.flask_app, threaded=True)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.server = None
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2)


if IS_WINDOWS:
    from ctypes import wintypes

    HICON = wintypes.HANDLE
    HCURSOR = wintypes.HANDLE
    HBRUSH = wintypes.HANDLE
    WNDPROC = ctypes.WINFUNCTYPE(
        ctypes.c_long,
        wintypes.HWND,
        wintypes.UINT,
        wintypes.WPARAM,
        wintypes.LPARAM,
    )

    class WNDCLASS(ctypes.Structure):
        _fields_ = [
            ("style", wintypes.UINT),
            ("lpfnWndProc", WNDPROC),
            ("cbClsExtra", ctypes.c_int),
            ("cbWndExtra", ctypes.c_int),
            ("hInstance", wintypes.HINSTANCE),
            ("hIcon", HICON),
            ("hCursor", HCURSOR),
            ("hbrBackground", HBRUSH),
            ("lpszMenuName", wintypes.LPCWSTR),
            ("lpszClassName", wintypes.LPCWSTR),
        ]


    class MSG(ctypes.Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND),
            ("message", wintypes.UINT),
            ("wParam", wintypes.WPARAM),
            ("lParam", wintypes.LPARAM),
            ("time", wintypes.DWORD),
            ("pt_x", ctypes.c_long),
            ("pt_y", ctypes.c_long),
        ]


    class AgentWindow:
        TITLEBAR_HEIGHT = 38
        WINDOW_WIDTH = 360
        WINDOW_HEIGHT = 210

        def __init__(self, server):
            self.server = server
            self.h_instance = kernel32.GetModuleHandleW(None)
            self.class_name = "TorkToolAgentWindow"
            self.window_title = "TorkTool Agent"
            self._wnd_proc = WNDPROC(self._window_proc)
            self._register_class()
            self.hwnd = None

        def _register_class(self):
            wc = WNDCLASS()
            wc.lpfnWndProc = self._wnd_proc
            wc.hInstance = self.h_instance
            wc.lpszClassName = self.class_name
            wc.hCursor = user32.LoadCursorW(None, IDC_ARROW)
            wc.hbrBackground = ctypes.c_void_p(COLOR_WINDOW + 1)
            user32.RegisterClassW(ctypes.byref(wc))

        def _create_controls(self):
            title_y = 10
            body_top = self.TITLEBAR_HEIGHT + 18
            button_top = 4
            button_width = 32

            user32.CreateWindowExW(
                0,
                "STATIC",
                self.window_title,
                WS_CHILD | WS_VISIBLE | SS_LEFT,
                14,
                title_y,
                180,
                18,
                self.hwnd,
                None,
                self.h_instance,
                None,
            )
            user32.CreateWindowExW(
                0,
                "BUTTON",
                "_",
                WS_TABSTOP | WS_VISIBLE | WS_CHILD | BS_PUSHBUTTON,
                self.WINDOW_WIDTH - 86,
                button_top,
                button_width,
                28,
                self.hwnd,
                ctypes.c_void_p(BUTTON_MINIMIZE_ID),
                self.h_instance,
                None,
            )
            user32.CreateWindowExW(
                0,
                "BUTTON",
                "X",
                WS_TABSTOP | WS_VISIBLE | WS_CHILD | BS_PUSHBUTTON,
                self.WINDOW_WIDTH - 46,
                button_top,
                button_width,
                28,
                self.hwnd,
                ctypes.c_void_p(BUTTON_CLOSE_ID),
                self.h_instance,
                None,
            )
            user32.CreateWindowExW(
                0,
                "STATIC",
                "TorkTool Agent activo",
                WS_CHILD | WS_VISIBLE | SS_LEFT,
                20,
                body_top,
                260,
                22,
                self.hwnd,
                None,
                self.h_instance,
                None,
            )
            user32.CreateWindowExW(
                0,
                "STATIC",
                f"Backend local: http://{LOCAL_AGENT_HOST}:{LOCAL_AGENT_PORT}",
                WS_CHILD | WS_VISIBLE | SS_LEFT,
                20,
                body_top + 30,
                300,
                22,
                self.hwnd,
                None,
                self.h_instance,
                None,
            )
            user32.CreateWindowExW(
                0,
                "STATIC",
                "Cierra esta ventana para detener el agente.",
                WS_CHILD | WS_VISIBLE | SS_LEFT,
                20,
                body_top + 60,
                300,
                22,
                self.hwnd,
                None,
                self.h_instance,
                None,
            )
            user32.CreateWindowExW(
                0,
                "BUTTON",
                "Abrir web",
                WS_TABSTOP | WS_VISIBLE | WS_CHILD | BS_PUSHBUTTON,
                20,
                body_top + 98,
                110,
                30,
                self.hwnd,
                ctypes.c_void_p(BUTTON_OPEN_ID),
                self.h_instance,
                None,
            )

        @staticmethod
        def _get_mouse_pos(lparam):
            x = ctypes.c_short(lparam & 0xFFFF).value
            y = ctypes.c_short((lparam >> 16) & 0xFFFF).value
            return x, y

        def _window_proc(self, hwnd, msg, wparam, lparam):
            if msg == WM_COMMAND:
                button_id = wparam & 0xFFFF
                if button_id == BUTTON_OPEN_ID:
                    webbrowser.open(WEB_APP_URL)
                    return 0
                if button_id == BUTTON_MINIMIZE_ID:
                    user32.ShowWindow(hwnd, SW_MINIMIZE)
                    return 0
                if button_id == BUTTON_CLOSE_ID:
                    user32.SendMessageW(hwnd, WM_CLOSE, 0, 0)
                    return 0
            if msg == WM_LBUTTONDOWN:
                _, y = self._get_mouse_pos(lparam)
                if y <= self.TITLEBAR_HEIGHT:
                    user32.ReleaseCapture()
                    user32.SendMessageW(hwnd, WM_NCLBUTTONDOWN, HTCAPTION, 0)
                    return 0
            if msg == WM_CLOSE:
                self.server.stop()
                user32.DestroyWindow(hwnd)
                return 0
            if msg == WM_DESTROY:
                user32.PostQuitMessage(0)
                return 0
            return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

        def run(self):
            style = WS_POPUP | WS_BORDER | WS_SYSMENU | WS_MINIMIZEBOX | WS_VISIBLE
            self.hwnd = user32.CreateWindowExW(
                0,
                self.class_name,
                self.window_title,
                style,
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                self.WINDOW_WIDTH,
                self.WINDOW_HEIGHT,
                None,
                None,
                self.h_instance,
                None,
            )
            self._create_controls()
            user32.ShowWindow(self.hwnd, SW_SHOW)
            msg = MSG()
            while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
                user32.TranslateMessage(ctypes.byref(msg))
                user32.DispatchMessageW(ctypes.byref(msg))


def main():
    logger.info(
        "Starting TorkTool Local Agent on http://%s:%s for %s",
        LOCAL_AGENT_HOST,
        LOCAL_AGENT_PORT,
        WEB_APP_URL,
    )
    server = LocalAgentServer(app)
    server.start()

    if IS_WINDOWS:
        AgentWindow(server).run()
    else:
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            server.stop()


if __name__ == "__main__":
    main()
