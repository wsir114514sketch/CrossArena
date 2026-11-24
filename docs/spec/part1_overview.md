# Cross Arena 项目规格 · 第一部分：总纲与规范

LayUDown 独立项目 · 整合版规格（共三部分）· 由原主文档与技术补充规格整合而成，冲突处以本文为准

> 三部分：**第一部分 总纲与规范** · 第二部分 美术管线 · 第三部分 运行时与路线图

---

## 1. 项目目标

使用 Godot 开发动漫跨 IP 的 2D 横版格斗游戏，Blender 负责 3D 建模、绑定、动作与 2D 渲染。

- **玩法参考**：《拳皇》（连招攻防）、《死神VS火影》（跨角色对战与必杀）、《罪恶装备 -奋战-》（动漫卡通渲染与特效）。
- **首个 IP**：《明日方舟》，之后持续扩展其他 IP。
- **视觉方案（已锁定）**：Blender 3D 制作 → 骨骼动画逐帧渲染 → 透明背景 2D Sprite → Godot 2D 显示。严格横向 Side View，仅 X 轴移动和 Y 轴跳跃。运行时不显示 3D 模型，不改为实时 3D 或 2.5D 纵深移动。
- **定位**：长期运营的独立项目，初期为个人学习及同人开发。

## 2. 核心原则（8 条）

1. **先架构，后功能**；先做出一个真正可玩的角色，再扩展阵容。
2. **引擎与 IP 内容彻底分离**：核心代码中不得出现任何 IP 的角色名、技能逻辑或资源路径。
3. **数据驱动**：新增角色或 IP 只需新增内容包，不改核心战斗代码，不复制引擎。
4. **表现与判定分离**：Blender 和 Sprite 只管表现；伤害、命中、帧数据全部来自独立数据文件。
5. **确定性模拟**：战斗固定 60Hz，关键状态可保存、恢复、重放（为回滚联机预留）。
6. **手感与质量优先**于角色数量。
7. **小步迭代**：每次修改前先检查影响范围；每个阶段必须实际运行并通过实机对局验证，代码生成成功不等于完成。
8. **不堆积难以维护的代码**，不为快速实现而硬编码。

## 3. 技术栈与版本锁定

| 项目 | 选择 |
|---|---|
| 游戏引擎 | Godot 4.x 当前稳定版 |
| 脚本语言 | GDScript |
| 3D 与动画 | Blender（骨骼动画、Cel Shading、Python 脚本自动化） |
| 角色表现 | 透明 PNG 序列 + Sprite Sheet |
| UI | Godot Control 系统 |
| 战斗模拟 | 固定 60Hz，整数 / 定点数，不依赖 Godot 物理 |
| 配置格式 | JSON（数据）+ Godot Resource（导入后的运行时资源） |
| 测试 | GUT 或同类 Godot 单元测试 + 战斗回放测试 |

**版本锁定规则**：Phase 0 环境检查后，将实际使用的 Godot、Blender 及插件版本写入仓库根目录 `versions.md`，此后升级必须单独评估。使用插件前先确认与锁定版本兼容。

### 关键技术决策：自研确定性模拟

原补充规格推荐 `CharacterBody2D`、`Area2D`、`AnimatedSprite2D` 作为战斗基础，但这些节点的内部计时和物理不具备确定性，与「固定 60Hz、可回滚」的要求冲突。整合后的做法：

- **模拟层**：纯数据（整数 / 定点数）。位置、速度、状态、帧计数全部由模拟层自己计算。
- **判定层**：Hitbox / Hurtbox / 身体碰撞都是矩形数据，由模拟层逐帧检测，不使用 Area2D。
- **表现层**：Godot 节点只负责显示。每个模拟帧，由模拟状态直接指定当前显示哪一张图，不让 AnimatedSprite2D 自行计时。Hitstop、慢动作因此不会造成动画与判定失步。

此改动不影响 Blender 美术管线。

## 4. 模块划分

| 模块 | 职责 |
|---|---|
| Core | 公共接口、模拟时钟、定点数工具、状态快照 |
| Combat | 战斗流程：回合、胜负、计时 |
| Fighter | 角色状态机与控制器 |
| HitSystem | Hitbox / Hurtbox 判定、优先级、防止重复命中 |
| SkillSystem | 技能与必杀技 |
| ComboSystem | 连招、取消、输入缓冲、伤害递减 |
| Animation | 动画播放接口（表现层），帧映射 |
| AISystem | 电脑对手 |
| Network | 联机（预留，首期只定接口） |
| UI | 全部界面 |
| IPContent | 各 IP 独立内容包 |
| AssetPipeline | Blender 渲染、打包、校验工具 |
| Tests | 自动化测试 |

依赖方向：IPContent 只被「数据加载器」读取，Combat 及以下模块不得反向依赖任何具体 IP。

## 5. 安全红线

LayUDown 已有服务正在运行，本项目必须独立开发。

