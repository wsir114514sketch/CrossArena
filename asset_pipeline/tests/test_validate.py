"""Unit tests for asset_pipeline/validate.py (stdlib unittest, no mocks).

Each test copies the real ip_content/test_pack into a temporary project,
introduces a targeted mutation or code snippet, and checks the validator output.

Run:  .venv\\Scripts\\python -m unittest discover -s asset_pipeline/tests -v
"""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import validate  # noqa: E402

PROJECT = validate.PROJECT_ROOT
PACK = PROJECT / "ip_content" / "test_pack"


class TempProject:
    def __init__(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        shutil.copytree(PACK, self.root / "ip_content" / "test_pack",
                        ignore=shutil.ignore_patterns("check_report.md"))
        for d in ("core", "combat", "fighter", "hit_system", "ui", "animation"):
            (self.root / d).mkdir(exist_ok=True)

    def close(self):
        self._tmp.cleanup()

    def p(self, rel: str) -> Path:
        return self.root / "ip_content" / "test_pack" / rel

    def char(self, short: str, rel: str) -> Path:
        return self.p(f"characters/{short}/{rel}")

    def read(self, path: Path):
        return json.loads(path.read_text(encoding="utf-8"))

    def write(self, path: Path, obj):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")

    def edit(self, path: Path, fn):
        d = self.read(path)
        fn(d)
        self.write(path, d)

    def clone_char_as(self, ip_id: str, short: str, name_zh: str, name_en: str) -> Path:
        """Clone dummy_a into ip_content/<ip_id>/characters/<short> with valid metadata."""
        ip_dir = self.root / "ip_content" / ip_id
        ip_json = ip_dir / "ip.json"
        if not ip_json.is_file():
            self.write(ip_json, {
                "id": ip_id,
                "name_zh": "样例作品",
                "name_en": "Sample Franchise",
                "cover": "cover.png",
                "description": "Sample IP for isolation tests.",
                "featured_characters": [],
                "status": "open",
            })
        dst = ip_dir / "characters" / short
        shutil.copytree(self.p("characters/dummy_a"), dst)
        cid = f"{ip_id}.{short}"
        self.edit(dst / "character.json",
                  lambda d: d.update(id=cid, ip_id=ip_id, name_zh=name_zh, name_en=name_en))
        for mp in (dst / "metadata").glob("*.json"):
            if mp.name == "sources.json":
                continue
            self.edit(mp, lambda d, c=cid: d.update(character_id=c))
        return dst

    def run(self, skip_assets=True, **kw):
        return validate.validate_project(self.root, skip_assets=skip_assets, **kw)


class RealProjectTests(unittest.TestCase):
    def test_repository_content_has_no_errors_or_warnings(self):
        rep = validate.validate_project(PROJECT, skip_assets=True)
        self.assertEqual([], [f"{i.code} {i.path} {i.message}" for i in rep.errors])
        self.assertEqual([], [f"{i.code} {i.path} {i.message}" for i in rep.warnings])

    def test_anim_length_mapping(self):
        self.assertEqual(24, validate.anim_length_sim_frames(12, 30))
        self.assertEqual(12, validate.anim_length_sim_frames(12, 60))
        self.assertEqual(30, validate.anim_length_sim_frames(12, 24))
        self.assertEqual(3, validate.anim_length_sim_frames(1, 24))


class MutationTests(unittest.TestCase):
    def setUp(self):
        self.t = TempProject()

    def tearDown(self):
        self.t.close()

    def assertCode(self, rep, code, level="error"):
        self.assertIn(code, rep.codes(level),
                      f"expected {level} {code}, got:\n" + "\n".join(validate.format_issues(rep.issues)))

    def test_baseline_copy_passes(self):
        rep = self.t.run()
        self.assertEqual([], rep.errors)

    def test_invalid_json(self):
        self.t.char("dummy_a", "framedata/light_01.json").write_text("{ nope", encoding="utf-8")
        self.assertCode(self.t.run(), "JSON_INVALID")

    def test_missing_skill_file(self):
        self.t.char("dummy_b", "skills/test_bolt.json").unlink()
        self.assertCode(self.t.run(), "SKILL_FILE_MISSING")

    def test_core_move_missing_and_undeclared(self):
        self.t.char("dummy_a", "metadata/wakeup.json").unlink()
        self.assertCode(self.t.run(), "CORE_MOVE_MISSING")

    def test_core_move_declared_unsupported_is_fine(self):
        self.t.char("dummy_a", "metadata/wakeup.json").unlink()
        self.t.edit(self.t.char("dummy_a", "character.json"),
                    lambda d: d["unsupported_core_moves"].append("wakeup"))
        self.assertEqual([], self.t.run().errors)

    def test_optional_wakeup_framedata_allowed(self):
        # D2: wakeup may optionally define framedata/wakeup.json for wakeup invulnerability frames.
        self.t.write(self.t.char("dummy_a", "framedata/wakeup.json"), {
            "move_id": "wakeup",
            "animation_id": "wakeup",
            "startup": 0,
            "active": 0,
            "recovery": 20,
            "hitboxes": [],
            "cancel_windows": [],
            "invuln_frames": [[0, 7]],
            "armor_frames": [],
        })
        self.assertEqual([], self.t.run().errors)

    def test_unsupported_but_present_warns(self):
        self.t.edit(self.t.char("dummy_a", "character.json"),
                    lambda d: d["unsupported_core_moves"].append("idle"))
        self.assertCode(self.t.run(), "UNSUPPORTED_BUT_PRESENT", "warning")

    def test_unknown_unsupported_move(self):
        self.t.edit(self.t.char("dummy_a", "character.json"),
                    lambda d: d["unsupported_core_moves"].append("moonwalk"))
        self.assertCode(self.t.run(), "UNSUPPORTED_UNKNOWN")

    def test_attack_without_framedata(self):
        self.t.char("dummy_a", "framedata/heavy_01.json").unlink()
        self.t.edit(self.t.char("dummy_a", "framedata/light_01.json"),
                    lambda d: d["cancel_windows"].clear())
        self.assertCode(self.t.run(), "FRAMEDATA_MISSING")

    def test_framedata_longer_than_animation(self):
        self.t.edit(self.t.char("dummy_a", "framedata/light_01.json"),
                    lambda d: d.update(recovery=30))
        self.assertCode(self.t.run(), "FRAMEDATA_TOO_LONG")

    def test_framedata_animation_missing(self):
        self.t.edit(self.t.char("dummy_a", "framedata/light_01.json"),
                    lambda d: d.update(animation_id="nope"))
        self.assertCode(self.t.run(), "ANIMATION_MISSING")

    def test_hitbox_frames_out_of_bounds(self):
        def f(d):
            d["hitboxes"][0]["frames"] = [6, 99]
        self.t.edit(self.t.char("dummy_a", "framedata/light_01.json"), f)
        self.assertCode(self.t.run(), "FRAME_RANGE_OUT_OF_BOUNDS")

    def test_hitbox_outside_active_warns(self):
        def f(d):
            d["hitboxes"][0]["frames"] = [2, 7]
        self.t.edit(self.t.char("dummy_a", "framedata/light_01.json"), f)
        self.assertCode(self.t.run(), "HITBOX_OUTSIDE_ACTIVE", "warning")

    def test_bad_rect(self):
        def f(d):
            d["hitboxes"][0]["rect"] = [0, 0, -5, 10]
        self.t.edit(self.t.char("dummy_a", "framedata/light_01.json"), f)
        self.assertCode(self.t.run(), "RECT_INVALID")

    def test_float_damage_rejected(self):
        def f(d):
            d["hitboxes"][0]["damage"] = 30.5
        self.t.edit(self.t.char("dummy_a", "framedata/light_01.json"), f)
        self.assertCode(self.t.run(), "FIELD_INVALID")

    # ---- D5: hitstop required, block_hitstop & super_freeze optional ----

    def test_hitstop_missing_rejected(self):
        def f(d):
            d["hitboxes"][0].pop("hitstop")
        self.t.edit(self.t.char("dummy_a", "framedata/light_01.json"), f)
        self.assertCode(self.t.run(), "FIELD_INVALID")

    def test_block_hitstop_and_super_freeze_valid(self):
        def f(d):
            d["hitboxes"][0]["block_hitstop"] = 4
            d["super_freeze"] = {"frame": 0, "duration": 20}
        self.t.edit(self.t.char("dummy_a", "framedata/light_01.json"), f)
        self.assertEqual([], self.t.run().errors)

    def test_super_freeze_out_of_bounds_rejected(self):
        self.t.edit(self.t.char("dummy_a", "framedata/light_01.json"),
                    lambda d: d.update(super_freeze={"frame": 99, "duration": 20}))
        self.assertCode(self.t.run(), "FRAME_RANGE_OUT_OF_BOUNDS")

    def test_negative_block_hitstop_rejected(self):
        def f(d):
            d["hitboxes"][0]["block_hitstop"] = -1
        self.t.edit(self.t.char("dummy_a", "framedata/light_01.json"), f)
        self.assertCode(self.t.run(), "FIELD_INVALID")

    # ---- D6: pushbox.down required + optional global combat_config.json ----

    def test_pushbox_down_missing_rejected(self):
        self.t.edit(self.t.char("dummy_a", "framedata/hurtboxes.json"),
                    lambda d: d["hurtbox_default"]["pushbox"].pop("down"))
        self.assertCode(self.t.run(), "HURTBOX_CONFIG_MISSING")

    def test_combat_config_valid_and_invalid(self):
        cfg_path = self.t.root / "combat" / "combat_config.json"
        self.t.write(cfg_path, {
            "stage_half_width": 600000,
            "corner_pushback_permille": 1000,
            "input_buffer_frames": 6,
            "motion_input_window_frames": 15,
            "juggle_max_hits": 3,
            "same_move_combo_limit": 2,
            "damage_scaling_pct": [100, 90, 80, 70, 60, 50, 40],
            "min_damage_scaling_pct": 30,
        })
        self.assertEqual([], self.t.run().errors)
        self.t.edit(cfg_path, lambda d: d.update(damage_scaling_pct=[]))
        self.assertCode(self.t.run(), "FIELD_INVALID")

    # ---- D8: single-owner & multi-owner key rules ----

    def test_cancel_target_unknown(self):
        def f(d):
            d["cancel_windows"][0]["into"] = ["medium_01"]
        self.t.edit(self.t.char("dummy_a", "framedata/light_01.json"), f)
        self.assertCode(self.t.run(), "CANCEL_TARGET_UNKNOWN")

    def test_damage_in_skill_is_duplicate_ownership(self):
        self.t.edit(self.t.char("dummy_b", "skills/test_bolt.json"),
                    lambda d: d["projectile"].update(damage=40))
        self.assertCode(self.t.run(), "DUPLICATE_OWNERSHIP")

    def test_cooldown_in_framedata_is_duplicate_ownership(self):
        self.t.edit(self.t.char("dummy_a", "framedata/light_01.json"),
                    lambda d: d.update(cooldown=10))
        self.assertCode(self.t.run(), "DUPLICATE_OWNERSHIP")

    def test_stats_in_skill_is_duplicate_ownership(self):
        self.t.edit(self.t.char("dummy_b", "skills/test_bolt.json"),
                    lambda d: d.update(walk_speed=100))
        self.assertCode(self.t.run(), "DUPLICATE_OWNERSHIP")

    def test_gravity_locked_to_fighter_and_projectile_gravity_to_skill(self):
        # 'gravity' in skill is rejected; 'projectile_gravity' in skill.projectile is allowed.
        self.t.edit(self.t.char("dummy_b", "skills/test_bolt.json"),
                    lambda d: d["projectile"].update(projectile_gravity=300))
        self.assertEqual([], self.t.run().errors)
        self.t.edit(self.t.char("dummy_b", "skills/test_bolt.json"),
                    lambda d: d["projectile"].update(gravity=300))
        self.assertCode(self.t.run(), "DUPLICATE_OWNERSHIP")

    def test_animation_id_forbidden_in_skill_and_fighter(self):
        self.t.edit(self.t.char("dummy_b", "skills/test_bolt.json"),
                    lambda d: d.update(animation_id="skill_01"))
        self.assertCode(self.t.run(), "DUPLICATE_OWNERSHIP")

    def test_meter_and_gauge_ownership(self):
        def add_valid(d):
            d["meter_gain_on_whiff"] = 5
            d["hitboxes"][0]["meter_gain_on_hit"] = 20
            d["hitboxes"][0]["meter_gain_on_block"] = 10
        self.t.edit(self.t.char("dummy_a", "framedata/light_01.json"), add_valid)
        self.t.edit(self.t.char("dummy_a", "character.json"),
                    lambda d: d["stats"].update(max_gauge=1000, gauge_gain_on_hurt_pct=50, gauge_gain_on_block_pct=25))
        self.assertEqual([], self.t.run().errors)
        # Putting meter_gain_on_hit into skill is rejected.
        self.t.edit(self.t.char("dummy_b", "skills/test_bolt.json"),
                    lambda d: d.update(meter_gain_on_hit=20))
        self.assertCode(self.t.run(), "DUPLICATE_OWNERSHIP")

    def test_combat_events_in_animation_rejected(self):
        self.t.edit(self.t.char("dummy_a", "metadata/light_01.json"),
                    lambda d: d.update(combat_events=[{"frame": 3, "type": "hitbox_on"}]))
        self.assertCode(self.t.run(), "DUPLICATE_OWNERSHIP")

    def test_projectile_skill_without_spawn(self):
        self.t.edit(self.t.char("dummy_b", "framedata/skill_01.json"),
                    lambda d: d.pop("projectile_spawn"))
        self.assertCode(self.t.run(), "PROJECTILE_SPAWN_MISSING")

    def test_bad_skill_type(self):
        self.t.edit(self.t.char("dummy_b", "skills/test_bolt.json"),
                    lambda d: d.update(type="laser"))
        self.assertCode(self.t.run(), "FIELD_INVALID")

    def test_character_id_mismatch(self):
        self.t.edit(self.t.char("dummy_a", "character.json"),
                    lambda d: d.update(id="test_pack.someone_else"))
        self.assertCode(self.t.run(), "ID_MISMATCH")

    def test_animation_type_mismatch(self):
        self.t.edit(self.t.char("dummy_a", "metadata/idle.json"),
                    lambda d: d.update(animation_type="combat"))
        self.assertCode(self.t.run(), "ANIMATION_TYPE_MISMATCH")

    def test_canvas_inconsistent(self):
        self.t.edit(self.t.char("dummy_a", "metadata/idle.json"),
                    lambda d: d.update(canvas_size=[768, 768]))
        self.assertCode(self.t.run(), "CANVAS_INCONSISTENT")

    def test_featured_character_missing(self):
        self.t.edit(self.t.p("ip.json"),
                    lambda d: d["featured_characters"].append("test_pack.ghost"))
        self.assertCode(self.t.run(), "FEATURED_MISSING")

    def test_hurtbox_config_missing(self):
        self.t.edit(self.t.char("dummy_a", "character.json"),
                    lambda d: d.update(hurtboxes="hurtbox_big"))
        self.assertCode(self.t.run(), "HURTBOX_CONFIG_MISSING")

    # ---- D10: sources.json coverage & broad wildcard warnings ----

    def test_sources_missing(self):
        self.t.char("dummy_a", "metadata/sources.json").unlink()
        self.assertCode(self.t.run(), "SOURCES_MISSING")

    def test_sources_uncovered_asset(self):
        tex = self.t.char("dummy_a", "textures/body.png")
        tex.parent.mkdir(parents=True)
        tex.write_bytes(b"")
        self.assertCode(self.t.run(), "SOURCES_UNCOVERED")

    def test_ip_level_asset_needs_sources(self):
        self.t.p("sources.json").unlink()
        sfx = self.t.p("audio/hit.ogg")
        sfx.parent.mkdir(parents=True)
        sfx.write_bytes(b"")
        self.assertCode(self.t.run(), "SOURCES_MISSING")

    def test_ip_root_cover_needs_sources_entry(self):
        # D10: cover.png at ip_content/<ip>/cover.png must also be covered by <ip>/sources.json.
        (self.t.p("cover.png")).write_bytes(b"")
        self.t.write(self.t.p("sources.json"), {"entries": [{
            "path": "audio/hit.ogg", "source": "self", "author": "self",
            "license": "internal", "redistributable": False,
        }]})
        self.assertCode(self.t.run(), "SOURCES_UNCOVERED")

    def test_non_placeholder_broad_wildcard_warns_only_on_source_dirs(self):
        self.t.write(self.t.char("dummy_a", "metadata/sources.json"), {"entries": [
            {"path": "animations/*", "source": "rendered", "author": "self",
             "license": "internal", "redistributable": False},
            {"path": "sprites/*", "source": "packed", "author": "self",
             "license": "internal", "redistributable": False},
        ]})
        self.assertNotIn("SOURCES_BROAD_WILDCARD", self.t.run().codes("warning"))
        # Adding wildcard on textures/* without placeholder=true triggers warning.
        self.t.edit(self.t.char("dummy_a", "metadata/sources.json"),
                    lambda d: d["entries"].append({
                        "path": "textures/*", "source": "hand-made", "author": "self",
                        "license": "internal", "redistributable": False,
                    }))
        self.assertCode(self.t.run(), "SOURCES_BROAD_WILDCARD", "warning")

    def test_non_ascii_file_name(self):
        self.t.char("dummy_a", "metadata/待机.txt").write_text("x", encoding="utf-8")
        self.assertCode(self.t.run(), "NAME_INVALID")

    def test_uppercase_file_name(self):
        self.t.char("dummy_b", "skills/Extra.json").write_text("{}", encoding="utf-8")
        self.assertCode(self.t.run(), "NAME_INVALID")

    def test_asset_mode_missing_frames(self):
        self.assertCode(self.t.run(skip_assets=False, character="test_pack.dummy_a"), "FRAMES_MISSING")

    def test_asset_mode_noncontiguous_and_count(self):
        d = self.t.char("dummy_a", "animations/block")
        d.mkdir(parents=True)
        (d / "frame_000.png").write_bytes(b"")
        (d / "frame_002.png").write_bytes(b"")
        rep = self.t.run(skip_assets=False, character="test_pack.dummy_a")
        self.assertIn("FRAMES_NONCONTIGUOUS", rep.codes("error"))
        block_issues = [i for i in rep.issues if i.path.endswith("metadata/block.json")]
        self.assertTrue(any(i.code == "FRAMES_NONCONTIGUOUS" for i in block_issues))

    def test_character_filter_only_checks_that_character(self):
        self.t.edit(self.t.char("dummy_b", "character.json"), lambda d: d.update(id="bad"))
        rep = self.t.run(character="test_pack.dummy_a")
        self.assertEqual([], rep.errors)

    def test_cli_exit_codes(self):
        self.assertEqual(0, validate.main(["--root", str(self.t.root), "--skip-assets"]))
        self.t.char("dummy_a", "metadata/idle.json").unlink()
        self.assertEqual(1, validate.main(["--root", str(self.t.root), "--skip-assets"]))
        report = self.t.char("dummy_a", "metadata/check_report.md").read_text(encoding="utf-8")
        self.assertIn("FAIL", report)
        self.assertIn("CORE_MOVE_MISSING", report)


class CoreIsolationD11Tests(unittest.TestCase):
    """Decision D11: expanded scan scope + tiered matching to eliminate false positives."""

    def setUp(self):
        self.t = TempProject()
        # Populate characters with colliding common English words, 1-char ASCII, 1-char CJK,
        # and distinct franchise names.
        self.t.clone_char_as("sample_ip", "red", "红", "Red")
        self.t.clone_char_as("sample_ip", "ash", "灰烬", "Ash")
        self.t.clone_char_as("sample_ip", "frost", "霜星", "Frost")
        self.t.clone_char_as("sample_ip", "spot", "斑点", "Spot")
        self.t.clone_char_as("sample_ip", "w", "W", "W")
        self.t.clone_char_as("sample_ip", "amiya", "阿米娅", "Amiya")

    def tearDown(self):
        self.t.close()

    def assertClean(self, rep):
        ip_errs = [i for i in rep.errors if i.code == "IP_STRING_IN_CORE"]
        self.assertEqual([], [f"{i.path}: {i.message}" for i in ip_errs])

    def assertFlagged(self, rep, expected_path_suffix: str):
        ip_errs = [i for i in rep.errors if i.code == "IP_STRING_IN_CORE"]
        self.assertTrue(
            any(i.path.endswith(expected_path_suffix) for i in ip_errs),
            f"expected IP_STRING_IN_CORE on *{expected_path_suffix}, got: "
            + "\n".join(validate.format_issues(rep.issues)),
        )

    # ---- False-positive prevention tests ----

    def test_no_false_positive_on_godot_color_constants_and_common_terms(self):
        (self.t.root / "ui" / "debug_draw.gd").write_text(
            "extends Node2D\n"
            "const HITBOX_COLOR := Color.RED\n"
            "const HURTBOX_COLOR := Color.BLUE\n"
            "const FLASH_COLOR := Color.WHITE\n"
            "var red_channel: int = 255\n"
            "var ash_opacity: int = 0\n"
            "var frost_tint: int = 10\n"
            "var spot: Vector2i = Vector2i.ZERO\n"
            "var light_move := 'light_01'\n"
            "var block_stun := 9\n"
            "var dash_speed := 5000\n",
            encoding="utf-8",
        )
        self.assertClean(self.t.run())

    def test_no_false_positive_on_single_letter_width_or_chinese_prose_comments(self):
        (self.t.root / "core" / "aabb.gd").write_text(
            "# 调试模式叠加绘制攻击框（红）、受击框（蓝）\n"
            "func overlaps(x: int, y: int, w: int, h: int) -> bool:\n"
            "    return w > 0 and h > 0\n",
            encoding="utf-8",
        )
        self.assertClean(self.t.run())

    def test_no_false_positive_on_generic_ip_content_root_or_excluded_files(self):
        (self.t.root / "core" / "loader.gd").write_text(
            'const CONTENT_ROOT := "res://ip_content"\nvar dummy_ab := 1\n',
            encoding="utf-8",
        )
        # Excluded locations: tests/, docs/, root README.md, tools.local.json
        (self.t.root / "tests" / "test_fighter.gd").parent.mkdir(parents=True, exist_ok=True)
        (self.t.root / "tests" / "test_fighter.gd").write_text(
            'var c := "sample_ip.amiya"\n', encoding="utf-8"
        )
        (self.t.root / "docs").mkdir(exist_ok=True)
        (self.t.root / "docs" / "note.md").write_text("阿米娅 sample_ip.red\n", encoding="utf-8")
        (self.t.root / "README.md").write_text("Example: test_pack.dummy_a\n", encoding="utf-8")
        (self.t.root / "tools.local.json").write_text('{"note": "sample_ip"}\n', encoding="utf-8")
        self.assertClean(self.t.run())

    # ---- True-positive leak detection tests ----

    def test_catches_colliding_character_by_full_id(self):
        (self.t.root / "fighter" / "special.gd").write_text(
            'func check(id: String) -> bool:\n    return id == "sample_ip.red"\n',
            encoding="utf-8",
        )
        self.assertFlagged(self.t.run(), "fighter/special.gd")

    def test_catches_single_letter_character_by_full_id_or_dot_suffix(self):
        (self.t.root / "fighter" / "w_hack.gd").write_text(
            'func is_bomb_specialist(id: String) -> bool:\n    return id.ends_with(".w")\n',
            encoding="utf-8",
        )
        self.assertFlagged(self.t.run(), "fighter/w_hack.gd")

    def test_catches_colliding_character_by_characters_subpath(self):
        (self.t.root / "animation" / "sprite_loader.gd").write_text(
            'var p := "characters/red/sprites/idle.png"\n',
            encoding="utf-8",
        )
        self.assertFlagged(self.t.run(), "animation/sprite_loader.gd")

    def test_catches_single_cjk_name_when_hardcoded_as_string_literal(self):
        (self.t.root / "ui" / "hud.gd").write_text(
            'func badge(title: String) -> bool:\n    return title == "红"\n',
            encoding="utf-8",
        )
        self.assertFlagged(self.t.run(), "ui/hud.gd")

    def test_catches_multi_cjk_name_anywhere(self):
        (self.t.root / "hit_system" / "judge.gd").write_text(
            "# 灰烬与霜星的特殊判定\n",
            encoding="utf-8",
        )
        self.assertFlagged(self.t.run(), "hit_system/judge.gd")

    def test_catches_distinct_character_identifier_anywhere(self):
        (self.t.root / "core" / "sim.gd").write_text(
            "var amiya_bonus: int = 0\n",
            encoding="utf-8",
        )
        self.assertFlagged(self.t.run(), "core/sim.gd")

    def test_catches_leaks_in_root_files_and_non_hardcoded_module_dirs(self):
        # Repository-root project.godot, root main.gd, and a new folder data_loader/
        (self.t.root / "project.godot").write_text(
            '[application]\ndefault_char="sample_ip.amiya"\n', encoding="utf-8"
        )
        (self.t.root / "main.gd").write_text('const IP := "sample_ip"\n', encoding="utf-8")
        new_mod = self.t.root / "data_loader"
        new_mod.mkdir()
        (new_mod / "registry.gd").write_text('var preload_pack := "test_pack"\n', encoding="utf-8")

        rep = self.t.run()
        self.assertFlagged(rep, "project.godot")
        self.assertFlagged(rep, "main.gd")
        self.assertFlagged(rep, "data_loader/registry.gd")


if __name__ == "__main__":
    unittest.main()
