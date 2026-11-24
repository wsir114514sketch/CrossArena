# 版本锁定（versions.md）

规格第一部分第 3 节：升级任何一项都必须单独评估，并更新本文件。

| 项目 | 锁定版本 | 来源 / 位置 | 校验 |
|---|---|---|---|
| Godot | 4.7.2.stable.official (`ed1daf0bf`) | 本机路径写在 `tools.local.json` | `godot --version` |
| Godot 标准导出模板（仅安装 Windows + Web） | `4.7.2.stable` | 来源：`https://github.com/godotengine/godot/releases/download/4.7.2-stable/Godot_v4.7.2-stable_export_templates.tpz`（官方校验清单同目录 `SHA512-SUMS.txt`）；安装于 `%APPDATA%\Godot\export_templates\4.7.2.stable\`（仅解压 `version.txt`、`icudt_godot.dat`、`windows_*`、`web_*` 共 22 个文件） | `.tpz`（1,281,349,702 字节）<br>SHA-256：`F298490B8D44D934BE425A5A65A51BF15F422428B229A06A6E11D9FFEA248011`<br>SHA-512：`ca4d71c4d7b81dfc15d1a98baa07534aa95b03fdda78a0075b06672e1648d2e5f40980c9adc28d23e1b92e732ee7bf3461997aa804af74ec2fcd7a93ccb84079`（与官方 `SHA512-SUMS.txt` 完全一致，`zipfile.testzip()` 零损坏） |
| Blender | 5.3.0（构建日期 2026-11-10） | 本机路径写在 `tools.local.json` | `blender --version` |
| Blender EEVEE 引擎标识符 | `BLENDER_EEVEE`（运行时检测，不写死在代码里） | `asset_pipeline/probes/eevee_probe.py` | 后台渲染探针通过 |
| GUT | 9.7.1 | `https://github.com/bitwes/Gut/archive/refs/tags/v9.7.1.zip`，解压后放在 `addons/gut/`，已提交进仓库 | zip（1,118,303 字节）<br>SHA-256：`14969AA46ADC84AA08CDD21B9F6D1A64ADDD92AE60B36F02D0521ED305AA4086` |
| Python | 3.12.10（项目内 `.venv`） | 基于 `C:\Users\lenovo\AppData\Local\Programs\Python\Python312` 创建，不动系统 Python 与 miniconda | `.venv\Scripts\python --version` |
| Python 依赖：`Pillow` | `13.0.0`（`requirements.txt` 严格 `==` 锁定） | PyPI 官方源 `pillow-13.0.0-cp312-cp312-win_amd64.whl`（仅安装至 `.venv`） | whl（7,272,166 字节）<br>SHA-256：`FF3FE9EB621FBB9DB4C4BE33AB946F6BAC5F98AB50CA8D3260503653656C961B` |
| Git | 2.56.0.windows.3 | — | — |

## 已安装导出模板文件清单（`%APPDATA%\Godot\export_templates\4.7.2.stable\`）

仅保留首期目标所需的 Windows 与 Web 模板（未安装 Android / iOS / Linux / macOS 模板；后续启动 Android iQOO Neo9 测试前再按需从同一压缩包提取 `android_*.apk`）：

