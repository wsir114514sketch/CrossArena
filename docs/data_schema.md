# Cross Arena 数据 Schema 与校验规范

状态：**正式规范（与 `asset_pipeline/validate.py` 及 `docs/decisions.md` 同步锁定）**

本文件定义 `ip_content/` 下全部数据文件、跨 IP 全局战斗规则文件 `combat/combat_config.json`、字段唯一归属矩阵（D8）以及核心代码 IP 隔离检查规则（D11）。新增任何 IP 或角色只需按本规范提供数据与资产包，无需修改引擎核心代码。

---

## 1. 全局命名与数值约定

1. **目录与文件名**：`ip_content/` 下所有目录名与文件名仅允许小写 ASCII 字符 `[a-z0-9_.]`（正则 `^[a-z0-9_]+(\.[a-z0-9_]+)*$`），帧序列文件固定为 `frame_000.png` 起三位补零连续编号。
2. **定点数与帧单位**：
   - 模拟频率固定 **60Hz**（1 模拟帧 = 1 tick）。
   - 长度/位置/速度单位：**`1 像素 = 1000 模拟单位`**，全部使用 64 位有符号整数（禁止浮点数进入模拟层字段；`bool` 不视为 `int`）。
   - 矩形格式：**`[x, y, w, h]`**（4 个整数，`w > 0, h > 0`），原点 `(0, 0)` 为角色脚底地面锚点，面向右侧（`facing = +1`），`+X` 向右、**`+Y` 向下**（地面 `y = 0`，角色头顶方向 `y < 0`）。
   - 面向左侧（`facing = -1`）时的水平镜像公式：`world_rect = [pos_x - x - w, pos_y + y, w, h]`。
   - 整数 AABB 相交判定（严格重叠）：`a.x < b.x + b.w and b.x < a.x + a.w and a.y < b.y + b.h and b.y < a.y + a.h`。
   - 帧区间 `[start, end]`：**0 起点闭区间**（`0 <= start <= end < total`，当 `start <= tick <= end` 时生效）。

---

## 2. 文件级 Schema 定义

### 2.1 `ip_content/<ip>/ip.json`（IPDefinition）

| 字段 | 类型 | 必填 | 约束与说明 |
|---|---|---|---|
| `id` | `string` | 是 | 匹配 `^[a-z0-9_]+$`，必须与所在目录名 `<ip>` 完全一致 |
| `name_zh` | `string` | 是 | 中文名称 |
| `name_en` | `string` | 是 | 英文名称 |
| `cover` | `string` | 是 | 相对 `<ip>/` 的封面图路径（资产模式下文件必须存在，且须登记于 `<ip>/sources.json`） |
| `description` | `string` | 是 | IP 简介 |
| `featured_characters` | `string[]` | 是 | 代表角色完整 ID 列表（每项必须在该 IP `characters/` 下真实存在） |
| `status` | `string` | 是 | `"open"` 或 `"locked"` |
| `test_only` | `bool` | 否 | 为 `true` 时表示测试专用包，正式选角界面默认隐藏（D9） |

---

### 2.2 `ip_content/<ip>/characters/<char>/character.json`（FighterDefinition）

**独占归属字段**：`stats`、`max_hp`、`walk_speed`、`jump_velocity`、`defense`、`gravity`、`max_gauge`、`gauge_gain_on_hurt_pct`、`gauge_gain_on_block_pct`。禁止出现 `animation_id`。

