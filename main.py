import os
from core.config import logger, WEB_APP_URL
from core.bridge import initialize_bridge
from core.server import LocalAgentServer
from core.downloader import start_download_process
from core.ui import AgentWindow

def main():
    logger.info("Iniciando TorkTool Local Agent...")
    
    # Initialize network bridge
    bridge = initialize_bridge({
        "backend_url": os.environ.get("TORKTOOL_WS_URL", "wss://torktool.roftcore.work"),
        "auth_token": os.environ.get("TORKTOOL_TOKEN"),
    })
    
    # Register remote handlers
    bridge.bridge.register_handler("download_playlist", lambda d: start_download_process(d.get("url")))
    bridge.bridge.register_handler("download_track", lambda d: start_download_process(d.get("url")))

    # Start local server
    server = LocalAgentServer()
    server.start()

    # Start UI (blocks until closed)
    try:
        ui = AgentWindow(server)
        ui.run()
    finally:
        logger.info("Deteniendo agente...")
        bridge.stop()
        server.stop()

if __name__ == "__main__":
    main()
