# PyInstaller spec for ABX PDF Builder Flask server
# Run: pyinstaller server.spec

import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Collect all data files needed at runtime
datas = [
    ('assets',        'assets'),
    ('brand_config.json', '.'),
]

# Include all reportlab and svglib data
datas += collect_data_files('reportlab')
datas += collect_data_files('svglib')

hiddenimports = (
    collect_submodules('reportlab') +
    collect_submodules('svglib') +
    collect_submodules('flask') +
    collect_submodules('PIL') +
    collect_submodules('fitz') +
    ['anthropic', 'python_dotenv', 'dotenv', 'pypdf']
)

a = Analysis(
    ['server.py'],
    pathex=['.'],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='abx-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # no terminal window
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