| 字段 | 类型 | 必填 | 约束与说明 |
|---|---|---|---|
| `id` | `string` | 是 | 必须等于 `"<ip>.<char>"` |
| `ip_id` | `string` | 是 | 必须等于 `"<ip>"` |
| `name_zh` / `name_en` | `string` | 是 | 非空显示名 |
| `portrait` / `splash` | `string` | 是 | 相对角色目录的头像与立绘路径 |
| `stats.max_hp` | `int` | 是 | `> 0`，最大生命值 |
| `stats.walk_speed` | `int` | 是 | `> 0`，每模拟帧水平移动距离（模拟单位） |
| `stats.jump_velocity` | `int` | 是 | `> 0`，起跳初速度标量（起跳时模拟层赋 `vel_y = -jump_velocity`） |
| `stats.gravity` | `int` | 是 | `> 0`，空中每模拟帧重力加速度（每帧 `vel_y += gravity`） |
| `stats.defense` | `int` | 是 | `>= 0`，基础防御系数（`100` 为标准值） |
| `stats.max_gauge` | `int` | 否 | `> 0`，角色能量槽上限（Phase 2 启用，省略时使用全局默认值） |
| `stats.gauge_gain_on_hurt_pct` | `int` | 否 | `>= 0`，受击回能百分比系数 |
| `stats.gauge_gain_on_block_pct` | `int` | 否 | `>= 0`，防御回能百分比系数 |
| `height_scale` | `number` | 是 | `> 0`，视觉比例参数（表现参考） |
| `hurtboxes` | `string` | 是 | 对应 `framedata/hurtboxes.json` 中的配置键名（如 `"hurtbox_default"`） |
| `skills` | `string[]` | 是 | 相对角色目录的技能文件路径列表（如 `"skills/energy_bolt.json"`） |
| `unsupported_core_moves` | `string[]` | 是 | 未实现的统一核心动作名列表（仅允许填 25 个核心动作清单内的名字） |
| `base_character_id` | `string` | 否 | 派生/觉醒形态指向基础角色完整 ID（如 `"<ip>.<base_char>"`），选人界面据此聚合同一角色的多形态 |
| `forms` | `string[]` | 否 | 基础角色拥有的可选/觉醒形态完整 ID 列表（每项须在同一 IP `characters/` 下存在） |
| `form_name_zh` / `form_name_en` | `string` | 否 | 形态显示名（如 `"常态"` / `"仙人模式"` / `"卍解"`） |
| `resource_metadata` | `object` | 否 | 资源溯源与完整度摘要（`origin_repo`、`completeness`、`authorization_status`、`sprite_scale` 等） |
| `ai_profile` | `object` | 否 | 各项键值均为 `[0, 1]` 区间内的数值 |
| `bio` | `string` | 否 | 角色简介 |

---

### 2.3 `metadata/<anim>.json`（AnimationDefinition）

负责纯表现信息，**严禁包含 `combat_events` 或任何判定/数值字段**。

| 字段 | 类型 | 必填 | 约束与说明 |
|---|---|---|---|
| `animation_id` | `string` | 是 | 必须等于文件名 `<anim>` |
| `character_id` | `string` | 是 | 必须等于 `"<ip>.<char>"` |
| `animation_type` | `string` | 是 | `"core"` \| `"combat"` \| `"skill"` \| `"presentation"` \| `"extra"`（核心动作必须与其所属分类一致） |
| `source_frames` | `string` | 是 | 原始 PNG 序列目录（如 `"animations/light_01/"`） |
| `source_frames_left` | `string` | 条件 | 当 `facing_mode == "dual"` 时必填 |
| `frame_count` | `int` | 是 | `> 0`；对应模拟帧容量 `sim_length = ceil(frame_count * 60 / animation_fps)` |
| `animation_fps` | `int` | 是 | `1 .. 60`（常规 `30` 或 `60`） |
| `loop` | `bool` | 是 | 是否循环播放 |
| `facing_mode` | `string` | 是 | `"flip"`（水平翻转）或 `"dual"`（左右独立素材） |
| `canvas_size` | `[int, int]` | 是 | `[w, h]`，同一角色的所有动画必须完全一致 |
| `pivot` | `[int, int]` | 是 | 画布内坐标 `0 <= x < w, 0 <= y < h` |
| `ground_anchor` | `[int, int]` | 是 | 脚底地面锚点像素坐标，画布内 |
| `presentation_events` | `object[]` | 否 | 每项含 `frame`（`0 .. frame_count - 1` 动画帧序号）与 `type`（`sfx`/`vfx`/`voice`/`camera_shake`/`flash`） |

---

### 2.4 `framedata/<move>.json`（FrameData）

战斗判定的**唯一来源**。攻击动作与技能动作必填；`dash` 与 `wakeup` 可选提供（用于配置冲刺取消窗口或起身无敌帧）。

