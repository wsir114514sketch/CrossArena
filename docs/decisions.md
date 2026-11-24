# 规格落地决策记录（逐条审查版）

本文件记录规格（`docs/spec/`）中未写明或存在表述差异之处的落地方式。凡与规格冲突的地方，以规格为准。

> [!IMPORTANT]
> **审查状态说明（2026-11-24 检查点 2 准备阶段）**：
> 以下 D1–D13 的**当前生效规则均保持检查点 1 原样未作改动**（未擅自修改任何有争议的架构决定，也未改动 `validate.py`）。每条均补充了**对应规格依据**、**潜在冲突 / 边界漏洞**与**建议修改**，按争议程度分为：
> - `无争议（补充细化）`：与规格完全一致，仅需把隐含前提写清楚（D1、D3、D9、D12）。
> - `低争议（校验补漏）`：方向无分歧，但发现边界遗漏，建议批准后补齐（D2、D7、D10、D13）。
> - `需拍板（存在规格差异或架构权衡）`：规格正文与示例不一致，或涉及后续系统契约，必须由你明确选择方案后再改代码/校验器（D4、D5、D6、D8、D11）。

---

## 决策总览表

| 编号 | 主题 | 审查分类 | 核心待确认点 |
|---|---|---|---|
| D1 | 技能动作 ID 命名 | 无争议（补充细化） | 规格目录树示例有一处简写 `ultimate/`，以命名规范表 `skill_ultimate` 为准 |
| D2 | 核心动作「已实现」的判定 | 低争议（校验补漏） | `wakeup`（起身无敌帧）与 `dash`（冲刺取消）是否允许可选 `framedata/<id>.json` |
| D3 | FrameData 帧编号起点与区间开闭 | 无争议（补充细化） | 明确所有 `[start, end]` 为 **0 起点闭区间（含首尾）** |
| D4 | 矩形坐标系、朝向镜像与跳跃符号 | **需拍板** | 朝左镜像公式 `x' = -(x + w)`、严格相交 `<` vs `<=`、`jump_velocity` 正数存值向上取负 |
| D5 | `hitstop` 字段位置与必填性 | **需拍板** | 第三部分要求写在命中数据里，但第一部分 `light_01.json` 示例未写 `hitstop`；另需确认防御停顿 `block_hitstop` |
| D6 | 身体挤压盒（pushbox）位置与倒地/角落规则 | **需拍板** | `KNOCKDOWN` 期间是否有 pushbox；全局角落反推与场地边界数据放哪个配置文件 |
| D7 | 投射物数据拆分与引用链 | 低争议（校验补漏） | `SkillDefinition` 通过 `move_id -> FrameData -> animation_id` 单向串联；Phase 2 斜向弹道扩展方式 |
| D8 | 「同一数值不重复定义」的键归属校验 | **需拍板** | 能量增长字段归属（第三部分写了「FighterDefinition 或技能配置」需二选一固定），以及禁止 `skill` 直接写 `animation_id` |
| D9 | 测试内容包 `test_pack` 隔离策略 | 无争议（补充细化） | `DataLoader` 默认过滤 `test_only: true`；`dummy_b` 的远程技能留到 Phase 2 执行 |
| D10 | `sources.json` 通配符与 IP 级素材覆盖 | 低争议（校验补漏） | 补查 `ip_content/<ip>/cover.png`；正式角色手制素材目录（`model/`、`textures/`）限制裸 `*` 通配 |
| D11 | 核心代码禁止 IP 字符串的扫描范围与误报防护 | **需拍板** | 未来英文常见词角色名（如 `Red`/`Ash`）与内置常量冲突处理；根目录脚本是否纳入扫描 |
| D12 | 个人服务器范围与 `sources.json` 真实性 | 无争议（补充细化） | 私服内部使用不免除 `sources.json` 登记；非自制/未获公开授权素材仍须如实填 `"redistributable": false` |
| D13 | 64 位整数除法的取整语义分配 | 低争议（校验补漏） | 区分向零截断 `/` 与向下取整 `div_floor`：坐标转像素必须用 `div_floor` 防止原点附近出现双倍宽像素桶 |

