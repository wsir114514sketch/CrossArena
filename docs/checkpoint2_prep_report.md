# 检查点 2 准备工作报告

日期：2026-11-24 · 仓库：`D:/MyGame/CrossArena`

本报告汇总你在检查点 1 之后授权的 **5 项准备工作**的执行结果、校验凭据、调研区分表以及 `docs/decisions.md` 的审查摘要。严格遵守禁止事项：**未开始 Blender 渲染管线、未开始 Phase 1、未制作正式角色素材、未修改核心战斗代码、未触碰任何外部项目/服务器/Nginx/端口**。

---

## 1. Godot 4.7.2 Stable 标准导出模板（仅安装 Windows 与 Web）

### 1.1 下载来源与压缩包完整性校验

| 项目 | 记录值 |
|---|---|
| 官方发布页标签 | `4.7.2-stable` |
| 模板包下载 URL | `https://github.com/godotengine/godot/releases/download/4.7.2-stable/Godot_v4.7.2-stable_export_templates.tpz` |
| 官方校验清单 URL | `https://github.com/godotengine/godot/releases/download/4.7.2-stable/SHA512-SUMS.txt` |
| 本地缓存文件名 | `Godot_v4.7.2-stable_export_templates.tpz`（位于已 gitignore 的 `.cache/templates/`，审查后可删除以释放 1.22 GB） |
| 文件大小 | `1,281,349,702` 字节（约 1.19 GiB） |
| **实测 SHA-256** | `F298490B8D44D934BE425A5A65A51BF15F422428B229A06A6E11D9FFEA248011` |
| **实测 SHA-512** | `ca4d71c4d7b81dfc15d1a98baa07534aa95b03fdda78a0075b06672e1648d2e5f40980c9adc28d23e1b92e732ee7bf3461997aa804af74ec2fcd7a93ccb84079` |
| 官方 `SHA512-SUMS.txt` 对照 | **逐位完全一致**（第 14 行记录值相同） |
| ZIP 结构与 CRC 校验 | Python `zipfile.ZipFile.testzip()` 返回 `None`（包内全部 35 个条目零损坏） |

### 1.2 按需安装范围与实测验证

- 安装目录：`C:\Users\lenovo\AppData\Roaming\Godot\export_templates\4.7.2.stable\`。
- **按范围过滤**：仅解压了 `version.txt`（内容 `4.7.2.stable`）、`icudt_godot.dat`（ICU 国际化数据）、全部 `web_*.zip`（8 个）和全部 `windows_*.exe`（12 个），合计 **22 个文件（732,754,969 字节）**；**未解压** `android_*`、`ios.zip`、`linux_*`、`macos.zip`。每个已安装文件的大小和 SHA-256 已完整写入 [versions.md](../versions.md)。
- **无头试导出实测**（在隔离临时目录 `.cache/export_probe` 用空场景测试后已清理，未开启任何端口，未改动项目代码）：
  - `Windows Desktop`（x86_64 release）：`exit=0`，生成 `probe.exe`（`109,127,680` 字节）+ `probe.pck`（`1,472` 字节）。
  - `Web` 单线程（`variant/thread_support=false`）：`exit=0`，生成 `index.html`、`index.js`（`279,815` 字节）、`index.wasm`（`39,514,754` 字节；经 `gzip -6` 压缩后为 **`10,114,291` 字节**）、`index.audio.worklet.js`、`index.pck`。
  - `Web` 多线程（`variant/thread_support=true`）：`exit=0`，生成 `index.wasm`（`38,820,072` 字节）、`index.js`（`314,653` 字节）。

---

## 2. Python `.venv` 锁定安装 `Pillow==13.0.0`

| 项目 | 记录值 |
|---|---|
| 下载源 | PyPI 官方源 `https://pypi.org/simple`（注：本机全局 pip 配置的清华镜像连接超时，显式指定官方源成功下载） |
| Wheel 文件名 | `pillow-13.0.0-cp312-cp312-win_amd64.whl` |
| 文件大小 | `7,272,166` 字节 |
| **SHA-256** | `FF3FE9EB621FBB9DB4C4BE33AB946F6BAC5F98AB50CA8D3260503653656C961B` |
| 安装位置 | 仅 `D:\MyGame\CrossArena\.venv\Lib\site-packages\PIL`（`--no-deps` 安装，无传递依赖） |
| 锁定文件 | [requirements.txt](../requirements.txt) 写入 `Pillow==13.0.0`；`.venv\Scripts\python -m pip list --format=freeze` 确认为 `pillow==13.0.0` |
| 系统环境隔离 | 未触碰系统 `Python312` 与 `D:\ProgramData\miniconda3` |

