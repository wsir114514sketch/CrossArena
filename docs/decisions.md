# 规格落地决策记录

本文件记录规格（`docs/spec/`）中未写明或前后矛盾之处的落地方式。凡与规格冲突的地方，以规格为准；本文件只用来补全规格没有写到的细节。

| # | 问题 | 决策 | 依据 |
|---|---|---|---|
| D1 | 技能动作 ID：按「去掉前缀」的规则，`Skill_01` 会变成 `01` | 技能动作**保留** `skill_` 前缀：`skill_01`…`skill_ultimate` | 第一部分第 7 节命名表的示例（`skill_ultimate`）与 SkillDefinition 示例（`move_id: skill_01`） |
| D2 | 核心动作怎样算「已实现」 | 存在 `metadata/<id>.json` 即视为已实现。攻击类和技能类动作还必须有 `framedata/<id>.json` | 第一部分第 9.5 节 |
| D3 | 帧编号的起点 | FrameData 的帧编号**从 0 开始**，前摇占 `[0, startup-1]`，有效帧为 `[startup, startup+active-1]` | 第一部分示例：startup=5，hitbox 帧为 [5,7] |
| D4 | 矩形坐标系 | `[x, y, w, h]` 均为整数（1px = 1000），原点在脚底，面向右；**y 轴向下**（与 Godot 一致），因此身体部位的 y 为负数 | 第一部分示例 rect y=-90000 |
| D5 | Hitstop 写在哪里 | 每个 hitbox 都必须写 `hitstop` 字段 | 第三部分第 8 节「数值写在 FrameData 命中数据里」 |
| D6 | 身体碰撞盒（pushbox）放在哪里 | 与受击框放在一起，写在 `framedata/hurtboxes.json` 的 `<配置名>.pushbox.{stand,crouch,air}` | 规格未指定位置 |
| D7 | 投射物的伤害数据放在哪里 | `FrameData.projectile_spawn[].hit` 负责伤害与硬直，`SkillDefinition.projectile` 负责特效、速度和寿命 | 第一部分第 9.2 节「伤害只写在 FrameData」 |
| D8 | 「同一数值不在多个文件重复」怎样校验 | 用**键归属**近似实现：伤害、硬直、帧数相关键只能出现在 FrameData，`cooldown`/`cost` 只能出现在 Skill，基础数值只能出现在 Fighter。`gravity` 不纳入检查，因为投射物将来可能有自己的重力 | 第一部分第 9.2 节 |
| D9 | 测试内容包 | `ip_content/test_pack/`，`ip.json` 设 `test_only: true`，正式版 UI 应隐藏 | 第三部分 Phase 1 |
| D10 | 素材登记的匹配规则 | `sources.json.entries[].path` 是相对于角色目录的通配符，用 fnmatch 匹配，`*` 可以跨越 `/`。IP 级目录（stages/effects/audio）里有文件时，必须在 IP 根目录提供 `sources.json` | 第一部分第 6 节 |
| D11 | IP 字符串检查的范围 | 检查 `core combat fighter hit_system skill_system combo_system animation ai_system network ui` 这些目录，不检查 `tests/` 和 `asset_pipeline/`。被禁的词包括所有 IP id、角色 id、角色目录名和中英文显示名。ASCII 词按词边界匹配、不区分大小写，长度不足 3 的忽略 | 第一部分第 9.5 节 |
| D12 | 版权 | 本项目只部署在个人服务器上，不对外传播、不商用（用户 2026-11-24 确认）。`sources.json` 登记照常维护，因为它也是素材清单 | 用户确认 |
| D13 | 整数除法 | GDScript 的 `/` 向零截断，`%` 结果与被除数同号。模拟层需要向下取整时，统一使用工具函数（Phase 1 在 `core/` 中提供） | GUT 冒烟测试实测 |