---

## 逐条审查详情

### D1 · 技能动作 ID 命名
- **当前决策（未改动）**：技能动作保留 `skill_` 前缀，即 `skill_01`、`skill_02`、`skill_03`、`skill_ultimate`。
- **对应规格依据**：
  - `part1_overview.md` §7 命名规范表第 5 行：「动画 ID（目录与 JSON）：Action 名去掉前缀并小写，示例 `idle`、`light_01`」。
  - `part1_overview.md` §7 命名规范表第 6 行：「技能动作：`Skill_01`、`Skill_02`、`Skill_03`、`Skill_Ultimate` → 示例 `skill_ultimate`」。
  - `part1_overview.md` §9.3 `SkillDefinition` 示例：`"input": "skill_01"`, `"move_id": "skill_01"`。
- **潜在冲突**：
  1. 若对 `Skill_01` 机械套用「去掉前缀」，会变成纯数字 `"01"`，可读性与标识性极差。
  2. `part1_overview.md` §8 目录结构示意图（第 138 行）写的是 `animations/ idle/ walk_forward/ light_01/ ultimate/`（漏了 `skill_` 前缀），与 §7 表格示例 `skill_ultimate` 不一致。
- **建议修改（无争议）**：维持当前决策（`Core_`、`Combat_`、`Presentation_` 去前缀，`Skill_` 保留 `skill_` 前缀）；将 §8 目录示意图中的 `ultimate/` 视为排版简写。角色若有核心清单之外的专属技能动作（如 `Skill_Moon_Slash`），动画 ID 同样保留 `skill_` 前缀（`skill_moon_slash`），并在 `AnimationDefinition` 中设 `animation_type: "skill"`（或 `"extra"`，建议统一用 `"skill"`）。

---

### D2 · 核心动作怎样算「已实现」
- **当前决策（未改动）**：存在 `metadata/<id>.json` 即视为已实现；属于攻击类（`light_01`、`light_02`、`medium_01`、`heavy_01`、`air_attack`、`throw`）和技能类（`skill_01`..`skill_ultimate`）的动作，还必须存在 `framedata/<id>.json`。
- **对应规格依据**：
  - `part1_overview.md` §7「统一核心动作清单」（共 25 个动作）及 §9.5「核心动作清单中的每一项要么存在，要么在 `unsupported_core_moves` 中声明」。
  - `part1_overview.md` §9.2「判定事件（攻击框开关、取消窗口、无敌帧、投射物生成）只写在 FrameData」。
  - `part3_runtime_roadmap.md` §4 状态机转换表：「`DASH`：按角色配置可取消进入攻击」「`KNOCKDOWN`：动画结束 → `WAKEUP` → `IDLE`（起身可配置无敌帧）」。
- **潜在冲突**：
  1. 起身动作 `wakeup` 需要配置「起身无敌帧」，冲刺 `dash` 需要配置「取消窗口 / 无敌帧 / 持续帧数」。由于 D8 规定 `invuln_frames` 和 `cancel_windows` **只能写在 FrameData**，如果 `wakeup` 和 `dash` 没有对应的 `framedata/wakeup.json`、`framedata/dash.json`，这些数据将无处安放。
  2. 当前 `validate.py` 允许非攻击动作拥有可选的 `framedata/<id>.json`，但 D2 文字未说明这一点。
  3. 渲染管线接入后（检查点 2），除了 `metadata/<id>.json` 与 `animations/<id>/frame_NNN.png` 外，还需明确打包后的 `sprites/` 图集何时纳入必填检查。
- **建议修改（低争议）**：保持攻击类与技能类强制要求 `framedata/<id>.json`；在 D2 中明确 **`dash` 与 `wakeup` 允许（并在配置无敌帧或取消窗口时必须）提供 `framedata/dash.json` / `framedata/wakeup.json`**；打包图集检查在 `pack_sprites.py` 完成后作为 `--check-sprites` 或默认资产检查加入。

---

