"""Unit tests for asset_pipeline/validate.py (stdlib unittest, no mocks).

Each test copies the real ip_content/test_pack into a temporary project,
introduces exactly one defect, and checks the validator reports it.

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
        (self.root / "core").mkdir()

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

    def run(self, skip_assets=True, **kw):
        return validate.validate_project(self.root, skip_assets=skip_assets, **kw)


class RealProjectTests(unittest.TestCase):
    def test_repository_content_has_no_errors(self):
        rep = validate.validate_project(PROJECT, skip_assets=True)
        self.assertEqual([], [f"{i.code} {i.path} {i.message}" for i in rep.errors])

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
        # light_01: 12 frames @ 30 fps = 24 sim frames
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

    def test_non_ascii_file_name(self):
        self.t.char("dummy_a", "metadata/待机.txt").write_text("x", encoding="utf-8")
        self.assertCode(self.t.run(), "NAME_INVALID")

    def test_uppercase_file_name(self):
        self.t.char("dummy_b", "skills/Extra.json").write_text("{}", encoding="utf-8")
        self.assertCode(self.t.run(), "NAME_INVALID")

    def test_ip_id_in_core_code(self):
        (self.t.root / "core" / "loader.gd").write_text(
            'var path = "res://ip_content/test_pack/x.json"\n', encoding="utf-8")
        self.assertCode(self.t.run(), "IP_STRING_IN_CORE")

    def test_character_display_name_in_core_code(self):
        (self.t.root / "core" / "names.gd").write_text('# 测试人偶甲 special case\n', encoding="utf-8")
        self.assertCode(self.t.run(), "IP_STRING_IN_CORE")

    def test_generic_code_is_not_flagged(self):
        (self.t.root / "core" / "sim.gd").write_text(
            'const ROOT := "res://ip_content"\nvar dummy_ab := 1\n', encoding="utf-8")
        self.assertNotIn("IP_STRING_IN_CORE", self.t.run().codes())

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


if __name__ == "__main__":
    unittest.main()