---

## 3. 目标平台测试清单更新

已同步写入 [versions.md](../versions.md) 与 [phase0_report.md](../phase0_report.md)：

1. **首期目标（Phase 1 起每个阶段的实机门禁）**：**Windows 11 专业版 + Google Chrome 157**（已只读核实本机 `C:\Program Files\Google\Chrome\Application\chrome.exe` 版本号为 **`157.0.8103.80`**，可直接用于本地测试）。
2. **后续测试目标**：**Android — iQOO Neo9 / Android 15**（触控布局、安全区与移动端显存预算验证目标；本轮未安装 Android 导出模板，待进入移动端测试前单独评估安装）。
3. **暂不安排**：**iOS**（不安装导出模板、不纳入测试门禁）。

---

## 4. Godot Web 导出与回滚方案调研（严格区分三类证据等级）

以下每一条结论均明确标注证据等级：**【官方确认】**（来自 Godot 官方文档或对应开源仓库文档）、**【实际测试】**（本机 Godot 4.7.2 实跑验证）、**【未验证推测】**（尚未在本机浏览器/网络环境下实测，需后续阶段验证）。

### 4.1 Godot 4 Web 导出调研

| 维度 | 证据等级 | 结论与对本项目的具体影响 |
|---|---|---|
| **单线程导出与跨源隔离响应头（COOP/COEP）** | **【官方确认】+【实际测试】** | 官方文档确认自 Godot 4.3 起支持单线程 Web 导出（`Thread Support` 关闭），无需 `SharedArrayBuffer`，从而无需服务器配置 `Cross-Origin-Opener-Policy: same-origin` 与 `Cross-Origin-Embedder-Policy: require-corp`。本机 Godot 4.7.2 实测导出单线程产物后核查 `index.html` 与 `index.js`：当 `GODOT_THREADS_ENABLED = false` 时，`Engine.getMissingFeatures({ threads: false })` 不会检查 `window.crossOriginIsolated` 或 `SharedArrayBuffer`。<br>**影响**：首期 Web 版强烈建议采用**单线程导出**，后续集成个人网站时无需改动全局响应头策略，避免影响同域其他页面或外链资源。 |
| **多线程导出的硬性要求** | **【官方确认】+【实际测试】** | 开启 `variant/thread_support=true` 时，产物依赖 `SharedArrayBuffer`；浏览器端要求处于安全上下文（HTTPS 或 `localhost`）且响应头同时携带上述 `COOP` + `COEP`，否则本机实测导出的 `index.js` 会直接阻断启动并报错 `SharedArrayBuffer - Check that the web server configuration sends the correct headers.`。 |
| **渲染后端限制（WebGL 2.0）** | **【官方确认】** | Godot 4 Web 平台仅支持 **`Compatibility` 渲染方法**（基于 WebGL 2.0 / OpenGL ES 3.0），不支持 `Forward+` 与 `Mobile`（Vulkan）。<br>**影响**：本项目 `project.godot` 在进入 Phase 1 场景搭建时应直接锁定 `gl_compatibility`，确保 Windows 开发画面与 Chrome 157 Web 画面使用同一套渲染管线，避免着色器行为不一致。 |
| **单线程 Web 音频限制（Sample 模式）** | **【官方确认】** | 单线程 Web 导出为保证低音频延迟，默认通过浏览器原生 Web Audio API 的 **Sample 回放模式**播放，不支持音频总线效果器（`AudioEffect`、混响、多普勒）与程序化音频（`AudioStreamGenerator`），且逐帧快速调制音量/音高可能出现阶梯感；若强行切回 `Stream` 模式在低端机掉帧时可能爆音。<br>**影响**：2D 格斗的打击音效、语音、BGM 均为预制音频片段直接触发，不依赖实时混响或程序化合成，Sample 模式天然契合且延迟更低。 |
| **包体与静态压缩传输** | **【官方确认】+【实际测试】** | Web 导出核心体积在 `.wasm` 与 `.pck`。本机实测 Godot 4.7.2 单线程空项目 `index.wasm` 裸大小为 `39.51 MB`，经 `gzip -6` 压缩后降至 **`10.11 MB`**（体积减少 74.4%）；官方文档强烈建议托管服务器开启 Gzip 或 Brotli 预压缩。角色图集若全部打进单一主 `.pck` 会拉长首屏下载时间，按需分包或延迟加载策略需在后续关注。 |
| **纹理压缩与描边透明图质量** | **【官方确认】+【未验证推测】** | 【官方确认】Compatibility 渲染器下高阶桌面/移动显存压缩（BPTC/ASTC）受限，且同时勾选桌面与移动 VRAM 压缩会让导出体积翻倍；Lossless PNG/WebP 磁盘体积小但运行时在显存中完全解压为 RGBA8。<br>【未验证推测】规格第二部分第 9 节判断「默认不启用显存压缩，带描边透明图容易出杂边」，在 Chrome 157（RTX 4050 / WebGL2）与后续 iQOO Neo9 上加载双角色未压缩 RGBA8 图集的实际显存占用与帧率表现尚未实测（需等渲染管线产出测试人偶图集后实测）。 |
| **Chrome 157 实际加载与手柄/键盘输入焦点行为** | **【未验证推测】** | 本轮严格遵守「不开网络端口」禁令，未启动本地 HTTP 服务在 Chrome 157 窗口中实际打开 `index.html`（现代浏览器在 `file://` 协议下会拦截 fetch `.wasm`/`.pck`）。浏览器端 Canvas 焦点捕获、自动播放音频解锁（需首次点击交互）留待你允许本地试运行阶段验证。 |

