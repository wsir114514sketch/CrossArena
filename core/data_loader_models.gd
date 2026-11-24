class_name DataModels
extends RefCounted
## Immutable runtime data definitions loaded from ip_content/ and combat/ JSON files.
## Contains zero Godot SceneTree Node references.


class CombatConfigData extends RefCounted:
	var stage_half_width: int = 520000
	var corner_pushback_permille: int = 1000
	var input_buffer_frames: int = 6
	var motion_input_window_frames: int = 15
	var juggle_max_hits: int = 3
	var same_move_combo_limit: int = 3
	var damage_scaling_pct: PackedInt64Array = PackedInt64Array([100, 90, 80, 70, 60, 50, 40])
	var min_damage_scaling_pct: int = 30
	var round_time_seconds: int = 99
	var rounds_to_win: int = 2
	var intro_ticks: int = 60
	var ko_ticks: int = 90
	var round_end_ticks: int = 60
	var p1_start_x: int = -220000
	var p2_start_x: int = 220000


class HitBoxSpec extends RefCounted:
	var frames_start: int = 0
	var frames_end: int = 0
	var hit_index: int = 0
	var rect: PackedInt64Array = PackedInt64Array([0, 0, 1, 1])
	var damage: int = 0
	var knockback_x: int = 0
	var knockback_y: int = 0
	var hitstun: int = 0
	var blockstun: int = 0
	var hitstop: int = 0
	var block_hitstop: int = 0
	var air_hit: bool = true
	var priority: int = 1
	var meter_gain_on_hit: int = 20
	var meter_gain_on_block: int = 10


class CancelWindowSpec extends RefCounted:
	var frames_start: int = 0
	var frames_end: int = 0
	var into: PackedStringArray = PackedStringArray()


class HurtboxOverrideSpec extends RefCounted:
	var frames_start: int = 0
	var frames_end: int = 0
	var rects: Array[PackedInt64Array] = []


class ProjectileSpawnSpec extends RefCounted:
	var frame: int = 0
	var offset_x: int = 0
	var offset_y: int = 0
	var rect: PackedInt64Array = PackedInt64Array([0, 0, 1, 1])
	var hit: HitBoxSpec


class MoveFrameData extends RefCounted:
	var move_id: String = ""
	var animation_id: String = ""
	var startup: int = 0
	var active: int = 0
	var recovery: int = 0
	var total_ticks: int = 1
	var hitboxes: Array[HitBoxSpec] = []
	var cancel_windows: Array[CancelWindowSpec] = []
	var invuln_ranges: Array[PackedInt64Array] = []
	var armor_ranges: Array[PackedInt64Array] = []
	var hurtbox_overrides: Array[HurtboxOverrideSpec] = []
	var projectile_spawns: Array[ProjectileSpawnSpec] = []
	var has_super_freeze: bool = false
	var super_freeze_frame: int = 0
	var super_freeze_duration: int = 0
	var meter_gain_on_whiff: int = 0

	func is_invulnerable_at(move_tick: int) -> bool:
		for rng in invuln_ranges:
			if move_tick >= rng[0] and move_tick <= rng[1]:
				return true
		return false

	func has_armor_at(move_tick: int) -> bool:
		for rng in armor_ranges:
			if move_tick >= rng[0] and move_tick <= rng[1]:
				return true
		return false


class HurtboxProfile extends RefCounted:
	var stand: Array[PackedInt64Array] = []
	var crouch: Array[PackedInt64Array] = []
	var air: Array[PackedInt64Array] = []
	var down: Array[PackedInt64Array] = []
	var push_stand: PackedInt64Array = PackedInt64Array([-25000, -170000, 50000, 170000])
	var push_crouch: PackedInt64Array = PackedInt64Array([-25000, -105000, 50000, 105000])
	var push_air: PackedInt64Array = PackedInt64Array([-22000, -160000, 44000, 120000])
	var push_down: PackedInt64Array = PackedInt64Array([-25000, -40000, 50000, 40000])


class SkillSpec extends RefCounted:
	var skill_id: String = ""
	var type: String = "melee"
	var input_code: String = ""
	var cost: int = 0
	var cooldown: int = 0
	var move_id: String = ""
	var proj_effect: String = ""
	var proj_speed: int = 0
	var proj_vel_y: int = 0
	var proj_gravity: int = 0
	var proj_lifetime: int = 0


class PresentationEventSpec extends RefCounted:
	var frame: int = 0
	var type: String = ""
	var id: String = ""


class AtlasFrameRegion extends RefCounted:
	## Region inside a packed sprite sheet + crop offset relative to the full canvas.
	var region: Rect2i = Rect2i(0, 0, 1, 1)
	var crop_offset: Vector2i = Vector2i.ZERO


class AnimSpec extends RefCounted:
	var animation_id: String = ""
	var animation_type: String = "core"
	var source_frames: String = ""
	var frame_count: int = 1
	var animation_fps: int = 30
	var loop: bool = false
	var facing_mode: String = "flip"
	var canvas_size: Vector2i = Vector2i(512, 512)
	var pivot: Vector2i = Vector2i(256, 480)
	var ground_anchor: Vector2i = Vector2i(256, 480)
	var presentation_events: Array[PresentationEventSpec] = []
	var sheet_path: String = ""
	var atlas_frames: Array[AtlasFrameRegion] = []


class IPInfo extends RefCounted:
	var id: String = ""
	var name_zh: String = ""
	var name_en: String = ""
	var cover_path: String = ""
	var description: String = ""
	var status: String = "locked"
	var test_only: bool = false
	var character_ids: PackedStringArray = PackedStringArray()


class FighterBundle extends RefCounted:
	var id: String = ""
	var ip_id: String = ""
	var name_zh: String = ""
	var name_en: String = ""
	var base_dir: String = ""
	var ip_dir: String = ""
	var portrait_path: String = ""
	var splash_path: String = ""
	var max_hp: int = 1000
	var walk_speed: int = 3000
	var jump_velocity: int = 14000
	var gravity: int = 700
	var defense: int = 100
	var max_gauge: int = 1000
	var gauge_gain_on_hurt_pct: int = 50
	var gauge_gain_on_block_pct: int = 25
	var height_scale: float = 1.0
	var hurtboxes: HurtboxProfile
	var moves: Dictionary = {} # move_id -> MoveFrameData
	var move_ids_sorted: PackedStringArray = PackedStringArray()
	var skills: Array[SkillSpec] = []
	var anims: Dictionary = {} # animation_id -> AnimSpec
	var unsupported_core_moves: PackedStringArray = PackedStringArray()
	var ai_aggression_permille: int = 500
	var ai_zoning_permille: int = 500

	func supports_move(move_id: String) -> bool:
		return not unsupported_core_moves.has(move_id) and anims.has(move_id)
