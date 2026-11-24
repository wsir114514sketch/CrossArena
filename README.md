# Cross Arena

一个跨 IP 的 2D 横版格斗游戏（Godot 4.7.2 + Blender 5.3）。完整规格见 [docs/spec/](docs/spec/)，规格未覆盖的落地细节见 [docs/decisions.md](docs/decisions.md)。

## 开发环境

1. 复制 `tools.local.example.json` 为 `tools.local.json`，填入 Godot、Blender、Python 的本机路径（该文件已 gitignore）。
2. 创建虚拟环境：`<python3.12> -m venv .venv`，然后执行 `.venv\Scripts\python -m pip install -r requirements.txt`（当前没有任何依赖）。
3. 运行全部检查：`powershell -File scripts/run_tests.ps1`。

## 常用命令

```powershell
.venv\Scripts\python asset_pipeline\validate.py --skip-assets            # 校验全部内容包（只查数据）
.venv\Scripts\python asset_pipeline\validate.py --character test_pack.dummy_a
.venv\Scripts\python -m unittest discover -s asset_pipeline\tests        # 校验器自身的测试
```

## 目录

| 路径 | 内容 |
|---|---|
| `core/` … `ui/` | 引擎模块，每个目录的 README 写明职责。目录内不得出现任何 IP 相关字符串 |
| `ip_content/<ip>/` | IP 内容包，格式见规格第一部分第 8–9 节 |
| `asset_pipeline/` | Blender 渲染、Sprite 打包与校验工具（Python） |
| `tests/` | GUT 测试 |
| `addons/gut/` | GUT 9.7.1，来源与校验值见 `versions.md` |