### D3 · FrameData 帧编号的起点与区间语义
- **当前决策（未改动）**：FrameData 的帧编号从 `0` 开始，前摇占 `[0, startup-1]`，有效帧为 `[startup, startup+active-1]`。
- **对应规格依据**：
  - `part1_overview.md` §9.3 `framedata/light_01.json`：`startup: 5, active: 3, recovery: 9`，`hitboxes[0].frames: [5, 7]`（5、6、7 共 3 帧，恰好等于 `active: 3`）。
  - `part1_overview.md` §7 帧文件从 `frame_000.png` 起；§9.3 `AnimationDefinition` 示例 `frame_count: 12`、`presentation_events[0].frame: 4`。
- **潜在冲突**：
  1. 原文只写了起点为 `0`，没有用黑体写明 JSON 中的 `[start, end]` 是**闭区间 `[start, end]`** 还是半开区间 `[start, end)`。若运行时误按 Python `range(5, 7)` 解析，`[5, 7]` 会少算第 7 帧，导致 `active=3` 实际只有 2 帧判定。
  2. 当某个招式不直接带近战攻击框（如远程起手 `active: 0` 或纯位移技能 `startup: 0`）时，`[0, startup-1]` 退化为空区间，代码不可直接构造闭区间循环而不判空。
- **建议修改（无争议）**：补充两条硬约定：① 所有 FrameData 帧区间 `[a, b]`（含 `hitboxes[].frames`、`cancel_windows[].frames`、`invuln_frames[]`、`armor_frames[]`、`hurtbox_override[].frames`）均为 **0 起点闭区间，即满足 `a <= tick <= b` 时生效**，招式总模拟帧数 `total = startup + active + recovery`（有效 tick 范围 `0 .. total - 1`）；② 当 `startup == 0`、`active == 0` 或 `recovery == 0` 时表示该阶段占 0 帧。

---

### D4 · 矩形坐标系、水平镜像与物理符号约定（需拍板）
- **当前决策（未改动）**：`[x, y, w, h]` 均为整数（`1px = 1000`），原点在脚底，面向右；`y` 轴向下（与 Godot 2D 一致），因此身体部位的 `y` 为负数。
- **对应规格依据**：
  - `part1_overview.md` §9.3：`1 像素 = 1000 单位`；`character.json` 中 `"jump_velocity": 14000, "gravity": 700`（均为正整数）；`light_01.json` 中 `"rect": [20000, -90000, 60000, 40000]`，「`rect` 为相对角色脚底、面向右侧时的本地偏移，向左时由运行时按 `facing_direction` 镜像，不在数据里写两份」。
  - `part3_runtime_roadmap.md` §5：「全部为整数矩形，检测用整数 AABB 相交。镜像按 `facing_direction` 在运行时计算」。
- **潜在冲突**：
  1. **朝左镜像公式易错点**：面向右（`facing = +1`）时，本地矩形 `[x, y, w, h]` 在世界坐标横轴覆盖 `[pos_x + x, pos_x + x + w]`。当角色面向左（`facing = -1`）沿 `x = 0` 轴镜像时，横轴区间变为 `[pos_x - x - w, pos_x - x]`，即**镜像后的左上角横坐标必须是 `world_x = pos_x - x - w`**（宽度仍为 `w`），而绝不能写成 `pos_x - x`（否则所有朝左攻击框会整体向右偏出一个 `w` 的宽度）。击退 `knockback: [kx, ky]` 同理：攻方朝右命中时守方受 `+kx`，朝左命中时守方受 `-kx`（角落反推除外）。
  2. **AABB 边界接触算不算相交**：两个矩形边缘恰好贴合（`r1.x + r1.w == r2.x`）时，若算相交（`<=`），身体挤压盒（pushbox）推开到贴合位置后下一帧仍会被判为相交并继续推开，产生 1 单位抖动；若采用**严格重叠（`<`）**，推开至 `r1.x + r1.w == r2.x` 即处于稳定接触态。
  3. **Y 轴方向与 `jump_velocity` 正负号**：`y` 轴向下意味着地面 `ground_y = 0`、空中 `pos_y < 0`；而 `character.json` 示例写的是正数 `"jump_velocity": 14000`、`"knockback": [4000, 0]`。如果不统一约定 JSON 中纵向速度/浮空击退的正负号含义，浮空招式很容易写反方向。
