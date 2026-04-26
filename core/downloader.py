import asyncio
import json
import shutil
import threading
import time
import zipfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from yt_dlp import YoutubeDL
from core.config import logger, DOWNLOADS_DIR, MAX_WORKERS
from core.security import clean_text_name, validate_spotify_url

# Global progress tracker
PROGRESS_TRACKER = {}
JOB_TRACKER = {}

# Spotify Scraper Imports
try:
    from spotify_scraper import SpotifyClient
    from spotify_scraper.extractors.playlist import PlaylistExtractor
except ImportError:
    SpotifyClient = None
    PlaylistExtractor = None

class SpotifyDownloader:
    def __init__(self):
        from core.system import SystemSetup
        self.ffmpeg_available = SystemSetup.check_ffmpeg()
        self.sp = SpotifyClient() if SpotifyClient else None
        self.playlist_parser = PlaylistExtractor(None) if PlaylistExtractor else None

    def _normalize_playlist_tracks(self, playlist_data):
        tracks = []
        raw_tracks = (playlist_data or {}).get("tracks") or []
        items = raw_tracks.get("items") or [] if isinstance(raw_tracks, dict) else raw_tracks
        for item in items:
            track = item.get("track") if isinstance(item, dict) and isinstance(item.get("track"), dict) else item
            if not isinstance(track, dict): continue
            name = track.get("name")
            artists = track.get("artists") or []
            if name and artists:
                tracks.append({"name": name, "artists": artists, "duration_ms": track.get("duration_ms") or 0})
        return tracks

    def normalize_owner(self, owner):
        if not owner:
            return "Spotify"
        if isinstance(owner, str):
            return owner.strip() or "Spotify"
        if isinstance(owner, dict):
            for key in ("display_name", "name", "username"):
                value = owner.get(key)
                if value:
                    return str(value).strip() or "Spotify"
        return str(owner).strip() or "Spotify"

    def _find_youtube(self, track, artist, duration_seconds):
        query = f"{artist} - {track} official audio"
        options = {"quiet": True, "no_warnings": True, "extract_flat": True}
        try:
            with YoutubeDL(options) as ydl:
                result = ydl.extract_info(f"ytsearch1:{query}", download=False)
                if result.get("entries"): return result["entries"][0]["url"]
        except: pass
        return None

    def _download(self, url, path, filename, type_="mp3", progress_callback=None):
        ext = "mp4" if type_ == "mp4" else "mp3"
        last_percent = {"value": 0}

        def hook(data):
            if not progress_callback:
                return
            if data.get("status") == "downloading":
                percent = data.get("percent_str")
                if percent:
                    try:
                        parsed = int(float(percent.replace("%", "").strip()))
                    except Exception:
                        parsed = last_percent["value"]
                else:
                    parsed = last_percent["value"]
                last_percent["value"] = parsed
                progress_callback(parsed, data.get("downloaded_bytes", 0), data.get("total_bytes", 0))
            elif data.get("status") == "finished":
                progress_callback(100, data.get("downloaded_bytes", 0), data.get("total_bytes", 0))

        options = {
            "format": "bestvideo+bestaudio/best" if type_ == "mp4" else "bestaudio/best",
            "outtmpl": str(path / f"{filename}.%(ext)s"),
            "quiet": True,
            "progress_hooks": [hook] if progress_callback else [],
        }
        if type_ == "mp3":
            options["postprocessors"] = [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }]
        try:
            with YoutubeDL(options) as ydl: ydl.download([url])
            return path / f"{filename}.{ext}"
        except: return None

    async def download_playlist(self, url, progress_callback=None):
        if not self.sp: return None, "Spotify Client no disponible"
        try:
            playlist = self.sp.get_playlist_info(url)
            name = clean_text_name(playlist["name"])
            folder = DOWNLOADS_DIR / name
            folder.mkdir(exist_ok=True)
            tracks = self._normalize_playlist_tracks(playlist)
            total = len(tracks)
            completed = 0

            if total == 0:
                return None, "La playlist no contiene pistas válidas"
            
            def report_progress(count):
                if progress_callback:
                    percent = int((count / total) * 100)
                    progress_callback(percent, count, total)

            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                loop = asyncio.get_event_loop()
                tasks = [
                    loop.run_in_executor(executor, self._process_track, index, track, folder, total)
                    for index, track in enumerate(tracks, start=1)
                ]
                for future in asyncio.as_completed(tasks):
                    try:
                        await future
                    except Exception as e:
                        logger.error(f"Error descargando pista: {e}")
                    completed += 1
                    report_progress(completed)

            zip_path = DOWNLOADS_DIR / f"{name}.zip"
            with zipfile.ZipFile(zip_path, "w") as z:
                for f in folder.glob("*.mp3"): z.write(f, f.name)
            shutil.rmtree(folder)
            return f"{name}.zip", None
        except Exception as e:
            return None, str(e)

    def _process_track(self, index, track, folder, total=None):
        name = clean_text_name(track["name"])
        artist = clean_text_name(", ".join(a["name"] for a in track["artists"]))
        prefix = f"{index:02d}" if total else str(index)
        filename = f"{prefix} - {artist} - {name}"
        url = self._find_youtube(name, artist, track["duration_ms"] // 1000)
        if url: return self._download(url, folder, filename, "mp3")
        return None

    def get_track_info(self, url):
        endpoint = f"https://open.spotify.com/oembed?url={url}"
        req = Request(endpoint, headers={"User-Agent": "Mozilla/5.0"})
        with urlopen(req) as res:
            embed = json.loads(res.read().decode("utf-8"))
            title = embed.get("title", "")
            artist = embed.get("author_name", "Spotify")
            if " - " in title:
                artist_p, name_p = title.split(" - ", 1)
                name, artist = name_p.strip(), artist_p.strip()
            else:
                name = title
            
            return {
                "success": True, "kind": "track", "name": name, "owner": artist,
                "total_tracks": 1, "image": embed.get("thumbnail_url"),
                "download_supported": True,
                "tracks": [{"name": name, "artists": [{"name": artist}], "duration_ms": 0}]
            }

    def download_urls(self, urls, filename, type_="mp3"):
        if not urls:
            return None, "No se proporcionaron URLs"

        safe_filename = clean_text_name(filename)
        if not safe_filename:
            safe_filename = f"torktool_{int(time.time())}"

        output_dir = DOWNLOADS_DIR
        options = {
            "format": "bestvideo+bestaudio/best" if type_ == "mp4" else "bestaudio/best",
            "outtmpl": str(output_dir / f"{safe_filename}.%(ext)s"),
            "quiet": True,
            "noplaylist": False,
        }

        if type_ == "mp3":
            options["postprocessors"] = [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }]

        try:
            with YoutubeDL(options) as ydl:
                ydl.download(urls)

            ext = "mp4" if type_ == "mp4" else "mp3"
            final_path = output_dir / f"{safe_filename}.{ext}"
            if final_path.exists():
                return final_path.name, None

            candidates = sorted(output_dir.glob(f"{safe_filename}.*"), key=lambda p: p.stat().st_mtime, reverse=True)
            if candidates:
                return candidates[0].name, None

            return None, "No se pudo generar el archivo de salida"
        except Exception as e:
            return None, str(e)

    def download_urls_with_progress(self, urls, filename, type_="mp3", progress_callback=None):
        if not urls:
            return None, "No se proporcionaron URLs"

        safe_filename = clean_text_name(filename)
        if not safe_filename:
            safe_filename = f"torktool_{int(time.time())}"

        output_dir = DOWNLOADS_DIR
        last_reported = {"value": 0}

        def hook(data):
            if not progress_callback:
                return
            if data.get("status") == "downloading":
                percent = data.get("_percent_str") or data.get("percent_str")
                if percent:
                    try:
                        parsed = int(float(str(percent).replace("%", "").strip()))
                    except Exception:
                        parsed = last_reported["value"]
                else:
                    parsed = last_reported["value"]
                last_reported["value"] = parsed
                progress_callback(parsed, data.get("downloaded_bytes", 0), data.get("total_bytes", 0))
            elif data.get("status") == "finished":
                progress_callback(100, data.get("downloaded_bytes", 0), data.get("total_bytes", 0))

        options = {
            "format": "bestvideo+bestaudio/best" if type_ == "mp4" else "bestaudio/best",
            "outtmpl": str(output_dir / f"{safe_filename}.%(ext)s"),
            "quiet": True,
            "noplaylist": False,
            "progress_hooks": [hook] if progress_callback else [],
        }

        if type_ == "mp3":
            options["postprocessors"] = [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }]

        try:
            with YoutubeDL(options) as ydl:
                ydl.download(urls)

            ext = "mp4" if type_ == "mp4" else "mp3"
            final_path = output_dir / f"{safe_filename}.{ext}"
            if final_path.exists():
                return final_path.name, None

            candidates = sorted(output_dir.glob(f"{safe_filename}.*"), key=lambda p: p.stat().st_mtime, reverse=True)
            if candidates:
                return candidates[0].name, None

            return None, "No se pudo generar el archivo de salida"
        except Exception as e:
            return None, str(e)

