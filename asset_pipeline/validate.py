#!/usr/bin/env python3
"""Cross Arena content & architecture validator.

Enforces:
- Spec part 1 section 9.5 & part 2 section 8 data/asset rules
- Formalized decisions D1-D13 (see docs/decisions.md and docs/data_schema.md)

Standard library only.

Usage:
  python asset_pipeline/validate.py                      # whole project
  python asset_pipeline/validate.py --ip test_pack
  python asset_pipeline/validate.py --character test_pack.dummy_a
  python asset_pipeline/validate.py --skip-assets        # data only, ignore rendered files

Exit code: 0 = no errors (warnings allowed), 1 = errors found, 2 = bad usage.
A per-character report is written to <character>/metadata/check_report.md
unless --no-report is given.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- constants

CORE_MOVES: dict[str, list[str]] = {
    "core": ["idle", "walk_forward", "walk_backward", "dash", "crouch",
             "jump_start", "jump_loop", "landing"],
    "combat": ["light_01", "light_02", "medium_01", "heavy_01", "air_attack",
               "block", "hit", "knockdown", "wakeup", "throw"],
    "skill": ["skill_01", "skill_02", "skill_03", "skill_ultimate"],
    "presentation": ["intro", "victory", "defeat"],
}
CORE_MOVE_CATEGORY = {m: cat for cat, ms in CORE_MOVES.items() for m in ms}
ATTACK_MOVES = {"light_01", "light_02", "medium_01", "heavy_01", "air_attack", "throw"}
SKILL_MOVES = set(CORE_MOVES["skill"])
ANIMATION_TYPES = {"core", "combat", "skill", "presentation", "extra"}
SKILL_TYPES = {"melee", "projectile", "area", "dash", "control", "guard",
               "invuln", "multi_hit", "ultimate"}
CANCEL_KEYWORDS = {"skill", "ultimate"}
PRESENTATION_EVENT_TYPES = {"sfx", "vfx", "voice", "camera_shake", "flash"}
FACING_MODES = {"flip", "dual"}
IP_STATUSES = {"open", "locked"}
HURTBOX_STATES = ("stand", "crouch", "air", "down")
# Decision D6: pushbox requires all 4 states including 'down' to prevent wakeup overlap jitter.
PUSHBOX_STATES = ("stand", "crouch", "air", "down")

CORE_CODE_DIRS = frozenset({
    "core", "combat", "fighter", "hit_system", "skill_system",
    "combo_system", "animation", "ai_system", "network", "ui",
})
# Decision D11: scan all engine/project files outside excluded non-engine top-level folders.
EXCLUDED_TOP_DIRS = frozenset({
    "ip_content", "tests", "asset_pipeline", "addons", "docs",
    ".venv", ".cache", ".git", ".godot", "build",
})
EXCLUDED_ROOT_FILES = frozenset({
    "tools.local.json", "tools.local.example.json", ".gutconfig.json",
})
CORE_SCAN_EXTS = frozenset({
    ".gd", ".tscn", ".tres", ".gdshader", ".godot", ".cfg", ".json", ".cs", ".py",
})

CHAR_ASSET_DIRS = ["blender", "model", "textures", "animations", "sprites", "previews"]
IP_ASSET_DIRS = ["stages", "effects", "audio"]
GENERATED_ASSET_DIRS = frozenset({"animations", "sprites"})
METADATA_RESERVED = {"sources.json"}
FRAMEDATA_RESERVED = {"hurtboxes.json"}

ID_RE = re.compile(r"^[a-z0-9_]+$")
CHAR_ID_RE = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
NAME_RE = re.compile(r"^[a-z0-9_]+(\.[a-z0-9_]+)*$")
FRAME_RE = re.compile(r"^frame_(\d{3})\.png$")

# Decision D8: single-owner rule (part 1 section 9.2).
KEY_OWNERS: dict[str, str] = {}
for _k in ("damage", "knockback", "hitstun", "blockstun", "hitstop", "block_hitstop",
           "hitboxes", "cancel_windows", "invuln_frames", "armor_frames",
           "startup", "active", "recovery", "projectile_spawn", "hurtbox_override",
           "combat_events", "super_freeze", "meter_gain_on_hit",
           "meter_gain_on_block", "meter_gain_on_whiff"):
    KEY_OWNERS[_k] = "framedata"
for _k in ("cooldown", "cost", "projectile_gravity"):
    KEY_OWNERS[_k] = "skill"
for _k in ("stats", "max_hp", "walk_speed", "jump_velocity", "defense", "gravity",
           "max_gauge", "gauge_gain_on_hurt_pct", "gauge_gain_on_block_pct"):
    KEY_OWNERS[_k] = "fighter"

# Keys legitimately shared by a fixed subset of file kinds and forbidden elsewhere (D8).
MULTI_KEY_OWNERS: dict[str, frozenset[str]] = {
    "animation_id": frozenset({"animation", "framedata"}),
}

# Decision D11: standard engine, color, geometry, and combat terms that may collide with
# short English character codenames (e.g. "Red" vs Color.RED, "Ash" vs ash_fade, "Spot" vs spot).
ENGINE_COLLISION_WORDS: frozenset[str] = frozenset({
    # Colors & visual terms
    "red", "blue", "green", "white", "black", "gray", "grey", "cyan",
    "pink", "gold", "silver", "orange", "yellow", "purple", "violet",
    "brown", "indigo", "crimson", "scarlet", "amber", "ivory", "azure",
    "ash", "frost", "blaze", "flame", "spark", "flash", "shadow", "glow",
    "haze", "mist", "snow", "rain", "wind", "storm", "cloud", "smoke",
    # Geometry, combat & engine identifiers
    "spot", "point", "line", "rect", "box", "edge", "grid", "node", "root",
    "light", "medium", "heavy", "block", "guard", "shield", "armor",
    "dash", "rush", "jump", "walk", "idle", "hit", "throw", "slash",
    "pierce", "strike", "impact", "charge", "burst", "pulse", "wave",
    "rock", "stone", "iron", "steel", "sand", "dust", "ice", "fire",
    "fang", "claw", "wing", "horn", "tail", "plume", "thorn", "leaf",
    "dawn", "dusk", "night", "noon", "star", "moon", "sun", "sky", "void",
    "zero", "one", "ace", "king", "queen", "jack", "ghost", "phantom",
    "silence", "peace", "hope", "rope", "bena", "iris", "april", "may", "june",
})


# ---------------------------------------------------------------- reporting

@dataclass
class Issue:
    level: str   # "error" | "warning"
    code: str
    path: str
    message: str


@dataclass
class Report:
    root: Path
    issues: list[Issue] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def _rel(self, path: Path | str) -> str:
        p = Path(path)
        try:
            return p.resolve().relative_to(self.root.resolve()).as_posix()
        except ValueError:
            return p.as_posix()

    def error(self, code: str, path: Path | str, message: str) -> None:
        self.issues.append(Issue("error", code, self._rel(path), message))

    def warn(self, code: str, path: Path | str, message: str) -> None:
        self.issues.append(Issue("warning", code, self._rel(path), message))

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "error"]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "warning"]

    def codes(self, level: str | None = None) -> set[str]:
        return {i.code for i in self.issues if level is None or i.level == level}

    def subset(self, prefix: str) -> list[Issue]:
        return [i for i in self.issues if i.path.startswith(prefix)]


# ---------------------------------------------------------------- helpers

def is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def is_num(v) -> bool:
    return (isinstance(v, (int, float))) and not isinstance(v, bool)


def load_json(path: Path, rep: Report):
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        rep.error("FILE_MISSING", path, "file not found")
    except json.JSONDecodeError as exc:
        rep.error("JSON_INVALID", path, f"invalid JSON: {exc}")
    except UnicodeDecodeError as exc:
        rep.error("JSON_INVALID", path, f"not UTF-8: {exc}")
    return None


def require(obj: dict, key: str, kind, rep: Report, path: Path, code="FIELD_INVALID"):
    """Check obj[key] exists and passes kind (a predicate or type). Returns value or None."""
    if key not in obj:
        rep.error("FIELD_MISSING", path, f"missing field '{key}'")
        return None
    v = obj[key]
    ok = kind(v) if callable(kind) and not isinstance(kind, type) else isinstance(v, kind)
    if not ok:
        rep.error(code, path, f"field '{key}' has invalid value {v!r}")
        return None
    return v


def anim_length_sim_frames(frame_count: int, fps: int) -> int:
    """Number of 60 Hz simulation frames an animation spans (part 3 section 9 mapping)."""
    return (frame_count * 60 + fps - 1) // fps


def check_range(rng, total: int, what: str, rep: Report, path: Path) -> bool:
    if not (isinstance(rng, list) and len(rng) == 2 and all(is_int(x) for x in rng)):
        rep.error("FRAME_RANGE_INVALID", path, f"{what}: frame range must be [start, end], got {rng!r}")
        return False
    a, b = rng
    if a < 0 or b < a or b >= total:
        rep.error("FRAME_RANGE_OUT_OF_BOUNDS", path,
                  f"{what}: frames [{a}, {b}] outside move length 0..{total - 1}")
        return False
    return True


def check_rect(rect, what: str, rep: Report, path: Path) -> bool:
    if not (isinstance(rect, list) and len(rect) == 4 and all(is_int(x) for x in rect)):
        rep.error("RECT_INVALID", path, f"{what}: rect must be 4 integers [x, y, w, h], got {rect!r}")
        return False
    if rect[2] <= 0 or rect[3] <= 0:
        rep.error("RECT_INVALID", path, f"{what}: rect width/height must be > 0, got {rect!r}")
        return False
    return True


def check_key_ownership(obj, kind: str, rep: Report, path: Path, trail: str = "") -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            here = f"{trail}.{k}" if trail else k
            owner = KEY_OWNERS.get(k)
            if owner is not None and owner != kind:
                if k == "combat_events":
                    msg = "combat_events are not allowed in animation data; move them to FrameData"
                else:
                    msg = f"key '{here}' belongs to {owner} data only (single-owner rule)"
                rep.error("DUPLICATE_OWNERSHIP", path, msg)
            allowed_kinds = MULTI_KEY_OWNERS.get(k)
            if allowed_kinds is not None and kind not in allowed_kinds:
                rep.error("DUPLICATE_OWNERSHIP", path,
                          f"key '{here}' belongs to {sorted(allowed_kinds)} data only (single-owner rule)")
            check_key_ownership(v, kind, rep, path, here)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            check_key_ownership(v, kind, rep, path, f"{trail}[{i}]")


def list_files(base: Path) -> list[Path]:
    if not base.is_dir():
        return []
    return sorted(
        p for p in base.rglob("*")
        if p.is_file() and p.suffix.lower() not in {".import", ".uid"}
    )


def check_names(base: Path, rep: Report) -> None:
    """Part 1 section 7: every directory and file name under ip_content is lowercase ASCII."""
    for p in sorted(base.rglob("*")):
        if not NAME_RE.match(p.name):
            rep.error("NAME_INVALID", p, f"name '{p.name}' must be lowercase ASCII [a-z0-9_.]")


def check_sources(owner_dir: Path, sources_path: Path, asset_dirs: list[str],
                  rep: Report, required: bool, skip_assets: bool,
                  extra_files: list[Path] | None = None) -> None:
    files = sorted({*(extra_files or []), *(f for d in asset_dirs for f in list_files(owner_dir / d))})
    if not sources_path.is_file():
        if required or files:
            rep.error("SOURCES_MISSING", sources_path, "sources.json is required")
        return
    data = load_json(sources_path, rep)
    if data is None:
        return
    entries = data.get("entries") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        rep.error("FIELD_INVALID", sources_path, "'entries' must be a list")
        return
    patterns: list[str] = []
    for i, e in enumerate(entries):
        where = f"entries[{i}]"
        if not isinstance(e, dict):
            rep.error("FIELD_INVALID", sources_path, f"{where} must be an object")
            continue
        ok = True
        for key in ("path", "source", "author", "license"):
            if not isinstance(e.get(key), str) or not e.get(key):
                rep.error("FIELD_MISSING", sources_path, f"{where}.{key} must be a non-empty string")
                ok = False
        if not isinstance(e.get("redistributable"), bool):
            rep.error("FIELD_MISSING", sources_path, f"{where}.redistributable must be true/false")
            ok = False
        if "placeholder" in e and not isinstance(e["placeholder"], bool):
            rep.error("FIELD_INVALID", sources_path, f"{where}.placeholder must be true/false")
            ok = False
        if ok:
            pat = e["path"]
            patterns.append(pat)
            is_placeholder = e.get("placeholder") is True
            if not is_placeholder and ("*" in pat or "?" in pat):
                top_seg = pat.split("/", 1)[0]
                if top_seg not in GENERATED_ASSET_DIRS:
                    rep.warn("SOURCES_BROAD_WILDCARD", sources_path,
                             f"{where}: wildcard '{pat}' on non-generated source assets; "
                             f"register concrete files or set placeholder=true")
    # fnmatch '*' also matches '/', so "animations/*" covers the whole subtree.
    for f in files:
        rel = f.relative_to(owner_dir).as_posix()
        if not any(fnmatch.fnmatchcase(rel, pat) for pat in patterns):
            rep.error("SOURCES_UNCOVERED", f, "asset has no entry in sources.json")
    if not skip_assets:
        for pat in patterns:
            if not any(fnmatch.fnmatchcase(f.relative_to(owner_dir).as_posix(), pat) for f in files):
                rep.warn("SOURCES_UNUSED", sources_path, f"entry '{pat}' matches no file")


# ---------------------------------------------------------------- per-file validators

def validate_animation(path: Path, char_id: str, canvas_ref: list, rep: Report,
                       char_dir: Path, skip_assets: bool):
    d = load_json(path, rep)
    if not isinstance(d, dict):
        return None
    check_key_ownership(d, "animation", rep, path)
    aid = require(d, "animation_id", str, rep, path)
    if aid is not None and aid != path.stem:
        rep.error("ID_MISMATCH", path, f"animation_id '{aid}' must equal file name '{path.stem}'")
    cid = require(d, "character_id", str, rep, path)
    if cid is not None and cid != char_id:
        rep.error("ID_MISMATCH", path, f"character_id '{cid}' must be '{char_id}'")
    atype = require(d, "animation_type", lambda v: v in ANIMATION_TYPES, rep, path)
    cat = CORE_MOVE_CATEGORY.get(path.stem)
    if atype is not None and cat is not None and atype != cat:
        rep.error("ANIMATION_TYPE_MISMATCH", path,
                  f"core move '{path.stem}' must have animation_type '{cat}', got '{atype}'")
    n = require(d, "frame_count", lambda v: is_int(v) and v > 0, rep, path)
    fps = require(d, "animation_fps", lambda v: is_int(v) and 0 < v <= 60, rep, path)
    require(d, "loop", bool, rep, path)
    facing = require(d, "facing_mode", lambda v: v in FACING_MODES, rep, path)
    canvas = require(d, "canvas_size",
                     lambda v: isinstance(v, list) and len(v) == 2 and all(is_int(x) and x > 0 for x in v),
                     rep, path)
    for key in ("pivot", "ground_anchor"):
        pt = require(d, key, lambda v: isinstance(v, list) and len(v) == 2 and all(is_int(x) for x in v),
                     rep, path)
        if pt is not None and canvas is not None:
            if not (0 <= pt[0] < canvas[0] and 0 <= pt[1] < canvas[1]):
                rep.error("POINT_OUTSIDE_CANVAS", path, f"{key} {pt} outside canvas {canvas}")
    if canvas is not None:
        if canvas_ref and canvas != canvas_ref[0]:
            rep.error("CANVAS_INCONSISTENT", path,
                      f"canvas_size {canvas} differs from {canvas_ref[0]} used by other animations of this character")
        elif not canvas_ref:
            canvas_ref.append(canvas)
    src = require(d, "source_frames", str, rep, path)
    events = d.get("presentation_events", [])
    if not isinstance(events, list):
        rep.error("FIELD_INVALID", path, "presentation_events must be a list")
    else:
        for i, ev in enumerate(events):
            if not (isinstance(ev, dict) and is_int(ev.get("frame")) and isinstance(ev.get("type"), str)):
                rep.error("FIELD_INVALID", path, f"presentation_events[{i}] needs integer 'frame' and string 'type'")
                continue
            if n is not None and not (0 <= ev["frame"] < n):
                rep.error("FRAME_RANGE_OUT_OF_BOUNDS", path,
                          f"presentation_events[{i}] frame {ev['frame']} outside 0..{n - 1}")
            if ev["type"] not in PRESENTATION_EVENT_TYPES:
                rep.warn("EVENT_TYPE_UNKNOWN", path, f"presentation event type '{ev['type']}' is not a known type")
    if not skip_assets and src is not None and n is not None:
        check_frames(char_dir / src, n, rep, path)
        if facing == "dual":
            left = d.get("source_frames_left")
            if not isinstance(left, str):
                rep.error("FIELD_MISSING", path, "facing_mode 'dual' requires 'source_frames_left'")
            else:
                check_frames(char_dir / left, n, rep, path)
    if n is None or fps is None:
        return None
    return {"frame_count": n, "fps": fps, "sim_length": anim_length_sim_frames(n, fps)}


def check_frames(frames_dir: Path, expected: int, rep: Report, meta_path: Path) -> None:
    if not frames_dir.is_dir():
        rep.error("FRAMES_MISSING", meta_path, f"frame directory '{frames_dir.name}/' does not exist")
        return
    idx = []
    for f in frames_dir.iterdir():
        if f.suffix.lower() in {".import", ".uid"}:
            continue
        m = FRAME_RE.match(f.name)
        if m:
            idx.append(int(m.group(1)))
        elif f.is_file():
            rep.warn("FRAME_FILE_UNEXPECTED", f, "unexpected file in frame directory")
    idx.sort()
    if not idx:
        rep.error("FRAMES_MISSING", meta_path, f"no frame_NNN.png files in '{frames_dir.name}/'")
        return
    if idx != list(range(len(idx))):
        missing = sorted(set(range(idx[-1] + 1)) - set(idx))
        rep.error("FRAMES_NONCONTIGUOUS", meta_path, f"frame numbers not contiguous, missing {missing[:10]}")
    if len(idx) != expected:
        rep.error("FRAME_COUNT_MISMATCH", meta_path,
                  f"metadata frame_count {expected} but {len(idx)} frames on disk")


def check_hit(hit: dict, what: str, rep: Report, path: Path) -> None:
    if not isinstance(hit, dict):
        rep.error("FIELD_INVALID", path, f"{what} must be an object")
        return
    for key in ("damage", "hitstun", "blockstun", "hitstop", "priority"):
        if not (is_int(hit.get(key)) and hit[key] >= 0):
            rep.error("FIELD_INVALID", path, f"{what}.{key} must be an integer >= 0")
    for opt_key in ("block_hitstop", "meter_gain_on_hit", "meter_gain_on_block"):
        if opt_key in hit and not (is_int(hit[opt_key]) and hit[opt_key] >= 0):
            rep.error("FIELD_INVALID", path, f"{what}.{opt_key} must be an integer >= 0")
    kb = hit.get("knockback")
    if not (isinstance(kb, list) and len(kb) == 2 and all(is_int(x) for x in kb)):
        rep.error("FIELD_INVALID", path, f"{what}.knockback must be [x, y] integers")
    if not isinstance(hit.get("air_hit"), bool):
        rep.error("FIELD_INVALID", path, f"{what}.air_hit must be true/false")


def validate_framedata(path: Path, anims: dict, move_ids: set, rep: Report):
    d = load_json(path, rep)
    if not isinstance(d, dict):
        return None
    check_key_ownership(d, "framedata", rep, path)
    mid = require(d, "move_id", str, rep, path)
    if mid is not None and mid != path.stem:
        rep.error("ID_MISMATCH", path, f"move_id '{mid}' must equal file name '{path.stem}'")
    aid = require(d, "animation_id", str, rep, path)
    s = require(d, "startup", lambda v: is_int(v) and v >= 0, rep, path)
    a = require(d, "active", lambda v: is_int(v) and v >= 0, rep, path)
    r = require(d, "recovery", lambda v: is_int(v) and v >= 0, rep, path)
    if None in (s, a, r):
        return d
    total = s + a + r
    if total <= 0:
        rep.error("FIELD_INVALID", path, "startup + active + recovery must be > 0")
        return d
    if aid is not None:
        anim = anims.get(aid)
        if anim is None:
            rep.error("ANIMATION_MISSING", path, f"animation_id '{aid}' has no metadata/{aid}.json")
        elif total > anim["sim_length"]:
            rep.error("FRAMEDATA_TOO_LONG", path,
                      f"move lasts {total} sim frames but animation '{aid}' covers only "
                      f"{anim['sim_length']} ({anim['frame_count']} frames @ {anim['fps']} fps)")
    if "meter_gain_on_whiff" in d and not (is_int(d["meter_gain_on_whiff"]) and d["meter_gain_on_whiff"] >= 0):
        rep.error("FIELD_INVALID", path, "meter_gain_on_whiff must be an integer >= 0")
    if "super_freeze" in d:
        sf = d["super_freeze"]
        if not isinstance(sf, dict):
            rep.error("FIELD_INVALID", path, "super_freeze must be an object")
        else:
            fr = sf.get("frame")
            dur = sf.get("duration")
            if not (is_int(fr) and 0 <= fr < total):
                rep.error("FRAME_RANGE_OUT_OF_BOUNDS", path, f"super_freeze.frame {fr!r} outside 0..{total - 1}")
            if not (is_int(dur) and dur > 0):
                rep.error("FIELD_INVALID", path, "super_freeze.duration must be an integer > 0")
    active_lo, active_hi = s, s + a - 1
    for i, hb in enumerate(d.get("hitboxes", [])):
        what = f"hitboxes[{i}]"
        if not isinstance(hb, dict):
            rep.error("FIELD_INVALID", path, f"{what} must be an object")
            continue
        if check_range(hb.get("frames"), total, what, rep, path):
            lo, hi = hb["frames"]
            if a == 0 or lo < active_lo or hi > active_hi:
                rep.warn("HITBOX_OUTSIDE_ACTIVE", path,
                         f"{what} frames {hb['frames']} outside active window [{active_lo}, {active_hi}]")
        check_rect(hb.get("rect"), what, rep, path)
        check_hit(hb, what, rep, path)
        if "hit_index" in hb and not (is_int(hb["hit_index"]) and hb["hit_index"] >= 0):
            rep.error("FIELD_INVALID", path, f"{what}.hit_index must be an integer >= 0")
    if not isinstance(d.get("hitboxes", []), list):
        rep.error("FIELD_INVALID", path, "hitboxes must be a list")
    for i, cw in enumerate(d.get("cancel_windows", [])):
        what = f"cancel_windows[{i}]"
        if not isinstance(cw, dict):
            rep.error("FIELD_INVALID", path, f"{what} must be an object")
            continue
        check_range(cw.get("frames"), total, what, rep, path)
        into = cw.get("into")
        if not (isinstance(into, list) and into and all(isinstance(x, str) for x in into)):
            rep.error("FIELD_INVALID", path, f"{what}.into must be a non-empty list of move ids")
            continue
        for target in into:
            if target not in CANCEL_KEYWORDS and target not in move_ids:
                rep.error("CANCEL_TARGET_UNKNOWN", path,
                          f"{what} cancels into '{target}', which is neither a move of this character nor one of {sorted(CANCEL_KEYWORDS)}")
    for key in ("invuln_frames", "armor_frames"):
        v = d.get(key, [])
        if not isinstance(v, list):
            rep.error("FIELD_INVALID", path, f"{key} must be a list of [start, end]")
            continue
        for i, rng in enumerate(v):
            check_range(rng, total, f"{key}[{i}]", rep, path)
    for i, ov in enumerate(d.get("hurtbox_override", [])):
        what = f"hurtbox_override[{i}]"
        if not isinstance(ov, dict):
            rep.error("FIELD_INVALID", path, f"{what} must be an object")
            continue
        check_range(ov.get("frames"), total, what, rep, path)
        rects = ov.get("rects")
        if not (isinstance(rects, list) and rects):
            rep.error("FIELD_INVALID", path, f"{what}.rects must be a non-empty list")
        else:
            for j, rc in enumerate(rects):
                check_rect(rc, f"{what}.rects[{j}]", rep, path)
    for i, ps in enumerate(d.get("projectile_spawn", [])):
        what = f"projectile_spawn[{i}]"
        if not isinstance(ps, dict):
            rep.error("FIELD_INVALID", path, f"{what} must be an object")
            continue
        fr = ps.get("frame")
        if not (is_int(fr) and 0 <= fr < total):
            rep.error("FRAME_RANGE_OUT_OF_BOUNDS", path, f"{what}.frame {fr!r} outside 0..{total - 1}")
        off = ps.get("offset")
        if not (isinstance(off, list) and len(off) == 2 and all(is_int(x) for x in off)):
            rep.error("FIELD_INVALID", path, f"{what}.offset must be [x, y] integers")
        check_rect(ps.get("rect"), what, rep, path)
        check_hit(ps.get("hit"), f"{what}.hit", rep, path)
    return d


def validate_hurtboxes(path: Path, config: str, rep: Report) -> None:
    d = load_json(path, rep)
    if not isinstance(d, dict):
        return
    check_key_ownership(d, "hurtbox", rep, path)
    cfg = d.get(config)
    if not isinstance(cfg, dict):
        rep.error("HURTBOX_CONFIG_MISSING", path, f"hurtbox config '{config}' not found")
        return
    for st in HURTBOX_STATES:
        rects = cfg.get(st)
        if not (isinstance(rects, list) and rects):
            rep.error("HURTBOX_CONFIG_MISSING", path, f"'{config}.{st}' must be a non-empty list of rects")
            continue
        for j, rc in enumerate(rects):
            check_rect(rc, f"{config}.{st}[{j}]", rep, path)
    push = cfg.get("pushbox")
    if not isinstance(push, dict):
        rep.error("HURTBOX_CONFIG_MISSING", path, f"'{config}.pushbox' must define {list(PUSHBOX_STATES)}")
        return
    for st in PUSHBOX_STATES:
        if st not in push:
            rep.error("HURTBOX_CONFIG_MISSING", path, f"'{config}.pushbox.{st}' is required")
            continue
        check_rect(push.get(st), f"{config}.pushbox.{st}", rep, path)


def validate_skill(path: Path, framedata: dict, rep: Report, ip_dir: Path, skip_assets: bool):
    d = load_json(path, rep)
    if not isinstance(d, dict):
        return None
    check_key_ownership(d, "skill", rep, path)
    sid = require(d, "skill_id", str, rep, path)
    if sid is not None and sid != path.stem:
        rep.error("ID_MISMATCH", path, f"skill_id '{sid}' must equal file name '{path.stem}'")
    stype = require(d, "type", lambda v: v in SKILL_TYPES, rep, path)
    require(d, "input", lambda v: isinstance(v, str) and v != "", rep, path)
    require(d, "cost", lambda v: is_int(v) and v >= 0, rep, path)
    require(d, "cooldown", lambda v: is_int(v) and v >= 0, rep, path)
    mid = require(d, "move_id", str, rep, path)
    fd = framedata.get(mid) if mid is not None else None
    if mid is not None and mid not in framedata:
        rep.error("FRAMEDATA_MISSING", path, f"move_id '{mid}' has no framedata/{mid}.json")
    if stype == "projectile":
        proj = d.get("projectile")
        if not isinstance(proj, dict):
            rep.error("FIELD_MISSING", path, "projectile skill needs a 'projectile' object")
        else:
            if not isinstance(proj.get("effect"), str):
                rep.error("FIELD_INVALID", path, "projectile.effect must be a path string")
            elif not skip_assets and not (ip_dir / proj["effect"]).exists():
                rep.error("EFFECT_MISSING", path, f"effect '{proj['effect']}' not found under the IP folder")
            if not is_int(proj.get("speed")):
                rep.error("FIELD_INVALID", path, "projectile.speed must be an integer")
            if not (is_int(proj.get("lifetime")) and proj["lifetime"] > 0):
                rep.error("FIELD_INVALID", path, "projectile.lifetime must be an integer > 0")
            if "velocity_y" in proj and not is_int(proj["velocity_y"]):
                rep.error("FIELD_INVALID", path, "projectile.velocity_y must be an integer")
            if "projectile_gravity" in proj and not (is_int(proj["projectile_gravity"]) and proj["projectile_gravity"] >= 0):
                rep.error("FIELD_INVALID", path, "projectile.projectile_gravity must be an integer >= 0")
        if isinstance(fd, dict) and not fd.get("projectile_spawn"):
            rep.error("PROJECTILE_SPAWN_MISSING", path,
                      f"projectile skill but framedata/{mid}.json has no projectile_spawn")
    return d


def validate_combat_config(path: Path, rep: Report) -> None:
    """Validate optional global non-IP combat config (Decision D6)."""
    if not path.is_file():
        return
    d = load_json(path, rep)
    if not isinstance(d, dict):
        return
    check_key_ownership(d, "combat_config", rep, path)
    require(d, "stage_half_width", lambda v: is_int(v) and v > 0, rep, path)
    require(d, "corner_pushback_permille", lambda v: is_int(v) and 0 <= v <= 2000, rep, path)
    require(d, "input_buffer_frames", lambda v: is_int(v) and v >= 0, rep, path)
    require(d, "motion_input_window_frames", lambda v: is_int(v) and v > 0, rep, path)
    require(d, "juggle_max_hits", lambda v: is_int(v) and v >= 0, rep, path)
    require(d, "same_move_combo_limit", lambda v: is_int(v) and v > 0, rep, path)
    require(d, "damage_scaling_pct",
            lambda v: isinstance(v, list) and len(v) > 0 and all(is_int(x) and 1 <= x <= 100 for x in v),
            rep, path)
    require(d, "min_damage_scaling_pct", lambda v: is_int(v) and 1 <= v <= 100, rep, path)


# ---------------------------------------------------------------- character / IP

def validate_character(char_dir: Path, ip_id: str, ip_dir: Path, rep: Report, skip_assets: bool) -> dict | None:
    path = char_dir / "character.json"
    d = load_json(path, rep)
    if not isinstance(d, dict):
        return None
    check_key_ownership(d, "fighter", rep, path)
    expected_id = f"{ip_id}.{char_dir.name}"
    cid = require(d, "id", lambda v: isinstance(v, str) and CHAR_ID_RE.match(v), rep, path)
    if cid is not None and cid != expected_id:
        rep.error("ID_MISMATCH", path, f"id '{cid}' must be '{expected_id}' (ip prefix + folder name)")
    cid = expected_id
    ipf = require(d, "ip_id", str, rep, path)
    if ipf is not None and ipf != ip_id:
        rep.error("ID_MISMATCH", path, f"ip_id '{ipf}' must be '{ip_id}'")
    for key in ("name_zh", "name_en"):
        require(d, key, lambda v: isinstance(v, str) and v != "", rep, path)
    stats = require(d, "stats", dict, rep, path)
    if stats is not None:
        for key in ("max_hp", "walk_speed", "jump_velocity", "gravity"):
            if not (is_int(stats.get(key)) and stats[key] > 0):
                rep.error("FIELD_INVALID", path, f"stats.{key} must be an integer > 0")
        if not (is_int(stats.get("defense")) and stats["defense"] >= 0):
            rep.error("FIELD_INVALID", path, "stats.defense must be an integer >= 0")
        if "max_gauge" in stats and not (is_int(stats["max_gauge"]) and stats["max_gauge"] > 0):
            rep.error("FIELD_INVALID", path, "stats.max_gauge must be an integer > 0")
        for gkey in ("gauge_gain_on_hurt_pct", "gauge_gain_on_block_pct"):
            if gkey in stats and not (is_int(stats[gkey]) and stats[gkey] >= 0):
                rep.error("FIELD_INVALID", path, f"stats.{gkey} must be an integer >= 0")
    require(d, "height_scale", lambda v: is_num(v) and v > 0, rep, path)
    ai = d.get("ai_profile", {})
    if not isinstance(ai, dict) or not all(is_num(v) and 0 <= v <= 1 for v in ai.values()):
        rep.error("FIELD_INVALID", path, "ai_profile values must be numbers in [0, 1]")
    unsupported = require(d, "unsupported_core_moves",
                          lambda v: isinstance(v, list) and all(isinstance(x, str) for x in v), rep, path) or []
    for m in unsupported:
        if m not in CORE_MOVE_CATEGORY:
            rep.error("UNSUPPORTED_UNKNOWN", path, f"'{m}' in unsupported_core_moves is not a core move")
    if not skip_assets:
        for key in ("portrait", "splash"):
            rel = d.get(key)
            if isinstance(rel, str) and not (char_dir / rel).is_file():
                rep.error("ASSET_MISSING", path, f"{key} '{rel}' not found")

    # animations
    anims: dict[str, dict] = {}
    canvas_ref: list = []
    meta_dir = char_dir / "metadata"
    for mp in sorted(meta_dir.glob("*.json")) if meta_dir.is_dir() else []:
        if mp.name in METADATA_RESERVED:
            continue
        info = validate_animation(mp, cid, canvas_ref, rep, char_dir, skip_assets)
        if info is not None:
            anims[mp.stem] = info

    # framedata
    fd_dir = char_dir / "framedata"
    fd_files = [p for p in sorted(fd_dir.glob("*.json"))] if fd_dir.is_dir() else []
    move_ids = {p.stem for p in fd_files if p.name not in FRAMEDATA_RESERVED}
    framedata: dict[str, dict] = {}
    for fp in fd_files:
        if fp.name in FRAMEDATA_RESERVED:
            continue
        fdd = validate_framedata(fp, anims, move_ids, rep)
        if fdd is not None:
            framedata[fp.stem] = fdd

    hb_cfg = require(d, "hurtboxes", str, rep, path)
    if hb_cfg is not None:
        validate_hurtboxes(fd_dir / "hurtboxes.json", hb_cfg, rep)

    # skills
    skill_refs = require(d, "skills", lambda v: isinstance(v, list) and all(isinstance(x, str) for x in v),
                         rep, path) or []
    skill_moves: set[str] = set()
    seen_ids: set[str] = set()
    for ref in skill_refs:
        sp = char_dir / ref
        if not sp.is_file():
            rep.error("SKILL_FILE_MISSING", path, f"skill '{ref}' not found")
            continue
        sd = validate_skill(sp, framedata, rep, ip_dir, skip_assets)
        if isinstance(sd, dict):
            if sd.get("skill_id") in seen_ids:
                rep.error("DUPLICATE_ID", sp, f"skill_id '{sd.get('skill_id')}' used twice")
            seen_ids.add(sd.get("skill_id"))
            if isinstance(sd.get("move_id"), str):
                skill_moves.add(sd["move_id"])
    referenced = {(char_dir / r).resolve() for r in skill_refs}
    skills_dir = char_dir / "skills"
    for sp in sorted(skills_dir.glob("*.json")) if skills_dir.is_dir() else []:
        if sp.resolve() not in referenced:
            rep.warn("SKILL_UNREFERENCED", sp, "skill file is not listed in character.json")

    # core move list (part 1 section 7)
    for move in CORE_MOVE_CATEGORY:
        exists = move in anims or (meta_dir / f"{move}.json").is_file()
        if move in unsupported:
            if exists:
                rep.warn("UNSUPPORTED_BUT_PRESENT", path, f"'{move}' is declared unsupported but has animation metadata")
            continue
        if not exists:
            rep.error("CORE_MOVE_MISSING", path,
                      f"core move '{move}' has no metadata/{move}.json and is not in unsupported_core_moves")
            continue
        if move in ATTACK_MOVES or move in SKILL_MOVES:
            if move not in framedata and not (fd_dir / f"{move}.json").is_file():
                rep.error("FRAMEDATA_MISSING", path, f"attack/skill move '{move}' has no framedata/{move}.json")
        if move in SKILL_MOVES and move not in skill_moves:
            rep.warn("SKILL_MOVE_UNUSED", path, f"'{move}' exists but no listed skill uses it")

    check_sources(char_dir, meta_dir / "sources.json", CHAR_ASSET_DIRS, rep, required=True,
                  skip_assets=skip_assets)
    return d


def validate_ip(ip_dir: Path, rep: Report, skip_assets: bool, only_char: str | None = None) -> dict:
    """Returns {'ip': ip_json or None, 'characters': {id: character_json}}."""
    out = {"ip": None, "characters": {}}
    path = ip_dir / "ip.json"
    check_names(ip_dir, rep)
    d = load_json(path, rep)
    if isinstance(d, dict):
        check_key_ownership(d, "ip", rep, path)
        out["ip"] = d
        iid = require(d, "id", lambda v: isinstance(v, str) and ID_RE.match(v), rep, path)
        if iid is not None and iid != ip_dir.name:
            rep.error("ID_MISMATCH", path, f"id '{iid}' must equal folder name '{ip_dir.name}'")
        for key in ("name_zh", "name_en", "description", "cover"):
            require(d, key, str, rep, path)
        require(d, "status", lambda v: v in IP_STATUSES, rep, path)
        if "test_only" in d and not isinstance(d["test_only"], bool):
            rep.error("FIELD_INVALID", path, "test_only must be true/false")
        if not skip_assets and isinstance(d.get("cover"), str) and not (ip_dir / d["cover"]).is_file():
            rep.error("ASSET_MISSING", path, f"cover '{d['cover']}' not found")
    chars_dir = ip_dir / "characters"
    char_dirs = sorted(p for p in chars_dir.iterdir() if p.is_dir()) if chars_dir.is_dir() else []
    for cdir in char_dirs:
        cid = f"{ip_dir.name}.{cdir.name}"
        if only_char is not None and cid != only_char:
            continue
        cd = validate_character(cdir, ip_dir.name, ip_dir, rep, skip_assets)
        if cd is not None:
            out["characters"][cid] = cd
    if isinstance(d, dict) and only_char is None:
        all_ids = {f"{ip_dir.name}.{c.name}" for c in char_dirs}
        feat = d.get("featured_characters")
        if not (isinstance(feat, list) and all(isinstance(x, str) for x in feat)):
            rep.error("FIELD_INVALID", path, "featured_characters must be a list of character ids")
        else:
            for fc in feat:
                if fc not in all_ids:
                    rep.error("FEATURED_MISSING", path, f"featured character '{fc}' does not exist")
        if d.get("status") == "open" and not char_dirs:
            rep.warn("IP_OPEN_EMPTY", path, "IP is open but has no characters")
    ip_root_assets = [
        p for p in sorted(ip_dir.iterdir())
        if p.is_file()
        and p.name not in {"ip.json", "sources.json"}
        and p.suffix.lower() not in {".md", ".import", ".uid"}
    ]
    check_sources(ip_dir, ip_dir / "sources.json", IP_ASSET_DIRS, rep, required=False,
                  skip_assets=skip_assets, extra_files=ip_root_assets)
    return out


# ---------------------------------------------------------------- core code check (Decision D11)

def collect_ip_patterns(ip_root: Path) -> list[tuple[str, re.Pattern]]:
    """Build tiered regex patterns for IP-specific identifiers that must never appear in core code."""
    rules: list[tuple[str, re.Pattern]] = []
    seen: set[tuple[str, int]] = set()

    def add(label: str, pat: re.Pattern) -> None:
        sig = (pat.pattern, pat.flags)
        if sig not in seen:
            seen.add(sig)
            rules.append((label, pat))

    def add_word(tok: str) -> None:
        # Treat '_' as a token separator so snake_case leaks like 'amiya_bonus' or
        # 'is_arknights' are caught, while substrings inside words ('dummy_ab') are not.
        add(tok, re.compile(r"(?<![A-Za-z0-9])" + re.escape(tok) + r"(?![A-Za-z0-9])", re.I))

    def add_non_ascii_name(tok: str) -> None:
        t = tok.strip()
        if not t:
            return
        if len(t) >= 2:
            add(t, re.compile(re.escape(t)))
        else:
            # Single CJK character (e.g. "红", "陈", "空"): forbid as string literal, allow prose comments.
            add(t, re.compile(r"""["']""" + re.escape(t) + r"""["']"""))

    if not ip_root.is_dir():
        return rules

    for ip_dir in sorted(p for p in ip_root.iterdir() if p.is_dir()):
        ip_name = ip_dir.name
        # Tier 1a: ip_content/<ip> path fragment
        add(f"ip_content/{ip_name}",
            re.compile(r"ip_content[/\\]+" + re.escape(ip_name) + r"(?![A-Za-z0-9_])", re.I))
        # Tier 1b: IP folder / id
        if len(ip_name) >= 3:
            add_word(ip_name)
        elif ip_name:
            add(ip_name, re.compile(r"""["']""" + re.escape(ip_name) + r"""["']""", re.I))

        ip_json_path = ip_dir / "ip.json"
        try:
            ip_d = json.loads(ip_json_path.read_text(encoding="utf-8")) if ip_json_path.is_file() else None
        except (OSError, ValueError):
            ip_d = None
        if isinstance(ip_d, dict):
            for key in ("id", "name_en"):
                val = ip_d.get(key)
                if isinstance(val, str) and val.strip():
                    v = val.strip()
                    if v.isascii():
                        if len(v) >= 3:
                            add_word(v)
                        else:
                            add(v, re.compile(r"""["']""" + re.escape(v) + r"""["']""", re.I))
                    else:
                        add_non_ascii_name(v)
            zh = ip_d.get("name_zh")
            if isinstance(zh, str) and zh.strip():
                if zh.isascii():
                    if len(zh.strip()) >= 3:
                        add_word(zh.strip())
                else:
                    add_non_ascii_name(zh)

        chars_dir = ip_dir / "characters"
        if not chars_dir.is_dir():
            continue
        for cdir in sorted(p for p in chars_dir.iterdir() if p.is_dir()):
            cname = cdir.name
            full_id = f"{ip_name}.{cname}"
            # Tier 1c: full <ip>.<char> ID (even for 1-char cname like arknights.w) & characters/<char> path
            add_word(full_id)
            add(f"characters/{cname}",
                re.compile(r"characters[/\\]+" + re.escape(cname) + r"(?![A-Za-z0-9_])", re.I))

            # Tier 2 vs Tier 3 for character short directory name
            norm_c = cname.lower()
            if len(norm_c) >= 3 and norm_c not in ENGINE_COLLISION_WORDS:
                add_word(cname)
            elif norm_c:
                add(f".{cname}", re.compile(r"""["']\.""" + re.escape(cname) + r"""["']""", re.I))

            cj = cdir / "character.json"
            try:
                cd = json.loads(cj.read_text(encoding="utf-8")) if cj.is_file() else None
            except (OSError, ValueError):
                cd = None
            if not isinstance(cd, dict):
                continue
            cid_val = cd.get("id")
            if isinstance(cid_val, str) and "." in cid_val:
                add_word(cid_val.strip())
            en_val = cd.get("name_en")
            if isinstance(en_val, str) and en_val.strip():
                en_s = en_val.strip()
                if en_s.isascii():
                    norm_en = en_s.lower()
                    if len(norm_en) >= 3 and norm_en not in ENGINE_COLLISION_WORDS:
                        add_word(en_s)
                    elif norm_en:
                        add(f".{en_s}", re.compile(r"""["']\.""" + re.escape(en_s) + r"""["']""", re.I))
                else:
                    add_non_ascii_name(en_s)
            zh_val = cd.get("name_zh")
            if isinstance(zh_val, str) and zh_val.strip():
                zh_s = zh_val.strip()
                if zh_s.isascii():
                    norm_zh = zh_s.lower()
                    if len(norm_zh) >= 3 and norm_zh not in ENGINE_COLLISION_WORDS:
                        add_word(zh_s)
                else:
                    add_non_ascii_name(zh_s)

    return rules


