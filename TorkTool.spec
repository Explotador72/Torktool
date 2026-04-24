# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_submodules

spotify_hiddenimports = []
try:
    spotify_hiddenimports = collect_submodules('spotify_scraper')
except Exception:
    spotify_hiddenimports = []

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('index.html', '.'),
        ('assets', 'assets'),
        ('translations', 'translations'),
        ('img', 'img'),
    ],
    hiddenimports=spotify_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='TorkTool',
    icon='torken.ico',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
