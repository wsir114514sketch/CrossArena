extends Node2D
## Top-level playable battle scene driving the fixed 60 Hz deterministic accumulator.
## Strictly separates Simulation (CombatSim + SimState) from Presentation (Stage, FighterView, Effects, HUD).

const FIXED_DT: float = 1.0 / 60.0
const VIEWPORT_W: float = 1280.0
const VIEWPORT_H: float = 720.0
const GROUND_Y: float = 590.0
const STAGE_CENTER_X: float = 640.0

var combat_cfg: DataModels.CombatConfigData
var roster_ids: PackedStringArray = PackedStringArray()
var matchup_index: int = 0
var bundles: Array[DataModels.FighterBundle] = []
var state: SimState
var saved_snapshot: Dictionary = {}

var cpu_enabled: bool = true
var debug_boxes_enabled: bool = true
var sparring_ai := SparringAI.new()
var recorded_inputs: Array[PackedInt64Array] = []

var _accumulator: float = 0.0
var _seen_event_keys: Dictionary = {}
var _sparks: Array[Dictionary] = []
var _shake_timer: float = 0.0
var _shake_strength: float = 0.0
var _proj_tex_cache: Dictionary = {}

@onready var world_root: Node2D = $WorldRoot
@onready var background_layer: Node2D = $WorldRoot/Background
@onready var battlefield_layer: Node2D = $WorldRoot/Battlefield
@onready var fighter_p1_view: FighterView = $WorldRoot/FighterLayer/FighterP1
@onready var fighter_p2_view: FighterView = $WorldRoot/FighterLayer/FighterP2
@onready var projectile_layer: Node2D = $WorldRoot/ForegroundEffect/Projectiles
@onready var spark_layer: Node2D = $WorldRoot/ForegroundEffect/Sparks
@onready var hud: BattleHUD = $UILayer/BattleHUD


func _ready() -> void:
	combat_cfg = DataLoader.load_combat_config()
	# Query formal open IPs first; fall back to test packs when no formal IP has characters yet (Phase 1)
	roster_ids = DataLoader.list_playable_character_ids(false)
	if roster_ids.is_empty():
		roster_ids = DataLoader.list_playable_character_ids(true)

	battlefield_layer.draw.connect(_on_draw_battlefield)
	projectile_layer.draw.connect(_on_draw_projectiles)
	spark_layer.draw.connect(_on_draw_sparks)

	if not roster_ids.is_empty():
		_start_match_for_index(0)


func _unhandled_key_input(event: InputEvent) -> void:
	if not (event is InputEventKey):
		return
	var ke: InputEventKey = event as InputEventKey
	if not ke.pressed or ke.echo:
		return
	match ke.physical_keycode:
		KEY_F1:
			if not roster_ids.is_empty():
				matchup_index = (matchup_index + 1) % maxi(1, roster_ids.size() * roster_ids.size())
				_start_match_for_index(matchup_index)
		KEY_F2:
			cpu_enabled = not cpu_enabled
		KEY_F3:
			debug_boxes_enabled = not debug_boxes_enabled
			fighter_p1_view.show_debug_boxes = debug_boxes_enabled
			fighter_p2_view.show_debug_boxes = debug_boxes_enabled
		KEY_F4:
			if ke.shift_pressed or saved_snapshot.is_empty():
				saved_snapshot = state.save_state()
				hud.show_banner("STATE SAVED (SHIFT+F4 TO UPDATE)", 0.8)
			else:
				state.load_state(saved_snapshot)
				hud.show_banner("STATE RESTORED", 0.6)
		KEY_R:
			_start_match_for_index(matchup_index)


func _process(delta: float) -> void:
	if state == null or bundles.size() < 2:
		return

	_accumulator += minf(delta, 0.1)
	while _accumulator >= FIXED_DT:
		_accumulator -= FIXED_DT
		var p1_mask: int = InputCollector.poll_player_keyboard(0)
		var p2_mask: int = (
			sparring_ai.compute_input(state, 1, bundles[1])
			if cpu_enabled
			else InputCollector.poll_player_keyboard(1)
		)
		var frame_in := PackedInt64Array([p1_mask, p2_mask])
		recorded_inputs.append(frame_in)
		CombatSim.step(state, frame_in, bundles, combat_cfg)
		_consume_presentation_events(state.events)

	_update_visual_only(delta)