### 4.2 回滚联机（Rollback Netcode）与 Web 网络传输调研

| 维度 | 证据等级 | 结论与对本项目的具体影响 |
|---|---|---|---|
| **浏览器端可用网络协议限制** | **【官方确认】** | 浏览器安全沙箱禁止网页打开裸 UDP 或 TCP 套接字，因此 Godot Web 导出**完全不支持 `ENetMultiplayerPeer`、`PacketPeerUDP`、`StreamPeerTCP`**，也不能作为服务端监听。Web 端仅支持两种传输：<br>1. **`WebSocketMultiplayerPeer` / `WebSocketPeer`**（客户端连服务端，基于 TCP，有队头阻塞，部署最简单，HTTPS 页面须用 `wss://`）；<br>2. **`WebRTCMultiplayerPeer` / `WebRTCPeerConnection`**（浏览器间 P2P 无序不可靠 DataChannel，类 UDP 低延迟，最适合格斗回滚，但**必须**额外部署信令服务器与 STUN/TURN 穿透服务，且 Godot Web/原生端需注意 WebRTC 插件配套）。 |
| **现有插件评估 1：`godot-rollback-netcode`（Snopek Games）** | **【官方确认】** | GitLab `snopek-games/godot-rollback-netcode` 已发布支持 Godot 4.2+ 的 `1.0.0-alpha` 版本。其核心机制是通过全局单例 `SyncManager` 以固定 tick 调度场景树中节点的 `save_state() -> Dictionary`、`load_state(state)` 与 `network_process(input)`，内置输入延迟（Input Delay）、末次输入重复预测（Input Prediction）、历史环形缓冲与 `WebRTC` 对接能力。<br>**局限与风险**：① Godot 4 分支仍标为 alpha；② 它深度绑定「Godot 节点树遍历存取 Dictionary」以及 Godot 高层 MultiplayerPeer 体系；③ 若不配合自定义外部传输适配，灵活性受插件自身协议约束。 |
| **现有插件评估 2：`netfox` / `GGRS` GDExtension** | **【官方确认】** | ① `foxssake/netfox` 面向 Godot 4 通用客户端预测/服务端权威同步，核心面向连续物理游戏而非对称帧锁定 2D 格斗；<br>② Rust `GGRS` 等 C++/Rust 回滚库若通过 `GDExtension` 接入 Godot Web，官方文档确认必须开启 `variant/extensions_support=true`（使用体积更大且需动态链接的 `web_dlink_*` 模板）并把扩展交叉编译为 `wasm32`，工程链路显著变重。 |
| **本项目确定性模拟与回滚对接路线评估** | **【实际测试（局部）】+【未验证推测】** | 【实际测试】GUT 已实测确认 GDScript 64 位整数运算的确定性边界（向零截断除法、二补数溢出回绕、`posmod`）。<br>【架构结论与未验证推测】规格第三部分第 2、12 节设计的 **`step(state, inputs) -> state` 纯数据模拟层**天然优于节点遍历式快照：整个战场状态集中在一个无节点引用的纯数据快照中，`save_state`/`load_state` 只需复制定长整数/数组结构。因此 Phase 1–5 **不应引入任何第三方回滚插件依赖**；到 Phase 6 联机阶段，参考 `SyncManager` 的「固定帧输入延迟 + 重复上一帧输入预测 + 状态环形缓冲 + 帧校验和对账」算法在 `network/` 模块直接驱动 `step()`，并实测对比局域网/公网下 `WebRTC DataChannel` 与 `WebSocket` 的抖动表现（该网络延迟表现目前属【未验证推测】）。 |

