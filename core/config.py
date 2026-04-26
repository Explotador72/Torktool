import os
import sys
import logging
from pathlib import Path

# Base Paths
if getattr(sys, 'frozen', False):
    BASE_DIR = Path(sys._MEIPASS)
    APP_DIR = Path(sys.executable).resolve().parent
else:
    BASE_DIR = Path(__file__).parent.parent
    APP_DIR = BASE_DIR

# User directories
WORKING_DIR = APP_DIR
DOWNLOADS_DIR = WORKING_DIR / "Downloads_playlists"
DOWNLOADS_DIR.mkdir(exist_ok=True)

# Log Configuration
LOG_FILE = WORKING_DIR / "torktool.log"

def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(LOG_FILE, mode="a", encoding="utf-8")
        ]
    )
    return logging.getLogger("TorkTool")

logger = setup_logging()

# Server Constants
MAX_WORKERS = 6
LOCAL_AGENT_HOST = "127.0.0.1"
LOCAL_AGENT_PORT = 7777
WEB_APP_URL = os.environ.get("TORKTOOL_WEB_URL", "https://torktool.roftcore.work").rstrip("/")

# Dev Mode Support
DEV_URL = os.environ.get("TORKTOOL_DEV_URL")
if DEV_URL:
    WEB_APP_URL = DEV_URL.rstrip("/")
    logger.info(f"Modo Desarrollo Activo: {WEB_APP_URL}")

ALLOWED_ORIGINS = [
    WEB_APP_URL,
    f"http://{LOCAL_AGENT_HOST}:{LOCAL_AGENT_PORT}",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:4200",
]