| 字段 | 类型 | 必填 | 约束与说明 |
|---|---|---|---|
| `move_id` | `string` | 是 | 必须等于文件名 `<move>` |
| `animation_id` | `string` | 是 | 必须在 `metadata/<animation_id>.json` 中存在，且 `startup + active + recovery <= sim_length` |
| `startup` | `int` | 是 | `>= 0`，前摇模拟帧数 |
| `active` | `int` | 是 | `>= 0`，有效模拟帧数 |
| `recovery` | `int` | 是 | `>= 0`，收招模拟帧数；三者之和 `total > 0` |
| `hitboxes` | `Hitbox[]` | 否 | 攻击框列表（默认 `[]`） |
| `cancel_windows` | `CancelWindow[]` | 否 | 取消窗口列表：`{"frames": [a, b], "into": [...]}`，`into` 元素须为本角色已有 `move_id` 或关键字 `"skill"` / `"ultimate"` |
| `invuln_frames` | `[int, int][]` | 否 | 无敌帧闭区间列表 |
| `armor_frames` | `[int, int][]` | 否 | 霸体帧闭区间列表 |
| `hurtbox_override` | `object[]` | 否 | 按帧覆盖受击框：`{"frames": [a, b], "rects": [[x, y, w, h], ...]}` |
| `projectile_spawn` | `ProjectileSpawn[]` | 否 | 投射物生成事件列表：`{"frame": int, "offset": [ox, oy], "rect": [x, y, w, h], "hit": HitSpec}` |
| `super_freeze` | `object` | 否 | 必杀技定格：`{"frame": int, "duration": int}`（`0 <= frame < total`, `duration > 0`） |
| `move_velocity` | `object[]` | 否 | 招式位移速度区间列表：`{"frames": [a, b], "vel": [vx, vy]}`（模拟单位/帧，`vx` 随朝向翻转） |
| `meter_gain_on_whiff` | `int` | 否 | `>= 0`，招式挥空固定回能值 |

#### `HitSpec` / `Hitbox` 字段（用于 `hitboxes[]` 与 `projectile_spawn[].hit`）

| 字段 | 类型 | 必填 | 约束与说明 |
|---|---|---|---|
| `frames` | `[int, int]` | 仅 `hitboxes[]` | 闭区间 `[a, b]`，超出 `[startup, startup + active - 1]` 时报警告 `HITBOX_OUTSIDE_ACTIVE` |
| `rect` | `[int, int, int, int]` | 仅 `hitboxes[]` | 本地攻击框 `[x, y, w, h]` |
| `hit_index` | `int` | 否 | `>= 0`，多段攻击段号（默认 `0`；同段号对同一目标只命中一次） |
| `damage` | `int` | 是 | `>= 0`，基础伤害 |
| `knockback` | `[int, int]` | 是 | `[kx, ky]`，`kx > 0` 向对手后方推开，`ky < 0` 向上击飞 |
| `hitstun` | `int` | 是 | `>= 0`，命中硬直帧数 |
| `blockstun` | `int` | 是 | `>= 0`，防御硬直帧数 |
| `hitstop` | `int` | **是** | `>= 0`，命中冻结帧数（D5 强制必填） |
| `block_hitstop` | `int` | 否 | `>= 0`，被防御时的冻结帧数；省略时运行时取 `hitstop` |
| `air_hit` | `bool` | 是 | 是否允许命中空中目标 |
| `priority` | `int` | 是 | `>= 0`，同帧互打判定优先级（相同则互打 Trade） |
| `guard_type` | `string` | 否 | `"mid"`（默认，站防蹲防皆可）\| `"overhead"`（中段，破蹲防）\| `"low"`（下段，破站防）\| `"unblockable"` \| `"throw"` |
| `knockdown` | `bool` | 否 | 命中后是否直接强制击倒 |
| `guard_break` | `bool` | 否 | 防御命中时是否直接触发破防硬直 |
| `chip_damage` | `int` | 否 | `>= 0`，被防御时的磨血伤害 |
| `meter_gain_on_hit` | `int` | 否 | `>= 0`，命中回能值 |
| `meter_gain_on_block` | `int` | 否 | `>= 0`，被防御回能值 |

---

### 2.5 `framedata/hurtboxes.json`（受击框与身体碰撞盒配置 · D6）

顶层键名为配置名（如 `"hurtbox_default"`），每个配置对象必须包含：

| 字段 | 类型 | 必填 | 约束与说明 |
|---|---|---|---|
| `stand` | `Rect[]` | 是 | 站立状态受击框数组（至少 1 个矩形） |
| `crouch` | `Rect[]` | 是 | 下蹲状态受击框数组（至少 1 个矩形） |
| `air` | `Rect[]` | 是 | 空中状态受击框数组（至少 1 个矩形） |
| `down` | `Rect[]` | 是 | 倒地状态受击框数组（至少 1 个矩形） |
| `pushbox.stand` | `Rect` | 是 | 站立身体挤压盒（单个矩形） |
| `pushbox.crouch` | `Rect` | 是 | 下蹲身体挤压盒（单个矩形） |
| `pushbox.air` | `Rect` | 是 | 空中身体挤压盒（单个矩形） |
| `pushbox.down` | `Rect` | **是** | 倒地身体挤压盒（单个矩形，D6 新增必填，防起身坐标重合抖动） |

