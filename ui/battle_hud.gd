class_name BattleHUD
extends Control
## Crisp anime-fighter HUD drawn via Control._draw() (spec part 3 section 11).
## Reads SimState + FighterBundles only; never writes back to simulation state.

var p1_bundle: DataModels.FighterBundle
var p2_bundle: DataModels.FighterBundle
var p1_portrait: Texture2D
var p2_portrait: Texture2D
var sim_state: SimState
var cpu_enabled: bool = true
var debug_boxes_enabled: bool = true
var checksum_hex: String = ""

# Presentation-only smooth trailing damage bars
var _trail_hp_ratio: PackedFloat32Array = PackedFloat32Array([1.0, 1.0])
var _banner_text: String = ""
var _banner_timer: float = 0.0


func set_fighters(b0: DataModels.FighterBundle, b1: DataModels.FighterBundle, tex0: Texture2D, tex1: Texture2D) -> void:
	p1_bundle = b0
	p2_bundle = b1
	p1_portrait = tex0
	p2_portrait = tex1
	_trail_hp_ratio = PackedFloat32Array([1.0, 1.0])
	queue_redraw()


func show_banner(text: String, duration: float = 1.1) -> void:
	_banner_text = text
	_banner_timer = duration
	queue_redraw()


func update_hud(state: SimState, delta: float, is_cpu: bool, show_boxes: bool) -> void:
	sim_state = state
	cpu_enabled = is_cpu
	debug_boxes_enabled = show_boxes

	for i in range(2):
		var f: SimState.FighterSimState = state.fighters[i]
		var cur_ratio: float = clampf(float(f.hp) / float(maxi(1, f.max_hp)), 0.0, 1.0)
		if cur_ratio >= _trail_hp_ratio[i]:
			_trail_hp_ratio[i] = cur_ratio
		elif f.hitstop_ticks == 0 and f.state_name != "HITSTUN":
			_trail_hp_ratio[i] = move_toward(_trail_hp_ratio[i], cur_ratio, delta * 0.65)
		else:
			_trail_hp_ratio[i] = move_toward(_trail_hp_ratio[i], cur_ratio, delta * 0.12)

	if _banner_timer > 0.0:
		_banner_timer = maxf(0.0, _banner_timer - delta)
	queue_redraw()


