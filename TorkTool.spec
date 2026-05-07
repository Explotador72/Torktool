# -*- mode: python ; coding: utf-8 -*-

spotify_hiddenimports = [
    'spotify_scraper',
    'spotify_scraper.extractors.playlist',
]

heavy_excludes = [
    'whisper',
    'torch',
    'torchaudio',
    'torchvision',
    'transformers',
    'triton',
    'xformers',
    'lightning_fabric',
    'pytorch_lightning',
    'scipy',
    'pandas',
    'matplotlib',
    'IPython',
    'jupyter',
    'pygame',
    'playwright',
    'selenium',
    'webdriver_manager',
    'aspose',
]

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=spotify_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', *heavy_excludes],
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
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