---

### 2.6 `skills/<skill>.json`（SkillDefinition）

**独占归属字段**：`cooldown`、`cost`、`projectile_gravity`。**严禁出现 `animation_id`、`damage`、`hitstun` 等字段**（统一通过 `move_id` 关联 `framedata/<move_id>.json`）。

| 字段 | 类型 | 必填 | 约束与说明 |
|---|---|---|---|
| `skill_id` | `string` | 是 | 必须等于文件名 `<skill>` |
| `type` | `string` | 是 | `melee` \| `projectile` \| `area` \| `dash` \| `control` \| `guard` \| `invuln` \| `multi_hit` \| `ultimate` \| `awaken` |
| `input` | `string` | 是 | 非空输入标识或指令串（如 `"skill_01"`、`"236_skill"`、`"awaken"`） |
| `cost` | `int` | 是 | `>= 0`，能量消耗 |
| `cooldown` | `int` | 是 | `>= 0`，冷却模拟帧数 |
| `move_id` | `string` | 是 | 对应本角色 `framedata/<move_id>.json` |
| `name_zh` / `name_en` | `string` | 否 | 技能显示名称（用于角色详情、出招表与必杀横幅） |
| `target_form_id` | `string` | 条件 | `type == "awaken"` 时必填，指向觉醒后切换的目标形态角色 ID（`"<ip>.<form>"`） |
| `awaken_duration_ticks` | `int` | 否 | `>= 0`，觉醒持续帧数（`0` 或省略表示本局持续至回合结束） |
| `projectile` | `object` | 条件 | `type == "projectile"` 时必填，含 `effect`（相对 IP 目录路径）、`speed`（`int`）、`lifetime`（`int > 0`），可选 `velocity_y`（`int`）与 `projectile_gravity`（`int >= 0`）；同时对应 `FrameData` 必须含非空 `projectile_spawn` |

---

### 2.6b `ip_content/<ip>/assists/<assist>/assist.json`（AssistDefinition）

紧凑擂台独立援助角色配置（角色无身体挤压盒，不可在受击硬直中呼叫）：

| 字段 | 类型 | 必填 | 约束与说明 |
|---|---|---|---|
| `id` | `string` | 是 | 必须等于 `"<ip>.<assist>"` |
| `ip_id` | `string` | 是 | 必须等于 `"<ip>"` |
| `name_zh` / `name_en` | `string` | 是 | 非空显示名 |
| `portrait` | `string` | 是 | 相对援助目录的头像路径（如 `"previews/portrait.png"`） |
| `cooldown_ticks` | `int` | 是 | `> 0`，援助召唤冷却模拟帧数（默认 `720` = 12 秒） |
| `spawn_offset` | `[int, int]` | 是 | 相对主控角色的登场偏移模拟坐标 `[ox, oy]` |
| `move_id` | `string` | 是 | 对应本援助目录 `framedata/<move_id>.json` 与 `metadata/<move_id>.json` |
| `skill_name_zh` | `string` | 否 | 援助招式名 |
| `projectile` | `object` | 否 | 若援助发射独立飞行道具，结构同 `SkillDefinition.projectile` |

---

### 2.6c `ip_content/<ip>/roster_manifest.json`（全量角色与资源盘点数据库）

每个正式 IP 目录提供 `roster_manifest.json`，完整登记原版可用角色、形态、觉醒形态与援助角色的来源、动画完备度与授权状态（`entries[]` 每项至少含 `id`、`name_zh`、`ip_id`、`category` [`playable` \| `form` \| `awakening_form` \| `assist`]、`completeness`、`authorization_status`）。

---

### 2.7 `metadata/sources.json` 与 `<ip>/sources.json`（素材来源登记 · D10 & D12）

- 每个角色必须提供 `metadata/sources.json`；当 IP 目录的 `stages/`、`effects/`、`audio/` 或 IP 根目录存在资产文件（如 `cover.png`）时，必须提供 `<ip>/sources.json`。
- `entries[]` 每项包含：`path`（非空相对路径或通配符）、`source`、`author`、`license`（均非空字符串）、`redistributable`（`bool`），可选 `placeholder`（`bool`）。
- 未标记 `"placeholder": true` 时，仅允许对派生目录 `animations/*` 与 `sprites/*` 使用通配符；对源资产目录使用 `*` 或 `?` 会触发 `SOURCES_BROAD_WILDCARD` 警告。