**严禁**：

- 修改 UNO、UNION ARENA、Hon Shogi、OpenClaw 项目。
- 修改现有 nginx 路由。
- 占用已有服务端口，尤其不能影响 OpenClaw 的 **18815** 端口。
- 删除或覆盖现有资源。
- 未经确认修改生产服务器或现有网站。

**做法**：使用独立目录、独立 Git 仓库、独立测试环境。与现有网站整合需等 Phase 6 评估后经你确认。

## 6. 版权与素材来源

- 优先使用：自制 Blender 模型与动作、你提供且有权使用的资源、获明确授权的第三方资源。
- 不擅自抓取、复制或再分发官方游戏模型、动画、音乐等商业素材。
- 公开发行、商业化或分发受版权保护的 IP 素材前，必须先评估授权。
- **来源登记表**：每个角色目录下放 `metadata/sources.json`，记录每项资源的来源、作者、授权类型、是否可公开分发。资源检查报告中缺少登记即报错。

## 7. 命名规范

| 对象 | 规则 | 示例 |
|---|---|---|
| 目录与文件 | 全部 ASCII，小写加下划线 | `characters/ch_en/` |
| 角色 ID | `ip前缀.角色名`，ASCII 小写 | `arknights.amiya`、`arknights.ch_en` |
| 显示名 | 只存放在 JSON，不进目录名 | `"name_zh": "陈"` |
| Blender Action | 类别前缀 + 名称，首字母大写 | `Core_Idle`、`Combat_Light_01` |
| 动画 ID（目录与 JSON） | Action 名去掉前缀并小写 | `idle`、`light_01` |
| 技能动作 | `Skill_01`、`Skill_02`、`Skill_03`、`Skill_Ultimate` | `skill_ultimate` |
| 帧文件 | `frame_000.png` 起，三位补零 | `frame_012.png` |

### 统一核心动作清单

每个角色必须实现或在 `character.json` 中明确标记为 `unsupported`。角色可以有额外专属动作。

- **Core**：Idle、Walk_Forward、Walk_Backward、Dash、Crouch、Jump_Start、Jump_Loop、Landing
- **Combat**：Light_01、Light_02、Medium_01、Heavy_01、Air_Attack、Block、Hit、Knockdown、Wakeup、Throw
- **Skill**：Skill_01、Skill_02、Skill_03、Skill_Ultimate
- **Presentation**：Intro、Victory、Defeat

## 8. 目录结构

```
cross-arena/                     # 独立 Git 仓库
  versions.md                    # 版本锁定
  core/  combat/  fighter/  hit_system/
  skill_system/  combo_system/  animation/
  ai_system/  network/  ui/
  asset_pipeline/                # Blender 脚本与校验工具
  tests/
  ip_content/
    arknights/
      ip.json
      characters/
        amiya/
          character.json         # FighterDefinition
          skills/                # 技能定义
          framedata/             # 战斗帧数据（判定的唯一来源）
          metadata/              # 动画元数据、sources.json
          blender/               # .blend 源文件
          model/  textures/
          animations/            # 原始 PNG 序列（源素材）
            idle/  walk_forward/  light_01/  ultimate/ ...
          sprites/               # 打包后的 Sprite Sheet（Godot 导入用）
          previews/
        ch_en/
      stages/
      effects/
      audio/
    naruto/                      # 未来 IP，同样结构
```

规则：公共动画控制器、Sprite 播放器、战斗逻辑只存在于顶层模块，**不得复制进角色目录**。原始 PNG 序列永远保留，Sprite Sheet 只是可重新生成的导入形式。

## 9. 数据 Schema

### 9.1 五类数据与职责

| 数据 | 文件位置 | 回答的问题 | 唯一负责的内容 |
|---|---|---|---|
| **IPDefinition** | `ip.json` | 这个 IP 是什么 | 名称、封面、简介、代表角色、是否开放 |
| **FighterDefinition** | `character.json` | 这个角色是谁、基础能力如何 | ID、名称、头像立绘、生命、移速、跳跃、防御、受击框配置、身高比例、AI 参数、技能与动画引用、介绍 |
| **AnimationDefinition** | `metadata/<anim>.json` | 这个动画怎么显示 | 帧数、FPS、循环、朝向模式、画布、pivot、地面锚点、纯表现事件（音效、特效触发） |
| **FrameData** | `framedata/<move>.json` | 这个招式怎么判定 | 前摇 / 有效 / 收招帧、各帧攻击框、伤害、击退、硬直、取消窗口、无敌 / 霸体帧、空中命中、投射物生成 |
| **SkillDefinition** | `skills/<skill>.json` | 这个技能怎么用 | 输入方式、消耗、冷却、类型、引用的 animation_id 与 framedata |

### 9.2 防止重复写数据的规则