| 文件名 | 大小（字节） | SHA-256 |
|---|---:|---|
| `version.txt` | 13 | `38885C88F75ABBC797A1DB7559719800279A00CFB9FA8B2E2868A7F6F84BAD2E` |
| `icudt_godot.dat` | 4,797,472 | `64E407B570A21A4B740531A14CD95F0CEFC46CEF3D8224FD09A0DD386FB7016A` |
| `web_nothreads_release.zip` | 10,245,903 | `D3EE2F08CEF0CF3CF6678A6355A92A8DB48CCDD35CBD2E8BFD5F0E8A0B4032A0` |
| `web_nothreads_debug.zip` | 10,232,720 | `08962AEFEF811B603541D7951AC67EF00413AAD2D978855183C28ADEE98F626A` |
| `web_release.zip` | 10,290,815 | `02F0DCA13ED3D8343FA68F8F88AC80295562408D71AA67157E8B96DDEBAA67A3` |
| `web_debug.zip` | 10,342,534 | `5E6696B42CE07F908FCE1698CC227E11807399456B6AB986E69A125EAE3596EE` |
| `web_dlink_nothreads_release.zip` | 11,549,046 | `555ACADDCFDE759A431F326A244CB7E20209EF534F7D221B3E2F10879821D8EE` |
| `web_dlink_nothreads_debug.zip` | 12,014,273 | `2E7256717078C829EC7B02DADF9E20C490D7AE861B12903B8C7637BA50DA554C` |
| `web_dlink_release.zip` | 11,568,406 | `6E1A1D21032EC35D7C4BF9E3A5C9892EF6795ECC5B22F6FA92F50A820523544E` |
| `web_dlink_debug.zip` | 12,125,435 | `4238F2D660ED2F0FFC8323B160CA2DBCA0A4161345164385DCEB9AADE32BE3ED` |
| `windows_release_x86_64.exe` | 109,268,480 | `D34D36F3BE1A6C49C56525AE86469B92E4F417DDF0B43CF00DD80C385C4B0562` |
| `windows_release_x86_64_console.exe` | 188,928 | `52BDCAE9068E8D23B840E5C63B0C1798FFE2CB66144E5C4BC7AF11FB8C8600DF` |
| `windows_debug_x86_64.exe` | 103,176,704 | `51498B72B3A237F882EBD7D1787F06A4BC1EAF0572DAAB93837ADCFD3CFDC107` |
| `windows_debug_x86_64_console.exe` | 188,928 | `5514C7645EE897A01F540D3CF22EDE5BADF92394521A08BFAB66A54D7369E6E6` |
| `windows_release_x86_32.exe` | 122,176,000 | `74015A09AB40DD9250AD233DF883990E724A620128F03D15AFC9E3B5F2A01B29` |
| `windows_release_x86_32_console.exe` | 192,000 | `15B0887CF2A87E409ABCE06FEDC263BEC8E624745C64745B7042B37386532D3E` |
| `windows_debug_x86_32.exe` | 113,264,640 | `73C404C39332E12AA19725431B35F61538954A13F5BC5FF0157990F2633D9966` |
| `windows_debug_x86_32_console.exe` | 192,000 | `C3A0A3737F0129A9081960D338CCDB92A2BD2602F2D732C9A1B2468FE40028E8` |
| `windows_release_arm64.exe` | 91,662,336 | `7A2CCD688F6C3D53D2D67878BC98A96BEBE8463BF97ACF986B9C2C9E1BA9A292` |
| `windows_release_arm64_console.exe` | 159,744 | `CD58B045A810019AA769D0E40D6397C30FEA0DCC1F7CC707F5E6CB1A73BA8CE7` |
| `windows_debug_arm64.exe` | 98,958,848 | `37108F059E3650E84FFEF6F233EA45DF765E9E9BDCA1AE1199CF77B913B0228E` |
| `windows_debug_arm64_console.exe` | 159,744 | `2B1D5D083F25DDFCA3399FBE1A44543659B6E636C127DA1B0837C3191E927BC6` |

## 目标测试平台清单

| 优先级 | 平台 / 设备 | 状态与说明 |
|---|---|---|
| **首期目标**（Phase 1 起通用门禁） | Windows 11 专业版 + Google Chrome 157（本机已安装 `157.0.8103.80`） | 已安装 Windows 与 Web 导出模板并通过空项目无头导出实测 |
| **后续测试目标** | Android：iQOO Neo9 / Android 15 | 暂未安装 Android 导出模板与 Android SDK；进入移动端适配测试阶段前单独评估安装 |
| **暂不安排** | iOS | 不安装模板、不排期 |

## 规则

- 工具路径只写在 `tools.local.json`（已 gitignore，模板见 `tools.local.example.json`），不修改系统 PATH。
- GUT 不通过 Asset Library 安装；升级时从 GitHub tag 重新下载，并同时更新本表中的 SHA-256。
- Python 依赖只安装在项目 `.venv/` 内，`requirements.txt` 必须用 `==` 锁死版本，不修改系统 Python 与 miniconda。
- 每次会话开始先运行 `git -C <项目路径> rev-parse --show-toplevel`，结果必须等于 `D:/MyGame/CrossArena`；所有 git 命令都带 `-C`。
