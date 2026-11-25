import sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract_bvn_assets as ex

ROOT = ex.ROOT


def regen(ip_id: str, rel_dir: str, tag_kind: str, cfg: dict, idle_rel: str) -> None:
    d = ROOT / "ip_content" / ip_id / rel_dir / cfg["dir"]
    idle = Image.open(d / idle_rel).convert("RGBA")
    ex.fetch_portrait_and_splash(d, tag_kind, cfg["tag_pack"], cfg["face_prefix"], idle, (0, 0, 0, 255))


n = 0
for ip_id, chars in (("naruto", ex.NARUTO_CHARACTERS), ("bleach", ex.BLEACH_CHARACTERS)):
    for cfg in chars:
        regen(ip_id, "characters", "fighters", cfg, "animations/idle/frame_000.png")
        n += 1
    for acfg in ex.ASSISTS_CONFIG[ip_id]:
        regen(ip_id, "assists", "assists", acfg, "animations/assist_call/frame_000.png")
        n += 1
print("regenerated previews:", n)