downloader = SpotifyDownloader()

def create_job(job_type, payload):
    job_id = uuid.uuid4().hex
    JOB_TRACKER[job_id] = {
        "job_id": job_id,
        "type": job_type,
        "status": "starting",
        "percent": 0,
        "current": 0,
        "total": 0,
        **payload,
    }
    return job_id

def update_job(job_id, **fields):
    if job_id in JOB_TRACKER:
        JOB_TRACKER[job_id].update(fields)

def get_job(job_id):
    return JOB_TRACKER.get(job_id)

def start_download_process(url):
    from core.bridge import get_bridge_service
    spotify_type = validate_spotify_url(url)
    if not url or spotify_type == "unknown": return False, "URL de Spotify no válida"

    job_id = create_job("spotify", {"url": url})
    PROGRESS_TRACKER[url] = {"percent": 0, "current": 0, "total": 0, "status": "starting", "job_id": job_id}
    bridge = get_bridge_service()

    def progress_callback(percent, current, total):
        PROGRESS_TRACKER[url] = {"percent": percent, "current": current, "total": total, "status": "downloading"}
        update_job(job_id, percent=percent, current=current, total=total, status="downloading")
        if bridge and bridge.bridge and bridge.bridge.connected:
            bridge.bridge.send_operation("download_progress", {"url": url, "percent": percent, "current": current, "total": total})

    def run_download():
        filename, error = asyncio.run(downloader.download_playlist(url, progress_callback))
        if error:
            PROGRESS_TRACKER[url] = {"status": "error", "error": error}
            update_job(job_id, status="error", error=error)
        else:
            PROGRESS_TRACKER[url] = {"percent": 100, "status": "finished", "filename": filename}
            update_job(job_id, percent=100, status="finished", filename=filename)
        
        if bridge and bridge.bridge and bridge.bridge.connected:
            bridge.bridge.send_operation("operation_result", {
                "operation": "download_playlist", "url": url, "success": not error,
                "filename": filename, "error": error
            })

    threading.Thread(target=run_download, daemon=True).start()
    return True, {"job_id": job_id, "message": "Descarga iniciada en segundo plano."}

def start_youtube_download_process(urls, filename, type_="mp3"):
    job_id = create_job("youtube", {"urls": urls, "filename": filename, "type": type_})

    def progress_callback(percent, current, total):
        update_job(job_id, percent=percent, current=current, total=total, status="downloading")

    def run_download():
        update_job(job_id, status="downloading", percent=0)
        saved_name, error = downloader.download_urls_with_progress(urls, filename, type_, progress_callback)
        if error:
            update_job(job_id, status="error", error=error)
        else:
            update_job(job_id, percent=100, status="finished", filename=saved_name, download_url=f"/api/download/{saved_name}")

    threading.Thread(target=run_download, daemon=True).start()
    return True, {"job_id": job_id, "message": "Descarga iniciada en segundo plano."}