func _start_match_for_index(idx: int) -> void:
	var count: int = roster_ids.size()
	var i0: int = idx % count
	@warning_ignore("integer_division")
	var i1: int = ((idx / count) + 1) % count if count > 1 else 0
	var b0: DataModels.FighterBundle = DataLoader.load_fighter(roster_ids[i0])
	var b1: DataModels.FighterBundle = DataLoader.load_fighter(roster_ids[i1])
	bundles = [b0, b1]

	state = CombatSim.create_match_state(b0, b1, combat_cfg, 20261124)
	saved_snapshot = {}
	recorded_inputs.clear()
	_seen_event_keys.clear()
	_sparks.clear()
	sparring_ai.reset(987654321)

	fighter_p1_view.setup(b0)
	fighter_p2_view.setup(b1)
	fighter_p1_view.show_debug_boxes = debug_boxes_enabled
	fighter_p2_view.show_debug_boxes = debug_boxes_enabled

	hud.set_fighters(
		b0, b1,
		_load_ui_texture(b0.portrait_path),
		_load_ui_texture(b1.portrait_path)
	)
	battlefield_layer.queue_redraw()
	_consume_presentation_events(state.events)
	_update_visual_only(0.0)


func _consume_presentation_events(events: Array[Dictionary]) -> void:
	for ev in events:
		var key: int = (int(ev["tick"]) << 20) ^ int(ev["seq"])
		if _seen_event_keys.has(key):
			continue
		_seen_event_keys[key] = true

		var ev_type: String = String(ev["type"])
		var sx: float = STAGE_CENTER_X + float(FixedMath.units_to_px(int(ev["x"])))
		var sy: float = GROUND_Y + float(FixedMath.units_to_px(int(ev["y"])))

		match ev_type:
			"round_fight":
				hud.show_banner("FIGHT!", 0.85)
			"hit_spark":
				_sparks.append({"pos": Vector2(sx, sy), "color": Color(1.0, 0.86, 0.28), "radius": 34.0, "ttl": 0.18, "max_ttl": 0.18})
				_shake_timer = 0.08
				_shake_strength = 4.0
			"block_spark":
				_sparks.append({"pos": Vector2(sx, sy), "color": Color(0.36, 0.82, 1.0), "radius": 28.0, "ttl": 0.16, "max_ttl": 0.16})
			"camera_shake":
				_shake_timer = 0.16
				_shake_strength = 9.0


func _update_visual_only(delta: float) -> void:
	fighter_p1_view.sync_from_sim(state.fighters[0], GROUND_Y, STAGE_CENTER_X)
	fighter_p2_view.sync_from_sim(state.fighters[1], GROUND_Y, STAGE_CENTER_X)

	# Decay visual sparks & camera shake (presentation-only, never affects SimState)
	var next_sparks: Array[Dictionary] = []
	for sp in _sparks:
		var rem: float = float(sp["ttl"]) - delta
		if rem > 0.0:
			sp["ttl"] = rem
			next_sparks.append(sp)
	_sparks = next_sparks

	if _shake_timer > 0.0:
		_shake_timer = maxf(0.0, _shake_timer - delta)
		var phase: float = float(state.tick) * 2.3
		world_root.position = Vector2(cos(phase) * _shake_strength, sin(phase * 1.7) * _shake_strength * 0.6)
	else:
		world_root.position = Vector2.ZERO

	if state.tick % 15 == 0 or hud.checksum_hex == "":
		hud.checksum_hex = "%08X" % (state.compute_checksum() & 0xFFFFFFFF)
	hud.update_hud(state, delta, cpu_enabled, debug_boxes_enabled)
	projectile_layer.queue_redraw()
	spark_layer.queue_redraw()


