import os
import threading
from pathlib import Path
from core.config import logger, WORKING_DIR

# Optional imports for transcription
try:
    import whisper
except ImportError:
    whisper = None

class AudioTranscriber:
    def __init__(self):
        self.model = None
        self._loading = False

    def is_available(self):
        return whisper is not None

    def _load_model(self):
        if self.model is None and not self._loading:
            self._loading = True
            try:
                logger.info("Cargando modelo Whisper (base)... esto puede tardar la primera vez.")
                # We use 'base' as it's a good balance between speed and accuracy for desktop
                self.model = whisper.load_model("base")
                logger.info("Modelo Whisper cargado correctamente.")
            except Exception as e:
                logger.error(f"Error cargando Whisper: {e}")
            finally:
                self._loading = False

    def transcribe(self, file_path):
        if not self.is_available():
            return "Error: la transcripción no está disponible en este build."
        
        if self.model is None:
            self._load_model()
            
        if self.model is None:
            return "Error: No se pudo cargar el modelo de transcripción."

        try:
            logger.info(f"Iniciando transcripción de: {file_path}")
            result = self.model.transcribe(str(file_path))
            return result.get("text", "").strip()
        except Exception as e:
            logger.error(f"Error durante la transcripción: {e}")
            return f"Error en la transcripción: {str(e)}"

transcriber = AudioTranscriber()