def iter_core_scan_files(root: Path) -> list[Path]:
    """Return all repository files subject to core IP-isolation scanning (Decision D11)."""
    out: list[Path] = []
    if not root.is_dir():
        return out
    for entry in sorted(root.iterdir()):
        if entry.is_file():
            if entry.name in EXCLUDED_ROOT_FILES:
                continue
            if entry.suffix.lower() in CORE_SCAN_EXTS:
                out.append(entry)
        elif entry.is_dir():
            if entry.name in EXCLUDED_TOP_DIRS or entry.name == "__pycache__":
                continue
            in_core_mod = entry.name in CORE_CODE_DIRS
            for f in list_files(entry):
                if "__pycache__" in f.parts:
                    continue
                sfx = f.suffix.lower()
                if sfx in CORE_SCAN_EXTS or (in_core_mod and sfx == ".md"):
                    out.append(f)
    return out


def check_core_code(root: Path, rep: Report) -> None:
    patterns = collect_ip_patterns(root / "ip_content")
    if not patterns:
        return
    for f in iter_core_scan_files(root):
        try:
            text = f.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            rep.warn("CODE_UNREADABLE", f, "could not read as UTF-8")
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            for tok, pat in patterns:
                if pat.search(line):
                    rep.error("IP_STRING_IN_CORE", f, f"line {lineno}: contains IP-specific string '{tok}'")
                    break