func _draw() -> void:
	if sim_state == null:
		return
	var font: Font = ThemeDB.fallback_font
	if font == null:
		return

	var vp_w: float = size.x if size.x > 0.0 else 1280.0
	var vp_h: float = size.y if size.y > 0.0 else 720.0
	var center_x: float = vp_w * 0.5

	# Portraits (sharp framed boxes, left & right)
	_draw_portrait_box(Rect2(24, 18, 68, 68), p1_portrait, Color(0.27, 0.62, 0.98))
	_draw_portrait_box(Rect2(vp_w - 92, 18, 68, 68), p2_portrait, Color(0.95, 0.36, 0.42))

	# Health bars (angled parallelogram fighter bars)
	var bar_w: float = center_x - 166.0
	var f0: SimState.FighterSimState = sim_state.fighters[0]
	var f1: SimState.FighterSimState = sim_state.fighters[1]
	var r0: float = clampf(float(f0.hp) / float(maxi(1, f0.max_hp)), 0.0, 1.0)
	var r1: float = clampf(float(f1.hp) / float(maxi(1, f1.max_hp)), 0.0, 1.0)

	_draw_angled_hp_bar(Vector2(102, 26), bar_w, 26.0, r0, _trail_hp_ratio[0], false, Color(0.18, 0.86, 0.52))
	_draw_angled_hp_bar(Vector2(vp_w - 102, 26), bar_w, 26.0, r1, _trail_hp_ratio[1], true, Color(0.18, 0.86, 0.52))

	# Character names & numeric HP
	var name0: String = "%s (%s)" % [p1_bundle.name_zh, p1_bundle.name_en] if p1_bundle != null else "P1"
	var name1: String = "%s (%s)%s" % [p2_bundle.name_zh, p2_bundle.name_en, " [CPU]" if cpu_enabled else " [P2]"] if p2_bundle != null else "P2"
	draw_string(font, Vector2(106, 72), name0, HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color(0.92, 0.96, 1.0))
	draw_string(font, Vector2(106 + bar_w - 95, 72), "%d / %d" % [f0.hp, f0.max_hp], HORIZONTAL_ALIGNMENT_RIGHT, 95, 14, Color(0.75, 0.84, 0.95))
	draw_string(font, Vector2(vp_w - 106 - bar_w, 72), "%d / %d" % [f1.hp, f1.max_hp], HORIZONTAL_ALIGNMENT_LEFT, 95, 14, Color(0.75, 0.84, 0.95))
	draw_string(font, Vector2(vp_w - 106 - bar_w, 72), name1, HORIZONTAL_ALIGNMENT_RIGHT, bar_w, 16, Color(1.0, 0.92, 0.94))

	# Round win diamonds
	for r_idx in range(2):
		var p1_won: bool = sim_state.rounds_won[0] > r_idx
		var p2_won: bool = sim_state.rounds_won[1] > r_idx
		_draw_diamond(Vector2(center_x - 68.0 - float(r_idx) * 22.0, 68.0), 7.0, p1_won, Color(1.0, 0.82, 0.22))
		_draw_diamond(Vector2(center_x + 68.0 + float(r_idx) * 22.0, 68.0), 7.0, p2_won, Color(1.0, 0.82, 0.22))

	# Center countdown timer
	@warning_ignore("integer_division")
	var secs_left: int = (sim_state.round_timer_ticks + 59) / 60
	var timer_box := PackedVector2Array([
		Vector2(center_x - 46, 16), Vector2(center_x + 46, 16),
		Vector2(center_x + 38, 66), Vector2(center_x - 38, 66),
	])
	draw_colored_polygon(timer_box, Color(0.08, 0.10, 0.16, 0.95))
	draw_polyline(PackedVector2Array([timer_box[0], timer_box[1], timer_box[2], timer_box[3], timer_box[0]]), Color(0.92, 0.78, 0.32), 2.0)
	var t_color: Color = Color(1.0, 0.35, 0.35) if secs_left <= 15 else Color(1.0, 0.96, 0.84)
	draw_string(font, Vector2(center_x - 38, 52), "%02d" % secs_left, HORIZONTAL_ALIGNMENT_CENTER, 76, 30, t_color)

	# Bottom super gauge bars
	var g0: float = clampf(float(f0.gauge) / float(maxi(1, f0.max_gauge)), 0.0, 1.0)
	var g1: float = clampf(float(f1.gauge) / float(maxi(1, f1.max_gauge)), 0.0, 1.0)
	_draw_gauge_bar(Rect2(32, vp_h - 46, 300, 14), g0, false, f0.gauge)
	_draw_gauge_bar(Rect2(vp_w - 332, vp_h - 46, 300, 14), g1, true, f1.gauge)

	# Combo callouts (opponent's combo_count reflects active combo landed by player)
	if f1.combo_count >= 2:
		draw_string(font, Vector2(36, 150), "%d HITS!" % f1.combo_count, HORIZONTAL_ALIGNMENT_LEFT, -1, 32, Color(1.0, 0.84, 0.24))
	if f0.combo_count >= 2:
		draw_string(font, Vector2(vp_w - 236, 150), "%d HITS!" % f0.combo_count, HORIZONTAL_ALIGNMENT_RIGHT, 200, 32, Color(1.0, 0.48, 0.36))

	# Center phase / event banner
	var active_banner: String = _compute_phase_banner()
	if active_banner != "":
		var bw: float = 460.0
		draw_rect(Rect2(center_x - bw * 0.5, vp_h * 0.34 - 36.0, bw, 62.0), Color(0.05, 0.06, 0.10, 0.84), true)
		draw_line(Vector2(center_x - bw * 0.5, vp_h * 0.34 - 36.0), Vector2(center_x + bw * 0.5, vp_h * 0.34 - 36.0), Color(1.0, 0.80, 0.28), 2.5)
		draw_line(Vector2(center_x - bw * 0.5, vp_h * 0.34 + 26.0), Vector2(center_x + bw * 0.5, vp_h * 0.34 + 26.0), Color(1.0, 0.80, 0.28), 2.5)
		draw_string(font, Vector2(center_x - bw * 0.5, vp_h * 0.34 + 8.0), active_banner, HORIZONTAL_ALIGNMENT_CENTER, bw, 36, Color(1.0, 0.94, 0.72))

	# Footer keybind & determinism status bar
	var hint: String = "P1: WASD+J(轻)/K(重)/U(技)/L(防)   P2: 方向键+M/,/./ /   [F1] 换阵容  [F2] CPU:%s  [F3] 判定框:%s  [F4] 快照存取  [R] 重开" % [
		"ON" if cpu_enabled else "OFF",
		"ON" if debug_boxes_enabled else "OFF",
	]
	draw_rect(Rect2(0, vp_h - 24, vp_w, 24), Color(0.04, 0.05, 0.08, 0.82), true)
	draw_string(font, Vector2(14, vp_h - 7), hint, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(0.72, 0.78, 0.88))
	if checksum_hex != "":
		draw_string(font, Vector2(vp_w - 230, vp_h - 7), " tick:%d  #%s" % [sim_state.tick, checksum_hex], HORIZONTAL_ALIGNMENT_RIGHT, 216, 12, Color(0.52, 0.72, 0.62))


