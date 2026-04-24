"""
Network Bridge Module for TorkTool
Provides persistent WebSocket/HTTP connection to web backend
"""

import json
import logging
import ssl
import time
import threading
from typing import Optional, Dict, Any, Callable
from urllib.parse import urlparse
import websocket  # pip install websocket-client


class NetworkBridge:
    """
    Network bridge that maintains persistent connection to web backend
    and forwards local operations to web API
    """
    
    def __init__(
        self,
        backend_url: str = "wss://torktool.roftcore.work",
        http_url: str = "https://torktool.roftcore.work",
        auth_token: Optional[str] = None,
        reconnect_interval: int = 5,
        max_reconnect_attempts: int = 10,
    ):
        self.backend_url = backend_url
        self.http_url = http_url
        self.auth_token = auth_token or self._get_auth_token()
        self.reconnect_interval = reconnect_interval
        self.max_reconnect_attempts = max_reconnect_attempts
        self.ws: Optional[websocket.WebSocketApp] = None
        self.ws_thread: Optional[threading.Thread] = None
        self.running = False
        self.connected = False
        self.last_error: Optional[str] = None
        self.message_handlers: Dict[str, Callable] = {}
        self.logger = logging.getLogger(__name__)
        
        # Register default handlers
        self.register_handler("status_update", self._handle_status_update)
        self.register_handler("operation_result", self._handle_operation_result)
        self.register_handler("error", self._handle_error)
        
    def _get_auth_token(self) -> Optional[str]:
        """Try to get auth token from environment or config"""
        import os
        token = os.environ.get("TORKTOOL_AUTH_TOKEN")
        if not token:
            # Try to read from config file
            try:
                config_path = Path(__file__).parent.parent / "config.json"
                if config_path.exists():
                    with open(config_path) as f:
                        config = json.load(f)
                        token = config.get("auth_token")
            except Exception:
                pass
        return token
    
    def register_handler(self, event_type: str, handler: Callable):
        """Register a handler for specific event types"""
        self.message_handlers[event_type] = handler
    
    def _on_message(self, ws, message: str):
        """Handle incoming WebSocket messages"""
        try:
            data = json.loads(message)
            event_type = data.get("type", "unknown")
            handler = self.message_handlers.get(event_type)
            if handler:
                handler(data)
            else:
                self.logger.warning(f"No handler registered for event: {event_type}")
        except json.JSONDecodeError as e:
            self.logger.error(f"Failed to parse message: {e}")
        except Exception as e:
            self.logger.error(f"Error handling message: {e}")
    
    def _on_error(self, ws, error):
        """Handle WebSocket errors"""
        self.last_error = str(error)
        self.logger.error(f"WebSocket error: {error}")
        self.connected = False
    
    def _on_close(self, ws, close_status_code, close_msg):
        """Handle WebSocket close"""
        self.connected = False
        self.logger.info("WebSocket connection closed")
        if self.running:
            self._reconnect()
    
    def _on_open(self, ws):
        """Handle WebSocket open connection"""
        self.connected = True
        self.last_error = None
        self.logger.info("WebSocket connection established")
        
        # Send authentication if token exists
        if self.auth_token:
            self._authenticate()
    
    def _authenticate(self):
        """Send authentication message to server"""
        auth_msg = {
            "type": "authenticate",
            "token": self.auth_token,
            "timestamp": int(time.time()),
        }
        try:
            self.ws.send(json.dumps(auth_msg))
            self.logger.info("Authentication message sent")
        except Exception as e:
            self.logger.error(f"Authentication failed: {e}")
    
    def _handle_status_update(self, data: Dict[str, Any]):
        """Handle status update from server"""
        self.logger.info(f"Status update: {data.get('status')}")
    
    def _handle_operation_result(self, data: Dict[str, Any]):
        """Handle operation result from server"""
        operation_id = data.get("operation_id")
        result = data.get("result")
        self.logger.info(f"Operation {operation_id} completed: {result}")
    
    def _handle_error(self, data: Dict[str, Any]):
        """Handle error from server"""
        error_msg = data.get("error", "Unknown error")
        self.logger.error(f"Server error: {error_msg}")
    
    def _reconnect(self):
        """Attempt to reconnect with exponential backoff"""
        attempt = 0
        while attempt < self.max_reconnect_attempts and self.running:
            try:
                self.logger.info(f"Reconnecting... attempt {attempt + 1}")
                time.sleep(self.reconnect_interval * (2 ** attempt))
                self._start_ws_connection()
                if self.connected:
                    self.logger.info("Reconnection successful")
                    return True
                attempt += 1
            except Exception as e:
                self.logger.error(f"Reconnection attempt {attempt + 1} failed: {e}")
                attempt += 1
        
        self.logger.error("Maximum reconnection attempts reached")
        return False
    
    def _start_ws_connection(self):
        """Start WebSocket connection"""
        # Configure SSL context
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = True
        ssl_context.verify_mode = ssl.CERT_REQUIRED
        
        # For development, you might want to disable verification
        # ssl_context.check_hostname = False
        # ssl_context.verify_mode = ssl.CERT_NONE
        
        self.ws = websocket.WebSocketApp(
            self.backend_url,
            on_open=self._on_open,
            on_message=self._on_message,
            on_error=self._on_error,
            on_close=self._on_close,
        )
        
        # Run WebSocket in a separate thread
        self.ws_thread = threading.Thread(
            target=self.ws.run_forever,
            kwargs={
                "sslopt": {"cert_reqs": ssl.CERT_REQUIRED, "ca_certs": self._get_ca_cert()},
                "ping_interval": 30,
                "ping_timeout": 10,
            },
            daemon=True,
        )
        self.ws_thread.start()
    
    def _get_ca_cert(self) -> Optional[str]:
        """Get path to CA certificate bundle"""
        # Try common locations
        cert_paths = [
            "/etc/ssl/certs/ca-certificates.crt",  # Debian/Ubuntu
            "/etc/pki/tls/certs/ca-bundle.trust.crt",  # RHEL/CentOS
            "/usr/local/etc/openssl/cert.pem",  # macOS with Homebrew
        ]
        
        for path in cert_paths:
            import os
            if os.path.exists(path):
                return path
        return None
    
    def start(self):
        """Start the network bridge"""
        if self.running:
            self.logger.warning("Bridge is already running")
            return
        
        self.running = True
        self.logger.info("Starting network bridge...")
        self._start_ws_connection()
    
    def stop(self):
        """Stop the network bridge"""
        self.running = False
        self.connected = False
        if self.ws:
            self.ws.close()
        self.logger.info("Network bridge stopped")
    
    def send_operation(
        self,
        operation: str,
        data: Dict[str, Any],
        callback: Optional[Callable] = None,
    ) -> bool:
        """
        Send an operation to the backend
        
        Args:
            operation: Operation type (e.g., "download_playlist", "delete_file")
            data: Operation data
            callback: Optional callback for operation result
        
        Returns:
            bool: True if operation was sent successfully
        """
        if not self.connected:
            self.logger.warning("Not connected to backend")
            if callback:
                callback({"success": False, "error": "Not connected"})
            return False
        
        operation_id = f"op_{int(time.time() * 1000)}"
        message = {
            "type": "operation",
            "operation_id": operation_id,
            "operation": operation,
            "data": data,
            "timestamp": int(time.time()),
            "auth_token": self.auth_token,
        }
        
        try:
            self.ws.send(json.dumps(message))
            self.logger.info(f"Operation {operation} sent (ID: {operation_id})")
            
            if callback:
                # Store callback for when result comes back
                self.message_handlers[operation_id] = callback
            
            return True
        except Exception as e:
            self.logger.error(f"Failed to send operation: {e}")
            if callback:
                callback({"success": False, "error": str(e)})
            return False
    
    def get_status(self) -> Dict[str, Any]:
        """Get current bridge status"""
        return {
            "connected": self.connected,
            "backend_url": self.backend_url,
            "auth_token_present": bool(self.auth_token),
            "last_error": self.last_error,
            "reconnect_interval": self.reconnect_interval,
        }


