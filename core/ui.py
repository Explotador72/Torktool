import os
import sys
import ctypes
import webbrowser
from core.config import logger, WEB_APP_URL, LOCAL_AGENT_HOST, LOCAL_AGENT_PORT, LOG_FILE

IS_WINDOWS = sys.platform.startswith("win")

if IS_WINDOWS:
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    # Win32 Constants
    WM_DESTROY = 0x0002
    WM_COMMAND = 0x0111
    WM_CLOSE = 0x0010
    WM_LBUTTONDOWN = 0x0201
    WM_NCLBUTTONDOWN = 0x00A1
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
    BUTTON_DEBUG_ID = 1004
    HTCAPTION = 2

    # Win32 Types for 64-bit compatibility
    LRESULT = ctypes.c_int64 if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_long
    WPARAM = wintypes.WPARAM
    LPARAM = wintypes.LPARAM

    WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, WPARAM, LPARAM)

    # Set explicit types for used functions
    user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, WPARAM, LPARAM]
    user32.DefWindowProcW.restype = LRESULT
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, WPARAM, LPARAM]
    user32.SendMessageW.restype = LRESULT
    user32.CreateWindowExW.restype = wintypes.HWND
    
    class WNDCLASS(ctypes.Structure):
        _fields_ = [
            ("style", wintypes.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
            ("cbWndExtra", ctypes.c_int), ("hInstance", wintypes.HINSTANCE), ("hIcon", wintypes.HANDLE),
            ("hCursor", wintypes.HANDLE), ("hbrBackground", wintypes.HANDLE), ("lpszMenuName", wintypes.LPCWSTR),
            ("lpszClassName", wintypes.LPCWSTR)
        ]

    class MSG(ctypes.Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND), ("message", wintypes.UINT), ("wParam", wintypes.WPARAM),
            ("lParam", wintypes.LPARAM), ("time", wintypes.DWORD), ("pt_x", ctypes.c_long), ("pt_y", ctypes.c_long)
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
            body_top = self.TITLEBAR_HEIGHT + 18
            user32.CreateWindowExW(0, "STATIC", self.window_title, WS_CHILD|WS_VISIBLE|SS_LEFT, 14, 10, 180, 18, self.hwnd, None, self.h_instance, None)
            user32.CreateWindowExW(0, "BUTTON", "_", WS_TABSTOP|WS_VISIBLE|WS_CHILD|BS_PUSHBUTTON, self.WINDOW_WIDTH-86, 4, 32, 28, self.hwnd, ctypes.c_void_p(BUTTON_MINIMIZE_ID), self.h_instance, None)
            user32.CreateWindowExW(0, "BUTTON", "X", WS_TABSTOP|WS_VISIBLE|WS_CHILD|BS_PUSHBUTTON, self.WINDOW_WIDTH-46, 4, 32, 28, self.hwnd, ctypes.c_void_p(BUTTON_CLOSE_ID), self.h_instance, None)
            user32.CreateWindowExW(0, "STATIC", "TorkTool Agent activo", WS_CHILD|WS_VISIBLE|SS_LEFT, 20, body_top, 260, 22, self.hwnd, None, self.h_instance, None)
            user32.CreateWindowExW(0, "STATIC", f"Backend local: http://{LOCAL_AGENT_HOST}:{LOCAL_AGENT_PORT}", WS_CHILD|WS_VISIBLE|SS_LEFT, 20, body_top+30, 300, 22, self.hwnd, None, self.h_instance, None)
            user32.CreateWindowExW(0, "STATIC", "Cierra esta ventana para detener el agente.", WS_CHILD|WS_VISIBLE|SS_LEFT, 20, body_top+60, 300, 22, self.hwnd, None, self.h_instance, None)
            user32.CreateWindowExW(0, "BUTTON", "Abrir web", WS_TABSTOP|WS_VISIBLE|WS_CHILD|BS_PUSHBUTTON, 20, body_top+98, 110, 30, self.hwnd, ctypes.c_void_p(BUTTON_OPEN_ID), self.h_instance, None)
            user32.CreateWindowExW(0, "BUTTON", "Ver Logs", WS_TABSTOP|WS_VISIBLE|WS_CHILD|BS_PUSHBUTTON, 140, body_top+98, 110, 30, self.hwnd, ctypes.c_void_p(BUTTON_DEBUG_ID), self.h_instance, None)

        def _window_proc(self, hwnd, msg, wparam, lparam):
            if msg == WM_COMMAND:
                bid = wparam & 0xFFFF
                if bid == BUTTON_OPEN_ID: webbrowser.open(WEB_APP_URL)
                elif bid == BUTTON_DEBUG_ID: os.startfile(LOG_FILE) if LOG_FILE.exists() else None
                elif bid == BUTTON_MINIMIZE_ID: user32.ShowWindow(hwnd, SW_MINIMIZE)
                elif bid == BUTTON_CLOSE_ID: user32.SendMessageW(hwnd, WM_CLOSE, 0, 0)
            elif msg == WM_LBUTTONDOWN:
                if (lparam >> 16) & 0xFFFF <= self.TITLEBAR_HEIGHT:
                    user32.ReleaseCapture()
                    user32.SendMessageW(hwnd, WM_NCLBUTTONDOWN, HTCAPTION, 0)
            elif msg == WM_CLOSE:
                self.server.stop()
                user32.DestroyWindow(hwnd)
            elif msg == WM_DESTROY: user32.PostQuitMessage(0)
            return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

        def run(self):
            self.hwnd = user32.CreateWindowExW(0, self.class_name, self.window_title, WS_POPUP|WS_BORDER|WS_SYSMENU|WS_MINIMIZEBOX|WS_VISIBLE, CW_USEDEFAULT, CW_USEDEFAULT, self.WINDOW_WIDTH, self.WINDOW_HEIGHT, None, None, self.h_instance, None)
            self._create_controls()
            user32.ShowWindow(self.hwnd, SW_SHOW)
            msg = MSG()
            while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
                user32.TranslateMessage(ctypes.byref(msg))
                user32.DispatchMessageW(ctypes.byref(msg))
else:
    class AgentWindow:
        def __init__(self, server): self.server = server
        def run(self):
            import time
            try:
                while True: time.sleep(1)
            except KeyboardInterrupt: self.server.stop()
