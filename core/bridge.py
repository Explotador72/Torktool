import json
import ssl
import time
import threading
from typing import Optional, Dict, Any, Callable
from urllib.parse import urlparse
import websocket
from core.config import logger

class NetworkBridge:
    def __init__(self, backend_url, http_url="", auth_token=None):
        self.backend_url = backend_url
        self.http_url = http_url
        self.auth_token = auth_token
        self.ws = None
        self.ws_thread = None
        self.running = False
        self.connected = False
        self.last_error = None
        self.message_handlers = {}
        self.reconnect_interval = 5
        
        self.register_handler("status_update", self._handle_status_update)
        self.register_handler("operation_result", self._handle_operation_result)
        self.register_handler("error", self._handle_error)
    
    def register_handler(self, event_type, handler):
        self.message_handlers[event_type] = handler

    def _on_message(self, ws, message):
        try:
            data = json.loads(message)
            handler = self.message_handlers.get(data.get("type", "unknown"))
            if handler: handler(data)
        except Exception as e:
            logger.error(f"Error procesando mensaje WS: {e}")

    def _on_error(self, ws, error):
        self.last_error = str(error)
        logger.error(f"Error de WebSocket: {error}")
        self.connected = False
        if "Handshake status 200" in str(error):
            self.reconnect_interval = 30

    def _on_close(self, ws, status, msg):
        self.connected = False
        logger.info(f"Conexión WebSocket cerrada: {msg}")

    def _on_open(self, ws):
        self.connected = True
        self.reconnect_interval = 5
        logger.info("Conexión WebSocket establecida")
        if self.auth_token:
            self.ws.send(json.dumps({
                "type": "authenticate", "token": self.auth_token, "timestamp": int(time.time())
            }))

    def _handle_status_update(self, data): logger.info(f"Actualización de estado: {data.get('status')}")
    def _handle_operation_result(self, data): logger.info(f"Operación completada: {data.get('operation_id')}")
    def _handle_error(self, data): logger.error(f"Error del servidor: {data.get('error')}")

    def _start_ws_connection(self):
        if self.ws:
            try: self.ws.close()
            except: pass
        
        import certifi
        self.ws = websocket.WebSocketApp(
            self.backend_url, on_open=self._on_open, on_message=self._on_message,
            on_error=self._on_error, on_close=self._on_close
        )
        self.ws_thread = threading.Thread(
            target=self.ws.run_forever,
            kwargs={"sslopt": {"cert_reqs": ssl.CERT_REQUIRED, "ca_certs": certifi.where()},
                    "ping_interval": 30, "ping_timeout": 10},
            daemon=True
        )
        self.ws_thread.start()

    def start(self):
        self.running = True
        self._start_ws_connection()

    def stop(self):
        self.running = False
        self.connected = False
        if self.ws: self.ws.close()

    def send_operation(self, operation, data):
        if not self.connected: return False
        msg = {
            "type": "operation", "operation_id": f"op_{int(time.time()*1000)}",
            "operation": operation, "data": data, "timestamp": int(time.time()),
            "auth_token": self.auth_token
        }
        try:
            self.ws.send(json.dumps(msg))
            return True
        except: return False

    def get_status(self):
        return {"connected": self.connected, "last_error": self.last_error}

class BridgeService:
    def __init__(self, config=None):
        self.config = config or {}
        self.bridge = None
        self.running = False

    def start(self):
        if self.running: return
        self.running = True
        self.bridge = NetworkBridge(
            self.config.get("backend_url", "wss://torktool.roftcore.work"),
            auth_token=self.config.get("auth_token")
        )
        self.bridge.start()

    def stop(self):
        self.running = False
        if self.bridge: self.bridge.stop()

    def get_status(self):
        return self.bridge.get_status() if self.bridge else {"connected": False}

bridge_service = BridgeService()

def initialize_bridge(config=None):
    bridge_service.config = config or {}
    bridge_service.start()
    return bridge_service

def get_bridge_service():
    return bridge_service
