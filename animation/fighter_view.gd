class_name FighterView
extends Node2D
## Presentation-only node for one fighter (spec part 3 section 9).
## Reads FighterSimState + FighterBundle; NEVER mutates simulation state.

var bundle: DataModels.FighterBundle
var show_debug_boxes: bool = true

var _sheet_cache: Dictionary = {} # res_path -> Texture2D
var _frame_tex_cache: Dictionary = {} # res_path -> Texture2D

@onready var shadow_sprite: Sprite2D = $Shadow
@onready var character_sprite: Sprite2D = $CharacterSprite
@onready var effects_root: Node2D = $Effects
@onready var debug_draw_node: Node2D = $DebugDraw


func _ready() -> void:
	character_sprite.centered = false
	shadow_sprite.texture = _build_oval_shadow_texture()
	shadow_sprite.position = Vector2(0.0, 0.0)
	debug_draw_node.draw.connect(_on_debug_draw)


var _last_state: SimState.FighterSimState


func setup(fighter_bundle: DataModels.FighterBundle, tint_fallback: Color = Color.WHITE) -> void:
	bundle = fighter_bundle
	_sheet_cache.clear()
	_frame_tex_cache.clear()
	character_sprite.modulate = tint_fallback


func sync_from_sim(f: SimState.FighterSimState, ground_screen_y: float, stage_center_x: float) -> void:
	_last_state = f
	var px_x: int = FixedMath.units_to_px(f.pos_x)
	var px_y: int = FixedMath.units_to_px(f.pos_y)
	position = Vector2(stage_center_x + float(px_x), ground_screen_y + float(px_y))
	# Keep ground shadow anchored on the floor beneath the character
	shadow_sprite.position = Vector2(0.0, float(-px_y))
	var shadow_scale: float = clampf(1.0 + float(px_y) / 300.0, 0.45, 1.0)
	shadow_sprite.scale = Vector2(shadow_scale, shadow_scale)

	if bundle != null and bundle.anims.has(f.anim_id):
		var anim: DataModels.AnimSpec = bundle.anims[f.anim_id] as DataModels.AnimSpec
		var frame_idx: int = FrameMapper.compute_display_frame(
			f.anim_tick, anim.animation_fps, anim.frame_count, anim.loop
		)
		_apply_sprite_frame(anim, frame_idx, f.facing < 0)

	debug_draw_node.visible = show_debug_boxes
	if show_debug_boxes:
		debug_draw_node.queue_redraw()


func _apply_sprite_frame(anim: DataModels.AnimSpec, frame_idx: int, flip_left: bool) -> void:
	if anim.sheet_path != "" and frame_idx < anim.atlas_frames.size():
		var tex: Texture2D = _load_texture(anim.sheet_path)
		if tex != null:
			var reg: DataModels.AtlasFrameRegion = anim.atlas_frames[frame_idx]
			character_sprite.texture = tex
			character_sprite.region_enabled = true
			character_sprite.region_rect = Rect2(reg.region)
			character_sprite.flip_h = flip_left
			var anchor: Vector2i = anim.ground_anchor
			var rw: int = reg.region.size.x
			var ox: int = (anchor.x - reg.crop_offset.x - rw) if flip_left else (reg.crop_offset.x - anchor.x)
			var oy: int = reg.crop_offset.y - anchor.y
			character_sprite.offset = Vector2(float(ox), float(oy))
			return

	# Fallback to raw PNG sequence frame_NNN.png if sprite sheet not yet packed
	var raw_path: String = "%s/%sframe_%03d.png" % [bundle.base_dir, anim.source_frames, frame_idx]
	var raw_tex: Texture2D = _load_texture(raw_path)
	if raw_tex != null:
		character_sprite.texture = raw_tex
		character_sprite.region_enabled = false
		character_sprite.flip_h = flip_left
		var w: int = anim.canvas_size.x
		var ax: int = anim.ground_anchor.x
		var ay: int = anim.ground_anchor.y
		character_sprite.offset = Vector2(float(ax - w if flip_left else -ax), float(-ay))


func _load_texture(res_path: String) -> Texture2D:
	if _sheet_cache.has(res_path):
		return _sheet_cache[res_path] as Texture2D
	var tex: Texture2D = null
	if ResourceLoader.exists(res_path):
		tex = ResourceLoader.load(res_path) as Texture2D
	elif FileAccess.file_exists(res_path):
		var img := Image.load_from_file(ProjectSettings.globalize_path(res_path))
		if img != null and not img.is_empty():
			tex = ImageTexture.create_from_image(img)
	if tex != null:
		_sheet_cache[res_path] = tex
	return tex


func _on_debug_draw() -> void:
	if not show_debug_boxes or _last_state == null or bundle == null:
		return
	var f: SimState.FighterSimState = _last_state

	# Pushbox (Green)
	var push_w: PackedInt64Array = HitResolver.get_world_pushbox(f, bundle)
	_draw_world_box_local(push_w, f, Color(0.2, 0.95, 0.35, 0.22), Color(0.2, 0.95, 0.35, 0.9))

	# Hurtboxes (Blue)
	for hb in HitResolver.get_world_hurtboxes(f, bundle):
		_draw_world_box_local(hb, f, Color(0.25, 0.55, 1.0, 0.20), Color(0.35, 0.68, 1.0, 0.92))

	# Active Hitboxes (Red)
	for item in HitResolver.get_world_active_hitboxes(f, bundle):
		var wr: PackedInt64Array = item["world_rect"] as PackedInt64Array
		_draw_world_box_local(wr, f, Color(1.0, 0.2, 0.2, 0.35), Color(1.0, 0.25, 0.25, 1.0))

	# Ground anchor crosshair
	debug_draw_node.draw_line(Vector2(-8, 0), Vector2(8, 0), Color.YELLOW, 2.0)
	debug_draw_node.draw_line(Vector2(0, -8), Vector2(0, 8), Color.YELLOW, 2.0)

	var font: Font = ThemeDB.fallback_font
	if font != null:
		var info: String = "%s [%d] anim:%s(%d)" % [f.state_name, f.state_tick, f.anim_id, f.anim_tick]
		debug_draw_node.draw_string(font, Vector2(-68, 20), info, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.95, 0.95, 1.0))


func _draw_world_box_local(wrect: PackedInt64Array, f: SimState.FighterSimState, fill: Color, border: Color) -> void:
	var rx: float = float(FixedMath.units_to_px(wrect[0] - f.pos_x))
	var ry: float = float(FixedMath.units_to_px(wrect[1] - f.pos_y))
	var rw: float = float(FixedMath.units_to_px(wrect[2]))
	var rh: float = float(FixedMath.units_to_px(wrect[3]))
	var rect := Rect2(rx, ry, rw, rh)
	debug_draw_node.draw_rect(rect, fill, true)
	debug_draw_node.draw_rect(rect, border, false, 1.5)


static func _build_oval_shadow_texture() -> Texture2D:
	var img := Image.create(76, 20, false, Image.FORMAT_RGBA8)
	for y in range(20):
		for x in range(76):
			var nx: float = (float(x) - 37.5) / 36.0
			var ny: float = (float(y) - 9.5) / 9.0
			var d2: float = nx * nx + ny * ny
			if d2 <= 1.0:
				img.set_pixel(x, y, Color(0.0, 0.0, 0.0, 0.42 * (1.0 - d2 * 0.65)))
			else:
				img.set_pixel(x, y, Color(0, 0, 0, 0))
	return ImageTexture.create_from_image(img)