# ---------------------------------------------------------------- entry points

def validate_project(root: Path = PROJECT_ROOT, *, ip: str | None = None, character: str | None = None,
                     skip_assets: bool = False) -> Report:
    rep = Report(root=root)
    ip_root = root / "ip_content"
    if character is not None:
        ip = character.split(".", 1)[0]
    if not ip_root.is_dir():
        rep.error("FILE_MISSING", ip_root, "ip_content/ not found")
    else:
        ip_dirs = sorted(p for p in ip_root.iterdir() if p.is_dir())
        if ip is not None:
            ip_dirs = [p for p in ip_dirs if p.name == ip]
            if not ip_dirs:
                rep.error("FILE_MISSING", ip_root / ip, f"IP '{ip}' not found")
        for ip_dir in ip_dirs:
            res = validate_ip(ip_dir, rep, skip_assets, only_char=character)
            if character is not None and character not in res["characters"] \
                    and not (ip_dir / "characters" / character.split(".", 1)[1]).is_dir():
                rep.error("FILE_MISSING", ip_dir / "characters", f"character '{character}' not found")
    validate_combat_config(root / "combat" / "combat_config.json", rep)
    check_core_code(root, rep)
    if skip_assets:
        rep.notes.append("Asset files (PNG frames, portraits, covers, effects) were not checked (--skip-assets).")
    return rep


