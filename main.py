import asyncio
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
import zipfile
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen

from flask import Flask, request, jsonify, send_from_directory, make_response
from flask_cors import CORS
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
    logger.error("spotify_scraper not found. Spotify functionality will be limited.")

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
    if not url or not downloader.sp:
        return jsonify({"success": False, "error": "Invalid URL or Spotify not available"})
    try:
        info = downloader.sp.get_playlist_info(url)
        return jsonify({
            "success": True,
            "name": info["name"],
            "owner": info.get("owner", "Unknown"),
            "total_tracks": len(info.get("tracks", [])),
            "tracks": downloader._normalize_playlist_tracks(info)[:10],
            "image": info.get("images", [{}])[0].get("url")
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route("/api/playlist/download", methods=["POST"])
def playlist_download():
    data = request.json
    url = data.get("url")
    
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

if __name__ == "__main__":
    print(
        f"Starting TorkTool Local Agent on http://{LOCAL_AGENT_HOST}:{LOCAL_AGENT_PORT} "
        f"for {WEB_APP_URL}"
    )
    threading.Thread(target=open_browser, daemon=True).start()
    app.run(host=LOCAL_AGENT_HOST, port=LOCAL_AGENT_PORT)
