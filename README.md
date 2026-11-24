# Cross Arena

跨 IP 紧凑型 2D 横版街机格斗游戏（**TypeScript + Vite + HTML5 Canvas 2D + Web Audio + Vitest**，零外部游戏引擎依赖）。

核心定位：保留经典动漫角色的像素造型、招牌技能、觉醒变身与援助演出，同时采用《拳皇》与《街头霸王》式的紧凑擂台、立回距离博弈、上中下段防御、目押/取消连招、投技拆投与确定性帧回滚同步架构。引擎核心代码对具体 IP 100% 零感知，所有角色、形态、援助与主题均由 `ip_content/<ip>/` 数据驱动。

完整规格见 [docs/spec/](docs/spec/)，数据 Schema 规范见 [docs/data_schema.md](docs/data_schema.md)，落地决策记录见 [docs/decisions.md](docs/decisions.md)。

## 快速启动

1. 安装前端与测试依赖：`npm install`
2. Python 资产管线虚拟环境（已配置 `.venv`）：`.venv\Scripts\python -m pip install -r requirements.txt`（锁定 `Pillow==13.0.0`）
3. 启动本地开发服：`npm run dev`（默认监听 `http://127.0.0.1:5179`）
4. 运行全套自动化门禁：`powershell -ExecutionPolicy Bypass -File scripts/run_tests.ps1`

## 常用命令

```powershell
.venv\Scripts\python asset_pipeline\validate.py                        # 校验全部内容包、精灵资产与核心代码 IP 隔离
.venv\Scripts\python asset_pipeline\validate.py --public-release-check # 公开发行合规门禁（拦截待授权/不可再分发素材）
.venv\Scripts\python -m unittest discover -s asset_pipeline\tests      # 校验器自身的 Python 单元测试
npm run typecheck                                                      # TypeScript 严格类型检查
npm test                                                               # Vitest 战斗机制、AI、回滚与重放单元测试
npm run build                                                          # 生产构建（设置 PUBLIC_RELEASE=1 自动剔除待授权包）
```

## 目录结构

| 路径 | 内容 |
|---|---|
| `core/` | 60Hz 定点数数学（`1px = 1000` 单位）、位掩码输入、确定性 PRNG、可快照/校验和 `SimState`、内容加载器 |
| `combat/` | 紧凑街机擂台规则、回合推进、双人物理挤压、顶层 `BattleSimulation` 与场景镜头表现 |
| `fighter/` | 完整街机格斗状态机（站/走/冲刺/后撤/蹲/跳/立防/蹲防/攻击/投技/破防/浮空/倒地/起身/必杀/觉醒） |
| `hit_system/` | Hitbox / Hurtbox / Pushbox 整数 AABB 判定、上/中/下段防御、投技与拆投、连招缩放、受击冻结 |
| `combo_system/` | 环形输入缓冲、搓招指令识别（`236`/`214`/`623`/`66`/`44` 及方向快捷键）、普通技->特殊技->必杀取消链 |
| `skill_system/` | 数据驱动技能执行器、飞行道具、必杀暗屏冻结（Super Freeze）、局内觉醒变身与独立援助召唤系统 |
| `animation/` | 最近邻像素精灵表渲染器、角色锚点对齐、打击火花/气场特效与帧判定框（Hitbox/Hurtbox/Pushbox）调试层 |
| `ai_system/` | 基于距离博弈、防空、差合惩罚、连招确认、能量与援助管理的战术 AI |
| `network/` | 本地双人、输入延迟缓冲、基于快照环的确定性回滚同步（SyncTest）与录像重放（Replay）系统 |
| `ui/` | 街机主菜单、双 IP 四层选人界面（IP -> 角色 -> 形态/援助 -> 确认）、经典顶部对战 HUD、训练房面板与 Web Audio 音效 |
| `ip_content/<ip>/` | IP 内容包（角色、多形态、援助、精灵图集、帧数据、技能与授权溯源清单 `sources.json`） |
| `asset_pipeline/` | XFL 无损像素提取、精灵表打包与全项目 Schema/合规校验工具（Python） |
| `tests/` | Vitest 自动化测试套件 |
