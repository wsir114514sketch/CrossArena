# Phase 0 环境检查报告（含检查点 2 准备更新）

日期：2026-11-24 · 机器：本机 Windows 11 专业版 · 对应规格第三部分第 15 节

所有环境检查与准备工作均未修改任何现有 LayUDown 项目、网站、服务器、Nginx、防火墙或端口。联网操作严格限于用户已批准的三项（GUT v9.7.1、Godot 4.7.2 标准导出模板、Pillow 13.0.0 官方 whl）。

## 1. 检查结果总表

| 检查项 | 结果 | 状态 |
|---|---|---|
| 项目位置 | `D:/MyGame/CrossArena`。`git -C D:\MyGame rev-parse` 确认外层不属于任何仓库；`git -C D:\MyGame\CrossArena rev-parse --show-toplevel` = `D:/MyGame/CrossArena` | ✅ |
| 现有项目隔离 | 旧工作区 `D:\MyGame\GameWorkSapce`（含 UNO / unionarena / Hon shugi 等）零写入、零改动 | ✅ |
| Godot 版本 | `4.7.2.stable.official.ed1daf0bf`，位于 `D:\GodotWorkSpace\`，含 console 版 | ✅ |
| Godot 无头运行 | `--headless --import`、GUT 命令行与 `--headless --export-release` 均正常 | ✅ |
| Godot 导出模板 | 已下载官方 `Godot_v4.7.2-stable_export_templates.tpz` 并通过官方 `SHA512-SUMS.txt` 与 ZIP CRC 完整性校验；已向 `%APPDATA%\Godot\export_templates\4.7.2.stable\` 安装 **Windows + Web** 模板（共 22 个文件，约 698.8 MiB），未安装其他平台模板 | ✅ |
| Web / Windows 空项目试导出 | 隔离临时工程无头导出 `Windows Desktop`、单线程 `Web`、多线程 `Web` 全部 `exit=0`（详数据见 `docs/checkpoint2_prep_report.md`） | ✅ |
| Blender 版本 | `5.3.0`（构建日期 2026-11-10），位于 `D:\BlenderWorkSpace\` | ✅ |
| EEVEE 引擎标识符 | 运行时动态检测结果为 `BLENDER_EEVEE`（不硬编码） | ✅ |
| Blender 后台渲染 | `blender -b --factory-startup` + EEVEE 成功渲染 256×256 RGBA PNG（四角 alpha=0，`Standard` 色彩变换可用） | ✅ |
| GPU | NVIDIA GeForce RTX 4050 Laptop + AMD Radeon 780M（另有 MuMu / GameViewer / Oray 虚拟显示适配器） | ℹ️ |
| 测试框架兼容性 | GUT `9.7.1` 在 Godot `4.7.2` 上 4/4 测试通过 | ✅ |
| Python 与依赖 | 项目 `.venv`（Python `3.12.10`），已锁定安装 `Pillow==13.0.0`；未修改系统 Python 与 miniconda | ✅ |
| 本机监听端口 | 本机 `18815` 未监听；未接触生产服务器，未开启任何本地监听端口 | ✅ |
| 磁盘空间 | 安装模板与缓存后：C 盘剩余 **24.8 GB**，D 盘剩余 **33.3 GB**（其中 `.cache/templates/*.tpz` 占 1.22 GB，审查通过后可清理回收） | ⚠️ 持续关注 |
| 目标测试平台 | **首期**：Windows 11 专业版 + Chrome 157（本机实装 `157.0.8103.80`）；**后续**：Android iQOO Neo9 / Android 15；**暂不安排**：iOS | ✅ |

## 2. 目标平台与分阶段策略

| 阶段定位 | 目标平台 / 设备 | 当前准备情况 |
|---|---|---|
| **首期目标**（Phase 1–5 阶段验收门禁） | Windows 11 专业版 + Google Chrome 157（本机已核实安装 `157.0.8103.80`） | Windows x86_64 与 Web 单线程/多线程导出模板已就绪并通过空项目无头导出实测 |
| **后续测试目标** | Android：iQOO Neo9（Android 15） | 本轮按要求未安装 Android 模板与 Android SDK；进入移动端触控与性能实测前再单独申请安装 |
| **暂不安排** | iOS | 不安装模板，不纳入当前路线图排期 |

## 3. Web 导出与回滚方案调研结论索引

完整的官方资料核实、实测数据与未验证推测对照表已整理至 **[docs/checkpoint2_prep_report.md](docs/checkpoint2_prep_report.md)** 第 4 节，核心结论摘要如下：

- **Godot 4.7.2 Web 导出**：
  - **官方确认 + 实际测试**：关闭线程支持（`variant/thread_support=false`，Godot 4.3+ 默认推荐方案）时，生成的 `index.html` 中 `GODOT_THREADS_ENABLED = false`，`Engine.getMissingFeatures` **不要求** `SharedArrayBuffer` 与跨源隔离响应头（`COOP` / `COEP`），可直接作为纯静态文件托管；单线程空包 `index.wasm` 原始 `39.51 MB`，`gzip -6` 后仅 **`10.11 MB`**（缩小 74.4%）。
  - **官方确认**：Web 端仅支持 `Compatibility`（WebGL 2.0）渲染器；单线程音频默认走 Web Audio Sample 模式（不支持总线 `AudioEffect` 与程序化音频，格斗常规音效播放不受影响）；Web 端**不支持** `ENet` / 裸 UDP，联机传输仅能选 `WebSocket`（客户端）或 `WebRTC`（P2P 数据通道，需信令与 STUN/TURN）。
- **回滚联机方案**：
  - **官方/仓库文档确认**：Snopek Games 的 `godot-rollback-netcode` 已有 Godot 4 版本（`1.0.0-alpha` 起），核心通过 `SyncManager` 驱动节点级 `save_state()` / `load_state()` / `network_process(input)`，支持配合 `WebRTC` 运行；`netfox` 则偏向通用状态同步/物理回滚而非传统 2D 帧格斗。
  - **架构对照**：本项目规格已定采用**纯数据 `SimState` + `step(state, inputs)`**（无节点状态依赖），比节点遍历式快照更精简可控；Phase 1–5 保持零外部网络插件依赖，Phase 6 再决定是自写轻量输入同步层（WebSocket/WebRTC）还是仅借用现有插件的传输/时钟调节思路。

## 4. 根据实测修正与待确认项

1. **已实测确认**：
   - Blender 5.3.0 后台 EEVEE 引擎标识符为 `BLENDER_EEVEE`。
   - Godot 4.7.2 Windows（约 104.1 MiB 裸 exe）与 Web（约 37.7 MiB 裸 wasm / 9.65 MiB gzip）无头导出流程畅通。
   - GDScript 64 位整数 `/` 向零截断、`posmod` 非负。
2. **待你审查拍板**：
   - 见 [docs/decisions.md](docs/decisions.md) 中标为 `需拍板` 的 5 条架构与校验细则（D4、D5、D6、D8、D11）。
   - 画布尺寸（384 / 512 / 768）与显存预算实测将在你批准进入检查点 2 后执行。
