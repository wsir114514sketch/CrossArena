# 版本锁定（versions.md）

规格第一部分第 3 节：升级任何一项都必须单独评估，并更新本文件。

| 项目 | 锁定版本 | 来源 / 位置 | 校验 |
|---|---|---|---|
| Godot | 4.7.2.stable.official (ed1daf0bf) | 本机路径写在 `tools.local.json` | `godot --version` |
| Blender | 5.3.0（构建日期 2026-11-10） | 本机路径写在 `tools.local.json` | `blender --version` |
| Blender EEVEE 引擎标识符 | `BLENDER_EEVEE`（运行时检测，不写死在代码里） | `asset_pipeline/probes/eevee_probe.py` | 后台渲染探针通过 |
| GUT | 9.7.1 | https://github.com/bitwes/Gut/archive/refs/tags/v9.7.1.zip，解压后放在 `addons/gut/`，已提交进仓库 | zip 的 SHA-256：`14969AA46ADC84AA08CDD21B9F6D1A64ADDD92AE60B36F02D0521ED305AA4086`（1,118,303 字节） |
| Python | 3.12.10（项目内 `.venv`） | `C:\Users\lenovo\AppData\Local\Programs\Python\Python312` | `.venv\Scripts\python --version` |
| Python 依赖 | 无（`requirements.txt` 只允许 `==` 锁死版本） | — | — |
| Git | 2.56.0.windows.3 | — | — |

## 规则

- 工具路径只写在 `tools.local.json`（已 gitignore，模板见 `tools.local.example.json`），不修改系统 PATH。
- GUT 不通过 Asset Library 安装；升级时从 GitHub tag 重新下载，并同时更新本表中的 SHA-256。
- 每次会话开始先运行 `git -C <项目路径> rev-parse --show-toplevel`，结果必须等于 `D:/MyGame/CrossArena`；所有 git 命令都带 `-C`。