---

### 2.8 `combat/combat_config.json`（跨 IP 全局战斗规则配置 · D6）

存放与具体 IP 无关的全局模拟规则（Phase 1 创建；文件存在时由 `validate.py` 校验类型与范围）：

| 字段 | 类型 | 必填 | 说明与初始建议值 |
|---|---|---|---|
| `stage_half_width` | `int` | 是 | `> 0`，场地中心到单侧边界距离（如 `600000` = 600px） |
| `corner_pushback_permille` | `int` | 是 | `0 .. 2000`，防守方贴墙受击时将水平击退反推给攻击方的千分比（如 `1000` = 100%） |
| `input_buffer_frames` | `int` | 是 | `>= 0`，按键输入缓冲帧数（建议 `6`） |
| `motion_input_window_frames` | `int` | 是 | `> 0`，方向序列指令识别窗口帧数（建议 `15`） |
| `juggle_max_hits` | `int` | 是 | `>= 0`，空中浮空追击最大次数上限 |
| `same_move_combo_limit` | `int` | 是 | `> 0`，单次连招内同一 `move_id` 允许命中的最大次数 |
| `damage_scaling_pct` | `int[]` | 是 | 非空数组，每项 `1 .. 100`，按连招段数依次取百分比（建议 `[100, 90, 80, 70, 60, 50, 40]`） |
| `min_damage_scaling_pct` | `int` | 是 | `1 .. 100`，超出数组长度后的保底伤害百分比（建议 `30`） |

---

## 3. 字段唯一归属矩阵（D8）

任何受控键名出现在非归属文件类型（任意嵌套深度）中，校验器均报 `DUPLICATE_OWNERSHIP` 错误：

| 归属文件类型 | 独占键名 |
|---|---|
| `framedata` | `damage`, `knockback`, `hitstun`, `blockstun`, `hitstop`, `block_hitstop`, `hitboxes`, `cancel_windows`, `invuln_frames`, `armor_frames`, `startup`, `active`, `recovery`, `projectile_spawn`, `hurtbox_override`, `combat_events`, `super_freeze`, `meter_gain_on_hit`, `meter_gain_on_block`, `meter_gain_on_whiff` |
| `skill` | `cooldown`, `cost`, `projectile_gravity` |
| `fighter` | `stats`, `max_hp`, `walk_speed`, `jump_velocity`, `defense`, `gravity`, `max_gauge`, `gauge_gain_on_hurt_pct`, `gauge_gain_on_block_pct` |
| `animation` 或 `framedata` | `animation_id`（禁止出现在 `skill`、`fighter`、`hurtbox`、`ip` 中） |

---

## 4. 核心代码 IP 隔离规则（D11）

1. **扫描目标**：仓库根及所有非排除目录下的 `.gd`、`.tscn`、`.tres`、`.gdshader`、`.godot`、`.cfg`、`.json`、`.cs`、`.py` 文件，外加 10 个核心模块目录（`core/`..`ui/`）下的 `.md` 文档。
2. **排除范围**：`ip_content/`、`tests/`、`asset_pipeline/`、`addons/`、`docs/`、`.venv/`、`.cache/`、`.git/`、`.godot/`、`build/` 以及本机工具配置文件 `tools.local*.json`、`.gutconfig.json`。
3. **三级匹配规则**：
   - **一级（无条件拦截）**：`ip_content/<ip>`、`characters/<char>`、`<ip>.<char>` 完整角色 ID、长度 `>= 3` 的 IP `id` 与 IP `name_en`（短 IP `id` 拦截引号字面量）、长度 `>= 2` 的非 ASCII 显示名。
   - **二级（专属角色标识拦截）**：不在 `ENGINE_COLLISION_WORDS` 中的长度 `>= 3` 角色目录名与角色 `name_en`（不区分大小写词边界）。
   - **三级（通用词防误报）**：命中 `ENGINE_COLLISION_WORDS`（如 `red`、`ash`、`frost`、`spot`、`light`、`heavy`、`block`、`dash`）或长度 `< 3` 的 ASCII 角色名（如 `w`），允许作为引擎常规标识符/常量（如 `Color.RED`、`var w`），仅额外拦截引号内 ID 后缀（如 `".red"`、`".w"`）；单字非 ASCII 显示名（如 `红`、`陈`、`空`）仅拦截引号内字面量（如 `"红"`），不拦截普通中文注释（如 `# 攻击框（红）`）。
