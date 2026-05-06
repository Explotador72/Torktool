# -*- mode: python ; coding: utf-8 -*-
import zipfile
import os
import shutil

spotify_hiddenimports = [
    'spotify_scraper',
    'spotify_scraper.extractors.playlist',
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

def build_zip(pyz, exe, a):
    exe_path = exe.name
    dist_dir = os.path.join(os.path.dirname(exe_path), 'dist_TorkTool')
    if os.path.exists(dist_dir):
        shutil.rmtree(dist_dir)
    os.makedirs(dist_dir)

    shutil.copy2(exe_path, os.path.join(dist_dir, 'TorkTool.exe'))

    for bin in a.binaries:
        src, dst, typ = bin
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(dist_dir, dst))

    for dat in a.datas:
        src, dst, typ = dat
        dst_dir = os.path.join(dist_dir, dst)
        if os.path.isdir(src):
            shutil.copytree(src, dst_dir)
        else:
            os.makedirs(os.path.dirname(dst_dir), exist_ok=True)
            shutil.copy2(src, dst_dir)

    zip_path = os.path.join(os.path.dirname(exe_path), 'TorkTool.zip')
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(dist_dir):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, dist_dir)
                zipf.write(file_path, arcname)

    shutil.rmtree(dist_dir)
    print(f'Created: {zip_path}')

build_zip(pyz, exe, a)