- **建议修改（需你确认）**：
  1. 锁定镜像公式：`facing == +1` 时 `world_rect = [pos_x + x, pos_y + y, w, h]`；`facing == -1` 时 `world_rect = [pos_x - x - w, pos_y + y, w, h]`。
  2. 锁定 AABB 相交为**严格重叠**：`a.x < b.x + b.w and b.x < a.x + a.w and a.y < b.y + b.h and b.y < a.y + a.h`。
  3. 锁定纵向符号：`stats.jump_velocity` 与 `stats.gravity` 在 JSON 中填正整数（标量大小），起跳时赋 `vel_y = -jump_velocity`，每帧空中 `vel_y += gravity`，`pos_y >= 0` 视为落地并钳制回 `0`；而 `knockback: [kx, ky]` 作为带符号向量，`kx > 0` 表示沿攻击方向推开，**`ky < 0` 表示向上击飞浮空**（与 `rect.y < 0` 向上完全一致）。

---

### D5 · Hitstop 写在哪里与是否必填（需拍板）
- **当前决策（未改动）**：每个 `hitbox`（以及 `projectile_spawn[].hit`）都**必须**写 `hitstop` 字段（`validate.py` 缺失即报错）。
- **对应规格依据**：
  - `part3_runtime_roadmap.md` §8：「Hitstop：命中后双方冻结若干模拟帧（轻 6、中 8、重 10，初始建议；**数值写在 FrameData 命中数据里**）」。
  - `part1_overview.md` §9.3 `framedata/light_01.json` 示例（第 249–252 行）：写了 `damage`、`knockback`、`hitstun`、`blockstun`、`air_hit`、`priority`，**未出现 `hitstop` 字段**。
- **潜在冲突**：
  1. **规格内部示例冲突**：拿 `part1_overview.md` 第 240–259 行的官方示例原封不动喂给当前 `validate.py`，会因缺少 `hitstop` 报 `FIELD_INVALID` 错误。
  2. **命中停顿 vs 防御停顿**：格斗游戏中被防御时的停顿帧数（`blockstop` / `block_hitstop`）有时与命中不同；目前未规定防御时是否共用 `hitstop`，还是允许可选字段 `block_hitstop`。
  3. **必杀技定格（Super Freeze）位置未定**：`part3_runtime_roadmap.md` §8 同时提到「必杀技暂停（Super Freeze）：必杀技发动时的定格帧数，作为模拟暂停处理，长度固定」，尚未约定该帧数写在必杀技的 `FrameData`（如 `super_freeze: { frame: 0, duration: 30 }`）还是 `SkillDefinition`。按 `part1` §9.2「影响模拟判定的帧事件归 FrameData」，应归 `FrameData`。
- **建议修改（需你确认，二选一）**：
  - **方案 A（推荐）**：维持 `hitstop` 在每个命中数据中**必填**（把 `part1` §9.3 视为节选示例），防止配表漏填导致打击感缺失；同时支持可选整数字段 `block_hitstop`（省略时默认等于 `hitstop`），并在 `FrameData` 预留可选 `super_freeze` 对象（Phase 2 启用）。
  - **方案 B**：将 `hitstop` 改为可选字段，省略时报错警告或回退为 `0`。

---

### D6 · 身体碰撞盒（pushbox）与场地/角落规则位置（需拍板）
- **当前决策（未改动）**：身体碰撞盒与受击框放在一起，写在 `framedata/hurtboxes.json` 的 `<配置名>.pushbox.{stand,crouch,air}`。
- **对应规格依据**：
  - `part1_overview.md` §9.1：`FighterDefinition` 包含「受击框配置」（示例 `"hurtboxes": "hurtbox_default"`）。
  - `part3_runtime_roadmap.md` §3：「场地有左右边界；角色之间有身体碰撞盒（pushbox），互相挤压时按整数规则推开；角落受击时的反推规则写成数据」。
  - `part3_runtime_roadmap.md` §5：「受击框：来自角色目录 `framedata/hurtboxes.json` 的配置……按状态区分站立 / 下蹲 / 空中 / 倒地」。