- **伤害、击退、硬直只写在 FrameData**，其他文件只引用，不复制。
- **判定事件（攻击框开关、取消窗口、无敌帧、投射物生成）只写在 FrameData**。原补充规格把这些放在动画的 `combat_events` 里，整合后移到 FrameData；AnimationDefinition 只保留不影响战斗结果的表现事件。
- **冷却与消耗只写在 SkillDefinition**。
- **角色基础数值只写在 FighterDefinition**，技能不重复定义生命、速度。
- 任何数值如果在两个文件里出现，视为设计错误，由校验工具报错。

### 9.3 示例

**ip.json**

```json
{
  "id": "arknights",
  "name_zh": "明日方舟",
  "name_en": "Arknights",
  "cover": "cover.png",
  "description": "…",
  "featured_characters": ["arknights.amiya"],
  "status": "open"
}
```

角色数量由加载器扫描 `characters/` 自动统计，不手写；`status` 为 `locked` 的 IP 在选择界面显示未开放，不提供入口。

**character.json（FighterDefinition，节选）**

```json
{
  "id": "arknights.amiya",
  "ip_id": "arknights",
  "name_zh": "阿米娅",
  "name_en": "Amiya",
  "portrait": "previews/portrait.png",
  "splash": "previews/splash.png",
  "stats": {
    "max_hp": 1000,
    "walk_speed": 3200,
    "jump_velocity": 14000,
    "gravity": 700,
    "defense": 100
  },
  "height_scale": 1.0,
  "hurtboxes": "hurtbox_default",
  "skills": ["skills/energy_bolt.json", "skills/ultimate.json"],
  "unsupported_core_moves": ["throw"],
  "ai_profile": { "aggression": 0.4, "zoning": 0.8 },
  "bio": "…"
}
```

数值单位约定：位置与速度使用整数（1 像素 = 1000 单位），避免浮点误差影响确定性。以上数值仅为格式示例，非平衡设计。

**animations 元数据（AnimationDefinition）**

```json
{
  "animation_id": "light_01",
  "character_id": "arknights.amiya",
  "animation_type": "combat",
  "source_frames": "animations/light_01/",
  "frame_count": 12,
  "animation_fps": 30,
  "loop": false,
  "facing_mode": "flip",
  "canvas_size": [512, 512],
  "pivot": [256, 480],
  "ground_anchor": [256, 480],
  "presentation_events": [
    { "frame": 4, "type": "sfx", "id": "swing_light" }
  ]
}
```

`facing_mode` 取值：`flip`（水平翻转，默认）或 `dual`（需要左右各一套素材，用于文字、不对称服装或武器）。

**framedata/light_01.json（FrameData）**

```json
{
  "move_id": "light_01",
  "animation_id": "light_01",
  "startup": 5,
  "active": 3,
  "recovery": 9,
  "hitboxes": [
    { "frames": [5, 7], "rect": [20000, -90000, 60000, 40000],
      "damage": 30, "knockback": [4000, 0],
      "hitstun": 14, "blockstun": 9,
      "air_hit": true, "priority": 1 }
  ],
  "cancel_windows": [
    { "frames": [6, 10], "into": ["light_02", "medium_01", "skill"] }
  ],
  "invuln_frames": [],
  "armor_frames": []
}
```

帧数单位是**模拟帧（60Hz）**。`rect` 为相对角色脚底、面向右侧时的本地偏移，向左时由运行时按 `facing_direction` 镜像，不在数据里写两份。

**skills/energy_bolt.json（SkillDefinition，节选）**

```json
{
  "skill_id": "energy_bolt",
  "type": "projectile",
  "input": "skill_01",
  "cost": 0,
  "cooldown": 90,
  "move_id": "skill_01",
  "projectile": { "effect": "effects/energy_bolt", "speed": 9000, "lifetime": 90 }
}
```

技能类型枚举：`melee`、`projectile`、`area`、`dash`、`control`、`guard`、`invuln`、`multi_hit`、`ultimate`。

### 9.4 动画帧与模拟帧的映射

运行时由 `animation_fps` 与 60Hz 推算：每个模拟帧显示哪一张图是**纯计算结果**（例如 30 FPS 动画每张图显示 2 个模拟帧），不依赖墙钟时间。Hitstop 期间模拟帧计数暂停，显示图片因此同步冻结；恢复后从原帧继续。映射算法见第三部分第 9 节。

### 9.5 校验规则（由 AssetPipeline 自动检查）

- `character.json` 引用的所有技能、动画、FrameData 文件都存在。
- 核心动作清单中的每一项要么存在，要么在 `unsupported_core_moves` 中声明。
- FrameData 的 `animation_id` 在动画元数据中存在，且帧范围不超出动画长度。
- 同一数值未在多个文件中重复定义。
- `sources.json` 覆盖该角色全部素材。
- 核心代码目录（`core/`、`combat/` 等）中不包含任何 IP 相关字符串。

---

**第一部分结束。** 第二部分：美术管线；第三部分：运行时与路线图。
