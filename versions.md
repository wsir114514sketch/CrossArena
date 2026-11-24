# 版本锁定（versions.md）

本项目已全面迁移为 **TypeScript + Vite + HTML5 Canvas 2D + Web Audio + Vitest** 架构（零 Godot 依赖），升级任何一项都必须单独评估并更新本文件。

| 项目 | 锁定版本 | 来源 / 位置 | 校验 |
|---|---|---|---|
| Node.js | `v24.11.1` | 本机标准环境 | `node --version` |
| npm | `11.6.2` | 本机随附 npm，`package-lock.json` 严格锁定 | `npm --version` |
| TypeScript | `5.7.2`（`package-lock.json` 锁定） | npm 官方源（`devDependencies`） | `npx tsc --version` |
| Vite | `6.0.5`（`package-lock.json` 锁定） | npm 官方源（`devDependencies`） | `npx vite --version` |
| Vitest | `2.1.8`（`package-lock.json` 锁定） | npm 官方源（`devDependencies`） | `npx vitest --version` |
| Python | `3.12.10`（项目内 `.venv`） | 基于 `C:\Users\lenovo\AppData\Local\Programs\Python\Python312` 创建，不动系统 Python 与 miniconda | `.venv\Scripts\python --version` |
| Python 依赖：`Pillow` | `13.0.0`（`requirements.txt` 严格 `==` 锁定） | PyPI 官方源 `pillow-13.0.0-cp312-cp312-win_amd64.whl`（仅安装至 `.venv`） | whl（7,272,166 字节）<br>SHA-256：`FF3FE9EB621FBB9DB4C4BE33AB946F6BAC5F98AB50CA8D3260503653656C961B` |
| Git | `2.56.0.windows.3` | — | — |

## 目标运行与测试平台清单

| 优先级 | 平台 / 设备 | 状态与说明 |
|---|---|---|
| **首期目标**（全阶段门禁） | Windows 11 专业版 + Google Chrome 157（`157.0.8103.80`）+ Node.js Vitest | 原生 HTML5 Canvas 2D 最近邻像素渲染 + 60Hz 确定性定点模拟 |
| **后续测试目标** | 移动端现代浏览器 / WebView（Android 15） | 支持响应式缩放与虚拟按键扩展 |

## 规则

- 默认不依赖、不调用 Godot（仅当明确指定时再单独评估）。
- 前端与测试依赖仅安装在项目 `node_modules/` 并由 `package-lock.json` 锁定；Python 资产管线依赖仅安装在项目 `.venv/` 内，`requirements.txt` 必须用 `==` 锁死版本。
- 每次会话开始先运行 `git -C D:\MyGame\CrossArena rev-parse --show-toplevel`，结果必须等于 `D:/MyGame/CrossArena`；所有 git 命令都带 `-C`。
