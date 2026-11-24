# Phase 0 环境检查报告

日期：2026-11-24 · 机器：本机 Windows 11 专业版 · 对应规格第三部分第 15 节

除了下载 GUT（用户已授权的唯一一次联网）和在项目目录内写文件之外，所有检查都是**只读**的。没有修改任何现有项目、配置或服务，也没有开放任何端口。

## 1. 检查结果

| 检查项 | 结果 | 状态 |
|---|---|---|
| 项目位置 | `D:/MyGame/CrossArena`。`git -C D:\MyGame rev-parse` 报 not a git repository，确认不在任何仓库内；已在此处 `git init`，`rev-parse --show-toplevel` = `D:/MyGame/CrossArena` | ✅ |
| 现有项目隔离 | 旧的工作区 `D:\MyGame\GameWorkSapce` 是另一个仓库（远端 `Yhb-was-a-dick`，分支 `union-arena-2.4.5`，包含 UNO/unionarena 等项目）。未对它做任何写入，其中原有的空目录 `Game\CrossArena` 也没有动 | ✅ |
| Godot 版本 | 4.7.2.stable.official (ed1daf0bf)，位于 `D:\GodotWorkSpace\`，有控制台版 | ✅ |
| Godot 无头运行 | `--headless --import` 与 `-s gut_cmdln.gd` 都正常 | ✅ |
| Godot 导出模板 | `%APPDATA%\Godot\export_templates` **不存在**，Windows 和 Web 模板都没安装 | ⚠️ 需要处理 |
| Blender 版本 | 5.3.0（构建于 2026-11-10），位于 `D:\BlenderWorkSpace\` | ✅ |
| EEVEE 引擎标识符 | 运行时检测结果为 `BLENDER_EEVEE`（5.x 中已不存在 `BLENDER_EEVEE_NEXT`）。代码按「名称包含 EEVEE」检测，没有写死 | ✅ |
| Blender 后台渲染 | `blender -b --factory-startup` + EEVEE 能渲染出 256×256 RGBA PNG：四角 alpha=0，View Transform 可以设为 `Standard`，首次耗时 6.4s（含着色器编译），之后 0.9s | ✅ |
| GPU | NVIDIA GeForce RTX 4050 Laptop + AMD Radeon 780M（核显），另外有 MuMu、GameViewer、Oray 三个虚拟显示适配器 | ℹ️ |
| 测试框架兼容性 | GUT 9.7.1 在 Godot 4.7.2 上 4/4 测试通过，没有兼容性报错 | ✅ |
| 本机监听端口 | 53, 135, 139, 445, 902, 912, 3306, 4001, 4301, 4310, 5040, 5283, 5284, 5357, 7897, 8000, 8100, 8300, 9080, 9097, 9210, 10087, 13508, 15561, 16602–16605, 24081, 27339, 33060, 33211, 33331, 42050, 49132, 49664–49668, 49673, 49709, 49724, 49735, 49742, 49836, 50051, 50503, 52368, 52369, 57203, 57205, 59979, 61010, 63701。**18815 不在本机监听**（它在服务器上，本轮没有访问服务器） | ✅ |
| 磁盘空间 | C: 剩余 25.5 GB，D: 剩余 34.5 GB | ⚠️ 见下 |
| Python | 3.12.10，已在项目内建 `.venv`；未改动 miniconda | ✅ |
| Git | 2.56.0.windows.3 | ✅ |

### 磁盘余量估算

按规格第二部分第 9 节估算：一个角色约 25 个动画 × 平均 15 帧，512² 透明 PNG 每帧约 0.1–0.3 MB（压缩后），PNG 序列约 40–110 MB；加上 2 倍分辨率的中间帧（如果保留）、`.blend` 文件和图集，每个角色约 **0.3–0.5 GB**。D 盘剩余 34.5 GB，够前几个角色使用，但每加一个 IP 都需要重新评估。2 倍分辨率的中间帧建议不保留，或者放到 `.cache/`（已 gitignore）。

## 2. 未完成 / 需要你处理

| 项 | 原因 | 建议 |
|---|---|---|
| Godot 导出模板（Windows + Web） | 没有安装；下载需要访问 godotengine.org 或 GitHub releases，超出本轮授权的联网范围 | 在编辑器中用「管理导出模板」下载 4.7.2 模板，或者授权我从 GitHub 下载 `Godot_v4.7.2-stable_export_templates.tpz` 并记录它的 SHA-256。Phase 1 结束时需要用它做 Windows + 浏览器的实机验证 |
| Web 导出可行性 | 没有模板，无法用空项目试导出 | 以下内容基于已有知识，**未实测**：Godot 4.3 及以上默认采用单线程 Web 导出，不需要 `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` 响应头；只有勾选线程支持时才需要跨源隔离。部署到你的服务器时只需新增静态目录，**不改动现有 nginx 路由**（安全红线，届时会先请你确认） |
| 目标设备清单 | 无法自动获取 | 请告诉我要测试的安卓/iOS 机型和浏览器版本（至少 Chrome/Edge 各一个） |
| 服务器端口（18815 等） | 本轮不访问服务器 | 留到 Phase 6 |
| 内存预算实测 | 还没有渲染出的角色 | 放到检查点 2 的测试人偶和画布尺寸对比中一起做 |

## 3. 调研摘要（回滚 / 帧数据 / 判定）

> [!NOTE]
> 本轮只授权访问 github.com 下载 GUT，没有浏览以下项目，下面的内容**基于已有知识，未联网核实**，仅作为方向参考，不复制任何代码。

| 参考 | 要点 | 对本项目的影响 |
|---|---|---|
| Godot Rollback Netcode（Snopek Games 插件）及其格斗示例 | 依靠节点的 `_save_state` / `_load_state` / `_network_process` 约定实现回滚，要求逻辑不用 Godot 物理、使用整数或定点数 | 本项目用纯数据的 `SimState` 加 `step(state, inputs)`，比按节点逐个快照更轻；Phase 6 可以评估是否把它接为传输与预测层 |
| Shoto Fighter Godot / Fightvania 一类开源格斗 Demo | 常见做法是用 Area2D 做判定、AnimationPlayer 驱动帧，开发快但不具备确定性 | 规格已决定判定层自研、不用 Area2D，这些项目只参考状态划分和帧数据表的组织方式 |
| Godot 官方 2D 动画文档 | AnimatedSprite2D / AnimationPlayer 按引擎时间推进 | 按规格，显示帧号由模拟层的 `anim_tick` 直接计算，`Sprite2D.region_rect` 手动切换 |
| Blender 绑定与渲染工作流 | 正交相机、原地动画、Fake User、次级运动烘焙 | 已写入第二部分，检查点 2 实现 |

## 4. 本检查点的交付物

- 仓库骨架：按规格第一部分第 8 节建立目录，各模块目录带职责说明；规格三部分已复制到 `docs/spec/`。
- 文档：`versions.md`（版本锁定，含 GUT 的 SHA-256）、`docs/decisions.md`（规格未写明处的 13 条落地决策）。
- 数据 Schema 示例：
  - `ip_content/test_pack/` 下两个占位角色，`dummy_b` 带投射物技能。
  - `ip_content/arknights/ip.json`，状态为 `locked`。
- `asset_pipeline/validate.py`：
  - 实现第一部分第 9.5 节的全部检查，外加第二部分第 8 节中与图像无关的检查（帧文件缺失、帧号不连续、帧数不一致、核心动作缺失、`sources.json` 缺失或未覆盖全部素材）。
  - 有 40 个单元测试，每个测试都注入一个具体缺陷再验证能报出来，不用 mock。
- `asset_pipeline/probes/eevee_probe.py`：EEVEE 后台渲染探针。
- `scripts/run_tests.ps1`：一键运行全部检查，开头先校验 git 根目录。
- `tests/unit/test_gut_smoke.gd`：确认 GUT 可用，并记录整数运算语义（除法向零截断、`%` 与被除数同号、int 为 64 位）。

## 5. 根据实测修正的规格数值

- 第二部分第 5 节「EEVEE」的引擎标识符：确认为 `BLENDER_EEVEE`。
- 第三部分第 2 节「固定取整方式」：GDScript 的 `/` 向零截断，向下取整需要用工具函数（见 decisions D13）。
- 内存预算、画布尺寸：等检查点 2 实测后再修正。
