#!/usr/bin/env python3
"""Generate 2D geometric mannequin placeholder PNGs & sprite sheets for ip_content/test_pack.

Uses Pillow==13.0.0 in .venv. Does NOT use Blender (Phase 3).
All generated assets are marked placeholder=true in sources.json and satisfy:
- Transparent corners (alpha == 0)
- Ground anchor locked at [256, 480] on [512, 512] canvas
- Active attack frames visually match FrameData hitbox coordinates
- Packed sprite sheet with 2px extruded border + crop_offset metadata
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PACK_DIR = ROOT / "ip_content" / "test_pack"
CANVAS_W, CANVAS_H = 512, 512
ANCHOR_X, ANCHOR_Y = 256, 480


def draw_limb(draw: ImageDraw.ImageDraw, p0: tuple[float, float], p1: tuple[float, float],
              width: int, fill: tuple[int, int, int, int], outline: tuple[int, int, int, int]) -> None:
    draw.line([p0, p1], fill=outline, width=width + 6)
    draw.line([p0, p1], fill=fill, width=width)
    r = width // 2 + 2
    for px, py in (p0, p1):
        draw.ellipse([px - r, py - r, px + r, py + r], fill=fill, outline=outline, width=2)


def render_mannequin_frame(anim_id: str, f_idx: int, f_count: int,
                           primary: tuple[int, int, int, int],
                           accent: tuple[int, int, int, int],
                           has_staff: bool) -> Image.Image:
    img = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    outline = (22, 24, 32, 255)
    dark = (max(0, primary[0] - 45), max(0, primary[1] - 45), max(0, primary[2] - 45), 255)

    t = f_idx / max(1, f_count)
    phase = math.sin(t * math.tau)

    # Default standing skeleton relative to (ANCHOR_X, ANCHOR_Y)
    hip_x, hip_y = 0.0, -92.0
    shoulder_x, shoulder_y = 2.0, -146.0
    head_x, head_y = 4.0, -168.0
    l_foot = (-18.0, -4.0)
    r_foot = (18.0, -4.0)
    l_hand = (-20.0, -110.0)
    r_hand = (24.0, -112.0)
    weapon_tip = None

    if anim_id == "idle":
        bob = round(math.sin(t * math.tau) * 3.0)
        hip_y += bob
        shoulder_y += bob
        head_y += bob
        r_hand = (26.0, -116.0 + bob)
        l_hand = (-18.0, -112.0 + bob)
    elif anim_id in ("walk_forward", "walk_backward"):
        dir_sign = 1.0 if anim_id == "walk_forward" else -1.0
        stride = math.sin(t * math.tau * dir_sign) * 22.0
        l_foot = (-stride, -4.0 - max(0.0, -math.cos(t * math.tau * dir_sign) * 8.0))
        r_foot = (stride, -4.0 - max(0.0, math.cos(t * math.tau * dir_sign) * 8.0))
        l_hand = (stride * 0.7, -112.0)
        r_hand = (-stride * 0.7 + 10.0, -114.0)
        bob = abs(math.sin(t * math.tau)) * 3.0
        hip_y += bob
        shoulder_y += bob
        head_y += bob
    elif anim_id == "crouch":
        hip_y = -58.0
        shoulder_x, shoulder_y = 8.0, -96.0
        head_x, head_y = 12.0, -114.0
        l_foot = (-22.0, -4.0)
        r_foot = (22.0, -4.0)
        l_hand = (-8.0, -82.0)
        r_hand = (28.0, -86.0)
    elif anim_id == "jump_start":
        hip_y = -68.0
        shoulder_y = -116.0
        head_y = -138.0
        l_hand = (-24.0, -96.0)
        r_hand = (24.0, -96.0)
    elif anim_id == "jump_loop":
        hip_y = -102.0
        shoulder_y = -154.0
        head_y = -176.0
        l_foot = (-14.0, -26.0 + phase * 3.0)
        r_foot = (16.0, -34.0 - phase * 3.0)
        l_hand = (-26.0, -138.0)
        r_hand = (28.0, -142.0)
    elif anim_id == "landing":
        hip_y = -66.0
        shoulder_y = -114.0
        head_y = -136.0
    elif anim_id == "light_01":
        # Startup 6 sim (frames 0..2), active [6,7] sim (frame 3), recovery (frames 4..11)
        if f_idx < 3:
            shoulder_x = -6.0
            r_hand = (-8.0, -118.0)
        elif f_idx in (3, 4):
            # Hitbox rect is [20, -130, 60, 40] px -> extends x: 20..80, y: -130..-90
            shoulder_x = 12.0
            head_x = 14.0
            r_hand = (76.0, -112.0)
            weapon_tip = (80.0, -112.0)
        else:
            rec = (f_idx - 4) / max(1, f_count - 4)
            r_hand = (76.0 * (1.0 - rec) + 24.0 * rec, -112.0)
    elif anim_id == "heavy_01":
        # Startup 12 sim (frames 0..5), active [12,15] sim (frames 6..7), recovery (8..19)
        if f_idx < 6:
            wind = f_idx / 5.0
            shoulder_x = -12.0 * wind
            r_hand = (-22.0 * wind, -148.0)
            weapon_tip = (-38.0 * wind, -172.0)
        elif f_idx in (6, 7, 8):
            # Hitbox rect is [25, -140, 85, 50] px -> extends x: 25..110, y: -140..-90
            shoulder_x = 18.0
            head_x = 20.0
            r_foot = (32.0, -4.0)
            r_hand = (64.0, -116.0)
            weapon_tip = (110.0, -114.0)
        else:
            rec = (f_idx - 8) / max(1, f_count - 8)
            r_hand = (64.0 * (1.0 - rec) + 24.0 * rec, -116.0)
            weapon_tip = (100.0 * (1.0 - rec) + 34.0 * rec, -114.0)
    elif anim_id == "skill_01":
        # Startup 14 sim (frames 0..6), spawn at sim 14 (frame 7)
        if f_idx < 7:
            r_hand = (10.0, -138.0)
            l_hand = (18.0, -132.0)
        else:
            r_hand = (58.0, -120.0)
            l_hand = (42.0, -120.0)
            weapon_tip = (72.0, -120.0)
    elif anim_id == "block":
        shoulder_x = -4.0
        head_x = -2.0
        l_hand = (18.0, -138.0)
        r_hand = (24.0, -122.0)
    elif anim_id == "hit":
        recoil = math.sin(min(1.0, (f_idx + 1) / max(1, f_count)) * math.pi)
        shoulder_x = -16.0 * recoil
        head_x = -22.0 * recoil
        head_y = -164.0 + 8.0 * recoil
        l_hand = (-30.0, -126.0)
        r_hand = (8.0, -132.0)
    elif anim_id == "knockdown":
        prog = min(1.0, f_idx / 5.0)
        hip_x = -12.0 * prog
        hip_y = -92.0 * (1.0 - prog) - 18.0 * prog
        shoulder_x = -48.0 * prog
        shoulder_y = -146.0 * (1.0 - prog) - 20.0 * prog
        head_x = -68.0 * prog
        head_y = -168.0 * (1.0 - prog) - 24.0 * prog
        l_foot = (34.0 * prog - 18.0 * (1.0 - prog), -4.0 - 8.0 * prog)
        r_foot = (52.0 * prog + 18.0 * (1.0 - prog), -4.0)
        l_hand = (-36.0 * prog, -22.0 * prog - 110.0 * (1.0 - prog))
        r_hand = (-20.0 * prog, -28.0 * prog - 112.0 * (1.0 - prog))
    elif anim_id == "wakeup":
        prog = (f_idx + 1) / max(1, f_count)
        hip_y = -18.0 * (1.0 - prog) - 92.0 * prog
        shoulder_x = -40.0 * (1.0 - prog) + 2.0 * prog
        shoulder_y = -20.0 * (1.0 - prog) - 146.0 * prog
        head_x = -56.0 * (1.0 - prog) + 4.0 * prog
        head_y = -24.0 * (1.0 - prog) - 168.0 * prog
        l_foot = (-18.0, -4.0)
        r_foot = (18.0, -4.0)
        l_hand = (-18.0, -110.0 * prog - 20.0 * (1.0 - prog))
        r_hand = (22.0, -112.0 * prog - 20.0 * (1.0 - prog))

    def to_canvas(pt: tuple[float, float]) -> tuple[float, float]:
        return (ANCHOR_X + pt[0], ANCHOR_Y + pt[1])

    hip = to_canvas((hip_x, hip_y))
    sh = to_canvas((shoulder_x, shoulder_y))
    hd = to_canvas((head_x, head_y))
    lf = to_canvas(l_foot)
    rf = to_canvas(r_foot)
    lh = to_canvas(l_hand)
    rh = to_canvas(r_hand)

    l_knee = ((hip[0] + lf[0]) * 0.5 + 4.0, (hip[1] + lf[1]) * 0.5)
    r_knee = ((hip[0] + rf[0]) * 0.5 + 6.0, (hip[1] + rf[1]) * 0.5)

    # Back limbs
    draw_limb(d, hip, l_knee, 12, dark, outline)
    draw_limb(d, l_knee, lf, 11, dark, outline)
    draw_limb(d, sh, lh, 10, dark, outline)

    # Torso
    draw_limb(d, hip, sh, 20, primary, outline)
    # Scarf / chest accent
    d.polygon([
        (sh[0] - 10, sh[1] - 4),
        (sh[0] + 12, sh[1] - 4),
        (sh[0] + 8, sh[1] + 14),
        (sh[0] - 12, sh[1] + 10),
    ], fill=accent, outline=outline)

    # Head + visor facing right so flip orientation is obvious
    hr = 16
    d.ellipse([hd[0] - hr, hd[1] - hr, hd[0] + hr, hd[1] + hr], fill=primary, outline=outline, width=3)
    d.rectangle([hd[0] + 2, hd[1] - 6, hd[0] + hr + 2, hd[1] + 2], fill=accent, outline=outline, width=2)

    # Front leg
    draw_limb(d, hip, r_knee, 13, primary, outline)
    draw_limb(d, r_knee, rf, 12, primary, outline)

    # Weapon / attack visual
    if weapon_tip is not None:
        wt = to_canvas(weapon_tip)
        draw_limb(d, rh, wt, 8, accent, outline)
    elif has_staff and anim_id not in ("knockdown", "hit"):
        wt = (rh[0] + 14.0, rh[1] - 28.0)
        draw_limb(d, (rh[0] - 6.0, rh[1] + 18.0), wt, 6, accent, outline)

    # Front arm
    draw_limb(d, sh, rh, 11, primary, outline)

    if anim_id == "block":
        # Guard shield bar in front
        d.rounded_rectangle([rh[0] + 4, sh[1] - 24, rh[0] + 14, hip[1] + 16],
                            radius=4, fill=(140, 210, 255, 200), outline=outline, width=2)

    return img


def extrude_pad(cropped: Image.Image, pad: int = 2) -> Image.Image:
    w, h = cropped.size
    out = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    out.paste(cropped, (pad, pad))
    # Extrude 1px edges outward to prevent bilinear bleed (spec part 2 section 7)
    top = cropped.crop((0, 0, w, 1))
    bot = cropped.crop((0, h - 1, w, h))
    left = cropped.crop((0, 0, 1, h))
    right = cropped.crop((w - 1, 0, w, h))
    for p in range(pad):
        out.paste(top, (pad, p))
        out.paste(bot, (pad, h + pad + p))
        out.paste(left, (p, pad))
        out.paste(right, (w + pad + p, pad))
    return out


def pack_animation(char_dir: Path, anim_id: str, frames: list[Image.Image]) -> None:
    anim_dir = char_dir / "animations" / anim_id
    anim_dir.mkdir(parents=True, exist_ok=True)
    sprites_dir = char_dir / "sprites"
    sprites_dir.mkdir(parents=True, exist_ok=True)

    cropped_cells: list[tuple[Image.Image, tuple[int, int], tuple[int, int]]] = []
    for idx, img in enumerate(frames):
        img.save(anim_dir / f"frame_{idx:03d}.png", format="PNG")
        bbox = img.getbbox() or (ANCHOR_X - 1, ANCHOR_Y - 1, ANCHOR_X + 1, ANCHOR_Y + 1)
        crop = img.crop(bbox)
        padded = extrude_pad(crop, pad=2)
        cropped_cells.append((padded, (bbox[0], bbox[1]), crop.size))

    cols = min(4, len(cropped_cells))
    rows = (len(cropped_cells) + cols - 1) // cols
    cell_w = max(c[0].size[0] for c in cropped_cells)
    cell_h = max(c[0].size[1] for c in cropped_cells)
    sheet = Image.new("RGBA", (cols * cell_w, rows * cell_h), (0, 0, 0, 0))

    atlas_entries = []
    for idx, (padded, crop_off, orig_size) in enumerate(cropped_cells):
        gx = (idx % cols) * cell_w
        gy = (idx // cols) * cell_h
        sheet.paste(padded, (gx, gy))
        atlas_entries.append({
            "frame": idx,
            "rect": [gx + 2, gy + 2, orig_size[0], orig_size[1]],
            "crop_offset": [crop_off[0], crop_off[1]],
        })

    sheet_name = f"{anim_id}.png"
    sheet.save(sprites_dir / sheet_name, format="PNG")
    (sprites_dir / f"{anim_id}.json").write_text(
        json.dumps({"animation_id": anim_id, "sheet": sheet_name, "frames": atlas_entries}, indent=2) + "\n",
        encoding="utf-8",
    )


def make_previews(char_dir: Path, primary: tuple[int, int, int, int],
                  accent: tuple[int, int, int, int]) -> None:
    prev_dir = char_dir / "previews"
    prev_dir.mkdir(parents=True, exist_ok=True)
    pose = render_mannequin_frame("idle", 0, 8, primary, accent, False)
    portrait = Image.new("RGBA", (128, 128), (24, 28, 40, 255))
    head_crop = pose.crop((192, 286, 320, 414))
    portrait.alpha_composite(head_crop, (0, 0))
    d = ImageDraw.Draw(portrait)
    d.rectangle([0, 0, 127, 127], outline=accent, width=4)
    portrait.save(prev_dir / "portrait.png", format="PNG")

    splash = Image.new("RGBA", (256, 320), (18, 22, 32, 230))
    body_crop = pose.crop((128, 180, 384, 500))
    splash.alpha_composite(body_crop, (0, 0))
    ImageDraw.Draw(splash).rectangle([0, 0, 255, 319], outline=accent, width=3)
    splash.save(prev_dir / "splash.png", format="PNG")


def update_char_sources(char_dir: Path) -> None:
    placeholder = {
        "source": "programmatic placeholder generated by asset_pipeline/generate_test_placeholders.py",
        "author": "cross-arena",
        "license": "project-internal",
        "redistributable": True,
        "placeholder": True,
    }
    entries = [dict(path=p, **placeholder) for p in ("animations/*", "sprites/*", "previews/*")]
    (char_dir / "metadata" / "sources.json").write_text(
        json.dumps({"entries": entries}, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    configs = [
        ("dummy_a", (68, 152, 245, 255), (255, 206, 72, 255), False),
        ("dummy_b", (232, 92, 108, 255), (108, 240, 212, 255), True),
    ]
    for short, primary, accent, has_staff in configs:
        cdir = PACK_DIR / "characters" / short
        for mp in sorted((cdir / "metadata").glob("*.json")):
            if mp.name == "sources.json":
                continue
            meta = json.loads(mp.read_text(encoding="utf-8"))
            aid = meta["animation_id"]
            f_count = int(meta["frame_count"])
            frames = [render_mannequin_frame(aid, i, f_count, primary, accent, has_staff) for i in range(f_count)]
            pack_animation(cdir, aid, frames)
        make_previews(cdir, primary, accent)
        update_char_sources(cdir)

    # IP cover & projectile effect placeholder
    cover = Image.new("RGBA", (320, 180), (20, 24, 36, 255))
    cd = ImageDraw.Draw(cover)
    cd.rectangle([4, 4, 315, 175], outline=(90, 170, 255, 255), width=3)
    cd.polygon([(40, 140), (130, 40), (160, 140)], fill=(68, 152, 245, 220))
    cd.polygon([(160, 140), (200, 40), (280, 140)], fill=(232, 92, 108, 220))
    cover.save(PACK_DIR / "cover.png", format="PNG")

    eff_dir = PACK_DIR / "effects" / "test_bolt"
    eff_dir.mkdir(parents=True, exist_ok=True)
    bolt = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bolt)
    bd.ellipse([10, 16, 54, 48], fill=(90, 245, 220, 235), outline=(255, 255, 255, 255), width=3)
    bd.ellipse([22, 22, 48, 42], fill=(255, 255, 255, 255))
    bolt.save(eff_dir / "frame_000.png", format="PNG")
    print("Generated test_pack placeholder sprites and sheets.")


if __name__ == "__main__":
    main()
