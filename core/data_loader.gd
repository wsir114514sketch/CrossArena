class_name DataLoader
extends RefCounted
## Reads ip_content/* and combat/combat_config.json into pure runtime DataModels.
## Core engine code never hardcodes any IP id, character id, or asset path (Decision D11).

const CONTENT_ROOT: String = "res://ip_content"
const COMBAT_CONFIG_PATH: String = "res://combat/combat_config.json"
const STATE_TABLE_PATH: String = "res://fighter/state_transitions.json"


static func read_json_dict(res_path: String) -> Dictionary:
	if not FileAccess.file_exists(res_path):
		push_error("DataLoader: missing JSON file %s" % res_path)
		return {}
	var text: String = FileAccess.get_file_as_string(res_path)
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("DataLoader: invalid JSON object in %s" % res_path)
		return {}
	return parsed as Dictionary


static func load_combat_config(res_path: String = COMBAT_CONFIG_PATH) -> DataModels.CombatConfigData:
	var cfg := DataModels.CombatConfigData.new()
	if not FileAccess.file_exists(res_path):
		return cfg
	var d: Dictionary = read_json_dict(res_path)
	if d.is_empty():
		return cfg
	cfg.stage_half_width = int(d.get("stage_half_width", cfg.stage_half_width))
	cfg.corner_pushback_permille = int(d.get("corner_pushback_permille", cfg.corner_pushback_permille))
	cfg.input_buffer_frames = int(d.get("input_buffer_frames", cfg.input_buffer_frames))
	cfg.motion_input_window_frames = int(d.get("motion_input_window_frames", cfg.motion_input_window_frames))
	cfg.juggle_max_hits = int(d.get("juggle_max_hits", cfg.juggle_max_hits))
	cfg.same_move_combo_limit = int(d.get("same_move_combo_limit", cfg.same_move_combo_limit))
	cfg.min_damage_scaling_pct = int(d.get("min_damage_scaling_pct", cfg.min_damage_scaling_pct))
	if d.has("damage_scaling_pct") and typeof(d["damage_scaling_pct"]) == TYPE_ARRAY:
		var arr := PackedInt64Array()
		for item in d["damage_scaling_pct"]:
			arr.append(int(item))
		if not arr.is_empty():
			cfg.damage_scaling_pct = arr
	cfg.round_time_seconds = int(d.get("round_time_seconds", cfg.round_time_seconds))
	cfg.rounds_to_win = int(d.get("rounds_to_win", cfg.rounds_to_win))
	cfg.intro_ticks = int(d.get("intro_ticks", cfg.intro_ticks))
	cfg.ko_ticks = int(d.get("ko_ticks", cfg.ko_ticks))
	cfg.round_end_ticks = int(d.get("round_end_ticks", cfg.round_end_ticks))
	cfg.p1_start_x = int(d.get("p1_start_x", cfg.p1_start_x))
	cfg.p2_start_x = int(d.get("p2_start_x", cfg.p2_start_x))
	return cfg


static func list_ips(include_test: bool = false, content_root: String = CONTENT_ROOT) -> Array[DataModels.IPInfo]:
	## Scans ip_content/ in sorted directory order. Excludes test_only packs unless include_test is true (D9).
	var result: Array[DataModels.IPInfo] = []
	var dir := DirAccess.open(content_root)
	if dir == null:
		return result
	var ip_names := PackedStringArray()
	dir.list_dir_begin()
	var entry: String = dir.get_next()
	while entry != "":
		if dir.current_is_dir() and not entry.begins_with("."):
			ip_names.append(entry)
		entry = dir.get_next()
	dir.list_dir_end()
	ip_names.sort()

	for ip_name in ip_names:
		var ip_dir: String = "%s/%s" % [content_root, ip_name]
		var ip_json_path: String = "%s/ip.json" % ip_dir
		if not FileAccess.file_exists(ip_json_path):
			continue
		var d: Dictionary = read_json_dict(ip_json_path)
		if d.is_empty():
			continue
		var is_test: bool = bool(d.get("test_only", false))
		if is_test and not include_test:
			continue
		var info := DataModels.IPInfo.new()
		info.id = String(d.get("id", ip_name))
		info.name_zh = String(d.get("name_zh", info.id))
		info.name_en = String(d.get("name_en", info.id))
		info.cover_path = "%s/%s" % [ip_dir, String(d.get("cover", "cover.png"))]
		info.description = String(d.get("description", ""))
		info.status = String(d.get("status", "locked"))
		info.test_only = is_test
		info.character_ids = _scan_character_ids(ip_dir, info.id)
		result.append(info)
	return result


