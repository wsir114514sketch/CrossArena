# 检查点 2 最终报告（数据规范定稿与校验器闭环）

日期：2026-11-24 · 仓库：`D:/MyGame/CrossArena`

本报告记录根据你的正式批复，将数据规范（D1–D13 决策及完整 Schema）与自动化校验器（`asset_pipeline/validate.py`）同步锁定的最终结果。本轮严格遵守范围限制：**未启动 Blender 渲染管线、未开始 Phase 1、未创建正式角色动画、未修改核心战斗系统、未部署或接触任何外部服务/网站**。

---

## 1. 定稿内容摘要

1. **正式锁定 D4、D5、D8（写入 [docs/decisions.md](decisions.md) 与 [docs/data_schema.md](data_schema.md)）**：
   - **D4（坐标系、镜像与物理符号）**：锁定整数矩形 `[x, y, w, h]`（`1px = 1000`，`+Y` 向下）；朝左（`facing = -1`）镜像公式锁定为 `world_rect = [pos_x - x - w, pos_y + y, w, h]`；整数 AABB 相交采用严格不等号 `<`（贴边不判重叠）；`jump_velocity`/`gravity` 存正标量（起跳赋 `-jump_velocity`），`knockback.y < 0` 为向上击飞。
   - **D5（`hitstop` 与停顿字段）**：`hitboxes[]` 与 `projectile_spawn[].hit` 强制要求填写 `hitstop >= 0`，可选支持 `block_hitstop >= 0`（省略时默认等于 `hitstop`）；`FrameData` 顶层支持可选 `super_freeze: {frame, duration}`。
   - **D8（字段唯一归属矩阵）**：`gravity` 及能量上限/受击防御回能比锁归 `fighter`；`projectile_gravity` 锁归 `skill`；`meter_gain_on_hit` / `meter_gain_on_block` / `meter_gain_on_whiff` 锁归 `framedata`；`animation_id` 严禁出现在 `skill`、`fighter`、`hurtbox`、`ip` 中（强制经 `move_id -> FrameData -> animation_id` 单向关联）。
2. **按批复调整 D6、D11（同步更新校验器与测试包数据）**：
   - **D6（倒地 `pushbox.down` 与全局战斗配置 Schema）**：`hurtboxes.json` 的 `pushbox` 强制覆盖 `stand`、`crouch`、`air`、**`down`** 四种姿态（已在 `test_pack` 两个占位角色中补齐 `pushbox.down`）；明确跨 IP 全局战斗规则文件 `combat/combat_config.json` 的正式 Schema 与校验逻辑。
   - **D11（全仓核心范围扫描与三级防误报匹配）**：
     - **范围扩充**：除 `ip_content/ tests/ asset_pipeline/ addons/ docs/ .venv/ .cache/ .git/ .godot/ build/` 及本机工具配置外，全仓所有代码/场景/项目配置（含根目录 `project.godot` 及任意新增模块目录）均纳入扫描。
     - **三级精准匹配**：一级无条件拦截 `ip_content/<ip>`、`characters/<char>`、完整 `<ip>.<char>` ID、IP 标识与多字中文名；二级按子词边界（识别 `snake_case` 分隔，拦截 `amiya_bonus` 等）拦截专属角色词；三级对 `ENGINE_COLLISION_WORDS` 通用引擎术语（如 `Color.RED`、`ash`、`frost`、`spot`、`light`、`block`、`dash`）、短字母名（如 `var w`）及普通中文注释（如 `# 攻击框（红）`）防误报放行，同时继续拦截 `".red"`、`".w"`、`== "红"` 等硬编码字面量。
3. **补充 D2 / D10 细节闭环**：
   - 支持 `wakeup` / `dash` 可选提供 `framedata/<id>.json`（配置起身无敌帧或冲刺取消窗口）。
   - IP 根目录下的非文档资产（如 `cover.png`）纳入 `<ip>/sources.json` 覆盖检查；非占位符（未标 `placeholder: true`）在源资产目录使用宽泛 `*` 通配时输出 `SOURCES_BROAD_WILDCARD` 警告。

---

## 2. 变更文件清单

| 文件路径 | 变更类型 | 说明 |
|---|---|---|
| `docs/decisions.md` | 更新 | 将 D1–D13 全部转为正式锁定状态，移除待定标记 |
| `docs/data_schema.md` | **新增** | 完整的 8 类 JSON Schema、字段唯一归属表与核心代码 IP 隔离规范文档 |
| `docs/checkpoint2_final_report.md` | **新增** | 本最终报告 |
| `README.md` | 更新 | 补充 `docs/data_schema.md` 入口链接与 `Pillow==13.0.0` 依赖说明 |
| `asset_pipeline/validate.py` | 更新 | 落地 D5、D6、D8、D10、D11 全部新增校验规则与三级防误报扫描器 |
| `asset_pipeline/tests/test_validate.py` | 更新 | 由 40 个扩展至 **59 个**无 mock 单元测试，新增 `CoreIsolationD11Tests` 专项误报与漏报测试集 |
| `ip_content/test_pack/characters/dummy_a/framedata/hurtboxes.json` | 更新 | 按 D6 补充 `pushbox.down` |
| `ip_content/test_pack/characters/dummy_b/framedata/hurtboxes.json` | 更新 | 按 D6 补充 `pushbox.down` |

---

## 3. 完整测试套件运行结果

通过 `powershell -File scripts/run_tests.ps1` 实跑验证：

- **Git 仓库根守卫**：`D:/MyGame/CrossArena`（通过）
- **Python 校验器单元测试（`asset_pipeline/tests/test_validate.py`）**：**`59/59 passed`**（含 D5 停顿校验、D6 `pushbox.down` 与 `combat_config.json`、D8 唯一归属、D10 封面与通配警告、D11 `Color.RED`/`var w`/中文注释零误报及根目录/新目录/`snake_case` 泄漏拦截）
- **全仓内容包与核心代码隔离校验（`validate.py --skip-assets`）**：**`0 error(s), 0 warning(s)`**
- **Godot 4.7.2 + GUT 9.7.1 无头测试**：**`4/4 passed`**（`7/7 asserts`）