def format_issues(issues: list[Issue]) -> list[str]:
    lines = []
    for i in sorted(issues, key=lambda x: (x.level != "error", x.path, x.code)):
        lines.append(f"- **{i.level.upper()}** `{i.code}` `{i.path}`: {i.message}")
    return lines


def write_character_reports(rep: Report, root: Path, ip: str | None = None,
                            character: str | None = None) -> list[Path]:
    """Write metadata/check_report.md for every character that was validated."""
    written = []
    ip_root = root / "ip_content"
    for cj in sorted(ip_root.glob("*/characters/*/character.json")):
        cdir = cj.parent
        cid = f"{cdir.parent.parent.name}.{cdir.name}"
        if character is not None and cid != character:
            continue
        if ip is not None and cdir.parent.parent.name != ip:
            continue
        prefix = cdir.relative_to(root).as_posix() + "/"
        issues = rep.subset(prefix)
        errs = [i for i in issues if i.level == "error"]
        warns = [i for i in issues if i.level == "warning"]
        status = "FAIL" if errs else "PASS"
        body = [f"# Check report: {cdir.parent.parent.name}.{cdir.name}", "",
                f"Result: **{status}** ({len(errs)} errors, {len(warns)} warnings)", ""]
        body += [f"> {n}" for n in rep.notes]
        if rep.notes:
            body.append("")
        body += format_issues(issues) or ["No issues."]
        out = cdir / "metadata" / "check_report.md"
        if out.parent.is_dir():
            out.write_text("\n".join(body) + "\n", encoding="utf-8")
            written.append(out)
    return written


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Validate Cross Arena content packs.")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--character", help="character id, e.g. test_pack.dummy_a")
    g.add_argument("--ip", help="IP id, e.g. arknights")
    g.add_argument("--all", action="store_true", help="validate everything (default)")
    ap.add_argument("--skip-assets", action="store_true", help="only check data, not rendered files")
    ap.add_argument("--no-report", action="store_true", help="do not write metadata/check_report.md")
    ap.add_argument("--root", type=Path, default=PROJECT_ROOT, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    if args.character and not CHAR_ID_RE.match(args.character):
        ap.error("--character must look like ip.name")

    rep = validate_project(args.root, ip=args.ip, character=args.character, skip_assets=args.skip_assets)
    if not args.no_report:
        write_character_reports(rep, args.root, ip=args.ip, character=args.character)
    for line in format_issues(rep.issues):
        print(line)
    for n in rep.notes:
        print(f"note: {n}")
    print(f"\n{len(rep.errors)} error(s), {len(rep.warnings)} warning(s)")
    return 1 if rep.errors else 0


if __name__ == "__main__":
    sys.exit(main())