static func list_playable_character_ids(include_test: bool = false, content_root: String = CONTENT_ROOT) -> PackedStringArray:
	var out := PackedStringArray()
	for ip_info in list_ips(include_test, content_root):
		if ip_info.status != "open":
			continue
		for cid in ip_info.character_ids:
			out.append(cid)
	return out


static func load_fighter(character_id: String, content_root: String = CONTENT_ROOT) -> DataModels.FighterBundle:
	var parts: PackedStringArray = character_id.split(".", false, 1)
	if parts.size() != 2:
		push_error("DataLoader.load_fighter: invalid character_id '%s'" % character_id)
		return null
	var ip_id: String = parts[0]
	var short_name: String = parts[1]
	var ip_dir: String = "%s/%s" % [content_root, ip_id]
	var char_dir: String = "%s/characters/%s" % [ip_dir, short_name]
	var d: Dictionary = read_json_dict("%s/character.json" % char_dir)
	if d.is_empty():
		return null

	var b := DataModels.FighterBundle.new()
	b.id = String(d.get("id", character_id))
	b.ip_id = String(d.get("ip_id", ip_id))
	b.name_zh = String(d.get("name_zh", short_name))
	b.name_en = String(d.get("name_en", short_name))
	b.base_dir = char_dir
	b.ip_dir = ip_dir
	b.portrait_path = "%s/%s" % [char_dir, String(d.get("portrait", "previews/portrait.png"))]
	b.splash_path = "%s/%s" % [char_dir, String(d.get("splash", "previews/splash.png"))]

	var stats: Dictionary = d.get("stats", {}) as Dictionary
	b.max_hp = int(stats.get("max_hp", 1000))
	b.walk_speed = int(stats.get("walk_speed", 3000))
	b.jump_velocity = int(stats.get("jump_velocity", 14000))
	b.gravity = int(stats.get("gravity", 700))
	b.defense = int(stats.get("defense", 100))
	b.max_gauge = int(stats.get("max_gauge", 1000))
	b.gauge_gain_on_hurt_pct = int(stats.get("gauge_gain_on_hurt_pct", 50))
	b.gauge_gain_on_block_pct = int(stats.get("gauge_gain_on_block_pct", 25))
	b.height_scale = float(d.get("height_scale", 1.0))

	var ai: Dictionary = d.get("ai_profile", {}) as Dictionary
	b.ai_aggression_permille = int(round(float(ai.get("aggression", 0.5)) * 1000.0))
	b.ai_zoning_permille = int(round(float(ai.get("zoning", 0.5)) * 1000.0))

	var unsup := PackedStringArray()
	for u in d.get("unsupported_core_moves", []):
		unsup.append(String(u))
	b.unsupported_core_moves = unsup

	var hb_name: String = String(d.get("hurtboxes", "hurtbox_default"))
	b.hurtboxes = _load_hurtboxes("%s/framedata/hurtboxes.json" % char_dir, hb_name)
	b.anims = _load_animations(char_dir)
	b.moves = _load_moves("%s/framedata" % char_dir)
	var sorted_mids := PackedStringArray()
	for k in b.moves.keys():
		sorted_mids.append(String(k))
	sorted_mids.sort()
	b.move_ids_sorted = sorted_mids

	for sref in d.get("skills", []):
		var sk := _load_skill("%s/%s" % [char_dir, String(sref)])
		if sk != null:
			b.skills.append(sk)
	return b


static func _scan_character_ids(ip_dir: String, ip_id: String) -> PackedStringArray:
	var out := PackedStringArray()
	var croot: String = "%s/characters" % ip_dir
	var dir := DirAccess.open(croot)
	if dir == null:
		return out
	var names := PackedStringArray()
	dir.list_dir_begin()
	var entry: String = dir.get_next()
	while entry != "":
		if dir.current_is_dir() and not entry.begins_with("."):
			if FileAccess.file_exists("%s/%s/character.json" % [croot, entry]):
				names.append("%s.%s" % [ip_id, entry])
		entry = dir.get_next()
	dir.list_dir_end()
	names.sort()
	return names


static func _to_rect4(arr: Variant) -> PackedInt64Array:
	var a: Array = arr as Array
	return PackedInt64Array([int(a[0]), int(a[1]), int(a[2]), int(a[3])])


static func _to_rect_list(arr: Variant) -> Array[PackedInt64Array]:
	var out: Array[PackedInt64Array] = []
	if typeof(arr) == TYPE_ARRAY:
		for r in arr:
			out.append(_to_rect4(r))
	return out