func _compute_phase_banner() -> String:
	match sim_state.round_phase:
		SimState.RoundPhase.INTRO:
			return "ROUND %d" % sim_state.round_number
		SimState.RoundPhase.KO:
			return "DOUBLE K.O.!" if sim_state.round_winner == 2 else "K.O.!"
		SimState.RoundPhase.ROUND_END:
			if sim_state.round_winner == 0:
				return "P1 TAKES ROUND"
			if sim_state.round_winner == 1:
				return "P2 TAKES ROUND"
			return "DRAW ROUND"
		SimState.RoundPhase.MATCH_END:
			if sim_state.match_winner == 0:
				return "PLAYER 1 VICTORY!  [R] REMATCH"
			if sim_state.match_winner == 1:
				return "PLAYER 2 VICTORY!  [R] REMATCH"
			return "DRAW MATCH!  [R] REMATCH"
	if _banner_timer > 0.0:
		return _banner_text
	return ""


func _draw_portrait_box(rect: Rect2, tex: Texture2D, border_col: Color) -> void:
	draw_rect(rect, Color(0.09, 0.11, 0.16, 0.95), true)
	if tex != null:
		draw_texture_rect(tex, rect.grow(-2.0), false)
	draw_rect(rect, border_col, false, 2.5)


func _draw_angled_hp_bar(anchor: Vector2, width: float, height: float, ratio: float, trail: float, right_side: bool, fill_col: Color) -> void:
	var slant: float = 12.0
	var dir: float = -1.0 if right_side else 1.0
	var bg := PackedVector2Array([
		anchor,
		anchor + Vector2(dir * width, 0),
		anchor + Vector2(dir * (width - slant), height),
		anchor + Vector2(dir * (-slant), height),
	])
	draw_colored_polygon(bg, Color(0.10, 0.12, 0.17, 0.92))

	# Damage trail (red/amber)
	if trail > 0.001:
		var tw: float = width * trail
		var tp := PackedVector2Array([
			anchor,
			anchor + Vector2(dir * tw, 0),
			anchor + Vector2(dir * (tw - slant), height),
			anchor + Vector2(dir * (-slant), height),
		])
		draw_colored_polygon(tp, Color(0.88, 0.24, 0.26, 0.92))

	# Current HP fill (drains toward center like classic anime fighters)
	if ratio > 0.001:
		var cw: float = width * ratio
		var col: Color = Color(0.95, 0.72, 0.18) if ratio < 0.30 else fill_col
		var fp := PackedVector2Array([
			anchor,
			anchor + Vector2(dir * cw, 0),
			anchor + Vector2(dir * (cw - slant), height),
			anchor + Vector2(dir * (-slant), height),
		])
		draw_colored_polygon(fp, col)

	draw_polyline(PackedVector2Array([bg[0], bg[1], bg[2], bg[3], bg[0]]), Color(0.86, 0.90, 0.96, 0.95), 2.0)


func _draw_diamond(center: Vector2, r: float, filled: bool, col: Color) -> void:
	var pts := PackedVector2Array([
		center + Vector2(0, -r), center + Vector2(r, 0),
		center + Vector2(0, r), center + Vector2(-r, 0),
	])
	draw_colored_polygon(pts, col if filled else Color(0.12, 0.14, 0.20, 0.9))
	draw_polyline(PackedVector2Array([pts[0], pts[1], pts[2], pts[3], pts[0]]), Color(0.92, 0.88, 0.76), 1.5)


func _draw_gauge_bar(rect: Rect2, ratio: float, right_align: bool, val: int) -> void:
	draw_rect(rect, Color(0.08, 0.10, 0.15, 0.9), true)
	var w: float = rect.size.x * ratio
	if w > 0.5:
		var fill_rect := Rect2(rect.position.x + (rect.size.x - w if right_align else 0.0), rect.position.y, w, rect.size.y)
		draw_rect(fill_rect, Color(0.24, 0.74, 1.0) if ratio < 1.0 else Color(1.0, 0.82, 0.24), true)
	draw_rect(rect, Color(0.65, 0.78, 0.95), false, 1.5)
	var font: Font = ThemeDB.fallback_font
	if font != null:
		draw_string(font, Vector2(rect.position.x, rect.position.y - 4), "GAUGE %d" % val,
			HORIZONTAL_ALIGNMENT_RIGHT if right_align else HORIZONTAL_ALIGNMENT_LEFT, rect.size.x, 12, Color(0.75, 0.88, 1.0))