---

## 5. `docs/decisions.md` 13 条决定审查摘要（未擅改任何争议项）

已按要求重写 [docs/decisions.md](../docs/decisions.md) 的说明结构（保留检查点 1 全部现行规则不变），逐条列出规格依据、潜在冲突与修改建议。其中 **5 条需要你在进入下一阶段前拍板**：

1. **D4（坐标系、镜像与速度符号）**：建议确认朝左镜像公式统一为 `world_x = pos_x - x - w`、AABB 相交采用严格不等号 `<`（贴边不算重叠，防挤压抖动）、`jump_velocity`/`gravity` 填正标量而 `knockback.y < 0` 表示向上击飞。
2. **D5（`hitstop` 是否必填）**：规格第三部分要求写在命中数据里，但第一部分 `light_01.json` 节选示例未写 `hitstop`。建议维持必填（方案 A），并允许可选 `block_hitstop`（默认等于 `hitstop`）。
3. **D6（挤压盒 `pushbox` 与全局战斗参数位置）**：建议确认倒地状态保留 `pushbox.down`（防起身重合翻转），并在 Phase 1 新增非 IP 的全局规则文件（如 `combat/combat_config.json`）存放场地边界、角落反推、缓冲帧数与伤害递减表。
4. **D8（数值单归属校验）**：建议将 `gravity` 锁归 `FighterDefinition`、禁止 `SkillDefinition` 写 `animation_id`，并固定能量增长字段归属（基础回能归 `FighterDefinition`、招式命中回能归 `FrameData`、消耗 `cost` 归 `SkillDefinition`）。
5. **D11（核心代码禁用 IP 字符串防误报）**：为防止未来英文常见词角色名（如 `Red` / `Ash`）与引擎常量（如 `Color.RED`）撞名误报，建议对 `ip_id`、`ip.char`、路径片段和中文名无条件严禁，对纯英文短单词采用更精确匹配或引擎常量白名单，同时把仓库根目录脚本也纳入扫描范围。

其余 8 条（D1、D2、D3、D7、D9、D10、D12、D13）均为无争议细化或低争议补漏（如 D10 补查 `ip_content/<ip>/cover.png`、D13 坐标转像素统一用 `div_floor`）。等你逐项批复后，再同步更新 `validate.py` 及对应测试。
