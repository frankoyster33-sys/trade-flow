# trade flow

面向塑料包装业务报价的本机工作台：导入 Excel、图片或文字，由硅基流动/其他模型提供方如：open ai、anthropic、openrounter等模型提取规格，按已有规则生成内部 Excel；业务员在 WPS 或 Excel 审核、保存后，一键生成独立的对外 Quotation Sheet。

## 日常使用

Mac 上双击桌面的「trade flow」应用图标。入口会按需启动本机服务，并在默认浏览器打开 `http://127.0.0.1:60322/`。也可以直接运行项目中的「启动 trade flow.command」。

桌面入口连接到当前用户「应用程序」文件夹中的原生 Mac 启动器。首次运行时如系统提示访问桌面文件夹，请允许，以读取报价项目与报价池。项目移动位置后，重新运行「安装桌面入口.command」即可更新入口。

- 内部报价默认保存到当前用户桌面的 `agent报价池`。
- 对外报价默认保存到当前用户桌面的 `agent 对外报价单池`。
- 文件按日期分类，保留版本，支持搜索和日／周报价清单。
- 审核直接修改实际 Excel；核算输入变动后另存重算版本，再确认出单。

完整操作流程见 [使用说明](使用说明.md)。

## 在另一台 Mac 恢复

本仓库保存源码、核价规则、主模板和启动入口生成器。GitHub 上传本身不会部署网页服务。

需要 Node.js 22 或以上、Python 3，以及 `@oai/artifact-tool` 表格运行库。当前版本使用 Codex 工作区提供的该运行库；它没有包含在仓库中，不能仅靠普通的 `npm install` 完成环境准备。在拥有相同 Codex 工作区运行环境的 Mac 上，启动器会自动连接其 Node 依赖目录。

Python 读取表格需要 openpyxl、pandas、xlrd。当前工作区已提供前两项，补充依赖可执行：

```sh
python3 -m pip install --target .python -r requirements.txt
```

从 GitHub 下载后，在项目目录执行以下命令准备两个入口，再运行「启动 trade flow.command」。创建桌面应用需要 Mac 的 Xcode Command Line Tools（Swift 编译器）；仅运行网页服务时不需要编译桌面应用。

```sh
chmod +x *.command
python3 scripts/install_shortcut.py
```

首次运行后，在系统设置中重新填写自己的硅基流动密钥并选择文字、图片模型。

可选环境设置：`HS_QUOTE_NODE`、`HS_QUOTE_PYTHON`、`HS_QUOTE_PORT`、`HS_QUOTE_DATA`、`HS_QUOTE_INTERNAL`、`HS_QUOTE_EXTERNAL`。所有默认数据目录均是本地目录。

## 仓库内容

- `public/`：工作台界面。
- `server.mjs`、`lib/`：文件池、模型提取、审核与报价生成。
- `vendor/`：固定版本的原有报价规则、生成器与模板。
- `scripts/install_shortcut.py`：Mac 桌面入口生成器。
- `scripts/DesktopLauncher.swift`：原生 Mac 启动器源码。
- `tests/`：验证脚本；WPS 回归检查依赖本机 TEST 测试记录，业务文件不随源码上传。

不含 API 密钥、上传的询价资料、实际报价单、运行日志和本机运行库。`.data/`、`.python/`、`node_modules/` 及业务表格均已排除；仅保留核价主模板。

核价规则自检：`node vendor/batch/scripts/self_test.mjs`。首版已执行的流程与范围见 [验证记录](验证记录.md)，原有技能与设计来源见 [PROVENANCE.md](PROVENANCE.md)。

当前版本用于单台 Mac 的报价工作流，尚未提供 Docker、多人协作或云端运行包。第三方图标许可证保留在 `public/lucide.LICENSE`。
