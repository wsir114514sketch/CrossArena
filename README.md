# Cross Arena

一个跨 IP 的 2D 横版格斗游戏（Godot 4.7.2 + Blender 5.3）。完整规格见 [docs/spec/](docs/spec/)，数据 Schema 规范见 [docs/data_schema.md](docs/data_schema.md)，落地决策记录见 [docs/decisions.md](docs/decisions.md)。

## 开发环境

1. 复制 `tools.local.example.json` 为 `tools.local.json`，填入 Godot、Blender、Python 的本机路径（该文件已 gitignore）。
2. 创建虚拟环境：`<python3.12> -m venv .venv`，然后执行 `.venv\Scripts\python -m pip install -r requirements.txt`（已锁定 `Pillow==13.0.0`）。
3. 运行全部检查：`powershell -File scripts/run_tests.ps1`。

## 常用命令

```powershell
.venv\Scripts\python asset_pipeline\validate.py --skip-assets            # 校验全部内容包与核心代码隔离（只查数据）
.venv\Scripts\python asset_pipeline\validate.py --character test_pack.dummy_a
.venv\Scripts\python -m unittest discover -s asset_pipeline\tests        # 校验器自身的单元测试
```

## 目录

| 路径 | 内容 |
|---|---|
| `core/` … `ui/` | 引擎模块，每个目录的 README 写明职责。核心代码与配置中不得出现任何 IP 相关字符串 |
| `ip_content/<ip>/` | IP 内容包，格式见 [docs/data_schema.md](docs/data_schema.md) |
| `asset_pipeline/` | Blender 渲染、Sprite 打包与数据校验工具（Python） |
| `docs/` | 原始规格（`spec/`）、数据 Schema（`data_schema.md`）与正式决策记录（`decisions.md`） |
| `tests/` | GUT 测试 |
| `addons/gut/` | GUT 9.7.1，来源与校验值见 `versions.md` |