static func _load_hurtboxes(res_path: String, config_name: String) -> DataModels.HurtboxProfile:
	var hp := DataModels.HurtboxProfile.new()
	var d: Dictionary = read_json_dict(res_path)
	if not d.has(config_name):
		return hp
	var cfg: Dictionary = d[config_name] as Dictionary
	hp.stand = _to_rect_list(cfg.get("stand", []))
	hp.crouch = _to_rect_list(cfg.get("crouch", []))
	hp.air = _to_rect_list(cfg.get("air", []))
	hp.down = _to_rect_list(cfg.get("down", []))
	var push: Dictionary = cfg.get("pushbox", {}) as Dictionary
	if push.has("stand"):
		hp.push_stand = _to_rect4(push["stand"])
	if push.has("crouch"):
		hp.push_crouch = _to_rect4(push["crouch"])
	if push.has("air"):
		hp.push_air = _to_rect4(push["air"])
	if push.has("down"):
		hp.push_down = _to_rect4(push["down"])
	return hp


static func _load_animations(char_dir: String) -> Dictionary:
	var out: Dictionary = {}
	var meta_dir: String = "%s/metadata" % char_dir
	var dir := DirAccess.open(meta_dir)
	if dir == null:
		return out
	var files := PackedStringArray()
	dir.list_dir_begin()
	var f: String = dir.get_next()
	while f != "":
		if not dir.current_is_dir() and f.ends_with(".json") and f != "sources.json":
			files.append(f)
		f = dir.get_next()
	dir.list_dir_end()
	files.sort()

	for fname in files:
		var d: Dictionary = read_json_dict("%s/%s" % [meta_dir, fname])
		if d.is_empty():
			continue
		var a := DataModels.AnimSpec.new()
		a.animation_id = String(d.get("animation_id", fname.get_basename()))
		a.animation_type = String(d.get("animation_type", "core"))
		a.source_frames = String(d.get("source_frames", "animations/%s/" % a.animation_id))
		a.frame_count = int(d.get("frame_count", 1))
		a.animation_fps = int(d.get("animation_fps", 30))
		a.loop = bool(d.get("loop", false))
		a.facing_mode = String(d.get("facing_mode", "flip"))
		var cs: Array = d.get("canvas_size", [512, 512]) as Array
		a.canvas_size = Vector2i(int(cs[0]), int(cs[1]))
		var pv: Array = d.get("pivot", [256, 480]) as Array
		a.pivot = Vector2i(int(pv[0]), int(pv[1]))
		var ga: Array = d.get("ground_anchor", [256, 480]) as Array
		a.ground_anchor = Vector2i(int(ga[0]), int(ga[1]))
		for ev in d.get("presentation_events", []):
			var ed: Dictionary = ev as Dictionary
			var pe := DataModels.PresentationEventSpec.new()
			pe.frame = int(ed.get("frame", 0))
			pe.type = String(ed.get("type", ""))
			pe.id = String(ed.get("id", ""))
			a.presentation_events.append(pe)
		# Optional packed sprite sheet metadata in sprites/<anim>.json
		var atlas_json_path: String = "%s/sprites/%s.json" % [char_dir, a.animation_id]
		if FileAccess.file_exists(atlas_json_path):
			var ad: Dictionary = read_json_dict(atlas_json_path)
			a.sheet_path = "%s/sprites/%s" % [char_dir, String(ad.get("sheet", "%s.png" % a.animation_id))]
			for fr in ad.get("frames", []):
				var fd: Dictionary = fr as Dictionary
				var reg := DataModels.AtlasFrameRegion.new()
				var r: Array = fd.get("rect", [0, 0, a.canvas_size.x, a.canvas_size.y]) as Array
				var c: Array = fd.get("crop_offset", [0, 0]) as Array
				reg.region = Rect2i(int(r[0]), int(r[1]), int(r[2]), int(r[3]))
				reg.crop_offset = Vector2i(int(c[0]), int(c[1]))
				a.atlas_frames.append(reg)
		out[a.animation_id] = a
	return out


static func _parse_hit_spec(hd: Dictionary) -> DataModels.HitBoxSpec:
	var hb := DataModels.HitBoxSpec.new()
	if hd.has("frames"):
		var fr: Array = hd["frames"] as Array
		hb.frames_start = int(fr[0])
		hb.frames_end = int(fr[1])
	hb.hit_index = int(hd.get("hit_index", 0))
	if hd.has("rect"):
		hb.rect = _to_rect4(hd["rect"])
	hb.damage = int(hd.get("damage", 0))
	var kb: Array = hd.get("knockback", [0, 0]) as Array
	hb.knockback_x = int(kb[0])
	hb.knockback_y = int(kb[1])
	hb.hitstun = int(hd.get("hitstun", 0))
	hb.blockstun = int(hd.get("blockstun", 0))
	hb.hitstop = int(hd.get("hitstop", 0))
	hb.block_hitstop = int(hd.get("block_hitstop", hb.hitstop))
	hb.air_hit = bool(hd.get("air_hit", true))
	hb.priority = int(hd.get("priority", 1))
	hb.meter_gain_on_hit = int(hd.get("meter_gain_on_hit", 20))
	hb.meter_gain_on_block = int(hd.get("meter_gain_on_block", 10))
	return hb


