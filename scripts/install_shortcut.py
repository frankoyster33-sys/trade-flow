"""Install a small local macOS launcher; quotation data stays in the project."""
from pathlib import Path
import plistlib
import sys

if sys.platform != 'darwin':
    raise SystemExit('桌面入口目前支持 macOS。')

root = Path(__file__).resolve().parent.parent
app = Path.home() / 'Desktop' / 'trade flow.app'
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
    'LSApplicationCategoryType': 'public.app-category.business',
}))
(resources / 'project-path.txt').write_text(str(root) + '\n')
launcher = macos / 'launch'
launcher.write_text('''#!/bin/zsh
HS_RESOURCES="$(cd -- "$(dirname -- "$0")/../Resources" && pwd)"
IFS= read -r HS_PROJECT < "$HS_RESOURCES/project-path.txt"
if [[ -f "$HS_PROJECT/启动 trade flow.command" ]]; then
  mkdir -p "$HS_PROJECT/.data"
  if ! /bin/zsh "$HS_PROJECT/启动 trade flow.command" >"$HS_PROJECT/.data/desktop-launch.log" 2>&1; then
    /usr/bin/open -t "$HS_PROJECT/.data/desktop-launch.log"
  fi
else
  print '项目文件夹已移动。请在新位置运行「安装桌面入口.command」。' > "$HS_RESOURCES/启动提示.txt"
  /usr/bin/open -t "$HS_RESOURCES/启动提示.txt"
fi
''')
launcher.chmod(0o755)
print(f'已创建桌面入口：{app}')
