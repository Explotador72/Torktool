import re
import ipaddress
from urllib.parse import urlparse
from flask import request, make_response
from werkzeug.utils import secure_filename
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from core.config import DOWNLOADS_DIR, ALLOWED_ORIGINS, logger

def init_limiter(app):
    return Limiter(
        get_remote_address,
        app=app,
        default_limits=["200 per day", "50 per hour"],
        storage_uri="memory://",
    )

def is_allowed_origin(origin):
    if not origin: return False
    if origin in ALLOWED_ORIGINS: return True
    try:
        parsed = urlparse(origin)
        if parsed.hostname in ["localhost", "127.0.0.1", "::1"]:
            return True
        if parsed.hostname:
            try:
                ip = ipaddress.ip_address(parsed.hostname)
                if ip.is_private or ip.is_loopback or ip.is_link_local:
                    return True
            except ValueError:
                pass
    except:
        pass
    return False

def safe_path_resolve(filename):
    if not filename or not isinstance(filename, str): return None
    s_filename = secure_filename(filename)
    if not s_filename: return None
    
    dangerous_patterns = ['..', './', '.\\', '\\', '/', '%2e', '%2f']
    for pattern in dangerous_patterns:
        if pattern in filename.lower(): return None
        
    try:
        target_path = (DOWNLOADS_DIR / s_filename).resolve()
        if not str(target_path).startswith(str(DOWNLOADS_DIR.resolve())):
            return None
        if target_path.is_dir(): return None
        return target_path
    except:
        return None

def apply_cors_headers(response):
    origin = request.headers.get("Origin")
    if is_allowed_origin(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Client-Type"

    if request.headers.get("Access-Control-Request-Private-Network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

def clean_text_name(text):
    if not text: return "unnamed"
    cleaned = re.sub(r'[^a-zA-Z0-9 \.\-_]', '_', text).strip()
    return cleaned or "unnamed"

def validate_spotify_url(url):
    if not url: return "unknown"
    parsed = urlparse(url)
    if parsed.netloc not in ["open.spotify.com", "spotify.com"]:
        return "unknown"
    path = parsed.path.lower()
    if "/track/" in path: return "track"
    if "/playlist/" in path: return "playlist"
    return "unknown"