class HttpBridge:
    """
    HTTP-based bridge for operations that don't require real-time updates
    """
    
    def __init__(self, base_url: str, auth_token: Optional[str] = None):
        self.base_url = base_url
        self.auth_token = auth_token or self._get_auth_token()
        self.session = self._create_session()
        self.logger = logging.getLogger(__name__)
    
    def _get_auth_token(self) -> Optional[str]:
        """Try to get auth token from environment"""
        import os
        return os.environ.get("TORKTOOL_AUTH_TOKEN")
    
    def _create_session(self):
        """Create HTTP session with proper SSL context"""
        import requests
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry
        
        session = requests.Session()
        
        # Configure SSL context
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = True
        ssl_context.verify_mode = ssl.CERT_REQUIRED
        
        # Mount adapter with retry strategy
        retry_strategy = Retry(
            total=3,
            status_forcelist=[429, 500, 502, 503, 504],
            method_whitelist=["HEAD", "GET", "OPTIONS", "POST"],
            backoff_factor=1,
        )
        adapter = HTTPAdapter(max_retries=retry_strategy, pool_connections=10, pool_maxsize=20)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        
        # Set headers
        session.headers.update({
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
        
        return session
    
    def _make_request(self, method: str, endpoint: str, **kwargs):
        """Make HTTP request with authentication"""
        url = f"{self.base_url}{endpoint}"
        
        headers = kwargs.get("headers", {})
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        headers["X-Client-Type"] = "TorkTool-Desktop"
        kwargs["headers"] = headers
        
        try:
            response = self.session.request(method, url, **kwargs)
            response.raise_for_status()
            return response
        except requests.exceptions.RequestException as e:
            self.logger.error(f"HTTP request failed: {e}")
            if hasattr(e, "response") and e.response:
                self.logger.error(f"Response status: {e.response.status_code}")
                self.logger.error(f"Response body: {e.response.text}")
            raise
    
    def get(self, endpoint: str, **kwargs):
        """Make GET request"""
        return self._make_request("GET", endpoint, **kwargs)
    
    def post(self, endpoint: str, data: Optional[Dict] = None, **kwargs):
        """Make POST request"""
        kwargs.setdefault("json", data)
        return self._make_request("POST", endpoint, **kwargs)
    
    def put(self, endpoint: str, data: Optional[Dict] = None, **kwargs):
        """Make PUT request"""
        kwargs.setdefault("json", data)
        return self._make_request("PUT", endpoint, **kwargs)
    
    def delete(self, endpoint: str, **kwargs):
        """Make DELETE request"""
        return self._make_request("DELETE", endpoint, **kwargs)
    
    def authenticate(self) -> bool:
        """Test authentication with the backend"""
        try:
            response = self.get("/api/status")
            return response.status_code == 200
        except Exception as e:
            self.logger.error(f"Authentication failed: {e}")
            return False


class BridgeService:
    """
    Bridge service that runs in background thread
    Integrates with existing Flask app
    """
    
    def __init__(self, config: Optional[Dict] = None):
        self.config = config or {}
        self.bridge: Optional[NetworkBridge] = None
        self.http_bridge: Optional[HttpBridge] = None
        self.thread: Optional[threading.Thread] = None
        self.running = False
        self.logger = logging.getLogger(__name__)
    
    def start(self):
        """Start the bridge service"""
        if self.running:
            self.logger.warning("Bridge service already running")
            return
        
        self.running = True
        self.logger.info("Starting bridge service...")
        
        # Initialize bridges
        backend_url = self.config.get(
            "backend_url", 
            "wss://torktool.roftcore.work"
        )
        http_url = self.config.get(
            "http_url",
            "https://torktool.roftcore.work"
        )
        auth_token = self.config.get("auth_token")
        
        self.bridge = NetworkBridge(
            backend_url=backend_url,
            auth_token=auth_token,
        )
        
        self.http_bridge = HttpBridge(
            base_url=http_url,
            auth_token=auth_token,
        )
        
        # Start WebSocket connection in background thread
        self.thread = threading.Thread(
            target=self._run_bridge,
            daemon=True,
        )
        self.thread.start()
        
        self.logger.info("Bridge service started successfully")
    
    def _run_bridge(self):
        """Main bridge loop"""
        self.bridge.start()
        
        while self.running:
            try:
                # Check connection status
                status = self.bridge.get_status()
                if not status["connected"] and status["last_error"]:
                    self.logger.warning(f"Connection lost: {status['last_error']}")
                
                time.sleep(10)  # Check every 10 seconds
            except Exception as e:
                self.logger.error(f"Bridge loop error: {e}")
                time.sleep(5)
        
        self.bridge.stop()
    
    def stop(self):
        """Stop the bridge service"""
        self.running = False
        if self.bridge:
            self.bridge.stop()
        self.logger.info("Bridge service stopped")
    
    def send_playlist_download(self, url: str, callback=None):
        """Send playlist download operation"""
        if not self.bridge or not self.bridge.connected:
            self.logger.warning("Bridge not connected, using HTTP fallback")
            return self._http_playlist_download(url)
        
        return self.bridge.send_operation(
            "download_playlist",
            {"url": url},
            callback=callback,
        )
    
    def _http_playlist_download(self, url: str):
        """Fallback HTTP implementation for playlist download"""
        try:
            response = self.http_bridge.post(
                "/api/playlist/download",
                {"url": url},
            )
            return response.json()
        except Exception as e:
            self.logger.error(f"HTTP fallback failed: {e}")
            return {"success": False, "error": str(e)}
    
    def send_file_operation(
        self,
        operation: str,
        file_data: Dict[str, Any],
        callback=None,
    ):
        """Send file management operation"""
        if not self.bridge or not self.bridge.connected:
            self.logger.warning("Bridge not connected, using HTTP fallback")
            return self._http_file_operation(operation, file_data)
        
        return self.bridge.send_operation(
            f"file_{operation}",
            file_data,
            callback=callback,
        )
    
    def _http_file_operation(self, operation: str, data: Dict[str, Any]):
        """Fallback HTTP implementation for file operations"""
        try:
            if operation == "delete":
                response = self.http_bridge.delete(
                    f"/api/delete/{data['filename']}"
                )
            elif operation == "list":
                response = self.http_bridge.get("/api/files")
            else:
                raise ValueError(f"Unknown operation: {operation}")
            
            return response.json()
        except Exception as e:
            self.logger.error(f"HTTP fallback failed: {e}")
            return {"success": False, "error": str(e)}
    
    def get_status(self) -> Dict[str, Any]:
        """Get bridge service status"""
        if not self.bridge:
            return {"running": self.running, "connected": False}
        
        return {
            "running": self.running,
            "connected": self.bridge.connected,
            "status": self.bridge.get_status(),
        }


# Global bridge service instance
bridge_service = BridgeService()


def initialize_bridge(config: Optional[Dict] = None):
    """Initialize the network bridge service"""
    bridge_service.start()
    return bridge_service


def get_bridge_service() -> BridgeService:
    """Get the global bridge service instance"""
    return bridge_service


if __name__ == "__main__":
    # Test the bridge
    import os
    from pathlib import Path
    
    # Initialize bridge with test configuration
    bridge = initialize_bridge({
        "backend_url": os.environ.get("TORKTOOL_WS_URL", "wss://torktool.roftcore.work"),
        "auth_token": os.environ.get("TORKTOOL_TOKEN"),
    })
    
    # Test sending an operation
    def test_callback(result):
        print(f"Operation result: {result}")
    
    bridge.send_playlist_download(
        "https://open.spotify.com/playlist/test",
        callback=test_callback,
    )
    
    # Keep running for testing
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        bridge.stop()
        print("Bridge stopped")