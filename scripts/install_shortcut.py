"""Install a small local macOS launcher; quotation data stays in the project."""
from pathlib import Path
import plistlib
import subprocess
import shutil
from datetime import datetime
import sys

if sys.platform != 'darwin':
    raise SystemExit('桌面入口目前支持 macOS。')

root = Path(__file__).resolve().parent.parent
app = Path.home() / 'Applications' / 'trade flow.app'
desktop = Path.home() / 'Desktop' / 'trade flow.app'
bundle_id = 'local.tradeflow.quotation'
plist = app / 'Contents' / 'Info.plist'
if app.exists():
    try:
        current_id = plistlib.loads(plist.read_bytes()).get('CFBundleIdentifier')
    except (OSError, ValueError):
        current_id = None
    if current_id != bundle_id:
        raise SystemExit('桌面已有同名项目，为避免覆盖，未创建入口。')

macos = app / 'Contents' / 'MacOS'
resources = app / 'Contents' / 'Resources'
macos.mkdir(parents=True, exist_ok=True)
resources.mkdir(parents=True, exist_ok=True)
plist.write_bytes(plistlib.dumps({
    'CFBundleName': 'trade flow',
    'CFBundleDisplayName': 'trade flow',
    'CFBundleIdentifier': bundle_id,
    'CFBundleExecutable': 'launch',
    'CFBundlePackageType': 'APPL',
    'CFBundleVersion': '1',
    'CFBundleShortVersionString': '0.1.0',
    'LSUIElement': True,
    'LSMinimumSystemVersion': '11.0',
    'CFBundleSupportedPlatforms': ['MacOSX'],
    'NSDesktopFolderUsageDescription': '读取报价项目、内部报价池和对外报价单池，以启动本机报价工作台。',
    'LSApplicationCategoryType': 'public.app-category.business',
}))
(resources / 'project-path.txt').write_text(str(root) + '\n')
launcher = macos / 'launch'
subprocess.run([
    '/usr/bin/xcrun', 'swiftc', str(root / 'scripts' / 'DesktopLauncher.swift'),
    '-o', str(launcher),
], check=True)
launcher.chmod(0o755)
subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', str(app)], check=True)
print(f'已创建桌面入口：{app}')
if desktop.is_symlink():
    if desktop.resolve() != app.resolve():
        raise SystemExit('桌面已有不同目标的 trade flow 入口，未覆盖。')
elif desktop.exists():
    desktop_plist = desktop / 'Contents' / 'Info.plist'
    if not desktop_plist.exists() or plistlib.loads(desktop_plist.read_bytes()).get('CFBundleIdentifier') != bundle_id:
        raise SystemExit('桌面已有同名项目，未覆盖。')
    backup = root / '.data' / 'retired-launchers' / datetime.now().strftime('%Y%m%d-%H%M%S')
    backup.mkdir(parents=True, exist_ok=True)
    shutil.move(str(desktop), str(backup / desktop.name))
if not desktop.exists():
    desktop.symlink_to(app, target_is_directory=True)
print(f'桌面快捷入口：{desktop}')