static func _load_moves(fd_dir: String) -> Dictionary:
	var out: Dictionary = {}
	var dir := DirAccess.open(fd_dir)
	if dir == null:
		return out
	var files := PackedStringArray()
	dir.list_dir_begin()
	var f: String = dir.get_next()
	while f != "":
		if not dir.current_is_dir() and f.ends_with(".json") and f != "hurtboxes.json":
			files.append(f)
		f = dir.get_next()
	dir.list_dir_end()
	files.sort()

	for fname in files:
		var d: Dictionary = read_json_dict("%s/%s" % [fd_dir, fname])
		if d.is_empty():
			continue
		var m := DataModels.MoveFrameData.new()
		m.move_id = String(d.get("move_id", fname.get_basename()))
		m.animation_id = String(d.get("animation_id", m.move_id))
		m.startup = int(d.get("startup", 0))
		m.active = int(d.get("active", 0))
		m.recovery = int(d.get("recovery", 0))
		m.total_ticks = m.startup + m.active + m.recovery
		m.meter_gain_on_whiff = int(d.get("meter_gain_on_whiff", 0))
		if d.has("super_freeze") and typeof(d["super_freeze"]) == TYPE_DICTIONARY:
			var sf: Dictionary = d["super_freeze"] as Dictionary
			m.has_super_freeze = true
			m.super_freeze_frame = int(sf.get("frame", 0))
			m.super_freeze_duration = int(sf.get("duration", 0))
		for h in d.get("hitboxes", []):
			m.hitboxes.append(_parse_hit_spec(h as Dictionary))
		for cw in d.get("cancel_windows", []):
			var cd: Dictionary = cw as Dictionary
			var c := DataModels.CancelWindowSpec.new()
			var fr: Array = cd["frames"] as Array
			c.frames_start = int(fr[0])
			c.frames_end = int(fr[1])
			var into := PackedStringArray()
			for t in cd.get("into", []):
				into.append(String(t))
			c.into = into
			m.cancel_windows.append(c)
		for inv in d.get("invuln_frames", []):
			var ir: Array = inv as Array
			m.invuln_ranges.append(PackedInt64Array([int(ir[0]), int(ir[1])]))
		for arm in d.get("armor_frames", []):
			var ar: Array = arm as Array
			m.armor_ranges.append(PackedInt64Array([int(ar[0]), int(ar[1])]))
		for ov in d.get("hurtbox_override", []):
			var od: Dictionary = ov as Dictionary
			var spec := DataModels.HurtboxOverrideSpec.new()
			var fr2: Array = od["frames"] as Array
			spec.frames_start = int(fr2[0])
			spec.frames_end = int(fr2[1])
			spec.rects = _to_rect_list(od.get("rects", []))
			m.hurtbox_overrides.append(spec)
		for ps in d.get("projectile_spawn", []):
			var pd: Dictionary = ps as Dictionary
			var pspec := DataModels.ProjectileSpawnSpec.new()
			pspec.frame = int(pd.get("frame", 0))
			var off: Array = pd.get("offset", [0, 0]) as Array
			pspec.offset_x = int(off[0])
			pspec.offset_y = int(off[1])
			pspec.rect = _to_rect4(pd["rect"])
			pspec.hit = _parse_hit_spec(pd.get("hit", {}) as Dictionary)
			m.projectile_spawns.append(pspec)
		out[m.move_id] = m
	return out


static func _load_skill(res_path: String) -> DataModels.SkillSpec:
	var d: Dictionary = read_json_dict(res_path)
	if d.is_empty():
		return null
	var s := DataModels.SkillSpec.new()
	s.skill_id = String(d.get("skill_id", res_path.get_file().get_basename()))
	s.type = String(d.get("type", "melee"))
	s.input_code = String(d.get("input", ""))
	s.cost = int(d.get("cost", 0))
	s.cooldown = int(d.get("cooldown", 0))
	s.move_id = String(d.get("move_id", ""))
	if d.has("projectile") and typeof(d["projectile"]) == TYPE_DICTIONARY:
		var pd: Dictionary = d["projectile"] as Dictionary
		s.proj_effect = String(pd.get("effect", ""))
		s.proj_speed = int(pd.get("speed", 0))
		s.proj_vel_y = int(pd.get("velocity_y", 0))
		s.proj_gravity = int(pd.get("projectile_gravity", 0))
		s.proj_lifetime = int(pd.get("lifetime", 60))
	return s