- **潜在冲突**：
  1. **倒地（`KNOCKDOWN`）状态的 pushbox 未定义**：当前 `hurtboxes.json` 的受击框有 4 个状态（`stand`/`crouch`/`air`/`down`），但 `pushbox` 只定义了 3 个状态（`stand`/`crouch`/`air`）。角色处于 `KNOCKDOWN` 或 `WAKEUP` 时，是用 `stand` 的 pushbox（防止对手穿模站进倒地角色身体里导致起身重叠），还是缩小/关闭 pushbox？必须明确，否则起身帧会出现双方坐标完全重合的极端情况。
  2. **角落受击反推与全局战斗参数没有落盘位置**：`part3_runtime_roadmap.md` §3 要求「角落受击时的反推规则写成数据」，§6 要求「缓冲帧数做成全局配置」，§7 要求「伤害递减表」。这些属于**跨 IP 通用战斗规则数据**，不能写进具体 IP 目录，也不应硬编码在 GDScript 常量里。
- **建议修改（需你确认）**：
  1. `pushbox` 继续放在 `framedata/hurtboxes.json`，并补充 **`down` 状态也保留窄身体碰撞盒 `pushbox.down`**（或在模拟规则中规定倒地沿用 `pushbox.crouch`），避免对手与倒地角色完全重合导致起身左右朝向翻转抖动。
  2. 在 `combat/` 下新增一份与 IP 无关的全局规则数据文件（如 `combat/combat_config.json`，Phase 1 建立），集中存放场地默认宽度、角落反推系数、输入缓冲帧数、伤害递减表等全局模拟参数。

---

### D7 · 投射物的伤害数据拆分与引用链
- **当前决策（未改动）**：`FrameData.projectile_spawn[].hit` 负责伤害与硬直，`SkillDefinition.projectile` 负责特效、速度和寿命。
- **对应规格依据**：
  - `part1_overview.md` §9.1：`FrameData` 唯一负责「伤害、击退、硬直……投射物生成」；`SkillDefinition` 负责「输入方式、消耗、冷却、类型、引用的 animation_id 与 framedata」。
  - `part1_overview.md` §9.2：「伤害、击退、硬直只写在 FrameData」「判定事件（……投射物生成）只写在 FrameData」。
  - `part1_overview.md` §9.3 `skills/energy_bolt.json`：`"move_id": "skill_01", "projectile": { "effect": "effects/energy_bolt", "speed": 9000, "lifetime": 90 }`。
  - `part3_runtime_roadmap.md` §5：「投射物：模拟层的独立实体，有自己的矩形、速度、生命周期和命中数据（由 SkillDefinition 与 FrameData 的 `projectile_spawn` 定义）」。
- **潜在冲突**：
  1. `part1` §9.1 文字提到 SkillDefinition 引用「`animation_id` 与 `framedata`」，但 §9.3 JSON 示例只写了 `"move_id": "skill_01"`（由 `framedata/skill_01.json` 再指向 `"animation_id": "skill_01"`）。单向链 `Skill -> move_id -> FrameData -> animation_id` 更好，避免了在两个文件里重复写 `animation_id`。
  2. 目前 `SkillDefinition.projectile.speed` 只支持单个整数（默认水平飞行），若 Phase 2/4 出现斜向投射物（如空中斜下发射法球）、多发扇形弹幕或可穿透多段弹道（`max_hits`），单标量 `speed` 不够表达。
- **建议修改（低争议）**：维持当前拆分（最严格符合 §9.2 与 §9.3 示例），明确技能统一通过 `move_id` 关联 `FrameData`；到 Phase 2 实现技能系统时，允许 `SkillDefinition.projectile` 可选支持 `velocity_y`（默认 `0`）与 `max_hits`（默认 `1`）。

---

