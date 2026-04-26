import subprocess
from core.config import logger

class SystemSetup:
    @staticmethod
    def verify_ffmpeg():
        try:
            # check ffmpeg version to verify existence
            return subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=10).returncode == 0
        except:
            return False

    @staticmethod
    def check_ffmpeg():
        if SystemSetup.verify_ffmpeg():
            return True
        logger.warning("FFmpeg no encontrado en el sistema.")
        return False