func _on_draw_battlefield() -> void:
	# Clean anime arena backdrop & stage boundary markers
	battlefield_layer.draw_rect(Rect2(0, 0, VIEWPORT_W, VIEWPORT_H), Color(0.07, 0.09, 0.14), true)
	battlefield_layer.draw_rect(Rect2(0, GROUND_Y, VIEWPORT_W, VIEWPORT_H - GROUND_Y), Color(0.12, 0.15, 0.22), true)
	battlefield_layer.draw_line(Vector2(0, GROUND_Y), Vector2(VIEWPORT_W, GROUND_Y), Color(0.42, 0.56, 0.78), 3.0)

	# Subtle perspective grid lines on stage floor
	for i in range(-6, 7):
		var top_x: float = STAGE_CENTER_X + float(i) * 85.0
		var bot_x: float = STAGE_CENTER_X + float(i) * 135.0
		battlefield_layer.draw_line(Vector2(top_x, GROUND_Y), Vector2(bot_x, VIEWPORT_H), Color(0.18, 0.22, 0.32), 1.0)

	if combat_cfg != null:
		var half_px: float = float(FixedMath.units_to_px(combat_cfg.stage_half_width))
		var left_wall: float = STAGE_CENTER_X - half_px
		var right_wall: float = STAGE_CENTER_X + half_px
		battlefield_layer.draw_line(Vector2(left_wall, 120), Vector2(left_wall, GROUND_Y + 20), Color(0.95, 0.45, 0.32, 0.45), 2.0)
		battlefield_layer.draw_line(Vector2(right_wall, 120), Vector2(right_wall, GROUND_Y + 20), Color(0.95, 0.45, 0.32, 0.45), 2.0)


func _on_draw_projectiles() -> void:
	if state == null:
		return
	for p in state.projectiles:
		if not p.active:
			continue
		var px: float = STAGE_CENTER_X + float(FixedMath.units_to_px(p.pos_x))
		var py: float = GROUND_Y + float(FixedMath.units_to_px(p.pos_y))
		var owner_b: DataModels.FighterBundle = bundles[p.owner_slot]
		var eff_file: String = "%s/%s/frame_000.png" % [owner_b.ip_dir, p.effect_path]
		var tex: Texture2D = _load_ui_texture(eff_file)
		if tex != null:
			var sz: Vector2 = tex.get_size()
			projectile_layer.draw_texture_rect(tex, Rect2(px - sz.x * 0.5, py - sz.y * 0.5, sz.x, sz.y), false)
		else:
			projectile_layer.draw_circle(Vector2(px, py), 16.0, Color(0.35, 0.96, 0.88))
		if debug_boxes_enabled:
			var wr: PackedInt64Array = FixedMath.mirror_rect(p.pos_x, p.pos_y, p.facing, p.rect)
			var dr := Rect2(
				STAGE_CENTER_X + float(FixedMath.units_to_px(wr[0])),
				GROUND_Y + float(FixedMath.units_to_px(wr[1])),
				float(FixedMath.units_to_px(wr[2])),
				float(FixedMath.units_to_px(wr[3]))
			)
			projectile_layer.draw_rect(dr, Color(1.0, 0.25, 0.25, 0.35), true)
			projectile_layer.draw_rect(dr, Color(1.0, 0.25, 0.25, 1.0), false, 1.5)


func _on_draw_sparks() -> void:
	for sp in _sparks:
		var ratio: float = float(sp["ttl"]) / float(sp["max_ttl"])
		var pos: Vector2 = sp["pos"] as Vector2
		var col: Color = sp["color"] as Color
		var rad: float = float(sp["radius"]) * (1.35 - ratio * 0.5)
		spark_layer.draw_arc(pos, rad, 0.0, TAU, 24, Color(col.r, col.g, col.b, ratio), 3.5)
		for a_idx in range(6):
			var ang: float = float(a_idx) * TAU / 6.0 + (1.0 - ratio) * 0.5
			var p0: Vector2 = pos + Vector2(cos(ang), sin(ang)) * (rad * 0.3)
			var p1: Vector2 = pos + Vector2(cos(ang), sin(ang)) * (rad * 1.25)
			spark_layer.draw_line(p0, p1, Color(1.0, 1.0, 1.0, ratio), 2.5)


func _load_ui_texture(res_path: String) -> Texture2D:
	if _proj_tex_cache.has(res_path):
		return _proj_tex_cache[res_path] as Texture2D
	var tex: Texture2D = null
	if ResourceLoader.exists(res_path):
		tex = ResourceLoader.load(res_path) as Texture2D
	elif FileAccess.file_exists(res_path):
		var img := Image.load_from_file(ProjectSettings.globalize_path(res_path))
		if img != null and not img.is_empty():
			tex = ImageTexture.create_from_image(img)
	if tex != null:
		_proj_tex_cache[res_path] = tex
	return tex