### D8 · 「同一数值不在多个文件重复」的校验方式（需拍板）
- **当前决策（未改动）**：用**字段键名归属（`KEY_OWNERS`）**实现：伤害、硬直、帧数相关键只能出现在 `FrameData`，`cooldown`/`cost` 只能出现在 `SkillDefinition`，基础属性键只能出现在 `FighterDefinition`；`gravity` 暂不纳入检查。
- **对应规格依据**：
  - `part1_overview.md` §9.2「防止重复写数据的规则」全部 5 条。
  - `part3_runtime_roadmap.md` §7 第 146 行：「能量条随命中、被击、防御增长，数值写在 FighterDefinition **或**技能配置中」。
- **潜在冲突**：
  1. **按「字段归属」而非「数值相等」校验是必须的**（否则 `damage: 30` 与 `animation_fps: 30` 会因同为 `30` 误报），但当前 `KEY_OWNERS` 漏管了两个地方：
     - `animation_id` 若同时写在 `SkillDefinition` 和 `FrameData` 中，属于重复引用定义，当前未拦截。
     - **能量获取（meter gain）归属未定**：`part3` §7 写了「FighterDefinition **或**技能配置」，但按 `part1` §9.2 精神，同一职责不应允许两处任选，否则校验器无法做唯一归属检查。
  2. `gravity` 不纳入检查会留下口子：若有人误在 `SkillDefinition` 里写 `"gravity": 700` 不会报错。
- **建议修改（需你确认）**：
  1. 将 `gravity` 收归 `FighterDefinition` 独占；未来投射物若需重力，字段名定为 `projectile_gravity`（归 `SkillDefinition`）。
  2. 禁止在 `SkillDefinition` 中出现 `animation_id`（统一经 `move_id` 查 `FrameData.animation_id`）。
  3. 明确能量相关字段的唯一归属（Phase 2 启用）：角色默认能量上限与基础受击/防御回能比例归 `FighterDefinition`，单次招式命中/挥空的固定回能值（如 `meter_gain_on_hit` / `meter_gain_on_block`）归 `FrameData`（与 `damage` 同处），`SkillDefinition` 只管释放消耗 `cost`。

---

### D9 · 测试内容包 `ip_content/test_pack/`
- **当前决策（未改动）**：占位测试角色放在 `ip_content/test_pack/`，`ip.json` 增加 `"test_only": true`，正式版 UI 隐藏。
- **对应规格依据**：
  - `part3_runtime_roadmap.md` §13 Phase 1：「两个测试角色（占位素材，放在独立的测试内容包并在 `sources.json` 标明占位）」。
  - `part1_overview.md` §9.3 `ip.json`：`status` 取 `"open"` 或 `"locked"`。
- **潜在冲突**：
  1. `test_only` 是规格示例外的扩展布尔字段；若运行时 `DataLoader` 只看 `status == "open"` 而不识别 `test_only`，测试包会混入正式选角界面。
  2. 当前 `test_pack` 中的 `dummy_b` 含有投射物技能 `test_bolt`（用于覆盖 `validate.py` 对 `SkillDefinition` 的单元测试），而规格 Phase 1 范围只要求「移动、跳跃、普攻、防御、受击、生命值、胜负」，技能属于 Phase 2。
- **建议修改（无争议）**：保持 `test_only: true` 设计；规定运行时 `DataLoader.list_ips(include_test := false)` 默认排除 `test_only == true` 的内容包（仅测试入口与开发调试显式传 `true`）；Phase 1 对局闭环只要求执行基础动作（`dummy_b` 的 `skill_01` 数据保留供校验器测试，Phase 2 再接入技能触发）。

---

### D10 · `sources.json` 素材登记的匹配规则
- **当前决策（未改动）**：`sources.json.entries[].path` 是相对于角色目录（或 IP 目录）的通配符，用 `fnmatch` 匹配，`*` 可以跨越 `/`；IP 级目录（`stages`/`effects`/`audio`）里有文件时，必须在 IP 根目录提供 `sources.json`。
- **对应规格依据**：
  - `part1_overview.md` §6：「每个角色目录下放 `metadata/sources.json`，记录每项资源的来源、作者、授权类型、是否可公开分发。资源检查报告中缺少登记即报错」。
  - `part1_overview.md` §9.5：「`sources.json` 覆盖该角色全部素材」；`part2_art_pipeline.md` §8：「缺少 `sources.json` 或未覆盖全部素材 → 错误」。
- **潜在冲突**：
  1. **IP 根目录封面漏检**：`ip.json` 引用的 `cover.png` 位于 `ip_content/<ip>/cover.png`，不在 `stages/`、`effects/`、`audio/` 三个子目录内，当前 `validate.py` 的 `IP_ASSET_DIRS` 未覆盖它。
  2. **宽泛通配符掩盖新增第三方素材**：对管线自动批量生成的目录（如 `animations/*`、`sprites/*`）或带 `"placeholder": true` 的测试包，用 `*` 通配很合理；但对正式角色的 `model/`、`textures/`、`blender/`、`audio/`，若一条 `"textures/*"` 通配到底，后续混入不同来源贴图时校验器不会提醒补登来源。
- **建议修改（低争议）**：
  1. 将 `ip_content/<ip>/` 根下的图像/音频文件（如 `cover.png`）一并纳入 IP 级 `sources.json` 覆盖检查。
  2. 当条目未标记 `"placeholder": true` 时，仅允许对管线派生目录（`animations/*`、`sprites/*`）使用目录级 `*` 通配；对源资产目录（`blender/`、`model/`、`textures/`、`previews/`、`audio/`）使用宽泛 `*` 时输出 `WARNING` 提示逐项或按制作批次登记。

---

### D11 · 核心代码禁止出现 IP 字符串的检查范围（需拍板）
- **当前决策（未改动）**：扫描 `core combat fighter hit_system skill_system combo_system animation ai_system network ui` 十个目录（不查 `tests/` 和 `asset_pipeline/`）。禁用词收集自所有 `ip_content` 下的 IP `id`、角色 `id`、角色目录名和中英文显示名；ASCII 词按词边界、不区分大小写匹配，长度不足 3 的忽略。
- **对应规格依据**：
  - `part1_overview.md` §2 原则 2：「引擎与 IP 内容彻底分离：核心代码中不得出现任何 IP 的角色名、技能逻辑或资源路径」。
  - `part1_overview.md` §4：「依赖方向：IPContent 只被『数据加载器』读取，Combat 及以下模块不得反向依赖任何具体 IP」。
  - `part1_overview.md` §9.5：「核心代码目录（`core/`、`combat/` 等）中不包含任何 IP 相关字符串」。
- **潜在冲突**：
  1. **英文常见词角色名的误报风险（高概率）**：明日方舟或其他动漫 IP 中存在大量与通用英文单词/编程术语重名的干员或角色，例如 `Red`（红，`Color.RED`）、`Ash`（灰烬）、`Frost`（霜星/Frost，`frost`）、`Blaze`、`Dusk`、`Spot`、` Fang` 等。因为当前规则对 `name_en` 与角色目录名做**不区分大小写的单词边界匹配**，一旦后续加入名为 `Red` 的角色，核心 UI 代码里写 `Color.RED` 就会立刻触发 `IP_STRING_IN_CORE` 误报！
  2. **目录覆盖缺口**：若未来在仓库根目录新增启动场景或数据加载器目录（如 `main.tscn`、`data_loader/`、`project.godot`），不在上述 10 个子目录硬编码列表内，可能漏检。
- **建议修改（需你确认）**：
  1. **扫描目录扩充**：除了排除列表（`ip_content/`、`tests/`、`asset_pipeline/`、`addons/`、`docs/`、`.venv/`、`.cache/`、`.git/`）之外，仓库内其余所有 `.gd`、`.tscn`、`.tres`、`.gdshader`、`project.godot` 全部纳入核心代码扫描。
  2. **禁用词分级精准匹配**（消除 `Color.RED` 类误报）：
     - **无条件严禁（不区分大小写）**：所有 `ip_id`（如 `arknights`）、完整 `ip.char` ID（如 `arknights.red`）、路径片段 `characters/<char_dir>`、以及所有非 ASCII 显示名（如 `阿米娅`、`陈`）。
     - **纯英文单词形式的 `name_en` / 短目录名**：若与引擎常见保留词冲突，改为匹配引号内字面量或要求长度/前缀，或维护一份极简的引擎术语白名单（如 `RED`），既彻底堵死硬编码角色逻辑，又不阻塞正常使用 `Color.RED`。

---

### D12 · 个人服务器使用范围与版权登记
- **当前决策（未改动）**：本项目只部署在个人服务器上，不对外传播、不商用（用户 2026-11-24 确认）；`sources.json` 登记照常维护，因为它也是素材清单。
- **对应规格依据**：
  - `part1_overview.md` §6「版权与素材来源」；用户 2026-11-24 确认第 9 条。
- **潜在冲突**：无冲突，但需防止在后续制作正式 IP 角色时把 `sources.json` 中的 `"redistributable"` 习惯性写成 `true`（`test_pack` 写 `true` 是因为它是本仓库程序自生成的几何占位符）。
- **建议修改（无争议）**：补充说明——正式 IP 角色（如阿米娅、陈）的 `sources.json` 必须如实填写来源与授权状态，凡涉及受版权保护 IP 形象或未获公开再分发授权的素材，`"redistributable"` 一律填 `false`。

---

### D13 · 整数除法的取整语义与溢出边界
- **当前决策（未改动）**：GDScript 的 `/` 向零截断，`%` 结果与被除数同号；模拟层需要向下取整时，统一使用工具函数（Phase 1 在 `core/` 中提供）。
- **对应规格依据**：
  - `part3_runtime_roadmap.md` §2：「位置、速度、伤害等全部用整数（1 像素 = 1000 单位）；除法用整数除并固定取整方式」。
  - `part3_runtime_roadmap.md` §9：「显示帧序号 = `(anim_tick * animation_fps) / 60`（整数除法，向下取整）」「显示位置 = 模拟位置 ÷ 1000，再加上图集裁边偏移与 pivot 偏移，保证脚底不抖动」。
  - `tests/unit/test_gut_smoke.gd` 实测：GDScript 64 位有符号整数 `-7 / 2 == -3`（向零截断），`posmod(-7, 2) == 1`。
- **潜在冲突**：
  1. **负坐标转像素时的原点不对称抖动**：若表现层直接写 `sim_x / 1000`（向零截断），则 `sim_x` 在 `[-999, +999]`（宽度 `1999`）区间内都会映射到像素 `0`，而在 `[1000, 1999]` 宽度只有 `1000`！角色跨过 `x = 0` 时会出现 1 像素的停滞跳变。使用**向下取整 `div_floor(sim_x, 1000)`**（即 `(sim_x - posmod(sim_x, 1000)) / 1000`）则每个像素桶严格等宽 `1000`（`[-1000, -1] -> -1`，`[0, 999] -> 0`）。
  2. **GDScript `INTEGER_DIVISION` 警告与隐式浮点风险**：在 GDScript 中两个 `int` 相除若开启严格警告会报 `INTEGER_DIVISION`，而若任一操作数退化为未标注类型的 `Variant`/`float` 则会静默变成浮点除法，破坏确定性！
- **建议修改（低争议）**：在 Phase 1 `core/` 定点数工具中同时提供强类型函数 `div_trunc(a: int, b: int) -> int` 与 `div_floor(a: int, b: int) -> int`（内部统一处理 `INTEGER_DIVISION` 注解并断言 `b != 0`），并明确约定：
  - **坐标换算（`sim -> px`）**：统一用 `div_floor(val, 1000)`（或在启用平滑显示时仅在表现层转 `float(val) / 1000.0`，不写回模拟层）。
  - **非负帧号映射与伤害百分比（`>= 0`）**：`(anim_tick * fps) / 60` 与 `(damage * pct) / 100` 因被除数非负，两种取整等价，统一走整数工具函数禁止裸 `/` 混用 `Variant`。
